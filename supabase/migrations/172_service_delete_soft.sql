-- 172: حذف الخدمة فوري دايمًا (طلب المستخدم) — بدون رسالة «مربوطة بفواتير/مواعيد/دكتور».
-- الخدمة اللي ما عليها أي موعد أو خطة بتتمسح فعليًا. اللي عليها سجلات (مواعيد/خطط/فواتير) بتتخفي (deleted=true + موقوفة)
-- وبتفضل في القاعدة عشان اسمها يفضل ظاهر في المواعيد والفواتير القديمة (appointments/treatment_plans مربوطين بيها بقيد FK).
-- ارتباطها بالأطباء والباقات بيتشال تلقائيًا.
alter table services add column if not exists deleted boolean not null default false;

create or replace function delete_service(p_id text) returns void
language plpgsql security definer set search_path = public as $$
declare s services;
begin
  perform require_perm('services', 'delete');
  select * into s from services where id = p_id;
  if s.id is null then raise exception 'الخدمة غير موجودة'; end if;
  update package_plans set service_ids = array_remove(service_ids, p_id) where p_id = any(service_ids);
  delete from therapist_services where service_id = p_id;
  if exists (select 1 from appointments where service_id = p_id) or exists (select 1 from treatment_plans where service_id = p_id) then
    update services set deleted = true, active = false, show_on_site = false where id = p_id;
  else
    delete from services where id = p_id;
  end if;
  perform log_action('حذف خدمة: ' || s.name);
end $$;
revoke execute on function delete_service(text) from public, anon;
grant execute on function delete_service(text) to authenticated;
