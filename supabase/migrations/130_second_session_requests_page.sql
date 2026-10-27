-- 130: إشعار طلب الجلسة الثانية بيودّي «طلبات الموظفين» (/requests) — الطلبات بتظهر هناك للمدير.
CREATE OR REPLACE FUNCTION public.request_second_session(p_source text, p_id uuid, p_therapist uuid, p_note text DEFAULT ''::text)
 RETURNS uuid
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare emp uuid; v_patient uuid; v uuid; v_name text;
begin
  emp := require_perm('appointments', 'edit');
  if p_source = 'package' then select patient_id, name into v_patient, v_name from packages where id = p_id;
  elsif p_source = 'plan' then select patient_id, 'خطة علاج ' || total_sessions || ' جلسات' into v_patient, v_name from treatment_plans where id = p_id;
  else raise exception 'نوع غير معروف'; end if;
  if v_patient is null then raise exception 'الباقة/الخطة غير موجودة'; end if;
  if not can_see_patient(v_patient) then raise exception 'لا توجد صلاحية على ملف هذا المريض' using errcode = '42501'; end if;
  if p_therapist is null then raise exception 'اختر الدكتور للجلسة الثانية'; end if;
  if patient_day_sessions(v_patient, riyadh_today(), null) = 0 then
    raise exception 'المريض لسه ماحضرش جلسة النهارده — سجّل الحضور العادي'; end if;
  if exists (select 1 from second_session_requests r where r.patient_id = v_patient and r.status = 'pending') then
    raise exception 'فيه طلب جلسة ثانية بانتظار موافقة المدير بالفعل'; end if;
  insert into second_session_requests (source, ref_id, patient_id, therapist_id, note, requested_by)
  values (p_source, p_id, v_patient, p_therapist, trim(coalesce(p_note, '')), emp) returning id into v;
  perform notify_staff('staff_request', 'طلب جلسة ثانية اليوم بانتظار موافقتك',
    (select full_name from patients where id = v_patient) || ' — ' || v_name, v::text, '/requests', v_patient);
  perform log_action('طلب جلسة ثانية اليوم — ' || v_name, v_patient);
  return v;
end $function$;
