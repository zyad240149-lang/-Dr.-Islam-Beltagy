-- أداء (مراجعة 2026-10-08): auth.uid() داخل سياسات RLS بتتحسب لكل صف — بتتغلّف بـ (select auth.uid()) فتتحسب مرة واحدة. نفس المنطق بالظبط.
do $$ declare r record; q text; w text; begin
  for r in select schemaname, tablename, policyname, qual, with_check from pg_policies
           where (tablename, policyname) in (('customers','customers_self'),('invoices','invoices_self'),('payments','payments_self'),('notifications','notifications_self'),
             ('patient_files','staff_write'),('patient_files','p_write'),('patient_files','p_delete'),('push_subscriptions','push_own_select')) loop
    q := replace(r.qual, 'auth.uid()', '(select auth.uid())');
    w := replace(r.with_check, 'auth.uid()', '(select auth.uid())');
    execute format('alter policy %I on %I.%I %s %s', r.policyname, r.schemaname, r.tablename,
      case when q is not null then 'using (' || q || ')' else '' end, case when w is not null then 'with check (' || w || ')' else '' end);
  end loop;
end $$;
