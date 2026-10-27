-- نقل أسماء أصناف المخزون لقسم بيع المنتجات (2026-10-21، بطلب المدير: «انقل أسامي بس»):
-- الاسم + الكود (SKU) + التصنيف كوصف، والسعر 0 والكمية 0 (تتحدد من صفحة بيع المنتجات). جدول inventory_items نفسه ما اتمسّش (فيه الكميات وسعر التكلفة).
update products p set name = i.name, description = coalesce(nullif(p.description, ''), i.category), updated_at = now()
  from inventory_items i where lower(i.sku) = lower(p.sku) and p.name = p.sku;
insert into products (sku, name, description, price, quantity, active)
select i.sku, i.name, i.category, 0, 0, true from inventory_items i
where not exists (select 1 from products p where lower(p.sku) = lower(i.sku));
