-- ====================================================================================
-- باقات الجلسات الثابتة (باقة 4 جلسات / باقة 6 جلسات) + الدفع الكامل أو على دفعتين بموافقة المدير.
-- الـ Workflow ده بيتطبّق بس على الباقات اللي نوعها pkg4 / pkg6 — أي فاتورة تانية بتفضل على نظام الدفع القديم زي ما هو.
--
--  • الباقة الثابتة بتتعمل بحالة pending_payment (مش قابلة للحجز) وتتفعّل تلقائيًا أول ما الفاتورة تبقى مدفوعة بالكامل.
--  • بدون موافقة: الدفعة الوحيدة المسموحة = كامل المبلغ.
--  • بعد موافقة المدير: الدفعة الأولى = 50% بالظبط، والتانية = المتبقي بالظبط (مفيش نسب يدوية).
--  • المحاسب مايقدرش يوافق على طلبه، ولا يتجاوز الرفض، ولا يعدّل/يحذف دفعات الباقة (إلغاء بس مع سجل).
--  • الدفعات مابتتمسحش: الإلغاء بيعلّم الدفعة voided ويحتفظ بيها.
-- ====================================================================================

-- ---------- 1) نوع الباقة في الكتالوج ----------
alter table package_plans add column if not exists kind text;
alter table package_plans drop constraint if exists package_plans_kind_check;
alter table package_plans add constraint package_plans_kind_check check (
  kind is null or (kind = 'pkg4' and total_sessions = 4) or (kind = 'pkg6' and total_sessions = 6));

-- ---------- 2) الباقة المباعة ----------
alter table packages add column if not exists kind text check (kind in ('pkg4','pkg6'));
alter table packages add column if not exists plan_id uuid references package_plans(id) on delete set null;
alter table packages add column if not exists activated_at timestamptz;
alter table packages drop constraint if exists packages_status_check;
alter table packages add constraint packages_status_check check (status in ('pending_payment','active','expired','completed','cancelled'));
alter table packages drop constraint if exists packages_used_le_total;
alter table packages add constraint packages_used_le_total check (used_sessions >= 0 and used_sessions <= total_sessions);

-- ---------- 3) الدفعات: إلغاء بدل حذف + رقم الدفعة ----------
alter table payments add column if not exists installment_no int check (installment_no in (1,2));
alter table payments add column if not exists voided_at timestamptz;
alter table payments add column if not exists voided_by uuid references employees(id) on delete set null;
alter table payments add column if not exists void_reason text;

-- ---------- 4) طلبات التقسيط ----------
create table if not exists package_installment_requests (
  id uuid primary key default gen_random_uuid(),
  invoice_id uuid not null references invoices(id) on delete cascade,
  package_id uuid not null references packages(id) on delete cascade,
  patient_id uuid not null references patients(id) on delete cascade,
  total numeric(10,2) not null,
  first_amount numeric(10,2) not null,
  second_amount numeric(10,2) not null,
  reason text,
  status text not null default 'pending' check (status in ('pending','approved','rejected','cancelled')),
  requested_by uuid references employees(id) on delete set null,
  requested_at timestamptz not null default now(),
  decided_by uuid references employees(id) on delete set null,
  decided_at timestamptz,
  reject_reason text
);
-- طلب واحد مفتوح (بانتظار/موافق عليه) لكل فاتورة
create unique index if not exists pir_open_uq on package_installment_requests (invoice_id) where status in ('pending','approved');
create index if not exists pir_status_idx on package_installment_requests (status, requested_at desc);
alter table package_installment_requests enable row level security;
drop policy if exists pir_staff_read on package_installment_requests;
drop policy if exists pir_self_read on package_installment_requests;
create policy pir_staff_read on package_installment_requests for select
  using ((has_perm('installments','view') or has_perm('invoices','view')) and can_see_patient(patient_id));
create policy pir_self_read on package_installment_requests for select using (patient_id = my_patient_id());
revoke insert, update, delete on package_installment_requests from authenticated, anon;
grant select on package_installment_requests to authenticated;
drop trigger if exists trg_audit_row on package_installment_requests;
create trigger trg_audit_row after insert or update or delete on package_installment_requests for each row execute function audit_row();
drop trigger if exists trg_audit_row on package_plans;
create trigger trg_audit_row after insert or update or delete on package_plans for each row execute function audit_row();

-- الدفعات بقت مابتتحذفش — ممنوع أي كتابة مباشرة (كانت RPC فقط أصلًا، تأكيد)
revoke insert, update, delete on payments from authenticated, anon;

-- ---------- 5) إعادة الحساب: تجاهل الدفعات الملغاة + تفعيل الباقة الثابتة عند السداد الكامل ----------
create or replace function recalc_invoice(p_id uuid) returns void
language plpgsql security definer set search_path = public as $$
declare base numeric; inv invoices; pk packages;
begin
  update invoices i set paid = coalesce((select sum(amount) from payments where invoice_id = i.id and voided_at is null), 0) where id = p_id;
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
  where id = p_id
  returning * into inv;
  -- الباقة الثابتة: تتفعّل بس لما المتبقي = 0
  if inv.package_id is not null then
    select * into pk from packages where id = inv.package_id for update;
    if pk.kind is not null then
      if inv.status = 'paid' and pk.status = 'pending_payment' then
        update packages set status = 'active', activated_at = now(), start_date = riyadh_today(),
          expiry_date = riyadh_today() + coalesce((select valid_days from package_plans where id = pk.plan_id), greatest(expiry_date - start_date, 90))
        where id = pk.id;
        perform log_action('تفعيل ' || pk.name || ' بعد السداد الكامل — ' || pk.total_sessions || ' جلسات', pk.patient_id);
      elsif inv.status in ('due','partial') and pk.status = 'active' and pk.used_sessions = 0 then
        -- دفعة اتلغت قبل استخدام أي جلسة: الباقة ترجع بانتظار الدفع
        update packages set status = 'pending_payment', activated_at = null where id = pk.id;
      end if;
    end if;
  end if;
end $$;

-- ---------- 6) بيع الباقة ----------
create or replace function sell_package(p_patient uuid, p_package_plan uuid) returns jsonb
language plpgsql security definer set search_path = public as $$
declare pp package_plans; v uuid; pts int; inv uuid;
begin
  perform require_perm('packages', 'create');
  select * into pp from package_plans where id = p_package_plan and active;
  if pp.id is null then raise exception 'الباقة غير متاحة'; end if;
  if not exists (select 1 from patients where id = p_patient) then raise exception 'اختر المريض'; end if;
  -- عدد الجلسات بييجي من الكتالوج (ثابت 4 أو 6 للباقات الثابتة) — مفيش أي مدخل يغيّره وقت البيع
  insert into packages (patient_id, name, service_ids, total_sessions, price, start_date, expiry_date, status, kind, plan_id)
  values (p_patient, pp.name, pp.service_ids, pp.total_sessions, pp.price, riyadh_today(), riyadh_today() + pp.valid_days,
          case when pp.kind is not null then 'pending_payment' else 'active' end, pp.kind, pp.id)
  returning id into v;
  inv := new_invoice(p_patient, pp.name, pp.price, 'due', riyadh_today(), null, v, null, null);
  select loyalty_package_points into pts from center_info limit 1;
  perform award_loyalty_points(p_patient, 'package', coalesce(pts, 4), 'نقاط شراء باقة: ' || pp.name, 'package', v);
  perform log_action('بيع ' || pp.name || ' (' || pp.total_sessions || ' جلسات) بقيمة ' || pp.price || ' ر.س'
    || case when pp.kind is not null then ' — بانتظار الدفع' else '' end, p_patient);
  return jsonb_build_object('id', v, 'invoiceId', inv);
end $$;

-- ---------- 7) تسجيل الدفع ----------
create or replace function record_payment(p_invoice uuid, p_amount numeric, p_method text, p_note text default '') returns void
language plpgsql security definer set search_path = public as $$
declare inv invoices; pk packages; req package_installment_requests; n_paid int; inst int;
begin
  perform require_perm('payments', 'create');
  select * into inv from invoices where id = p_invoice for update;
  if inv.id is null then raise exception 'الفاتورة غير موجودة'; end if;
  if inv.status = 'cancelled' then raise exception 'لا يمكن الدفع على فاتورة ملغاة'; end if;
  if inv.status = 'draft' then raise exception 'الفاتورة بانتظار المراجعة والاعتماد أولًا'; end if;
  if p_method not in ('cash','card','transfer') then raise exception 'طريقة الدفع غير صحيحة'; end if;
  if p_amount is null or p_amount <= 0 or p_amount > inv.remaining then raise exception 'المبلغ يجب أن يكون بين 1 و % ر.س', inv.remaining; end if;

  if inv.package_id is not null then select * into pk from packages where id = inv.package_id; end if;
  if pk.kind is not null then
    if pk.status = 'cancelled' then raise exception 'الباقة ملغاة'; end if;
    select * into req from package_installment_requests where invoice_id = inv.id and status in ('pending','approved') limit 1;
    select count(*) into n_paid from payments where invoice_id = inv.id and voided_at is null;
    if req.status = 'pending' then
      raise exception 'طلب الدفع على دفعتين بانتظار موافقة المدير — لا يمكن تسجيل أي دفعة الآن';
    elsif req.status = 'approved' then
      if req.total <> inv.total then raise exception 'قيمة الفاتورة تغيّرت بعد الموافقة على التقسيط — يلزم طلب جديد'; end if;
      if n_paid = 0 then
        if p_amount <> req.first_amount then raise exception 'الدفعة الأولى يجب أن تكون % ر.س بالضبط (50%%)', req.first_amount; end if;
        inst := 1;
      else
        if p_amount <> inv.remaining then raise exception 'الدفعة الثانية يجب أن تكون المتبقي بالكامل: % ر.س', inv.remaining; end if;
        inst := 2;
      end if;
    else
      -- بدون موافقة (أو بعد الرفض): الدفع الكامل فقط
      if n_paid > 0 or p_amount <> inv.remaining then
        raise exception 'الدفع الجزئي غير مسموح لهذه الباقة بدون موافقة المدير — ادفع المبلغ كاملًا (% ر.س) أو أرسل طلب الدفع على دفعتين', inv.remaining;
      end if;
    end if;
  end if;

  insert into payments (invoice_id, patient_id, amount, method, note, created_by, installment_no)
  values (p_invoice, inv.patient_id, p_amount, p_method, coalesce(p_note, ''), my_employee_id(), inst);
  perform recalc_invoice(p_invoice);
  perform log_action('تسجيل ' || case inst when 1 then 'الدفعة الأولى ' when 2 then 'الدفعة الثانية ' else 'دفعة ' end
    || p_amount || ' ر.س على ' || inv.no, inv.patient_id);
end $$;

-- دفعات الباقات الثابتة: مفيش تعديل ولا حذف — إلغاء (void) بس
create or replace function update_payment(p_id uuid, p_amount numeric, p_method text, p_note text) returns void
language plpgsql security definer set search_path = public as $$
declare pay payments; inv invoices;
begin
  perform require_perm('payments', 'edit');
  select * into pay from payments where id = p_id;
  if pay.id is null then raise exception 'الدفعة غير موجودة'; end if;
  if pay.voided_at is not null then raise exception 'الدفعة ملغاة'; end if;
  select * into inv from invoices where id = pay.invoice_id for update;
  if exists (select 1 from packages where id = inv.package_id and kind is not null) then
    raise exception 'دفعات باقات الجلسات لا تُعدَّل — استخدم إلغاء الدفعة ثم سجّلها من جديد'; end if;
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
  select * into pay from payments where id = p_id;
  if pay.id is null then raise exception 'الدفعة غير موجودة'; end if;
  if exists (select 1 from invoices i join packages k on k.id = i.package_id where i.id = pay.invoice_id and k.kind is not null) then
    raise exception 'دفعات باقات الجلسات لا تُحذف — استخدم إلغاء الدفعة (يحتفظ بالسجل)'; end if;
  delete from payments where id = p_id;
  perform recalc_invoice(pay.invoice_id);
  perform log_action('حذف دفعة ' || pay.amount || ' ر.س من ' || (select no from invoices where id = pay.invoice_id), pay.patient_id);
end $$;

-- إلغاء دفعة باقة (بيحتفظ بالسجل) — للمدير فقط، ومش بعد استخدام جلسات من الباقة
create or replace function void_package_payment(p_id uuid, p_reason text) returns void
language plpgsql security definer set search_path = public as $$
declare emp uuid; pay payments; inv invoices; pk packages;
begin
  emp := require_perm('installments', 'edit');
  select * into pay from payments where id = p_id for update;
  if pay.id is null then raise exception 'الدفعة غير موجودة'; end if;
  if pay.voided_at is not null then raise exception 'الدفعة ملغاة بالفعل'; end if;
  if nullif(trim(coalesce(p_reason, '')), '') is null then raise exception 'اكتب سبب إلغاء الدفعة'; end if;
  select * into inv from invoices where id = pay.invoice_id for update;
  select * into pk from packages where id = inv.package_id;
  if pk.kind is null then raise exception 'الإلغاء بالسجل مخصص لدفعات باقات الجلسات'; end if;
  if pk.used_sessions > 0 then raise exception 'لا يمكن إلغاء الدفعة — تم استخدام % جلسة من الباقة', pk.used_sessions; end if;
  -- الدفعة الأولى مايتلغيش وفيه دفعة تانية سارية
  if pay.installment_no = 1 and exists (select 1 from payments where invoice_id = inv.id and installment_no = 2 and voided_at is null) then
    raise exception 'ألغِ الدفعة الثانية أولًا'; end if;
  update payments set voided_at = now(), voided_by = emp, void_reason = trim(p_reason) where id = p_id;
  perform recalc_invoice(inv.id);
  perform log_action('إلغاء دفعة ' || pay.amount || ' ر.س من ' || inv.no || ' — السبب: ' || trim(p_reason), inv.patient_id);
end $$;

-- ---------- 8) طلب التقسيط / قرار المدير ----------
create or replace function request_package_installment(p_invoice uuid, p_reason text default null) returns uuid
language plpgsql security definer set search_path = public as $$
declare emp uuid; inv invoices; pk packages; v uuid; first_amt numeric;
begin
  emp := require_perm('installments', 'create');
  select * into inv from invoices where id = p_invoice for update;
  if inv.id is null then raise exception 'الفاتورة غير موجودة'; end if;
  select * into pk from packages where id = inv.package_id;
  if pk.kind is null then raise exception 'الدفع على دفعتين متاح فقط لباقة 4 جلسات وباقة 6 جلسات'; end if;
  if inv.status = 'cancelled' or pk.status = 'cancelled' then raise exception 'الفاتورة أو الباقة ملغاة'; end if;
  if inv.paid > 0 then raise exception 'تم تسجيل دفع على الفاتورة بالفعل — لا يمكن طلب التقسيط'; end if;
  if exists (select 1 from package_installment_requests where invoice_id = inv.id and status = 'pending') then raise exception 'يوجد طلب بانتظار موافقة المدير لهذه الفاتورة'; end if;
  if exists (select 1 from package_installment_requests where invoice_id = inv.id and status = 'approved') then raise exception 'تمت الموافقة على التقسيط لهذه الفاتورة بالفعل'; end if;
  -- بعد الرفض: مايتبعتش طلب تاني من المحاسب (مايتجاوزش الرفض)
  if exists (select 1 from package_installment_requests where invoice_id = inv.id and status = 'rejected') then
    raise exception 'تم رفض التقسيط لهذه الفاتورة — الدفع الكامل فقط'; end if;
  first_amt := round(inv.total / 2, 2);
  insert into package_installment_requests (invoice_id, package_id, patient_id, total, first_amount, second_amount, reason, requested_by)
  values (inv.id, pk.id, inv.patient_id, inv.total, first_amt, inv.total - first_amt, nullif(trim(coalesce(p_reason, '')), ''), emp)
  returning id into v;
  perform notify_staff('installment_request', 'طلب دفع باقة على دفعتين',
    (select full_name from patients where id = inv.patient_id) || ' — ' || pk.name || ' (' || inv.total || ' ر.س)', v::text, '/installments', inv.patient_id);
  perform log_action('طلب دفع ' || pk.name || ' على دفعتين (' || first_amt || ' + ' || (inv.total - first_amt) || ') — ' || inv.no, inv.patient_id);
  return v;
end $$;

create or replace function decide_package_installment(p_id uuid, p_approve boolean, p_reason text default null) returns void
language plpgsql security definer set search_path = public as $$
declare emp uuid; r package_installment_requests; inv invoices;
begin
  emp := require_perm('installments', 'edit');
  select * into r from package_installment_requests where id = p_id for update;
  if r.id is null then raise exception 'الطلب غير موجود'; end if;
  if r.status <> 'pending' then raise exception 'تم اتخاذ قرار في هذا الطلب بالفعل'; end if;
  if r.requested_by = emp then raise exception 'لا يمكنك الموافقة أو الرفض على طلب أرسلته بنفسك'; end if;
  select * into inv from invoices where id = r.invoice_id;
  if p_approve and (inv.status = 'cancelled' or inv.paid > 0 or inv.total <> r.total) then
    raise exception 'الفاتورة تغيّرت منذ إرسال الطلب — لا يمكن الموافقة'; end if;
  update package_installment_requests set status = case when p_approve then 'approved' else 'rejected' end,
    decided_by = emp, decided_at = now(), reject_reason = case when p_approve then null else nullif(trim(coalesce(p_reason, '')), '') end
  where id = p_id;
  perform log_action(case when p_approve then 'موافقة على دفع ' else 'رفض دفع ' end || inv.no || ' على دفعتين'
    || case when not p_approve and nullif(trim(coalesce(p_reason, '')), '') is not null then ' — السبب: ' || trim(p_reason) else '' end, r.patient_id);
end $$;

-- ---------- 9) منع حجز جلسات أكتر من عدد الباقة ----------
create or replace function guard_package_bookings() returns trigger
language plpgsql security definer set search_path = public as $$
declare pk packages; n int;
begin
  if new.package_id is null or new.status in ('cancelled','no_show','rescheduled') then return new; end if;
  if tg_op = 'UPDATE' and old.package_id is not distinct from new.package_id and old.status not in ('cancelled','no_show','rescheduled') then return new; end if;
  select * into pk from packages where id = new.package_id for update;
  if pk.kind is null then return new; end if;
  if pk.status <> 'active' then raise exception 'الباقة غير مفعّلة — لازم تكون مدفوعة بالكامل'; end if;
  select count(*) into n from appointments where package_id = pk.id and id <> new.id and status not in ('cancelled','no_show','rescheduled');
  if n + 1 > pk.total_sessions then
    raise exception 'تم حجز كل جلسات الباقة (%/%) — لا يمكن إضافة جلسة أخرى', n, pk.total_sessions; end if;
  return new;
end $$;
drop trigger if exists trg_guard_package_bookings on appointments;
create trigger trg_guard_package_bookings before insert or update of package_id, status on appointments
  for each row execute function guard_package_bookings();

revoke execute on function void_package_payment(uuid, text), request_package_installment(uuid, text), decide_package_installment(uuid, boolean, text) from public, anon;
grant execute on function void_package_payment(uuid, text), request_package_installment(uuid, text), decide_package_installment(uuid, boolean, text) to authenticated;

-- ---------- 10) الصلاحيات ----------
insert into role_permissions (role, area, ops) values
  ('system_admin', 'installments', '{view,create,edit,delete}'),
  ('center_manager', 'installments', '{view,create,edit,delete}'),
  ('accountant', 'installments', '{view,create}'),
  ('reception', 'installments', '{}'),
  ('secretary', 'installments', '{}'),
  ('therapist', 'installments', '{}')
on conflict (role, area) do update set ops = excluded.ops;

do $$ begin
  begin alter publication supabase_realtime add table package_installment_requests; exception when others then null; end;
end $$;
