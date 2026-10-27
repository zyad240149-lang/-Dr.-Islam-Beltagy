-- ===================================================================
-- مراجعة شاملة لقاعدة البيانات — إضافات جديدة فقط (بدون حذف/تعديل أي جدول موجود)
-- 8 جداول جديدة: expenses, medications, prescriptions, prescription_items,
-- message_templates, whatsapp_messages, holidays, booking_settings
-- ===================================================================

-- ===== 1) المصروفات =====
create table if not exists expenses (
  id uuid primary key default gen_random_uuid(),
  branch_id uuid references branches(id) on delete set null,
  category text not null,
  amount numeric(10,2) not null check (amount > 0),
  description text not null default '',
  expense_date date not null default current_date,
  payment_method text not null default 'cash' check (payment_method in ('cash','card','transfer','online')),
  created_by uuid references employees(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index if not exists idx_expenses_date on expenses(expense_date);
alter table expenses enable row level security;
drop policy if exists staff_read on expenses;
create policy staff_read on expenses for select using (has_perm('financial', 'view'));
revoke insert, update, delete on expenses from authenticated;

create or replace function save_expense(p jsonb) returns jsonb
language plpgsql security definer set search_path = public as $$
declare v uuid := _uuid(p, 'id'); emp uuid;
begin
  emp := require_perm('financial', case when v is null then 'create' else 'edit' end);
  if _txt(p, 'category') = '' then raise exception 'بند المصروف مطلوب'; end if;
  if _num(p, 'amount') <= 0 then raise exception 'قيمة المصروف يجب أن تكون أكبر من صفر'; end if;
  if v is not null then
    update expenses set category = _txt(p, 'category'), amount = _num(p, 'amount'), description = _txt(p, 'description'),
      expense_date = coalesce(nullif(p->>'expenseDate', '')::date, expense_date), payment_method = _txt(p, 'paymentMethod', 'cash'), updated_at = now()
    where id = v;
  else
    insert into expenses (branch_id, category, amount, description, expense_date, payment_method, created_by)
    values (_uuid(p, 'branchId'), _txt(p, 'category'), _num(p, 'amount'), _txt(p, 'description'), coalesce(nullif(p->>'expenseDate', '')::date, riyadh_today()), _txt(p, 'paymentMethod', 'cash'), emp)
    returning id into v;
  end if;
  perform log_action('تسجيل مصروف: ' || _txt(p, 'category') || ' — ' || _num(p, 'amount') || ' ر.س');
  return jsonb_build_object('id', v);
end $$;

create or replace function delete_expense(p_id uuid) returns void
language plpgsql security definer set search_path = public as $$
begin
  perform require_perm('financial', 'delete');
  delete from expenses where id = p_id;
  perform log_action('حذف مصروف');
end $$;

revoke execute on function save_expense(jsonb), delete_expense(uuid) from public, anon;
grant execute on function save_expense(jsonb), delete_expense(uuid) to authenticated;

-- ===== 2) الأدوية =====
create table if not exists medications (
  id uuid primary key default gen_random_uuid(),
  name text not null unique,
  description text not null default '',
  active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
alter table medications enable row level security;
drop policy if exists staff_read on medications;
create policy staff_read on medications for select using (is_staff());
revoke insert, update, delete on medications from authenticated;

create or replace function save_medication(p jsonb) returns jsonb
language plpgsql security definer set search_path = public as $$
declare v uuid := _uuid(p, 'id');
begin
  perform require_perm('prescriptions', case when v is null then 'create' else 'edit' end);
  if _txt(p, 'name') = '' then raise exception 'اسم الدواء مطلوب'; end if;
  if v is not null then
    update medications set name = _txt(p, 'name'), description = _txt(p, 'description'), active = coalesce((p->>'active')::boolean, true), updated_at = now() where id = v;
  else
    insert into medications (name, description) values (_txt(p, 'name'), _txt(p, 'description')) returning id into v;
  end if;
  perform log_action('حفظ دواء: ' || _txt(p, 'name'));
  return jsonb_build_object('id', v);
end $$;

create or replace function hide_medication(p_id uuid) returns void
language plpgsql security definer set search_path = public as $$
begin
  perform require_perm('prescriptions', 'delete');
  update medications set active = false where id = p_id;
  perform log_action('إيقاف دواء');
end $$;

revoke execute on function save_medication(jsonb), hide_medication(uuid) from public, anon;
grant execute on function save_medication(jsonb), hide_medication(uuid) to authenticated;

-- ===== 3) الوصفات الطبية =====
create table if not exists prescriptions (
  id uuid primary key default gen_random_uuid(),
  patient_id uuid not null references patients(id) on delete cascade,
  therapist_id uuid references therapists(id) on delete set null,
  treatment_session_id uuid references treatment_sessions(id) on delete set null,
  notes text not null default '',
  prescription_date date not null default current_date,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index if not exists idx_prescriptions_patient on prescriptions(patient_id, created_at desc);
alter table prescriptions enable row level security;
drop policy if exists staff_read on prescriptions;
create policy staff_read on prescriptions for select using (has_perm('prescriptions', 'view') or can_see_patient(patient_id));
revoke insert, update, delete on prescriptions from authenticated;

-- ===== 4) بنود الوصفة (الأدوية داخلها) =====
create table if not exists prescription_items (
  id uuid primary key default gen_random_uuid(),
  prescription_id uuid not null references prescriptions(id) on delete cascade,
  medication_id uuid not null references medications(id) on delete restrict,
  dosage text not null default '',
  frequency text not null default '',
  duration text not null default '',
  instructions text not null default '',
  created_at timestamptz not null default now()
);
create index if not exists idx_prescription_items_prescription on prescription_items(prescription_id);
alter table prescription_items enable row level security;
drop policy if exists staff_read on prescription_items;
create policy staff_read on prescription_items for select using (
  exists (select 1 from prescriptions p where p.id = prescription_id and (has_perm('prescriptions', 'view') or can_see_patient(p.patient_id)))
);
revoke insert, update, delete on prescription_items from authenticated;

-- حفظ الوصفة وبنودها في معاملة واحدة (Transaction) — إما تُحفظ كاملة أو لا شيء
create or replace function save_prescription(p jsonb) returns jsonb
language plpgsql security definer set search_path = public as $$
declare v uuid := _uuid(p, 'id'); pid uuid := _uuid(p, 'patientId'); item jsonb; emp uuid;
begin
  emp := require_perm('prescriptions', case when v is null then 'create' else 'edit' end);
  if pid is null or not exists (select 1 from patients where id = pid) then raise exception 'اختر المريض'; end if;
  if not can_see_patient(pid) then raise exception 'غير مصرح' using errcode = '42501'; end if;
  if v is not null then
    update prescriptions set therapist_id = _uuid(p, 'therapistId'), treatment_session_id = _uuid(p, 'treatmentSessionId'),
      notes = _txt(p, 'notes'), prescription_date = coalesce(nullif(p->>'prescriptionDate', '')::date, prescription_date), updated_at = now()
    where id = v;
    delete from prescription_items where prescription_id = v;
  else
    insert into prescriptions (patient_id, therapist_id, treatment_session_id, notes, prescription_date)
    values (pid, _uuid(p, 'therapistId'), _uuid(p, 'treatmentSessionId'), _txt(p, 'notes'), coalesce(nullif(p->>'prescriptionDate', '')::date, riyadh_today()))
    returning id into v;
  end if;
  if jsonb_typeof(p->'items') = 'array' then
    for item in select * from jsonb_array_elements(p->'items') loop
      if _uuid(item, 'medicationId') is null then raise exception 'اختر الدواء لكل بند'; end if;
      insert into prescription_items (prescription_id, medication_id, dosage, frequency, duration, instructions)
      values (v, _uuid(item, 'medicationId'), _txt(item, 'dosage'), _txt(item, 'frequency'), _txt(item, 'duration'), _txt(item, 'instructions'));
    end loop;
  end if;
  perform log_action('حفظ وصفة طبية', pid);
  return jsonb_build_object('id', v);
end $$;

create or replace function delete_prescription(p_id uuid) returns void
language plpgsql security definer set search_path = public as $$
declare pr prescriptions;
begin
  perform require_perm('prescriptions', 'delete');
  select * into pr from prescriptions where id = p_id;
  if pr.id is null then raise exception 'الوصفة غير موجودة'; end if;
  delete from prescriptions where id = p_id;
  perform log_action('حذف وصفة طبية', pr.patient_id);
end $$;

revoke execute on function save_prescription(jsonb), delete_prescription(uuid) from public, anon;
grant execute on function save_prescription(jsonb), delete_prescription(uuid) to authenticated;

-- صلاحيات قسم الوصفات الطبية الجديد
insert into role_permissions (role, area, ops) values
  ('system_admin', 'prescriptions', '{view,create,edit,delete}'),
  ('center_manager', 'prescriptions', '{view,create,edit,delete}'),
  ('therapist', 'prescriptions', '{view,create,edit}'),
  ('secretary', 'prescriptions', '{view}'),
  ('reception', 'prescriptions', '{view}'),
  ('accountant', 'prescriptions', '{}')
on conflict (role, area) do update set ops = excluded.ops;
-- توسيع صلاحية "financial" الموجودة لتشمل تسجيل/تعديل المصروفات لا الاطلاع فقط
insert into role_permissions (role, area, ops) values ('accountant', 'financial', '{view,create,edit}')
on conflict (role, area) do update set ops = excluded.ops;

-- ===== 5) قوالب الرسائل =====
create table if not exists message_templates (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  type text not null check (type in ('appointment_confirmation','appointment_reminder','appointment_cancelled','invoice','package','promotional','general')),
  content text not null,
  active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
alter table message_templates enable row level security;
drop policy if exists staff_read on message_templates;
create policy staff_read on message_templates for select using (has_perm('campaigns', 'view'));
revoke insert, update, delete on message_templates from authenticated;

create or replace function save_message_template(p jsonb) returns jsonb
language plpgsql security definer set search_path = public as $$
declare v uuid := _uuid(p, 'id');
begin
  perform require_perm('campaigns', case when v is null then 'create' else 'edit' end);
  if _txt(p, 'name') = '' or _txt(p, 'content') = '' then raise exception 'اسم القالب ومحتواه مطلوبان'; end if;
  if p->>'type' not in ('appointment_confirmation','appointment_reminder','appointment_cancelled','invoice','package','promotional','general') then
    raise exception 'نوع القالب غير صحيح';
  end if;
  if v is not null then
    update message_templates set name = _txt(p, 'name'), type = p->>'type', content = _txt(p, 'content'), active = coalesce((p->>'active')::boolean, true), updated_at = now() where id = v;
  else
    insert into message_templates (name, type, content) values (_txt(p, 'name'), p->>'type', _txt(p, 'content')) returning id into v;
  end if;
  perform log_action('حفظ قالب رسالة: ' || _txt(p, 'name'));
  return jsonb_build_object('id', v);
end $$;

create or replace function delete_message_template(p_id uuid) returns void
language plpgsql security definer set search_path = public as $$
begin
  perform require_perm('campaigns', 'delete');
  delete from message_templates where id = p_id;
  perform log_action('حذف قالب رسالة');
end $$;

revoke execute on function save_message_template(jsonb), delete_message_template(uuid) from public, anon;
grant execute on function save_message_template(jsonb), delete_message_template(uuid) to authenticated;

-- ===== 6) سجل رسائل واتساب — تخزين فقط، بدون أي تكامل فعلي مع واتساب الآن =====
create table if not exists whatsapp_messages (
  id uuid primary key default gen_random_uuid(),
  patient_id uuid references patients(id) on delete set null,
  phone text not null,
  template_id uuid references message_templates(id) on delete set null,
  message_type text not null default 'general',
  message_content text not null default '',
  external_message_id text,
  status text not null default 'pending' check (status in ('pending','sent','delivered','read','failed')),
  sent_at timestamptz,
  delivered_at timestamptz,
  read_at timestamptz,
  failed_reason text,
  created_at timestamptz not null default now()
);
create index if not exists idx_whatsapp_messages_patient on whatsapp_messages(patient_id, created_at desc);
alter table whatsapp_messages enable row level security;
drop policy if exists staff_read on whatsapp_messages;
create policy staff_read on whatsapp_messages for select using (has_perm('campaigns', 'view') or can_see_patient(patient_id));
revoke insert, update, delete on whatsapp_messages from authenticated;

-- تسجيل يدوي لإرسال تم بالفعل (مثلًا زر "واتساب" الحالي في الفواتير الذي يفتح wa.me) — بدون أي استدعاء API خارجي
create or replace function log_whatsapp_message(p jsonb) returns jsonb
language plpgsql security definer set search_path = public as $$
declare v uuid;
begin
  perform require_perm('campaigns', 'create');
  if _txt(p, 'phone') = '' then raise exception 'رقم الجوال مطلوب'; end if;
  insert into whatsapp_messages (patient_id, phone, template_id, message_type, message_content, status, sent_at)
  values (_uuid(p, 'patientId'), _txt(p, 'phone'), _uuid(p, 'templateId'), _txt(p, 'messageType', 'general'), _txt(p, 'messageContent'), 'sent', now())
  returning id into v;
  return jsonb_build_object('id', v);
end $$;

revoke execute on function log_whatsapp_message(jsonb) from public, anon;
grant execute on function log_whatsapp_message(jsonb) to authenticated;

-- ===== 7) الإجازات/الأيام المغلقة — تمنع الحجز فعليًا (مربوطة بـ check_slot) =====
create table if not exists holidays (
  id uuid primary key default gen_random_uuid(),
  branch_id uuid references branches(id) on delete cascade,
  date date not null,
  reason text not null default '',
  active boolean not null default true,
  created_at timestamptz not null default now()
);
create unique index if not exists uq_holidays_branch_date on holidays(coalesce(branch_id, '00000000-0000-0000-0000-000000000000'::uuid), date);
alter table holidays enable row level security;
drop policy if exists staff_read on holidays;
create policy staff_read on holidays for select using (is_staff());
revoke insert, update, delete on holidays from authenticated;

create or replace function save_holiday(p jsonb) returns jsonb
language plpgsql security definer set search_path = public as $$
declare v uuid := _uuid(p, 'id');
begin
  perform require_perm('settings', case when v is null then 'create' else 'edit' end);
  if nullif(p->>'date', '') is null then raise exception 'التاريخ مطلوب'; end if;
  if v is not null then
    update holidays set branch_id = _uuid(p, 'branchId'), date = (p->>'date')::date, reason = _txt(p, 'reason'), active = coalesce((p->>'active')::boolean, true) where id = v;
  else
    insert into holidays (branch_id, date, reason) values (_uuid(p, 'branchId'), (p->>'date')::date, _txt(p, 'reason')) returning id into v;
  end if;
  perform log_action('حفظ يوم إجازة/إغلاق: ' || (p->>'date'));
  return jsonb_build_object('id', v);
end $$;

create or replace function delete_holiday(p_id uuid) returns void
language plpgsql security definer set search_path = public as $$
begin
  perform require_perm('settings', 'delete');
  delete from holidays where id = p_id;
  perform log_action('حذف يوم إجازة/إغلاق');
end $$;

revoke execute on function save_holiday(jsonb), delete_holiday(uuid) from public, anon;
grant execute on function save_holiday(jsonb), delete_holiday(uuid) to authenticated;

-- التكامل الفعلي: أي محاولة حجز في يوم مغلق تُرفض من نقطة الفحص المشتركة لكل مسارات الحجز
-- (نفس جسم الدالة الأصلي في 003_rpc.sql بالكامل — مُضاف إليه فحص الإجازات فقط، بدون أي تغيير في منطق التعارض/ساعات العمل الحالي)
create or replace function check_slot(p_therapist uuid, p_date date, p_time text, p_dur int, p_exclude uuid default null) returns void
language plpgsql security definer set search_path = public as $$
declare d text := lower(to_char(p_date, 'Dy')); sched jsonb; th therapists; wh jsonb; br uuid;
begin
  if p_time !~ '^\d{2}:\d{2}$' then raise exception 'صيغة الوقت غير صحيحة'; end if;
  if p_date < riyadh_today() then raise exception 'لا يمكن الحجز في تاريخ سابق'; end if;
  select e.value into sched from center_info c, jsonb_array_elements(c.week_schedule) e where e.value->>'day' = d limit 1;
  if sched is null or not coalesce((sched->>'open')::boolean, false) then raise exception 'المركز مغلق في هذا اليوم'; end if;
  if p_time < sched->>'from' or p_time >= sched->>'to' then raise exception 'الوقت خارج ساعات عمل المركز (% - %)', sched->>'from', sched->>'to'; end if;

  select * into th from therapists where id = p_therapist;
  if th.id is null or not th.active then raise exception 'المعالج غير موجود أو غير نشط'; end if;
  br := th.branch_id;
  if exists (select 1 from holidays where date = p_date and active and (branch_id is null or branch_id = br)) then
    raise exception 'المركز مغلق في هذا اليوم — اختر يومًا آخر';
  end if;
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

-- ===== 8) إعدادات الحجز العامة لكل فرع (بدون أي مدة جلسة/موعد) =====
create table if not exists booking_settings (
  id uuid primary key default gen_random_uuid(),
  branch_id uuid not null references branches(id) on delete cascade,
  allow_online_booking boolean not null default true,
  allow_patient_cancellation boolean not null default true,
  allow_patient_rescheduling boolean not null default true,
  max_future_booking_days int not null default 60 check (max_future_booking_days > 0),
  booking_confirmation_required boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (branch_id)
);
insert into booking_settings (branch_id) select id from branches on conflict (branch_id) do nothing;
alter table booking_settings enable row level security;
drop policy if exists staff_read on booking_settings;
create policy staff_read on booking_settings for select using (is_staff());
revoke insert, update, delete on booking_settings from authenticated;

create or replace function save_booking_settings(p jsonb) returns void
language plpgsql security definer set search_path = public as $$
declare bid uuid := _uuid(p, 'branchId');
begin
  perform require_perm('settings', 'edit');
  if bid is null then raise exception 'حدد الفرع'; end if;
  update booking_settings set
    allow_online_booking = coalesce((p->>'allowOnlineBooking')::boolean, allow_online_booking),
    allow_patient_cancellation = coalesce((p->>'allowPatientCancellation')::boolean, allow_patient_cancellation),
    allow_patient_rescheduling = coalesce((p->>'allowPatientRescheduling')::boolean, allow_patient_rescheduling),
    max_future_booking_days = coalesce(nullif(p->>'maxFutureBookingDays', '')::int, max_future_booking_days),
    booking_confirmation_required = coalesce((p->>'bookingConfirmationRequired')::boolean, booking_confirmation_required),
    updated_at = now()
  where branch_id = bid;
  perform log_action('تحديث إعدادات الحجز');
end $$;

revoke execute on function save_booking_settings(jsonb) from public, anon;
grant execute on function save_booking_settings(jsonb) to authenticated;

-- التكامل الفعلي: تطبيق الإعدادات على حجز/إلغاء/تعديل المريض لنفسه من بوابته
create or replace function patient_book(p jsonb) returns jsonb
language plpgsql security definer set search_path = public as $$
declare c customers; pat patients; svc services; th uuid := _uuid(p, 'therapistId'); d date := nullif(p->>'date', '')::date; tm text := _txt(p, 'time'); a appointments; v_price numeric; bs booking_settings;
begin
  c := require_patient();
  select * into pat from patients where id = c.patient_id;
  if not pat.active then raise exception 'ملفك غير نشط — تواصل مع المركز'; end if;
  select bst.* into bs from booking_settings bst order by created_at limit 1;
  if bs.id is not null and not bs.allow_online_booking then raise exception 'الحجز الإلكتروني موقوف حاليًا — تواصل مع المركز للحجز'; end if;
  if bs.id is not null and d is not null and d > riyadh_today() + bs.max_future_booking_days then
    raise exception 'لا يمكن الحجز لأكثر من % يومًا مقدمًا', bs.max_future_booking_days;
  end if;
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
  return jsonb_build_object('id', a.id, 'no', a.no);
end $$;

create or replace function patient_cancel(p_id uuid, p_reason text default '') returns void
language plpgsql security definer set search_path = public as $$
declare c customers; a appointments; hrs int; pat patients; bs booking_settings;
begin
  c := require_patient();
  select bst.* into bs from booking_settings bst order by created_at limit 1;
  if bs.id is not null and not bs.allow_patient_cancellation then raise exception 'إلغاء الموعد من البوابة موقوف — تواصل مع المركز'; end if;
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
declare c customers; a appointments; hrs int; pat patients; bs booking_settings;
begin
  c := require_patient();
  select bst.* into bs from booking_settings bst order by created_at limit 1;
  if bs.id is not null and not bs.allow_patient_rescheduling then raise exception 'تعديل الموعد من البوابة موقوف — تواصل مع المركز'; end if;
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
