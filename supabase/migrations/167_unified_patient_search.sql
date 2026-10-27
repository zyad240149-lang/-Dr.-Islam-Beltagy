-- 167: بحث موحّد عن المريض في كل دوال الخادم — نفس قواعد patientMatches في الواجهة (admin/src/utils/phoneUtils.ts):
--   • الاسم: أي جزء منه، وكل كلمة في البحث لازم تكون موجودة (بأي ترتيب)، من غير فرق أ/إ/آ/ٱ = ا، ة = ه، ى = ي، ومن غير تشكيل/تطويل
--   • رقم الملف: بالرقم لوحده (15754) أو بالصيغة القديمة (TM-15754) — القاعدة لسه مخزّنة «TM-»، والعرض بقى أرقام بس في الواجهة
--   • رقم الهوية/الإقامة، والجوال بأي صيغة (05… / 5… / 966… / +966… / 00966…) سواء الرقم متسجّل دولي أو محلي قديم
--   • الأرقام العربية/الفارسية بتتحول لاتيني
-- الدوال اللي بتبحث (list_patients, global_search, package_attendance_list, online_accounts) بيتعاد بناؤها من تعريفها الحالي
-- على القاعدة (pg_get_functiondef) باستبدال شرط البحث بس — عشان مانرجّعش أي تعديل اتعمل عليها في هجرة تانية.

create or replace function search_norm(p text) returns text
language sql immutable parallel safe set search_path = public as $$
  -- translate: الحروف الزيادة في الأول (التطويل U+0640 والتشكيل U+064B–U+0652 وU+0670) مالهاش مقابل فبتتشال
  select btrim(regexp_replace(
    translate(lower(coalesce(p, '')),
      'أإآٱةى٠١٢٣٤٥٦٧٨٩۰۱۲۳۴۵۶۷۸۹' || chr(1600) || chr(1611) || chr(1612) || chr(1613) || chr(1614) || chr(1615) || chr(1616) || chr(1617) || chr(1618) || chr(1648),
      'ااااهي01234567890123456789'),
    '\s+', ' ', 'g'));
$$;

-- الجوال: أرقام المدخل من غير أصفار البداية؛ ولو المدخل طويل (9 أرقام أو أكتر) بنقارن بآخر 9 كمان
-- (عشان 966551234567 يلاقي 0551234567 المتسجّل قديم، و0551234567 يلاقي +966551234567)
create or replace function phone_digits_match(p_phone text, p_q text) returns boolean
language sql immutable parallel safe set search_path = public as $$
  with x as (
    select regexp_replace(translate(coalesce(p_phone, ''), '٠١٢٣٤٥٦٧٨٩۰۱۲۳۴۵۶۷۸۹', '01234567890123456789'), '\D', '', 'g') as pd,
           ltrim(regexp_replace(translate(coalesce(p_q, ''), '٠١٢٣٤٥٦٧٨٩۰۱۲۳۴۵۶۷۸۹', '01234567890123456789'), '\D', '', 'g'), '0') as qd
  )
  select length(qd) >= 3 and pd <> '' and (position(qd in pd) > 0 or (length(qd) >= 9 and position(right(qd, 9) in pd) > 0)) from x;
$$;

create or replace function patient_q_match(p_name text, p_phone text, p_file text, p_nid text, p_q text) returns boolean
language plpgsql immutable parallel safe set search_path = public as $$
declare q text := search_norm(p_q); n text; qf text; qd text;
begin
  if q = '' then return true; end if;
  -- الاسم: كل كلمة في البحث موجودة في الاسم
  n := search_norm(p_name);
  if n <> '' and not exists (select 1 from unnest(string_to_array(q, ' ')) w where position(w in n) = 0) then return true; end if;
  if n <> '' and position(replace(q, ' ', '') in replace(n, ' ', '')) > 0 then return true; end if; -- «عبدالله» = «عبد الله»
  -- رقم الملف: 15754 أو TM-15754 أو tm 15754
  qf := regexp_replace(q, '^tm[-\s]*', '');
  if qf ~ '^\d+$' and position(qf in regexp_replace(coalesce(p_file, ''), '\D', '', 'g')) > 0 then return true; end if;
  if position(q in lower(coalesce(p_file, ''))) > 0 then return true; end if;
  -- أرقام بس (مع مسافات/شرط/+/أقواس): هوية/إقامة أو جوال
  if q ~ '^[+\d\s()-]+$' then
    qd := regexp_replace(q, '\D', '', 'g');
    if length(qd) >= 3 and position(qd in regexp_replace(coalesce(p_nid, ''), '\D', '', 'g')) > 0 then return true; end if;
    if phone_digits_match(p_phone, q) then return true; end if;
  end if;
  return false;
end $$;

-- ترتيب نتائج البحث العام: تطابق رقم الملف/الهوية/الجوال بالكامل الأول (عشان «1025» يطلّع ملف 1025 قبل 10250…)
create or replace function patient_q_rank(p_file text, p_nid text, p_phone text, p_q text) returns int
language sql immutable parallel safe set search_path = public as $$
  select case
    when regexp_replace(search_norm(p_q), '^tm[-\s]*', '') ~ '^\d+$'
         and regexp_replace(coalesce(p_file, ''), '\D', '', 'g') = regexp_replace(search_norm(p_q), '^tm[-\s]*', '') then 0
    when regexp_replace(search_norm(p_q), '\D', '', 'g') <> '' and coalesce(p_nid, '') = regexp_replace(search_norm(p_q), '\D', '', 'g') then 0
    when length(ltrim(regexp_replace(search_norm(p_q), '\D', '', 'g'), '0')) >= 9
         and right(regexp_replace(coalesce(p_phone, ''), '\D', '', 'g'), 9) = right(regexp_replace(search_norm(p_q), '\D', '', 'g'), 9) then 0
    else 1 end;
$$;

revoke all on function search_norm(text) from public, anon;
revoke all on function phone_digits_match(text, text) from public, anon;
revoke all on function patient_q_match(text, text, text, text, text) from public, anon;
revoke all on function patient_q_rank(text, text, text, text) from public, anon;
grant execute on function search_norm(text), phone_digits_match(text, text), patient_q_match(text, text, text, text, text), patient_q_rank(text, text, text, text) to authenticated;

-- إعادة بناء دوال البحث من تعريفها الحالي باستبدال الشرط القديم (ilike/like) بـ patient_q_match
do $mig$
declare
  fn text; def text; nd text;
  old_pat constant text := '((?:\w+\.)?)full_name ilike pat or \1phone like pat or phone_digits_match\(\1phone, (\w+)\) or \1file_no ilike pat or \1national_id like pat';
begin
  foreach fn in array array['list_patients', 'global_search', 'package_attendance_list'] loop
    select pg_get_functiondef(p.oid) into def from pg_proc p join pg_namespace s on s.oid = p.pronamespace where s.nspname = 'public' and p.proname = fn;
    if def is null then raise exception '167: الدالة % مش موجودة', fn; end if;
    nd := regexp_replace(def, old_pat, 'patient_q_match(\1full_name, \1phone, \1file_no, \1national_id, \2)', 'g');
    if fn = 'global_search' then
      nd := replace(nd, 'patient_q_match(full_name, phone, file_no, national_id, q)) order by full_name limit 6',
                        'patient_q_match(full_name, phone, file_no, national_id, q)) order by patient_q_rank(file_no, national_id, phone, q), full_name limit 6');
    end if;
    if nd = def then
      if position('patient_q_match(' in def) > 0 then continue; end if; -- متطبّقة قبل كده (إعادة تشغيل)
      raise exception '167: شرط البحث القديم مش موجود في % — راجع تعريفها', fn;
    end if;
    execute nd;
  end loop;

  select pg_get_functiondef(p.oid) into def from pg_proc p join pg_namespace s on s.oid = p.pronamespace where s.nspname = 'public' and p.proname = 'online_accounts';
  nd := regexp_replace(def,
    'coalesce\(p\.full_name, c\.name\) ilike pat or c\.name ilike pat or phone_digits_match\(coalesce\(p\.phone, c\.phone\), q\)\s+or phone_digits_match\(c\.phone, q\) or p\.file_no ilike pat or coalesce\(p\.national_id, ''''\) like pat',
    'patient_q_match(coalesce(p.full_name, c.name), coalesce(p.phone, c.phone), p.file_no, p.national_id, q) or patient_q_match(c.name, c.phone, null, null, q)');
  if nd = def then
    if position('patient_q_match(' in def) = 0 then raise exception '167: شرط البحث القديم مش موجود في online_accounts — راجع تعريفها'; end if;
  else
    execute nd;
  end if;
end $mig$;
