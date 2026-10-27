-- حضور مرضى الباقات: السبب الجذري إن «الباقات» الفعلية في المركز (عروض 4 جلسات 796 / 6 جلسات 1096) متسجّلة كـ«خطط علاجية» (treatment_plans)
-- وجدول packages فاضي — فالصفحة كانت بتقرا جدول فاضي. دلوقتي المصدر = الباقات (packages) + الخطط العلاجية (treatment_plans) مع بعض،
-- وتسجيل الحضور مايحتاجش موعد: لو مفيش موعد اليوم بيتعمل موعد زيارة مباشرة (Walk-in) بالدكتور المختار.

alter table package_checkins alter column package_id drop not null;
alter table package_checkins add column if not exists plan_id uuid references treatment_plans(id) on delete cascade;
do $$ begin
  if not exists (select 1 from pg_constraint where conname = 'package_checkins_src_chk') then
    alter table package_checkins add constraint package_checkins_src_chk check (package_id is not null or plan_id is not null);
  end if;
end $$;
create index if not exists idx_package_checkins_plan on package_checkins (plan_id, created_at desc);

-- ===== القائمة: كل الباقات الفعّالة + كل الخطط العلاجية الفعّالة (بدون أي شرط موعد اليوم) =====
create or replace function package_attendance_list(p_q text default '') returns jsonb
language plpgsql stable security definer set search_path = public as $$
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
      and (q = '' or p.full_name ilike pat or p.phone like pat or phone_digits_match(p.phone, q) or p.file_no ilike pat)
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
      and (q = '' or p.full_name ilike pat or p.phone like pat or phone_digits_match(p.phone, q) or p.file_no ilike pat)
    limit 500
  ) x;
  return res;
end $$;
revoke execute on function package_attendance_list(text) from public, anon;
grant execute on function package_attendance_list(text) to authenticated;

-- ===== تسجيل الحضور (باقة أو خطة) — من غير شرط موعد: لو مفيش موعد اليوم بيتعمل موعد زيارة مباشرة بالدكتور =====
create or replace function attendance_check_in(p_source text, p_id uuid, p_appointment uuid default null, p_therapist uuid default null) returns jsonb
language plpgsql security definer set search_path = public as $$
declare emp uuid; v_patient uuid; v_total int; v_used int; v_status text; v_expiry date; v_service text; v_default_th uuid; v_name text; v_svc_ids text[];
  pend int; a appointments; v_no int; v_id uuid; svc services; th uuid; walk boolean := false; v_price numeric; pkg packages; pln treatment_plans; v_plan_price numeric := 0;
begin
  emp := require_perm('appointments', 'edit');
  if p_source = 'package' then
    select * into pkg from packages where id = p_id for update;
    if pkg.id is null then raise exception 'الباقة غير موجودة'; end if;
    v_patient := pkg.patient_id; v_total := pkg.total_sessions; v_used := pkg.used_sessions; v_status := pkg.status; v_expiry := pkg.expiry_date;
    v_svc_ids := pkg.service_ids; v_service := coalesce(v_svc_ids[1], (select id from services where active order by price limit 1)); v_name := pkg.name;
  elsif p_source = 'plan' then
    select * into pln from treatment_plans where id = p_id for update;
    if pln.id is null then raise exception 'الخطة العلاجية غير موجودة'; end if;
    v_patient := pln.patient_id; v_total := pln.total_sessions; v_status := pln.status; v_expiry := pln.end_date; v_default_th := pln.therapist_id; v_service := pln.service_id; v_plan_price := coalesce(pln.price, 0);
    v_name := 'خطة علاج ' || pln.total_sessions || ' جلسات';
    select count(*)::int into v_used from treatment_sessions where plan_id = pln.id and status = 'completed';
  else raise exception 'نوع غير معروف'; end if;
  if not can_see_patient(v_patient) then raise exception 'لا توجد صلاحية على ملف هذا المريض' using errcode = '42501'; end if;
  if v_status <> 'active' then raise exception 'الباقة/الخطة غير فعّالة (%)', v_status; end if;
  if v_expiry is not null and v_expiry < riyadh_today() then raise exception 'الباقة/الخطة منتهية الصلاحية بتاريخ %', v_expiry; end if;
  select count(*)::int into pend from appointments x where x.status in ('arrived', 'in_progress') and ((p_source = 'package' and x.package_id = p_id) or (p_source = 'plan' and x.plan_id = p_id));
  if v_used + pend >= v_total then raise exception 'اكتملت جلسات الباقة — لا توجد جلسات متبقية'; end if;
  if exists (select 1 from package_checkins c where ((p_source = 'package' and c.package_id = p_id) or (p_source = 'plan' and c.plan_id = p_id)) and (c.created_at at time zone 'Africa/Cairo')::date = riyadh_today())
  then raise exception 'تم تسجيل حضور هذا المريض على هذه الباقة اليوم من قبل'; end if;

  -- الموعد: اللي اتحدد، أو موعد اليوم المرتبط، وإلا زيارة مباشرة
  if p_appointment is not null then
    select * into a from appointments where id = p_appointment for update;
    if a.id is null or a.patient_id <> v_patient then raise exception 'الموعد غير موجود لهذا المريض'; end if;
  else
    select * into a from appointments x where x.patient_id = v_patient and x.date = riyadh_today() and x.status in ('new', 'confirmed', 'rescheduled', 'on_way')
      and ((p_source = 'package' and (x.package_id = p_id or (x.package_id is null and x.plan_id is null))) or (p_source = 'plan' and x.plan_id = p_id)) order by x.time limit 1 for update;
  end if;
  if a.id is not null then
    if a.status in ('cancelled', 'completed', 'no_show') then raise exception 'لا يمكن تسجيل حضور موعد بحالته الحالية'; end if;
    if a.status in ('arrived', 'in_progress') or exists (select 1 from package_checkins where appointment_id = a.id) then raise exception 'تم تسجيل حضور هذا الموعد من قبل'; end if;
    if a.date <> riyadh_today() then raise exception 'الحضور يُسجَّل في يوم الموعد فقط (موعد هذا الحجز %)', a.date; end if;
    if a.therapist_id is null then
      th := coalesce(p_therapist, v_default_th);
      if th is null then raise exception 'اختر الدكتور قبل تسجيل الحضور'; end if;
      perform assert_booking_doctor(th, a.service_id, null);
      update appointments set therapist_id = th where id = a.id; a.therapist_id := th;
    end if;
    if p_source = 'package' and a.package_id is null then update appointments set package_id = p_id where id = a.id; end if;
    if p_source = 'plan' and a.plan_id is null then update appointments set plan_id = p_id where id = a.id; end if;
  else
    -- زيارة مباشرة (Walk-in): موعد جديد بالوقت الحالي بتوقيت القاهرة
    walk := true;
    th := coalesce(p_therapist, v_default_th);
    if th is null then raise exception 'اختر الدكتور — مفيش موعد اليوم والحضور هيتسجّل كزيارة مباشرة'; end if;
    select * into svc from services where id = v_service and active;
    if svc.id is null then select * into svc from services where active order by price limit 1; end if;
    if svc.id is null then raise exception 'لا توجد خدمة فعّالة لتسجيل الزيارة'; end if;
    perform assert_booking_doctor(th, svc.id, null);
    v_price := effective_price(svc.id, th, null);
    insert into appointments (no, patient_id, type, service_id, therapist_id, location, address, date, time, duration_min, status, price, package_id, plan_id, branch_id, created_by, notes)
    values (next_counter('appointment', 'MV-'), v_patient, 'session', svc.id, th, 'center', '', riyadh_today(), to_char(now() at time zone 'Africa/Cairo', 'HH24:MI'), svc.duration_min, 'new',
            case when v_plan_price > 0 or p_source = 'package' then 0 else v_price end,
            case when p_source = 'package' then p_id else null end, case when p_source = 'plan' then p_id else null end,
            coalesce((select branch_id from therapists where id = th), (select id from branches order by created_at limit 1)), my_employee_id(), 'زيارة مباشرة — حضور باقة')
    returning * into a;
    if p_source = 'plan' and v_plan_price = 0 then perform new_invoice(v_patient, svc.name, v_price, 'due', riyadh_today(), a.id, null, null, svc.id); end if;
  end if;

  v_no := v_used + pend + 1; -- رقم الجلسة محسوب من السجل الفعلي
  insert into package_checkins (package_id, plan_id, patient_id, appointment_id, checked_in_by, session_no)
  values (case when p_source = 'package' then p_id end, case when p_source = 'plan' then p_id end, v_patient, a.id, emp, v_no) returning id into v_id;
  perform set_appointment_status(a.id, 'arrived', null, null);
  perform log_action('تسجيل حضور — ' || v_name || ' (الجلسة ' || v_no || ' من ' || v_total || ')' || case when walk then ' — زيارة مباشرة' else '' end, v_patient);
  return jsonb_build_object('id', v_id, 'sessionNo', v_no, 'total', v_total, 'remaining', greatest(v_total - v_used - pend - 1, 0), 'walkIn', walk);
end $$;
revoke execute on function attendance_check_in(text, uuid, uuid, uuid) from public, anon;
grant execute on function attendance_check_in(text, uuid, uuid, uuid) to authenticated;

-- ===== سجل الجلسات (باقة أو خطة) =====
create or replace function attendance_session_log(p_source text, p_id uuid) returns jsonb
language plpgsql stable security definer set search_path = public as $$
declare v_patient uuid; v_name text; v_status text; v_total int; v_used int; v_start date; v_expiry date; pend int; logs jsonb; pkg packages; pln treatment_plans;
begin
  perform require_perm('appointments', 'view');
  if p_source = 'package' then
    select * into pkg from packages where id = p_id;
    if pkg.id is null then raise exception 'الباقة غير موجودة'; end if;
    v_patient := pkg.patient_id; v_name := pkg.name; v_status := pkg.status; v_total := pkg.total_sessions; v_used := pkg.used_sessions; v_start := pkg.start_date; v_expiry := pkg.expiry_date;
  else
    select * into pln from treatment_plans where id = p_id;
    if pln.id is null then raise exception 'الخطة العلاجية غير موجودة'; end if;
    v_patient := pln.patient_id; v_name := 'خطة علاج ' || pln.total_sessions || ' جلسات'; v_status := pln.status; v_total := pln.total_sessions; v_start := pln.start_date; v_expiry := pln.end_date;
    select count(*)::int into v_used from treatment_sessions where plan_id = pln.id and status = 'completed';
  end if;
  if not can_see_patient(v_patient) then raise exception 'لا توجد صلاحية على ملف هذا المريض' using errcode = '42501'; end if;
  select count(*)::int into pend from appointments x where x.status in ('arrived', 'in_progress') and ((p_source = 'package' and x.package_id = p_id) or (p_source <> 'package' and x.plan_id = p_id));
  select coalesce(jsonb_agg(jsonb_build_object('no', rn, 'date', date, 'time', time, 'status', status, 'doctor', doctor) order by rn), '[]') into logs from (
    select row_number() over (order by a.date, a.time) rn, a.date, a.time, a.status, (select name from therapists where id = a.therapist_id) doctor
    from appointments a where a.status in ('arrived', 'in_progress', 'completed') and ((p_source = 'package' and a.package_id = p_id) or (p_source <> 'package' and a.plan_id = p_id))) z;
  return jsonb_build_object('name', v_name, 'status', v_status, 'total', v_total, 'used', v_used, 'pending', pend, 'remaining', greatest(v_total - v_used - pend, 0), 'startDate', v_start, 'expiry', v_expiry, 'sessions', logs);
end $$;
revoke execute on function attendance_session_log(text, uuid) from public, anon;
grant execute on function attendance_session_log(text, uuid) to authenticated;

-- ===== اكتمال (باقة أو خطة) =====
create or replace function attendance_complete(p_source text, p_id uuid) returns jsonb
language plpgsql security definer set search_path = public as $$
declare pl treatment_plans; open_appts int;
begin
  if p_source = 'package' then return package_complete(p_id); end if;
  perform require_perm('plans', 'edit');
  select * into pl from treatment_plans where id = p_id for update;
  if pl.id is null or not can_see_patient(pl.patient_id) then raise exception 'الخطة العلاجية غير موجودة'; end if;
  if pl.status <> 'active' then raise exception 'الخطة مش فعّالة (%) — مفيش حاجة تتكمّل', pl.status; end if;
  update treatment_plans set status = 'completed', progress_pct = 100 where id = pl.id;
  perform notify_patient(pl.patient_id, 'plan_completed', 'اكتملت خطتك العلاجية 🎉', 'تم إكمال خطتك العلاجية — نتمنى لك دوام الصحة', pl.id::text);
  select count(*)::int into open_appts from appointments where plan_id = pl.id and status in ('new', 'confirmed', 'rescheduled') and date >= riyadh_today();
  perform log_action('اكتمال الخطة العلاجية (' || pl.total_sessions || ' جلسات)', pl.patient_id);
  return jsonb_build_object('plansCompleted', 1, 'openAppointments', open_appts);
end $$;
revoke execute on function attendance_complete(text, uuid) from public, anon;
grant execute on function attendance_complete(text, uuid) to authenticated;
