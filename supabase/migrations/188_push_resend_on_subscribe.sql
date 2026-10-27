-- تفعيل الإشعارات بعد الحدث بشوية (2026-10-21، تجربة حقيقية): المريض حجز وبعدها بثواني فعّل الإشعارات على الآيفون،
-- فإشعار «تم استلام حجزك» و«فاتورة جديدة» اتسجلوا «بدون جهاز» وما وصلوش. دلوقتي أول اشتراك لجهاز بيبعت له:
--   • الترحيب لو اتسجّل من غير جهاز خلال آخر 3 أيام (زي 187)
--   • أي إشعار تاني اتسجّل «بدون جهاز» خلال آخر 30 دقيقة (بحد 5) — مرة واحدة لكل إشعار (الحالة بتتغيّر)
create or replace function save_push_subscription(p_endpoint text, p_p256dh text, p_auth text, p_user_agent text default '') returns void
language plpgsql security definer set search_path = public as $$
declare r record;
begin
  if auth.uid() is null then raise exception 'غير مصرح' using errcode = '42501'; end if;
  if coalesce(p_endpoint, '') !~ '^https://' or coalesce(p_p256dh, '') = '' or coalesce(p_auth, '') = '' then raise exception 'بيانات اشتراك غير صالحة'; end if;
  insert into push_subscriptions (auth_user_id, endpoint, p256dh, auth, user_agent)
  values (auth.uid(), p_endpoint, p_p256dh, p_auth, left(coalesce(p_user_agent, ''), 300))
  on conflict (endpoint) do update set auth_user_id = auth.uid(), p256dh = excluded.p256dh, auth = excluded.auth, user_agent = excluded.user_agent;
  for r in select n.id from notifications n
            left join customers c on c.id = n.customer_id
            left join employees e on e.id = n.employee_id
           where (c.auth_user_id = auth.uid() or e.auth_user_id = auth.uid()) and n.push_status = 'no_device'
             and ((n.kind = 'welcome' and n.created_at > now() - interval '3 days') or n.created_at > now() - interval '30 minutes')
           order by n.created_at desc limit 6 loop
    update notifications set push_status = 'pending', push_error = null where id = r.id;
    perform push_request(r.id);
  end loop;
end $$;
revoke all on function save_push_subscription(text, text, text, text) from public, anon;
grant execute on function save_push_subscription(text, text, text, text) to authenticated;
