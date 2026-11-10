-- 968: employee_login_stats / employee_logins كانوا بيقروا audit_logs كله (≈200MB، seq scan 2.5–7 ثواني)
-- ← تحت الضغط بيعدّوا statement_timeout (8s) والشاشة بتاخد 500 (شاشة الموظفين في /finance و/payroll). index جزئي على صفوف الدخول بس.
create index if not exists idx_audit_login_emp on public.audit_logs (employee_id, at desc) where action = 'login' and employee_id is not null;
