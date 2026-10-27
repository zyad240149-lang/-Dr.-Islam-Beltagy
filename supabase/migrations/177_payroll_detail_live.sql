-- تفاصيل الأخصائي: المستحق اللي بيتحدّث تلقائيًا (176) يعرض زياراته الحية، مش اللقطة القديمة
do $$
declare def text; nd text;
begin
  select pg_get_functiondef(p.oid) into def from pg_proc p join pg_namespace n on n.oid = p.pronamespace where n.nspname = 'public' and p.proname = 'payroll_subject_detail';
  nd := replace(def, 'if d.id is not null then
      select coalesce(jsonb_agg(jsonb_build_object(''appointmentId'', appointment_id,',
    'if d.id is not null and not (d.auto_sync and not exists (select 1 from payroll_payouts po where po.due_id = d.id and po.status = ''paid'')
                                  and not exists (select 1 from payroll_periods pp where pp.period = d.period and pp.status = ''closed'')) then
      select coalesce(jsonb_agg(jsonb_build_object(''appointmentId'', appointment_id,');
  nd := replace(nd, 'from target_visits(p_id, r.d1, r.d2, null) tv;', 'from target_visits(p_id, r.d1, r.d2, d.id) tv;');
  if nd = def or position('auto_sync' in nd) = 0 or position('r.d2, d.id) tv' in nd) = 0 then raise exception '177: payroll_subject_detail'; end if;
  execute nd;
end $$;
