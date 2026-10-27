-- ===================================================================
-- 005 — منصة كاملة: حساب المريض، ملفات المرضى (Storage)، سجل الجسم، Audit Log،
-- أسعار الخدمات المتعددة، إعدادات المركز الموسّعة، صلاحية البيانات المالية، Realtime.
-- قابل لإعادة التشغيل (idempotent).
-- ===================================================================

-- ===== إعدادات المركز الموسّعة =====
alter table center_info add column if not exists email text not null default '';
alter table center_info add column if not exists street text not null default '';
alter table center_info add column if not exists logo_url text not null default '';
alter table center_info add column if not exists currency text not null default 'SAR';
alter table center_info add column if not exists default_appointment_min int not null default 30 check (default_appointment_min between 5 and 240);
alter table center_info add column if not exists cancel_before_hours int not null default 24 check (cancel_before_hours >= 0);

-- ===== المرضى: بيانات تواصل وعنوان وطبيب مسؤول =====
alter table patients add column if not exists email text not null default '';
alter table patients add column if not exists city text not null default '';
alter table patients add column if not exists district text not null default '';
alter table patients add column if not exists street text not null default '';
alter table patients add column if not exists doctor_id uuid references therapists(id) on delete set null;
create index if not exists idx_patients_doctor on patients(doctor_id);
create index if not exists idx_patients_name on patients(lower(full_name));
create index if not exists idx_patients_registered on patients(registered_at desc);
create index if not exists idx_patients_source on patients(referral_source);

-- ===== الأطباء: بيانات إضافية =====
alter table therapists add column if not exists email text not null default '';
alter table therapists add column if not exists bio text not null default '';
alter table therapists add column if not exists photo_url text not null default '';
alter table therapists add column if not exists default_duration_min int not null default 30 check (default_duration_min between 5 and 240);

-- ===== المواعيد: ملاحظات + حالة "قيد الزيارة" =====
alter table appointments add column if not exists notes text not null default '';
alter table appointments drop constraint if exists appointments_status_check;
alter table appointments add constraint appointments_status_check
  check (status in ('new','confirmed','on_way','arrived','in_progress','no_show','completed','cancelled','rescheduled'));
create table if not exists appointment_status_history (
  id uuid primary key default gen_random_uuid(),
  appointment_id uuid not null references appointments(id) on delete cascade,
  old_status text,
  new_status text not null,
  changed_by uuid,
  reason text,
  changed_at timestamptz not null default now()
);
create index if not exists idx_ash_appt on appointment_status_history(appointment_id, changed_at);

-- ===== أسعار الخدمات المتعددة (عادي / عرض / حسب الطبيب) =====
create table if not exists service_prices (
  id uuid primary key default gen_random_uuid(),
  service_id text not null references services(id) on delete cascade,
  label text not null check (length(trim(label)) > 0),
  price numeric(10,2) not null check (price >= 0),
  therapist_id uuid references therapists(id) on delete cascade,
  active boolean not null default true,
  created_at timestamptz not null default now()
);
create index if not exists idx_service_prices_service on service_prices(service_id);

-- ===== سجل الجسم (المنطقة المتأثرة/المشكلة/التشخيص/الدرجة) مرتبط بالمريض والزيارة والطبيب =====
create table if not exists body_records (
  id uuid primary key default gen_random_uuid(),
  patient_id uuid not null references patients(id) on delete cascade,
  appointment_id uuid references appointments(id) on delete set null,
  session_id uuid references treatment_sessions(id) on delete set null,
  therapist_id uuid references therapists(id) on delete set null,
  region_id text not null,
  condition_id text,
  side text check (side in ('right','left','both')),
  problem text not null default '',
  diagnosis text not null default '',
  severity int not null default 1 check (severity between 1 and 5),
  notes text not null default '',
  created_by uuid references employees(id) on delete set null,
  created_at timestamptz not null default now()
);
create index if not exists idx_body_records_patient on body_records(patient_id, created_at desc);

-- ===== ملفات المرضى (Supabase Storage) =====
create table if not exists patient_files (
  id uuid primary key default gen_random_uuid(),
  patient_id uuid not null references patients(id) on delete cascade,
  uploaded_by uuid,                       -- auth uid لمن رفع الملف (موظف أو المريض نفسه)
  uploaded_by_name text not null default '',
  file_path text not null unique,         -- المسار داخل bucket: <patient_id>/<uuid>-<name>
  file_name text not null,
  file_type text not null default '',
  size_bytes bigint not null default 0 check (size_bytes >= 0),
  note text not null default '',
  created_at timestamptz not null default now()
);
create index if not exists idx_patient_files_patient on patient_files(patient_id, created_at desc);

-- ===== Audit Log هيكلي (قبل/بعد) =====
create table if not exists audit_logs (
  id bigserial primary key,
  at timestamptz not null default now(),
  user_id uuid,                            -- auth uid
  employee_id uuid,
  action text not null,                    -- insert | update | delete | login | ...
  table_name text not null,
  record_id text,
  old_data jsonb,
  new_data jsonb
);
create index if not exists idx_audit_at on audit_logs(at desc);
create index if not exists idx_audit_table on audit_logs(table_name, record_id);

-- ===== الصلاحية الجديدة: البيانات المالية (الإيرادات والأرباح والتقارير المالية) =====
insert into role_permissions (role, area, ops) values
  ('system_admin','financial','{view,create,edit,delete}'),
  ('center_manager','financial','{view,create,edit,delete}'),
  ('accountant','financial','{view}')
on conflict (role, area) do nothing;
insert into role_permissions (role, area, ops) values ('system_admin','audit','{view}'), ('center_manager','audit','{view}')
  on conflict (role, area) do nothing;

-- ===================================================================
-- دوال مساعدة للهوية
-- ===================================================================
create or replace function is_admin() returns boolean
language sql stable security definer set search_path = public as $$
  select exists (select 1 from employees where auth_user_id = auth.uid() and active and role in ('system_admin','center_manager'))
$$;

create or replace function my_patient_id() returns uuid
language sql stable security definer set search_path = public as $$
  select patient_id from customers where auth_user_id = auth.uid() limit 1
$$;

create or replace function my_customer_id() returns uuid
language sql stable security definer set search_path = public as $$
  select id from customers where auth_user_id = auth.uid() limit 1
$$;

-- ===================================================================
-- Row Level Security للجداول الجديدة + سياسات المريض
-- ===================================================================
alter table appointment_status_history enable row level security;
alter table service_prices enable row level security;
alter table body_records enable row level security;
alter table patient_files enable row level security;
alter table audit_logs enable row level security;

do $$
declare r record;
begin
  for r in select polname, relname from pg_policy join pg_class on pg_class.oid = polrelid
           where polname like 'p\_%' escape '\' loop
    execute format('drop policy %I on %I', r.polname, r.relname);
  end loop;
end $$;

-- الموظفون
create policy staff_read on appointment_status_history for select using (
  exists (select 1 from appointments a where a.id = appointment_id and (has_perm('appointments','view') or has_perm('sessions','view')) and can_see_patient(a.patient_id)));
create policy staff_read on service_prices for select using (is_staff());
create policy staff_write on service_prices for insert with check (has_perm('services','create') or has_perm('services','edit'));
create policy staff_update on service_prices for update using (has_perm('services','edit'));
create policy staff_delete on service_prices for delete using (has_perm('services','delete') or has_perm('services','edit'));
create policy staff_read on body_records for select using ((has_perm('plans','view') or has_perm('patients','view')) and can_see_patient(patient_id));
create policy staff_write on body_records for insert with check (has_perm('plans','create') and can_see_patient(patient_id) and created_by = my_employee_id());
create policy staff_update on body_records for update using (has_perm('plans','edit') and can_see_patient(patient_id));
create policy staff_delete on body_records for delete using (has_perm('plans','delete') and can_see_patient(patient_id));
create policy staff_read on patient_files for select using (has_perm('patients','view') and can_see_patient(patient_id));
create policy staff_write on patient_files for insert with check (has_perm('patients','edit') and can_see_patient(patient_id) and uploaded_by = auth.uid());
create policy staff_delete on patient_files for delete using (has_perm('patients','edit') and can_see_patient(patient_id));
create policy staff_read on audit_logs for select using (has_perm('audit','view'));

-- المريض (حسابه فقط)
create policy p_self on patients for select using (id = my_patient_id());
create policy p_self on appointments for select using (patient_id = my_patient_id());
create policy p_self on treatment_plans for select using (patient_id = my_patient_id());
create policy p_self on treatment_sessions for select using (patient_id = my_patient_id());
create policy p_self on invoices for select using (patient_id = my_patient_id());
create policy p_self on invoice_items for select using (exists (select 1 from invoices i where i.id = invoice_id and i.patient_id = my_patient_id()));
create policy p_self on payments for select using (patient_id = my_patient_id());
create policy p_self on packages for select using (patient_id = my_patient_id());
create policy p_self on patient_files for select using (patient_id = my_patient_id());
create policy p_write on patient_files for insert with check (patient_id = my_patient_id() and uploaded_by = auth.uid());
create policy p_delete on patient_files for delete using (patient_id = my_patient_id() and uploaded_by = auth.uid());
create policy p_notif_update on notifications for update using (audience = 'customer' and customer_id = my_customer_id());

-- ===================================================================
-- Audit تلقائي على الجداول الحساسة (قبل/بعد)
-- ===================================================================
create or replace function audit_row() returns trigger
language plpgsql security definer set search_path = public as $$
declare rid text; oldj jsonb; newj jsonb;
begin
  oldj := case when tg_op = 'INSERT' then null else to_jsonb(old) end;
  newj := case when tg_op = 'DELETE' then null else to_jsonb(new) end;
  rid := coalesce(newj->>'id', oldj->>'id', newj->>'role' || ':' || (newj->>'area'), oldj->>'role' || ':' || (oldj->>'area'));
  -- لا نسجل الأعمدة الكبيرة/الحساسة
  oldj := oldj - 'work_hours' - 'on_leave';
  newj := newj - 'work_hours' - 'on_leave';
  insert into audit_logs (user_id, employee_id, action, table_name, record_id, old_data, new_data)
  values (auth.uid(), my_employee_id(), lower(tg_op), tg_table_name, rid, oldj, newj);
  return coalesce(new, old);
end $$;

do $$
declare t text;
begin
  foreach t in array array['patients','appointments','invoices','payments','discount_codes','role_permissions','employees','center_info',
    'treatment_plans','services','therapists','packages','patient_files','body_records','support_tickets','staff_requests','service_prices','branches']
  loop
    execute format('drop trigger if exists trg_audit_row on %I', t);
    execute format('create trigger trg_audit_row after insert or update or delete on %I for each row execute function audit_row()', t);
  end loop;
end $$;

-- تاريخ تغيّر حالة الموعد
create or replace function appt_status_hist() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if tg_op = 'INSERT' then
    insert into appointment_status_history (appointment_id, old_status, new_status, changed_by) values (new.id, null, new.status, auth.uid());
  elsif new.status is distinct from old.status then
    insert into appointment_status_history (appointment_id, old_status, new_status, changed_by, reason) values (new.id, old.status, new.status, auth.uid(), new.cancel_reason);
  end if;
  return new;
end $$;
drop trigger if exists trg_appt_hist on appointments;
create trigger trg_appt_hist after insert or update on appointments for each row execute function appt_status_hist();

-- ===================================================================
-- Storage: bucket خاص بملفات المرضى + سياسات
-- ===================================================================
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('patient-files', 'patient-files', false, 10485760,
        array['application/pdf','image/png','image/jpeg','image/webp','application/msword','application/vnd.openxmlformats-officedocument.wordprocessingml.document','text/plain'])
on conflict (id) do update set public = false, file_size_limit = excluded.file_size_limit, allowed_mime_types = excluded.allowed_mime_types;

drop policy if exists pf_staff_read on storage.objects;
drop policy if exists pf_staff_write on storage.objects;
drop policy if exists pf_staff_delete on storage.objects;
drop policy if exists pf_patient_read on storage.objects;
drop policy if exists pf_patient_write on storage.objects;
drop policy if exists pf_patient_delete on storage.objects;

create or replace function storage_patient_of(p_name text) returns uuid
language plpgsql immutable as $$
begin return ((string_to_array(p_name, '/'))[1])::uuid; exception when others then return null; end $$;

create policy pf_staff_read on storage.objects for select using (bucket_id = 'patient-files' and has_perm('patients','view') and can_see_patient(storage_patient_of(name)));
create policy pf_staff_write on storage.objects for insert with check (bucket_id = 'patient-files' and has_perm('patients','edit') and can_see_patient(storage_patient_of(name)));
create policy pf_staff_delete on storage.objects for delete using (bucket_id = 'patient-files' and has_perm('patients','edit') and can_see_patient(storage_patient_of(name)));
create policy pf_patient_read on storage.objects for select using (bucket_id = 'patient-files' and storage_patient_of(name) = my_patient_id());
create policy pf_patient_write on storage.objects for insert with check (bucket_id = 'patient-files' and storage_patient_of(name) = my_patient_id());
create policy pf_patient_delete on storage.objects for delete using (bucket_id = 'patient-files' and storage_patient_of(name) = my_patient_id());

-- ===================================================================
-- Realtime: تحديث فوري للمواعيد والإشعارات والمالية
-- ===================================================================
do $$
declare t text;
begin
  foreach t in array array['appointments','notifications','invoices','payments','patients','treatment_sessions','treatment_plans','support_tickets','support_replies','staff_requests','body_records','patient_files']
  loop
    begin
      execute format('alter publication supabase_realtime add table %I', t);
    exception when duplicate_object then null; when undefined_object then null;
    end;
  end loop;
end $$;
