-- أرقام الإجماليات (يوم/أسبوع/شهر/سنة: الإيرادات والمستحق والتقارير المالية) للمدير بس (طلب الإدارة 2026-10-09).
delete from role_permissions where area = 'financial' and role not in ('system_admin', 'center_manager');
