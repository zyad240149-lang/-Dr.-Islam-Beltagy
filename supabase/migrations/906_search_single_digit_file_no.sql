-- البحث الموحّد: رقم ملف من خانة واحدة (1..9) كان بيترجع فاضي لأن أقل طول للبحث حرفين.
-- رقم واحد بس ← تطابق تام لرقم الملف (مش أي جوال فيه الرقم ده). باقي السلوك زي ما هو.
create or replace function public.global_search(p_q text)
 returns jsonb
 language plpgsql
 stable security definer
 set search_path to 'public'
as $function$
declare q text := trim(coalesce(p_q, '')); pat text; res jsonb := '[]'::jsonb; d text;
begin
  if my_employee_id() is null then raise exception 'غير مصرح' using errcode = '42501'; end if;
  d := translate(q, '٠١٢٣٤٥٦٧٨٩', '0123456789');
  if length(q) < 2 then
    if d ~ '^[0-9]$' and has_perm('patients', 'view') then
      res := coalesce((select jsonb_agg(jsonb_build_object('type','patient','id',id,'title',full_name,'sub',file_no || ' · ' || phone,'link','/patients/' || id))
        from (select * from patients where not is_guest and can_see_patient(id) and regexp_replace(file_no, '\D', '', 'g') = d limit 6) p), '[]');
    end if;
    return res;
  end if;
  pat := '%' || replace(replace(replace(q, '\', '\\'), '%', '\%'), '_', '\_') || '%';
  if has_perm('patients', 'view') then
    res := res || coalesce((select jsonb_agg(jsonb_build_object('type','patient','id',id,'title',full_name,'sub',file_no || ' · ' || phone,'link','/patients/' || id))
      from (select * from patients where not is_guest and can_see_patient(id) and (patient_q_match(full_name, phone, file_no, national_id, q)) order by patient_q_rank(file_no, national_id, phone, q), full_name limit 6) p), '[]');
  end if;
  if has_perm('therapists', 'view') or has_perm('booking', 'view') then
    res := res || coalesce((select jsonb_agg(jsonb_build_object('type','doctor','id',id,'title',name,'sub',title,'link','/employees?tab=therapists&q=' || name))
      from (select * from therapists where name ilike pat or phone like pat or phone_digits_match(phone, q) order by name limit 5) t), '[]');
  end if;
  if has_perm('appointments', 'view') then
    res := res || coalesce((select jsonb_agg(jsonb_build_object('type','appointment','id',a.id,'title',a.no || ' — ' || p.full_name,'sub',a.date || ' ' || a.time,'link','/appointments?q=' || a.no))
      from (select * from appointments where no ilike pat and can_see_patient(patient_id) order by date desc limit 5) a join patients p on p.id = a.patient_id), '[]');
  end if;
  return res;
end $function$;
