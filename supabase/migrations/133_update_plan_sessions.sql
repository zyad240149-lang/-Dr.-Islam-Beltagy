-- 133: تعديل عدد جلسات الخطة من «مراجعة فاتورة الخطة العلاجية» (الاستقبال/المحاسب) — من غير ما يعدّل باقي بيانات الخطة.
-- مايقلّش عن الجلسات المكتملة ولا عن المواعيد المحجوزة على الخطة، والمدة بالأسابيع بتتحسب من جلسات الأسبوع.
create or replace function update_plan_sessions(p_plan uuid, p_total int) returns jsonb
language plpgsql security definer set search_path = public as $$
declare pl treatment_plans; done int; booked int; weeks int;
begin
  perform require_any(array['invoices:edit', 'plans:edit']);
  select * into pl from treatment_plans where id = p_plan for update;
  if pl.id is null or not can_see_patient(pl.patient_id) then raise exception 'الخطة غير موجودة'; end if;
  if p_total is null or p_total < 1 or p_total > 52 then raise exception 'عدد الجلسات من 1 إلى 52'; end if;
  select count(*) into done from treatment_sessions where plan_id = p_plan and status = 'completed';
  select count(*) into booked from appointments where plan_id = p_plan and status not in ('cancelled', 'no_show');
  if p_total < greatest(done, booked) then raise exception 'عدد الجلسات مايقلّش عن % (جلسات مكتملة أو محجوزة على الخطة)', greatest(done, booked); end if;
  weeks := greatest(1, ceil(p_total::numeric / greatest(pl.sessions_per_week, 1))::int);
  update treatment_plans set total_sessions = p_total, duration_weeks = weeks, end_date = start_date + weeks * 7, session_dates = null where id = p_plan;
  update invoices set service_name = regexp_replace(service_name, '\(\d+ جلسات\)', '(' || p_total || ' جلسات)')
   where plan_id = p_plan and status = 'draft';
  update invoice_items ii set description = i.service_name from invoices i where ii.invoice_id = i.id and i.plan_id = p_plan and i.status = 'draft';
  perform recalc_plan(p_plan);
  perform log_action('تعديل عدد جلسات الخطة العلاجية إلى ' || p_total, pl.patient_id);
  return jsonb_build_object('total', p_total);
end $$;
revoke execute on function update_plan_sessions(uuid, int) from public, anon;
grant execute on function update_plan_sessions(uuid, int) to authenticated;
