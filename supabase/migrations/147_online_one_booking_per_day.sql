-- 147: الحجز الإلكتروني (بوابة المريض + الموقع) = موعد واحد في اليوم للمريض. قبل كده كان فيه حد 5 مواعيد قادمة بس، فنفس المريض كان يقدر يحجز أكتر من موعد في نفس اليوم.
-- نفس الشرط في إعادة الجدولة (مايقدرش ينقل موعده ليوم عنده فيه موعد تاني). الموعد الملغي/المنقول/«لم يحضر» مابيتحسبش. التحقق بقفل لكل مريض+يوم عشان طلبين في نفس اللحظة مايعدّوش.
-- الحجز من الإدارة (استقبال/سكرتارية) مش متأثر.
CREATE OR REPLACE FUNCTION public.patient_book(p jsonb)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
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
  perform pg_advisory_xact_lock(hashtext('pt-day-book:' || pat.id::text || d::text));
  if exists (select 1 from appointments x where x.patient_id = pat.id and x.date = d and x.status not in ('cancelled', 'no_show', 'rescheduled')) then
    raise exception 'عندك موعد محجوز في نفس اليوم — الحجز الإلكتروني موعد واحد في اليوم. للحجز الإضافي تواصل مع المركز';
  end if;
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
end $function$
;

CREATE OR REPLACE FUNCTION public.patient_reschedule(p_id uuid, p_date date, p_time text)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
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
  perform pg_advisory_xact_lock(hashtext('pt-day-book:' || c.patient_id::text || p_date::text));
  if exists (select 1 from appointments x where x.patient_id = c.patient_id and x.date = p_date and x.status not in ('cancelled', 'no_show', 'rescheduled') and x.id <> p_id) then
    raise exception 'عندك موعد محجوز في نفس اليوم — الحجز الإلكتروني موعد واحد في اليوم. للحجز الإضافي تواصل مع المركز';
  end if;
  perform check_slot(a.therapist_id, p_date, p_time, a.duration_min, p_id);
  update appointments set date = p_date, time = p_time, status = 'rescheduled', updated_at = now() where id = p_id;
  update invoices set date = p_date where appointment_id = p_id and status in ('due','draft');
  select * into pat from patients where id = a.patient_id;
  perform notify_staff('appointment_rescheduled', 'المريض غيّر موعده', pat.full_name || ' — ' || a.no || ' إلى ' || p_date || ' ' || p_time, a.no, '/appointments', pat.id);
end $function$
;
