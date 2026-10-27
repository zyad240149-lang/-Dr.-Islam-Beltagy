-- تعديل كامل لتفاصيل الموعد بعد إنشائه (الخدمة، نوع الزيارة، العنوان، الملاحظات) — منفصل عن إعادة الجدولة
-- (اللي بتغيّر التاريخ/الوقت/المعالج فقط). لو الخدمة اتغيّرت والمعالج الحالي مش بيقدّمها، بنرفض ونطلب
-- تغيير المعالج أولًا عبر "إعادة جدولة" لأمان منطق التعارض (check_slot) بدل ما نعيد كتابته هنا.
create or replace function update_appointment_details(p_id uuid, p jsonb) returns void
language plpgsql security definer set search_path = public as $$
declare a appointments; svc services; new_service_id text; new_location text; new_type text; new_address text; new_notes text; inv_id uuid;
begin
  perform require_perm('appointments', 'edit');
  select * into a from appointments where id = p_id for update;
  if a.id is null or not can_see_patient(a.patient_id) then raise exception 'الموعد غير موجود'; end if;
  if a.status in ('cancelled', 'completed') then raise exception 'لا يمكن تعديل موعد ملغي أو مكتمل'; end if;

  new_service_id := coalesce(nullif(p->>'serviceId', ''), a.service_id);
  new_location := coalesce(nullif(p->>'location', ''), a.location);
  new_type := case when new_location = 'home' then 'home' else coalesce(nullif(p->>'type', ''), a.type) end;
  new_address := case when new_location = 'home' then trim(coalesce(p->>'address', a.address)) else '' end;
  new_notes := coalesce(p->>'notes', a.notes);

  if new_location not in ('center', 'home') then raise exception 'مكان الموعد غير صحيح'; end if;
  if new_location = 'home' and new_address = '' then raise exception 'أدخل عنوان الزيارة المنزلية'; end if;

  select * into svc from services where id = new_service_id;
  if svc.id is null or not svc.active then raise exception 'الخدمة غير موجودة أو موقوفة'; end if;

  if new_service_id is distinct from a.service_id then
    if a.therapist_id is not null and not exists (select 1 from therapist_services where therapist_id = a.therapist_id and service_id = svc.id) then
      raise exception 'المعالج الحالي لا يقدّم الخدمة الجديدة — استخدم «إعادة جدولة» لاختيار معالج يقدّمها أولًا';
    end if;
  end if;

  update appointments set service_id = svc.id, type = new_type, location = new_location, address = new_address,
    duration_min = svc.duration_min, price = svc.price, notes = new_notes, updated_at = now()
  where id = p_id;

  -- الفاتورة المرتبطة تتحدّث بس لو لسه من غير أي دفعة (حماية من تغيير فاتورة اتدفع منها جزء تلقائيًا —
  -- المدير عنده تحكم كامل يدوي في الفاتورة نفسها من صفحة الفواتير لو محتاج تعديل بعد الدفع)
  if new_service_id is distinct from a.service_id then
    update invoices set price = svc.price, service_name = svc.name
    where appointment_id = p_id and status in ('due', 'draft') and paid = 0;
    for inv_id in select id from invoices where appointment_id = p_id and status in ('due', 'draft') and paid = 0 loop
      perform recalc_invoice(inv_id);
    end loop;
  end if;

  perform log_action('تعديل تفاصيل الموعد ' || a.no || ' — ' || svc.name, a.patient_id);
end $$;

revoke execute on function update_appointment_details(uuid, jsonb) from public, anon;
grant execute on function update_appointment_details(uuid, jsonb) to authenticated;
