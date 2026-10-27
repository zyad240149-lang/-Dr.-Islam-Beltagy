-- ===================================================================
-- 003 — منطق العمل على الخادم (RPC). كل دالة: تتحقق من الهوية والصلاحية،
-- تتحقق من صحة المدخلات، تنفّذ العملية كاملة داخل Transaction، وتسجل في activity_log.
-- الأخطاء ترجع برسالة عربية واضحة (raise exception) تظهر للمستخدم كما هي.
-- ===================================================================

create or replace function _txt(p jsonb, k text, d text default '') returns text
language sql immutable as $$ select coalesce(nullif(trim(p->>k), ''), d) $$;
create or replace function _uuid(p jsonb, k text) returns uuid
language sql immutable as $$ select nullif(trim(p->>k), '')::uuid $$;
create or replace function _num(p jsonb, k text, d numeric default 0) returns numeric
language sql immutable as $$ select coalesce(nullif(trim(p->>k), '')::numeric, d) $$;

create or replace function require_any(p_pairs text[]) returns uuid
language plpgsql stable security definer set search_path = public as $$
declare v uuid := my_employee_id(); i int;
begin
  if v is null then raise exception 'غير مصرح — سجّل الدخول بحساب موظف' using errcode = '42501'; end if;
  for i in 1..array_length(p_pairs, 1) loop
    if has_perm(split_part(p_pairs[i], ':', 1), split_part(p_pairs[i], ':', 2)) then return v; end if;
  end loop;
  raise exception 'لا توجد صلاحية لهذه العملية' using errcode = '42501';
end $$;

-- ===================================================================
-- التوفر ومنع التعارض
-- ===================================================================
create or replace function check_slot(p_therapist uuid, p_date date, p_time text, p_dur int, p_exclude uuid default null) returns void
language plpgsql security definer set search_path = public as $$
declare d text := lower(to_char(p_date, 'Dy')); sched jsonb; th therapists; wh jsonb;
begin
  if p_time !~ '^\d{2}:\d{2}$' then raise exception 'صيغة الوقت غير صحيحة'; end if;
  if p_date < riyadh_today() then raise exception 'لا يمكن الحجز في تاريخ سابق'; end if;
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

  perform pg_advisory_xact_lock(hashtext(p_therapist::text || p_date::text));
  if exists (select 1 from appointments a
             where a.therapist_id = p_therapist and a.date = p_date and a.status <> 'cancelled' and a.id is distinct from p_exclude
               and p_time::time < a.time::time + make_interval(mins => a.duration_min)
               and a.time::time < p_time::time + make_interval(mins => p_dur)) then
    raise exception 'المعالج لديه موعد آخر في هذا الوقت';
  end if;
end $$;

-- ===================================================================
-- الفواتير
-- ===================================================================
create or replace function recalc_invoice(p_id uuid) returns void
language plpgsql security definer set search_path = public as $$
declare base numeric;
begin
  update invoices i set paid = coalesce((select sum(amount) from payments where invoice_id = i.id), 0) where id = p_id;
  select greatest(price - discount, 0) into base from invoices where id = p_id;
  update invoices set
    tax_amount = round(base * tax_rate / 100, 2),
    total = base + round(base * tax_rate / 100, 2)
  where id = p_id;
  update invoices set
    remaining = greatest(total - paid, 0),
    status = case when status in ('cancelled','draft') then status
                  when greatest(total - paid, 0) = 0 then 'paid'
                  when paid > 0 then 'partial' else 'due' end
  where id = p_id;
end $$;

create or replace function new_invoice(p_patient uuid, p_name text, p_price numeric, p_status text, p_date date,
  p_appt uuid default null, p_package uuid default null, p_plan uuid default null, p_service text default null) returns uuid
language plpgsql security definer set search_path = public as $$
declare v uuid;
begin
  insert into invoices (no, patient_id, appointment_id, package_id, plan_id, service_name, price, status, date, tax_rate, created_by)
  values (next_counter('invoice', 'INV-'), p_patient, p_appt, p_package, p_plan, p_name, p_price, p_status, p_date,
          (select tax_rate from center_info limit 1), my_employee_id())
  returning id into v;
  insert into invoice_items (invoice_id, service_id, description, qty, unit_price) values (v, p_service, p_name, 1, p_price);
  perform recalc_invoice(v);
  return v;
end $$;

create or replace function create_invoice(p jsonb) returns jsonb
language plpgsql security definer set search_path = public as $$
declare v uuid; pat patients; it jsonb; subtotal numeric := 0; names text := ''; disc numeric := _num(p, 'discount');
begin
  perform require_perm('invoices', 'create');
  select * into pat from patients where id = _uuid(p, 'patientId');
  if pat.id is null then raise exception 'اختر المريض'; end if;
  if jsonb_typeof(p->'items') <> 'array' or jsonb_array_length(p->'items') = 0 then raise exception 'أضف بندًا واحدًا على الأقل'; end if;
  for it in select * from jsonb_array_elements(p->'items') loop
    if _txt(it, 'description') = '' then raise exception 'وصف البند مطلوب'; end if;
    if _num(it, 'qty', 1) <= 0 or _num(it, 'unitPrice', -1) < 0 then raise exception 'تحقق من كمية وسعر البند «%»', _txt(it, 'description'); end if;
    subtotal := subtotal + _num(it, 'qty', 1) * _num(it, 'unitPrice');
    names := names || case when names = '' then '' else '، ' end || _txt(it, 'description');
  end loop;
  if disc < 0 or disc > subtotal then raise exception 'قيمة الخصم غير صحيحة'; end if;
  insert into invoices (no, patient_id, appointment_id, plan_id, service_name, price, discount, status, date, tax_rate, note, created_by)
  values (next_counter('invoice', 'INV-'), pat.id, _uuid(p, 'appointmentId'), _uuid(p, 'planId'), left(names, 300), subtotal, disc, 'due',
          coalesce(nullif(p->>'date', '')::date, riyadh_today()), (select tax_rate from center_info limit 1), _txt(p, 'note'), my_employee_id())
  returning id into v;
  insert into invoice_items (invoice_id, service_id, description, qty, unit_price)
  select v, nullif(e->>'serviceId', ''), trim(e->>'description'), coalesce(nullif(e->>'qty', '')::numeric, 1), (e->>'unitPrice')::numeric
  from jsonb_array_elements(p->'items') e;
  perform recalc_invoice(v);
  perform log_action('إصدار فاتورة يدوية ' || (select no from invoices where id = v) || ' بقيمة ' || subtotal || ' ر.س', pat.id);
  perform notify_patient(pat.id, 'invoice', 'فاتورة جديدة', 'تم إصدار فاتورة بقيمة ' || (select total from invoices where id = v) || ' ر.س', v::text);
  return jsonb_build_object('id', v);
end $$;

create or replace function record_payment(p_invoice uuid, p_amount numeric, p_method text, p_note text default '') returns void
language plpgsql security definer set search_path = public as $$
declare inv invoices;
begin
  perform require_perm('payments', 'create');
  select * into inv from invoices where id = p_invoice for update;
  if inv.id is null then raise exception 'الفاتورة غير موجودة'; end if;
  if inv.status = 'cancelled' then raise exception 'لا يمكن الدفع على فاتورة ملغاة'; end if;
  if inv.status = 'draft' then raise exception 'الفاتورة بانتظار المراجعة والاعتماد أولًا'; end if;
  if p_method not in ('cash','card','transfer') then raise exception 'طريقة الدفع غير صحيحة'; end if;
  if p_amount is null or p_amount <= 0 or p_amount > inv.remaining then raise exception 'المبلغ يجب أن يكون بين 1 و % ر.س', inv.remaining; end if;
  insert into payments (invoice_id, patient_id, amount, method, note, created_by) values (p_invoice, inv.patient_id, p_amount, p_method, coalesce(p_note, ''), my_employee_id());
  perform recalc_invoice(p_invoice);
  perform log_action('تسجيل دفعة ' || p_amount || ' ر.س على ' || inv.no, inv.patient_id);
end $$;

create or replace function update_payment(p_id uuid, p_amount numeric, p_method text, p_note text) returns void
language plpgsql security definer set search_path = public as $$
declare pay payments; inv invoices;
begin
  perform require_perm('payments', 'edit');
  select * into pay from payments where id = p_id;
  if pay.id is null then raise exception 'الدفعة غير موجودة'; end if;
  select * into inv from invoices where id = pay.invoice_id for update;
  if p_method not in ('cash','card','transfer') then raise exception 'طريقة الدفع غير صحيحة'; end if;
  if p_amount is null or p_amount <= 0 or p_amount > inv.remaining + pay.amount then
    raise exception 'المبلغ يجب أن يكون بين 1 و % ر.س', inv.remaining + pay.amount;
  end if;
  update payments set amount = p_amount, method = p_method, note = coalesce(p_note, '') where id = p_id;
  perform recalc_invoice(inv.id);
  perform log_action('تعديل دفعة على ' || inv.no || ' إلى ' || p_amount || ' ر.س', inv.patient_id);
end $$;

create or replace function delete_payment(p_id uuid) returns void
language plpgsql security definer set search_path = public as $$
declare pay payments;
begin
  perform require_perm('payments', 'delete');
  delete from payments where id = p_id returning * into pay;
  if pay.id is null then raise exception 'الدفعة غير موجودة'; end if;
  perform recalc_invoice(pay.invoice_id);
  perform log_action('حذف دفعة ' || pay.amount || ' ر.س من ' || (select no from invoices where id = pay.invoice_id), pay.patient_id);
end $$;

create or replace function apply_discount(p_invoice uuid, p_amount numeric) returns void
language plpgsql security definer set search_path = public as $$
declare inv invoices;
begin
  perform require_perm('invoices', 'edit');
  select * into inv from invoices where id = p_invoice for update;
  if inv.id is null then raise exception 'الفاتورة غير موجودة'; end if;
  if inv.status = 'cancelled' then raise exception 'الفاتورة ملغاة'; end if;
  if p_amount < 0 or p_amount > inv.price then raise exception 'قيمة الخصم غير صحيحة'; end if;
  if inv.price - p_amount < inv.paid then raise exception 'الإجمالي بعد الخصم أقل من المدفوع فعلًا'; end if;
  update invoices set discount = p_amount where id = p_invoice;
  perform recalc_invoice(p_invoice);
  perform log_action('خصم ' || p_amount || ' ر.س على ' || inv.no, inv.patient_id);
end $$;

create or replace function cancel_invoice(p_invoice uuid) returns void
language plpgsql security definer set search_path = public as $$
declare inv invoices;
begin
  perform require_perm('invoices', 'edit');
  select * into inv from invoices where id = p_invoice for update;
  if inv.id is null then raise exception 'الفاتورة غير موجودة'; end if;
  if inv.paid > 0 then raise exception 'على الفاتورة مدفوعات. احذف الدفعات أولًا'; end if;
  update invoices set status = 'cancelled' where id = p_invoice;
  perform log_action('إلغاء الفاتورة ' || inv.no, inv.patient_id);
end $$;

create or replace function delete_invoice(p_invoice uuid) returns void
language plpgsql security definer set search_path = public as $$
declare inv invoices;
begin
  perform require_perm('invoices', 'delete');
  select * into inv from invoices where id = p_invoice;
  if inv.id is null then raise exception 'الفاتورة غير موجودة'; end if;
  if exists (select 1 from payments where invoice_id = p_invoice) then raise exception 'على الفاتورة مدفوعات. احذف الدفعات أولًا'; end if;
  if inv.discount_code_id is not null then update discount_codes set used_count = greatest(used_count - 1, 0) where id = inv.discount_code_id; end if;
  delete from invoices where id = p_invoice;
  perform log_action('حذف الفاتورة ' || inv.no, inv.patient_id);
end $$;

create or replace function update_plan_invoice(p_invoice uuid, p_price numeric, p_discount numeric, p_note text, p_issue boolean) returns void
language plpgsql security definer set search_path = public as $$
declare inv invoices;
begin
  perform require_perm('invoices', 'edit');
  select * into inv from invoices where id = p_invoice for update;
  if inv.id is null then raise exception 'الفاتورة غير موجودة'; end if;
  if p_price < 0 or p_discount < 0 then raise exception 'السعر والخصم يجب ألا يكونا سالبين'; end if;
  if p_discount > p_price then raise exception 'الخصم لا يمكن أن يتجاوز السعر'; end if;
  if p_price - p_discount < inv.paid then raise exception 'الإجمالي لا يمكن أن يقل عن المدفوع (% ر.س)', inv.paid; end if;
  update invoices set price = p_price, discount = p_discount, note = trim(coalesce(p_note, '')),
    status = case when p_issue and status = 'draft' then 'due' else status end
  where id = p_invoice;
  update invoice_items set unit_price = p_price, qty = 1 where invoice_id = p_invoice
    and (select count(*) from invoice_items where invoice_id = p_invoice) = 1;
  if inv.plan_id is not null then update treatment_plans set price = p_price where id = inv.plan_id; end if;
  perform recalc_invoice(p_invoice);
  if p_issue and inv.status = 'draft' then
    perform notify_patient(inv.patient_id, 'invoice', 'فاتورة خطتك العلاجية', 'تم إصدار فاتورة بقيمة ' || (select total from invoices where id = p_invoice) || ' ر.س', p_invoice::text);
  end if;
  perform log_action(case when p_issue then 'اعتماد وإصدار' else 'تعديل' end || ' فاتورة الخطة العلاجية ' || inv.no, inv.patient_id);
end $$;

-- ===================================================================
-- أكواد الخصم
-- ===================================================================
create or replace function save_discount_code(p jsonb) returns jsonb
language plpgsql security definer set search_path = public as $$
declare v uuid := _uuid(p, 'id'); v_code text := upper(regexp_replace(coalesce(p->>'code', ''), '\s+', '', 'g')); ex discount_codes;
begin
  perform require_perm('discounts', case when v is null then 'create' else 'edit' end);
  if v_code !~ '^[A-Z0-9_-]{3,20}$' then raise exception 'الكود من 3 إلى 20 حرف إنجليزي أو رقم بدون مسافات'; end if;
  if exists (select 1 from discount_codes where code = v_code and id is distinct from v) then raise exception 'الكود مستخدم بالفعل'; end if;
  if p->>'type' not in ('percent','fixed') then raise exception 'نوع الخصم غير صحيح'; end if;
  if _num(p, 'value') <= 0 then raise exception 'قيمة الخصم يجب أن تكون أكبر من صفر'; end if;
  if p->>'type' = 'percent' and _num(p, 'value') > 100 then raise exception 'نسبة الخصم لا تتجاوز 100%%'; end if;
  if nullif(p->>'validFrom', '') is null or nullif(p->>'validTo', '') is null or (p->>'validFrom')::date > (p->>'validTo')::date then
    raise exception 'تحقق من تاريخ بداية ونهاية الصلاحية';
  end if;
  if _num(p, 'maxUses') < 1 then raise exception 'عدد مرات الاستخدام يجب ألا يقل عن 1'; end if;
  if v is not null then
    select * into ex from discount_codes where id = v for update;
    if ex.id is null then raise exception 'الكود غير موجود'; end if;
    if _num(p, 'maxUses') < ex.used_count then raise exception 'الكود استُخدم % مرات بالفعل', ex.used_count; end if;
    update discount_codes set code = v_code, type = p->>'type', value = _num(p, 'value'),
      valid_from = (p->>'validFrom')::date, valid_to = (p->>'validTo')::date, max_uses = _num(p, 'maxUses')::int,
      active = coalesce((p->>'active')::boolean, true), note = _txt(p, 'note') where id = v;
  else
    insert into discount_codes (code, type, value, valid_from, valid_to, max_uses, active, note, created_by)
    values (v_code, p->>'type', _num(p, 'value'), (p->>'validFrom')::date, (p->>'validTo')::date, _num(p, 'maxUses')::int,
            coalesce((p->>'active')::boolean, true), _txt(p, 'note'), my_employee_id()) returning id into v;
  end if;
  perform log_action(case when ex.id is null then 'إنشاء' else 'تعديل' end || ' كود خصم ' || v_code);
  return jsonb_build_object('id', v);
end $$;

create or replace function delete_discount_code(p_id uuid) returns void
language plpgsql security definer set search_path = public as $$
declare dc discount_codes;
begin
  perform require_perm('discounts', 'delete');
  select * into dc from discount_codes where id = p_id;
  if dc.id is null then raise exception 'الكود غير موجود'; end if;
  if dc.used_count > 0 or exists (select 1 from invoices where discount_code_id = p_id) then raise exception 'الكود مستخدم في فواتير — أوقفه بدل حذفه'; end if;
  delete from discount_codes where id = p_id;
  perform log_action('حذف كود خصم ' || dc.code);
end $$;

create or replace function apply_discount_code(p_invoice uuid, p_code text) returns jsonb
language plpgsql security definer set search_path = public as $$
declare inv invoices; dc discount_codes; amount numeric; t date := riyadh_today();
begin
  perform require_perm('invoices', 'edit');
  select * into inv from invoices where id = p_invoice for update;
  if inv.id is null then raise exception 'الفاتورة غير موجودة'; end if;
  if inv.status = 'cancelled' then raise exception 'الفاتورة ملغاة'; end if;
  if inv.discount_code is not null then raise exception 'تم تطبيق الكود % على هذه الفاتورة بالفعل', inv.discount_code; end if;
  select * into dc from discount_codes where code = upper(trim(p_code)) for update;
  if dc.id is null then raise exception 'كود الخصم غير صحيح'; end if;
  if not dc.active then raise exception 'كود الخصم موقوف'; end if;
  if dc.used_count >= dc.max_uses then raise exception 'تم استهلاك كل مرات استخدام الكود'; end if;
  if t < dc.valid_from then raise exception 'الكود يبدأ من %', dc.valid_from; end if;
  if t > dc.valid_to then raise exception 'انتهت صلاحية الكود في %', dc.valid_to; end if;
  amount := least(inv.price, case when dc.type = 'percent' then round(inv.price * dc.value / 100) else dc.value end);
  if inv.price - amount < inv.paid then raise exception 'الإجمالي بعد الخصم أقل من المدفوع فعلًا'; end if;
  update invoices set discount = amount, discount_code = dc.code, discount_code_id = dc.id where id = p_invoice;
  update discount_codes set used_count = used_count + 1 where id = dc.id;
  perform recalc_invoice(p_invoice);
  perform log_action('تطبيق كود الخصم ' || dc.code || ' (' || amount || ' ر.س) على ' || inv.no, inv.patient_id);
  return jsonb_build_object('amount', amount);
end $$;

-- ===================================================================
-- المواعيد
-- ===================================================================
create or replace function active_plan_id(p_patient uuid) returns uuid
language sql stable security definer set search_path = public as $$
  select id from treatment_plans where patient_id = p_patient and status = 'active' order by start_date desc limit 1
$$;

create or replace function book_appointment(p jsonb) returns jsonb
language plpgsql security definer set search_path = public as $$
declare svc services; pat patients; th uuid := _uuid(p, 'therapistId'); d date; tm text := _txt(p, 'time');
  loc text := _txt(p, 'location', 'center'); plan treatment_plans; pkg uuid := _uuid(p, 'packageId'); a appointments;
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

  if pkg is not null and not exists (select 1 from packages where id = pkg and patient_id = pat.id and status = 'active' and used_sessions < total_sessions) then
    raise exception 'الباقة غير صالحة لهذا المريض';
  end if;
  if p ? 'planId' then select * into plan from treatment_plans where id = _uuid(p, 'planId') and patient_id = pat.id;
  else select * into plan from treatment_plans where id = active_plan_id(pat.id); end if;

  insert into appointments (no, patient_id, type, service_id, therapist_id, location, address, date, time, duration_min, status, price,
                            package_id, plan_id, series_id, branch_id, created_by)
  values (next_counter('appointment', 'MV-'), pat.id, case when loc = 'home' then 'home' else _txt(p, 'type', 'session') end, svc.id, th, loc,
          case when loc = 'home' then _txt(p, 'address') else '' end, d, tm, svc.duration_min, 'new', svc.price,
          pkg, plan.id, _uuid(p, 'seriesId'),
          coalesce(_uuid(p, 'branchId'), (select branch_id from therapists where id = th), (select id from branches order by created_at limit 1)),
          my_employee_id())
  returning * into a;

  if pkg is null and not coalesce(plan.price, 0) > 0 then
    perform new_invoice(pat.id, svc.name, svc.price, 'due', d, a.id, null, null, svc.id);
  end if;
  perform notify_staff('appointment_new', case when loc = 'home' then 'تم حجز زيارة منزلية' else 'تم إنشاء موعد جديد' end,
    pat.full_name || ' — ' || svc.name || ' — ' || d || ' ' || tm, a.no, '/appointments', pat.id);
  perform notify_patient(pat.id, 'appointment_new', 'تم حجز موعدك', svc.name || ' يوم ' || d || ' الساعة ' || tm, a.id::text);
  perform log_action('حجز موعد ' || a.no || ' — ' || svc.name || ' بتاريخ ' || d || ' ' || tm, pat.id);
  return jsonb_build_object('id', a.id, 'no', a.no);
end $$;

create or replace function set_appointment_status(p_id uuid, p_status text, p_reason text default null) returns void
language plpgsql security definer set search_path = public as $$
declare a appointments; pname text; label text;
begin
  perform require_any(array['appointments:edit', 'sessions:edit']);
  select * into a from appointments where id = p_id for update;
  if a.id is null or not can_see_patient(a.patient_id) then raise exception 'الموعد غير موجود'; end if;
  if p_status not in ('new','confirmed','on_way','arrived','no_show','completed','cancelled','rescheduled') then raise exception 'حالة غير صحيحة'; end if;
  if a.status = 'cancelled' and p_status <> 'cancelled' then raise exception 'الموعد ملغي — أنشئ موعدًا جديدًا'; end if;
  if p_status = 'cancelled' and coalesce(trim(p_reason), '') = '' then raise exception 'اكتب سبب الإلغاء'; end if;
  update appointments set status = p_status, updated_at = now(),
    cancel_reason = case when p_status = 'cancelled' then trim(p_reason) else cancel_reason end
  where id = p_id;
  select full_name into pname from patients where id = a.patient_id;
  if p_status = 'cancelled' then
    update invoices set status = 'cancelled' where appointment_id = p_id and paid = 0 and status <> 'cancelled';
    perform notify_staff('appointment_cancelled', 'تم إلغاء موعد', pname || ' — ' || a.no, a.no, '/appointments', a.patient_id);
    perform notify_patient(a.patient_id, 'appointment_cancelled', 'تم إلغاء موعدك', 'موعد ' || a.date || ' الساعة ' || a.time || ' — السبب: ' || trim(p_reason), a.id::text);
  elsif p_status = 'confirmed' then
    perform notify_patient(a.patient_id, 'appointment_confirmed', 'تم تأكيد موعدك', 'موعدك يوم ' || a.date || ' الساعة ' || a.time || ' مؤكد', a.id::text);
  elsif p_status = 'no_show' then
    perform notify_staff('no_show', 'مريض لم يحضر', pname || ' لم يحضر موعده ' || a.no || ' (' || a.date || ' ' || a.time || ')', a.no, '/appointments', a.patient_id);
  elsif p_status = 'on_way' then
    perform notify_patient(a.patient_id, 'visit_on_way', 'المعالج في الطريق إليك', 'زيارتك المنزلية اليوم الساعة ' || a.time, a.id::text);
  end if;
  label := case p_status when 'confirmed' then 'تأكيد' when 'on_way' then 'خروج المعالج للزيارة' when 'arrived' then 'تسجيل حضور'
    when 'no_show' then 'تسجيل عدم حضور' when 'cancelled' then 'إلغاء' when 'completed' then 'إكمال' when 'new' then 'إعادة إلى جديد' else 'تحديث' end;
  perform log_action(label || ' الموعد ' || a.no || coalesce(' — السبب: ' || nullif(trim(p_reason), ''), ''), a.patient_id);
end $$;

create or replace function reschedule_appointment(p_id uuid, p_date date, p_time text, p_therapist uuid default null, p_address text default null) returns void
language plpgsql security definer set search_path = public as $$
declare a appointments; th uuid;
begin
  perform require_perm('appointments', 'edit');
  select * into a from appointments where id = p_id for update;
  if a.id is null or not can_see_patient(a.patient_id) then raise exception 'الموعد غير موجود'; end if;
  if a.status in ('cancelled','completed') then raise exception 'لا يمكن تغيير موعد ملغي أو مكتمل'; end if;
  th := coalesce(p_therapist, a.therapist_id);
  if not exists (select 1 from therapist_services where therapist_id = th and service_id = a.service_id) then raise exception 'المعالج لا يقدم خدمة هذا الموعد'; end if;
  perform check_slot(th, p_date, p_time, a.duration_min, p_id);
  update appointments set date = p_date, time = p_time, therapist_id = th, status = 'rescheduled', updated_at = now(),
    address = case when location = 'home' and p_address is not null then trim(p_address) else address end
  where id = p_id;
  update invoices set date = p_date where appointment_id = p_id and status in ('due','draft');
  perform notify_staff('appointment_rescheduled', 'تم تغيير موعد', (select full_name from patients where id = a.patient_id) || ' — ' || a.no || ' إلى ' || p_date || ' ' || p_time, a.no, '/appointments', a.patient_id);
  perform notify_patient(a.patient_id, 'appointment_rescheduled', 'تم تغيير موعدك', 'موعدك الجديد يوم ' || p_date || ' الساعة ' || p_time, a.id::text);
  perform log_action('إعادة جدولة الموعد ' || a.no || ' إلى ' || p_date || ' ' || p_time, a.patient_id);
end $$;

create or replace function delete_appointment(p_id uuid) returns void
language plpgsql security definer set search_path = public as $$
declare a appointments;
begin
  perform require_perm('appointments', 'delete');
  select * into a from appointments where id = p_id;
  if a.id is null then raise exception 'الموعد غير موجود'; end if;
  if exists (select 1 from treatment_sessions where appointment_id = p_id) then raise exception 'للموعد جلسة مسجلة. احذف الجلسة أولًا'; end if;
  if exists (select 1 from payments pay join invoices i on i.id = pay.invoice_id where i.appointment_id = p_id) then
    raise exception 'فاتورة الموعد عليها مدفوعات. احذف المدفوعات أو ألغِ الموعد بدل حذفه';
  end if;
  delete from invoices where appointment_id = p_id;
  delete from appointments where id = p_id;
  perform log_action('حذف الموعد ' || a.no, a.patient_id);
end $$;

-- ===================================================================
-- الخطط والجلسات
-- ===================================================================
create or replace function recalc_plan(p_plan uuid) returns void
language plpgsql security definer set search_path = public as $$
declare pl treatment_plans; done int;
begin
  select * into pl from treatment_plans where id = p_plan;
  if pl.id is null then return; end if;
  select count(*) into done from treatment_sessions where plan_id = p_plan and status = 'completed';
  update treatment_plans set progress_pct = case when total_sessions > 0 then least(100, round(done * 100.0 / total_sessions)) else 0 end where id = p_plan;
  if done >= pl.total_sessions and pl.status = 'active' then
    update treatment_plans set status = 'completed' where id = p_plan;
    perform notify_staff('user', 'اكتملت خطة علاجية', (select full_name from patients where id = pl.patient_id) || ' أكمل كل جلسات خطة «' || pl.diagnosis || '»', p_plan::text, '/patients/' || pl.patient_id, pl.patient_id);
    perform notify_patient(pl.patient_id, 'plan_completed', 'أكملت خطتك العلاجية 🎉', 'أكملت ' || pl.total_sessions || ' جلسات — نتمنى لك دوام الصحة', p_plan::text);
  end if;
end $$;

create or replace function save_plan(p jsonb) returns jsonb
language plpgsql security definer set search_path = public as $$
declare v uuid := _uuid(p, 'id'); pat patients; ex treatment_plans; svc services; start_d date; weeks int; v_total int; v_price numeric;
  me_row employees := me(); th uuid; inv uuid;
begin
  perform require_perm('plans', case when v is null then 'create' else 'edit' end);
  select * into pat from patients where id = _uuid(p, 'patientId');
  if pat.id is null or not can_see_patient(pat.id) then raise exception 'اختر المريض'; end if;
  select * into svc from services where id = nullif(p->>'serviceId', '');
  if svc.id is null then raise exception 'اختر الخدمة'; end if;
  if _txt(p, 'diagnosis') = '' then raise exception 'اكتب التشخيص'; end if;
  v_total := _num(p, 'totalSessions', 0)::int; weeks := _num(p, 'durationWeeks', 1)::int; v_price := _num(p, 'price', 0);
  if v_total < 1 or v_total > 200 then raise exception 'عدد الجلسات غير صحيح'; end if;
  if weeks < 1 then raise exception 'مدة الخطة غير صحيحة'; end if;
  if v_price < 0 then raise exception 'السعر لا يمكن أن يكون سالبًا'; end if;
  start_d := coalesce(nullif(p->>'startDate', '')::date, riyadh_today());
  th := coalesce(_uuid(p, 'therapistId'), me_row.therapist_id);
  if p->>'status' is not null and p->>'status' not in ('active','completed','paused') then raise exception 'حالة الخطة غير صحيحة'; end if;

  if v is not null then
    select * into ex from treatment_plans where id = v for update;
    if ex.id is null then raise exception 'الخطة غير موجودة'; end if;
    update treatment_plans set service_id = svc.id, diagnosis = _txt(p, 'diagnosis'),
      diagnosis_condition_id = nullif(p #>> '{diagnosisRef,conditionId}', ''), diagnosis_side = nullif(p #>> '{diagnosisRef,side}', ''),
      main_goal = _txt(p, 'mainGoal'), short_term_goals = _txt(p, 'shortTermGoals'), long_term_goals = _txt(p, 'longTermGoals'),
      total_sessions = v_total, sessions_per_week = _num(p, 'sessionsPerWeek', 2)::int, duration_weeks = weeks,
      therapy_type = _txt(p, 'therapyType'), exercises = _txt(p, 'exercises'), devices = _txt(p, 'devices'),
      therapist_notes = _txt(p, 'therapistNotes'), notes = _txt(p, 'notes'), price = v_price,
      start_date = start_d, end_date = start_d + weeks * 7, status = coalesce(nullif(p->>'status', ''), status), therapist_id = th
    where id = v;
  else
    insert into treatment_plans (patient_id, service_id, diagnosis, diagnosis_condition_id, diagnosis_side, main_goal, short_term_goals, long_term_goals,
      total_sessions, sessions_per_week, duration_weeks, therapy_type, exercises, devices, therapist_notes, notes, price, start_date, end_date,
      status, therapist_id, created_by)
    values (pat.id, svc.id, _txt(p, 'diagnosis'), nullif(p #>> '{diagnosisRef,conditionId}', ''), nullif(p #>> '{diagnosisRef,side}', ''),
      _txt(p, 'mainGoal'), _txt(p, 'shortTermGoals'), _txt(p, 'longTermGoals'), v_total, _num(p, 'sessionsPerWeek', 2)::int, weeks,
      _txt(p, 'therapyType'), _txt(p, 'exercises'), _txt(p, 'devices'), _txt(p, 'therapistNotes'), _txt(p, 'notes'), v_price, start_d, start_d + weeks * 7,
      coalesce(nullif(p->>'status', ''), 'active'), th, me_row.id)
    returning id into v;
    if v_price > 0 then
      inv := new_invoice(pat.id, 'خطة علاج: ' || svc.name || ' (' || v_total || ' جلسات)', v_price, 'draft', start_d, null, null, v, svc.id);
      perform notify_staff('payment_due', 'فاتورة خطة علاجية بانتظار المراجعة', pat.full_name || ' — ' || svc.name || ' (' || v_total || ' جلسات)', v::text, '/invoices?tab=plans', pat.id);
    end if;
    update appointments set plan_id = v where patient_id = pat.id and plan_id is null and date >= start_d
      and status in ('new','confirmed','on_way','arrived','rescheduled');
    perform notify_patient(pat.id, 'plan_new', 'خطة علاجية جديدة', svc.name || ' — ' || v_total || ' جلسات تبدأ ' || start_d, v::text);
  end if;
  perform recalc_plan(v);
  perform log_action(case when ex.id is null then 'إنشاء' else 'تعديل' end || ' خطة علاجية — ' || _txt(p, 'diagnosis') || ' (' || v_total || ' جلسات)', pat.id);
  return jsonb_build_object('id', v);
end $$;

create or replace function delete_plan(p_id uuid) returns void
language plpgsql security definer set search_path = public as $$
declare pl treatment_plans;
begin
  perform require_perm('plans', 'delete');
  select * into pl from treatment_plans where id = p_id;
  if pl.id is null then raise exception 'الخطة غير موجودة'; end if;
  if exists (select 1 from payments pay join invoices i on i.id = pay.invoice_id where i.plan_id = p_id) then
    raise exception 'فاتورة الخطة عليها مدفوعات — لا يمكن حذف الخطة. أوقفها بدل حذفها';
  end if;
  delete from invoices where plan_id = p_id and status in ('draft','due','cancelled');
  update appointments set plan_id = null where plan_id = p_id;
  update treatment_sessions set plan_id = null where plan_id = p_id;
  delete from treatment_plans where id = p_id;
  perform log_action('حذف خطة علاجية — ' || pl.diagnosis, pl.patient_id);
end $$;

create or replace function start_session(p_appointment uuid) returns jsonb
language plpgsql security definer set search_path = public as $$
declare a appointments; s treatment_sessions;
begin
  perform require_perm('sessions', 'create');
  select * into s from treatment_sessions where appointment_id = p_appointment;
  if s.id is not null then return jsonb_build_object('id', s.id); end if;
  select * into a from appointments where id = p_appointment for update;
  if a.id is null or not can_see_patient(a.patient_id) then raise exception 'الموعد غير موجود'; end if;
  if a.status in ('cancelled','no_show') then raise exception 'لا يمكن بدء جلسة لموعد ملغي أو لم يحضر'; end if;
  update appointments set status = 'arrived', updated_at = now() where id = a.id;
  insert into treatment_sessions (appointment_id, patient_id, therapist_id, plan_id, session_no, date, status, started_at)
  values (a.id, a.patient_id, a.therapist_id, a.plan_id, (select count(*) + 1 from treatment_sessions where patient_id = a.patient_id), a.date, 'in_progress', now())
  returning * into s;
  perform log_action('بدء الجلسة رقم ' || s.session_no || ' (' || a.no || ')', a.patient_id);
  return jsonb_build_object('id', s.id);
end $$;

create or replace function update_session(p_id uuid, p jsonb) returns void
language plpgsql security definer set search_path = public as $$
declare s treatment_sessions;
begin
  perform require_perm('sessions', 'edit');
  select * into s from treatment_sessions where id = p_id for update;
  if s.id is null or not can_see_patient(s.patient_id) then raise exception 'الجلسة غير موجودة'; end if;
  if p ? 'painLevel' and nullif(p->>'painLevel', '') is not null and ((p->>'painLevel')::int < 0 or (p->>'painLevel')::int > 10) then
    raise exception 'مستوى الألم من 0 إلى 10';
  end if;
  update treatment_sessions set
    pain_level = case when p ? 'painLevel' then nullif(p->>'painLevel', '')::int else pain_level end,
    therapist_notes = coalesce(p->>'therapistNotes', therapist_notes), treatment_used = coalesce(p->>'treatmentUsed', treatment_used),
    devices_used = coalesce(p->>'devicesUsed', devices_used), exercises = coalesce(p->>'exercises', exercises),
    patient_response = coalesce(p->>'patientResponse', patient_response), next_plan = coalesce(p->>'nextPlan', next_plan)
  where id = p_id;
  perform log_action('تحديث بيانات الجلسة رقم ' || s.session_no, s.patient_id);
end $$;

create or replace function complete_session(p_id uuid, p jsonb default '{}') returns void
language plpgsql security definer set search_path = public as $$
declare s treatment_sessions; a appointments; pkg packages; left_n int; thr int;
begin
  perform require_perm('sessions', 'edit');
  select * into s from treatment_sessions where id = p_id for update;
  if s.id is null or not can_see_patient(s.patient_id) then raise exception 'الجلسة غير موجودة'; end if;
  if s.status = 'completed' then raise exception 'الجلسة مكتملة بالفعل'; end if;
  perform update_session(p_id, coalesce(p, '{}'));
  update treatment_sessions set status = 'completed', completed_at = now() where id = p_id;
  select * into a from appointments where id = s.appointment_id for update;
  if a.id is not null then
    update appointments set status = 'completed', updated_at = now() where id = a.id;
    if a.package_id is not null then
      select * into pkg from packages where id = a.package_id for update;
      if pkg.id is not null and pkg.used_sessions < pkg.total_sessions then
        update packages set used_sessions = used_sessions + 1,
          status = case when used_sessions + 1 >= total_sessions then 'completed' else status end
        where id = pkg.id;
        left_n := pkg.total_sessions - pkg.used_sessions - 1;
        select package_low_threshold into thr from center_info limit 1;
        if left_n > 0 and left_n <= thr then
          perform notify_staff('package_low', 'باقة قاربت على النفاد', (select full_name from patients where id = pkg.patient_id) || ': تبقّى ' || left_n || ' جلسة', pkg.id::text, '/patients/' || pkg.patient_id, pkg.patient_id);
        end if;
      end if;
    end if;
  end if;
  if s.plan_id is not null then perform recalc_plan(s.plan_id); end if;
  perform notify_patient(s.patient_id, 'session_completed', 'اكتملت جلستك', 'تم تسجيل إكمال الجلسة رقم ' || s.session_no || ' — شكرًا لالتزامك', s.id::text);
  perform log_action('إكمال الجلسة رقم ' || s.session_no, s.patient_id);
end $$;

create or replace function complete_next_plan_session(p_plan uuid) returns jsonb
language plpgsql security definer set search_path = public as $$
declare pl treatment_plans; done int; sid uuid; nxt uuid;
begin
  perform require_any(array['sessions:edit', 'plans:edit']);
  select * into pl from treatment_plans where id = p_plan;
  if pl.id is null or not can_see_patient(pl.patient_id) then raise exception 'الخطة غير موجودة'; end if;
  select count(*) into done from treatment_sessions where plan_id = p_plan and status = 'completed';
  if done >= pl.total_sessions then raise exception 'كل جلسات الخطة مكتملة بالفعل'; end if;
  select id into sid from treatment_sessions where plan_id = p_plan and status in ('in_progress','scheduled') order by session_no limit 1;
  if sid is null then
    select id into nxt from appointments where plan_id = p_plan and status in ('new','confirmed','on_way','rescheduled','arrived') order by date, time limit 1;
    if nxt is not null then sid := (start_session(nxt)->>'id')::uuid;
    else
      insert into treatment_sessions (patient_id, therapist_id, plan_id, session_no, date, status, started_at)
      values (pl.patient_id, pl.therapist_id, p_plan, (select count(*) + 1 from treatment_sessions where patient_id = pl.patient_id), riyadh_today(), 'in_progress', now())
      returning id into sid;
    end if;
  end if;
  perform complete_session(sid, '{}');
  return jsonb_build_object('index', done + 1, 'total', pl.total_sessions);
end $$;

create or replace function delete_session(p_id uuid) returns void
language plpgsql security definer set search_path = public as $$
declare s treatment_sessions; a appointments;
begin
  perform require_perm('sessions', 'delete');
  select * into s from treatment_sessions where id = p_id;
  if s.id is null then raise exception 'الجلسة غير موجودة'; end if;
  select * into a from appointments where id = s.appointment_id;
  if a.id is not null and s.status = 'completed' then
    update appointments set status = 'arrived' where id = a.id;
    if a.package_id is not null then
      update packages set used_sessions = greatest(used_sessions - 1, 0), status = case when status = 'completed' then 'active' else status end where id = a.package_id;
    end if;
  end if;
  delete from treatment_sessions where id = p_id;
  if s.plan_id is not null then
    perform recalc_plan(s.plan_id);
    update treatment_plans set status = 'active' where id = s.plan_id and status = 'completed'
      and (select count(*) from treatment_sessions where plan_id = s.plan_id and status = 'completed') < total_sessions;
  end if;
  perform log_action('حذف الجلسة رقم ' || s.session_no, s.patient_id);
end $$;

-- ===================================================================
-- الباقات
-- ===================================================================
create or replace function sell_package(p_patient uuid, p_package_plan uuid) returns jsonb
language plpgsql security definer set search_path = public as $$
declare pp package_plans; v uuid;
begin
  perform require_perm('packages', 'create');
  select * into pp from package_plans where id = p_package_plan and active;
  if pp.id is null then raise exception 'الباقة غير متاحة'; end if;
  if not exists (select 1 from patients where id = p_patient) then raise exception 'اختر المريض'; end if;
  insert into packages (patient_id, name, service_ids, total_sessions, price, start_date, expiry_date, status)
  values (p_patient, pp.name, pp.service_ids, pp.total_sessions, pp.price, riyadh_today(), riyadh_today() + pp.valid_days, 'active') returning id into v;
  perform new_invoice(p_patient, pp.name, pp.price, 'due', riyadh_today(), null, v, null, null);
  perform log_action('بيع ' || pp.name || ' بقيمة ' || pp.price || ' ر.س', p_patient);
  return jsonb_build_object('id', v);
end $$;

create or replace function cancel_package(p_id uuid) returns void
language plpgsql security definer set search_path = public as $$
declare pk packages; a record;
begin
  perform require_perm('packages', 'edit');
  select * into pk from packages where id = p_id for update;
  if pk.id is null then raise exception 'الباقة غير موجودة'; end if;
  update packages set status = 'cancelled' where id = p_id;
  update invoices set status = 'cancelled' where package_id = p_id and paid = 0;
  for a in select ap.*, s.name as svc_name from appointments ap join services s on s.id = ap.service_id
           where ap.package_id = p_id and ap.status in ('new','confirmed','on_way','arrived','rescheduled') loop
    update appointments set package_id = null where id = a.id;
    perform new_invoice(a.patient_id, a.svc_name, a.price, 'due', a.date, a.id, null, null, a.service_id);
  end loop;
  perform log_action('إلغاء ' || pk.name, pk.patient_id);
end $$;

-- ===================================================================
-- المرضى / المعالجون / الخدمات
-- ===================================================================
create or replace function delete_patient(p_id uuid) returns void
language plpgsql security definer set search_path = public as $$
declare pat patients;
begin
  perform require_perm('patients', 'delete');
  select * into pat from patients where id = p_id;
  if pat.id is null then raise exception 'المريض غير موجود'; end if;
  if exists (select 1 from payments where patient_id = p_id) then raise exception 'لا يمكن حذف مريض لديه مدفوعات مسجّلة — عطّل الملف بدل حذفه'; end if;
  update customers set patient_id = null where patient_id = p_id;
  delete from patients where id = p_id;
  perform log_action('حذف ملف المريض ' || pat.full_name || ' (' || pat.file_no || ')');
end $$;

create or replace function save_therapist(p jsonb) returns jsonb
language plpgsql security definer set search_path = public as $$
declare v uuid := _uuid(p, 'id'); w jsonb;
begin
  perform require_perm('therapists', case when v is null then 'create' else 'edit' end);
  if length(_txt(p, 'name')) < 2 then raise exception 'اسم المعالج مطلوب'; end if;
  for w in select * from jsonb_array_elements(coalesce(p->'workHours', '[]')) loop
    if (w->>'from') >= (w->>'to') then raise exception 'وقت بداية الدوام يجب أن يسبق نهايته'; end if;
  end loop;
  if v is null then
    insert into therapists (name, title, phone, photo, work_hours, on_leave, active, branch_id)
    values (_txt(p, 'name'), _txt(p, 'title'), _txt(p, 'phone'), _txt(p, 'photo'), coalesce(p->'workHours', '[]'), coalesce(p->'onLeave', '[]'),
            coalesce((p->>'active')::boolean, true), coalesce(_uuid(p, 'branchId'), (select id from branches order by created_at limit 1)))
    returning id into v;
  else
    update therapists set name = _txt(p, 'name'), title = _txt(p, 'title'), phone = _txt(p, 'phone'), photo = _txt(p, 'photo', photo),
      work_hours = coalesce(p->'workHours', work_hours), on_leave = coalesce(p->'onLeave', on_leave),
      active = coalesce((p->>'active')::boolean, active), branch_id = coalesce(_uuid(p, 'branchId'), branch_id)
    where id = v;
    if not found then raise exception 'المعالج غير موجود'; end if;
  end if;
  if p ? 'serviceIds' then
    delete from therapist_services where therapist_id = v;
    insert into therapist_services (therapist_id, service_id)
    select v, s from jsonb_array_elements_text(p->'serviceIds') s where exists (select 1 from services where id = s);
  end if;
  perform log_action(case when p ? 'id' and _uuid(p, 'id') is not null then 'تعديل' else 'إضافة' end || ' معالج: ' || _txt(p, 'name'));
  return jsonb_build_object('id', v);
end $$;

create or replace function delete_therapist(p_id uuid) returns void
language plpgsql security definer set search_path = public as $$
declare t therapists;
begin
  perform require_perm('therapists', 'delete');
  select * into t from therapists where id = p_id;
  if t.id is null then raise exception 'المعالج غير موجود'; end if;
  if exists (select 1 from appointments where therapist_id = p_id and status in ('new','confirmed','on_way','arrived','rescheduled') and date >= riyadh_today()) then
    raise exception 'للمعالج مواعيد قادمة. أعد جدولتها أو ألغها أولًا، أو عطّل المعالج بدل حذفه';
  end if;
  if exists (select 1 from appointments where therapist_id = p_id) or exists (select 1 from treatment_sessions where therapist_id = p_id) then
    update therapists set active = false where id = p_id;
    perform log_action('تعطيل المعالج (له سجلات سابقة): ' || t.name);
    return;
  end if;
  delete from therapists where id = p_id;
  perform log_action('حذف المعالج: ' || t.name);
end $$;

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
    insert into services (id, name, category, description, price, duration_min, active, branch_id)
    values (v, _txt(p, 'name'), _txt(p, 'category'), _txt(p, 'description'), _num(p, 'price'), _num(p, 'durationMin')::int,
            coalesce((p->>'active')::boolean, true), _uuid(p, 'branchId'));
  else
    update services set name = _txt(p, 'name'), category = _txt(p, 'category'), description = _txt(p, 'description'), price = _num(p, 'price'),
      duration_min = _num(p, 'durationMin')::int, active = coalesce((p->>'active')::boolean, active), branch_id = _uuid(p, 'branchId')
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

create or replace function delete_service(p_id text) returns void
language plpgsql security definer set search_path = public as $$
declare s services;
begin
  perform require_perm('services', 'delete');
  select * into s from services where id = p_id;
  if s.id is null then raise exception 'الخدمة غير موجودة'; end if;
  if exists (select 1 from appointments where service_id = p_id) or exists (select 1 from treatment_plans where service_id = p_id) then
    raise exception 'الخدمة مستخدمة في مواعيد أو خطط مسجلة. أوقفها بدل حذفها حفاظًا على السجلات';
  end if;
  update package_plans set service_ids = array_remove(service_ids, p_id) where p_id = any(service_ids);
  delete from services where id = p_id;
  perform log_action('حذف خدمة: ' || s.name);
end $$;

-- ===================================================================
-- الإعدادات والصلاحيات
-- ===================================================================
create or replace function update_week_schedule(p_schedule jsonb) returns void
language plpgsql security definer set search_path = public as $$
declare d jsonb;
begin
  perform require_any(array['workhours:edit', 'settings:edit']);
  if jsonb_typeof(p_schedule) <> 'array' or jsonb_array_length(p_schedule) <> 7 then raise exception 'جدول الأسبوع غير صحيح'; end if;
  for d in select * from jsonb_array_elements(p_schedule) loop
    if (d->>'open')::boolean and (d->>'from') >= (d->>'to') then raise exception 'وقت البداية يجب أن يسبق وقت النهاية في كل يوم مفتوح'; end if;
  end loop;
  update center_info set week_schedule = p_schedule,
    work_start = coalesce((select min(e.value->>'from') from jsonb_array_elements(p_schedule) e where (e.value->>'open')::boolean), work_start),
    work_end = coalesce((select max(e.value->>'to') from jsonb_array_elements(p_schedule) e where (e.value->>'open')::boolean), work_end)
  where id = 1;
end $$;

create or replace function save_permissions(p_matrix jsonb) returns void
language plpgsql security definer set search_path = public as $$
declare r text; a text;
begin
  perform require_perm('roles', 'edit');
  for r in select jsonb_object_keys(p_matrix) loop
    continue when r = 'system_admin';
    if r not in ('center_manager','secretary','therapist','reception','accountant') then raise exception 'دور غير معروف: %', r; end if;
    delete from role_permissions where role = r;
    for a in select jsonb_object_keys(p_matrix->r) loop
      insert into role_permissions (role, area, ops)
      select r, a, coalesce(array_agg(o) filter (where o in ('view','create','edit','delete')), '{}')
      from jsonb_array_elements_text(p_matrix->r->a) o;
    end loop;
  end loop;
  perform log_action('تعديل مصفوفة الصلاحيات');
end $$;

-- ===================================================================
-- طلبات الموظفين
-- ===================================================================
create or replace function create_staff_request(p jsonb) returns jsonb
language plpgsql security definer set search_path = public as $$
declare meid uuid := require_perm('requests', 'create'); emp employees; typ text := _txt(p, 'type'); fd date; td date; v uuid;
begin
  select * into emp from employees where id = coalesce(_uuid(p, 'employeeId'), meid);
  if emp.id is null then raise exception 'الموظف غير موجود'; end if;
  if emp.id <> meid and not has_perm('requests', 'edit') then raise exception 'يمكنك تقديم طلب لنفسك فقط'; end if;
  if typ not in ('leave','permission','other') then raise exception 'نوع الطلب غير صحيح'; end if;
  if _txt(p, 'reason') = '' then raise exception 'اكتب سبب الطلب'; end if;
  fd := nullif(p->>'fromDate', '')::date;
  td := case when typ = 'leave' then nullif(p->>'toDate', '')::date else fd end;
  if fd is null or td is null or fd > td then raise exception 'تحقق من تاريخ البداية والنهاية'; end if;
  if typ = 'permission' and (_txt(p, 'fromTime') = '' or _txt(p, 'toTime') = '' or _txt(p, 'fromTime') >= _txt(p, 'toTime')) then
    raise exception 'وقت بداية الاستئذان يجب أن يسبق نهايته';
  end if;
  insert into staff_requests (employee_id, type, reason, from_date, to_date, from_time, to_time)
  values (emp.id, typ, _txt(p, 'reason'), fd, td, _txt(p, 'fromTime'), _txt(p, 'toTime')) returning id into v;
  perform notify_staff('staff_request', 'طلب ' || case typ when 'leave' then 'إجازة' when 'permission' then 'استئذان' else '' end || ' جديد',
    emp.name || ' — بانتظار موافقة المدير', v::text, '/requests');
  perform log_action('تقديم طلب (' || typ || ') للموظف ' || emp.name);
  return jsonb_build_object('id', v);
end $$;

create or replace function decide_staff_request(p_id uuid, p jsonb) returns void
language plpgsql security definer set search_path = public as $$
declare meid uuid := require_perm('requests', 'edit'); rq staff_requests; approve boolean := coalesce((p->>'approve')::boolean, false);
  fd date; td date; ft text; tt text; emp employees;
begin
  select * into rq from staff_requests where id = p_id for update;
  if rq.id is null then raise exception 'الطلب غير موجود'; end if;
  if rq.status <> 'pending' then raise exception 'تم البت في هذا الطلب مسبقًا'; end if;
  select * into emp from employees where id = rq.employee_id;
  if approve then
    fd := coalesce(nullif(p->>'fromDate', '')::date, rq.from_date);
    td := case when rq.type = 'leave' then coalesce(nullif(p->>'toDate', '')::date, rq.to_date) else fd end;
    ft := coalesce(nullif(p->>'fromTime', ''), rq.from_time); tt := coalesce(nullif(p->>'toTime', ''), rq.to_time);
    if fd > td then raise exception 'تحقق من مدة الإجازة المعتمدة'; end if;
    if rq.type = 'permission' and ft >= tt then raise exception 'وقت البداية يجب أن يسبق وقت النهاية'; end if;
    update staff_requests set from_date = fd, to_date = td, from_time = ft, to_time = tt where id = p_id;
  end if;
  update staff_requests set status = case when approve then 'approved' else 'rejected' end, decision_note = _txt(p, 'note'),
    decided_by = meid, decided_at = now() where id = p_id;
  perform log_action(case when approve then 'قبول' else 'رفض' end || ' طلب للموظف ' || coalesce(emp.name, ''));
end $$;

-- الطلب المعتمد الذي يمنع الموظف الحالي من دخول النظام الآن (إن وجد)
create or replace function my_active_leave() returns jsonb
language sql stable security definer set search_path = public as $$
  select to_jsonb(r) from staff_requests r
  where r.employee_id = my_employee_id() and r.status = 'approved' and r.type in ('leave','permission')
    and riyadh_today() between r.from_date and r.to_date
    and (r.type = 'leave' or to_char(now() at time zone 'Africa/Cairo', 'HH24:MI') between r.from_time and r.to_time)
  limit 1
$$;

-- ===================================================================
-- حملات إشعارات المرضى
-- ===================================================================
create or replace function send_campaign(p jsonb) returns jsonb
language plpgsql security definer set search_path = public as $$
declare meid uuid := require_perm('campaigns', 'create'); aud text := _txt(p, 'audience', 'all'); ids uuid[]; delivered int := 0; v uuid;
begin
  if length(_txt(p, 'title')) < 2 then raise exception 'اكتب عنوان الإشعار'; end if;
  if length(_txt(p, 'body')) < 2 then raise exception 'اكتب نص الإشعار'; end if;
  if aud not in ('all','with_account','source','patient','new','active_plan','inactive') then raise exception 'المستلمون غير صحيح'; end if;
  select coalesce(array_agg(id), '{}') into ids from patients pt
  where pt.active and case aud
    when 'source' then pt.referral_source = _txt(p, 'source')
    when 'patient' then pt.id = _uuid(p, 'patientId')
    when 'with_account' then exists (select 1 from customers c where c.patient_id = pt.id)
    when 'new' then pt.registered_at >= now() - interval '30 days'
    when 'active_plan' then exists (select 1 from treatment_plans tp where tp.patient_id = pt.id and tp.status = 'active')
    when 'inactive' then
      exists (select 1 from appointments ap where ap.patient_id = pt.id and ap.status = 'completed')
      and not exists (select 1 from appointments ap2 where ap2.patient_id = pt.id and ap2.date >= current_date and ap2.status not in ('cancelled','no_show'))
      and coalesce((select max(ap3.date) from appointments ap3 where ap3.patient_id = pt.id and ap3.status = 'completed'), current_date) <= current_date - 60
    else true end;
  if array_length(ids, 1) is null then raise exception 'لا يوجد مستلمين بهذا الاختيار'; end if;
  insert into notifications (audience, customer_id, patient_id, kind, title, body)
  select distinct on (c.id) 'customer', c.id, pt.id, 'offer', _txt(p, 'title'), _txt(p, 'body')
  from patients pt join customers c on c.patient_id = pt.id
     or (c.patient_id is null and right(regexp_replace(c.phone, '\D', '', 'g'), 9) = right(regexp_replace(pt.phone, '\D', '', 'g'), 9))
  where pt.id = any(ids);
  get diagnostics delivered = row_count;
  insert into campaigns (title, body, audience, source, patient_id, discount_code_id, recipients, delivered, created_by)
  values (_txt(p, 'title'), _txt(p, 'body'), aud, nullif(p->>'source', ''), _uuid(p, 'patientId'), _uuid(p, 'discountCodeId'),
          array_length(ids, 1), delivered, meid) returning id into v;
  perform log_action('إرسال إشعار للمرضى: ' || _txt(p, 'title') || ' (' || array_length(ids, 1) || ' مستلم، وصل لـ ' || delivered || ' حساب)');
  return jsonb_build_object('id', v, 'recipients', array_length(ids, 1), 'delivered', delivered);
end $$;

-- ===================================================================
-- المخزون
-- ===================================================================
create or replace function save_item(p jsonb) returns jsonb
language plpgsql security definer set search_path = public as $$
declare v uuid := _uuid(p, 'id'); q numeric := _num(p, 'quantity', 0);
begin
  perform require_perm('inventory', case when v is null then 'create' else 'edit' end);
  if _txt(p, 'name') = '' then raise exception 'اسم الصنف مطلوب'; end if;
  if _num(p, 'minQuantity') < 0 or _num(p, 'costPrice') < 0 or _num(p, 'salePrice') < 0 or q < 0 then raise exception 'القيم الرقمية لا يمكن أن تكون سالبة'; end if;
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
end $$;

create or replace function delete_item(p_id uuid) returns void
language plpgsql security definer set search_path = public as $$
declare it inventory_items;
begin
  perform require_perm('inventory', 'delete');
  delete from inventory_items where id = p_id returning * into it;
  if it.id is null then raise exception 'الصنف غير موجود'; end if;
  perform log_action('حذف صنف مخزون: ' || it.name);
end $$;

create or replace function add_stock_movement(p jsonb) returns void
language plpgsql security definer set search_path = public as $$
declare it inventory_items; typ text := _txt(p, 'type'); q numeric := _num(p, 'quantity'); out_dir boolean;
begin
  perform require_perm('inventory', 'edit');
  select * into it from inventory_items where id = _uuid(p, 'itemId') for update;
  if it.id is null then raise exception 'الصنف غير موجود'; end if;
  if typ not in ('purchase','issue','adjust_in','adjust_out') then raise exception 'نوع الحركة غير صحيح'; end if;
  if q <= 0 then raise exception 'الكمية يجب أن تكون أكبر من صفر'; end if;
  out_dir := typ in ('issue','adjust_out');
  if out_dir and q > it.quantity then raise exception 'الكمية المتاحة % % فقط', it.quantity, it.unit; end if;
  update inventory_items set quantity = quantity + case when out_dir then -q else q end,
    cost_price = case when typ = 'purchase' and _num(p, 'unitCost') > 0 then _num(p, 'unitCost') else cost_price end, updated_at = now()
  where id = it.id;
  insert into stock_movements (item_id, type, quantity, unit_cost, reference, employee_id, note)
  values (it.id, typ, q, _num(p, 'unitCost'), _txt(p, 'reference'), my_employee_id(), _txt(p, 'note'));
  perform log_action(case typ when 'purchase' then 'شراء' when 'issue' then 'صرف' when 'adjust_in' then 'تسوية بالزيادة' else 'تسوية بالنقص' end || ' ' || q || ' ' || it.unit || ' من ' || it.name);
end $$;

-- ===================================================================
-- التنبيهات الآلية (تُستدعى عند فتح النظام ودوريًا — بدون تكرار)
-- ===================================================================
create or replace function run_automations() returns int
language plpgsql security definer set search_path = public as $$
declare c center_info; n int := 0; r record; t date := riyadh_today(); now_r timestamp := now() at time zone 'Africa/Cairo';
begin
  if not is_staff() then return 0; end if;
  select * into c from center_info limit 1;
  for r in select a.*, p.full_name, s.name svc from appointments a join patients p on p.id = a.patient_id join services s on s.id = a.service_id
           where a.status in ('new','confirmed','rescheduled') and (a.date + a.time::time) > now_r
             and (a.date + a.time::time) - now_r <= make_interval(hours => c.reminder_hours_before)
             and not exists (select 1 from notifications x where x.kind = 'appointment_soon' and x.ref_id = a.no) loop
    perform notify_staff('appointment_soon', 'موعد قريب', r.full_name || ' — ' || r.svc || ' — ' || r.date || ' ' || r.time, r.no, '/appointments', r.patient_id);
    perform notify_patient(r.patient_id, 'appointment_reminder', 'تذكير بموعدك', r.svc || ' اليوم الساعة ' || r.time, r.no);
    n := n + 1;
  end loop;
  update packages set status = 'expired' where status = 'active' and expiry_date < t;
  for r in select pk.*, p.full_name from packages pk join patients p on p.id = pk.patient_id
           where pk.status = 'active' and pk.expiry_date between t and t + 7
             and not exists (select 1 from notifications x where x.kind = 'package_expiring' and x.ref_id = pk.id::text) loop
    perform notify_staff('package_expiring', 'باقة على وشك الانتهاء', r.name || ' لـ ' || r.full_name || ' تنتهي ' || r.expiry_date, r.id::text, '/patients/' || r.patient_id, r.patient_id);
    n := n + 1;
  end loop;
  for r in select i.*, p.full_name from invoices i join patients p on p.id = i.patient_id
           where i.status in ('due','partial') and i.date < t
             and not exists (select 1 from notifications x where x.kind = 'payment_due' and x.ref_id = i.no) loop
    perform notify_staff('payment_due', 'مبلغ مستحق متأخر', r.no || ' — ' || r.full_name || ': متبقٍ ' || r.remaining || ' ر.س', r.no, '/invoices', r.patient_id);
    perform notify_patient(r.patient_id, 'payment_due', 'مبلغ مستحق', 'عليك مبلغ ' || r.remaining || ' ر.س على الفاتورة ' || r.no, r.no);
    n := n + 1;
  end loop;
  for r in select * from inventory_items it where it.active and it.quantity <= it.min_quantity
             and not exists (select 1 from notifications x where x.kind = 'stock_low' and x.ref_id = it.id || ':' || it.quantity) loop
    perform notify_staff('stock_low', 'مخزون منخفض', r.name || ': الكمية ' || r.quantity || ' ' || r.unit || ' (الحد الأدنى ' || r.min_quantity || ')', r.id || ':' || r.quantity, '/inventory');
    n := n + 1;
  end loop;
  return n;
end $$;

-- ===================================================================
-- لوحة المعلومات والتقارير (محسوبة من قاعدة البيانات مباشرة)
-- ===================================================================
create or replace function dashboard_stats(p_branch uuid default null) returns jsonb
language plpgsql stable security definer set search_path = public as $$
declare t date := riyadh_today(); m date := date_trunc('month', riyadh_today())::date; res jsonb;
begin
  perform require_perm('dashboard', 'view');
  select jsonb_build_object(
    'todayAppointments', (select count(*) from appointments a where a.date = t and a.status <> 'cancelled' and (p_branch is null or a.branch_id = p_branch) and can_see_patient(a.patient_id)),
    'completedToday', (select count(*) from appointments a where a.date = t and a.status = 'completed' and (p_branch is null or a.branch_id = p_branch) and can_see_patient(a.patient_id)),
    'totalPatients', (select count(*) from patients pt where pt.active and can_see_patient(pt.id)),
    'newPatientsMonth', (select count(*) from patients pt where pt.registered_at >= m and can_see_patient(pt.id)),
    'monthRevenue', case when has_perm('payments','view') or has_perm('invoices','view') then
        (select coalesce(sum(pay.amount), 0) from payments pay left join invoices i on i.id = pay.invoice_id left join appointments a on a.id = i.appointment_id
         where (pay.date at time zone 'Africa/Cairo')::date >= m and (p_branch is null or a.branch_id = p_branch)) else null end,
    'outstanding', case when has_perm('invoices','view') then
        (select coalesce(sum(i.remaining), 0) from invoices i left join appointments a on a.id = i.appointment_id
         where i.status in ('due','partial') and (p_branch is null or a.branch_id = p_branch)) else null end,
    'draftPlanInvoices', (select count(*) from invoices where status = 'draft'),
    'unreadNotifications', (select count(*) from notifications where audience = 'staff' and not read),
    'pendingRequests', case when has_perm('requests','edit') then (select count(*) from staff_requests where status = 'pending') else 0 end,
    'openTickets', case when has_perm('support','view') then (select count(*) from support_tickets where status in ('open','in_progress')) else 0 end
  ) into res;
  return res;
end $$;

create or replace function report_summary(p_from date, p_to date, p_branch uuid default null, p_therapist uuid default null, p_group text default 'day') returns jsonb
language plpgsql stable security definer set search_path = public as $$
declare res jsonb; g text := case when p_group in ('day','week','month') then p_group else 'day' end;
begin
  perform require_perm('reports', 'view');
  if p_from is null or p_to is null or p_from > p_to then raise exception 'تحقق من فترة التقرير'; end if;
  with appts as (
    select a.* from appointments a
    where a.date between p_from and p_to and (p_branch is null or a.branch_id = p_branch) and (p_therapist is null or a.therapist_id = p_therapist)
  ), pays as (
    select pay.*, a.branch_id, a.therapist_id from payments pay
    join invoices i on i.id = pay.invoice_id left join appointments a on a.id = i.appointment_id
    where (pay.date at time zone 'Africa/Cairo')::date between p_from and p_to
      and (p_branch is null or a.branch_id = p_branch) and (p_therapist is null or a.therapist_id = p_therapist)
  ), invs as (
    select i.*, a.branch_id, a.therapist_id from invoices i left join appointments a on a.id = i.appointment_id
    where i.date between p_from and p_to and i.status not in ('cancelled','draft')
      and (p_branch is null or a.branch_id = p_branch) and (p_therapist is null or a.therapist_id = p_therapist)
  )
  select jsonb_build_object(
    'revenue', (select coalesce(sum(amount), 0) from pays),
    'paymentsCount', (select count(*) from pays),
    'paymentsByMethod', (select coalesce(jsonb_object_agg(method, total), '{}') from (select method, sum(amount) total from pays group by method) x),
    'invoiced', (select coalesce(sum(total), 0) from invs),
    'discounts', (select coalesce(sum(discount), 0) from invs),
    'tax', (select coalesce(sum(tax_amount), 0) from invs),
    'outstanding', (select coalesce(sum(remaining), 0) from invoices i left join appointments a on a.id = i.appointment_id
                    where i.status in ('due','partial') and (p_branch is null or a.branch_id = p_branch) and (p_therapist is null or a.therapist_id = p_therapist)),
    'newPatients', (select count(*) from patients where (registered_at at time zone 'Africa/Cairo')::date between p_from and p_to),
    'totalPatients', (select count(*) from patients where active),
    'appointments', (select count(*) from appts),
    'appointmentsByStatus', (select coalesce(jsonb_object_agg(status, n), '{}') from (select status, count(*) n from appts group by status) x),
    'therapists', (select coalesce(jsonb_agg(x order by x.completed desc), '[]') from (
        select t.id, t.name, count(a.id) appointments, count(a.id) filter (where a.status = 'completed') completed,
               count(a.id) filter (where a.status = 'no_show') no_show, count(a.id) filter (where a.status = 'cancelled') cancelled,
               count(distinct a.patient_id) patients,
               coalesce((select sum(p2.amount) from pays p2 where p2.therapist_id = t.id), 0) revenue
        from therapists t left join appts a on a.therapist_id = t.id
        where p_therapist is null or t.id = p_therapist
        group by t.id, t.name) x),
    'services', (select coalesce(jsonb_agg(x order by x.count desc), '[]') from (
        select s.id, s.name, count(a.id) count, count(a.id) filter (where a.status = 'completed') completed, coalesce(sum(a.price) filter (where a.status = 'completed'), 0) value
        from services s join appts a on a.service_id = s.id group by s.id, s.name) x),
    'branches', (select coalesce(jsonb_agg(x), '[]') from (
        select b.id, b.name, (select count(*) from appts a where a.branch_id = b.id) appointments,
               (select coalesce(sum(amount), 0) from pays p2 where p2.branch_id = b.id) revenue
        from branches b where p_branch is null or b.id = p_branch) x),
    'series', (select coalesce(jsonb_agg(x order by x.period), '[]') from (
        select to_char(date_trunc(g, d)::date, 'YYYY-MM-DD') period,
               (select count(*) from appts a where date_trunc(g, a.date) = date_trunc(g, d)) appointments,
               (select coalesce(sum(amount), 0) from pays p2 where date_trunc(g, (p2.date at time zone 'Africa/Cairo')::date) = date_trunc(g, d)) revenue
        from generate_series(date_trunc(g, p_from)::date, p_to, ('1 ' || g)::interval) d) x)
  ) into res;
  return res;
end $$;

-- لا أحد يستدعي الدوال الداخلية مباشرة
revoke execute on function recalc_invoice(uuid), new_invoice(uuid, text, numeric, text, date, uuid, uuid, uuid, text), recalc_plan(uuid),
  check_slot(uuid, date, text, int, uuid), notify_staff(text, text, text, text, text, uuid), notify_patient(uuid, text, text, text, text),
  log_action(text, uuid), next_counter(text, text, int)
  from public, anon, authenticated;
revoke execute on all functions in schema public from anon;
