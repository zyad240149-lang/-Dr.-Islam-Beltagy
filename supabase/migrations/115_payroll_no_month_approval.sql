-- «مش عاوز اعتماد الشهر» (طلب المدير 2026-10-12): مفيش خطوة اعتماد يدوية.
-- أول ما المدير يصرف أو يحدد مكافأة لشخص، المستحق بتاعه بيتثبّت لوحده بالأرقام المباشرة في اللحظة دي.
create or replace function payroll_ensure_due(p_period text, p_type text, p_id uuid) returns uuid
language plpgsql security definer set search_path = public as $$
declare emp uuid := require_gm('create'); r record; per payroll_periods; pl comp_plans; c jsonb; v uuid; basis text; nm text; rl text;
begin
  select * into r from payroll_period_range(p_period);
  if r.d1 > riyadh_today() then raise exception 'الشهر لسه مابدأش'; end if;
  if p_type not in ('therapist', 'employee') then raise exception 'نوع غير صحيح'; end if;
  perform pg_advisory_xact_lock(hashtext('payroll-period:' || p_period));
  select id into v from payroll_dues where period = p_period and (case when p_type = 'therapist' then therapist_id else employee_id end) = p_id;
  if v is not null then return v; end if;
  insert into payroll_periods (period) values (p_period) on conflict (period) do nothing;
  select * into per from payroll_periods where period = p_period for update;
  if per.status = 'closed' then raise exception 'الشهر مقفول'; end if;
  pl := payroll_plan_for(p_type, p_id, p_period);
  if pl.id is null then raise exception 'حدد الراتب والإعدادات الأول'; end if;
  select coalesce(target_revenue_basis, 'collected') into basis from center_info limit 1;
  if p_type = 'therapist' then
    select name into nm from therapists where id = p_id;
    c := therapist_target_calc(p_id, p_period, null);
    insert into payroll_dues (period, subject_type, therapist_id, subject_name, subject_role, plan_id, base_salary, monthly_target, bonus_method, bonus_rate,
      bonus_fixed, bonus_condition, revenue_basis, qualifying, invoiced, collected, visits_count, achievement_pct, target_reached, computed_bonus, salary_due, bonus_due, approved_by)
    values (p_period, 'therapist', p_id, nm, 'therapist', pl.id, pl.base_salary, pl.monthly_target, pl.bonus_method, pl.bonus_rate, pl.bonus_fixed,
      pl.bonus_condition, basis, (c->>'qualifying')::numeric, (c->>'invoiced')::numeric, (c->>'collected')::numeric, (c->>'visits')::int,
      (c->>'pct')::numeric, (c->>'reached')::boolean, (c->>'bonus')::numeric, pl.base_salary, (c->>'bonus')::numeric, emp)
    returning id into v;
    insert into payroll_due_visits (due_id, appointment_id, visit_date, file_no, patient_name, service_name, invoice_no, source, value_net, collected, qualifying, payment_status)
    select v, tv.appointment_id, tv.visit_date, tv.file_no, tv.patient_name, tv.service_name, tv.invoice_no, tv.source, tv.value_net, tv.collected,
      case when basis = 'invoiced' then tv.value_net else tv.collected end, tv.payment_status
    from target_visits(p_id, r.d1, r.d2, null) tv where not tv.counted_elsewhere;
  else
    select name, role into nm, rl from employees where id = p_id;
    if nm is null then raise exception 'الموظف غير موجود'; end if;
    insert into payroll_dues (period, subject_type, employee_id, subject_name, subject_role, plan_id, base_salary, revenue_basis, salary_due, approved_by)
    values (p_period, 'employee', p_id, nm, rl, pl.id, pl.base_salary, basis, pl.base_salary, emp) returning id into v;
  end if;
  -- حالة داخلية بس (مش ظاهرة في الواجهة) عشان باقي قواعد الصرف تفضل زي ما هي
  update payroll_periods set status = 'approved', approved_at = coalesce(approved_at, now()), approved_by = coalesce(approved_by, emp) where period = p_period and status = 'open';
  perform payroll_log('تثبيت مستحق تلقائيًا', p_period, nm, null, '{}'::jsonb);
  return v;
end $$;

revoke execute on function payroll_ensure_due(text, text, uuid) from public, anon;
grant execute on function payroll_ensure_due(text, text, uuid) to authenticated;
