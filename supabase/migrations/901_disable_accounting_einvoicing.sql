-- 901: النظام المحاسبي والفوترة الإلكترونية اتشالوا من الواجهة بطلب العيادة —
-- نوقف كمان كل أثرهم التلقائي في القاعدة (قيود محاسبية مع كل فاتورة/دفعة/راتب/بيع، وحراسة فواتير هيئة الزكاة).
-- الجداول نفسها بتفضل موجودة (فاضية) عشان أي دالة قديمة تشير لها ماتقعش.
drop trigger if exists trg_acc_invoice on invoices;
drop trigger if exists trg_acc_payment on payments;
drop trigger if exists trg_acc_payroll_due on payroll_dues;
drop trigger if exists trg_acc_payroll_payout on payroll_payouts;
drop trigger if exists trg_acc_product_sale on product_sales;
drop trigger if exists trg_zatca_guard_items on invoice_items;
drop trigger if exists trg_zatca_guard_invoice on invoices;
drop trigger if exists trg_zatca_on_cancel on invoices;
drop trigger if exists trg_zatca_on_sale_cancel on product_sales;

-- القيود اللي اتسجلت قبل الإيقاف (بيانات اختبار فقط — القاعدة كانت جديدة)
truncate acc_journal_lines, acc_journals, acc_audit, acc_depreciation;
