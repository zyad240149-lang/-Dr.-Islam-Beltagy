-- تشخيص كل جلسة (2026-10-22): الأخصائي يكتب تشخيص الجلسة الأولى يدويًا (خانة واحدة)، والجلسة التانية بعد تأكيد حضور الأولى، وهكذا.
-- الربط بالباقة/الخطة نفسها (نفس مصدر «حضور مرضى الباقات») + رقم الجلسة. الكتابة RPC فقط، والقراءة RLS.
create table if not exists session_diagnoses (
  id uuid primary key default gen_random_uuid(),
  source text not null check (source in ('package', 'plan')),
  source_id uuid not null,
  patient_id uuid not null references patients(id) on delete cascade,
  session_no int not null check (session_no >= 1),
  diagnosis text not null check (length(btrim(diagnosis)) between 1 and 1000),
  created_by uuid references employees(id) on delete set null,
  updated_by uuid references employees(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (source, source_id, session_no)
);
create index if not exists session_diagnoses_patient_idx on session_diagnoses (patient_id);
create index if not exists session_diagnoses_created_by_idx on session_diagnoses (created_by);
create index if not exists session_diagnoses_updated_by_idx on session_diagnoses (updated_by);
alter table session_diagnoses enable row level security;
drop policy if exists sd_read on session_diagnoses;
create policy sd_read on session_diagnoses for select using ((select has_perm('sessions', 'view')) and (select can_see_patient(patient_id)));
revoke insert, update, delete on session_diagnoses from authenticated, anon;

-- عدد الجلسات اللي حضرها المريض فعلًا في الباقة/الخطة (نفس تعريف حضور الباقات)
create or replace function session_attended_count(p_source text, p_id uuid) returns int
language sql stable security definer set search_path = public as $$
  select greatest(
    (select count(*)::int from appointments a where a.status in ('arrived', 'in_progress', 'completed')
       and ((p_source = 'package' and a.package_id = p_id) or (p_source = 'plan' and a.plan_id = p_id))),
    case when p_source = 'package' then coalesce((select used_sessions from packages where id = p_id), 0)
         else (select count(*)::int from treatment_sessions where plan_id = p_id and status = 'completed') end)
$$;
revoke execute on function session_attended_count(text, uuid) from public, anon, authenticated;

create or replace function session_diagnoses_list(p_source text, p_id uuid) returns jsonb
language plpgsql stable security definer set search_path = public as $$
declare v_patient uuid; v_total int;
begin
  perform require_perm('sessions', 'view');
  if p_source = 'package' then select patient_id, total_sessions into v_patient, v_total from packages where id = p_id;
  elsif p_source = 'plan' then select patient_id, total_sessions into v_patient, v_total from treatment_plans where id = p_id;
  else raise exception 'مصدر غير صحيح'; end if;
  if v_patient is null then raise exception 'الباقة أو الخطة غير موجودة'; end if;
  if not can_see_patient(v_patient) then raise exception 'ما فيه صلاحية على ملف هذا المريض' using errcode = '42501'; end if;
  return jsonb_build_object('total', v_total, 'attended', session_attended_count(p_source, p_id),
    'items', (select coalesce(jsonb_agg(jsonb_build_object('no', d.session_no, 'diagnosis', d.diagnosis, 'updatedAt', d.updated_at,
               'by', (select name from employees where id = coalesce(d.updated_by, d.created_by))) order by d.session_no), '[]')
              from session_diagnoses d where d.source = p_source and d.source_id = p_id));
end $$;

create or replace function session_diagnosis_save(p_source text, p_id uuid, p_session_no int, p_text text) returns void
language plpgsql security definer set search_path = public as $$
declare emp uuid; v_patient uuid; v_total int; v_att int; t text := btrim(coalesce(p_text, '')); ex session_diagnoses;
begin
  emp := require_perm('sessions', 'edit');
  if p_source = 'package' then select patient_id, total_sessions into v_patient, v_total from packages where id = p_id;
  elsif p_source = 'plan' then select patient_id, total_sessions into v_patient, v_total from treatment_plans where id = p_id;
  else raise exception 'مصدر غير صحيح'; end if;
  if v_patient is null then raise exception 'الباقة أو الخطة غير موجودة'; end if;
  if not can_see_patient(v_patient) then raise exception 'ما فيه صلاحية على ملف هذا المريض' using errcode = '42501'; end if;
  if p_session_no is null or p_session_no < 1 or p_session_no > v_total then raise exception 'رقم الجلسة غير صحيح'; end if;
  if t = '' then raise exception 'اكتب التشخيص'; end if;
  if length(t) > 1000 then raise exception 'التشخيص طويل (الحد 1000 حرف)'; end if;
  perform pg_advisory_xact_lock(hashtext('sd:' || p_id::text));
  v_att := session_attended_count(p_source, p_id);
  -- الجلسة الأولى في أي وقت؛ الجلسة N بعد تأكيد حضور الجلسة N-1
  if p_session_no > 1 and v_att < p_session_no - 1 then
    raise exception 'تشخيص الجلسة % بعد تأكيد حضور الجلسة % (المؤكَّد حتى الآن: %)', p_session_no, p_session_no - 1, v_att;
  end if;
  select * into ex from session_diagnoses where source = p_source and source_id = p_id and session_no = p_session_no;
  if ex.id is null then
    insert into session_diagnoses (source, source_id, patient_id, session_no, diagnosis, created_by, updated_by) values (p_source, p_id, v_patient, p_session_no, t, emp, emp);
    perform log_action('تشخيص الجلسة ' || p_session_no, v_patient);
  elsif ex.diagnosis is distinct from t then
    update session_diagnoses set diagnosis = t, updated_by = emp, updated_at = now() where id = ex.id;
    perform log_action('تعديل تشخيص الجلسة ' || p_session_no, v_patient);
  end if;
end $$;
revoke execute on function session_diagnoses_list(text, uuid), session_diagnosis_save(text, uuid, int, text) from public, anon;
grant execute on function session_diagnoses_list(text, uuid), session_diagnosis_save(text, uuid, int, text) to authenticated;
