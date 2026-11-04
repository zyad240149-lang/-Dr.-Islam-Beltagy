-- 934: النوع (ذكر/أنثى) إلزامي عند إنشاء حساب مريض أونلاين، بالموبايل أو بجوجل.
-- الملف الموجود بيتكمّل نوعه لو كان فاضي، والنوع المسجّل في الملف مابيتغيّرش من التسجيل.
drop function if exists public.register_customer(uuid, text, text, text, text);
create or replace function public.register_customer(p_auth_user uuid, p_name text, p_phone text, p_email text, p_national_id text default null, p_gender text default null)
returns jsonb language plpgsql security definer set search_path to 'public'
as $function$
declare pid uuid; cid uuid; last9 text := right(regexp_replace(p_phone, '\D', '', 'g'), 9); nm text; w text[]; nid text := norm_id(p_national_id); linked boolean := false;
begin
  if coalesce(p_gender, '') not in ('male', 'female') then
    raise exception 'اختار النوع: ذكر أو أنثى';
  end if;
  nm := assert_patient_name(p_name);
  w := regexp_split_to_array(nm, ' ');
  if exists (select 1 from patients where right(regexp_replace(phone, '\D', '', 'g'), 9) = last9
      and not exists (select 1 from customers c where c.patient_id = patients.id)) then
    -- ملف موجود بنفس الموبايل = نفس الملف بشرط الرقم القومي/الجواز المسجّل فيه يطابق
    select id into pid from patients where right(regexp_replace(phone, '\D', '', 'g'), 9) = last9
      and nid <> '' and norm_id(national_id) = nid
      and not exists (select 1 from customers c where c.patient_id = patients.id) order by registered_at limit 1;
    if pid is null then
      raise exception 'الرقم ده مسجّل في ملف مريض — لازم الرقم القومي المسجّل في الملف عشان نربط الحساب، أو كلّم العيادة';
    end if;
    linked := true;
    -- الاسم الناقص أو مش عربي في الملف الموجود بيتكمّل بالاسم الثلاثي العربي
    update patients set email = case when coalesce(email, '') = '' then coalesce(trim(p_email), '') else email end,
      gender = case when coalesce(gender, '') in ('male', 'female') then gender else p_gender end,
      full_name = case when name_words(full_name) < 3 or not is_arabic_name(full_name) then nm else full_name end,
      first_name = case when name_words(full_name) < 3 or not is_arabic_name(full_name) then w[1] else first_name end,
      father_name = case when name_words(full_name) < 3 or not is_arabic_name(full_name) then w[2] else father_name end,
      family_name = case when name_words(full_name) < 3 or not is_arabic_name(full_name) then array_to_string(w[3:], ' ') else family_name end
    where id = pid;
  else
    insert into patients (file_no, full_name, first_name, father_name, family_name, phone, email, gender, referral_source)
    values ('', nm, w[1], w[2], array_to_string(w[3:], ' '), p_phone, coalesce(trim(p_email), ''), p_gender, 'website') returning id into pid;
  end if;
  insert into customers (auth_user_id, patient_id, name, phone, email) values (p_auth_user, pid, nm, p_phone, nullif(trim(coalesce(p_email, '')), '')) returning id into cid;
  insert into audit_logs (user_id, action, table_name, record_id, new_data)
    values (p_auth_user, 'register', 'customers', cid::text, jsonb_build_object('phone', p_phone, 'linkedExisting', linked));
  return jsonb_build_object('customerId', cid, 'patientId', pid);
end $function$;

revoke all on function public.register_customer(uuid, text, text, text, text, text) from public, anon, authenticated;
grant execute on function public.register_customer(uuid, text, text, text, text, text) to service_role;
