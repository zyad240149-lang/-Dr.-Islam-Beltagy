-- حجز المكالمة: موعد + فاتورة من غير ما يتضاف مريض في «المرضى» (طلب الإدارة 2026-10-07).
-- المتصل بيتسجّل كمريض «ضيف» مخفي (is_guest) — مايظهرش في قائمة المرضى ولا العدادات ولا البحث، وبيتحوّل لمريض حقيقي لما
-- الموظف يضيفه يدويًا بنفس الجوال (نفس السجل — بدون تكرار ومواعيده وفواتيره تفضل مربوطة).

alter table patients add column if not exists is_guest boolean not null default false;
create index if not exists idx_patients_guest on patients (is_guest) where is_guest;

-- الضيف ماينبّهش الموظفين ماتتربطش بحساب عميل لحد ما يتحوّل لمريض حقيقي
create or replace function patients_after_insert() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if new.is_guest then return new; end if;
  perform notify_staff('patient_new', 'تسجيل مريض جديد', new.full_name || ' — ' || new.file_no, new.referral_source, '/patients/' || new.id, new.id);
  update customers set patient_id = new.id
   where patient_id is null and right(regexp_replace(phone, 'D', '', 'g'), 9) = right(regexp_replace(new.phone, 'D', '', 'g'), 9);
  return new;
end $$;

create or replace function patients_after_promote() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  perform notify_staff('patient_new', 'تسجيل مريض جديد', new.full_name || ' — ' || new.file_no, new.referral_source, '/patients/' || new.id, new.id);
  update customers set patient_id = new.id
   where patient_id is null and right(regexp_replace(phone, 'D', '', 'g'), 9) = right(regexp_replace(new.phone, 'D', '', 'g'), 9);
  return new;
end $$;
drop trigger if exists trg_patients_promote on patients;
create trigger trg_patients_promote after update of is_guest on patients for each row when (old.is_guest and not new.is_guest) execute function patients_after_promote();

-- المريض الضيف: بيدوّر بالجوال (مريض حقيقي الأول) وإلا بينشئ ضيف مخفي
create or replace function guest_patient(g jsonb) returns patients
language plpgsql security definer set search_path = public as $$
declare pat patients; digits text := regexp_replace(coalesce(g->>'phone', ''), 'D', '', 'g'); nm text := trim(coalesce(g->>'fullName', ''));
begin
  if length(digits) < 9 then raise exception 'رقم الجوال غير صحيح'; end if;
  select * into pat from patients where right(regexp_replace(phone, 'D', '', 'g'), 9) = right(digits, 9) order by is_guest, registered_at desc limit 1;
  if pat.id is not null then return pat; end if;
  if length(nm) < 2 then raise exception 'اسم المريض مطلوب'; end if;
  insert into patients (file_no, full_name, phone, is_guest, notes) values ('', nm, g->>'phone', true, 'حجز عن طريق مكالمة') returning * into pat;
  return pat;
end $$;
revoke execute on function guest_patient(jsonb) from public, anon, authenticated;

CREATE OR REPLACE FUNCTION public.book_appointment(p jsonb)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare svc services; pat patients; th uuid := _uuid(p, 'therapistId'); d date; tm text := _txt(p, 'time');
  loc text := _txt(p, 'location', 'center'); plan treatment_plans; pkg uuid := _uuid(p, 'packageId'); a appointments; v_price numeric; v_branch uuid;
begin
  perform require_any(array['booking:create', 'appointments:create']);
  if _uuid(p, 'patientId') is null and p ? 'guest' then pat := guest_patient(p->'guest');
  else select * into pat from patients where id = _uuid(p, 'patientId'); end if;
  if pat.id is null or not can_see_patient(pat.id) then raise exception 'اختر المريض'; end if;
  if not pat.active then raise exception 'ملف المريض غير نشط'; end if;
  select * into svc from services where id = _txt(p, 'serviceId');
  if svc.id is null or not svc.active then raise exception 'الخدمة غير موجودة أو موقوفة'; end if;
  -- الدكتور إجباري (لا يوجد «أي دكتور»): اتفحص قبل التاريخ/الوقت
  perform assert_booking_doctor(th, svc.id, _uuid(p, 'branchId'));
  d := nullif(p->>'date', '')::date;
  if d is null then raise exception 'اختر التاريخ'; end if;
  if loc not in ('center','home') then raise exception 'مكان الموعد غير صحيح'; end if;
  if loc = 'home' and _txt(p, 'address') = '' then raise exception 'أدخل عنوان الزيارة المنزلية'; end if;
  perform check_slot(th, d, tm, svc.duration_min, null);
  v_price := effective_price(svc.id, th, _uuid(p, 'priceId'));
  v_branch := coalesce(_uuid(p, 'branchId'), (select branch_id from therapists where id = th), (select id from branches order by created_at limit 1));

  if pkg is not null and not exists (select 1 from packages where id = pkg and patient_id = pat.id and status = 'active' and used_sessions < total_sessions) then
    raise exception 'الباقة غير صالحة لهذا المريض';
  end if;
  if p ? 'planId' then select * into plan from treatment_plans where id = _uuid(p, 'planId') and patient_id = pat.id;
  else select * into plan from treatment_plans where id = active_plan_id(pat.id); end if;

  insert into appointments (no, patient_id, type, service_id, therapist_id, location, address, date, time, duration_min, status, price,
                            package_id, plan_id, series_id, branch_id, created_by, notes)
  values (next_counter('appointment', 'MV-'), pat.id, case when loc = 'home' then 'home' else _txt(p, 'type', 'session') end, svc.id, th, loc,
          case when loc = 'home' then _txt(p, 'address') else '' end, d, tm, svc.duration_min, 'new', v_price,
          pkg, plan.id, _uuid(p, 'seriesId'), v_branch, my_employee_id(), _txt(p, 'notes'))
  returning * into a;

  if pkg is null and not coalesce(plan.price, 0) > 0 then
    perform new_invoice(pat.id, svc.name, v_price, 'due', d, a.id, null, null, svc.id);
  end if;
  perform notify_staff('appointment_new', case when loc = 'home' then 'تم حجز زيارة منزلية' else 'تم إنشاء موعد جديد' end,
    pat.full_name || ' — ' || svc.name || ' — ' || d || ' ' || tm, a.no, '/appointments', pat.id);
  perform notify_patient(pat.id, 'appointment_new', 'تم حجز موعدك', svc.name || ' يوم ' || d || ' الساعة ' || tm, a.id::text);
  perform log_action('حجز موعد ' || a.no || ' — ' || svc.name || ' بتاريخ ' || d || ' ' || tm, pat.id);
  return jsonb_build_object('id', a.id, 'no', a.no);
end $function$;
CREATE OR REPLACE FUNCTION public.dashboard_stats(p_branch uuid DEFAULT NULL::uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare t date := riyadh_today(); m date := date_trunc('month', riyadh_today())::date; res jsonb; fin boolean := has_perm('financial','view');
begin
  perform require_perm('dashboard', 'view');
  select jsonb_build_object(
    'todayAppointments', (select count(*) from appointments a where a.date = t and a.status <> 'cancelled' and (p_branch is null or a.branch_id = p_branch) and can_see_patient(a.patient_id)),
    'completedToday', (select count(*) from appointments a where a.date = t and a.status = 'completed' and (p_branch is null or a.branch_id = p_branch) and can_see_patient(a.patient_id)),
    'totalPatients', (select count(*) from patients pt where not pt.is_guest and pt.active and can_see_patient(pt.id)),
    'newPatientsMonth', (select count(*) from patients pt where not pt.is_guest and pt.registered_at >= m and can_see_patient(pt.id)),
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
end $function$;
CREATE OR REPLACE FUNCTION public.report_summary(p_from date, p_to date, p_branch uuid DEFAULT NULL::uuid, p_therapist uuid DEFAULT NULL::uuid, p_group text DEFAULT 'day'::text, p_service text DEFAULT NULL::text)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
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
    'newPatients', (select count(*) from patients where not is_guest and (registered_at at time zone 'Africa/Cairo')::date between p_from and p_to and can_see_patient(id)),
    'totalPatients', (select count(*) from patients where not is_guest and active and can_see_patient(id)),
    'appointments', (select count(*) from appts),
    'appointmentsByStatus', (select coalesce(jsonb_object_agg(status, n), '{}') from (select status, count(*) n from appts group by status) x),
    'patientsBySource', (select coalesce(jsonb_agg(x order by x.n desc), '[]') from (
        select referral_source source, count(*) n from patients where not is_guest and (registered_at at time zone 'Africa/Cairo')::date between p_from and p_to and can_see_patient(id) group by 1) x),
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
end $function$;
CREATE OR REPLACE FUNCTION public.global_search(p_q text)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare q text := trim(coalesce(p_q, '')); pat text; res jsonb := '[]'::jsonb;
begin
  if my_employee_id() is null then raise exception 'غير مصرح' using errcode = '42501'; end if;
  if length(q) < 2 then return res; end if;
  pat := '%' || replace(replace(replace(q, '\', '\\'), '%', '\%'), '_', '\_') || '%';
  if has_perm('patients', 'view') then
    res := res || coalesce((select jsonb_agg(jsonb_build_object('type','patient','id',id,'title',full_name,'sub',file_no || ' · ' || phone,'link','/patients/' || id))
      from (select * from patients where not is_guest and can_see_patient(id) and (full_name ilike pat or phone like pat or phone_digits_match(phone, q) or file_no ilike pat or national_id like pat) order by full_name limit 6) p), '[]');
  end if;
  if has_perm('therapists', 'view') or has_perm('booking', 'view') then
    res := res || coalesce((select jsonb_agg(jsonb_build_object('type','doctor','id',id,'title',name,'sub',title,'link','/employees?tab=therapists&q=' || name))
      from (select * from therapists where name ilike pat or phone like pat or phone_digits_match(phone, q) order by name limit 5) t), '[]');
  end if;
  if has_perm('appointments', 'view') then
    res := res || coalesce((select jsonb_agg(jsonb_build_object('type','appointment','id',a.id,'title',a.no || ' — ' || p.full_name,'sub',a.date || ' ' || a.time,'link','/appointments?q=' || a.no))
      from (select * from appointments where no ilike pat and can_see_patient(patient_id) order by date desc limit 5) a join patients p on p.id = a.patient_id), '[]');
  end if;
  return res;
end $function$;
CREATE OR REPLACE FUNCTION public.list_patients(p_q text DEFAULT ''::text, p_gender text DEFAULT ''::text, p_source text DEFAULT ''::text, p_active text DEFAULT ''::text, p_doctor uuid DEFAULT NULL::uuid, p_sort text DEFAULT 'registered_desc'::text, p_limit integer DEFAULT 20, p_offset integer DEFAULT 0)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
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
    where not p.is_guest and can_see_patient(p.id)
      and (trim(coalesce(p_q, '')) = '' or p.full_name ilike pat or p.phone like pat or phone_digits_match(p.phone, p_q) or p.file_no ilike pat or p.national_id like pat)
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
end $function$;
