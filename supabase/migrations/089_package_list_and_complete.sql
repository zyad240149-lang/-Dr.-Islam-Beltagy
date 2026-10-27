-- حضور الباقات: قائمة كل مرضى الباقات الفعّالة (مش بس اللي عندهم موعد اليوم) + اكتمال الباقة
create or replace function package_checkin_search(p_q text default '') returns jsonb
language plpgsql stable security definer set search_path = public as $$
declare pat text; res jsonb;
begin
  perform require_perm('appointments', 'view');
  pat := '%' || replace(replace(replace(trim(coalesce(p_q, '')), '\', '\\'), '%', '\%'), '_', '\_') || '%';
  select coalesce(jsonb_agg(r order by r->>'name'), '[]') into res from (
    select jsonb_build_object('patientId', p.id, 'name', p.full_name, 'phone', p.phone, 'fileNo', p.file_no,
      'packages', (select jsonb_agg(jsonb_build_object(
          'id', k.id, 'name', k.name, 'total', k.total_sessions, 'used', k.used_sessions,
          'pending', (select count(*) from appointments x where x.package_id = k.id and x.status in ('arrived', 'in_progress')),
          'expiry', k.expiry_date, 'expired', (k.expiry_date is not null and k.expiry_date < riyadh_today()),
          'appointments', coalesce((select jsonb_agg(jsonb_build_object('id', a.id, 'no', a.no, 'time', a.time, 'status', a.status, 'service', (select name from services where id = a.service_id),
                'doctor', (select name from therapists where id = a.therapist_id), 'checkedIn', exists (select 1 from package_checkins c where c.appointment_id = a.id)) order by a.time)
              from appointments a where a.patient_id = p.id and a.date = riyadh_today() and a.status not in ('cancelled', 'completed', 'no_show')
                and (a.package_id = k.id or (a.package_id is null and (coalesce(array_length(k.service_ids, 1), 0) = 0 or a.service_id = any(k.service_ids))))), '[]')
        ) order by k.start_date) from packages k where k.patient_id = p.id and k.status = 'active')) as r
    from patients p
    where not p.is_guest and can_see_patient(p.id)
      and exists (select 1 from packages k where k.patient_id = p.id and k.status = 'active')
      and (trim(coalesce(p_q, '')) = '' or p.full_name ilike pat or p.phone like pat or phone_digits_match(p.phone, p_q) or p.file_no ilike pat)
    limit 200
  ) q;
  return res;
end $$;
revoke execute on function package_checkin_search(text) from public, anon;
grant execute on function package_checkin_search(text) to authenticated;

-- اكتمال الباقة: بيقفل الباقة (completed) وبيكمّل الخطة العلاجية المرتبطة (من مواعيد الباقة، أو خطة المريض الوحيدة النشطة) — وبتظهر «مكتملة» في خطط العلاج
create or replace function package_complete(p_package uuid) returns jsonb
language plpgsql security definer set search_path = public as $$
declare pk packages; plan_ids uuid[]; n_plans int := 0; open_appts int; pid uuid;
begin
  perform require_perm('packages', 'edit');
  select * into pk from packages where id = p_package for update;
  if pk.id is null or not can_see_patient(pk.patient_id) then raise exception 'الباقة غير موجودة'; end if;
  if pk.status <> 'active' then raise exception 'الباقة مش فعّالة (%) — مفيش حاجة تتكمّل', pk.status; end if;
  update packages set status = 'completed' where id = pk.id;
  select coalesce(array_agg(distinct a.plan_id), '{}') into plan_ids from appointments a where a.package_id = pk.id and a.plan_id is not null;
  if coalesce(array_length(plan_ids, 1), 0) = 0 then
    select coalesce(array_agg(id), '{}') into plan_ids from treatment_plans where patient_id = pk.patient_id and status = 'active';
    if coalesce(array_length(plan_ids, 1), 0) > 1 then plan_ids := '{}'; end if; -- أكتر من خطة نشطة من غير ربط واضح: ماينفعش نخمّن
  end if;
  foreach pid in array plan_ids loop
    update treatment_plans set status = 'completed', progress_pct = 100 where id = pid and patient_id = pk.patient_id and status = 'active';
    if found then
      n_plans := n_plans + 1;
      perform notify_patient(pk.patient_id, 'plan_completed', 'اكتملت خطتك العلاجية 🎉', 'تم إكمال باقتك «' || pk.name || '» — نتمنى لك دوام الصحة', pid::text);
    end if;
  end loop;
  select count(*) into open_appts from appointments where package_id = pk.id and status in ('new', 'confirmed', 'rescheduled') and date >= riyadh_today();
  perform log_action('اكتمال الباقة «' || pk.name || '» (' || pk.used_sessions || ' من ' || pk.total_sessions || ' جلسة)', pk.patient_id);
  return jsonb_build_object('plansCompleted', n_plans, 'openAppointments', open_appts, 'remainingSessions', greatest(pk.total_sessions - pk.used_sessions, 0));
end $$;
revoke execute on function package_complete(uuid) from public, anon;
grant execute on function package_complete(uuid) to authenticated;
