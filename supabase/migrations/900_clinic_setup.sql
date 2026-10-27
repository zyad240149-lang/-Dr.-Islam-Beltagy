-- 900: تجهيز قاعدة البيانات لعيادة د. إسلام بلتاجي (جراحة العظام والكسور)
--  1) بيانات العيادة (مصر: جنيه، بدون ضريبة)  2) كتالوج خدمات العظام بدل الخدمات القديمة
--  3) الطبيب الأساسي  4) جداول أقسام العظام (كشوفات / أشعة / عمليات / كسور وجبس) بصلاحيات وسجل تدقيق
--  5) إيقاف الإرسال لهيئة الزكاة نهائيًا  6) مسح سجلات التدقيق الناتجة عن الهجرات نفسها

-- ============ 1) بيانات العيادة ============
update center_info set
  name = 'عيادة د. إسلام بلتاجي لجراحة العظام والكسور', branch_name = 'العيادة الرئيسية', city = 'القاهرة', district = 'مدينة نصر',
  currency = 'EGP', tax_rate = 0, foreign_tax_rate = 0, vat_number = '', cr_number = '',
  work_start = '16:00', work_end = '22:00', slot_step_min = 30, default_appointment_min = 30,
  work_hours = 'يوميًا ماعدا الجمعة من 4 عصرًا حتى 10 مساءً',
  week_schedule = '[{"day":"sun","open":true,"from":"16:00","to":"22:00"},{"day":"mon","open":true,"from":"16:00","to":"22:00"},{"day":"tue","open":true,"from":"16:00","to":"22:00"},{"day":"wed","open":true,"from":"16:00","to":"22:00"},{"day":"thu","open":true,"from":"16:00","to":"22:00"},{"day":"fri","open":false,"from":"16:00","to":"22:00"},{"day":"sat","open":true,"from":"16:00","to":"22:00"}]'::jsonb,
  attendance_since = riyadh_today(), marketing_since = riyadh_today()
where id = 1;
update branches set name = 'العيادة الرئيسية', city = 'القاهرة', district = 'مدينة نصر';

-- ============ 2) خدمات العظام ============
delete from therapist_services;
delete from service_prices;
delete from services where not exists (select 1 from appointments a where a.service_id = services.id);
insert into services (id, name, category, description, price, duration_min, active) values
  ('sv_exam',        'كشف عظام',                      'الكشوفات',         'كشف إكلينيكي كامل مع خطة علاج',            400, 30, true),
  ('sv_followup',    'استشارة / متابعة',              'الكشوفات',         'متابعة خلال أسبوعين من الكشف',             200, 15, true),
  ('sv_cast',        'تركيب جبس',                     'الجبس والكسور',    'جبس كامل أو جبيرة حسب الإصابة',            600, 30, true),
  ('sv_cast_off',    'فك جبس',                        'الجبس والكسور',    'إزالة الجبس وفحص الالتئام',                150, 15, true),
  ('sv_reduction',   'رد كسر مغلق',                   'الجبس والكسور',    'رد الكسر تحت مخدر موضعي وتثبيته',         1200, 45, true),
  ('sv_hyaluronic',  'حقن مفصل الركبة (هيالورونيك)', 'الحقن',            'حقنة زيت الركبة لخشونة المفصل',           1800, 20, true),
  ('sv_prp',         'حقن بلازما PRP',                'الحقن',            'بلازما غنية بالصفائح للأوتار والمفاصل',   2000, 30, true),
  ('sv_steroid',     'حقن كورتيزون موضعي',            'الحقن',            'لالتهاب الأوتار والأكياس الزلالية',         500, 15, true),
  ('sv_dressing',    'غيار جرح بعد عملية',            'ما بعد العمليات',  'غيار وفحص الجرح',                          150, 15, true),
  ('sv_sutures',     'فك غرز',                        'ما بعد العمليات',  'إزالة الغرز بعد 14 يوم',                   200, 15, true),
  ('sv_physio',      'جلسة علاج طبيعي وتأهيل',        'التأهيل',          'جلسة تأهيل بعد الكسور والعمليات',          300, 45, true)
on conflict (id) do update set name = excluded.name, category = excluded.category, description = excluded.description,
  price = excluded.price, duration_min = excluded.duration_min, active = true;

-- ============ 3) الطبيب الأساسي ============
insert into therapists (name, title, phone, work_hours, default_duration_min, bio)
select 'د. إسلام بلتاجي', 'استشاري جراحة العظام والكسور', '',
  '[{"day":"sun","from":"16:00","to":"22:00"},{"day":"mon","from":"16:00","to":"22:00"},{"day":"tue","from":"16:00","to":"22:00"},{"day":"wed","from":"16:00","to":"22:00"},{"day":"thu","from":"16:00","to":"22:00"},{"day":"sat","from":"16:00","to":"22:00"}]'::jsonb,
  30, 'استشاري جراحة العظام والمفاصل والكسور'
where not exists (select 1 from therapists where name = 'د. إسلام بلتاجي');
insert into therapist_services (therapist_id, service_id)
select t.id, s.id from therapists t cross join services s where t.active on conflict do nothing;

-- ============ 4) أقسام العظام ============
create table if not exists ortho_consultations (
  id uuid primary key default gen_random_uuid(),
  patient_id uuid not null references patients(id) on delete cascade,
  date date not null default riyadh_today(),
  complaint text not null check (length(trim(complaint)) > 0),
  region text not null default '',
  side text not null default 'na' check (side in ('right', 'left', 'both', 'na')),
  examination text not null default '',
  diagnosis text not null check (length(trim(diagnosis)) > 0),
  plan text not null default '',
  created_by uuid references employees(id) on delete set null default my_employee_id(),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create table if not exists ortho_imaging (
  id uuid primary key default gen_random_uuid(),
  patient_id uuid not null references patients(id) on delete cascade,
  kind text not null check (kind in ('xray', 'mri', 'ct', 'dexa', 'us')),
  region text not null check (length(trim(region)) > 0),
  requested_at date not null default riyadh_today(),
  status text not null default 'requested' check (status in ('requested', 'received', 'reviewed')),
  finding text not null default '',
  created_by uuid references employees(id) on delete set null default my_employee_id(),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create table if not exists ortho_surgeries (
  id uuid primary key default gen_random_uuid(),
  patient_id uuid not null references patients(id) on delete cascade,
  procedure text not null check (length(trim(procedure)) > 0),
  region text not null default '',
  side text not null default 'na' check (side in ('right', 'left', 'both', 'na')),
  hospital text not null default '',
  date date not null,
  implant text not null default '',
  status text not null default 'planned' check (status in ('planned', 'scheduled', 'done', 'postponed')),
  notes text not null default '',
  created_by uuid references employees(id) on delete set null default my_employee_id(),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create table if not exists ortho_fractures (
  id uuid primary key default gen_random_uuid(),
  patient_id uuid not null references patients(id) on delete cascade,
  bone text not null check (length(trim(bone)) > 0),
  side text not null default 'na' check (side in ('right', 'left', 'both', 'na')),
  kind text not null default '',
  injury_date date not null,
  cast_date date not null,
  removal_due date not null,
  status text not null default 'casted' check (status in ('casted', 'healing', 'healed', 'surgical')),
  created_by uuid references employees(id) on delete set null default my_employee_id(),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check (removal_due >= cast_date)
);
create index if not exists ortho_consultations_patient on ortho_consultations(patient_id, date desc);
create index if not exists ortho_imaging_patient on ortho_imaging(patient_id);
create index if not exists ortho_imaging_status on ortho_imaging(status) where status <> 'reviewed';
create index if not exists ortho_surgeries_patient on ortho_surgeries(patient_id);
create index if not exists ortho_surgeries_date on ortho_surgeries(date);
create index if not exists ortho_fractures_patient on ortho_fractures(patient_id);
create index if not exists ortho_fractures_due on ortho_fractures(removal_due) where status <> 'healed';

create or replace function ortho_touch() returns trigger language plpgsql as $$
begin new.updated_at := now(); return new; end $$;

do $$
declare t text;
begin
  foreach t in array array['ortho_consultations', 'ortho_imaging', 'ortho_surgeries', 'ortho_fractures'] loop
    execute format('alter table %I enable row level security', t);
    execute format('revoke all on %I from anon', t);
    execute format('grant select, insert, update, delete on %I to authenticated', t);
    -- القراءة: من له صلاحية عرض المرضى. الكتابة السريرية: صلاحية الجلسات (الطبيب/المدير) — الاستقبال والمحاسب قراءة فقط
    execute format('drop policy if exists staff_read on %I', t);
    execute format('create policy staff_read on %I for select using ((select has_perm(''patients'', ''view'')))', t);
    execute format('drop policy if exists staff_insert on %I', t);
    execute format('create policy staff_insert on %I for insert with check ((select has_perm(''sessions'', ''create'')))', t);
    execute format('drop policy if exists staff_update on %I', t);
    execute format('create policy staff_update on %I for update using ((select has_perm(''sessions'', ''edit''))) with check ((select has_perm(''sessions'', ''edit'')))', t);
    execute format('drop policy if exists staff_delete on %I', t);
    execute format('create policy staff_delete on %I for delete using ((select has_perm(''sessions'', ''delete'')) or (select is_admin()))', t);
    execute format('drop trigger if exists trg_touch on %I', t);
    execute format('create trigger trg_touch before update on %I for each row execute function ortho_touch()', t);
    execute format('drop trigger if exists trg_audit on %I', t);
    execute format('create trigger trg_audit after insert or update or delete on %I for each row execute function audit_row()', t);
  end loop;
end $$;

-- ============ 5) لا إرسال للهيئة ============
update zatca_config set auto_submit = false where true;

-- ============ 6) بداية نظيفة ============
delete from audit_logs;
