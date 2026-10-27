-- حضور مرضى الباقات (شاشة الاستقبال): رقم الجلسة من السجل + منع حضورين لنفس الباقة في اليوم + قائمة وسجل الجلسات

alter table package_checkins add column if not exists session_no int;

-- كل باقات المرضى (فعّالة + المنتهية حديثًا) بصف لكل باقة: الجلسات، مواعيد الانتهاء الحقيقية، وحالة اليوم (موعد/حضور)
create or replace function package_attendance_list(p_q text default '') returns jsonb
language plpgsql stable security definer set search_path = public as $$
declare pat text; res jsonb; q text := trim(coalesce(p_q, ''));
begin
  perform require_perm('appointments', 'view');
  pat := '%' || replace(replace(replace(q, '', '\'), '%', '%'), '_', '_') || '%';
  select coalesce(jsonb_agg(r order by (r->>'expiresAt')), '[]') into res from (
    select jsonb_build_object(
      'packageId', k.id, 'patientId', p.id, 'name', p.full_name, 'phone', p.phone, 'fileNo', p.file_no,
      'packageName', k.name, 'status', k.status, 'total', k.total_sessions, 'used', k.used_sessions,
      'pending', pend.n, 'remaining', greatest(k.total_sessions - k.used_sessions - pend.n, 0), 'nextNo', least(k.used_sessions + pend.n + 1, k.total_sessions),
      'startDate', k.start_date, 'expiry', k.expiry_date,
      'expiresAt', case when k.expiry_date is null then null else to_char(((k.expiry_date::timestamp + time '23:59:59') at time zone 'Africa/Cairo') at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS"Z"') end,
      'serverNow', to_char(now() at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS"Z"'),
      'today', (select jsonb_build_object('appointmentId', a.id, 'no', a.no, 'time', a.time, 'status', a.status, 'service', (select name from services where id = a.service_id),
                  'doctor', (select name from therapists where id = a.therapist_id), 'checkedIn', c.id is not null, 'checkinAt', c.created_at, 'sessionNo', c.session_no)
                from appointments a left join package_checkins c on c.appointment_id = a.id
                where a.patient_id = p.id and a.date = riyadh_today() and a.status not in ('cancelled', 'no_show')
                  and (a.package_id = k.id or (a.package_id is null and (coalesce(array_length(k.service_ids, 1), 0) = 0 or a.service_id = any(k.service_ids))))
                order by (c.id is not null) desc, a.time limit 1)
    ) as r
    from packages k join patients p on p.id = k.patient_id
    cross join lateral (select count(*)::int n from appointments x where x.package_id = k.id and x.status in ('arrived', 'in_progress')) pend
    where not p.is_guest and can_see_patient(p.id)
      and (k.status = 'active' or (k.status = 'expired' and k.expiry_date >= riyadh_today() - 60) or (q <> '' and k.status = 'completed'))
      and (q = '' or p.full_name ilike pat or p.phone like pat or phone_digits_match(p.phone, q) or p.file_no ilike pat)
    limit 500
  ) x;
  return res;
end $$;
revoke execute on function package_attendance_list(text) from public, anon;
grant execute on function package_attendance_list(text) to authenticated;

-- سجل جلسات الباقة: الجلسات اللي حضرت/اتنفذت فعليًا بالترتيب (من المواعيد المرتبطة بالباقة) + الباقي «لم تستخدم»
create or replace function package_session_log(p_package uuid) returns jsonb
language plpgsql stable security definer set search_path = public as $$
declare pk packages; pend int; logs jsonb;
begin
  perform require_perm('appointments', 'view');
  select * into pk from packages where id = p_package;
  if pk.id is null or not can_see_patient(pk.patient_id) then raise exception 'الباقة غير موجودة'; end if;
  select count(*)::int into pend from appointments x where x.package_id = pk.id and x.status in ('arrived', 'in_progress');
  select coalesce(jsonb_agg(jsonb_build_object('no', rn, 'date', date, 'time', time, 'status', status, 'doctor', doctor, 'checkinAt', checkin_at) order by rn), '[]') into logs from (
    select row_number() over (order by a.date, a.time) rn, a.date, a.time, a.status, (select name from therapists where id = a.therapist_id) doctor, c.created_at checkin_at
    from appointments a left join package_checkins c on c.appointment_id = a.id
    where a.package_id = pk.id and a.status in ('arrived', 'in_progress', 'completed')) z;
  return jsonb_build_object('name', pk.name, 'status', pk.status, 'total', pk.total_sessions, 'used', pk.used_sessions, 'pending', pend,
    'remaining', greatest(pk.total_sessions - pk.used_sessions - pend, 0), 'startDate', pk.start_date, 'expiry', pk.expiry_date, 'sessions', logs);
end $$;
revoke execute on function package_session_log(uuid) from public, anon;
grant execute on function package_session_log(uuid) to authenticated;

create or replace function package_check_in(p_package uuid, p_appointment uuid) returns jsonb
language plpgsql security definer set search_path = public as $$
declare emp uuid; pk packages; a appointments; pend int; v_id uuid; v_no int;
begin
  emp := require_perm('appointments', 'edit');
  select * into pk from packages where id = p_package for update;
  if pk.id is null or not can_see_patient(pk.patient_id) then raise exception 'الباقة غير موجودة'; end if;
  select * into a from appointments where id = p_appointment for update;
  if a.id is null or a.patient_id <> pk.patient_id then raise exception 'الموعد غير موجود لهذا المريض'; end if;
  if pk.status <> 'active' then raise exception 'الباقة غير فعّالة (%)', pk.status; end if;
  if pk.expiry_date is not null and pk.expiry_date < riyadh_today() then raise exception 'الباقة منتهية الصلاحية بتاريخ %', pk.expiry_date; end if;
  if a.package_id is not null and a.package_id <> pk.id then raise exception 'هذا الموعد مرتبط بباقة أخرى'; end if;
  if coalesce(array_length(pk.service_ids, 1), 0) > 0 and not (a.service_id = any(pk.service_ids)) then raise exception 'خدمة الموعد غير مشمولة في هذه الباقة'; end if;
  if a.status in ('cancelled', 'completed', 'no_show') then raise exception 'لا يمكن تسجيل حضور موعد بحالته الحالية'; end if;
  if a.status in ('arrived', 'in_progress') or exists (select 1 from package_checkins where appointment_id = a.id) then raise exception 'تم تسجيل حضور هذا الموعد من قبل'; end if;
  if a.date <> riyadh_today() then raise exception 'الحضور يُسجَّل في يوم الموعد فقط (موعد هذا الحجز %)', a.date; end if;
  if a.therapist_id is null then raise exception 'اختر الدكتور للموعد قبل تسجيل الحضور'; end if;
  -- جلسات الباقة المتاحة = الإجمالي − المنتهية − اللي حضرت ولسه ماخلصتش
  select count(*) into pend from appointments x where x.package_id = pk.id and x.status in ('arrived', 'in_progress') and x.id <> a.id;
  if pk.used_sessions + pend >= pk.total_sessions then raise exception 'اكتملت جلسات الباقة — لا توجد جلسات متبقية'; end if;
  -- حضور واحد لكل باقة في اليوم (منع تسجيل جلسة تانية لنفس الحضور)
  if exists (select 1 from package_checkins c where c.package_id = pk.id and (c.created_at at time zone 'Africa/Cairo')::date = riyadh_today()) then raise exception 'تم تسجيل حضور هذا المريض على هذه الباقة اليوم من قبل'; end if;
  v_no := pk.used_sessions + pend + 1; -- رقم الجلسة محسوب من السجل الفعلي للباقة
  if a.package_id is null then update appointments set package_id = pk.id where id = a.id; end if;
  insert into package_checkins (package_id, patient_id, appointment_id, checked_in_by, session_no) values (pk.id, pk.patient_id, a.id, emp, v_no) returning id into v_id;
  perform set_appointment_status(a.id, 'arrived', null, null);
  perform log_action('تسجيل حضور مريض باقة — ' || pk.name || ' (الموعد ' || a.no || ')', pk.patient_id);
  return jsonb_build_object('id', v_id, 'sessionNo', v_no, 'total', pk.total_sessions, 'remaining', greatest(pk.total_sessions - pk.used_sessions - pend - 1, 0));
end $$;
revoke execute on function package_check_in(uuid, uuid) from public, anon;
grant execute on function package_check_in(uuid, uuid) to authenticated;
