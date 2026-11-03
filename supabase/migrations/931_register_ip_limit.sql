-- 931: حد لإنشاء حسابات المرضى من الموقع لكل جهاز/شبكة — عشان محدش يغرق النظام بحسابات وهمية.
-- بنحفظ بصمة (hash) لعنوان الـ IP مش العنوان نفسه، والجدول مقفول تمامًا (Edge Function بمفتاح الخدمة بس) وبيتمسح بعد يومين.
create table if not exists register_ip_log (
  id bigserial primary key,
  ip_hash text not null,
  created_at timestamptz not null default now()
);
create index if not exists register_ip_log_ip on register_ip_log(ip_hash, created_at desc);
alter table register_ip_log enable row level security;
revoke all on register_ip_log from anon, authenticated, public;
revoke all on sequence register_ip_log_id_seq from anon, authenticated, public;

select cron.unschedule(jobid) from cron.job where jobname = 'register-ip-log-prune';
select cron.schedule('register-ip-log-prune', '23 4 * * *', $$delete from public.register_ip_log where created_at < now() - interval '2 days'$$);
