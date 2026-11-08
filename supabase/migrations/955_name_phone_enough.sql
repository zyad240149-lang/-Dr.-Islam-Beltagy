-- ٨/١١: الاسم والرقم كفاية — مفيش «استكمال بيانات» ولا «حجز مكالمة»
-- 1) الملف الناقص مابقاش بيمنع تأكيد الموعد ولا اعتماد الفاتورة: الشرط الوحيد رقم الجوال
create or replace function public.patient_missing_fields(p patients) returns text[]
language sql stable set search_path to 'public' as $function$
  select array_remove(array[
    case when length(regexp_replace(coalesce(p.phone, ''), '\D', '', 'g')) < 9 then 'رقم الجوال' end
  ], null)
$function$;

-- 2) الاسم: أي اسم (حرفين على الأقل) — مش لازم ثلاثي ولا بالعربي
create or replace function public.assert_patient_name(p_name text) returns text
language plpgsql immutable set search_path to 'public' as $function$
declare nm text := regexp_replace(trim(coalesce(p_name, '')), '\s+', ' ', 'g');
begin
  if length(nm) < 2 then raise exception 'اكتب اسمك'; end if;
  return nm;
end $function$;

create or replace function public.patient_name_guard() returns trigger
language plpgsql security definer set search_path to 'public' as $function$
begin
  return new;
end $function$;

-- 3) التسجيل من الموقع/التطبيق: النوع مش إجباري
CREATE OR REPLACE FUNCTION public.register_customer(p_auth_user uuid, p_name text, p_phone text, p_email text, p_national_id text DEFAULT NULL::text, p_gender text DEFAULT NULL::text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare pid uuid; cid uuid; last9 text := right(regexp_replace(p_phone, '\D', '', 'g'), 9); nm text; w text[]; nid text := norm_id(p_national_id); linked boolean := false;
begin
  if coalesce(p_gender, '') not in ('male', 'female') then p_gender := null; end if; -- ٨/١١: النوع مش إجباري
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

-- 4) الحجز لمريض جديد (اسم + رقم) بيعمل ملف عادي في «المرضى» مش «حجز مكالمة»
CREATE OR REPLACE FUNCTION public.guest_patient(g jsonb)
 RETURNS patients
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare pat patients; digits text := regexp_replace(coalesce(g->>'phone', ''), '\D', '', 'g'); nm text := trim(coalesce(g->>'fullName', ''));
  nat text := case when g->>'nationality' = 'non_saudi' then 'non_saudi' else 'saudi' end;
begin
  if length(digits) < 9 then raise exception 'رقم الجوال غير صحيح'; end if;
  select * into pat from patients where right(regexp_replace(phone, '\D', '', 'g'), 9) = right(digits, 9) order by is_guest, registered_at desc limit 1;
  if pat.id is not null then return pat; end if;
  if length(nm) < 2 then raise exception 'اسم المريض مطلوب'; end if;
  insert into patients (file_no, full_name, phone, is_guest, nationality, notes) values ('', nm, g->>'phone', false, nat, '') returning * into pat;
  return pat;
end $function$;

update patients set is_guest = false where is_guest;
