-- ١١/١١: الحجز الأونلاين من الصفحة الرئيسية من غير حساب — الاسم + الموبايل + كشف/متابعة + اليوم والوقت.
-- نفس قواعد patient_book (إعدادات الحجز، الأيام المسموحة، دوام الدكتور، عدم التعارض، موعد واحد في اليوم، الفاتورة، تنبيه الاستقبال)
-- والمريض بيتعرف من رقم موبايله: لو له ملف بيتحجز عليه، ولو لأ بيتعمله ملف جديد (مصدره «الموقع»).
create or replace function public.guest_book(p jsonb)
returns jsonb
language plpgsql security definer set search_path to 'public' as $function$
declare
  pat patients; svc services; th uuid := _uuid(p, 'therapistId'); d date := nullif(p->>'date', '')::date; tm text := _txt(p, 'time');
  a appointments; v_price numeric; bs booking_settings; v_doc text;
  digits text := regexp_replace(coalesce(p->>'phone', ''), '\D', '', 'g'); nm text; w text[];
begin
  nm := assert_patient_name(p->>'fullName');
  if length(digits) < 10 or length(digits) > 15 then raise exception 'رقم الموبايل غير صحيح'; end if;
  select bst.* into bs from booking_settings bst order by created_at limit 1;
  if bs.id is not null and not bs.allow_online_booking then raise exception 'الحجز الأونلاين موقوف حاليًا — كلّم العيادة للحجز'; end if;
  if bs.id is not null and d is not null and d > riyadh_today() + bs.max_future_booking_days then
    raise exception 'ما ينفعش الحجز لأكتر من % يوم قدام', bs.max_future_booking_days;
  end if;
  select * into svc from services where id = _txt(p, 'serviceId');
  if svc.id is null or not svc.active then raise exception 'الخدمة غير موجودة أو موقوفة'; end if;
  if svc.name not like '%كشف%' and svc.name not like '%متابع%' then raise exception 'الحجز الأونلاين للكشف والمتابعة بس — للخدمات التانية كلّم العيادة'; end if;
  perform assert_booking_doctor(th, svc.id, null);
  if d is null then raise exception 'اختار اليوم'; end if;
  if tm !~ '^\d{2}:\d{2}$' then raise exception 'اختار الوقت'; end if;
  if d < riyadh_today() then raise exception 'ما ينفعش الحجز في يوم فات'; end if;
  if d = riyadh_today() and tm <= to_char(now() at time zone 'Africa/Cairo', 'HH24:MI') then raise exception 'الوقت ده فات — اختار وقت بعده'; end if;

  -- نفس الموبايل = نفس المريض (آخر 9 أرقام)
  perform pg_advisory_xact_lock(hashtext('guest-book:' || right(digits, 9)));
  select * into pat from patients where right(regexp_replace(phone, '\D', '', 'g'), 9) = right(digits, 9) order by is_guest, registered_at limit 1;
  -- حماية من الإزعاج: مش أكتر من 3 حجوزات أونلاين لنفس الرقم في اليوم
  if pat.id is not null and (select count(*) from appointments x where x.patient_id = pat.id and x.source = 'online' and x.created_at > now() - interval '1 day') >= 3 then
    raise exception 'اتعمل حجوزات كتير من الرقم ده النهارده — كلّم العيادة';
  end if;
  if pat.id is null then
    w := regexp_split_to_array(nm, ' ');
    insert into patients (file_no, full_name, first_name, father_name, family_name, phone, referral_source, notes)
    values ('', nm, w[1], w[2], array_to_string(w[3:], ' '), p->>'phone', 'website', '') returning * into pat;
  end if;
  if not pat.active then raise exception 'الملف ده غير نشط — كلّم العيادة'; end if;
  if exists (select 1 from appointments x where x.patient_id = pat.id and x.date = d and x.status not in ('cancelled', 'no_show')) then
    raise exception 'فيه موعد محجوز بالرقم ده في نفس اليوم — للتعديل كلّم العيادة';
  end if;
  if (select count(*) from appointments where patient_id = pat.id and status in ('new','confirmed','rescheduled') and date >= riyadh_today()) >= 5 then
    raise exception 'وصلت للحد الأقصى من المواعيد الجاية (5) — كلّم العيادة';
  end if;

  perform check_slot(th, d, tm, svc.duration_min, null);
  v_price := effective_price(svc.id, th, null);
  insert into appointments (no, patient_id, customer_id, type, service_id, therapist_id, location, address, date, time, duration_min, status, price, branch_id, notes, source)
  values (next_counter('appointment', 'MV-'), pat.id, null, 'session', svc.id, th, 'center', '', d, tm, svc.duration_min, 'new', v_price,
          coalesce((select branch_id from therapists where id = th), (select id from branches order by created_at limit 1)),
          trim('حجز من الموقع (من غير حساب) — الاسم المكتوب: ' || nm || case when coalesce(_txt(p, 'notes'), '') <> '' then ' — ' || _txt(p, 'notes') else '' end), 'online')
  returning * into a;
  select name into v_doc from therapists where id = th;
  if not exists (select 1 from treatment_plans where patient_id = pat.id and status = 'active' and treatment_plans.price > 0 and treatment_plans.service_id = svc.id) then
    perform new_invoice(pat.id, svc.name, v_price, 'due', d, a.id, null, null, svc.id);
  end if;
  perform notify_staff('appointment_new', 'حجز أونلاين جديد من الموقع', nm || ' (' || (p->>'phone') || ') — ' || svc.name || ' — ' || coalesce(v_doc, '') || ' — ' || d || ' ' || tm, a.no, '/appointments', pat.id);
  return jsonb_build_object('no', a.no, 'doctor', v_doc, 'date', d, 'time', tm, 'service', svc.name);
end $function$;
revoke execute on function public.guest_book(jsonb) from public;
grant execute on function public.guest_book(jsonb) to anon, authenticated;

-- الصفحة الرئيسية (من غير تسجيل دخول): public_catalog و doctor_day_slots مقفولين على anon (902)،
-- فدول نسخ ضيقة للحجز الأونلاين بس: خدمات الكشف/المتابعة الظاهرة على الموقع + الدكاترة اللي بيقدموها + الأوقات الفاضية. مفيش أي بيانات مرضى.
create or replace function public.guest_booking_catalog()
returns jsonb
language sql stable security definer set search_path to 'public' as $function$
  select jsonb_build_object(
    'services', coalesce((select jsonb_agg(jsonb_build_object('id', s.id, 'name', s.name, 'price', s.price, 'durationMin', s.duration_min,
        'doctorIds', coalesce((select jsonb_agg(ts.therapist_id) from therapist_services ts join therapists t on t.id = ts.therapist_id and t.active where ts.service_id = s.id), '[]'))
        order by s.name)
      from services s where s.active and s.show_on_site and (s.name like '%كشف%' or s.name like '%متابع%')), '[]'),
    'doctors', coalesce((select jsonb_agg(jsonb_build_object('id', t.id, 'name', t.name,
        'serviceIds', coalesce((select jsonb_agg(ts.service_id) from therapist_services ts where ts.therapist_id = t.id), '[]')) order by t.name)
      from therapists t where t.active), '[]'))
$function$;
revoke execute on function public.guest_booking_catalog() from public;
grant execute on function public.guest_booking_catalog() to anon, authenticated;

create or replace function public.guest_day_slots(p_therapist uuid, p_service text, p_date date)
returns jsonb
language plpgsql stable security definer set search_path to 'public' as $function$
begin
  if not exists (select 1 from services s where s.id = p_service and s.active and s.show_on_site and (s.name like '%كشف%' or s.name like '%متابع%')) then
    return jsonb_build_object('status', 'not_offered', 'slots', '[]'::jsonb);
  end if;
  return doctor_day_slots(p_therapist, p_service, p_date);
end $function$;
revoke execute on function public.guest_day_slots(uuid, text, date) from public;
grant execute on function public.guest_day_slots(uuid, text, date) to anon, authenticated;
