-- الاستقبال يشوف كل الأقسام (اطلاع) ماعدا «البيانات المالية» (financial = الإيرادات والإجماليات المالية) — طلب الإدارة 2026-10-08.
-- صلاحياته الحالية (إضافة/تعديل) ماتتغيّرش؛ بنضيف view بس لأي قسم ناقص. ماحدش بيشوف رواتب (مفيش حقل راتب في النظام أصلًا).
insert into role_permissions (role, area, ops)
select 'reception', a, '{view}' from unnest(array['dashboard','patients','booking','appointments','plans','sessions','services','therapists','employees','invoices','payments','packages','inventory','reports','notifications','roles','settings','workhours','requests','support','discounts','campaigns','attendance','loyalty','products','installments','physio']) a
on conflict (role, area) do update set ops = (select array(select distinct o from unnest(role_permissions.ops || '{view}') o order by o desc));
update role_permissions set ops = array(select o from unnest(array['view','create','edit','delete']) o where o = any(ops)) where role = 'reception';
delete from role_permissions where role = 'reception' and area = 'financial';
