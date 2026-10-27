-- 159: اكتمال بيانات المريض + منع تأكيد الموعد/اعتماد الفاتورة قبله + ترقيم الملفات الجديدة + الاسم الثلاثي + «حسابات المرضى الأونلاين»
-- (طلب المستخدم 2026-10-18). مفيش أعمدة جديدة: «مكتمل» بيتحسب من بيانات الملف نفسه، فبيتغيّر لوحده أول ما الموظف يكمّل.

-- ========== 1) تعريف «مكتمل» — مصدر واحد (الواجهة نسخة منه: utils/patientGaps.ts) ==========
create or replace function public.name_words(p text) returns int
language sql immutable set search_path to 'public'
as $$ select coalesce(array_length(array_remove(regexp_split_to_array(trim(coalesce(p, '')), '\s+'), ''), 1), 0) $$;

create or replace function public.patient_missing_fields(p patients) returns text[]
language sql stable set search_path to 'public'
as $$
  select array_remove(array[
    case when name_words(p.full_name) < 3 then 'الاسم الثلاثي' end,
    case when length(regexp_replace(coalesce(p.phone, ''), '\D', '', 'g')) < 9 then 'رقم الجوال' end,
    case when coalesce(p.nationality, '') not in ('saudi', 'non_saudi') or coalesce(p.nationality_unconfirmed, false) then 'نوع الهوية (الجنسية)' end,
    case when coalesce(p.national_id, '') !~ '^\d{10}$'
           or (p.nationality = 'non_saudi' and left(p.national_id, 1) <> '2')
           or (coalesce(p.nationality, 'saudi') <> 'non_saudi' and left(p.national_id, 1) <> '1')
         then case when p.nationality = 'non_saudi' then 'رقم الإقامة' else 'رقم الهوية الوطنية' end end,
    case when coalesce(p.gender, '') not in ('male', 'female') then 'الجنس' end
  ], null)
$$;

create or replace function public.patient_is_complete(p_id uuid) returns boolean
language sql stable security definer set search_path to 'public'
as $$ select coalesce((select cardinality(patient_missing_fields(p)) = 0 from patients p where p.id = p_id), false) $$;

-- نفس الرسالة في كل مكان؛ رقم المريض في DETAIL عشان الواجهة تفتح ملفه، والنواقص في HINT
create or replace function public.assert_patient_complete(p_id uuid) returns void
language plpgsql stable security definer set search_path to 'public'
as $$
declare p patients; miss text[];
begin
  select * into p from patients where id = p_id;
  if p.id is null then return; end if;
  miss := patient_missing_fields(p);
  if cardinality(miss) > 0 then
    raise exception using message = 'بيانات المريض غير مكتملة. يجب استكمال البيانات المطلوبة قبل تأكيد الموعد أو اعتماد الفاتورة',
      detail = 'incomplete_patient:' || p.id, hint = 'الناقص: ' || array_to_string(miss, '، ');
  end if;
end $$;

-- ========== 2) منع تأكيد الموعد — على الجدول نفسه، فبيغطي كل الدوال وأي طلب مباشر ==========
-- أي انتقال لحالة «مؤكد» أو بعدها (في الطريق/حضر/جاري/مكتمل)، أو موعد بيتعمل بحالة منهم (زيارة مباشرة)، محتاج ملف مكتمل.
-- الموعد اللي كان مؤكد قبل كده بيكمل دورته عادي (حضر ← مكتمل). الحجز نفسه (جديد) مسموح حتى لو ناقص.
create or replace function public.guard_appt_patient_complete() returns trigger
language plpgsql security definer set search_path to 'public'
as $$
begin
  if new.patient_id is null or new.status not in ('confirmed', 'on_way', 'arrived', 'in_progress', 'completed') then return new; end if;
  if tg_op = 'UPDATE' and old.status in ('confirmed', 'on_way', 'arrived', 'in_progress', 'completed') then return new; end if;
  perform assert_patient_complete(new.patient_id);
  return new;
end $$;
drop trigger if exists trg_appt_patient_complete on appointments;
create trigger trg_appt_patient_complete before insert or update of status on appointments
  for each row execute function guard_appt_patient_complete();

-- ========== 3) منع اعتماد الفاتورة (مسودة ← مستحقة) — على الجدول، فبيغطي update_plan_invoice وأي مسار تاني ==========
create or replace function public.guard_invoice_patient_complete() returns trigger
language plpgsql security definer set search_path to 'public'
as $$
begin
  if old.status = 'draft' and new.status not in ('draft', 'cancelled') and new.patient_id is not null then
    perform assert_patient_complete(new.patient_id);
  end if;
  return new;
end $$;
drop trigger if exists trg_invoice_patient_complete on invoices;
create trigger trg_invoice_patient_complete before update of status on invoices
  for each row execute function guard_invoice_patient_complete();

-- ========== 4) ترقيم الملفات الجديدة: بعد أعلى رقم مستخدم فعلًا (قرار المستخدم: 15754 وبعدها بالتتابع) ==========
-- نفس العدّاد الموجود (next_counter = UPDATE ذرّي على صف العدّاد، فتسجيلين في نفس اللحظة مايخدوش نفس الرقم) + الفهرس الفريد
-- patients_file_no_key. الإضافة: لو الرقم مستخدم (رقم قديم اتستورد) بيتخطّاه بدل ما يفشل. الأرقام الحالية ماتتغيّرش.
update counters set value = (select max(nullif(regexp_replace(file_no, '\D', '', 'g'), '')::bigint) from patients)
where name = 'patient' and (select max(nullif(regexp_replace(file_no, '\D', '', 'g'), '')::bigint) from patients) is not null;

create or replace function public.patients_before_insert() returns trigger
language plpgsql security definer set search_path to 'public'
as $function$
declare dup patients; legacy boolean := coalesce(current_setting('app.legacy_import', true), '') = 'on';
begin
  if new.file_no is null or new.file_no = '' then
    loop
      new.file_no := next_counter('patient', 'TM-');
      exit when not exists (select 1 from patients where file_no = new.file_no);
    end loop;
  end if;
  if legacy then if length(trim(new.full_name)) < 1 then raise exception 'اسم المريض مطلوب'; end if; return new; end if;
  if length(trim(new.full_name)) < 2 then raise exception 'اسم المريض مطلوب'; end if; -- استيراد الملف القديم: جوال ناقص/مكرر مسموح (والنواقص بتتعلّم في الواجهة)
  if length(regexp_replace(new.phone, '\D', '', 'g')) < 9 then raise exception 'رقم الجوال غير صحيح'; end if;
  select * into dup from patients x where right(regexp_replace(x.phone, '\D', '', 'g'), 9) = right(regexp_replace(new.phone, '\D', '', 'g'), 9) limit 1;
  if dup.id is not null then raise exception 'هذا الرقم مسجّل بالفعل للمريض % (%)', dup.full_name, dup.file_no; end if;
  return new;
end $function$;

-- ========== 5) الاسم الثلاثي للمريض (تسجيل عادي + جوجل + تعديل بياناته + الحجز) — على الخادم ==========
create or replace function public.register_customer(p_auth_user uuid, p_name text, p_phone text, p_email text)
returns jsonb language plpgsql security definer set search_path to 'public'
as $function$
declare pid uuid; cid uuid; last9 text := right(regexp_replace(p_phone, '\D', '', 'g'), 9); nm text := regexp_replace(trim(coalesce(p_name, '')), '\s+', ' ', 'g'); w text[];
begin
  if name_words(nm) < 3 then raise exception 'اكتب اسمك الثلاثي على الأقل (الاسم واسم الأب واسم الجد)'; end if;
  w := regexp_split_to_array(nm, ' ');
  -- ملف موجود بنفس الجوال (فتحه الموظف قبل كده) = نفس الملف، من غير ملف مكرر
  select id into pid from patients where right(regexp_replace(phone, '\D', '', 'g'), 9) = last9
    and not exists (select 1 from customers c where c.patient_id = patients.id) order by registered_at limit 1;
  if pid is null then
    insert into patients (file_no, full_name, first_name, father_name, family_name, phone, email, referral_source)
    values ('', nm, w[1], w[2], array_to_string(w[3:], ' '), p_phone, coalesce(trim(p_email), ''), 'website') returning id into pid;
  else
    update patients set email = case when coalesce(email, '') = '' then coalesce(trim(p_email), '') else email end,
      full_name = case when name_words(full_name) < 3 then nm else full_name end,
      first_name = case when name_words(full_name) < 3 then w[1] else first_name end,
      father_name = case when name_words(full_name) < 3 then w[2] else father_name end,
      family_name = case when name_words(full_name) < 3 then array_to_string(w[3:], ' ') else family_name end
    where id = pid;
  end if;
  insert into customers (auth_user_id, patient_id, name, phone, email) values (p_auth_user, pid, nm, p_phone, nullif(trim(coalesce(p_email, '')), '')) returning id into cid;
  insert into audit_logs (user_id, action, table_name, record_id, new_data) values (p_auth_user, 'register', 'customers', cid::text, jsonb_build_object('phone', p_phone));
  return jsonb_build_object('customerId', cid, 'patientId', pid);
end $function$;

create or replace function public.patient_update_profile(p jsonb)
returns void language plpgsql security definer set search_path to 'public'
as $function$
declare c customers; nm text := regexp_replace(trim(coalesce(p->>'fullName', '')), '\s+', ' ', 'g'); w text[];
begin
  c := require_patient();
  if p ? 'fullName' and name_words(nm) < 3 then raise exception 'اكتب اسمك الثلاثي على الأقل (الاسم واسم الأب واسم الجد)'; end if;
  w := case when nm <> '' then regexp_split_to_array(nm, ' ') end;
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

-- الحجز الأونلاين: مسموح والملف ناقص (هوية/جنس...) — بس الاسم الثلاثي لازم يكون محفوظ (بيتطلب مرة واحدة في البوابة ويتحفظ)
create or replace function public.patient_name_guard() returns trigger
language plpgsql security definer set search_path to 'public'
as $$
begin
  if new.source = 'online' and name_words((select full_name from patients where id = new.patient_id)) < 3 then
    raise exception 'أكمل اسمك الثلاثي أولًا (الاسم واسم الأب واسم الجد) — بيتحفظ في ملفك مرة واحدة';
  end if;
  return new;
end $$;
drop trigger if exists trg_appt_online_name on appointments;
create trigger trg_appt_online_name before insert on appointments
  for each row when (new.source = 'online') execute function patient_name_guard();

-- ========== 6) «حسابات المرضى الأونلاين» — كل حسابات customers (الموقع/التطبيق/جوجل)، حجزوا أو لأ ==========
create or replace function public.online_accounts(p_q text default '') returns jsonb
language plpgsql stable security definer set search_path to 'public'
as $$
declare q text := trim(coalesce(p_q, '')); pat text := '%' || trim(coalesce(p_q, '')) || '%';
begin
  perform require_perm('online_accounts', 'view');
  return coalesce((
    select jsonb_agg(row_to_json(x) order by x."memberSince" desc) from (
      select c.id as "customerId", p.id as "patientId", coalesce(nullif(p.full_name, ''), c.name) as name, coalesce(nullif(p.phone, ''), c.phone) as phone,
        nullif(regexp_replace(coalesce(p.file_no, ''), '\D', '', 'g'), '') as "fileNo",
        case when p.nationality = 'non_saudi' then 'إقامة' when p.nationality = 'saudi' then 'هوية وطنية' end as "idType",
        nullif(p.national_id, '') as "nationalId", c.member_since as "memberSince", c.email,
        case when exists (select 1 from auth.identities i where i.user_id = c.auth_user_id and i.provider = 'google') then 'google' else 'phone' end as "signupMethod",
        coalesce(to_jsonb(patient_missing_fields(p)), '[]'::jsonb) as missing,
        (select count(*) from appointments a where a.patient_id = p.id and a.status <> 'cancelled')::int as "bookings",
        (select count(*) from appointments a where a.patient_id = p.id and a.source = 'online')::int as "onlineBookings",
        (select min(a.date)::text from appointments a where a.patient_id = p.id and a.status in ('new', 'confirmed', 'on_way', 'rescheduled') and a.date >= riyadh_today()) as "nextDate",
        (select max(a.date)::text from appointments a where a.patient_id = p.id and a.status <> 'cancelled' and a.date < riyadh_today()) as "lastDate"
      from customers c left join patients p on p.id = c.patient_id
      where coalesce(p.notes, '') not in ('TEST_SEED', 'QA_CLEANUP')
        and (q = '' or coalesce(p.full_name, c.name) ilike pat or c.name ilike pat or phone_digits_match(coalesce(p.phone, c.phone), q)
             or phone_digits_match(c.phone, q) or p.file_no ilike pat or coalesce(p.national_id, '') like pat)
    ) x), '[]'::jsonb);
end $$;

-- صلاحية القسم الجديد: الإدارة والاستقبال والسكرتارية (تتعدّل من «الأدوار والصلاحيات»). الاستكمال نفسه = صلاحية patients/edit الموجودة
insert into role_permissions (role, area, ops)
select r, 'online_accounts', array['view'] from unnest(array['center_manager', 'reception', 'secretary']) r
where not exists (select 1 from role_permissions where role = r and area = 'online_accounts');

revoke all on function public.patient_missing_fields(patients) from public, anon;
revoke all on function public.patient_is_complete(uuid) from public, anon;
revoke all on function public.assert_patient_complete(uuid) from public, anon;
revoke all on function public.online_accounts(text) from public, anon;
revoke all on function public.register_customer(uuid, text, text, text) from public, anon, authenticated;
revoke all on function public.guard_appt_patient_complete() from public, anon, authenticated;
revoke all on function public.guard_invoice_patient_complete() from public, anon, authenticated;
revoke all on function public.patient_name_guard() from public, anon, authenticated;
grant execute on function public.patient_missing_fields(patients) to authenticated;
grant execute on function public.patient_is_complete(uuid) to authenticated;
grant execute on function public.online_accounts(text) to authenticated;
grant execute on function public.name_words(text) to authenticated;
