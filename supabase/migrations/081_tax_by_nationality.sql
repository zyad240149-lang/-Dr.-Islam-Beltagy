-- الضريبة تلقائي حسب جنسية المريض (طلب الإدارة 2026-10-07): سعودي 0% — غير سعودي 15%.
create or replace function patient_tax_rate(p_patient uuid) returns numeric
language sql stable security definer set search_path = public as $$
  select case when exists (select 1 from patients where id = p_patient and nationality = 'non_saudi') then 15::numeric else 0::numeric end
$$;
revoke execute on function patient_tax_rate(uuid) from public, anon;
grant execute on function patient_tax_rate(uuid) to authenticated;

-- كل فاتورة جديدة (أي مسار: موعد/خطة/باقة/جلسة) بتاخد نسبة المريض تلقائيًا — recalc_invoice بيحسب الضريبة والإجمالي منها
create or replace function invoices_set_tax_rate() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  new.tax_rate := patient_tax_rate(new.patient_id);
  return new;
end $$;
drop trigger if exists trg_invoices_tax_rate on invoices;
create trigger trg_invoices_tax_rate before insert on invoices for each row execute function invoices_set_tax_rate();

-- تغيير الجنسية: الفواتير اللي لسه ماتدفعش منها ولا اتبعتت للهيئة بتتحدّث (المدفوعة/المرسلة بتفضل زي ما هي)
create or replace function patients_nationality_tax() returns trigger
language plpgsql security definer set search_path = public as $$
declare i record;
begin
  for i in select id from invoices where patient_id = new.id and status in ('draft','due') and coalesce(paid, 0) = 0 and zatca_status is null loop
    update invoices set tax_rate = patient_tax_rate(new.id) where id = i.id;
    perform recalc_invoice(i.id);
  end loop;
  return new;
end $$;
drop trigger if exists trg_patients_nationality_tax on patients;
create trigger trg_patients_nationality_tax after update of nationality on patients for each row when (old.nationality is distinct from new.nationality) execute function patients_nationality_tax();

-- تصحيح الفواتير الحالية غير المدفوعة وغير المرسلة
do $$ declare i record; begin
  for i in select inv.id, inv.patient_id from invoices inv where inv.status in ('draft','due') and coalesce(inv.paid, 0) = 0 and inv.zatca_status is null
           and inv.tax_rate is distinct from patient_tax_rate(inv.patient_id) loop
    update invoices set tax_rate = patient_tax_rate(i.patient_id) where id = i.id;
    perform recalc_invoice(i.id);
  end loop;
end $$;

CREATE OR REPLACE FUNCTION public.sell_product(p_product uuid, p_qty integer, p_discount numeric DEFAULT 0, p_patient uuid DEFAULT NULL::uuid, p_customer_name text DEFAULT NULL::text, p_payment_method text DEFAULT 'cash'::text, p_idempotency_key text DEFAULT NULL::text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare emp uuid; pr products; v_sub numeric; v_disc numeric := coalesce(p_discount, 0); v_rate numeric; v_tax numeric; v_total numeric;
  v_no text; v_id uuid; existing product_sales;
begin
  emp := require_perm('products', 'create');
  if p_idempotency_key is not null then
    select * into existing from product_sales where idempotency_key = p_idempotency_key;
    if existing.id is not null then return jsonb_build_object('id', existing.id, 'invoiceNo', existing.invoice_no, 'duplicate', true); end if;
  end if;
  if p_qty is null or p_qty <= 0 then raise exception 'الكمية المطلوبة لازم تكون أكبر من صفر'; end if;
  if coalesce(p_payment_method, 'cash') not in ('cash','card','transfer') then raise exception 'طريقة الدفع غير صحيحة'; end if;
  -- قفل صف المنتج: عمليتين بيع في نفس اللحظة مايقدروش يبيعوا نفس الكمية مرتين
  select * into pr from products where id = p_product for update;
  if pr.id is null then raise exception 'المنتج غير موجود'; end if;
  if not pr.active then raise exception 'المنتج «%» غير متاح للبيع', pr.name; end if;
  if pr.quantity <= 0 then raise exception 'المنتج «%» غير متوفر — الكمية صفر', pr.name; end if;
  if p_qty > pr.quantity then raise exception 'الكمية المطلوبة (%) أكبر من المتاح (%)', p_qty, pr.quantity; end if;
  if p_patient is not null and not exists (select 1 from patients where id = p_patient) then raise exception 'المريض غير موجود'; end if;
  v_sub := round(pr.price * p_qty, 2);
  if v_disc < 0 or v_disc > v_sub then raise exception 'الخصم لازم يكون بين 0 و %', v_sub; end if;
  -- الضريبة تلقائي حسب جنسية المريض (سعودي 0% / غير سعودي 15%)؛ من غير مريض بتتبع نسبة المركز
  if p_patient is not null then v_rate := patient_tax_rate(p_patient);
  else select coalesce(tax_rate, 0) into v_rate from center_info limit 1; end if;
  v_rate := coalesce(v_rate, 0);
  v_tax := round((v_sub - v_disc) * v_rate / 100, 2);
  v_total := v_sub - v_disc + v_tax;
  v_no := 'PS-' || lpad(nextval('product_sale_no_seq')::text, 6, '0');
  insert into product_sales (invoice_no, product_id, product_name, product_sku, qty, unit_price, subtotal, discount, tax_rate, tax_amount, total,
    payment_method, patient_id, customer_name, employee_id, idempotency_key)
  values (v_no, pr.id, pr.name, pr.sku, p_qty, pr.price, v_sub, v_disc, v_rate, v_tax, v_total, coalesce(p_payment_method, 'cash'), p_patient,
    case when p_patient is null then nullif(trim(coalesce(p_customer_name, '')), '') end, emp, p_idempotency_key)
  returning id into v_id;
  -- الخصم من الكمية بعد نجاح تسجيل الفاتورة، في نفس المعاملة
  update products set quantity = quantity - p_qty, updated_at = now() where id = pr.id;
  insert into product_stock_moves (product_id, kind, qty, qty_after, ref_sale, employee_id) values (pr.id, 'sale', -p_qty, pr.quantity - p_qty, v_id, emp);
  perform log_action('بيع ' || p_qty || ' × ' || pr.name || ' — فاتورة ' || v_no || ' بإجمالي ' || v_total, p_patient);
  return jsonb_build_object('id', v_id, 'invoiceNo', v_no, 'remaining', pr.quantity - p_qty);
end $function$;
