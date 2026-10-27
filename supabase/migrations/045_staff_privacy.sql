-- خصوصية بيانات الموظفين: كل موظف بيشوف بياناته هو بس (الحضور، طلبات الإجازة/الاستئذان، ملفه).
-- اللي بيشوف بيانات الفريق كله: مسؤول النظام ومدير المركز بس.

-- 1) تقرير حضور الفريق: السكرتير كان عنده attendance:edit فكان بيشوف حضور الكل — بقى حضوره هو بس
update role_permissions set ops = '{view}' where area = 'attendance' and role not in ('system_admin', 'center_manager');
-- طلبات الموظفين: القبول/الرفض ورؤية طلبات الكل للمدير بس (حماية لو حد اتدّاله edit بالغلط)
update role_permissions set ops = array(select unnest(ops) except select 'edit') where area = 'requests' and role not in ('system_admin', 'center_manager');

-- 2) جدول الموظفين: كان أي موظف يقدر يقرا بيانات كل الموظفين (الجوال، الدور، ساعات العمل...)
drop policy if exists staff_read on employees;
create policy staff_read on employees for select using (id = my_employee_id() or has_perm('employees', 'view'));

-- الأسماء بس (من غير جوال ولا بيانات تانية) عشان الواجهة تعرض «أنشأها / المعالج / منفّذ العملية»
create or replace function staff_directory() returns table (id uuid, name text, role text, active boolean, therapist_id uuid)
language sql stable security definer set search_path = public as $$
  select e.id, e.name, e.role, e.active, e.therapist_id from employees e where is_staff()
$$;
revoke execute on function staff_directory() from public, anon;
grant execute on function staff_directory() to authenticated;
