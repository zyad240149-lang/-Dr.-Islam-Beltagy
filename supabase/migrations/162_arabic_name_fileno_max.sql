-- 162 (طلب المستخدم 2026-10-18):
--  1) الاسم لازم يكون بالعربي — في التسجيل/جوجل/تعديل البيانات/الحجز، وجزء من «مكتمل» (الاسم الثلاثي بالعربي).
--  2) رقم الملف الجديد = أعلى رقم موجود + 1 (بقفل) بدل عدّاد بيتقدّم ومايرجعش — مرضى الاختبار المؤقتين كانوا بياكلوا أرقام
--     (المريض الحقيقي فهد عشوي الظفيري خد 15758 بدل 15754)، فرقمه اتصلّح لـ 15754 بموافقة المستخدم.

-- ========== الاسم بالعربي ==========
-- حروف عربية (ء–ي + تشكيل + ـ + آ/أ/إ/ة/ى وحروف فارسية شائعة في الأسماء) ومسافات بس — من غير حروف لاتيني ولا أرقام ولا رموز
create or replace function public.is_arabic_name(p text) returns boolean
language sql immutable set search_path to 'public'
as $$ select coalesce(trim(p), '') <> '' and trim(p) ~ '^[ء-غـ-ْٰپچژکگی ]+$' $$;

create or replace function public.patient_missing_fields(p patients) returns text[]
language sql stable set search_path to 'public'
as $$
  select array_remove(array[
    case when name_words(p.full_name) < 3 or not is_arabic_name(regexp_replace(coalesce(p.full_name, ''), '\s+', ' ', 'g')) then 'الاسم الثلاثي بالعربي' end,
    case when length(regexp_replace(coalesce(p.phone, ''), '\D', '', 'g')) < 9 then 'رقم الجوال' end,
    case when coalesce(p.nationality, '') not in ('saudi', 'non_saudi') or coalesce(p.nationality_unconfirmed, false) then 'نوع الهوية (الجنسية)' end,
    case when coalesce(p.national_id, '') !~ '^\d{10}$'
           or (p.nationality = 'non_saudi' and left(p.national_id, 1) <> '2')
           or (coalesce(p.nationality, 'saudi') <> 'non_saudi' and left(p.national_id, 1) <> '1')
         then case when p.nationality = 'non_saudi' then 'رقم الإقامة' else 'رقم الهوية الوطنية' end end,
    case when coalesce(p.gender, '') not in ('male', 'female') then 'الجنس' end
  ], null)
$$;

-- رسالة واحدة لكل مسارات المريض
create or replace function public.assert_patient_name(p_name text) returns text
language plpgsql immutable set search_path to 'public'
as $$
declare nm text := regexp_replace(trim(coalesce(p_name, '')), '\s+', ' ', 'g');
begin
  if name_words(nm) < 3 or not is_arabic_name(nm) then
    raise exception 'اكتب اسمك الثلاثي بالعربي (الاسم واسم الأب واسم الجد) — حروف عربية بس';
  end if;
  return nm;
end $$;

create or replace function public.register_customer(p_auth_user uuid, p_name text, p_phone text, p_email text)
returns jsonb language plpgsql security definer set search_path to 'public'
as $function$
declare pid uuid; cid uuid; last9 text := right(regexp_replace(p_phone, '\D', '', 'g'), 9); nm text; w text[];
begin
  nm := assert_patient_name(p_name);
  w := regexp_split_to_array(nm, ' ');
  -- ملف موجود بنفس الجوال (فتحه الموظف قبل كده) = نفس الملف، من غير ملف مكرر
  select id into pid from patients where right(regexp_replace(phone, '\D', '', 'g'), 9) = last9
    and not exists (select 1 from customers c where c.patient_id = patients.id) order by registered_at limit 1;
  if pid is null then
    insert into patients (file_no, full_name, first_name, father_name, family_name, phone, email, referral_source)
    values ('', nm, w[1], w[2], array_to_string(w[3:], ' '), p_phone, coalesce(trim(p_email), ''), 'website') returning id into pid;
  else
    -- الاسم الناقص أو مش عربي في الملف الموجود بيتكمّل بالاسم الثلاثي العربي
    update patients set email = case when coalesce(email, '') = '' then coalesce(trim(p_email), '') else email end,
      full_name = case when name_words(full_name) < 3 or not is_arabic_name(full_name) then nm else full_name end,
      first_name = case when name_words(full_name) < 3 or not is_arabic_name(full_name) then w[1] else first_name end,
      father_name = case when name_words(full_name) < 3 or not is_arabic_name(full_name) then w[2] else father_name end,
      family_name = case when name_words(full_name) < 3 or not is_arabic_name(full_name) then array_to_string(w[3:], ' ') else family_name end
    where id = pid;
  end if;
  insert into customers (auth_user_id, patient_id, name, phone, email) values (p_auth_user, pid, nm, p_phone, nullif(trim(coalesce(p_email, '')), '')) returning id into cid;
  insert into audit_logs (user_id, action, table_name, record_id, new_data) values (p_auth_user, 'register', 'customers', cid::text, jsonb_build_object('phone', p_phone));
  return jsonb_build_object('customerId', cid, 'patientId', pid);
end $function$;

create or replace function public.patient_update_profile(p jsonb)
returns void language plpgsql security definer set search_path to 'public'
as $function$
declare c customers; nm text := ''; w text[];
begin
  c := require_patient();
  if p ? 'fullName' then nm := assert_patient_name(p->>'fullName'); w := regexp_split_to_array(nm, ' '); end if;
  update patients set full_name = coalesce(nullif(nm, ''), full_name),
    first_name = case when nm <> '' then w[1] else first_name end,
    father_name = case when nm <> '' then w[2] else father_name end,
    family_name = case when nm <> '' then array_to_string(w[3:], ' ') else family_name end,
    email = coalesce(trim(p->>'email'), email),
    address = coalesce(trim(p->>'address'), address), city = coalesce(trim(p->>'city'), city), district = coalesce(trim(p->>'district'), district),
    street = coalesce(trim(p->>'street'), street), gender = coalesce(nullif(p->>'gender', ''), gender),
    birth_date = case when p ? 'birthDate' then nullif(p->>'birthDate', '')::date else birth_date end,
    emergency_contact_name = coalesce(trim(p->>'emergencyContactName'), emergency_contact_name),
    emergency_contact_phone = coalesce(trim(p->>'emergencyContactPhone'), emergency_contact_phone)
  where id = c.patient_id;
  update customers set name = coalesce(nullif(nm, ''), name), email = case when p ? 'email' then nullif(trim(p->>'email'), '') else email end where id = c.id;
end $function$;

create or replace function public.patient_name_guard() returns trigger
language plpgsql security definer set search_path to 'public'
as $$
declare nm text := (select full_name from patients where id = new.patient_id);
begin
  if new.source = 'online' and (name_words(nm) < 3 or not is_arabic_name(regexp_replace(coalesce(nm, ''), '\s+', ' ', 'g'))) then
    raise exception 'أكمل اسمك الثلاثي بالعربي أولًا (الاسم واسم الأب واسم الجد) — بيتحفظ في ملفك مرة واحدة';
  end if;
  return new;
end $$;

-- ========== رقم الملف: أعلى رقم موجود + 1 ==========
-- قفل واحد لكل الترقيم (تسجيلين في نفس اللحظة بيتنفذوا ورا بعض) + الفهرس الفريد patients_file_no_key. الأرقام الموجودة ماتتغيّرش.
create or replace function public.next_patient_file_no() returns text
language plpgsql security definer set search_path to 'public'
as $$
declare v bigint;
begin
  perform pg_advisory_xact_lock(hashtext('patients.file_no'));
  select coalesce(max(nullif(regexp_replace(file_no, '\D', '', 'g'), '')::bigint), 0) + 1 into v from patients;
  update counters set value = v where name = 'patient'; -- للتوافق (الاستيراد بيقرا العدّاد)
  return 'TM-' || v;
end $$;

create or replace function public.patients_before_insert() returns trigger
language plpgsql security definer set search_path to 'public'
as $function$
declare dup patients; legacy boolean := coalesce(current_setting('app.legacy_import', true), '') = 'on';
begin
  if new.file_no is null or new.file_no = '' then new.file_no := next_patient_file_no(); end if;
  if legacy then if length(trim(new.full_name)) < 1 then raise exception 'اسم المريض مطلوب'; end if; return new; end if;
  if length(trim(new.full_name)) < 2 then raise exception 'اسم المريض مطلوب'; end if; -- استيراد الملف القديم: جوال ناقص/مكرر مسموح (والنواقص بتتعلّم في الواجهة)
  if length(regexp_replace(new.phone, '\D', '', 'g')) < 9 then raise exception 'رقم الجوال غير صحيح'; end if;
  select * into dup from patients x where right(regexp_replace(x.phone, '\D', '', 'g'), 9) = right(regexp_replace(new.phone, '\D', '', 'g'), 9) limit 1;
  if dup.id is not null then raise exception 'هذا الرقم مسجّل بالفعل للمريض % (%)', dup.full_name, dup.file_no; end if;
  return new;
end $function$;

-- تصحيح رقم المريض الحقيقي اللي اتسجّل وقت الاختبارات (مالوش مواعيد ولا فواتير)
update patients set file_no = 'TM-15754'
where file_no = 'TM-15758' and full_name = 'فهد عشوي الظفيري'
  and not exists (select 1 from patients where file_no = 'TM-15754')
  and not exists (select 1 from patients where nullif(regexp_replace(file_no, '\D', '', 'g'), '')::bigint between 15754 and 15757);
update counters set value = coalesce((select max(nullif(regexp_replace(file_no, '\D', '', 'g'), '')::bigint) from patients), value) where name = 'patient';

revoke all on function public.next_patient_file_no() from public, anon, authenticated;
revoke all on function public.assert_patient_name(text) from public, anon;
grant execute on function public.is_arabic_name(text) to authenticated;
