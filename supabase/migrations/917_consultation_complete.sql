-- 917: التشخيص كله اختياري — الكشف بيتحفظ حتى لو ناقص (الشكوى/التشخيص فاضيين) ويتعلّم «يحتاج استكمال» (complete = false)،
-- والدكتور يعلّمه «التشخيص اكتمل». الكشوفات القديمة كلها مكتملة (default true).
alter table ortho_consultations
  drop constraint if exists ortho_consultations_complaint_check,
  drop constraint if exists ortho_consultations_diagnosis_check,
  add column if not exists complete boolean not null default true;

-- «سجلي الطبي» في بوابة المريض: التشخيصات المكتملة بس (اللي لسه بيتكتب مايظهرش للمريض) — نفس دالة 909 + شرط complete
CREATE OR REPLACE FUNCTION public.patient_medical_record()
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare c customers;
begin
  c := require_patient();
  return jsonb_build_object(
    'consultations', coalesce((select jsonb_agg(jsonb_build_object(
        'id', x.id, 'date', x.date, 'complaint', x.complaint, 'region', x.region, 'side', x.side, 'diagnosis', x.diagnosis, 'icd10', x.icd10,
        'plan', x.plan, 'medications', x.medications, 'labs', x.labs, 'imagingRequests', x.imaging_requests, 'followUp', x.follow_up, 'doctor', e.name)
        order by x.date desc, x.created_at desc)
      from ortho_consultations x left join employees e on e.id = x.created_by where x.patient_id = c.patient_id and x.complete), '[]'::jsonb),
    'imaging', coalesce((select jsonb_agg(jsonb_build_object('id', x.id, 'kind', x.kind, 'region', x.region, 'requestedAt', x.requested_at, 'status', x.status, 'finding', x.finding)
        order by x.requested_at desc, x.created_at desc)
      from ortho_imaging x where x.patient_id = c.patient_id), '[]'::jsonb),
    'fractures', coalesce((select jsonb_agg(jsonb_build_object('id', x.id, 'bone', x.bone, 'side', x.side, 'kind', x.kind, 'injuryDate', x.injury_date,
        'castDate', x.cast_date, 'removalDue', x.removal_due, 'status', x.status) order by x.injury_date desc, x.created_at desc)
      from ortho_fractures x where x.patient_id = c.patient_id), '[]'::jsonb),
    'surgeries', coalesce((select jsonb_agg(jsonb_build_object('id', x.id, 'procedure', x.procedure, 'region', x.region, 'side', x.side, 'hospital', x.hospital,
        'date', x.date, 'implant', x.implant, 'status', x.status) order by x.date desc nulls first, x.created_at desc)
      from ortho_surgeries x where x.patient_id = c.patient_id), '[]'::jsonb),
    'nextFollowUp', (select min(x.follow_up) from ortho_consultations x where x.patient_id = c.patient_id and x.complete and x.follow_up >= riyadh_today()),
    'patient', (select jsonb_build_object('name', p.full_name, 'fileNo', p.file_no, 'birthDate', p.birth_date, 'gender', p.gender) from patients p where p.id = c.patient_id)
  );
end $function$;
