-- 910: الخطة العلاجية بتتربط بمواعيد خدمتها بس
-- كان أي موعد بيتحجز لمريض عنده خطة نشطة (حتى كشف عظام أو غيار) بيتربط بالخطة تلقائيًا: بيتحسب جلسة منها
-- («كل جلسات الخطة محجوزة» قبل ما تتحجز)، ومن غير فاتورة خاصة بيه. ونفس الكلام في الحجز الأونلاين لو الخطة مدفوعة.
-- دلوقتي الربط التلقائي لخطة نفس الخدمة بس؛ الاستقبال لسه يقدر يختار خطة بعينها صراحةً (planId).

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
  if v_dur < 10 or v_dur > 240 then raise exception 'مدة الجلسة غير صحيحة'; end if;
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

  -- موعد على خطة ليها فاتورة (حتى لو مسودة بسعر 0 مستنية الاستقبال) = مفيش فاتورة منفصلة للجلسة
  if pkg is null and not (coalesce(plan.price, 0) > 0 or (plan.id is not null and exists (select 1 from invoices iv where iv.plan_id = plan.id and iv.status <> 'cancelled'))) then
    perform new_invoice(pat.id, svc.name, v_price, 'due', d, a.id, null, null, svc.id);
  end if;
  perform notify_staff('appointment_new', case when loc = 'home' then 'تم حجز زيارة منزلية' else 'تم إنشاء موعد جديد' end,
    pat.full_name || ' — ' || svc.name || ' — ' || d || ' ' || tm, a.no, '/appointments', pat.id);
  perform notify_patient(pat.id, 'appointment_new', 'تم حجز موعدك', svc.name || ' يوم ' || d || ' الساعة ' || tm, a.id::text);
  perform log_action('حجز موعد ' || a.no || ' — ' || svc.name || ' بتاريخ ' || d || ' ' || tm, pat.id);
  return jsonb_build_object('id', a.id, 'no', a.no);
end $function$;

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
    raise exception 'ما يمكن الحجز لأكثر من % يومًا مقدمًا', bs.max_future_booking_days;
  end if;
  select * into svc from services where id = _txt(p, 'serviceId');
  if svc.id is null or not svc.active then raise exception 'الخدمة غير موجودة أو موقوفة'; end if;
  -- الحجز الأونلاين للكشف بس (طلب المستخدم 2026-10-19) — أي خدمة تانية بتتحجز من المركز
  if svc.name not like '%كشف%' then raise exception 'الحجز الأونلاين متاح لخدمة الكشف فقط — للخدمات الثانية تواصل مع المركز'; end if;
  perform assert_booking_doctor(th, svc.id, null);
  if d is null then raise exception 'اختر التاريخ'; end if;
  if tm !~ '^\d{2}:\d{2}$' then raise exception 'اختر الوقت'; end if;
  if d < riyadh_today() then raise exception 'ما يمكن الحجز في تاريخ سابق'; end if;
  if d = riyadh_today() and tm <= to_char(now() at time zone 'Africa/Cairo', 'HH24:MI') then raise exception 'هالوقت انقضى — اختر وقت لاحق'; end if;
  perform pg_advisory_xact_lock(hashtext('pt-day-book:' || pat.id::text || d::text));
  if exists (select 1 from appointments x where x.patient_id = pat.id and x.date = d and x.status not in ('cancelled', 'no_show')) then
    raise exception 'عندك موعد محجوز في اليوم نفسه — الحجز الإلكتروني موعد واحد في اليوم. للحجز الإضافي تواصل مع المركز';
  end if;
  if (select count(*) from appointments where patient_id = pat.id and status in ('new','confirmed','rescheduled') and date >= riyadh_today()) >= 5 then
    raise exception 'وصلت للحد الأقصى من المواعيد القادمة (5). تواصل مع المركز لتعديلها';
  end if;
  -- مركز مفتوح + عطلات + إجازة الدكتور + عدم تعارضه مع حجز تاني لنفس الدكتور (بقفل ذرّي)
  perform check_slot(th, d, tm, svc.duration_min, null);
  v_price := effective_price(svc.id, th, _uuid(p, 'priceId'));
  insert into appointments (no, patient_id, customer_id, type, service_id, therapist_id, location, address, date, time, duration_min, status, price, branch_id, notes, source)
  values (next_counter('appointment', 'MV-'), pat.id, c.id, 'session', svc.id, th, 'center', '', d, tm, svc.duration_min, 'new', v_price,
          coalesce((select branch_id from therapists where id = th), (select id from branches order by created_at limit 1)), _txt(p, 'notes'), 'online')
  returning * into a;
  select name into v_doc from therapists where id = th;
  if not exists (select 1 from treatment_plans where patient_id = pat.id and status = 'active' and treatment_plans.price > 0 and treatment_plans.service_id = svc.id) then
    perform new_invoice(pat.id, svc.name, v_price, 'due', d, a.id, null, null, svc.id);
  end if;
  perform notify_staff('appointment_new', 'حجز جديد من المريض', pat.full_name || ' — ' || svc.name || ' — ' || v_doc || ' — ' || d || ' ' || tm, a.no, '/appointments', pat.id);
  perform notify_patient(pat.id, 'appointment_new', 'تم استلام حجزك', svc.name || ' مع ' || v_doc || ' يوم ' || d || ' الساعة ' || tm || ' — بانتظار تأكيد المركز', a.id::text);
  return jsonb_build_object('id', a.id, 'no', a.no, 'doctor', v_doc);
end $function$;
