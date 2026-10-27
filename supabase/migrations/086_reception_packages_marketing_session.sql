-- تعديلات الاستقبال/الباقات/التسويق/الضريبة/الجلسات/العلاج الطبيعي (2026-10-07). كل التغييرات آمنة للبيانات القديمة (أعمدة جديدة NULL/افتراضي، مفيش حذف).

-- ===== 1) منع تكرار المريض بنفس الجوال (على الخادم) =====
create or replace function patients_before_insert() returns trigger
language plpgsql security definer set search_path = public as $$
declare dup patients;
begin
  if new.file_no is null or new.file_no = '' then new.file_no := next_counter('patient', 'TM-'); end if;
  if length(trim(new.full_name)) < 2 then raise exception 'اسم المريض مطلوب'; end if;
  if length(regexp_replace(new.phone, '\D', '', 'g')) < 9 then raise exception 'رقم الجوال غير صحيح'; end if;
  select * into dup from patients x where right(regexp_replace(x.phone, '\D', '', 'g'), 9) = right(regexp_replace(new.phone, '\D', '', 'g'), 9) limit 1;
  if dup.id is not null then raise exception 'هذا الرقم مسجّل بالفعل للمريض % (%)', dup.full_name, dup.file_no; end if;
  return new;
end $$;

-- ===== 2) منع تعارض المواعيد على مستوى الجدول (شبكة أمان فوق check_slot) — قفل لكل دكتور+يوم =====
create or replace function appointments_no_overlap() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if new.therapist_id is null or new.status = 'cancelled' then return new; end if;
  perform pg_advisory_xact_lock(hashtext(new.therapist_id::text || new.date::text));
  if exists (select 1 from appointments a where a.therapist_id = new.therapist_id and a.date = new.date and a.status <> 'cancelled' and a.id is distinct from new.id
             and new.time::time < a.time::time + make_interval(mins => a.duration_min) and a.time::time < new.time::time + make_interval(mins => new.duration_min)) then
    raise exception 'عذرًا، هذا الموعد تم حجزه للتو. يرجى اختيار موعد آخر.';
  end if;
  return new;
end $$;
drop trigger if exists trg_appointments_no_overlap_ins on appointments;
create trigger trg_appointments_no_overlap_ins before insert on appointments for each row execute function appointments_no_overlap();
drop trigger if exists trg_appointments_no_overlap_upd on appointments;
create trigger trg_appointments_no_overlap_upd before update on appointments for each row
  when (old.date is distinct from new.date or old.time is distinct from new.time or old.duration_min is distinct from new.duration_min or old.therapist_id is distinct from new.therapist_id)
  execute function appointments_no_overlap();

-- ===== 3) الجلسة: Subject + Pain Scale (1–10). الأعمدة القديمة (devices_used / exercises / therapist_notes) فاضلة بدون حذف، بس اتشالت من الواجهة =====
alter table treatment_sessions add column if not exists subject text not null default '';
alter table treatment_sessions add column if not exists pain_scale int;
do $$ begin
  if not exists (select 1 from pg_constraint where conname = 'treatment_sessions_pain_scale_chk') then
    alter table treatment_sessions add constraint treatment_sessions_pain_scale_chk check (pain_scale is null or pain_scale between 1 and 10);
  end if;
end $$;

create or replace function update_session(p_id uuid, p jsonb) returns void
language plpgsql security definer set search_path = public as $$
declare s treatment_sessions; v_scale int;
begin
  perform require_perm('sessions', 'edit');
  select * into s from treatment_sessions where id = p_id for update;
  if s.id is null or not can_see_patient(s.patient_id) then raise exception 'الجلسة غير موجودة'; end if;
  if p ? 'painScale' and nullif(p->>'painScale', '') is not null then
    if (p->>'painScale') !~ '^-?\d+$' then raise exception 'مقياس الألم لازم رقم صحيح من 1 إلى 10'; end if;
    v_scale := (p->>'painScale')::int;
    if v_scale < 1 or v_scale > 10 then raise exception 'مقياس الألم لازم يكون من 1 إلى 10'; end if;
  end if;
  if p ? 'painLevel' and nullif(p->>'painLevel', '') is not null and ((p->>'painLevel')::int < 0 or (p->>'painLevel')::int > 10) then
    raise exception 'مستوى الألم من 0 إلى 10';
  end if;
  if length(coalesce(p->>'subject', '')) > 300 then raise exception 'الموضوع (Subject) أطول من المسموح (300 حرف)'; end if;
  update treatment_sessions set
    subject = case when p ? 'subject' then trim(coalesce(p->>'subject', '')) else subject end,
    pain_scale = coalesce(v_scale, pain_scale),
    pain_level = case when v_scale is not null then v_scale when p ? 'painLevel' then nullif(p->>'painLevel', '')::int else pain_level end,
    therapist_notes = coalesce(p->>'therapistNotes', therapist_notes), treatment_used = coalesce(p->>'treatmentUsed', treatment_used),
    devices_used = coalesce(p->>'devicesUsed', devices_used), exercises = coalesce(p->>'exercises', exercises),
    patient_response = coalesce(p->>'patientResponse', patient_response), next_plan = coalesce(p->>'nextPlan', next_plan)
  where id = p_id;
  perform log_action('تحديث بيانات الجلسة رقم ' || s.session_no, s.patient_id);
end $$;

-- ===== 4) ROM: قيم سالبة مسموحة (-360 إلى 360) =====
CREATE OR REPLACE FUNCTION public.physio_objective(o jsonb)
 RETURNS jsonb
 LANGUAGE plpgsql
 IMMUTABLE
 SET search_path TO 'public'
AS $function$
declare k text; e jsonb; sides text[] := array['right','left','bilateral','na'];
begin
  if o is null or jsonb_typeof(o) = 'null' then return '{}'::jsonb; end if;
  if jsonb_typeof(o) <> 'object' then raise exception 'بيانات الفحص (Objective) غير صحيحة'; end if;
  if pg_column_size(o) > 60000 then raise exception 'بيانات الفحص أكبر من المسموح'; end if;
  for k in select jsonb_object_keys(o) loop
    if k not in ('observation','palpation','muscles','rom','sensationSuperficial','sensationDeep','specialTests','reflexes','gait') then
      raise exception 'حقل غير معروف في الفحص: %', k;
    end if;
  end loop;
  -- القوائم المتعددة
  if o ? 'observation' and not coalesce((select bool_and(x in ('normal','good_general','poor_general','postural_abnormality','swelling','redness','bruising','atrophy','hypertrophy','deformity','scar','skin_changes','limited_movement','difficulty_standing','difficulty_sitting','difficulty_walking','assistive_device','other'))
      from jsonb_array_elements_text(coalesce(o->'observation'->'items', '[]')) x), true) then raise exception 'General Observation فيها اختيار غير معروف'; end if;
  if o ? 'palpation' and not coalesce((select bool_and(x in ('normal','no_tenderness','tenderness','mild_tenderness','moderate_tenderness','severe_tenderness','local_pain','swelling','increased_tone','decreased_tone','spasm','trigger_point','tightness','warmth','coldness','crepitus','scar_tissue','other'))
      from jsonb_array_elements_text(coalesce(o->'palpation'->'items', '[]')) x), true) then raise exception 'Palpation فيها اختيار غير معروف'; end if;
  if o ? 'gait' and not coalesce((select bool_and(x in ('normal','antalgic','ataxic','steppage','spastic','trendelenburg','hemiplegic','parkinsonian','foot_drop','unsteady','wide_based','circumduction','shuffling','limp','cane','walker','crutches','wheelchair','other'))
      from jsonb_array_elements_text(coalesce(o->'gait'->'items', '[]')) x), true) then raise exception 'Gait فيها اختيار غير معروف'; end if;
  if o ? 'sensationSuperficial' and not coalesce((select bool_and(x in ('normal','decreased','increased','absent','hypersensitivity','allodynia','paresthesia','dysesthesia','not_tested','other'))
      from jsonb_array_elements_text(coalesce(o->'sensationSuperficial'->'items', '[]')) x), true) then raise exception 'Sensation — Superficial فيها اختيار غير معروف'; end if;
  if o ? 'sensationDeep' and not coalesce((select bool_and(x in ('normal','decreased','increased','absent','impaired','not_tested','other'))
      from jsonb_array_elements_text(coalesce(o->'sensationDeep'->'items', '[]')) x), true) then raise exception 'Sensation — Deep فيها اختيار غير معروف'; end if;
  -- القوائم الديناميكية
  if jsonb_array_length(coalesce(o->'muscles', '[]')) > 60 or jsonb_array_length(coalesce(o->'rom', '[]')) > 60
     or jsonb_array_length(coalesce(o->'specialTests', '[]')) > 60 or jsonb_array_length(coalesce(o->'reflexes', '[]')) > 60 then
    raise exception 'عدد عناصر الفحص أكبر من المسموح (60)';
  end if;
  for e in select * from jsonb_array_elements(coalesce(o->'muscles', '[]')) loop
    if trim(coalesce(e->>'muscle', '')) = '' then raise exception 'Muscle Assessment: اختر العضلة'; end if;
    if coalesce(e->>'side', '') not in ('right','left','bilateral') then raise exception 'Muscle Assessment: اختر الجهة'; end if;
    if coalesce(e->>'grade', '') not in ('0','1','2','3','4','5','nt') then raise exception 'Muscle Assessment: اختر درجة القوة (0–5)'; end if;
  end loop;
  for e in select * from jsonb_array_elements(coalesce(o->'rom', '[]')) loop
    if coalesce(e->>'joint', '') not in ('shoulder','elbow','wrist','hand','hip','knee','ankle','cervical','thoracic','lumbar','other') then raise exception 'ROM: اختر المفصل'; end if;
    if coalesce(e->>'side', '') not in ('right','left','bilateral','na','midline') then raise exception 'ROM: اختر الجهة'; end if;
    if coalesce(e->>'status', '') not in ('normal','mild','moderate','severe','hypermobile','excessive','painful','not_tested') then raise exception 'ROM: اختر حالة الحركة'; end if;
    if (e ? 'active' and jsonb_typeof(e->'active') = 'number' and ((e->>'active')::numeric < -360 or (e->>'active')::numeric > 360))
       or (e ? 'passive' and jsonb_typeof(e->'passive') = 'number' and ((e->>'passive')::numeric < -360 or (e->>'passive')::numeric > 360)) then
      raise exception 'ROM: الدرجة من -360 إلى 360 (القيم السالبة مسموحة)';
    end if;
  end loop;
  for e in select * from jsonb_array_elements(coalesce(o->'specialTests', '[]')) loop
    if trim(coalesce(e->>'test', '')) = '' then raise exception 'Special Tests: اختر اسم الاختبار'; end if;
    if coalesce(e->>'result', '') not in ('positive','negative','equivocal','not_tested') then raise exception 'Special Tests: اختر النتيجة'; end if;
    if coalesce(e->>'side', 'na') <> all(sides) then raise exception 'Special Tests: الجهة غير صحيحة'; end if;
  end loop;
  for e in select * from jsonb_array_elements(coalesce(o->'reflexes', '[]')) loop
    if coalesce(e->>'reflex', '') not in ('biceps','triceps','brachioradialis','patellar','achilles','other') then raise exception 'Reflexes: اختر الـ Reflex'; end if;
    if coalesce(e->>'side', '') not in ('right','left','bilateral') then raise exception 'Reflexes: اختر الجهة'; end if;
    if coalesce(e->>'result', '') not in ('0','1+','2+','3+','4+') then raise exception 'Reflexes: اختر النتيجة'; end if;
  end loop;
  return o;
end $function$;

-- ===== 5) الضريبة: نسبة غير السعوديين قابلة للضبط من الإعدادات (الافتراضي 15%) =====
alter table center_info add column if not exists foreign_tax_rate numeric(5,2) not null default 15;
do $$ begin
  if not exists (select 1 from pg_constraint where conname = 'center_info_foreign_tax_chk') then
    alter table center_info add constraint center_info_foreign_tax_chk check (foreign_tax_rate >= 0 and foreign_tax_rate <= 100);
  end if;
end $$;
create or replace function patient_tax_rate(p_patient uuid) returns numeric
language sql stable security definer set search_path = public as $$
  select case when exists (select 1 from patients where id = p_patient and nationality = 'non_saudi')
              then coalesce((select foreign_tax_rate from center_info limit 1), 15)::numeric else 0::numeric end
$$;

-- ===== 6) حضور مرضى الباقات (Check-in) =====
create table if not exists package_checkins (
  id uuid primary key default gen_random_uuid(),
  package_id uuid not null references packages(id) on delete cascade,
  patient_id uuid not null references patients(id) on delete cascade,
  appointment_id uuid not null references appointments(id) on delete cascade,
  checked_in_by uuid references employees(id) on delete set null,
  created_at timestamptz not null default now(),
  unique (appointment_id)
);
create index if not exists idx_package_checkins_pkg on package_checkins (package_id, created_at desc);
create index if not exists idx_package_checkins_patient on package_checkins (patient_id, created_at desc);
alter table package_checkins enable row level security;
drop policy if exists staff_read on package_checkins;
create policy staff_read on package_checkins for select using (has_perm('appointments', 'view') and can_see_patient(patient_id));
revoke insert, update, delete on package_checkins from authenticated, anon;

create or replace function package_check_in(p_package uuid, p_appointment uuid) returns jsonb
language plpgsql security definer set search_path = public as $$
declare emp uuid; pk packages; a appointments; pend int; v_id uuid;
begin
  emp := require_perm('appointments', 'edit');
  select * into pk from packages where id = p_package for update;
  if pk.id is null or not can_see_patient(pk.patient_id) then raise exception 'الباقة غير موجودة'; end if;
  select * into a from appointments where id = p_appointment for update;
  if a.id is null or a.patient_id <> pk.patient_id then raise exception 'الموعد غير موجود لهذا المريض'; end if;
  if pk.status <> 'active' then raise exception 'الباقة غير فعّالة (%)', pk.status; end if;
  if pk.expiry_date is not null and pk.expiry_date < riyadh_today() then raise exception 'الباقة منتهية الصلاحية بتاريخ %', pk.expiry_date; end if;
  if a.package_id is not null and a.package_id <> pk.id then raise exception 'هذا الموعد مرتبط بباقة أخرى'; end if;
  if coalesce(array_length(pk.service_ids, 1), 0) > 0 and not (a.service_id = any(pk.service_ids)) then raise exception 'خدمة الموعد غير مشمولة في هذه الباقة'; end if;
  if a.status in ('cancelled', 'completed', 'no_show') then raise exception 'لا يمكن تسجيل حضور موعد بحالته الحالية'; end if;
  if a.status in ('arrived', 'in_progress') or exists (select 1 from package_checkins where appointment_id = a.id) then raise exception 'تم تسجيل حضور هذا الموعد من قبل'; end if;
  if a.date <> riyadh_today() then raise exception 'الحضور يُسجَّل في يوم الموعد فقط (موعد هذا الحجز %)', a.date; end if;
  if a.therapist_id is null then raise exception 'اختر الدكتور للموعد قبل تسجيل الحضور'; end if;
  -- جلسات الباقة المتاحة = الإجمالي − المنتهية − اللي حضرت ولسه ماخلصتش
  select count(*) into pend from appointments x where x.package_id = pk.id and x.status in ('arrived', 'in_progress') and x.id <> a.id;
  if pk.used_sessions + pend >= pk.total_sessions then raise exception 'لا توجد جلسات متبقية في هذه الباقة'; end if;
  if a.package_id is null then update appointments set package_id = pk.id where id = a.id; end if;
  insert into package_checkins (package_id, patient_id, appointment_id, checked_in_by) values (pk.id, pk.patient_id, a.id, emp) returning id into v_id;
  perform set_appointment_status(a.id, 'arrived', null, null);
  perform log_action('تسجيل حضور مريض باقة — ' || pk.name || ' (الموعد ' || a.no || ')', pk.patient_id);
  return jsonb_build_object('id', v_id, 'remaining', greatest(pk.total_sessions - pk.used_sessions - pend - 1, 0));
end $$;
revoke execute on function package_check_in(uuid, uuid) from public, anon;
grant execute on function package_check_in(uuid, uuid) to authenticated;

create or replace function package_checkin_search(p_q text default '') returns jsonb
language plpgsql stable security definer set search_path = public as $$
declare pat text; res jsonb;
begin
  perform require_perm('appointments', 'view');
  pat := '%' || replace(replace(replace(trim(coalesce(p_q, '')), '\', '\\'), '%', '\%'), '_', '\_') || '%';
  select coalesce(jsonb_agg(r order by r->>'name'), '[]') into res from (
    select jsonb_build_object('patientId', p.id, 'name', p.full_name, 'phone', p.phone, 'fileNo', p.file_no,
      'packages', (select jsonb_agg(jsonb_build_object(
          'id', k.id, 'name', k.name, 'total', k.total_sessions, 'used', k.used_sessions,
          'pending', (select count(*) from appointments x where x.package_id = k.id and x.status in ('arrived', 'in_progress')),
          'expiry', k.expiry_date, 'expired', (k.expiry_date is not null and k.expiry_date < riyadh_today()),
          'appointments', coalesce((select jsonb_agg(jsonb_build_object('id', a.id, 'no', a.no, 'time', a.time, 'status', a.status, 'service', (select name from services where id = a.service_id),
                'doctor', (select name from therapists where id = a.therapist_id), 'checkedIn', exists (select 1 from package_checkins c where c.appointment_id = a.id)) order by a.time)
              from appointments a where a.patient_id = p.id and a.date = riyadh_today() and a.status not in ('cancelled', 'completed', 'no_show')
                and (a.package_id = k.id or (a.package_id is null and (coalesce(array_length(k.service_ids, 1), 0) = 0 or a.service_id = any(k.service_ids))))), '[]')
        ) order by k.start_date) from packages k where k.patient_id = p.id and k.status = 'active')) as r
    from patients p
    where not p.is_guest and can_see_patient(p.id)
      and exists (select 1 from packages k where k.patient_id = p.id and k.status = 'active')
      and (trim(coalesce(p_q, '')) = '' and exists (select 1 from appointments a where a.patient_id = p.id and a.date = riyadh_today() and a.status not in ('cancelled', 'completed', 'no_show'))
           or trim(coalesce(p_q, '')) <> '' and (p.full_name ilike pat or p.phone like pat or phone_digits_match(p.phone, p_q) or p.file_no ilike pat))
    limit 50
  ) q;
  return res;
end $$;
revoke execute on function package_checkin_search(text) from public, anon;
grant execute on function package_checkin_search(text) to authenticated;

-- ===== 7) تقرير التسويق: «المريض عرف المركز منين؟» شهريًا (بدون الضيوف) =====
create or replace function marketing_report(p_month text) returns jsonb
language plpgsql stable security definer set search_path = public as $$
declare m0 date; m1 date; prev0 date; res jsonb;
begin
  perform require_perm('reports', 'view');
  if p_month !~ '^\d{4}-(0[1-9]|1[0-2])$' then raise exception 'اختر شهرًا صحيحًا'; end if;
  m0 := (p_month || '-01')::date; m1 := (m0 + interval '1 month')::date; prev0 := (m0 - interval '1 month')::date;
  select jsonb_build_object(
    'month', p_month,
    'bySource', coalesce((select jsonb_agg(jsonb_build_object('source', s, 'n', n) order by n desc, s) from (
        select coalesce(nullif(referral_source, ''), 'other') s, count(*)::int n from patients
        where not is_guest and can_see_patient(id) and (registered_at at time zone 'Africa/Cairo')::date >= m0 and (registered_at at time zone 'Africa/Cairo')::date < m1 group by 1) x), '[]'),
    'previous', coalesce((select jsonb_agg(jsonb_build_object('source', s, 'n', n)) from (
        select coalesce(nullif(referral_source, ''), 'other') s, count(*)::int n from patients
        where not is_guest and can_see_patient(id) and (registered_at at time zone 'Africa/Cairo')::date >= prev0 and (registered_at at time zone 'Africa/Cairo')::date < m0 group by 1) x), '[]'),
    'trend', coalesce((select jsonb_agg(jsonb_build_object('month', mo, 'source', s, 'n', n) order by mo, s) from (
        select to_char((registered_at at time zone 'Africa/Cairo')::date, 'YYYY-MM') mo, coalesce(nullif(referral_source, ''), 'other') s, count(*)::int n from patients
        where not is_guest and can_see_patient(id) and (registered_at at time zone 'Africa/Cairo')::date >= (m0 - interval '11 months')::date and (registered_at at time zone 'Africa/Cairo')::date < m1 group by 1, 2) x), '[]')
  ) into res;
  return res;
end $$;
revoke execute on function marketing_report(text) from public, anon;
grant execute on function marketing_report(text) to authenticated;
