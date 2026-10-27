-- 010 — أكواد الخصم: الحد الأدنى للطلب + سجل الاستخدام (coupon_usage)

alter table discount_codes add column if not exists min_amount numeric(10,2) not null default 0 check (min_amount >= 0);

create table if not exists coupon_usage (
  id uuid primary key default gen_random_uuid(),
  coupon_id uuid not null references discount_codes(id) on delete restrict,
  invoice_id uuid references invoices(id) on delete set null,
  patient_id uuid references patients(id) on delete set null,
  amount numeric(10,2) not null check (amount >= 0),
  used_by uuid references employees(id) on delete set null,
  used_at timestamptz not null default now()
);
create index if not exists idx_coupon_usage_coupon on coupon_usage(coupon_id);
alter table coupon_usage enable row level security;
drop policy if exists staff_read on coupon_usage;
create policy staff_read on coupon_usage for select using (has_perm('discounts', 'view'));

create or replace function save_discount_code(p jsonb) returns jsonb
language plpgsql security definer set search_path = public as $$
declare v uuid := _uuid(p, 'id'); v_code text := upper(regexp_replace(coalesce(p->>'code', ''), '\s+', '', 'g')); ex discount_codes;
begin
  perform require_perm('discounts', case when v is null then 'create' else 'edit' end);
  if v_code !~ '^[A-Z0-9_-]{3,20}$' then raise exception 'الكود من 3 إلى 20 حرف إنجليزي أو رقم بدون مسافات'; end if;
  if exists (select 1 from discount_codes where code = v_code and id is distinct from v) then raise exception 'الكود مستخدم بالفعل'; end if;
  if p->>'type' not in ('percent','fixed') then raise exception 'نوع الخصم غير صحيح'; end if;
  if _num(p, 'value') <= 0 then raise exception 'قيمة الخصم يجب أن تكون أكبر من صفر'; end if;
  if p->>'type' = 'percent' and _num(p, 'value') > 100 then raise exception 'نسبة الخصم لا تتجاوز 100%%'; end if;
  if nullif(p->>'validFrom', '') is null or nullif(p->>'validTo', '') is null or (p->>'validFrom')::date > (p->>'validTo')::date then
    raise exception 'تحقق من تاريخ بداية ونهاية الصلاحية';
  end if;
  if _num(p, 'maxUses') < 1 then raise exception 'عدد مرات الاستخدام يجب ألا يقل عن 1'; end if;
  if _num(p, 'minAmount', 0) < 0 then raise exception 'الحد الأدنى للطلب لا يمكن أن يكون سالبًا'; end if;
  if v is not null then
    select * into ex from discount_codes where id = v for update;
    if ex.id is null then raise exception 'الكود غير موجود'; end if;
    if _num(p, 'maxUses') < ex.used_count then raise exception 'الكود استُخدم % مرات بالفعل', ex.used_count; end if;
    update discount_codes set code = v_code, type = p->>'type', value = _num(p, 'value'),
      valid_from = (p->>'validFrom')::date, valid_to = (p->>'validTo')::date, max_uses = _num(p, 'maxUses')::int,
      min_amount = _num(p, 'minAmount', 0), active = coalesce((p->>'active')::boolean, true), note = _txt(p, 'note') where id = v;
  else
    insert into discount_codes (code, type, value, valid_from, valid_to, max_uses, min_amount, active, note, created_by)
    values (v_code, p->>'type', _num(p, 'value'), (p->>'validFrom')::date, (p->>'validTo')::date, _num(p, 'maxUses')::int, _num(p, 'minAmount', 0),
            coalesce((p->>'active')::boolean, true), _txt(p, 'note'), my_employee_id()) returning id into v;
  end if;
  perform log_action(case when ex.id is null then 'إنشاء' else 'تعديل' end || ' كود خصم ' || v_code);
  return jsonb_build_object('id', v);
end $$;

create or replace function apply_discount_code(p_invoice uuid, p_code text) returns jsonb
language plpgsql security definer set search_path = public as $$
declare inv invoices; dc discount_codes; amount numeric; t date := riyadh_today();
begin
  perform require_perm('invoices', 'edit');
  select * into inv from invoices where id = p_invoice for update;
  if inv.id is null then raise exception 'الفاتورة غير موجودة'; end if;
  if inv.status = 'cancelled' then raise exception 'الفاتورة ملغاة'; end if;
  if inv.discount_code is not null then raise exception 'تم تطبيق الكود % على هذه الفاتورة بالفعل', inv.discount_code; end if;
  select * into dc from discount_codes where code = upper(trim(p_code)) for update;
  if dc.id is null then raise exception 'كود الخصم غير صحيح'; end if;
  if not dc.active then raise exception 'كود الخصم موقوف'; end if;
  if dc.used_count >= dc.max_uses then raise exception 'تم استهلاك كل مرات استخدام الكود'; end if;
  if t < dc.valid_from then raise exception 'الكود يبدأ من %', dc.valid_from; end if;
  if t > dc.valid_to then raise exception 'انتهت صلاحية الكود في %', dc.valid_to; end if;
  if inv.price < dc.min_amount then raise exception 'الكود يتطلب حدًّا أدنى للطلب % — قيمة الفاتورة %', dc.min_amount, inv.price; end if;
  amount := least(inv.price, case when dc.type = 'percent' then round(inv.price * dc.value / 100) else dc.value end);
  if inv.price - amount < inv.paid then raise exception 'الإجمالي بعد الخصم أقل من المدفوع فعلًا'; end if;
  update invoices set discount = amount, discount_code = dc.code, discount_code_id = dc.id where id = p_invoice;
  update discount_codes set used_count = used_count + 1 where id = dc.id;
  insert into coupon_usage (coupon_id, invoice_id, patient_id, amount, used_by) values (dc.id, p_invoice, inv.patient_id, amount, my_employee_id());
  perform recalc_invoice(p_invoice);
  perform log_action('تطبيق كود الخصم ' || dc.code || ' (' || amount || ' ر.س) على ' || inv.no, inv.patient_id);
  return jsonb_build_object('amount', amount);
end $$;

grant execute on function save_discount_code(jsonb), apply_discount_code(uuid, text) to authenticated;
do $$ begin
  begin alter publication supabase_realtime add table coupon_usage; exception when others then null; end;
end $$;
