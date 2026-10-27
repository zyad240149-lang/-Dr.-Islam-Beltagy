-- اسم المدير اللي وافق على التقسيط بيتسجّل على كل دفعة تقسيط (عشان الفاتورة المطبوعة/PDF تعرضه مباشرة)
alter table payments add column if not exists installment_approved_by uuid references employees(id) on delete set null;
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

  insert into payments (invoice_id, patient_id, amount, method, note, created_by, installment_no, installment_approved_by)
  values (p_invoice, inv.patient_id, p_amount, p_method, coalesce(p_note, ''), my_employee_id(), inst, case when inst is not null then req.decided_by end);
  perform recalc_invoice(p_invoice);
  perform log_action('تسجيل ' || case inst when 1 then 'الدفعة الأولى ' when 2 then 'الدفعة الثانية ' else 'دفعة ' end
    || p_amount || ' ر.س على ' || inv.no, inv.patient_id);
end $$;
