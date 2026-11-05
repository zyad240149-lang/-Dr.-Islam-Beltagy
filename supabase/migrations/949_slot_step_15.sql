-- 949: كل المواعيد ربع ساعة — مفيش مدة لكل خدمة. خانات الحجز كل 15 دقيقة وأي موعد جديد أو متعدل وقته = 15 دقيقة
-- من أي طريق (الاستقبال، البوابة، الأوفلاين، الخطط، المتابعات). المواعيد القديمة بتفضل زي ما هي لحد ما وقتها يتعدل.
update public.center_info set slot_step_min = 15, default_appointment_min = 15;
alter table public.services alter column duration_min set default 15;
update public.services set duration_min = 15 where duration_min is distinct from 15;
update public.therapists set default_duration_min = 15 where default_duration_min is distinct from 15;

create or replace function public.force_15_min_duration()
 returns trigger language plpgsql set search_path to 'public'
as $$ begin new.duration_min := 15; return new; end $$;

drop trigger if exists a00_services_15_min on public.services;
create trigger a00_services_15_min before insert or update of duration_min on public.services
  for each row execute function public.force_15_min_duration();

-- الاسم بيبدأ بـ a00 عشان يشتغل قبل تريجر منع التداخل (تريجرات BEFORE بتشتغل بالترتيب الأبجدي)
drop trigger if exists a00_appointments_15_min on public.appointments;
create trigger a00_appointments_15_min before insert or update of date, time, duration_min on public.appointments
  for each row execute function public.force_15_min_duration();

-- المواعيد الجاية القائمة كمان تبقى ربع ساعة
update public.appointments set duration_min = 15 where date >= current_date and status <> 'cancelled' and duration_min <> 15;
