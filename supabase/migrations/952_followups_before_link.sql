-- 952: موعد المتابعة بيتحدد من غير ملف مريض: بيتحفظ جوه pending_patient->followUps، ولما التشخيص يتربط بيتسجل في ملف المريض.

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
  -- مواعيد المتابعة اللي اتحددت قبل الربط ← تتسجل في ملف المريض مربوطة بالتشخيص
  for r in select * from jsonb_array_elements(coalesce(c.pending_patient->'followUps', '[]'::jsonb)) loop
    if coalesce(r->>'date', '') !~ '^\d{4}-\d{2}-\d{2}$' then continue; end if;
    insert into ortho_follow_ups (patient_id, consultation_id, doctor_id, date, time, reason, notes, kind, status, created_by)
      values (p_patient, p_id, nullif(r->>'doctorId', '')::uuid, (r->>'date')::date, nullif(r->>'time', '')::time,
              coalesce(r->>'reason', ''), coalesce(r->>'notes', ''), nullif(r->>'kind', ''), 'scheduled', c.created_by);
  end loop;
  update ortho_consultations set pending_patient = pending_patient - 'followUps' where id = p_id;
  if c.appointment_id is null then
    select a.id into v_appt from appointments a
      where a.patient_id = p_patient and a.date = c.date and a.status in ('arrived', 'in_progress', 'completed')
        and not exists (select 1 from ortho_consultations x where x.appointment_id = a.id)
      order by a.time limit 1;
    if v_appt is not null then update ortho_consultations set appointment_id = v_appt where id = p_id; end if;
  end if;
end $$;
revoke execute on function ortho_link_consult(uuid, uuid, text) from anon, authenticated, public;
