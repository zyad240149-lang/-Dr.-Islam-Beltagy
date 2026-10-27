-- 009 — إعادة تثبيت صلاحيات التنفيذ (تُشغَّل آخر مرة دائمًا بعد أي دوال جديدة)
revoke execute on all functions in schema public from public, anon;
grant execute on all functions in schema public to authenticated;
revoke execute on function recalc_invoice(uuid), new_invoice(uuid, text, numeric, text, date, uuid, uuid, uuid, text), recalc_plan(uuid),
  check_slot(uuid, date, text, int, uuid), notify_staff(text, text, text, text, text, uuid), notify_patient(uuid, text, text, text, text),
  log_action(text, uuid), next_counter(text, text, int), effective_price(text, uuid, uuid), register_customer(uuid, text, text, text) from authenticated;
-- الزائر (بدون تسجيل دخول) يقرأ الكتالوج العام والأوقات المحجوزة فقط
grant execute on function public_catalog(), busy_slots(uuid, date) to anon;
grant execute on function register_customer(uuid, text, text, text) to service_role;
