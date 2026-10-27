-- 149: «تصدير ملف المرضى (Excel)» بقى صلاحية مستقلة `patient_export` (كانت مخفية بشرط الدور في الكود) — بتظهر في «الأدوار والصلاحيات».
-- الافتراضي: المدير العام ومدير المركز بس (اطلاع). أي دور تاني بيتفعّل له من شاشة الصلاحيات.
insert into role_permissions (role, area, ops) values
  ('system_admin', 'patient_export', array['view']),
  ('center_manager', 'patient_export', array['view'])
on conflict (role, area) do update set ops = excluded.ops;
