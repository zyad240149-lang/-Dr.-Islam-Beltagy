-- كتابة الكمية المتاحة مباشرة من نافذة تعديل المنتج (2026-10-21): بتتسجّل كحركة مخزون «adjust» (الفرق + الكمية بعدها) في سجل الحركة والعمليات.
alter table product_stock_moves drop constraint if exists product_stock_moves_kind_check;
alter table product_stock_moves add constraint product_stock_moves_kind_check check (kind in ('initial','restock','sale','sale_cancel','adjust'));

create or replace function product_set_quantity(p_id uuid, p_qty int, p_note text default null) returns int
language plpgsql security definer set search_path = public as $$
declare emp uuid; pr products;
begin
  emp := require_perm('products', 'edit');
  if p_qty is null or p_qty < 0 then raise exception 'الكمية لازم تكون 0 أو أكثر'; end if;
  select * into pr from products where id = p_id for update;
  if pr.id is null then raise exception 'المنتج غير موجود'; end if;
  if pr.quantity = p_qty then return p_qty; end if;
  update products set quantity = p_qty, updated_at = now() where id = p_id;
  insert into product_stock_moves (product_id, kind, qty, qty_after, employee_id, note)
  values (p_id, 'adjust', p_qty - pr.quantity, p_qty, emp, coalesce(nullif(trim(coalesce(p_note, '')), ''), 'تعديل الكمية يدويًا'));
  perform log_action('تعديل كمية المنتج ' || pr.name || ' من ' || pr.quantity || ' إلى ' || p_qty, null);
  return p_qty;
end $$;
revoke execute on function product_set_quantity(uuid, int, text) from public, anon;
grant execute on function product_set_quantity(uuid, int, text) to authenticated;
