-- 141: «تأكيد» (= حضر) و«لم يحضر» كانوا بيتسجّلوا على موعد تاريخه لسه ماجاش (مثلًا موعد بعد يومين يتعلّم «لم يحضر»).
-- الحضور المبكر كمان كان بيدخل في تارجت الأخصائي لشهر الموعد. دلوقتي الحالات دي في يوم الموعد أو بعده بس.
CREATE OR REPLACE FUNCTION public.set_appointment_status(p_id uuid, p_status text, p_reason text DEFAULT NULL::text, p_therapist uuid DEFAULT NULL::uuid)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare a appointments; pname text; label text;
begin
  perform require_any(array['appointments:edit', 'sessions:edit']);
  if p_status = 'arrived' then perform require_perm('appt_confirm', 'view'); end if;
  if p_status = 'cancelled' then perform require_perm('appt_cancel', 'view'); end if;
  select * into a from appointments where id = p_id for update;
  if a.id is null or not can_see_patient(a.patient_id) then raise exception 'الموعد غير موجود'; end if;
  if p_status not in ('new','confirmed','on_way','arrived','in_progress','no_show','completed','cancelled','rescheduled') then raise exception 'حالة غير صحيحة'; end if;
  if a.status = 'cancelled' and p_status <> 'cancelled' then raise exception 'الموعد ملغي — أنشئ موعدًا جديدًا'; end if;
  if p_status in ('arrived', 'in_progress', 'completed', 'no_show') and a.date > riyadh_today() then
    raise exception 'الموعد بتاريخ % — الحضور أو عدم الحضور بيتسجّل في يوم الموعد أو بعده', a.date;
  end if;
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
