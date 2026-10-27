-- 136: طرق الدفع المعتمدة بس (طلب الإدارة 2026-10-14): ATM (mada) / تحويل (transfer) / كاش (cash) / Credit (card) / كاش + ATM (cash_atm).
-- الدفعات القديمة بطرق تانية فاضلة زي ما هي، لكن مفيش دفعة جديدة أو تعديل بطريقة غير دول.
create or replace function public.is_payment_method(p text) returns boolean
language sql immutable set search_path = public as $function$
  select p in ('mada', 'transfer', 'cash', 'card', 'cash_atm')
$function$;
