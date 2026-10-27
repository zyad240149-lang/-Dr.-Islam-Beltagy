-- ===================================================================
-- 006 — دوال المنصة: بحث شامل، ترقيم المرضى على الخادم، كتالوج عام للموقع،
-- حساب المريض (حجز/إلغاء/تعديل/لوحة)، تعديل الحساب، وتشديد صلاحية البيانات المالية.
-- ===================================================================

-- ===== check_slot: استراحة الطبيب + نهاية الدوام =====
create or replace function check_slot(p_therapist uuid, p_date date, p_time text, p_dur int, p_exclude uuid default null) returns void
language plpgsql security definer set search_path = public as $$
declare d text := lower(to_char(p_date, 'Dy')); sched jsonb; th therapists; wh jsonb; endt time;
begin
  if p_time !~ '^\d{2}:\d{2}$' then raise exception 'صيغة الوقت غير صحيحة'; end if;
  if p_date < riyadh_today() then raise exception 'لا يمكن الحجز في تاريخ سابق'; end if;
  if p_date = riyadh_today() and p_time::time <= (now() at time zone 'Africa/Cairo')::time then raise exception 'هذا الوقت انقضى اليوم'; end if;
  select e.value into sched from center_info c, jsonb_array_elements(c.week_schedule) e where e.value->>'day' = d limit 1;
  if sched is null or not coalesce((sched->>'open')::boolean, false) then raise exception 'المركز مغلق في هذا اليوم'; end if;
  if p_time < sched->>'from' or p_time >= sched->>'to' then raise exception 'الوقت خارج ساعات عمل المركز (% - %)', sched->>'from', sched->>'to'; end if;

  select * into th from therapists where id = p_therapist;
  if th.id is null or not th.active then raise exception 'المعالج غير موجود أو غير نشط'; end if;
  if exists (select 1 from jsonb_array_elements(th.on_leave) l where p_date between (l.value->>'from')::date and (l.value->>'to')::date)
     or exists (select 1 from staff_requests r join employees e on e.id = r.employee_id
                where e.therapist_id = p_therapist and r.status = 'approved' and r.type = 'leave' and p_date between r.from_date and r.to_date) then
    raise exception 'المعالج في إجازة في هذا التاريخ';
  end if;
  select w.value into wh from jsonb_array_elements(th.work_hours) w where w.value->>'day' = d limit 1;
  if wh is null or p_time < wh->>'from' or p_time >= wh->>'to' then raise exception 'الوقت خارج ساعات عمل المعالج في هذا اليوم'; end if;
  endt := p_time::time + make_interval(mins => p_dur);
  if endt > (wh->>'to')::time then raise exception 'الموعد يتجاوز نهاية دوام المعالج'; end if;
  if coalesce(wh->>'breakFrom', '') <> '' and coalesce(wh->>'breakTo', '') <> ''
     and p_time::time < (wh->>'breakTo')::time and endt > (wh->>'breakFrom')::time then
    raise exception 'الوقت يتقاطع مع فترة استراحة المعالج (% - %)', wh->>'breakFrom', wh->>'breakTo';
  end if;

  perform pg_advisory_xact_lock(hashtext(p_therapist::text || p_date::text));
  if exists (select 1 from appointments a
             where a.therapist_id = p_therapist and a.date = p_date and a.status not in ('cancelled') and a.id is distinct from p_exclude
               and p_time::time < a.time::time + make_interval(mins => a.duration_min)
               and a.time::time < endt) then
    raise exception 'المعالج لديه موعد آخر في هذا الوقت';
  end if;
end $$;

-- ===== سعر الخدمة الفعلي (سعر مختار > سعر خاص بالطبيب > السعر الأساسي) =====
create or replace function effective_price(p_service text, p_therapist uuid, p_price_id uuid default null) returns numeric
language sql stable security definer set search_path = public as $$
  select coalesce(
    (select price from service_prices where id = p_price_id and service_id = p_service and active and (therapist_id is null or therapist_id = p_therapist)),
    (select price from service_prices where service_id = p_service and therapist_id = p_therapist and active order by created_at desc limit 1),
    (select price from services where id = p_service))
$$;

-- ===== book_appointment: ملاحظات + سعر مختار =====
create or replace function book_appointment(p jsonb) returns jsonb
language plpgsql security definer set search_path = public as $$
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
  if not exists (select 1 from therapist_services where therapist_id = th and service_id = svc.id) then raise exception 'المعالج لا يقدم هذه الخدمة'; end if;
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
end $$;

-- ===== start_session: الموعد يصير "قيد الزيارة" =====
create or replace function start_session(p_appointment uuid) returns jsonb
language plpgsql security definer set search_path = public as $$
declare a appointments; s treatment_sessions;
begin
  perform require_perm('sessions', 'create');
  select * into s from treatment_sessions where appointment_id = p_appointment;
  if s.id is not null then return jsonb_build_object('id', s.id); end if;
  select * into a from appointments where id = p_appointment for update;
  if a.id is null or not can_see_patient(a.patient_id) then raise exception 'الموعد غير موجود'; end if;
  if a.status in ('cancelled','no_show') then raise exception 'لا يمكن بدء زيارة لموعد ملغي أو لم يحضر'; end if;
  update appointments set status = 'in_progress', updated_at = now() where id = a.id;
  insert into treatment_sessions (appointment_id, patient_id, therapist_id, plan_id, session_no, date, status, started_at)
  values (a.id, a.patient_id, a.therapist_id, a.plan_id, (select count(*) + 1 from treatment_sessions where patient_id = a.patient_id), a.date, 'in_progress', now())
  returning * into s;
  perform log_action('بدء الزيارة رقم ' || s.session_no || ' (' || a.no || ')', a.patient_id);
  return jsonb_build_object('id', s.id);
end $$;

-- ===== set_appointment_status: يقبل in_progress =====
do $$
declare def text;
begin
  select pg_get_functiondef('set_appointment_status(uuid,text,text)'::regprocedure) into def;
  def := replace(def, $q$'new','confirmed','on_way','arrived','no_show','completed','cancelled','rescheduled'$q$, $q$'new','confirmed','on_way','arrived','in_progress','no_show','completed','cancelled','rescheduled'$q$);
  execute def;
end $$;

-- ===== لوحة المعلومات: الأرقام المالية تتطلب صلاحية البيانات المالية =====
create or replace function dashboard_stats(p_branch uuid default null) returns jsonb
language plpgsql stable security definer set search_path = public as $$
declare t date := riyadh_today(); m date := date_trunc('month', riyadh_today())::date; res jsonb; fin boolean := has_perm('financial','view');
begin
  perform require_perm('dashboard', 'view');
  select jsonb_build_object(
    'todayAppointments', (select count(*) from appointments a where a.date = t and a.status <> 'cancelled' and (p_branch is null or a.branch_id = p_branch) and can_see_patient(a.patient_id)),
    'completedToday', (select count(*) from appointments a where a.date = t and a.status = 'completed' and (p_branch is null or a.branch_id = p_branch) and can_see_patient(a.patient_id)),
    'totalPatients', (select count(*) from patients pt where pt.active and can_see_patient(pt.id)),
    'newPatientsMonth', (select count(*) from patients pt where pt.registered_at >= m and can_see_patient(pt.id)),
    'monthRevenue', case when fin then
        (select coalesce(sum(pay.amount), 0) from payments pay left join invoices i on i.id = pay.invoice_id left join appointments a on a.id = i.appointment_id
         where (pay.date at time zone 'Africa/Cairo')::date >= m and (p_branch is null or a.branch_id = p_branch)) else null end,
    'outstanding', case when fin then
        (select coalesce(sum(i.remaining), 0) from invoices i left join appointments a on a.id = i.appointment_id
         where i.status in ('due','partial') and (p_branch is null or a.branch_id = p_branch)) else null end,
    'draftPlanInvoices', case when has_perm('invoices','view') then (select count(*) from invoices where status = 'draft') else 0 end,
    'unreadNotifications', (select count(*) from notifications where audience = 'staff' and not read),
    'pendingRequests', case when has_perm('requests','edit') then (select count(*) from staff_requests where status = 'pending') else 0 end,
    'openTickets', case when has_perm('support','view') then (select count(*) from support_tickets where status in ('open','in_progress')) else 0 end
  ) into res;
  return res;
end $$;

-- ===== تقارير الخادم: تشغيلية للجميع، مالية لمن يملك financial فقط =====
drop function if exists report_summary(date, date, uuid, uuid, text);
create or replace function report_summary(p_from date, p_to date, p_branch uuid default null, p_therapist uuid default null, p_group text default 'day', p_service text default null) returns jsonb
language plpgsql stable security definer set search_path = public as $$
declare res jsonb; g text := case when p_group in ('day','week','month') then p_group else 'day' end; fin boolean := has_perm('financial','view');
begin
  perform require_perm('reports', 'view');
  if p_from is null or p_to is null or p_from > p_to then raise exception 'تحقق من فترة التقرير'; end if;
  with appts as (
    select a.* from appointments a
    where a.date between p_from and p_to and (p_branch is null or a.branch_id = p_branch) and (p_therapist is null or a.therapist_id = p_therapist)
      and (p_service is null or a.service_id = p_service) and can_see_patient(a.patient_id)
  ), pays as (
    select pay.*, a.branch_id, a.therapist_id, a.service_id from payments pay
    join invoices i on i.id = pay.invoice_id left join appointments a on a.id = i.appointment_id
    where (pay.date at time zone 'Africa/Cairo')::date between p_from and p_to
      and (p_branch is null or a.branch_id = p_branch) and (p_therapist is null or a.therapist_id = p_therapist) and (p_service is null or a.service_id = p_service)
  ), invs as (
    select i.*, a.branch_id, a.therapist_id, a.service_id from invoices i left join appointments a on a.id = i.appointment_id
    where i.date between p_from and p_to and i.status not in ('cancelled','draft')
      and (p_branch is null or a.branch_id = p_branch) and (p_therapist is null or a.therapist_id = p_therapist) and (p_service is null or a.service_id = p_service)
  )
  select jsonb_build_object(
    'financial', fin,
    'revenue', case when fin then (select coalesce(sum(amount), 0) from pays) end,
    'paymentsCount', case when fin then (select count(*) from pays) end,
    'paymentsByMethod', case when fin then (select coalesce(jsonb_object_agg(method, total), '{}') from (select method, sum(amount) total from pays group by method) x) end,
    'invoiced', case when fin then (select coalesce(sum(total), 0) from invs) end,
    'discounts', case when fin then (select coalesce(sum(discount), 0) from invs) end,
    'tax', case when fin then (select coalesce(sum(tax_amount), 0) from invs) end,
    'outstanding', case when fin then (select coalesce(sum(remaining), 0) from invoices i left join appointments a on a.id = i.appointment_id
                    where i.status in ('due','partial') and (p_branch is null or a.branch_id = p_branch) and (p_therapist is null or a.therapist_id = p_therapist) and (p_service is null or a.service_id = p_service)) end,
    'newPatients', (select count(*) from patients where (registered_at at time zone 'Africa/Cairo')::date between p_from and p_to and can_see_patient(id)),
    'totalPatients', (select count(*) from patients where active and can_see_patient(id)),
    'appointments', (select count(*) from appts),
    'appointmentsByStatus', (select coalesce(jsonb_object_agg(status, n), '{}') from (select status, count(*) n from appts group by status) x),
    'patientsBySource', (select coalesce(jsonb_agg(x order by x.n desc), '[]') from (
        select referral_source source, count(*) n from patients where (registered_at at time zone 'Africa/Cairo')::date between p_from and p_to and can_see_patient(id) group by 1) x),
    'patientsByDoctor', (select coalesce(jsonb_agg(x order by x.patients desc), '[]') from (
        select t.id, t.name, count(distinct a.patient_id) patients, count(a.id) visits from therapists t join appts a on a.therapist_id = t.id group by t.id, t.name) x),
    'therapists', (select coalesce(jsonb_agg(x order by x.completed desc), '[]') from (
        select t.id, t.name, count(a.id) appointments, count(a.id) filter (where a.status = 'completed') completed,
               count(a.id) filter (where a.status = 'no_show') no_show, count(a.id) filter (where a.status = 'cancelled') cancelled,
               count(distinct a.patient_id) patients,
               case when fin then coalesce((select sum(p2.amount) from pays p2 where p2.therapist_id = t.id), 0) end revenue
        from therapists t left join appts a on a.therapist_id = t.id
        where p_therapist is null or t.id = p_therapist
        group by t.id, t.name) x),
    'services', (select coalesce(jsonb_agg(x order by x.count desc), '[]') from (
        select s.id, s.name, count(a.id) count, count(a.id) filter (where a.status = 'completed') completed,
               case when fin then coalesce((select sum(p2.amount) from pays p2 where p2.service_id = s.id), 0) end revenue
        from services s join appts a on a.service_id = s.id group by s.id, s.name) x),
    'branches', (select coalesce(jsonb_agg(x), '[]') from (
        select b.id, b.name, (select count(*) from appts a where a.branch_id = b.id) appointments,
               case when fin then (select coalesce(sum(amount), 0) from pays p2 where p2.branch_id = b.id) end revenue
        from branches b where p_branch is null or b.id = p_branch) x),
    'series', (select coalesce(jsonb_agg(x order by x.period), '[]') from (
        select to_char(date_trunc(g, d)::date, 'YYYY-MM-DD') period,
               (select count(*) from appts a where date_trunc(g, a.date) = date_trunc(g, d)) appointments,
               case when fin then (select coalesce(sum(amount), 0) from pays p2 where date_trunc(g, (p2.date at time zone 'Africa/Cairo')::date) = date_trunc(g, d)) end revenue
        from generate_series(date_trunc(g, p_from)::date, p_to, ('1 ' || g)::interval) d) x)
  ) into res;
  return res;
end $$;

-- ===================================================================
-- بحث شامل (مرضى / أطباء / مواعيد) حسب الصلاحية ونطاق الطبيب
-- ===================================================================
create or replace function global_search(p_q text) returns jsonb
language plpgsql stable security definer set search_path = public as $$
declare q text := trim(coalesce(p_q, '')); pat text; res jsonb := '[]'::jsonb;
begin
  if my_employee_id() is null then raise exception 'غير مصرح' using errcode = '42501'; end if;
  if length(q) < 2 then return res; end if;
  pat := '%' || replace(replace(replace(q, '\', '\\'), '%', '\%'), '_', '\_') || '%';
  if has_perm('patients', 'view') then
    res := res || coalesce((select jsonb_agg(jsonb_build_object('type','patient','id',id,'title',full_name,'sub',file_no || ' · ' || phone,'link','/patients/' || id))
      from (select * from patients where can_see_patient(id) and (full_name ilike pat or phone like pat or file_no ilike pat or national_id like pat) order by full_name limit 6) p), '[]');
  end if;
  if has_perm('therapists', 'view') or has_perm('booking', 'view') then
    res := res || coalesce((select jsonb_agg(jsonb_build_object('type','doctor','id',id,'title',name,'sub',title,'link','/employees?tab=therapists&q=' || name))
      from (select * from therapists where name ilike pat or phone like pat order by name limit 5) t), '[]');
  end if;
  if has_perm('appointments', 'view') then
    res := res || coalesce((select jsonb_agg(jsonb_build_object('type','appointment','id',a.id,'title',a.no || ' — ' || p.full_name,'sub',a.date || ' ' || a.time,'link','/appointments?q=' || a.no))
      from (select * from appointments where no ilike pat and can_see_patient(patient_id) order by date desc limit 5) a join patients p on p.id = a.patient_id), '[]');
  end if;
  return res;
end $$;

-- ===================================================================
-- قائمة المرضى بترقيم وبحث وفرز على الخادم
-- ===================================================================
create or replace function list_patients(p_q text default '', p_gender text default '', p_source text default '', p_active text default '',
  p_doctor uuid default null, p_sort text default 'registered_desc', p_limit int default 20, p_offset int default 0) returns jsonb
language plpgsql stable security definer set search_path = public as $$
declare pat text; res jsonb; lim int := least(greatest(coalesce(p_limit, 20), 1), 200); off int := greatest(coalesce(p_offset, 0), 0);
begin
  perform require_perm('patients', 'view');
  pat := '%' || replace(replace(replace(trim(coalesce(p_q, '')), '\', '\\'), '%', '\%'), '_', '\_') || '%';
  with f as (
    select p.*, t.name as doctor_name,
      (select max(a.date) from appointments a where a.patient_id = p.id and a.status in ('completed','arrived','in_progress')) as last_visit,
      (select min(a.date) from appointments a where a.patient_id = p.id and a.status in ('new','confirmed','rescheduled') and a.date >= riyadh_today()) as next_visit,
      (select coalesce(sum(i.remaining), 0) from invoices i where i.patient_id = p.id and i.status in ('due','partial')) as balance,
      exists (select 1 from customers c where c.patient_id = p.id) as has_account
    from patients p left join therapists t on t.id = p.doctor_id
    where can_see_patient(p.id)
      and (trim(coalesce(p_q, '')) = '' or p.full_name ilike pat or p.phone like pat or p.file_no ilike pat or p.national_id like pat)
      and (coalesce(p_gender, '') = '' or p.gender = p_gender)
      and (coalesce(p_source, '') = '' or p.referral_source = p_source)
      and (coalesce(p_active, '') = '' or p.active = (p_active = 'on'))
      and (p_doctor is null or p.doctor_id = p_doctor)
  ), pg as (
    select f.*, row_number() over (order by
      case when p_sort = 'name_asc' then f.full_name end asc, case when p_sort = 'name_desc' then f.full_name end desc,
      case when p_sort = 'file_asc' then f.file_no end asc,
      case when p_sort = 'last_visit_desc' then f.last_visit end desc nulls last,
      case when p_sort = 'registered_asc' then f.registered_at end asc,
      f.registered_at desc) as rn from f
  )
  select jsonb_build_object('total', (select count(*) from f),
    'rows', coalesce((select jsonb_agg(to_jsonb(x) order by x.rn) from (select * from pg where rn > off and rn <= off + lim) x), '[]'))
  into res;
  return res;
end $$;

-- ===================================================================
-- الكتالوج العام للموقع (بدون تسجيل دخول): خدمات + أطباء + أسعار + ساعات العمل
-- ===================================================================
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
        order by s.category, s.name) from services s where s.active), '[]'),
    'doctors', coalesce((select jsonb_agg(jsonb_build_object('id', t.id, 'name', t.name, 'title', t.title, 'bio', t.bio, 'photo', t.photo, 'photoUrl', t.photo_url,
        'workHours', t.work_hours, 'defaultDurationMin', t.default_duration_min,
        'serviceIds', coalesce((select jsonb_agg(ts.service_id) from therapist_services ts where ts.therapist_id = t.id), '[]')) order by t.name)
        from therapists t where t.active), '[]')
  )
$$;

-- الأوقات المحجوزة لطبيب في يوم (بدون أي بيانات مرضى) — لبناء الأوقات المتاحة في الموقع وبوابة المريض
create or replace function busy_slots(p_therapist uuid, p_date date) returns jsonb
language sql stable security definer set search_path = public as $$
  select coalesce(jsonb_agg(jsonb_build_object('time', time, 'durationMin', duration_min)), '[]')
  from appointments where therapist_id = p_therapist and date = p_date and status <> 'cancelled'
$$;

-- ===================================================================
-- حساب المريض
-- ===================================================================
create or replace function require_patient() returns customers
language plpgsql stable security definer set search_path = public as $$
declare c customers;
begin
  select * into c from customers where auth_user_id = auth.uid() limit 1;
  if c.id is null then raise exception 'سجّل الدخول بحساب مريض' using errcode = '42501'; end if;
  if c.patient_id is null then raise exception 'حسابك غير مرتبط بملف مريض — تواصل مع المركز'; end if;
  return c;
end $$;

create or replace function patient_me() returns jsonb
language plpgsql stable security definer set search_path = public as $$
declare c customers; p patients;
begin
  c := require_patient();
  select * into p from patients where id = c.patient_id;
  return jsonb_build_object('customer', to_jsonb(c), 'patient', to_jsonb(p),
    'doctor', (select name from therapists where id = p.doctor_id));
end $$;

create or replace function patient_dashboard() returns jsonb
language plpgsql stable security definer set search_path = public as $$
declare c customers; pid uuid; t date := riyadh_today();
begin
  c := require_patient(); pid := c.patient_id;
  return jsonb_build_object(
    'next', (select to_jsonb(x) from (select a.id, a.no, a.date, a.time, a.status, a.duration_min, s.name as service, th.name as doctor
              from appointments a join services s on s.id = a.service_id left join therapists th on th.id = a.therapist_id
              where a.patient_id = pid and a.status in ('new','confirmed','rescheduled') and (a.date + a.time::time) >= (now() at time zone 'Africa/Cairo')
              order by a.date, a.time limit 1) x),
    'totalAppointments', (select count(*) from appointments where patient_id = pid),
    'completedAppointments', (select count(*) from appointments where patient_id = pid and status = 'completed'),
    'upcomingAppointments', (select count(*) from appointments where patient_id = pid and status in ('new','confirmed','rescheduled') and date >= t),
    'activePlans', (select count(*) from treatment_plans where patient_id = pid and status = 'active'),
    'dueInvoices', (select count(*) from invoices where patient_id = pid and status in ('due','partial')),
    'dueAmount', (select coalesce(sum(remaining), 0) from invoices where patient_id = pid and status in ('due','partial')),
    'unreadNotifications', (select count(*) from notifications where customer_id = c.id and not read));
end $$;

create or replace function patient_appointments() returns jsonb
language plpgsql stable security definer set search_path = public as $$
declare c customers;
begin
  c := require_patient();
  return coalesce((select jsonb_agg(to_jsonb(x) order by x.date desc, x.time desc) from (
    select a.id, a.no, a.date, a.time, a.duration_min, a.status, a.notes, a.price, a.cancel_reason, a.service_id, a.therapist_id, s.name as service, th.name as doctor
    from appointments a join services s on s.id = a.service_id left join therapists th on th.id = a.therapist_id where a.patient_id = c.patient_id) x), '[]');
end $$;

create or replace function patient_book(p jsonb) returns jsonb
language plpgsql security definer set search_path = public as $$
declare c customers; pat patients; svc services; th uuid := _uuid(p, 'therapistId'); d date := nullif(p->>'date', '')::date; tm text := _txt(p, 'time'); a appointments; v_price numeric;
begin
  c := require_patient();
  select * into pat from patients where id = c.patient_id;
  if not pat.active then raise exception 'ملفك غير نشط — تواصل مع المركز'; end if;
  select * into svc from services where id = _txt(p, 'serviceId');
  if svc.id is null or not svc.active then raise exception 'الخدمة غير موجودة أو موقوفة'; end if;
  if th is null then raise exception 'اختر الطبيب'; end if;
  if not exists (select 1 from therapist_services where therapist_id = th and service_id = svc.id) then raise exception 'الطبيب لا يقدم هذه الخدمة'; end if;
  if d is null then raise exception 'اختر التاريخ'; end if;
  if (select count(*) from appointments where patient_id = pat.id and status in ('new','confirmed','rescheduled') and date >= riyadh_today()) >= 5 then
    raise exception 'وصلت للحد الأقصى من المواعيد القادمة (5). تواصل مع المركز لتعديلها';
  end if;
  perform check_slot(th, d, tm, svc.duration_min, null);
  v_price := effective_price(svc.id, th, _uuid(p, 'priceId'));
  insert into appointments (no, patient_id, customer_id, type, service_id, therapist_id, location, address, date, time, duration_min, status, price, branch_id, notes)
  values (next_counter('appointment', 'MV-'), pat.id, c.id, 'session', svc.id, th, 'center', '', d, tm, svc.duration_min, 'new', v_price,
          coalesce((select branch_id from therapists where id = th), (select id from branches order by created_at limit 1)), _txt(p, 'notes'))
  returning * into a;
  if not exists (select 1 from treatment_plans where patient_id = pat.id and status = 'active' and treatment_plans.price > 0) then
    perform new_invoice(pat.id, svc.name, v_price, 'due', d, a.id, null, null, svc.id);
  end if;
  perform notify_staff('appointment_new', 'حجز جديد من المريض', pat.full_name || ' — ' || svc.name || ' — ' || d || ' ' || tm, a.no, '/appointments', pat.id);
  perform notify_patient(pat.id, 'appointment_new', 'تم استلام حجزك', svc.name || ' يوم ' || d || ' الساعة ' || tm || ' — بانتظار تأكيد المركز', a.id::text);
  insert into audit_logs (user_id, action, table_name, record_id, new_data) values (auth.uid(), 'patient_book', 'appointments', a.id::text, to_jsonb(a));
  return jsonb_build_object('id', a.id, 'no', a.no);
end $$;

create or replace function patient_cancel(p_id uuid, p_reason text default '') returns void
language plpgsql security definer set search_path = public as $$
declare c customers; a appointments; hrs int; pat patients;
begin
  c := require_patient();
  select * into a from appointments where id = p_id and patient_id = c.patient_id for update;
  if a.id is null then raise exception 'الموعد غير موجود'; end if;
  if a.status not in ('new','confirmed','rescheduled') then raise exception 'لا يمكن إلغاء موعد بحالته الحالية'; end if;
  select cancel_before_hours into hrs from center_info limit 1;
  if (a.date + a.time::time) - (now() at time zone 'Africa/Cairo') < make_interval(hours => coalesce(hrs, 24)) then
    raise exception 'لا يمكن الإلغاء قبل الموعد بأقل من % ساعة — تواصل مع المركز', coalesce(hrs, 24);
  end if;
  update appointments set status = 'cancelled', cancel_reason = coalesce(nullif(trim(p_reason), ''), 'إلغاء من المريض'), updated_at = now() where id = p_id;
  update invoices set status = 'cancelled' where appointment_id = p_id and paid = 0 and status <> 'cancelled';
  select * into pat from patients where id = a.patient_id;
  perform notify_staff('appointment_cancelled', 'المريض ألغى موعده', pat.full_name || ' — ' || a.no, a.no, '/appointments', pat.id);
end $$;

create or replace function patient_reschedule(p_id uuid, p_date date, p_time text) returns void
language plpgsql security definer set search_path = public as $$
declare c customers; a appointments; hrs int; pat patients;
begin
  c := require_patient();
  select * into a from appointments where id = p_id and patient_id = c.patient_id for update;
  if a.id is null then raise exception 'الموعد غير موجود'; end if;
  if a.status not in ('new','confirmed','rescheduled') then raise exception 'لا يمكن تعديل موعد بحالته الحالية'; end if;
  select cancel_before_hours into hrs from center_info limit 1;
  if (a.date + a.time::time) - (now() at time zone 'Africa/Cairo') < make_interval(hours => coalesce(hrs, 24)) then
    raise exception 'لا يمكن تعديل الموعد قبله بأقل من % ساعة — تواصل مع المركز', coalesce(hrs, 24);
  end if;
  perform check_slot(a.therapist_id, p_date, p_time, a.duration_min, p_id);
  update appointments set date = p_date, time = p_time, status = 'rescheduled', updated_at = now() where id = p_id;
  update invoices set date = p_date where appointment_id = p_id and status in ('due','draft');
  select * into pat from patients where id = a.patient_id;
  perform notify_staff('appointment_rescheduled', 'المريض غيّر موعده', pat.full_name || ' — ' || a.no || ' إلى ' || p_date || ' ' || p_time, a.no, '/appointments', pat.id);
end $$;

create or replace function patient_update_profile(p jsonb) returns void
language plpgsql security definer set search_path = public as $$
declare c customers;
begin
  c := require_patient();
  if p ? 'fullName' and length(trim(p->>'fullName')) < 3 then raise exception 'الاسم الكامل مطلوب'; end if;
  update patients set full_name = coalesce(nullif(trim(p->>'fullName'), ''), full_name), email = coalesce(trim(p->>'email'), email),
    address = coalesce(trim(p->>'address'), address), city = coalesce(trim(p->>'city'), city), district = coalesce(trim(p->>'district'), district),
    street = coalesce(trim(p->>'street'), street), gender = coalesce(nullif(p->>'gender', ''), gender),
    birth_date = case when p ? 'birthDate' then nullif(p->>'birthDate', '')::date else birth_date end,
    emergency_contact_name = coalesce(trim(p->>'emergencyContactName'), emergency_contact_name),
    emergency_contact_phone = coalesce(trim(p->>'emergencyContactPhone'), emergency_contact_phone)
  where id = c.patient_id;
  update customers set name = coalesce(nullif(trim(p->>'fullName'), ''), name), email = case when p ? 'email' then nullif(trim(p->>'email'), '') else email end where id = c.id;
end $$;

-- ===== تعديل حساب الموظف الشخصي (الاسم/الجوال فقط — الدور والحالة لا) =====
create or replace function update_my_profile(p jsonb) returns void
language plpgsql security definer set search_path = public as $$
declare v uuid := my_employee_id();
begin
  if v is null then raise exception 'غير مصرح' using errcode = '42501'; end if;
  if p ? 'name' and length(trim(p->>'name')) < 3 then raise exception 'الاسم الكامل مطلوب'; end if;
  if p ? 'phone' and length(regexp_replace(coalesce(p->>'phone', ''), '\D', '', 'g')) not between 9 and 15 then raise exception 'رقم الجوال غير صحيح'; end if;
  update employees set name = coalesce(nullif(trim(p->>'name'), ''), name), phone = coalesce(trim(p->>'phone'), phone) where id = v;
end $$;

create or replace function audit_login() returns void
language plpgsql security definer set search_path = public as $$
begin
  if auth.uid() is null then return; end if;
  insert into audit_logs (user_id, employee_id, action, table_name, record_id, new_data)
  values (auth.uid(), my_employee_id(), 'login', case when my_employee_id() is not null then 'employees' else 'customers' end,
          coalesce(my_employee_id()::text, my_customer_id()::text), jsonb_build_object('at', now()));
end $$;

-- ===== تسجيل مريض جديد (تُنادى من Edge Function بمفتاح الخدمة فقط) =====
create or replace function register_customer(p_auth_user uuid, p_name text, p_phone text, p_email text) returns jsonb
language plpgsql security definer set search_path = public as $$
declare pid uuid; cid uuid; last9 text := right(regexp_replace(p_phone, '\D', '', 'g'), 9);
begin
  select id into pid from patients where right(regexp_replace(phone, '\D', '', 'g'), 9) = last9
    and not exists (select 1 from customers c where c.patient_id = patients.id) order by registered_at limit 1;
  if pid is null then
    insert into patients (file_no, full_name, phone, email, referral_source) values ('', trim(p_name), p_phone, coalesce(trim(p_email), ''), 'website') returning id into pid;
  else
    update patients set email = case when coalesce(email, '') = '' then coalesce(trim(p_email), '') else email end where id = pid;
  end if;
  insert into customers (auth_user_id, patient_id, name, phone, email) values (p_auth_user, pid, trim(p_name), p_phone, nullif(trim(coalesce(p_email, '')), '')) returning id into cid;
  insert into audit_logs (user_id, action, table_name, record_id, new_data) values (p_auth_user, 'register', 'customers', cid::text, jsonb_build_object('phone', p_phone));
  return jsonb_build_object('customerId', cid, 'patientId', pid);
end $$;

-- ===================================================================
-- صلاحيات التنفيذ: المريض/الموظف المسجّل، والزائر للكتالوج فقط
-- ===================================================================
revoke execute on all functions in schema public from public, anon;
grant execute on all functions in schema public to authenticated;
revoke execute on function recalc_invoice(uuid), new_invoice(uuid, text, numeric, text, date, uuid, uuid, uuid, text), recalc_plan(uuid),
  check_slot(uuid, date, text, int, uuid), notify_staff(text, text, text, text, text, uuid), notify_patient(uuid, text, text, text, text),
  log_action(text, uuid), next_counter(text, text, int), effective_price(text, uuid, uuid), register_customer(uuid, text, text, text) from authenticated;
grant execute on function public_catalog(), busy_slots(uuid, date) to anon, authenticated;
grant execute on function register_customer(uuid, text, text, text) to service_role;
alter default privileges in schema public revoke execute on functions from public, anon;
