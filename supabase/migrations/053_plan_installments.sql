-- الدفع على دفعتين بموافقة المدير بقى متاح كمان لفواتير الخطط العلاجية (بيتحدد من نافذة «مراجعة فاتورة الخطة العلاجية»).
-- فاتورة الخطة بتخضع لقواعد التقسيط بس لو اتبعت عليها طلب — غير كده بتفضل على نظام الدفع القديم زي ما هي.
alter table package_installment_requests alter column package_id drop not null;
alter table package_installment_requests add column if not exists plan_id uuid references treatment_plans(id) on delete set null;

create or replace function record_payment(p_invoice uuid, p_amount numeric, p_method text, p_note text default '') returns void
language plpgsql security definer set search_path = public as $$
declare inv invoices; pk packages; req package_installment_requests; n_paid int; inst int; governed boolean;
begin
  perform require_perm('payments', 'create');
  select * into inv from invoices where id = p_invoice for update;
  if inv.id is null then raise exception 'الفاتورة غير موجودة'; end if;
  if inv.status = 'cancelled' then raise exception 'لا يمكن الدفع على فاتورة ملغاة'; end if;
  if inv.status = 'draft' then raise exception 'الفاتورة بانتظار المراجعة والاعتماد أولًا'; end if;
  if p_method not in ('cash','card','transfer') then raise exception 'طريقة الدفع غير صحيحة'; end if;
  if p_amount is null or p_amount <= 0 or p_amount > inv.remaining then raise exception 'المبلغ يجب أن يكون بين 1 و % ر.س', inv.remaining; end if;

  if inv.package_id is not null then select * into pk from packages where id = inv.package_id; end if;
  -- خاضعة للتقسيط: باقة 4/6 دايمًا، أو فاتورة خطة علاجية عليها طلب تقسيط (بانتظار/موافق/مرفوض)
  governed := pk.kind is not null or (inv.plan_id is not null and exists (select 1 from package_installment_requests where invoice_id = inv.id and status in ('pending','approved','rejected')));
  if governed then
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
        raise exception 'الدفع الجزئي غير مسموح لهذه الفاتورة بدون موافقة المدير — ادفع المبلغ كاملًا (% ر.س) أو أرسل طلب الدفع على دفعتين', inv.remaining;
      end if;
    end if;
  end if;

  insert into payments (invoice_id, patient_id, amount, method, note, created_by, installment_no, installment_approved_by)
  values (p_invoice, inv.patient_id, p_amount, p_method, coalesce(p_note, ''), my_employee_id(), inst, case when inst is not null then req.decided_by end);
  perform recalc_invoice(p_invoice);
  perform log_action('تسجيل ' || case inst when 1 then 'الدفعة الأولى ' when 2 then 'الدفعة الثانية ' else 'دفعة ' end
    || p_amount || ' ر.س على ' || inv.no, inv.patient_id);
end $$;

create or replace function update_payment(p_id uuid, p_amount numeric, p_method text, p_note text) returns void
language plpgsql security definer set search_path = public as $$
declare pay payments; inv invoices;
begin
  perform require_perm('payments', 'edit');
  select * into pay from payments where id = p_id;
  if pay.id is null then raise exception 'الدفعة غير موجودة'; end if;
  if pay.voided_at is not null then raise exception 'الدفعة ملغاة'; end if;
  select * into inv from invoices where id = pay.invoice_id for update;
  if exists (select 1 from packages where id = inv.package_id and kind is not null) or exists (select 1 from package_installment_requests where invoice_id = inv.id and status in ('pending','approved','rejected')) then
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
  if exists (select 1 from invoices i join packages k on k.id = i.package_id where i.id = pay.invoice_id and k.kind is not null) or exists (select 1 from package_installment_requests where invoice_id = pay.invoice_id and status in ('pending','approved','rejected')) then
    raise exception 'دفعات باقات الجلسات لا تُحذف — استخدم إلغاء الدفعة (يحتفظ بالسجل)'; end if;
  delete from payments where id = p_id;
  perform recalc_invoice(pay.invoice_id);
  perform log_action('حذف دفعة ' || pay.amount || ' ر.س من ' || (select no from invoices where id = pay.invoice_id), pay.patient_id);
end $$;

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
  if pk.kind is null and not exists (select 1 from package_installment_requests where invoice_id = inv.id and status in ('approved','rejected','pending')) then
    raise exception 'الإلغاء بالسجل مخصص لدفعات الباقات وفواتير التقسيط'; end if;
  if pk.kind is not null and pk.used_sessions > 0 then raise exception 'لا يمكن إلغاء الدفعة — تم استخدام % جلسة من الباقة', pk.used_sessions; end if;
  -- الدفعة الأولى مايتلغيش وفيه دفعة تانية سارية
  if pay.installment_no = 1 and exists (select 1 from payments where invoice_id = inv.id and installment_no = 2 and voided_at is null) then
    raise exception 'ألغِ الدفعة الثانية أولًا'; end if;
  update payments set voided_at = now(), voided_by = emp, void_reason = trim(p_reason) where id = p_id;
  perform recalc_invoice(inv.id);
  perform log_action('إلغاء دفعة ' || pay.amount || ' ر.س من ' || inv.no || ' — السبب: ' || trim(p_reason), inv.patient_id);
end $$;

create or replace function request_package_installment(p_invoice uuid, p_reason text default null) returns uuid
language plpgsql security definer set search_path = public as $$
declare emp uuid; inv invoices; pk packages; v uuid; first_amt numeric;
begin
  emp := require_perm('installments', 'create');
  select * into inv from invoices where id = p_invoice for update;
  if inv.id is null then raise exception 'الفاتورة غير موجودة'; end if;
  if inv.package_id is not null then select * into pk from packages where id = inv.package_id; end if;
  if pk.kind is null and inv.plan_id is null then raise exception 'الدفع على دفعتين متاح فقط لباقة 4 جلسات وباقة 6 جلسات وفواتير الخطط العلاجية'; end if;
  if inv.status = 'draft' then raise exception 'اعتمد الفاتورة أولًا'; end if;
  if inv.status = 'cancelled' or pk.status = 'cancelled' then raise exception 'الفاتورة أو الباقة ملغاة'; end if;
  if inv.paid > 0 then raise exception 'تم تسجيل دفع على الفاتورة بالفعل — لا يمكن طلب التقسيط'; end if;
  if exists (select 1 from package_installment_requests where invoice_id = inv.id and status = 'pending') then raise exception 'يوجد طلب بانتظار موافقة المدير لهذه الفاتورة'; end if;
  if exists (select 1 from package_installment_requests where invoice_id = inv.id and status = 'approved') then raise exception 'تمت الموافقة على التقسيط لهذه الفاتورة بالفعل'; end if;
  -- بعد الرفض: مايتبعتش طلب تاني من المحاسب (مايتجاوزش الرفض)
  if exists (select 1 from package_installment_requests where invoice_id = inv.id and status = 'rejected') then
    raise exception 'تم رفض التقسيط لهذه الفاتورة — الدفع الكامل فقط'; end if;
  first_amt := round(inv.total / 2, 2);
  insert into package_installment_requests (invoice_id, package_id, plan_id, patient_id, total, first_amount, second_amount, reason, requested_by)
  values (inv.id, pk.id, inv.plan_id, inv.patient_id, inv.total, first_amt, inv.total - first_amt, nullif(trim(coalesce(p_reason, '')), ''), emp)
  returning id into v;
  perform notify_staff('installment_request', 'طلب دفع باقة على دفعتين',
    (select full_name from patients where id = inv.patient_id) || ' — ' || coalesce(pk.name, inv.service_name) || ' (' || inv.total || ' ر.س)', v::text, '/installments', inv.patient_id);
  perform log_action('طلب دفع ' || coalesce(pk.name, inv.service_name) || ' على دفعتين (' || first_amt || ' + ' || (inv.total - first_amt) || ') — ' || inv.no, inv.patient_id);
  return v;
end $$;

create or replace function guard_fixed_package_invoice() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if (new.price is distinct from old.price or new.discount is distinct from old.discount)
     and (exists (select 1 from packages where id = new.package_id and kind is not null) and old.paid > 0
          or exists (select 1 from package_installment_requests where invoice_id = new.id and status in ('pending','approved'))) then
    raise exception 'لا يمكن تعديل سعر أو خصم الفاتورة بعد طلب التقسيط أو تسجيل دفع';
  end if;
  return new;
end $$;
