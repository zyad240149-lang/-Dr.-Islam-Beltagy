-- 975: توحيد المواد الفعالة المتكررة (جداول 973 بس) — من غير حذف أي صف:
-- المادة المكررة بتتعلّم merged_into = المادة الأساسية، واسمها بيتضاف لأسامي الأساسية البديلة، والأدوية بتتربط بالأساسية.
-- قواعد التكرار: (1) نفس الاسم بعد التوحيد (sulphate=sulfate، vit=vitamin، حذف تركيز مكتوب في الآخر، فواصل/مسافات)
--                 (2) اسم مادة مكتوب كاسم بديل لمادة تانية (vitamin d3 ⇄ cholecalciferol).
-- الأساسية = اللي مربوط بيها أدوية أكتر.
alter table ortho_active_ingredients add column if not exists merged_into uuid references ortho_active_ingredients(id) on delete set null;
create index if not exists ortho_active_ingredients_merged on ortho_active_ingredients (merged_into) where merged_into is not null;

create or replace function ortho_ing_key(n text) returns text language sql immutable as $$
  select btrim(regexp_replace(regexp_replace(regexp_replace(regexp_replace(regexp_replace(lower(n),
    '\msulphate\M', 'sulfate', 'g'),
    '^vit\.?\s+', 'vitamin '),
    '\s*[\d.,]+\s*(mg|mcg|µg|iu|i\.u\.?|g|gm|%)\M.*$', ''),
    '[^a-z0-9 ]', ' ', 'g'),
    '\s+', ' ', 'g'))
$$;

create temp table ing_n on commit drop as
select i.id, i.name, ortho_ing_key(i.name) as k, (select count(*) from ortho_medication_ingredients l where l.ingredient_id = i.id) as n
from ortho_active_ingredients i where i.merged_into is null;

-- (1) نفس المفتاح
create temp table ing_map on commit drop as
select id, first_value(id) over (partition by k order by n desc, name) as canon from ing_n where k <> '';

-- (2) الاسم البديل: لو اسم مادة A (بعد التوحيد) موجود في أسامي B البديلة → يتدمجوا، الأساسية الأكبر
insert into ing_map (id, canon)
select a_c, b_c from (
  select distinct on (least(ma.canon, mb.canon), greatest(ma.canon, mb.canon))
    case when na.n >= nb.n then mb.canon else ma.canon end as a_c,
    case when na.n >= nb.n then ma.canon else mb.canon end as b_c
  from ortho_active_ingredients b
  cross join lateral unnest(b.synonyms) s
  join ing_n na on na.k = ortho_ing_key(s)
  join ing_map ma on ma.id = na.id
  join ing_map mb on mb.id = b.id
  join ing_n nb on nb.id = mb.canon
  where b.merged_into is null and ma.canon <> mb.canon and na.id = ma.canon
) x;

-- الأساسية النهائية (سلسلة واحدة كفاية: الخطوة 2 بتربط أساسيات الخطوة 1 ببعض)
create temp table ing_final on commit drop as
select m.id, coalesce((select m2.canon from ing_map m2 where m2.id = m.canon and m2.canon <> m.canon limit 1), m.canon) as canon
from (select id, (array_agg(canon order by canon = id))[1] as canon from ing_map group by id) m;

-- علّم المكرر + ضيف اسمه للأسامي البديلة للأساسية
update ortho_active_ingredients i set merged_into = f.canon from ing_final f where i.id = f.id and f.canon <> f.id;
update ortho_active_ingredients c set synonyms = (
  select coalesce(array_agg(distinct s), '{}') from (
    select unnest(c.synonyms) s union select d.name from ortho_active_ingredients d where d.merged_into = c.id union select unnest(d.synonyms) from ortho_active_ingredients d where d.merged_into = c.id
  ) x where lower(s) <> lower(c.name))
where exists (select 1 from ortho_active_ingredients d where d.merged_into = c.id);

-- الربط: كل دواء مربوط بمادة مكررة بيتربط كمان بالأساسية (الربط القديم بيفضل؛ الشاشات بتتجاهل المكررة لما الأساسية موجودة)
insert into ortho_medication_ingredients (medication_id, ingredient_id, strength, position)
select distinct on (l.medication_id, i.merged_into) l.medication_id, i.merged_into, l.strength, l.position
from ortho_medication_ingredients l join ortho_active_ingredients i on i.id = l.ingredient_id
where i.merged_into is not null
order by l.medication_id, i.merged_into, l.position
on conflict do nothing;

-- المعلومات الطبية: لو الأساسية فاضية والمكررة فيها نشرة، تتنقل (من غير ما نمسح من المكررة)
update ortho_active_ingredients c set
  reference_dose = case when c.reference_dose = '' then d.reference_dose else c.reference_dose end,
  indications = case when c.indications = '' then d.indications else c.indications end,
  contraindications = case when c.contraindications = '' then d.contraindications else c.contraindications end,
  warnings = case when c.warnings = '' then d.warnings else c.warnings end,
  side_effects = case when c.side_effects = '' then d.side_effects else c.side_effects end,
  interactions = case when c.interactions = '' then d.interactions else c.interactions end,
  info_source = case when c.info_source = '' or c.info_source like 'openFDA: مفيش%' then d.info_source else c.info_source end,
  info_updated_at = coalesce(c.info_updated_at, d.info_updated_at)
from (select distinct on (merged_into) * from ortho_active_ingredients where merged_into is not null and info_source like 'نشرة FDA%' order by merged_into, info_updated_at desc nulls last) d
where d.merged_into = c.id and (c.info_source = '' or c.info_source like 'openFDA: مفيش%');
