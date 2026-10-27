-- التارجت ما كان يتحدّث: أول ما تضغط «تسجيل صرف» يتثبّت مستحق الشهر بأرقام اللحظة دي (مثلًا إيراد 0)، وبعدها أي زيارة جديدة ما تنعكس.
-- الحل: المستحق اللي ما اتصرف منه شي ولا اتعدّل يدويًا (auto_sync) بيتحدّث من الأرقام الحية قبل أي صرف، والواجهة تعرض الأرقام الحية له.
alter table payroll_dues add column if not exists auto_sync boolean not null default true;
update payroll_dues set auto_sync = false where updated_by is not null and exists (select 1 from payroll_audit a where a.subject_name = payroll_dues.subject_name and a.period = payroll_dues.period and a.action in ('تعديل مستحق معتمد', 'تعديل مستحق بعد إغلاق الشهر', 'تحديد نسبة المكافأة بعد الوصول للتارجت', 'تحديد نسبة المكافأة بعد إغلاق الشهر'));

do $$
declare def text; nd text;
begin
  select pg_get_functiondef(p.oid) into def from pg_proc p join pg_namespace n on n.oid = p.pronamespace where n.nspname = 'public' and p.proname = 'payroll_ensure_due';
  nd := replace(def, 'if v is not null then return v; end if;', 'if v is not null then
    if exists (select 1 from payroll_dues where id = v and auto_sync)
       and not exists (select 1 from payroll_payouts where due_id = v and status = ''paid'')
       and not exists (select 1 from payroll_periods where period = p_period and status = ''closed'') then
      perform payroll_recalc_due(v, ''تحديث تلقائي قبل الصرف'');
    end if;
    return v;
  end if;');
  if nd = def then raise exception '176: payroll_ensure_due'; end if;
  execute nd;

  select pg_get_functiondef(p.oid) into def from pg_proc p join pg_namespace n on n.oid = p.pronamespace where n.nspname = 'public' and p.proname = 'payroll_adjust_due';
  nd := replace(def, 'update payroll_dues set salary_due = ns, bonus_due = nb,', 'update payroll_dues set auto_sync = false, salary_due = ns, bonus_due = nb,');
  if nd = def then raise exception '176: payroll_adjust_due'; end if;
  execute nd;

  select pg_get_functiondef(p.oid) into def from pg_proc p join pg_namespace n on n.oid = p.pronamespace where n.nspname = 'public' and p.proname = 'payroll_set_bonus_rate';
  nd := replace(def, 'update payroll_dues set bonus_method = p_method,', 'update payroll_dues set auto_sync = false, bonus_method = p_method,');
  if nd = def then raise exception '176: payroll_set_bonus_rate'; end if;
  execute nd;

  select pg_get_functiondef(p.oid) into def from pg_proc p join pg_namespace n on n.oid = p.pronamespace where n.nspname = 'public' and p.proname = 'payroll_overview';
  nd := replace(def, '''approvedAt'', d.approved_at, ''updatedAt'', d.updated_at) end,', '''approvedAt'', d.approved_at, ''updatedAt'', d.updated_at, ''autoSync'', d.auto_sync) end,');
  if nd = def then raise exception '176: payroll_overview'; end if;
  execute nd;
end $$;
