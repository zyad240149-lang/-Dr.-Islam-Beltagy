-- الرقم القومي بقى اختياري لاكتمال ملف المريض: فاضي ما بيعتبرش «نقص» بعد كده (يمنع تأكيد الموعد/اعتماد الفاتورة) —
-- لو اتكتب لازم يكون بالشكل الصح، لكن مش شرط. نفس التعديل المقابل على العميل في src/utils/patientGaps.ts
CREATE OR REPLACE FUNCTION public.patient_missing_fields(p patients)
 RETURNS text[]
 LANGUAGE sql
 STABLE
 SET search_path TO 'public'
AS $function$
  select array_remove(array[
    case when name_words(p.full_name) < 3 or not is_arabic_name(regexp_replace(coalesce(p.full_name, ''), '\s+', ' ', 'g')) then 'الاسم الثلاثي بالعربي' end,
    case when length(regexp_replace(coalesce(p.phone, ''), '\D', '', 'g')) < 9 then 'رقم الجوال' end,
    case when coalesce(p.nationality, '') not in ('saudi', 'non_saudi') or coalesce(p.nationality_unconfirmed, false) then 'الجنسية (مصري / أجنبي)' end,
    case when coalesce(p.national_id, '') <> ''
           and ((coalesce(p.nationality, 'saudi') <> 'non_saudi' and p.national_id !~ '^[23][0-9]{13}$')
             or (p.nationality = 'non_saudi' and p.national_id !~ '^[A-Za-z0-9]{6,20}$'))
         then case when p.nationality = 'non_saudi' then 'رقم جواز السفر' else 'الرقم القومي' end end,
    case when coalesce(p.gender, '') not in ('male', 'female') then 'الجنس' end
  ], null)
$function$
;
