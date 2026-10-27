-- 152: صفحة المرضى: ترتيب رقم الملف رقميًا (الأصغر للأكبر — كان نصيًا فـ TM-100 قبل TM-92) + فلتر «بيانات ناقصة» (هوية/جوال/اسم ثلاثي/جنسية غير مؤكدة).
drop function if exists list_patients(text, text, text, text, uuid, text, integer, integer);
CREATE OR REPLACE FUNCTION public.list_patients(p_q text DEFAULT ''::text, p_gender text DEFAULT ''::text, p_source text DEFAULT ''::text, p_active text DEFAULT ''::text, p_doctor uuid DEFAULT NULL::uuid, p_sort text DEFAULT 'registered_desc'::text, p_limit integer DEFAULT 20, p_offset integer DEFAULT 0, p_gaps text DEFAULT ''::text)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare pat text; res jsonb; lim int := least(greatest(coalesce(p_limit, 20), 1), 200); off int := greatest(coalesce(p_offset, 0), 0);
begin
  perform require_perm('patients', 'view');
  pat := '%' || replace(replace(replace(trim(coalesce(p_q, '')), '\', '\\'), '%', '\%'), '_', '\_') || '%';
  with f as (
    select p.*, t.name as doctor_name,
      (select max(a.date) from appointments a where a.patient_id = p.id and a.status in ('completed','arrived','in_progress')) as last_visit,
      (select min(a.date) from appointments a where a.patient_id = p.id and a.status in ('new','confirmed','rescheduled') and a.date >= riyadh_today()) as next_visit,
      (select coalesce(sum(i.remaining), 0) from invoices i where i.patient_id = p.id and i.status in ('due','partial')) as balance,
      exists (select 1 from customers c where c.patient_id = p.id) as has_account
    from patients p left join therapists t on t.id = p.doctor_id
    where not p.is_guest and can_see_patient(p.id)
      and (trim(coalesce(p_q, '')) = '' or p.full_name ilike pat or p.phone like pat or phone_digits_match(p.phone, p_q) or p.file_no ilike pat or p.national_id like pat)
      and (coalesce(p_gender, '') = '' or p.gender = p_gender)
      and (coalesce(p_source, '') = '' or p.referral_source = p_source)
      and (coalesce(p_active, '') = '' or p.active = (p_active = 'on'))
      and (p_doctor is null or p.doctor_id = p_doctor)
      and (coalesce(p_gaps, '') = ''
        or (p_gaps in ('any', 'id') and coalesce(p.national_id, '') = '')
        or (p_gaps in ('any', 'phone') and length(regexp_replace(coalesce(p.phone, ''), 'D', '', 'g')) < 9)
        or (p_gaps in ('any', 'name') and coalesce(array_length(regexp_split_to_array(trim(p.full_name), 's+'), 1), 0) < 3)
        or (p_gaps in ('any', 'nationality') and p.nationality_unconfirmed))
  ), pg as (
    select f.*, row_number() over (order by
      case when p_sort = 'name_asc' then f.full_name end asc, case when p_sort = 'name_desc' then f.full_name end desc,
      case when p_sort = 'file_asc' then coalesce(nullif(regexp_replace(f.file_no, 'D', '', 'g'), '')::bigint, 0) end asc,
      case when p_sort = 'file_desc' then coalesce(nullif(regexp_replace(f.file_no, 'D', '', 'g'), '')::bigint, 0) end desc,
      case when p_sort = 'last_visit_desc' then f.last_visit end desc nulls last,
      case when p_sort = 'registered_asc' then f.registered_at end asc,
      f.registered_at desc) as rn from f
  )
  select jsonb_build_object('total', (select count(*) from f),
    'rows', coalesce((select jsonb_agg(to_jsonb(x) order by x.rn) from (select * from pg where rn > off and rn <= off + lim) x), '[]'))
  into res;
  return res;
end $function$
;
revoke execute on function list_patients(text, text, text, text, uuid, text, integer, integer, text) from public, anon;
grant execute on function list_patients(text, text, text, text, uuid, text, integer, integer, text) to authenticated;
