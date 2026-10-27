-- ترتيب نتايج بحث المرضى حسب الصلة (2026-10-21): تطابق كامل لرقم الملف/الهوية/الجوال أول، وبعده الاسم المطابق أو اللي يبدأ بالبحث، وبعدين الترتيب المختار.
-- قبل كذا كانت النتايج مرتّبة بالفرز العادي بس، فالمريض المطلوب بالضبط (مثلًا ملف 15758) كان يضيع وسط نتايج فيها الرقم جزء منها.
create or replace function patient_name_rank(p_name text, p_q text) returns int
language sql immutable parallel safe set search_path = public as $$
  select case
    when search_norm(p_q) = '' then 3
    when search_norm(p_name) = search_norm(p_q) then 0
    when position(search_norm(p_q) in search_norm(p_name)) = 1 then 1
    when position(' ' || search_norm(p_q) in ' ' || search_norm(p_name)) > 0 then 2
    else 3 end
$$;
revoke all on function patient_name_rank(text, text) from public, anon;
grant execute on function patient_name_rank(text, text) to authenticated;

do $$
declare def text; nd text;
begin
  select pg_get_functiondef('list_patients(text,text,text,text,uuid,text,integer,integer,text)'::regprocedure) into def;
  nd := replace(def, 'row_number() over (order by', 'row_number() over (order by
      case when trim(coalesce(p_q, '''')) = '''' then 0 else patient_q_rank(f.file_no, f.national_id, f.phone, p_q) end asc,
      case when trim(coalesce(p_q, '''')) = '''' then 0 else patient_name_rank(f.full_name, p_q) end asc,');
  if nd = def then raise exception '181: list_patients'; end if;
  execute nd;
end $$;
