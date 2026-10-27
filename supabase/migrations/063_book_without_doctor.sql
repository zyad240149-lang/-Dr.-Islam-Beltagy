-- الحجز من الإدارة بيعتمد على ساعات المركز بس — الطبيب اختياري (يتعيّن بعدين)
CREATE OR REPLACE FUNCTION public.book_appointment(p jsonb)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare svc services; pat patients; th uuid := _uuid(p, 'therapistId'); d date; tm text := _txt(p, 'time');
  loc text := _txt(p, 'location', 'center'); plan treatment_plans; pkg uuid := _uuid(p, 'packageId'); a appointments; v_price numeric;
begin
  perform require_any(array['booking:create', 'appointments:create']);
  select * into pat from patients where id = _uuid(p, 'patientId');
  if pat.id is null or not can_see_patient(pat.id) then raise exception 'اختر المريض'; end if;
  if not pat.active then raise exception 'ملف المريض غير نشط'; end if;
  select * into svc from services where id = _txt(p, 'serviceId');
  if svc.id is null or not svc.active then raise exception 'الخدمة غير موجودة أو موقوفة'; end if;
  d := nullif(p->>'date', '')::date;
  if d is null then raise exception 'اختر التاريخ'; end if;
  if loc not in ('center','home') then raise exception 'مكان الموعد غير صحيح'; end if;
  if loc = 'home' and _txt(p, 'address') = '' then raise exception 'أدخل عنوان الزيارة المنزلية'; end if;
  if th is not null then
    perform check_slot(th, d, tm, svc.duration_min, null);
  else
    declare sched jsonb;
    begin
      if tm !~ '^\d{2}:\d{2}$' then raise exception 'صيغة الوقت غير صحيحة'; end if;
      if d < riyadh_today() then raise exception 'لا يمكن الحجز في تاريخ سابق'; end if;
      select e.value into sched from center_info c, jsonb_array_elements(c.week_schedule) e where e.value->>'day' = lower(to_char(d, 'Dy')) limit 1;
      if sched is null or not coalesce((sched->>'open')::boolean, false) then raise exception 'المركز مغلق في هذا اليوم'; end if;
      if tm < sched->>'from' or tm > sched->>'to' then raise exception 'الوقت خارج ساعات عمل المركز (% - %)', sched->>'from', sched->>'to'; end if;
      if exists (select 1 from holidays where date = d and active) then raise exception 'المركز مغلق في هذا اليوم — اختر يومًا آخر'; end if;
    end;
  end if;
  v_price := effective_price(svc.id, th, _uuid(p, 'priceId'));

  if pkg is not null and not exists (select 1 from packages where id = pkg and patient_id = pat.id and status = 'active' and used_sessions < total_sessions) then
    raise exception 'الباقة غير صالحة لهذا المريض';
  end if;
  if p ? 'planId' then select * into plan from treatment_plans where id = _uuid(p, 'planId') and patient_id = pat.id;
  else select * into plan from treatment_plans where id = active_plan_id(pat.id); end if;

  insert into appointments (no, patient_id, type, service_id, therapist_id, location, address, date, time, duration_min, status, price,
                            package_id, plan_id, series_id, branch_id, created_by, notes)
  values (next_counter('appointment', 'MV-'), pat.id, case when loc = 'home' then 'home' else _txt(p, 'type', 'session') end, svc.id, th, loc,
          case when loc = 'home' then _txt(p, 'address') else '' end, d, tm, svc.duration_min, 'new', v_price,
          pkg, plan.id, _uuid(p, 'seriesId'),
          coalesce(_uuid(p, 'branchId'), (select branch_id from therapists where id = th), (select id from branches order by created_at limit 1)),
          my_employee_id(), _txt(p, 'notes'))
  returning * into a;

  if pkg is null and not coalesce(plan.price, 0) > 0 then
    perform new_invoice(pat.id, svc.name, v_price, 'due', d, a.id, null, null, svc.id);
  end if;
  perform notify_staff('appointment_new', case when loc = 'home' then 'تم حجز زيارة منزلية' else 'تم إنشاء موعد جديد' end,
    pat.full_name || ' — ' || svc.name || ' — ' || d || ' ' || tm, a.no, '/appointments', pat.id);
  perform notify_patient(pat.id, 'appointment_new', 'تم حجز موعدك', svc.name || ' يوم ' || d || ' الساعة ' || tm, a.id::text);
  perform log_action('حجز موعد ' || a.no || ' — ' || svc.name || ' بتاريخ ' || d || ' ' || tm, pat.id);
  return jsonb_build_object('id', a.id, 'no', a.no);
end $function$
;
