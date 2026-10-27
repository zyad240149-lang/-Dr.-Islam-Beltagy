-- الاستقبال: فواتير ومدفوعات كاملة (عرض/إضافة/اعتماد ومراجعة وتعديل/حذف) زي المحاسب — طلب الإدارة 2026-10-08.
insert into role_permissions (role, area, ops) values ('reception', 'invoices', '{view,create,edit,delete}'), ('reception', 'payments', '{view,create,edit,delete}')
on conflict (role, area) do update set ops = excluded.ops;
-- السكرتير = اتحاد الاستقبال والمحاسب (104)
delete from role_permissions where role = 'secretary';
insert into role_permissions (role, area, ops)
select 'secretary', s.area, array(select o from unnest(array['view','create','edit','delete']) o where o in (select unnest(array_agg(s.o))))
from (select area, unnest(ops) o from role_permissions where role in ('reception','accountant') and area <> 'roles') s group by s.area;
