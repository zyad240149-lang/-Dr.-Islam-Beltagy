-- حجز المريض من البوابة/التطبيق: رسالة واضحة بدل «الوقت ده اتحجز» لما السبب إن المركز مغلق/التاريخ فات/الوقت برّه ساعات العمل.
-- (قبل كده أي حاجة من دول كانت بتطلع للمريض كأن الوقت محجوز.) باقي المنطق زي ما هو بالظبط.
create or replace function patient_book(p jsonb) returns jsonb
language plpgsql security definer set search_path = public as $$
declare c customers; pat patients; svc services; th uuid := null; free int; pending int; d date := nullif(p->>'date', '')::date; tm text := _txt(p, 'time'); a appointments; v_price numeric; bs booking_settings; sched jsonb;
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
  if tm !~ '^\d{2}:\d{2}$' then raise exception 'اختر الوقت'; end if;
  if d < riyadh_today() then raise exception 'لا يمكن الحجز في تاريخ سابق'; end if;
  if d = riyadh_today() and tm <= to_char(now() at time zone 'Africa/Cairo', 'HH24:MI') then raise exception 'الوقت ده فات — اختر وقت لاحق'; end if;
  select e.value into sched from center_info ci, jsonb_array_elements(ci.week_schedule) e where e.value->>'day' = lower(to_char(d, 'Dy')) limit 1;
  if sched is null or not coalesce((sched->>'open')::boolean, false) then raise exception 'المركز مغلق في هذا اليوم — اختر يومًا آخر'; end if;
  if tm < sched->>'from' or tm >= sched->>'to' then raise exception 'الوقت خارج ساعات عمل المركز (% - %)', sched->>'from', sched->>'to'; end if;
  if exists (select 1 from holidays h where h.date = d and h.active) then raise exception 'المركز مغلق في هذا اليوم — اختر يومًا آخر'; end if;
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
end $$;
revoke execute on function patient_book(jsonb) from public, anon;
grant execute on function patient_book(jsonb) to authenticated;
