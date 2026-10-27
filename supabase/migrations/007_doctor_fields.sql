-- 007 — حفظ بيانات الطبيب الكاملة (بريد، نبذة، صورة، مدة الموعد الافتراضية) + استراحة ساعات العمل

create or replace function save_therapist(p jsonb) returns jsonb
language plpgsql security definer set search_path = public as $$
declare v uuid := _uuid(p, 'id'); w jsonb; is_new boolean := _uuid(p, 'id') is null;
begin
  perform require_perm('therapists', case when v is null then 'create' else 'edit' end);
  if length(_txt(p, 'name')) < 2 then raise exception 'اسم المعالج مطلوب'; end if;
  if _txt(p, 'email') <> '' and _txt(p, 'email') !~ '^[^@\s]+@[^@\s]+\.[^@\s]+$' then raise exception 'البريد الإلكتروني غير صحيح'; end if;
  if _num(p, 'defaultDurationMin', 30) not between 5 and 240 then raise exception 'مدة الموعد الافتراضية بين 5 و240 دقيقة'; end if;
  for w in select * from jsonb_array_elements(coalesce(p->'workHours', '[]')) loop
    if (w->>'from') >= (w->>'to') then raise exception 'وقت بداية الدوام يجب أن يسبق نهايته'; end if;
    if coalesce(w->>'breakFrom', '') <> '' or coalesce(w->>'breakTo', '') <> '' then
      if coalesce(w->>'breakFrom', '') = '' or coalesce(w->>'breakTo', '') = '' or (w->>'breakFrom') >= (w->>'breakTo')
         or (w->>'breakFrom') < (w->>'from') or (w->>'breakTo') > (w->>'to') then
        raise exception 'فترة الاستراحة يجب أن تكون داخل ساعات الدوام (البداية قبل النهاية)';
      end if;
    end if;
  end loop;
  if v is null then
    insert into therapists (name, title, phone, photo, work_hours, on_leave, active, branch_id, email, bio, photo_url, default_duration_min)
    values (_txt(p, 'name'), _txt(p, 'title'), _txt(p, 'phone'), _txt(p, 'photo'), coalesce(p->'workHours', '[]'), coalesce(p->'onLeave', '[]'),
            coalesce((p->>'active')::boolean, true), coalesce(_uuid(p, 'branchId'), (select id from branches order by created_at limit 1)),
            _txt(p, 'email'), _txt(p, 'bio'), _txt(p, 'photoUrl'), _num(p, 'defaultDurationMin', 30)::int)
    returning id into v;
  else
    update therapists set name = _txt(p, 'name'), title = _txt(p, 'title'), phone = _txt(p, 'phone'), photo = _txt(p, 'photo', photo),
      work_hours = coalesce(p->'workHours', work_hours), on_leave = coalesce(p->'onLeave', on_leave),
      active = coalesce((p->>'active')::boolean, active), branch_id = coalesce(_uuid(p, 'branchId'), branch_id),
      email = case when p ? 'email' then _txt(p, 'email') else email end, bio = case when p ? 'bio' then _txt(p, 'bio') else bio end,
      photo_url = case when p ? 'photoUrl' then _txt(p, 'photoUrl') else photo_url end,
      default_duration_min = case when p ? 'defaultDurationMin' then _num(p, 'defaultDurationMin', 30)::int else default_duration_min end
    where id = v;
    if not found then raise exception 'المعالج غير موجود'; end if;
  end if;
  if p ? 'serviceIds' then
    delete from therapist_services where therapist_id = v;
    insert into therapist_services (therapist_id, service_id)
    select v, s from jsonb_array_elements_text(p->'serviceIds') s where exists (select 1 from services where id = s);
  end if;
  perform log_action(case when is_new then 'إضافة' else 'تعديل' end || ' معالج: ' || _txt(p, 'name'));
  return jsonb_build_object('id', v);
end $$;

grant execute on function save_therapist(jsonb) to authenticated;
