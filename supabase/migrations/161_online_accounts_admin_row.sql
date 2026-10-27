-- 161: صف صلاحية «حسابات المرضى الأونلاين» للمدير العام كمان — الخادم بيعدّيه دايمًا، بس الواجهة بتقرا مصفوفة الدور من role_permissions
insert into role_permissions (role, area, ops)
select 'system_admin', 'online_accounts', array['view']
where not exists (select 1 from role_permissions where role = 'system_admin' and area = 'online_accounts');
