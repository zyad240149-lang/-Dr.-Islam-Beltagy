-- طلب المدير 2026-10-21: الباقة/الخطة العلاجية تدخل التارجت بكامل سعرها (صافي فاتورتها) أول ما تتأكد أول زيارة منها
-- (حضر/جاري/مكتمل) باسم دكتور هالزيارة وفي شهرها — والزيارات اللاحقة من نفس الباقة ما تضيف شي (ما فيه حساب مرتين).
-- قبل كذا: الصافي ÷ عدد الجلسات لكل زيارة.
do $$
declare def text; nd text;
begin
  select pg_get_functiondef(p.oid) into def from pg_proc p join pg_namespace n on n.oid = p.pronamespace where n.nspname = 'public' and p.proname = 'target_visits';
  nd := replace(def, 'x.net / greatest(x.sessions, 1) as net, x.coll / greatest(x.sessions, 1) as coll', 'x.net as net, x.coll as coll');
  nd := replace(nd, '< greatest(x.sessions, 1)', '< 1');
  if nd = def or position('< 1' in nd) = 0 or position('x.net as net' in nd) = 0 then raise exception '175: تعريف target_visits اتغيّر — راجع الاستبدال'; end if;
  execute nd;
end $$;
