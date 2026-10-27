-- 909: منع تضارب المواعيد نهائيًا + سجل المريض الطبي في بوابته
--
-- 1) المريض نفسه مايتحجزش في وقتين متداخلين (حتى مع دكتورين مختلفين) — كان الفحص على الدكتور بس.
--    الفحص في تريجر الجدول نفسه، فبيغطي كل طرق الحجز والتعديل: الاستقبال، الأوفلاين، البوابة، إعادة الجدولة،
--    تعديل التفاصيل، جلسات الخطط. «زيارة مباشرة» من حضور الباقات (app.allow_overlap) فاضلة استثناء زي ما هي.
-- 2) الموعد اللي اتعادت جدولته (status = 'rescheduled') هو موعد قائم بالوقت الجديد — كان بيتحسب «مش موجود» في:
--    موعد أونلاين واحد في اليوم، وعدد جلسات الباقة المحجوزة.
-- 3) رجوع موعد «لم يحضر» لحالة نشطة بيتفحص تاني (ممكن الوقت يكون اتحجز للمريض في مكان تاني).
-- 4) patient_medical_record(): المريض بيشوف كشوفاته وروشتاته وطلبات الأشعة والكسور والعمليات بتاعته بس.

create or replace function public.appointments_no_overlap()
 returns trigger
 language plpgsql
 security definer
 set search_path to 'public'
as $function$
declare c appointments; v_doc text;
begin
  if new.status = 'cancelled' then return new; end if;
  if current_setting('app.allow_overlap', true) = 'on' then return new; end if; -- حضور مباشر من «حضور مرضى الباقات»
  -- الدكتور: موعدين متداخلين لنفس الدكتور
  if new.therapist_id is not null then
    perform pg_advisory_xact_lock(hashtext(new.therapist_id::text || new.date::text));
    if exists (select 1 from appointments a where a.therapist_id = new.therapist_id and a.date = new.date and a.status <> 'cancelled' and a.id is distinct from new.id
               and _hm(new.time) < _hm(a.time) + a.duration_min and _hm(a.time) < _hm(new.time) + new.duration_min) then
      raise exception 'عذرًا، هذا الموعد تم حجزه للتو. يرجى اختيار موعد آخر.';
    end if;
  end if;
  -- المريض: مايبقاش في مكانين في نفس الوقت (أي دكتور، أي خدمة). الموعد اللي خلص أو ماحضرهوش مابيحجزش وقته.
  if new.patient_id is not null and new.status not in ('no_show', 'completed') then
    perform pg_advisory_xact_lock(hashtext('pt-appt:' || new.patient_id::text || new.date::text));
    select a.* into c from appointments a
     where a.patient_id = new.patient_id and a.date = new.date and a.id is distinct from new.id
       and a.status not in ('cancelled', 'no_show', 'completed')
       and _hm(new.time) < _hm(a.time) + a.duration_min and _hm(a.time) < _hm(new.time) + new.duration_min
     order by a.time limit 1;
    if c.id is not null then
      select name into v_doc from therapists where id = c.therapist_id;
      raise exception 'المريض عنده موعد تاني في نفس الوقت (% – %)% — اختر وقتًا مختلفًا',
        c.time, to_char(c.time::time + make_interval(mins => c.duration_min), 'HH24:MI'), coalesce(' مع ' || v_doc, '');
    end if;
  end if;
  return new;
end $function$;

drop trigger if exists trg_appointments_no_overlap_upd on public.appointments;
create trigger trg_appointments_no_overlap_upd before update on public.appointments for each row
  when (old.date is distinct from new.date or old.time is distinct from new.time or old.duration_min is distinct from new.duration_min
        or old.therapist_id is distinct from new.therapist_id or old.patient_id is distinct from new.patient_id
        or (old.status in ('cancelled', 'no_show') and new.status not in ('cancelled', 'no_show', 'completed')))
  execute function appointments_no_overlap();

-- patient_book

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
  if not exists (select 1 from treatment_plans where patient_id = pat.id and status = 'active' and treatment_plans.price > 0) then
    perform new_invoice(pat.id, svc.name, v_price, 'due', d, a.id, null, null, svc.id);
  end if;
  perform notify_staff('appointment_new', 'حجز جديد من المريض', pat.full_name || ' — ' || svc.name || ' — ' || v_doc || ' — ' || d || ' ' || tm, a.no, '/appointments', pat.id);
  perform notify_patient(pat.id, 'appointment_new', 'تم استلام حجزك', svc.name || ' مع ' || v_doc || ' يوم ' || d || ' الساعة ' || tm || ' — بانتظار تأكيد المركز', a.id::text);
  return jsonb_build_object('id', a.id, 'no', a.no, 'doctor', v_doc);
end $function$;

-- patient_reschedule

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
  if a.status not in ('new','confirmed','rescheduled') then raise exception 'ما يمكن تعديل موعد بحالته الحالية'; end if;
  select cancel_before_hours into hrs from center_info limit 1;
  if (a.date + a.time::time) - (now() at time zone 'Africa/Cairo') < make_interval(hours => coalesce(hrs, 24)) then
    raise exception 'ما يمكن تعديل الموعد قبله بأقل من % ساعة — تواصل مع المركز', coalesce(hrs, 24);
  end if;
  if a.therapist_id is null then raise exception 'هذا الموعد بدون دكتور محدد — تواصل مع المركز لتعديله'; end if;
  perform pg_advisory_xact_lock(hashtext('pt-day-book:' || c.patient_id::text || p_date::text));
  if exists (select 1 from appointments x where x.patient_id = c.patient_id and x.date = p_date and x.status not in ('cancelled', 'no_show') and x.id <> p_id) then
    raise exception 'عندك موعد محجوز في اليوم نفسه — الحجز الإلكتروني موعد واحد في اليوم. للحجز الإضافي تواصل مع المركز';
  end if;
  if p_date = riyadh_today() and p_time <= to_char(now() at time zone 'Africa/Cairo', 'HH24:MI') then raise exception 'هالوقت انقضى — اختر وقت لاحق'; end if;
  perform check_slot(a.therapist_id, p_date, p_time, a.duration_min, p_id);
  update appointments set date = p_date, time = p_time, status = 'rescheduled', updated_at = now() where id = p_id;
  update invoices set date = p_date where appointment_id = p_id and status in ('due','draft');
  select * into pat from patients where id = a.patient_id;
  perform notify_staff('appointment_rescheduled', 'المريض غيّر موعده', pat.full_name || ' — ' || a.no || ' إلى ' || p_date || ' ' || p_time, a.no, '/appointments', pat.id);
end $function$;

-- guard_package_bookings

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
    raise exception 'تم حجز كل جلسات الباقة (%/%) — ما يمكن إضافة جلسة أخرى', n, pk.total_sessions; end if;
  return new;
end $function$;

-- سجل المريض الطبي (بوابة المريض ← «سجلي الطبي»): للقراءة بس، ملفه هو بس
create or replace function public.patient_medical_record()
 returns jsonb
 language plpgsql
 stable security definer
 set search_path to 'public'
as $function$
declare c customers;
begin
  c := require_patient();
  return jsonb_build_object(
    'consultations', coalesce((select jsonb_agg(jsonb_build_object(
        'id', x.id, 'date', x.date, 'complaint', x.complaint, 'region', x.region, 'side', x.side, 'diagnosis', x.diagnosis, 'icd10', x.icd10,
        'plan', x.plan, 'medications', x.medications, 'labs', x.labs, 'imagingRequests', x.imaging_requests, 'followUp', x.follow_up, 'doctor', e.name)
        order by x.date desc, x.created_at desc)
      from ortho_consultations x left join employees e on e.id = x.created_by where x.patient_id = c.patient_id), '[]'::jsonb),
    'imaging', coalesce((select jsonb_agg(jsonb_build_object('id', x.id, 'kind', x.kind, 'region', x.region, 'requestedAt', x.requested_at, 'status', x.status, 'finding', x.finding)
        order by x.requested_at desc, x.created_at desc)
      from ortho_imaging x where x.patient_id = c.patient_id), '[]'::jsonb),
    'fractures', coalesce((select jsonb_agg(jsonb_build_object('id', x.id, 'bone', x.bone, 'side', x.side, 'kind', x.kind, 'injuryDate', x.injury_date,
        'castDate', x.cast_date, 'removalDue', x.removal_due, 'status', x.status) order by x.injury_date desc, x.created_at desc)
      from ortho_fractures x where x.patient_id = c.patient_id), '[]'::jsonb),
    'surgeries', coalesce((select jsonb_agg(jsonb_build_object('id', x.id, 'procedure', x.procedure, 'region', x.region, 'side', x.side, 'hospital', x.hospital,
        'date', x.date, 'implant', x.implant, 'status', x.status) order by x.date desc nulls first, x.created_at desc)
      from ortho_surgeries x where x.patient_id = c.patient_id), '[]'::jsonb),
    'nextFollowUp', (select min(x.follow_up) from ortho_consultations x where x.patient_id = c.patient_id and x.follow_up >= riyadh_today()),
    'patient', (select jsonb_build_object('name', p.full_name, 'fileNo', p.file_no, 'birthDate', p.birth_date, 'gender', p.gender) from patients p where p.id = c.patient_id)
  );
end $function$;
revoke execute on function public.patient_medical_record() from anon, public;
grant execute on function public.patient_medical_record() to authenticated;
