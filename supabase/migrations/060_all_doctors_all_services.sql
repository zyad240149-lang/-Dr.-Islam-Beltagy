-- كل الأطباء بيقدّموا كل الخدمات (طلب المستخدم 2026-09-30) — شيل ربط «المعالج ↔ الخدمة» من منطق الحجز نهائيًا.
-- قبل كده: الحجز/إعادة الجدولة/تغيير الخدمة كانوا بيرفضوا «المعالج لا يقدم هذه الخدمة» لو الربط ناقص، وحفظ خدمة أو معالج
-- كان بيمسح روابطه ويعيدها من القائمة اللي جاية من الشاشة — وده اللي خلّى خدمة «كشف» من غير أي طبيب فكانت بتترفض.
-- دلوقتي: مفيش تحقق من الربط، الكتالوج العام بيعرض كل الأطباء لكل خدمة، وجدول therapist_services بيفضل مليان للتوافق بس.

CREATE OR REPLACE FUNCTION public.book_appointment(p jsonb)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare svc services; pat patients; th uuid := _uuid(p, 'therapistId'); d date; tm text := _txt(p, 'time');
  loc text := _txt(p, 'location', 'center'); plan treatment_plans; pkg uuid := _uuid(p, 'packageId'); a appointments; v_price numeric;
begin
  perform require_any(array['booking:create', 'appointments:create']);
  select * into pat from patients where id = _uuid(p, 'patientId');
  if pat.id is null or not can_see_patient(pat.id) then raise exception 'اختر المريض'; end if;
  if not pat.active then raise exception 'ملف المريض غير نشط'; end if;
  select * into svc from services where id = _txt(p, 'serviceId');
  if svc.id is null or not svc.active then raise exception 'الخدمة غير موجودة أو موقوفة'; end if;
  if th is null then raise exception 'اختر المعالج'; end if;
  d := nullif(p->>'date', '')::date;
  if d is null then raise exception 'اختر التاريخ'; end if;
  if loc not in ('center','home') then raise exception 'مكان الموعد غير صحيح'; end if;
  if loc = 'home' and _txt(p, 'address') = '' then raise exception 'أدخل عنوان الزيارة المنزلية'; end if;
  perform check_slot(th, d, tm, svc.duration_min, null);
  v_price := effective_price(svc.id, th, _uuid(p, 'priceId'));

  if pkg is not null and not exists (select 1 from packages where id = pkg and patient_id = pat.id and status = 'active' and used_sessions < total_sessions) then
    raise exception 'الباقة غير صالحة لهذا المريض';
  end if;
  if p ? 'planId' then select * into plan from treatment_plans where id = _uuid(p, 'planId') and patient_id = pat.id;
  else select * into plan from treatment_plans where id = active_plan_id(pat.id); end if;

  insert into appointments (no, patient_id, type, service_id, therapist_id, location, address, date, time, duration_min, status, price,
                            package_id, plan_id, series_id, branch_id, created_by, notes)
  values (next_counter('appointment', 'MV-'), pat.id, case when loc = 'home' then 'home' else _txt(p, 'type', 'session') end, svc.id, th, loc,
          case when loc = 'home' then _txt(p, 'address') else '' end, d, tm, svc.duration_min, 'new', v_price,
          pkg, plan.id, _uuid(p, 'seriesId'),
          coalesce(_uuid(p, 'branchId'), (select branch_id from therapists where id = th), (select id from branches order by created_at limit 1)),
          my_employee_id(), _txt(p, 'notes'))
  returning * into a;

  if pkg is null and not coalesce(plan.price, 0) > 0 then
    perform new_invoice(pat.id, svc.name, v_price, 'due', d, a.id, null, null, svc.id);
  end if;
  perform notify_staff('appointment_new', case when loc = 'home' then 'تم حجز زيارة منزلية' else 'تم إنشاء موعد جديد' end,
    pat.full_name || ' — ' || svc.name || ' — ' || d || ' ' || tm, a.no, '/appointments', pat.id);
  perform notify_patient(pat.id, 'appointment_new', 'تم حجز موعدك', svc.name || ' يوم ' || d || ' الساعة ' || tm, a.id::text);
  perform log_action('حجز موعد ' || a.no || ' — ' || svc.name || ' بتاريخ ' || d || ' ' || tm, pat.id);
  return jsonb_build_object('id', a.id, 'no', a.no);
end $function$
;

CREATE OR REPLACE FUNCTION public.reschedule_appointment(p_id uuid, p_date date, p_time text, p_therapist uuid DEFAULT NULL::uuid, p_address text DEFAULT NULL::text)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare a appointments; th uuid;
begin
  perform require_perm('appointments', 'edit');
  select * into a from appointments where id = p_id for update;
  if a.id is null or not can_see_patient(a.patient_id) then raise exception 'الموعد غير موجود'; end if;
  if a.status in ('cancelled','completed') then raise exception 'لا يمكن تغيير موعد ملغي أو مكتمل'; end if;
  th := coalesce(p_therapist, a.therapist_id);
  perform check_slot(th, p_date, p_time, a.duration_min, p_id);
  update appointments set date = p_date, time = p_time, therapist_id = th, status = 'rescheduled', updated_at = now(),
    address = case when location = 'home' and p_address is not null then trim(p_address) else address end
  where id = p_id;
  update invoices set date = p_date where appointment_id = p_id and status in ('due','draft');
  perform notify_staff('appointment_rescheduled', 'تم تغيير موعد', (select full_name from patients where id = a.patient_id) || ' — ' || a.no || ' إلى ' || p_date || ' ' || p_time, a.no, '/appointments', a.patient_id);
  perform notify_patient(a.patient_id, 'appointment_rescheduled', 'تم تغيير موعدك', 'موعدك الجديد يوم ' || p_date || ' الساعة ' || p_time, a.id::text);
  perform log_action('إعادة جدولة الموعد ' || a.no || ' إلى ' || p_date || ' ' || p_time, a.patient_id);
end $function$
;

CREATE OR REPLACE FUNCTION public.update_appointment_details(p_id uuid, p jsonb)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare a appointments; svc services; new_service_id text; new_location text; new_type text; new_address text; new_notes text; inv_id uuid;
begin
  perform require_perm('appointments', 'edit');
  select * into a from appointments where id = p_id for update;
  if a.id is null or not can_see_patient(a.patient_id) then raise exception 'الموعد غير موجود'; end if;
  if a.status in ('cancelled', 'completed') then raise exception 'لا يمكن تعديل موعد ملغي أو مكتمل'; end if;

  new_service_id := coalesce(nullif(p->>'serviceId', ''), a.service_id);
  new_location := coalesce(nullif(p->>'location', ''), a.location);
  new_type := case when new_location = 'home' then 'home' else coalesce(nullif(p->>'type', ''), a.type) end;
  new_address := case when new_location = 'home' then trim(coalesce(p->>'address', a.address)) else '' end;
  new_notes := coalesce(p->>'notes', a.notes);

  if new_location not in ('center', 'home') then raise exception 'مكان الموعد غير صحيح'; end if;
  if new_location = 'home' and new_address = '' then raise exception 'أدخل عنوان الزيارة المنزلية'; end if;

  select * into svc from services where id = new_service_id;
  if svc.id is null or not svc.active then raise exception 'الخدمة غير موجودة أو موقوفة'; end if;


  update appointments set service_id = svc.id, type = new_type, location = new_location, address = new_address,
    duration_min = svc.duration_min, price = svc.price, notes = new_notes, updated_at = now()
  where id = p_id;

  -- الفاتورة المرتبطة تتحدّث بس لو لسه من غير أي دفعة (حماية من تغيير فاتورة اتدفع منها جزء تلقائيًا —
  -- المدير عنده تحكم كامل يدوي في الفاتورة نفسها من صفحة الفواتير لو محتاج تعديل بعد الدفع)
  if new_service_id is distinct from a.service_id then
    update invoices set price = svc.price, service_name = svc.name
    where appointment_id = p_id and status in ('due', 'draft') and paid = 0;
    for inv_id in select id from invoices where appointment_id = p_id and status in ('due', 'draft') and paid = 0 loop
      perform recalc_invoice(inv_id);
    end loop;
  end if;

  perform log_action('تعديل تفاصيل الموعد ' || a.no || ' — ' || svc.name, a.patient_id);
end $function$
;

CREATE OR REPLACE FUNCTION public.free_therapists_count(p_service text, p_date date, p_time text, p_dur integer)
 RETURNS integer
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare t record; n int := 0;
begin
  for t in select th.id as therapist_id from therapists th where th.active loop -- كل طبيب نشط بيقدّم كل الخدمات
    begin
      perform check_slot(t.therapist_id, p_date, p_time, p_dur, null);
      n := n + 1;
    exception when others then null;
    end;
  end loop;
  return n;
end $function$
;

CREATE OR REPLACE FUNCTION public.public_catalog()
 RETURNS jsonb
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  select jsonb_build_object(
    'center', (select jsonb_build_object('name', name, 'phone', phone, 'email', email, 'city', city, 'district', district, 'street', street,
        'currency', currency, 'weekSchedule', week_schedule, 'slotStep', slot_step_min, 'cancelBeforeHours', cancel_before_hours) from center_info limit 1),
    'services', coalesce((select jsonb_agg(jsonb_build_object('id', s.id, 'name', s.name, 'category', s.category, 'description', s.description,
        'price', s.price, 'durationMin', s.duration_min,
        'prices', coalesce((select jsonb_agg(jsonb_build_object('id', sp.id, 'label', sp.label, 'price', sp.price) order by sp.price)
                            from service_prices sp where sp.service_id = s.id and sp.active and sp.therapist_id is null), '[]'),
        'doctorIds', coalesce((select jsonb_agg(t.id order by t.name) from therapists t where t.active), '[]'))
        order by s.category, s.name) from services s where s.active), '[]'),
    'doctors', coalesce((select jsonb_agg(jsonb_build_object('id', t.id, 'name', t.name, 'title', t.title, 'bio', t.bio, 'photo', t.photo, 'photoUrl', t.photo_url,
        'workHours', t.work_hours, 'defaultDurationMin', t.default_duration_min,
        'serviceIds', coalesce((select jsonb_agg(sv.id) from services sv where sv.active), '[]')) order by t.name)
        from therapists t where t.active), '[]')
  )
$function$
;

CREATE OR REPLACE FUNCTION public.save_service(p jsonb)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare v text := nullif(p->>'id', ''); is_new boolean := v is null or not exists (select 1 from services where id = nullif(p->>'id', ''));
begin
  perform require_perm('services', case when is_new then 'create' else 'edit' end);
  if length(_txt(p, 'name')) < 2 then raise exception 'اسم الخدمة مطلوب'; end if;
  if _num(p, 'price', -1) < 0 then raise exception 'السعر غير صحيح'; end if;
  if _num(p, 'durationMin', 0) < 5 then raise exception 'مدة الخدمة غير صحيحة'; end if;
  if is_new then
    v := coalesce(v, 'sv_' || substr(replace(gen_random_uuid()::text, '-', ''), 1, 8));
    insert into services (id, name, category, description, price, duration_min, active, branch_id)
    values (v, _txt(p, 'name'), _txt(p, 'category'), _txt(p, 'description'), _num(p, 'price'), _num(p, 'durationMin')::int,
            coalesce((p->>'active')::boolean, true), _uuid(p, 'branchId'));
  else
    update services set name = _txt(p, 'name'), category = _txt(p, 'category'), description = _txt(p, 'description'), price = _num(p, 'price'),
      duration_min = _num(p, 'durationMin')::int, active = coalesce((p->>'active')::boolean, active), branch_id = _uuid(p, 'branchId')
    where id = v;
  end if;
  -- كل الأطباء بيقدّموا الخدمة دي (قائمة therapistIds لو اتبعتت بتتجاهل)
  insert into therapist_services (therapist_id, service_id) select t.id, v from therapists t on conflict do nothing;
  perform log_action(case when is_new then 'إضافة' else 'تعديل' end || ' خدمة: ' || _txt(p, 'name') || ' — ' || _num(p, 'price') || ' ر.س');
  return jsonb_build_object('id', v);
end $function$
;

CREATE OR REPLACE FUNCTION public.save_therapist(p jsonb)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
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
  -- الطبيب بيقدّم كل الخدمات (قائمة serviceIds لو اتبعتت بتتجاهل)
  insert into therapist_services (therapist_id, service_id) select v, s.id from services s on conflict do nothing;
  perform log_action(case when is_new then 'إضافة' else 'تعديل' end || ' معالج: ' || _txt(p, 'name'));
  return jsonb_build_object('id', v);
end $function$
;

-- رجّع كل الروابط الناقصة (زي «كشف»)
insert into therapist_services (therapist_id, service_id) select t.id, s.id from therapists t cross join services s on conflict do nothing;
