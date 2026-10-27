-- إشعارات تطبيق الموقع العام: أي زائر ثبّت التطبيق ووافق على الإشعارات (حتى من غير حساب) بيتسجّل اشتراكه هنا
-- بـ source='site'. الإرسال ليهم من لوحة الإدارة («إشعارات المرضى» ← إشعار لكل من ثبّت التطبيق) عبر Edge Function "push".
alter table push_subscriptions alter column auth_user_id drop not null;
alter table push_subscriptions add column if not exists source text not null default 'app' check (source in ('app','site'));
create index if not exists push_subscriptions_source_idx on push_subscriptions(source);

-- الحفظ متاح للزائر (anon): بنقبل بس روابط خدمات الإشعارات المعروفة — عشان محدش يسجّل رابط عشوائي
-- والخادم يبعت له طلبات (SSRF) — ومفتاحي التشفير لازم يكونوا بطول منطقي.
create or replace function save_site_push_subscription(p_endpoint text, p_p256dh text, p_auth text, p_user_agent text default '') returns void
language plpgsql security definer set search_path = public as $$
declare host text := lower(substring(coalesce(p_endpoint, '') from '^https://([^/:]+)'));
begin
  if host is null or not (host = 'fcm.googleapis.com' or host = 'web.push.apple.com' or host like '%.push.services.mozilla.com'
     or host = 'updates.push.services.mozilla.com' or host like '%.notify.windows.com') then
    raise exception 'رابط اشتراك غير مدعوم';
  end if;
  if length(coalesce(p_p256dh, '')) not between 60 and 120 or length(coalesce(p_auth, '')) not between 16 and 40 or length(p_endpoint) > 1000 then
    raise exception 'بيانات اشتراك غير صالحة';
  end if;
  insert into push_subscriptions (auth_user_id, endpoint, p256dh, auth, user_agent, source)
  values (auth.uid(), p_endpoint, p_p256dh, p_auth, left(coalesce(p_user_agent, ''), 300), 'site')
  on conflict (endpoint) do update set p256dh = excluded.p256dh, auth = excluded.auth, user_agent = excluded.user_agent,
    auth_user_id = coalesce(auth.uid(), push_subscriptions.auth_user_id);
end $$;

-- إلغاء الاشتراك: معرفة رابط الاشتراك نفسه (سر في المتصفح) = إثبات الملكية
create or replace function delete_site_push_subscription(p_endpoint text) returns void
language sql security definer set search_path = public as $$
  delete from push_subscriptions where endpoint = p_endpoint and source = 'site';
$$;

-- عدد الأجهزة المشتركة (لعرضه في لوحة الإدارة قبل الإرسال)
create or replace function site_push_count() returns int
language plpgsql stable security definer set search_path = public as $$
begin
  perform require_perm('notifications', 'view');
  return (select count(*) from push_subscriptions where source = 'site');
end $$;

revoke all on function save_site_push_subscription(text, text, text, text), delete_site_push_subscription(text), site_push_count() from public;
grant execute on function save_site_push_subscription(text, text, text, text), delete_site_push_subscription(text) to anon, authenticated;
grant execute on function site_push_count() to authenticated;
