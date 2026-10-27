-- «تعديل» من الفواتير والمدفوعات: الخدمة/السعر/الدكتور/الموعد مسموح قبل التأكيد وبعده وبعد اكتمال الموعد (تصحيح السجل).
-- الملغي بس ممنوع. الفاتورة المرتبطة بتتحدّث (السعر مايقلّش عن المدفوع، والمرسلة لهيئة الزكاة سعرها مقفول).
CREATE OR REPLACE FUNCTION public.update_appointment_details(p_id uuid, p jsonb)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare a appointments; svc services; new_service_id text; new_location text; new_type text; new_address text; new_notes text; inv_id uuid; new_date date; new_time text; new_price numeric; sched jsonb; inv invoices; new_th uuid;
begin
  perform require_perm('appointments', 'edit');
  select * into a from appointments where id = p_id for update;
  if a.id is null or not can_see_patient(a.patient_id) then raise exception 'الموعد غير موجود'; end if;
  if a.status = 'cancelled' then raise exception 'لا يمكن تعديل موعد ملغي'; end if;

  new_service_id := coalesce(nullif(p->>'serviceId', ''), a.service_id);
  new_location := coalesce(nullif(p->>'location', ''), a.location);
  new_type := case when new_location = 'home' then 'home' else coalesce(nullif(p->>'type', ''), a.type) end;
  new_address := case when new_location = 'home' then trim(coalesce(p->>'address', a.address)) else '' end;
  new_notes := coalesce(p->>'notes', a.notes);

  if new_location not in ('center', 'home') then raise exception 'مكان الموعد غير صحيح'; end if;
  if new_location = 'home' and new_address = '' then raise exception 'أدخل عنوان الزيارة المنزلية'; end if;

  select * into svc from services where id = new_service_id;
  if svc.id is null or not svc.active then raise exception 'الخدمة غير موجودة أو موقوفة'; end if;

  new_date := coalesce(nullif(p->>'date', '')::date, a.date);
  new_time := coalesce(nullif(p->>'time', ''), a.time);
  new_th := coalesce(_uuid(p, 'therapistId'), a.therapist_id);
  if new_date is distinct from a.date or new_time is distinct from a.time or new_service_id is distinct from a.service_id or new_th is distinct from a.therapist_id then
    if a.status = 'completed' then
      if new_th is null then raise exception 'يرجى اختيار الدكتور أولًا'; end if;
      if not exists (select 1 from therapists where id = new_th) then raise exception 'الدكتور غير موجود'; end if;
      if new_time !~ '^\d{2}:\d{2}$' then raise exception 'صيغة الوقت غير صحيحة'; end if;
      if new_date > riyadh_today() then raise exception 'موعد مكتمل — التاريخ لا يكون في المستقبل'; end if;
    elsif new_th is not null then
      perform assert_booking_doctor(new_th, new_service_id, null);
      perform check_slot(new_th, new_date, new_time, svc.duration_min, p_id);
    else
      if new_time !~ '^\d{2}:\d{2}$' then raise exception 'صيغة الوقت غير صحيحة'; end if;
      if new_date < riyadh_today() then raise exception 'لا يمكن الحجز في تاريخ سابق'; end if;
      select e.value into sched from center_info c, jsonb_array_elements(c.week_schedule) e where e.value->>'day' = lower(to_char(new_date, 'Dy')) limit 1;
      if sched is null or not coalesce((sched->>'open')::boolean, false) then raise exception 'المركز مغلق في هذا اليوم'; end if;
      if new_time < sched->>'from' or new_time > sched->>'to' then raise exception 'الوقت خارج ساعات عمل المركز (% - %)', sched->>'from', sched->>'to'; end if;
      if exists (select 1 from holidays where date = new_date and active) then raise exception 'المركز مغلق في هذا اليوم — اختر يومًا آخر'; end if;
    end if;
  end if;

  new_price := case when nullif(p->>'price', '') is not null then (p->>'price')::numeric
                    when new_service_id is distinct from a.service_id then svc.price else a.price end;
  if new_price < 0 then raise exception 'السعر غير صحيح'; end if;


  update appointments set service_id = svc.id, type = new_type, location = new_location, address = new_address,
    therapist_id = new_th, duration_min = svc.duration_min, price = new_price, notes = new_notes, date = new_date, time = new_time,
    status = case when a.status = 'completed' then status when new_date is distinct from a.date or new_time is distinct from a.time then 'rescheduled' else status end, updated_at = now()
  where id = p_id;

  -- الفاتورة المرتبطة تتحدّث بس لو لسه من غير أي دفعة (حماية من تغيير فاتورة اتدفع منها جزء تلقائيًا —
  -- المدير عنده تحكم كامل يدوي في الفاتورة نفسها من صفحة الفواتير لو محتاج تعديل بعد الدفع)
  -- الفاتورة المرتبطة (لو فيه): السعر/الخدمة/التاريخ — مسموح طالما الإجمالي الجديد مش أقل من المدفوع
  for inv in select * from invoices where appointment_id = p_id and status in ('due', 'draft', 'partial', 'paid') loop
    if inv.zatca_status is not null and (inv.price is distinct from new_price) then raise exception 'الفاتورة % اتبعتت لهيئة الزكاة — لا يمكن تعديل سعرها', inv.no; end if;
    if new_price - coalesce(inv.discount, 0) < coalesce(inv.paid, 0) then
      raise exception 'السعر الجديد أقل من المبلغ المدفوع في الفاتورة %', inv.no;
    end if;
    update invoices set price = new_price, service_name = svc.name, date = new_date where id = inv.id;
    perform recalc_invoice(inv.id);
  end loop;

  perform log_action(case when a.status = 'completed' then 'تعديل موعد مكتمل ' else 'تعديل تفاصيل الموعد ' end || a.no || ' — ' || svc.name, a.patient_id);
end $function$;

