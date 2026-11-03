-- 929: رقم واتساب ورقم إضافي للمريض، «شكوى المريض / سبب الزيارة» في التشخيص، تصنيف ملفات المريض (أشعة/تحاليل)، ومواعيد المتابعات.
-- كله إضافات (add column if not exists / create table if not exists) — مفيش بيانات بتتمسح أو بتتغير.

-- ===== 1. أرقام التواصل =====
-- whatsapp_mode: الرقم اللي عليه واتساب — phone = الأساسي (الافتراضي = نفس السلوك القديم)، phone2 = الإضافي، other = رقم تالت في whatsapp_phone، none = مفيش واتساب
alter table patients add column if not exists phone2 text not null default '';
alter table patients add column if not exists whatsapp_mode text not null default 'phone';
alter table patients add column if not exists whatsapp_phone text not null default '';
alter table patients drop constraint if exists patients_whatsapp_mode_check;
alter table patients add constraint patients_whatsapp_mode_check check (whatsapp_mode in ('phone', 'phone2', 'other', 'none'));

-- ===== 2. شكوى المريض / سبب الزيارة (خانة كتابة حرة مستقلة عن الشيت) =====
alter table ortho_consultations add column if not exists visit_reason text not null default '';

-- ===== 3. ملفات المريض: أشعة / تحاليل / أخرى + اسم ووصف + تاريخ الملف =====
alter table patient_files add column if not exists category text not null default 'other';
alter table patient_files drop constraint if exists patient_files_category_check;
alter table patient_files add constraint patient_files_category_check check (category in ('xray', 'lab', 'other'));
alter table patient_files add column if not exists title text not null default '';
alter table patient_files add column if not exists file_date date;
create index if not exists patient_files_category_idx on patient_files (patient_id, category);

-- ===== 4. مواعيد المتابعات =====
-- سجل مستقل (مش حجز): بيتربط بالمريض والتشخيص اللي اتحدد منه والطبيب المسؤول؛ التحويل لحجز فعلي بيملا appointment_id.
-- «اليوم» و«فائتة» و«قادمة» بتتحسب من التاريخ لما الحالة scheduled — المخزن: scheduled / done / cancelled بس
create table if not exists ortho_follow_ups (
  id uuid primary key default gen_random_uuid(),
  patient_id uuid not null references patients(id) on delete cascade,
  consultation_id uuid references ortho_consultations(id) on delete set null,
  doctor_id uuid references therapists(id) on delete set null,
  date date not null,
  time time,
  reason text not null default '',
  notes text not null default '',
  status text not null default 'scheduled' check (status in ('scheduled', 'done', 'cancelled')),
  appointment_id uuid references appointments(id) on delete set null,
  created_by uuid references employees(id) on delete set null default my_employee_id(),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index if not exists ortho_follow_ups_date on ortho_follow_ups(date, time);
create index if not exists ortho_follow_ups_patient on ortho_follow_ups(patient_id, date desc);
create index if not exists ortho_follow_ups_consult on ortho_follow_ups(consultation_id);

alter table ortho_follow_ups enable row level security;
revoke all on ortho_follow_ups from anon;
grant select, insert, update, delete on ortho_follow_ups to authenticated;
-- القراية: أي حد بيشوف ملفات المرضى. الإضافة/التعديل: الطبيب (sessions) أو الاستقبال (appointments). الحذف: المدير أو صلاحية حذف الجلسات
drop policy if exists staff_read on ortho_follow_ups;
create policy staff_read on ortho_follow_ups for select using ((select has_perm('patients', 'view')));
drop policy if exists staff_insert on ortho_follow_ups;
create policy staff_insert on ortho_follow_ups for insert with check ((select has_perm('sessions', 'create')) or (select has_perm('appointments', 'create')));
drop policy if exists staff_update on ortho_follow_ups;
create policy staff_update on ortho_follow_ups for update
  using ((select has_perm('sessions', 'edit')) or (select has_perm('appointments', 'edit')))
  with check ((select has_perm('sessions', 'edit')) or (select has_perm('appointments', 'edit')));
drop policy if exists staff_delete on ortho_follow_ups;
create policy staff_delete on ortho_follow_ups for delete using ((select has_perm('sessions', 'delete')) or (select is_admin()));
drop trigger if exists trg_touch on ortho_follow_ups;
create trigger trg_touch before update on ortho_follow_ups for each row execute function ortho_touch();
drop trigger if exists trg_audit on ortho_follow_ups;
create trigger trg_audit after insert or update or delete on ortho_follow_ups for each row execute function audit_row();
drop trigger if exists trg_sync_tombstone on ortho_follow_ups;
create trigger trg_sync_tombstone after delete on ortho_follow_ups for each row execute function sync_tombstone();
