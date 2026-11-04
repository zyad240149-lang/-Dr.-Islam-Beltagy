-- الدوال قبل هجرات 934-937 (2026-11-04T11:19:06.934Z) للرجوع عند الحاجة. المشروع jdhnxfhwwszxykizrahb
CREATE OR REPLACE FUNCTION public.add_stock_movement(p jsonb)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare it inventory_items; typ text := _txt(p, 'type'); q numeric := _num(p, 'quantity'); out_dir boolean;
begin
  perform require_perm('inventory', 'edit');
  select * into it from inventory_items where id = _uuid(p, 'itemId') for update;
  if it.id is null then raise exception 'الصنف غير موجود'; end if;
  if typ not in ('purchase','issue','adjust_in','adjust_out') then raise exception 'نوع الحركة غير صحيح'; end if;
  if q <= 0 then raise exception 'الكمية لازم تكون أكبر من صفر'; end if;
  out_dir := typ in ('issue','adjust_out');
  if out_dir and q > it.quantity then raise exception 'الكمية المتاحة % % فقط', it.quantity, it.unit; end if;
  update inventory_items set quantity = quantity + case when out_dir then -q else q end,
    cost_price = case when typ = 'purchase' and _num(p, 'unitCost') > 0 then _num(p, 'unitCost') else cost_price end, updated_at = now()
  where id = it.id;
  insert into stock_movements (item_id, type, quantity, unit_cost, reference, employee_id, note)
  values (it.id, typ, q, _num(p, 'unitCost'), _txt(p, 'reference'), my_employee_id(), _txt(p, 'note'));
  perform log_action(case typ when 'purchase' then 'شراء' when 'issue' then 'صرف' when 'adjust_in' then 'تسوية بالزيادة' else 'تسوية بالنقص' end || ' ' || q || ' ' || it.unit || ' من ' || it.name);
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

CREATE OR REPLACE FUNCTION public.delete_item(p_id uuid)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare it inventory_items;
begin
  perform require_perm('inventory', 'delete');
  delete from inventory_items where id = p_id returning * into it;
  if it.id is null then raise exception 'الصنف غير موجود'; end if;
  perform log_action('حذف صنف مخزون: ' || it.name);
end $function$;

CREATE OR REPLACE FUNCTION public.register_customer(p_auth_user uuid, p_name text, p_phone text, p_email text, p_national_id text DEFAULT NULL::text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare pid uuid; cid uuid; last9 text := right(regexp_replace(p_phone, '\D', '', 'g'), 9); nm text; w text[]; nid text := norm_id(p_national_id); linked boolean := false;
begin
  nm := assert_patient_name(p_name);
  w := regexp_split_to_array(nm, ' ');
  if exists (select 1 from patients where right(regexp_replace(phone, '\D', '', 'g'), 9) = last9
      and not exists (select 1 from customers c where c.patient_id = patients.id)) then
    -- ملف موجود بنفس الموبايل = نفس الملف بشرط الرقم القومي/الجواز المسجّل فيه يطابق
    select id into pid from patients where right(regexp_replace(phone, '\D', '', 'g'), 9) = last9
      and nid <> '' and norm_id(national_id) = nid
      and not exists (select 1 from customers c where c.patient_id = patients.id) order by registered_at limit 1;
    if pid is null then
      raise exception 'الرقم ده مسجّل في ملف مريض — لازم الرقم القومي المسجّل في الملف عشان نربط الحساب، أو كلّم العيادة';
    end if;
    linked := true;
    -- الاسم الناقص أو مش عربي في الملف الموجود بيتكمّل بالاسم الثلاثي العربي
    update patients set email = case when coalesce(email, '') = '' then coalesce(trim(p_email), '') else email end,
      full_name = case when name_words(full_name) < 3 or not is_arabic_name(full_name) then nm else full_name end,
      first_name = case when name_words(full_name) < 3 or not is_arabic_name(full_name) then w[1] else first_name end,
      father_name = case when name_words(full_name) < 3 or not is_arabic_name(full_name) then w[2] else father_name end,
      family_name = case when name_words(full_name) < 3 or not is_arabic_name(full_name) then array_to_string(w[3:], ' ') else family_name end
    where id = pid;
  else
    insert into patients (file_no, full_name, first_name, father_name, family_name, phone, email, referral_source)
    values ('', nm, w[1], w[2], array_to_string(w[3:], ' '), p_phone, coalesce(trim(p_email), ''), 'website') returning id into pid;
  end if;
  insert into customers (auth_user_id, patient_id, name, phone, email) values (p_auth_user, pid, nm, p_phone, nullif(trim(coalesce(p_email, '')), '')) returning id into cid;
  insert into audit_logs (user_id, action, table_name, record_id, new_data)
    values (p_auth_user, 'register', 'customers', cid::text, jsonb_build_object('phone', p_phone, 'linkedExisting', linked));
  return jsonb_build_object('customerId', cid, 'patientId', pid);
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

CREATE OR REPLACE FUNCTION public.save_item(p jsonb)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare v uuid := _uuid(p, 'id'); q numeric := _num(p, 'quantity', 0);
begin
  perform require_perm('inventory', case when v is null then 'create' else 'edit' end);
  if _txt(p, 'name') = '' then raise exception 'اسم الصنف مطلوب'; end if;
  if _num(p, 'minQuantity') < 0 or _num(p, 'costPrice') < 0 or _num(p, 'salePrice') < 0 or q < 0 then raise exception 'القيم الرقمية ما ينفع تكون سالبة'; end if;
  if v is null then
    insert into inventory_items (sku, name, category, unit, quantity, min_quantity, cost_price, sale_price, supplier, active)
    values (next_counter('item', 'SKU-'), _txt(p, 'name'), _txt(p, 'category'), _txt(p, 'unit', 'قطعة'), q, _num(p, 'minQuantity'),
            _num(p, 'costPrice'), _num(p, 'salePrice'), _txt(p, 'supplier'), coalesce((p->>'active')::boolean, true)) returning id into v;
    if q > 0 then
      insert into stock_movements (item_id, type, quantity, unit_cost, reference, employee_id) values (v, 'purchase', q, _num(p, 'costPrice'), 'رصيد افتتاحي', my_employee_id());
    end if;
  else
    update inventory_items set name = _txt(p, 'name'), category = _txt(p, 'category'), unit = _txt(p, 'unit', 'قطعة'), min_quantity = _num(p, 'minQuantity'),
      cost_price = _num(p, 'costPrice'), sale_price = _num(p, 'salePrice'), supplier = _txt(p, 'supplier'),
      active = coalesce((p->>'active')::boolean, active), updated_at = now() where id = v;
  end if;
  perform log_action(case when _uuid(p, 'id') is null then 'إضافة' else 'تعديل' end || ' صنف مخزون: ' || _txt(p, 'name'));
  return jsonb_build_object('id', v);
end $function$;
