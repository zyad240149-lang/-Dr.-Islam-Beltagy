-- 936: الدفعات الملغاة (voided_at) ماتتحسبش إيراد في التقارير ولوحة التحكم.
CREATE OR REPLACE FUNCTION public.dashboard_stats(p_branch uuid DEFAULT NULL::uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare t date := riyadh_today(); m date := date_trunc('month', riyadh_today())::date; res jsonb; fin boolean := has_perm('financial','view');
begin
  perform require_perm('dashboard', 'view');
  select jsonb_build_object(
    'todayAppointments', (select count(*) from appointments a where a.date = t and a.status <> 'cancelled' and (p_branch is null or a.branch_id = p_branch) and can_see_patient(a.patient_id)),
    'completedToday', (select count(*) from appointments a where a.date = t and a.status = 'completed' and (p_branch is null or a.branch_id = p_branch) and can_see_patient(a.patient_id)),
    'totalPatients', (select count(*) from patients pt where not pt.is_guest and pt.active and can_see_patient(pt.id)),
    'newPatientsMonth', (select count(*) from patients pt where not pt.is_guest and pt.registered_at >= m and can_see_patient(pt.id)),
    'monthRevenue', case when fin then
        (select coalesce(sum(pay.amount), 0) from payments pay left join invoices i on i.id = pay.invoice_id left join appointments a on a.id = i.appointment_id
         where pay.voided_at is null and (pay.date at time zone 'Africa/Cairo')::date >= m and (p_branch is null or a.branch_id = p_branch)) else null end,
    'outstanding', case when fin then
        (select coalesce(sum(i.remaining), 0) from invoices i left join appointments a on a.id = i.appointment_id
         where i.status in ('due','partial') and (p_branch is null or a.branch_id = p_branch)) else null end,
    'draftPlanInvoices', case when has_perm('invoices','view') then (select count(*) from invoices where status = 'draft') else 0 end,
    'unreadNotifications', (select count(*) from notifications where audience = 'staff' and not read),
    'pendingRequests', case when has_perm('requests','edit') then (select count(*) from staff_requests where status = 'pending') else 0 end,
    'openTickets', case when has_perm('support','view') then (select count(*) from support_tickets where status in ('open','in_progress')) else 0 end
  ) into res;
  return res;
end $function$;

CREATE OR REPLACE FUNCTION public.report_summary(p_from date, p_to date, p_branch uuid DEFAULT NULL::uuid, p_therapist uuid DEFAULT NULL::uuid, p_group text DEFAULT 'day'::text, p_service text DEFAULT NULL::text)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare res jsonb; g text := case when p_group in ('day','week','month') then p_group else 'day' end; fin boolean := has_perm('financial','view');
begin
  perform require_perm('reports', 'view');
  if p_from is null or p_to is null or p_from > p_to then raise exception 'تحقق من فترة التقرير'; end if;
  with appts as (
    select a.* from appointments a
    where a.date between p_from and p_to and (p_branch is null or a.branch_id = p_branch) and (p_therapist is null or a.therapist_id = p_therapist)
      and (p_service is null or a.service_id = p_service) and can_see_patient(a.patient_id)
  ), pays as (
    select pay.*, a.branch_id, a.therapist_id, a.service_id from payments pay
    join invoices i on i.id = pay.invoice_id left join appointments a on a.id = i.appointment_id
    where pay.voided_at is null and (pay.date at time zone 'Africa/Cairo')::date between p_from and p_to
      and (p_branch is null or a.branch_id = p_branch) and (p_therapist is null or a.therapist_id = p_therapist) and (p_service is null or a.service_id = p_service)
  ), invs as (
    select i.*, a.branch_id, a.therapist_id, a.service_id from invoices i left join appointments a on a.id = i.appointment_id
    where i.date between p_from and p_to and i.status not in ('cancelled','draft')
      and (p_branch is null or a.branch_id = p_branch) and (p_therapist is null or a.therapist_id = p_therapist) and (p_service is null or a.service_id = p_service)
  )
  select jsonb_build_object(
    'financial', fin,
    'revenue', case when fin then (select coalesce(sum(amount), 0) from pays) end,
    'paymentsCount', case when fin then (select count(*) from pays) end,
    'paymentsByMethod', case when fin then (select coalesce(jsonb_object_agg(method, total), '{}') from (select method, sum(amount) total from pays group by method) x) end,
    'invoiced', case when fin then (select coalesce(sum(total), 0) from invs) end,
    'discounts', case when fin then (select coalesce(sum(discount), 0) from invs) end,
    'tax', case when fin then (select coalesce(sum(tax_amount), 0) from invs) end,
    'outstanding', case when fin then (select coalesce(sum(remaining), 0) from invoices i left join appointments a on a.id = i.appointment_id
                    where i.status in ('due','partial') and (p_branch is null or a.branch_id = p_branch) and (p_therapist is null or a.therapist_id = p_therapist) and (p_service is null or a.service_id = p_service)) end,
    'newPatients', (select count(*) from patients where not is_guest and (registered_at at time zone 'Africa/Cairo')::date between p_from and p_to and can_see_patient(id)),
    'totalPatients', (select count(*) from patients where not is_guest and active and can_see_patient(id)),
    'appointments', (select count(*) from appts),
    'appointmentsByStatus', (select coalesce(jsonb_object_agg(status, n), '{}') from (select status, count(*) n from appts group by status) x),
    'patientsBySource', (select coalesce(jsonb_agg(x order by x.n desc), '[]') from (
        select referral_source source, count(*) n from patients where not is_guest and (registered_at at time zone 'Africa/Cairo')::date between p_from and p_to and can_see_patient(id) group by 1) x),
    'patientsByDoctor', (select coalesce(jsonb_agg(x order by x.patients desc), '[]') from (
        select t.id, t.name, count(distinct a.patient_id) patients, count(a.id) visits from therapists t join appts a on a.therapist_id = t.id group by t.id, t.name) x),
    'therapists', (select coalesce(jsonb_agg(x order by x.completed desc), '[]') from (
        select t.id, t.name, count(a.id) appointments, count(a.id) filter (where a.status = 'completed') completed,
               count(a.id) filter (where a.status = 'no_show') no_show, count(a.id) filter (where a.status = 'cancelled') cancelled,
               count(distinct a.patient_id) patients,
               case when fin then coalesce((select sum(p2.amount) from pays p2 where p2.therapist_id = t.id), 0) end revenue
        from therapists t left join appts a on a.therapist_id = t.id
        where p_therapist is null or t.id = p_therapist
        group by t.id, t.name) x),
    'services', (select coalesce(jsonb_agg(x order by x.count desc), '[]') from (
        select s.id, s.name, count(a.id) count, count(a.id) filter (where a.status = 'completed') completed,
               case when fin then coalesce((select sum(p2.amount) from pays p2 where p2.service_id = s.id), 0) end revenue
        from services s join appts a on a.service_id = s.id group by s.id, s.name) x),
    'branches', (select coalesce(jsonb_agg(x), '[]') from (
        select b.id, b.name, (select count(*) from appts a where a.branch_id = b.id) appointments,
               case when fin then (select coalesce(sum(amount), 0) from pays p2 where p2.branch_id = b.id) end revenue
        from branches b where p_branch is null or b.id = p_branch) x),
    'series', (select coalesce(jsonb_agg(x order by x.period), '[]') from (
        select to_char(date_trunc(g, d)::date, 'YYYY-MM-DD') period,
               (select count(*) from appts a where date_trunc(g, a.date) = date_trunc(g, d)) appointments,
               case when fin then (select coalesce(sum(amount), 0) from pays p2 where date_trunc(g, (p2.date at time zone 'Africa/Cairo')::date) = date_trunc(g, d)) end revenue
        from generate_series(date_trunc(g, p_from)::date, p_to, ('1 ' || g)::interval) d) x)
  ) into res;
  return res;
end $function$;

