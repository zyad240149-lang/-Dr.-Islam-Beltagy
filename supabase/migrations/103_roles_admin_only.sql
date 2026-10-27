-- «الأدوار والصلاحيات» للمدير العام (system_admin) بس (طلب الإدارة 2026-10-08).
-- 102 كانت ضايفة view للاستقبال — اتشالت. وsave_permissions بقت تتجاهل قسم roles لأي دور تاني، فمستحيل يتمنح بالغلط من المصفوفة.
delete from role_permissions where area = 'roles' and role <> 'system_admin';
create or replace function save_permissions(p_matrix jsonb) returns void
language plpgsql security definer set search_path = public as $function$
declare r text; a text;
begin
  perform require_perm('roles', 'edit');
  if not exists (select 1 from employees e where e.auth_user_id = auth.uid() and e.role = 'system_admin') then
    raise exception 'تعديل الأدوار والصلاحيات للمدير العام فقط' using errcode = '42501'; end if;
  for r in select jsonb_object_keys(p_matrix) loop
    continue when r = 'system_admin';
    if r not in ('center_manager','secretary','therapist','reception','accountant') then raise exception 'دور غير معروف: %', r; end if;
    delete from role_permissions where role = r;
    for a in select jsonb_object_keys(p_matrix->r) loop
      continue when a = 'roles';
      insert into role_permissions (role, area, ops)
      select r, a, coalesce(array_agg(o) filter (where o in ('view','create','edit','delete')), '{}')
      from jsonb_array_elements_text(p_matrix->r->a) o;
    end loop;
  end loop;
  perform log_action('تعديل مصفوفة الصلاحيات');
end $function$;
