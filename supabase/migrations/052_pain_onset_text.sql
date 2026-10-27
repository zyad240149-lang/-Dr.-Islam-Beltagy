-- «بداية ظهور الألم» بقت وصف نصي (إزاي بدأ الألم) بدل تاريخ — التواريخ القديمة بتتحول نص زي ما هي.
alter table treatment_plans alter column pain_onset type text using pain_onset::text;
CREATE OR REPLACE FUNCTION public.save_plan(p jsonb)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare v uuid := _uuid(p, 'id'); pat patients; ex treatment_plans; svc services; start_d date; weeks int; per_week int; v_total int; v_price numeric; v_dates jsonb;
  me_row employees := me(); th uuid; inv uuid;
begin
  perform require_perm('plans', case when v is null then 'create' else 'edit' end);
  select * into pat from patients where id = _uuid(p, 'patientId');
  if pat.id is null or not can_see_patient(pat.id) then raise exception 'اختر المريض'; end if;
  select * into svc from services where id = nullif(p->>'serviceId', '');
  if svc.id is null then raise exception 'اختر الخدمة'; end if;
  if _txt(p, 'diagnosis') = '' then raise exception 'اكتب التشخيص'; end if;
  -- إجمالي الجلسات = المدة بالأسابيع × الجلسات في الأسبوع — بيتحسب هنا دايمًا، وأي totalSessions جاي من الواجهة بيتجاهل
  weeks := _num(p, 'durationWeeks', 1)::int; per_week := _num(p, 'sessionsPerWeek', 2)::int; v_price := _num(p, 'price', 0);
  if per_week < 1 or per_week > 7 then raise exception 'الجلسات في الأسبوع من 1 إلى 7'; end if;
  if weeks < 1 or weeks > 52 then raise exception 'مدة الخطة من 1 إلى 52 أسبوع'; end if;
  v_total := weeks * per_week;
  if nullif(p->>'patientAge', '') is not null and ((p->>'patientAge')::int < 0 or (p->>'patientAge')::int > 120) then raise exception 'العمر غير صحيح'; end if;
  if v_total > 200 then raise exception 'إجمالي الجلسات لا يزيد عن 200'; end if;
  -- مواعيد الجلسات المعدّلة يدويًا: تتحفظ بس لو عددها = إجمالي الجلسات وكلها تواريخ صحيحة ومرتّبة، وإلا بترجع محسوبة تلقائي (null)
  v_dates := case when jsonb_typeof(p->'sessionDates') = 'array' and jsonb_array_length(p->'sessionDates') = v_total then p->'sessionDates' end;
  if v_dates is not null then
    if exists (select 1 from jsonb_array_elements_text(v_dates) with ordinality a(d, n)
               join jsonb_array_elements_text(v_dates) with ordinality b(d, n) on b.n = a.n + 1 where b.d::date < a.d::date) then
      raise exception 'مواعيد الجلسات لازم تكون بالترتيب — كل جلسة بعد اللي قبلها';
    end if;
  end if;
  if v_price < 0 then raise exception 'السعر لا يمكن أن يكون سالبًا'; end if;
  start_d := coalesce(nullif(p->>'startDate', '')::date, riyadh_today());
  th := coalesce(_uuid(p, 'therapistId'), me_row.therapist_id);
  if p->>'status' is not null and p->>'status' not in ('active','completed','paused') then raise exception 'حالة الخطة غير صحيحة'; end if;

  if v is not null then
    select * into ex from treatment_plans where id = v for update;
    if ex.id is null then raise exception 'الخطة غير موجودة'; end if;
    update treatment_plans set service_id = svc.id, diagnosis = _txt(p, 'diagnosis'),
      diagnosis_condition_id = nullif(p #>> '{diagnosisRef,conditionId}', ''), diagnosis_side = nullif(p #>> '{diagnosisRef,side}', ''),
      main_goal = _txt(p, 'mainGoal'), short_term_goals = _txt(p, 'shortTermGoals'), long_term_goals = _txt(p, 'longTermGoals'),
      total_sessions = v_total, sessions_per_week = per_week, duration_weeks = weeks,
      therapy_type = _txt(p, 'therapyType'), exercises = _txt(p, 'exercises'), devices = _txt(p, 'devices'),
      therapist_notes = _txt(p, 'therapistNotes'), notes = _txt(p, 'notes'), price = v_price,
      start_date = start_d, end_date = start_d + weeks * 7, session_dates = v_dates,
      patient_age = nullif(p->>'patientAge', '')::int, pain_onset = nullif(trim(p->>'painOnset'), ''), chief_complaint = _txt(p, 'chiefComplaint'), status = coalesce(nullif(p->>'status', ''), status), therapist_id = th
    where id = v;
  else
    insert into treatment_plans (patient_id, service_id, diagnosis, diagnosis_condition_id, diagnosis_side, main_goal, short_term_goals, long_term_goals,
      total_sessions, sessions_per_week, duration_weeks, therapy_type, exercises, devices, therapist_notes, notes, price, start_date, end_date,
      status, therapist_id, created_by, session_dates, patient_age, pain_onset, chief_complaint)
    values (pat.id, svc.id, _txt(p, 'diagnosis'), nullif(p #>> '{diagnosisRef,conditionId}', ''), nullif(p #>> '{diagnosisRef,side}', ''),
      _txt(p, 'mainGoal'), _txt(p, 'shortTermGoals'), _txt(p, 'longTermGoals'), v_total, per_week, weeks,
      _txt(p, 'therapyType'), _txt(p, 'exercises'), _txt(p, 'devices'), _txt(p, 'therapistNotes'), _txt(p, 'notes'), v_price, start_d, start_d + weeks * 7,
      coalesce(nullif(p->>'status', ''), 'active'), th, me_row.id, v_dates, nullif(p->>'patientAge', '')::int, nullif(trim(p->>'painOnset'), ''), _txt(p, 'chiefComplaint'))
    returning id into v;
    if v_price > 0 then
      inv := new_invoice(pat.id, 'خطة علاج: ' || svc.name || ' (' || v_total || ' جلسات)', v_price, 'draft', start_d, null, null, v, svc.id);
      perform notify_staff('payment_due', 'فاتورة خطة علاجية بانتظار المراجعة', pat.full_name || ' — ' || svc.name || ' (' || v_total || ' جلسات)', v::text, '/invoices?tab=plans', pat.id);
    end if;
    update appointments set plan_id = v where patient_id = pat.id and plan_id is null and date >= start_d
      and status in ('new','confirmed','on_way','arrived','rescheduled');
    perform notify_patient(pat.id, 'plan_new', 'خطة علاجية جديدة', svc.name || ' — ' || v_total || ' جلسات تبدأ ' || start_d, v::text);
  end if;
  perform recalc_plan(v);
  perform log_action(case when ex.id is null then 'إنشاء' else 'تعديل' end || ' خطة علاجية — ' || _txt(p, 'diagnosis') || ' (' || v_total || ' جلسات)', pat.id);
  return jsonb_build_object('id', v);
end $function$
;
