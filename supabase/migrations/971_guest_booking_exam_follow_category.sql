-- ١٢/١١: الحجز الأونلاين من الصفحة الرئيسية = كل خدمات قسم «كشف ومتابعة» (طلب العيادة) — مش بالاسم بس.
-- خدمات القسم بتتعلّم «تظهر على الموقع» عشان trigger الحجز الأونلاين (170) مايرفضهاش.
update public.services set show_on_site = true where active and category = 'كشف ومتابعة' and not show_on_site;

create or replace function public.guest_booking_catalog()
returns jsonb
language sql stable security definer set search_path to 'public' as $function$
  select jsonb_build_object(
    'services', coalesce((select jsonb_agg(jsonb_build_object('id', s.id, 'name', s.name, 'price', s.price, 'durationMin', s.duration_min,
        'doctorIds', coalesce((select jsonb_agg(ts.therapist_id) from therapist_services ts join therapists t on t.id = ts.therapist_id and t.active where ts.service_id = s.id), '[]'))
        order by s.name)
      from services s where s.active and s.show_on_site and (s.category = 'كشف ومتابعة' or s.name like '%كشف%' or s.name like '%متابع%')), '[]'),
    'doctors', coalesce((select jsonb_agg(jsonb_build_object('id', t.id, 'name', t.name,
        'serviceIds', coalesce((select jsonb_agg(ts.service_id) from therapist_services ts where ts.therapist_id = t.id), '[]')) order by t.name)
      from therapists t where t.active), '[]'))
$function$;

create or replace function public.guest_day_slots(p_therapist uuid, p_service text, p_date date)
returns jsonb
language plpgsql stable security definer set search_path to 'public' as $function$
begin
  if not exists (select 1 from services s where s.id = p_service and s.active and s.show_on_site and (s.category = 'كشف ومتابعة' or s.name like '%كشف%' or s.name like '%متابع%')) then
    return jsonb_build_object('status', 'not_offered', 'slots', '[]'::jsonb);
  end if;
  return doctor_day_slots(p_therapist, p_service, p_date);
end $function$;

-- guest_book: نفس الدالة (970) بس شرط الخدمة بقى القسم كمان
do $$
declare src text;
begin
  select pg_get_functiondef('public.guest_book(jsonb)'::regprocedure) into src;
  src := replace(src, $q$if svc.name not like '%كشف%' and svc.name not like '%متابع%' then$q$, $q$if coalesce(svc.category, '') <> 'كشف ومتابعة' and svc.name not like '%كشف%' and svc.name not like '%متابع%' then$q$);
  execute src;
end $$;
