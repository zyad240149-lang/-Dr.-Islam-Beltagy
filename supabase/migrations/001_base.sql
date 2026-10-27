-- ===================================================================
-- عيادة د. إسلام بلتاجي لجراحة العظام والكسور — قاعدة بيانات موحّدة (Admin + Portal)
-- ===================================================================
create extension if not exists pgcrypto;

-- ===== المركز =====
create table if not exists center_info (
  id int primary key default 1,
  name text not null default 'عيادة د. إسلام بلتاجي لجراحة العظام والكسور',
  branch_name text not null default 'الفرع الرئيسي',
  city text not null default 'القاهرة',
  district text not null default 'مدينة نصر',
  phone text not null default '',
  work_start text not null default '09:00',
  work_end text not null default '21:00',
  slot_step_min int not null default 30,
  package_low_threshold int not null default 2,
  reminder_hours_before int not null default 2,
  check (id = 1)
);
insert into center_info (id) values (1) on conflict (id) do nothing;

-- ===== الموظفون (إدارة) =====
create table if not exists employees (
  id uuid primary key default gen_random_uuid(),
  auth_user_id uuid references auth.users(id) on delete set null,
  name text not null,
  username text not null unique,
  role text not null check (role in ('system_admin','center_manager','secretary','therapist','reception','accountant')),
  phone text not null default '',
  active boolean not null default true,
  created_at timestamptz not null default now(),
  last_login timestamptz
);

-- ===== المرضى (ملف طبي داخل الإدارة) =====
create table if not exists patients (
  id uuid primary key default gen_random_uuid(),
  file_no text not null unique,
  full_name text not null,
  phone text not null,
  national_id text not null default '',
  birth_date date,
  gender text check (gender in ('male','female')),
  address text not null default '',
  referral_source text not null default 'other',
  emergency_contact_name text not null default '',
  emergency_contact_phone text not null default '',
  notes text not null default '',
  registered_at timestamptz not null default now(),
  active boolean not null default true,
  main_complaint text not null default '',
  diagnosis text not null default '',
  medical_history text not null default ''
);
create index if not exists idx_patients_phone on patients(phone);

-- ===== حسابات العملاء (بوابة العميل) — مرتبطة بملف المريض =====
create table if not exists customers (
  id uuid primary key default gen_random_uuid(),
  auth_user_id uuid references auth.users(id) on delete set null,
  patient_id uuid references patients(id) on delete set null,
  name text not null,
  phone text not null unique,
  email text,
  member_since timestamptz not null default now()
);

-- ===== المعالجون (نفس الأخصائيين يظهروا في الإدارة والبوابة) =====
create table if not exists therapists (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  title text not null default '',
  phone text not null default '',
  photo text not null default '',
  work_hours jsonb not null default '[]',
  on_leave jsonb not null default '[]',
  active boolean not null default true
);

-- ===== الخدمات (مطابقة تمامًا بين الإدارة والبوابة) =====
create table if not exists services (
  id text primary key, -- نفس الـ id الثابت (sv_pt, sv_nerve, ...)
  name text not null,
  category text not null default '',
  description text not null default '',
  price numeric(10,2) not null,
  duration_min int not null default 45,
  active boolean not null default true
);

create table if not exists therapist_services (
  therapist_id uuid references therapists(id) on delete cascade,
  service_id text references services(id) on delete cascade,
  primary key (therapist_id, service_id)
);

-- ===== الغرف =====
create table if not exists rooms (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  no text not null default '',
  type text not null default '',
  status text not null default 'available' check (status in ('available','maintenance'))
);

-- ===== خطط الباقات (قوالب) وباقات المريض =====
create table if not exists package_plans (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  service_ids text[] not null default '{}',
  total_sessions int not null,
  price numeric(10,2) not null,
  valid_days int not null default 90,
  active boolean not null default true
);

create table if not exists packages (
  id uuid primary key default gen_random_uuid(),
  patient_id uuid not null references patients(id) on delete cascade,
  name text not null,
  service_ids text[] not null default '{}',
  total_sessions int not null,
  used_sessions int not null default 0,
  price numeric(10,2) not null,
  start_date date not null default current_date,
  expiry_date date,
  status text not null default 'active' check (status in ('active','expired','completed','cancelled'))
);

-- ===== خطط العلاج =====
create table if not exists treatment_plans (
  id uuid primary key default gen_random_uuid(),
  patient_id uuid not null references patients(id) on delete cascade,
  service_id text references services(id),
  diagnosis text not null default '',
  main_goal text not null default '',
  short_term_goals text not null default '',
  long_term_goals text not null default '',
  total_sessions int not null default 1,
  sessions_per_week int not null default 2,
  duration_weeks int not null default 4,
  therapy_type text not null default '',
  exercises text not null default '',
  devices text not null default '',
  therapist_notes text not null default '',
  notes text not null default '',
  progress_pct int not null default 0,
  start_date date not null default current_date,
  end_date date,
  status text not null default 'active' check (status in ('active','completed','paused'))
);

-- ===== التقييم الأولي =====
create table if not exists initial_assessments (
  id uuid primary key default gen_random_uuid(),
  patient_id uuid not null references patients(id) on delete cascade,
  date timestamptz not null default now(),
  main_complaint text not null default '',
  onset_date text not null default '',
  medical_history text not null default '',
  prior_injuries text not null default '',
  prior_surgeries text not null default '',
  medications text not null default '',
  allergies text not null default '',
  medical_diagnosis text not null default '',
  pain_level int,
  rom text not null default '',
  muscle_strength text not null default '',
  balance text not null default '',
  gait text not null default '',
  special_tests text not null default '',
  therapist_notes text not null default '',
  goals text not null default '',
  plan text not null default '',
  suggested_sessions int not null default 0
);

-- ===== المواعيد (الجدول المشترك الأهم بين الإدارة والبوابة) =====
create table if not exists appointments (
  id uuid primary key default gen_random_uuid(),
  no text not null unique,
  patient_id uuid not null references patients(id) on delete cascade,
  customer_id uuid references customers(id) on delete set null, -- من حجزه لو حجزه العميل بنفسه من البوابة
  type text not null default 'session' check (type in ('initial','session','followup','rehab','home')),
  service_id text not null references services(id),
  therapist_id uuid references therapists(id),
  room_id uuid references rooms(id),
  location text not null default 'center' check (location in ('center','home')),
  address text not null default '',
  date date not null,
  time text not null,
  duration_min int not null default 45,
  status text not null default 'new' check (status in ('new','confirmed','on_way','arrived','no_show','completed','cancelled','rescheduled')),
  price numeric(10,2) not null default 0,
  package_id uuid references packages(id),
  plan_id uuid references treatment_plans(id),
  series_id uuid,
  cancel_reason text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index if not exists idx_appt_patient on appointments(patient_id);
create index if not exists idx_appt_therapist_date on appointments(therapist_id, date);
create index if not exists idx_appt_customer on appointments(customer_id);
-- منع تعارض حجز نفس المعالج في نفس اليوم والوقت
create unique index if not exists uq_therapist_slot on appointments(therapist_id, date, time)
  where status not in ('cancelled','rescheduled');

-- ===== الجلسات العلاجية =====
create table if not exists treatment_sessions (
  id uuid primary key default gen_random_uuid(),
  appointment_id uuid not null references appointments(id) on delete cascade,
  patient_id uuid not null references patients(id) on delete cascade,
  therapist_id uuid references therapists(id),
  plan_id uuid references treatment_plans(id),
  session_no int not null default 1,
  date date not null default current_date,
  status text not null default 'scheduled' check (status in ('scheduled','in_progress','completed','cancelled')),
  pain_level int,
  therapist_notes text not null default '',
  treatment_used text not null default '',
  devices_used text not null default '',
  exercises text not null default '',
  patient_response text not null default '',
  next_plan text not null default '',
  started_at timestamptz,
  completed_at timestamptz
);

-- ===== الفواتير (مشتركة — تظهر في الإدارة والبوابة) =====
create table if not exists invoices (
  id uuid primary key default gen_random_uuid(),
  no text not null unique,
  patient_id uuid not null references patients(id) on delete cascade,
  appointment_id uuid references appointments(id) on delete set null,
  package_id uuid references packages(id) on delete set null,
  service_name text not null default '',
  price numeric(10,2) not null default 0,
  discount numeric(10,2) not null default 0,
  total numeric(10,2) not null default 0,
  paid numeric(10,2) not null default 0,
  remaining numeric(10,2) not null default 0,
  status text not null default 'due' check (status in ('paid','partial','due','cancelled')),
  date date not null default current_date
);
create index if not exists idx_invoices_patient on invoices(patient_id);

-- ===== المدفوعات =====
create table if not exists payments (
  id uuid primary key default gen_random_uuid(),
  invoice_id uuid not null references invoices(id) on delete cascade,
  patient_id uuid not null references patients(id) on delete cascade,
  amount numeric(10,2) not null,
  method text not null default 'cash' check (method in ('cash','card','transfer','online')),
  date timestamptz not null default now(),
  note text not null default ''
);

-- ===== الإشعارات =====
create table if not exists notifications (
  id uuid primary key default gen_random_uuid(),
  audience text not null check (audience in ('staff','customer')),
  customer_id uuid references customers(id) on delete cascade,
  kind text not null,
  title text not null,
  body text not null default '',
  ref_id text,
  link text,
  created_at timestamptz not null default now(),
  read boolean not null default false
);

-- ===== المخزون =====
create table if not exists inventory_items (
  id uuid primary key default gen_random_uuid(),
  sku text not null unique,
  name text not null,
  category text not null default '',
  unit text not null default 'قطعة',
  quantity numeric(10,2) not null default 0,
  min_quantity numeric(10,2) not null default 0,
  cost_price numeric(10,2) not null default 0,
  sale_price numeric(10,2) not null default 0,
  supplier text not null default '',
  active boolean not null default true,
  updated_at timestamptz not null default now()
);

create table if not exists stock_movements (
  id uuid primary key default gen_random_uuid(),
  item_id uuid not null references inventory_items(id) on delete cascade,
  type text not null check (type in ('purchase','issue','adjust_in','adjust_out')),
  quantity numeric(10,2) not null,
  unit_cost numeric(10,2) not null default 0,
  reference text not null default '',
  employee_id uuid references employees(id) on delete set null,
  date timestamptz not null default now(),
  note text not null default ''
);

-- ===== سجل العمليات =====
create table if not exists activity_log (
  id uuid primary key default gen_random_uuid(),
  at timestamptz not null default now(),
  employee_id uuid references employees(id) on delete set null,
  patient_id uuid references patients(id) on delete set null,
  action text not null
);

-- ===== الصلاحيات (RBAC) =====
create table if not exists role_permissions (
  role text not null,
  area text not null,
  ops text[] not null default '{}',
  primary key (role, area)
);

-- ===== دوال مساعدة: توليد أرقام تسلسلية =====
create table if not exists counters (
  name text primary key,
  value int not null default 0
);
insert into counters(name, value) values ('patient',0),('appointment',0),('invoice',0),('item',0)
  on conflict do nothing;

create or replace function next_counter(p_name text, p_prefix text, p_pad int default 4)
returns text language plpgsql as $$
declare v int;
begin
  update counters set value = value + 1 where name = p_name returning value into v;
  if v is null then
    insert into counters(name, value) values (p_name, 1) returning value into v;
  end if;
  return p_prefix || lpad(v::text, p_pad, '0');
end $$;

-- ===================================================================
-- Row Level Security
-- ===================================================================
alter table patients enable row level security;
alter table customers enable row level security;
alter table appointments enable row level security;
alter table invoices enable row level security;
alter table payments enable row level security;
alter table treatment_plans enable row level security;
alter table treatment_sessions enable row level security;
alter table initial_assessments enable row level security;
alter table packages enable row level security;
alter table notifications enable row level security;
alter table employees enable row level security;

-- الموظفون (staff) عندهم صلاحية كاملة عبر service_role من الـ Edge Functions فقط.
-- العميل (auth.uid()) يشوف بياناته الخاصة فقط عبر customers.auth_user_id.
create policy customers_self on customers for select
  using (auth_user_id = auth.uid());

create policy appointments_self on appointments for select
  using (customer_id in (select id from customers where auth_user_id = auth.uid()));

create policy invoices_self on invoices for select
  using (patient_id in (
    select patient_id from customers where auth_user_id = auth.uid()
  ));

create policy payments_self on payments for select
  using (patient_id in (
    select patient_id from customers where auth_user_id = auth.uid()
  ));

create policy notifications_self on notifications for select
  using (customer_id in (select id from customers where auth_user_id = auth.uid()));

-- باقي الجداول الحساسة (ملف طبي كامل) مقصورة على service_role بس (Edge Functions للإدارة)
-- بدون أي policy إضافية = محظور افتراضيًا للـ anon/authenticated، متاح فقط لـ service_role (بيتجاوز RLS تلقائيًا).
create table if not exists conditions (
  id text primary key, region_id text not null, name_ar text not null, name_en text not null, icd10 text not null, tests text not null default ''
);
insert into conditions (id, region_id, name_ar, name_en, icd10, tests) values
('neck_disc', 'neck', 'أمراض الغضروف العنقي (تآكل - انزلاق)', 'Disc disease (degeneration - herniation)', 'M50.x', 'Spurling، Distraction، ULTT'),
('neck_sci', 'neck', 'إصابات الحبل الشوكي', 'Spinal cord injury', 'S14.1x', 'فحص عصبي ASIA، الردود الانعكاسية'),
('neck_strain', 'neck', 'شد وتيبس عضلات الرقبة', 'Muscle strain / tightness', 'S16.1x', 'مدى الحركة، الجس'),
('neck_whiplash', 'neck', 'إصابة الارتجاج العنقي', 'Whiplash', 'S13.4x', 'Canadian C-spine rule، مدى الحركة'),
('neck_tmj', 'neck', 'اضطراب المفصل الفكي الصدغي', 'TMJ Dysfunction', 'M26.6x', 'قياس فتح الفم، الانحراف، جس المفصل'),
('sh_frozen', 'shoulder', 'الكتف المتجمد', 'Frozen shoulder', 'M75.0x', 'فقد الدوران الخارجي السلبي (Capsular pattern)'),
('sh_rc', 'shoulder', 'متلازمة الكفة المدورة', 'Rotator cuff syndrome', 'M75.1x', 'Hawkins-Kennedy، Neer، Empty can، Painful arc'),
('sh_oa', 'shoulder', 'خشونة مفصل الكتف', 'Shoulder OA', 'M19.01x', 'فقد الحركة السلبية، طقطقة، أشعة'),
('sh_ac_oa', 'shoulder', 'خشونة المفصل الأخرمي الترقوي', 'AC joint OA', 'M19.01x', 'Cross-body adduction، O''Brien'),
('sh_biceps', 'shoulder', 'التهاب وتر العضلة ذات الرأسين', 'Biceps tendonitis', 'M75.2x', 'Speed''s، Yergason''s'),
('el_tennis', 'elbow', 'مرفق التنس', 'Tennis elbow', 'M77.1x', 'Cozen، Mill''s'),
('el_golfer', 'elbow', 'مرفق لاعب الجولف', 'Golfer''s elbow', 'M77.0x', 'Reverse Cozen، جس اللقيمة الإنسية'),
('el_pronator', 'elbow', 'متلازمة العضلة الكابة المدورة', 'Pronator teres syndrome', 'G56.1x', 'مقاومة الكبّ، Tinel على الساعد'),
('wr_cts', 'wrist_hand', 'متلازمة النفق الرسغي', 'Carpal tunnel syndrome', 'G56.0x', 'Phalen، Tinel، Durkan'),
('wr_dequervain', 'wrist_hand', 'متلازمة دي كيرفان', 'De Quervain''s syndrome', 'M65.4', 'Finkelstein'),
('wr_mallet', 'wrist_hand', 'الإصبع المطرقي', 'Mallet finger', 'M20.01x', 'عدم القدرة على فرد المفصل الطرفي (DIP)'),
('wr_tendon', 'wrist_hand', 'التهاب أوتار الرسغ', 'Wrist tendonitis', 'M65.83x', 'ألم مع الحركة المقاومة، جس'),
('wr_fracture', 'wrist_hand', 'كسور الرسغ واليد (تأهيل)', 'Fractures', 'S52.5x / S62.x', 'أشعة، جس Snuffbox'),
('bk_radic', 'back', 'اعتلال الجذور العصبية', 'Radiculopathy', 'M54.1x', 'SLR، Slump'),
('bk_spinal', 'back', 'إصابات العمود الفقري', 'Spinal injury', 'S22.0x / S32.0x', 'العلامات الحمراء، تصوير'),
('bk_sij', 'back', 'اختلال المفصل العجزي الحرقفي', 'SIJ dysfunction', 'M53.3', 'FABER، Thigh thrust، Gaenslen'),
('bk_spasm', 'back', 'تشنج وشد عضلات الظهر', 'Muscle spasm / Tightness', 'M62.830', 'جس، مدى الحركة'),
('hp_oa', 'hip', 'خشونة مفصل الورك', 'Hip OA', 'M16.x', 'فقد الدوران الداخلي، FADIR'),
('hp_gtps', 'hip', 'متلازمة ألم المدور الكبير', 'Greater trochanteric pain syndrome', 'M70.6x', 'جس المدور، الوقوف على رجل واحدة 30 ثانية'),
('hp_itb', 'hip', 'متلازمة الشريط الحرقفي الظنبوبي', 'IT band syndrome', 'M76.3x', 'Ober، Noble'),
('hp_fai', 'hip', 'انحشار مفصل الورك', 'Hip impingement', 'M25.85x', 'FADIR، FABER'),
('kn_oa', 'knee', 'خشونة الركبة', 'Knee OA', 'M17.x', 'طقطقة، جس خط المفصل، أشعة'),
('kn_chondro', 'knee', 'تلين غضروف الرضفة', 'Chondromalacia', 'M22.4x', 'Clarke''s، Patellar grind'),
('kn_patellar', 'knee', 'التهاب وتر الرضفة', 'Patellar tendonitis', 'M76.5x', 'جس أسفل الرضفة، Single-leg decline squat'),
('kn_acl_pcl', 'knee', 'إصابة الرباط الصليبي الأمامي / الخلفي', 'ACL / PCL injury', 'S83.51x / S83.52x', 'Lachman، Anterior / Posterior drawer، Sag sign'),
('kn_mcl_lcl', 'knee', 'إصابة الرباط الجانبي الداخلي / الخارجي', 'MCL / LCL injury', 'S83.41x / S83.42x', 'Valgus / Varus stress'),
('kn_meniscus', 'knee', 'إصابة الغضروف الهلالي الإنسي / الوحشي', 'Medial / Lateral meniscus injury', 'S83.2x', 'McMurray، Thessaly'),
('kn_sublux', 'knee', 'خلع جزئي للرضفة', 'Patellar subluxation', 'S83.01x', 'Patellar apprehension'),
('an_lig', 'ankle', 'إصابات أربطة الكاحل', 'Ligaments'' injuries', 'S93.4x', 'Anterior drawer، Talar tilt، Ottawa rules'),
('an_plantar', 'ankle', 'التهاب اللفافة الأخمصية', 'Plantar fasciitis', 'M72.2', 'ألم أول خطوة، Windlass'),
('an_spur', 'ankle', 'شوكة عظم الكعب', 'Calcaneal spur', 'M77.3x', 'جس الكعب، أشعة'),
('an_achilles', 'ankle', 'التهاب وتر أكيلس', 'Achilles tendonitis', 'M76.6x', 'Arc sign، Royal London، Thompson لاستبعاد التمزق')
on conflict (id) do update set region_id = excluded.region_id, name_ar = excluded.name_ar, name_en = excluded.name_en, icd10 = excluded.icd10, tests = excluded.tests;
alter table treatment_plans add column if not exists diagnosis_condition_id text references conditions(id);
alter table treatment_plans add column if not exists diagnosis_side text check (diagnosis_side in ('right','left','both'));
alter table initial_assessments add column if not exists diagnosis_condition_id text references conditions(id);
alter table initial_assessments add column if not exists diagnosis_side text check (diagnosis_side in ('right','left','both'));
alter table patients add column if not exists diagnosis_condition_id text references conditions(id);
alter table patients add column if not exists diagnosis_side text check (diagnosis_side in ('right','left','both'));
alter table conditions enable row level security;
select region_id, count(*) from conditions group by region_id order by 1;