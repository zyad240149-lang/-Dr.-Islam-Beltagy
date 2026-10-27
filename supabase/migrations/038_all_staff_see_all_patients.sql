-- كل الموظفين (بما فيهم المعالج) بيشوفوا كل المرضى — طلب المستخدم: المريض يتضاف مرة واحدة ويظهر لكل المناصب.
-- الصلاحيات حسب القسم (has_perm) لسه شغالة زي ما هي؛ اللي اتشال بس هو قصر المعالج على مرضاه.
create or replace function can_see_patient(p_patient uuid) returns boolean
language sql stable security definer set search_path = public as $$
  select is_staff()
$$;
