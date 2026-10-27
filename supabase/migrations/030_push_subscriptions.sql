-- Web Push: اشتراكات أجهزة المستخدمين (موظفين أو مرضى) — كل مستخدم يشوف/يعدّل اشتراكاته هو بس.
-- الإرسال الفعلي من Edge Function "push" بمفتاح VAPID الخاص (سر في Supabase، مش في الفرونت إند).
create table if not exists push_subscriptions (
  id uuid primary key default gen_random_uuid(),
  auth_user_id uuid not null references auth.users(id) on delete cascade,
  endpoint text not null unique,
  p256dh text not null,
  auth text not null,
  user_agent text not null default '',
  created_at timestamptz not null default now(),
  last_used_at timestamptz
);
create index if not exists push_subscriptions_user_idx on push_subscriptions(auth_user_id);
alter table push_subscriptions enable row level security;
drop policy if exists push_own_select on push_subscriptions;
create policy push_own_select on push_subscriptions for select using (auth_user_id = auth.uid());
-- الكتابة عبر الدوال تحت بس (مفيش insert/update/delete مباشر)

create or replace function save_push_subscription(p_endpoint text, p_p256dh text, p_auth text, p_user_agent text default '') returns void
language plpgsql security definer set search_path = public as $$
begin
  if auth.uid() is null then raise exception 'غير مصرح' using errcode = '42501'; end if;
  if coalesce(p_endpoint, '') !~ '^https://' or coalesce(p_p256dh, '') = '' or coalesce(p_auth, '') = '' then raise exception 'بيانات اشتراك غير صالحة'; end if;
  insert into push_subscriptions (auth_user_id, endpoint, p256dh, auth, user_agent)
  values (auth.uid(), p_endpoint, p_p256dh, p_auth, left(coalesce(p_user_agent, ''), 300))
  on conflict (endpoint) do update set auth_user_id = auth.uid(), p256dh = excluded.p256dh, auth = excluded.auth, user_agent = excluded.user_agent;
end $$;

create or replace function delete_push_subscription(p_endpoint text) returns void
language sql security definer set search_path = public as $$
  delete from push_subscriptions where endpoint = p_endpoint and auth_user_id = auth.uid();
$$;

revoke all on function save_push_subscription(text, text, text, text) from public, anon;
revoke all on function delete_push_subscription(text) from public, anon;
grant execute on function save_push_subscription(text, text, text, text) to authenticated;
grant execute on function delete_push_subscription(text) to authenticated;
