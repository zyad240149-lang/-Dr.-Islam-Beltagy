-- الدكتور إجباري في كل حجز (طلب الإدارة 2026-10-06): NO DOCTOR = NO AVAILABLE TIMES = NO BOOKING
-- يلغي هجرتي 063/069 (حجز بدون طبيب). المواعيد المتاحة = ساعات المركز + العطلات + إجازة الطبيب + حجوزات الطبيب نفسه.
-- المواعيد القديمة اللي من غير طبيب بتفضل زي ما هي (بيانات تاريخية) — لكن مفيش حجز جديد من غير طبيب.

-- ===== 1) نقطة الفحص المشتركة: رسالة واضحة + تحقق من الطبيب قبل أي حاجة =====
CREATE OR REPLACE FUNCTION public.check_slot(p_therapist uuid, p_date date, p_time text, p_dur integer, p_exclude uuid DEFAULT NULL::uuid)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare d text := lower(to_char(p_date, 'Dy')); sched jsonb; th therapists; br uuid;
begin
  if p_therapist is null then raise exception 'يجب اختيار الدكتور قبل تأكيد الحجز.'; end if;
  select * into th from therapists where id = p_therapist;
  if th.id is null or not th.active then raise exception 'الدكتور غير موجود أو غير نشط — اختر دكتورًا آخر'; end if;
  if p_time !~ '^\d{2}:\d{2}$' then raise exception 'صيغة الوقت غير صحيحة'; end if;
  if p_date < riyadh_today() then raise exception 'لا يمكن الحجز في تاريخ سابق'; end if;
  select e.value into sched from center_info c, jsonb_array_elements(c.week_schedule) e where e.value->>'day' = d limit 1;
  if sched is null or not coalesce((sched->>'open')::boolean, false) then raise exception 'المركز مغلق في هذا اليوم'; end if;
  if p_time < sched->>'from' or p_time > sched->>'to' then raise exception 'الوقت خارج ساعات عمل المركز (% - %)', sched->>'from', sched->>'to'; end if;

  br := th.branch_id;
  if exists (select 1 from holidays where date = p_date and active and (branch_id is null or branch_id = br)) then
    raise exception 'المركز مغلق في هذا اليوم — اختر يومًا آخر';
  end if;
  if exists (select 1 from jsonb_array_elements(th.on_leave) l where p_date between (l.value->>'from')::date and (l.value->>'to')::date)
     or exists (select 1 from staff_requests r join employees e on e.id = r.employee_id
                where e.therapist_id = p_therapist and r.status = 'approved' and r.type = 'leave' and p_date between r.from_date and r.to_date) then
    raise exception 'الدكتور في إجازة في هذا التاريخ';
  end if;

  -- قفل لكل (دكتور + يوم): حجزين في نفس اللحظة بيتنفذوا واحد ورا التاني، والتاني بيشوف حجز الأول ويترفض
  perform pg_advisory_xact_lock(hashtext(p_therapist::text || p_date::text));
  if exists (select 1 from appointments a
             where a.therapist_id = p_therapist and a.date = p_date and a.status <> 'cancelled' and a.id is distinct from p_exclude
               and p_time::time < a.time::time + make_interval(mins => a.duration_min)
               and a.time::time < p_time::time + make_interval(mins => p_dur)) then
    raise exception 'عذرًا، هذا الموعد تم حجزه للتو. يرجى اختيار موعد آخر.';
  end if;
end $function$;

-- ===== 2) تحقق موحّد من (الدكتور + الخدمة + الفرع) — بيستخدمه كل مسارات إنشاء الحجز =====
create or replace function assert_booking_doctor(p_therapist uuid, p_service text, p_branch uuid default null) returns void
language plpgsql stable security definer set search_path = public as $$
declare th therapists;
begin
  if p_therapist is null then raise exception 'يجب اختيار الدكتور قبل تأكيد الحجز.'; end if;
  select * into th from therapists where id = p_therapist;
  if th.id is null then raise exception 'الدكتور المختار غير صحيح.'; end if;
  if not th.active then raise exception 'الدكتور المختار غير متاح حاليًا — اختر دكتورًا آخر'; end if;
  if not exists (select 1 from therapist_services ts where ts.therapist_id = p_therapist and ts.service_id = p_service) then
    raise exception 'الدكتور % لا يقدّم هذه الخدمة — اختر دكتورًا آخر أو خدمة أخرى', th.name;
  end if;
  if p_branch is not null and th.branch_id is not null and th.branch_id <> p_branch then
    raise exception 'الدكتور % غير مرتبط بالفرع المختار', th.name;
  end if;
end $$;
revoke execute on function assert_booking_doctor(uuid, text, uuid) from public, anon, authenticated;

-- ===== 3) حجز الإدارة (الاستقبال/الهاتف): therapistId إجباري =====
CREATE OR REPLACE FUNCTION public.book_appointment(p jsonb)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare svc services; pat patients; th uuid := _uuid(p, 'therapistId'); d date; tm text := _txt(p, 'time');
  loc text := _txt(p, 'location', 'center'); plan treatment_plans; pkg uuid := _uuid(p, 'packageId'); a appointments; v_price numeric; v_branch uuid;
begin
  perform require_any(array['booking:create', 'appointments:create']);
  select * into pat from patients where id = _uuid(p, 'patientId');
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
  perform check_slot(th, d, tm, svc.duration_min, null);
  v_price := effective_price(svc.id, th, _uuid(p, 'priceId'));
  v_branch := coalesce(_uuid(p, 'branchId'), (select branch_id from therapists where id = th), (select id from branches order by created_at limit 1));

  if pkg is not null and not exists (select 1 from packages where id = pkg and patient_id = pat.id and status = 'active' and used_sessions < total_sessions) then
    raise exception 'الباقة غير صالحة لهذا المريض';
  end if;
  if p ? 'planId' then select * into plan from treatment_plans where id = _uuid(p, 'planId') and patient_id = pat.id;
  else select * into plan from treatment_plans where id = active_plan_id(pat.id); end if;

  insert into appointments (no, patient_id, type, service_id, therapist_id, location, address, date, time, duration_min, status, price,
                            package_id, plan_id, series_id, branch_id, created_by, notes)
  values (next_counter('appointment', 'MV-'), pat.id, case when loc = 'home' then 'home' else _txt(p, 'type', 'session') end, svc.id, th, loc,
          case when loc = 'home' then _txt(p, 'address') else '' end, d, tm, svc.duration_min, 'new', v_price,
          pkg, plan.id, _uuid(p, 'seriesId'), v_branch, my_employee_id(), _txt(p, 'notes'))
  returning * into a;

  if pkg is null and not coalesce(plan.price, 0) > 0 then
    perform new_invoice(pat.id, svc.name, v_price, 'due', d, a.id, null, null, svc.id);
  end if;
  perform notify_staff('appointment_new', case when loc = 'home' then 'تم حجز زيارة منزلية' else 'تم إنشاء موعد جديد' end,
    pat.full_name || ' — ' || svc.name || ' — ' || d || ' ' || tm, a.no, '/appointments', pat.id);
  perform notify_patient(pat.id, 'appointment_new', 'تم حجز موعدك', svc.name || ' يوم ' || d || ' الساعة ' || tm, a.id::text);
  perform log_action('حجز موعد ' || a.no || ' — ' || svc.name || ' بتاريخ ' || d || ' ' || tm, pat.id);
  return jsonb_build_object('id', a.id, 'no', a.no);
end $function$;

-- ===== 4) حجز المريض بنفسه: therapistId إجباري + التحقق من توفر الدكتور نفسه =====
create or replace function patient_book(p jsonb) returns jsonb
language plpgsql security definer set search_path = public as $$
declare c customers; pat patients; svc services; th uuid := _uuid(p, 'therapistId'); d date := nullif(p->>'date', '')::date; tm text := _txt(p, 'time'); a appointments; v_price numeric; bs booking_settings; v_doc text;
begin
  c := require_patient();
  select * into pat from patients where id = c.patient_id;
  if not pat.active then raise exception 'ملفك غير نشط — تواصل مع المركز'; end if;
  select bst.* into bs from booking_settings bst order by created_at limit 1;
  if bs.id is not null and not bs.allow_online_booking then raise exception 'الحجز الإلكتروني موقوف حاليًا — تواصل مع المركز للحجز'; end if;
  if bs.id is not null and d is not null and d > riyadh_today() + bs.max_future_booking_days then
    raise exception 'لا يمكن الحجز لأكثر من % يومًا مقدمًا', bs.max_future_booking_days;
  end if;
  select * into svc from services where id = _txt(p, 'serviceId');
  if svc.id is null or not svc.active then raise exception 'الخدمة غير موجودة أو موقوفة'; end if;
  perform assert_booking_doctor(th, svc.id, null);
  if d is null then raise exception 'اختر التاريخ'; end if;
  if tm !~ '^\d{2}:\d{2}$' then raise exception 'اختر الوقت'; end if;
  if d < riyadh_today() then raise exception 'لا يمكن الحجز في تاريخ سابق'; end if;
  if d = riyadh_today() and tm <= to_char(now() at time zone 'Africa/Cairo', 'HH24:MI') then raise exception 'الوقت ده فات — اختر وقت لاحق'; end if;
  if (select count(*) from appointments where patient_id = pat.id and status in ('new','confirmed','rescheduled') and date >= riyadh_today()) >= 5 then
    raise exception 'وصلت للحد الأقصى من المواعيد القادمة (5). تواصل مع المركز لتعديلها';
  end if;
  -- مركز مفتوح + عطلات + إجازة الدكتور + عدم تعارضه مع حجز تاني لنفس الدكتور (بقفل ذرّي)
  perform check_slot(th, d, tm, svc.duration_min, null);
  v_price := effective_price(svc.id, th, _uuid(p, 'priceId'));
  insert into appointments (no, patient_id, customer_id, type, service_id, therapist_id, location, address, date, time, duration_min, status, price, branch_id, notes)
  values (next_counter('appointment', 'MV-'), pat.id, c.id, 'session', svc.id, th, 'center', '', d, tm, svc.duration_min, 'new', v_price,
          coalesce((select branch_id from therapists where id = th), (select id from branches order by created_at limit 1)), _txt(p, 'notes'))
  returning * into a;
  select name into v_doc from therapists where id = th;
  if not exists (select 1 from treatment_plans where patient_id = pat.id and status = 'active' and treatment_plans.price > 0) then
    perform new_invoice(pat.id, svc.name, v_price, 'due', d, a.id, null, null, svc.id);
  end if;
  perform notify_staff('appointment_new', 'حجز جديد من المريض', pat.full_name || ' — ' || svc.name || ' — ' || v_doc || ' — ' || d || ' ' || tm, a.no, '/appointments', pat.id);
  perform notify_patient(pat.id, 'appointment_new', 'تم استلام حجزك', svc.name || ' مع ' || v_doc || ' يوم ' || d || ' الساعة ' || tm || ' — بانتظار تأكيد المركز', a.id::text);
  return jsonb_build_object('id', a.id, 'no', a.no, 'doctor', v_doc);
end $$;
revoke execute on function patient_book(jsonb) from public, anon;
grant execute on function patient_book(jsonb) to authenticated;

-- ===== 5) المريض بيعدّل موعده: الموعد اللي له طبيب يتفحص على الطبيب نفسه، والقديم من غير طبيب يتحوّل للمركز =====
create or replace function patient_reschedule(p_id uuid, p_date date, p_time text) returns void
language plpgsql security definer set search_path = public as $$
declare c customers; a appointments; hrs int; pat patients; bs booking_settings;
begin
  c := require_patient();
  select bst.* into bs from booking_settings bst order by created_at limit 1;
  if bs.id is not null and not bs.allow_patient_rescheduling then raise exception 'تعديل الموعد من البوابة موقوف — تواصل مع المركز'; end if;
  select * into a from appointments where id = p_id and patient_id = c.patient_id for update;
  if a.id is null then raise exception 'الموعد غير موجود'; end if;
  if a.status not in ('new','confirmed','rescheduled') then raise exception 'لا يمكن تعديل موعد بحالته الحالية'; end if;
  select cancel_before_hours into hrs from center_info limit 1;
  if (a.date + a.time::time) - (now() at time zone 'Africa/Cairo') < make_interval(hours => coalesce(hrs, 24)) then
    raise exception 'لا يمكن تعديل الموعد قبله بأقل من % ساعة — تواصل مع المركز', coalesce(hrs, 24);
  end if;
  if a.therapist_id is null then raise exception 'هذا الموعد بدون دكتور محدد — تواصل مع المركز لتعديله'; end if;
  perform check_slot(a.therapist_id, p_date, p_time, a.duration_min, p_id);
  update appointments set date = p_date, time = p_time, status = 'rescheduled', updated_at = now() where id = p_id;
  update invoices set date = p_date where appointment_id = p_id and status in ('due','draft');
  select * into pat from patients where id = a.patient_id;
  perform notify_staff('appointment_rescheduled', 'المريض غيّر موعده', pat.full_name || ' — ' || a.no || ' إلى ' || p_date || ' ' || p_time, a.no, '/appointments', pat.id);
end $$;
revoke execute on function patient_reschedule(uuid, date, text) from public, anon;
grant execute on function patient_reschedule(uuid, date, text) to authenticated;

-- ===== 6) أوقات دكتور محدد في يوم محدد — مصدر واحد لبوابة المريض والموقع العام =====
-- status: ok | past | closed | holiday | leave | not_offered | no_doctor
-- slots: كل وقت داخل ساعات المركز + available (false = محجوز لنفس الدكتور → ✕). مفيش أي بيانات مرضى.
create or replace function doctor_day_slots(p_therapist uuid, p_service text, p_date date) returns jsonb
language plpgsql stable security definer set search_path = public as $$
declare th therapists; svc services; sched jsonb; step int; t int; o int; cl int; dur int; now_min int; is_today boolean; out jsonb := '[]'; busy boolean; hhmm text;
begin
  if p_therapist is null then return jsonb_build_object('status', 'no_doctor', 'slots', '[]'::jsonb); end if;
  select * into th from therapists where id = p_therapist and active;
  if th.id is null then return jsonb_build_object('status', 'no_doctor', 'slots', '[]'::jsonb); end if;
  select * into svc from services where id = p_service and active;
  if svc.id is null or not exists (select 1 from therapist_services ts where ts.therapist_id = p_therapist and ts.service_id = p_service) then
    return jsonb_build_object('status', 'not_offered', 'slots', '[]'::jsonb);
  end if;
  if p_date < riyadh_today() then return jsonb_build_object('status', 'past', 'slots', '[]'::jsonb); end if;
  select e.value into sched from center_info c, jsonb_array_elements(c.week_schedule) e where e.value->>'day' = lower(to_char(p_date, 'Dy')) limit 1;
  if sched is null or not coalesce((sched->>'open')::boolean, false) then return jsonb_build_object('status', 'closed', 'slots', '[]'::jsonb); end if;
  if exists (select 1 from holidays h where h.date = p_date and h.active and (h.branch_id is null or h.branch_id = th.branch_id)) then
    return jsonb_build_object('status', 'holiday', 'slots', '[]'::jsonb);
  end if;
  if exists (select 1 from jsonb_array_elements(th.on_leave) l where p_date between (l.value->>'from')::date and (l.value->>'to')::date)
     or exists (select 1 from staff_requests r join employees e on e.id = r.employee_id
                where e.therapist_id = p_therapist and r.status = 'approved' and r.type = 'leave' and p_date between r.from_date and r.to_date) then
    return jsonb_build_object('status', 'leave', 'slots', '[]'::jsonb);
  end if;
  step := greatest(coalesce((select slot_step_min from center_info limit 1), 30), 5);
  dur := svc.duration_min;
  o := split_part(sched->>'from', ':', 1)::int * 60 + split_part(sched->>'from', ':', 2)::int;
  cl := split_part(sched->>'to', ':', 1)::int * 60 + split_part(sched->>'to', ':', 2)::int;
  is_today := p_date = riyadh_today();
  now_min := extract(hour from now() at time zone 'Africa/Cairo')::int * 60 + extract(minute from now() at time zone 'Africa/Cairo')::int;
  t := o;
  while t <= cl loop
    if not (is_today and t <= now_min) then
      hhmm := lpad((t / 60)::text, 2, '0') || ':' || lpad((t % 60)::text, 2, '0');
      busy := exists (select 1 from appointments a where a.therapist_id = p_therapist and a.date = p_date and a.status <> 'cancelled'
                      and hhmm::time < a.time::time + make_interval(mins => a.duration_min) and a.time::time < hhmm::time + make_interval(mins => dur));
      out := out || jsonb_build_array(jsonb_build_object('time', hhmm, 'available', not busy));
    end if;
    t := t + step;
  end loop;
  return jsonb_build_object('status', 'ok', 'slots', out);
end $$;
revoke execute on function doctor_day_slots(uuid, text, date) from public;
grant execute on function doctor_day_slots(uuid, text, date) to anon, authenticated;

-- ===== 7) شبكة أمان على مستوى الجدول: مفيش موعد جديد من غير دكتور، ولا موعد قائم يتفرّغ من دكتوره =====
create or replace function appointments_require_doctor() returns trigger
language plpgsql as $$
begin
  if tg_op = 'INSERT' and new.therapist_id is null then
    raise exception 'يجب اختيار الدكتور قبل تأكيد الحجز.';
  end if;
  if tg_op = 'UPDATE' and new.therapist_id is null and old.therapist_id is not null then
    raise exception 'لا يمكن إزالة الدكتور من موعد محجوز.';
  end if;
  return new;
end $$;
drop trigger if exists trg_appointments_require_doctor on appointments;
create trigger trg_appointments_require_doctor before insert or update of therapist_id on appointments for each row execute function appointments_require_doctor();

-- فهرس يسرّع فحص التعارض (دكتور + يوم)
create index if not exists idx_appointments_doctor_day on appointments (therapist_id, date) where status <> 'cancelled';
