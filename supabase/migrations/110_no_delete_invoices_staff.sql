-- حذف الفواتير والمواعيد للمدير العام ومدير المركز بس (طلب الإدارة 2026-10-09). باقي الأدوار: إلغاء بسبب فقط (لو عندها صلاحية الإلغاء).
update role_permissions set ops = array_remove(ops, 'delete') where area in ('invoices','appointments','booking') and role not in ('system_admin','center_manager');
