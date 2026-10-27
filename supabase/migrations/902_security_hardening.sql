-- 902: تقوية أمنية بعد فحص Supabase Security Advisor
-- مفيش موقع عام للحجز في هذا المشروع، فالدوال اللي كانت متاحة للزائر بدون دخول (anon) تتقفل عليه.
-- المستخدم المسجّل (authenticated) بيفضل يقدر يستخدم اللي يخصه منها (بوابة المريض).
revoke execute on function public.busy_slots(uuid, date) from anon, public;
revoke execute on function public.doctor_day_slots(uuid, text, date) from anon, public;
revoke execute on function public.public_catalog() from anon, public;
revoke execute on function public.save_site_push_subscription(text, text, text, text) from anon, public;
revoke execute on function public.delete_site_push_subscription(text) from anon, public;
revoke execute on function public.trg_online_service_visible() from anon, authenticated, public;
grant execute on function public.busy_slots(uuid, date) to authenticated;
grant execute on function public.doctor_day_slots(uuid, text, date) to authenticated;
grant execute on function public.public_catalog() to authenticated;

-- search_path ثابت لدالة التحديث التلقائي في جداول العظام
alter function public.ortho_touch() set search_path = public;
