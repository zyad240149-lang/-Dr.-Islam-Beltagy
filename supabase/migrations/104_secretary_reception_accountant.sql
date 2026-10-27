-- صلاحيات «سكرتير المدير» = استقبال + محاسب مع بعض (اتحاد الاتنين) — طلب الإدارة 2026-10-08. (قسم roles للمدير العام بس)
delete from role_permissions where role = 'secretary';
insert into role_permissions (role, area, ops)
select 'secretary', s.area, array(select o from unnest(array['view','create','edit','delete']) o where o in (select unnest(array_agg(s.o))))
from (select area, unnest(ops) o from role_permissions where role in ('reception','accountant') and area <> 'roles') s
group by s.area;
