-- تخصيص خدمة لدكتور/أطباء معيّنين (2026-10-21): therapist_services هو الربط الفعلي (الحجز والموقع وبوابة المريض كلهم بيعتمدوا عليه).
-- doctors_only = الخدمة مخصصة لأطباء معيّنين → الطبيب الجديد ما ينربط بيها تلقائيًا (الخدمة الجديدة لسه بتنربط بكل الأطباء).
alter table services add column if not exists doctors_only boolean not null default false;
update services s set doctors_only = (select count(*) from therapists) > (select count(*) from therapist_services ts where ts.service_id = s.id);

create or replace function fill_therapist_services() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if tg_table_name = 'therapists' then
    insert into therapist_services (therapist_id, service_id) select new.id, s.id from services s where not s.doctors_only on conflict do nothing;
  else
    insert into therapist_services (therapist_id, service_id) select t.id, new.id from therapists t on conflict do nothing;
  end if;
  return null;
end $$;

create or replace function set_service_doctors(p_service text, p_therapists jsonb) returns jsonb
language plpgsql security definer set search_path = public as $$
declare ids uuid[]; n int; total int; nm text;
begin
  perform require_perm('services', 'edit');
  select name into nm from services where id = p_service;
  if nm is null then raise exception 'الخدمة غير موجودة'; end if;
  select coalesce(array_agg(distinct t::uuid), '{}') into ids from jsonb_array_elements_text(coalesce(p_therapists, '[]'::jsonb)) t
    where exists (select 1 from therapists where id = t::uuid);
  n := cardinality(ids);
  if n = 0 then raise exception 'اختر دكتور واحد على الأقل للخدمة'; end if;
  select count(*) into total from therapists;
  delete from therapist_services where service_id = p_service;
  insert into therapist_services (therapist_id, service_id) select unnest(ids), p_service;
  update services set doctors_only = n < total where id = p_service;
  perform log_action('تخصيص الخدمة «' || nm || '» ' || case when n < total then 'لـ ' || n || ' من ' || total || ' أطباء' else 'لكل الأطباء' end);
  return jsonb_build_object('count', n, 'all', n >= total);
end $$;
revoke execute on function set_service_doctors(text, jsonb) from public, anon;
grant execute on function set_service_doctors(text, jsonb) to authenticated;
