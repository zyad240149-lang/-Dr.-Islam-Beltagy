-- 170: الخدمة لها تفعيلان — «مفعّلة» (تشتغل في الإدارة) و«تظهر في الموقع» (الموقع العام + بوابة المريض).
-- مفعّلة + مش ظاهرة في الموقع = للإدارة بس. الافتراضي ظاهرة (زي ما كان).
alter table services add column if not exists show_on_site boolean not null default true;

create or replace function save_service(p jsonb) returns jsonb
language plpgsql security definer set search_path = public as $$
declare v text := nullif(p->>'id', ''); is_new boolean := v is null or not exists (select 1 from services where id = nullif(p->>'id', ''));
begin
  perform require_perm('services', case when is_new then 'create' else 'edit' end);
  if length(_txt(p, 'name')) < 2 then raise exception 'اسم الخدمة مطلوب'; end if;
  if _num(p, 'price', -1) < 0 then raise exception 'السعر غير صحيح'; end if;
  if _num(p, 'durationMin', 0) < 5 then raise exception 'مدة الخدمة غير صحيحة'; end if;
  if is_new then
    v := coalesce(v, 'sv_' || substr(replace(gen_random_uuid()::text, '-', ''), 1, 8));
    insert into services (id, name, category, description, price, duration_min, active, show_on_site, branch_id)
    values (v, _txt(p, 'name'), _txt(p, 'category'), _txt(p, 'description'), _num(p, 'price'), _num(p, 'durationMin')::int,
            coalesce((p->>'active')::boolean, true), coalesce((p->>'showOnSite')::boolean, true), _uuid(p, 'branchId'));
  else
    update services set name = _txt(p, 'name'), category = _txt(p, 'category'), description = _txt(p, 'description'), price = _num(p, 'price'),
      duration_min = _num(p, 'durationMin')::int, active = coalesce((p->>'active')::boolean, active),
      show_on_site = coalesce((p->>'showOnSite')::boolean, show_on_site), branch_id = _uuid(p, 'branchId')
    where id = v;
  end if;
  if p ? 'therapistIds' then
    delete from therapist_services where service_id = v;
    insert into therapist_services (therapist_id, service_id)
    select t::uuid, v from jsonb_array_elements_text(p->'therapistIds') t where exists (select 1 from therapists where id = t::uuid);
  end if;
  perform log_action(case when is_new then 'إضافة' else 'تعديل' end || ' خدمة: ' || _txt(p, 'name') || ' — ' || _num(p, 'price') || ' ر.س');
  return jsonb_build_object('id', v);
end $$;

-- الكتالوج العام: المفعّلة + الظاهرة في الموقع بس
create or replace function public_catalog() returns jsonb
language sql stable security definer set search_path = public as $$
  select jsonb_build_object(
    'center', (select jsonb_build_object('name', name, 'phone', phone, 'email', email, 'city', city, 'district', district, 'street', street,
        'currency', currency, 'weekSchedule', week_schedule, 'slotStep', slot_step_min, 'cancelBeforeHours', cancel_before_hours) from center_info limit 1),
    'services', coalesce((select jsonb_agg(jsonb_build_object('id', s.id, 'name', s.name, 'category', s.category, 'description', s.description,
        'price', s.price, 'durationMin', s.duration_min,
        'prices', coalesce((select jsonb_agg(jsonb_build_object('id', sp.id, 'label', sp.label, 'price', sp.price) order by sp.price)
                            from service_prices sp where sp.service_id = s.id and sp.active and sp.therapist_id is null), '[]'),
        'doctorIds', coalesce((select jsonb_agg(ts.therapist_id) from therapist_services ts join therapists t on t.id = ts.therapist_id and t.active where ts.service_id = s.id), '[]'))
        order by s.category, s.name) from services s where s.active and s.show_on_site), '[]'),
    'doctors', coalesce((select jsonb_agg(jsonb_build_object('id', t.id, 'name', t.name, 'title', t.title, 'bio', t.bio, 'photo', t.photo, 'photoUrl', t.photo_url,
        'workHours', t.work_hours, 'defaultDurationMin', t.default_duration_min,
        'serviceIds', coalesce((select jsonb_agg(ts.service_id) from therapist_services ts where ts.therapist_id = t.id), '[]')) order by t.name)
        from therapists t where t.active), '[]')
  )
$$;

-- حجز المريض أونلاين لخدمة مش ظاهرة في الموقع مرفوض من الخادم (مش بس مخفية من الواجهة)
create or replace function public.trg_online_service_visible() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if new.source = 'online' and exists (select 1 from services s where s.id = new.service_id and not s.show_on_site) then
    raise exception 'هذه الخدمة غير متاحة للحجز عبر الموقع — تواصل مع المركز';
  end if;
  return new;
end $$;
drop trigger if exists appointments_online_service_visible on appointments;
create trigger appointments_online_service_visible before insert on appointments
  for each row execute function public.trg_online_service_visible();
