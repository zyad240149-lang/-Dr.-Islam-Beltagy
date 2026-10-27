-- إشعارات المريض كانت بتتسجل جوه النظام بس (notify_patient / الحملات) ومفيش أي حاجة بتبعتها Push للجهاز.
-- الإصلاح: أي إشعار جديد للعميل (audience='customer') بيبعت طلب للـ Edge Function "push/notify" عبر pg_net،
-- والدالة بتبعته لكل أجهزة المريض المشتركة وتسجّل النتيجة في push_logs.
create extension if not exists pg_net;

-- إعداد خاص بالخادم (بدون سياسات RLS = service_role بس): رابط الدالة والسر المشترك
create table if not exists push_config (
  id int primary key default 1 check (id = 1),
  notify_url text not null,
  hook_secret text not null
);
alter table push_config enable row level security;

create table if not exists push_logs (
  id bigserial primary key,
  created_at timestamptz not null default now(),
  notification_id uuid,
  auth_user_id uuid,
  source text not null default 'notification', -- notification / test / campaign_site
  endpoint_host text,
  status text not null, -- sent / failed / expired / no_device
  status_code int,
  error text
);
create index if not exists push_logs_created_idx on push_logs(created_at desc);
create index if not exists push_logs_notif_idx on push_logs(notification_id);
alter table push_logs enable row level security;
drop policy if exists push_logs_staff_read on push_logs;
create policy push_logs_staff_read on push_logs for select using (has_perm('notifications', 'view'));

create or replace function push_on_notification() returns trigger
language plpgsql security definer set search_path = public as $$
declare cfg push_config;
begin
  if new.audience <> 'customer' or new.customer_id is null then return new; end if;
  select * into cfg from push_config where id = 1;
  if cfg.notify_url is null then return new; end if;
  perform net.http_post(
    url := cfg.notify_url,
    headers := jsonb_build_object('Content-Type', 'application/json', 'x-push-secret', cfg.hook_secret),
    body := jsonb_build_object('notification_id', new.id),
    timeout_milliseconds := 15000);
  return new;
exception when others then
  return new; -- فشل الـ Push عمره ما يمنع تسجيل الإشعار نفسه
end $$;
revoke execute on function push_on_notification() from public, anon, authenticated;

drop trigger if exists trg_push_on_notification on notifications;
create trigger trg_push_on_notification after insert on notifications for each row execute function push_on_notification();
