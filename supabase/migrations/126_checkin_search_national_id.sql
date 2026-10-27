-- 126: البحث في «حضور مرضى الباقات» برقم الهوية (السعودي) أو الإقامة (غير السعودي) — زي list_patients و global_search.
CREATE OR REPLACE FUNCTION public.package_attendance_list(p_q text DEFAULT ''::text)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare pat text; res jsonb; q text := trim(coalesce(p_q, ''));
begin
  perform require_perm('appointments', 'view');
  pat := '%' || replace(replace(replace(q, '\', '\\'), '%', '\%'), '_', '\_') || '%';
  select coalesce(jsonb_agg(r order by (r->>'expiresAt') nulls last), '[]') into res from (
    -- 1) الباقات (packages)
    select jsonb_build_object(
      'source', 'package', 'packageId', k.id, 'patientId', p.id, 'name', p.full_name, 'phone', p.phone, 'fileNo', p.file_no,
      'packageName', k.name, 'status', k.status, 'total', k.total_sessions, 'used', k.used_sessions,
      'pending', pend.n, 'remaining', greatest(k.total_sessions - k.used_sessions - pend.n, 0), 'nextNo', least(k.used_sessions + pend.n + 1, k.total_sessions),
      'startDate', k.start_date, 'expiry', k.expiry_date,
      'expiresAt', case when k.expiry_date is null then null else to_char(((k.expiry_date::timestamp + time '23:59:59') at time zone 'Africa/Cairo') at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS"Z"') end,
      'serverNow', to_char(now() at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS"Z"'), 'defaultDoctorId', null,
      'today', (select jsonb_build_object('appointmentId', a.id, 'no', a.no, 'time', a.time, 'status', a.status, 'service', (select name from services where id = a.service_id),
                  'doctor', (select name from therapists where id = a.therapist_id), 'checkedIn', c.id is not null, 'checkinAt', c.created_at, 'sessionNo', c.session_no)
                from appointments a left join package_checkins c on c.appointment_id = a.id
                where a.patient_id = p.id and a.date = riyadh_today() and a.status not in ('cancelled', 'no_show')
                  and (a.package_id = k.id or (a.package_id is null and a.plan_id is null and (coalesce(array_length(k.service_ids, 1), 0) = 0 or a.service_id = any(k.service_ids))))
                order by (c.id is not null) desc, a.time limit 1)
    ) as r
    from packages k join patients p on p.id = k.patient_id
    cross join lateral (select count(*)::int n from appointments x where x.package_id = k.id and x.status in ('arrived', 'in_progress')) pend
    where not p.is_guest and can_see_patient(p.id)
      and (k.status = 'active' or (k.status = 'expired' and k.expiry_date >= riyadh_today() - 60) or (q <> '' and k.status = 'completed'))
      and (q = '' or p.full_name ilike pat or p.phone like pat or phone_digits_match(p.phone, q) or p.file_no ilike pat or p.national_id like pat)
    union all
    -- 2) الخطط العلاجية (treatment_plans) — هي «الباقات» الفعلية: total_sessions، الجلسات المنتهية من treatment_sessions، التاريخ من start/end
    select jsonb_build_object(
      'source', 'plan', 'packageId', pl.id, 'patientId', p.id, 'name', p.full_name, 'phone', p.phone, 'fileNo', p.file_no,
      'packageName', 'خطة علاج ' || pl.total_sessions || ' جلسات' || case when coalesce(pl.diagnosis, '') <> '' then ' — ' || pl.diagnosis else '' end,
      'status', pl.status, 'total', pl.total_sessions, 'used', done.n,
      'pending', pend.n, 'remaining', greatest(pl.total_sessions - done.n - pend.n, 0), 'nextNo', least(done.n + pend.n + 1, pl.total_sessions),
      'startDate', pl.start_date, 'expiry', pl.end_date,
      'expiresAt', case when pl.end_date is null then null else to_char(((pl.end_date::timestamp + time '23:59:59') at time zone 'Africa/Cairo') at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS"Z"') end,
      'serverNow', to_char(now() at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS"Z"'), 'defaultDoctorId', pl.therapist_id,
      'today', (select jsonb_build_object('appointmentId', a.id, 'no', a.no, 'time', a.time, 'status', a.status, 'service', (select name from services where id = a.service_id),
                  'doctor', (select name from therapists where id = a.therapist_id), 'checkedIn', c.id is not null, 'checkinAt', c.created_at, 'sessionNo', c.session_no)
                from appointments a left join package_checkins c on c.appointment_id = a.id
                where a.patient_id = p.id and a.date = riyadh_today() and a.status not in ('cancelled', 'no_show') and a.plan_id = pl.id
                order by (c.id is not null) desc, a.time limit 1)
    ) as r
    from treatment_plans pl join patients p on p.id = pl.patient_id
    cross join lateral (select count(*)::int n from treatment_sessions s where s.plan_id = pl.id and s.status = 'completed') done
    cross join lateral (select count(*)::int n from appointments x where x.plan_id = pl.id and x.status in ('arrived', 'in_progress')) pend
    where not p.is_guest and can_see_patient(p.id)
      and (pl.status = 'active' or (pl.status = 'completed' and (q <> '' or coalesce(pl.updated_at, pl.created_at) > now() - interval '45 days')))
      and (q = '' or p.full_name ilike pat or p.phone like pat or phone_digits_match(p.phone, q) or p.file_no ilike pat or p.national_id like pat)
    limit 500
  ) x;
  return res;
end $function$;
