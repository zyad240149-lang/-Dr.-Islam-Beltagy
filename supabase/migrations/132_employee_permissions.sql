-- 132: صلاحيات لموظف محدد (من «الأدوار والصلاحيات» ← اختيار الموظف) — بتحل محل صلاحيات دوره في الأقسام اللي اتحددت له.
-- employees.perm_override = {area: [ops]}: القسم الموجود فيه = صلاحيات الموظف ده بالظبط (إضافة أو منع)، والقسم الغايب = صلاحيات الدور.
-- المدير العام دايمًا كل الصلاحيات. الصلاحيات الإضافية القديمة (extra_perms) لسه شغالة فوق الاتنين.
alter table employees add column if not exists perm_override jsonb;

create or replace function public.has_perm(p_area text, p_op text) returns boolean
language sql stable security definer set search_path to 'public' as $function$
  select exists (
    select 1 from employees e
    where e.auth_user_id = auth.uid() and e.active and not is_on_leave(e.id)
      and (e.role = 'system_admin'
        or (case when e.perm_override ? p_area then (e.perm_override -> p_area) ? p_op
                 else exists (select 1 from role_permissions rp where rp.role = e.role and rp.area = p_area and p_op = any(rp.ops)) end)
        or coalesce(e.extra_perms -> p_area, '[]'::jsonb) ? p_op)
  )
$function$;

create or replace function set_employee_permissions(p_employee uuid, p_matrix jsonb) returns void
language plpgsql security definer set search_path = public as $$
declare emp employees; clean jsonb := '{}'::jsonb; a text;
begin
  perform require_perm('roles', 'edit');
  if not exists (select 1 from employees e where e.auth_user_id = auth.uid() and e.role = 'system_admin') then
    raise exception 'تخصيص صلاحيات الموظفين للمدير العام فقط' using errcode = '42501'; end if;
  select * into emp from employees where id = p_employee for update;
  if emp.id is null then raise exception 'الموظف غير موجود'; end if;
  if emp.role = 'system_admin' then raise exception 'المدير العام عنده كل الصلاحيات دايمًا'; end if;
  if p_matrix is not null then
    if jsonb_typeof(p_matrix) <> 'object' then raise exception 'صيغة الصلاحيات غير صحيحة'; end if;
    for a in select jsonb_object_keys(p_matrix) loop
      continue when a in ('roles', 'payroll');
      clean := clean || jsonb_build_object(a, coalesce((select jsonb_agg(distinct o) from jsonb_array_elements_text(p_matrix -> a) o where o in ('view','create','edit','delete')), '[]'::jsonb));
    end loop;
  end if;
  update employees set perm_override = case when p_matrix is null then null else clean end where id = emp.id;
  perform log_action(case when p_matrix is null then 'إرجاع صلاحيات الموظف لصلاحيات دوره — ' else 'تخصيص صلاحيات الموظف — ' end || emp.name);
end $$;
revoke execute on function set_employee_permissions(uuid, jsonb) from public, anon;
grant execute on function set_employee_permissions(uuid, jsonb) to authenticated;
