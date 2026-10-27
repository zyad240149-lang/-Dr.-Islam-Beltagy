-- طلب المدير 2026-10-21: صرف مكافأة التارجت مفتوح حتى قبل ما الأخصائي يوصل للتارجت.
-- صرف مكافأة أكبر من المستحق (أو بدون مستحق) بيرفع «المكافأة المعتمدة» لنفس المبلغ ويسجّل ده في سجل التدقيق (المدير العام بس)،
-- والمستحق بيبطّل يتحدّث تلقائيًا. الراتب لسه ما ينصرف أكتر من مستحقه.
do $$
declare def text; nd text;
begin
  select pg_get_functiondef(p.oid) into def from pg_proc p join pg_namespace n on n.oid = p.pronamespace where n.nspname = 'public' and p.proname = 'payroll_pay';
  nd := replace(def, 'if due_amt <= 0 then raise exception', 'if k = ''bonus'' and d.subject_type = ''therapist'' and paid + amt > due_amt then
    update payroll_dues set bonus_due = paid + amt, auto_sync = false, updated_at = now(), updated_by = emp where id = d.id;
    perform payroll_log(''صرف مكافأة بدون استحقاق تارجت (رفع المكافأة المعتمدة)'', d.period, d.subject_name, _txt(p, ''note''),
      jsonb_build_object(''before'', due_amt, ''after'', paid + amt, ''amount'', amt, ''qualifying'', d.qualifying, ''target'', d.monthly_target));
    due_amt := paid + amt;
  end if;
  if due_amt <= 0 then raise exception');
  if nd = def then raise exception '180: payroll_pay'; end if;
  execute nd;
end $$;
