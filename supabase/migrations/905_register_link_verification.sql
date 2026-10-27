-- 905: ربط حساب المريض الجديد بملف موجود بنفس الموبايل لازم يثبت إنه صاحب الملف
--  قبل كده: أي حد يعرف موبايل مريض عنده ملف (ومالوش حساب) كان يقدر يعمل حساب بالرقم ويشوف ملفه.
--  دلوقتي: لو فيه ملف (أو أكتر — عيلة بموبايل واحد) بنفس الموبايل ومش مربوط بحساب:
--    • لازم يكتب الرقم القومي (أو جواز السفر) المسجّل في الملف، والحساب بيتربط بالملف اللي رقمه مطابق
--    • لو مفيش ولا ملف فيهم رقم قومي ← يكلّم العيادة (يضيفوا الرقم للملف) — مفيش ربط ولا ملف جديد
--    • 5 محاولات غلط في الساعة على نفس الموبايل ← قفل ساعة (ضد التخمين)
--  register_link_check: فحص قبل إنشاء حساب الدخول (بيرجّع حالة وبيسجّل المحاولة الغلط)
--  register_customer: بيطبّق نفس الشرط تاني (حماية مزدوجة لو الفحص اتنسى)

create table if not exists register_attempts (
  id bigserial primary key,
  phone_last9 text not null,
  created_at timestamptz not null default now()
);
create index if not exists register_attempts_phone_idx on register_attempts (phone_last9, created_at);
alter table register_attempts enable row level security; -- للخادم فقط (بدون سياسات)
revoke all on register_attempts from anon, authenticated;

-- توحيد شكل الرقم: من غير مسافات/شُرَط، أرقام عربية ← إنجليزي، حروف الجواز كابيتال
create or replace function public.norm_id(p text) returns text
language sql immutable set search_path to 'public'
as $$ select upper(translate(regexp_replace(coalesce(p, ''), '[\s\-]', '', 'g'), '٠١٢٣٤٥٦٧٨٩۰۱۲۳۴۵۶۷۸۹', '01234567890123456789')) $$;

create or replace function public.register_link_check(p_phone text, p_national_id text)
returns jsonb language plpgsql security definer set search_path to 'public'
as $function$
declare last9 text := right(regexp_replace(coalesce(p_phone, ''), '\D', '', 'g'), 9); nid text := norm_id(p_national_id);
  n_files int; n_with_id int; matched uuid;
begin
  select count(*), count(*) filter (where norm_id(national_id) <> '') into n_files, n_with_id
    from patients where right(regexp_replace(phone, '\D', '', 'g'), 9) = last9
      and not exists (select 1 from customers c where c.patient_id = patients.id);
  if n_files = 0 then return jsonb_build_object('ok', true, 'link', false); end if;
  delete from register_attempts where created_at < now() - interval '1 day';
  if (select count(*) from register_attempts where phone_last9 = last9 and created_at > now() - interval '1 hour') >= 5 then
    return jsonb_build_object('ok', false, 'code', 'locked');
  end if;
  if n_with_id = 0 then return jsonb_build_object('ok', false, 'code', 'contact_clinic'); end if;
  if nid = '' then return jsonb_build_object('ok', false, 'code', 'need_id'); end if;
  select id into matched from patients where right(regexp_replace(phone, '\D', '', 'g'), 9) = last9
    and norm_id(national_id) = nid and not exists (select 1 from customers c where c.patient_id = patients.id) limit 1;
  if matched is null then
    insert into register_attempts (phone_last9) values (last9);
    return jsonb_build_object('ok', false, 'code', 'id_mismatch');
  end if;
  return jsonb_build_object('ok', true, 'link', true);
end $function$;

drop function if exists public.register_customer(uuid, text, text, text);
create or replace function public.register_customer(p_auth_user uuid, p_name text, p_phone text, p_email text, p_national_id text default null)
returns jsonb language plpgsql security definer set search_path to 'public'
as $function$
declare pid uuid; cid uuid; last9 text := right(regexp_replace(p_phone, '\D', '', 'g'), 9); nm text; w text[]; nid text := norm_id(p_national_id); linked boolean := false;
begin
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
      full_name = case when name_words(full_name) < 3 or not is_arabic_name(full_name) then nm else full_name end,
      first_name = case when name_words(full_name) < 3 or not is_arabic_name(full_name) then w[1] else first_name end,
      father_name = case when name_words(full_name) < 3 or not is_arabic_name(full_name) then w[2] else father_name end,
      family_name = case when name_words(full_name) < 3 or not is_arabic_name(full_name) then array_to_string(w[3:], ' ') else family_name end
    where id = pid;
  else
    insert into patients (file_no, full_name, first_name, father_name, family_name, phone, email, referral_source)
    values ('', nm, w[1], w[2], array_to_string(w[3:], ' '), p_phone, coalesce(trim(p_email), ''), 'website') returning id into pid;
  end if;
  insert into customers (auth_user_id, patient_id, name, phone, email) values (p_auth_user, pid, nm, p_phone, nullif(trim(coalesce(p_email, '')), '')) returning id into cid;
  insert into audit_logs (user_id, action, table_name, record_id, new_data)
    values (p_auth_user, 'register', 'customers', cid::text, jsonb_build_object('phone', p_phone, 'linkedExisting', linked));
  return jsonb_build_object('customerId', cid, 'patientId', pid);
end $function$;

revoke all on function public.register_customer(uuid, text, text, text, text) from public, anon, authenticated;
grant execute on function public.register_customer(uuid, text, text, text, text) to service_role;
revoke all on function public.register_link_check(text, text) from public, anon, authenticated;
grant execute on function public.register_link_check(text, text) to service_role;
revoke all on function public.norm_id(text) from public, anon;
grant execute on function public.norm_id(text) to authenticated, service_role;
