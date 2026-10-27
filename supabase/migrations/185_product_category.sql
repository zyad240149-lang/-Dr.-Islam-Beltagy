-- تصنيف المنتج (2026-10-21): الشرح اللي تحت اسم المنتج (اللي اتنقل من المخزون) بقى «تصنيف» مستقل.
alter table products add column if not exists category text;
update products set category = description, description = null
  where category is null and description in (select category from inventory_items);

do $$
declare def text; nd text;
begin
  select pg_get_functiondef('product_save(jsonb)'::regprocedure) into def;
  nd := replace(def, 'insert into products (sku, name, description, price, quantity, image_path, active)', 'insert into products (sku, name, description, category, price, quantity, image_path, active)');
  nd := replace(nd, 'v_sku, v_name, nullif(trim(coalesce(p->>''description'', '''')), ''''), v_price,', 'v_sku, v_name, nullif(trim(coalesce(p->>''description'', '''')), ''''), nullif(trim(coalesce(p->>''category'', '''')), ''''), v_price,');
  nd := replace(nd, 'description = nullif(trim(coalesce(p->>''description'', '''')), ''''), price = v_price,', 'description = nullif(trim(coalesce(p->>''description'', '''')), ''''),
      category = case when p ? ''category'' then nullif(trim(coalesce(p->>''category'', '''')), '''') else category end, price = v_price,');
  if nd = def or position('category, price' in nd) = 0 or position('category = case' in nd) = 0 then raise exception '185: product_save'; end if;
  execute nd;
end $$;
