-- 124: «تسجيل حضور» من «حضور مرضى الباقات» (زيارة مباشرة) مابقاش يرفض لو الدكتور عنده موعد في نفس الوقت.
-- الحضور بيفعّل app.allow_overlap محليًا في نفس المعاملة بس، فالحجز العادي لسه بيمنع التعارض زي ما هو.
CREATE OR REPLACE FUNCTION public.appointments_no_overlap()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
begin
  if new.therapist_id is null or new.status = 'cancelled' then return new; end if;
  if current_setting('app.allow_overlap', true) = 'on' then return new; end if; -- حضور مباشر من «حضور مرضى الباقات»
  perform pg_advisory_xact_lock(hashtext(new.therapist_id::text || new.date::text));
  if exists (select 1 from appointments a where a.therapist_id = new.therapist_id and a.date = new.date and a.status <> 'cancelled' and a.id is distinct from new.id
             and new.time::time < a.time::time + make_interval(mins => a.duration_min) and a.time::time < new.time::time + make_interval(mins => new.duration_min)) then
    raise exception 'عذرًا، هذا الموعد تم حجزه للتو. يرجى اختيار موعد آخر.';
  end if;
  return new;
end $function$
;

CREATE OR REPLACE FUNCTION public.attendance_check_in(p_source text, p_id uuid, p_appointment uuid DEFAULT NULL::uuid, p_therapist uuid DEFAULT NULL::uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
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
    -- حضور الباقة/الخطة بيتسجّل حتى لو الدكتور عنده موعد في نفس الوقت (طلب الإدارة 2026-10-13)
    perform set_config('app.allow_overlap', 'on', true);
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
  if p_source = 'plan' then perform attendance_plan_session(a.id, p_id, v_no); end if; -- الحضور بيتسجّل جلسة في الخطة العلاجية
  perform log_action('تسجيل حضور — ' || v_name || ' (الجلسة ' || v_no || ' من ' || v_total || ')' || case when walk then ' — زيارة مباشرة' else '' end, v_patient);
  return jsonb_build_object('id', v_id, 'sessionNo', v_no, 'total', v_total, 'remaining', greatest(v_total - v_used - pend - 1, 0), 'walkIn', walk);
end $function$
;
