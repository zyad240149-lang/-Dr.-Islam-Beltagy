-- تحديد نسبة المكافأة بعد ما الأخصائي يوصل للتارجت (طلب الإدارة 2026-10-11):
-- المدير العام يختار النسبة على مستحق معتمد لأخصائي حقق التارجت — من قيمة التارجت أو من الإيراد المؤهل —
-- والمكافأة المعتمدة بتتحسب على الخادم وتتسجّل في سجل التدقيق، وبعدها تتصرف عادي (payroll_pay).
create or replace function payroll_set_bonus_rate(p_due uuid, p_method text, p_rate numeric, p_note text default '') returns jsonb
language plpgsql security definer set search_path = public as $$
declare emp uuid := require_gm('edit'); d payroll_dues; per payroll_periods; pb numeric; amt numeric; r numeric := round(coalesce(p_rate, -1), 2);
begin
  select * into d from payroll_dues where id = p_due for update;
  if d.id is null then raise exception 'المستحق غير موجود — اعتمد الشهر الأول'; end if;
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

revoke execute on function payroll_set_bonus_rate(uuid, text, numeric, text) from public, anon;
grant execute on function payroll_set_bonus_rate(uuid, text, numeric, text) to authenticated;
