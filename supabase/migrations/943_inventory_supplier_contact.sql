-- 943: رقم المورّد ولينكه في صنف المخزون. اللينك http/https بس عشان مايبقاش رابط ضار.
alter table inventory_items
  add column if not exists supplier_phone text not null default '',
  add column if not exists supplier_url text not null default '';
alter table inventory_items drop constraint if exists inventory_items_supplier_url_http;
alter table inventory_items add constraint inventory_items_supplier_url_http check (supplier_url = '' or supplier_url ~* '^https?://');

create or replace function public.save_item(p jsonb) returns jsonb
language plpgsql security definer set search_path to 'public' as $$
declare v uuid := _uuid(p, 'id'); q numeric := _num(p, 'quantity', 0); code text := nullif(_txt(p, 'sku'), '');
begin
  perform require_perm('inventory', case when v is null then 'create' else 'edit' end);
  if _txt(p, 'name') = '' then raise exception 'اسم الصنف مطلوب'; end if;
  if _num(p, 'minQuantity') < 0 or _num(p, 'costPrice') < 0 or _num(p, 'salePrice') < 0 or q < 0 then raise exception 'القيم الرقمية ما ينفع تكون سالبة'; end if;
  if code is not null and exists (select 1 from inventory_items where lower(sku) = lower(code) and id is distinct from v) then raise exception 'الكود ده مستخدم لصنف تاني'; end if;
  if v is null then
    insert into inventory_items (sku, name, category, unit, quantity, min_quantity, cost_price, sale_price, supplier, supplier_phone, supplier_url, active)
    values (coalesce(code, next_counter('item', 'SKU-')), _txt(p, 'name'), _txt(p, 'category'), _txt(p, 'unit', 'قطعة'), q, _num(p, 'minQuantity'),
            _num(p, 'costPrice'), _num(p, 'salePrice'), _txt(p, 'supplier'), _txt(p, 'supplierPhone'), _txt(p, 'supplierUrl'), coalesce((p->>'active')::boolean, true)) returning id into v;
    if q > 0 then
      insert into stock_movements (item_id, type, quantity, unit_cost, reference, employee_id, balance_after) values (v, 'purchase', q, _num(p, 'costPrice'), 'رصيد افتتاحي', my_employee_id(), q);
    end if;
  else
    update inventory_items set sku = coalesce(code, sku), name = _txt(p, 'name'), category = _txt(p, 'category'), unit = _txt(p, 'unit', 'قطعة'), min_quantity = _num(p, 'minQuantity'),
      cost_price = _num(p, 'costPrice'), sale_price = _num(p, 'salePrice'), supplier = _txt(p, 'supplier'), supplier_phone = _txt(p, 'supplierPhone'), supplier_url = _txt(p, 'supplierUrl'),
      active = coalesce((p->>'active')::boolean, active), updated_at = now() where id = v;
  end if;
  perform log_action(case when _uuid(p, 'id') is null then 'إضافة' else 'تعديل' end || ' صنف مخزون: ' || _txt(p, 'name'));
  return jsonb_build_object('id', v);
end $$;
