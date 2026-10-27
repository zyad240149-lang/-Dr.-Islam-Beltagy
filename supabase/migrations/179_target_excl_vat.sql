-- طلب المدير 2026-10-21: التارجت من غير ضريبة (يرجّع صافي الفاتورة بعد الخصم بدون الضريبة؛ باقي قواعد 175/178 كما هي: الباقة كاملة في أول زيارة).
do $$
declare def text; nd text;
begin
  select pg_get_functiondef(p.oid) into def from pg_proc p join pg_namespace n on n.oid = p.pronamespace where n.nspname = 'public' and p.proname = 'target_visits';
  nd := replace(def, 'sum(i.total)', 'sum(greatest(i.price - i.discount, 0))');
  nd := replace(nd, 'i.total * least(', 'greatest(i.price - i.discount, 0) * least(');
  if nd = def or position('sum(i.total)' in nd) > 0 or position('i.total * least' in nd) > 0 then raise exception '179: target_visits'; end if;
  execute nd;
end $$;
