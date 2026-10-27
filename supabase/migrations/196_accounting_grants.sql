-- النظام المحاسبي — صلاحيات التنفيذ: كل دوال acc_* مقفولة عن الزائر وعن المسجّلين، ما عدا قائمة الـ RPC العامة تحت (وكل واحدة منها بتنادي acc_require).
-- الدوال الداخلية (acc_post_source / acc_create_journal / acc_apply_source / تريجرات...) مش قابلة للاستدعاء من الواجهة نهائيًا.
do $$
declare r record;
  pub text[] := array['acc_account_save', 'acc_cost_center_save', 'acc_method_map_save', 'acc_treasury_save', 'acc_treasury_transfer', 'acc_cash_count', 'acc_reconcile',
    'acc_journal_save', 'acc_journal_post', 'acc_journal_discard', 'acc_journal_reverse', 'acc_expense_save', 'acc_expense_approve', 'acc_expense_cancel',
    'acc_vendor_save', 'acc_purchase_save', 'acc_purchase_post', 'acc_purchase_cancel', 'acc_vendor_payment_save', 'acc_vendor_payment_void',
    'acc_stock_consume', 'acc_stock_count', 'acc_consumption_cancel', 'acc_advance_save', 'acc_advance_recover', 'acc_advance_cancel',
    'acc_asset_save', 'acc_asset_cancel', 'acc_run_depreciation', 'acc_budget_save', 'acc_period_close', 'acc_period_reopen', 'acc_sync_pending',
    'acc_trial_balance', 'acc_ledger', 'acc_income_statement', 'acc_balance_sheet', 'acc_cash_flow', 'acc_journal_list', 'acc_journal_detail',
    'acc_can_see_source', 'acc_receivables', 'acc_payables', 'acc_profitability', 'acc_budget_vs_actual', 'acc_vat_report', 'acc_inventory_report', 'acc_payroll_summary',
    'acc_treasury_overview', 'acc_posting_status', 'acc_dashboard', 'acc_integrity_check', 'acc_audit_list'];
begin
  for r in select p.oid::regprocedure as sig, p.proname from pg_proc p where p.pronamespace = 'public'::regnamespace and p.proname like 'acc\_%' loop
    execute format('revoke all on function %s from public, anon, authenticated', r.sig);
    if r.proname = any(pub) then execute format('grant execute on function %s to authenticated', r.sig); end if;
  end loop;
end $$;
