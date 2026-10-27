-- طلب المدير 2026-10-21: التارجت = إيرادات الأخصائي زي ما هي (نفس رقم الإيرادات في النظام: إجمالي الفاتورة شامل الضريبة، والمحصّل = المدفوع).
-- قبل كذا: صافي الفاتورة بدون ضريبة (فاتورة 100 + ضريبة 15 كانت تدخل 100، دلوقتي 115).
do $$
declare def text; nd text;
begin
  select pg_get_functiondef(p.oid) into def from pg_proc p join pg_namespace n on n.oid = p.pronamespace where n.nspname = 'public' and p.proname = 'target_visits';
  nd := replace(def, 'greatest(i.price - i.discount, 0)', 'i.total');
  if nd = def then raise exception '178: target_visits'; end if;
  execute nd;
end $$;
