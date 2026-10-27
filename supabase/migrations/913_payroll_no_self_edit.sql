-- تضارب مصالح: ولا حتى المدير العام (صاحب حساب أخصائي) يقدر يحدد راتبه/تارجته/نسبة مكافأته أو يعدّل مستحقه هو نفسه.
-- نفس الدوال الأصلية (112_payroll_targets.sql, 113_bonus_rate_after_target.sql) + سطر الحماية.

create or replace function payroll_save_plan(p jsonb) returns uuid
language plpgsql security definer set search_path = public as $$
declare emp uuid := require_gm('edit'); typ text := _txt(p, 'type'); sid uuid := _uuid(p, 'id'); eff text := _txt(p, 'effectiveFrom');
  sal numeric; tgt numeric; rate numeric; fixed numeric; meth text := coalesce(nullif(_txt(p, 'bonusMethod'), ''), 'none');
  cond text := coalesce(nullif(_txt(p, 'bonusCondition'), ''), 'reach'); nm text; v uuid; prev comp_plans;
begin
  if typ = 'therapist' and exists (select 1 from employees where id = emp and therapist_id = sid) then
    raise exception 'لا يمكنك تحديد راتبك أو تارجتك أنت — اطلب من مدير عام آخر';
  end if;
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

create or replace function payroll_adjust_due(p_due uuid, p_salary numeric, p_bonus numeric, p_reason text) returns void
language plpgsql security definer set search_path = public as $$
declare emp uuid := require_gm('edit'); d payroll_dues; per payroll_periods; ps numeric; pb numeric; ns numeric := round(coalesce(p_salary, -1), 2); nb numeric := round(coalesce(p_bonus, -1), 2);
begin
  select * into d from payroll_dues where id = p_due for update;
  if d.id is null then raise exception 'المستحق غير موجود'; end if;
  if d.subject_type = 'therapist' and exists (select 1 from employees where id = emp and therapist_id = d.therapist_id) then
    raise exception 'لا يمكنك تعديل مستحقك أنت — اطلب من مدير عام آخر';
  end if;
  if coalesce(trim(p_reason), '') = '' then raise exception 'اكتب سبب التعديل'; end if;
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

create or replace function payroll_set_bonus_rate(p_due uuid, p_method text, p_rate numeric, p_note text default '') returns jsonb
language plpgsql security definer set search_path = public as $$
declare emp uuid := require_gm('edit'); d payroll_dues; per payroll_periods; pb numeric; amt numeric; r numeric := round(coalesce(p_rate, -1), 2);
begin
  select * into d from payroll_dues where id = p_due for update;
  if d.id is null then raise exception 'المستحق غير موجود — اعتمد الشهر الأول'; end if;
  if exists (select 1 from employees where id = emp and therapist_id = d.therapist_id) then
    raise exception 'لا يمكنك تحديد نسبة مكافأتك أنت — اطلب من مدير عام آخر';
  end if;
  if d.subject_type <> 'therapist' then raise exception 'الموظفين الإداريين مالهمش مكافآت تارجت'; end if;
  select * into per from payroll_periods where period = d.period;
  if per.status not in ('approved', 'closed') then raise exception 'اعتمد الشهر الأول'; end if;
  if d.monthly_target <= 0 then raise exception 'مفيش تارجت محدد للشهر ده'; end if;
  if d.qualifying < d.monthly_target then raise exception 'لسه ماوصلش للتارجت — المكافأة بالنسبة بعد الوصول بس'; end if;
  if p_method not in ('pct_target', 'pct_revenue') then raise exception 'اختار النسبة من قيمة التارجت أو من الإيراد المؤهل'; end if;
  if r <= 0 or r > 100 then raise exception 'النسبة لازم تكون أكبر من 0 ولحد 100'; end if;
  amt := payroll_bonus_amount(p_method, r, 0, d.monthly_target, d.qualifying);
  select coalesce(sum(amount), 0) into pb from payroll_payouts where due_id = d.id and kind = 'bonus' and status = 'paid';
  if amt < pb then raise exception 'المكافأة الجديدة أقل من اللي اتصرف بالفعل — ألغِ الصرف الزيادة الأول'; end if;
  update payroll_dues set bonus_method = p_method, bonus_rate = r, bonus_fixed = 0, bonus_due = amt, updated_at = now(), updated_by = emp where id = d.id;
  perform payroll_log(case when per.status = 'closed' then 'تحديد نسبة المكافأة بعد إغلاق الشهر' else 'تحديد نسبة المكافأة بعد الوصول للتارجت' end,
    d.period, d.subject_name, p_note, jsonb_build_object(
      'before', jsonb_build_object('bonusMethod', d.bonus_method, 'bonusRate', d.bonus_rate, 'bonusDue', d.bonus_due),
      'after', jsonb_build_object('bonusMethod', p_method, 'bonusRate', r, 'bonusDue', amt),
      'target', d.monthly_target, 'qualifying', d.qualifying));
  return jsonb_build_object('bonusDue', amt, 'paid', pb, 'remaining', amt - pb);
end $$;
