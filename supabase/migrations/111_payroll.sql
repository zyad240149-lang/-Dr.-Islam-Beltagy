-- قسم «رواتب الأخصائيين» (راتب أساسي + هدف شهري + نسبة لو وصل الهدف) وصرفها، وقسم «الفواتير والمدفوعات (المدير)»
-- اللي بيعرض فواتير المرضى والمدفوعات والرواتب ونسب الأطباء مع بعض. (طلب الإدارة 2026-10-11)
-- ⚠️ للمدير بس (المدير العام + مدير المركز): صلاحية payroll + شرط is_admin() على الخادم — حتى لو الصلاحية اتدّت لدور تاني.
--
-- «دخل الأخصائي» في الشهر = المدفوعات المحصّلة فعلًا خلال الشهر (بتوقيت السعودية) على فواتير مربوطة بيه
-- (عن طريق موعد الفاتورة، أو الخطة العلاجية لو مفيش موعد) — بعد استبعاد الضريبة، ومن غير الدفعات الملغاة والفواتير الملغاة.
-- الفواتير اللي مش مربوطة بدكتور بتظهر كـ«دخل غير منسوب» ومابتدخلش في هدف حد.

create table if not exists therapist_compensation (
  therapist_id uuid primary key references therapists(id) on delete cascade,
  base_salary numeric(12,2) not null default 0 check (base_salary >= 0),
  monthly_target numeric(12,2) not null default 0 check (monthly_target >= 0),
  commission_rate numeric(5,2) not null default 0 check (commission_rate between 0 and 100),
  -- total = النسبة من كل الدخل لما يوصل الهدف | above_target = النسبة من اللي فوق الهدف بس
  commission_basis text not null default 'total' check (commission_basis in ('total', 'above_target')),
  note text not null default '',
  updated_at timestamptz not null default now(),
  updated_by uuid references employees(id) on delete set null
);
create index if not exists idx_comp_updated_by on therapist_compensation (updated_by);

create sequence if not exists payroll_payout_no_seq;

-- كل صرف = سند (PR-000001) بلقطة من الأرقام وقت الصرف — مابيتعدلش، والإلغاء بيحتفظ بالسجل
create table if not exists payroll_payouts (
  id uuid primary key default gen_random_uuid(),
  no text not null unique,
  therapist_id uuid not null references therapists(id) on delete restrict,
  period text not null check (period ~ '^[0-9]{4}-(0[1-9]|1[0-2])$'),
  kind text not null check (kind in ('salary', 'commission')),
  amount numeric(12,2) not null check (amount > 0),
  base_salary numeric(12,2) not null default 0,
  monthly_target numeric(12,2) not null default 0,
  achieved numeric(12,2) not null default 0,
  commission_rate numeric(5,2) not null default 0,
  commission_basis text not null default 'total',
  method text not null default 'transfer' check (method in ('cash', 'transfer')),
  note text not null default '',
  status text not null default 'paid' check (status in ('paid', 'cancelled')),
  paid_at timestamptz not null default now(),
  paid_by uuid references employees(id) on delete set null,
  cancelled_at timestamptz,
  cancelled_by uuid references employees(id) on delete set null,
  cancel_reason text
);
-- صرف واحد بس لكل (أخصائي + شهر + نوع) — الإلغاء بيفتح الباب لصرف جديد
create unique index if not exists payroll_one_paid_uq on payroll_payouts (therapist_id, period, kind) where status = 'paid';
create index if not exists idx_payroll_therapist on payroll_payouts (therapist_id);
create index if not exists idx_payroll_period on payroll_payouts (period);
create index if not exists idx_payroll_paid_by on payroll_payouts (paid_by);
create index if not exists idx_payroll_cancelled_by on payroll_payouts (cancelled_by);

alter table therapist_compensation enable row level security;
alter table payroll_payouts enable row level security;
drop policy if exists payroll_comp_select on therapist_compensation;
drop policy if exists payroll_payouts_select on payroll_payouts;
create policy payroll_comp_select on therapist_compensation for select using ((select has_perm('payroll', 'view')) and (select is_admin()));
create policy payroll_payouts_select on payroll_payouts for select using ((select has_perm('payroll', 'view')) and (select is_admin()));
revoke all on therapist_compensation, payroll_payouts from anon;
revoke insert, update, delete on therapist_compensation, payroll_payouts from authenticated;
grant select on therapist_compensation, payroll_payouts to authenticated;
revoke all on sequence payroll_payout_no_seq from anon, authenticated;

-- ---------- مساعدات ----------
create or replace function require_payroll(p_op text) returns uuid
language plpgsql stable security definer set search_path = public as $$
declare v uuid;
begin
  v := require_perm('payroll', p_op);
  if not is_admin() then raise exception 'قسم الرواتب ونسب الأطباء للمدير فقط' using errcode = '42501'; end if;
  return v;
end $$;

create or replace function payroll_period_range(p_period text, out d1 date, out d2 date)
language plpgsql immutable set search_path = public as $$
begin
  if coalesce(p_period, '') !~ '^[0-9]{4}-(0[1-9]|1[0-2])$' then raise exception 'الشهر غير صحيح'; end if;
  d1 := to_date(p_period || '-01', 'YYYY-MM-DD');
  d2 := (d1 + interval '1 month' - interval '1 day')::date;
end $$;

-- دخل كل أخصائي في فترة (المحصّل بدون الضريبة) — therapist_id = null يعني دخل مش مربوط بدكتور
create or replace function payroll_revenue(p_from date, p_to date)
returns table (therapist_id uuid, revenue numeric, payments_count bigint)
language sql stable security definer set search_path = public as $$
  select coalesce(a.therapist_id, tp.therapist_id) as therapist_id,
         round(sum(pay.amount * case when i.total > 0 and i.tax_amount > 0 then (i.total - i.tax_amount) / i.total else 1 end), 2) as revenue,
         count(*) as payments_count
  from payments pay
  join invoices i on i.id = pay.invoice_id
  left join appointments a on a.id = i.appointment_id
  left join treatment_plans tp on tp.id = i.plan_id
  where pay.voided_at is null and i.status <> 'cancelled'
    and (pay.date at time zone 'Africa/Cairo')::date between p_from and p_to
  group by 1
$$;

-- النسبة المستحقة: صفر لو ماوصلش الهدف
create or replace function payroll_commission(p_achieved numeric, p_target numeric, p_rate numeric, p_basis text) returns numeric
language sql immutable set search_path = public as $$
  select case
    when coalesce(p_rate, 0) <= 0 or coalesce(p_achieved, 0) <= 0 or p_achieved < coalesce(p_target, 0) then 0::numeric
    when p_basis = 'above_target' then round((p_achieved - coalesce(p_target, 0)) * p_rate / 100, 2)
    else round(p_achieved * p_rate / 100, 2)
  end
$$;

-- ---------- إعداد راتب / هدف / نسبة أخصائي ----------
create or replace function payroll_save_compensation(p jsonb) returns void
language plpgsql security definer set search_path = public as $$
declare emp uuid := require_payroll('edit'); tid uuid := _uuid(p, 'therapistId'); nm text;
  sal numeric; tgt numeric; rate numeric; basis text := coalesce(nullif(p->>'basis', ''), 'total');
begin
  select name into nm from therapists where id = tid;
  if nm is null then raise exception 'الأخصائي غير موجود'; end if;
  begin
    sal := round(coalesce(nullif(p->>'baseSalary', '')::numeric, 0), 2);
    tgt := round(coalesce(nullif(p->>'target', '')::numeric, 0), 2);
    rate := round(coalesce(nullif(p->>'rate', '')::numeric, 0), 2);
  exception when others then raise exception 'اكتب أرقام صحيحة للراتب والهدف والنسبة';
  end;
  if sal < 0 then raise exception 'الراتب الأساسي لا يمكن أن يكون سالبًا'; end if;
  if tgt < 0 then raise exception 'الهدف الشهري لا يمكن أن يكون سالبًا'; end if;
  if rate < 0 or rate > 100 then raise exception 'النسبة لازم تكون من 0 إلى 100'; end if;
  if basis not in ('total', 'above_target') then raise exception 'طريقة حساب النسبة غير صحيحة'; end if;
  insert into therapist_compensation (therapist_id, base_salary, monthly_target, commission_rate, commission_basis, note, updated_at, updated_by)
  values (tid, sal, tgt, rate, basis, _txt(p, 'note'), now(), emp)
  on conflict (therapist_id) do update set base_salary = excluded.base_salary, monthly_target = excluded.monthly_target,
    commission_rate = excluded.commission_rate, commission_basis = excluded.commission_basis, note = excluded.note,
    updated_at = now(), updated_by = emp;
  perform log_action('تحديث راتب وهدف ونسبة الأخصائي ' || nm);
end $$;

-- ---------- رواتب ونسب كل الأخصائيين في شهر ----------
create or replace function payroll_month(p_period text) returns jsonb
language plpgsql stable security definer set search_path = public as $$
declare r record; res jsonb;
begin
  perform require_payroll('view');
  select * into r from payroll_period_range(p_period);
  with rev as (select * from payroll_revenue(r.d1, r.d2)),
  x as (
    select t.id, t.name, t.title, t.active, c.therapist_id is not null as configured,
      coalesce(c.base_salary, 0) as base_salary, coalesce(c.monthly_target, 0) as target, coalesce(c.commission_rate, 0) as rate,
      coalesce(c.commission_basis, 'total') as basis, coalesce(c.note, '') as note,
      coalesce(rv.revenue, 0) as achieved, coalesce(rv.payments_count, 0) as payments_count
    from therapists t
    left join therapist_compensation c on c.therapist_id = t.id
    left join rev rv on rv.therapist_id = t.id
    where t.active or c.therapist_id is not null or rv.therapist_id is not null
       or exists (select 1 from payroll_payouts pp where pp.therapist_id = t.id and pp.period = p_period)
  )
  select jsonb_build_object(
    'period', p_period, 'from', r.d1, 'to', r.d2, 'today', riyadh_today(),
    'unattributed', coalesce((select revenue from rev where therapist_id is null), 0),
    'rows', coalesce(jsonb_agg(jsonb_build_object(
      'therapistId', x.id, 'name', x.name, 'title', x.title, 'active', x.active, 'configured', x.configured,
      'baseSalary', x.base_salary, 'target', x.target, 'rate', x.rate, 'basis', x.basis, 'note', x.note,
      'achieved', x.achieved, 'paymentsCount', x.payments_count,
      'reached', x.achieved > 0 and x.achieved >= x.target,
      'commission', payroll_commission(x.achieved, x.target, x.rate, x.basis),
      'salaryPayout', (select jsonb_build_object('id', pp.id, 'no', pp.no, 'amount', pp.amount, 'paidAt', pp.paid_at, 'method', pp.method)
                       from payroll_payouts pp where pp.therapist_id = x.id and pp.period = p_period and pp.kind = 'salary' and pp.status = 'paid'),
      'commissionPayout', (select jsonb_build_object('id', pp.id, 'no', pp.no, 'amount', pp.amount, 'paidAt', pp.paid_at, 'method', pp.method)
                       from payroll_payouts pp where pp.therapist_id = x.id and pp.period = p_period and pp.kind = 'commission' and pp.status = 'paid')
    ) order by x.name), '[]'::jsonb))
  into res from x;
  return res;
end $$;

-- ---------- صرف راتب أو نسبة (المبلغ بيتحسب على الخادم) ----------
create or replace function payroll_pay(p jsonb) returns jsonb
language plpgsql security definer set search_path = public as $$
declare emp uuid := require_payroll('create'); tid uuid := _uuid(p, 'therapistId'); per text := _txt(p, 'period'); k text := _txt(p, 'kind');
  m text := coalesce(nullif(_txt(p, 'method'), ''), 'transfer'); r record; c therapist_compensation; nm text; ach numeric; amt numeric; v uuid; vno text;
begin
  select * into r from payroll_period_range(per);
  if k not in ('salary', 'commission') then raise exception 'نوع الصرف غير صحيح'; end if;
  if m not in ('cash', 'transfer') then raise exception 'طريقة الصرف غير صحيحة'; end if;
  if r.d1 > riyadh_today() then raise exception 'لا يمكن الصرف لشهر لسه مابدأش'; end if;
  select name into nm from therapists where id = tid;
  if nm is null then raise exception 'الأخصائي غير موجود'; end if;
  -- قفل لنفس (الأخصائي + الشهر + النوع) عشان ضغطتين في نفس اللحظة مايصرفوش مرتين
  perform pg_advisory_xact_lock(hashtext('payroll:' || tid::text || ':' || per || ':' || k));
  if exists (select 1 from payroll_payouts where therapist_id = tid and period = per and kind = k and status = 'paid') then
    if k = 'salary' then raise exception 'راتب % عن شهر % اتصرف قبل كده', nm, per;
    else raise exception 'نسبة هدف % عن شهر % اتصرفت قبل كده', nm, per; end if;
  end if;
  select * into c from therapist_compensation where therapist_id = tid;
  if c.therapist_id is null then raise exception 'حدّد راتب وهدف % الأول', nm; end if;
  select coalesce(sum(revenue), 0) into ach from payroll_revenue(r.d1, r.d2) where therapist_id = tid;
  if k = 'salary' then
    amt := c.base_salary;
    if amt <= 0 then raise exception 'الراتب الأساسي لـ % غير محدد', nm; end if;
  else
    amt := payroll_commission(ach, c.monthly_target, c.commission_rate, c.commission_basis);
    if amt <= 0 then raise exception '% ماوصلش للهدف الشهر ده — مفيش نسبة مستحقة', nm; end if;
  end if;
  vno := 'PR-' || lpad(nextval('payroll_payout_no_seq')::text, 6, '0');
  insert into payroll_payouts (no, therapist_id, period, kind, amount, base_salary, monthly_target, achieved, commission_rate, commission_basis, method, note, paid_by)
  values (vno, tid, per, k, amt, c.base_salary, c.monthly_target, ach, c.commission_rate, c.commission_basis, m, _txt(p, 'note'), emp)
  returning id into v;
  perform log_action('صرف ' || case k when 'salary' then 'راتب' else 'نسبة هدف' end || ' ' || nm || ' عن ' || per || ' — ' || amt || ' ر.س (' || vno || ')');
  return jsonb_build_object('id', v, 'no', vno, 'amount', amt);
end $$;

-- ---------- إلغاء صرف (السجل بيفضل بحالة «ملغي») ----------
create or replace function payroll_cancel(p_id uuid, p_reason text) returns void
language plpgsql security definer set search_path = public as $$
declare emp uuid := require_payroll('delete'); pp payroll_payouts; nm text;
begin
  if coalesce(trim(p_reason), '') = '' then raise exception 'اكتب سبب إلغاء الصرف'; end if;
  update payroll_payouts set status = 'cancelled', cancelled_at = now(), cancelled_by = emp, cancel_reason = trim(p_reason)
  where id = p_id and status = 'paid' returning * into pp;
  if pp.id is null then raise exception 'الصرف غير موجود أو ملغي بالفعل'; end if;
  select name into nm from therapists where id = pp.therapist_id;
  perform log_action('إلغاء صرف ' || pp.no || ' (' || coalesce(nm, '') || ') — ' || trim(p_reason));
end $$;

-- ---------- «الفواتير والمدفوعات (المدير)»: كل الوارد والصادر في شهر ----------
create or replace function finance_month(p_period text) returns jsonb
language plpgsql stable security definer set search_path = public as $$
declare r record; inv jsonb; pays jsonb; sales jsonb; outs jsonb;
begin
  perform require_payroll('view');
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

  select coalesce(jsonb_agg(jsonb_build_object(
      'id', pp.id, 'no', pp.no, 'kind', pp.kind, 'period', pp.period, 'therapist', th.name, 'amount', pp.amount,
      'baseSalary', pp.base_salary, 'target', pp.monthly_target, 'achieved', pp.achieved, 'rate', pp.commission_rate, 'basis', pp.commission_basis,
      'method', pp.method, 'note', pp.note, 'status', pp.status, 'paidAt', pp.paid_at, 'paidBy', e.name,
      'cancelledAt', pp.cancelled_at, 'cancelReason', pp.cancel_reason) order by pp.paid_at desc), '[]'::jsonb)
  into outs
  from payroll_payouts pp join therapists th on th.id = pp.therapist_id left join employees e on e.id = pp.paid_by
  where pp.period = p_period;

  return jsonb_build_object(
    'period', p_period, 'from', r.d1, 'to', r.d2,
    'totals', jsonb_build_object(
      'invoiced', coalesce((select sum((x->>'total')::numeric) from jsonb_array_elements(inv) x where x->>'status' <> 'cancelled'), 0),
      'outstanding', coalesce((select sum((x->>'remaining')::numeric) from jsonb_array_elements(inv) x where x->>'status' <> 'cancelled'), 0),
      'collected', coalesce((select sum((x->>'amount')::numeric) from jsonb_array_elements(pays) x), 0),
      'productSales', coalesce((select sum((x->>'total')::numeric) from jsonb_array_elements(sales) x), 0),
      'salaries', coalesce((select sum((x->>'amount')::numeric) from jsonb_array_elements(outs) x where x->>'status' = 'paid' and x->>'kind' = 'salary'), 0),
      'commissions', coalesce((select sum((x->>'amount')::numeric) from jsonb_array_elements(outs) x where x->>'status' = 'paid' and x->>'kind' = 'commission'), 0)
    ),
    'invoices', inv, 'payments', pays, 'productSales', sales, 'payouts', outs);
end $$;

-- ---------- الصلاحيات ----------
-- الدوال الداخلية مش للاستدعاء المباشر
revoke execute on function payroll_revenue(date, date) from public, anon, authenticated;
revoke execute on function payroll_commission(numeric, numeric, numeric, text) from public, anon, authenticated;
revoke execute on function payroll_period_range(text) from public, anon, authenticated;
revoke execute on function require_payroll(text) from public, anon, authenticated;
revoke execute on function payroll_save_compensation(jsonb), payroll_month(text), payroll_pay(jsonb), payroll_cancel(uuid, text), finance_month(text) from public, anon;
grant execute on function payroll_save_compensation(jsonb), payroll_month(text), payroll_pay(jsonb), payroll_cancel(uuid, text), finance_month(text) to authenticated;

delete from role_permissions where area = 'payroll' and role not in ('system_admin', 'center_manager');
insert into role_permissions (role, area, ops) values
  ('system_admin', 'payroll', '{view,create,edit,delete}'),
  ('center_manager', 'payroll', '{view,create,edit,delete}')
on conflict (role, area) do update set ops = excluded.ops;
