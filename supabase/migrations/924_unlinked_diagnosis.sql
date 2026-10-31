-- 924: «فتح ملف تشخيص جديد» بالاسم الثلاثي — تشخيص من غير ملف مريض (الدكتور بدون إنترنت والمريض لسه ما وصلش من الاستقبال).
-- التشخيص بيتحفظ وبياناته في pending_patient (الاسم/الموبايل/السن/النوع من خانة 1 في الشيت). المطابقة بتحصل هنا على الخادم
-- (مش على الجهاز) عشان تشتغل أيًا كان الجهاز اللي يرفع الأول:
--   - التشخيص وصل والملف موجود ← بيتربط وقت الإدخال.
--   - التشخيص وصل الأول ← «بانتظار ملف المريض»؛ أول ما الاستقبال يرفع الملف (أو يعدّل الاسم) ← بيتربط.
-- الربط التلقائي بس لما يكون فيه مريض واحد بالاسم ده مطابق لباقي البيانات، ومتأكدين منه: الموبايل مطابق، أو مفيش غيره بنفس الاسم
-- وملفه اتفتح في نفس أيام التشخيص (±2 يوم). غير كده ← «يحتاج مراجعة» ومحدش بيتدمج؛ المستخدم صاحب الصلاحية بيختار الملف (link_consultation).
alter table ortho_consultations
  alter column patient_id drop not null,
  add column if not exists pending_patient jsonb,
  add column if not exists link_status text check (link_status in ('waiting', 'review')),
  add column if not exists link_note text,
  add column if not exists link_method text check (link_method in ('auto', 'manual')),
  add column if not exists linked_at timestamptz;
alter table ortho_consultations drop constraint if exists ortho_consultations_patient_or_name;
alter table ortho_consultations add constraint ortho_consultations_patient_or_name
  check (patient_id is not null or coalesce(trim(pending_patient->>'name'), '') <> '');
create index if not exists ortho_consultations_unlinked on ortho_consultations(created_at) where patient_id is null;

-- توحيد الاسم للمطابقة: الهمزات/التاء المربوطة/الألف المقصورة/التشكيل/المسافات
create or replace function norm_ar_name(t text) returns text language sql immutable parallel safe as $$
  select trim(regexp_replace(
    translate(regexp_replace(lower(coalesce(t, '')), '[ً-ْـ]', '', 'g'), 'أإآٱةى', 'ااااهي'),
    '\s+', ' ', 'g'))
$$;
create index if not exists patients_norm_name on patients(norm_ar_name(full_name));

-- ربط تشخيص بملف مريض + طلبات الأشعة/التحاليل اللي اتكتبت فيه (الجهاز ما بيسجلهاش من غير مريض) + زيارة النهارده لو مفتوحة
create or replace function ortho_link_consult(p_id uuid, p_patient uuid, p_method text) returns void
language plpgsql security definer set search_path to 'public' as $$
declare c ortho_consultations; v_appt uuid; r jsonb; l text;
begin
  update ortho_consultations set patient_id = p_patient, link_status = null, link_note = null, link_method = p_method, linked_at = now()
    where id = p_id and patient_id is null returning * into c;
  if not found then return; end if;
  for r in select * from jsonb_array_elements(coalesce(c.imaging_requests, '[]'::jsonb)) loop
    if coalesce(trim(r->>'region'), '') = '' then continue; end if;
    insert into ortho_imaging (patient_id, kind, region, requested_at, status, finding, attachments, created_by)
      values (p_patient, coalesce(r->>'kind', 'xray'), case when coalesce(r->>'view', '') <> '' then (r->>'region') || ' — ' || (r->>'view') else r->>'region' end,
              c.date, 'requested', '', '[]'::jsonb, c.created_by);
  end loop;
  for l in select * from jsonb_array_elements_text(coalesce(c.labs, '[]'::jsonb)) loop
    insert into ortho_imaging (patient_id, kind, region, requested_at, status, finding, attachments, created_by)
      values (p_patient, 'lab', l, c.date, 'requested', '', '[]'::jsonb, c.created_by);
  end loop;
  if c.appointment_id is null then
    select a.id into v_appt from appointments a
      where a.patient_id = p_patient and a.date = c.date and a.status in ('arrived', 'in_progress', 'completed')
        and not exists (select 1 from ortho_consultations x where x.appointment_id = a.id)
      order by a.time limit 1;
    if v_appt is not null then update ortho_consultations set appointment_id = v_appt where id = p_id; end if;
  end if;
end $$;
revoke execute on function ortho_link_consult(uuid, uuid, text) from anon, authenticated, public;

-- محاولة مطابقة تشخيص واحد غير مربوط
create or replace function ortho_try_link(p_id uuid) returns void
language plpgsql security definer set search_path to 'public' as $$
declare c ortho_consultations; v_name text; v_phone text; v_age int; v_gender text;
  n_all int; n_ok int; v_pick uuid; v_phone_ok boolean; v_recent boolean;
begin
  select * into c from ortho_consultations where id = p_id and patient_id is null;
  if not found then return; end if;
  v_name := norm_ar_name(c.pending_patient->>'name');
  v_phone := right(regexp_replace(coalesce(c.pending_patient->>'phone', ''), '\D', '', 'g'), 9);
  v_age := case when coalesce(c.pending_patient->>'age', '') ~ '^\d{1,3}$' then (c.pending_patient->>'age')::int end;
  v_gender := nullif(c.pending_patient->>'gender', '');
  if array_length(string_to_array(v_name, ' '), 1) is distinct from null and array_length(string_to_array(v_name, ' '), 1) < 3 then
    update ortho_consultations set link_status = 'review', link_note = 'الاسم أقل من ثلاثي — اختار ملف المريض يدويًا' where id = p_id;
    return;
  end if;
  -- المرشّحين: نفس الاسم، ومفيش تعارض في الموبايل/النوع/السن (لو مكتوبين في الناحيتين)
  with cand as (
    select p.id, p.registered_at,
      (length(v_phone) = 9 and right(regexp_replace(coalesce(p.phone, ''), '\D', '', 'g'), 9) = v_phone) as phone_eq,
      (length(v_phone) = 9 and length(regexp_replace(coalesce(p.phone, ''), '\D', '', 'g')) >= 9
         and right(regexp_replace(p.phone, '\D', '', 'g'), 9) <> v_phone) as phone_clash,
      (v_gender is not null and p.gender is not null and p.gender <> v_gender) as gender_clash,
      (v_age is not null and p.birth_date is not null and abs(extract(year from age(c.date, p.birth_date)) - v_age) > 1) as age_clash
    from patients p where norm_ar_name(p.full_name) = v_name
  )
  select count(*), count(*) filter (where not (phone_clash or gender_clash or age_clash)),
         (array_agg(id) filter (where not (phone_clash or gender_clash or age_clash)))[1],
         bool_or(phone_eq) filter (where not (phone_clash or gender_clash or age_clash)),
         bool_or(abs(registered_at::date - c.date) <= 2) filter (where not (phone_clash or gender_clash or age_clash))
    into n_all, n_ok, v_pick, v_phone_ok, v_recent from cand;
  if n_ok = 1 and (v_phone_ok or (n_all = 1 and v_recent)) then
    perform ortho_link_consult(p_id, v_pick, 'auto');
  elsif n_all = 0 then
    update ortho_consultations set link_status = 'waiting', link_note = 'مفيش ملف مريض بالاسم ده لسه — هيتربط تلقائي أول ما ملف الاستقبال يوصل' where id = p_id;
  else
    update ortho_consultations set link_status = 'review', link_note = case
      when n_ok > 1 then 'فيه ' || n_ok || ' ملفات بنفس الاسم — اختار الملف الصح'
      when n_ok = 0 then 'فيه ملف بنفس الاسم بس بياناته مختلفة (الموبايل/السن/النوع) — راجع واختار'
      else 'فيه ملف بنفس الاسم بس قديم ومفيش موبايل يأكد إنه نفس الشخص — راجع واختار' end
    where id = p_id;
  end if;
end $$;
revoke execute on function ortho_try_link(uuid) from anon, authenticated, public;

-- تشخيص جديد/اتعدّل اسمه وهو لسه مش مربوط
create or replace function trg_ortho_consult_link() returns trigger
language plpgsql security definer set search_path to 'public' as $$
begin
  perform ortho_try_link(new.id);
  return null;
end $$;
drop trigger if exists trg_ortho_consult_link_ins on ortho_consultations;
create trigger trg_ortho_consult_link_ins after insert on ortho_consultations
  for each row when (new.patient_id is null) execute function trg_ortho_consult_link();
drop trigger if exists trg_ortho_consult_link_upd on ortho_consultations;
create trigger trg_ortho_consult_link_upd after update of pending_patient on ortho_consultations
  for each row when (new.patient_id is null) execute function trg_ortho_consult_link();

-- التشخيص المربوط مايرجعش «غير مربوط» (نسخة قديمة على جهاز اتبعتت بعد الربط)
create or replace function trg_ortho_consult_keep_link() returns trigger language plpgsql as $$
begin
  if new.patient_id is null and old.patient_id is not null then
    new.patient_id := old.patient_id; new.link_status := old.link_status; new.link_note := old.link_note;
  end if;
  return new;
end $$;
drop trigger if exists trg_ortho_consult_keep_link on ortho_consultations;
create trigger trg_ortho_consult_keep_link before update on ortho_consultations for each row execute function trg_ortho_consult_keep_link();

-- ملف مريض جديد (أو اتعدّل اسمه/موبايله) ← التشخيصات المستنية بنفس الاسم تتطابق تاني
create or replace function trg_patient_link_pending() returns trigger
language plpgsql security definer set search_path to 'public' as $$
declare x uuid;
begin
  for x in select id from ortho_consultations where patient_id is null and norm_ar_name(pending_patient->>'name') = norm_ar_name(new.full_name) loop
    perform ortho_try_link(x);
  end loop;
  return null;
end $$;
drop trigger if exists trg_patient_link_pending on patients;
create trigger trg_patient_link_pending after insert or update of full_name, phone, gender, birth_date on patients
  for each row execute function trg_patient_link_pending();

-- الربط اليدوي (المستخدم اختار الملف): صلاحية تعديل الجلسات
create or replace function link_consultation(p_id uuid, p_patient uuid) returns void
language plpgsql security definer set search_path to 'public' as $$
begin
  if not (has_perm('sessions', 'edit') or is_admin()) then raise exception 'ليس لديك صلاحية ربط التشخيص بملف المريض.'; end if;
  if not exists (select 1 from patients where id = p_patient) then raise exception 'ملف المريض غير موجود.'; end if;
  if not exists (select 1 from ortho_consultations where id = p_id and patient_id is null) then raise exception 'التشخيص ده اتربط بملف مريض بالفعل.'; end if;
  perform ortho_link_consult(p_id, p_patient, 'manual');
end $$;
revoke execute on function link_consultation(uuid, uuid) from anon, public;
grant execute on function link_consultation(uuid, uuid) to authenticated;
