-- إصلاح: ربط حساب العميل (البوابة) بملف المريض بالجوال كان بيشيل حرف D بدل أي حاجة مش رقم — الجوال بـ +966 أو مسافات ماكانش بيتطابق.
CREATE OR REPLACE FUNCTION public.patients_after_promote()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
begin
  perform notify_staff('patient_new', 'تسجيل مريض جديد', new.full_name || ' — ' || new.file_no, new.referral_source, '/patients/' || new.id, new.id);
  update customers set patient_id = new.id
   where patient_id is null and right(regexp_replace(phone, '\D', '', 'g'), 9) = right(regexp_replace(new.phone, '\D', '', 'g'), 9);
  return new;
end $function$
;

CREATE OR REPLACE FUNCTION public.patients_after_insert()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
begin
  if new.is_guest then return new; end if;
  perform notify_staff('patient_new', 'تسجيل مريض جديد', new.full_name || ' — ' || new.file_no, new.referral_source, '/patients/' || new.id, new.id);
  update customers set patient_id = new.id
   where patient_id is null and right(regexp_replace(phone, '\D', '', 'g'), 9) = right(regexp_replace(new.phone, '\D', '', 'g'), 9);
  return new;
end $function$
;

