-- إلغاء اعتماد شهر في «الرواتب والتارجت» (طلب الإدارة 2026-10-11): يرجّع الشهر «مفتوح» بأرقام مباشرة.
-- مسموح بس لو مفيش أي عملية صرف (ولا حتى ملغاة) على مستحقات الشهر — عشان سجل الصرف مايتمسحش أبدًا. بسبب إجباري ومتسجّل.
create or replace function payroll_reopen_period(p_period text, p_reason text) returns jsonb
language plpgsql security definer set search_path = public as $$
declare emp uuid := require_gm('edit'); per payroll_periods; n int;
begin
  perform payroll_period_range(p_period);
  if coalesce(trim(p_reason), '') = '' then raise exception 'اكتب سبب إلغاء الاعتماد'; end if;
  perform pg_advisory_xact_lock(hashtext('payroll-period:' || p_period));
  select * into per from payroll_periods where period = p_period for update;
  if per.period is null or per.status = 'open' then raise exception 'الشهر مش معتمد أصلًا'; end if;
  if exists (select 1 from payroll_payouts po join payroll_dues d on d.id = po.due_id where d.period = p_period) then
    raise exception 'فيه صرف متسجّل على الشهر ده — مايتلغاش اعتماده (ألغِ الصرف أو استخدم «تعديل المستحق»)';
  end if;
  select count(*) into n from payroll_dues where period = p_period;
  delete from payroll_dues where period = p_period; -- الزيارات المحتسبة بتتمسح معاها (cascade) وترجع تتحسب مباشر
  update payroll_periods set status = 'open', approved_at = null, approved_by = null, closed_at = null, closed_by = null where period = p_period;
  perform payroll_log('إلغاء اعتماد الشهر', p_period, null, p_reason, jsonb_build_object('before', per.status, 'removedDues', n));
  return jsonb_build_object('removedDues', n);
end $$;

revoke execute on function payroll_reopen_period(text, text) from public, anon;
grant execute on function payroll_reopen_period(text, text) to authenticated;

-- أكتوبر 2026 اتعتمد بالغلط ومفيش عليه مستحقات ولا صرف — يرجع مفتوح (طلب المدير)
do $$ begin
  if exists (select 1 from payroll_periods where period = '2026-10' and status = 'approved')
     and not exists (select 1 from payroll_dues where period = '2026-10') then
    update payroll_periods set status = 'open', approved_at = null, approved_by = null where period = '2026-10';
    insert into payroll_audit (actor, actor_name, action, period, reason, details)
    values (null, 'النظام', 'إلغاء اعتماد الشهر', '2026-10', 'طلب المدير: الاعتماد اتعمل بالغلط', '{"before":"approved","removedDues":0}'::jsonb);
  end if;
end $$;
