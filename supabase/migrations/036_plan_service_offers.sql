-- أسعار خدمات خطط العلاج حسب عدد الجلسات (مثلًا 4 جلسات / 6 جلسات) — تظهر كاختيارات جاهزة في نموذج الخطة العلاجية.
-- offers = [{ "sessions": 4, "price": 796 }, ...]
alter table plan_services add column if not exists offers jsonb not null default '[]'::jsonb;

create or replace function save_plan_service(p jsonb) returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  v uuid := nullif(p->>'id', '')::uuid;
  o jsonb := coalesce(p->'offers', '[]'::jsonb);
  e jsonb;
begin
  perform require_perm('plans', case when v is null then 'create' else 'edit' end);
  if trim(coalesce(p->>'name', '')) = '' then raise exception 'اسم الخدمة مطلوب'; end if;
  if jsonb_typeof(o) <> 'array' then raise exception 'صيغة الأسعار غير صحيحة'; end if;
  for e in select * from jsonb_array_elements(o) loop
    if coalesce((e->>'sessions')::int, 0) < 1 then raise exception 'عدد الجلسات يجب أن يكون 1 على الأقل'; end if;
    if coalesce((e->>'price')::numeric, -1) < 0 then raise exception 'السعر لا يمكن أن يكون سالبًا'; end if;
  end loop;
  if (select count(distinct (x->>'sessions')::int) from jsonb_array_elements(o) x) <> jsonb_array_length(o) then
    raise exception 'لا يمكن تكرار نفس عدد الجلسات مرتين';
  end if;
  o := coalesce((select jsonb_agg(jsonb_build_object('sessions', (x->>'sessions')::int, 'price', (x->>'price')::numeric) order by (x->>'sessions')::int)
                 from jsonb_array_elements(o) x), '[]'::jsonb);
  if v is not null then
    update plan_services set name = trim(p->>'name'), active = coalesce((p->>'active')::boolean, true), offers = o where id = v;
    if not found then raise exception 'الخدمة غير موجودة'; end if;
  else
    insert into plan_services (name, offers) values (trim(p->>'name'), o) returning id into v;
  end if;
  perform log_action('حفظ خدمة خطة علاج: ' || trim(p->>'name'));
  return jsonb_build_object('id', v);
end $$;

-- حذف فعلي (الخطط القديمة بتحفظ اسم نوع العلاج كنص، فمش بتتأثر)
create or replace function delete_plan_service(p_id uuid) returns void
language plpgsql security definer set search_path = public as $$
declare n text;
begin
  perform require_perm('plans', 'delete');
  delete from plan_services where id = p_id returning name into n;
  if n is null then raise exception 'الخدمة غير موجودة'; end if;
  perform log_action('حذف خدمة خطة علاج: ' || n);
end $$;

revoke execute on function save_plan_service(jsonb), delete_plan_service(uuid) from public, anon;
grant execute on function save_plan_service(jsonb), delete_plan_service(uuid) to authenticated;
