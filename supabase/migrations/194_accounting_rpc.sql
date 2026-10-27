-- النظام المحاسبي — دوال الكتابة (RPC). كل دالة: acc_require(الصلاحية) ← تحقق ← كتابة ← ترحيل ← سجل تدقيق، في معاملة واحدة.
-- الأخطاء بتعمل rollback كامل (مفيش مستند من غير أثره المحاسبي). مفاتيح التكرار (key) بترجّع نفس النتيجة لو الطلب اتعاد.

create or replace view acc_posted_lines as
  select l.*, j.entry_date, j.source_type, j.source_id, j.no as journal_no, j.description as journal_desc, j.posted_at, j.reversal_of
  from acc_journal_lines l join acc_journals j on j.id = l.journal_id where j.status = 'posted';
revoke all on acc_posted_lines from anon, authenticated;

create or replace function acc_d(p jsonb, k text) returns date language sql immutable as $$ select nullif(p ->> k, '')::date $$;

create or replace function acc_treasury_balance(p_id uuid, p_asof date default null) returns numeric
language sql stable security definer set search_path = public as $$
  select coalesce(sum(l.debit - l.credit), 0) from acc_posted_lines l join acc_treasuries t on t.account_id = l.account_id
  where t.id = p_id and (p_asof is null or l.entry_date <= p_asof)
$$;

-- ===== الحسابات والإعدادات =====
create or replace function acc_account_save(p jsonb) returns jsonb
language plpgsql security definer set search_path = public as $$
declare v uuid := _uuid(p, 'id'); a acc_accounts; used boolean; v_code text := btrim(_txt(p, 'code')); typ text := _txt(p, 'type');
begin
  perform acc_require('settings.manage');
  if v_code = '' or btrim(_txt(p, 'name')) = '' then raise exception 'رمز الحساب واسمه مطلوبان'; end if;
  if typ not in ('asset', 'liability', 'equity', 'revenue', 'expense') then raise exception 'نوع الحساب غير صحيح'; end if;
  if v is null then
    insert into acc_accounts (code, name, name_en, type, parent_id, postable, active)
    values (v_code, btrim(_txt(p, 'name')), nullif(_txt(p, 'nameEn'), ''), typ, _uuid(p, 'parentId'), coalesce((p->>'postable')::boolean, true), true) returning * into a;
  else
    select * into a from acc_accounts where id = v for update;
    if a.id is null then raise exception 'الحساب غير موجود'; end if;
    select exists (select 1 from acc_journal_lines where account_id = v) into used;
    if used and (a.type <> typ or (a.postable and not coalesce((p->>'postable')::boolean, true))) then raise exception 'لا يمكن تغيير نوع حساب عليه حركة أو تحويله لحساب رئيسي'; end if;
    if a.system_key is not null and (a.type <> typ or not coalesce((p->>'active')::boolean, true)) then raise exception 'حساب نظام أساسي — لا يمكن تغيير نوعه أو إيقافه'; end if;
    update acc_accounts set code = v_code, name = btrim(_txt(p, 'name')), name_en = nullif(_txt(p, 'nameEn'), ''), type = typ,
      parent_id = _uuid(p, 'parentId'), postable = coalesce((p->>'postable')::boolean, postable), active = coalesce((p->>'active')::boolean, active)
    where id = v returning * into a;
  end if;
  perform acc_audit_log(case when v is null then 'إضافة حساب' else 'تعديل حساب' end, 'account', a.id::text, jsonb_build_object('code', a.code, 'name', a.name));
  return to_jsonb(a);
exception when unique_violation then raise exception 'رمز الحساب مستخدم من قبل';
end $$;

create or replace function acc_cost_center_save(p jsonb) returns jsonb
language plpgsql security definer set search_path = public as $$
declare v uuid := _uuid(p, 'id'); c acc_cost_centers;
begin
  perform acc_require('settings.manage');
  if btrim(_txt(p, 'code')) = '' or btrim(_txt(p, 'name')) = '' then raise exception 'رمز مركز التكلفة واسمه مطلوبان'; end if;
  if v is null then insert into acc_cost_centers (code, name) values (btrim(_txt(p, 'code')), btrim(_txt(p, 'name'))) returning * into c;
  else update acc_cost_centers set code = btrim(_txt(p, 'code')), name = btrim(_txt(p, 'name')), active = coalesce((p->>'active')::boolean, active) where id = v returning * into c; end if;
  if c.id is null then raise exception 'مركز التكلفة غير موجود'; end if;
  perform acc_audit_log('حفظ مركز تكلفة', 'cost_center', c.id::text, to_jsonb(c));
  return to_jsonb(c);
exception when unique_violation then raise exception 'رمز مركز التكلفة مستخدم من قبل';
end $$;

create or replace function acc_method_map_save(p_method text, p_treasury uuid) returns void
language plpgsql security definer set search_path = public as $$
begin
  perform acc_require('settings.manage');
  if not is_payment_method(p_method) then raise exception 'طريقة دفع غير معروفة'; end if;
  if not exists (select 1 from acc_treasuries where id = p_treasury and active) then raise exception 'الخزنة غير موجودة أو موقوفة'; end if;
  insert into acc_method_map (method, treasury_id) values (p_method, p_treasury) on conflict (method) do update set treasury_id = excluded.treasury_id;
  perform acc_audit_log('ربط طريقة دفع بخزنة', 'method_map', p_method, jsonb_build_object('treasury', p_treasury));
end $$;

-- ===== الخزائن =====
create or replace function acc_treasury_save(p jsonb) returns jsonb
language plpgsql security definer set search_path = public as $$
declare v uuid := _uuid(p, 'id'); t acc_treasuries; kind text := _txt(p, 'kind'); v_code text; ob numeric := coalesce(nullif(p->>'openingBalance', '')::numeric, 0); od date := coalesce(acc_d(p, 'openingDate'), riyadh_today());
begin
  perform acc_require('settings.manage');
  if btrim(_txt(p, 'name')) = '' then raise exception 'اسم الخزنة مطلوب'; end if;
  if v is null then
    if kind not in ('cash', 'bank') then raise exception 'نوع الحساب: صندوق أو بنك'; end if;
    if ob < 0 then raise exception 'الرصيد الافتتاحي لا يكون سالبًا'; end if;
    select (coalesce(max(a2.code::int), 1110) + 1)::text into v_code from acc_accounts a2 where a2.code ~ '^11[0-9]{2}$';
    if v_code::int >= 1200 then raise exception 'تجاوزت الحد الأقصى لعدد الحسابات تحت النقدية والبنوك'; end if;
    insert into acc_accounts (code, name, type, parent_id, postable) values (v_code, btrim(_txt(p, 'name')), 'asset', (select a3.id from acc_accounts a3 where a3.code = '1100'), true);
    insert into acc_treasuries (name, kind, account_id, opening_balance, opening_date)
    values (btrim(_txt(p, 'name')), kind, (select a4.id from acc_accounts a4 where a4.code = v_code), ob, od) returning * into t;
    if ob > 0 then
      perform acc_create_journal(od, 'رصيد افتتاحي — ' || t.name, 'opening', t.id, 'v1', null,
        jsonb_build_array(jsonb_build_object('account', t.account_id, 'debit', ob, 'treasury', t.id), jsonb_build_object('account', 'opening_equity', 'credit', ob)), true, null, null, null, null, my_employee_id());
    end if;
  else
    update acc_treasuries set name = btrim(_txt(p, 'name')), active = coalesce((p->>'active')::boolean, active) where id = v returning * into t;
    if t.id is null then raise exception 'الخزنة غير موجودة'; end if;
    update acc_accounts set name = t.name, active = t.active where id = t.account_id;
  end if;
  perform acc_audit_log('حفظ خزنة/حساب بنكي', 'treasury', t.id::text, jsonb_build_object('name', t.name, 'opening', t.opening_balance));
  return to_jsonb(t);
end $$;

create or replace function acc_treasury_transfer(p jsonb) returns jsonb
language plpgsql security definer set search_path = public as $$
declare me uuid; f acc_treasuries; t acc_treasuries; amt numeric := round(_num(p, 'amount'), 2); d date := coalesce(acc_d(p, 'date'), riyadh_today()); key text := nullif(_txt(p, 'key'), ''); tr acc_transfers; bal numeric;
begin
  me := acc_require('journals.create');
  if key is not null then select * into tr from acc_transfers where idem_key = key; if tr.id is not null then return to_jsonb(tr); end if; end if;
  if amt <= 0 then raise exception 'المبلغ يجب أن يكون أكبر من صفر'; end if;
  select * into f from acc_treasuries where id = _uuid(p, 'from') and active for update;
  select * into t from acc_treasuries where id = _uuid(p, 'to') and active;
  if f.id is null or t.id is null or f.id = t.id then raise exception 'اختر حسابين مختلفين نشطين'; end if;
  bal := acc_treasury_balance(f.id);
  if bal < amt then raise exception 'رصيد % غير كافٍ (المتاح %)', f.name, bal; end if;
  insert into acc_transfers (from_treasury, to_treasury, amount, transfer_date, note, idem_key, created_by) values (f.id, t.id, amt, d, _txt(p, 'note'), key, me) returning * into tr;
  perform acc_create_journal(d, 'تحويل من ' || f.name || ' إلى ' || t.name, 'transfer', tr.id, 'v1', null,
    jsonb_build_array(jsonb_build_object('account', t.account_id, 'debit', amt, 'treasury', t.id), jsonb_build_object('account', f.account_id, 'credit', amt, 'treasury', f.id)), true, null, null, null, null, me);
  perform acc_audit_log('تحويل بين الحسابات', 'transfer', tr.id::text, jsonb_build_object('amount', amt, 'from', f.name, 'to', t.name));
  return to_jsonb(tr);
end $$;

create or replace function acc_cash_count(p jsonb) returns jsonb
language plpgsql security definer set search_path = public as $$
declare me uuid; t acc_treasuries; d date := coalesce(acc_d(p, 'date'), riyadh_today()); counted numeric := round(_num(p, 'counted'), 2); book numeric; df numeric; cc acc_cash_counts; key text := nullif(_txt(p, 'key'), '');
begin
  me := acc_require('journals.create');
  if key is not null then select * into cc from acc_cash_counts where idem_key = key; if cc.id is not null then return to_jsonb(cc); end if; end if;
  if counted < 0 then raise exception 'المبلغ المعدود لا يكون سالبًا'; end if;
  select * into t from acc_treasuries where id = _uuid(p, 'treasuryId') for update;
  if t.id is null then raise exception 'الخزنة غير موجودة'; end if;
  book := acc_treasury_balance(t.id, d); df := counted - book;
  insert into acc_cash_counts (treasury_id, count_date, book_balance, counted, diff, note, idem_key, created_by) values (t.id, d, book, counted, df, _txt(p, 'note'), key, me) returning * into cc;
  if df <> 0 then
    perform acc_create_journal(d, 'تسوية جرد ' || t.name || case when df > 0 then ' (زيادة)' else ' (عجز)' end, 'cash_count', cc.id, 'v1', null,
      case when df > 0 then jsonb_build_array(jsonb_build_object('account', t.account_id, 'debit', df, 'treasury', t.id), jsonb_build_object('account', 'cash_diff', 'credit', df))
           else jsonb_build_array(jsonb_build_object('account', 'cash_diff', 'debit', -df), jsonb_build_object('account', t.account_id, 'credit', -df, 'treasury', t.id)) end,
      true, null, null, null, null, me);
  end if;
  perform acc_audit_log('جرد خزنة', 'cash_count', cc.id::text, jsonb_build_object('book', book, 'counted', counted, 'diff', df));
  return to_jsonb(cc);
end $$;

create or replace function acc_reconcile(p_lines uuid[], p_on boolean default true) returns int
language plpgsql security definer set search_path = public as $$
declare n int;
begin
  perform acc_require('journals.post');
  update acc_journal_lines l set reconciled_at = case when p_on then now() else null end
  where l.id = any(p_lines) and exists (select 1 from acc_treasuries t where t.account_id = l.account_id);
  get diagnostics n = row_count;
  perform acc_audit_log(case when p_on then 'تسوية بنكية' else 'إلغاء تسوية بنكية' end, 'reconcile', null, jsonb_build_object('count', n));
  return n;
end $$;

-- ===== القيود اليومية اليدوية =====
create or replace function acc_journal_save(p jsonb) returns jsonb
language plpgsql security definer set search_path = public as $$
declare me uuid; j acc_journals; v uuid := _uuid(p, 'id'); l jsonb; n int := 0; key text := nullif(_txt(p, 'key'), ''); do_post boolean := coalesce((p->>'post')::boolean, false);
        d date := coalesce(acc_d(p, 'date'), riyadh_today()); a acc_accounts;
begin
  me := acc_require('journals.create');
  if do_post then perform acc_require('journals.post'); end if;
  if jsonb_typeof(p->'lines') <> 'array' or jsonb_array_length(p->'lines') < 2 then raise exception 'القيد يحتاج سطرين على الأقل'; end if;
  if btrim(_txt(p, 'description')) = '' then raise exception 'بيان القيد مطلوب'; end if;
  if v is null then
    if key is not null then select * into j from acc_journals where idem_key = key; if j.id is not null then return jsonb_build_object('id', j.id, 'no', j.no, 'status', j.status); end if; end if;
    insert into acc_journals (entry_date, description, source_type, idem_key, attachment_path, created_by) values (d, btrim(_txt(p, 'description')), 'manual', key, nullif(_txt(p, 'attachment'), ''), me) returning * into j;
  else
    select * into j from acc_journals where id = v for update;
    if j.id is null then raise exception 'القيد غير موجود'; end if;
    if j.status <> 'draft' or j.source_type <> 'manual' then raise exception 'يمكن تعديل المسودات اليدوية فقط'; end if;
    update acc_journals set entry_date = d, description = btrim(_txt(p, 'description')), attachment_path = nullif(_txt(p, 'attachment'), '') where id = v returning * into j;
    delete from acc_journal_lines where journal_id = v;
  end if;
  for l in select * from jsonb_array_elements(p->'lines') loop
    n := n + 1;
    select * into a from acc_accounts where id = nullif(l->>'account', '')::uuid;
    if a.id is null or not a.postable or not a.active then raise exception 'السطر %: حساب غير صالح للترحيل', n; end if;
    if coalesce(nullif(l->>'debit', '')::numeric, 0) < 0 or coalesce(nullif(l->>'credit', '')::numeric, 0) < 0 then raise exception 'السطر %: لا مبالغ سالبة', n; end if;
    if coalesce(nullif(l->>'debit', '')::numeric, 0) > 0 and coalesce(nullif(l->>'credit', '')::numeric, 0) > 0 then raise exception 'السطر %: إما مدين أو دائن', n; end if;
    insert into acc_journal_lines (journal_id, line_no, account_id, debit, credit, memo, cost_center_id)
    values (j.id, n, a.id, round(coalesce(nullif(l->>'debit', '')::numeric, 0), 2), round(coalesce(nullif(l->>'credit', '')::numeric, 0), 2), nullif(l->>'memo', ''), nullif(l->>'costCenter', '')::uuid);
  end loop;
  if do_post then update acc_journals set status = 'posted', approved_by = me, posted_by = me where id = j.id returning * into j; end if;
  perform acc_audit_log(case when do_post then 'ترحيل قيد يدوي' else 'حفظ مسودة قيد' end, 'journal', j.id::text, jsonb_build_object('no', j.no));
  return jsonb_build_object('id', j.id, 'no', j.no, 'status', j.status);
end $$;

create or replace function acc_journal_post(p_id uuid) returns jsonb
language plpgsql security definer set search_path = public as $$
declare me uuid; j acc_journals;
begin
  me := acc_require('journals.post');
  select * into j from acc_journals where id = p_id for update;
  if j.id is null then raise exception 'القيد غير موجود'; end if;
  if j.status = 'posted' then return jsonb_build_object('id', j.id, 'no', j.no, 'status', 'posted'); end if;
  update acc_journals set status = 'posted', approved_by = me, posted_by = me where id = p_id returning * into j;
  perform acc_audit_log('ترحيل قيد', 'journal', j.id::text, jsonb_build_object('no', j.no));
  return jsonb_build_object('id', j.id, 'no', j.no, 'status', j.status);
end $$;

create or replace function acc_journal_discard(p_id uuid) returns void
language plpgsql security definer set search_path = public as $$
declare j acc_journals;
begin
  perform acc_require('journals.create');
  select * into j from acc_journals where id = p_id for update;
  if j.id is null then raise exception 'القيد غير موجود'; end if;
  if j.status <> 'draft' or j.source_type <> 'manual' then raise exception 'يمكن حذف المسودات اليدوية فقط'; end if;
  delete from acc_journals where id = p_id;
  perform acc_audit_log('حذف مسودة قيد', 'journal', p_id::text, jsonb_build_object('no', j.no));
end $$;

-- عكس قيد يدوي فقط — قيود المستندات (فواتير/مصروفات/...) بتتعكس بإلغاء المستند نفسه عشان ما يتعاد ترحيلها
create or replace function acc_journal_reverse(p_id uuid, p_reason text) returns jsonb
language plpgsql security definer set search_path = public as $$
declare j acc_journals; r uuid;
begin
  perform acc_require('journals.post');
  if btrim(coalesce(p_reason, '')) = '' then raise exception 'سبب العكس مطلوب'; end if;
  select * into j from acc_journals where id = p_id for update;
  if j.id is null then raise exception 'القيد غير موجود'; end if;
  if j.source_type <> 'manual' then raise exception 'هذا القيد ناتج عن مستند (%) — ألغِ المستند الأصلي بدل عكس القيد', j.source_type; end if;
  r := acc_reverse_journal(p_id, btrim(p_reason));
  perform acc_audit_log('عكس قيد', 'journal', p_id::text, jsonb_build_object('no', j.no, 'reason', p_reason, 'reversal', r));
  return jsonb_build_object('reversalId', r);
end $$;

-- ===== المصروفات =====
create or replace function acc_expense_save(p jsonb) returns jsonb
language plpgsql security definer set search_path = public as $$
declare me uuid; v uuid := _uuid(p, 'id'); e expenses; a acc_accounts; t acc_treasuries; amt numeric := round(_num(p, 'amount'), 2); vat numeric := round(_num(p, 'vatAmount'), 2);
        key text := nullif(_txt(p, 'key'), ''); do_approve boolean := coalesce((p->>'approve')::boolean, false);
begin
  me := acc_require('expenses.create');
  if do_approve then perform acc_require('expenses.approve'); end if;
  if v is null and key is not null then select * into e from expenses where idem_key = key; if e.id is not null then return to_jsonb(e); end if; end if;
  if amt <= 0 then raise exception 'قيمة المصروف يجب أن تكون أكبر من صفر'; end if;
  if vat < 0 or vat >= amt then raise exception 'قيمة الضريبة غير صحيحة'; end if;
  select * into a from acc_accounts where id = _uuid(p, 'accountId');
  if a.id is null or a.type <> 'expense' or not a.postable or not a.active then raise exception 'اختر حساب مصروف صالحًا'; end if;
  select * into t from acc_treasuries where id = _uuid(p, 'treasuryId') and active;
  if t.id is null then raise exception 'اختر الخزنة أو الحساب البنكي المدفوع منه'; end if;
  if btrim(_txt(p, 'description')) = '' then raise exception 'بيان المصروف مطلوب'; end if;
  if v is null then
    insert into expenses (no, category, amount, description, expense_date, payment_method, created_by, acc_status, account_id, treasury_id, vendor_id, vat_amount, cost_center_id, attachment_path, idem_key)
    values ('EXP-' || lpad(nextval('acc_expense_seq')::text, 6, '0'), a.name, amt, btrim(_txt(p, 'description')), coalesce(acc_d(p, 'date'), riyadh_today()),
      case when t.kind = 'cash' then 'cash' else 'transfer' end, me, 'draft', a.id, t.id, _uuid(p, 'vendorId'), vat, _uuid(p, 'costCenterId'), nullif(_txt(p, 'attachment'), ''), key) returning * into e;
  else
    select * into e from expenses where id = v for update;
    if e.id is null then raise exception 'المصروف غير موجود'; end if;
    if e.acc_status <> 'draft' then raise exception 'المصروف % مُعتمد أو ملغى — لا يُعدَّل', e.no; end if;
    update expenses set category = a.name, amount = amt, description = btrim(_txt(p, 'description')), expense_date = coalesce(acc_d(p, 'date'), expense_date),
      payment_method = case when t.kind = 'cash' then 'cash' else 'transfer' end, account_id = a.id, treasury_id = t.id, vendor_id = _uuid(p, 'vendorId'), vat_amount = vat,
      cost_center_id = _uuid(p, 'costCenterId'), attachment_path = coalesce(nullif(_txt(p, 'attachment'), ''), attachment_path), updated_at = now()
    where id = v returning * into e;
  end if;
  perform acc_audit_log('حفظ مصروف', 'expense', e.id::text, jsonb_build_object('no', e.no, 'amount', amt));
  if do_approve then return acc_expense_approve(e.id); end if;
  return to_jsonb(e);
end $$;

create or replace function acc_expense_approve(p_id uuid) returns jsonb
language plpgsql security definer set search_path = public as $$
declare me uuid; e expenses;
begin
  me := acc_require('expenses.approve');
  select * into e from expenses where id = p_id for update;
  if e.id is null then raise exception 'المصروف غير موجود'; end if;
  if e.acc_status = 'posted' then return to_jsonb(e); end if;
  if e.acc_status = 'cancelled' then raise exception 'المصروف ملغى'; end if;
  update expenses set acc_status = 'posted', approved_by = me, approved_at = now(), updated_at = now() where id = p_id returning * into e;
  perform acc_post_source('expense', p_id);
  perform acc_audit_log('اعتماد وترحيل مصروف', 'expense', p_id::text, jsonb_build_object('no', e.no, 'amount', e.amount));
  return to_jsonb(e);
end $$;

create or replace function acc_expense_cancel(p_id uuid, p_reason text) returns jsonb
language plpgsql security definer set search_path = public as $$
declare e expenses;
begin
  perform acc_require('expenses.approve');
  if btrim(coalesce(p_reason, '')) = '' then raise exception 'سبب الإلغاء مطلوب'; end if;
  select * into e from expenses where id = p_id for update;
  if e.id is null then raise exception 'المصروف غير موجود'; end if;
  if e.acc_status = 'cancelled' then return to_jsonb(e); end if;
  update expenses set acc_status = 'cancelled', cancelled_at = now(), cancel_reason = btrim(p_reason), updated_at = now() where id = p_id returning * into e;
  perform acc_post_source('expense', p_id);
  perform acc_audit_log('إلغاء مصروف', 'expense', p_id::text, jsonb_build_object('no', e.no, 'reason', p_reason));
  return to_jsonb(e);
end $$;

-- ===== الموردون والمشتريات =====
create or replace function acc_vendor_save(p jsonb) returns jsonb
language plpgsql security definer set search_path = public as $$
declare me uuid; v uuid := _uuid(p, 'id'); r acc_vendors;
begin
  me := acc_require('purchases.manage');
  if btrim(_txt(p, 'name')) = '' then raise exception 'اسم المورد مطلوب'; end if;
  if v is null then insert into acc_vendors (name, phone, vat_no, address, note, created_by) values (btrim(_txt(p, 'name')), nullif(_txt(p, 'phone'), ''), nullif(_txt(p, 'vatNo'), ''), nullif(_txt(p, 'address'), ''), _txt(p, 'note'), me) returning * into r;
  else update acc_vendors set name = btrim(_txt(p, 'name')), phone = nullif(_txt(p, 'phone'), ''), vat_no = nullif(_txt(p, 'vatNo'), ''), address = nullif(_txt(p, 'address'), ''), note = _txt(p, 'note'),
    active = coalesce((p->>'active')::boolean, active) where id = v returning * into r; end if;
  if r.id is null then raise exception 'المورد غير موجود'; end if;
  perform acc_audit_log('حفظ مورد', 'vendor', r.id::text, jsonb_build_object('name', r.name));
  return to_jsonb(r);
exception when unique_violation then raise exception 'اسم المورد مسجّل من قبل';
end $$;

create or replace function acc_purchase_save(p jsonb) returns jsonb
language plpgsql security definer set search_path = public as $$
declare me uuid; v uuid := _uuid(p, 'id'); pu acc_purchases; it jsonb; n int := 0; sub numeric := 0; amt numeric; qty numeric; uc numeric; vat numeric := round(_num(p, 'vatAmount'), 2);
        key text := nullif(_txt(p, 'key'), ''); v_kind text := coalesce(nullif(_txt(p, 'kind'), ''), 'credit'); prod products; acct acc_accounts; do_post boolean := coalesce((p->>'post')::boolean, false);
begin
  me := acc_require('purchases.manage');
  if v is null and key is not null then select * into pu from acc_purchases where idem_key = key; if pu.id is not null then return to_jsonb(pu); end if; end if;
  if v_kind not in ('cash', 'credit') then raise exception 'نوع الشراء نقدي أو آجل'; end if;
  if v_kind = 'cash' and not exists (select 1 from acc_treasuries where id = _uuid(p, 'treasuryId') and active) then raise exception 'الشراء النقدي يحتاج خزنة/حساب بنكي'; end if;
  if not exists (select 1 from acc_vendors where id = _uuid(p, 'vendorId') and active) then raise exception 'اختر موردًا نشطًا'; end if;
  if jsonb_typeof(p->'items') <> 'array' or jsonb_array_length(p->'items') = 0 then raise exception 'أضف بندًا واحدًا على الأقل'; end if;
  if v is null then
    insert into acc_purchases (vendor_id, purchase_date, due_date, kind, vendor_invoice_no, note, treasury_id, attachment_path, idem_key, created_by)
    values (_uuid(p, 'vendorId'), coalesce(acc_d(p, 'date'), riyadh_today()), acc_d(p, 'dueDate'), v_kind, nullif(_txt(p, 'vendorInvoiceNo'), ''), _txt(p, 'note'), case when v_kind = 'cash' then _uuid(p, 'treasuryId') end, nullif(_txt(p, 'attachment'), ''), key, me)
    returning * into pu;
  else
    select * into pu from acc_purchases where id = v for update;
    if pu.id is null then raise exception 'فاتورة الشراء غير موجودة'; end if;
    if pu.status <> 'draft' then raise exception 'فاتورة الشراء % معتمدة أو ملغاة — لا تُعدَّل', pu.no; end if;
    update acc_purchases set vendor_id = _uuid(p, 'vendorId'), purchase_date = coalesce(acc_d(p, 'date'), purchase_date), due_date = acc_d(p, 'dueDate'), kind = v_kind, vendor_invoice_no = nullif(_txt(p, 'vendorInvoiceNo'), ''),
      note = _txt(p, 'note'), treasury_id = case when v_kind = 'cash' then _uuid(p, 'treasuryId') end, attachment_path = coalesce(nullif(_txt(p, 'attachment'), ''), attachment_path)
    where id = v returning * into pu;
    delete from acc_purchase_items where purchase_id = v;
  end if;
  for it in select * from jsonb_array_elements(p->'items') loop
    n := n + 1; qty := coalesce(nullif(it->>'qty', '')::numeric, 0); uc := coalesce(nullif(it->>'unitCost', '')::numeric, -1);
    if qty <= 0 or uc < 0 then raise exception 'البند %: الكمية والتكلفة غير صحيحتين', n; end if;
    amt := round(qty * uc, 2); sub := sub + amt;
    if nullif(it->>'productId', '') is not null then
      select * into prod from products where id = (it->>'productId')::uuid;
      if prod.id is null then raise exception 'البند %: المنتج غير موجود', n; end if;
      if qty <> trunc(qty) then raise exception 'البند %: كمية المنتج رقم صحيح', n; end if;
      insert into acc_purchase_items (purchase_id, line_no, product_id, description, qty, unit_cost, amount, cost_center_id) values (pu.id, n, prod.id, coalesce(nullif(it->>'description', ''), prod.name), qty, uc, amt, nullif(it->>'costCenter', '')::uuid);
    else
      select * into acct from acc_accounts where id = nullif(it->>'accountId', '')::uuid;
      if acct.id is null or acct.type not in ('expense', 'asset') or not acct.postable or not acct.active then raise exception 'البند %: اختر حساب مصروف صالحًا أو منتجًا', n; end if;
      insert into acc_purchase_items (purchase_id, line_no, account_id, description, qty, unit_cost, amount, cost_center_id) values (pu.id, n, acct.id, coalesce(nullif(it->>'description', ''), acct.name), qty, uc, amt, nullif(it->>'costCenter', '')::uuid);
    end if;
  end loop;
  if vat < 0 then raise exception 'الضريبة لا تكون سالبة'; end if;
  update acc_purchases set subtotal = sub, vat_amount = vat, total = sub + vat where id = pu.id returning * into pu;
  if pu.total <= 0 then raise exception 'إجمالي الفاتورة يجب أن يكون أكبر من صفر'; end if;
  perform acc_audit_log('حفظ فاتورة شراء', 'purchase', pu.id::text, jsonb_build_object('no', pu.no, 'total', pu.total));
  if do_post then return acc_purchase_post(pu.id); end if;
  return to_jsonb(pu);
end $$;

create or replace function acc_purchase_post(p_id uuid) returns jsonb
language plpgsql security definer set search_path = public as $$
declare me uuid; pu acc_purchases; it record; prod products; newq int; vp acc_vendor_payments;
begin
  me := acc_require('purchases.manage');
  select * into pu from acc_purchases where id = p_id for update;
  if pu.id is null then raise exception 'فاتورة الشراء غير موجودة'; end if;
  if pu.status = 'posted' then return to_jsonb(pu); end if;   -- منع الترحيل/الاستلام مرتين
  if pu.status = 'cancelled' then raise exception 'فاتورة الشراء ملغاة'; end if;
  update acc_purchases set status = 'posted', approved_by = me, approved_at = now() where id = p_id returning * into pu;
  for it in select * from acc_purchase_items where purchase_id = p_id and product_id is not null order by line_no loop
    select * into prod from products where id = it.product_id for update;
    newq := prod.quantity + it.qty::int;
    update products set quantity = newq, avg_cost = round((prod.quantity * prod.avg_cost + it.qty * it.unit_cost) / nullif(newq, 0), 4), updated_at = now() where id = prod.id;
    insert into product_stock_moves (product_id, kind, qty, qty_after, employee_id, note) values (prod.id, 'restock', it.qty::int, newq, me, 'استلام مشتريات ' || pu.no);
  end loop;
  perform acc_post_source('purchase', p_id);
  if pu.kind = 'cash' then
    insert into acc_vendor_payments (purchase_id, vendor_id, treasury_id, amount, pay_date, note, idem_key, created_by)
    values (pu.id, pu.vendor_id, pu.treasury_id, pu.total, pu.purchase_date, 'سداد نقدي — ' || pu.no, 'auto-cash:' || pu.id, me) returning * into vp;
    perform acc_post_source('vendor_payment', vp.id);
  end if;
  perform acc_audit_log('اعتماد واستلام فاتورة شراء', 'purchase', p_id::text, jsonb_build_object('no', pu.no, 'total', pu.total));
  return to_jsonb(pu);
end $$;

create or replace function acc_purchase_cancel(p_id uuid, p_reason text) returns jsonb
language plpgsql security definer set search_path = public as $$
declare me uuid; pu acc_purchases; it record; prod products; paid numeric;
begin
  me := acc_require('purchases.manage');
  if btrim(coalesce(p_reason, '')) = '' then raise exception 'سبب الإلغاء مطلوب'; end if;
  select * into pu from acc_purchases where id = p_id for update;
  if pu.id is null then raise exception 'فاتورة الشراء غير موجودة'; end if;
  if pu.status = 'cancelled' then return to_jsonb(pu); end if;
  if pu.status = 'posted' then
    -- السداد النقدي التلقائي يتلغي معاها؛ أي سداد يدوي لازم يتلغى الأول
    select coalesce(sum(amount), 0) into paid from acc_vendor_payments where purchase_id = p_id and status = 'active' and idem_key is distinct from 'auto-cash:' || p_id;
    if paid > 0 then raise exception 'على الفاتورة سداد % — ألغِ سندات السداد أولًا', paid; end if;
    update acc_vendor_payments set status = 'void', void_reason = 'إلغاء فاتورة الشراء', voided_at = now(), voided_by = me where purchase_id = p_id and status = 'active';
    perform acc_post_source('vendor_payment', vp.id) from acc_vendor_payments vp where vp.purchase_id = p_id;
    for it in select * from acc_purchase_items where purchase_id = p_id and product_id is not null loop
      select * into prod from products where id = it.product_id for update;
      if prod.quantity < it.qty::int then raise exception 'لا يمكن الإلغاء: المنتج % بيع أو استُهلك جزء منه (المتاح %)', prod.name, prod.quantity; end if;
      -- متوسط التكلفة: نشيل قيمة الكمية دي بتكلفتها الأصلية (القيمة الحالية = الكمية × المتوسط)
      update products set quantity = quantity - it.qty::int, avg_cost = case when quantity - it.qty::int > 0 then greatest(round((quantity * avg_cost - it.qty * it.unit_cost) / (quantity - it.qty::int), 4), 0) else avg_cost end, updated_at = now() where id = prod.id;
      insert into product_stock_moves (product_id, kind, qty, qty_after, employee_id, note) values (prod.id, 'adjust', -it.qty::int, prod.quantity - it.qty::int, me, 'إلغاء استلام ' || pu.no);
    end loop;
  end if;
  update acc_purchases set status = 'cancelled', cancelled_at = now(), cancelled_by = me, cancel_reason = btrim(p_reason) where id = p_id returning * into pu;
  perform acc_post_source('purchase', p_id);
  perform acc_audit_log('إلغاء فاتورة شراء', 'purchase', p_id::text, jsonb_build_object('no', pu.no, 'reason', p_reason));
  return to_jsonb(pu);
end $$;

create or replace function acc_vendor_payment_save(p jsonb) returns jsonb
language plpgsql security definer set search_path = public as $$
declare me uuid; vp acc_vendor_payments; pu acc_purchases; amt numeric := round(_num(p, 'amount'), 2); key text := nullif(_txt(p, 'key'), ''); paid numeric; vend uuid := _uuid(p, 'vendorId'); t acc_treasuries; bal numeric;
begin
  me := acc_require('purchases.manage');
  if key is not null then select * into vp from acc_vendor_payments where idem_key = key; if vp.id is not null then return to_jsonb(vp); end if; end if;
  if amt <= 0 then raise exception 'مبلغ السداد يجب أن يكون أكبر من صفر'; end if;
  select * into t from acc_treasuries where id = _uuid(p, 'treasuryId') and active for update;
  if t.id is null then raise exception 'اختر الخزنة/الحساب البنكي'; end if;
  if _uuid(p, 'purchaseId') is not null then
    select * into pu from acc_purchases where id = _uuid(p, 'purchaseId') for update;
    if pu.id is null or pu.status <> 'posted' then raise exception 'فاتورة الشراء غير معتمدة'; end if;
    select coalesce(sum(amount), 0) into paid from acc_vendor_payments where purchase_id = pu.id and status = 'active';
    if amt > pu.total - paid then raise exception 'المبلغ أكبر من المتبقي على الفاتورة (%)', pu.total - paid; end if;
    vend := pu.vendor_id;
  end if;
  if vend is null or not exists (select 1 from acc_vendors where id = vend) then raise exception 'المورد غير محدد'; end if;
  bal := acc_treasury_balance(t.id);
  if bal < amt then raise exception 'رصيد % غير كافٍ (المتاح %)', t.name, bal; end if;
  insert into acc_vendor_payments (purchase_id, vendor_id, treasury_id, amount, pay_date, note, attachment_path, idem_key, created_by)
  values (pu.id, vend, t.id, amt, coalesce(acc_d(p, 'date'), riyadh_today()), _txt(p, 'note'), nullif(_txt(p, 'attachment'), ''), key, me) returning * into vp;
  perform acc_post_source('vendor_payment', vp.id);
  perform acc_audit_log('سداد مورد', 'vendor_payment', vp.id::text, jsonb_build_object('no', vp.no, 'amount', amt));
  return to_jsonb(vp);
end $$;

create or replace function acc_vendor_payment_void(p_id uuid, p_reason text) returns jsonb
language plpgsql security definer set search_path = public as $$
declare me uuid; vp acc_vendor_payments;
begin
  me := acc_require('purchases.manage');
  if btrim(coalesce(p_reason, '')) = '' then raise exception 'سبب الإلغاء مطلوب'; end if;
  select * into vp from acc_vendor_payments where id = p_id for update;
  if vp.id is null then raise exception 'سند السداد غير موجود'; end if;
  if vp.status = 'void' then return to_jsonb(vp); end if;
  update acc_vendor_payments set status = 'void', void_reason = btrim(p_reason), voided_at = now(), voided_by = me where id = p_id returning * into vp;
  perform acc_post_source('vendor_payment', p_id);
  perform acc_audit_log('إلغاء سداد مورد', 'vendor_payment', p_id::text, jsonb_build_object('no', vp.no, 'reason', p_reason));
  return to_jsonb(vp);
end $$;

-- ===== استهلاك وجرد المخزون =====
create or replace function acc_stock_consume(p jsonb) returns jsonb
language plpgsql security definer set search_path = public as $$
declare me uuid; pr products; q int := coalesce(nullif(p->>'qty', '')::int, 0); cs acc_stock_consumptions; key text := nullif(_txt(p, 'key'), ''); tot numeric;
begin
  me := acc_require('purchases.manage');
  if key is not null then select * into cs from acc_stock_consumptions where idem_key = key; if cs.id is not null then return to_jsonb(cs); end if; end if;
  if q <= 0 then raise exception 'الكمية المستهلكة يجب أن تكون أكبر من صفر'; end if;
  select * into pr from products where id = _uuid(p, 'productId') for update;
  if pr.id is null then raise exception 'المنتج غير موجود'; end if;
  if pr.quantity < q then raise exception 'الكمية المتاحة من % هي % فقط', pr.name, pr.quantity; end if;
  tot := round(q * pr.avg_cost, 2);
  update products set quantity = quantity - q, updated_at = now() where id = pr.id;
  insert into product_stock_moves (product_id, kind, qty, qty_after, employee_id, note) values (pr.id, 'adjust', -q, pr.quantity - q, me, 'استهلاك — ' || _txt(p, 'note'));
  insert into acc_stock_consumptions (product_id, kind, qty, unit_cost, total, cons_date, note, idem_key, created_by)
  values (pr.id, 'consumption', q, pr.avg_cost, tot, coalesce(acc_d(p, 'date'), riyadh_today()), _txt(p, 'note'), key, me) returning * into cs;
  perform acc_post_source('consumption', cs.id);
  perform acc_audit_log('استهلاك مخزون', 'consumption', cs.id::text, jsonb_build_object('product', pr.name, 'qty', q, 'total', tot));
  return to_jsonb(cs);
end $$;

create or replace function acc_stock_count(p jsonb) returns jsonb
language plpgsql security definer set search_path = public as $$
declare me uuid; pr products; counted int := coalesce(nullif(p->>'counted', '')::int, -1); cs acc_stock_consumptions; key text := nullif(_txt(p, 'key'), ''); df int;
begin
  me := acc_require('purchases.manage');
  if key is not null then select * into cs from acc_stock_consumptions where idem_key = key; if cs.id is not null then return to_jsonb(cs); end if; end if;
  if counted < 0 then raise exception 'الكمية المعدودة غير صحيحة'; end if;
  select * into pr from products where id = _uuid(p, 'productId') for update;
  if pr.id is null then raise exception 'المنتج غير موجود'; end if;
  df := counted - pr.quantity;
  if df = 0 then raise exception 'الجرد مطابق للنظام — لا فرق للتسوية'; end if;
  update products set quantity = counted, updated_at = now() where id = pr.id;
  insert into product_stock_moves (product_id, kind, qty, qty_after, employee_id, note) values (pr.id, 'adjust', df, counted, me, 'تسوية جرد — ' || _txt(p, 'note'));
  insert into acc_stock_consumptions (product_id, kind, qty, unit_cost, total, cons_date, note, idem_key, created_by)
  values (pr.id, 'count', -df, pr.avg_cost, round(-df * pr.avg_cost, 2), coalesce(acc_d(p, 'date'), riyadh_today()), _txt(p, 'note'), key, me) returning * into cs;
  perform acc_post_source('consumption', cs.id);
  perform acc_audit_log('جرد مخزون', 'consumption', cs.id::text, jsonb_build_object('product', pr.name, 'diff', df));
  return to_jsonb(cs);
end $$;

create or replace function acc_consumption_cancel(p_id uuid, p_reason text) returns jsonb
language plpgsql security definer set search_path = public as $$
declare me uuid; cs acc_stock_consumptions; pr products;
begin
  me := acc_require('purchases.manage');
  if btrim(coalesce(p_reason, '')) = '' then raise exception 'سبب الإلغاء مطلوب'; end if;
  select * into cs from acc_stock_consumptions where id = p_id for update;
  if cs.id is null then raise exception 'السجل غير موجود'; end if;
  if cs.status = 'cancelled' then return to_jsonb(cs); end if;
  select * into pr from products where id = cs.product_id for update;
  if pr.quantity + cs.qty < 0 then raise exception 'لا يمكن الإلغاء: الكمية الحالية لا تسمح'; end if;
  update products set quantity = quantity + cs.qty, updated_at = now() where id = pr.id;
  insert into product_stock_moves (product_id, kind, qty, qty_after, employee_id, note) values (pr.id, 'adjust', cs.qty, pr.quantity + cs.qty, me, 'إلغاء استهلاك/جرد');
  update acc_stock_consumptions set status = 'cancelled', cancel_reason = btrim(p_reason), cancelled_at = now() where id = p_id returning * into cs;
  perform acc_post_source('consumption', p_id);
  perform acc_audit_log('إلغاء استهلاك/جرد', 'consumption', p_id::text, jsonb_build_object('reason', p_reason));
  return to_jsonb(cs);
end $$;

-- ===== السلف والخصومات (تحتاج accounting.payroll.manage) =====
create or replace function acc_advance_save(p jsonb) returns jsonb
language plpgsql security definer set search_path = public as $$
declare me uuid; av acc_advances; amt numeric := round(_num(p, 'amount'), 2); key text := nullif(_txt(p, 'key'), ''); nm text; t acc_treasuries; bal numeric;
begin
  me := acc_require('payroll.manage');
  if key is not null then select * into av from acc_advances where idem_key = key; if av.id is not null then return to_jsonb(av); end if; end if;
  if amt <= 0 then raise exception 'مبلغ السلفة يجب أن يكون أكبر من صفر'; end if;
  if _uuid(p, 'employeeId') is not null then select name into nm from employees where id = _uuid(p, 'employeeId');
  elsif _uuid(p, 'therapistId') is not null then select name into nm from therapists where id = _uuid(p, 'therapistId'); end if;
  if nm is null then raise exception 'اختر الموظف أو الأخصائي'; end if;
  select * into t from acc_treasuries where id = _uuid(p, 'treasuryId') and active for update;
  if t.id is null then raise exception 'اختر الخزنة/الحساب البنكي'; end if;
  bal := acc_treasury_balance(t.id);
  if bal < amt then raise exception 'رصيد % غير كافٍ (المتاح %)', t.name, bal; end if;
  insert into acc_advances (employee_id, therapist_id, person_name, amount, advance_date, treasury_id, note, idem_key, created_by)
  values (_uuid(p, 'employeeId'), _uuid(p, 'therapistId'), nm, amt, coalesce(acc_d(p, 'date'), riyadh_today()), t.id, _txt(p, 'note'), key, me) returning * into av;
  perform acc_post_source('advance', av.id);
  perform acc_audit_log('سلفة موظف', 'advance', av.id::text, jsonb_build_object('no', av.no, 'amount', amt));
  return to_jsonb(av);
end $$;

create or replace function acc_advance_recover(p jsonb) returns jsonb
language plpgsql security definer set search_path = public as $$
declare me uuid; av acc_advances; rc acc_advance_recoveries; amt numeric := round(_num(p, 'amount'), 2); key text := nullif(_txt(p, 'key'), ''); rec numeric; m text := _txt(p, 'method', 'payroll_deduction');
begin
  me := acc_require('payroll.manage');
  if key is not null then select * into rc from acc_advance_recoveries where idem_key = key; if rc.id is not null then return to_jsonb(rc); end if; end if;
  select * into av from acc_advances where id = _uuid(p, 'advanceId') for update;
  if av.id is null or av.status <> 'open' then raise exception 'السلفة غير مفتوحة'; end if;
  if m not in ('payroll_deduction', 'cash') then raise exception 'طريقة الاسترداد غير صحيحة'; end if;
  if m = 'cash' and not exists (select 1 from acc_treasuries where id = _uuid(p, 'treasuryId') and active) then raise exception 'الاسترداد النقدي يحتاج خزنة'; end if;
  select coalesce(sum(amount), 0) into rec from acc_advance_recoveries where advance_id = av.id and status = 'active';
  if amt <= 0 or amt > av.amount - rec then raise exception 'المبلغ غير صحيح — المتبقي من السلفة %', av.amount - rec; end if;
  insert into acc_advance_recoveries (advance_id, amount, rec_date, method, treasury_id, idem_key, note, created_by)
  values (av.id, amt, coalesce(acc_d(p, 'date'), riyadh_today()), m, case when m = 'cash' then _uuid(p, 'treasuryId') end, key, _txt(p, 'note'), me) returning * into rc;
  perform acc_post_source('advance_recovery', rc.id);
  if amt = av.amount - rec then update acc_advances set status = 'closed' where id = av.id; end if;
  perform acc_audit_log('استرداد/خصم سلفة', 'advance_recovery', rc.id::text, jsonb_build_object('advance', av.no, 'amount', amt, 'method', m));
  return to_jsonb(rc);
end $$;

create or replace function acc_advance_cancel(p_id uuid, p_reason text) returns jsonb
language plpgsql security definer set search_path = public as $$
declare av acc_advances;
begin
  perform acc_require('payroll.manage');
  if btrim(coalesce(p_reason, '')) = '' then raise exception 'سبب الإلغاء مطلوب'; end if;
  select * into av from acc_advances where id = p_id for update;
  if av.id is null then raise exception 'السلفة غير موجودة'; end if;
  if av.status = 'cancelled' then return to_jsonb(av); end if;
  if exists (select 1 from acc_advance_recoveries where advance_id = p_id and status = 'active') then raise exception 'عليها استردادات — ألغِها أولًا'; end if;
  update acc_advances set status = 'cancelled', cancel_reason = btrim(p_reason) where id = p_id returning * into av;
  perform acc_post_source('advance', p_id);
  perform acc_audit_log('إلغاء سلفة', 'advance', p_id::text, jsonb_build_object('no', av.no));
  return to_jsonb(av);
end $$;

-- ===== الأصول الثابتة والإهلاك =====
create or replace function acc_asset_save(p jsonb) returns jsonb
language plpgsql security definer set search_path = public as $$
declare me uuid; fa acc_assets; key text := nullif(_txt(p, 'key'), ''); f text := coalesce(nullif(_txt(p, 'funding'), ''), 'treasury'); cost numeric := round(_num(p, 'cost'), 2); pd date := coalesce(acc_d(p, 'purchaseDate'), riyadh_today());
begin
  me := acc_require('journals.create');
  if key is not null then select * into fa from acc_assets where idem_key = key; if fa.id is not null then return to_jsonb(fa); end if; end if;
  if btrim(_txt(p, 'name')) = '' then raise exception 'اسم الأصل مطلوب'; end if;
  if f = 'treasury' and not exists (select 1 from acc_treasuries where id = _uuid(p, 'treasuryId') and active) then raise exception 'اختر الخزنة المدفوع منها'; end if;
  if f = 'payable' and not exists (select 1 from acc_vendors where id = _uuid(p, 'vendorId')) then raise exception 'اختر المورد'; end if;
  insert into acc_assets (name, category, cost, salvage, life_months, purchase_date, dep_start, funding, treasury_id, vendor_id, note, idem_key, created_by)
  values (btrim(_txt(p, 'name')), _txt(p, 'category'), cost, round(_num(p, 'salvage'), 2), coalesce(nullif(p->>'lifeMonths', '')::int, 60), pd, coalesce(acc_d(p, 'depStart'), pd), f,
    case when f = 'treasury' then _uuid(p, 'treasuryId') end, case when f = 'payable' then _uuid(p, 'vendorId') end, _txt(p, 'note'), key, me) returning * into fa;
  perform acc_post_source('asset', fa.id);
  perform acc_audit_log('إضافة أصل ثابت', 'asset', fa.id::text, jsonb_build_object('code', fa.code, 'cost', cost));
  return to_jsonb(fa);
end $$;

create or replace function acc_asset_cancel(p_id uuid, p_reason text) returns jsonb
language plpgsql security definer set search_path = public as $$
declare fa acc_assets;
begin
  perform acc_require('journals.post');
  if btrim(coalesce(p_reason, '')) = '' then raise exception 'سبب الإلغاء مطلوب'; end if;
  select * into fa from acc_assets where id = p_id for update;
  if fa.id is null then raise exception 'الأصل غير موجود'; end if;
  if exists (select 1 from acc_depreciation where asset_id = p_id) then raise exception 'على الأصل إهلاك مُرحَّل — لا يمكن إلغاؤه'; end if;
  update acc_assets set status = 'cancelled' where id = p_id returning * into fa;
  perform acc_post_source('asset', p_id);
  perform acc_audit_log('إلغاء أصل ثابت', 'asset', p_id::text, jsonb_build_object('code', fa.code, 'reason', p_reason));
  return to_jsonb(fa);
end $$;

create or replace function acc_run_depreciation(p_month text) returns jsonb
language plpgsql security definer set search_path = public as $$
declare me uuid; r record; mend date; n int; jid uuid; sid uuid; lines jsonb := '[]'::jsonb; tot numeric := 0; cnt int := 0; run_no int; acc numeric; amt numeric;
begin
  me := acc_require('journals.post');
  if p_month !~ '^[0-9]{4}-(0[1-9]|1[0-2])$' then raise exception 'الشهر بصيغة YYYY-MM'; end if;
  if p_month > to_char(riyadh_today(), 'YYYY-MM') then raise exception 'لا إهلاك لشهر لم يبدأ'; end if;
  mend := least(((p_month || '-01')::date + interval '1 month' - interval '1 day')::date, riyadh_today());
  perform pg_advisory_xact_lock(hashtextextended('dep:' || p_month, 0));
  create temp table if not exists _dep_new (asset_id uuid, amount numeric) on commit drop;
  delete from _dep_new where true;
  for r in select * from acc_assets where status = 'active' and date_trunc('month', dep_start) <= (p_month || '-01')::date order by code loop
    continue when exists (select 1 from acc_depreciation where asset_id = r.id and month = p_month);
    select coalesce(sum(amount), 0) into acc from acc_depreciation where asset_id = r.id;
    amt := least(round((r.cost - r.salvage) / r.life_months, 2), r.cost - r.salvage - acc);
    continue when amt <= 0;
    if (select count(*) from acc_depreciation where asset_id = r.id) < ((substr(p_month,1,4)::int - extract(year from r.dep_start)::int) * 12 + (substr(p_month,6,2)::int - extract(month from r.dep_start)::int)) then
      raise exception 'الأصل %: شغّل الإهلاك للشهور السابقة أولًا', r.code; end if;
    insert into _dep_new values (r.id, amt); tot := tot + amt; cnt := cnt + 1;
  end loop;
  if cnt = 0 then return jsonb_build_object('created', 0, 'total', 0); end if;
  select count(*) + 1 into run_no from acc_journals where source_type = 'depreciation' and description like '%' || p_month || '%';
  sid := md5('dep:' || p_month || ':' || run_no)::uuid;
  jid := acc_create_journal(mend, 'إهلاك الأصول الثابتة عن شهر ' || p_month, 'depreciation', sid, 'v1', p_month,
    jsonb_build_array(jsonb_build_object('account', 'deprec_exp', 'debit', tot), jsonb_build_object('account', 'accum_deprec', 'credit', tot)), true, null, null, null, null, me);
  insert into acc_depreciation (asset_id, month, amount, journal_id) select asset_id, p_month, amount, jid from _dep_new;
  perform acc_audit_log('تشغيل الإهلاك', 'depreciation', p_month, jsonb_build_object('assets', cnt, 'total', tot));
  return jsonb_build_object('created', cnt, 'total', tot, 'journalId', jid);
end $$;

-- ===== الموازنات =====
create or replace function acc_budget_save(p jsonb) returns int
language plpgsql security definer set search_path = public as $$
declare me uuid; r jsonb; n int := 0;
begin
  me := acc_require('settings.manage');
  for r in select * from jsonb_array_elements(coalesce(p->'rows', '[]'::jsonb)) loop
    if (r->>'period') !~ '^[0-9]{4}-(0[1-9]|1[0-2])$' or coalesce(nullif(r->>'amount', '')::numeric, -1) < 0 then raise exception 'بيانات موازنة غير صحيحة'; end if;
    insert into acc_budgets (period, account_id, cost_center_id, amount, updated_by)
    values (r->>'period', (r->>'accountId')::uuid, nullif(r->>'costCenterId', '')::uuid, (r->>'amount')::numeric, me)
    on conflict (period, account_id, (coalesce(cost_center_id, '00000000-0000-0000-0000-000000000000'::uuid)))
    do update set amount = excluded.amount, updated_by = me, updated_at = now();
    n := n + 1;
  end loop;
  perform acc_audit_log('حفظ موازنة', 'budget', null, jsonb_build_object('rows', n));
  return n;
end $$;

-- ===== الفترات =====
create or replace function acc_period_close(p_month text, p_note text default '') returns jsonb
language plpgsql security definer set search_path = public as $$
declare me uuid; drafts int; errs int; pend int;
begin
  me := acc_require('periods.close');
  if p_month !~ '^[0-9]{4}-(0[1-9]|1[0-2])$' then raise exception 'الشهر بصيغة YYYY-MM'; end if;
  if p_month >= to_char(riyadh_today(), 'YYYY-MM') then raise exception 'لا يمكن إقفال الشهر الحالي أو القادم'; end if;
  select count(*) into drafts from acc_journals where status = 'draft' and to_char(entry_date, 'YYYY-MM') = p_month;
  if drafts > 0 then raise exception 'يوجد % قيد/قيود مسودة في هذا الشهر — رحّلها أو احذفها أولًا', drafts; end if;
  select count(*) into errs from acc_posting_errors where resolved_at is null;
  select count(*) into pend from acc_pending_docs();
  if errs > 0 or pend > 0 then raise exception 'يوجد % مستند لم يُرحَّل و% خطأ ترحيل مفتوح — شغّل «مزامنة المستندات» أولًا', pend, errs; end if;
  insert into acc_periods (month, status, closed_at, closed_by, note) values (p_month, 'closed', now(), me, coalesce(p_note, ''))
  on conflict (month) do update set status = 'closed', closed_at = now(), closed_by = me, note = coalesce(p_note, '');
  perform acc_audit_log('إقفال فترة', 'period', p_month, jsonb_build_object('note', p_note));
  return jsonb_build_object('month', p_month, 'status', 'closed');
end $$;

create or replace function acc_period_reopen(p_month text, p_reason text) returns jsonb
language plpgsql security definer set search_path = public as $$
declare me uuid;
begin
  me := acc_require('periods.close');
  if btrim(coalesce(p_reason, '')) = '' then raise exception 'سبب إعادة الفتح مطلوب'; end if;
  update acc_periods set status = 'open', reopened_at = now(), reopened_by = me, note = btrim(p_reason) where month = p_month and status = 'closed';
  if not found then raise exception 'الشهر غير مقفول'; end if;
  perform acc_audit_log('إعادة فتح فترة', 'period', p_month, jsonb_build_object('reason', p_reason));
  return jsonb_build_object('month', p_month, 'status', 'open');
end $$;

-- ===== المزامنة وإعادة المحاولة =====
create or replace function acc_sync_pending() returns jsonb
language plpgsql security definer set search_path = public as $$
declare r jsonb;
begin
  perform acc_require('journals.post');
  r := acc_sync_pending_internal(1000);
  perform acc_audit_log('مزامنة المستندات', 'sync', null, r);
  return r;
end $$;
