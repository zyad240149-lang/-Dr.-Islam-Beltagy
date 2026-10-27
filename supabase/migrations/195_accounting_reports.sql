-- النظام المحاسبي — التقارير. كلها مبنية على القيود المرحّلة فقط (acc_posted_lines) وبصلاحية accounting.reports.view.
-- كل رقم قابل للتتبع: أي سطر يرجع لرقم القيد (journal_id/no) والمستند المصدر (source_type/source_id/source_no).

create or replace function acc_trial_balance(p_from date, p_to date) returns jsonb
language plpgsql security definer set search_path = public as $$
declare r jsonb;
begin
  perform acc_require('reports.view');
  with b as (
    select a.id, a.code, a.name, a.type,
      coalesce(sum(l.debit - l.credit) filter (where l.entry_date < p_from), 0) as opening,
      coalesce(sum(l.debit) filter (where l.entry_date between p_from and p_to), 0) as debit,
      coalesce(sum(l.credit) filter (where l.entry_date between p_from and p_to), 0) as credit
    from acc_accounts a left join acc_posted_lines l on l.account_id = a.id and l.entry_date <= p_to
    where a.postable group by a.id
  ), c as (
    select *, opening + debit - credit as closing from b where opening <> 0 or debit <> 0 or credit <> 0
  )
  select jsonb_build_object(
    'rows', coalesce((select jsonb_agg(jsonb_build_object('id', id, 'code', code, 'name', name, 'type', type,
        'openingDebit', greatest(opening, 0), 'openingCredit', greatest(-opening, 0), 'debit', debit, 'credit', credit,
        'closingDebit', greatest(closing, 0), 'closingCredit', greatest(-closing, 0)) order by code) from c), '[]'::jsonb),
    'totals', (select jsonb_build_object('openingDebit', coalesce(sum(greatest(opening, 0)), 0), 'openingCredit', coalesce(sum(greatest(-opening, 0)), 0),
        'debit', coalesce(sum(debit), 0), 'credit', coalesce(sum(credit), 0),
        'closingDebit', coalesce(sum(greatest(closing, 0)), 0), 'closingCredit', coalesce(sum(greatest(-closing, 0)), 0)) from c)) into r;
  return r || jsonb_build_object('balanced', (r->'totals'->>'debit')::numeric = (r->'totals'->>'credit')::numeric
    and (r->'totals'->>'closingDebit')::numeric = (r->'totals'->>'closingCredit')::numeric);
end $$;

create or replace function acc_ledger(p_account uuid, p_from date, p_to date) returns jsonb
language plpgsql security definer set search_path = public as $$
declare opening numeric; rows jsonb; acc acc_accounts;
begin
  perform acc_require('reports.view');
  select * into acc from acc_accounts where id = p_account;
  if acc.id is null then raise exception 'الحساب غير موجود'; end if;
  select coalesce(sum(debit - credit), 0) into opening from acc_posted_lines where account_id = p_account and entry_date < p_from;
  select coalesce(jsonb_agg(jsonb_build_object('lineId', id, 'journalId', journal_id, 'no', journal_no, 'date', entry_date,
      'description', case when acc_can_see_source(source_type) then journal_desc else 'قيد رواتب (مخفي)' end,
      'memo', case when acc_can_see_source(source_type) then memo end,
      'sourceType', source_type, 'sourceId', source_id, 'debit', debit, 'credit', credit,
      'balance', opening + run, 'reconciled', reconciled_at is not null) order by entry_date, posted_at, line_no), '[]'::jsonb) into rows
  from (select l.*, sum(l.debit - l.credit) over (order by l.entry_date, l.posted_at, l.line_no, l.id) as run
        from acc_posted_lines l where l.account_id = p_account and l.entry_date between p_from and p_to limit 3000) s;
  return jsonb_build_object('account', jsonb_build_object('id', acc.id, 'code', acc.code, 'name', acc.name, 'type', acc.type),
    'opening', opening, 'rows', rows,
    'closing', opening + (select coalesce(sum(debit - credit), 0) from acc_posted_lines where account_id = p_account and entry_date between p_from and p_to));
end $$;

create or replace function acc_income_statement(p_from date, p_to date, p_cc uuid default null) returns jsonb
language plpgsql security definer set search_path = public as $$
declare rev jsonb; cogs jsonb; opx jsonb; tr numeric; tc numeric; to_ numeric;
begin
  perform acc_require('reports.view');
  create temp table if not exists _is_tmp (code text, name text, type text, amount numeric, sect text) on commit drop;
  delete from _is_tmp where true;
  insert into _is_tmp
  select a.code, a.name, a.type, case when a.type = 'revenue' then sum(l.credit - l.debit) else sum(l.debit - l.credit) end,
    case when a.type = 'revenue' then 'rev' when a.code like '5%' then 'cogs' else 'opex' end
  from acc_accounts a join acc_posted_lines l on l.account_id = a.id
  where a.type in ('revenue', 'expense') and l.entry_date between p_from and p_to and (p_cc is null or l.cost_center_id = p_cc)
  group by a.id having sum(l.credit - l.debit) <> 0;
  select coalesce(jsonb_agg(jsonb_build_object('code', code, 'name', name, 'amount', amount) order by code) filter (where sect = 'rev'), '[]'::jsonb),
         coalesce(jsonb_agg(jsonb_build_object('code', code, 'name', name, 'amount', amount) order by code) filter (where sect = 'cogs'), '[]'::jsonb),
         coalesce(jsonb_agg(jsonb_build_object('code', code, 'name', name, 'amount', amount) order by code) filter (where sect = 'opex'), '[]'::jsonb),
         coalesce(sum(amount) filter (where sect = 'rev'), 0), coalesce(sum(amount) filter (where sect = 'cogs'), 0), coalesce(sum(amount) filter (where sect = 'opex'), 0)
  into rev, cogs, opx, tr, tc, to_ from _is_tmp;
  return jsonb_build_object('revenue', rev, 'cogs', cogs, 'opex', opx, 'totalRevenue', tr, 'totalCogs', tc, 'grossProfit', tr - tc, 'totalOpex', to_, 'netIncome', tr - tc - to_);
end $$;

create or replace function acc_balance_sheet(p_asof date) returns jsonb
language plpgsql security definer set search_path = public as $$
declare assets jsonb; liab jsonb; eq jsonb; ta numeric; tl numeric; te numeric; earn numeric;
begin
  perform acc_require('reports.view');
  create temp table if not exists _bs_tmp (code text, name text, type text, amount numeric) on commit drop;
  delete from _bs_tmp where true;
  insert into _bs_tmp
  select a.code, a.name, a.type, case when a.type = 'asset' then sum(l.debit - l.credit) else sum(l.credit - l.debit) end
  from acc_accounts a join acc_posted_lines l on l.account_id = a.id
  where a.type in ('asset', 'liability', 'equity') and l.entry_date <= p_asof group by a.id having sum(l.debit - l.credit) <> 0;
  select coalesce(sum(case when a.type = 'revenue' then l.credit - l.debit else -(l.debit - l.credit) end), 0) into earn
  from acc_accounts a join acc_posted_lines l on l.account_id = a.id where a.type in ('revenue', 'expense') and l.entry_date <= p_asof;
  select coalesce(jsonb_agg(jsonb_build_object('code', code, 'name', name, 'amount', amount) order by code) filter (where type = 'asset'), '[]'::jsonb),
         coalesce(jsonb_agg(jsonb_build_object('code', code, 'name', name, 'amount', amount) order by code) filter (where type = 'liability'), '[]'::jsonb),
         coalesce(jsonb_agg(jsonb_build_object('code', code, 'name', name, 'amount', amount) order by code) filter (where type = 'equity'), '[]'::jsonb),
         coalesce(sum(amount) filter (where type = 'asset'), 0), coalesce(sum(amount) filter (where type = 'liability'), 0), coalesce(sum(amount) filter (where type = 'equity'), 0)
  into assets, liab, eq, ta, tl, te from _bs_tmp;
  return jsonb_build_object('assets', assets, 'liabilities', liab, 'equity', eq, 'currentEarnings', earn,
    'totalAssets', ta, 'totalLiabilities', tl, 'totalEquity', te + earn, 'difference', ta - (tl + te + earn), 'balanced', ta = tl + te + earn);
end $$;

create or replace function acc_cash_flow(p_from date, p_to date) returns jsonb
language plpgsql security definer set search_path = public as $$
declare opening numeric; closing numeric; rows jsonb;
begin
  perform acc_require('reports.view');
  select coalesce(sum(l.debit - l.credit), 0) into opening from acc_posted_lines l join acc_treasuries t on t.account_id = l.account_id where l.entry_date < p_from;
  select coalesce(sum(l.debit - l.credit), 0) into closing from acc_posted_lines l join acc_treasuries t on t.account_id = l.account_id where l.entry_date <= p_to;
  select coalesce(jsonb_agg(jsonb_build_object('class', cls, 'inflow', inflow, 'outflow', outflow, 'net', inflow - outflow) order by cls), '[]'::jsonb) into rows
  from (select case when l.source_type in ('payment', 'product_sale') then '1-تشغيلي: تحصيلات المرضى والمبيعات'
                    when l.source_type in ('expense', 'vendor_payment') then '2-تشغيلي: مصروفات وموردون'
                    when l.source_type in ('payroll_payout', 'advance', 'advance_recovery') then '3-تشغيلي: رواتب وسلف'
                    when l.source_type = 'asset' then '4-استثماري: أصول ثابتة'
                    when l.source_type = 'opening' then '5-تمويلي/افتتاحي: أرصدة افتتاحية'
                    when l.source_type = 'transfer' then '6-تحويلات داخلية (صافيها صفر)'
                    else '7-أخرى (قيود يدوية وتسويات جرد)' end cls,
          sum(l.debit) inflow, sum(l.credit) outflow
        from acc_posted_lines l join acc_treasuries t on t.account_id = l.account_id where l.entry_date between p_from and p_to group by 1) s;
  return jsonb_build_object('opening', opening, 'closing', closing, 'rows', rows,
    'net', (select coalesce(sum((x->>'net')::numeric), 0) from jsonb_array_elements(rows) x), 'check', closing - opening - (select coalesce(sum((x->>'net')::numeric), 0) from jsonb_array_elements(rows) x));
end $$;

-- قائمة القيود (مع الفلاتر) — القيود الخاصة بالرواتب لا يراها إلا من له accounting.payroll.view
create or replace function acc_journal_list(p jsonb) returns jsonb
language plpgsql security definer set search_path = public as $$
declare lim int := least(coalesce(nullif(p->>'limit', '')::int, 100), 500); off int := coalesce(nullif(p->>'offset', '')::int, 0); q text := nullif(btrim(coalesce(p->>'q', '')), ''); rows jsonb; cnt int;
begin
  perform acc_require('access');
  create temp table if not exists _jl (id uuid) on commit drop;
  delete from _jl where true;
  insert into _jl select j.id from acc_journals j
  where acc_can_see_source(j.source_type)
    and (nullif(p->>'from', '') is null or j.entry_date >= (p->>'from')::date) and (nullif(p->>'to', '') is null or j.entry_date <= (p->>'to')::date)
    and (nullif(p->>'sourceType', '') is null or j.source_type = p->>'sourceType') and (nullif(p->>'status', '') is null or j.status = p->>'status')
    and (nullif(p->>'account', '') is null or exists (select 1 from acc_journal_lines l where l.journal_id = j.id and l.account_id = (p->>'account')::uuid))
    and (nullif(p->>'user', '') is null or j.created_by = (p->>'user')::uuid or j.posted_by = (p->>'user')::uuid)
    and (q is null or j.no ilike '%' || q || '%' or j.description ilike '%' || q || '%' or coalesce(j.source_no, '') ilike '%' || q || '%');
  select count(*) into cnt from _jl;
  select coalesce(jsonb_agg(x order by (x->>'date') desc, (x->>'no') desc), '[]'::jsonb) into rows from (
    select jsonb_build_object('id', j.id, 'no', j.no, 'date', j.entry_date, 'description', j.description, 'status', j.status, 'sourceType', j.source_type,
      'sourceId', j.source_id, 'sourceNo', j.source_no, 'total', case when j.status = 'posted' then j.total else (select coalesce(sum(debit), 0) from acc_journal_lines where journal_id = j.id) end,
      'reversed', j.reversed_by is not null, 'isReversal', j.reversal_of is not null, 'createdBy', (select name from employees where id = j.created_by),
      'postedBy', (select name from employees where id = j.posted_by), 'attachment', j.attachment_path) x
    from acc_journals j join _jl on _jl.id = j.id order by j.entry_date desc, j.no desc limit lim offset off) s;
  return jsonb_build_object('total', cnt, 'rows', rows);
end $$;

create or replace function acc_journal_detail(p_id uuid) returns jsonb
language plpgsql security definer set search_path = public as $$
declare j acc_journals;
begin
  perform acc_require('access');
  select * into j from acc_journals where id = p_id;
  if j.id is null or not acc_can_see_source(j.source_type) then raise exception 'القيد غير موجود أو لا تملك صلاحية عرضه' using errcode = '42501'; end if;
  return jsonb_build_object('id', j.id, 'no', j.no, 'date', j.entry_date, 'postedAt', j.posted_at, 'description', j.description, 'status', j.status, 'sourceType', j.source_type,
    'sourceId', j.source_id, 'sourceNo', j.source_no, 'currency', j.currency, 'total', j.total, 'reversalOf', (select no from acc_journals where id = j.reversal_of),
    'reversedBy', (select no from acc_journals where id = j.reversed_by), 'attachment', j.attachment_path,
    'createdBy', (select name from employees where id = j.created_by), 'approvedBy', (select name from employees where id = j.approved_by), 'postedBy', (select name from employees where id = j.posted_by),
    'createdAt', j.created_at,
    'lines', coalesce((select jsonb_agg(jsonb_build_object('id', l.id, 'no', l.line_no, 'accountId', a.id, 'code', a.code, 'account', a.name, 'debit', l.debit, 'credit', l.credit, 'memo', l.memo,
        'costCenter', (select name from acc_cost_centers where id = l.cost_center_id), 'partyType', l.party_type, 'partyId', l.party_id,
        'party', case l.party_type when 'patient' then (select full_name from patients where id = l.party_id) when 'vendor' then (select name from acc_vendors where id = l.party_id) end,
        'reconciled', l.reconciled_at is not null) order by l.line_no)
      from acc_journal_lines l join acc_accounts a on a.id = l.account_id where l.journal_id = j.id), '[]'::jsonb));
end $$;

create or replace function acc_receivables(p_asof date default null) returns jsonb
language plpgsql security definer set search_path = public as $$
declare d date := coalesce(p_asof, riyadh_today()); inv jsonb; pat jsonb; ins jsonb; gl numeric; sm numeric;
begin
  perform acc_require('reports.view');
  select coalesce(jsonb_agg(jsonb_build_object('invoiceId', i.id, 'no', i.no, 'date', i.date, 'patientId', i.patient_id, 'patient', p.full_name, 'fileNo', p.file_no, 'total', i.total, 'paid', i.paid, 'remaining', i.remaining,
      'status', i.status, 'ageDays', d - i.date, 'bucket', case when d - i.date <= 30 then '0-30' when d - i.date <= 60 then '31-60' when d - i.date <= 90 then '61-90' else '90+' end) order by i.date), '[]'::jsonb)
  into inv from invoices i join patients p on p.id = i.patient_id where i.status in ('due', 'partial') and i.remaining > 0;
  select coalesce(jsonb_agg(jsonb_build_object('patientId', patient_id, 'patient', patient, 'fileNo', file_no, 'remaining', rem, 'invoices', n) order by rem desc), '[]'::jsonb) into pat
  from (select i.patient_id, p.full_name patient, p.file_no, sum(i.remaining) rem, count(*) n from invoices i join patients p on p.id = i.patient_id where i.status in ('due', 'partial') and i.remaining > 0 group by 1, 2, 3) s;
  select coalesce(jsonb_agg(jsonb_build_object('invoiceId', r.invoice_id, 'no', i.no, 'patient', p.full_name, 'total', r.total, 'firstAmount', r.first_amount, 'secondAmount', r.second_amount,
      'firstDue', r.first_due_date, 'secondDue', r.second_due_date, 'paid', i.paid, 'remaining', i.remaining, 'status', r.status) order by coalesce(r.first_due_date, i.date)), '[]'::jsonb) into ins
  from package_installment_requests r join invoices i on i.id = r.invoice_id join patients p on p.id = r.patient_id where r.status not in ('rejected', 'cancelled') and i.remaining > 0;
  select coalesce(sum(debit - credit), 0) into gl from acc_posted_lines where account_id = acc_account_id('ar');
  select coalesce(sum(remaining), 0) into sm from invoices where status in ('due', 'partial');
  return jsonb_build_object('invoices', inv, 'patients', pat, 'installments', ins, 'glBalance', gl, 'operationalBalance', sm, 'difference', gl - sm);
end $$;

create or replace function acc_payables(p_asof date default null) returns jsonb
language plpgsql security definer set search_path = public as $$
declare d date := coalesce(p_asof, riyadh_today()); vend jsonb; pur jsonb; gl numeric;
begin
  perform acc_require('reports.view');
  select coalesce(jsonb_agg(jsonb_build_object('vendorId', v.id, 'vendor', v.name, 'balance', b) order by b desc), '[]'::jsonb) into vend
  from acc_vendors v join (select party_id, sum(credit - debit) b from acc_posted_lines where account_id = acc_account_id('ap') and party_type = 'vendor' group by 1 having sum(credit - debit) <> 0) s on s.party_id = v.id;
  select coalesce(jsonb_agg(jsonb_build_object('id', p.id, 'no', p.no, 'vendor', v.name, 'vendorId', v.id, 'date', p.purchase_date, 'dueDate', p.due_date, 'total', p.total,
      'paid', coalesce(pay.paid, 0), 'remaining', p.total - coalesce(pay.paid, 0), 'overdue', p.due_date is not null and p.due_date < d) order by p.purchase_date), '[]'::jsonb) into pur
  from acc_purchases p join acc_vendors v on v.id = p.vendor_id
  left join (select purchase_id, sum(amount) paid from acc_vendor_payments where status = 'active' group by 1) pay on pay.purchase_id = p.id
  where p.status = 'posted' and p.total - coalesce(pay.paid, 0) > 0;
  select coalesce(sum(credit - debit), 0) into gl from acc_posted_lines where account_id = acc_account_id('ap');
  return jsonb_build_object('vendors', vend, 'purchases', pur, 'glBalance', gl);
end $$;

create or replace function acc_profitability(p_from date, p_to date, p_by text default 'therapist') returns jsonb
language plpgsql security definer set search_path = public as $$
begin
  perform acc_require('reports.view');
  return jsonb_build_object('by', p_by, 'rows', coalesce((
    select jsonb_agg(jsonb_build_object('key', k, 'name', nm, 'revenue', rev, 'documents', n) order by rev desc)
    from (select case when p_by = 'service' then coalesce(l.service_name, '—') else coalesce(l.therapist_id::text, '—') end k,
            case when p_by = 'service' then coalesce(l.service_name, 'غير محدد') else coalesce((select name from therapists where id = l.therapist_id), 'غير منسوب لأخصائي') end nm,
            sum(l.credit - l.debit) rev, count(distinct l.journal_id) n
          from acc_posted_lines l join acc_accounts a on a.id = l.account_id
          where a.type = 'revenue' and l.entry_date between p_from and p_to group by 1, 2 having sum(l.credit - l.debit) <> 0) s), '[]'::jsonb));
end $$;

create or replace function acc_budget_vs_actual(p_from text, p_to text, p_cc uuid default null) returns jsonb
language plpgsql security definer set search_path = public as $$
declare d1 date := (p_from || '-01')::date; d2 date := ((p_to || '-01')::date + interval '1 month' - interval '1 day')::date;
begin
  perform acc_require('reports.view');
  return jsonb_build_object('rows', coalesce((
    select jsonb_agg(jsonb_build_object('code', a.code, 'name', a.name, 'type', a.type, 'budget', coalesce(b.amt, 0), 'actual', coalesce(x.amt, 0),
        'variance', case when a.type = 'revenue' then coalesce(x.amt, 0) - coalesce(b.amt, 0) else coalesce(b.amt, 0) - coalesce(x.amt, 0) end,
        'pct', case when coalesce(b.amt, 0) > 0 then round(coalesce(x.amt, 0) / b.amt * 100, 1) end) order by a.code)
    from acc_accounts a
    left join (select account_id, sum(amount) amt from acc_budgets where period between p_from and p_to and (p_cc is null or cost_center_id = p_cc) group by 1) b on b.account_id = a.id
    left join (select l.account_id, sum(case when ac.type = 'revenue' then l.credit - l.debit else l.debit - l.credit end) amt
               from acc_posted_lines l join acc_accounts ac on ac.id = l.account_id where ac.type in ('revenue', 'expense') and l.entry_date between d1 and d2 and (p_cc is null or l.cost_center_id = p_cc) group by 1) x on x.account_id = a.id
    where a.type in ('revenue', 'expense') and a.postable and (b.amt is not null or x.amt is not null)), '[]'::jsonb));
end $$;

create or replace function acc_vat_report(p_from date, p_to date) returns jsonb
language plpgsql security definer set search_path = public as $$
declare o numeric; i numeric;
begin
  perform acc_require('reports.view');
  select coalesce(sum(credit - debit), 0) into o from acc_posted_lines where account_id = acc_account_id('vat_out') and entry_date between p_from and p_to;
  select coalesce(sum(debit - credit), 0) into i from acc_posted_lines where account_id = acc_account_id('vat_in') and entry_date between p_from and p_to;
  return jsonb_build_object('outputVat', o, 'inputVat', i, 'netPayable', o - i, 'months', coalesce((
    select jsonb_agg(jsonb_build_object('month', m, 'output', op, 'input', ip) order by m) from (
      select to_char(entry_date, 'YYYY-MM') m, sum(case when account_id = acc_account_id('vat_out') then credit - debit else 0 end) op, sum(case when account_id = acc_account_id('vat_in') then debit - credit else 0 end) ip
      from acc_posted_lines where account_id in (acc_account_id('vat_out'), acc_account_id('vat_in')) and entry_date between p_from and p_to group by 1) s), '[]'::jsonb));
end $$;

create or replace function acc_inventory_report() returns jsonb
language plpgsql security definer set search_path = public as $$
declare gl numeric; tot numeric;
begin
  perform acc_require('reports.view');
  select coalesce(sum(debit - credit), 0) into gl from acc_posted_lines where account_id = acc_account_id('inventory');
  select coalesce(sum(quantity * avg_cost), 0) into tot from products;
  return jsonb_build_object('glBalance', gl, 'stockValue', round(tot, 2), 'difference', round(gl - tot, 2), 'rows', coalesce((
    select jsonb_agg(jsonb_build_object('id', id, 'sku', sku, 'name', name, 'category', category, 'quantity', quantity, 'avgCost', avg_cost, 'value', round(quantity * avg_cost, 2), 'active', active) order by name) from products), '[]'::jsonb),
    'consumption', coalesce((select jsonb_agg(jsonb_build_object('id', c.id, 'date', c.cons_date, 'product', p.name, 'kind', c.kind, 'qty', c.qty, 'total', c.total, 'status', c.status, 'note', c.note) order by c.cons_date desc, c.created_at desc)
      from (select * from acc_stock_consumptions order by cons_date desc, created_at desc limit 200) c join products p on p.id = c.product_id), '[]'::jsonb));
end $$;

create or replace function acc_payroll_summary(p_period text) returns jsonb
language plpgsql security definer set search_path = public as $$
begin
  perform acc_require('payroll.view');
  return jsonb_build_object('period', p_period, 'rows', coalesce((
    select jsonb_agg(jsonb_build_object('dueId', d.id, 'name', d.subject_name, 'role', d.subject_role, 'salaryDue', d.salary_due, 'bonusDue', d.bonus_due,
        'paidSalary', coalesce(s.paid, 0), 'paidBonus', coalesce(b.paid, 0), 'salaryRemaining', d.salary_due - coalesce(s.paid, 0), 'bonusRemaining', d.bonus_due - coalesce(b.paid, 0),
        'accrued', exists (select 1 from acc_journals j where j.source_type = 'payroll_due' and j.source_id = d.id and j.status = 'posted' and j.reversed_by is null)) order by d.subject_name)
    from payroll_dues d
    left join (select due_id, sum(amount) paid from payroll_payouts where status = 'paid' and kind = 'salary' group by 1) s on s.due_id = d.id
    left join (select due_id, sum(amount) paid from payroll_payouts where status = 'paid' and kind = 'bonus' group by 1) b on b.due_id = d.id
    where d.period = p_period and d.approved_at is not null), '[]'::jsonb),
    'glSalaryPayable', (select coalesce(sum(credit - debit), 0) from acc_posted_lines where account_id = acc_account_id('salary_payable')),
    'glBonusPayable', (select coalesce(sum(credit - debit), 0) from acc_posted_lines where account_id = acc_account_id('bonus_payable')),
    'advances', coalesce((select jsonb_agg(jsonb_build_object('id', a.id, 'no', a.no, 'name', a.person_name, 'amount', a.amount, 'date', a.advance_date, 'status', a.status,
        'recovered', coalesce((select sum(amount) from acc_advance_recoveries r where r.advance_id = a.id and r.status = 'active'), 0)) order by a.advance_date desc) from acc_advances a), '[]'::jsonb));
end $$;

create or replace function acc_treasury_overview() returns jsonb
language plpgsql security definer set search_path = public as $$
begin
  perform acc_require('access');
  return jsonb_build_object('rows', coalesce((
    select jsonb_agg(jsonb_build_object('id', t.id, 'name', t.name, 'kind', t.kind, 'accountId', t.account_id, 'code', a.code, 'active', t.active, 'opening', t.opening_balance,
        'balance', acc_treasury_balance(t.id),
        'unreconciled', (select count(*) from acc_posted_lines l where l.account_id = t.account_id and l.reconciled_at is null),
        'lastCount', (select jsonb_build_object('date', c.count_date, 'counted', c.counted, 'book', c.book_balance, 'diff', c.diff) from acc_cash_counts c where c.treasury_id = t.id order by c.count_date desc, c.created_at desc limit 1)) order by t.kind, t.name)
    from acc_treasuries t join acc_accounts a on a.id = t.account_id), '[]'::jsonb),
    'methods', coalesce((select jsonb_agg(jsonb_build_object('method', method, 'treasuryId', treasury_id) order by method) from acc_method_map), '[]'::jsonb));
end $$;

create or replace function acc_posting_status() returns jsonb
language plpgsql security definer set search_path = public as $$
begin
  perform acc_require('access');
  return jsonb_build_object('pending', coalesce((select jsonb_object_agg(source_type, n) from (select source_type, count(*) n from acc_pending_docs() group by 1) s), '{}'::jsonb),
    'errors', coalesce((select jsonb_agg(jsonb_build_object('id', id, 'type', source_type, 'sourceId', source_id, 'message', message, 'attempts', attempts, 'lastAt', last_at) order by last_at desc)
      from acc_posting_errors where resolved_at is null), '[]'::jsonb));
end $$;

create or replace function acc_dashboard() returns jsonb
language plpgsql security definer set search_path = public as $$
declare ms date := date_trunc('month', riyadh_today())::date; me date := riyadh_today(); rev numeric; exp numeric;
begin
  perform acc_require('access');
  select coalesce(sum(case when a.type = 'revenue' then l.credit - l.debit end), 0), coalesce(sum(case when a.type = 'expense' then l.debit - l.credit end), 0) into rev, exp
  from acc_posted_lines l join acc_accounts a on a.id = l.account_id where a.type in ('revenue', 'expense') and l.entry_date between ms and me;
  return jsonb_build_object('cash', (select coalesce(sum(acc_treasury_balance(id)), 0) from acc_treasuries where active),
    'receivables', (select coalesce(sum(debit - credit), 0) from acc_posted_lines where account_id = acc_account_id('ar')),
    'payables', (select coalesce(sum(credit - debit), 0) from acc_posted_lines where account_id = acc_account_id('ap')),
    'monthRevenue', rev, 'monthExpenses', exp, 'monthNet', rev - exp,
    'vatPayable', (select coalesce(sum(credit - debit), 0) from acc_posted_lines where account_id = acc_account_id('vat_out')) - (select coalesce(sum(debit - credit), 0) from acc_posted_lines where account_id = acc_account_id('vat_in')),
    'draftJournals', (select count(*) from acc_journals where status = 'draft'),
    'draftExpenses', (select count(*) from expenses where acc_status = 'draft'),
    'pendingDocs', (select count(*) from acc_pending_docs()),
    'openErrors', (select count(*) from acc_posting_errors where resolved_at is null),
    'closedMonths', (select count(*) from acc_periods where status = 'closed'),
    'series', coalesce((select jsonb_agg(jsonb_build_object('month', m, 'revenue', r, 'expenses', e) order by m) from (
        select to_char(l.entry_date, 'YYYY-MM') m, sum(case when a.type = 'revenue' then l.credit - l.debit else 0 end) r, sum(case when a.type = 'expense' then l.debit - l.credit else 0 end) e
        from acc_posted_lines l join acc_accounts a on a.id = l.account_id where a.type in ('revenue', 'expense') and l.entry_date >= (ms - interval '5 months')::date group by 1) s), '[]'::jsonb),
    'topExpenses', coalesce((select jsonb_agg(jsonb_build_object('name', nm, 'amount', amt) order by amt desc) from (
        select a.name nm, sum(l.debit - l.credit) amt from acc_posted_lines l join acc_accounts a on a.id = l.account_id where a.type = 'expense' and l.entry_date between ms and me group by 1 having sum(l.debit - l.credit) > 0 order by 2 desc limit 6) s), '[]'::jsonb));
end $$;

-- فحوصات سلامة: توازن القيود، عدم تكرار القيد النشط، مطابقة الإيراد/الذمم للنظام الطبي
create or replace function acc_integrity_check() returns jsonb
language plpgsql security definer set search_path = public as $$
declare unb int; dup int; gl_ar numeric; op_ar numeric; gl_rev numeric; op_rev numeric; checks jsonb;
begin
  perform acc_require('reports.view');
  select count(*) into unb from (select journal_id from acc_posted_lines group by journal_id having sum(debit) <> sum(credit)) s;
  select count(*) into dup from (select source_type, source_id from acc_journals where status = 'posted' and reversed_by is null and source_id is not null and source_type <> 'reversal' and source_type <> 'depreciation' group by 1, 2 having count(*) > 1) s;
  select coalesce(sum(debit - credit), 0) into gl_ar from acc_posted_lines where account_id = acc_account_id('ar');
  select coalesce(sum(remaining), 0) into op_ar from invoices where status in ('due', 'partial');
  select coalesce(sum(l.credit - l.debit), 0) into gl_rev from acc_posted_lines l join acc_journals j on j.id = l.journal_id where l.account_id = acc_account_id('rev_services') and j.source_type = 'invoice' and j.reversed_by is null;
  select coalesce(sum(greatest(price - discount, 0)), 0) into op_rev from invoices where status in ('due', 'partial', 'paid') and total > 0;
  checks := jsonb_build_array(
    jsonb_build_object('key', 'balanced', 'label', 'كل القيود المرحّلة متوازنة', 'ok', unb = 0, 'detail', unb),
    jsonb_build_object('key', 'no_duplicates', 'label', 'لا يوجد أكثر من قيد نشط لنفس المستند', 'ok', dup = 0, 'detail', dup),
    jsonb_build_object('key', 'ar_match', 'label', 'رصيد الذمم في الدفاتر = المتبقي على فواتير المرضى', 'ok', gl_ar = op_ar, 'detail', gl_ar - op_ar),
    jsonb_build_object('key', 'revenue_match', 'label', 'إيراد الخدمات في الدفاتر = صافي الفواتير المعتمدة', 'ok', gl_rev = op_rev, 'detail', gl_rev - op_rev),
    jsonb_build_object('key', 'pending', 'label', 'لا توجد مستندات بانتظار الترحيل', 'ok', (select count(*) from acc_pending_docs()) = 0, 'detail', (select count(*) from acc_pending_docs())),
    jsonb_build_object('key', 'errors', 'label', 'لا توجد أخطاء ترحيل مفتوحة', 'ok', (select count(*) from acc_posting_errors where resolved_at is null) = 0, 'detail', (select count(*) from acc_posting_errors where resolved_at is null)));
  return jsonb_build_object('checks', checks, 'ok', not exists (select 1 from jsonb_array_elements(checks) c where (c->>'ok')::boolean = false));
end $$;

create or replace function acc_audit_list(p_limit int default 200) returns jsonb
language plpgsql security definer set search_path = public as $$
begin
  perform acc_require('reports.view');
  return coalesce((select jsonb_agg(jsonb_build_object('id', id, 'at', at, 'employee', (select name from employees where id = employee_id), 'action', action, 'entity', entity, 'entityId', entity_id, 'detail', detail) order by id desc)
    from (select * from acc_audit order by id desc limit least(coalesce(p_limit, 200), 1000)) s), '[]'::jsonb);
end $$;
