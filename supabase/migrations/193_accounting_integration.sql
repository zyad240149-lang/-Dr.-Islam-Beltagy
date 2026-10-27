-- النظام المحاسبي — الربط التلقائي مع النظام الطبي (فواتير، دفعات، بيع منتجات، مصروفات، مشتريات، رواتب، سلف، أصول)
-- القاعدة: «قيد نشط واحد لكل مستند». أي تغيير في المستند = عكس القيد القديم + قيد جديد، والإلغاء/الحذف = عكس فقط، وإعادة نفس الحالة = لا شيء.
-- الربط عبر تريجرات AFTER بتنادي acc_try_post: لو الترحيل فشل (فترة مقفلة مثلًا) العملية الأصلية بتكمل والخطأ يتسجّل في acc_posting_errors ويتعاد.

create or replace function acc_post_source(p_type text, p_id uuid) returns uuid
language plpgsql security definer set search_path = public as $$
declare
  inv invoices; pay payments; ps product_sales; ex expenses; pu acc_purchases; vp acc_vendor_payments; cs acc_stock_consumptions;
  av acc_advances; rc acc_advance_recoveries; fa acc_assets; du payroll_dues; po payroll_payouts; t acc_treasuries;
  lines jsonb; th uuid; rev numeric; tax numeric; cost numeric; d date; me date; has_act boolean; it record;
begin
  if p_type = 'invoice' then
    select * into inv from invoices where id = p_id;
    if inv.id is null or inv.status in ('draft', 'cancelled') or inv.total <= 0 then return acc_apply_source('invoice', p_id, riyadh_today(), '', null, null); end if;
    select a.therapist_id into th from appointments a where a.id = inv.appointment_id;
    if th is null and inv.plan_id is not null then select therapist_id into th from treatment_plans where id = inv.plan_id; end if;
    tax := coalesce(inv.tax_amount, 0); rev := inv.total - tax;
    lines := jsonb_build_array(
      jsonb_build_object('account', 'ar', 'debit', inv.total, 'partyType', 'patient', 'partyId', inv.patient_id, 'memo', 'فاتورة ' || inv.no),
      jsonb_build_object('account', 'rev_services', 'credit', rev, 'therapist', th, 'service', inv.service_name, 'memo', 'إيراد فاتورة ' || inv.no));
    if tax > 0 then lines := lines || jsonb_build_array(jsonb_build_object('account', 'vat_out', 'credit', tax, 'memo', 'ضريبة فاتورة ' || inv.no)); end if;
    return acc_apply_source('invoice', p_id, inv.date, 'إيراد الفاتورة ' || inv.no, inv.no, lines);

  elsif p_type = 'payment' then
    select * into pay from payments where id = p_id;
    if pay.id is null or pay.voided_at is not null or pay.amount <= 0 then return acc_apply_source('payment', p_id, riyadh_today(), '', null, null); end if;
    select * into inv from invoices where id = pay.invoice_id;
    t := acc_treasury_for_method(pay.method);
    lines := jsonb_build_array(
      jsonb_build_object('account', t.account_id, 'debit', pay.amount, 'treasury', t.id, 'memo', 'تحصيل فاتورة ' || coalesce(inv.no, '')),
      jsonb_build_object('account', 'ar', 'credit', pay.amount, 'partyType', 'patient', 'partyId', coalesce(pay.patient_id, inv.patient_id), 'memo', 'تحصيل فاتورة ' || coalesce(inv.no, '')));
    return acc_apply_source('payment', p_id, (pay.date at time zone 'Africa/Cairo')::date, 'تحصيل على الفاتورة ' || coalesce(inv.no, ''), inv.no, lines);

  elsif p_type = 'product_sale' then
    select * into ps from product_sales where id = p_id;
    if ps.id is null or ps.status <> 'completed' then return acc_apply_source('product_sale', p_id, riyadh_today(), '', null, null); end if;
    t := acc_treasury_for_method(ps.payment_method);
    tax := coalesce(ps.tax_amount, 0); rev := ps.total - tax;
    -- تكلفة البضاعة تتثبّت وقت أول ترحيل (ما تتغيّرش لو متوسط التكلفة اتغيّر بعدين)
    select exists (select 1 from acc_journals where source_type = 'product_sale' and source_id = p_id and status = 'posted' and reversed_by is null) into has_act;
    if has_act then
      select coalesce(sum(l.credit), 0) into cost from acc_journal_lines l join acc_journals j on j.id = l.journal_id
      where j.source_type = 'product_sale' and j.source_id = p_id and j.status = 'posted' and j.reversed_by is null and l.account_id = acc_account_id('inventory');
    else
      select round(ps.qty * coalesce(avg_cost, 0), 2) into cost from products where id = ps.product_id;
    end if;
    lines := jsonb_build_array(
      jsonb_build_object('account', t.account_id, 'debit', ps.total, 'treasury', t.id, 'memo', 'بيع منتج ' || ps.invoice_no),
      jsonb_build_object('account', 'rev_products', 'credit', rev, 'service', ps.product_name, 'memo', 'إيراد ' || ps.invoice_no));
    if tax > 0 then lines := lines || jsonb_build_array(jsonb_build_object('account', 'vat_out', 'credit', tax)); end if;
    if coalesce(cost, 0) > 0 then
      lines := lines || jsonb_build_array(jsonb_build_object('account', 'cogs', 'debit', cost, 'memo', 'تكلفة ' || ps.invoice_no), jsonb_build_object('account', 'inventory', 'credit', cost));
    end if;
    return acc_apply_source('product_sale', p_id, (ps.created_at at time zone 'Africa/Cairo')::date, 'بيع منتجات ' || ps.invoice_no, ps.invoice_no, lines);

  elsif p_type = 'expense' then
    select * into ex from expenses where id = p_id;
    if ex.id is null or ex.acc_status <> 'posted' then return acc_apply_source('expense', p_id, riyadh_today(), '', null, null); end if;
    if ex.account_id is null or ex.treasury_id is null then raise exception 'المصروف % ينقصه حساب المصروف أو الخزنة', ex.no; end if;
    select * into t from acc_treasuries where id = ex.treasury_id;
    lines := jsonb_build_array(
      jsonb_build_object('account', ex.account_id, 'debit', ex.amount - ex.vat_amount, 'costCenter', ex.cost_center_id, 'memo', ex.description),
      jsonb_build_object('account', t.account_id, 'credit', ex.amount, 'treasury', t.id, 'memo', ex.description));
    if ex.vat_amount > 0 then lines := lines || jsonb_build_array(jsonb_build_object('account', 'vat_in', 'debit', ex.vat_amount)); end if;
    return acc_apply_source('expense', p_id, ex.expense_date, 'مصروف ' || ex.no || ' — ' || ex.category, ex.no, lines);

  elsif p_type = 'purchase' then
    select * into pu from acc_purchases where id = p_id;
    if pu.id is null or pu.status <> 'posted' then return acc_apply_source('purchase', p_id, riyadh_today(), '', null, null); end if;
    lines := '[]'::jsonb;
    for it in select * from acc_purchase_items where purchase_id = p_id order by line_no loop
      lines := lines || jsonb_build_array(jsonb_build_object('account', case when it.product_id is not null then 'inventory' else it.account_id::text end,
        'debit', it.amount, 'costCenter', it.cost_center_id, 'memo', pu.no || ' — ' || it.description));
    end loop;
    if pu.vat_amount > 0 then lines := lines || jsonb_build_array(jsonb_build_object('account', 'vat_in', 'debit', pu.vat_amount, 'memo', pu.no)); end if;
    lines := lines || jsonb_build_array(jsonb_build_object('account', 'ap', 'credit', pu.total, 'partyType', 'vendor', 'partyId', pu.vendor_id, 'memo', pu.no));
    return acc_apply_source('purchase', p_id, pu.purchase_date, 'فاتورة شراء ' || pu.no, pu.no, lines);

  elsif p_type = 'vendor_payment' then
    select * into vp from acc_vendor_payments where id = p_id;
    if vp.id is null or vp.status <> 'active' then return acc_apply_source('vendor_payment', p_id, riyadh_today(), '', null, null); end if;
    select * into t from acc_treasuries where id = vp.treasury_id;
    lines := jsonb_build_array(
      jsonb_build_object('account', 'ap', 'debit', vp.amount, 'partyType', 'vendor', 'partyId', vp.vendor_id, 'memo', vp.no),
      jsonb_build_object('account', t.account_id, 'credit', vp.amount, 'treasury', t.id, 'memo', vp.no));
    return acc_apply_source('vendor_payment', p_id, vp.pay_date, 'سداد مورد ' || vp.no, vp.no, lines);

  elsif p_type = 'consumption' then
    select * into cs from acc_stock_consumptions where id = p_id;
    if cs.id is null or cs.status <> 'posted' or cs.total = 0 then return acc_apply_source('consumption', p_id, riyadh_today(), '', null, null); end if;
    lines := case when cs.qty > 0 then
      jsonb_build_array(jsonb_build_object('account', 'consumables', 'debit', abs(cs.total), 'memo', cs.note), jsonb_build_object('account', 'inventory', 'credit', abs(cs.total)))
      else jsonb_build_array(jsonb_build_object('account', 'inventory', 'debit', abs(cs.total), 'memo', cs.note), jsonb_build_object('account', 'consumables', 'credit', abs(cs.total))) end;
    return acc_apply_source('consumption', p_id, cs.cons_date, case when cs.kind = 'count' then 'تسوية جرد مخزون' else 'استهلاك مخزون' end, null, lines);

  elsif p_type = 'advance' then
    select * into av from acc_advances where id = p_id;
    if av.id is null or av.status = 'cancelled' then return acc_apply_source('advance', p_id, riyadh_today(), '', null, null); end if;
    select * into t from acc_treasuries where id = av.treasury_id;
    lines := jsonb_build_array(
      jsonb_build_object('account', 'staff_advances', 'debit', av.amount, 'partyType', 'employee', 'partyId', coalesce(av.employee_id, av.therapist_id), 'memo', av.person_name),
      jsonb_build_object('account', t.account_id, 'credit', av.amount, 'treasury', t.id, 'memo', av.person_name));
    return acc_apply_source('advance', p_id, av.advance_date, 'سلفة موظف ' || av.no, av.no, lines);

  elsif p_type = 'advance_recovery' then
    select * into rc from acc_advance_recoveries where id = p_id;
    if rc.id is null or rc.status <> 'active' then return acc_apply_source('advance_recovery', p_id, riyadh_today(), '', null, null); end if;
    select * into av from acc_advances where id = rc.advance_id;
    if rc.method = 'cash' then
      select * into t from acc_treasuries where id = rc.treasury_id;
      lines := jsonb_build_array(jsonb_build_object('account', t.account_id, 'debit', rc.amount, 'treasury', t.id), jsonb_build_object('account', 'staff_advances', 'credit', rc.amount, 'partyType', 'employee', 'partyId', coalesce(av.employee_id, av.therapist_id)));
    else
      lines := jsonb_build_array(jsonb_build_object('account', 'salary_payable', 'debit', rc.amount, 'partyType', 'employee', 'partyId', coalesce(av.employee_id, av.therapist_id)), jsonb_build_object('account', 'staff_advances', 'credit', rc.amount, 'partyType', 'employee', 'partyId', coalesce(av.employee_id, av.therapist_id)));
    end if;
    return acc_apply_source('advance_recovery', p_id, rc.rec_date, 'استرداد سلفة ' || av.no, av.no, lines);

  elsif p_type = 'asset' then
    select * into fa from acc_assets where id = p_id;
    if fa.id is null or fa.status <> 'active' then return acc_apply_source('asset', p_id, riyadh_today(), '', null, null); end if;
    if fa.funding = 'treasury' then
      select * into t from acc_treasuries where id = fa.treasury_id;
      lines := jsonb_build_array(jsonb_build_object('account', 'fixed_assets', 'debit', fa.cost, 'memo', fa.name), jsonb_build_object('account', t.account_id, 'credit', fa.cost, 'treasury', t.id, 'memo', fa.name));
    elsif fa.funding = 'payable' then
      lines := jsonb_build_array(jsonb_build_object('account', 'fixed_assets', 'debit', fa.cost, 'memo', fa.name), jsonb_build_object('account', 'ap', 'credit', fa.cost, 'partyType', 'vendor', 'partyId', fa.vendor_id, 'memo', fa.name));
    else
      lines := jsonb_build_array(jsonb_build_object('account', 'fixed_assets', 'debit', fa.cost, 'memo', fa.name), jsonb_build_object('account', 'opening_equity', 'credit', fa.cost, 'memo', fa.name));
    end if;
    return acc_apply_source('asset', p_id, fa.purchase_date, 'شراء أصل ثابت ' || fa.code, fa.code, lines);

  elsif p_type = 'payroll_due' then
    select * into du from payroll_dues where id = p_id;
    if du.id is null or du.approved_at is null or (coalesce(du.salary_due, 0) <= 0 and coalesce(du.bonus_due, 0) <= 0) then
      return acc_apply_source('payroll_due', p_id, riyadh_today(), '', null, null);
    end if;
    me := ((du.period || '-01')::date + interval '1 month' - interval '1 day')::date; d := least(me, riyadh_today());
    lines := '[]'::jsonb;
    if coalesce(du.salary_due, 0) > 0 then
      lines := lines || jsonb_build_array(jsonb_build_object('account', 'salaries_exp', 'debit', du.salary_due, 'partyType', du.subject_type, 'partyId', coalesce(du.therapist_id, du.employee_id), 'memo', du.subject_name),
        jsonb_build_object('account', 'salary_payable', 'credit', du.salary_due, 'partyType', du.subject_type, 'partyId', coalesce(du.therapist_id, du.employee_id), 'memo', du.subject_name));
    end if;
    if coalesce(du.bonus_due, 0) > 0 then
      lines := lines || jsonb_build_array(jsonb_build_object('account', 'commission_exp', 'debit', du.bonus_due, 'partyType', du.subject_type, 'partyId', coalesce(du.therapist_id, du.employee_id), 'memo', du.subject_name),
        jsonb_build_object('account', 'bonus_payable', 'credit', du.bonus_due, 'partyType', du.subject_type, 'partyId', coalesce(du.therapist_id, du.employee_id), 'memo', du.subject_name));
    end if;
    return acc_apply_source('payroll_due', p_id, d, 'استحقاق رواتب ' || du.period, du.period, lines);

  elsif p_type = 'payroll_payout' then
    select * into po from payroll_payouts where id = p_id;
    if po.id is null or po.status <> 'paid' then return acc_apply_source('payroll_payout', p_id, riyadh_today(), '', null, null); end if;
    perform acc_post_source('payroll_due', po.due_id);
    select * into du from payroll_dues where id = po.due_id;
    t := acc_treasury_for_method(po.method);
    lines := jsonb_build_array(
      jsonb_build_object('account', case when po.kind = 'salary' then 'salary_payable' else 'bonus_payable' end, 'debit', po.amount, 'partyType', du.subject_type, 'partyId', coalesce(du.therapist_id, du.employee_id), 'memo', du.subject_name),
      jsonb_build_object('account', t.account_id, 'credit', po.amount, 'treasury', t.id, 'memo', du.subject_name));
    return acc_apply_source('payroll_payout', p_id, po.paid_on, 'صرف ' || case when po.kind = 'salary' then 'راتب' else 'مكافأة' end || ' ' || po.no, po.no, lines);
  end if;
  raise exception 'نوع مستند غير مدعوم: %', p_type;
end $$;

-- ---------- التريجرات ----------
create or replace function acc_trg_source() returns trigger language plpgsql security definer set search_path = public as $$
begin
  if tg_op = 'DELETE' then perform acc_try_post(tg_argv[0], old.id); return old; end if;
  perform acc_try_post(tg_argv[0], new.id); return new;
end $$;

drop trigger if exists trg_acc_invoice on invoices;
create trigger trg_acc_invoice after insert or update of status, price, discount, total, tax_amount, tax_rate, date, patient_id, service_name or delete on invoices
  for each row execute function acc_trg_source('invoice');
drop trigger if exists trg_acc_payment on payments;
create trigger trg_acc_payment after insert or update of amount, method, voided_at, date, invoice_id or delete on payments
  for each row execute function acc_trg_source('payment');
drop trigger if exists trg_acc_product_sale on product_sales;
create trigger trg_acc_product_sale after insert or update of status, total, tax_amount, qty, payment_method on product_sales
  for each row execute function acc_trg_source('product_sale');
drop trigger if exists trg_acc_payroll_due on payroll_dues;
create trigger trg_acc_payroll_due after insert or update of salary_due, bonus_due, approved_at, period on payroll_dues
  for each row execute function acc_trg_source('payroll_due');
drop trigger if exists trg_acc_payroll_payout on payroll_payouts;
create trigger trg_acc_payroll_payout after insert or update of status, amount, method, paid_on, kind or delete on payroll_payouts
  for each row execute function acc_trg_source('payroll_payout');

-- ---------- المستندات اللي لسه ما اترحّلت (أو لازم تتعكس) ----------
create or replace function acc_pending_docs() returns table (source_type text, source_id uuid)
language sql stable security definer set search_path = public as $$
  with act as (select source_type st, source_id sid from acc_journals where status = 'posted' and reversed_by is null and source_id is not null)
  select 'invoice', i.id from invoices i where i.status not in ('draft', 'cancelled') and i.total > 0
    and not exists (select 1 from act where st = 'invoice' and sid = i.id)
  union all select 'invoice', i.id from invoices i where i.status in ('draft', 'cancelled') and exists (select 1 from act where st = 'invoice' and sid = i.id)
  union all select 'payment', p.id from payments p where p.voided_at is null and p.amount > 0 and not exists (select 1 from act where st = 'payment' and sid = p.id)
  union all select 'payment', p.id from payments p where p.voided_at is not null and exists (select 1 from act where st = 'payment' and sid = p.id)
  union all select 'product_sale', s.id from product_sales s where s.status = 'completed' and not exists (select 1 from act where st = 'product_sale' and sid = s.id)
  union all select 'product_sale', s.id from product_sales s where s.status <> 'completed' and exists (select 1 from act where st = 'product_sale' and sid = s.id)
  union all select 'payroll_due', d.id from payroll_dues d where d.approved_at is not null and (coalesce(d.salary_due, 0) > 0 or coalesce(d.bonus_due, 0) > 0)
    and not exists (select 1 from act where st = 'payroll_due' and sid = d.id)
  union all select 'payroll_payout', o.id from payroll_payouts o where o.status = 'paid' and not exists (select 1 from act where st = 'payroll_payout' and sid = o.id)
  union all select 'payroll_payout', o.id from payroll_payouts o where o.status <> 'paid' and exists (select 1 from act where st = 'payroll_payout' and sid = o.id)
  union all select 'expense', e.id from expenses e where e.acc_status = 'posted' and not exists (select 1 from act where st = 'expense' and sid = e.id)
  union all select 'purchase', p.id from acc_purchases p where p.status = 'posted' and not exists (select 1 from act where st = 'purchase' and sid = p.id)
  union all select 'vendor_payment', v.id from acc_vendor_payments v where v.status = 'active' and not exists (select 1 from act where st = 'vendor_payment' and sid = v.id)
$$;

-- مزامنة: بترحّل المتأخر وتعيد المحاولة للفاشل — آمنة تتكرر (القيود مفتاحها المصدر)
create or replace function acc_sync_pending_internal(p_limit int default 500) returns jsonb
language plpgsql security definer set search_path = public as $$
declare r record; n int := 0; fixed int := 0; failed int := 0; open_before int;
begin
  select count(*) into open_before from acc_posting_errors where resolved_at is null;
  for r in select * from acc_pending_docs() limit p_limit loop
    n := n + 1;
    perform acc_try_post(r.source_type, r.source_id);
  end loop;
  select count(*) into failed from acc_posting_errors where resolved_at is null;
  return jsonb_build_object('attempted', n, 'failed', failed, 'errorsBefore', open_before);
end $$;
