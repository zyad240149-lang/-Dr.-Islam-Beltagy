-- الفواتير ≠ المواعيد، والمواعيد ≠ الحضور (2026-10-08، طلب الإدارة)
--   المريض ← الفاتورة ← الخدمة/الباقة (packages: total/used) ← Check-in (package_checkins) ← المستخدم/المتبقي
--   المريض ← المواعيد (مستقلة — وجود موعد أو إلغاؤه مابيغيّرش رصيد الجلسات)
-- مفيش جداول جديدة: packages هو رصيد الجلسات المدفوعة، وpackage_checkins هو سجل الحضور (بيتوسّع).
-- الخصم الوحيد لجلسة = session_check_in. complete_session/delete_session مابقوش يلمسوا رصيد الباقة.
-- الخطط العلاجية (treatment_plans) فاضلة على نظامها الحالي (صفحة حضور الخطط) — مش داخلة هنا.

-- ===== 1) الأعمدة =====
alter table invoices add column if not exists payment_method text;
do $$ begin
  if not exists (select 1 from pg_constraint where conname = 'invoices_payment_method_chk') then
    alter table invoices add constraint invoices_payment_method_chk check (payment_method is null or payment_method in ('cash','card','transfer','credit'));
  end if;
end $$;

alter table packages add column if not exists invoice_id uuid references invoices(id) on delete set null;
alter table packages add column if not exists service_id text references services(id) on delete set null;
alter table packages add column if not exists created_by uuid references employees(id) on delete set null;
alter table packages add column if not exists created_at timestamptz not null default now();
create index if not exists packages_invoice_idx on packages (invoice_id);
create index if not exists packages_service_idx on packages (service_id);
create index if not exists packages_created_by_idx on packages (created_by);
create index if not exists packages_patient_status_idx on packages (patient_id, status);
-- الباقات القديمة (المباعة من الكتالوج): الفاتورة مربوطة من ناحية invoices.package_id بس
update packages k set invoice_id = (select i.id from invoices i where i.package_id = k.id order by i.created_at limit 1) where k.invoice_id is null;

-- الحضور مابقاش لازم يكون على موعد (كان NOT NULL = الحضور كان مربوط بالموعد إجباريًا)
alter table package_checkins alter column appointment_id drop not null;
alter table package_checkins add column if not exists service_id text references services(id) on delete set null;
alter table package_checkins add column if not exists invoice_id uuid references invoices(id) on delete set null;
alter table package_checkins add column if not exists request_id text;
alter table package_checkins add column if not exists cancelled_at timestamptz;
alter table package_checkins add column if not exists cancelled_by uuid references employees(id) on delete set null;
alter table package_checkins add column if not exists cancel_reason text;
create unique index if not exists package_checkins_request_uk on package_checkins (request_id) where request_id is not null;
-- نفس الجلسة مرتين على نفس الباقة = مرفوض (الملغي مابيتحسبش)
create unique index if not exists package_checkins_session_uk on package_checkins (package_id, session_no) where package_id is not null and cancelled_at is null;
create index if not exists package_checkins_invoice_idx on package_checkins (invoice_id);
create index if not exists package_checkins_service_idx on package_checkins (service_id);
create index if not exists package_checkins_cancelled_by_idx on package_checkins (cancelled_by);
create index if not exists package_checkins_created_idx on package_checkins (created_at desc);

-- ===== 2) الصلاحية: قسم Check-in مستقل =====
insert into role_permissions (role, area, ops) values
  ('system_admin', 'checkin', '{view,create,edit,delete}'),
  ('center_manager', 'checkin', '{view,create,edit,delete}'),
  ('reception', 'checkin', '{view,create}'),
  ('secretary', 'checkin', '{view,create}'),
  ('accountant', 'checkin', '{view}'),
  ('therapist', 'checkin', '{view}')
on conflict do nothing;

drop policy if exists staff_read on package_checkins;
create policy staff_read on package_checkins for select using ((has_perm('checkin', 'view') or has_perm('appointments', 'view')) and can_see_patient(patient_id));

-- ===== 3) أدوات =====
-- رقم الملف: مسافات/أرقام عربية/حروف صغيرة
create or replace function norm_file_no(p text) returns text language sql immutable set search_path = public as $$
  select upper(regexp_replace(translate(coalesce(p, ''), '٠١٢٣٤٥٦٧٨٩۰۱۲۳۴۵۶۷۸۹', '01234567890123456789'), '\s', '', 'g'))
$$;

create or replace function patient_by_file_no(p_file text) returns jsonb
language plpgsql stable security definer set search_path = public as $$
declare pat patients; f text := norm_file_no(p_file);
begin
  if not (has_perm('invoices', 'create') or has_perm('checkin', 'view')) then raise exception 'لا توجد صلاحية لهذه العملية' using errcode = '42501'; end if;
  if f = '' then raise exception 'أدخل رقم الملف'; end if;
  select * into pat from patients where norm_file_no(file_no) = f and not is_guest limit 1;
  if pat.id is null or not can_see_patient(pat.id) then raise exception 'رقم الملف % غير موجود', trim(p_file); end if;
  return jsonb_build_object('id', pat.id, 'fileNo', pat.file_no, 'name', pat.full_name, 'phone', pat.phone, 'nationality', coalesce(pat.nationality, 'saudi'),
    'active', pat.active, 'taxRate', patient_tax_rate(pat.id));
end $$;

-- ملخص رصيد باقة واحدة (للواجهة)
create or replace function package_balance_json(k packages) returns jsonb
language sql stable security definer set search_path = public as $$
  select jsonb_build_object(
    'id', k.id, 'name', k.name, 'serviceId', coalesce(k.service_id, k.service_ids[1]),
    'serviceName', coalesce((select name from services where id = coalesce(k.service_id, k.service_ids[1])), k.name),
    'total', k.total_sessions, 'used', k.used_sessions, 'remaining', greatest(k.total_sessions - k.used_sessions, 0),
    'status', k.status, 'expiry', k.expiry_date, 'expired', (k.expiry_date is not null and k.expiry_date < riyadh_today()),
    'invoiceId', i.id, 'invoiceNo', i.no, 'invoiceStatus', i.status, 'paymentMethod', i.payment_method,
    'lastCheckin', (select max(c.created_at) from package_checkins c where c.package_id = k.id and c.cancelled_at is null),
    'checkedInToday', exists (select 1 from package_checkins c where c.package_id = k.id and c.cancelled_at is null
                              and (c.created_at at time zone 'Africa/Cairo')::date = riyadh_today()))
  from (select 1) x left join invoices i on i.id = coalesce(k.invoice_id, (select id from invoices where package_id = k.id order by created_at limit 1))
$$;

-- ===== 4) إنشاء فاتورة (من غير أي موعد) =====
create or replace function create_session_invoice(p jsonb) returns jsonb
language plpgsql security definer set search_path = public as $$
declare emp uuid; pat patients; svc services; n int; unit numeric; disc numeric; method text; pay numeric; sub numeric;
  v_inv uuid; v_no text; v_pkg uuid; inv invoices;
begin
  emp := require_perm('invoices', 'create');
  if nullif(p->>'patientId', '') is not null then select * into pat from patients where id = (p->>'patientId')::uuid;
  else select * into pat from patients where norm_file_no(file_no) = norm_file_no(p->>'fileNo') and norm_file_no(p->>'fileNo') <> '' and not is_guest limit 1; end if;
  if pat.id is null or pat.is_guest or not can_see_patient(pat.id) then raise exception 'رقم الملف غير موجود — لم يتم إنشاء الفاتورة'; end if;
  if not pat.active then raise exception 'ملف المريض غير نشط'; end if;

  select * into svc from services where id = nullif(p->>'serviceId', '');
  if svc.id is null then raise exception 'اختر نوع الخدمة'; end if;
  if not svc.active then raise exception 'الخدمة «%» موقوفة', svc.name; end if;

  begin n := (p->>'sessions')::int; exception when others then n := null; end;
  if n is null or n < 1 or n > 200 then raise exception 'عدد الجلسات لازم يكون رقم صحيح من 1 إلى 200'; end if;
  begin unit := round((p->>'unitPrice')::numeric, 2); exception when others then unit := null; end;
  if unit is null or unit < 0 then raise exception 'سعر الجلسة غير صحيح'; end if;
  begin disc := round(coalesce(nullif(p->>'discount', '')::numeric, 0), 2); exception when others then disc := null; end;
  sub := round(unit * n, 2);
  if disc is null or disc < 0 or disc > sub then raise exception 'الخصم لازم يكون بين 0 و %', sub; end if;
  method := nullif(p->>'paymentMethod', '');
  if method is null or method not in ('cash','card','transfer','credit') then raise exception 'اختر طريقة الدفع (كاش / بطاقة / تحويل / كريدت)'; end if;

  -- الفاتورة: مالهاش موعد ولا خطة — حالتها من الدفع بس
  v_no := next_counter('invoice', 'INV-');
  insert into invoices (no, patient_id, appointment_id, plan_id, service_name, price, discount, status, date, tax_rate, note, created_by, payment_method)
  values (v_no, pat.id, null, null, left(svc.name || case when n > 1 then ' — ' || n || ' جلسات' else '' end, 300), sub, disc, 'due', riyadh_today(),
          0, trim(coalesce(p->>'note', '')), emp, method)
  returning id into v_inv;  -- tax_rate بيتحدد من جنسية المريض (تريجر invoices_set_tax_rate)
  insert into invoice_items (invoice_id, service_id, description, qty, unit_price) values (v_inv, svc.id, svc.name, n, unit);

  -- رصيد الجلسات المدفوعة — مستقل عن المواعيد
  insert into packages (patient_id, name, service_ids, service_id, total_sessions, used_sessions, price, start_date, expiry_date, status, kind, invoice_id, created_by)
  values (pat.id, svc.name || ' — ' || n || case when n = 1 then ' جلسة' else ' جلسات' end, array[svc.id], svc.id, n, 0, sub - disc, riyadh_today(), null, 'active', null, v_inv, emp)
  returning id into v_pkg;
  update invoices set package_id = v_pkg where id = v_inv;
  perform recalc_invoice(v_inv);
  select * into inv from invoices where id = v_inv;

  -- الدفع وقت الإصدار: كاش/بطاقة/تحويل = المبلغ المدفوع (افتراضي الإجمالي)، كريدت = آجل بدون دفع
  if method = 'credit' then pay := 0;
  else
    begin pay := round(coalesce(nullif(p->>'paidAmount', '')::numeric, inv.total), 2); exception when others then pay := null; end;
    if pay is null or pay < 0 or pay > inv.total then raise exception 'المبلغ المدفوع لازم يكون بين 0 و %', inv.total; end if;
  end if;
  if pay > 0 then
    if not has_perm('payments', 'create') then raise exception 'لا توجد صلاحية لتسجيل الدفع — اختر «كريدت» أو اطلب من المحاسب'; end if;
    insert into payments (invoice_id, patient_id, amount, method, note, created_by) values (v_inv, pat.id, pay, method, 'دفع عند إصدار الفاتورة', emp);
    perform recalc_invoice(v_inv);
    select * into inv from invoices where id = v_inv;
  end if;

  perform log_action('إصدار فاتورة ' || v_no || ' — ' || svc.name || ' × ' || n || ' جلسة بإجمالي ' || inv.total || ' ر.س', pat.id);
  perform notify_patient(pat.id, 'invoice', 'فاتورة جديدة', 'تم إصدار فاتورة بقيمة ' || inv.total || ' ر.س', v_inv::text);
  return jsonb_build_object('invoiceId', v_inv, 'invoiceNo', v_no, 'packageId', v_pkg, 'total', inv.total, 'paid', inv.paid, 'status', inv.status);
end $$;

-- ===== 5) Check-in =====
create or replace function checkin_search(p_q text) returns jsonb
language plpgsql stable security definer set search_path = public as $$
declare q text := trim(coalesce(p_q, '')); pat text; res jsonb;
begin
  perform require_perm('checkin', 'view');
  if length(q) < 2 then return '[]'::jsonb; end if;
  pat := '%' || replace(replace(replace(q, '\', '\\'), '%', '\%'), '_', '\_') || '%';
  select coalesce(jsonb_agg(r order by (r->>'exact')::boolean desc, r->>'name'), '[]') into res from (
    select jsonb_build_object('id', p.id, 'name', p.full_name, 'fileNo', p.file_no, 'phone', p.phone,
      'exact', norm_file_no(p.file_no) = norm_file_no(q),
      'packages', coalesce((select jsonb_agg(package_balance_json(k) order by (k.status = 'active') desc, k.created_at desc)
                            from packages k where k.patient_id = p.id and k.status <> 'cancelled'), '[]')) r
    from patients p
    where not p.is_guest and can_see_patient(p.id)
      and (p.full_name ilike pat or p.file_no ilike pat or norm_file_no(p.file_no) = norm_file_no(q) or p.phone like pat or phone_digits_match(p.phone, q))
    limit 20
  ) z;
  return res;
end $$;

create or replace function session_check_in(p_package uuid, p_request_id text default null) returns jsonb
language plpgsql security definer set search_path = public as $$
declare emp uuid; k packages; inv invoices; prev package_checkins; v_id uuid; v_no int; rid text := nullif(trim(coalesce(p_request_id, '')), '');
begin
  emp := require_perm('checkin', 'create');
  -- نفس العملية اتبعتت مرتين (ضغطتين/إعادة إرسال): نرجّع نفس السجل من غير خصم تاني
  if rid is not null then
    select * into prev from package_checkins where request_id = rid;
    if prev.id is not null then
      select * into k from packages where id = prev.package_id;
      return jsonb_build_object('id', prev.id, 'sessionNo', prev.session_no, 'total', k.total_sessions, 'used', k.used_sessions,
        'remaining', greatest(k.total_sessions - k.used_sessions, 0), 'duplicate', true);
    end if;
  end if;
  select * into k from packages where id = p_package for update;   -- قفل: Check-in متزامنين مايخصموش نفس الجلسة
  if k.id is null or not can_see_patient(k.patient_id) then raise exception 'الباقة غير موجودة'; end if;
  select * into inv from invoices where id = coalesce(k.invoice_id, (select id from invoices where package_id = k.id order by created_at limit 1));
  if inv.id is not null and inv.status = 'cancelled' then raise exception 'فاتورة هذه الجلسات ملغاة — لا يمكن تسجيل حضور'; end if;
  if k.status = 'pending_payment' then raise exception 'الباقة بانتظار السداد الكامل — لا يمكن تسجيل حضور'; end if;
  if k.status = 'cancelled' then raise exception 'الباقة ملغاة — لا توجد جلسات صالحة'; end if;
  if k.status = 'expired' then raise exception 'الباقة منتهية الصلاحية — لا توجد جلسات صالحة'; end if;
  if k.expiry_date is not null and k.expiry_date < riyadh_today() then raise exception 'الباقة منتهية الصلاحية بتاريخ %', k.expiry_date; end if;
  if k.used_sessions >= k.total_sessions or k.status = 'completed' then raise exception 'لا توجد جلسات متبقية لهذا المريض.'; end if;
  if k.status <> 'active' then raise exception 'الباقة غير صالحة (%)', k.status; end if;

  v_no := k.used_sessions + 1;
  insert into package_checkins (package_id, patient_id, appointment_id, checked_in_by, session_no, service_id, invoice_id, request_id)
  values (k.id, k.patient_id, null, emp, v_no, coalesce(k.service_id, k.service_ids[1]), inv.id, rid)
  returning id into v_id;
  update packages set used_sessions = used_sessions + 1, status = case when used_sessions + 1 >= total_sessions then 'completed' else status end where id = k.id;
  perform log_action('Check-in — ' || k.name || ' (الجلسة ' || v_no || ' من ' || k.total_sessions || ')', k.patient_id);
  if k.total_sessions - v_no between 1 and coalesce((select package_low_threshold from center_info limit 1), 0) then
    perform notify_staff('package_low', 'باقة قاربت على النفاد', (select full_name from patients where id = k.patient_id) || ': تبقّى ' || (k.total_sessions - v_no) || ' جلسة', k.id::text, '/check-in', k.patient_id);
  end if;
  return jsonb_build_object('id', v_id, 'sessionNo', v_no, 'total', k.total_sessions, 'used', v_no, 'remaining', k.total_sessions - v_no, 'duplicate', false);
end $$;

-- إلغاء Check-in (منطق منفصل، للمدير): آخر حضور بس، وبيرجّع الجلسة للرصيد — السجل بيفضل (مُعلَّم ملغي)
create or replace function checkin_cancel(p_checkin uuid, p_reason text) returns jsonb
language plpgsql security definer set search_path = public as $$
declare emp uuid; c package_checkins; k packages;
begin
  emp := require_perm('checkin', 'delete');
  if nullif(trim(coalesce(p_reason, '')), '') is null then raise exception 'اكتب سبب إلغاء الحضور'; end if;
  select * into c from package_checkins where id = p_checkin for update;
  if c.id is null or c.package_id is null then raise exception 'سجل الحضور غير موجود'; end if;
  if c.cancelled_at is not null then raise exception 'الحضور ده ملغي بالفعل'; end if;
  select * into k from packages where id = c.package_id for update;
  if exists (select 1 from package_checkins x where x.package_id = c.package_id and x.cancelled_at is null and x.session_no > c.session_no) then
    raise exception 'ألغِ آخر حضور أولًا (الجلسة %)', (select max(session_no) from package_checkins x where x.package_id = c.package_id and x.cancelled_at is null); end if;
  update package_checkins set cancelled_at = now(), cancelled_by = emp, cancel_reason = trim(p_reason) where id = c.id;
  update packages set used_sessions = greatest(used_sessions - 1, 0), status = case when status = 'completed' then 'active' else status end where id = k.id;
  perform log_action('إلغاء Check-in — ' || k.name || ' (الجلسة ' || c.session_no || ') — السبب: ' || trim(p_reason), c.patient_id);
  return jsonb_build_object('used', k.used_sessions - 1, 'remaining', k.total_sessions - k.used_sessions + 1);
end $$;

create or replace function checkin_log(p_from date default null, p_to date default null, p_patient uuid default null, p_package uuid default null) returns jsonb
language plpgsql stable security definer set search_path = public as $$
declare res jsonb;
begin
  perform require_perm('checkin', 'view');
  select coalesce(jsonb_agg(r order by r->>'at' desc), '[]') into res from (
    select jsonb_build_object('id', c.id, 'patientId', p.id, 'patient', p.full_name, 'fileNo', p.file_no, 'phone', p.phone,
      'service', coalesce(s.name, k.name), 'packageId', k.id, 'sessionNo', c.session_no, 'total', k.total_sessions,
      'at', to_char(c.created_at at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS"Z"'), 'employee', e.name,
      'invoiceId', i.id, 'invoiceNo', i.no, 'cancelled', c.cancelled_at is not null, 'cancelReason', c.cancel_reason, 'cancelledBy', ce.name) r
    from package_checkins c
    join packages k on k.id = c.package_id
    join patients p on p.id = c.patient_id
    left join services s on s.id = coalesce(c.service_id, k.service_id)
    left join employees e on e.id = c.checked_in_by
    left join employees ce on ce.id = c.cancelled_by
    left join invoices i on i.id = coalesce(c.invoice_id, k.invoice_id)
    where can_see_patient(p.id)
      and (p_patient is null or c.patient_id = p_patient) and (p_package is null or c.package_id = p_package)
      and (p_from is null or (c.created_at at time zone 'Africa/Cairo')::date >= p_from)
      and (p_to is null or (c.created_at at time zone 'Africa/Cairo')::date <= p_to)
    order by c.created_at desc
    limit 2000
  ) z;
  return res;
end $$;

-- ===== 6) فك ربط الخصم بالمواعيد/الجلسات =====
-- complete_session: نفس اللي قبل كده من غير خصم جلسة الباقة (الخصم = Check-in بس)
create or replace function complete_session(p_id uuid, p jsonb default '{}'::jsonb) returns void
language plpgsql security definer set search_path = public as $function$
declare s treatment_sessions; a appointments; pts int;
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
  end if;
  if s.plan_id is not null then perform recalc_plan(s.plan_id); end if;
  select loyalty_session_points into pts from center_info limit 1;
  perform award_loyalty_points(s.patient_id, 'session', coalesce(pts, 2), 'نقاط إتمام جلسة/كشف', 'session', s.id);
  perform notify_patient(s.patient_id, 'session_completed', 'اكتملت جلستك', 'تم تسجيل إكمال الجلسة رقم ' || s.session_no || ' — شكرًا لالتزامك', s.id::text);
  perform log_action('إكمال الجلسة رقم ' || s.session_no, s.patient_id);
end $function$;

create or replace function delete_session(p_id uuid) returns void
language plpgsql security definer set search_path = public as $function$
declare s treatment_sessions; a appointments;
begin
  perform require_perm('sessions', 'delete');
  select * into s from treatment_sessions where id = p_id;
  if s.id is null then raise exception 'الجلسة غير موجودة'; end if;
  select * into a from appointments where id = s.appointment_id;
  if a.id is not null and s.status = 'completed' then
    update appointments set status = 'arrived' where id = a.id;
  end if;
  if s.status = 'completed' then perform reverse_loyalty_points('session', s.id, 'إلغاء نقاط جلسة محذوفة رقم ' || s.session_no); end if;
  delete from treatment_sessions where id = p_id;
  if s.plan_id is not null then
    perform recalc_plan(s.plan_id);
    update treatment_plans set status = 'active' where id = s.plan_id and status = 'completed'
      and (select count(*) from treatment_sessions where plan_id = s.plan_id and status = 'completed') < total_sessions;
  end if;
  perform log_action('حذف الجلسة رقم ' || s.session_no, s.patient_id);
end $function$;

-- الحضور القديم المربوط بالموعد: للباقات بقى Check-in المستقل (الخطط العلاجية فاضلة زي ما هي)
create or replace function package_check_in(p_package uuid, p_appointment uuid) returns jsonb
language plpgsql security definer set search_path = public as $$
begin
  raise exception 'تسجيل حضور الباقات بقى من قسم «Check-in» — مش من الموعد';
end $$;

do $$ declare src text; begin
  -- attendance_check_in للخطط العلاجية بس
  select pg_get_functiondef('public.attendance_check_in(text,uuid,uuid,uuid)'::regprocedure) into src;
  if position('بقى من قسم «Check-in»' in src) = 0 then
    src := replace(src, $q$  if p_source = 'package' then
    select * into pkg from packages where id = p_id for update;$q$, $q$  if p_source = 'package' then
    raise exception 'تسجيل حضور الباقات بقى من قسم «Check-in» — مش من الموعد';
    select * into pkg from packages where id = p_id for update;$q$);
    if position('بقى من قسم «Check-in»' in src) = 0 then raise exception '099: تعديل attendance_check_in ماتطبّقش (النص اتغيّر)'; end if;
    execute src;
  end if;
  -- قايمة حضور الخطط: من غير الباقات (ليها قسم Check-in)
  select pg_get_functiondef('public.package_attendance_list(text)'::regprocedure) into src;
  if position('k.status = ''__none__''' in src) = 0 then
    src := replace(src, $q$where not p.is_guest and can_see_patient(p.id)
      and (k.status = 'active'$q$, $q$where not p.is_guest and can_see_patient(p.id) and k.status = '__none__'
      and (k.status = 'active'$q$);
    if position('k.status = ''__none__''' in src) = 0 then raise exception '099: تعديل package_attendance_list ماتطبّقش (النص اتغيّر)'; end if;
    execute src;
  end if;
end $$;

-- إلغاء/حذف الفاتورة: رصيد جلساتها مابيفضلش صالح
create or replace function cancel_invoice(p_invoice uuid) returns void
language plpgsql security definer set search_path = public as $function$
declare inv invoices;
begin
  perform require_perm('invoices', 'edit');
  select * into inv from invoices where id = p_invoice for update;
  if inv.id is null then raise exception 'الفاتورة غير موجودة'; end if;
  if inv.paid > 0 then raise exception 'على الفاتورة مدفوعات. احذف الدفعات أولًا'; end if;
  if inv.discount_code_id is not null then update discount_codes set used_count = greatest(used_count - 1, 0) where id = inv.discount_code_id; end if;
  update invoices set status = 'cancelled' where id = p_invoice;
  -- الجلسات اللي اتشرت بالفاتورة دي: مابقاش ينفع Check-in عليها (سجل الحضور القديم بيفضل)
  update packages set status = 'cancelled' where invoice_id = p_invoice and status in ('active','pending_payment','completed');
  perform log_action('إلغاء الفاتورة ' || inv.no, inv.patient_id);
end $function$;

create or replace function delete_invoice(p_invoice uuid) returns void
language plpgsql security definer set search_path = public as $function$
declare inv invoices; n_pay int; n_ck int;
begin
  perform require_perm('invoices', 'delete');
  select * into inv from invoices where id = p_invoice for update;
  if inv.id is null then raise exception 'الفاتورة غير موجودة'; end if;
  if exists (select 1 from zatca_documents where invoice_id = p_invoice and status <> 'awaiting') then
    raise exception 'الفاتورة % اتبعتت لهيئة الزكاة — لا يمكن حذفها (ألغِها ليصدر إشعار دائن)', inv.no;
  end if;
  select count(*) into n_ck from package_checkins c join packages k on k.id = c.package_id where k.invoice_id = p_invoice and c.cancelled_at is null;
  if n_ck > 0 then raise exception 'على الفاتورة % حضور مسجّل (% جلسة) — لا يمكن حذفها، ألغِها بدل الحذف', inv.no, n_ck; end if;
  delete from zatca_documents where invoice_id = p_invoice;
  select count(*) into n_pay from payments where invoice_id = p_invoice;
  if inv.discount_code_id is not null then update discount_codes set used_count = greatest(used_count - 1, 0) where id = inv.discount_code_id; end if;
  delete from package_checkins where package_id in (select id from packages where invoice_id = p_invoice);  -- ملغية بس (اتأكدنا فوق)
  update appointments set package_id = null where package_id in (select id from packages where invoice_id = p_invoice);
  delete from packages where invoice_id = p_invoice;
  delete from invoices where id = p_invoice; -- الدفعات وبنود الفاتورة وطلبات التقسيط بتتحذف تلقائيًا (cascade)
  perform log_action('حذف الفاتورة ' || inv.no || case when n_pay > 0 then ' مع ' || n_pay || ' دفعة' else '' end, inv.patient_id);
end $function$;

-- ===== 7) الصلاحيات =====
revoke execute on function norm_file_no(text), patient_by_file_no(text), package_balance_json(packages), create_session_invoice(jsonb), checkin_search(text),
  session_check_in(uuid, text), checkin_cancel(uuid, text), checkin_log(date, date, uuid, uuid) from public, anon;
grant execute on function patient_by_file_no(text), create_session_invoice(jsonb), checkin_search(text),
  session_check_in(uuid, text), checkin_cancel(uuid, text), checkin_log(date, date, uuid, uuid) to authenticated;
revoke execute on function package_balance_json(packages) from authenticated;
grant execute on function norm_file_no(text) to authenticated;
