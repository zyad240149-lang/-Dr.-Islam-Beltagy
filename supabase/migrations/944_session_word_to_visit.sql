-- 944: كلمة «جلسة» بقت «زيارة» في رسايل دوال الخادم والإشعارات الجديدة. الأسماء الداخلية والبيانات المتسجلة ما اتغيرتش.
update notification_kinds set label = replace(label, 'جلسة', 'زيارة'), push_title = replace(push_title, 'جلستك', 'زيارتك') where kind = 'session_completed';

CREATE OR REPLACE FUNCTION public.apply_discount_code(p_invoice uuid, p_code text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare inv invoices; dc discount_codes; amount numeric; t date := riyadh_today();
begin
  perform require_perm('invoices', 'edit');
  select * into inv from invoices where id = p_invoice for update;
  if inv.id is null then raise exception 'الفاتورة غير موجودة'; end if;
  if inv.status = 'cancelled' then raise exception 'الفاتورة ملغاة'; end if;
  if inv.discount_code is not null then raise exception 'تم تطبيق الكود % على هالفاتورة بالفعل', inv.discount_code; end if;
  select * into dc from discount_codes where id = find_discount_code(p_code) for update;
  if dc.id is null then raise exception 'كود الخصم غير صحيح'; end if;
  if dc.patient_id is not null and dc.patient_id <> inv.patient_id then raise exception 'هذا الكود خاص بمريض آخر ولا يمكن استخدامه هنا'; end if;
  if not dc.active then raise exception 'كود الخصم موقوف'; end if;
  if dc.used_count >= dc.max_uses then raise exception 'تم استهلاك كل مرات استخدام الكود'; end if;
  if t < dc.valid_from then raise exception 'الكود يبدأ من %', dc.valid_from; end if;
  if t > dc.valid_to then raise exception 'انتهت صلاحية الكود في %', dc.valid_to; end if;
  if inv.price < dc.min_amount then raise exception 'الكود يتطلب حدًّا أدنى للطلب % — قيمة الفاتورة %', dc.min_amount, inv.price; end if;
  amount := least(inv.price, case when dc.type = 'percent' then round(inv.price * dc.value / 100) else dc.value end);
  if inv.price - amount < inv.paid then raise exception 'الإجمالي بعد الخصم أقل من المدفوع فعلًا'; end if;
  update invoices set discount = amount, discount_code = dc.code, discount_code_id = dc.id,
    service_name = case when amount >= inv.price then 'زيارة مجانية - مكافأة ولاء' else service_name end
  where id = p_invoice;
  update discount_codes set used_count = used_count + 1 where id = dc.id;
  insert into coupon_usage (coupon_id, invoice_id, patient_id, amount, used_by) values (dc.id, p_invoice, inv.patient_id, amount, my_employee_id());
  perform recalc_invoice(p_invoice);
  perform log_action('تطبيق كود الخصم ' || dc.code || ' (' || amount || ' ج.م) على ' || inv.no, inv.patient_id);
  return jsonb_build_object('amount', amount);
end $function$;

CREATE OR REPLACE FUNCTION public.attendance_check_in(p_source text, p_id uuid, p_appointment uuid DEFAULT NULL::uuid, p_therapist uuid DEFAULT NULL::uuid, p_second boolean DEFAULT false)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare emp uuid; v_patient uuid; v_total int; v_used int; v_status text; v_expiry date; v_service text; v_default_th uuid; v_name text; v_svc_ids text[];
  pend int; a appointments; v_today int; v_last timestamptz; v_time time; v_no int; v_id uuid; svc services; th uuid; walk boolean := false; v_price numeric; pkg packages; pln treatment_plans; v_plan_price numeric := 0;
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
    v_name := 'خطة علاج ' || pln.total_sessions || ' زيارات';
    select count(*)::int into v_used from treatment_sessions where plan_id = pln.id and status = 'completed';
  else raise exception 'نوع غير معروف'; end if;
  if not can_see_patient(v_patient) then raise exception 'ما فيه صلاحية على ملف هذا المريض' using errcode = '42501'; end if;
  if v_status <> 'active' then raise exception 'الباقة/الخطة غير فعّالة (%)', pkg_status_ar(v_status); end if;
  if v_expiry is not null and v_expiry < riyadh_today() then raise exception 'الباقة/الخطة منتهية الصلاحية بتاريخ %', v_expiry; end if;
  select count(*)::int into pend from appointments x where x.status in ('arrived', 'in_progress') and ((p_source = 'package' and x.package_id = p_id) or (p_source = 'plan' and x.plan_id = p_id));
  if v_used + pend >= v_total then raise exception 'اكتملت زيارات الباقة — ما فيه زيارات متبقية'; end if;
  -- زيارة واحدة للمريض في اليوم (على أي خطة أو باقة، ومن أي شاشة)؛ التانية بموافقة المدير وبعد ساعة، وحد أقصى زيارتين
  v_today := patient_day_sessions(v_patient, riyadh_today(), null);
  v_last := patient_day_last(v_patient, riyadh_today());
  if v_today >= 2 then raise exception 'الحد الأقصى زيارتين في اليوم للمريض'; end if;
  if v_today = 1 and not coalesce(p_second, false) then raise exception 'المريض حضر زيارة اليوم بالفعل — لزيارة ثانية أرسل «طلب زيارة ثانية اليوم» إلى المدير'; end if;
  if v_today = 1 and not exists (select 1 from employees e where e.id = emp and e.role in ('system_admin', 'center_manager')) then
    raise exception 'الزيارة الثانية في اليوم نفسه تحتاج إلى موافقة المدير — أرسل «طلب زيارة ثانية اليوم»' using errcode = '42501'; end if;
  if v_today = 1 and v_last > now() - interval '60 minutes' then
    raise exception 'ما يمكن حجز زيارتين متتاليتين — الزيارة الثانية متاحة بعد % دقيقة', ceil(extract(epoch from (v_last + interval '60 minutes' - now())) / 60)::int; end if;
  if v_today = 1 then perform set_config('app.second_ok', 'on', true); end if;
  if v_today = 1 then p_appointment := null; end if; -- الزيارة التانية زيارة مباشرة أو موعد تاني اليوم

  -- الموعد: اللي اتحدد، أو موعد اليوم المرتبط، وإلا زيارة مباشرة
  if p_appointment is not null then
    select * into a from appointments where id = p_appointment for update;
    if a.id is null or a.patient_id <> v_patient then raise exception 'الموعد غير موجود لهذا المريض'; end if;
  else
    select * into a from appointments x where x.patient_id = v_patient and x.date = riyadh_today() and x.status in ('new', 'confirmed', 'rescheduled', 'on_way')
      and ((p_source = 'package' and (x.package_id = p_id or (x.package_id is null and x.plan_id is null))) or (p_source = 'plan' and x.plan_id = p_id)) order by x.time limit 1 for update;
    if a.id is null and p_source in ('plan', 'package') then
      v_id := plan_take_next_appointment(p_source, p_id);
      if v_id is not null then select * into a from appointments where id = v_id for update; v_id := null; end if;
    end if;
  end if;
  if a.id is not null then
    if a.status in ('cancelled', 'completed', 'no_show') then raise exception 'ما يمكن تسجيل حضور موعد بحالته الحالية'; end if;
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
    if th is null then raise exception 'اختر الدكتور — ما فيه موعد اليوم وسيُسجَّل الحضور كزيارة مباشرة'; end if;
    select * into svc from services where id = v_service and active;
    if svc.id is null then select * into svc from services where active order by price limit 1; end if;
    if svc.id is null then raise exception 'ما فيه خدمة فعّالة لتسجيل الزيارة'; end if;
    perform assert_booking_doctor(th, svc.id, null);
    v_price := effective_price(svc.id, th, null);
    -- حضور الباقة/الخطة بيتسجّل حتى لو الدكتور عنده موعد في نفس الوقت (طلب الإدارة 2026-10-13)
    perform set_config('app.allow_overlap', 'on', true);
    -- نفس الدقيقة محجوزة للدكتور (قيد uq_therapist_slot) → أول دقيقة فاضية بعدها
    v_time := (to_char(now() at time zone 'Africa/Cairo', 'HH24:MI'))::time;
    while exists (select 1 from appointments x where x.therapist_id = th and x.date = riyadh_today() and x.time = to_char(v_time, 'HH24:MI') and x.status not in ('cancelled', 'rescheduled')) loop
      v_time := v_time + interval '1 minute'; end loop;
    insert into appointments (no, patient_id, type, service_id, therapist_id, location, address, date, time, duration_min, status, price, package_id, plan_id, branch_id, created_by, notes)
    values (next_counter('appointment', 'MV-'), v_patient, 'session', svc.id, th, 'center', '', riyadh_today(), to_char(v_time, 'HH24:MI'), svc.duration_min, 'new',
            case when v_plan_price > 0 or p_source = 'package' then 0 else v_price end,
            case when p_source = 'package' then p_id else null end, case when p_source = 'plan' then p_id else null end,
            coalesce((select branch_id from therapists where id = th), (select id from branches order by created_at limit 1)), my_employee_id(), 'زيارة مباشرة — حضور باقة')
    returning * into a;
    if p_source = 'plan' and v_plan_price = 0 then perform new_invoice(v_patient, svc.name, v_price, 'due', riyadh_today(), a.id, null, null, svc.id); end if;
  end if;

  v_no := v_used + pend + 1; -- رقم الزيارة محسوب من السجل الفعلي
  insert into package_checkins (package_id, plan_id, patient_id, appointment_id, checked_in_by, session_no)
  values (case when p_source = 'package' then p_id end, case when p_source = 'plan' then p_id end, v_patient, a.id, emp, v_no) returning id into v_id;
  perform set_appointment_status(a.id, 'arrived', null, null);
  if p_source = 'plan' then perform attendance_plan_session(a.id, p_id, v_no); end if; -- الحضور بيتسجّل زيارة في الخطة العلاجية
  perform log_action('تسجيل حضور — ' || v_name || ' (الزيارة ' || v_no || ' من ' || v_total || ')' || case when walk then ' — زيارة مباشرة' else '' end, v_patient);
  return jsonb_build_object('id', v_id, 'sessionNo', v_no, 'total', v_total, 'remaining', greatest(v_total - v_used - pend - 1, 0), 'walkIn', walk);
end $function$;

CREATE OR REPLACE FUNCTION public.attendance_complete(p_source text, p_id uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare pl treatment_plans; open_appts int;
begin
  if p_source = 'package' then return package_complete(p_id); end if;
  perform require_perm('plans', 'edit');
  select * into pl from treatment_plans where id = p_id for update;
  if pl.id is null or not can_see_patient(pl.patient_id) then raise exception 'الخطة العلاجية غير موجودة'; end if;
  if pl.status <> 'active' then raise exception 'الخطة غير فعّالة (%) — ما فيه ما يمكن إكماله', pkg_status_ar(pl.status); end if;
  update treatment_plans set status = 'completed', progress_pct = 100 where id = pl.id;
  perform notify_patient(pl.patient_id, 'plan_completed', 'اكتملت خطتك العلاجية 🎉', 'تم إكمال خطتك العلاجية — نتمنى لك دوام الصحة', pl.id::text);
  select count(*)::int into open_appts from appointments where plan_id = pl.id and status in ('new', 'confirmed', 'rescheduled') and date >= riyadh_today();
  perform log_action('اكتمال الخطة العلاجية (' || pl.total_sessions || ' زيارات)', pl.patient_id);
  return jsonb_build_object('plansCompleted', 1, 'openAppointments', open_appts);
end $function$;

CREATE OR REPLACE FUNCTION public.attendance_plan_session(p_appt uuid, p_plan uuid, p_no integer)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare a appointments; s treatment_sessions; pts int;
begin
  select * into a from appointments where id = p_appt for update;
  select * into s from treatment_sessions where appointment_id = p_appt order by (status = 'completed') desc limit 1 for update;
  if s.id is not null and s.status = 'completed' then return; end if;
  if s.id is null then
    insert into treatment_sessions (appointment_id, patient_id, therapist_id, plan_id, session_no, date, status, started_at, completed_at)
    values (a.id, a.patient_id, a.therapist_id, p_plan, p_no, a.date, 'completed', now(), now()) returning * into s;
  else
    update treatment_sessions set status = 'completed', plan_id = coalesce(plan_id, p_plan), completed_at = now() where id = s.id returning * into s;
  end if;
  update appointments set status = 'completed', updated_at = now() where id = a.id;
  perform recalc_plan(p_plan);
  select loyalty_session_points into pts from center_info limit 1;
  perform award_loyalty_points(a.patient_id, 'session', coalesce(pts, 2), 'نقاط إتمام زيارة/كشف', 'session', s.id);
end $function$;

CREATE OR REPLACE FUNCTION public.attendance_session_log(p_source text, p_id uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
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
    v_patient := pln.patient_id; v_name := 'خطة علاج ' || pln.total_sessions || ' زيارات'; v_status := pln.status; v_total := pln.total_sessions; v_start := pln.start_date; v_expiry := pln.end_date;
    select count(*)::int into v_used from treatment_sessions where plan_id = pln.id and status = 'completed';
  end if;
  if not can_see_patient(v_patient) then raise exception 'ما فيه صلاحية على ملف هذا المريض' using errcode = '42501'; end if;
  select count(*)::int into pend from appointments x where x.status in ('arrived', 'in_progress') and ((p_source = 'package' and x.package_id = p_id) or (p_source <> 'package' and x.plan_id = p_id));
  select coalesce(jsonb_agg(jsonb_build_object('no', rn, 'date', date, 'time', time, 'status', status, 'doctor', doctor) order by rn), '[]') into logs from (
    select row_number() over (order by a.date, a.time) rn, a.date, a.time, a.status, (select name from therapists where id = a.therapist_id) doctor
    from appointments a where a.status in ('arrived', 'in_progress', 'completed') and ((p_source = 'package' and a.package_id = p_id) or (p_source <> 'package' and a.plan_id = p_id))) z;
  return jsonb_build_object('name', v_name, 'status', v_status, 'total', v_total, 'used', v_used, 'pending', pend, 'remaining', greatest(v_total - v_used - pend, 0), 'startDate', v_start, 'expiry', v_expiry, 'sessions', logs);
end $function$;

CREATE OR REPLACE FUNCTION public.book_appointment(p jsonb)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare v_dur int; svc services; pat patients; th uuid := _uuid(p, 'therapistId'); d date; tm text := _txt(p, 'time');
  loc text := _txt(p, 'location', 'center'); plan treatment_plans; pkg uuid := _uuid(p, 'packageId'); a appointments; v_price numeric; v_branch uuid;
begin
  perform require_any(array['booking:create', 'appointments:create']);
  if _uuid(p, 'patientId') is null and p ? 'guest' then pat := guest_patient(p->'guest');
  else select * into pat from patients where id = _uuid(p, 'patientId'); end if;
  if pat.id is null or not can_see_patient(pat.id) then raise exception 'اختر المريض'; end if;
  if not pat.active then raise exception 'ملف المريض غير نشط'; end if;
  select * into svc from services where id = _txt(p, 'serviceId');
  if svc.id is null or not svc.active then raise exception 'الخدمة غير موجودة أو موقوفة'; end if;
  -- الدكتور إجباري (لا يوجد «أي دكتور»): اتفحص قبل التاريخ/الوقت
  perform assert_booking_doctor(th, svc.id, _uuid(p, 'branchId'));
  d := nullif(p->>'date', '')::date;
  if d is null then raise exception 'اختر التاريخ'; end if;
  if loc not in ('center','home') then raise exception 'مكان الموعد غير صحيح'; end if;
  if loc = 'home' and _txt(p, 'address') = '' then raise exception 'أدخل عنوان الزيارة المنزلية'; end if;
  v_dur := coalesce(nullif(_num(p, 'durationMin', 0), 0)::int, svc.duration_min);
  if v_dur < 10 or v_dur > 240 then raise exception 'مدة الزيارة غير صحيحة'; end if;
  perform check_slot(th, d, tm, v_dur, null);
  v_price := effective_price(svc.id, th, _uuid(p, 'priceId'));
  v_branch := coalesce(_uuid(p, 'branchId'), (select branch_id from therapists where id = th), (select id from branches order by created_at limit 1));

  if pkg is not null and not exists (select 1 from packages where id = pkg and patient_id = pat.id and status = 'active' and used_sessions < total_sessions) then
    raise exception 'الباقة غير صالحة لهذا المريض';
  end if;
  if p ? 'planId' then select * into plan from treatment_plans where id = _uuid(p, 'planId') and patient_id = pat.id;
  else select * into plan from treatment_plans where patient_id = pat.id and status = 'active' and service_id = svc.id order by start_date desc limit 1; end if;

  insert into appointments (no, patient_id, type, service_id, therapist_id, location, address, date, time, duration_min, status, price,
                            package_id, plan_id, series_id, branch_id, created_by, notes)
  values (next_counter('appointment', 'MV-'), pat.id, case when loc = 'home' then 'home' else _txt(p, 'type', 'session') end, svc.id, th, loc,
          case when loc = 'home' then _txt(p, 'address') else '' end, d, tm, v_dur, 'new', v_price,
          pkg, plan.id, _uuid(p, 'seriesId'), v_branch, my_employee_id(), _txt(p, 'notes'))
  returning * into a;

  -- موعد على خطة ليها فاتورة (حتى لو مسودة بسعر 0 مستنية الاستقبال) = مفيش فاتورة منفصلة للزيارة
  if pkg is null and not (coalesce(plan.price, 0) > 0 or (plan.id is not null and exists (select 1 from invoices iv where iv.plan_id = plan.id and iv.status <> 'cancelled'))) then
    perform new_invoice(pat.id, svc.name, v_price, 'due', d, a.id, null, null, svc.id);
  end if;
  perform notify_staff('appointment_new', case when loc = 'home' then 'تم حجز زيارة منزلية' else 'تم إنشاء موعد جديد' end,
    pat.full_name || ' — ' || svc.name || ' — ' || d || ' ' || tm, a.no, '/appointments', pat.id);
  perform notify_patient(pat.id, 'appointment_new', 'تم حجز موعدك', svc.name || ' يوم ' || d || ' الساعة ' || tm, a.id::text);
  perform log_action('حجز موعد ' || a.no || ' — ' || svc.name || ' بتاريخ ' || d || ' ' || tm, pat.id);
  return jsonb_build_object('id', a.id, 'no', a.no);
end $function$;

CREATE OR REPLACE FUNCTION public.book_plan_session(p jsonb)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare pl treatment_plans; v_date date := nullif(p->>'date', '')::date; v_time text := nullif(p->>'time', ''); used int;
begin
  perform require_any(array['booking:create', 'appointments:create']);
  select * into pl from treatment_plans where id = _uuid(p, 'planId') for update;
  if pl.id is null or not can_see_patient(pl.patient_id) then raise exception 'الخطة العلاجية غير موجودة'; end if;
  if pl.status <> 'active' then raise exception 'الخطة العلاجية ليست نشطة — لا يمكن حجز زيارات عليها'; end if;
  if v_date is null then raise exception 'اختر التاريخ'; end if;
  select count(*)::int into used from appointments
   where plan_id = pl.id and status not in ('cancelled', 'no_show');
  if used >= pl.total_sessions then
    raise exception 'كل زيارات الخطة محجوزة بالفعل (% من %) — عدّل موعد موجود أو زوّد عدد زيارات الخطة', used, pl.total_sessions;
  end if;
  perform pg_advisory_xact_lock(hashtext('pt-day:' || pl.patient_id::text || v_date::text));
  if v_time is not null and exists (
       select 1 from appointments x
        where x.patient_id = pl.patient_id and x.date = v_date and x.status not in ('cancelled', 'no_show')
          and v_time::time < x.time::time + make_interval(mins => x.duration_min)
          and x.time::time < v_time::time + interval '30 minutes') then
    raise exception 'عند المريض موعد تاني في هالوقت يوم % — اختر وقتًا مختلفًا', to_char(v_date, 'YYYY-MM-DD');
  end if;
  return book_appointment(jsonb_build_object('patientId', pl.patient_id, 'type', 'session', 'serviceId', pl.service_id, 'planId', pl.id, 'durationMin', 30)
    || (p - 'patientId' - 'serviceId' - 'planId' - 'packageId' - 'guest' - 'priceId' - 'durationMin' - 'location' - 'address'));
end $function$;

CREATE OR REPLACE FUNCTION public.check_slot(p_therapist uuid, p_date date, p_time text, p_dur integer, p_exclude uuid DEFAULT NULL::uuid)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare th therapists; w jsonb; t int; why text;
begin
  if p_therapist is null then raise exception 'لازم اختيار الدكتور قبل تأكيد الحجز.'; end if;
  select * into th from therapists where id = p_therapist;
  if th.id is null or not th.active then raise exception 'الدكتور غير موجود أو غير نشط — اختر دكتور ثاني'; end if;
  if p_time !~ '^\d{2}:\d{2}$' then raise exception 'صيغة الوقت غير صحيحة'; end if;
  if p_date < riyadh_today() then raise exception 'ما يمكن الحجز في تاريخ سابق'; end if;
  if coalesce(p_dur, 0) <= 0 then raise exception 'مدة الزيارة غير صحيحة'; end if;
  w := doctor_day_window(p_therapist, p_date);
  case w->>'status'
    when 'closed' then raise exception 'المركز مغلق في هاليوم';
    when 'holiday' then raise exception 'المركز مغلق في هاليوم — اختر يوم ثاني';
    when 'leave' then raise exception 'الدكتور في إجازة في هذا التاريخ';
    when 'no_hours' then raise exception 'ما تم تحديد مواعيد عمل لهذا الدكتور — حدّدها من «المعالجين» أولًا';
    when 'off_day' then raise exception 'الدكتور ما يعمل في هاليوم — اختر يومًا من أيام عمله';
    when 'ok' then null;
    else raise exception 'الدكتور غير متاح';
  end case;
  t := _hm(p_time);
  why := doctor_window_reason(w, t, p_dur);
  if why = 'center' then raise exception 'الوقت خارج ساعات عمل المركز (% - %)', w->>'centerFrom', w->>'centerTo'; end if;
  if why = 'doctor' then raise exception 'الوقت خارج مواعيد عمل الدكتور (% - %)', w->>'doctorFrom', w->>'doctorTo'; end if;
  if why = 'blocked' then raise exception 'الدكتور غير متاح في هالوقت (استراحة أو استئذان)'; end if;

  -- قفل لكل (دكتور + يوم): حجزين في نفس اللحظة بيتنفذوا واحد ورا التاني، والتاني بيشوف حجز الأول ويترفض
  perform pg_advisory_xact_lock(hashtext(p_therapist::text || p_date::text));
  if exists (select 1 from appointments a
             where a.therapist_id = p_therapist and a.date = p_date and a.status <> 'cancelled' and a.id is distinct from p_exclude
               and t < _hm(a.time) + a.duration_min and _hm(a.time) < t + p_dur) then
    raise exception 'عذرًا، هذا الموعد تم حجزه للتو. يرجى اختيار موعد آخر.';
  end if;
end $function$;

CREATE OR REPLACE FUNCTION public.complete_next_plan_session(p_plan uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
begin
  raise exception 'يتم تسجيل زيارة الخطة من «حضور مرضى الباقات» فقط' using errcode = '42501';
end $function$;

CREATE OR REPLACE FUNCTION public.complete_session(p_id uuid, p jsonb DEFAULT '{}'::jsonb)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare s treatment_sessions; a appointments; pkg packages; left_n int; thr int; pts int;
begin
  perform require_perm('sessions', 'edit');
  select * into s from treatment_sessions where id = p_id for update;
  if s.id is null or not can_see_patient(s.patient_id) then raise exception 'الزيارة غير موجودة'; end if;
  if s.status = 'completed' then raise exception 'الزيارة مكتملة بالفعل'; end if;
  perform update_session(p_id, coalesce(p, '{}'));
  update treatment_sessions set status = 'completed', completed_at = now() where id = p_id;
  select * into a from appointments where id = s.appointment_id for update;
  if a.id is not null then
    update appointments set status = 'completed', updated_at = now() where id = a.id;
    if a.package_id is not null then
      select * into pkg from packages where id = a.package_id for update;
      if pkg.id is not null and pkg.used_sessions < pkg.total_sessions then
        update packages set used_sessions = used_sessions + 1,
          status = case when used_sessions + 1 >= total_sessions then 'completed' else status end
        where id = pkg.id;
        left_n := pkg.total_sessions - pkg.used_sessions - 1;
        select package_low_threshold into thr from center_info limit 1;
        if left_n > 0 and left_n <= thr then
          perform notify_staff('package_low', 'باقة قاربت على النفاد', (select full_name from patients where id = pkg.patient_id) || ': تبقّى ' || left_n || ' زيارة', pkg.id::text, '/patients/' || pkg.patient_id, pkg.patient_id);
        end if;
      end if;
    end if;
  end if;
  if s.plan_id is not null then perform recalc_plan(s.plan_id); end if;
  select loyalty_session_points into pts from center_info limit 1;
  perform award_loyalty_points(s.patient_id, 'session', coalesce(pts, 2), 'نقاط إتمام زيارة/كشف', 'session', s.id);
  perform notify_patient(s.patient_id, 'session_completed', 'اكتملت زيارتك', 'تم تسجيل إكمال الزيارة رقم ' || s.session_no || ' — شكرًا لالتزامك', s.id::text);
  perform log_action('إكمال الزيارة رقم ' || s.session_no, s.patient_id);
end $function$;

CREATE OR REPLACE FUNCTION public.decide_second_session(p_id uuid, p_approve boolean, p_reason text DEFAULT ''::text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare emp uuid; r second_session_requests; res jsonb;
begin
  emp := require_perm('appointments', 'edit');
  if not exists (select 1 from employees e where e.id = emp and e.role in ('system_admin', 'center_manager')) then
    raise exception 'الموافقة على الزيارة الثانية للمدير فقط' using errcode = '42501'; end if;
  select * into r from second_session_requests where id = p_id for update;
  if r.id is null then raise exception 'الطلب غير موجود'; end if;
  if r.status <> 'pending' then raise exception 'تم البت في هذا الطلب من قبل'; end if;
  if p_approve then
    res := attendance_check_in(r.source, r.ref_id, null, r.therapist_id, true);
    update second_session_requests set status = 'approved', decided_by = emp, decided_at = now(), checkin = res where id = r.id;
    perform log_action('موافقة على زيارة ثانية اليوم', r.patient_id);
  else
    if trim(coalesce(p_reason, '')) = '' then raise exception 'اكتب سبب الرفض'; end if;
    update second_session_requests set status = 'rejected', decided_by = emp, decided_at = now(), reject_reason = trim(p_reason) where id = r.id;
    perform log_action('رفض زيارة ثانية اليوم — ' || trim(p_reason), r.patient_id);
  end if;
  return coalesce(res, '{}'::jsonb);
end $function$;

CREATE OR REPLACE FUNCTION public.delete_appointment(p_id uuid)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare a appointments;
begin
  perform require_perm('appointments', 'delete');
  select * into a from appointments where id = p_id;
  if a.id is null then raise exception 'الموعد غير موجود'; end if;
  if exists (select 1 from treatment_sessions where appointment_id = p_id) then raise exception 'للموعد زيارة مسجلة. احذف الزيارة أولًا'; end if;
  if exists (select 1 from payments pay join invoices i on i.id = pay.invoice_id where i.appointment_id = p_id) then
    raise exception 'فاتورة الموعد عليها مدفوعات. احذف المدفوعات أو ألغِ الموعد بدل حذفه';
  end if;
  delete from invoices where appointment_id = p_id;
  delete from appointments where id = p_id;
  perform log_action('حذف الموعد ' || a.no, a.patient_id);
end $function$;

CREATE OR REPLACE FUNCTION public.delete_payment(p_id uuid)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare pay payments;
begin
  perform require_perm('payments', 'delete');
  select * into pay from payments where id = p_id;
  if pay.id is null then raise exception 'الدفعة غير موجودة'; end if;
  if exists (select 1 from invoices i join packages k on k.id = i.package_id where i.id = pay.invoice_id and k.kind is not null) or exists (select 1 from package_installment_requests where invoice_id = pay.invoice_id and status in ('pending','approved','rejected')) then
    raise exception 'دفعات باقات الزيارات لا تُحذف — استخدم إلغاء الدفعة (يحتفظ بالسجل)'; end if;
  delete from payments where id = p_id;
  perform recalc_invoice(pay.invoice_id);
  perform log_action('حذف دفعة ' || pay.amount || ' ج.م من ' || (select no from invoices where id = pay.invoice_id), pay.patient_id);
end $function$;

CREATE OR REPLACE FUNCTION public.delete_session(p_id uuid)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare s treatment_sessions; a appointments;
begin
  perform require_perm('sessions', 'delete');
  select * into s from treatment_sessions where id = p_id;
  if s.id is null then raise exception 'الزيارة غير موجودة'; end if;
  select * into a from appointments where id = s.appointment_id;
  if a.id is not null and s.status = 'completed' then
    update appointments set status = 'arrived' where id = a.id;
    if a.package_id is not null then
      update packages set used_sessions = greatest(used_sessions - 1, 0), status = case when status = 'completed' then 'active' else status end where id = a.package_id;
    end if;
  end if;
  if s.status = 'completed' then perform reverse_loyalty_points('session', s.id, 'إلغاء نقاط زيارة محذوفة رقم ' || s.session_no); end if;
  delete from treatment_sessions where id = p_id;
  if s.plan_id is not null then
    perform recalc_plan(s.plan_id);
    update treatment_plans set status = 'active' where id = s.plan_id and status = 'completed'
      and (select count(*) from treatment_sessions where plan_id = s.plan_id and status = 'completed') < total_sessions;
  end if;
  perform log_action('حذف الزيارة رقم ' || s.session_no, s.patient_id);
end $function$;

CREATE OR REPLACE FUNCTION public.guard_package_bookings()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare pk packages; n int;
begin
  if new.package_id is null or new.status in ('cancelled','no_show') then return new; end if;
  if tg_op = 'UPDATE' and old.package_id is not distinct from new.package_id and old.status not in ('cancelled','no_show') then return new; end if;
  select * into pk from packages where id = new.package_id for update;
  if pk.kind is null then return new; end if;
  if pk.status <> 'active' then raise exception 'الباقة غير مفعّلة — لازم تكون مدفوعة بالكامل'; end if;
  select count(*) into n from appointments where package_id = pk.id and id <> new.id and status not in ('cancelled','no_show');
  if n + 1 > pk.total_sessions then
    raise exception 'تم حجز كل زيارات الباقة (%/%) — ما يمكن إضافة زيارة أخرى', n, pk.total_sessions; end if;
  return new;
end $function$;

CREATE OR REPLACE FUNCTION public.guard_plan_session_day()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
begin
  if new.plan_id is null and new.package_id is null then return new; end if;
  if new.date is not distinct from old.date and new.time is not distinct from old.time then return new; end if;
  if new.status not in ('new', 'confirmed', 'rescheduled', 'on_way') then return new; end if;
  perform pg_advisory_xact_lock(hashtext('pt-day:' || new.patient_id::text || new.date::text));
  if exists (select 1 from appointments x where x.patient_id = new.patient_id and x.date = new.date and x.id <> new.id
              and x.status in ('new', 'confirmed', 'rescheduled', 'on_way', 'arrived', 'in_progress') and (x.plan_id is not null or x.package_id is not null)
              and new.time::time < x.time::time + make_interval(mins => x.duration_min)
              and x.time::time < new.time::time + make_interval(mins => new.duration_min)) then
    raise exception 'المريض عنده زيارة خطة/باقة في هالوقت يوم % — اختر وقتًا مختلفًا', to_char(new.date, 'YYYY-MM-DD');
  end if;
  return new;
end $function$;

CREATE OR REPLACE FUNCTION public.guard_second_session_day()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare cnt int;
begin
  if new.plan_id is null and new.package_id is null then return new; end if;
  if new.status not in ('arrived', 'in_progress', 'completed') then return new; end if;
  if tg_op = 'UPDATE' and old.status in ('arrived', 'in_progress', 'completed') then return new; end if;
  perform pg_advisory_xact_lock(hashtext('pt-day:' || new.patient_id::text || new.date::text));
  cnt := patient_day_sessions(new.patient_id, new.date, new.id);
  if cnt >= 2 then raise exception 'الحد الأقصى زيارتين في اليوم للمريض'; end if;
  if cnt = 1 and coalesce(current_setting('app.second_ok', true), '') <> 'on'
     and not exists (select 1 from employees e where e.auth_user_id = auth.uid() and e.active and e.role in ('system_admin', 'center_manager')) then
    raise exception 'المريض حضر زيارة اليوم بالفعل — الزيارة الثانية تحتاج إلى موافقة المدير (من «حضور مرضى الباقات» ← «طلب زيارة ثانية اليوم»)' using errcode = '42501';
  end if;
  return new;
end $function$;

CREATE OR REPLACE FUNCTION public.loyalty_redeem_core(p_patient uuid, p_sessions integer, p_emp uuid, p_beneficiary_name text, p_beneficiary_phone text, p_beneficiary_relation text, p_idempotency_key text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare bal int; unit int; cost int; v_code text; dc_id uuid; reward_val numeric; existing loyalty_redemptions; ben_patient uuid; ben_digits text;
  n int := coalesce(p_sessions, 1);
begin
  if n not in (1, 2) then raise exception 'اختر زيارة واحدة أو زيارتين'; end if;
  if p_idempotency_key is not null then
    select * into existing from loyalty_redemptions where idempotency_key = p_idempotency_key;
    if existing.id is not null then
      return jsonb_build_object('code', (select code from discount_codes where id = existing.discount_code_id), 'sessions', n,
        'remaining', (select coalesce(sum(points), 0) from loyalty_ledger where patient_id = existing.patient_id));
    end if;
  end if;
  perform pg_advisory_xact_lock(hashtext('loyalty:' || p_patient::text)); -- منع الاستبدال المزدوج بالتوازي
  if p_idempotency_key is not null then
    select * into existing from loyalty_redemptions where idempotency_key = p_idempotency_key;
    if existing.id is not null then
      return jsonb_build_object('code', (select code from discount_codes where id = existing.discount_code_id), 'sessions', n,
        'remaining', (select coalesce(sum(points), 0) from loyalty_ledger where patient_id = existing.patient_id));
    end if;
  end if;
  if not exists (select 1 from patients where id = p_patient) then raise exception 'المريض غير موجود'; end if;
  select coalesce(loyalty_redeem_cost, 30) into unit from center_info limit 1;
  cost := unit * n;
  select coalesce(sum(points), 0) into bal from loyalty_ledger where patient_id = p_patient;
  if bal < cost then raise exception 'رصيد النقاط أقل من % نقطة — الرصيد الحالي % نقطة', cost, bal; end if;

  if nullif(trim(coalesce(p_beneficiary_phone, '')), '') is not null then
    ben_digits := regexp_replace(p_beneficiary_phone, '\D', '', 'g');
    select id into ben_patient from patients where regexp_replace(phone, '\D', '', 'g') like '%' || right(ben_digits, 9) order by registered_at desc limit 1;
  end if;

  select price into reward_val from services where id = 'sv_physio';
  reward_val := coalesce(reward_val, 250);
  loop
    v_code := 'FREE-' || upper(substr(md5(random()::text || clock_timestamp()::text), 1, 6));
    exit when not exists (select 1 from discount_codes where discount_codes.code = v_code);
  end loop;
  -- قيمة الكود = زيارة واحدة لكل استخدام، وعدد مرات الاستخدام = عدد الزيارات
  insert into discount_codes (code, type, value, valid_from, valid_to, max_uses, min_amount, active, note, created_by, patient_id)
  values (v_code, 'fixed', reward_val, riyadh_today(), riyadh_today() + 365, n, 0, true,
    'مكافأة نقاط ولاء — ' || case when n = 2 then 'زيارتين مجانيتين' else 'زيارة مجانية' end, p_emp,
    coalesce(ben_patient, case when p_beneficiary_phone is null then p_patient else null end))
  returning id into dc_id;
  insert into loyalty_redemptions (patient_id, points_used, discount_code_id, created_by, beneficiary_name, beneficiary_phone, beneficiary_relation, idempotency_key)
  values (p_patient, cost, dc_id, p_emp, nullif(trim(coalesce(p_beneficiary_name, '')), ''), nullif(trim(coalesce(p_beneficiary_phone, '')), ''),
    nullif(trim(coalesce(p_beneficiary_relation, '')), ''), p_idempotency_key);
  perform award_loyalty_points(p_patient, 'redeem', -cost, 'استبدال ' || cost || ' نقطة (' || n || ' زيارة) — كود ' || v_code, 'redemption', dc_id);
  perform log_action('استبدال ' || cost || ' نقطة ولاء مقابل كود ' || v_code || ' (' || n || ' زيارة)'
    || case when p_emp is null then ' — من حساب المريض' else '' end
    || case when p_beneficiary_name is not null then ' — للمستفيد: ' || p_beneficiary_name else '' end, p_patient);
  if p_emp is null then
    perform notify_staff('loyalty', 'استبدال نقاط من المريض', (select full_name from patients where id = p_patient) || ' — كود ' || v_code || ' (' || n || ' زيارة)', v_code, '/loyalty', p_patient);
  end if;
  return jsonb_build_object('code', v_code, 'sessions', n, 'points', cost, 'remaining', bal - cost);
end $function$;

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
                order by (c.id is not null) desc, a.time limit 1),
      'next', (select jsonb_build_object('appointmentId', n.id, 'no', n.no, 'date', n.date, 'time', n.time, 'status', n.status, 'doctor', (select name from therapists where id = n.therapist_id))
                from appointments n where n.patient_id = p.id and n.date > riyadh_today() and n.status in ('new', 'confirmed', 'rescheduled', 'on_way') and n.package_id = k.id order by n.date, n.time limit 1)
    ) as r
    from packages k join patients p on p.id = k.patient_id
    cross join lateral (select count(*)::int n from appointments x where x.package_id = k.id and x.status in ('arrived', 'in_progress')) pend
    where not p.is_guest and can_see_patient(p.id)
      and (k.status = 'active' or (k.status = 'expired' and k.expiry_date >= riyadh_today() - 60) or (q <> '' and k.status = 'completed'))
      and (q = '' or patient_q_match(p.full_name, p.phone, p.file_no, p.national_id, q))
    union all
    -- 2) الخطط العلاجية (treatment_plans) — هي «الباقات» الفعلية: total_sessions، الزيارات المنتهية من treatment_sessions، التاريخ من start/end
    select jsonb_build_object(
      'source', 'plan', 'packageId', pl.id, 'patientId', p.id, 'name', p.full_name, 'phone', p.phone, 'fileNo', p.file_no,
      'packageName', 'خطة علاج ' || pl.total_sessions || ' زيارات' || case when coalesce(pl.diagnosis, '') <> '' then ' — ' || pl.diagnosis else '' end,
      'status', pl.status, 'total', pl.total_sessions, 'used', done.n,
      'pending', pend.n, 'remaining', greatest(pl.total_sessions - done.n - pend.n, 0), 'nextNo', least(done.n + pend.n + 1, pl.total_sessions),
      'startDate', pl.start_date, 'expiry', pl.end_date,
      'expiresAt', case when pl.end_date is null then null else to_char(((pl.end_date::timestamp + time '23:59:59') at time zone 'Africa/Cairo') at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS"Z"') end,
      'serverNow', to_char(now() at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS"Z"'), 'defaultDoctorId', pl.therapist_id,
      'today', (select jsonb_build_object('appointmentId', a.id, 'no', a.no, 'time', a.time, 'status', a.status, 'service', (select name from services where id = a.service_id),
                  'doctor', (select name from therapists where id = a.therapist_id), 'checkedIn', c.id is not null, 'checkinAt', c.created_at, 'sessionNo', c.session_no)
                from appointments a left join package_checkins c on c.appointment_id = a.id
                where a.patient_id = p.id and a.date = riyadh_today() and a.status not in ('cancelled', 'no_show') and a.plan_id = pl.id
                order by (c.id is not null) desc, a.time limit 1),
      'next', (select jsonb_build_object('appointmentId', n.id, 'no', n.no, 'date', n.date, 'time', n.time, 'status', n.status, 'doctor', (select name from therapists where id = n.therapist_id))
                from appointments n where n.patient_id = p.id and n.date > riyadh_today() and n.status in ('new', 'confirmed', 'rescheduled', 'on_way') and n.plan_id = pl.id order by n.date, n.time limit 1)
    ) as r
    from treatment_plans pl join patients p on p.id = pl.patient_id
    cross join lateral (select count(*)::int n from treatment_sessions s where s.plan_id = pl.id and s.status = 'completed') done
    cross join lateral (select count(*)::int n from appointments x where x.plan_id = pl.id and x.status in ('arrived', 'in_progress')) pend
    where not p.is_guest and can_see_patient(p.id)
      and (pl.status = 'active' or (pl.status = 'completed' and (q <> '' or coalesce(pl.updated_at, pl.created_at) > now() - interval '45 days')))
      and (q = '' or patient_q_match(p.full_name, p.phone, p.file_no, p.national_id, q))
    limit 500
  ) x;
  return res;
end $function$;

CREATE OR REPLACE FUNCTION public.package_check_in(p_package uuid, p_appointment uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare emp uuid; pk packages; a appointments; pend int; v_id uuid; v_no int;
begin
  emp := require_perm('appointments', 'edit');
  select * into pk from packages where id = p_package for update;
  if pk.id is null or not can_see_patient(pk.patient_id) then raise exception 'الباقة غير موجودة'; end if;
  select * into a from appointments where id = p_appointment for update;
  if a.id is null or a.patient_id <> pk.patient_id then raise exception 'الموعد غير موجود لهذا المريض'; end if;
  if pk.status <> 'active' then raise exception 'الباقة غير فعّالة (%)', pkg_status_ar(pk.status); end if;
  if pk.expiry_date is not null and pk.expiry_date < riyadh_today() then raise exception 'الباقة منتهية الصلاحية بتاريخ %', pk.expiry_date; end if;
  if a.package_id is not null and a.package_id <> pk.id then raise exception 'هذا الموعد مرتبط بباقة أخرى'; end if;
  if coalesce(array_length(pk.service_ids, 1), 0) > 0 and not (a.service_id = any(pk.service_ids)) then raise exception 'خدمة الموعد غير مشمولة في هذي الباقة'; end if;
  if a.status in ('cancelled', 'completed', 'no_show') then raise exception 'ما يمكن تسجيل حضور موعد بحالته الحالية'; end if;
  if a.status in ('arrived', 'in_progress') or exists (select 1 from package_checkins where appointment_id = a.id) then raise exception 'تم تسجيل حضور هذا الموعد من قبل'; end if;
  if a.date <> riyadh_today() then raise exception 'الحضور يُسجَّل في يوم الموعد فقط (موعد هذا الحجز %)', a.date; end if;
  if a.therapist_id is null then raise exception 'اختر الدكتور للموعد قبل تسجيل الحضور'; end if;
  -- زيارات الباقة المتاحة = الإجمالي − المنتهية − اللي حضرت ولسه ماخلصتش
  select count(*) into pend from appointments x where x.package_id = pk.id and x.status in ('arrived', 'in_progress') and x.id <> a.id;
  if pk.used_sessions + pend >= pk.total_sessions then raise exception 'اكتملت زيارات الباقة — ما فيه زيارات متبقية'; end if;
  -- حضور واحد لكل باقة في اليوم (منع تسجيل زيارة تانية لنفس الحضور)
  if exists (select 1 from package_checkins c where c.package_id = pk.id and (c.created_at at time zone 'Africa/Cairo')::date = riyadh_today()) then raise exception 'تم تسجيل حضور هذا المريض على هذي الباقة اليوم من قبل'; end if;
  v_no := pk.used_sessions + pend + 1; -- رقم الزيارة محسوب من السجل الفعلي للباقة
  if a.package_id is null then update appointments set package_id = pk.id where id = a.id; end if;
  insert into package_checkins (package_id, patient_id, appointment_id, checked_in_by, session_no) values (pk.id, pk.patient_id, a.id, emp, v_no) returning id into v_id;
  perform set_appointment_status(a.id, 'arrived', null, null);
  perform log_action('تسجيل حضور مريض باقة — ' || pk.name || ' (الموعد ' || a.no || ')', pk.patient_id);
  return jsonb_build_object('id', v_id, 'sessionNo', v_no, 'total', pk.total_sessions, 'remaining', greatest(pk.total_sessions - pk.used_sessions - pend - 1, 0));
end $function$;

CREATE OR REPLACE FUNCTION public.package_complete(p_package uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare pk packages; plan_ids uuid[]; n_plans int := 0; open_appts int; pid uuid;
begin
  perform require_perm('packages', 'edit');
  select * into pk from packages where id = p_package for update;
  if pk.id is null or not can_see_patient(pk.patient_id) then raise exception 'الباقة غير موجودة'; end if;
  if pk.status <> 'active' then raise exception 'الباقة غير فعّالة (%) — ما فيه ما يمكن إكماله', pkg_status_ar(pk.status); end if;
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
  perform log_action('اكتمال الباقة «' || pk.name || '» (' || pk.used_sessions || ' من ' || pk.total_sessions || ' زيارة)', pk.patient_id);
  return jsonb_build_object('plansCompleted', n_plans, 'openAppointments', open_appts, 'remainingSessions', greatest(pk.total_sessions - pk.used_sessions, 0));
end $function$;

CREATE OR REPLACE FUNCTION public.physio_delete_note(p_id uuid)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare n physio_progress_notes;
begin
  perform require_perm('physio', 'delete');
  select * into n from physio_progress_notes where id = p_id;
  if n.id is null then raise exception 'ملاحظة التقدّم غير موجودة'; end if;
  perform 1 from physio_plans where id = n.plan_id for update;
  if exists (select 1 from physio_progress_notes where plan_id = n.plan_id and session_no > n.session_no) then
    raise exception 'يمكن حذف آخر زيارة مسجّلة فقط للحفاظ على تسلسل أرقام الزيارات'; end if;
  delete from physio_progress_notes where id = p_id;
  update physio_plans set status = 'active', updated_at = now(), updated_by = my_employee_id() where id = n.plan_id and status = 'completed';
  perform log_action('حذف ملاحظة تقدّم علاج طبيعي — الزيارة ' || n.session_no, n.patient_id);
end $function$;

CREATE OR REPLACE FUNCTION public.physio_save_note(p jsonb)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare emp uuid; v_id uuid := nullif(p->>'id', '')::uuid; pl physio_plans; old physio_progress_notes; v_no int; v_done int;
  v_pain int; v_elec text[]; v_ts uuid; v_date date;
begin
  emp := require_perm('physio', case when v_id is null then 'create' else 'edit' end);
  if v_id is null then
    select * into pl from physio_plans where id = nullif(p->>'planId', '')::uuid for update; -- قفل الخطة يمنع تسجيل نفس رقم الزيارة مرتين بالتوازي
    if pl.id is null then raise exception 'ما يمكن تسجيل ملاحظة تقدّم بدون خطة علاج طبيعي'; end if;
  else
    select * into old from physio_progress_notes where id = v_id;
    if old.id is null then raise exception 'ملاحظة التقدّم غير موجودة'; end if;
    select * into pl from physio_plans where id = old.plan_id for update;
  end if;
  if not exists (select 1 from patients where id = pl.patient_id) then raise exception 'المريض غير موجود'; end if;
  if not can_see_patient(pl.patient_id) then raise exception 'ما فيه صلاحية على ملف هذا المريض' using errcode = '42501'; end if;

  v_pain := physio_int(p, 'painVas', 0, 10, 'مقياس الألم');
  if v_pain is null then raise exception 'مقياس الألم مطلوب من 0 إلى 10'; end if;
  v_elec := physio_arr(p, 'electrotherapy');
  if not v_elec <@ array['tens','swt','laser','ifc','us','nmes','game_ready','cryotherapy','iontophoresis','phonophoresis'] then raise exception 'العلاج الكهربائي يحتوي خيارًا غير معروف'; end if;
  if physio_txt(p, 'ptName') = '' then raise exception 'اسم أخصائي العلاج الطبيعي مطلوب'; end if;
  v_date := coalesce(physio_date(p, 'sessionDate', 'تاريخ الزيارة'), old.session_date, riyadh_today());
  if v_date > riyadh_today() then raise exception 'تاريخ الزيارة ما ينفع يكون في المستقبل'; end if;
  if v_date < pl.start_date then raise exception 'تاريخ الزيارة قبل بداية الخطة'; end if;
  v_ts := nullif(p->>'treatmentSessionId', '')::uuid;
  if v_ts is not null and not exists (select 1 from treatment_sessions where id = v_ts and patient_id = pl.patient_id) then raise exception 'الزيارة المرتبطة لا تخص هذا المريض'; end if;

  if v_id is null then
    if pl.status = 'cancelled' then raise exception 'الخطة ملغاة — ما يمكن تسجيل زيارات عليها'; end if;
    select count(*), coalesce(max(session_no), 0) into v_done, v_no from physio_progress_notes where plan_id = pl.id;
    v_no := v_no + 1;
    if p->>'sessionNo' is not null and p->>'sessionNo' <> '' and (p->>'sessionNo')::int <> v_no then
      raise exception 'رقم الزيارة لازم يكون % (الزيارات متسلسلة)', v_no; end if;
    if v_no > pl.total_sessions then
      raise exception 'انتهت زيارات الخطة (%/%) — لإضافة زيارة، عدّل الخطة وزِد عدد الزيارات (يتطلب صلاحية تعديل)', pl.total_sessions, pl.total_sessions; end if;
    if v_ts is not null and exists (select 1 from physio_progress_notes where treatment_session_id = v_ts) then raise exception 'هذي الزيارة لها ملاحظة تقدّم بالفعل'; end if;
    insert into physio_progress_notes (plan_id, patient_id, session_no, session_date, treatment_session_id, diagnosis, pain_vas, electrotherapy,
      manual_therapy, positioning, therapeutic_exercise, pt_name, therapist_id, created_by, updated_by)
    values (pl.id, pl.patient_id, v_no, v_date, v_ts,
      coalesce(nullif(physio_txt(p, 'diagnosis'), ''), (select diagnosis from physio_evaluations where id = pl.evaluation_id), ''),
      v_pain, v_elec, physio_txt(p, 'manualTherapy'), physio_txt(p, 'positioning'), physio_txt(p, 'therapeuticExercise'), physio_txt(p, 'ptName'),
      coalesce(nullif(p->>'therapistId', '')::uuid, (select therapist_id from employees where id = emp)), emp, emp)
    returning id into v_id;
    if v_no >= pl.total_sessions and pl.status = 'active' then update physio_plans set status = 'completed', updated_at = now(), updated_by = emp where id = pl.id; end if;
    perform log_action('ملاحظة تقدّم علاج طبيعي — الزيارة ' || v_no || '/' || pl.total_sessions, pl.patient_id);
  else
    -- رقم الزيارة والخطة ثابتين في التعديل (منعًا لتكرار أو كسر التسلسل)
    if v_ts is not null and exists (select 1 from physio_progress_notes where treatment_session_id = v_ts and id <> v_id) then raise exception 'هذي الزيارة لها ملاحظة تقدّم بالفعل'; end if;
    update physio_progress_notes set session_date = v_date, treatment_session_id = v_ts, diagnosis = physio_txt(p, 'diagnosis'), pain_vas = v_pain,
      electrotherapy = v_elec, manual_therapy = physio_txt(p, 'manualTherapy'), positioning = physio_txt(p, 'positioning'),
      therapeutic_exercise = physio_txt(p, 'therapeuticExercise'), pt_name = physio_txt(p, 'ptName'),
      therapist_id = coalesce(nullif(p->>'therapistId', '')::uuid, therapist_id), updated_at = now(), updated_by = emp
    where id = v_id returning session_no into v_no;
    perform log_action('تعديل ملاحظة تقدّم علاج طبيعي — الزيارة ' || v_no, pl.patient_id);
  end if;
  return physio_plan_tracking(pl.id) || jsonb_build_object('noteId', v_id, 'sessionNo', v_no);
end $function$;

CREATE OR REPLACE FUNCTION public.physio_save_plan(p jsonb)
 RETURNS uuid
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare emp uuid; v_id uuid := nullif(p->>'id', '')::uuid; v_eval physio_evaluations; v_patient uuid; v_pkg uuid; v_tp uuid;
  v_total int; v_done int := 0; v_unit text; v_start date; v_status text; old physio_plans;
begin
  emp := require_perm('physio', case when v_id is null then 'create' else 'edit' end);
  if v_id is null then
    select * into v_eval from physio_evaluations where id = nullif(p->>'evaluationId', '')::uuid;
    if v_eval.id is null then raise exception 'أنشئ التقييم أولًا — لازم تكون الخطة مرتبطة بتقييم'; end if;
    if exists (select 1 from physio_plans where evaluation_id = v_eval.id) then raise exception 'هذا التقييم له خطة بالفعل — عدّلها بدل إنشاء خطة جديدة'; end if;
    v_patient := v_eval.patient_id;
  else
    select * into old from physio_plans where id = v_id for update;
    if old.id is null then raise exception 'الخطة غير موجودة'; end if;
    v_patient := old.patient_id;
    select count(*) into v_done from physio_progress_notes where plan_id = v_id;
  end if;
  if not can_see_patient(v_patient) then raise exception 'ما فيه صلاحية على ملف هذا المريض' using errcode = '42501'; end if;

  v_pkg := nullif(p->>'packageId', '')::uuid;
  if v_pkg is not null and not exists (select 1 from packages where id = v_pkg and patient_id = v_patient) then raise exception 'الباقة المختارة لا تخص هذا المريض'; end if;
  v_tp := nullif(p->>'treatmentPlanId', '')::uuid;
  if v_tp is not null and not exists (select 1 from treatment_plans where id = v_tp and patient_id = v_patient) then raise exception 'الخطة العلاجية المختارة لا تخص هذا المريض'; end if;

  v_total := physio_int(p, 'totalSessions', 1, 100, 'عدد الزيارات');
  if v_total is null and v_pkg is not null then select total_sessions into v_total from packages where id = v_pkg; end if;
  if v_total is null then raise exception 'عدد الزيارات مطلوب'; end if;
  if v_total < v_done then raise exception 'ما يمكن تقليل عدد الزيارات إلى % — مسجّل بالفعل % زيارة', v_total, v_done; end if;
  v_unit := nullif(physio_txt(p, 'durationUnit'), '');
  if v_unit is not null and v_unit not in ('week', 'month') then raise exception 'وحدة مدة الخطة لازم تكون أسبوع أو شهر'; end if;
  v_start := coalesce(physio_date(p, 'startDate', 'تاريخ بداية الخطة'), old.start_date, riyadh_today());
  v_status := coalesce(nullif(physio_txt(p, 'status'), ''), old.status, 'active');
  if v_status not in ('active', 'completed', 'cancelled') then raise exception 'حالة الخطة غير صحيحة'; end if;
  if v_status = 'completed' and v_done < v_total then v_status := 'active'; end if;
  if v_status = 'active' and v_done >= v_total and v_id is not null then v_status := 'completed'; end if;
  if physio_date(p, 'reevaluationDate', 'تاريخ إعادة التقييم') < v_start then raise exception 'تاريخ إعادة التقييم لازم يكون بعد بداية الخطة'; end if;
  if physio_date(p, 'followUpDate', 'تاريخ المتابعة') < v_start then raise exception 'تاريخ المتابعة لازم يكون بعد بداية الخطة'; end if;

  if v_id is null then
    insert into physio_plans (patient_id, evaluation_id, package_id, treatment_plan_id, pt_frequency, total_sessions, duration_value, duration_unit,
      sessions_per_week, start_date, follow_up_date, reevaluation_date, short_goals, long_goals, status, notes, created_by, updated_by)
    values (v_patient, v_eval.id, v_pkg, v_tp, physio_txt(p, 'ptFrequency'), v_total, physio_int(p, 'durationValue', 1, 52, 'مدة الخطة'), v_unit,
      physio_int(p, 'sessionsPerWeek', 1, 7, 'عدد الزيارات في الأسبوع'), v_start, physio_date(p, 'followUpDate', 'تاريخ المتابعة'),
      physio_date(p, 'reevaluationDate', 'تاريخ إعادة التقييم'), physio_arr(p, 'shortGoals'), physio_arr(p, 'longGoals'), v_status, physio_txt(p, 'notes'), emp, emp)
    returning id into v_id;
    perform log_action('خطة علاج طبيعي جديدة: ' || v_total || ' زيارة', v_patient);
  else
    update physio_plans set package_id = v_pkg, treatment_plan_id = v_tp, pt_frequency = physio_txt(p, 'ptFrequency'), total_sessions = v_total,
      duration_value = physio_int(p, 'durationValue', 1, 52, 'مدة الخطة'), duration_unit = v_unit,
      sessions_per_week = physio_int(p, 'sessionsPerWeek', 1, 7, 'عدد الزيارات في الأسبوع'), start_date = v_start,
      follow_up_date = physio_date(p, 'followUpDate', 'تاريخ المتابعة'), reevaluation_date = physio_date(p, 'reevaluationDate', 'تاريخ إعادة التقييم'),
      short_goals = case when p ? 'shortGoals' then physio_arr(p, 'shortGoals') else short_goals end,
      long_goals = case when p ? 'longGoals' then physio_arr(p, 'longGoals') else long_goals end,
      status = v_status, notes = physio_txt(p, 'notes'), updated_at = now(), updated_by = emp
    where id = v_id;
    perform log_action('تعديل خطة علاج طبيعي: ' || v_total || ' زيارة', v_patient);
  end if;
  return v_id;
end $function$;

CREATE OR REPLACE FUNCTION public.plans_notify_update()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare sig text;
begin
  -- تحديث «مهم» بس: عدد الزيارات/الوتيرة/المدة/البداية/الخدمة/الطبيب — والحفظ من غير تغيير فعلي ما بيبعتش حاجة
  if (old.total_sessions, old.sessions_per_week, old.duration_weeks, old.start_date, old.service_id, old.therapist_id)
     is not distinct from (new.total_sessions, new.sessions_per_week, new.duration_weeks, new.start_date, new.service_id, new.therapist_id) then return null; end if;
  if old.xmin::text = (txid_current() % 4294967296)::text then return null; end if;  -- اتعملت في نفس المعاملة (إنشاء) → plan_new بيغطيها
  sig := md5(concat_ws('|', new.total_sessions, new.sessions_per_week, new.duration_weeks, new.start_date, new.service_id, new.therapist_id));
  begin
    perform notify_patient_keyed(new.patient_id, 'plan_updated', 'تم تحديث خطتك العلاجية',
      'خطتك الآن ' || new.total_sessions || ' زيارة (' || new.sessions_per_week || ' أسبوعيًا) تبدأ ' || coalesce(new.start_date::text, '') || '. التفاصيل في صفحة الخطة العلاجية.',
      new.id::text, 'plan_updated:' || new.id || ':' || sig, null, null, '/me/plans', 'plan.updated', null);
  exception when others then raise warning 'plan_updated notify: %', sqlerrm;
  end;
  return null;
end $function$;

CREATE OR REPLACE FUNCTION public.recalc_invoice(p_id uuid)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare base numeric; inv invoices; pk packages;
begin
  update invoices i set paid = coalesce((select sum(amount) from payments where invoice_id = i.id and voided_at is null), 0) where id = p_id;
  select greatest(price - discount, 0) into base from invoices where id = p_id;
  update invoices set
    tax_amount = round(base * tax_rate / 100, 2),
    total = base + round(base * tax_rate / 100, 2)
  where id = p_id;
  update invoices set
    remaining = greatest(total - paid, 0),
    status = case when status in ('cancelled','draft') then status
                  when greatest(total - paid, 0) = 0 then 'paid'
                  when paid > 0 then 'partial' else 'due' end
  where id = p_id
  returning * into inv;
  -- الباقة الثابتة: تتفعّل بس لما المتبقي = 0
  if inv.package_id is not null then
    select * into pk from packages where id = inv.package_id for update;
    if pk.kind is not null then
      if inv.status = 'paid' and pk.status = 'pending_payment' then
        update packages set status = 'active', activated_at = now(), start_date = riyadh_today(),
          expiry_date = riyadh_today() + coalesce((select valid_days from package_plans where id = pk.plan_id), greatest(expiry_date - start_date, 90))
        where id = pk.id;
        perform log_action('تفعيل ' || pk.name || ' بعد السداد الكامل — ' || pk.total_sessions || ' زيارات', pk.patient_id);
      elsif inv.status in ('due','partial') and pk.status = 'active' and pk.used_sessions = 0 then
        -- دفعة اتلغت قبل استخدام أي زيارة: الباقة ترجع بانتظار الدفع
        update packages set status = 'pending_payment', activated_at = null where id = pk.id;
      end if;
    end if;
  end if;
end $function$;

CREATE OR REPLACE FUNCTION public.recalc_plan(p_plan uuid)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare pl treatment_plans; done int;
begin
  select * into pl from treatment_plans where id = p_plan;
  if pl.id is null then return; end if;
  select count(*) into done from treatment_sessions where plan_id = p_plan and status = 'completed';
  update treatment_plans set progress_pct = case when total_sessions > 0 then least(100, round(done * 100.0 / total_sessions)) else 0 end where id = p_plan;
  if done >= pl.total_sessions and pl.status = 'active' then
    update treatment_plans set status = 'completed' where id = p_plan;
    perform notify_staff('user', 'اكتملت خطة علاجية', (select full_name from patients where id = pl.patient_id) || ' أكمل كل زيارات خطة «' || pl.diagnosis || '»', p_plan::text, '/patients/' || pl.patient_id, pl.patient_id);
    perform notify_patient(pl.patient_id, 'plan_completed', 'أكملت خطتك العلاجية 🎉', 'أكملت ' || pl.total_sessions || ' زيارات — نتمنى لك دوام الصحة', p_plan::text);
  end if;
end $function$;

CREATE OR REPLACE FUNCTION public.request_package_installment(p_invoice uuid, p_reason text DEFAULT NULL::text, p_first_due date DEFAULT NULL::date, p_second_due date DEFAULT NULL::date)
 RETURNS uuid
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare emp uuid; inv invoices; pk packages; v uuid; first_amt numeric; d1 date; d2 date;
begin
  emp := require_perm('installments', 'create');
  select * into inv from invoices where id = p_invoice for update;
  if inv.id is null then raise exception 'الفاتورة غير موجودة'; end if;
  if inv.package_id is not null then select * into pk from packages where id = inv.package_id; end if;
  if pk.kind is null and inv.plan_id is null then raise exception 'الدفع على دفعتين متاح فقط لباقة 4 زيارات وباقة 6 زيارات وفواتير الخطط العلاجية'; end if;
  if inv.status = 'draft' and inv.plan_id is null then raise exception 'اعتمد الفاتورة أولًا'; end if;
  if inv.status = 'cancelled' or pk.status = 'cancelled' then raise exception 'الفاتورة أو الباقة ملغاة'; end if;
  if inv.total <= 0 then raise exception 'إجمالي الفاتورة صفر'; end if;
  if inv.paid > 0 then raise exception 'تم تسجيل دفع على الفاتورة بالفعل — ما يمكن طلب التقسيط'; end if;
  if exists (select 1 from package_installment_requests where invoice_id = inv.id and status = 'pending') then raise exception 'فيه طلب بانتظار موافقة المدير لهذه الفاتورة'; end if;
  if exists (select 1 from package_installment_requests where invoice_id = inv.id and status = 'approved') then raise exception 'تمت الموافقة على التقسيط لهذه الفاتورة بالفعل'; end if;
  if exists (select 1 from package_installment_requests where invoice_id = inv.id and status = 'rejected') then
    raise exception 'تم رفض التقسيط لهذه الفاتورة — الدفع الكامل فقط'; end if;
  d1 := coalesce(p_first_due, riyadh_today());
  d2 := coalesce(p_second_due, d1 + 30);
  if d1 < riyadh_today() then raise exception 'تاريخ استحقاق الدفعة الأولى ما ينفع يكون في الماضي'; end if;
  if d2 <= d1 then raise exception 'لازم يكون تاريخ استحقاق الدفعة الثانية بعد الأولى'; end if;
  first_amt := round(inv.total / 2, 2);
  insert into package_installment_requests (invoice_id, package_id, plan_id, patient_id, total, first_amount, second_amount, reason, requested_by, first_due_date, second_due_date)
  values (inv.id, pk.id, inv.plan_id, inv.patient_id, inv.total, first_amt, inv.total - first_amt, nullif(trim(coalesce(p_reason, '')), ''), emp, d1, d2)
  returning id into v;
  perform notify_staff('installment_request', 'طلب دفع على دفعتين',
    (select full_name from patients where id = inv.patient_id) || ' — ' || coalesce(pk.name, inv.service_name) || ' (' || inv.total || ' ج.م)', v::text, '/installments', inv.patient_id);
  perform log_action('طلب دفع ' || coalesce(pk.name, inv.service_name) || ' على دفعتين (' || first_amt || ' بتاريخ ' || d1 || ' + ' || (inv.total - first_amt) || ' بتاريخ ' || d2 || ') — ' || inv.no, inv.patient_id);
  return v;
end $function$;

CREATE OR REPLACE FUNCTION public.request_second_session(p_source text, p_id uuid, p_therapist uuid, p_note text DEFAULT ''::text)
 RETURNS uuid
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare emp uuid; v_patient uuid; v uuid; v_name text;
begin
  emp := require_perm('appointments', 'edit');
  if p_source = 'package' then select patient_id, name into v_patient, v_name from packages where id = p_id;
  elsif p_source = 'plan' then select patient_id, 'خطة علاج ' || total_sessions || ' زيارات' into v_patient, v_name from treatment_plans where id = p_id;
  else raise exception 'نوع غير معروف'; end if;
  if v_patient is null then raise exception 'الباقة/الخطة غير موجودة'; end if;
  if not can_see_patient(v_patient) then raise exception 'ما فيه صلاحية على ملف هذا المريض' using errcode = '42501'; end if;
  if p_therapist is null then raise exception 'اختر الدكتور للزيارة الثانية'; end if;
  if patient_day_sessions(v_patient, riyadh_today(), null) = 0 then
    raise exception 'لم يحضر المريض زيارة اليوم بعد — سجّل الحضور العادي'; end if;
  if exists (select 1 from second_session_requests r where r.patient_id = v_patient and r.status = 'pending') then
    raise exception 'فيه طلب زيارة ثانية بانتظار موافقة المدير بالفعل'; end if;
  insert into second_session_requests (source, ref_id, patient_id, therapist_id, note, requested_by)
  values (p_source, p_id, v_patient, p_therapist, trim(coalesce(p_note, '')), emp) returning id into v;
  perform notify_staff('staff_request', 'طلب زيارة ثانية اليوم بانتظار موافقتك',
    (select full_name from patients where id = v_patient) || ' — ' || v_name, v::text, '/requests', v_patient);
  perform log_action('طلب زيارة ثانية اليوم — ' || v_name, v_patient);
  return v;
end $function$;

CREATE OR REPLACE FUNCTION public.save_plan(p jsonb)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare v uuid := _uuid(p, 'id'); pat patients; ex treatment_plans; svc services; start_d date; weeks int; per_week int; v_total int; v_price numeric; v_dates jsonb;
  me_row employees := me(); th uuid; inv uuid;
begin
  perform require_perm('plans', case when v is null then 'create' else 'edit' end);
  select * into pat from patients where id = _uuid(p, 'patientId');
  if pat.id is null or not can_see_patient(pat.id) then raise exception 'اختر المريض'; end if;
  select * into svc from services where id = nullif(p->>'serviceId', '');
  if svc.id is null then raise exception 'اختر الخدمة'; end if;
  -- إجمالي الزيارات = المدة بالأسابيع × الزيارات في الأسبوع — بيتحسب هنا دايمًا، وأي totalSessions جاي من الواجهة بيتجاهل
  weeks := _num(p, 'durationWeeks', 1)::int; per_week := _num(p, 'sessionsPerWeek', 2)::int; v_price := _num(p, 'price', 0);
  if per_week < 1 or per_week > 7 then raise exception 'الزيارات في الأسبوع من 1 إلى 7'; end if;
  if weeks < 1 or weeks > 52 then raise exception 'مدة الخطة من 1 إلى 52 أسبوع'; end if;
  v_total := weeks * per_week;
  if nullif(p->>'patientAge', '') is not null and ((p->>'patientAge')::int < 0 or (p->>'patientAge')::int > 120) then raise exception 'العمر غير صحيح'; end if;
  if v_total > 200 then raise exception 'إجمالي الزيارات ما يزيد عن 200'; end if;
  -- مواعيد الزيارات المعدّلة يدويًا: تتحفظ بس لو عددها = إجمالي الزيارات وكلها تواريخ صحيحة ومرتّبة، وإلا بترجع محسوبة تلقائي (null)
  v_dates := case when jsonb_typeof(p->'sessionDates') = 'array' and jsonb_array_length(p->'sessionDates') = v_total then p->'sessionDates' end;
  if v_dates is not null then
    if exists (select 1 from jsonb_array_elements_text(v_dates) with ordinality a(d, n)
               join jsonb_array_elements_text(v_dates) with ordinality b(d, n) on b.n = a.n + 1 where b.d::date < a.d::date) then
      raise exception 'لازم تكون مواعيد الزيارات بالترتيب — كل زيارة بعد التي قبلها';
    end if;
  end if;
  if v_price < 0 then raise exception 'السعر ما ينفع يكون سالبًا'; end if;
  -- الأخصائي مايحددش سعر: الخطة الجديدة بتتعمل بسعر 0 (طلب للاستقبال/المحاسب)، والتعديل بيحتفظ بالسعر الحالي
  if me_row.role = 'therapist' then v_price := coalesce((select price from treatment_plans where id = v), 0); end if;
  start_d := coalesce(nullif(p->>'startDate', '')::date, riyadh_today());
  th := coalesce(_uuid(p, 'therapistId'), me_row.therapist_id);
  if p->>'status' is not null and p->>'status' not in ('active','completed','paused') then raise exception 'حالة الخطة غير صحيحة'; end if;

  if v is not null then
    select * into ex from treatment_plans where id = v for update;
    if ex.id is null then raise exception 'الخطة غير موجودة'; end if;
    update treatment_plans set service_id = svc.id, diagnosis = _txt(p, 'diagnosis'),
      diagnosis_condition_id = nullif(p #>> '{diagnosisRef,conditionId}', ''), diagnosis_side = nullif(p #>> '{diagnosisRef,side}', ''),
      main_goal = _txt(p, 'mainGoal'), short_term_goals = _txt(p, 'shortTermGoals'), long_term_goals = _txt(p, 'longTermGoals'),
      total_sessions = v_total, sessions_per_week = per_week, duration_weeks = weeks,
      therapy_type = _txt(p, 'therapyType'), exercises = _txt(p, 'exercises'), devices = _txt(p, 'devices'),
      therapist_notes = _txt(p, 'therapistNotes'), notes = _txt(p, 'notes'), price = v_price,
      start_date = start_d, end_date = start_d + weeks * 7, session_dates = v_dates,
      patient_age = nullif(p->>'patientAge', '')::int, pain_onset = nullif(trim(p->>'painOnset'), ''), chief_complaint = _txt(p, 'chiefComplaint'), status = coalesce(nullif(p->>'status', ''), status), therapist_id = th
    where id = v;
  else
    insert into treatment_plans (patient_id, service_id, diagnosis, diagnosis_condition_id, diagnosis_side, main_goal, short_term_goals, long_term_goals,
      total_sessions, sessions_per_week, duration_weeks, therapy_type, exercises, devices, therapist_notes, notes, price, start_date, end_date,
      status, therapist_id, created_by, session_dates, patient_age, pain_onset, chief_complaint)
    values (pat.id, svc.id, _txt(p, 'diagnosis'), nullif(p #>> '{diagnosisRef,conditionId}', ''), nullif(p #>> '{diagnosisRef,side}', ''),
      _txt(p, 'mainGoal'), _txt(p, 'shortTermGoals'), _txt(p, 'longTermGoals'), v_total, per_week, weeks,
      _txt(p, 'therapyType'), _txt(p, 'exercises'), _txt(p, 'devices'), _txt(p, 'therapistNotes'), _txt(p, 'notes'), v_price, start_d, start_d + weeks * 7,
      coalesce(nullif(p->>'status', ''), 'active'), th, me_row.id, v_dates, nullif(p->>'patientAge', '')::int, nullif(trim(p->>'painOnset'), ''), _txt(p, 'chiefComplaint'))
    returning id into v;
    -- دايمًا فاتورة مسودة = طلب للاستقبال/المحاسب (حتى لو الدكتور ماحددش سعر): يحددوا السعر ويحجزوا الزيارات
    inv := new_invoice(pat.id, 'خطة علاج: ' || svc.name || ' (' || v_total || ' زيارات)', v_price, 'draft', start_d, null, null, v, svc.id);
    perform notify_staff('payment_due', case when v_price > 0 then 'فاتورة خطة علاجية بانتظار المراجعة' else 'طلب خطة علاجية: حدد السعر ومواعيد الزيارات' end,
      pat.full_name || ' — ' || svc.name || ' (' || v_total || ' زيارات)', v::text, '/invoices?tab=plans', pat.id);
    -- ربط المواعيد القادمة بالخطة: بس اللي مالهاش فاتورة خاصة بيها ولا باقة ونفس خدمة الخطة.
    -- الموعد اللي ليه فاتورته (مدفوعة أو مستحقة) زيارة مستقلة — ربطه كان بيعدّه زيارة من الخطة («3 من 2 محجوزة») ويخصمها من رصيدها.
    update appointments a set plan_id = v where a.patient_id = pat.id and a.plan_id is null and a.package_id is null and a.date >= start_d
      and a.service_id = svc.id and a.status in ('new','confirmed','on_way','arrived','rescheduled')
      and not exists (select 1 from invoices i where i.appointment_id = a.id and i.status <> 'cancelled');
    perform notify_patient(pat.id, 'plan_new', 'خطة علاجية جديدة', svc.name || ' — ' || v_total || ' زيارات تبدأ ' || start_d, v::text);
  end if;
  perform recalc_plan(v);
  perform log_action(case when ex.id is null then 'إنشاء' else 'تعديل' end || ' خطة علاجية — ' || _txt(p, 'diagnosis') || ' (' || v_total || ' زيارات)', pat.id);
  return jsonb_build_object('id', v);
end $function$;

CREATE OR REPLACE FUNCTION public.save_plan_service(p jsonb)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v uuid := nullif(p->>'id', '')::uuid;
  o jsonb := coalesce(p->'offers', '[]'::jsonb);
  e jsonb;
begin
  perform require_perm('plans', case when v is null then 'create' else 'edit' end);
  if trim(coalesce(p->>'name', '')) = '' then raise exception 'اسم الخدمة مطلوب'; end if;
  if jsonb_typeof(o) <> 'array' then raise exception 'صيغة الأسعار غير صحيحة'; end if;
  for e in select * from jsonb_array_elements(o) loop
    if coalesce((e->>'sessions')::int, 0) < 1 then raise exception 'عدد الزيارات لازم يكون 1 على الأقل'; end if;
    if coalesce((e->>'price')::numeric, -1) < 0 then raise exception 'السعر ما ينفع يكون سالبًا'; end if;
  end loop;
  if (select count(distinct (x->>'sessions')::int) from jsonb_array_elements(o) x) <> jsonb_array_length(o) then
    raise exception 'ما يمكن تكرار نفس عدد الزيارات مرتين';
  end if;
  o := coalesce((select jsonb_agg(jsonb_build_object('sessions', (x->>'sessions')::int, 'price', (x->>'price')::numeric) order by (x->>'sessions')::int)
                 from jsonb_array_elements(o) x), '[]'::jsonb);
  if v is not null then
    update plan_services set name = trim(p->>'name'), active = coalesce((p->>'active')::boolean, true), offers = o where id = v;
    if not found then raise exception 'الخدمة غير موجودة'; end if;
  else
    insert into plan_services (name, offers) values (trim(p->>'name'), o) returning id into v;
  end if;
  perform log_action('حفظ خدمة خطة علاج: ' || trim(p->>'name'));
  return jsonb_build_object('id', v);
end $function$;

CREATE OR REPLACE FUNCTION public.sell_package(p_patient uuid, p_package_plan uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare pp package_plans; v uuid; pts int; inv uuid;
begin
  perform require_perm('packages', 'create');
  select * into pp from package_plans where id = p_package_plan and active;
  if pp.id is null then raise exception 'الباقة غير متاحة'; end if;
  if not exists (select 1 from patients where id = p_patient) then raise exception 'اختر المريض'; end if;
  -- عدد الزيارات بييجي من الكتالوج (ثابت 4 أو 6 للباقات الثابتة) — مفيش أي مدخل يغيّره وقت البيع
  insert into packages (patient_id, name, service_ids, total_sessions, price, start_date, expiry_date, status, kind, plan_id)
  values (p_patient, pp.name, pp.service_ids, pp.total_sessions, pp.price, riyadh_today(), riyadh_today() + pp.valid_days,
          case when pp.kind is not null then 'pending_payment' else 'active' end, pp.kind, pp.id)
  returning id into v;
  inv := new_invoice(p_patient, pp.name, pp.price, 'due', riyadh_today(), null, v, null, null);
  select loyalty_package_points into pts from center_info limit 1;
  perform award_loyalty_points(p_patient, 'package', coalesce(pts, 4), 'نقاط شراء باقة: ' || pp.name, 'package', v);
  perform log_action('بيع ' || pp.name || ' (' || pp.total_sessions || ' زيارات) بقيمة ' || pp.price || ' ج.م'
    || case when pp.kind is not null then ' — بانتظار الدفع' else '' end, p_patient);
  return jsonb_build_object('id', v, 'invoiceId', inv);
end $function$;

CREATE OR REPLACE FUNCTION public.session_diagnosis_save(p_source text, p_id uuid, p_session_no integer, p_text text)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare emp uuid; v_patient uuid; v_total int; v_att int; t text := btrim(coalesce(p_text, '')); ex session_diagnoses;
begin
  emp := require_perm('sessions', 'edit');
  if p_source = 'package' then select patient_id, total_sessions into v_patient, v_total from packages where id = p_id;
  elsif p_source = 'plan' then select patient_id, total_sessions into v_patient, v_total from treatment_plans where id = p_id;
  else raise exception 'مصدر غير صحيح'; end if;
  if v_patient is null then raise exception 'الباقة أو الخطة غير موجودة'; end if;
  if not can_see_patient(v_patient) then raise exception 'ما فيه صلاحية على ملف هذا المريض' using errcode = '42501'; end if;
  if p_session_no is null or p_session_no < 1 or p_session_no > v_total then raise exception 'رقم الزيارة غير صحيح'; end if;
  if t = '' then raise exception 'اكتب التشخيص'; end if;
  if length(t) > 1000 then raise exception 'التشخيص طويل (الحد 1000 حرف)'; end if;
  perform pg_advisory_xact_lock(hashtext('sd:' || p_id::text));
  v_att := session_attended_count(p_source, p_id);
  -- الزيارة الأولى في أي وقت؛ الزيارة N بعد تأكيد حضور الزيارة N-1
  if p_session_no > 1 and v_att < p_session_no - 1 then
    raise exception 'تشخيص الزيارة % بعد تأكيد حضور الزيارة % (المؤكَّد حتى الآن: %)', p_session_no, p_session_no - 1, v_att;
  end if;
  select * into ex from session_diagnoses where source = p_source and source_id = p_id and session_no = p_session_no;
  if ex.id is null then
    insert into session_diagnoses (source, source_id, patient_id, session_no, diagnosis, created_by, updated_by) values (p_source, p_id, v_patient, p_session_no, t, emp, emp);
    perform log_action('تشخيص الزيارة ' || p_session_no, v_patient);
  elsif ex.diagnosis is distinct from t then
    update session_diagnoses set diagnosis = t, updated_by = emp, updated_at = now() where id = ex.id;
    perform log_action('تعديل تشخيص الزيارة ' || p_session_no, v_patient);
  end if;
end $function$;

CREATE OR REPLACE FUNCTION public.target_visits(p_therapist uuid, p_from date, p_to date, p_exclude_due uuid DEFAULT NULL::uuid)
 RETURNS TABLE(appointment_id uuid, visit_date date, visit_time text, appt_status text, file_no text, patient_name text, service_name text, invoice_no text, source text, value_net numeric, collected numeric, payment_status text, counted_elsewhere boolean)
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  with v as (
    select a.id, a.date, a.time, a.status, a.plan_id, a.package_id, a.service_id, a.patient_id
    from appointments a
    where a.date between p_from and p_to and a.status in ('arrived', 'in_progress', 'completed')
      and a.therapist_id = p_therapist
  )
  select v.id, v.date, v.time, v.status, coalesce(p.file_no, ''), coalesce(p.full_name, ''), coalesce(sv.name, ''),
    coalesce(own.no, sh.no),
    case when own.n > 0 then 'visit' when sh.n > 0 then sh.src else 'none' end,
    round(coalesce(case when own.n > 0 then own.net else sh.net end, 0), 2),
    round(coalesce(case when own.n > 0 then own.coll else sh.coll end, 0), 2),
    coalesce(case when own.n > 0 then own.st else sh.st end, 'none'),
    exists (select 1 from payroll_due_visits dv where dv.appointment_id = v.id and dv.due_id is distinct from p_exclude_due)
  from v
  left join patients p on p.id = v.patient_id
  left join services sv on sv.id = v.service_id
  left join lateral (
    select count(*) as n, string_agg(i.no, '، ' order by i.no) as no,
      sum(greatest(i.price - i.discount, 0)) as net,
      sum(case when i.total > 0 then greatest(i.price - i.discount, 0) * least(i.paid / i.total, 1) else 0 end) as coll,
      case when bool_and(i.remaining <= 0) then 'paid' when bool_or(i.paid > 0) then 'partial' else 'due' end as st
    from invoices i where i.appointment_id = v.id and i.status not in ('cancelled', 'draft')
  ) own on true
  left join lateral (
    -- فاتورة واحدة لخطة علاجية أو باقة: الصافي ÷ عدد الزيارات، لأول «عدد الزيارات» زيارة منفذة بس
    select x.n, x.no, x.src, x.net as net, x.coll as coll, x.st
    from (
      select count(*) as n, string_agg(i.no, '، ' order by i.no) as no, 'plan'::text as src, max(tp.total_sessions) as sessions,
        sum(greatest(i.price - i.discount, 0)) as net,
        sum(case when i.total > 0 then greatest(i.price - i.discount, 0) * least(i.paid / i.total, 1) else 0 end) as coll,
        case when bool_and(i.remaining <= 0) then 'paid' when bool_or(i.paid > 0) then 'partial' else 'due' end as st
      from treatment_plans tp join invoices i on i.plan_id = tp.id and i.appointment_id is null and i.status not in ('cancelled', 'draft')
      where tp.id = v.plan_id
      having count(*) > 0
      union all
      select count(*), string_agg(i.no, '، ' order by i.no), 'package', max(pk.total_sessions),
        sum(greatest(i.price - i.discount, 0)),
        sum(case when i.total > 0 then greatest(i.price - i.discount, 0) * least(i.paid / i.total, 1) else 0 end),
        case when bool_and(i.remaining <= 0) then 'paid' when bool_or(i.paid > 0) then 'partial' else 'due' end
      from packages pk join invoices i on i.package_id = pk.id and i.appointment_id is null and i.status not in ('cancelled', 'draft')
      where pk.id = v.package_id and v.plan_id is null
      having count(*) > 0
    ) x
    where (select count(*) from appointments a2
           where a2.status in ('arrived', 'in_progress', 'completed')
             and ((x.src = 'plan' and a2.plan_id = v.plan_id) or (x.src = 'package' and a2.package_id = v.package_id))
             and (a2.date, a2.time, a2.id::text) < (v.date, v.time, v.id::text)) < 1
    limit 1
  ) sh on true
$function$;

CREATE OR REPLACE FUNCTION public.update_payment(p_id uuid, p_amount numeric, p_method text, p_note text)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare pay payments; inv invoices;
begin
  perform require_perm('payments', 'edit');
  select * into pay from payments where id = p_id;
  if pay.id is null then raise exception 'الدفعة غير موجودة'; end if;
  if pay.voided_at is not null then raise exception 'الدفعة ملغاة'; end if;
  select * into inv from invoices where id = pay.invoice_id for update;
  if exists (select 1 from packages where id = inv.package_id and kind is not null) or exists (select 1 from package_installment_requests where invoice_id = inv.id and status in ('pending','approved','rejected')) then
    raise exception 'دفعات باقات الزيارات لا تُعدَّل — استخدم إلغاء الدفعة ثم سجّلها من جديد'; end if;
  if not is_payment_method(p_method) then raise exception 'طريقة الدفع غير صحيحة'; end if;
  if p_amount is null or p_amount <= 0 or p_amount > inv.remaining + pay.amount then
    raise exception 'المبلغ لازم يكون بين 1 و % ج.م', inv.remaining + pay.amount;
  end if;
  update payments set amount = p_amount, method = p_method, note = coalesce(p_note, '') where id = p_id;
  perform recalc_invoice(inv.id);
  perform log_action('تعديل دفعة على ' || inv.no || ' إلى ' || p_amount || ' ج.م', inv.patient_id);
end $function$;

CREATE OR REPLACE FUNCTION public.update_plan_sessions(p_plan uuid, p_total integer)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare pl treatment_plans; done int; booked int; weeks int;
begin
  perform require_any(array['invoices:edit', 'plans:edit']);
  select * into pl from treatment_plans where id = p_plan for update;
  if pl.id is null or not can_see_patient(pl.patient_id) then raise exception 'الخطة غير موجودة'; end if;
  if p_total is null or p_total < 1 or p_total > 52 then raise exception 'عدد الزيارات من 1 إلى 52'; end if;
  select count(*) into done from treatment_sessions where plan_id = p_plan and status = 'completed';
  select count(*) into booked from appointments where plan_id = p_plan and status not in ('cancelled', 'no_show');
  if p_total < greatest(done, booked) then raise exception 'ما ينفع يقل عدد الزيارات عن % (زيارات مكتملة أو محجوزة على الخطة)', greatest(done, booked); end if;
  weeks := greatest(1, ceil(p_total::numeric / greatest(pl.sessions_per_week, 1))::int);
  update treatment_plans set total_sessions = p_total, duration_weeks = weeks, end_date = start_date + weeks * 7, session_dates = null where id = p_plan;
  update invoices set service_name = regexp_replace(service_name, '\(\d+ زيارات\)', '(' || p_total || ' زيارات)')
   where plan_id = p_plan and status = 'draft';
  update invoice_items ii set description = i.service_name from invoices i where ii.invoice_id = i.id and i.plan_id = p_plan and i.status = 'draft';
  perform recalc_plan(p_plan);
  perform log_action('تعديل عدد زيارات الخطة العلاجية إلى ' || p_total, pl.patient_id);
  return jsonb_build_object('total', p_total);
end $function$;

CREATE OR REPLACE FUNCTION public.update_session(p_id uuid, p jsonb)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare s treatment_sessions; v_scale int;
begin
  perform require_perm('sessions', 'edit');
  select * into s from treatment_sessions where id = p_id for update;
  if s.id is null or not can_see_patient(s.patient_id) then raise exception 'الزيارة غير موجودة'; end if;
  if p ? 'painScale' and nullif(p->>'painScale', '') is not null then
    if (p->>'painScale') !~ '^-?\d+$' then raise exception 'لازم يكون مقياس الألم رقم صحيح من 1 إلى 10'; end if;
    v_scale := (p->>'painScale')::int;
    if v_scale < 1 or v_scale > 10 then raise exception 'لازم يكون مقياس الألم من 1 إلى 10'; end if;
  end if;
  if p ? 'painLevel' and nullif(p->>'painLevel', '') is not null and ((p->>'painLevel')::int < 0 or (p->>'painLevel')::int > 10) then
    raise exception 'مستوى الألم من 0 إلى 10';
  end if;
  if length(coalesce(p->>'subject', '')) > 300 then raise exception 'الموضوع (Subject) أطول من المسموح (300 حرف)'; end if;
  update treatment_sessions set
    subject = case when p ? 'subject' then trim(coalesce(p->>'subject', '')) else subject end,
    pain_scale = coalesce(v_scale, pain_scale),
    pain_level = case when v_scale is not null then v_scale when p ? 'painLevel' then nullif(p->>'painLevel', '')::int else pain_level end,
    therapist_notes = coalesce(p->>'therapistNotes', therapist_notes), treatment_used = coalesce(p->>'treatmentUsed', treatment_used),
    devices_used = coalesce(p->>'devicesUsed', devices_used), exercises = coalesce(p->>'exercises', exercises),
    patient_response = coalesce(p->>'patientResponse', patient_response), next_plan = coalesce(p->>'nextPlan', next_plan)
  where id = p_id;
  perform log_action('تحديث بيانات الزيارة رقم ' || s.session_no, s.patient_id);
end $function$;

CREATE OR REPLACE FUNCTION public.void_package_payment(p_id uuid, p_reason text)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare emp uuid; pay payments; inv invoices; pk packages;
begin
  emp := require_perm('installments', 'edit');
  select * into pay from payments where id = p_id for update;
  if pay.id is null then raise exception 'الدفعة غير موجودة'; end if;
  if pay.voided_at is not null then raise exception 'الدفعة ملغاة بالفعل'; end if;
  if nullif(trim(coalesce(p_reason, '')), '') is null then raise exception 'اكتب سبب إلغاء الدفعة'; end if;
  select * into inv from invoices where id = pay.invoice_id for update;
  select * into pk from packages where id = inv.package_id;
  if pk.kind is null and not exists (select 1 from package_installment_requests where invoice_id = inv.id and status in ('approved','rejected','pending')) then
    raise exception 'الإلغاء بالسجل مخصص لدفعات الباقات وفواتير التقسيط'; end if;
  if pk.kind is not null and pk.used_sessions > 0 then raise exception 'ما يمكن إلغاء الدفعة — تم استخدام % زيارة من الباقة', pk.used_sessions; end if;
  -- الدفعة الأولى مايتلغيش وفيه دفعة تانية سارية
  if pay.installment_no = 1 and exists (select 1 from payments where invoice_id = inv.id and installment_no = 2 and voided_at is null) then
    raise exception 'ألغِ الدفعة الثانية أولًا'; end if;
  update payments set voided_at = now(), voided_by = emp, void_reason = trim(p_reason) where id = p_id;
  perform recalc_invoice(inv.id);
  perform log_action('إلغاء دفعة ' || pay.amount || ' ج.م من ' || inv.no || ' — السبب: ' || trim(p_reason), inv.patient_id);
end $function$;

