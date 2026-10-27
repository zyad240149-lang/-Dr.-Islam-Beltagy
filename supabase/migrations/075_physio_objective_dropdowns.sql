-- العلاج الطبيعي: Objective منظّم بـ Dropdown جوه نفس خانات النموذج (طلب الإدارة 2026-10-01 — بعد الرجوع في 074).
--   physio_evaluations.objective (jsonb): General Observation / Palpation / Muscle Assessment / ROM / Sensation / Special Tests / Reflexes / Gait
--   الأعمدة النصية القديمة (observation, palpation, rom, ...) فاضلة زي ما هي — مفيش بيانات بتتمسح، والقديم بيتعرض جنب الجديد.
--   قوائم العضلات والاختبارات الخاصة في جداول (بتتدار من الإعدادات من غير تعديل كود).

alter table physio_evaluations add column if not exists objective jsonb not null default '{}'::jsonb;

create table if not exists physio_muscles (
  id uuid primary key default gen_random_uuid(),
  name text not null check (length(trim(name)) between 2 and 120),
  active boolean not null default true,
  sort int not null default 0,
  created_at timestamptz not null default now()
);
create unique index if not exists physio_muscles_name_uq on physio_muscles (lower(trim(name)));
create table if not exists physio_special_tests (
  id uuid primary key default gen_random_uuid(),
  name text not null check (length(trim(name)) between 2 and 120),
  active boolean not null default true,
  sort int not null default 0,
  created_at timestamptz not null default now()
);
create unique index if not exists physio_special_tests_name_uq on physio_special_tests (lower(trim(name)));
alter table physio_muscles enable row level security;
alter table physio_special_tests enable row level security;
drop policy if exists physio_muscles_read on physio_muscles;
create policy physio_muscles_read on physio_muscles for select using (has_perm('physio', 'view'));
drop policy if exists physio_special_tests_read on physio_special_tests;
create policy physio_special_tests_read on physio_special_tests for select using (has_perm('physio', 'view'));

insert into physio_muscles (name, sort) values
  ('Trapezius (Upper)', 0),
  ('Trapezius (Middle)', 1),
  ('Trapezius (Lower)', 2),
  ('Levator Scapulae', 3),
  ('Sternocleidomastoid', 4),
  ('Scalenes', 5),
  ('Cervical Extensors', 6),
  ('Cervical Flexors', 7),
  ('Deltoid (Anterior)', 8),
  ('Deltoid (Middle)', 9),
  ('Deltoid (Posterior)', 10),
  ('Supraspinatus', 11),
  ('Infraspinatus', 12),
  ('Teres Minor', 13),
  ('Subscapularis', 14),
  ('Teres Major', 15),
  ('Rhomboids', 16),
  ('Serratus Anterior', 17),
  ('Pectoralis Major', 18),
  ('Pectoralis Minor', 19),
  ('Latissimus Dorsi', 20),
  ('Biceps', 21),
  ('Triceps', 22),
  ('Brachialis', 23),
  ('Brachioradialis', 24),
  ('Pronator Teres', 25),
  ('Supinator', 26),
  ('Wrist Flexors', 27),
  ('Wrist Extensors', 28),
  ('Finger Flexors', 29),
  ('Finger Extensors', 30),
  ('Thenar Muscles', 31),
  ('Hypothenar Muscles', 32),
  ('Interossei', 33),
  ('Erector Spinae', 34),
  ('Multifidus', 35),
  ('Quadratus Lumborum', 36),
  ('Rectus Abdominis', 37),
  ('Obliques', 38),
  ('Transversus Abdominis', 39),
  ('Iliopsoas', 40),
  ('Gluteus Maximus', 41),
  ('Gluteus Medius', 42),
  ('Gluteus Minimus', 43),
  ('Piriformis', 44),
  ('Tensor Fasciae Latae', 45),
  ('Hip Adductors', 46),
  ('Quadriceps', 47),
  ('Rectus Femoris', 48),
  ('Vastus Medialis (VMO)', 49),
  ('Vastus Lateralis', 50),
  ('Hamstrings', 51),
  ('Sartorius', 52),
  ('Gastrocnemius', 53),
  ('Soleus', 54),
  ('Tibialis Anterior', 55),
  ('Tibialis Posterior', 56),
  ('Peroneals (Fibularis)', 57),
  ('Extensor Hallucis Longus', 58),
  ('Flexor Hallucis Longus', 59),
  ('Intrinsic Foot Muscles', 60)
on conflict do nothing;
insert into physio_special_tests (name, sort) values
  ('Spurling''s Test', 0),
  ('Cervical Distraction Test', 1),
  ('ULTT (Upper Limb Tension Test)', 2),
  ('Adson''s Test', 3),
  ('Roos Test', 4),
  ('Vertebral Artery Test', 5),
  ('Neer''s Test', 6),
  ('Hawkins-Kennedy Test', 7),
  ('Empty Can (Jobe) Test', 8),
  ('Drop Arm Test', 9),
  ('Speed Test', 10),
  ('Yergason''s Test', 11),
  ('Apprehension Test', 12),
  ('Relocation Test', 13),
  ('Sulcus Sign', 14),
  ('O''Brien''s Test', 15),
  ('Lift-off Test', 16),
  ('Painful Arc', 17),
  ('Cozen''s Test', 18),
  ('Mill''s Test', 19),
  ('Golfer''s Elbow Test', 20),
  ('Tinel''s Sign', 21),
  ('Phalen''s Test', 22),
  ('Finkelstein''s Test', 23),
  ('SLR (Straight Leg Raise)', 24),
  ('Crossed SLR', 25),
  ('Slump Test', 26),
  ('Prone Instability Test', 27),
  ('Stork Test', 28),
  ('FABER (Patrick) Test', 29),
  ('FADIR Test', 30),
  ('Thomas Test', 31),
  ('Ober''s Test', 32),
  ('Trendelenburg Sign', 33),
  ('Piriformis Test', 34),
  ('Gaenslen Test', 35),
  ('SI Compression Test', 36),
  ('SI Distraction Test', 37),
  ('Lachman Test', 38),
  ('Anterior Drawer Test', 39),
  ('Posterior Drawer Test', 40),
  ('Pivot Shift Test', 41),
  ('McMurray''s Test', 42),
  ('Apley''s Test', 43),
  ('Thessaly Test', 44),
  ('Valgus Stress Test', 45),
  ('Varus Stress Test', 46),
  ('Clarke''s Test', 47),
  ('Patellar Apprehension Test', 48),
  ('Ankle Anterior Drawer Test', 49),
  ('Talar Tilt Test', 50),
  ('Thompson''s Test', 51),
  ('Squeeze Test', 52),
  ('Windlass Test', 53),
  ('Kleiger Test', 54)
on conflict do nothing;

-- إدارة القوائم (صلاحية physio/edit): إضافة / تعديل الاسم / تفعيل-تعطيل. مفيش حذف نهائي — التقييمات القديمة بتشاور على الاسم.
create or replace function physio_list_save(p_kind text, p_id uuid, p_name text, p_active boolean default true) returns uuid
language plpgsql security definer set search_path = public as $$
declare v_id uuid; v_name text := trim(coalesce(p_name, ''));
begin
  perform require_perm('physio', 'edit');
  if p_kind not in ('muscle', 'test') then raise exception 'نوع القائمة غير معروف'; end if;
  if length(v_name) < 2 or length(v_name) > 120 then raise exception 'الاسم من 2 إلى 120 حرف'; end if;
  if p_kind = 'muscle' then
    if exists (select 1 from physio_muscles where lower(trim(name)) = lower(v_name) and id is distinct from p_id) then raise exception 'العضلة دي موجودة بالفعل'; end if;
    if p_id is null then insert into physio_muscles (name, active, sort) values (v_name, coalesce(p_active, true), (select coalesce(max(sort), 0) + 1 from physio_muscles)) returning id into v_id;
    else update physio_muscles set name = v_name, active = coalesce(p_active, active) where id = p_id returning id into v_id; end if;
  else
    if exists (select 1 from physio_special_tests where lower(trim(name)) = lower(v_name) and id is distinct from p_id) then raise exception 'الاختبار ده موجود بالفعل'; end if;
    if p_id is null then insert into physio_special_tests (name, active, sort) values (v_name, coalesce(p_active, true), (select coalesce(max(sort), 0) + 1 from physio_special_tests)) returning id into v_id;
    else update physio_special_tests set name = v_name, active = coalesce(p_active, active) where id = p_id returning id into v_id; end if;
  end if;
  if v_id is null then raise exception 'العنصر غير موجود'; end if;
  return v_id;
end $$;
revoke execute on function physio_list_save(text, uuid, text, boolean) from public, anon;
grant execute on function physio_list_save(text, uuid, text, boolean) to authenticated;

-- التحقق من الـ Objective المنظّم قبل الحفظ (الأنواع + الاختيارات المسموحة + الحجم)
create or replace function physio_objective(o jsonb) returns jsonb
language plpgsql immutable set search_path = public as $$
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
    if (e ? 'active' and jsonb_typeof(e->'active') = 'number' and ((e->>'active')::numeric < 0 or (e->>'active')::numeric > 360))
       or (e ? 'passive' and jsonb_typeof(e->'passive') = 'number' and ((e->>'passive')::numeric < 0 or (e->>'passive')::numeric > 360)) then
      raise exception 'ROM: الدرجة من 0 إلى 360';
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
end $$;
revoke execute on function physio_objective(jsonb) from public, anon;

create or replace function physio_save_evaluation(p jsonb) returns uuid
language plpgsql security definer set search_path = public as $$
declare emp uuid; v_id uuid := nullif(p->>'id', '')::uuid; v_patient uuid; v_age int; v_pain int; v_onset text; v_char text[]; v_eval_date date;
begin
  emp := require_perm('physio', case when v_id is null then 'create' else 'edit' end);
  if v_id is null then
    v_patient := nullif(p->>'patientId', '')::uuid;
    if v_patient is null or not exists (select 1 from patients where id = v_patient) then raise exception 'المريض غير موجود'; end if;
  else
    select patient_id into v_patient from physio_evaluations where id = v_id;
    if v_patient is null then raise exception 'التقييم غير موجود'; end if;
  end if;
  if not can_see_patient(v_patient) then raise exception 'لا توجد صلاحية على ملف هذا المريض' using errcode = '42501'; end if;

  if physio_txt(p, 'chiefComplaint') = '' then raise exception 'الشكوى الرئيسية مطلوبة'; end if;
  if physio_txt(p, 'diagnosis') = '' then raise exception 'التشخيص مطلوب'; end if;
  v_pain := physio_int(p, 'painVas', 0, 10, 'مقياس الألم');
  if v_pain is null then raise exception 'مقياس الألم (VAS) مطلوب من 0 إلى 10'; end if;
  v_age := physio_int(p, 'age', 0, 130, 'العمر');
  if v_age is null then
    select extract(year from age(riyadh_today(), birth_date))::int into v_age from patients where id = v_patient and birth_date is not null;
  end if;
  v_onset := nullif(physio_txt(p, 'onset'), '');
  if v_onset is not null and v_onset not in ('sudden', 'gradual') then raise exception 'بداية الألم يجب أن تكون مفاجئة أو تدريجية'; end if;
  v_char := physio_arr(p, 'painCharacter');
  if not v_char <@ array['dull','aching','numbness','burning','stabbing','tingling','itchy'] then raise exception 'طبيعة الألم تحتوي خيارًا غير معروف'; end if;
  if p->'redFlags' is null or jsonb_typeof(p->'redFlags') <> 'boolean' then raise exception 'حدّد وجود علامات الخطر (Red Flags): نعم أو لا'; end if;
  v_eval_date := coalesce(physio_date(p, 'evalDate', 'تاريخ التقييم'), riyadh_today());
  if v_eval_date > riyadh_today() then raise exception 'تاريخ التقييم لا يمكن أن يكون في المستقبل'; end if;

  if v_id is null then
    insert into physio_evaluations (patient_id, therapist_id, eval_date, age, chief_complaint, pain_vas, pain_location, onset, duration, pain_character,
      aggravating_factors, relieving_factors, medical_history, medications, observation, palpation, rom, muscle_assessment,
      sensation_superficial, sensation_deep, reflexes, special_tests, gait, diagnosis, diagnosis_condition_id, red_flags, red_flags_notes, objective, created_by, updated_by)
    values (v_patient, coalesce(nullif(p->>'therapistId', '')::uuid, (select therapist_id from employees where id = emp)), v_eval_date, v_age,
      physio_txt(p, 'chiefComplaint'), v_pain, physio_txt(p, 'painLocation'), v_onset, physio_txt(p, 'duration'), v_char,
      physio_txt(p, 'aggravatingFactors'), physio_txt(p, 'relievingFactors'), physio_txt(p, 'medicalHistory'), physio_txt(p, 'medications'),
      physio_txt(p, 'observation'), physio_txt(p, 'palpation'), physio_txt(p, 'rom'), physio_txt(p, 'muscleAssessment'),
      physio_txt(p, 'sensationSuperficial'), physio_txt(p, 'sensationDeep'), physio_txt(p, 'reflexes'), physio_txt(p, 'specialTests'), physio_txt(p, 'gait'),
      physio_txt(p, 'diagnosis'), nullif(physio_txt(p, 'diagnosisConditionId'), ''), (p->>'redFlags')::boolean, physio_txt(p, 'redFlagsNotes'), physio_objective(p->'objective'), emp, emp)
    returning id into v_id;
    perform log_action('تقييم علاج طبيعي جديد: ' || physio_txt(p, 'diagnosis'), v_patient);
  else
    update physio_evaluations set
      therapist_id = coalesce(nullif(p->>'therapistId', '')::uuid, therapist_id), eval_date = v_eval_date, age = v_age,
      chief_complaint = physio_txt(p, 'chiefComplaint'), pain_vas = v_pain, pain_location = physio_txt(p, 'painLocation'), onset = v_onset,
      duration = physio_txt(p, 'duration'), pain_character = v_char, aggravating_factors = physio_txt(p, 'aggravatingFactors'),
      relieving_factors = physio_txt(p, 'relievingFactors'), medical_history = physio_txt(p, 'medicalHistory'), medications = physio_txt(p, 'medications'),
      observation = physio_txt(p, 'observation'), palpation = physio_txt(p, 'palpation'), rom = physio_txt(p, 'rom'),
      muscle_assessment = physio_txt(p, 'muscleAssessment'), sensation_superficial = physio_txt(p, 'sensationSuperficial'),
      sensation_deep = physio_txt(p, 'sensationDeep'), reflexes = physio_txt(p, 'reflexes'), special_tests = physio_txt(p, 'specialTests'),
      gait = physio_txt(p, 'gait'), diagnosis = physio_txt(p, 'diagnosis'), diagnosis_condition_id = nullif(physio_txt(p, 'diagnosisConditionId'), ''),
      red_flags = (p->>'redFlags')::boolean, red_flags_notes = physio_txt(p, 'redFlagsNotes'),
      objective = case when p ? 'objective' then physio_objective(p->'objective') else objective end, updated_at = now(), updated_by = emp
    where id = v_id;
    perform log_action('تعديل تقييم علاج طبيعي: ' || physio_txt(p, 'diagnosis'), v_patient);
  end if;
  return v_id;
end $$;
