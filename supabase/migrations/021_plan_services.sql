-- قائمة "خدمات خطط العلاج" — منفصلة تمامًا عن كتالوج الخدمات/الأسعار الرسمي (services)، بدون أي تأثير عليه.
-- تُستخدم فقط كقائمة اختيار لحقل "نوع العلاج" الحالي في نموذج الخطة العلاجية (treatment_plans.therapy_type نص حر أصلاً، بدون أي تغيير في الجدول).
create table if not exists plan_services (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  active boolean not null default true,
  created_at timestamptz not null default now()
);
alter table plan_services enable row level security;
drop policy if exists staff_read on plan_services;
create policy staff_read on plan_services for select using (is_staff());
revoke insert, update, delete on plan_services from authenticated;

create or replace function save_plan_service(p jsonb) returns jsonb
language plpgsql security definer set search_path = public as $$
declare v uuid := nullif(p->>'id', '')::uuid;
begin
  perform require_perm('plans', case when v is null then 'create' else 'edit' end);
  if trim(coalesce(p->>'name', '')) = '' then raise exception 'اسم الخدمة مطلوب'; end if;
  if v is not null then
    update plan_services set name = trim(p->>'name'), active = coalesce((p->>'active')::boolean, true) where id = v;
  else
    insert into plan_services (name) values (trim(p->>'name')) returning id into v;
  end if;
  perform log_action('حفظ خدمة خطة علاج: ' || trim(p->>'name'));
  return jsonb_build_object('id', v);
end $$;

create or replace function hide_plan_service(p_id uuid) returns void
language plpgsql security definer set search_path = public as $$
begin
  perform require_perm('plans', 'delete');
  update plan_services set active = false where id = p_id;
  perform log_action('إيقاف خدمة خطة علاج');
end $$;

revoke execute on function save_plan_service(jsonb), hide_plan_service(uuid) from public, anon;
grant execute on function save_plan_service(jsonb), hide_plan_service(uuid) to authenticated;
