-- الامتدادات المطلوبة قبل أي هجرة (pg_net للإشعارات، pg_cron للمهام الدورية)
create extension if not exists pg_net;
create extension if not exists pg_cron;
