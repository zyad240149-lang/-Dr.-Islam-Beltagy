-- 969: شراء «مستلزمات طبية» من المصروفات بيحدّث سعر التكلفة بتاع الصنف (آخر سعر شراء)
-- قسم الأسعار اتشال من نموذج الصنف في المخزون (١١/١١)، فسعر التكلفة وقيمة المخزون بيتحسبوا من الشراء.

CREATE OR REPLACE FUNCTION public.save_supply_expense(p jsonb)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v uuid := _uuid(p, 'id'); k text := nullif(_txt(p, 'key'), ''); emp uuid;
  item uuid := _uuid(p, 'itemId'); q numeric := _num(p, 'quantity', 0); up numeric := _num(p, 'unitPrice', -1);
  d date := coalesce(nullif(p->>'purchaseDate', '')::date, riyadh_today()); descr text := _txt(p, 'description'); method text := _txt(p, 'paymentMethod', 'cash');
  amt numeric; ex expenses; it inventory_items; cur numeric; dup boolean := false;
begin
  emp := require_perm('expenses', case when v is null then 'create' else 'edit' end);
  perform require_perm('inventory', 'edit');
  if k is null then raise exception 'مفتاح العملية مطلوب'; end if;
  if item is null then raise exception 'اختار المنتج من المخزون'; end if;
  if q <= 0 then raise exception 'الكمية لازم تكون أكبر من صفر'; end if;
  if up < 0 then raise exception 'سعر الوحدة مطلوب'; end if;
  amt := round(q * up, 2);
  if amt <= 0 then raise exception 'الإجمالي لازم يكون أكبر من صفر'; end if;
  select * into it from inventory_items where id = item;
  if it.id is null then raise exception 'المنتج غير موجود في المخزون'; end if;
  if not it.active and (v is null or not exists (select 1 from expenses where id = v and inventory_item_id = item)) then raise exception 'المنتج «%» متوقف في المخزون', it.name; end if;
  -- طلبين بنفس المفتاح في نفس اللحظة: التاني بيستنى الأول ويرجّع نفس النتيجة
  perform pg_advisory_xact_lock(hashtextextended('supply_expense:' || k, 0));

  if v is null then
    select * into ex from expenses where idem_key = k;
    if found then
      dup := true;
    else
      insert into expenses (category, amount, description, expense_date, payment_method, created_by, idem_key, inventory_item_id, quantity, unit_price)
      values ('مستلزمات طبية', amt, descr, d, method, emp, k, item, q, up) returning * into ex;
      perform stock_move_core(item, 'purchase', q, up, 'مصروف مستلزمات طبية', descr, 'exp:' || ex.id, false, null);
      update stock_movements set expense_id = ex.id where idem_key = 'exp:' || ex.id;
      perform log_action('شراء مستلزمات طبية: ' || q || ' ' || it.unit || ' ' || it.name || ' — ' || amt || ' ج.م');
    end if;
  else
    select * into ex from expenses where id = v for update;
    if ex.id is null then raise exception 'المصروف غير موجود'; end if;
    if ex.inventory_item_id is null then raise exception 'المصروف ده مش مربوط بالمخزون'; end if;
    if ex.inventory_item_id <> item then
      -- منتج تاني: الكمية بترجع من القديم وتتضاف للجديد
      select quantity into cur from inventory_items where id = ex.inventory_item_id;
      if cur < ex.quantity then raise exception 'مينفعش تغيّر المنتج — اتصرف من الكمية اللي اتشرت (المتاح % من %)', cur, ex.quantity; end if;
      perform stock_move_core(ex.inventory_item_id, 'adjust_out', ex.quantity, 0, 'تعديل مصروف مستلزمات', 'تغيير المنتج', 'exp-edit:' || v || ':' || k || ':out', false, null);
      perform stock_move_core(item, 'purchase', q, up, 'مصروف مستلزمات طبية', descr, 'exp-edit:' || v || ':' || k || ':in', false, null);
    elsif q > ex.quantity then
      perform stock_move_core(item, 'adjust_in', q - ex.quantity, up, 'تعديل مصروف مستلزمات', 'زيادة الكمية', 'exp-edit:' || v || ':' || k, false, null);
    elsif q < ex.quantity then
      select quantity into cur from inventory_items where id = item;
      if cur < ex.quantity - q then raise exception 'مينفعش تقلل الكمية — اتصرف منها (المتاح %)', cur; end if;
      perform stock_move_core(item, 'adjust_out', ex.quantity - q, 0, 'تعديل مصروف مستلزمات', 'تقليل الكمية', 'exp-edit:' || v || ':' || k, false, null);
    end if;
    update stock_movements set expense_id = v where idem_key like 'exp-edit:' || v || ':' || k || '%' and expense_id is null;
    update expenses set amount = amt, quantity = q, unit_price = up, inventory_item_id = item, description = descr, expense_date = d, payment_method = method, updated_at = now()
    where id = v returning * into ex;
    perform log_action('تعديل مصروف مستلزمات طبية: ' || it.name || ' — ' || amt || ' ج.م');
  end if;
  -- ٩٦٩: سعر التكلفة بتاع الصنف = آخر سعر شراء (نموذج الصنف مابقاش فيه أسعار)
  if not dup then update inventory_items set cost_price = up, updated_at = now() where id = ex.inventory_item_id; end if;
  select * into it from inventory_items where id = ex.inventory_item_id;
  return jsonb_build_object('id', ex.id, 'duplicate', dup, 'amount', ex.amount, 'balance', it.quantity, 'minQuantity', it.min_quantity, 'low', it.quantity <= it.min_quantity, 'unit', it.unit, 'item', it.name);
end $function$

;

-- الأصناف الموجودة: سعر التكلفة = سعر آخر شراء متسجل من المصروفات (لو فيه)
update inventory_items i set cost_price = e.unit_price, updated_at = now()
from (select distinct on (inventory_item_id) inventory_item_id, unit_price from expenses
      where inventory_item_id is not null and unit_price > 0 order by inventory_item_id, expense_date desc, created_at desc) e
where e.inventory_item_id = i.id and i.cost_price is distinct from e.unit_price;
