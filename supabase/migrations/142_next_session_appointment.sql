-- 142: عرض موعد الجلسة القادمة بدقة + «اكتمال الجلسة»/الحضور مابيستهلكوش موعد مستقبلي بتاريخه.
-- المشكلة: زرار «اكتمال الجلسة» كان بيختار أقرب موعد للخطة (حتى لو بعد أسبوع) ويعلّمه «مكتمل» بتاريخه المستقبلي،
-- فالمواعيد القادمة بتختفي من الكارت («لا يوجد موعد محجوز») وبتظهر مكتملة في المستقبل. والحضور المباشر كان بيسيب المواعيد القادمة زي ما هي.
-- الحل: plan_take_next_appointment بتقدّم أقرب موعد قادم للخطة/الباقة لليوم (بالوقت الحالي) وتستخدمه الجلسة والحضور.
-- + «حضور مرضى الباقات» بيرجّع الموعد القادم (next) + لما الخطة تكتمل أي موعد قادم متبقي لها بيتلغي.

create or replace function plan_take_next_appointment(p_source text, p_id uuid) returns uuid
language plpgsql security definer set search_path = public as $$
declare a appointments; v_time time;
begin
  select * into a from appointments x
   where x.date > riyadh_today() and x.status in ('new', 'confirmed', 'rescheduled', 'on_way')
     and ((p_source = 'plan' and x.plan_id = p_id) or (p_source = 'package' and x.package_id = p_id))
   order by x.date, x.time limit 1 for update;
  if a.id is null then return null; end if;
  v_time := (to_char(now() at time zone 'Africa/Cairo', 'HH24:MI'))::time;
  while a.therapist_id is not null and exists (select 1 from appointments x where x.therapist_id = a.therapist_id and x.date = riyadh_today()
        and x.time = to_char(v_time, 'HH24:MI') and x.status not in ('cancelled', 'rescheduled') and x.id <> a.id) loop
    v_time := v_time + interval '1 minute'; end loop;
  perform set_config('app.allow_overlap', 'on', true);
  update appointments set date = riyadh_today(), time = to_char(v_time, 'HH24:MI'), updated_at = now(),
         notes = trim(both ' ' from coalesce(notes, '') || ' — اتقدّم من ' || a.date::text) where id = a.id;
  return a.id;
end $$;
revoke execute on function plan_take_next_appointment(text, uuid) from public, anon, authenticated;

create or replace function cancel_leftover_plan_appointments() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if new.status = 'completed' and old.status is distinct from 'completed' then
    update appointments set status = 'cancelled', updated_at = now()
     where plan_id = new.id and date >= riyadh_today() and status in ('new', 'confirmed', 'rescheduled', 'on_way');
  end if;
  return new;
end $$;
revoke execute on function cancel_leftover_plan_appointments() from public, anon, authenticated;
drop trigger if exists plans_cancel_leftover on treatment_plans;
create trigger plans_cancel_leftover after update of status on treatment_plans for each row execute function cancel_leftover_plan_appointments();
update appointments a set status = 'cancelled', updated_at = now()
 where a.plan_id in (select id from treatment_plans where status = 'completed') and a.date >= riyadh_today() and a.status in ('new', 'confirmed', 'rescheduled', 'on_way');

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
                order by (c.id is not null) desc, a.time limit 1),
      'next', (select jsonb_build_object('appointmentId', n.id, 'no', n.no, 'date', n.date, 'time', n.time, 'status', n.status, 'doctor', (select name from therapists where id = n.therapist_id))
                from appointments n where n.patient_id = p.id and n.date > riyadh_today() and n.status in ('new', 'confirmed', 'rescheduled', 'on_way') and n.plan_id = pl.id order by n.date, n.time limit 1)
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
end $function$
;

CREATE OR REPLACE FUNCTION public.complete_next_plan_session(p_plan uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare pl treatment_plans; done int; sid uuid; nxt uuid; v_day int; v_last timestamptz;
begin
  perform require_any(array['sessions:edit', 'plans:edit']);
  select * into pl from treatment_plans where id = p_plan;
  if pl.id is null or not can_see_patient(pl.patient_id) then raise exception 'الخطة غير موجودة'; end if;
  select count(*) into done from treatment_sessions where plan_id = p_plan and status = 'completed';
  if done >= pl.total_sessions then raise exception 'كل جلسات الخطة مكتملة بالفعل'; end if;
  -- نفس قاعدة اليوم: جلسة واحدة للمريض في اليوم، والتانية بموافقة المدير وبعد ساعة، وحد أقصى جلستين
  v_day := patient_day_sessions(pl.patient_id, riyadh_today(), null); v_last := patient_day_last(pl.patient_id, riyadh_today());
  if v_day >= 2 then raise exception 'الحد الأقصى جلستين في اليوم للمريض'; end if;
  if v_day = 1 and not exists (select 1 from employees e where e.auth_user_id = auth.uid() and e.active and e.role in ('system_admin', 'center_manager')) then
    raise exception 'المريض أخد جلسة النهارده بالفعل — الجلسة التانية محتاجة موافقة المدير (من «حضور مرضى الباقات» ← «طلب جلسة ثانية اليوم»)' using errcode = '42501'; end if;
  if v_day = 1 and v_last > now() - interval '60 minutes' then
    raise exception 'مينفعش جلستين ورا بعض — الجلسة التانية متاحة بعد % دقيقة', ceil(extract(epoch from (v_last + interval '60 minutes' - now())) / 60)::int; end if;
  if v_day = 1 then perform set_config('app.second_ok', 'on', true); end if;
  select id into sid from treatment_sessions where plan_id = p_plan and status in ('in_progress','scheduled') order by session_no limit 1;
  if sid is null then
    select id into nxt from appointments where plan_id = p_plan and date <= riyadh_today() and status in ('new','confirmed','on_way','rescheduled','arrived') order by date desc, time limit 1;
    -- مفيش موعد النهارده: الجلسة بتاخد أقرب موعد قادم للخطة وبيتقدّم لليوم (مش بيتعلّم «مكتمل» بتاريخ مستقبلي)
    if nxt is null then nxt := plan_take_next_appointment('plan', p_plan); end if;
    if nxt is not null then sid := (start_session(nxt)->>'id')::uuid;
    else
      insert into treatment_sessions (patient_id, therapist_id, plan_id, session_no, date, status, started_at)
      values (pl.patient_id, pl.therapist_id, p_plan, (select count(*) + 1 from treatment_sessions where patient_id = pl.patient_id), riyadh_today(), 'in_progress', now())
      returning id into sid;
    end if;
  end if;
  perform complete_session(sid, '{}');
  return jsonb_build_object('index', done + 1, 'total', pl.total_sessions);
end $function$
;

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
    v_name := 'خطة علاج ' || pln.total_sessions || ' جلسات';
    select count(*)::int into v_used from treatment_sessions where plan_id = pln.id and status = 'completed';
  else raise exception 'نوع غير معروف'; end if;
  if not can_see_patient(v_patient) then raise exception 'لا توجد صلاحية على ملف هذا المريض' using errcode = '42501'; end if;
  if v_status <> 'active' then raise exception 'الباقة/الخطة غير فعّالة (%)', pkg_status_ar(v_status); end if;
  if v_expiry is not null and v_expiry < riyadh_today() then raise exception 'الباقة/الخطة منتهية الصلاحية بتاريخ %', v_expiry; end if;
  select count(*)::int into pend from appointments x where x.status in ('arrived', 'in_progress') and ((p_source = 'package' and x.package_id = p_id) or (p_source = 'plan' and x.plan_id = p_id));
  if v_used + pend >= v_total then raise exception 'اكتملت جلسات الباقة — لا توجد جلسات متبقية'; end if;
  -- جلسة واحدة للمريض في اليوم (على أي خطة أو باقة، ومن أي شاشة)؛ التانية بموافقة المدير وبعد ساعة، وحد أقصى جلستين
  v_today := patient_day_sessions(v_patient, riyadh_today(), null);
  v_last := patient_day_last(v_patient, riyadh_today());
  if v_today >= 2 then raise exception 'الحد الأقصى جلستين في اليوم للمريض'; end if;
  if v_today = 1 and not coalesce(p_second, false) then raise exception 'المريض حضر جلسة النهارده بالفعل — لجلسة تانية ابعت «طلب جلسة ثانية اليوم» للمدير'; end if;
  if v_today = 1 and not exists (select 1 from employees e where e.id = emp and e.role in ('system_admin', 'center_manager')) then
    raise exception 'الجلسة التانية في نفس اليوم محتاجة موافقة المدير — ابعت «طلب جلسة ثانية اليوم»' using errcode = '42501'; end if;
  if v_today = 1 and v_last > now() - interval '60 minutes' then
    raise exception 'مينفعش جلستين ورا بعض — الجلسة التانية متاحة بعد % دقيقة', ceil(extract(epoch from (v_last + interval '60 minutes' - now())) / 60)::int; end if;
  if v_today = 1 then perform set_config('app.second_ok', 'on', true); end if;
  if v_today = 1 then p_appointment := null; end if; -- الجلسة التانية زيارة مباشرة أو موعد تاني اليوم

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

  v_no := v_used + pend + 1; -- رقم الجلسة محسوب من السجل الفعلي
  insert into package_checkins (package_id, plan_id, patient_id, appointment_id, checked_in_by, session_no)
  values (case when p_source = 'package' then p_id end, case when p_source = 'plan' then p_id end, v_patient, a.id, emp, v_no) returning id into v_id;
  perform set_appointment_status(a.id, 'arrived', null, null);
  if p_source = 'plan' then perform attendance_plan_session(a.id, p_id, v_no); end if; -- الحضور بيتسجّل جلسة في الخطة العلاجية
  perform log_action('تسجيل حضور — ' || v_name || ' (الجلسة ' || v_no || ' من ' || v_total || ')' || case when walk then ' — زيارة مباشرة' else '' end, v_patient);
  return jsonb_build_object('id', v_id, 'sessionNo', v_no, 'total', v_total, 'remaining', greatest(v_total - v_used - pend - 1, 0), 'walkIn', walk);
end $function$
;
