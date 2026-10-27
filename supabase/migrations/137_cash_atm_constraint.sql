-- 137: «كاش / ATM» (cash_atm) كانت بتترفض عند التسجيل — هجرة 136 ضافتها لـ is_payment_method بس،
-- وقيود الجداول (CHECK) فضلت بالقائمة القديمة: «new row for relation "payments" violates check constraint "payments_method_check"».
-- القيم القديمة فاضلة في القيد عشان الدفعات القديمة؛ الطرق المسموحة للتسجيل الجديد لسه بيحددها is_payment_method.
alter table public.payments drop constraint if exists payments_method_check;
alter table public.payments add constraint payments_method_check check (method = any (array[
  'cash', 'mada', 'card', 'cash_atm', 'apple_pay', 'stc_pay', 'urpay', 'transfer', 'sadad', 'tabby', 'tamara', 'cheque', 'online', 'other']));

alter table public.product_sales drop constraint if exists product_sales_payment_method_check;
alter table public.product_sales add constraint product_sales_payment_method_check check (payment_method = any (array[
  'cash', 'mada', 'card', 'cash_atm', 'apple_pay', 'stc_pay', 'urpay', 'transfer', 'sadad', 'tabby', 'tamara', 'cheque', 'online', 'other']));

alter table public.expenses drop constraint if exists expenses_payment_method_check;
alter table public.expenses add constraint expenses_payment_method_check check (payment_method = any (array[
  'cash', 'mada', 'card', 'cash_atm', 'apple_pay', 'stc_pay', 'urpay', 'transfer', 'sadad', 'tabby', 'tamara', 'cheque', 'online', 'other']));
