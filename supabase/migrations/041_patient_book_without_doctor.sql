-- حجز المريض من الموبايل من غير اختيار طبيب؛ الإدارة بتختار الطبيب عند التأكيد/الحضور.

-- عدد الأطباء الفاضيين لخدمة في وقت معيّن (نفس قواعد check_slot: ساعات العمل، الإجازات، التعارض)
create or replace function free_therapists_count(p_service text, p_date date, p_time text, p_dur int) returns int
language plpgsql security definer set search_path = public as $$
declare t record; n int := 0;
begin
  for t in select ts.therapist_id from therapist_services ts join therapists th on th.id = ts.therapist_id and th.active where ts.service_id = p_service loop
    begin
      perform check_slot(t.therapist_id, p_date, p_time, p_dur, null);
      n := n + 1;
    exception when others then null;
    end;
  end loop;
  return n;
end $$;
revoke execute on function free_therapists_count(text, date, text, int) from public, anon, authenticated;

create or replace function public.patient_book(p jsonb)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare c customers; pat patients; svc services; th uuid := null; free int; pending int; d date := nullif(p->>'date', '')::date; tm text := _txt(p, 'time'); a appointments; v_price numeric; bs booking_settings;
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
  if d is null then raise exception 'اختر التاريخ'; end if;
  if (select count(*) from appointments where patient_id = pat.id and status in ('new','confirmed','rescheduled') and date >= riyadh_today()) >= 5 then
    raise exception 'وصلت للحد الأقصى من المواعيد القادمة (5). تواصل مع المركز لتعديلها';
  end if;
  -- المريض مابيختارش طبيب: الطبيب بيتحدد من الإدارة عند تأكيد الحجز.
  -- الوقت متاح لو عدد الأطباء الفاضيين فيه أكبر من الحجوزات اللي لسه من غير طبيب في نفس الوقت
  free := free_therapists_count(svc.id, d, tm, svc.duration_min);
  select count(*) into pending from appointments x where x.therapist_id is null and x.date = d and x.status not in ('cancelled','no_show','completed')
    and tm::time < x.time::time + make_interval(mins => x.duration_min) and x.time::time < tm::time + make_interval(mins => svc.duration_min);
  if free - pending < 1 then raise exception 'الوقت ده اتحجز — اختر وقت تاني'; end if;
  v_price := effective_price(svc.id, th, _uuid(p, 'priceId'));
  insert into appointments (no, patient_id, customer_id, type, service_id, therapist_id, location, address, date, time, duration_min, status, price, branch_id, notes)
  values (next_counter('appointment', 'MV-'), pat.id, c.id, 'session', svc.id, th, 'center', '', d, tm, svc.duration_min, 'new', v_price,
          (select id from branches order by created_at limit 1), _txt(p, 'notes'))
  returning * into a;
  if not exists (select 1 from treatment_plans where patient_id = pat.id and status = 'active' and treatment_plans.price > 0) then
    perform new_invoice(pat.id, svc.name, v_price, 'due', d, a.id, null, null, svc.id);
  end if;
  perform notify_staff('appointment_new', 'حجز جديد من المريض', pat.full_name || ' — ' || svc.name || ' — ' || d || ' ' || tm, a.no, '/appointments', pat.id);
  perform notify_patient(pat.id, 'appointment_new', 'تم استلام حجزك', svc.name || ' يوم ' || d || ' الساعة ' || tm || ' — بانتظار تأكيد المركز وتحديد الطبيب', a.id::text);
  return jsonb_build_object('id', a.id, 'no', a.no);
end $function$;

drop function if exists public.set_appointment_status(uuid, text, text);
create or replace function public.set_appointment_status(p_id uuid, p_status text, p_reason text DEFAULT NULL::text, p_therapist uuid DEFAULT NULL::uuid)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare a appointments; pname text; label text;
begin
  perform require_any(array['appointments:edit', 'sessions:edit']);
  select * into a from appointments where id = p_id for update;
  if a.id is null or not can_see_patient(a.patient_id) then raise exception 'الموعد غير موجود'; end if;
  if p_status not in ('new','confirmed','on_way','arrived','in_progress','no_show','completed','cancelled','rescheduled') then raise exception 'حالة غير صحيحة'; end if;
  if a.status = 'cancelled' and p_status <> 'cancelled' then raise exception 'الموعد ملغي — أنشئ موعدًا جديدًا'; end if;
  if p_status = 'cancelled' and coalesce(trim(p_reason), '') = '' then raise exception 'اكتب سبب الإلغاء'; end if;
  -- تعيين الطبيب (حجز المريض من الموبايل بييجي من غير طبيب) — بيتحقق إن الطبيب فاضي في الوقت ده
  if p_therapist is not null and p_therapist is distinct from a.therapist_id then
    perform check_slot(p_therapist, a.date, a.time, a.duration_min, a.id);
    update appointments set therapist_id = p_therapist, branch_id = coalesce((select branch_id from therapists where id = p_therapist), branch_id) where id = p_id;
    a.therapist_id := p_therapist;
  end if;
  if a.therapist_id is null and p_status in ('confirmed','on_way','arrived','in_progress','completed') then
    raise exception 'اختر الطبيب قبل تأكيد الموعد';
  end if;
  update appointments set status = p_status, updated_at = now(),
    cancel_reason = case when p_status = 'cancelled' then trim(p_reason) else cancel_reason end
  where id = p_id;
  select full_name into pname from patients where id = a.patient_id;
  if p_status = 'cancelled' then
    update invoices set status = 'cancelled' where appointment_id = p_id and paid = 0 and status <> 'cancelled';
    perform notify_staff('appointment_cancelled', 'تم إلغاء موعد', pname || ' — ' || a.no, a.no, '/appointments', a.patient_id);
    perform notify_patient(a.patient_id, 'appointment_cancelled', 'تم إلغاء موعدك', 'موعد ' || a.date || ' الساعة ' || a.time || ' — السبب: ' || trim(p_reason), a.id::text);
  elsif p_status = 'confirmed' then
    perform notify_patient(a.patient_id, 'appointment_confirmed', 'تم تأكيد موعدك', 'موعدك يوم ' || a.date || ' الساعة ' || a.time || ' مؤكد', a.id::text);
  elsif p_status = 'no_show' then
    perform notify_staff('no_show', 'مريض لم يحضر', pname || ' لم يحضر موعده ' || a.no || ' (' || a.date || ' ' || a.time || ')', a.no, '/appointments', a.patient_id);
  elsif p_status = 'on_way' then
    perform notify_patient(a.patient_id, 'visit_on_way', 'المعالج في الطريق إليك', 'زيارتك المنزلية اليوم الساعة ' || a.time, a.id::text);
  end if;
  label := case p_status when 'confirmed' then 'تأكيد' when 'on_way' then 'خروج المعالج للزيارة' when 'arrived' then 'تسجيل حضور'
    when 'no_show' then 'تسجيل عدم حضور' when 'cancelled' then 'إلغاء' when 'completed' then 'إكمال' when 'new' then 'إعادة إلى جديد' else 'تحديث' end;
  perform log_action(label || ' الموعد ' || a.no || coalesce(' — السبب: ' || nullif(trim(p_reason), ''), ''), a.patient_id);
end $function$;
revoke execute on function set_appointment_status(uuid, text, text, uuid) from public, anon;
grant execute on function set_appointment_status(uuid, text, text, uuid) to authenticated;
