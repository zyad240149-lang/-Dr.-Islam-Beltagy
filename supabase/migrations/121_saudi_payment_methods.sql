-- وسائل الدفع السعودية (طلب الإدارة 2026-10-12): نقدًا، مدى، بطاقة (فيزا/ماستركارد)، Apple Pay، STC Pay، urpay، تحويل بنكي، سداد، تابي، تمارا، شيك، أخرى
-- («online» قديمة فاضلة للسجلات اللي اتسجّلت بيها). التسجيل يدوي (مفيش ربط مع بوابات دفع). مصدر القائمة الوحيد في القاعدة: is_payment_method().
create or replace function is_payment_method(p text) returns boolean language sql immutable as $$ select p in ('cash', 'mada', 'card', 'apple_pay', 'stc_pay', 'urpay', 'transfer', 'sadad', 'tabby', 'tamara', 'cheque', 'online', 'other') $$;

alter table payments drop constraint if exists payments_method_check;
alter table payments add constraint payments_method_check check (method in ('cash', 'mada', 'card', 'apple_pay', 'stc_pay', 'urpay', 'transfer', 'sadad', 'tabby', 'tamara', 'cheque', 'online', 'other'));
alter table product_sales drop constraint if exists product_sales_payment_method_check;
alter table product_sales add constraint product_sales_payment_method_check check (payment_method in ('cash', 'mada', 'card', 'apple_pay', 'stc_pay', 'urpay', 'transfer', 'sadad', 'tabby', 'tamara', 'cheque', 'online', 'other'));
alter table expenses drop constraint if exists expenses_payment_method_check;
alter table expenses add constraint expenses_payment_method_check check (payment_method in ('cash', 'mada', 'card', 'apple_pay', 'stc_pay', 'urpay', 'transfer', 'sadad', 'tabby', 'tamara', 'cheque', 'online', 'other'));

CREATE OR REPLACE FUNCTION public.record_payment(p_invoice uuid, p_amount numeric, p_method text, p_note text DEFAULT ''::text)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $$
declare inv invoices; pk packages; req package_installment_requests; n_paid int; inst int; governed boolean;
begin
  perform require_perm('payments', 'create');
  select * into inv from invoices where id = p_invoice for update;
  if inv.id is null then raise exception 'الفاتورة غير موجودة'; end if;
  if inv.status = 'cancelled' then raise exception 'لا يمكن الدفع على فاتورة ملغاة'; end if;
  if inv.status = 'draft' then raise exception 'الفاتورة بانتظار المراجعة والاعتماد أولًا'; end if;
  if not is_payment_method(p_method) then raise exception 'طريقة الدفع غير صحيحة'; end if;
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
end $$
;

CREATE OR REPLACE FUNCTION public.update_payment(p_id uuid, p_amount numeric, p_method text, p_note text)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $$
declare pay payments; inv invoices;
begin
  perform require_perm('payments', 'edit');
  select * into pay from payments where id = p_id;
  if pay.id is null then raise exception 'الدفعة غير موجودة'; end if;
  if pay.voided_at is not null then raise exception 'الدفعة ملغاة'; end if;
  select * into inv from invoices where id = pay.invoice_id for update;
  if exists (select 1 from packages where id = inv.package_id and kind is not null) or exists (select 1 from package_installment_requests where invoice_id = inv.id and status in ('pending','approved','rejected')) then
    raise exception 'دفعات باقات الجلسات لا تُعدَّل — استخدم إلغاء الدفعة ثم سجّلها من جديد'; end if;
  if not is_payment_method(p_method) then raise exception 'طريقة الدفع غير صحيحة'; end if;
  if p_amount is null or p_amount <= 0 or p_amount > inv.remaining + pay.amount then
    raise exception 'المبلغ يجب أن يكون بين 1 و % ر.س', inv.remaining + pay.amount;
  end if;
  update payments set amount = p_amount, method = p_method, note = coalesce(p_note, '') where id = p_id;
  perform recalc_invoice(inv.id);
  perform log_action('تعديل دفعة على ' || inv.no || ' إلى ' || p_amount || ' ر.س', inv.patient_id);
end $$
;

CREATE OR REPLACE FUNCTION public.sell_product(p_product uuid, p_qty integer, p_discount numeric DEFAULT 0, p_patient uuid DEFAULT NULL::uuid, p_customer_name text DEFAULT NULL::text, p_payment_method text DEFAULT 'cash'::text, p_idempotency_key text DEFAULT NULL::text, p_nationality text DEFAULT NULL::text, p_national_id text DEFAULT NULL::text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $$
declare emp uuid; pr products; v_sub numeric; v_disc numeric := coalesce(p_discount, 0); v_rate numeric; v_tax numeric; v_total numeric;
  v_no text; v_id uuid; existing product_sales; v_nat text; v_nid text;
begin
  emp := require_perm('products', 'create');
  if p_idempotency_key is not null then
    select * into existing from product_sales where idempotency_key = p_idempotency_key;
    if existing.id is not null then return jsonb_build_object('id', existing.id, 'invoiceNo', existing.invoice_no, 'duplicate', true); end if;
  end if;
  if p_qty is null or p_qty <= 0 then raise exception 'الكمية المطلوبة لازم تكون أكبر من صفر'; end if;
  if not is_payment_method(coalesce(p_payment_method, 'cash')) then raise exception 'طريقة الدفع غير صحيحة'; end if;
  -- قفل صف المنتج: عمليتين بيع في نفس اللحظة مايقدروش يبيعوا نفس الكمية مرتين
  select * into pr from products where id = p_product for update;
  if pr.id is null then raise exception 'المنتج غير موجود'; end if;
  if not pr.active then raise exception 'المنتج «%» غير متاح للبيع', pr.name; end if;
  if pr.quantity <= 0 then raise exception 'المنتج «%» غير متوفر — الكمية صفر', pr.name; end if;
  if p_qty > pr.quantity then raise exception 'الكمية المطلوبة (%) أكبر من المتاح (%)', p_qty, pr.quantity; end if;
  if p_patient is not null and not exists (select 1 from patients where id = p_patient) then raise exception 'المريض غير موجود'; end if;
  v_sub := round(pr.price * p_qty, 2);
  if v_disc < 0 or v_disc > v_sub then raise exception 'الخصم لازم يكون بين 0 و %', v_sub; end if;
  if p_patient is not null then
    v_rate := patient_tax_rate(p_patient);
  else
    v_nat := nullif(trim(coalesce(p_nationality, '')), '');
    if v_nat is null or v_nat not in ('saudi','non_saudi') then raise exception 'اختر جنسية العميل (سعودي / غير سعودي)'; end if;
    v_nid := nullif(translate(trim(coalesce(p_national_id, '')), '٠١٢٣٤٥٦٧٨٩', '0123456789'), '');
    if v_nid is not null and v_nat = 'saudi' and v_nid !~ '^1[0-9]{9}$' then raise exception 'رقم الهوية الوطنية 10 أرقام يبدأ بـ 1'; end if;
    if v_nat = 'non_saudi' then v_nid := null; end if;
    v_rate := case when v_nat = 'non_saudi' then coalesce((select foreign_tax_rate from center_info limit 1), 15) else 0 end;
  end if;
  v_rate := coalesce(v_rate, 0);
  v_tax := round((v_sub - v_disc) * v_rate / 100, 2);
  v_total := v_sub - v_disc + v_tax;
  v_no := 'PS-' || lpad(nextval('product_sale_no_seq')::text, 6, '0');
  insert into product_sales (invoice_no, product_id, product_name, product_sku, qty, unit_price, subtotal, discount, tax_rate, tax_amount, total,
    payment_method, patient_id, customer_name, employee_id, idempotency_key, buyer_nationality, buyer_national_id)
  values (v_no, pr.id, pr.name, pr.sku, p_qty, pr.price, v_sub, v_disc, v_rate, v_tax, v_total, coalesce(p_payment_method, 'cash'), p_patient,
    case when p_patient is null then nullif(trim(coalesce(p_customer_name, '')), '') end, emp, p_idempotency_key, v_nat, v_nid)
  returning id into v_id;
  -- الخصم من الكمية بعد نجاح تسجيل الفاتورة، في نفس المعاملة
  update products set quantity = quantity - p_qty, updated_at = now() where id = pr.id;
  insert into product_stock_moves (product_id, kind, qty, qty_after, ref_sale, employee_id) values (pr.id, 'sale', -p_qty, pr.quantity - p_qty, v_id, emp);
  perform log_action('بيع ' || p_qty || ' × ' || pr.name || ' — فاتورة ' || v_no || ' بإجمالي ' || v_total, p_patient);
  return jsonb_build_object('id', v_id, 'invoiceNo', v_no, 'remaining', pr.quantity - p_qty);
end $$
;
