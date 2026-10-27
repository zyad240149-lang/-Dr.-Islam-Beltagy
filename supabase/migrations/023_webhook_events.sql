-- جدول أحداث الـ Webhooks الواردة من خدمات خارجية (Edge Function "webhook").
-- عام الآن (provider='generic' للاختبار)، وقابل لاستقبال مزودين حقيقيين لاحقًا (tabby/tamara/...)
-- بدون أي تغيير في الجدول — يكفي إضافة سر جديد باسم WEBHOOK_SECRET_<PROVIDER>.
create table if not exists public.webhook_events (
  id uuid primary key default gen_random_uuid(),
  provider text not null,
  event_id text not null,
  event_type text,
  payload jsonb not null,
  headers jsonb,
  status text not null default 'received' check (status in ('received', 'processed', 'failed', 'ignored', 'duplicate')),
  error text,
  received_at timestamptz not null default now(),
  processed_at timestamptz,
  unique (provider, event_id)
);

create index if not exists webhook_events_provider_idx on public.webhook_events (provider, received_at desc);

alter table public.webhook_events enable row level security;
-- لا سياسات وصول للعميل/الموظف عبر anon أو authenticated — القراءة والكتابة فقط عبر service_role
-- داخل Edge Function "webhook" (نفس نمط جدول activity_log وباقي الجداول التشغيلية الحساسة).
revoke all on public.webhook_events from anon, authenticated;
