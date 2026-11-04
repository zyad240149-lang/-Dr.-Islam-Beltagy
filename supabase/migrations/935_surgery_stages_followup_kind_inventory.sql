-- 935: (1) مراحل العمليات والإنهاء المالي مرة واحدة، (2) نوع المتابعة ومزامنتها للحجز، (3) حركات مخزون كاملة.

-- ===== 1) العمليات الجراحية =====
alter table ortho_surgeries
  add column if not exists price numeric not null default 0 check (price >= 0),
  add column if not exists cost numeric not null default 0 check (cost >= 0),
  add column if not exists paid_at_finish numeric not null default 0 check (paid_at_finish >= 0),
  add column if not exists invoice_id uuid references invoices(id) on delete set null,
  add column if not exists finished_at timestamptz,
  add column if not exists finished_by uuid references employees(id) on delete set null;
create unique index if not exists ortho_surgeries_one_invoice on ortho_surgeries(invoice_id) where invoice_id is not null;

alter table ortho_surgeries drop constraint if exists ortho_surgeries_status_check;
alter table ortho_surgeries add constraint ortho_surgeries_status_check check (status in ('planned', 'scheduled', 'in_progress', 'done', 'postponed'));

create table if not exists ortho_surgery_stages (
  id uuid primary key default gen_random_uuid(),
  surgery_id uuid not null references ortho_surgeries(id) on delete cascade,
  position integer not null default 0,
  name text not null check (length(trim(name)) > 0),
  details text not null default '',
  status text not null default 'pending' check (status in ('pending', 'in_progress', 'done')),
  done_at timestamptz,
  created_by uuid references employees(id) on delete set null default my_employee_id(),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index if not exists ortho_surgery_stages_surgery on ortho_surgery_stages(surgery_id, position);
alter table ortho_surgery_stages enable row level security;
drop policy if exists staff_read on ortho_surgery_stages;
create policy staff_read on ortho_surgery_stages for select using ((select has_perm('patients', 'view')));
drop policy if exists staff_insert on ortho_surgery_stages;
create policy staff_insert on ortho_surgery_stages for insert with check ((select has_perm('sessions', 'create')));
drop policy if exists staff_update on ortho_surgery_stages;
create policy staff_update on ortho_surgery_stages for update using ((select has_perm('sessions', 'edit'))) with check ((select has_perm('sessions', 'edit')));
drop policy if exists staff_delete on ortho_surgery_stages;
create policy staff_delete on ortho_surgery_stages for delete using ((select has_perm('sessions', 'delete')) or (select is_admin()));
grant select, insert, update, delete on ortho_surgery_stages to authenticated;

drop trigger if exists trg_touch on ortho_surgery_stages;
create trigger trg_touch before update on ortho_surgery_stages for each row execute function ortho_touch();
drop trigger if exists trg_audit on ortho_surgery_stages;
create trigger trg_audit after insert or update or delete on ortho_surgery_stages for each row execute function audit_row();
drop trigger if exists trg_sync_tombstone on ortho_surgery_stages;
create trigger trg_sync_tombstone after delete on ortho_surgery_stages for each row execute function sync_tombstone();

-- العملية بتتقفل بدالة الإنهاء بس، وبعدها أرقامها ومراحلها ماتتغيّرش
create or replace function public.trg_surgery_guard() returns trigger
language plpgsql security definer set search_path to 'public' as $$
declare finishing boolean := coalesce(current_setting('app.surgery_finish', true), '') = '1';
begin
  if tg_op = 'DELETE' then
    if old.invoice_id is not null and exists (select 1 from invoices where id = old.invoice_id and status <> 'cancelled') then
      raise exception 'العملية عليها فاتورة — ألغِ الفاتورة الأول';
    end if;
    return old;
  end if;
  if not finishing then
    if new.status = 'done' and (tg_op = 'INSERT' or old.status <> 'done') then
      raise exception 'إنهاء العملية بيتم من زر «إنهاء العملية» بس';
    end if;
    if tg_op = 'UPDATE' and old.status = 'done' and (new.status, new.price, new.cost, new.paid_at_finish, new.invoice_id, new.patient_id, new.finished_at)
        is distinct from (old.status, old.price, old.cost, old.paid_at_finish, old.invoice_id, old.patient_id, old.finished_at) then
      raise exception 'العملية منتهية — بياناتها المالية ماتتعدلش';
    end if;
    if tg_op = 'UPDATE' and (new.paid_at_finish, new.invoice_id, new.finished_at) is distinct from (old.paid_at_finish, old.invoice_id, old.finished_at) then
      raise exception 'البيانات دي بتتسجل عند إنهاء العملية بس';
    end if;
    if tg_op = 'INSERT' and (new.paid_at_finish <> 0 or new.invoice_id is not null or new.finished_at is not null) then
      raise exception 'البيانات دي بتتسجل عند إنهاء العملية بس';
    end if;
  end if;
  return new;
end $$;
drop trigger if exists trg_surgery_guard on ortho_surgeries;
create trigger trg_surgery_guard before insert or update or delete on ortho_surgeries for each row execute function public.trg_surgery_guard();

create or replace function public.trg_surgery_stage_guard() returns trigger
language plpgsql security definer set search_path to 'public' as $$
declare sid uuid := case when tg_op = 'DELETE' then old.surgery_id else new.surgery_id end;
begin
  if exists (select 1 from ortho_surgeries where id = sid and status = 'done') then
    raise exception 'العملية منتهية — مراحلها ماتتعدلش';
  end if;
  if tg_op = 'DELETE' then return old; end if;
  if new.status = 'done' and (tg_op = 'INSERT' or old.status <> 'done') then new.done_at := now(); end if;
  if new.status <> 'done' then new.done_at := null; end if;
  return new;
end $$;
drop trigger if exists trg_stage_guard on ortho_surgery_stages;
create trigger trg_stage_guard before insert or update or delete on ortho_surgery_stages for each row execute function public.trg_surgery_stage_guard();

-- ===== 3) المخزون (قبل دالة الإنهاء لأنها بتستخدم الخصم) =====
alter table stock_movements
  add column if not exists balance_after numeric,
  add column if not exists idem_key text,
  add column if not exists surgery_id uuid references ortho_surgeries(id) on delete set null,
  add column if not exists overdraw boolean not null default false;
create unique index if not exists stock_movements_idem on stock_movements(idem_key) where idem_key is not null;
create unique index if not exists inventory_items_sku_uq on inventory_items(lower(sku));

-- الخصم/الإضافة الوحيد للكمية: قفل الصنف، منع التكرار بالمفتاح، الرصيد بعد الحركة، وتنبيه عند الوصول للحد الأدنى
create or replace function public.stock_move_core(p_item uuid, p_type text, p_qty numeric, p_unit_cost numeric, p_reference text, p_note text, p_key text, p_overdraw boolean, p_surgery uuid)
returns numeric language plpgsql security definer set search_path to 'public' as $$
declare it inventory_items; out_dir boolean; after_q numeric; existing numeric;
begin
  if p_key is not null then
    select balance_after into existing from stock_movements where idem_key = p_key;
    if found then return existing; end if;
  end if;
  select * into it from inventory_items where id = p_item for update;
  if it.id is null then raise exception 'الصنف غير موجود'; end if;
  if p_type not in ('purchase', 'issue', 'adjust_in', 'adjust_out') then raise exception 'نوع الحركة غير صحيح'; end if;
  if p_qty is null or p_qty <= 0 then raise exception 'الكمية لازم تكون أكبر من صفر'; end if;
  out_dir := p_type in ('issue', 'adjust_out');
  if out_dir and p_qty > it.quantity and not coalesce(p_overdraw, false) then
    raise exception 'الكمية المتاحة من % هي % % فقط', it.name, it.quantity, it.unit;
  end if;
  after_q := it.quantity + case when out_dir then -p_qty else p_qty end;
  update inventory_items set quantity = after_q,
    cost_price = case when p_type = 'purchase' and coalesce(p_unit_cost, 0) > 0 then p_unit_cost else cost_price end, updated_at = now()
  where id = it.id;
  insert into stock_movements (item_id, type, quantity, unit_cost, reference, employee_id, note, balance_after, idem_key, surgery_id, overdraw)
  values (it.id, p_type, p_qty, coalesce(p_unit_cost, 0), coalesce(p_reference, ''), my_employee_id(), coalesce(p_note, ''), after_q, p_key, p_surgery, out_dir and p_qty > it.quantity);
  if out_dir and it.active and it.quantity > it.min_quantity and after_q <= it.min_quantity then
    perform notify_staff('inventory', 'صنف قارب على النفاد', it.name || ': الرصيد ' || after_q || ' ' || it.unit || ' (الحد الأدنى ' || it.min_quantity || ')', it.id::text, '/inventory', null);
  end if;
  perform log_action(case p_type when 'purchase' then 'شراء' when 'issue' then 'صرف' when 'adjust_in' then 'تسوية بالزيادة' else 'تسوية بالنقص' end || ' ' || p_qty || ' ' || it.unit || ' من ' || it.name);
  return after_q;
end $$;
revoke all on function public.stock_move_core(uuid, text, numeric, numeric, text, text, text, boolean, uuid) from public, anon, authenticated;

create or replace function public.add_stock_movement(p jsonb) returns void
language plpgsql security definer set search_path to 'public' as $$
declare typ text := _txt(p, 'type'); over boolean := coalesce((p->>'overdraw')::boolean, false);
begin
  perform require_perm('inventory', 'edit');
  if over and not (is_admin() or has_perm('inv_overdraw', 'view')) then raise exception 'صرف كمية أكبر من المتاح محتاج صلاحية خاصة'; end if;
  if typ in ('issue', 'adjust_out') and _txt(p, 'reference') = '' and _txt(p, 'note') = '' then raise exception 'اكتب سبب الصرف'; end if;
  perform stock_move_core(_uuid(p, 'itemId'), typ, _num(p, 'quantity'), _num(p, 'unitCost'), _txt(p, 'reference'), _txt(p, 'note'), nullif(_txt(p, 'key'), ''), over, null);
end $$;

create or replace function public.save_item(p jsonb) returns jsonb
language plpgsql security definer set search_path to 'public' as $$
declare v uuid := _uuid(p, 'id'); q numeric := _num(p, 'quantity', 0); code text := nullif(_txt(p, 'sku'), '');
begin
  perform require_perm('inventory', case when v is null then 'create' else 'edit' end);
  if _txt(p, 'name') = '' then raise exception 'اسم الصنف مطلوب'; end if;
  if _num(p, 'minQuantity') < 0 or _num(p, 'costPrice') < 0 or _num(p, 'salePrice') < 0 or q < 0 then raise exception 'القيم الرقمية ما ينفع تكون سالبة'; end if;
  if code is not null and exists (select 1 from inventory_items where lower(sku) = lower(code) and id is distinct from v) then raise exception 'الكود ده مستخدم لصنف تاني'; end if;
  if v is null then
    insert into inventory_items (sku, name, category, unit, quantity, min_quantity, cost_price, sale_price, supplier, active)
    values (coalesce(code, next_counter('item', 'SKU-')), _txt(p, 'name'), _txt(p, 'category'), _txt(p, 'unit', 'قطعة'), q, _num(p, 'minQuantity'),
            _num(p, 'costPrice'), _num(p, 'salePrice'), _txt(p, 'supplier'), coalesce((p->>'active')::boolean, true)) returning id into v;
    if q > 0 then
      insert into stock_movements (item_id, type, quantity, unit_cost, reference, employee_id, balance_after) values (v, 'purchase', q, _num(p, 'costPrice'), 'رصيد افتتاحي', my_employee_id(), q);
    end if;
  else
    update inventory_items set sku = coalesce(code, sku), name = _txt(p, 'name'), category = _txt(p, 'category'), unit = _txt(p, 'unit', 'قطعة'), min_quantity = _num(p, 'minQuantity'),
      cost_price = _num(p, 'costPrice'), sale_price = _num(p, 'salePrice'), supplier = _txt(p, 'supplier'),
      active = coalesce((p->>'active')::boolean, active), updated_at = now() where id = v;
  end if;
  perform log_action(case when _uuid(p, 'id') is null then 'إضافة' else 'تعديل' end || ' صنف مخزون: ' || _txt(p, 'name'));
  return jsonb_build_object('id', v);
end $$;

-- تاريخ الحركات مابيتمسحش: الصنف اللي اتحرك بيتوقف بدل الحذف
create or replace function public.delete_item(p_id uuid) returns void
language plpgsql security definer set search_path to 'public' as $$
declare it inventory_items;
begin
  perform require_perm('inventory', 'delete');
  if exists (select 1 from stock_movements where item_id = p_id and reference <> 'رصيد افتتاحي') then
    raise exception 'الصنف ليه حركات مسجّلة — خليه «متوقف» بدل الحذف عشان السجل يفضل';
  end if;
  delete from inventory_items where id = p_id returning * into it;
  if it.id is null then raise exception 'الصنف غير موجود'; end if;
  perform log_action('حذف صنف مخزون: ' || it.name);
end $$;

create or replace function public.inventory_report(p_from date, p_to date) returns jsonb
language plpgsql stable security definer set search_path to 'public' as $$
begin
  perform require_perm('inventory', 'view');
  if p_from is null or p_to is null or p_from > p_to then raise exception 'حدد فترة صحيحة'; end if;
  return (
    with m as (
      select item_id,
        sum(case when type in ('purchase', 'adjust_in') then quantity else -quantity end) filter (where (date at time zone 'Africa/Cairo')::date > p_to) as after_net,
        sum(quantity) filter (where type in ('purchase', 'adjust_in') and (date at time zone 'Africa/Cairo')::date between p_from and p_to) as qty_in,
        sum(quantity) filter (where type in ('issue', 'adjust_out') and (date at time zone 'Africa/Cairo')::date between p_from and p_to) as qty_out
      from stock_movements group by item_id
    ), r as (
      select i.id, i.sku, i.name, i.unit, i.cost_price, i.min_quantity, i.active,
        coalesce(m.qty_in, 0) as qty_in, coalesce(m.qty_out, 0) as qty_out,
        i.quantity - coalesce(m.after_net, 0) as closing
      from inventory_items i left join m on m.item_id = i.id
    )
    select jsonb_build_object(
      'rows', coalesce(jsonb_agg(jsonb_build_object('id', id, 'sku', sku, 'name', name, 'unit', unit, 'in', qty_in, 'out', qty_out, 'closing', closing,
        'opening', closing - qty_in + qty_out, 'value', round(closing * cost_price, 2), 'low', active and closing <= min_quantity) order by name), '[]'::jsonb),
      'totalValue', coalesce(sum(round(closing * cost_price, 2)) filter (where active), 0))
    from r
  );
end $$;
revoke all on function public.inventory_report(date, date) from public, anon;
grant execute on function public.inventory_report(date, date) to authenticated;

-- ===== إنهاء العملية: معاملة واحدة، والتكرار بيرجّع نفس النتيجة من غير إيراد أو خصم تاني =====
create or replace function public.finish_surgery(p jsonb) returns jsonb
language plpgsql security definer set search_path to 'public' as $$
declare s ortho_surgeries; v_price numeric := _num(p, 'price', 0); v_cost numeric := _num(p, 'cost', 0); v_paid numeric := _num(p, 'paid', 0);
  v_method text := _txt(p, 'method'); inv uuid; it jsonb; over boolean := coalesce((p->>'overdraw')::boolean, false);
begin
  perform require_perm('sessions', 'edit');
  select * into s from ortho_surgeries where id = _uuid(p, 'id') for update;
  if s.id is null then raise exception 'العملية غير موجودة'; end if;
  if s.status = 'done' then return jsonb_build_object('alreadyDone', true, 'invoiceId', s.invoice_id); end if;
  if not exists (select 1 from ortho_surgery_stages where surgery_id = s.id) then raise exception 'أضف مراحل العملية الأول'; end if;
  if exists (select 1 from ortho_surgery_stages where surgery_id = s.id and status <> 'done') then raise exception 'فيه مراحل لسه ماخلصتش — حدّث حالتها الأول'; end if;
  if v_price < 0 or v_cost < 0 or v_paid < 0 then raise exception 'المبالغ ما ينفع تكون سالبة'; end if;
  if v_paid > v_price then raise exception 'المدفوع أكبر من المبلغ المستحق'; end if;
  if v_paid > 0 and not is_payment_method(v_method) then raise exception 'طريقة الدفع غير صحيحة'; end if;
  if over and not (is_admin() or has_perm('inv_overdraw', 'view')) then raise exception 'صرف كمية أكبر من المتاح محتاج صلاحية خاصة'; end if;

  perform set_config('app.surgery_finish', '1', true);
  if v_price > 0 then
    inv := new_invoice(s.patient_id, 'عملية: ' || s.procedure, v_price, 'due', riyadh_today());
    if v_paid > 0 then
      insert into payments (invoice_id, patient_id, amount, method, note, created_by)
      values (inv, s.patient_id, v_paid, v_method, 'مدفوع عند إنهاء العملية', my_employee_id());
      perform recalc_invoice(inv);
    end if;
  end if;
  if jsonb_typeof(p->'supplies') = 'array' then
    for it in select * from jsonb_array_elements(p->'supplies') loop
      perform stock_move_core(_uuid(it, 'itemId'), 'issue', _num(it, 'qty'), 0, 'عملية: ' || s.procedure, '', 'surgery:' || s.id || ':' || _txt(it, 'itemId'), over, s.id);
    end loop;
  end if;
  update ortho_surgeries set status = 'done', price = v_price, cost = v_cost, paid_at_finish = v_paid, invoice_id = inv, finished_at = now(), finished_by = my_employee_id() where id = s.id;
  perform set_config('app.surgery_finish', '', true);
  perform log_action('إنهاء عملية ' || s.procedure || ' — المستحق ' || v_price || ' ج.م، المدفوع ' || v_paid || ' ج.م', s.patient_id);
  return jsonb_build_object('alreadyDone', false, 'invoiceId', inv);
end $$;
revoke all on function public.finish_surgery(jsonb) from public, anon;
grant execute on function public.finish_surgery(jsonb) to authenticated;

-- ===== 2) نوع المتابعة ومزامنتها للحجز =====
alter table ortho_follow_ups add column if not exists kind text check (kind in ('surgery', 'imaging'));

create or replace function public.trg_follow_up_require_kind() returns trigger
language plpgsql set search_path to 'public' as $$
begin
  if new.consultation_id is not null and new.kind is null and not new.auto_created then
    raise exception 'اختار نوع المتابعة: متابعة عمليات أو متابعة صور';
  end if;
  return new;
end $$;
drop trigger if exists trg_require_kind on ortho_follow_ups;
create trigger trg_require_kind before insert on ortho_follow_ups for each row execute function public.trg_follow_up_require_kind();

-- تعديل المتابعة بيتنقل للحجز المربوط. لو الحجز اترفض (تضارب مثلًا) التعديل كله بيترفض، فالقسمين مابيختلفوش
create or replace function public.trg_follow_up_to_appointment() returns trigger
language plpgsql security definer set search_path to 'public' as $$
begin
  if new.appointment_id is null then return new; end if;
  if new.status = 'cancelled' and old.status <> 'cancelled' then
    update appointments set status = 'cancelled' where id = new.appointment_id and status <> 'cancelled';
  elsif new.status = 'scheduled' and new.time is not null then
    update appointments set date = new.date, time = to_char(new.time, 'HH24:MI'), therapist_id = coalesce(new.doctor_id, therapist_id)
      where id = new.appointment_id and status <> 'cancelled'
        and (date <> new.date or time <> to_char(new.time, 'HH24:MI') or therapist_id is distinct from coalesce(new.doctor_id, therapist_id));
  end if;
  return new;
end $$;
drop trigger if exists trg_to_appointment on ortho_follow_ups;
create trigger trg_to_appointment after update of date, time, doctor_id, status on ortho_follow_ups for each row
  when ((old.date, old.time, old.doctor_id, old.status) is distinct from (new.date, new.time, new.doctor_id, new.status))
  execute function public.trg_follow_up_to_appointment();

revoke execute on function public.trg_surgery_guard() from public, anon, authenticated;
revoke execute on function public.trg_surgery_stage_guard() from public, anon, authenticated;
revoke execute on function public.trg_follow_up_require_kind() from public, anon, authenticated;
revoke execute on function public.trg_follow_up_to_appointment() from public, anon, authenticated;

do $$ begin
  if exists (select 1 from pg_publication where pubname = 'supabase_realtime')
     and not exists (select 1 from pg_publication_tables where pubname = 'supabase_realtime' and tablename = 'ortho_surgery_stages') then
    alter publication supabase_realtime add table ortho_surgery_stages;
  end if;
end $$;
