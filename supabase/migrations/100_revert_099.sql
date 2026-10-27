-- إلغاء هجرة 099 (طلب الإدارة 2026-10-08): رجوع نظام الفواتير/الحضور لما كان عليه قبلها.
-- التعريفات الأصلية مأخوذة من القاعدة قبل تطبيق 099 مباشرة. البيانات الحالية ماتمسحتش (الأعمدة المضافة كانت فاضية).
drop function if exists create_session_invoice(jsonb), session_check_in(uuid, text), checkin_cancel(uuid, text),
  checkin_log(date, date, uuid, uuid), checkin_search(text), patient_by_file_no(text), package_balance_json(packages), norm_file_no(text);
delete from role_permissions where area = 'checkin';
drop policy if exists staff_read on package_checkins;
create policy staff_read on package_checkins for select using (has_perm('appointments', 'view') and can_see_patient(patient_id));

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
  if s.id is null or not can_see_patient(s.patient_id) then raise exception 'الجلسة غير موجودة'; end if;
  if s.status = 'completed' then raise exception 'الجلسة مكتملة بالفعل'; end if;
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
          perform notify_staff('package_low', 'باقة قاربت على النفاد', (select full_name from patients where id = pkg.patient_id) || ': تبقّى ' || left_n || ' جلسة', pkg.id::text, '/patients/' || pkg.patient_id, pkg.patient_id);
        end if;
      end if;
    end if;
  end if;
  if s.plan_id is not null then perform recalc_plan(s.plan_id); end if;
  select loyalty_session_points into pts from center_info limit 1;
  perform award_loyalty_points(s.patient_id, 'session', coalesce(pts, 2), 'نقاط إتمام جلسة/كشف', 'session', s.id);
  perform notify_patient(s.patient_id, 'session_completed', 'اكتملت جلستك', 'تم تسجيل إكمال الجلسة رقم ' || s.session_no || ' — شكرًا لالتزامك', s.id::text);
  perform log_action('إكمال الجلسة رقم ' || s.session_no, s.patient_id);
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
  if s.id is null then raise exception 'الجلسة غير موجودة'; end if;
  select * into a from appointments where id = s.appointment_id;
  if a.id is not null and s.status = 'completed' then
    update appointments set status = 'arrived' where id = a.id;
    if a.package_id is not null then
      update packages set used_sessions = greatest(used_sessions - 1, 0), status = case when status = 'completed' then 'active' else status end where id = a.package_id;
    end if;
  end if;
  if s.status = 'completed' then perform reverse_loyalty_points('session', s.id, 'إلغاء نقاط جلسة محذوفة رقم ' || s.session_no); end if;
  delete from treatment_sessions where id = p_id;
  if s.plan_id is not null then
    perform recalc_plan(s.plan_id);
    update treatment_plans set status = 'active' where id = s.plan_id and status = 'completed'
      and (select count(*) from treatment_sessions where plan_id = s.plan_id and status = 'completed') < total_sessions;
  end if;
  perform log_action('حذف الجلسة رقم ' || s.session_no, s.patient_id);
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
end $function$;

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
    -- الدكتور لازم يكون فاضي دلوقتي (رسالة واضحة بدل رسالة تعارض الحجز)
    if exists (select 1 from appointments x where x.therapist_id = th and x.date = riyadh_today() and x.status <> 'cancelled'
        and (to_char(now() at time zone 'Africa/Cairo', 'HH24:MI'))::time < x.time::time + make_interval(mins => x.duration_min)
        and x.time::time < (to_char(now() at time zone 'Africa/Cairo', 'HH24:MI'))::time + make_interval(mins => svc.duration_min))
    then raise exception 'الدكتور عنده موعد في هذا الوقت — اختر دكتورًا آخر للزيارة المباشرة'; end if;
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
end $function$;

CREATE OR REPLACE FUNCTION public.cancel_invoice(p_invoice uuid)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare inv invoices;
begin
  perform require_perm('invoices', 'edit');
  select * into inv from invoices where id = p_invoice for update;
  if inv.id is null then raise exception 'الفاتورة غير موجودة'; end if;
  if inv.paid > 0 then raise exception 'على الفاتورة مدفوعات. احذف الدفعات أولًا'; end if;
  if inv.discount_code_id is not null then update discount_codes set used_count = greatest(used_count - 1, 0) where id = inv.discount_code_id; end if;
  update invoices set status = 'cancelled' where id = p_invoice;
  perform log_action('إلغاء الفاتورة ' || inv.no, inv.patient_id);
end $function$;

CREATE OR REPLACE FUNCTION public.delete_invoice(p_invoice uuid)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare inv invoices; n_pay int;
begin
  perform require_perm('invoices', 'delete');
  select * into inv from invoices where id = p_invoice for update;
  if inv.id is null then raise exception 'الفاتورة غير موجودة'; end if;
  if exists (select 1 from zatca_documents where invoice_id = p_invoice and status <> 'awaiting') then
    raise exception 'الفاتورة % اتبعتت لهيئة الزكاة — لا يمكن حذفها (ألغِها ليصدر إشعار دائن)', inv.no;
  end if;
  delete from zatca_documents where invoice_id = p_invoice;
  select count(*) into n_pay from payments where invoice_id = p_invoice;
  if inv.discount_code_id is not null then update discount_codes set used_count = greatest(used_count - 1, 0) where id = inv.discount_code_id; end if;
  delete from invoices where id = p_invoice; -- الدفعات وبنود الفاتورة وطلبات التقسيط بتتحذف تلقائيًا (cascade)
  perform log_action('حذف الفاتورة ' || inv.no || case when n_pay > 0 then ' مع ' || n_pay || ' دفعة' else '' end, inv.patient_id);
end $function$;

drop index if exists package_checkins_request_uk, package_checkins_session_uk, package_checkins_created_idx, packages_patient_status_idx;
alter table package_checkins drop column if exists service_id, drop column if exists invoice_id, drop column if exists request_id,
  drop column if exists cancelled_at, drop column if exists cancelled_by, drop column if exists cancel_reason;
alter table package_checkins alter column appointment_id set not null;
alter table packages drop column if exists invoice_id, drop column if exists service_id, drop column if exists created_by, drop column if exists created_at;
alter table invoices drop constraint if exists invoices_payment_method_chk;
alter table invoices drop column if exists payment_method;
