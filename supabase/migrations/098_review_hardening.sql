-- مراجعة السيستم (2026-10-08) — ملاحظات Supabase Security/Performance Advisor
-- 1) دوال اتضافت بعد 058 بقت قابلة للاستدعاء من الزائر (anon) — Supabase بيدي anon صلاحية على أي دالة جديدة،
--    و058 كانت بتشيل الصلاحية من public بس. الزائر المفروض يوصل لـ public_catalog / busy_slots / doctor_day_slots
--    واشتراك إشعارات الموقع بس.
do $$ declare f text; begin
  foreach f in array array[
    'appointments_day_lock()', 'appointments_no_overlap()', 'appointments_require_doctor()',
    'invoices_set_tax_rate()', 'invoices_sync_appointment_price()', 'patients_after_promote()', 'patients_nationality_tax()',
    'center_busy_slots(date)'
  ] loop
    if to_regprocedure('public.' || f) is not null then
      execute format('revoke execute on function public.%s from public, anon', f);
    end if;
  end loop;
end $$;
-- أي دالة جديدة بعد كده: مش للزائر افتراضيًا (058 كانت بتشيلها من public بس)
alter default privileges in schema public revoke execute on functions from anon;

-- 2) search_path ثابت (زي باقي الدوال من 058)
alter function public.appointments_require_doctor() set search_path = public;

-- 3) فهرس للمفتاح الأجنبي الناقص
create index if not exists package_checkins_checked_in_by_idx on package_checkins (checked_in_by);
