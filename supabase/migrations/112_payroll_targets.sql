-- «الرواتب والتارجت» الكامل (طلب الإدارة 2026-10-11) — بيحل محل هيكل 111 (جداوله كانت فاضية):
--   • إعدادات بإصدارات (comp_plans): راتب + تارجت + طريقة مكافأة لكل أخصائي، وراتب ثابت للاستقبال/السكرتارية/المحاسب،
--     وكل تعديل نسخة جديدة بتاريخ سريان (شهر) ومين عمله — التعديل مابيغيّرش المستحقات المعتمدة.
--   • فترات شهرية (payroll_periods): مفتوحة (أرقام مباشرة متوقعة) ← معتمدة (المستحقات بتتجمّد) ← مقفولة.
--   • مستحقات معتمدة (payroll_dues) + الزيارات اللي اتحسبت فيها (payroll_due_visits — الزيارة بتتحسب مرة واحدة بس).
--   • صرف يدوي جزئي/كامل (payroll_payouts) — مفيش صرف أكتر من المستحق، ومفتاح منع التكرار لنفس العملية.
--   • سجل تدقيق (payroll_audit) لكل عملية وتعديل.
-- للمدير العام بس (system_admin) — على الخادم وفي RLS. الأخصائي يشوف بياناته هو بس من my_target().
--
-- قاعدة «الإيراد المؤهل» (تتعرض للمدير في الصفحة):
--   الزيارة المنفذة = موعد حالته حضر/جاري/مكتمل في الشهر (بتاريخ الزيارة). الأخصائي = اللي سجّل الجلسة لو فيه جلسة، وإلا دكتور الموعد.
--   قيمة الزيارة = صافي فاتورتها بعد الخصم ومن غير الضريبة. زيارة ضمن خطة علاجية/باقة فاتورتها واحدة = الصافي ÷ عدد جلسات الخطة
--   (لأول «عدد الجلسات» زيارة بس). الفواتير الملغاة والمسودات مش محسوبة. الدفعات الملغاة (استرداد) بتقلل المحصّل.
--   المؤهل = حسب سياسة المركز: «collected» المحصّل فعليًا من قيمة الزيارة (الافتراضي) أو «invoiced» قيمة الزيارة كاملة.

-- ---------- إزالة هيكل 111 (فاضي) ----------
do $$ begin
  if exists (select 1 from information_schema.tables where table_name = 'payroll_payouts')
     and exists (select 1 from information_schema.columns where table_name = 'payroll_payouts' and column_name = 'therapist_id') then
    if exists (select 1 from payroll_payouts) then raise exception 'payroll_payouts (111) فيه بيانات — وقف الهجرة'; end if;
    drop table payroll_payouts cascade;
  end if;
  if exists (select 1 from information_schema.tables where table_name = 'therapist_compensation') then
    if exists (select 1 from therapist_compensation) then raise exception 'therapist_compensation (111) فيه بيانات — وقف الهجرة'; end if;
    drop table therapist_compensation cascade;
  end if;
end $$;
drop function if exists payroll_save_compensation(jsonb);
drop function if exists payroll_month(text);
drop function if exists payroll_pay(jsonb);
drop function if exists payroll_cancel(uuid, text);
drop function if exists payroll_commission(numeric, numeric, numeric, text);
drop function if exists payroll_revenue(date, date);
drop function if exists require_payroll(text);

-- ---------- سياسة الإيراد المؤهل ----------
alter table center_info add column if not exists target_revenue_basis text not null default 'collected';
do $$ begin
  if not exists (select 1 from pg_constraint where conname = 'center_info_target_basis_chk') then
    alter table center_info add constraint center_info_target_basis_chk check (target_revenue_basis in ('collected', 'invoiced'));
  end if;
end $$;

-- ---------- الجداول ----------
create table if not exists comp_plans (
  id uuid primary key default gen_random_uuid(),
  subject_type text not null check (subject_type in ('therapist', 'employee')),
  therapist_id uuid references therapists(id) on delete cascade,
  employee_id uuid references employees(id) on delete cascade,
  effective_from text not null check (effective_from ~ '^[0-9]{4}-(0[1-9]|1[0-2])$'),
  base_salary numeric(12,2) not null default 0 check (base_salary >= 0),
  monthly_target numeric(12,2) not null default 0 check (monthly_target >= 0),
  bonus_method text not null default 'none' check (bonus_method in ('none', 'pct_target', 'pct_revenue', 'fixed')),
  bonus_rate numeric(5,2) not null default 0 check (bonus_rate between 0 and 100),
  bonus_fixed numeric(12,2) not null default 0 check (bonus_fixed >= 0),
  bonus_condition text not null default 'reach' check (bonus_condition in ('reach', 'exceed')),
  note text not null default '',
  created_at timestamptz not null default now(),
  created_by uuid references employees(id) on delete set null,
  check ((subject_type = 'therapist' and therapist_id is not null and employee_id is null)
      or (subject_type = 'employee' and employee_id is not null and therapist_id is null))
);
create index if not exists idx_comp_plans_th on comp_plans (therapist_id, effective_from);
create index if not exists idx_comp_plans_emp on comp_plans (employee_id, effective_from);
create index if not exists idx_comp_plans_by on comp_plans (created_by);

create table if not exists payroll_periods (
  period text primary key check (period ~ '^[0-9]{4}-(0[1-9]|1[0-2])$'),
  status text not null default 'open' check (status in ('open', 'approved', 'closed')),
  approved_at timestamptz, approved_by uuid references employees(id) on delete set null,
  closed_at timestamptz, closed_by uuid references employees(id) on delete set null,
  note text not null default ''
);
create index if not exists idx_periods_approved_by on payroll_periods (approved_by);
create index if not exists idx_periods_closed_by on payroll_periods (closed_by);

create table if not exists payroll_dues (
  id uuid primary key default gen_random_uuid(),
  period text not null references payroll_periods(period),
  subject_type text not null check (subject_type in ('therapist', 'employee')),
  therapist_id uuid references therapists(id) on delete set null,
  employee_id uuid references employees(id) on delete set null,
  subject_name text not null,
  subject_role text not null default '',
  plan_id uuid references comp_plans(id) on delete set null,
  base_salary numeric(12,2) not null default 0,
  monthly_target numeric(12,2) not null default 0,
  bonus_method text not null default 'none',
  bonus_rate numeric(5,2) not null default 0,
  bonus_fixed numeric(12,2) not null default 0,
  bonus_condition text not null default 'reach',
  revenue_basis text not null default 'collected',
  qualifying numeric(12,2) not null default 0,
  invoiced numeric(12,2) not null default 0,
  collected numeric(12,2) not null default 0,
  visits_count int not null default 0,
  achievement_pct numeric(8,2),
  target_reached boolean not null default false,
  computed_bonus numeric(12,2) not null default 0,   -- المكافأة اللي اتحسبت آليًا وقت الاعتماد
  salary_due numeric(12,2) not null default 0 check (salary_due >= 0),
  bonus_due numeric(12,2) not null default 0 check (bonus_due >= 0),   -- المكافأة المعتمدة
  approved_at timestamptz not null default now(),
  approved_by uuid references employees(id) on delete set null,
  updated_at timestamptz, updated_by uuid references employees(id) on delete set null
);
create unique index if not exists payroll_dues_th_uq on payroll_dues (period, therapist_id) where therapist_id is not null;
create unique index if not exists payroll_dues_emp_uq on payroll_dues (period, employee_id) where employee_id is not null;
create index if not exists idx_dues_therapist on payroll_dues (therapist_id);
create index if not exists idx_dues_employee on payroll_dues (employee_id);
create index if not exists idx_dues_plan on payroll_dues (plan_id);
create index if not exists idx_dues_approved_by on payroll_dues (approved_by);
create index if not exists idx_dues_updated_by on payroll_dues (updated_by);

create table if not exists payroll_due_visits (
  id uuid primary key default gen_random_uuid(),
  due_id uuid not null references payroll_dues(id) on delete cascade,
  appointment_id uuid references appointments(id) on delete set null,
  visit_date date not null,
  file_no text not null default '',
  patient_name text not null default '',
  service_name text not null default '',
  invoice_no text,
  source text not null default 'none',
  value_net numeric(12,2) not null default 0,
  collected numeric(12,2) not null default 0,
  qualifying numeric(12,2) not null default 0,
  payment_status text not null default 'none'
);
-- الزيارة بتتحسب في مستحق واحد بس — مهما اتعاد الاعتماد أو اتغيّر تاريخها
create unique index if not exists payroll_visit_once on payroll_due_visits (appointment_id) where appointment_id is not null;
create index if not exists idx_due_visits_due on payroll_due_visits (due_id);

create sequence if not exists payroll_payout_no_seq;
create table if not exists payroll_payouts (
  id uuid primary key default gen_random_uuid(),
  no text not null unique,
  due_id uuid not null references payroll_dues(id) on delete restrict,
  kind text not null check (kind in ('salary', 'bonus')),
  amount numeric(12,2) not null check (amount > 0),
  paid_on date not null,
  method text not null default 'transfer' check (method in ('cash', 'transfer')),
  reference text not null default '',
  note text not null default '',
  status text not null default 'paid' check (status in ('paid', 'void')),
  client_key text unique,
  created_at timestamptz not null default now(),
  created_by uuid references employees(id) on delete set null,
  voided_at timestamptz, voided_by uuid references employees(id) on delete set null, void_reason text
);
create index if not exists idx_payouts_due on payroll_payouts (due_id);
create index if not exists idx_payouts_by on payroll_payouts (created_by);
create index if not exists idx_payouts_voided_by on payroll_payouts (voided_by);

create table if not exists payroll_audit (
  id uuid primary key default gen_random_uuid(),
  at timestamptz not null default now(),
  actor uuid references employees(id) on delete set null,
  actor_name text not null default '',
  action text not null,
  period text,
  subject_name text,
  reason text,
  details jsonb not null default '{}'::jsonb
);
create index if not exists idx_payroll_audit_at on payroll_audit (at desc);
create index if not exists idx_payroll_audit_actor on payroll_audit (actor);

-- ---------- الهوية والصلاحية ----------
create or replace function is_gm() returns boolean
language sql stable security definer set search_path = public as $$
  select exists (select 1 from employees e where e.auth_user_id = auth.uid() and e.active and e.role = 'system_admin' and not is_on_leave(e.id))
$$;

create or replace function require_gm(p_op text) returns uuid
language plpgsql stable security definer set search_path = public as $$
declare v uuid;
begin
  v := require_perm('payroll', p_op);
  if not exists (select 1 from employees where id = v and role = 'system_admin') then
    raise exception 'قسم الرواتب والتارجت للمدير العام فقط' using errcode = '42501';
  end if;
  return v;
end $$;

alter table comp_plans enable row level security;
alter table payroll_periods enable row level security;
alter table payroll_dues enable row level security;
alter table payroll_due_visits enable row level security;
alter table payroll_payouts enable row level security;
alter table payroll_audit enable row level security;
do $$ declare t text; begin
  foreach t in array array['comp_plans', 'payroll_periods', 'payroll_dues', 'payroll_due_visits', 'payroll_payouts', 'payroll_audit'] loop
    execute format('drop policy if exists gm_select on %I', t);
    execute format('create policy gm_select on %I for select using ((select is_gm()))', t);
    execute format('revoke all on %I from anon', t);
    execute format('revoke insert, update, delete on %I from authenticated', t);
    execute format('grant select on %I to authenticated', t);
  end loop;
end $$;
revoke all on sequence payroll_payout_no_seq from anon, authenticated;

create or replace function payroll_log(p_action text, p_period text, p_subject text, p_reason text, p_details jsonb default '{}'::jsonb) returns void
language sql security definer set search_path = public as $$
  insert into payroll_audit (actor, actor_name, action, period, subject_name, reason, details)
  values (my_employee_id(), coalesce((select name from employees where id = my_employee_id()), ''), p_action, p_period, p_subject, nullif(trim(coalesce(p_reason, '')), ''), coalesce(p_details, '{}'::jsonb))
$$;

-- ---------- مساعدات الحساب ----------
create or replace function payroll_plan_for(p_type text, p_id uuid, p_period text) returns comp_plans
language sql stable security definer set search_path = public as $$
  select * from comp_plans
  where subject_type = p_type and (case when p_type = 'therapist' then therapist_id else employee_id end) = p_id and effective_from <= p_period
  order by effective_from desc, created_at desc limit 1
$$;

create or replace function payroll_bonus_amount(p_method text, p_rate numeric, p_fixed numeric, p_target numeric, p_revenue numeric) returns numeric
language sql immutable set search_path = public as $$
  select case p_method
    when 'pct_target' then round(coalesce(p_target, 0) * coalesce(p_rate, 0) / 100, 2)
    when 'pct_revenue' then round(coalesce(p_revenue, 0) * coalesce(p_rate, 0) / 100, 2)
    when 'fixed' then round(coalesce(p_fixed, 0), 2)
    else 0::numeric end
$$;

-- الزيارات المنفذة لأخصائي في فترة بقيمتها (قاعدة الإيراد المؤهل فوق). counted_elsewhere = اتحسبت قبل كده في مستحق معتمد تاني.
create or replace function target_visits(p_therapist uuid, p_from date, p_to date, p_exclude_due uuid default null)
returns table (appointment_id uuid, visit_date date, visit_time text, appt_status text, file_no text, patient_name text, service_name text,
               invoice_no text, source text, value_net numeric, collected numeric, payment_status text, counted_elsewhere boolean)
language sql stable security definer set search_path = public as $$
  with v as (
    select a.id, a.date, a.time, a.status, a.plan_id, a.package_id, a.service_id, a.patient_id
    from appointments a
    where a.date between p_from and p_to and a.status in ('arrived', 'in_progress', 'completed')
      and coalesce((select s.therapist_id from treatment_sessions s where s.appointment_id = a.id and s.therapist_id is not null
                    order by (s.status = 'completed') desc, s.date desc limit 1), a.therapist_id) = p_therapist
  )
  select v.id, v.date, v.time, v.status, coalesce(p.file_no, ''), coalesce(p.full_name, ''), coalesce(sv.name, ''),
    coalesce(own.no, sh.no),
    case when own.n > 0 then 'visit' when sh.n > 0 then sh.src else 'none' end,
    round(coalesce(case when own.n > 0 then own.net else sh.net end, 0), 2),
    round(coalesce(case when own.n > 0 then own.coll else sh.coll end, 0), 2),
    coalesce(case when own.n > 0 then own.st else sh.st end, 'none'),
    exists (select 1 from payroll_due_visits dv where dv.appointment_id = v.id and dv.due_id is distinct from p_exclude_due)
  from v
  left join patients p on p.id = v.patient_id
  left join services sv on sv.id = v.service_id
  left join lateral (
    select count(*) as n, string_agg(i.no, '، ' order by i.no) as no,
      sum(greatest(i.price - i.discount, 0)) as net,
      sum(case when i.total > 0 then greatest(i.price - i.discount, 0) * least(i.paid / i.total, 1) else 0 end) as coll,
      case when bool_and(i.remaining <= 0) then 'paid' when bool_or(i.paid > 0) then 'partial' else 'due' end as st
    from invoices i where i.appointment_id = v.id and i.status not in ('cancelled', 'draft')
  ) own on true
  left join lateral (
    -- فاتورة واحدة لخطة علاجية أو باقة: الصافي ÷ عدد الجلسات، لأول «عدد الجلسات» زيارة منفذة بس
    select x.n, x.no, x.src, x.net / greatest(x.sessions, 1) as net, x.coll / greatest(x.sessions, 1) as coll, x.st
    from (
      select count(*) as n, string_agg(i.no, '، ' order by i.no) as no, 'plan'::text as src, max(tp.total_sessions) as sessions,
        sum(greatest(i.price - i.discount, 0)) as net,
        sum(case when i.total > 0 then greatest(i.price - i.discount, 0) * least(i.paid / i.total, 1) else 0 end) as coll,
        case when bool_and(i.remaining <= 0) then 'paid' when bool_or(i.paid > 0) then 'partial' else 'due' end as st
      from treatment_plans tp join invoices i on i.plan_id = tp.id and i.appointment_id is null and i.status not in ('cancelled', 'draft')
      where tp.id = v.plan_id
      having count(*) > 0
      union all
      select count(*), string_agg(i.no, '، ' order by i.no), 'package', max(pk.total_sessions),
        sum(greatest(i.price - i.discount, 0)),
        sum(case when i.total > 0 then greatest(i.price - i.discount, 0) * least(i.paid / i.total, 1) else 0 end),
        case when bool_and(i.remaining <= 0) then 'paid' when bool_or(i.paid > 0) then 'partial' else 'due' end
      from packages pk join invoices i on i.package_id = pk.id and i.appointment_id is null and i.status not in ('cancelled', 'draft')
      where pk.id = v.package_id and v.plan_id is null
      having count(*) > 0
    ) x
    where (select count(*) from appointments a2
           where a2.status in ('arrived', 'in_progress', 'completed')
             and ((x.src = 'plan' and a2.plan_id = v.plan_id) or (x.src = 'package' and a2.package_id = v.package_id))
             and (a2.date, a2.time, a2.id::text) < (v.date, v.time, v.id::text)) < greatest(x.sessions, 1)
    limit 1
  ) sh on true
$$;

-- حساب تارجت أخصائي لشهر (مباشر) — بيستبعد الزيارات اللي اتحسبت في مستحق معتمد تاني
create or replace function therapist_target_calc(p_therapist uuid, p_period text, p_exclude_due uuid default null) returns jsonb
language plpgsql stable security definer set search_path = public as $$
declare r record; pl comp_plans; basis text; a record; tgt numeric; q numeric; pct numeric; reached boolean; eligible boolean; booked int;
begin
  select * into r from payroll_period_range(p_period);
  pl := payroll_plan_for('therapist', p_therapist, p_period);
  select coalesce((select target_revenue_basis from center_info limit 1), 'collected') into basis;
  select count(*) filter (where not tv.counted_elsewhere) as visits,
         count(*) filter (where not tv.counted_elsewhere and (case when basis = 'invoiced' then tv.value_net else tv.collected end) > 0) as qvisits,
         coalesce(sum(tv.value_net) filter (where not tv.counted_elsewhere), 0) as invoiced,
         coalesce(sum(tv.collected) filter (where not tv.counted_elsewhere), 0) as collected
    into a from target_visits(p_therapist, r.d1, r.d2, p_exclude_due) tv;
  select count(*) into booked from appointments x
    where x.therapist_id = p_therapist and x.date between r.d1 and r.d2 and x.status in ('new', 'confirmed', 'on_way');
  q := round(case when basis = 'invoiced' then a.invoiced else a.collected end, 2);
  tgt := coalesce(pl.monthly_target, 0);
  pct := case when tgt > 0 then round(q / tgt * 100, 2) end;
  reached := tgt > 0 and q >= tgt;
  eligible := tgt > 0 and coalesce(pl.bonus_method, 'none') <> 'none' and (case when pl.bonus_condition = 'exceed' then q > tgt else q >= tgt end);
  return jsonb_build_object(
    'hasPlan', pl.id is not null, 'planId', pl.id, 'effectiveFrom', pl.effective_from,
    'baseSalary', coalesce(pl.base_salary, 0), 'target', tgt, 'bonusMethod', coalesce(pl.bonus_method, 'none'),
    'bonusRate', coalesce(pl.bonus_rate, 0), 'bonusFixed', coalesce(pl.bonus_fixed, 0), 'bonusCondition', coalesce(pl.bonus_condition, 'reach'),
    'basis', basis, 'qualifying', q, 'invoiced', round(a.invoiced, 2), 'collected', round(a.collected, 2),
    'visits', a.visits, 'qualifyingVisits', a.qvisits, 'booked', booked,
    'pct', pct, 'remaining', case when tgt > 0 then greatest(tgt - q, 0) end, 'reached', reached, 'eligible', eligible,
    'bonus', case when eligible then payroll_bonus_amount(pl.bonus_method, pl.bonus_rate, pl.bonus_fixed, tgt, q) else 0 end,
    'bonusAtTarget', case when tgt > 0 then payroll_bonus_amount(pl.bonus_method, pl.bonus_rate, pl.bonus_fixed, tgt, tgt) else 0 end
  );
end $$;

-- ---------- قراءة: لوحة الشهر للمدير ----------
create or replace function payroll_overview(p_period text) returns jsonb
language plpgsql stable security definer set search_path = public as $$
declare r record; per payroll_periods; res_rows jsonb := '[]'::jsonb; t record; e record; d payroll_dues; c jsonb; pl comp_plans;
  ps numeric; pb numeric; last_on date; due_total numeric; paid_total numeric;
begin
  perform require_gm('view');
  select * into r from payroll_period_range(p_period);
  select * into per from payroll_periods where period = p_period;
  -- الأخصائيون
  for t in select th.*, (select string_agg(em.name, '، ') from employees em where em.therapist_id = th.id) as account from therapists th
           where th.active or exists (select 1 from comp_plans cp where cp.therapist_id = th.id)
              or exists (select 1 from payroll_dues pd where pd.therapist_id = th.id and pd.period = p_period)
           order by th.name loop
    select * into d from payroll_dues where therapist_id = t.id and period = p_period;
    c := therapist_target_calc(t.id, p_period, d.id);
    select coalesce(sum(amount) filter (where kind = 'salary'), 0), coalesce(sum(amount) filter (where kind = 'bonus'), 0), max(paid_on)
      into ps, pb, last_on from payroll_payouts where due_id = d.id and status = 'paid';
    due_total := case when d.id is not null then d.salary_due + d.bonus_due end;
    paid_total := coalesce(ps, 0) + coalesce(pb, 0);
    res_rows := res_rows || jsonb_build_object(
      'type', 'therapist', 'id', t.id, 'name', t.name, 'role', 'therapist', 'title', t.title, 'active', t.active, 'account', t.account,
      'live', c, 'dueId', d.id,
      'due', case when d.id is null then null else jsonb_build_object(
        'baseSalary', d.base_salary, 'target', d.monthly_target, 'bonusMethod', d.bonus_method, 'bonusRate', d.bonus_rate, 'bonusFixed', d.bonus_fixed,
        'bonusCondition', d.bonus_condition, 'basis', d.revenue_basis, 'qualifying', d.qualifying, 'invoiced', d.invoiced, 'collected', d.collected,
        'visits', d.visits_count, 'pct', d.achievement_pct, 'reached', d.target_reached, 'computedBonus', d.computed_bonus,
        'salaryDue', d.salary_due, 'bonusDue', d.bonus_due, 'approvedAt', d.approved_at, 'updatedAt', d.updated_at) end,
      'paidSalary', coalesce(ps, 0), 'paidBonus', coalesce(pb, 0), 'lastPaidOn', last_on,
      'payStatus', case when d.id is null then 'not_approved' when due_total <= 0 then 'nothing' when paid_total <= 0 then 'unpaid'
                        when paid_total < due_total then 'partial' else 'paid' end);
  end loop;
  -- الموظفون الإداريون (استقبال، سكرتارية، محاسب)
  for e in select em.* from employees em
           where (em.role in ('reception', 'secretary', 'accountant') and em.active)
              or exists (select 1 from comp_plans cp where cp.employee_id = em.id)
              or exists (select 1 from payroll_dues pd where pd.employee_id = em.id and pd.period = p_period)
           order by em.name loop
    select * into d from payroll_dues where employee_id = e.id and period = p_period;
    pl := payroll_plan_for('employee', e.id, p_period);
    select coalesce(sum(amount) filter (where kind = 'salary'), 0), max(paid_on) into ps, last_on
      from payroll_payouts where due_id = d.id and status = 'paid';
    res_rows := res_rows || jsonb_build_object(
      'type', 'employee', 'id', e.id, 'name', e.name, 'role', e.role, 'title', e.job_title, 'active', e.active, 'account', e.username,
      'live', jsonb_build_object('hasPlan', pl.id is not null, 'planId', pl.id, 'effectiveFrom', pl.effective_from, 'baseSalary', coalesce(pl.base_salary, 0)),
      'dueId', d.id,
      'due', case when d.id is null then null else jsonb_build_object('baseSalary', d.base_salary, 'salaryDue', d.salary_due, 'bonusDue', 0,
        'approvedAt', d.approved_at, 'updatedAt', d.updated_at) end,
      'paidSalary', coalesce(ps, 0), 'paidBonus', 0, 'lastPaidOn', last_on,
      'payStatus', case when d.id is null then 'not_approved' when d.salary_due <= 0 then 'nothing' when coalesce(ps, 0) <= 0 then 'unpaid'
                        when ps < d.salary_due then 'partial' else 'paid' end);
  end loop;
  return jsonb_build_object('period', p_period, 'from', r.d1, 'to', r.d2, 'today', riyadh_today(),
    'status', coalesce(per.status, 'open'), 'approvedAt', per.approved_at, 'closedAt', per.closed_at,
    'basis', coalesce((select target_revenue_basis from center_info limit 1), 'collected'), 'rows', res_rows);
end $$;

-- ---------- قراءة: تفاصيل شخص (الزيارات + المستحقات والصرف + سجل الإعدادات والتدقيق) ----------
create or replace function payroll_subject_detail(p_type text, p_id uuid, p_period text) returns jsonb
language plpgsql stable security definer set search_path = public as $$
declare r record; d payroll_dues; visits jsonb; nm text;
begin
  perform require_gm('view');
  select * into r from payroll_period_range(p_period);
  if p_type not in ('therapist', 'employee') then raise exception 'نوع غير صحيح'; end if;
  select * into d from payroll_dues where period = p_period and (case when p_type = 'therapist' then therapist_id else employee_id end) = p_id;
  nm := case when p_type = 'therapist' then (select name from therapists where id = p_id) else (select name from employees where id = p_id) end;
  if p_type = 'therapist' then
    if d.id is not null then
      select coalesce(jsonb_agg(jsonb_build_object('appointmentId', appointment_id, 'date', visit_date, 'fileNo', file_no, 'patient', patient_name,
        'service', service_name, 'invoiceNo', invoice_no, 'source', source, 'valueNet', value_net, 'collected', collected, 'qualifying', qualifying,
        'paymentStatus', payment_status, 'countedElsewhere', false) order by visit_date), '[]'::jsonb) into visits
      from payroll_due_visits where due_id = d.id;
    else
      select coalesce(jsonb_agg(jsonb_build_object('appointmentId', tv.appointment_id, 'date', tv.visit_date, 'fileNo', tv.file_no, 'patient', tv.patient_name,
        'service', tv.service_name, 'invoiceNo', tv.invoice_no, 'source', tv.source, 'valueNet', tv.value_net, 'collected', tv.collected,
        'qualifying', case when tv.counted_elsewhere then 0 when (select target_revenue_basis from center_info limit 1) = 'invoiced' then tv.value_net else tv.collected end,
        'paymentStatus', tv.payment_status, 'countedElsewhere', tv.counted_elsewhere) order by tv.visit_date, tv.visit_time), '[]'::jsonb) into visits
      from target_visits(p_id, r.d1, r.d2, null) tv;
    end if;
  end if;
  return jsonb_build_object(
    'name', nm, 'dueId', d.id,
    'visits', coalesce(visits, '[]'::jsonb),
    'plans', (select coalesce(jsonb_agg(jsonb_build_object('id', cp.id, 'effectiveFrom', cp.effective_from, 'baseSalary', cp.base_salary, 'target', cp.monthly_target,
        'bonusMethod', cp.bonus_method, 'bonusRate', cp.bonus_rate, 'bonusFixed', cp.bonus_fixed, 'bonusCondition', cp.bonus_condition, 'note', cp.note,
        'createdAt', cp.created_at, 'createdBy', em.name) order by cp.effective_from desc, cp.created_at desc), '[]'::jsonb)
      from comp_plans cp left join employees em on em.id = cp.created_by
      where cp.subject_type = p_type and (case when p_type = 'therapist' then cp.therapist_id else cp.employee_id end) = p_id),
    'payouts', (select coalesce(jsonb_agg(jsonb_build_object('id', po.id, 'no', po.no, 'period', pd.period, 'kind', po.kind, 'amount', po.amount,
        'paidOn', po.paid_on, 'method', po.method, 'reference', po.reference, 'note', po.note, 'status', po.status, 'createdBy', em.name,
        'createdAt', po.created_at, 'voidReason', po.void_reason) order by po.created_at desc), '[]'::jsonb)
      from payroll_payouts po join payroll_dues pd on pd.id = po.due_id left join employees em on em.id = po.created_by
      where (case when p_type = 'therapist' then pd.therapist_id else pd.employee_id end) = p_id),
    'audit', (select coalesce(jsonb_agg(jsonb_build_object('at', au.at, 'actor', au.actor_name, 'action', au.action, 'period', au.period,
        'reason', au.reason, 'details', au.details) order by au.at desc), '[]'::jsonb)
      from payroll_audit au where au.subject_name = nm)
  );
end $$;

-- ---------- كتابة: إعدادات (نسخة جديدة بتاريخ سريان) ----------
create or replace function payroll_save_plan(p jsonb) returns uuid
language plpgsql security definer set search_path = public as $$
declare emp uuid := require_gm('edit'); typ text := _txt(p, 'type'); sid uuid := _uuid(p, 'id'); eff text := _txt(p, 'effectiveFrom');
  sal numeric; tgt numeric; rate numeric; fixed numeric; meth text := coalesce(nullif(_txt(p, 'bonusMethod'), ''), 'none');
  cond text := coalesce(nullif(_txt(p, 'bonusCondition'), ''), 'reach'); nm text; v uuid; prev comp_plans;
begin
  perform payroll_period_range(eff);
  if typ = 'therapist' then
    select name into nm from therapists where id = sid;
    if nm is null then raise exception 'الأخصائي غير موجود'; end if;
  elsif typ = 'employee' then
    select name into nm from employees where id = sid and role in ('reception', 'secretary', 'accountant');
    if nm is null then raise exception 'الرواتب الثابتة للاستقبال والسكرتارية والمحاسب بس'; end if;
  else raise exception 'نوع غير صحيح'; end if;
  begin
    sal := round(coalesce(nullif(p->>'baseSalary', '')::numeric, 0), 2);
    tgt := round(coalesce(nullif(p->>'target', '')::numeric, 0), 2);
    rate := round(coalesce(nullif(p->>'bonusRate', '')::numeric, 0), 2);
    fixed := round(coalesce(nullif(p->>'bonusFixed', '')::numeric, 0), 2);
  exception when others then raise exception 'اكتب أرقام صحيحة للراتب والتارجت والمكافأة';
  end;
  if sal < 0 or tgt < 0 or fixed < 0 then raise exception 'الأرقام لا يمكن أن تكون سالبة'; end if;
  if rate < 0 or rate > 100 then raise exception 'النسبة لازم تكون من 0 إلى 100'; end if;
  if meth not in ('none', 'pct_target', 'pct_revenue', 'fixed') then raise exception 'طريقة حساب المكافأة غير صحيحة'; end if;
  if cond not in ('reach', 'exceed') then raise exception 'شرط استحقاق المكافأة غير صحيح'; end if;
  if typ = 'employee' then tgt := 0; meth := 'none'; rate := 0; fixed := 0; cond := 'reach'; end if; -- الإداريين راتب ثابت بس
  if meth in ('pct_target', 'pct_revenue') and rate <= 0 then raise exception 'حدّد نسبة المكافأة'; end if;
  if meth = 'fixed' and fixed <= 0 then raise exception 'حدّد قيمة المكافأة الثابتة'; end if;
  if meth <> 'none' and tgt <= 0 then raise exception 'المكافأة مرتبطة بالتارجت — حدّد قيمة التارجت الأول'; end if;
  prev := payroll_plan_for(typ, sid, eff);
  insert into comp_plans (subject_type, therapist_id, employee_id, effective_from, base_salary, monthly_target, bonus_method, bonus_rate, bonus_fixed, bonus_condition, note, created_by)
  values (typ, case when typ = 'therapist' then sid end, case when typ = 'employee' then sid end, eff, sal, tgt, meth, rate, fixed, cond, _txt(p, 'note'), emp)
  returning id into v;
  perform payroll_log('تحديد/تعديل الإعدادات المالية', eff, nm, _txt(p, 'note'), jsonb_build_object(
    'effectiveFrom', eff, 'before', case when prev.id is null then null else jsonb_build_object('baseSalary', prev.base_salary, 'target', prev.monthly_target,
      'bonusMethod', prev.bonus_method, 'bonusRate', prev.bonus_rate, 'bonusFixed', prev.bonus_fixed, 'bonusCondition', prev.bonus_condition, 'effectiveFrom', prev.effective_from) end,
    'after', jsonb_build_object('baseSalary', sal, 'target', tgt, 'bonusMethod', meth, 'bonusRate', rate, 'bonusFixed', fixed, 'bonusCondition', cond)));
  return v;
end $$;

create or replace function payroll_set_basis(p_basis text) returns void
language plpgsql security definer set search_path = public as $$
declare old text;
begin
  perform require_gm('edit');
  if p_basis not in ('collected', 'invoiced') then raise exception 'قاعدة احتساب غير صحيحة'; end if;
  select target_revenue_basis into old from center_info limit 1;
  update center_info set target_revenue_basis = p_basis where id is not null; -- Supabase بيرفض update من غير where من الـ API
  perform payroll_log('تغيير قاعدة احتساب الإيراد المؤهل', null, null, null, jsonb_build_object('before', old, 'after', p_basis));
end $$;

-- ---------- اعتماد الشهر: تجميد المستحقات (ولو اتعاد بيضيف اللي مالوش مستحق بس) ----------
create or replace function payroll_approve_period(p_period text, p_note text default '') returns jsonb
language plpgsql security definer set search_path = public as $$
declare emp uuid := require_gm('create'); r record; per payroll_periods; t record; e record; c jsonb; pl comp_plans; v uuid; n int := 0; basis text;
begin
  select * into r from payroll_period_range(p_period);
  if r.d1 > riyadh_today() then raise exception 'لا يمكن اعتماد شهر لسه مابدأش'; end if;
  perform pg_advisory_xact_lock(hashtext('payroll-period:' || p_period));
  insert into payroll_periods (period) values (p_period) on conflict (period) do nothing;
  select * into per from payroll_periods where period = p_period for update;
  if per.status = 'closed' then raise exception 'الشهر مقفول — مفيش اعتماد جديد'; end if;
  select coalesce(target_revenue_basis, 'collected') into basis from center_info limit 1;
  for t in select th.id, th.name from therapists th where not exists (select 1 from payroll_dues pd where pd.therapist_id = th.id and pd.period = p_period) loop
    pl := payroll_plan_for('therapist', t.id, p_period);
    continue when pl.id is null;
    c := therapist_target_calc(t.id, p_period, null);
    insert into payroll_dues (period, subject_type, therapist_id, subject_name, subject_role, plan_id, base_salary, monthly_target, bonus_method, bonus_rate,
      bonus_fixed, bonus_condition, revenue_basis, qualifying, invoiced, collected, visits_count, achievement_pct, target_reached, computed_bonus, salary_due, bonus_due, approved_by)
    values (p_period, 'therapist', t.id, t.name, 'therapist', pl.id, pl.base_salary, pl.monthly_target, pl.bonus_method, pl.bonus_rate, pl.bonus_fixed,
      pl.bonus_condition, basis, (c->>'qualifying')::numeric, (c->>'invoiced')::numeric, (c->>'collected')::numeric, (c->>'visits')::int,
      (c->>'pct')::numeric, (c->>'reached')::boolean, (c->>'bonus')::numeric, pl.base_salary, (c->>'bonus')::numeric, emp)
    returning id into v;
    insert into payroll_due_visits (due_id, appointment_id, visit_date, file_no, patient_name, service_name, invoice_no, source, value_net, collected, qualifying, payment_status)
    select v, tv.appointment_id, tv.visit_date, tv.file_no, tv.patient_name, tv.service_name, tv.invoice_no, tv.source, tv.value_net, tv.collected,
      case when basis = 'invoiced' then tv.value_net else tv.collected end, tv.payment_status
    from target_visits(t.id, r.d1, r.d2, null) tv where not tv.counted_elsewhere;
    n := n + 1;
  end loop;
  for e in select em.id, em.name, em.role from employees em where em.role in ('reception', 'secretary', 'accountant')
           and not exists (select 1 from payroll_dues pd where pd.employee_id = em.id and pd.period = p_period) loop
    pl := payroll_plan_for('employee', e.id, p_period);
    continue when pl.id is null;
    insert into payroll_dues (period, subject_type, employee_id, subject_name, subject_role, plan_id, base_salary, revenue_basis, salary_due, approved_by)
    values (p_period, 'employee', e.id, e.name, e.role, pl.id, pl.base_salary, basis, pl.base_salary, emp);
    n := n + 1;
  end loop;
  update payroll_periods set status = 'approved', approved_at = coalesce(approved_at, now()), approved_by = coalesce(approved_by, emp),
    note = case when coalesce(trim(p_note), '') <> '' then trim(p_note) else note end where period = p_period;
  perform payroll_log(case when per.status = 'approved' then 'إضافة مستحقات لشهر معتمد' else 'اعتماد الشهر' end, p_period, null, p_note, jsonb_build_object('added', n));
  return jsonb_build_object('added', n);
end $$;

create or replace function payroll_close_period(p_period text, p_note text default '') returns void
language plpgsql security definer set search_path = public as $$
declare emp uuid := require_gm('edit'); per payroll_periods;
begin
  perform payroll_period_range(p_period);
  select * into per from payroll_periods where period = p_period for update;
  if per.period is null or per.status = 'open' then raise exception 'اعتمد الشهر الأول قبل الإغلاق'; end if;
  if per.status = 'closed' then raise exception 'الشهر مقفول بالفعل'; end if;
  update payroll_periods set status = 'closed', closed_at = now(), closed_by = emp where period = p_period;
  perform payroll_log('إغلاق الشهر', p_period, null, p_note, '{}'::jsonb);
end $$;

-- ---------- تصحيح صريح لمستحق معتمد ----------
-- إعادة احتساب من البيانات الحالية (قبل الإغلاق بس) — بسبب إجباري
create or replace function payroll_recalc_due(p_due uuid, p_reason text) returns void
language plpgsql security definer set search_path = public as $$
declare emp uuid := require_gm('edit'); d payroll_dues; per payroll_periods; r record; c jsonb; pl comp_plans; ps numeric; pb numeric; basis text;
begin
  if coalesce(trim(p_reason), '') = '' then raise exception 'اكتب سبب إعادة الاحتساب'; end if;
  select * into d from payroll_dues where id = p_due for update;
  if d.id is null then raise exception 'المستحق غير موجود'; end if;
  select * into per from payroll_periods where period = d.period;
  if per.status = 'closed' then raise exception 'الشهر مقفول — استخدم «تعديل المستحق» بسبب'; end if;
  select * into r from payroll_period_range(d.period);
  select coalesce(target_revenue_basis, 'collected') into basis from center_info limit 1;
  select coalesce(sum(amount) filter (where kind = 'salary'), 0), coalesce(sum(amount) filter (where kind = 'bonus'), 0) into ps, pb
    from payroll_payouts where due_id = d.id and status = 'paid';
  if d.subject_type = 'therapist' then
    pl := payroll_plan_for('therapist', d.therapist_id, d.period);
    c := therapist_target_calc(d.therapist_id, d.period, d.id);
    if coalesce(pl.base_salary, 0) < ps or (c->>'bonus')::numeric < pb then raise exception 'المستحق الجديد أقل من اللي اتصرف بالفعل — ألغِ الصرف الزيادة الأول'; end if;
    delete from payroll_due_visits where due_id = d.id;
    insert into payroll_due_visits (due_id, appointment_id, visit_date, file_no, patient_name, service_name, invoice_no, source, value_net, collected, qualifying, payment_status)
    select d.id, tv.appointment_id, tv.visit_date, tv.file_no, tv.patient_name, tv.service_name, tv.invoice_no, tv.source, tv.value_net, tv.collected,
      case when basis = 'invoiced' then tv.value_net else tv.collected end, tv.payment_status
    from target_visits(d.therapist_id, r.d1, r.d2, d.id) tv where not tv.counted_elsewhere;
    update payroll_dues set plan_id = pl.id, base_salary = coalesce(pl.base_salary, 0), monthly_target = coalesce(pl.monthly_target, 0),
      bonus_method = coalesce(pl.bonus_method, 'none'), bonus_rate = coalesce(pl.bonus_rate, 0), bonus_fixed = coalesce(pl.bonus_fixed, 0),
      bonus_condition = coalesce(pl.bonus_condition, 'reach'), revenue_basis = basis, qualifying = (c->>'qualifying')::numeric,
      invoiced = (c->>'invoiced')::numeric, collected = (c->>'collected')::numeric, visits_count = (c->>'visits')::int,
      achievement_pct = (c->>'pct')::numeric, target_reached = (c->>'reached')::boolean, computed_bonus = (c->>'bonus')::numeric,
      salary_due = coalesce(pl.base_salary, 0), bonus_due = (c->>'bonus')::numeric, updated_at = now(), updated_by = emp
    where id = d.id;
  else
    pl := payroll_plan_for('employee', d.employee_id, d.period);
    if coalesce(pl.base_salary, 0) < ps then raise exception 'المستحق الجديد أقل من اللي اتصرف بالفعل — ألغِ الصرف الزيادة الأول'; end if;
    update payroll_dues set plan_id = pl.id, base_salary = coalesce(pl.base_salary, 0), salary_due = coalesce(pl.base_salary, 0), updated_at = now(), updated_by = emp where id = d.id;
  end if;
  perform payroll_log('إعادة احتساب مستحق معتمد', d.period, d.subject_name, p_reason, jsonb_build_object(
    'before', jsonb_build_object('salaryDue', d.salary_due, 'bonusDue', d.bonus_due, 'qualifying', d.qualifying),
    'after', (select jsonb_build_object('salaryDue', salary_due, 'bonusDue', bonus_due, 'qualifying', qualifying) from payroll_dues where id = d.id)));
end $$;

-- تعديل يدوي لمبلغ مستحق (حتى بعد الإغلاق) — بسبب إجباري ومتسجّل
create or replace function payroll_adjust_due(p_due uuid, p_salary numeric, p_bonus numeric, p_reason text) returns void
language plpgsql security definer set search_path = public as $$
declare emp uuid := require_gm('edit'); d payroll_dues; per payroll_periods; ps numeric; pb numeric; ns numeric := round(coalesce(p_salary, -1), 2); nb numeric := round(coalesce(p_bonus, -1), 2);
begin
  if coalesce(trim(p_reason), '') = '' then raise exception 'اكتب سبب التعديل'; end if;
  select * into d from payroll_dues where id = p_due for update;
  if d.id is null then raise exception 'المستحق غير موجود'; end if;
  if ns < 0 or nb < 0 then raise exception 'المبالغ لا يمكن أن تكون سالبة'; end if;
  if d.subject_type = 'employee' and nb > 0 then raise exception 'الموظفين الإداريين مالهمش مكافآت تارجت'; end if;
  select * into per from payroll_periods where period = d.period;
  select coalesce(sum(amount) filter (where kind = 'salary'), 0), coalesce(sum(amount) filter (where kind = 'bonus'), 0) into ps, pb
    from payroll_payouts where due_id = d.id and status = 'paid';
  if ns < ps or nb < pb then raise exception 'المستحق الجديد أقل من اللي اتصرف بالفعل — ألغِ الصرف الزيادة الأول'; end if;
  update payroll_dues set salary_due = ns, bonus_due = nb, updated_at = now(), updated_by = emp where id = d.id;
  perform payroll_log(case when per.status = 'closed' then 'تعديل مستحق بعد إغلاق الشهر' else 'تعديل مستحق معتمد' end, d.period, d.subject_name, p_reason,
    jsonb_build_object('before', jsonb_build_object('salaryDue', d.salary_due, 'bonusDue', d.bonus_due), 'after', jsonb_build_object('salaryDue', ns, 'bonusDue', nb)));
end $$;

-- ---------- الصرف اليدوي (جزئي أو كامل) ----------
create or replace function payroll_pay(p jsonb) returns jsonb
language plpgsql security definer set search_path = public as $$
declare emp uuid := require_gm('create'); d payroll_dues; per payroll_periods; k text := _txt(p, 'kind'); m text := coalesce(nullif(_txt(p, 'method'), ''), 'transfer');
  amt numeric; dt date; key text := nullif(_txt(p, 'clientKey'), ''); paid numeric; due_amt numeric; v uuid; vno text; ex payroll_payouts;
begin
  if key is not null then
    select * into ex from payroll_payouts where client_key = key;
    if ex.id is not null then return jsonb_build_object('id', ex.id, 'no', ex.no, 'amount', ex.amount, 'duplicate', true); end if;
  end if;
  begin amt := round((p->>'amount')::numeric, 2); exception when others then raise exception 'اكتب مبلغ صحيح'; end;
  begin dt := coalesce(nullif(p->>'paidOn', '')::date, riyadh_today()); exception when others then raise exception 'تاريخ الصرف غير صحيح'; end;
  if amt is null or amt <= 0 then raise exception 'مبلغ الصرف لازم يكون أكبر من صفر'; end if;
  if dt > riyadh_today() then raise exception 'تاريخ الصرف لا يمكن أن يكون في المستقبل'; end if;
  if k not in ('salary', 'bonus') then raise exception 'نوع المستحق غير صحيح'; end if;
  if m not in ('cash', 'transfer') then raise exception 'طريقة الصرف غير صحيحة'; end if;
  select * into d from payroll_dues where id = _uuid(p, 'dueId') for update;
  if d.id is null then raise exception 'المستحق غير موجود — اعتمد الشهر الأول'; end if;
  -- بعد القفل: لو نفس العملية (نفس المفتاح) اتسجّلت في نفس اللحظة من ضغطة تانية، نرجّعها بدل ما نسجّل مرتين
  if key is not null then
    select * into ex from payroll_payouts where client_key = key;
    if ex.id is not null then return jsonb_build_object('id', ex.id, 'no', ex.no, 'amount', ex.amount, 'duplicate', true); end if;
  end if;
  select * into per from payroll_periods where period = d.period;
  if per.status not in ('approved', 'closed') then raise exception 'اعتمد الشهر الأول قبل الصرف'; end if;
  due_amt := case when k = 'salary' then d.salary_due else d.bonus_due end;
  select coalesce(sum(amount), 0) into paid from payroll_payouts where due_id = d.id and kind = k and status = 'paid';
  if due_amt <= 0 then raise exception '% — مفيش % مستحق', d.subject_name, case when k = 'salary' then 'راتب' else 'مكافأة' end; end if;
  if paid + amt > due_amt then raise exception 'المبلغ أكبر من المتبقي (% ر.س)', due_amt - paid; end if;
  vno := 'PR-' || lpad(nextval('payroll_payout_no_seq')::text, 6, '0');
  insert into payroll_payouts (no, due_id, kind, amount, paid_on, method, reference, note, client_key, created_by)
  values (vno, d.id, k, amt, dt, m, _txt(p, 'reference'), _txt(p, 'note'), key, emp) returning id into v;
  perform payroll_log(case when k = 'salary' then 'صرف راتب' else 'صرف مكافأة' end, d.period, d.subject_name, _txt(p, 'note'),
    jsonb_build_object('no', vno, 'amount', amt, 'paidOn', dt, 'method', m, 'reference', _txt(p, 'reference'), 'remainingAfter', due_amt - paid - amt));
  return jsonb_build_object('id', v, 'no', vno, 'amount', amt, 'remaining', due_amt - paid - amt);
end $$;

create or replace function payroll_void_payout(p_id uuid, p_reason text) returns void
language plpgsql security definer set search_path = public as $$
declare emp uuid := require_gm('delete'); po payroll_payouts; d payroll_dues;
begin
  if coalesce(trim(p_reason), '') = '' then raise exception 'اكتب سبب إلغاء الصرف'; end if;
  update payroll_payouts set status = 'void', voided_at = now(), voided_by = emp, void_reason = trim(p_reason)
  where id = p_id and status = 'paid' returning * into po;
  if po.id is null then raise exception 'الصرف غير موجود أو ملغي بالفعل'; end if;
  select * into d from payroll_dues where id = po.due_id;
  perform payroll_log('إلغاء صرف', d.period, d.subject_name, p_reason, jsonb_build_object('no', po.no, 'amount', po.amount, 'kind', po.kind));
end $$;

-- ---------- سجل الصرف والتدقيق (للتقارير) ----------
create or replace function payroll_log_list(p_from text, p_to text) returns jsonb
language plpgsql stable security definer set search_path = public as $$
begin
  perform require_gm('view');
  perform payroll_period_range(p_from); perform payroll_period_range(p_to);
  return jsonb_build_object(
    'payouts', (select coalesce(jsonb_agg(jsonb_build_object('id', po.id, 'no', po.no, 'period', pd.period, 'kind', po.kind, 'amount', po.amount,
        'paidOn', po.paid_on, 'method', po.method, 'reference', po.reference, 'note', po.note, 'status', po.status, 'subject', pd.subject_name,
        'subjectType', pd.subject_type, 'role', pd.subject_role, 'createdBy', em.name, 'createdAt', po.created_at, 'voidReason', po.void_reason)
        order by po.created_at desc), '[]'::jsonb)
      from payroll_payouts po join payroll_dues pd on pd.id = po.due_id left join employees em on em.id = po.created_by
      where pd.period between p_from and p_to),
    'audit', (select coalesce(jsonb_agg(jsonb_build_object('at', au.at, 'actor', au.actor_name, 'action', au.action, 'period', au.period,
        'subject', au.subject_name, 'reason', au.reason, 'details', au.details) order by au.at desc), '[]'::jsonb)
      from payroll_audit au where au.period is null or au.period between p_from and p_to));
end $$;

-- ---------- لوحة الأخصائي: بياناته هو بس ----------
create or replace function my_target(p_period text) returns jsonb
language plpgsql stable security definer set search_path = public as $$
declare me uuid := require_perm('mytarget', 'view'); th uuid; r record; d payroll_dues; c jsonb; visits jsonb; pb numeric; days jsonb; today date := riyadh_today();
begin
  select therapist_id into th from employees where id = me;
  if th is null then raise exception 'حسابك مش مربوط بملف أخصائي — كلّم المدير'; end if;
  select * into r from payroll_period_range(p_period);
  if r.d1 > today then raise exception 'الشهر ده لسه مابدأش'; end if;
  select * into d from payroll_dues where therapist_id = th and period = p_period;
  c := therapist_target_calc(th, p_period, d.id);
  select coalesce(sum(amount), 0) into pb from payroll_payouts where due_id = d.id and kind = 'bonus' and status = 'paid';
  select coalesce(jsonb_agg(jsonb_build_object('date', tv.visit_date, 'fileNo', tv.file_no, 'service', tv.service_name, 'valueNet', tv.value_net,
      'collected', tv.collected, 'qualifying', case when (c->>'basis') = 'invoiced' then tv.value_net else tv.collected end, 'paymentStatus', tv.payment_status)
      order by tv.visit_date desc, tv.visit_time desc), '[]'::jsonb) into visits
    from target_visits(th, r.d1, r.d2, d.id) tv where not tv.counted_elsewhere;
  select coalesce(jsonb_agg(jsonb_build_object('date', x.visit_date, 'amount', x.amt) order by x.visit_date), '[]'::jsonb) into days
    from (select tv.visit_date, sum(case when (c->>'basis') = 'invoiced' then tv.value_net else tv.collected end) as amt
          from target_visits(th, r.d1, r.d2, d.id) tv where not tv.counted_elsewhere group by tv.visit_date) x;
  return c || jsonb_build_object(
    'period', p_period, 'from', r.d1, 'to', r.d2, 'today', today,
    'daysLeft', case when today > r.d2 then 0 when today < r.d1 then (r.d2 - r.d1 + 1) else (r.d2 - today) + 1 end,
    'name', (select name from therapists where id = th),
    'approved', d.id is not null, 'approvedBonus', case when d.id is not null then d.bonus_due end, 'paidBonus', pb,
    'visitsList', visits, 'daily', days);
end $$;

-- ---------- «الفواتير والمدفوعات (المدير)» على الهيكل الجديد ----------
create or replace function finance_month(p_period text) returns jsonb
language plpgsql stable security definer set search_path = public as $$
declare r record; inv jsonb; pays jsonb; sales jsonb; outs jsonb;
begin
  perform require_gm('view');
  select * into r from payroll_period_range(p_period);

  select coalesce(jsonb_agg(jsonb_build_object(
      'id', i.id, 'no', i.no, 'date', i.date, 'patient', pt.full_name, 'service', i.service_name, 'status', i.status,
      'total', i.total, 'tax', i.tax_amount, 'paid', i.paid, 'remaining', i.remaining,
      'therapist', th.name) order by i.date desc, i.no desc), '[]'::jsonb)
  into inv
  from invoices i
  join patients pt on pt.id = i.patient_id
  left join appointments a on a.id = i.appointment_id
  left join treatment_plans tp on tp.id = i.plan_id
  left join therapists th on th.id = coalesce(a.therapist_id, tp.therapist_id)
  where i.status <> 'draft' and i.date between r.d1 and r.d2;

  select coalesce(jsonb_agg(jsonb_build_object(
      'id', pay.id, 'date', pay.date, 'amount', pay.amount, 'method', pay.method, 'invoiceNo', i.no, 'patient', pt.full_name,
      'service', i.service_name, 'therapist', th.name) order by pay.date desc), '[]'::jsonb)
  into pays
  from payments pay
  join invoices i on i.id = pay.invoice_id
  join patients pt on pt.id = pay.patient_id
  left join appointments a on a.id = i.appointment_id
  left join treatment_plans tp on tp.id = i.plan_id
  left join therapists th on th.id = coalesce(a.therapist_id, tp.therapist_id)
  where pay.voided_at is null and i.status <> 'cancelled' and (pay.date at time zone 'Africa/Cairo')::date between r.d1 and r.d2;

  select coalesce(jsonb_agg(jsonb_build_object(
      'id', s.id, 'date', s.created_at, 'no', s.invoice_no, 'product', s.product_name, 'qty', s.qty, 'total', s.total,
      'method', s.payment_method, 'customer', coalesce(pt.full_name, s.customer_name)) order by s.created_at desc), '[]'::jsonb)
  into sales
  from product_sales s left join patients pt on pt.id = s.patient_id
  where s.status = 'completed' and (s.created_at at time zone 'Africa/Cairo')::date between r.d1 and r.d2;

  -- الصرف اللي تم خلال الشهر (بتاريخ الصرف) — عن أي شهر مستحق
  select coalesce(jsonb_agg(jsonb_build_object(
      'id', po.id, 'no', po.no, 'kind', po.kind, 'period', pd.period, 'subject', pd.subject_name, 'subjectType', pd.subject_type, 'role', pd.subject_role,
      'amount', po.amount, 'paidOn', po.paid_on, 'method', po.method, 'reference', po.reference, 'note', po.note, 'status', po.status,
      'paidBy', em.name, 'createdAt', po.created_at, 'voidReason', po.void_reason) order by po.paid_on desc, po.created_at desc), '[]'::jsonb)
  into outs
  from payroll_payouts po join payroll_dues pd on pd.id = po.due_id left join employees em on em.id = po.created_by
  where po.paid_on between r.d1 and r.d2;

  return jsonb_build_object(
    'period', p_period, 'from', r.d1, 'to', r.d2,
    'totals', jsonb_build_object(
      'invoiced', coalesce((select sum((x->>'total')::numeric) from jsonb_array_elements(inv) x where x->>'status' <> 'cancelled'), 0),
      'outstanding', coalesce((select sum((x->>'remaining')::numeric) from jsonb_array_elements(inv) x where x->>'status' <> 'cancelled'), 0),
      'collected', coalesce((select sum((x->>'amount')::numeric) from jsonb_array_elements(pays) x), 0),
      'productSales', coalesce((select sum((x->>'total')::numeric) from jsonb_array_elements(sales) x), 0),
      'salaries', coalesce((select sum((x->>'amount')::numeric) from jsonb_array_elements(outs) x where x->>'status' = 'paid' and x->>'kind' = 'salary'), 0),
      'bonuses', coalesce((select sum((x->>'amount')::numeric) from jsonb_array_elements(outs) x where x->>'status' = 'paid' and x->>'kind' = 'bonus'), 0)
    ),
    'invoices', inv, 'payments', pays, 'productSales', sales, 'payouts', outs);
end $$;

-- ---------- الصلاحيات ----------
revoke execute on function payroll_plan_for(text, uuid, text), payroll_bonus_amount(text, numeric, numeric, numeric, numeric),
  target_visits(uuid, date, date, uuid), therapist_target_calc(uuid, text, uuid), require_gm(text), payroll_log(text, text, text, text, jsonb),
  payroll_period_range(text) from public, anon, authenticated;
revoke execute on function is_gm() from public, anon;
grant execute on function is_gm() to authenticated; -- مستخدمة في سياسات RLS
revoke execute on function payroll_overview(text), payroll_subject_detail(text, uuid, text), payroll_save_plan(jsonb), payroll_set_basis(text),
  payroll_approve_period(text, text), payroll_close_period(text, text), payroll_recalc_due(uuid, text), payroll_adjust_due(uuid, numeric, numeric, text),
  payroll_pay(jsonb), payroll_void_payout(uuid, text), payroll_log_list(text, text), my_target(text), finance_month(text) from public, anon;
grant execute on function payroll_overview(text), payroll_subject_detail(text, uuid, text), payroll_save_plan(jsonb), payroll_set_basis(text),
  payroll_approve_period(text, text), payroll_close_period(text, text), payroll_recalc_due(uuid, text), payroll_adjust_due(uuid, numeric, numeric, text),
  payroll_pay(jsonb), payroll_void_payout(uuid, text), payroll_log_list(text, text), my_target(text), finance_month(text) to authenticated;

-- payroll = المدير العام بس. mytarget = لوحة الأخصائي الشخصية.
delete from role_permissions where area = 'payroll' and role <> 'system_admin';
insert into role_permissions (role, area, ops) values
  ('system_admin', 'payroll', '{view,create,edit,delete}'),
  ('system_admin', 'mytarget', '{view}'),
  ('therapist', 'mytarget', '{view}')
on conflict (role, area) do update set ops = excluded.ops;
