-- توحيد أرقام الجوال على E.164 (+201012345678 / +966551234567):
-- البحث القديم كان "phone like '%q%'" — فلو الموظف كتب 0101234 أو 0551234 (بالصفر المحلي) ما كانش هيلاقي الرقم المحفوظ دوليًا.
-- هنا البحث بقى على الأرقام بس بعد شيل أصفار البداية من المدخل، فبيلاقي الرقم بأي صيغة (محلية/دولية/قديمة).
create or replace function phone_digits_match(p_phone text, p_q text) returns boolean
language sql immutable as $$
  select length(ltrim(regexp_replace(coalesce(p_q, ''), '\D', '', 'g'), '0')) >= 3
     and regexp_replace(coalesce(p_phone, ''), '\D', '', 'g') like '%' || ltrim(regexp_replace(coalesce(p_q, ''), '\D', '', 'g'), '0') || '%';
$$;

create or replace function global_search(p_q text) returns jsonb
language plpgsql stable security definer set search_path = public as $$
declare q text := trim(coalesce(p_q, '')); pat text; res jsonb := '[]'::jsonb;
begin
  if my_employee_id() is null then raise exception 'غير مصرح' using errcode = '42501'; end if;
  if length(q) < 2 then return res; end if;
  pat := '%' || replace(replace(replace(q, '\', '\\'), '%', '\%'), '_', '\_') || '%';
  if has_perm('patients', 'view') then
    res := res || coalesce((select jsonb_agg(jsonb_build_object('type','patient','id',id,'title',full_name,'sub',file_no || ' · ' || phone,'link','/patients/' || id))
      from (select * from patients where can_see_patient(id) and (full_name ilike pat or phone like pat or phone_digits_match(phone, q) or file_no ilike pat or national_id like pat) order by full_name limit 6) p), '[]');
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
end $$;

create or replace function list_patients(p_q text default '', p_gender text default '', p_source text default '', p_active text default '',
  p_doctor uuid default null, p_sort text default 'registered_desc', p_limit int default 20, p_offset int default 0) returns jsonb
language plpgsql stable security definer set search_path = public as $$
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
    where can_see_patient(p.id)
      and (trim(coalesce(p_q, '')) = '' or p.full_name ilike pat or p.phone like pat or phone_digits_match(p.phone, p_q) or p.file_no ilike pat or p.national_id like pat)
      and (coalesce(p_gender, '') = '' or p.gender = p_gender)
      and (coalesce(p_source, '') = '' or p.referral_source = p_source)
      and (coalesce(p_active, '') = '' or p.active = (p_active = 'on'))
      and (p_doctor is null or p.doctor_id = p_doctor)
  ), pg as (
    select f.*, row_number() over (order by
      case when p_sort = 'name_asc' then f.full_name end asc, case when p_sort = 'name_desc' then f.full_name end desc,
      case when p_sort = 'file_asc' then f.file_no end asc,
      case when p_sort = 'last_visit_desc' then f.last_visit end desc nulls last,
      case when p_sort = 'registered_asc' then f.registered_at end asc,
      f.registered_at desc) as rn from f
  )
  select jsonb_build_object('total', (select count(*) from f),
    'rows', coalesce((select jsonb_agg(to_jsonb(x) order by x.rn) from (select * from pg where rn > off and rn <= off + lim) x), '[]'))
  into res;
  return res;
end $$;
