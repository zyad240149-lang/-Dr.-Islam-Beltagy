-- ====================================================================================
-- دورة التقسيط من قسم «المراجعة والتعديل» + الفصل بين موافقة المدير وإتمام المحاسب للفاتورة
--  • طلب التقسيط بيتبعت وفاتورة الخطة لسه «مسودة» في المراجعة — والموافقة مابتنقلهاش ولا بتعتمدها.
--  • إتمام/اعتماد الفاتورة (draft → due) ممنوع وطلب التقسيط لسه بانتظار المدير، وبيتسجّل مين أتمّها وإمتى.
--  • تاريخ استحقاق لكل دفعة + تعديل التواريخ للمدير فقط مع سجل.
--  • تتبّع آخر تعديل على الخطة العلاجية (مين وإمتى).
--  • ربط الملفات/الأشعة بالخطة أو الزيارة (بدون ما تضيع لو الخطة اتعدلت/اتحذفت).
-- ====================================================================================

-- ---------- 1) تواريخ الاستحقاق ----------
alter table package_installment_requests add column if not exists first_due_date date;
alter table package_installment_requests add column if not exists second_due_date date;
update package_installment_requests set first_due_date = coalesce(first_due_date, requested_at::date),
  second_due_date = coalesce(second_due_date, requested_at::date + 30);

-- ---------- 2) مين أتمّ الفاتورة ----------
alter table invoices add column if not exists issued_by uuid references employees(id) on delete set null;
alter table invoices add column if not exists issued_at timestamptz;

create or replace function guard_invoice_issue() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if old.status = 'draft' and new.status not in ('draft','cancelled') then
    if exists (select 1 from package_installment_requests where invoice_id = new.id and status = 'pending') then
      raise exception 'لا يمكن إتمام الفاتورة — طلب التقسيط بانتظار موافقة المدير';
    end if;
    new.issued_by := coalesce(my_employee_id(), new.issued_by);
    new.issued_at := now();
  end if;
  return new;
end $$;
drop trigger if exists trg_guard_invoice_issue on invoices;
create trigger trg_guard_invoice_issue before update of status on invoices for each row execute function guard_invoice_issue();

-- ---------- 3) طلب التقسيط: مسموح والفاتورة لسه في المراجعة ----------
drop function if exists request_package_installment(uuid, text);
create or replace function request_package_installment(p_invoice uuid, p_reason text default null,
  p_first_due date default null, p_second_due date default null) returns uuid
language plpgsql security definer set search_path = public as $$
declare emp uuid; inv invoices; pk packages; v uuid; first_amt numeric; d1 date; d2 date;
begin
  emp := require_perm('installments', 'create');
  select * into inv from invoices where id = p_invoice for update;
  if inv.id is null then raise exception 'الفاتورة غير موجودة'; end if;
  if inv.package_id is not null then select * into pk from packages where id = inv.package_id; end if;
  if pk.kind is null and inv.plan_id is null then raise exception 'الدفع على دفعتين متاح فقط لباقة 4 جلسات وباقة 6 جلسات وفواتير الخطط العلاجية'; end if;
  if inv.status = 'draft' and inv.plan_id is null then raise exception 'اعتمد الفاتورة أولًا'; end if;
  if inv.status = 'cancelled' or pk.status = 'cancelled' then raise exception 'الفاتورة أو الباقة ملغاة'; end if;
  if inv.total <= 0 then raise exception 'إجمالي الفاتورة صفر'; end if;
  if inv.paid > 0 then raise exception 'تم تسجيل دفع على الفاتورة بالفعل — لا يمكن طلب التقسيط'; end if;
  if exists (select 1 from package_installment_requests where invoice_id = inv.id and status = 'pending') then raise exception 'يوجد طلب بانتظار موافقة المدير لهذه الفاتورة'; end if;
  if exists (select 1 from package_installment_requests where invoice_id = inv.id and status = 'approved') then raise exception 'تمت الموافقة على التقسيط لهذه الفاتورة بالفعل'; end if;
  if exists (select 1 from package_installment_requests where invoice_id = inv.id and status = 'rejected') then
    raise exception 'تم رفض التقسيط لهذه الفاتورة — الدفع الكامل فقط'; end if;
  d1 := coalesce(p_first_due, riyadh_today());
  d2 := coalesce(p_second_due, d1 + 30);
  if d1 < riyadh_today() then raise exception 'تاريخ استحقاق الدفعة الأولى لا يمكن أن يكون في الماضي'; end if;
  if d2 <= d1 then raise exception 'تاريخ استحقاق الدفعة الثانية لازم يكون بعد الأولى'; end if;
  first_amt := round(inv.total / 2, 2);
  insert into package_installment_requests (invoice_id, package_id, plan_id, patient_id, total, first_amount, second_amount, reason, requested_by, first_due_date, second_due_date)
  values (inv.id, pk.id, inv.plan_id, inv.patient_id, inv.total, first_amt, inv.total - first_amt, nullif(trim(coalesce(p_reason, '')), ''), emp, d1, d2)
  returning id into v;
  perform notify_staff('installment_request', 'طلب دفع على دفعتين',
    (select full_name from patients where id = inv.patient_id) || ' — ' || coalesce(pk.name, inv.service_name) || ' (' || inv.total || ' ر.س)', v::text, '/installments', inv.patient_id);
  perform log_action('طلب دفع ' || coalesce(pk.name, inv.service_name) || ' على دفعتين (' || first_amt || ' بتاريخ ' || d1 || ' + ' || (inv.total - first_amt) || ' بتاريخ ' || d2 || ') — ' || inv.no, inv.patient_id);
  return v;
end $$;
revoke execute on function request_package_installment(uuid, text, date, date) from public, anon;
grant execute on function request_package_installment(uuid, text, date, date) to authenticated;

-- ---------- 4) قرار المدير: الموافقة مابتغيّرش حالة الفاتورة (تفضل في المراجعة لحد ما المحاسب يتمّها) ----------
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
  if inv.created_by is not null or r.requested_by is not null then
    perform notify_staff('installment_decision', case when p_approve then 'تمت الموافقة على التقسيط' else 'تم رفض التقسيط' end,
      (select full_name from patients where id = r.patient_id) || ' — ' || inv.no, r.id::text, '/invoices', r.patient_id);
  end if;
  perform log_action(case when p_approve then 'موافقة على دفع ' else 'رفض دفع ' end || inv.no || ' على دفعتين'
    || case when not p_approve and nullif(trim(coalesce(p_reason, '')), '') is not null then ' — السبب: ' || trim(p_reason) else '' end, r.patient_id);
end $$;

-- ---------- 5) تعديل تواريخ الاستحقاق (للمدير) — المبالغ ثابتة 50/50 ----------
create or replace function update_installment_dates(p_id uuid, p_first_due date, p_second_due date) returns void
language plpgsql security definer set search_path = public as $$
declare emp uuid; r package_installment_requests; n int;
begin
  emp := require_perm('installments', 'edit');
  select * into r from package_installment_requests where id = p_id for update;
  if r.id is null then raise exception 'الطلب غير موجود'; end if;
  if r.status not in ('pending','approved') then raise exception 'لا يمكن تعديل طلب مرفوض أو ملغي'; end if;
  if p_first_due is null or p_second_due is null or p_second_due <= p_first_due then raise exception 'تاريخ الدفعة الثانية لازم يكون بعد الأولى'; end if;
  select count(*) into n from payments where invoice_id = r.invoice_id and voided_at is null;
  if n >= 1 and p_first_due is distinct from r.first_due_date then raise exception 'الدفعة الأولى مدفوعة — لا يمكن تغيير تاريخها'; end if;
  if n >= 2 then raise exception 'الدفعتين مدفوعتين'; end if;
  update package_installment_requests set first_due_date = p_first_due, second_due_date = p_second_due where id = p_id;
  perform log_action('تعديل تواريخ استحقاق التقسيط: ' || coalesce(r.first_due_date::text, '—') || ' / ' || coalesce(r.second_due_date::text, '—')
    || ' ← ' || p_first_due || ' / ' || p_second_due || ' — ' || (select no from invoices where id = r.invoice_id), r.patient_id);
end $$;
revoke execute on function update_installment_dates(uuid, date, date) from public, anon;
grant execute on function update_installment_dates(uuid, date, date) to authenticated;

-- ---------- 6) آخر تعديل على الخطة ----------
alter table treatment_plans add column if not exists updated_at timestamptz;
alter table treatment_plans add column if not exists updated_by uuid references employees(id) on delete set null;
create or replace function touch_plan() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  new.updated_at := now();
  new.updated_by := coalesce(my_employee_id(), new.updated_by);
  return new;
end $$;
drop trigger if exists trg_touch_plan on treatment_plans;
create trigger trg_touch_plan before update on treatment_plans for each row execute function touch_plan();

-- ---------- 7) ربط الملفات بالخطة/الزيارة ----------
alter table patient_files add column if not exists plan_id uuid references treatment_plans(id) on delete set null;
alter table patient_files add column if not exists appointment_id uuid references appointments(id) on delete set null;
create index if not exists patient_files_plan_idx on patient_files (plan_id);
create index if not exists patient_files_appt_idx on patient_files (appointment_id);

-- ---------- 8) الصلاحيات: الاستقبال/السكرتارية يقدروا يبعتوا طلب تقسيط (الموافقة للمدير بس) ----------
insert into role_permissions (role, area, ops) values
  ('reception', 'installments', '{view,create}'),
  ('secretary', 'installments', '{view,create}')
on conflict (role, area) do update set ops = excluded.ops;
