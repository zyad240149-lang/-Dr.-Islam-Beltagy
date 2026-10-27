-- رجوع عن Objective المنظّم (طلب الإدارة 2026-10-01): الحقول رجعت نص حر زي 055.
-- مفيش بيانات اتسجلت في الشكل المنظّم (0 تقييمات وقت الرجوع)، فالعمود والجداول والدوال بتتشال.
drop function if exists physio_list_save(text, uuid, text, boolean);
drop table if exists physio_muscles;
drop table if exists physio_special_tests;
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
drop function if exists physio_objective(jsonb);
alter table physio_evaluations drop column if exists objective;
