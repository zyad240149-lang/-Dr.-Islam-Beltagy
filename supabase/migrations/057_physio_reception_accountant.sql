-- العلاج الطبيعي متاح للاستقبال والمحاسب (بطلب الإدارة) بنفس صلاحيات المعالج: اطلاع/إضافة/تعديل — الحذف للمدير فقط
insert into role_permissions (role, area, ops) values
  ('reception', 'physio', '{view,create,edit}'),
  ('accountant', 'physio', '{view,create,edit}')
on conflict (role, area) do update set ops = excluded.ops;
