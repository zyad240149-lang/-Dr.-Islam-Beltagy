-- 964: (1) سجل درجات الألم لكل زيارة  (2) سجل الروشتات — كل روشتة بتفضل محفوظة، وكل دواء ليه ملاحظة في عمود لوحده
--      (3) ربط المصروفات بالمخزون: شراء «مستلزمات طبية» = مصروف + توريد للمخزون في عملية واحدة idempotent.
--
-- (1) الألم بيتسجّل من 3 أماكن: الشيت العام في التشخيص (ortho_consultations.pain_score)، شيت «متابعة المريض» (ortho_nursing.sheet.pain)،
--     وموعد المتابعة نفسه (عمود جديد ortho_follow_ups.pain_score). تريجر على كل جدول بيكتب/يحدّث/يمسح صف واحد لكل زيارة في ortho_pain_scores
--     (unique source+source_id) — فالسجل دايمًا مطابق للمصدر ومفيش تكرار، حتى لو نفس الشيت اتحفظ كذا مرة أو اتبعت من غير نت واتعاد.
-- (2) الروشتة بتتحفظ في نفس السجل (التشخيص/شيت المتابعة) زي ما هي. التريجر بياخد نسخة منها في ortho_prescriptions + ortho_prescription_items
--     كل ما محتواها يتغيّر (version جديدة) — تعديل الروشتة أو كتابة روشتة جديدة مابيمسحش القديمة، وحذف الكشف مابيمسحش روشتاته من السجل.
--     ملاحظة الدواء (بعد الأكل، قبل النوم…) عمود notes في ortho_prescription_items — منفصلة عن تعليمات الروشتة العامة (instructions).
-- (3) save_supply_expense: صلاحية «المصروفات» + «المخزون/تعديل»؛ مفتاح العملية (idem_key) بيمنع تسجيل المصروف أو الكمية مرتين
--     (ضغطتين، إعادة إرسال بعد قطع النت، طلبين في نفس اللحظة — قفل advisory). التعديل بيعمل حركة تسوية بالفرق، والحذف بيرجّع الكمية.

-- ================= (1) الألم =================
alter table ortho_follow_ups add column if not exists pain_score smallint;
alter table ortho_follow_ups drop constraint if exists ortho_follow_ups_pain_chk;
alter table ortho_follow_ups add constraint ortho_follow_ups_pain_chk check (pain_score is null or pain_score between 0 and 10);

create table if not exists ortho_pain_scores (
  id uuid primary key default gen_random_uuid(),
  patient_id uuid not null references patients(id) on delete cascade,
  visit_date date not null,
  score smallint not null check (score between 0 and 10),
  source text not null check (source in ('consultation', 'nursing', 'follow_up')),
  source_id uuid not null,
  appointment_id uuid references appointments(id) on delete set null,
  created_by uuid references employees(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint ortho_pain_scores_source_uq unique (source, source_id)
);
create index if not exists ortho_pain_scores_patient on ortho_pain_scores(patient_id, visit_date desc);
create index if not exists ortho_pain_scores_appointment_id_fkey_idx on ortho_pain_scores(appointment_id);
create index if not exists ortho_pain_scores_created_by_fkey_idx on ortho_pain_scores(created_by);

-- r = الصف كـ jsonb (to_jsonb(new)) — دالة واحدة للتلات جداول
create or replace function public._pain_log(p_src text, r jsonb) returns void
language plpgsql security definer set search_path = public as $$
declare sc numeric; pid uuid := nullif(r->>'patient_id', '')::uuid; rid uuid := (r->>'id')::uuid;
begin
  if p_src = 'nursing' then
    sc := case when jsonb_typeof(r->'sheet'->'pain') = 'number' then (r->'sheet'->>'pain')::numeric end;
  else
    sc := nullif(r->>'pain_score', '')::numeric;
  end if;
  -- موعد متابعة ملغي مالوش درجة ألم
  if p_src = 'follow_up' and r->>'status' = 'cancelled' then sc := null; end if;
  if pid is null or sc is null or sc < 0 or sc > 10 then
    delete from ortho_pain_scores where source = p_src and source_id = rid;
    return;
  end if;
  insert into ortho_pain_scores (patient_id, visit_date, score, source, source_id, appointment_id, created_by)
  values (pid, coalesce(nullif(r->>'date', '')::date, riyadh_today()), round(sc)::smallint, p_src, rid,
    (select a.id from appointments a where a.id = nullif(r->>'appointment_id', '')::uuid),
    (select e.id from employees e where e.id = nullif(r->>'created_by', '')::uuid))
  on conflict (source, source_id) do update set patient_id = excluded.patient_id, visit_date = excluded.visit_date, score = excluded.score,
    appointment_id = excluded.appointment_id, updated_at = now()
  where (ortho_pain_scores.patient_id, ortho_pain_scores.visit_date, ortho_pain_scores.score, ortho_pain_scores.appointment_id)
    is distinct from (excluded.patient_id, excluded.visit_date, excluded.score, excluded.appointment_id);
end $$;

create or replace function public.trg_pain_log() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if tg_op = 'DELETE' then
    delete from ortho_pain_scores where source = tg_argv[0] and source_id = old.id;
    return old;
  end if;
  perform _pain_log(tg_argv[0], to_jsonb(new));
  return new;
end $$;

drop trigger if exists trg_pain_log on ortho_consultations;
create trigger trg_pain_log after insert or update or delete on ortho_consultations for each row execute function trg_pain_log('consultation');
drop trigger if exists trg_pain_log on ortho_nursing;
create trigger trg_pain_log after insert or update or delete on ortho_nursing for each row execute function trg_pain_log('nursing');
drop trigger if exists trg_pain_log on ortho_follow_ups;
create trigger trg_pain_log after insert or update or delete on ortho_follow_ups for each row execute function trg_pain_log('follow_up');

-- ================= (2) سجل الروشتات =================
create table if not exists ortho_prescriptions (
  id uuid primary key default gen_random_uuid(),
  patient_id uuid not null references patients(id) on delete cascade,
  rx_date date not null,
  source text not null check (source in ('consultation', 'nursing')),
  source_id uuid not null,              -- التشخيص/شيت المتابعة (من غير FK: الروشتة بتفضل في السجل لو الكشف اتمسح)
  version int not null default 1,       -- 1 = أول حفظ، وكل تعديل في محتوى الروشتة = نسخة جديدة
  instructions text not null default '', -- التعليمات / ملاحظات الروشتة العامة
  labs jsonb not null default '[]'::jsonb,
  imaging_requests jsonb not null default '[]'::jsonb,
  appointment_id uuid references appointments(id) on delete set null,
  fingerprint text not null,
  created_by uuid references employees(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint ortho_prescriptions_version_uq unique (source, source_id, version)
);
create index if not exists ortho_prescriptions_patient on ortho_prescriptions(patient_id, rx_date desc);
create index if not exists ortho_prescriptions_appointment_id_fkey_idx on ortho_prescriptions(appointment_id);
create index if not exists ortho_prescriptions_created_by_fkey_idx on ortho_prescriptions(created_by);

create table if not exists ortho_prescription_items (
  id uuid primary key default gen_random_uuid(),
  prescription_id uuid not null references ortho_prescriptions(id) on delete cascade,
  patient_id uuid not null references patients(id) on delete cascade,
  position int not null,
  name text not null,
  dose text not null default '',
  frequency text not null default '',
  duration text not null default '',
  notes text not null default '',        -- ملاحظة الدواء ده بس (بعد الأكل، قبل النوم…)
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint ortho_prescription_items_pos_uq unique (prescription_id, position)
);
create index if not exists ortho_prescription_items_patient_id_fkey_idx on ortho_prescription_items(patient_id);

create or replace function public._rx_log(p_src text, r jsonb) returns void
language plpgsql security definer set search_path = public as $$
declare
  pid uuid := nullif(r->>'patient_id', '')::uuid; rid uuid := (r->>'id')::uuid; rx jsonb; meds jsonb; labs jsonb; imgs jsonb; instr text; fp text;
  last_v int; last_fp text; last_id uuid; nid uuid; d date := coalesce(nullif(r->>'date', '')::date, riyadh_today());
  appt uuid := (select a.id from appointments a where a.id = nullif(r->>'appointment_id', '')::uuid);
  who uuid := (select e.id from employees e where e.id = nullif(r->>'created_by', '')::uuid);
begin
  if pid is null then return; end if; -- تشخيص لسه مش مربوط بملف — بيتسجّل أول ما يترتبط
  rx := case when p_src = 'nursing' then coalesce(r->'sheet'->'rx', '{}'::jsonb)
    else jsonb_build_object('medications', r->'medications', 'plan', r->'plan', 'labs', r->'labs', 'imagingRequests', r->'imaging_requests') end;
  select coalesce(jsonb_agg(jsonb_build_object('name', btrim(m->>'name'), 'dose', btrim(coalesce(m->>'dose', '')), 'frequency', btrim(coalesce(m->>'frequency', '')),
      'duration', btrim(coalesce(m->>'duration', '')), 'notes', btrim(coalesce(m->>'notes', ''))) order by o), '[]'::jsonb)
    into meds
    from jsonb_array_elements(case when jsonb_typeof(rx->'medications') = 'array' then rx->'medications' else '[]'::jsonb end) with ordinality e(m, o)
    where jsonb_typeof(m) = 'object' and btrim(coalesce(m->>'name', '')) <> '';
  labs := case when jsonb_typeof(rx->'labs') = 'array' then rx->'labs' else '[]'::jsonb end;
  imgs := case when jsonb_typeof(rx->'imagingRequests') = 'array' then rx->'imagingRequests' else '[]'::jsonb end;
  instr := btrim(coalesce(rx->>'plan', ''));
  if jsonb_array_length(meds) = 0 and instr = '' and jsonb_array_length(labs) = 0 and jsonb_array_length(imgs) = 0 then return; end if;
  fp := md5(jsonb_build_array(meds, instr, labs, imgs)::text);
  select version, fingerprint, id into last_v, last_fp, last_id from ortho_prescriptions where source = p_src and source_id = rid order by version desc limit 1;
  if last_fp = fp then
    -- نفس الروشتة (حفظ تاني من غير تغيير): التاريخ/المريض بس لو اتغيّروا
    update ortho_prescriptions set rx_date = d, patient_id = pid, appointment_id = appt, updated_at = now()
    where id = last_id and (rx_date, patient_id, appointment_id) is distinct from (d, pid, appt);
    update ortho_prescription_items set patient_id = pid where prescription_id = last_id and patient_id <> pid;
    return;
  end if;
  insert into ortho_prescriptions (patient_id, rx_date, source, source_id, version, instructions, labs, imaging_requests, appointment_id, fingerprint, created_by)
  values (pid, d, p_src, rid, coalesce(last_v, 0) + 1, instr, labs, imgs, appt, fp, coalesce(my_employee_id(), who))
  returning id into nid;
  insert into ortho_prescription_items (prescription_id, patient_id, position, name, dose, frequency, duration, notes)
  select nid, pid, o::int, m->>'name', m->>'dose', m->>'frequency', m->>'duration', m->>'notes'
  from jsonb_array_elements(meds) with ordinality e(m, o);
end $$;

create or replace function public.trg_rx_log() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  perform _rx_log(tg_argv[0], to_jsonb(new));
  return new;
end $$;

drop trigger if exists trg_rx_log on ortho_consultations;
create trigger trg_rx_log after insert or update on ortho_consultations for each row execute function trg_rx_log('consultation');
drop trigger if exists trg_rx_log on ortho_nursing;
create trigger trg_rx_log after insert or update on ortho_nursing for each row execute function trg_rx_log('nursing');

-- صلاحيات القراية: نفس أقسام المصدر (التشخيص / متابعة التمريض / المتابعات) + «المرضى» زي باقي السجلات الطبية (963).
-- مفيش insert/update/delete من الواجهة خالص — الكتابة من التريجرات بس.
do $$
declare t record;
begin
  for t in select * from (values
    ('ortho_pain_scores', '(select has_perm(''patients'', ''view'')) or (select has_perm(''diagnosis'', ''view'')) or (select has_perm(''nursing'', ''view'')) or (select has_perm(''follow_ups'', ''view''))'),
    ('ortho_prescriptions', '(select has_perm(''patients'', ''view'')) or (select has_perm(''diagnosis'', ''view'')) or (select has_perm(''nursing'', ''view''))'),
    ('ortho_prescription_items', '(select has_perm(''patients'', ''view'')) or (select has_perm(''diagnosis'', ''view'')) or (select has_perm(''nursing'', ''view''))')
  ) x(tbl, rd) loop
    execute format('alter table %I enable row level security', t.tbl);
    execute format('revoke all on %I from anon, authenticated', t.tbl);
    execute format('grant select on %I to authenticated', t.tbl);
    execute format('drop policy if exists staff_read on %I', t.tbl);
    execute format('create policy staff_read on %I for select using (%s)', t.tbl, t.rd);
    execute format('drop trigger if exists trg_touch on %I', t.tbl);
    execute format('create trigger trg_touch before update on %I for each row execute function ortho_touch()', t.tbl);
    if not exists (select 1 from pg_publication_tables where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = t.tbl) then
      execute format('alter publication supabase_realtime add table public.%I', t.tbl);
    end if;
  end loop;
end $$;
revoke all on function public._pain_log(text, jsonb) from public, anon, authenticated;
revoke all on function public._rx_log(text, jsonb) from public, anon, authenticated;
revoke all on function public.trg_pain_log() from public, anon, authenticated;
revoke all on function public.trg_rx_log() from public, anon, authenticated;

-- البيانات الموجودة: درجات الألم والروشتات اللي اتسجلت قبل الهجرة (قراءة بس من الجداول — مفيش تعديل في السجلات نفسها)
select _pain_log('consultation', to_jsonb(c)) from ortho_consultations c where c.pain_score is not null and c.patient_id is not null;
select _pain_log('nursing', to_jsonb(n)) from ortho_nursing n where jsonb_typeof(n.sheet->'pain') = 'number';
select _rx_log('consultation', to_jsonb(c)) from (select * from ortho_consultations where patient_id is not null order by created_at) c;
select _rx_log('nursing', to_jsonb(n)) from (select * from ortho_nursing order by created_at) n;

-- ================= (3) المصروفات ↔ المخزون =================
alter table expenses add column if not exists inventory_item_id uuid references inventory_items(id) on delete restrict;
alter table expenses add column if not exists quantity numeric;
alter table expenses add column if not exists unit_price numeric;
alter table expenses drop constraint if exists expenses_supply_chk;
alter table expenses add constraint expenses_supply_chk check (inventory_item_id is null or (quantity > 0 and unit_price >= 0));
create index if not exists expenses_inventory_item_id_fkey_idx on expenses(inventory_item_id);
alter table stock_movements add column if not exists expense_id uuid references expenses(id) on delete set null;
create index if not exists stock_movements_expense_id_fkey_idx on stock_movements(expense_id);

create or replace function public.save_supply_expense(p jsonb) returns jsonb
language plpgsql security definer set search_path = public as $$
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
  select * into it from inventory_items where id = ex.inventory_item_id;
  return jsonb_build_object('id', ex.id, 'duplicate', dup, 'amount', ex.amount, 'balance', it.quantity, 'minQuantity', it.min_quantity, 'low', it.quantity <= it.min_quantity, 'unit', it.unit, 'item', it.name);
end $$;
revoke all on function public.save_supply_expense(jsonb) from public, anon;
grant execute on function public.save_supply_expense(jsonb) to authenticated;

-- المصروف العادي: نفس اللي قبل كده + مفتاح عملية اختياري (ضغطتين مايسجلوش مصروفين) + رفض تعديل مصروف مربوط بالمخزون من هنا
create or replace function public.save_expense(p jsonb) returns jsonb
language plpgsql security definer set search_path = public as $$
declare v uuid := _uuid(p, 'id'); emp uuid; k text := nullif(_txt(p, 'key'), ''); found_id uuid;
begin
  emp := require_perm('expenses', case when v is null then 'create' else 'edit' end);
  if _txt(p, 'category') = '' then raise exception 'بند المصروف مطلوب'; end if;
  if _num(p, 'amount') <= 0 then raise exception 'قيمة المصروف لازم تكون أكبر من صفر'; end if;
  if v is not null then
    if exists (select 1 from expenses where id = v and inventory_item_id is not null) then
      raise exception 'المصروف ده مربوط بالمخزون — عدّله من خانات «مستلزمات طبية» (المنتج والكمية)';
    end if;
    update expenses set category = _txt(p, 'category'), amount = _num(p, 'amount'), description = _txt(p, 'description'),
      expense_date = coalesce(nullif(p->>'expenseDate', '')::date, expense_date), payment_method = _txt(p, 'paymentMethod', 'cash'), updated_at = now()
    where id = v;
  else
    if k is not null then
      perform pg_advisory_xact_lock(hashtextextended('expense:' || k, 0));
      select id into found_id from expenses where idem_key = k;
      if found_id is not null then return jsonb_build_object('id', found_id, 'duplicate', true); end if;
    end if;
    insert into expenses (branch_id, category, amount, description, expense_date, payment_method, created_by, idem_key)
    values (_uuid(p, 'branchId'), _txt(p, 'category'), _num(p, 'amount'), _txt(p, 'description'), coalesce(nullif(p->>'expenseDate', '')::date, riyadh_today()), _txt(p, 'paymentMethod', 'cash'), emp, k)
    returning id into v;
  end if;
  perform log_action('تسجيل مصروف: ' || _txt(p, 'category') || ' — ' || _num(p, 'amount') || ' ج.م');
  return jsonb_build_object('id', v);
end $$;

-- حذف مصروف مستلزمات = الكمية بترجع من المخزون (حركة تسوية بالنقص) في نفس العملية؛ لو اتصرف منها الحذف بيترفض
create or replace function public.delete_expense(p_id uuid) returns void
language plpgsql security definer set search_path = public as $$
declare ex expenses; cur numeric;
begin
  perform require_perm('expenses', 'delete');
  select * into ex from expenses where id = p_id for update;
  if ex.id is null then return; end if;
  if ex.inventory_item_id is not null then
    perform require_perm('inventory', 'edit');
    select quantity into cur from inventory_items where id = ex.inventory_item_id for update;
    if cur < ex.quantity then raise exception 'مينفعش تحذف المصروف ده — اتصرف من الكمية اللي اتشرت (المتاح % من %)', cur, ex.quantity; end if;
    perform stock_move_core(ex.inventory_item_id, 'adjust_out', ex.quantity, 0, 'حذف مصروف مستلزمات', coalesce(nullif(ex.description, ''), 'إلغاء الشراء'), 'exp-del:' || ex.id, false, null);
  end if;
  delete from expenses where id = p_id;
  perform log_action('حذف مصروف');
end $$;
