-- راتب من الإيراد فقط (2026-10-21): شرط استحقاق جديد 'always' = نسبة % من الإيراد المؤهل من أول ريال، من غير ما يتطلب تارجت.
-- بيشتغل مع bonus_method = 'pct_revenue' (والراتب الأساسي = 0). باقي الشروط (reach/exceed) زي ما هي.
alter table comp_plans drop constraint if exists comp_plans_bonus_condition_check;
alter table comp_plans add constraint comp_plans_bonus_condition_check check (bonus_condition in ('reach', 'exceed', 'always'));

do $$
declare def text; nd text;
begin
  select pg_get_functiondef(p.oid) into def from pg_proc p join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public' and p.proname = 'payroll_save_plan';
  nd := replace(def, 'if cond not in (''reach'', ''exceed'') then', 'if cond not in (''reach'', ''exceed'', ''always'') then');
  nd := replace(nd, 'if meth <> ''none'' and tgt <= 0 then', 'if cond = ''always'' and meth not in (''none'', ''pct_revenue'') then raise exception ''الراتب من الإيراد يكون بنسبة من الإيراد المحقق''; end if;
  if meth <> ''none'' and cond <> ''always'' and tgt <= 0 then');
  if nd = def or position('''always''' in nd) = 0 then raise exception '173: تعريف payroll_save_plan اتغيّر — راجع الاستبدال'; end if;
  execute nd;

  select pg_get_functiondef(p.oid) into def from pg_proc p join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public' and p.proname = 'therapist_target_calc';
  nd := replace(def, 'eligible := tgt > 0 and coalesce(pl.bonus_method, ''none'') <> ''none'' and (case when pl.bonus_condition = ''exceed'' then q > tgt else q >= tgt end);',
    'eligible := coalesce(pl.bonus_method, ''none'') <> ''none'' and (case when pl.bonus_condition = ''always'' then true when tgt <= 0 then false when pl.bonus_condition = ''exceed'' then q > tgt else q >= tgt end);');
  if nd = def then raise exception '173: تعريف therapist_target_calc اتغيّر — راجع الاستبدال'; end if;
  execute nd;
end $$;
