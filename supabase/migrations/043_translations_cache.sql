-- كاش الترجمة الآلية (عربي ↔ إنجليزي) لأي نص مكتوب في السيستم ومش موجود في القاموس الثابت
-- (أسماء، ملاحظات، تشخيص، إشعارات، أسماء خدمات...). كل نص بيتترجم مرة واحدة ويتشارك بين كل المستخدمين.
-- الكتابة والقراءة من Edge Function "translate" بس (service_role) — مفيش سياسات RLS للمستخدمين.
create table if not exists translations (
  source_hash text not null,          -- sha256(source)
  target text not null check (target in ('ar', 'en')),
  source text not null,
  result text not null,
  created_at timestamptz not null default now(),
  primary key (source_hash, target)
);
alter table translations enable row level security;
revoke all on translations from anon, authenticated;
