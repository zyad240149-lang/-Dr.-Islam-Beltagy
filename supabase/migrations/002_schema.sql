-- ===================================================================
-- 002 — إكمال المخطط للإنتاج: فروع، أكواد خصم، بنود فواتير وضريبة، حملات إشعارات،
-- طلبات موظفين، تذاكر دعم فني، علاقات ناقصة، فهارس، ودوال صلاحيات.
-- قابل لإعادة التشغيل (idempotent).
-- ===================================================================

-- ===== الفروع =====
create table if not exists branches (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  city text not null default '',
  district text not null default '',
  address text not null default '',
  phone text not null default '',
  active boolean not null default true,
  created_at timestamptz not null default now()
);
insert into branches (name, city, district, phone)
select coalesce(branch_name, 'الفرع الرئيسي'), city, district, phone from center_info
where not exists (select 1 from branches);

-- ===== إعدادات المركز =====
alter table center_info add column if not exists work_hours text not null default '';
alter table center_info add column if not exists tax_rate numeric(5,2) not null default 0 check (tax_rate >= 0 and tax_rate <= 100);
alter table center_info add column if not exists vat_number text not null default '';
alter table center_info add column if not exists week_schedule jsonb not null default
  '[{"day":"sun","open":true,"from":"09:00","to":"21:00"},{"day":"mon","open":true,"from":"09:00","to":"21:00"},
    {"day":"tue","open":true,"from":"09:00","to":"21:00"},{"day":"wed","open":true,"from":"09:00","to":"21:00"},
    {"day":"thu","open":true,"from":"09:00","to":"21:00"},{"day":"fri","open":false,"from":"09:00","to":"21:00"},
    {"day":"sat","open":true,"from":"09:00","to":"21:00"}]';

-- ===== الموظفون / المعالجون / الخدمات ↔ الفرع =====
alter table employees add column if not exists branch_id uuid references branches(id) on delete set null;
alter table employees add column if not exists therapist_id uuid references therapists(id) on delete set null;
alter table employees add column if not exists job_title text not null default '';
alter table therapists add column if not exists branch_id uuid references branches(id) on delete set null;
alter table therapists add column if not exists created_at timestamptz not null default now();
alter table services add column if not exists branch_id uuid references branches(id) on delete set null; -- null = كل الفروع
create unique index if not exists uq_employee_therapist on employees(therapist_id) where therapist_id is not null;

-- ===== المواعيد =====
alter table appointments add column if not exists branch_id uuid references branches(id) on delete set null;
alter table appointments add column if not exists created_by uuid references employees(id) on delete set null;
create index if not exists idx_appt_date on appointments(date);
create index if not exists idx_appt_status on appointments(status);
create index if not exists idx_appt_plan on appointments(plan_id);
create index if not exists idx_appt_package on appointments(package_id);
create index if not exists idx_appt_branch on appointments(branch_id);

-- ===== خطط العلاج / التقييم / الجلسات =====
alter table treatment_plans add column if not exists therapist_id uuid references therapists(id) on delete set null;
alter table treatment_plans add column if not exists price numeric(10,2) not null default 0 check (price >= 0);
alter table treatment_plans add column if not exists created_by uuid references employees(id) on delete set null;
alter table treatment_plans add column if not exists created_at timestamptz not null default now();
create index if not exists idx_plans_patient on treatment_plans(patient_id);
create index if not exists idx_plans_therapist on treatment_plans(therapist_id);

alter table initial_assessments add column if not exists therapist_id uuid references therapists(id) on delete set null;
alter table initial_assessments add column if not exists created_by uuid references employees(id) on delete set null;
create index if not exists idx_assess_patient on initial_assessments(patient_id);

alter table treatment_sessions alter column appointment_id drop not null; -- جلسة مسجلة مباشرة من الخطة بدون موعد
create index if not exists idx_sessions_patient on treatment_sessions(patient_id);
create index if not exists idx_sessions_plan on treatment_sessions(plan_id);
create index if not exists idx_sessions_appt on treatment_sessions(appointment_id);
create index if not exists idx_sessions_therapist on treatment_sessions(therapist_id);

create index if not exists idx_packages_patient on packages(patient_id);

-- ===== أكواد الخصم =====
create table if not exists discount_codes (
  id uuid primary key default gen_random_uuid(),
  code text not null unique check (code ~ '^[A-Z0-9_-]{3,20}$'),
  type text not null check (type in ('percent','fixed')),
  value numeric(10,2) not null check (value > 0),
  valid_from date not null,
  valid_to date not null,
  max_uses int not null check (max_uses >= 1),
  used_count int not null default 0,
  active boolean not null default true,
  note text not null default '',
  created_by uuid references employees(id) on delete set null,
  created_at timestamptz not null default now(),
  check (valid_from <= valid_to),
  check (type <> 'percent' or value <= 100),
  check (used_count >= 0 and used_count <= max_uses)
);

-- ===== الفواتير: بنود + ضريبة + خطة + كود خصم =====
alter table invoices add column if not exists plan_id uuid references treatment_plans(id) on delete set null;
alter table invoices add column if not exists created_by uuid references employees(id) on delete set null;
alter table invoices add column if not exists note text not null default '';
alter table invoices add column if not exists discount_code_id uuid references discount_codes(id) on delete set null;
alter table invoices add column if not exists discount_code text;
alter table invoices add column if not exists tax_rate numeric(5,2) not null default 0;
alter table invoices add column if not exists tax_amount numeric(10,2) not null default 0;
alter table invoices add column if not exists created_at timestamptz not null default now();
alter table invoices drop constraint if exists invoices_status_check;
alter table invoices add constraint invoices_status_check check (status in ('draft','paid','partial','due','cancelled'));
create index if not exists idx_invoices_status on invoices(status);
create index if not exists idx_invoices_date on invoices(date);
create index if not exists idx_invoices_appt on invoices(appointment_id);
create index if not exists idx_invoices_plan on invoices(plan_id);
create index if not exists idx_invoices_package on invoices(package_id);

create table if not exists invoice_items (
  id uuid primary key default gen_random_uuid(),
  invoice_id uuid not null references invoices(id) on delete cascade,
  service_id text references services(id) on delete set null,
  description text not null,
  qty numeric(10,2) not null default 1 check (qty > 0),
  unit_price numeric(10,2) not null check (unit_price >= 0),
  amount numeric(12,2) generated always as (qty * unit_price) stored
);
create index if not exists idx_invoice_items_invoice on invoice_items(invoice_id);

alter table payments add column if not exists created_by uuid references employees(id) on delete set null;
create index if not exists idx_payments_invoice on payments(invoice_id);
create index if not exists idx_payments_patient on payments(patient_id);
create index if not exists idx_payments_date on payments(date);

-- ===== الإشعارات: ربط بالمريض =====
alter table notifications add column if not exists patient_id uuid references patients(id) on delete cascade;
create index if not exists idx_notifications_customer on notifications(customer_id);
create index if not exists idx_notifications_audience on notifications(audience, created_at desc);
create index if not exists idx_customers_patient on customers(patient_id);

-- ===== حملات إشعارات المرضى =====
create table if not exists campaigns (
  id uuid primary key default gen_random_uuid(),
  title text not null,
  body text not null,
  audience text not null check (audience in ('all','with_account','source','patient')),
  source text,
  patient_id uuid references patients(id) on delete set null,
  discount_code_id uuid references discount_codes(id) on delete set null,
  recipients int not null default 0,
  delivered int not null default 0,
  created_by uuid references employees(id) on delete set null,
  created_at timestamptz not null default now()
);

-- ===== طلبات الموظفين =====
create table if not exists staff_requests (
  id uuid primary key default gen_random_uuid(),
  employee_id uuid not null references employees(id) on delete cascade,
  type text not null check (type in ('leave','permission','other')),
  reason text not null,
  from_date date not null,
  to_date date not null,
  from_time text not null default '',
  to_time text not null default '',
  status text not null default 'pending' check (status in ('pending','approved','rejected')),
  decision_note text not null default '',
  decided_by uuid references employees(id) on delete set null,
  created_at timestamptz not null default now(),
  decided_at timestamptz,
  check (from_date <= to_date)
);
create index if not exists idx_requests_employee on staff_requests(employee_id);
create index if not exists idx_requests_status on staff_requests(status);

-- ===== الدعم الفني (تذاكر) =====
create table if not exists support_tickets (
  id uuid primary key default gen_random_uuid(),
  no text not null unique,
  subject text not null check (length(trim(subject)) > 0),
  description text not null default '',
  category text not null default 'general',
  priority text not null default 'medium' check (priority in ('low','medium','high','urgent')),
  status text not null default 'open' check (status in ('open','in_progress','resolved','closed')),
  created_by uuid references employees(id) on delete set null,
  assigned_to uuid references employees(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create table if not exists support_replies (
  id uuid primary key default gen_random_uuid(),
  ticket_id uuid not null references support_tickets(id) on delete cascade,
  employee_id uuid references employees(id) on delete set null,
  body text not null check (length(trim(body)) > 0),
  created_at timestamptz not null default now()
);
create index if not exists idx_tickets_status on support_tickets(status);
create index if not exists idx_tickets_creator on support_tickets(created_by);
create index if not exists idx_replies_ticket on support_replies(ticket_id);

create index if not exists idx_activity_patient on activity_log(patient_id);
create index if not exists idx_activity_at on activity_log(at desc);
create index if not exists idx_movements_item on stock_movements(item_id);

-- ===== العدادات =====
insert into counters(name, value) values ('patient',1000),('appointment',1000),('invoice',1000),('item',100),('ticket',100)
  on conflict (name) do nothing;
update counters set value = greatest(value, 1000) where name in ('patient','appointment','invoice');

-- ===================================================================
-- دوال الهوية والصلاحيات (تُستخدم في RLS وفي كل RPC)
-- ===================================================================
create or replace function me() returns employees
language sql stable security definer set search_path = public as $$
  select * from employees where auth_user_id = auth.uid() and active limit 1
$$;

create or replace function my_employee_id() returns uuid
language sql stable security definer set search_path = public as $$
  select id from employees where auth_user_id = auth.uid() and active limit 1
$$;

create or replace function has_perm(p_area text, p_op text) returns boolean
language sql stable security definer set search_path = public as $$
  select exists (
    select 1 from employees e
    where e.auth_user_id = auth.uid() and e.active
      and (e.role = 'system_admin'
        or exists (select 1 from role_permissions rp where rp.role = e.role and rp.area = p_area and p_op = any(rp.ops)))
  )
$$;

create or replace function is_staff() returns boolean
language sql stable security definer set search_path = public as $$
  select my_employee_id() is not null
$$;

-- نطاق المعالج: يرى فقط مرضى مواعيده/جلساته/خططه
create or replace function can_see_patient(p_patient uuid) returns boolean
language sql stable security definer set search_path = public as $$
  select case
    when (select role from employees where auth_user_id = auth.uid() and active) is distinct from 'therapist' then is_staff()
    else exists (
      select 1 from employees e where e.auth_user_id = auth.uid() and e.active and e.therapist_id is not null and (
        exists (select 1 from appointments a where a.patient_id = p_patient and a.therapist_id = e.therapist_id)
        or exists (select 1 from treatment_sessions s where s.patient_id = p_patient and s.therapist_id = e.therapist_id)
        or exists (select 1 from treatment_plans p where p.patient_id = p_patient and (p.therapist_id = e.therapist_id or p.created_by = e.id))
      ))
  end
$$;

create or replace function require_perm(p_area text, p_op text) returns uuid
language plpgsql stable security definer set search_path = public as $$
declare v uuid := my_employee_id();
begin
  if v is null then raise exception 'غير مصرح — سجّل الدخول بحساب موظف' using errcode = '42501'; end if;
  if not has_perm(p_area, p_op) then raise exception 'لا توجد صلاحية لهذه العملية' using errcode = '42501'; end if;
  return v;
end $$;

create or replace function riyadh_today() returns date
language sql stable as $$ select (now() at time zone 'Africa/Cairo')::date $$;

create or replace function log_action(p_action text, p_patient uuid default null) returns void
language sql security definer set search_path = public as $$
  insert into activity_log (employee_id, patient_id, action) values (my_employee_id(), p_patient, p_action)
$$;

create or replace function notify_staff(p_kind text, p_title text, p_body text, p_ref text default null, p_link text default null, p_patient uuid default null) returns void
language sql security definer set search_path = public as $$
  insert into notifications (audience, kind, title, body, ref_id, link, patient_id) values ('staff', p_kind, p_title, p_body, p_ref, p_link, p_patient)
$$;

-- إشعار لحساب المريض على بوابة العميل (مربوط بملفه أو بنفس رقم الجوال)
create or replace function notify_patient(p_patient uuid, p_kind text, p_title text, p_body text, p_ref text default null) returns int
language plpgsql security definer set search_path = public as $$
declare n int;
begin
  insert into notifications (audience, customer_id, patient_id, kind, title, body, ref_id)
  select 'customer', c.id, p_patient, p_kind, p_title, p_body, p_ref
  from customers c join patients p on p.id = p_patient
  where c.patient_id = p_patient
     or (c.patient_id is null and right(regexp_replace(c.phone, '\D', '', 'g'), 9) = right(regexp_replace(p.phone, '\D', '', 'g'), 9));
  get diagnostics n = row_count;
  return n;
end $$;

-- ===================================================================
-- Row Level Security — كل جدول محمي. الكتابة على الجداول الحساسة (مواعيد، فواتير، مدفوعات،
-- جلسات، خطط، باقات، أكواد، طلبات، مخزون) تتم عبر دوال RPC فقط اللي بتطبق منطق العمل.
-- ===================================================================
do $$
declare t text;
begin
  foreach t in array array['branches','center_info','employees','patients','customers','therapists','therapist_services','services','rooms',
    'package_plans','packages','treatment_plans','initial_assessments','appointments','treatment_sessions','invoices','invoice_items',
    'payments','notifications','inventory_items','stock_movements','activity_log','role_permissions','counters','conditions',
    'discount_codes','campaigns','staff_requests','support_tickets','support_replies']
  loop
    execute format('alter table %I enable row level security', t);
  end loop;
end $$;

-- إزالة سياسات الموظفين القديمة (لو اتشغل السكربت قبل كده)
do $$
declare r record;
begin
  for r in select polname, relname from pg_policy join pg_class on pg_class.oid = polrelid
           where polname like 'staff\_%' escape '\' loop
    execute format('drop policy %I on %I', r.polname, r.relname);
  end loop;
end $$;

-- قراءة عامة لأي موظف مسجّل
create policy staff_read on branches for select using (is_staff());
create policy staff_read on center_info for select using (is_staff());
create policy staff_read on employees for select using (is_staff());
create policy staff_read on services for select using (is_staff());
create policy staff_read on therapists for select using (is_staff());
create policy staff_read on therapist_services for select using (is_staff());
create policy staff_read on role_permissions for select using (is_staff());
create policy staff_read on conditions for select using (is_staff());
create policy staff_read on rooms for select using (is_staff());
create policy staff_read on package_plans for select using (is_staff());

-- قراءة حسب صلاحية القسم + نطاق المريض
create policy staff_read on patients for select using (has_perm('patients','view') and can_see_patient(id));
create policy staff_read on customers for select using (has_perm('patients','view'));
create policy staff_read on appointments for select using ((has_perm('appointments','view') or has_perm('booking','view') or has_perm('sessions','view')) and can_see_patient(patient_id));
create policy staff_read on treatment_sessions for select using ((has_perm('sessions','view') or has_perm('patients','view')) and can_see_patient(patient_id));
create policy staff_read on treatment_plans for select using ((has_perm('plans','view') or has_perm('patients','view')) and can_see_patient(patient_id));
create policy staff_read on initial_assessments for select using ((has_perm('sessions','view') or has_perm('patients','view')) and can_see_patient(patient_id));
create policy staff_read on packages for select using ((has_perm('packages','view') or has_perm('patients','view') or has_perm('booking','view')) and can_see_patient(patient_id));
create policy staff_read on invoices for select using ((has_perm('invoices','view') or has_perm('payments','view')) and can_see_patient(patient_id));
create policy staff_read on invoice_items for select using (has_perm('invoices','view'));
create policy staff_read on payments for select using ((has_perm('payments','view') or has_perm('invoices','view')) and can_see_patient(patient_id));
create policy staff_read on notifications for select using (audience = 'staff' and has_perm('notifications','view'));
create policy staff_read on inventory_items for select using (has_perm('inventory','view'));
create policy staff_read on stock_movements for select using (has_perm('inventory','view'));
create policy staff_read on activity_log for select using (has_perm('reports','view') or (patient_id is not null and has_perm('patients','view') and can_see_patient(patient_id)) or has_perm('settings','view'));
create policy staff_read on discount_codes for select using (has_perm('discounts','view') or has_perm('invoices','edit') or has_perm('campaigns','view'));
create policy staff_read on campaigns for select using (has_perm('campaigns','view'));
create policy staff_read on staff_requests for select using (employee_id = my_employee_id() or has_perm('requests','edit'));
create policy staff_read on support_tickets for select using (created_by = my_employee_id() or has_perm('support','view'));
create policy staff_read on support_replies for select using (exists (select 1 from support_tickets t where t.id = ticket_id and (t.created_by = my_employee_id() or has_perm('support','view'))));

-- كتابة مباشرة (جداول بسيطة بدون منطق حسابي) — مقيدة بالصلاحية
create policy staff_insert on patients for insert with check (has_perm('patients','create'));
create policy staff_update on patients for update using (has_perm('patients','edit') and can_see_patient(id)) with check (has_perm('patients','edit'));
create policy staff_write on initial_assessments for insert with check (has_perm('sessions','create') and can_see_patient(patient_id));
create policy staff_update on initial_assessments for update using (has_perm('sessions','edit') and can_see_patient(patient_id));
create policy staff_delete on initial_assessments for delete using (has_perm('sessions','delete') and can_see_patient(patient_id));
create policy staff_write on package_plans for insert with check (has_perm('packages','create'));
create policy staff_update on package_plans for update using (has_perm('packages','edit'));
create policy staff_delete on package_plans for delete using (has_perm('packages','delete'));
create policy staff_update on center_info for update using (has_perm('settings','edit') or has_perm('workhours','edit'));
create policy staff_write on branches for insert with check (has_perm('settings','edit'));
create policy staff_update on branches for update using (has_perm('settings','edit'));
create policy staff_write on role_permissions for insert with check (has_perm('roles','edit'));
create policy staff_update on role_permissions for update using (has_perm('roles','edit'));
create policy staff_delete on role_permissions for delete using (has_perm('roles','edit'));
create policy staff_update on notifications for update using (audience = 'staff' and has_perm('notifications','view'));
create policy staff_delete on notifications for delete using (audience = 'staff' and has_perm('notifications','delete'));
create policy staff_write on support_tickets for insert with check (is_staff() and created_by = my_employee_id());
create policy staff_update on support_tickets for update using (has_perm('support','edit') or created_by = my_employee_id());
create policy staff_write on support_replies for insert with check (employee_id = my_employee_id()
  and exists (select 1 from support_tickets t where t.id = ticket_id and (t.created_by = my_employee_id() or has_perm('support','edit'))));

-- ===== تدقيق تلقائي للكتابات المباشرة =====
create or replace function audit_direct_write() returns trigger
language plpgsql security definer set search_path = public as $$
declare label text := coalesce(tg_argv[0], tg_table_name); verb text; pid uuid;
begin
  verb := case tg_op when 'INSERT' then 'إضافة' when 'UPDATE' then 'تعديل' else 'حذف' end;
  if tg_table_name = 'patients' then pid := case when tg_op = 'DELETE' then null else new.id end;
  elsif tg_table_name = 'initial_assessments' then pid := case when tg_op = 'DELETE' then old.patient_id else new.patient_id end;
  end if;
  if auth.uid() is not null then
    insert into activity_log (employee_id, patient_id, action) values (my_employee_id(), pid, verb || ' ' || label);
  end if;
  return coalesce(new, old);
end $$;

drop trigger if exists trg_audit on patients;
create trigger trg_audit after insert or update on patients for each row execute function audit_direct_write('بيانات المريض');
drop trigger if exists trg_audit on initial_assessments;
create trigger trg_audit after insert or update or delete on initial_assessments for each row execute function audit_direct_write('تقييم أولي');
drop trigger if exists trg_audit on package_plans;
create trigger trg_audit after insert or update or delete on package_plans for each row execute function audit_direct_write('باقة في الكتالوج');
drop trigger if exists trg_audit on center_info;
create trigger trg_audit after update on center_info for each row execute function audit_direct_write('إعدادات المركز');
drop trigger if exists trg_audit on role_permissions;
create trigger trg_audit after insert or update or delete on role_permissions for each row execute function audit_direct_write('مصفوفة الصلاحيات');

-- رقم ملف المريض تلقائي + إشعار تسجيل مريض جديد
create or replace function patients_before_insert() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if new.file_no is null or new.file_no = '' then new.file_no := next_counter('patient', 'TM-'); end if;
  if length(trim(new.full_name)) < 2 then raise exception 'اسم المريض مطلوب'; end if;
  if length(regexp_replace(new.phone, '\D', '', 'g')) < 9 then raise exception 'رقم الجوال غير صحيح'; end if;
  return new;
end $$;
drop trigger if exists trg_patients_bi on patients;
create trigger trg_patients_bi before insert on patients for each row execute function patients_before_insert();

create or replace function patients_after_insert() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  perform notify_staff('patient_new', 'تسجيل مريض جديد', new.full_name || ' — ' || new.file_no, new.referral_source, '/patients/' || new.id, new.id);
  update customers set patient_id = new.id
   where patient_id is null and right(regexp_replace(phone, '\D', '', 'g'), 9) = right(regexp_replace(new.phone, '\D', '', 'g'), 9);
  return new;
end $$;
drop trigger if exists trg_patients_ai on patients;
create trigger trg_patients_ai after insert on patients for each row execute function patients_after_insert();

create or replace function tickets_before_insert() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  new.no := next_counter('ticket', 'TK-');
  new.created_by := coalesce(new.created_by, my_employee_id());
  return new;
end $$;
drop trigger if exists trg_tickets_bi on support_tickets;
create trigger trg_tickets_bi before insert on support_tickets for each row execute function tickets_before_insert();

create or replace function touch_ticket() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  update support_tickets set updated_at = now(),
    status = case when status = 'open' and exists (select 1 from employees e where e.id = new.employee_id and e.id <> support_tickets.created_by) then 'in_progress' else status end
  where id = new.ticket_id;
  return new;
end $$;
drop trigger if exists trg_replies_ai on support_replies;
create trigger trg_replies_ai after insert on support_replies for each row execute function touch_ticket();

-- صلاحية كل الأقسام الجديدة للمدير
insert into role_permissions (role, area, ops) values
  ('center_manager','discounts','{view,create,edit,delete}'), ('center_manager','campaigns','{view,create,edit,delete}'),
  ('center_manager','support','{view,create,edit,delete}'), ('center_manager','requests','{view,create,edit,delete}')
on conflict (role, area) do nothing;
