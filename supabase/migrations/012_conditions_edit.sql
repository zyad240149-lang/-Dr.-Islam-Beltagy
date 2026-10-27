-- تعديل/إضافة/إخفاء الحالات في «جسم الإنسان». الحذف "إخفاء" (active=false) لأن الخطط والتقييمات تشير للحالة بمفتاح أجنبي.
alter table conditions add column if not exists description text not null default '';
alter table conditions add column if not exists services text[] not null default '{}';
alter table conditions add column if not exists active boolean not null default true;

create or replace function save_condition(p jsonb) returns jsonb
language plpgsql security definer set search_path = public as $$
declare v text := nullif(trim(coalesce(p->>'id', '')), ''); ex conditions;
begin
  perform require_perm('plans', case when v is null then 'create' else 'edit' end);
  if trim(coalesce(p->>'name', '')) = '' or trim(coalesce(p->>'en', '')) = '' then raise exception 'اسم الحالة بالعربي والإنجليزي مطلوب'; end if;
  if trim(coalesce(p->>'icd10', '')) = '' then raise exception 'كود ICD-10 مطلوب'; end if;
  if v is null then
    if trim(coalesce(p->>'regionId', '')) = '' then raise exception 'حدد المنطقة'; end if;
    v := 'c_' || substr(replace(gen_random_uuid()::text, '-', ''), 1, 10);
  end if;
  select * into ex from conditions where id = v;
  insert into conditions (id, region_id, name_ar, name_en, icd10, tests, description, services, active)
  values (v, coalesce(ex.region_id, p->>'regionId'), trim(p->>'name'), trim(p->>'en'), trim(p->>'icd10'), trim(coalesce(p->>'tests', '')), trim(coalesce(p->>'desc', '')),
          coalesce(array(select jsonb_array_elements_text(coalesce(p->'services', '[]'::jsonb))), '{}'), true)
  on conflict (id) do update set name_ar = excluded.name_ar, name_en = excluded.name_en, icd10 = excluded.icd10, tests = excluded.tests,
    description = excluded.description, services = excluded.services, active = true;
  perform log_action(case when ex.id is null then 'إضافة' else 'تعديل' end || ' حالة تشخيص: ' || trim(p->>'en'));
  return jsonb_build_object('id', v);
end $$;

create or replace function hide_condition(p_id text) returns void
language plpgsql security definer set search_path = public as $$
declare c conditions;
begin
  perform require_perm('plans', 'delete');
  select * into c from conditions where id = p_id;
  if c.id is null then raise exception 'الحالة غير موجودة'; end if;
  update conditions set active = false where id = p_id;
  perform log_action('حذف حالة تشخيص: ' || c.name_en);
end $$;

revoke execute on function save_condition(jsonb), hide_condition(text) from public, anon;
grant execute on function save_condition(jsonb), hide_condition(text) to authenticated;
