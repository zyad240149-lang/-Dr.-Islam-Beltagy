-- قسم «بيع المنتجات» — مستقل تمامًا عن المخزون العام (inventory): منتجاته وكمياته ومبيعاته وفواتيره خاصة بيه.
-- الكتابة كلها عبر RPC فقط. البيع = معاملة واحدة: قفل صف المنتج ← تحقق الكمية ← تسجيل الفاتورة ← خصم الكمية
-- (لو أي خطوة فشلت، مفيش حاجة بتتسجل ولا الكمية بتتخصم).

create table if not exists products (
  id uuid primary key default gen_random_uuid(),
  sku text not null,
  name text not null check (length(trim(name)) > 0),
  description text,
  price numeric(12,2) not null check (price >= 0),
  quantity int not null default 0 check (quantity >= 0),
  image_path text,
  active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create unique index if not exists products_sku_uq on products (upper(trim(sku)));

create sequence if not exists product_sale_no_seq;

create table if not exists product_sales (
  id uuid primary key default gen_random_uuid(),
  invoice_no text not null unique,
  product_id uuid not null references products(id),
  product_name text not null,
  product_sku text not null,
  qty int not null check (qty > 0),
  unit_price numeric(12,2) not null,
  subtotal numeric(12,2) not null,
  discount numeric(12,2) not null default 0 check (discount >= 0),
  tax_rate numeric(5,2) not null default 0,
  tax_amount numeric(12,2) not null default 0,
  total numeric(12,2) not null,
  payment_method text not null default 'cash' check (payment_method in ('cash','card','transfer')),
  patient_id uuid references patients(id) on delete set null,
  customer_name text,
  employee_id uuid references employees(id) on delete set null,
  status text not null default 'completed' check (status in ('completed','cancelled')),
  cancel_reason text,
  cancelled_at timestamptz,
  cancelled_by uuid references employees(id) on delete set null,
  idempotency_key text unique,
  created_at timestamptz not null default now()
);
create index if not exists product_sales_created_idx on product_sales (created_at desc);
create index if not exists product_sales_product_idx on product_sales (product_id);

create table if not exists product_stock_moves (
  id uuid primary key default gen_random_uuid(),
  product_id uuid not null references products(id) on delete cascade,
  kind text not null check (kind in ('initial','restock','sale','sale_cancel')),
  qty int not null,
  qty_after int not null,
  ref_sale uuid references product_sales(id) on delete set null,
  employee_id uuid references employees(id) on delete set null,
  note text,
  created_at timestamptz not null default now()
);

alter table products enable row level security;
alter table product_sales enable row level security;
alter table product_stock_moves enable row level security;
create policy products_select on products for select using (has_perm('products', 'view'));
create policy product_sales_select on product_sales for select using (has_perm('products', 'view'));
create policy product_moves_select on product_stock_moves for select using (has_perm('products', 'view'));
revoke insert, update, delete on products, product_sales, product_stock_moves from authenticated, anon;
grant select on products, product_sales, product_stock_moves to authenticated;

-- ---------- إضافة / تعديل منتج ----------
create or replace function product_save(p jsonb) returns uuid
language plpgsql security definer set search_path = public as $$
declare emp uuid; v_id uuid := nullif(p->>'id', '')::uuid; v_sku text := upper(trim(coalesce(p->>'sku', '')));
  v_name text := trim(coalesce(p->>'name', '')); v_price numeric := (p->>'price')::numeric; v_qty int;
begin
  emp := require_perm('products', case when v_id is null then 'create' else 'edit' end);
  if v_name = '' then raise exception 'اسم المنتج مطلوب'; end if;
  if v_sku = '' then raise exception 'كود المنتج (SKU) مطلوب'; end if;
  if v_price is null or v_price < 0 then raise exception 'سعر البيع غير صحيح'; end if;
  if exists (select 1 from products where upper(trim(sku)) = v_sku and id is distinct from v_id) then
    raise exception 'كود المنتج % مستخدم لمنتج آخر', v_sku; end if;
  if v_id is null then
    v_qty := coalesce((p->>'quantity')::int, 0);
    if v_qty < 0 then raise exception 'الكمية لا يمكن أن تكون سالبة'; end if;
    insert into products (sku, name, description, price, quantity, image_path, active)
    values (v_sku, v_name, nullif(trim(coalesce(p->>'description', '')), ''), v_price, v_qty, nullif(p->>'imagePath', ''), coalesce((p->>'active')::boolean, true))
    returning id into v_id;
    if v_qty > 0 then insert into product_stock_moves (product_id, kind, qty, qty_after, employee_id, note) values (v_id, 'initial', v_qty, v_qty, emp, 'الكمية الافتتاحية'); end if;
    perform log_action('إضافة منتج للبيع: ' || v_name || ' (' || v_sku || ')', null);
  else
    -- الكمية مابتتعدلش من هنا — إضافة الكمية عبر product_add_stock عشان تتسجل كحركة
    update products set sku = v_sku, name = v_name, description = nullif(trim(coalesce(p->>'description', '')), ''), price = v_price,
      image_path = case when p ? 'imagePath' then nullif(p->>'imagePath', '') else image_path end,
      active = coalesce((p->>'active')::boolean, active), updated_at = now()
    where id = v_id;
    if not found then raise exception 'المنتج غير موجود'; end if;
    perform log_action('تعديل منتج: ' || v_name || ' (' || v_sku || ')', null);
  end if;
  return v_id;
end $$;

-- ---------- إضافة كمية ----------
create or replace function product_add_stock(p_id uuid, p_qty int, p_note text default null) returns int
language plpgsql security definer set search_path = public as $$
declare emp uuid; v_after int; v_name text;
begin
  emp := require_perm('products', 'edit');
  if p_qty is null or p_qty <= 0 then raise exception 'أدخل كمية أكبر من صفر'; end if;
  update products set quantity = quantity + p_qty, updated_at = now() where id = p_id returning quantity, name into v_after, v_name;
  if not found then raise exception 'المنتج غير موجود'; end if;
  insert into product_stock_moves (product_id, kind, qty, qty_after, employee_id, note) values (p_id, 'restock', p_qty, v_after, emp, nullif(trim(coalesce(p_note, '')), ''));
  perform log_action('إضافة كمية ' || p_qty || ' للمنتج ' || v_name || ' — الكمية الآن ' || v_after, null);
  return v_after;
end $$;

-- ---------- حذف منتج: لو له مبيعات سابقة يتعطّل بدل الحذف ----------
create or replace function product_delete(p_id uuid) returns text
language plpgsql security definer set search_path = public as $$
declare emp uuid; v_name text;
begin
  emp := require_perm('products', 'delete');
  select name into v_name from products where id = p_id;
  if v_name is null then raise exception 'المنتج غير موجود'; end if;
  if exists (select 1 from product_sales where product_id = p_id) then
    update products set active = false, updated_at = now() where id = p_id;
    perform log_action('تعطيل منتج له مبيعات سابقة: ' || v_name, null);
    return 'disabled';
  end if;
  delete from products where id = p_id;
  perform log_action('حذف منتج: ' || v_name, null);
  return 'deleted';
end $$;

-- ---------- البيع ----------
create or replace function sell_product(p_product uuid, p_qty int, p_discount numeric default 0, p_patient uuid default null,
  p_customer_name text default null, p_payment_method text default 'cash', p_idempotency_key text default null) returns jsonb
language plpgsql security definer set search_path = public as $$
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
  select coalesce(tax_rate, 0) into v_rate from center_info limit 1;
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
end $$;

-- ---------- إلغاء عملية بيع (ترجع الكمية) ----------
create or replace function cancel_product_sale(p_id uuid, p_reason text default null) returns void
language plpgsql security definer set search_path = public as $$
declare emp uuid; s product_sales; v_after int;
begin
  emp := require_perm('products', 'delete');
  select * into s from product_sales where id = p_id for update;
  if s.id is null then raise exception 'عملية البيع غير موجودة'; end if;
  if s.status = 'cancelled' then raise exception 'العملية ملغاة بالفعل'; end if;
  update product_sales set status = 'cancelled', cancel_reason = nullif(trim(coalesce(p_reason, '')), ''), cancelled_at = now(), cancelled_by = emp where id = p_id;
  update products set quantity = quantity + s.qty, updated_at = now() where id = s.product_id returning quantity into v_after;
  insert into product_stock_moves (product_id, kind, qty, qty_after, ref_sale, employee_id, note) values (s.product_id, 'sale_cancel', s.qty, v_after, p_id, emp, p_reason);
  perform log_action('إلغاء بيع — فاتورة ' || s.invoice_no || ' وإرجاع ' || s.qty || ' للمنتج ' || s.product_name, s.patient_id);
end $$;

revoke execute on function product_save(jsonb), product_add_stock(uuid, int, text), product_delete(uuid),
  sell_product(uuid, int, numeric, uuid, text, text, text), cancel_product_sale(uuid, text) from public, anon;
grant execute on function product_save(jsonb), product_add_stock(uuid, int, text), product_delete(uuid),
  sell_product(uuid, int, numeric, uuid, text, text, text), cancel_product_sale(uuid, text) to authenticated;

-- ---------- صور المنتجات (عامة القراءة — صور منتجات مش بيانات حساسة) ----------
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('product-images', 'product-images', true, 3145728, array['image/png','image/jpeg','image/webp'])
on conflict (id) do nothing;
drop policy if exists product_img_write on storage.objects;
drop policy if exists product_img_delete on storage.objects;
create policy product_img_write on storage.objects for insert with check (bucket_id = 'product-images' and (has_perm('products','create') or has_perm('products','edit')));
create policy product_img_delete on storage.objects for delete using (bucket_id = 'product-images' and has_perm('products','edit'));

-- ---------- الصلاحيات ----------
insert into role_permissions (role, area, ops) values
  ('system_admin', 'products', '{view,create,edit,delete}'),
  ('center_manager', 'products', '{view,create,edit,delete}'),
  ('secretary', 'products', '{view,create}'),
  ('reception', 'products', '{view,create}'),
  ('accountant', 'products', '{view,create,edit}'),
  ('therapist', 'products', '{}')
on conflict (role, area) do update set ops = excluded.ops;

-- تحديثات لحظية
do $$ begin
  begin alter publication supabase_realtime add table products; exception when others then null; end;
  begin alter publication supabase_realtime add table product_sales; exception when others then null; end;
end $$;
