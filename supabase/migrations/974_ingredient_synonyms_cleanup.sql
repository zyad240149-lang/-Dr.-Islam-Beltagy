-- 974: تنضيف الأسامي البديلة للمواد الفعالة (جدول 973 الجديد بس): اللي بين القوسين كان أحيانًا تركيز (30 mg) مش اسم —
-- بيتشال من الأسامي البديلة، و«as cholecalciferol» تبقى «cholecalciferol». مفيش لمس لأي جدول قديم.
update ortho_active_ingredients set synonyms = coalesce((
  select array_agg(distinct s2) from (
    select btrim(regexp_replace(s, '^as\s+', '')) as s2 from unnest(synonyms) s
  ) x
  where s2 <> '' and s2 !~ '^[\d.,\s]+(mg|mcg|µg|iu|i\.u\.?|g|gm|%|ml|u|million|billion|cfu)?[\s\w./]*$' and s2 !~ '^\d'
    and lower(s2) <> lower(ortho_active_ingredients.name)
), '{}')
where cardinality(synonyms) > 0;
