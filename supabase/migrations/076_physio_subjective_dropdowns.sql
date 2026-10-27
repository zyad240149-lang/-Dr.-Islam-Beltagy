-- العلاج الطبيعي: Subjective (الألم والأعراض) بـ Dropdown جوه نفس الخانات (طلب الإدارة 2026-10-01).
--   physio_evaluations.subjective (jsonb): location / radiation / onset / duration / character / pattern / aggravating / relieving / history / medications
--   الأعمدة القديمة (pain_location, onset, duration, pain_character, aggravating_factors, ...) فاضلة زي ما هي — مفيش بيانات بتتمسح.
alter table physio_evaluations add column if not exists subjective jsonb not null default '{}'::jsonb;

create or replace function physio_subjective(o jsonb) returns jsonb
language plpgsql immutable set search_path = public as $$
declare k text; e jsonb; v numeric;
begin
  if o is null or jsonb_typeof(o) = 'null' then return '{}'::jsonb; end if;
  if jsonb_typeof(o) <> 'object' then raise exception 'بيانات الألم والأعراض غير صحيحة'; end if;
  if pg_column_size(o) > 40000 then raise exception 'بيانات الألم والأعراض أكبر من المسموح'; end if;
  for k in select jsonb_object_keys(o) loop
    if k not in ('location','radiation','onset','duration','character','pattern','aggravating','relieving','history','medications') then
      raise exception 'حقل غير معروف: %', k;
    end if;
  end loop;
  if o ? 'location' and not coalesce((select bool_and(x = any(array['head','face','jaw','neck','shoulder','upper_arm','elbow','forearm','wrist','hand','chest','upper_back','lower_back','abdomen','pelvis','hip','thigh','knee','lower_leg','ankle','foot','multiple','other'])) from jsonb_array_elements_text(coalesce(o->'location'->'items', '[]')) x), true) then raise exception 'location: اختيار غير معروف'; end if;
  if o ? 'location' and coalesce(o->'location'->'items', '[]') ? 'other' and trim(coalesce(o->'location'->>'other', '')) = '' then raise exception 'location: اكتب تفاصيل «Other»'; end if;
  if o ? 'radiation' and not coalesce((select bool_and(x = any(array['none','right','left','bilateral','proximal','distal','upper_limb','lower_limb','back','chest','abdomen','other'])) from jsonb_array_elements_text(coalesce(o->'radiation'->'items', '[]')) x), true) then raise exception 'radiation: اختيار غير معروف'; end if;
  if o ? 'radiation' and coalesce(o->'radiation'->'items', '[]') ? 'other' and trim(coalesce(o->'radiation'->>'other', '')) = '' then raise exception 'radiation: اكتب تفاصيل «Other»'; end if;
  if o ? 'onset' and not coalesce((select bool_and(x = any(array['sudden','gradual','traumatic','non_traumatic','post_operative','insidious','recurrent','flare_up','unknown','other'])) from jsonb_array_elements_text(coalesce(o->'onset'->'items', '[]')) x), true) then raise exception 'onset: اختيار غير معروف'; end if;
  if o ? 'onset' and coalesce(o->'onset'->'items', '[]') ? 'other' and trim(coalesce(o->'onset'->>'other', '')) = '' then raise exception 'onset: اكتب تفاصيل «Other»'; end if;
  if o ? 'character' and not coalesce((select bool_and(x = any(array['dull','aching','sharp','stabbing','throbbing','burning','shooting','cramping','pressure','tightness','soreness','numbness','tingling','pins_needles','electric','itching','deep','superficial','other'])) from jsonb_array_elements_text(coalesce(o->'character'->'items', '[]')) x), true) then raise exception 'character: اختيار غير معروف'; end if;
  if o ? 'character' and coalesce(o->'character'->'items', '[]') ? 'other' and trim(coalesce(o->'character'->>'other', '')) = '' then raise exception 'character: اكتب تفاصيل «Other»'; end if;
  if o ? 'pattern' and not coalesce((select bool_and(x = any(array['constant','intermittent','episodic','activity','night','morning','variable','other'])) from jsonb_array_elements_text(coalesce(o->'pattern'->'items', '[]')) x), true) then raise exception 'pattern: اختيار غير معروف'; end if;
  if o ? 'pattern' and coalesce(o->'pattern'->'items', '[]') ? 'other' and trim(coalesce(o->'pattern'->>'other', '')) = '' then raise exception 'pattern: اكتب تفاصيل «Other»'; end if;
  if o ? 'aggravating' and not coalesce((select bool_and(x = any(array['walking','running','standing','sitting','stairs','bending','lifting','carrying','reaching','pushing','pulling','exercise','sleeping','turning_bed','driving','prolonged_activity','prolonged_standing','prolonged_sitting','movement','weight_bearing','repetitive','specific_movement','specific_position','coughing','sneezing','straining','cold','heat','morning','night','other'])) from jsonb_array_elements_text(coalesce(o->'aggravating'->'items', '[]')) x), true) then raise exception 'aggravating: اختيار غير معروف'; end if;
  if o ? 'aggravating' and coalesce(o->'aggravating'->'items', '[]') ? 'other' and trim(coalesce(o->'aggravating'->>'other', '')) = '' then raise exception 'aggravating: اكتب تفاصيل «Other»'; end if;
  if o ? 'relieving' and not coalesce((select bool_and(x = any(array['rest','position_change','medication','ice','heat','stretching','exercise','massage','physiotherapy','lying_down','sitting','standing','elevation','compression','sleep','other'])) from jsonb_array_elements_text(coalesce(o->'relieving'->'items', '[]')) x), true) then raise exception 'relieving: اختيار غير معروف'; end if;
  if o ? 'relieving' and coalesce(o->'relieving'->'items', '[]') ? 'other' and trim(coalesce(o->'relieving'->>'other', '')) = '' then raise exception 'relieving: اكتب تفاصيل «Other»'; end if;
  if o ? 'history' and not coalesce((select bool_and(x = any(array['none','previous_injury','previous_surgery','previous_physio','chronic','neurological','musculoskeletal','cardiovascular','respiratory','diabetes','hypertension','osteoporosis','cancer','other'])) from jsonb_array_elements_text(coalesce(o->'history'->'items', '[]')) x), true) then raise exception 'history: اختيار غير معروف'; end if;
  if o ? 'history' and coalesce(o->'history'->'items', '[]') ? 'other' and trim(coalesce(o->'history'->>'other', '')) = '' then raise exception 'history: اكتب تفاصيل «Other»'; end if;
  if jsonb_array_length(coalesce(o->'onset'->'items', '[]')) > 1 then raise exception 'Onset: اختيار واحد بس'; end if;
  if o->'history'->'items' ? 'previous_surgery' and trim(coalesce(o->'history'->>'surgery', '')) = '' then raise exception 'اكتب تفاصيل العملية (Surgery Details)'; end if;
  if o->'history'->'items' ? 'previous_injury' and trim(coalesce(o->'history'->>'injury', '')) = '' then raise exception 'اكتب تفاصيل الإصابة (Injury Details)'; end if;
  if o ? 'duration' and jsonb_typeof(o->'duration') = 'object' and (o->'duration'->>'value') is not null then
    v := (o->'duration'->>'value')::numeric;
    if v <= 0 or v > 1000 then raise exception 'المدة لازم رقم موجب'; end if;
    if coalesce(o->'duration'->>'unit', '') not in ('hours','days','weeks','months','years') then raise exception 'اختر وحدة المدة'; end if;
  end if;
  if jsonb_array_length(coalesce(o->'medications', '[]')) > 40 then raise exception 'عدد الأدوية أكبر من المسموح'; end if;
  for e in select * from jsonb_array_elements(coalesce(o->'medications', '[]')) loop
    if trim(coalesce(e->>'name', '')) = '' then raise exception 'Medications: اكتب اسم الدواء'; end if;
  end loop;
  return o;
end $$;
revoke execute on function physio_subjective(jsonb) from public, anon;

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
      sensation_superficial, sensation_deep, reflexes, special_tests, gait, diagnosis, diagnosis_condition_id, red_flags, red_flags_notes, objective, subjective, created_by, updated_by)
    values (v_patient, coalesce(nullif(p->>'therapistId', '')::uuid, (select therapist_id from employees where id = emp)), v_eval_date, v_age,
      physio_txt(p, 'chiefComplaint'), v_pain, physio_txt(p, 'painLocation'), v_onset, physio_txt(p, 'duration'), v_char,
      physio_txt(p, 'aggravatingFactors'), physio_txt(p, 'relievingFactors'), physio_txt(p, 'medicalHistory'), physio_txt(p, 'medications'),
      physio_txt(p, 'observation'), physio_txt(p, 'palpation'), physio_txt(p, 'rom'), physio_txt(p, 'muscleAssessment'),
      physio_txt(p, 'sensationSuperficial'), physio_txt(p, 'sensationDeep'), physio_txt(p, 'reflexes'), physio_txt(p, 'specialTests'), physio_txt(p, 'gait'),
      physio_txt(p, 'diagnosis'), nullif(physio_txt(p, 'diagnosisConditionId'), ''), (p->>'redFlags')::boolean, physio_txt(p, 'redFlagsNotes'), physio_objective(p->'objective'), physio_subjective(p->'subjective'), emp, emp)
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
      objective = case when p ? 'objective' then physio_objective(p->'objective') else objective end,
      subjective = case when p ? 'subjective' then physio_subjective(p->'subjective') else subjective end, updated_at = now(), updated_by = emp
    where id = v_id;
    perform log_action('تعديل تقييم علاج طبيعي: ' || physio_txt(p, 'diagnosis'), v_patient);
  end if;
  return v_id;
end $$;
