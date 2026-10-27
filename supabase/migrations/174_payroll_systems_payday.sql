-- أنظمة الرواتب الثلاثة + موعد الصرف (2026-10-21)
--   base_commission = راتب أساسي + عمولة | commission_only = عمولة فقط (من أول ريال) | base_only = راتب ثابت فقط
-- pay_day = يوم الصرف الثابت (1–31، بيتقصّ لآخر يوم في الشهر) في الشهر اللي بعد شهر الاحتساب. فترة الاحتساب = الشهر الميلادي كامل.
alter table comp_plans add column if not exists pay_system text check (pay_system in ('base_commission', 'commission_only', 'base_only'));
alter table comp_plans add column if not exists pay_day smallint check (pay_day between 1 and 31);
update comp_plans set pay_system = case
  when subject_type = 'employee' or bonus_method = 'none' then 'base_only'
  when base_salary = 0 and bonus_condition = 'always' then 'commission_only'
  else 'base_commission' end
  where pay_system is null;

create or replace function payroll_pay_date(p_period text, p_day int) returns date
language sql immutable set search_path = public as $$
  select case when p_day is null then null else
    (date_trunc('month', (p_period || '-01')::date) + interval '1 month')::date
      + (least(p_day, extract(day from (date_trunc('month', (p_period || '-01')::date) + interval '2 month - 1 day'))::int) - 1) end
$$;
revoke execute on function payroll_pay_date(text, int) from public, anon;
grant execute on function payroll_pay_date(text, int) to authenticated;

do $$
declare def text; nd text;
begin
  -- 1) الحفظ: النظام + يوم الصرف + اتساق الحقول
  select pg_get_functiondef(p.oid) into def from pg_proc p join pg_namespace n on n.oid = p.pronamespace where n.nspname = 'public' and p.proname = 'payroll_save_plan';
  nd := replace(def, 'nm text; v uuid; prev comp_plans;', 'nm text; v uuid; prev comp_plans; psys text; pday int;');
  nd := replace(nd, 'if meth in (''pct_target'', ''pct_revenue'') and rate <= 0 then', $b$prev := payroll_plan_for(typ, sid, eff);
  psys := case when typ = 'employee' then 'base_only' else coalesce(nullif(_txt(p, 'paySystem'), ''),
    case when meth = 'none' then 'base_only' when sal = 0 and cond = 'always' then 'commission_only' else 'base_commission' end) end;
  if psys not in ('base_commission', 'commission_only', 'base_only') then raise exception 'نظام الراتب غير صحيح'; end if;
  begin
    pday := case when p ? 'payDay' then nullif(p->>'payDay', '')::int else prev.pay_day end;
  exception when others then raise exception 'يوم الصرف لازم يكون رقم من 1 إلى 31';
  end;
  if pday is not null and pday not between 1 and 31 then raise exception 'يوم الصرف لازم يكون من 1 إلى 31'; end if;
  if psys = 'base_only' then meth := 'none'; rate := 0; fixed := 0; cond := 'reach'; end if;
  if psys = 'commission_only' then sal := 0; meth := 'pct_revenue'; cond := 'always'; fixed := 0; end if;
  if psys = 'base_commission' and meth = 'none' then raise exception 'حدّد نسبة العمولة للنظام: راتب أساسي + عمولة'; end if;
  if meth in ('pct_target', 'pct_revenue') and rate <= 0 then$b$);
  nd := replace(nd, 'bonus_condition, note, created_by)', 'bonus_condition, note, created_by, pay_system, pay_day)');
  nd := replace(nd, 'cond, _txt(p, ''note''), emp)', 'cond, _txt(p, ''note''), emp, psys, pday)');
  nd := replace(nd, '''bonusCondition'', cond)));', '''bonusCondition'', cond, ''paySystem'', psys, ''payDay'', pday)));');
  if nd = def or position('psys' in nd) = 0 or position('pay_system, pay_day)' in nd) = 0 then raise exception '174: تعريف payroll_save_plan اتغيّر — راجع الاستبدال'; end if;
  execute nd;

  -- 2) الحساب المباشر: النظام + يوم الصرف في الإعدادات الحالية
  select pg_get_functiondef(p.oid) into def from pg_proc p join pg_namespace n on n.oid = p.pronamespace where n.nspname = 'public' and p.proname = 'therapist_target_calc';
  nd := replace(def, '''bonusCondition'', coalesce(pl.bonus_condition, ''reach''),',
    '''bonusCondition'', coalesce(pl.bonus_condition, ''reach''), ''paySystem'', coalesce(pl.pay_system, ''base_only''), ''payDay'', pl.pay_day,');
  if nd = def then raise exception '174: therapist_target_calc'; end if;
  execute nd;

  -- 3) اللوحة: موعد الصرف + المتأخر
  select pg_get_functiondef(p.oid) into def from pg_proc p join pg_namespace n on n.oid = p.pronamespace where n.nspname = 'public' and p.proname = 'payroll_overview';
  nd := replace(def, '''paidSalary'', coalesce(ps, 0), ''paidBonus'', coalesce(pb, 0), ''lastPaidOn'', last_on,',
    '''paidSalary'', coalesce(ps, 0), ''paidBonus'', coalesce(pb, 0), ''lastPaidOn'', last_on,
      ''payDate'', payroll_pay_date(p_period, (c->>''payDay'')::int),
      ''overdue'', payroll_pay_date(p_period, (c->>''payDay'')::int) < riyadh_today()
        and coalesce(due_total, coalesce((c->>''baseSalary'')::numeric, 0) + coalesce((c->>''bonus'')::numeric, 0)) > coalesce(ps, 0) + coalesce(pb, 0),');
  nd := replace(nd, '''paidSalary'', coalesce(ps, 0), ''paidBonus'', 0, ''lastPaidOn'', last_on,',
    '''paidSalary'', coalesce(ps, 0), ''paidBonus'', 0, ''lastPaidOn'', last_on,
      ''payDate'', payroll_pay_date(p_period, pl.pay_day),
      ''overdue'', payroll_pay_date(p_period, pl.pay_day) < riyadh_today() and coalesce(d.salary_due, pl.base_salary, 0) > coalesce(ps, 0),');
  nd := replace(nd, '''baseSalary'', coalesce(pl.base_salary, 0)),
      ''dueId'', d.id,', '''baseSalary'', coalesce(pl.base_salary, 0), ''paySystem'', ''base_only'', ''payDay'', pl.pay_day),
      ''dueId'', d.id,');
  if nd = def or position('overdue' in nd) = 0 then raise exception '174: payroll_overview'; end if;
  execute nd;
end $$;
