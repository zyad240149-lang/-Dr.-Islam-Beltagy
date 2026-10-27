-- وقت إغلاق المركز = آخر موعد يُحجز (مثلاً إغلاق 23:00 ⇒ آخر موعد 11:00 م)
-- الحجز وتعديل المواعيد من غير قيد «ساعات دوام الطبيب» (طلب المستخدم 2026-09-30): أي وقت جوّه ساعات عمل المركز مسموح.
-- لسه بيتحقق من: المركز فاتح + الوقت جوّه ساعاته + العطلات + إجازة الطبيب + إن الطبيب مالوش موعد تاني في نفس الوقت.
CREATE OR REPLACE FUNCTION public.check_slot(p_therapist uuid, p_date date, p_time text, p_dur integer, p_exclude uuid DEFAULT NULL::uuid)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare d text := lower(to_char(p_date, 'Dy')); sched jsonb; th therapists; wh jsonb; br uuid;
begin
  if p_time !~ '^\d{2}:\d{2}$' then raise exception 'صيغة الوقت غير صحيحة'; end if;
  if p_date < riyadh_today() then raise exception 'لا يمكن الحجز في تاريخ سابق'; end if;
  select e.value into sched from center_info c, jsonb_array_elements(c.week_schedule) e where e.value->>'day' = d limit 1;
  if sched is null or not coalesce((sched->>'open')::boolean, false) then raise exception 'المركز مغلق في هذا اليوم'; end if;
  if p_time < sched->>'from' or p_time > sched->>'to' then raise exception 'الوقت خارج ساعات عمل المركز (% - %)', sched->>'from', sched->>'to'; end if;

  select * into th from therapists where id = p_therapist;
  if th.id is null or not th.active then raise exception 'المعالج غير موجود أو غير نشط'; end if;
  br := th.branch_id;
  if exists (select 1 from holidays where date = p_date and active and (branch_id is null or branch_id = br)) then
    raise exception 'المركز مغلق في هذا اليوم — اختر يومًا آخر';
  end if;
  if exists (select 1 from jsonb_array_elements(th.on_leave) l where p_date between (l.value->>'from')::date and (l.value->>'to')::date)
     or exists (select 1 from staff_requests r join employees e on e.id = r.employee_id
                where e.therapist_id = p_therapist and r.status = 'approved' and r.type = 'leave' and p_date between r.from_date and r.to_date) then
    raise exception 'المعالج في إجازة في هذا التاريخ';
  end if;
  -- (اتشال) التحقق من ساعات دوام الطبيب — الحجز والتعديل مسموحين في أي وقت جوّه ساعات المركز

  perform pg_advisory_xact_lock(hashtext(p_therapist::text || p_date::text));
  if exists (select 1 from appointments a
             where a.therapist_id = p_therapist and a.date = p_date and a.status <> 'cancelled' and a.id is distinct from p_exclude
               and p_time::time < a.time::time + make_interval(mins => a.duration_min)
               and a.time::time < p_time::time + make_interval(mins => p_dur)) then
    raise exception 'المعالج لديه موعد آخر في هذا الوقت';
  end if;
end $function$
;

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
  if tm < sched->>'from' or tm > sched->>'to' then raise exception 'الوقت خارج ساعات عمل المركز (% - %)', sched->>'from', sched->>'to'; end if;
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

create or replace function patient_reschedule(p_id uuid, p_date date, p_time text) returns void
language plpgsql security definer set search_path = public as $$
declare c customers; a appointments; hrs int; pat patients; bs booking_settings; sched jsonb; free int; pending int;
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
  if a.therapist_id is not null then
    perform check_slot(a.therapist_id, p_date, p_time, a.duration_min, p_id);
  else
    -- نفس قاعدة patient_book: المركز فاتح + الوقت جوّه ساعاته + فيه طبيب فاضي أكتر من الحجوزات اللي لسه من غير طبيب
    if p_time !~ '^\d{2}:\d{2}$' then raise exception 'صيغة الوقت غير صحيحة'; end if;
    if p_date < riyadh_today() then raise exception 'لا يمكن الحجز في تاريخ سابق'; end if;
    select e.value into sched from center_info ci, jsonb_array_elements(ci.week_schedule) e where e.value->>'day' = lower(to_char(p_date, 'Dy')) limit 1;
    if sched is null or not coalesce((sched->>'open')::boolean, false) then raise exception 'المركز مغلق في هذا اليوم'; end if;
    if p_time < sched->>'from' or p_time > sched->>'to' then raise exception 'الوقت خارج ساعات عمل المركز (% - %)', sched->>'from', sched->>'to'; end if;
    free := free_therapists_count(a.service_id, p_date, p_time, a.duration_min);
    select count(*) into pending from appointments x where x.therapist_id is null and x.date = p_date and x.id <> p_id
      and x.status not in ('cancelled','no_show','completed')
      and p_time::time < x.time::time + make_interval(mins => x.duration_min) and x.time::time < p_time::time + make_interval(mins => a.duration_min);
    if free - pending < 1 then raise exception 'الوقت ده اتحجز — اختر وقت تاني'; end if;
  end if;
  update appointments set date = p_date, time = p_time, status = 'rescheduled', updated_at = now() where id = p_id;
  update invoices set date = p_date where appointment_id = p_id and status in ('due','draft');
  select * into pat from patients where id = a.patient_id;
  perform notify_staff('appointment_rescheduled', 'المريض غيّر موعده', pat.full_name || ' — ' || a.no || ' إلى ' || p_date || ' ' || p_time, a.no, '/appointments', pat.id);
end $$;
revoke execute on function patient_reschedule(uuid, date, text) from public, anon;
grant execute on function patient_reschedule(uuid, date, text) to authenticated;
