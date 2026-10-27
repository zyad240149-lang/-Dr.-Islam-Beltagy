-- 129: زرار «إكمال الجلسة التالية» في الخطة (complete_next_plan_session) كان بيعمل جلسات من غير موعد،
-- فالدكتور عمل جلستين في نفس الدقيقة ومحدش وقفه. دلوقتي العدّ الموحّد بيشمل الجلسات اللي من غير موعد كمان،
-- وبيتطبّق في: التريجر على المواعيد + حضور الباقات + إكمال الجلسة التالية.
create or replace function patient_day_sessions(p_patient uuid, p_date date, p_exclude uuid default null) returns int
language sql stable security definer set search_path = public as $$
  select (select count(*) from appointments x where x.patient_id = p_patient and x.date = p_date and x.id is distinct from p_exclude
            and x.status in ('arrived', 'in_progress', 'completed') and (x.plan_id is not null or x.package_id is not null))::int
       + (select count(*) from treatment_sessions s where s.patient_id = p_patient and s.date = p_date and s.appointment_id is null
            and s.status in ('in_progress', 'completed'))::int
$$;
create or replace function patient_day_last(p_patient uuid, p_date date) returns timestamptz
language sql stable security definer set search_path = public as $$
  select greatest(
    (select max(coalesce((select max(c.created_at) from package_checkins c where c.appointment_id = x.id), x.updated_at)) from appointments x
      where x.patient_id = p_patient and x.date = p_date and x.status in ('arrived', 'in_progress', 'completed') and (x.plan_id is not null or x.package_id is not null)),
    (select max(coalesce(s.completed_at, s.started_at)) from treatment_sessions s where s.patient_id = p_patient and s.date = p_date and s.appointment_id is null and s.status in ('in_progress', 'completed')))
$$;
revoke execute on function patient_day_sessions(uuid, date, uuid) from public, anon, authenticated;
revoke execute on function patient_day_last(uuid, date) from public, anon, authenticated;

create or replace function guard_second_session_day() returns trigger
language plpgsql security definer set search_path = public as $$
declare cnt int;
begin
  if new.plan_id is null and new.package_id is null then return new; end if;
  if new.status not in ('arrived', 'in_progress', 'completed') then return new; end if;
  if tg_op = 'UPDATE' and old.status in ('arrived', 'in_progress', 'completed') then return new; end if;
  perform pg_advisory_xact_lock(hashtext('pt-day:' || new.patient_id::text || new.date::text));
  cnt := patient_day_sessions(new.patient_id, new.date, new.id);
  if cnt >= 2 then raise exception 'الحد الأقصى جلستين في اليوم للمريض'; end if;
  if cnt = 1 and coalesce(current_setting('app.second_ok', true), '') <> 'on'
     and not exists (select 1 from employees e where e.auth_user_id = auth.uid() and e.active and e.role in ('system_admin', 'center_manager')) then
    raise exception 'المريض حضر جلسة النهارده بالفعل — الجلسة التانية محتاجة موافقة المدير (من «حضور مرضى الباقات» ← «طلب جلسة ثانية اليوم»)' using errcode = '42501';
  end if;
  return new;
end $$;
revoke execute on function guard_second_session_day() from public, anon, authenticated;

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
  if v_status <> 'active' then raise exception 'الباقة/الخطة غير فعّالة (%)', v_status; end if;
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
revoke execute on function attendance_check_in(text, uuid, uuid, uuid, boolean) from public, anon;
grant execute on function attendance_check_in(text, uuid, uuid, uuid, boolean) to authenticated;

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
    select id into nxt from appointments where plan_id = p_plan and status in ('new','confirmed','on_way','rescheduled','arrived') order by date, time limit 1;
    if nxt is not null then sid := (start_session(nxt)->>'id')::uuid;
    else
      insert into treatment_sessions (patient_id, therapist_id, plan_id, session_no, date, status, started_at)
      values (pl.patient_id, pl.therapist_id, p_plan, (select count(*) + 1 from treatment_sessions where patient_id = pl.patient_id), riyadh_today(), 'in_progress', now())
      returning id into sid;
    end if;
  end if;
  perform complete_session(sid, '{}');
  return jsonb_build_object('index', done + 1, 'total', pl.total_sessions);
end $function$;

-- الطلب متاح كمان لو الجلسة الأولى اتعملت من غير موعد
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
  elsif p_source = 'plan' then select patient_id, 'خطة علاج ' || total_sessions || ' جلسات' into v_patient, v_name from treatment_plans where id = p_id;
  else raise exception 'نوع غير معروف'; end if;
  if v_patient is null then raise exception 'الباقة/الخطة غير موجودة'; end if;
  if not can_see_patient(v_patient) then raise exception 'لا توجد صلاحية على ملف هذا المريض' using errcode = '42501'; end if;
  if p_therapist is null then raise exception 'اختر الدكتور للجلسة الثانية'; end if;
  if patient_day_sessions(v_patient, riyadh_today(), null) = 0 then
    raise exception 'المريض لسه ماحضرش جلسة النهارده — سجّل الحضور العادي'; end if;
  if exists (select 1 from second_session_requests r where r.patient_id = v_patient and r.status = 'pending') then
    raise exception 'فيه طلب جلسة ثانية بانتظار موافقة المدير بالفعل'; end if;
  insert into second_session_requests (source, ref_id, patient_id, therapist_id, note, requested_by)
  values (p_source, p_id, v_patient, p_therapist, trim(coalesce(p_note, '')), emp) returning id into v;
  perform notify_staff('staff_request', 'طلب جلسة ثانية اليوم بانتظار موافقتك',
    (select full_name from patients where id = v_patient) || ' — ' || v_name, v::text, '/package-checkin', v_patient);
  perform log_action('طلب جلسة ثانية اليوم — ' || v_name, v_patient);
  return v;
end $function$;
