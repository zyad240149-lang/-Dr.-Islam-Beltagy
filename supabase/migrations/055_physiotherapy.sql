-- ملف العلاج الطبيعي (Physiotherapy) — «تعديلات السستم 2»
-- Patient → physio_evaluations (Subjective/Objective/Assessment) → physio_plans (الخطة + الأهداف + ربط اختياري بالباقة/الخطة العلاجية)
--        → physio_progress_notes (ملاحظة تقدّم لكل جلسة، رقمها متسلسل ومحدود بعدد جلسات الخطة)
-- مفيش تكرار لجداول موجودة: المريض والمعالج والباقة والخطة العلاجية والجلسة كلها مراجع (FK) للجداول القائمة.
-- البيانات طبية: القراءة بصلاحية physio/view + نطاق المريض (can_see_patient)، والكتابة RPC فقط.

create table if not exists physio_evaluations (
  id uuid primary key default gen_random_uuid(),
  patient_id uuid not null references patients(id) on delete cascade,
  therapist_id uuid references therapists(id) on delete set null,
  eval_date date not null default riyadh_today(),
  -- Subjective
  age int check (age between 0 and 130),
  chief_complaint text not null check (length(trim(chief_complaint)) > 0),
  pain_vas int not null check (pain_vas between 0 and 10),
  pain_location text not null default '',
  onset text check (onset in ('sudden', 'gradual')),
  duration text not null default '',
  pain_character text[] not null default '{}'
    check (pain_character <@ array['dull','aching','numbness','burning','stabbing','tingling','itchy']),
  aggravating_factors text not null default '',
  relieving_factors text not null default '',
  medical_history text not null default '',
  medications text not null default '',
  -- Objective
  observation text not null default '',
  palpation text not null default '',
  rom text not null default '',
  muscle_assessment text not null default '',
  sensation_superficial text not null default '',
  sensation_deep text not null default '',
  reflexes text not null default '',
  special_tests text not null default '',
  gait text not null default '',
  -- Assessment
  diagnosis text not null check (length(trim(diagnosis)) > 0),
  diagnosis_condition_id text,
  red_flags boolean not null default false,
  red_flags_notes text not null default '',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  created_by uuid references employees(id) on delete set null,
  updated_by uuid references employees(id) on delete set null
);
create index if not exists physio_eval_patient_idx on physio_evaluations (patient_id, eval_date desc);

create table if not exists physio_plans (
  id uuid primary key default gen_random_uuid(),
  patient_id uuid not null references patients(id) on delete cascade,
  evaluation_id uuid not null references physio_evaluations(id) on delete cascade,
  package_id uuid references packages(id) on delete set null,
  treatment_plan_id uuid references treatment_plans(id) on delete set null,
  pt_frequency text not null default '',
  total_sessions int not null check (total_sessions between 1 and 100),
  duration_value int check (duration_value between 1 and 52),
  duration_unit text check (duration_unit in ('week', 'month')),
  sessions_per_week int check (sessions_per_week between 1 and 7),
  start_date date not null default riyadh_today(),
  follow_up_date date,
  reevaluation_date date,
  short_goals text[] not null default '{}',
  long_goals text[] not null default '{}',
  status text not null default 'active' check (status in ('active', 'completed', 'cancelled')),
  notes text not null default '',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  created_by uuid references employees(id) on delete set null,
  updated_by uuid references employees(id) on delete set null,
  constraint physio_plan_one_per_eval unique (evaluation_id),
  constraint physio_plan_reeval_after_start check (reevaluation_date is null or reevaluation_date >= start_date),
  constraint physio_plan_followup_after_start check (follow_up_date is null or follow_up_date >= start_date)
);
create index if not exists physio_plans_patient_idx on physio_plans (patient_id, created_at desc);

create table if not exists physio_progress_notes (
  id uuid primary key default gen_random_uuid(),
  plan_id uuid not null references physio_plans(id) on delete cascade,
  patient_id uuid not null references patients(id) on delete cascade,
  session_no int not null check (session_no > 0),
  session_date date not null default riyadh_today(),
  treatment_session_id uuid references treatment_sessions(id) on delete set null,
  diagnosis text not null default '',
  pain_vas int not null check (pain_vas between 0 and 10),
  electrotherapy text[] not null default '{}'
    check (electrotherapy <@ array['tens','swt','laser','ifc','us','nmes','game_ready','cryotherapy','iontophoresis','phonophoresis']),
  manual_therapy text not null default '',
  positioning text not null default '',
  therapeutic_exercise text not null default '',
  pt_name text not null check (length(trim(pt_name)) > 0),
  therapist_id uuid references therapists(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  created_by uuid references employees(id) on delete set null,
  updated_by uuid references employees(id) on delete set null,
  constraint physio_note_unique_session unique (plan_id, session_no)
);
create index if not exists physio_notes_patient_idx on physio_progress_notes (patient_id, session_date desc);

alter table physio_evaluations enable row level security;
alter table physio_plans enable row level security;
alter table physio_progress_notes enable row level security;
drop policy if exists physio_eval_select on physio_evaluations;
drop policy if exists physio_plans_select on physio_plans;
drop policy if exists physio_notes_select on physio_progress_notes;
create policy physio_eval_select on physio_evaluations for select using (has_perm('physio', 'view') and can_see_patient(patient_id));
create policy physio_plans_select on physio_plans for select using (has_perm('physio', 'view') and can_see_patient(patient_id));
create policy physio_notes_select on physio_progress_notes for select using (has_perm('physio', 'view') and can_see_patient(patient_id));
revoke insert, update, delete on physio_evaluations, physio_plans, physio_progress_notes from authenticated, anon;
revoke all on physio_evaluations, physio_plans, physio_progress_notes from anon;
grant select on physio_evaluations, physio_plans, physio_progress_notes to authenticated;

-- ---------- أدوات مساعدة ----------
create or replace function physio_txt(p jsonb, k text) returns text
language sql immutable as $$ select coalesce(trim(p->>k), '') $$;

create or replace function physio_arr(p jsonb, k text) returns text[]
language sql immutable as $$
  select coalesce(array(select distinct trim(x) from jsonb_array_elements_text(case when jsonb_typeof(p->k) = 'array' then p->k else '[]'::jsonb end) x where trim(x) <> ''), '{}')
$$;

create or replace function physio_int(p jsonb, k text, lo int, hi int, label text) returns int
language plpgsql immutable as $$
declare v int;
begin
  if p->>k is null or p->>k = '' then return null; end if;
  begin v := (p->>k)::int; exception when others then raise exception '% يجب أن يكون رقمًا صحيحًا', label; end;
  if v < lo or v > hi then raise exception '% يجب أن يكون بين % و %', label, lo, hi; end if;
  return v;
end $$;

create or replace function physio_date(p jsonb, k text, label text) returns date
language plpgsql immutable as $$
begin
  if p->>k is null or p->>k = '' then return null; end if;
  if p->>k !~ '^\d{4}-\d{2}-\d{2}$' then raise exception '% غير صحيح', label; end if;
  begin return (p->>k)::date; exception when others then raise exception '% غير صحيح', label; end;
end $$;

-- عدد الجلسات المسجلة/المتبقية لخطة
create or replace function physio_plan_tracking(p_plan uuid) returns jsonb
language plpgsql stable security definer set search_path = public as $$
declare pl physio_plans; v_done int;
begin
  perform require_perm('physio', 'view');
  select * into pl from physio_plans where id = p_plan;
  if pl.id is null or not can_see_patient(pl.patient_id) then raise exception 'الخطة غير موجودة'; end if;
  select count(*) into v_done from physio_progress_notes where plan_id = p_plan;
  return jsonb_build_object('planId', pl.id, 'total', pl.total_sessions, 'completed', v_done,
    'remaining', greatest(pl.total_sessions - v_done, 0), 'nextSessionNo', case when v_done < pl.total_sessions then v_done + 1 end,
    'status', pl.status, 'reevaluationDate', pl.reevaluation_date, 'followUpDate', pl.follow_up_date);
end $$;

-- ---------- التقييم: إنشاء / تعديل ----------
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
      sensation_superficial, sensation_deep, reflexes, special_tests, gait, diagnosis, diagnosis_condition_id, red_flags, red_flags_notes, created_by, updated_by)
    values (v_patient, coalesce(nullif(p->>'therapistId', '')::uuid, (select therapist_id from employees where id = emp)), v_eval_date, v_age,
      physio_txt(p, 'chiefComplaint'), v_pain, physio_txt(p, 'painLocation'), v_onset, physio_txt(p, 'duration'), v_char,
      physio_txt(p, 'aggravatingFactors'), physio_txt(p, 'relievingFactors'), physio_txt(p, 'medicalHistory'), physio_txt(p, 'medications'),
      physio_txt(p, 'observation'), physio_txt(p, 'palpation'), physio_txt(p, 'rom'), physio_txt(p, 'muscleAssessment'),
      physio_txt(p, 'sensationSuperficial'), physio_txt(p, 'sensationDeep'), physio_txt(p, 'reflexes'), physio_txt(p, 'specialTests'), physio_txt(p, 'gait'),
      physio_txt(p, 'diagnosis'), nullif(physio_txt(p, 'diagnosisConditionId'), ''), (p->>'redFlags')::boolean, physio_txt(p, 'redFlagsNotes'), emp, emp)
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
      red_flags = (p->>'redFlags')::boolean, red_flags_notes = physio_txt(p, 'redFlagsNotes'), updated_at = now(), updated_by = emp
    where id = v_id;
    perform log_action('تعديل تقييم علاج طبيعي: ' || physio_txt(p, 'diagnosis'), v_patient);
  end if;
  return v_id;
end $$;

-- ---------- الخطة (والأهداف): إنشاء / تعديل ----------
create or replace function physio_save_plan(p jsonb) returns uuid
language plpgsql security definer set search_path = public as $$
declare emp uuid; v_id uuid := nullif(p->>'id', '')::uuid; v_eval physio_evaluations; v_patient uuid; v_pkg uuid; v_tp uuid;
  v_total int; v_done int := 0; v_unit text; v_start date; v_status text; old physio_plans;
begin
  emp := require_perm('physio', case when v_id is null then 'create' else 'edit' end);
  if v_id is null then
    select * into v_eval from physio_evaluations where id = nullif(p->>'evaluationId', '')::uuid;
    if v_eval.id is null then raise exception 'أنشئ التقييم أولًا — الخطة لازم تكون مرتبطة بتقييم'; end if;
    if exists (select 1 from physio_plans where evaluation_id = v_eval.id) then raise exception 'هذا التقييم له خطة بالفعل — عدّلها بدل إنشاء خطة جديدة'; end if;
    v_patient := v_eval.patient_id;
  else
    select * into old from physio_plans where id = v_id for update;
    if old.id is null then raise exception 'الخطة غير موجودة'; end if;
    v_patient := old.patient_id;
    select count(*) into v_done from physio_progress_notes where plan_id = v_id;
  end if;
  if not can_see_patient(v_patient) then raise exception 'لا توجد صلاحية على ملف هذا المريض' using errcode = '42501'; end if;

  v_pkg := nullif(p->>'packageId', '')::uuid;
  if v_pkg is not null and not exists (select 1 from packages where id = v_pkg and patient_id = v_patient) then raise exception 'الباقة المختارة لا تخص هذا المريض'; end if;
  v_tp := nullif(p->>'treatmentPlanId', '')::uuid;
  if v_tp is not null and not exists (select 1 from treatment_plans where id = v_tp and patient_id = v_patient) then raise exception 'الخطة العلاجية المختارة لا تخص هذا المريض'; end if;

  v_total := physio_int(p, 'totalSessions', 1, 100, 'عدد الجلسات');
  if v_total is null and v_pkg is not null then select total_sessions into v_total from packages where id = v_pkg; end if;
  if v_total is null then raise exception 'عدد الجلسات مطلوب'; end if;
  if v_total < v_done then raise exception 'لا يمكن تقليل عدد الجلسات إلى % — مسجّل بالفعل % جلسة', v_total, v_done; end if;
  v_unit := nullif(physio_txt(p, 'durationUnit'), '');
  if v_unit is not null and v_unit not in ('week', 'month') then raise exception 'وحدة مدة الخطة يجب أن تكون أسبوع أو شهر'; end if;
  v_start := coalesce(physio_date(p, 'startDate', 'تاريخ بداية الخطة'), old.start_date, riyadh_today());
  v_status := coalesce(nullif(physio_txt(p, 'status'), ''), old.status, 'active');
  if v_status not in ('active', 'completed', 'cancelled') then raise exception 'حالة الخطة غير صحيحة'; end if;
  if v_status = 'completed' and v_done < v_total then v_status := 'active'; end if;
  if v_status = 'active' and v_done >= v_total and v_id is not null then v_status := 'completed'; end if;
  if physio_date(p, 'reevaluationDate', 'تاريخ إعادة التقييم') < v_start then raise exception 'تاريخ إعادة التقييم يجب أن يكون بعد بداية الخطة'; end if;
  if physio_date(p, 'followUpDate', 'تاريخ المتابعة') < v_start then raise exception 'تاريخ المتابعة يجب أن يكون بعد بداية الخطة'; end if;

  if v_id is null then
    insert into physio_plans (patient_id, evaluation_id, package_id, treatment_plan_id, pt_frequency, total_sessions, duration_value, duration_unit,
      sessions_per_week, start_date, follow_up_date, reevaluation_date, short_goals, long_goals, status, notes, created_by, updated_by)
    values (v_patient, v_eval.id, v_pkg, v_tp, physio_txt(p, 'ptFrequency'), v_total, physio_int(p, 'durationValue', 1, 52, 'مدة الخطة'), v_unit,
      physio_int(p, 'sessionsPerWeek', 1, 7, 'عدد الجلسات في الأسبوع'), v_start, physio_date(p, 'followUpDate', 'تاريخ المتابعة'),
      physio_date(p, 'reevaluationDate', 'تاريخ إعادة التقييم'), physio_arr(p, 'shortGoals'), physio_arr(p, 'longGoals'), v_status, physio_txt(p, 'notes'), emp, emp)
    returning id into v_id;
    perform log_action('خطة علاج طبيعي جديدة: ' || v_total || ' جلسة', v_patient);
  else
    update physio_plans set package_id = v_pkg, treatment_plan_id = v_tp, pt_frequency = physio_txt(p, 'ptFrequency'), total_sessions = v_total,
      duration_value = physio_int(p, 'durationValue', 1, 52, 'مدة الخطة'), duration_unit = v_unit,
      sessions_per_week = physio_int(p, 'sessionsPerWeek', 1, 7, 'عدد الجلسات في الأسبوع'), start_date = v_start,
      follow_up_date = physio_date(p, 'followUpDate', 'تاريخ المتابعة'), reevaluation_date = physio_date(p, 'reevaluationDate', 'تاريخ إعادة التقييم'),
      short_goals = case when p ? 'shortGoals' then physio_arr(p, 'shortGoals') else short_goals end,
      long_goals = case when p ? 'longGoals' then physio_arr(p, 'longGoals') else long_goals end,
      status = v_status, notes = physio_txt(p, 'notes'), updated_at = now(), updated_by = emp
    where id = v_id;
    perform log_action('تعديل خطة علاج طبيعي: ' || v_total || ' جلسة', v_patient);
  end if;
  return v_id;
end $$;

-- الأهداف لوحدها (إضافة/تعديل)
create or replace function physio_set_goals(p_plan uuid, p_short text[], p_long text[]) returns void
language plpgsql security definer set search_path = public as $$
declare emp uuid; v_patient uuid;
begin
  emp := require_perm('physio', 'edit');
  select patient_id into v_patient from physio_plans where id = p_plan for update;
  if v_patient is null then raise exception 'الخطة غير موجودة'; end if;
  if not can_see_patient(v_patient) then raise exception 'لا توجد صلاحية على ملف هذا المريض' using errcode = '42501'; end if;
  update physio_plans set
    short_goals = coalesce(array(select distinct trim(x) from unnest(coalesce(p_short, '{}')) x where trim(x) <> ''), '{}'),
    long_goals = coalesce(array(select distinct trim(x) from unnest(coalesce(p_long, '{}')) x where trim(x) <> ''), '{}'),
    updated_at = now(), updated_by = emp
  where id = p_plan;
  perform log_action('تحديث أهداف خطة العلاج الطبيعي', v_patient);
end $$;

-- ---------- ملاحظة التقدّم (Progress Note): إنشاء / تعديل ----------
create or replace function physio_save_note(p jsonb) returns jsonb
language plpgsql security definer set search_path = public as $$
declare emp uuid; v_id uuid := nullif(p->>'id', '')::uuid; pl physio_plans; old physio_progress_notes; v_no int; v_done int;
  v_pain int; v_elec text[]; v_ts uuid; v_date date;
begin
  emp := require_perm('physio', case when v_id is null then 'create' else 'edit' end);
  if v_id is null then
    select * into pl from physio_plans where id = nullif(p->>'planId', '')::uuid for update; -- قفل الخطة يمنع تسجيل نفس رقم الجلسة مرتين بالتوازي
    if pl.id is null then raise exception 'لا يمكن تسجيل ملاحظة تقدّم بدون خطة علاج طبيعي'; end if;
  else
    select * into old from physio_progress_notes where id = v_id;
    if old.id is null then raise exception 'ملاحظة التقدّم غير موجودة'; end if;
    select * into pl from physio_plans where id = old.plan_id for update;
  end if;
  if not exists (select 1 from patients where id = pl.patient_id) then raise exception 'المريض غير موجود'; end if;
  if not can_see_patient(pl.patient_id) then raise exception 'لا توجد صلاحية على ملف هذا المريض' using errcode = '42501'; end if;

  v_pain := physio_int(p, 'painVas', 0, 10, 'مقياس الألم');
  if v_pain is null then raise exception 'مقياس الألم مطلوب من 0 إلى 10'; end if;
  v_elec := physio_arr(p, 'electrotherapy');
  if not v_elec <@ array['tens','swt','laser','ifc','us','nmes','game_ready','cryotherapy','iontophoresis','phonophoresis'] then raise exception 'العلاج الكهربائي يحتوي خيارًا غير معروف'; end if;
  if physio_txt(p, 'ptName') = '' then raise exception 'اسم أخصائي العلاج الطبيعي مطلوب'; end if;
  v_date := coalesce(physio_date(p, 'sessionDate', 'تاريخ الجلسة'), old.session_date, riyadh_today());
  if v_date > riyadh_today() then raise exception 'تاريخ الجلسة لا يمكن أن يكون في المستقبل'; end if;
  if v_date < pl.start_date then raise exception 'تاريخ الجلسة قبل بداية الخطة'; end if;
  v_ts := nullif(p->>'treatmentSessionId', '')::uuid;
  if v_ts is not null and not exists (select 1 from treatment_sessions where id = v_ts and patient_id = pl.patient_id) then raise exception 'الجلسة المرتبطة لا تخص هذا المريض'; end if;

  if v_id is null then
    if pl.status = 'cancelled' then raise exception 'الخطة ملغاة — لا يمكن تسجيل جلسات عليها'; end if;
    select count(*), coalesce(max(session_no), 0) into v_done, v_no from physio_progress_notes where plan_id = pl.id;
    v_no := v_no + 1;
    if p->>'sessionNo' is not null and p->>'sessionNo' <> '' and (p->>'sessionNo')::int <> v_no then
      raise exception 'رقم الجلسة يجب أن يكون % (الجلسات متسلسلة)', v_no; end if;
    if v_no > pl.total_sessions then
      raise exception 'انتهت جلسات الخطة (%/%) — لإضافة جلسة، عدّل الخطة وزِد عدد الجلسات (يتطلب صلاحية تعديل)', pl.total_sessions, pl.total_sessions; end if;
    if v_ts is not null and exists (select 1 from physio_progress_notes where treatment_session_id = v_ts) then raise exception 'هذه الجلسة لها ملاحظة تقدّم بالفعل'; end if;
    insert into physio_progress_notes (plan_id, patient_id, session_no, session_date, treatment_session_id, diagnosis, pain_vas, electrotherapy,
      manual_therapy, positioning, therapeutic_exercise, pt_name, therapist_id, created_by, updated_by)
    values (pl.id, pl.patient_id, v_no, v_date, v_ts,
      coalesce(nullif(physio_txt(p, 'diagnosis'), ''), (select diagnosis from physio_evaluations where id = pl.evaluation_id), ''),
      v_pain, v_elec, physio_txt(p, 'manualTherapy'), physio_txt(p, 'positioning'), physio_txt(p, 'therapeuticExercise'), physio_txt(p, 'ptName'),
      coalesce(nullif(p->>'therapistId', '')::uuid, (select therapist_id from employees where id = emp)), emp, emp)
    returning id into v_id;
    if v_no >= pl.total_sessions and pl.status = 'active' then update physio_plans set status = 'completed', updated_at = now(), updated_by = emp where id = pl.id; end if;
    perform log_action('ملاحظة تقدّم علاج طبيعي — الجلسة ' || v_no || '/' || pl.total_sessions, pl.patient_id);
  else
    -- رقم الجلسة والخطة ثابتين في التعديل (منعًا لتكرار أو كسر التسلسل)
    if v_ts is not null and exists (select 1 from physio_progress_notes where treatment_session_id = v_ts and id <> v_id) then raise exception 'هذه الجلسة لها ملاحظة تقدّم بالفعل'; end if;
    update physio_progress_notes set session_date = v_date, treatment_session_id = v_ts, diagnosis = physio_txt(p, 'diagnosis'), pain_vas = v_pain,
      electrotherapy = v_elec, manual_therapy = physio_txt(p, 'manualTherapy'), positioning = physio_txt(p, 'positioning'),
      therapeutic_exercise = physio_txt(p, 'therapeuticExercise'), pt_name = physio_txt(p, 'ptName'),
      therapist_id = coalesce(nullif(p->>'therapistId', '')::uuid, therapist_id), updated_at = now(), updated_by = emp
    where id = v_id returning session_no into v_no;
    perform log_action('تعديل ملاحظة تقدّم علاج طبيعي — الجلسة ' || v_no, pl.patient_id);
  end if;
  return physio_plan_tracking(pl.id) || jsonb_build_object('noteId', v_id, 'sessionNo', v_no);
end $$;

-- حذف آخر ملاحظة فقط (يحافظ على التسلسل) — صلاحية حذف
create or replace function physio_delete_note(p_id uuid) returns void
language plpgsql security definer set search_path = public as $$
declare n physio_progress_notes;
begin
  perform require_perm('physio', 'delete');
  select * into n from physio_progress_notes where id = p_id;
  if n.id is null then raise exception 'ملاحظة التقدّم غير موجودة'; end if;
  perform 1 from physio_plans where id = n.plan_id for update;
  if exists (select 1 from physio_progress_notes where plan_id = n.plan_id and session_no > n.session_no) then
    raise exception 'يمكن حذف آخر جلسة مسجّلة فقط للحفاظ على تسلسل أرقام الجلسات'; end if;
  delete from physio_progress_notes where id = p_id;
  update physio_plans set status = 'active', updated_at = now(), updated_by = my_employee_id() where id = n.plan_id and status = 'completed';
  perform log_action('حذف ملاحظة تقدّم علاج طبيعي — الجلسة ' || n.session_no, n.patient_id);
end $$;

-- ملخص المريض (للوحة المختصرة)
create or replace function physio_patient_summary(p_patient uuid) returns jsonb
language plpgsql stable security definer set search_path = public as $$
declare pl physio_plans; ev physio_evaluations; v_last int; v_next record;
begin
  perform require_perm('physio', 'view');
  if not exists (select 1 from patients where id = p_patient) then raise exception 'المريض غير موجود'; end if;
  if not can_see_patient(p_patient) then raise exception 'لا توجد صلاحية على ملف هذا المريض' using errcode = '42501'; end if;
  select * into ev from physio_evaluations where patient_id = p_patient order by eval_date desc, created_at desc limit 1;
  select * into pl from physio_plans where patient_id = p_patient order by (status = 'active') desc, created_at desc limit 1;
  select pain_vas into v_last from physio_progress_notes where patient_id = p_patient order by session_date desc, created_at desc limit 1;
  select date, time into v_next from appointments where patient_id = p_patient and date >= riyadh_today()
    and status not in ('cancelled', 'completed', 'no_show', 'rescheduled') order by date, time limit 1;
  return jsonb_build_object('diagnosis', ev.diagnosis, 'painLevel', coalesce(v_last, ev.pain_vas),
    'plan', case when pl.id is null then null else physio_plan_tracking(pl.id) end,
    'packageName', (select name from packages where id = pl.package_id),
    'nextAppointment', case when v_next.date is null then null else jsonb_build_object('date', v_next.date, 'time', v_next.time) end);
end $$;

revoke execute on function physio_save_evaluation(jsonb), physio_save_plan(jsonb), physio_set_goals(uuid, text[], text[]), physio_save_note(jsonb),
  physio_delete_note(uuid), physio_plan_tracking(uuid), physio_patient_summary(uuid) from public, anon;
grant execute on function physio_save_evaluation(jsonb), physio_save_plan(jsonb), physio_set_goals(uuid, text[], text[]), physio_save_note(jsonb),
  physio_delete_note(uuid), physio_plan_tracking(uuid), physio_patient_summary(uuid) to authenticated;

-- ---------- حماية السجل الطبي: مريض عنده ملف علاج طبيعي مايتحذفش (نفس قاعدة 008 للزيارات) ----------
create or replace function delete_patient(p_id uuid) returns void
language plpgsql security definer set search_path = public as $$
declare pat patients;
begin
  perform require_perm('patients', 'delete');
  select * into pat from patients where id = p_id;
  if pat.id is null then raise exception 'المريض غير موجود'; end if;
  if exists (select 1 from appointments where patient_id = p_id) or exists (select 1 from treatment_sessions where patient_id = p_id) then
    raise exception 'لا يمكن حذف مريض لديه مواعيد أو زيارات مسجّلة — عطّل الملف بدل حذفه للاحتفاظ بالسجل الطبي';
  end if;
  if exists (select 1 from physio_evaluations where patient_id = p_id) then
    raise exception 'لا يمكن حذف مريض لديه ملف علاج طبيعي (تقييم/ملاحظات تقدّم) — عطّل الملف بدل حذفه للاحتفاظ بالسجل الطبي';
  end if;
  if exists (select 1 from payments where patient_id = p_id) or exists (select 1 from invoices where patient_id = p_id and status <> 'cancelled') then
    raise exception 'لا يمكن حذف مريض لديه فواتير أو مدفوعات — عطّل الملف بدل حذفه';
  end if;
  update customers set patient_id = null where patient_id = p_id;
  delete from patients where id = p_id;
  perform log_action('حذف ملف المريض ' || pat.full_name || ' (' || pat.file_no || ')');
end $$;
grant execute on function delete_patient(uuid) to authenticated;

-- ---------- الصلاحيات: بيانات طبية — للمعالج والإدارة فقط ----------
insert into role_permissions (role, area, ops) values
  ('system_admin', 'physio', '{view,create,edit,delete}'),
  ('center_manager', 'physio', '{view,create,edit,delete}'),
  ('therapist', 'physio', '{view,create,edit}'),
  ('secretary', 'physio', '{}'),
  ('reception', 'physio', '{}'),
  ('accountant', 'physio', '{}')
on conflict (role, area) do update set ops = excluded.ops;
