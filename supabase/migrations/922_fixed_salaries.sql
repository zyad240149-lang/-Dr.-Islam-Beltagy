-- 922: رواتب ثابتة بس (طلب العيادة) — مفيش تارجت ولا نسب ولا مكافآت أداء.
--   salary_settings : الراتب الشهري الثابت ويوم الصرف لكل موظف.
--   salary_payments : سجل راتب واحد لكل موظف في كل شهر (مستحق ← مدفوع بتاريخ الدفع الفعلي) — فهرس فريد بيمنع تكرار نفس الشهر.
-- جداول نظام التارجت القديم (payroll_dues / payroll_payouts / payroll_periods) ما اتلمستش (فاضية) — الواجهة بطّلت تستخدمها.
-- الصلاحيات من الخادم: العرض بصلاحية الرواتب (عرض)، والإضافة/التعديل بصلاحية الرواتب (تعديل) — ومحدش يسجّل/يعدّل راتبه هو (نفس قاعدة 913).

create table if not exists salary_settings (
  employee_id uuid primary key references employees(id) on delete cascade,
  monthly_salary numeric(12,2) not null default 0 check (monthly_salary >= 0),
  pay_day smallint not null default 1 check (pay_day between 1 and 31),
  active boolean not null default true,
  note text not null default '',
  updated_at timestamptz not null default now(),
  updated_by uuid references employees(id) on delete set null default my_employee_id()
);

create table if not exists salary_payments (
  id uuid primary key default gen_random_uuid(),
  employee_id uuid references employees(id) on delete set null,      -- لو الموظف اتمسح السجل المالي بيفضل باسمه
  employee_name text not null,
  period text not null check (period ~ '^\d{4}-(0[1-9]|1[0-2])$'),   -- شهر الاستحقاق YYYY-MM
  amount numeric(12,2) not null check (amount >= 0),
  due_date date not null,
  status text not null default 'due' check (status in ('due', 'paid')),
  paid_on date,
  method text not null default 'cash' check (method in ('cash', 'bank', 'wallet', 'other')),
  note text not null default '',
  created_at timestamptz not null default now(),
  created_by uuid references employees(id) on delete set null default my_employee_id(),
  updated_at timestamptz not null default now(),
  updated_by uuid references employees(id) on delete set null default my_employee_id(),
  constraint salary_paid_has_date check ((status = 'paid') = (paid_on is not null))
);
create unique index if not exists salary_payments_one_per_month on salary_payments (employee_id, period) where employee_id is not null;
create index if not exists salary_payments_period on salary_payments (period, status);

-- آخر تعديل + مين عدّله (بيتحدد من الخادم)
create or replace function salary_touch() returns trigger language plpgsql set search_path = public as $$
begin new.updated_at := now(); new.updated_by := my_employee_id(); return new; end $$;
drop trigger if exists trg_salary_settings_touch on salary_settings;
create trigger trg_salary_settings_touch before update on salary_settings for each row execute function salary_touch();
drop trigger if exists trg_salary_payments_touch on salary_payments;
create trigger trg_salary_payments_touch before update on salary_payments for each row execute function salary_touch();

alter table salary_settings enable row level security;
alter table salary_payments enable row level security;
revoke all on salary_settings, salary_payments from anon;
grant select, insert, update, delete on salary_settings, salary_payments to authenticated;

drop policy if exists salary_settings_read on salary_settings;
create policy salary_settings_read on salary_settings for select using ((select has_perm('payroll', 'view')));
drop policy if exists salary_settings_write on salary_settings;
create policy salary_settings_write on salary_settings for all
  using ((select has_perm('payroll', 'edit')) and employee_id is distinct from (select my_employee_id()))
  with check ((select has_perm('payroll', 'edit')) and employee_id is distinct from (select my_employee_id()));

drop policy if exists salary_payments_read on salary_payments;
create policy salary_payments_read on salary_payments for select using ((select has_perm('payroll', 'view')));
drop policy if exists salary_payments_insert on salary_payments;
create policy salary_payments_insert on salary_payments for insert
  with check ((select has_perm('payroll', 'edit')) and employee_id is distinct from (select my_employee_id()));
drop policy if exists salary_payments_update on salary_payments;
create policy salary_payments_update on salary_payments for update
  using ((select has_perm('payroll', 'edit')) and employee_id is distinct from (select my_employee_id()))
  with check ((select has_perm('payroll', 'edit')) and employee_id is distinct from (select my_employee_id()));
drop policy if exists salary_payments_delete on salary_payments;
create policy salary_payments_delete on salary_payments for delete
  using ((select has_perm('payroll', 'edit')) and status = 'due' and employee_id is distinct from (select my_employee_id()));

drop trigger if exists trg_audit on salary_payments;
create trigger trg_audit after insert or update or delete on salary_payments for each row execute function audit_row();
drop trigger if exists trg_audit on salary_settings;
create trigger trg_audit after insert or update or delete on salary_settings for each row execute function audit_row();

-- إشعارات التارجت (نظام الرواتب القديم) متوقفة
update notification_kinds set enabled = false where kind ~ 'target';
