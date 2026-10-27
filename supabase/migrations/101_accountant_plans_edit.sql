-- المحاسب يعدّل الخطط العلاجية (طلب الإدارة 2026-10-08). الاستقبال والمعالج شايفين «خطط العلاج» أصلًا (view).
update role_permissions set ops = '{view,create,edit}' where role = 'accountant' and area = 'plans';
