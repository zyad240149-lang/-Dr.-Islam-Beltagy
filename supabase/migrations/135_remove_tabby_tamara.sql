-- 135: إلغاء الدفع بتابي وتمارا (طلب الإدارة 2026-10-14) — مفيش دفعات جديدة بيهم. مفيش ولا دفعة قديمة بيهم وقت التطبيق.
create or replace function public.is_payment_method(p text) returns boolean
language sql immutable set search_path = public as $function$
  select p in ('cash', 'mada', 'card', 'apple_pay', 'stc_pay', 'urpay', 'transfer', 'sadad', 'cheque', 'online', 'other')
$function$;
