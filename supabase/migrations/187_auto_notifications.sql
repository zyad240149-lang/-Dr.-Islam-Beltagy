-- نظام الإشعارات التلقائية الموحّد (2026-10-21)
-- مبني فوق الموجود: جدول notifications (داخل التطبيق) + تريجر push_on_notification ← Edge Function "push" (Web Push / VAPID).
-- الجديد:
--   • notification_kinds / notification_prefs: إعدادات من القاعدة (تفعيل كل نوع، نص شاشة القفل، تذكيرات المواعيد، نسب التارجت).
--   • notifications: dedupe_key فريد (منع التكرار)، نص Push آمن منفصل عن نص التطبيق، تتبّع الإرسال/الوصول/الفتح/القراءة.
--   • notification_schedule: تذكيرات المواعيد (4/3/2/1 ساعة) مربوطة بالحجز — تتجدول/تتعاد/تتلغي تلقائيًا من تريجر على appointments.
--   • notifications_dispatch(): مهمة pg_cron كل دقيقة على الخادم (مش مؤقت في الواجهة) — بتبعت المستحق وتعيد محاولة الـ Push الفاشل.
--   • target_notice_log + notifications_check_targets(): إشعارات التارجت للأخصائي (مرة لكل نسبة في الشهر).
--   • ترحيب الحساب الجديد، فاتورة جديدة (أي مسار)، دفعة جديدة، تحديث الخطة، تغيير الموعد (أي مسار).

-- ============ 1) الإعدادات ============
create table if not exists notification_kinds (
  kind text primary key,
  label text not null,
  audience text not null check (audience in ('customer', 'staff')),
  enabled boolean not null default true,
  push_title text not null,          -- النص اللي بيظهر على شاشة القفل (من غير مبالغ ولا تشخيص)
  push_body text not null,
  link text,                         -- الصفحة اللي بتفتح لما يضغط على الإشعار
  sort int not null default 0,
  updated_at timestamptz,
  updated_by uuid references employees(id) on delete set null
);
alter table notification_kinds enable row level security;
drop policy if exists nk_staff_read on notification_kinds;
create policy nk_staff_read on notification_kinds for select using ((select is_staff()));

insert into notification_kinds (kind, label, audience, push_title, push_body, link, sort) values
  ('welcome',                 'ترحيب بعد إنشاء الحساب',            'customer', 'أهلًا بيك {name} 👋', 'يسعدنا انضمامك! تقدر تحجز مواعيدك وتتابع زياراتك وخطتك العلاجية من التطبيق.', '/me', 10),
  ('appointment_reminder',    'تذكير قبل الموعد',                  'customer', 'تذكير بموعدك', 'عندك موعد في عيادة د. إسلام بلتاجي بعد {hours}.', '/me/appointments', 20),
  ('appointment_new',         'استلام/تسجيل الحجز',                'customer', 'تم تسجيل حجزك', 'افتح التطبيق لتفاصيل موعدك.', '/me/appointments', 30),
  ('appointment_confirmed',   'تأكيد الموعد',                      'customer', 'تم تأكيد موعدك', 'افتح التطبيق لتفاصيل موعدك.', '/me/appointments', 40),
  ('appointment_rescheduled', 'تغيير الموعد',                      'customer', 'تم تغيير موعدك', 'افتح التطبيق لمعرفة موعدك الجديد.', '/me/appointments', 50),
  ('appointment_cancelled',   'إلغاء الموعد',                      'customer', 'تم إلغاء موعدك', 'افتح التطبيق للتفاصيل.', '/me/appointments', 60),
  ('visit_on_way',            'المعالج في الطريق (زيارة منزلية)',   'customer', 'المعالج في الطريق إليك', 'افتح التطبيق للتفاصيل.', '/me/appointments', 70),
  ('invoice',                 'فاتورة جديدة',                      'customer', 'فاتورة جديدة', 'تم إصدار فاتورة جديدة لحسابك. افتح التطبيق للاطلاع على التفاصيل.', '/me/invoices', 80),
  ('payment',                 'تسجيل دفعة',                        'customer', 'تم تسجيل دفعة', 'تم تسجيل دفعة على حسابك. افتح التطبيق للتفاصيل.', '/me/invoices', 90),
  ('payment_due',             'تذكير بمبلغ مستحق',                 'customer', 'تذكير بالفواتير', 'عندك مبلغ مستحق. افتح التطبيق للتفاصيل.', '/me/invoices', 100),
  ('plan_new',                'خطة علاجية جديدة',                  'customer', 'تم تجهيز خطتك العلاجية', 'تقدر تتابع تفاصيل خطتك ومراحلها من قسم الخطة العلاجية داخل التطبيق.', '/me/plans', 110),
  ('plan_updated',            'تحديث الخطة العلاجية',              'customer', 'تم تحديث خطتك العلاجية', 'افتح التطبيق لمراجعة التحديث.', '/me/plans', 120),
  ('session_completed',       'إكمال جلسة',                        'customer', 'اكتملت جلستك', 'شكرًا لالتزامك. التفاصيل في التطبيق.', '/me/plans', 130),
  ('plan_completed',          'إكمال الخطة/الباقة',                'customer', 'أكملت خطتك 🎉', 'نتمنى لك دوام الصحة.', '/me/plans', 140),
  ('target_progress',         'تحفيز: نسبة من التارجت',            'staff',    'أحسنت! 👏', 'وصلت إلى {pct}% من التارجت الشهري. كمّل، فاضل خطوة بسيطة على هدفك.', '/my-target', 200),
  ('target_reached',          'تحقيق التارجت',                     'staff',    'مبروك! 🎉', 'حققت التارجت الشهري بالكامل. استمر في نجاحك.', '/my-target', 210)
on conflict (kind) do nothing;

create table if not exists notification_prefs (
  id int primary key default 1 check (id = 1),
  reminder_offsets int[] not null default '{4,3,2,1}',     -- ساعات قبل الموعد
  target_thresholds int[] not null default '{80,100}',     -- نسب التارجت
  reminder_statuses text[] not null default '{new,confirmed,rescheduled}',
  updated_at timestamptz,
  updated_by uuid references employees(id) on delete set null
);
insert into notification_prefs (id) values (1) on conflict (id) do nothing;
alter table notification_prefs enable row level security;
drop policy if exists np_staff_read on notification_prefs;
create policy np_staff_read on notification_prefs for select using ((select is_staff()));

-- ============ 2) أعمدة جديدة على notifications ============
alter table notifications
  add column if not exists employee_id uuid references employees(id) on delete cascade,  -- إشعار شخصي لموظف (التارجت)
  add column if not exists dedupe_key text,
  add column if not exists event text,
  add column if not exists branch_id uuid,
  add column if not exists push_title text,
  add column if not exists push_body text,
  add column if not exists push_status text,          -- pending → sending → sent | no_device | failed | disabled
  add column if not exists push_attempts int not null default 0,
  add column if not exists push_last_at timestamptz,
  add column if not exists push_sent_at timestamptz,
  add column if not exists push_error text,
  add column if not exists delivered_at timestamptz,  -- الـ Service Worker على الجهاز استقبل الإشعار فعلًا
  add column if not exists opened_at timestamptz,     -- المستخدم ضغط على الإشعار
  add column if not exists read_at timestamptz,       -- اتعلّم مقروء داخل التطبيق
  add column if not exists receipt_token uuid not null default gen_random_uuid();
create unique index if not exists notifications_dedupe_uq on notifications (dedupe_key) where dedupe_key is not null;
create index if not exists notifications_employee_idx on notifications (employee_id) where employee_id is not null;
create index if not exists notifications_push_retry_idx on notifications (push_status, push_last_at) where push_status in ('pending', 'sending', 'failed');

-- الإشعار الشخصي للموظف يشوفه صاحبه بس (والإشعارات العامة للموظفين زي ما هي)
drop policy if exists staff_read on notifications;
create policy staff_read on notifications for select using (audience = 'staff' and employee_id is null and (select has_perm('notifications', 'view')));
drop policy if exists staff_update on notifications;
create policy staff_update on notifications for update using (audience = 'staff' and employee_id is null and (select has_perm('notifications', 'view')));
drop policy if exists staff_own_read on notifications;
create policy staff_own_read on notifications for select using (employee_id is not null and employee_id = (select my_employee_id()));
drop policy if exists staff_own_update on notifications;
create policy staff_own_update on notifications for update using (employee_id is not null and employee_id = (select my_employee_id()));

-- كتابة الأعمدة التقنية ممنوعة على المستخدم: تحديث العميل/الموظف لإشعاره = علامة «مقروء» بس
create or replace function notifications_guard_update() returns trigger
language plpgsql set search_path = public as $$
declare r boolean := new.read;
begin
  if current_user in ('authenticated', 'anon') then
    new := old;
    new.read := r;
  end if;
  if new.read and not coalesce(old.read, false) and new.read_at is null then new.read_at := now(); end if;
  return new;
end $$;
drop trigger if exists trg_notifications_guard_update on notifications;
create trigger trg_notifications_guard_update before update on notifications for each row execute function notifications_guard_update();

-- ============ 3) تجهيز كل إشعار قبل حفظه: التفعيل + منع التكرار + نص Push الآمن ============
create or replace function notifications_prepare() returns trigger
language plpgsql security definer set search_path = public as $$
declare k notification_kinds; nm text;
begin
  if new.audience = 'customer' or new.employee_id is not null then
    select * into k from notification_kinds where kind = new.kind;
    if k.kind is not null and not k.enabled then return null; end if;   -- النوع متوقف من الإعدادات
    -- مفتاح منع التكرار: لو المصدر ما حدّده — الأنواع اللي بتحصل مرة واحدة لكل سجل (فاتورة/خطة/حجز...) مفتاحها بالسجل بس،
    -- والباقي بالسجل + المحتوى (نفس الحدث بنفس النص = إشعار واحد مهما اتعاد تنفيذ الدالة)
    if new.dedupe_key is null and new.ref_id is not null and new.customer_id is not null then
      new.dedupe_key := new.kind || ':' || new.ref_id || ':' || new.customer_id ||
        case when new.kind in ('invoice', 'plan_new', 'welcome', 'appointment_new', 'appointment_cancelled', 'appointment_confirmed',
                               'plan_completed', 'session_completed', 'visit_on_way', 'payment')
             then '' else ':' || md5(coalesce(new.title, '') || '|' || coalesce(new.body, '')) end;
    end if;
    if new.dedupe_key is not null then
      perform pg_advisory_xact_lock(hashtext('notif:' || new.dedupe_key));
      if exists (select 1 from notifications where dedupe_key = new.dedupe_key) then return null; end if;
    end if;
    if new.customer_id is not null then select split_part(trim(name), ' ', 1) into nm from customers where id = new.customer_id; end if;
    new.push_title := coalesce(new.push_title, replace(coalesce(k.push_title, new.title), '{name}', coalesce(nm, '')));
    new.push_body := coalesce(new.push_body, replace(coalesce(k.push_body, new.body, ''), '{name}', coalesce(nm, '')));
    new.push_title := btrim(regexp_replace(new.push_title, '\s+', ' ', 'g'));
    new.link := coalesce(new.link, k.link);
    new.push_status := coalesce(new.push_status, 'pending');
  end if;
  return new;
end $$;
drop trigger if exists trg_notifications_prepare on notifications;
create trigger trg_notifications_prepare before insert on notifications for each row execute function notifications_prepare();

-- طلب الإرسال للـ Edge Function (pg_net) — من التريجر عند الإنشاء ومن المُرسِل الدوري عند إعادة المحاولة
create or replace function push_request(p_id uuid) returns void
language plpgsql security definer set search_path = public as $$
declare cfg push_config;
begin
  select * into cfg from push_config where id = 1;
  if cfg.notify_url is null then return; end if;
  update notifications set push_attempts = push_attempts + 1, push_last_at = now() where id = p_id;
  perform net.http_post(
    url := cfg.notify_url,
    headers := jsonb_build_object('Content-Type', 'application/json', 'x-push-secret', cfg.hook_secret),
    body := jsonb_build_object('notification_id', p_id),
    timeout_milliseconds := 15000);
end $$;
revoke execute on function push_request(uuid) from public, anon, authenticated;

create or replace function push_on_notification() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if new.push_status = 'pending' and ((new.audience = 'customer' and new.customer_id is not null) or new.employee_id is not null) then
    perform push_request(new.id);
  end if;
  return new;
exception when others then
  return new; -- فشل طلب الـ Push عمره ما يمنع تسجيل الإشعار — المُرسِل الدوري بيعيد المحاولة
end $$;
revoke execute on function push_on_notification() from public, anon, authenticated;
drop trigger if exists trg_push_on_notification on notifications;
create trigger trg_push_on_notification after insert on notifications for each row execute function push_on_notification();

-- إشعار لمريض بمفتاح منع تكرار (لكل حساب من حساباته) — نفس ربط الحسابات بتاع notify_patient
create or replace function notify_patient_keyed(p_patient uuid, p_kind text, p_title text, p_body text, p_ref text, p_key text,
  p_push_title text default null, p_push_body text default null, p_link text default null, p_event text default null, p_branch uuid default null)
returns int language plpgsql security definer set search_path = public as $$
declare n int;
begin
  insert into notifications (audience, customer_id, patient_id, kind, title, body, ref_id, dedupe_key, push_title, push_body, link, event, branch_id)
  select 'customer', c.id, p_patient, p_kind, p_title, p_body, p_ref, case when p_key is null then null else p_key || ':' || c.id end,
         p_push_title, p_push_body, p_link, p_event, p_branch
  from customers c join patients p on p.id = p_patient
  where c.patient_id = p_patient
     or (c.patient_id is null and right(regexp_replace(c.phone, '\D', '', 'g'), 9) = right(regexp_replace(p.phone, '\D', '', 'g'), 9));
  get diagnostics n = row_count;
  return n;
end $$;
revoke execute on function notify_patient_keyed(uuid, text, text, text, text, text, text, text, text, text, uuid) from public, anon, authenticated;

-- ============ 4) تذكيرات المواعيد ============
create table if not exists notification_schedule (
  id uuid primary key default gen_random_uuid(),
  dedupe_key text not null unique,
  kind text not null default 'appointment_reminder',
  appointment_id uuid references appointments(id) on delete cascade,
  patient_id uuid references patients(id) on delete cascade,
  branch_id uuid,
  offset_minutes int not null,
  appt_at timestamptz not null,
  scheduled_at timestamptz not null,
  status text not null default 'pending' check (status in ('pending', 'sent', 'cancelled', 'skipped', 'expired', 'failed')),
  attempts int not null default 0,
  last_error text,
  cancel_reason text,
  notification_count int,
  created_at timestamptz not null default now(),
  processed_at timestamptz
);
create index if not exists notification_schedule_due_idx on notification_schedule (scheduled_at) where status = 'pending';
create index if not exists notification_schedule_appt_idx on notification_schedule (appointment_id);
alter table notification_schedule enable row level security;
drop policy if exists ns_staff_read on notification_schedule;
create policy ns_staff_read on notification_schedule for select using ((select has_perm('notifications', 'view')));

create or replace function appt_at(p_date date, p_time text) returns timestamptz
language sql immutable set search_path = public as $$
  select ((p_date::text || ' ' || left(coalesce(nullif(p_time, ''), '00:00'), 5))::timestamp at time zone 'Africa/Cairo')
$$;

create or replace function hours_text(p_minutes int) returns text
language sql immutable set search_path = public as $$
  select case when p_minutes < 60 then p_minutes || ' دقيقة'
              when p_minutes = 60 then 'ساعة' when p_minutes = 120 then 'ساعتين'
              when p_minutes % 60 = 0 and p_minutes / 60 between 3 and 10 then (p_minutes / 60) || ' ساعات'
              when p_minutes % 60 = 0 then (p_minutes / 60) || ' ساعة'
              else round(p_minutes / 60.0, 1) || ' ساعة' end
$$;

-- يجدول/يعيد جدولة/يلغي تذكيرات موعد واحد حسب حالته ووقته الحالي والإعدادات
create or replace function sync_appointment_reminders(p_appt uuid) returns void
language plpgsql security definer set search_path = public as $$
declare a appointments; pr notification_prefs; v_at timestamptz; active boolean; h int; v_sched timestamptz; v_key text;
begin
  select * into a from appointments where id = p_appt;
  if a.id is null then return; end if;
  select * into pr from notification_prefs where id = 1;
  v_at := appt_at(a.date, a.time);
  active := a.status = any (pr.reminder_statuses)
            and coalesce((select enabled from notification_kinds where kind = 'appointment_reminder'), true)
            and v_at > now();
  update notification_schedule set status = 'cancelled', processed_at = now(),
         cancel_reason = case when not active then 'الموعد ' || a.status || ' أو انتهى أو التذكير متوقف' when appt_at <> v_at then 'تغيّر وقت الموعد' else 'تغيّرت إعدادات التذكير' end
   where appointment_id = a.id and status = 'pending'
     and (not active or appt_at <> v_at or not (offset_minutes / 60 = any (pr.reminder_offsets)));
  if not active then return; end if;
  foreach h in array pr.reminder_offsets loop
    v_sched := v_at - make_interval(hours => h);
    v_key := 'reminder:' || a.id || ':' || to_char(v_at at time zone 'Africa/Cairo', 'YYYYMMDDHH24MI') || ':' || (h * 60);
    insert into notification_schedule (dedupe_key, appointment_id, patient_id, branch_id, offset_minutes, appt_at, scheduled_at, status, processed_at, cancel_reason)
    values (v_key, a.id, a.patient_id, a.branch_id, h * 60, v_at, v_sched,
            case when v_sched <= now() then 'skipped' else 'pending' end,
            case when v_sched <= now() then now() end,
            case when v_sched <= now() then 'وقت التذكير فات وقت الحجز — ما بيتبعتش بأثر رجعي' end)
    on conflict (dedupe_key) do update set status = 'pending', processed_at = null, cancel_reason = null
      where notification_schedule.status = 'cancelled' and excluded.scheduled_at > now();
  end loop;
end $$;
revoke execute on function sync_appointment_reminders(uuid) from public, anon, authenticated;

-- ============ 5) أحداث المواعيد: التذكيرات + إشعار تغيير الموعد من أي مسار ============
create or replace function appointments_notify_events() returns trigger
language plpgsql security definer set search_path = public as $$
declare self_change boolean;
begin
  begin
    perform sync_appointment_reminders(new.id);
  exception when others then raise warning 'sync_appointment_reminders: %', sqlerrm; -- التذكير عمره ما يمنع الحجز
  end;
  if tg_op = 'UPDATE' and (old.date, old.time) is distinct from (new.date, new.time)
     and new.status in ('new', 'confirmed', 'rescheduled') and old.status in ('new', 'confirmed', 'rescheduled')
     and old.xmin::text <> (txid_current() % 4294967296)::text then   -- مش نفس معاملة الإنشاء
    -- المريض اللي غيّر موعده بنفسه من التطبيق ما يحتاج إشعار عن تغييره
    self_change := exists (select 1 from customers c where c.auth_user_id = auth.uid() and c.patient_id = new.patient_id);
    if not self_change then
      begin
        perform notify_patient_keyed(new.patient_id, 'appointment_rescheduled', 'تم تغيير موعدك',
          'موعدك الجديد يوم ' || new.date || ' الساعة ' || new.time, new.id::text,
          'resched:' || new.id || ':' || new.date || ' ' || new.time, null, null, null, 'appointment.rescheduled', new.branch_id);
      exception when others then raise warning 'appointment_rescheduled notify: %', sqlerrm;
      end;
    end if;
  end if;
  return null;
end $$;
drop trigger if exists trg_appointments_notify_events on appointments;
create trigger trg_appointments_notify_events after insert or update of date, time, status, patient_id on appointments
  for each row execute function appointments_notify_events();

-- reschedule_appointment كانت بتبعت إشعارها بنفسها — دلوقتي التريجر فوق بيغطي كل المسارات، فنشيل الإشعار المكرر منها
do $$
declare def text; nd text;
begin
  select pg_get_functiondef('reschedule_appointment(uuid,date,text,uuid,text)'::regprocedure) into def;
  nd := regexp_replace(def, E'[ \\t]*perform notify_patient\\(a\\.patient_id, ''appointment_rescheduled''[^\\n]*\\n', '');
  if nd = def then raise exception '187: reschedule_appointment'; end if;
  execute nd;
  -- run_automations: تذكير المريض القديم (مرة واحدة قبل الموعد، وبيشتغل بس لما موظف فاتح النظام) اتستبدل بالتذكيرات المجدولة على الخادم
  select pg_get_functiondef('run_automations()'::regprocedure) into def;
  nd := regexp_replace(def, E'[ \\t]*perform notify_patient\\(r\\.patient_id, ''appointment_reminder''[^\\n]*\\n', '');
  if nd = def then raise exception '187: run_automations'; end if;
  execute nd;
end $$;

-- ============ 6) الحساب الجديد / الفاتورة / الدفعة / الخطة ============
create or replace function customers_welcome() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  begin
    insert into notifications (audience, customer_id, patient_id, kind, title, body, ref_id, dedupe_key, event, link)
    values ('customer', new.id, new.patient_id, 'welcome', 'أهلًا بيك في عيادة د. إسلام بلتاجي 👋',
      'يسعدنا انضمامك إلينا. تقدر تحجز مواعيدك وتتابع زياراتك وخطتك العلاجية وفواتيرك من التطبيق.',
      new.id::text, 'welcome:' || new.id, 'customer.created', '/me');
  exception when others then raise warning 'welcome notify: %', sqlerrm;
  end;
  return null;
end $$;
drop trigger if exists trg_customers_welcome on customers;
create trigger trg_customers_welcome after insert on customers for each row execute function customers_welcome();

create or replace function invoices_notify_issued() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if new.patient_id is not null and new.status not in ('draft', 'cancelled')
     and (tg_op = 'INSERT' or old.status in ('draft')) then
    begin
      -- نفس شكل المفتاح التلقائي (invoice:<id>:<customer>) — فأي مسار تاني بيبعت «فاتورة» لنفس الفاتورة بيتمنع تكراره
      perform notify_patient_keyed(new.patient_id, 'invoice', 'فاتورة جديدة رقم ' || new.no,
        'تم إصدار فاتورة رقم ' || new.no || ' بإجمالي ' || new.total || ' ر.س. التفاصيل والمدفوعات في صفحة الفواتير.',
        new.id::text, 'invoice:' || new.id, null, null, '/me/invoices', 'invoice.issued', null);
    exception when others then raise warning 'invoice notify: %', sqlerrm;
    end;
  end if;
  return null;
end $$;
drop trigger if exists trg_invoices_notify_issued on invoices;
create trigger trg_invoices_notify_issued after insert or update of status on invoices for each row execute function invoices_notify_issued();

create or replace function payments_notify() returns trigger
language plpgsql security definer set search_path = public as $$
declare inv invoices;
begin
  if new.voided_at is null and new.amount > 0 then
    select * into inv from invoices where id = new.invoice_id;
    begin
      perform notify_patient_keyed(coalesce(new.patient_id, inv.patient_id), 'payment', 'تم تسجيل دفعة',
        'تم تسجيل دفعة ' || new.amount || ' ر.س على الفاتورة ' || coalesce(inv.no, '') || '. المتبقي ' || coalesce(inv.remaining, 0) || ' ر.س.',
        new.id::text, 'payment:' || new.id, null, null, '/me/invoices', 'payment.recorded', null);
    exception when others then raise warning 'payment notify: %', sqlerrm;
    end;
  end if;
  return null;
end $$;
drop trigger if exists trg_payments_notify on payments;
-- deferred عشان المتبقي في الرسالة يكون بعد recalc_invoice في نفس المعاملة
create constraint trigger trg_payments_notify after insert on payments deferrable initially deferred for each row execute function payments_notify();

create or replace function plans_notify_update() returns trigger
language plpgsql security definer set search_path = public as $$
declare sig text;
begin
  -- تحديث «مهم» بس: عدد الجلسات/الوتيرة/المدة/البداية/الخدمة/الطبيب — والحفظ من غير تغيير فعلي ما بيبعتش حاجة
  if (old.total_sessions, old.sessions_per_week, old.duration_weeks, old.start_date, old.service_id, old.therapist_id)
     is not distinct from (new.total_sessions, new.sessions_per_week, new.duration_weeks, new.start_date, new.service_id, new.therapist_id) then return null; end if;
  if old.xmin::text = (txid_current() % 4294967296)::text then return null; end if;  -- اتعملت في نفس المعاملة (إنشاء) → plan_new بيغطيها
  sig := md5(concat_ws('|', new.total_sessions, new.sessions_per_week, new.duration_weeks, new.start_date, new.service_id, new.therapist_id));
  begin
    perform notify_patient_keyed(new.patient_id, 'plan_updated', 'تم تحديث خطتك العلاجية',
      'خطتك الآن ' || new.total_sessions || ' جلسة (' || new.sessions_per_week || ' أسبوعيًا) تبدأ ' || coalesce(new.start_date::text, '') || '. التفاصيل في صفحة الخطة العلاجية.',
      new.id::text, 'plan_updated:' || new.id || ':' || sig, null, null, '/me/plans', 'plan.updated', null);
  exception when others then raise warning 'plan_updated notify: %', sqlerrm;
  end;
  return null;
end $$;
drop trigger if exists trg_plans_notify_update on treatment_plans;
create trigger trg_plans_notify_update after update on treatment_plans for each row execute function plans_notify_update();

-- اشتراك جهاز جديد: لو رسالة الترحيب اتسجّلت قبل ما المريض يفعّل الإشعارات (ما كانش عنده جهاز) نبعتها للجهاز الجديد مرة واحدة
create or replace function save_push_subscription(p_endpoint text, p_p256dh text, p_auth text, p_user_agent text default '') returns void
language plpgsql security definer set search_path = public as $$
declare nid uuid;
begin
  if auth.uid() is null then raise exception 'غير مصرح' using errcode = '42501'; end if;
  if coalesce(p_endpoint, '') !~ '^https://' or coalesce(p_p256dh, '') = '' or coalesce(p_auth, '') = '' then raise exception 'بيانات اشتراك غير صالحة'; end if;
  insert into push_subscriptions (auth_user_id, endpoint, p256dh, auth, user_agent)
  values (auth.uid(), p_endpoint, p_p256dh, p_auth, left(coalesce(p_user_agent, ''), 300))
  on conflict (endpoint) do update set auth_user_id = auth.uid(), p256dh = excluded.p256dh, auth = excluded.auth, user_agent = excluded.user_agent;
  select n.id into nid from notifications n join customers c on c.id = n.customer_id
   where c.auth_user_id = auth.uid() and n.kind = 'welcome' and n.push_status = 'no_device' and n.created_at > now() - interval '3 days' limit 1;
  if nid is not null then
    update notifications set push_status = 'pending' where id = nid;
    perform push_request(nid);
  end if;
end $$;
revoke all on function save_push_subscription(text, text, text, text) from public, anon;
grant execute on function save_push_subscription(text, text, text, text) to authenticated;

-- ============ 7) التارجت ============
create table if not exists target_notice_log (
  id bigserial primary key,
  therapist_id uuid not null references therapists(id) on delete cascade,
  period text not null,
  threshold int not null,
  pct_at numeric,
  notified boolean not null default false,
  created_at timestamptz not null default now(),
  unique (therapist_id, period, threshold)
);
alter table target_notice_log enable row level security;
drop policy if exists tnl_gm_read on target_notice_log;
create policy tnl_gm_read on target_notice_log for select using ((select has_perm('notifications', 'view')));

create or replace function notifications_check_targets() returns int
language plpgsql security definer set search_path = public as $$
declare pr notification_prefs; per text := to_char(riyadh_today(), 'YYYY-MM'); t record; c jsonb; v_pct numeric; thr int; top int; n int := 0; e record;
  k notification_kinds; did_insert boolean;
begin
  select * into pr from notification_prefs where id = 1;
  for t in select th.id, th.name from therapists th where th.active and exists (select 1 from employees em where em.therapist_id = th.id and em.active) loop
    c := therapist_target_calc(t.id, per, (select id from payroll_dues where therapist_id = t.id and period = per));
    v_pct := nullif(c->>'pct', '')::numeric;
    if v_pct is null then continue; end if;   -- ما فيه تارجت محدد
    top := null;
    foreach thr in array (select array_agg(x order by x) from unnest(pr.target_thresholds) x) loop
      if v_pct >= thr then
        insert into target_notice_log (therapist_id, period, threshold, pct_at) values (t.id, per, thr, v_pct)
          on conflict (therapist_id, period, threshold) do nothing;
        get diagnostics n = row_count;
        did_insert := n > 0;
        if did_insert then top := thr; end if;
      end if;
    end loop;
    if top is null then continue; end if;   -- ما فيه نسبة جديدة اتعدّت الشهر ده
    -- لو عدّى أكتر من نسبة مرة واحدة: إشعار واحد بأعلاها
    select * into k from notification_kinds where kind = case when top >= 100 then 'target_reached' else 'target_progress' end;
    for e in select id from employees where therapist_id = t.id and active loop
      insert into notifications (audience, employee_id, kind, title, body, ref_id, dedupe_key, push_title, push_body, link, event)
      values ('staff', e.id, k.kind,
        case when top >= 100 then 'مبروك! حققت التارجت الشهري 🎉' else 'أحسنت! وصلت إلى ' || top || '% من التارجت' end,
        case when top >= 100 then 'حققت ' || round(v_pct) || '% من تارجت ' || per || '. استمر في نجاحك.'
             else 'وصلت إلى ' || round(v_pct) || '% من تارجت ' || per || '. كمّل، فاضل خطوة بسيطة على تحقيق هدفك.' end,
        t.id::text, 'target:' || t.id || ':' || per || ':' || top || ':' || e.id,
        replace(k.push_title, '{pct}', top::text), replace(k.push_body, '{pct}', top::text), k.link, 'target.threshold');
    end loop;
    update target_notice_log set notified = true where therapist_id = t.id and period = per and threshold = top;
  end loop;
  return 0;
end $$;
revoke execute on function notifications_check_targets() from public, anon, authenticated;

-- ============ 8) المُرسِل الدوري (pg_cron كل دقيقة) ============
create or replace function notifications_dispatch() returns jsonb
language plpgsql security definer set search_path = public as $$
declare r notification_schedule; nr record; a appointments; svc text; n int; sent int := 0; skipped int := 0; retried int := 0; k notification_kinds; v_at timestamptz; sts text[];
begin
  select * into k from notification_kinds where kind = 'appointment_reminder';
  select reminder_statuses into sts from notification_prefs where id = 1;
  for r in select * from notification_schedule where status = 'pending' and scheduled_at <= now()
           order by scheduled_at limit 300 for update skip locked loop
    begin
      if r.scheduled_at < now() - interval '20 minutes' then
        -- الخادم كان واقف وقت التذكير: ما بنبعتش بأثر رجعي
        update notification_schedule set status = 'expired', processed_at = now(), cancel_reason = 'فات وقته (الخادم ما كانش شغّال)' where id = r.id;
        skipped := skipped + 1; continue;
      end if;
      select * into a from appointments where id = r.appointment_id;
      v_at := case when a.id is null then null else appt_at(a.date, a.time) end;
      if a.id is null or not (a.status = any (sts))
         or v_at is distinct from r.appt_at or v_at <= now() or not coalesce(k.enabled, true) then
        update notification_schedule set status = 'cancelled', processed_at = now(),
          cancel_reason = case when a.id is null then 'الموعد اتحذف' when v_at <= now() then 'الموعد بدأ أو انتهى' when not coalesce(k.enabled, true) then 'التذكير متوقف من الإعدادات' else 'الموعد اتغيّر أو اتلغى' end
         where id = r.id;
        skipped := skipped + 1; continue;
      end if;
      select name into svc from services where id = a.service_id;
      n := notify_patient_keyed(a.patient_id, 'appointment_reminder', 'تذكير بموعدك بعد ' || hours_text(r.offset_minutes),
        'موعدك ' || coalesce(svc, '') || ' يوم ' || a.date || ' الساعة ' || a.time || ' — بعد ' || hours_text(r.offset_minutes) || '.',
        a.id::text, r.dedupe_key, null, replace(coalesce(k.push_body, 'عندك موعد بعد {hours}.'), '{hours}', hours_text(r.offset_minutes)),
        null, 'appointment.reminder', r.branch_id);
      update notification_schedule set status = case when n > 0 then 'sent' else 'skipped' end, processed_at = now(), notification_count = n,
             cancel_reason = case when n = 0 then 'المريض ما عنده حساب في التطبيق' end, attempts = attempts + 1
       where id = r.id;
      sent := sent + n;
    exception when others then
      update notification_schedule set attempts = attempts + 1, last_error = left(sqlerrm, 500),
             status = case when attempts + 1 >= 3 then 'failed' else 'pending' end where id = r.id;
    end;
  end loop;
  -- إعادة محاولة الـ Push: الفاشل، أو اللي ما وصلش للدالة (طلب pg_net ضاع)، أو اللي علِق في «جاري الإرسال»
  update notifications set push_status = 'failed', push_error = coalesce(push_error, 'انتهت مهلة الإرسال')
   where push_status = 'sending' and push_last_at < now() - interval '10 minutes';
  for nr in select id from notifications
            where push_status in ('pending', 'failed') and push_attempts < 3
              and coalesce(push_last_at, created_at) < now() - interval '5 minutes' and created_at > now() - interval '6 hours'
            order by created_at limit 50 loop
    perform push_request(nr.id); retried := retried + 1;
  end loop;
  return jsonb_build_object('reminders', sent, 'skipped', skipped, 'pushRetried', retried);
end $$;
revoke execute on function notifications_dispatch() from public, anon, authenticated;

-- ============ 9) إعدادات الإدارة (RPC) ============
create or replace function notification_settings() returns jsonb
language plpgsql stable security definer set search_path = public as $$
begin
  perform require_perm('settings', 'view');
  return jsonb_build_object(
    'kinds', (select coalesce(jsonb_agg(jsonb_build_object('kind', kind, 'label', label, 'audience', audience, 'enabled', enabled,
                'pushTitle', push_title, 'pushBody', push_body, 'link', link) order by sort), '[]') from notification_kinds),
    'prefs', (select jsonb_build_object('reminderOffsets', reminder_offsets, 'targetThresholds', target_thresholds, 'updatedAt', updated_at) from notification_prefs where id = 1));
end $$;

create or replace function save_notification_settings(p jsonb) returns void
language plpgsql security definer set search_path = public as $$
declare emp uuid := require_perm('settings', 'edit'); x jsonb; offs int[]; thrs int[]; old_offs int[]; a record;
begin
  for x in select * from jsonb_array_elements(coalesce(p->'kinds', '[]')) loop
    if length(trim(coalesce(x->>'pushTitle', ''))) < 2 then raise exception 'عنوان الإشعار مطلوب لكل نوع'; end if;
    update notification_kinds set enabled = coalesce((x->>'enabled')::boolean, enabled),
      push_title = left(trim(x->>'pushTitle'), 80), push_body = left(trim(coalesce(x->>'pushBody', '')), 200),
      updated_at = now(), updated_by = emp
     where kind = x->>'kind';
  end loop;
  if p ? 'reminderOffsets' then
    select array_agg(distinct v::int order by v::int desc) into offs from jsonb_array_elements_text(p->'reminderOffsets') v;
    if offs is null then offs := '{}'; end if;
    if cardinality(offs) > 6 or exists (select 1 from unnest(offs) o where o < 1 or o > 48) then raise exception 'تذكيرات المواعيد: من 1 إلى 48 ساعة، و6 تذكيرات بالكثير'; end if;
  end if;
  if p ? 'targetThresholds' then
    select array_agg(distinct v::int order by v::int) into thrs from jsonb_array_elements_text(p->'targetThresholds') v;
    if thrs is null then thrs := '{}'; end if;
    if cardinality(thrs) > 5 or exists (select 1 from unnest(thrs) t where t < 1 or t > 200) then raise exception 'نسب التارجت: من 1 إلى 200، و5 نسب بالكثير'; end if;
  end if;
  select reminder_offsets into old_offs from notification_prefs where id = 1;
  update notification_prefs set reminder_offsets = coalesce(offs, reminder_offsets), target_thresholds = coalesce(thrs, target_thresholds),
         updated_at = now(), updated_by = emp where id = 1;
  -- لو اتغيّرت التذكيرات أو اتوقفت/اتفعّلت: نعيد جدولة المواعيد الجاية كلها
  for a in select id from appointments where date >= riyadh_today() - 1 and status in ('new', 'confirmed', 'rescheduled') loop
    perform sync_appointment_reminders(a.id);
  end loop;
  perform log_action('تعديل إعدادات الإشعارات التلقائية');
end $$;

-- حالات الإرسال للإدارة: آخر الإشعارات وحالتها + التذكيرات المجدولة + ملخص
create or replace function notification_delivery_report(p_days int default 7) returns jsonb
language plpgsql stable security definer set search_path = public as $$
declare since timestamptz := now() - make_interval(days => least(greatest(coalesce(p_days, 7), 1), 90));
begin
  perform require_perm('settings', 'view');
  return jsonb_build_object(
    'summary', (select coalesce(jsonb_object_agg(s, c), '{}') from (select coalesce(push_status, 'none') s, count(*) c from notifications
                 where created_at >= since and (audience = 'customer' or employee_id is not null) group by 1) x),
    'delivered', (select count(*) from notifications where created_at >= since and delivered_at is not null),
    'opened', (select count(*) from notifications where created_at >= since and opened_at is not null),
    'read', (select count(*) from notifications where created_at >= since and read and (audience = 'customer' or employee_id is not null)),
    'recent', (select coalesce(jsonb_agg(row_to_json(x) order by x.created_at desc), '[]') from (
        select n.id, n.created_at, n.kind, k.label, n.title, n.push_status, n.push_attempts, n.push_error, n.push_sent_at, n.delivered_at, n.opened_at, n.read,
               coalesce(c.name, em.name) as recipient
          from notifications n left join notification_kinds k on k.kind = n.kind
          left join customers c on c.id = n.customer_id left join employees em on em.id = n.employee_id
         where n.created_at >= since and (n.audience = 'customer' or n.employee_id is not null)
         order by n.created_at desc limit 100) x),
    'scheduled', (select coalesce(jsonb_agg(row_to_json(x) order by x.scheduled_at), '[]') from (
        select s.id, s.scheduled_at, s.appt_at, s.offset_minutes, s.status, s.cancel_reason, s.last_error, a.no as appointment_no, p.full_name as patient
          from notification_schedule s left join appointments a on a.id = s.appointment_id left join patients p on p.id = s.patient_id
         where s.scheduled_at >= now() - interval '1 day' and s.scheduled_at <= now() + interval '3 days'
         order by s.scheduled_at limit 150) x),
    'cron', (select coalesce(jsonb_agg(jsonb_build_object('job', jobname, 'schedule', schedule, 'active', active)), '[]') from cron.job where jobname like 'notifications-%'));
end $$;

revoke execute on function notification_settings(), save_notification_settings(jsonb), notification_delivery_report(int) from public, anon;
grant execute on function notification_settings(), save_notification_settings(jsonb), notification_delivery_report(int) to authenticated;
revoke execute on function appt_at(date, text), hours_text(int) from public, anon;
grant execute on function appt_at(date, text), hours_text(int) to authenticated;
revoke execute on function notifications_prepare(), notifications_guard_update(), appointments_notify_events(), customers_welcome(),
  invoices_notify_issued(), payments_notify(), plans_notify_update() from public, anon, authenticated;

-- ============ 10) جدولة المواعيد الجاية الموجودة دلوقتي + مهام الخادم ============
do $$
declare a record;
begin
  for a in select id from appointments where date >= riyadh_today() and status in ('new', 'confirmed', 'rescheduled') loop
    perform sync_appointment_reminders(a.id);
  end loop;
end $$;

select cron.unschedule(jobid) from cron.job where jobname in ('notifications-dispatch', 'notifications-targets');
select cron.schedule('notifications-dispatch', '* * * * *', $$select public.notifications_dispatch()$$);
select cron.schedule('notifications-targets', '*/10 * * * *', $$select public.notifications_check_targets()$$);
