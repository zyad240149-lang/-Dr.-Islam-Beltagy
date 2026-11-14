-- 973: قاعدة بيانات دوائية — كلها إضافة، مفيش أي حذف أو تعديل لبيانات موجودة.
-- (1) ortho_active_ingredients: المواد الفعالة كجدول مستقل + معلوماتها الطبية (تحذيرات/موانع/آثار/جرعة مرجعية) بمصدرها وحالة مراجعتها.
-- (2) ortho_medication_ingredients: ربط كل دواء تجاري بمواده الفعالة (يدعم الأدوية المركبة) + تركيز كل مادة.
-- (3) ortho_med_internal: بيانات داخلية للطبيب بس لكل دواء (الشركة، بلد المنشأ، حجم العبوة، ملاحظات الطبيب) — صلاحية قسم «الأدوية» بس، ومش بتتطبع.
-- (4) ortho_med_prices: سجل أسعار (السعر، العملة، البلد، عبوة ولا وحدة، تاريخ التحقق، المصدر) — صلاحية قسم «الأدوية» بس.
-- (5) ortho_med_groups: ترتيب مجموعات الأدوية — بيتزامن بين الأجهزة.
-- (6) أعمدة إضافية في البنك: التركيز، الشكل الصيدلاني، حالة اكتمال البيانات، المصدر.

-- (6) أعمدة البنك
alter table ortho_medications add column if not exists strength text not null default '';
alter table ortho_medications add column if not exists dosage_form text not null default '';
alter table ortho_medications add column if not exists data_status text not null default 'needs_review';
alter table ortho_medications add column if not exists info_source text not null default '';
do $$ begin
  if not exists (select 1 from pg_constraint where conname = 'ortho_medications_data_status_chk') then
    alter table ortho_medications add constraint ortho_medications_data_status_chk check (data_status in ('needs_review', 'partial', 'verified'));
  end if;
end $$;
create index if not exists ortho_medications_sci_lower on ortho_medications (lower(scientific_name));

-- (1) المواد الفعالة
create table if not exists ortho_active_ingredients (
  id uuid primary key default gen_random_uuid(),
  name text not null,                               -- الاسم الموحّد (lowercase)
  synonyms text[] not null default '{}',            -- أسامي تانية (مثال: acetaminophen)
  drug_class text not null default '',
  reference_dose text not null default '',          -- جرعة مرجعية للمراجعة — مش بتتملى لوحدها في الروشتة
  indications text not null default '',
  contraindications text not null default '',
  warnings text not null default '',
  side_effects text not null default '',
  interactions text not null default '',
  info_source text not null default '',
  info_updated_at date,
  data_status text not null default 'needs_review' check (data_status in ('needs_review', 'partial', 'verified')),
  created_by uuid references employees(id) on delete set null default my_employee_id(),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create unique index if not exists ortho_active_ingredients_name_uq on ortho_active_ingredients (lower(name));

-- (2) ربط الدواء بمواده
create table if not exists ortho_medication_ingredients (
  medication_id uuid not null references ortho_medications(id) on delete cascade,
  ingredient_id uuid not null references ortho_active_ingredients(id) on delete cascade,
  strength text not null default '',
  position int not null default 0,
  primary key (medication_id, ingredient_id)
);
create index if not exists ortho_medication_ingredients_ing on ortho_medication_ingredients (ingredient_id);

-- التعبئة الأولى من المادة الفعالة المكتوبة في البنك (A+B+C) — بيشيل اللي بين القوسين ويحطه اسم بديل
with parts as (
  select m.id as medication_id, ord - 1 as position,
         lower(btrim(regexp_replace(p, '\s*\(.*?\)\s*', ' ', 'g'))) as base,
         nullif(lower(btrim(substring(p from '\((.*?)\)'))), '') as syn
  from ortho_medications m, unnest(string_to_array(m.scientific_name, '+')) with ordinality as t(p, ord)
  where btrim(m.scientific_name) <> ''
), clean as (
  select medication_id, position, regexp_replace(base, '\s+', ' ', 'g') as base, syn from parts where btrim(base) <> ''
)
insert into ortho_active_ingredients (name, synonyms, created_by)
select base, coalesce(array_agg(distinct syn) filter (where syn is not null), '{}'), null from clean group by base
on conflict (lower(name)) do nothing;

with parts as (
  select m.id as medication_id, ord - 1 as position,
         regexp_replace(lower(btrim(regexp_replace(p, '\s*\(.*?\)\s*', ' ', 'g'))), '\s+', ' ', 'g') as base
  from ortho_medications m, unnest(string_to_array(m.scientific_name, '+')) with ordinality as t(p, ord)
  where btrim(m.scientific_name) <> ''
)
insert into ortho_medication_ingredients (medication_id, ingredient_id, position)
select distinct on (p.medication_id, i.id) p.medication_id, i.id, p.position
from parts p join ortho_active_ingredients i on lower(i.name) = p.base
where p.base <> ''
on conflict do nothing;

-- (3) البيانات الداخلية للطبيب
create table if not exists ortho_med_internal (
  id uuid primary key default gen_random_uuid(),
  medication_id uuid not null unique references ortho_medications(id) on delete cascade,
  company text not null default '',
  origin_country text not null default '',
  pack_size text not null default '',
  doctor_notes text not null default '',            -- ملاحظات الطبيب — مش بتتطبع ولا بتتبعت للمريض
  info_source text not null default '',
  updated_by uuid references employees(id) on delete set null default my_employee_id(),
  updated_at timestamptz not null default now()
);

-- (4) الأسعار — كل تحديث سعر سطر جديد (التاريخ محفوظ)، والحالي = أحدث verified_at
create table if not exists ortho_med_prices (
  id uuid primary key default gen_random_uuid(),
  medication_id uuid not null references ortho_medications(id) on delete cascade,
  price numeric(12, 2) not null check (price >= 0),
  currency text not null default 'EGP',
  country text not null default 'EG',
  price_basis text not null default 'pack' check (price_basis in ('pack', 'unit')),
  pack_size text not null default '',
  company text not null default '',
  verified_at date not null,
  source text not null check (btrim(source) <> ''),
  created_by uuid references employees(id) on delete set null default my_employee_id(),
  created_at timestamptz not null default now()
);
create index if not exists ortho_med_prices_med on ortho_med_prices (medication_id, verified_at desc);

-- (5) ترتيب المجموعات
create table if not exists ortho_med_groups (
  name text primary key,
  position int not null default 0,
  updated_at timestamptz not null default now()
);

-- الصلاحيات
alter table ortho_active_ingredients enable row level security;
alter table ortho_medication_ingredients enable row level security;
alter table ortho_med_internal enable row level security;
alter table ortho_med_prices enable row level security;
alter table ortho_med_groups enable row level security;
revoke all on ortho_active_ingredients, ortho_medication_ingredients, ortho_med_internal, ortho_med_prices, ortho_med_groups from anon;
grant select, insert, update, delete on ortho_active_ingredients, ortho_medication_ingredients, ortho_med_internal, ortho_med_prices, ortho_med_groups to authenticated;

do $$
declare t record;
begin
  for t in select * from (values
    -- الجدول، القراءة
    ('ortho_active_ingredients', '(select has_perm(''patients'', ''view'')) or (select has_perm(''medications'', ''view'')) or (select has_perm(''diagnosis'', ''view''))'),
    ('ortho_medication_ingredients', '(select has_perm(''patients'', ''view'')) or (select has_perm(''medications'', ''view'')) or (select has_perm(''diagnosis'', ''view''))'),
    ('ortho_med_groups', '(select has_perm(''patients'', ''view'')) or (select has_perm(''medications'', ''view'')) or (select has_perm(''diagnosis'', ''view''))'),
    -- الداخلي للطبيب: قسم «الأدوية» بس
    ('ortho_med_internal', '(select has_perm(''medications'', ''view''))'),
    ('ortho_med_prices', '(select has_perm(''medications'', ''view''))')
  ) v(tbl, rd) loop
    execute format('drop policy if exists staff_read on %I', t.tbl);
    execute format('create policy staff_read on %I for select using (%s)', t.tbl, t.rd);
    execute format('drop policy if exists staff_insert on %I', t.tbl);
    execute format('create policy staff_insert on %I for insert with check ((select has_perm(''medications'', ''create'')) or (select has_perm(''medications'', ''edit'')))', t.tbl);
    execute format('drop policy if exists staff_update on %I', t.tbl);
    execute format('create policy staff_update on %I for update using ((select has_perm(''medications'', ''edit''))) with check ((select has_perm(''medications'', ''edit'')))', t.tbl);
    execute format('drop policy if exists staff_delete on %I', t.tbl);
    execute format('create policy staff_delete on %I for delete using ((select has_perm(''medications'', ''delete'')) or (select is_admin()))', t.tbl);
  end loop;
end $$;

-- updated_at + سجل المراجعة (بعد التعبئة الأولى عشان مايتعملش ٣٠ ألف سطر مراجعة)
drop trigger if exists trg_touch on ortho_active_ingredients;
create trigger trg_touch before update on ortho_active_ingredients for each row execute function ortho_touch();
drop trigger if exists trg_touch on ortho_med_internal;
create trigger trg_touch before update on ortho_med_internal for each row execute function ortho_touch();
drop trigger if exists trg_touch on ortho_med_groups;
create trigger trg_touch before update on ortho_med_groups for each row execute function ortho_touch();
drop trigger if exists trg_audit on ortho_active_ingredients;
create trigger trg_audit after insert or update or delete on ortho_active_ingredients for each row execute function audit_row();
drop trigger if exists trg_audit on ortho_med_internal;
create trigger trg_audit after insert or update or delete on ortho_med_internal for each row execute function audit_row();
drop trigger if exists trg_audit on ortho_med_prices;
create trigger trg_audit after insert or update or delete on ortho_med_prices for each row execute function audit_row();
