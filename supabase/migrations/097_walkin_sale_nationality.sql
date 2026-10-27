-- بيع منتج لعميل من غير ملف (2026-10-08، طلب الإدارة): الموظف بيحدد الجنسية دايمًا، فالضريبة بتتحسب منها زي المريض
-- (سعودي 0% / غير سعودي foreign_tax_rate) بدل نسبة المركز الثابتة. رقم الهوية الوطنية للسعودي اختياري وقت البيع،
-- لكن الهيئة بتشترطه في الفاتورة الصفرية (BR-KSA-49) — من غيره الفاتورة مش هتتبعت لحد ما يتضاف.
alter table product_sales add column if not exists buyer_nationality text;
alter table product_sales add column if not exists buyer_national_id text;
do $$ begin
  if not exists (select 1 from pg_constraint where conname = 'product_sales_buyer_nationality_chk') then
    alter table product_sales add constraint product_sales_buyer_nationality_chk check (buyer_nationality is null or buyer_nationality in ('saudi','non_saudi'));
  end if;
end $$;

drop function if exists sell_product(uuid, integer, numeric, uuid, text, text, text);
create or replace function sell_product(p_product uuid, p_qty integer, p_discount numeric default 0, p_patient uuid default null,
  p_customer_name text default null, p_payment_method text default 'cash', p_idempotency_key text default null,
  p_nationality text default null, p_national_id text default null)
returns jsonb language plpgsql security definer set search_path = public as $function$
declare emp uuid; pr products; v_sub numeric; v_disc numeric := coalesce(p_discount, 0); v_rate numeric; v_tax numeric; v_total numeric;
  v_no text; v_id uuid; existing product_sales; v_nat text; v_nid text;
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
end $function$;
revoke execute on function sell_product(uuid, integer, numeric, uuid, text, text, text, text, text) from public, anon;
grant execute on function sell_product(uuid, integer, numeric, uuid, text, text, text, text, text) to authenticated;
