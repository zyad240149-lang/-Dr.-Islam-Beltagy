-- 151: next_counter كانت بتقصّ الرقم لو أطول من الحشو (lpad(v::text, 4) بيقصّ '15753' إلى '1575') — بعد استيراد الملف القديم (أرقام ملف لحد 15752)
-- كان أي مريض جديد هياخد رقم ملف مقصوص ومتكرر. دلوقتي الحشو بيزوّد الأصفار بس ومابيقصّش.
create or replace function next_counter(p_name text, p_prefix text, p_pad integer default 4) returns text
language plpgsql set search_path = public as $$
declare v int;
begin
  update counters set value = value + 1 where name = p_name returning value into v;
  if v is null then
    insert into counters(name, value) values (p_name, 1) returning value into v;
  end if;
  return p_prefix || case when length(v::text) >= p_pad then v::text else lpad(v::text, p_pad, '0') end;
end $$;
-- المريض اللي رقم ملفه كان مكرّرًا في الملف القديم واتقصّ رقمه
update patients set file_no = 'TM-15753' where file_no = 'TM-1575' and notes like '%كان مكرّرًا لمريض تاني%';
