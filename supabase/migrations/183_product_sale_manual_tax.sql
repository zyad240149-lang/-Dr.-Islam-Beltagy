-- بيع المنتجات: نسبة الضريبة بيحددها الموظف يدويًا من 0 لـ 20% (2026-10-21) بدل سعودي/غير سعودي.
-- p_tax_rate لو اتبعت بيتاخد كما هو (0–20)، ومعاه الجنسية/الهوية ما بتتطلبش. من غيره (استدعاء قديم) السلوك زي ما كان.
do $$
declare def text; nd text;
begin
  select pg_get_functiondef('sell_product(uuid,integer,numeric,uuid,text,text,text,text,text)'::regprocedure) into def;
  nd := replace(def, 'p_national_id text DEFAULT NULL::text)', 'p_national_id text DEFAULT NULL::text, p_tax_rate numeric DEFAULT NULL::numeric)');
  nd := replace(nd, 'if p_patient is not null then
    v_rate := patient_tax_rate(p_patient);', 'if p_tax_rate is not null then
    if p_tax_rate < 0 or p_tax_rate > 20 then raise exception ''نسبة الضريبة لازم تكون من 0 إلى 20''; end if;
    v_rate := round(p_tax_rate, 2);
  elsif p_patient is not null then
    v_rate := patient_tax_rate(p_patient);');
  if nd = def or position('p_tax_rate numeric' in nd) = 0 or position('elsif p_patient' in nd) = 0 then raise exception '183: sell_product'; end if;
  drop function sell_product(uuid, integer, numeric, uuid, text, text, text, text, text);
  execute nd;
  revoke execute on function sell_product(uuid, integer, numeric, uuid, text, text, text, text, text, numeric) from public, anon;
  grant execute on function sell_product(uuid, integer, numeric, uuid, text, text, text, text, text, numeric) to authenticated;
end $$;
