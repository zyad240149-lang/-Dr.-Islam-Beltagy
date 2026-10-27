-- مراجعة أمان وأداء شاملة (2026-09-30) — نتيجة Supabase Advisors + فحص يدوي لكل الدوال القابلة للاستدعاء.
-- 1) دوال داخلية كانت قابلة للاستدعاء من أي حد (حتى من غير تسجيل دخول) — أخطرها award_loyalty_points
--    (كان أي زائر يقدر يدّي أي مريض نقاط ولاء بلا حدود). الدوال دي بتتنادى من دوال/تريجرات تانية بس.
-- 2) صلاحيات الزائر (anon) على الجداول اتشالت بالكامل — الموقع العام بيستخدم public_catalog/busy_slots بس.
-- 3) search_path ثابت لكل الدوال المتبقية. 4) إصلاح إعادة جدولة المريض لموعد من غير طبيب.
-- 5) فهارس لكل المفاتيح الأجنبية اللي من غير فهرس. 6) عمود requested_by في translations لحد يومي لترجمات غير الموظفين.

-- ---------- 1) دوال داخلية: مفيش استدعاء مباشر من العملاء ----------
do $$
declare f record;
begin
  for f in
    select p.oid::regprocedure as sig from pg_proc p
    where p.pronamespace = 'public'::regnamespace
      and p.proname in ('award_loyalty_points', 'attendance_schedule', 'attendance_status', 'is_on_leave', 'active_plan_id',
                        'find_discount_code', 'zatca_invoice_locked', 'fill_therapist_services', 'free_therapists_count', 'check_slot')
  loop
    execute format('revoke execute on function %s from public, anon, authenticated', f.sig);
  end loop;
  -- دوال التريجر: ماينفعش تتنادى كـ RPC أصلًا، بس نشيلها من الزائر للنظافة
  for f in
    select p.oid::regprocedure as sig from pg_proc p
    where p.pronamespace = 'public'::regnamespace and pg_get_function_result(p.oid) = 'trigger'
  loop
    execute format('revoke execute on function %s from public, anon', f.sig);
  end loop;
end $$;

-- أي دالة جديدة بعد كده: للمسجّلين بس (مش للزائر) — والمتاح للزائر لازم يتمنح صراحةً
alter default privileges in schema public revoke execute on functions from public;
alter default privileges in schema public grant execute on functions to authenticated;

-- المتاح للزائر عمدًا (الموقع العام): الكتالوج والأوقات المحجوزة واشتراك إشعارات الزوار
grant execute on function public_catalog(), busy_slots(uuid, date) to anon;
do $$ begin
  execute 'grant execute on function save_site_push_subscription(text, text, text, text), delete_site_push_subscription(text) to anon';
exception when undefined_function then null; end $$;

-- ---------- 2) الجداول: الزائر مالوش أي وصول مباشر، والمسجّل مالوش TRUNCATE/TRIGGER/REFERENCES ----------
revoke all on all tables in schema public from anon;
revoke all on all sequences in schema public from anon;
revoke truncate, trigger, references on all tables in schema public from authenticated;
alter default privileges in schema public revoke all on tables from anon;
alter default privileges in schema public revoke all on sequences from anon;
alter default privileges in schema public revoke truncate, trigger, references on tables from authenticated;

-- ---------- 3) search_path ثابت ----------
do $$
declare f record;
begin
  for f in
    select p.oid::regprocedure as sig from pg_proc p
    where p.pronamespace = 'public'::regnamespace and p.prokind = 'f'
      and not exists (select 1 from unnest(coalesce(p.proconfig, '{}')) c where c like 'search_path=%')
      and not exists (select 1 from pg_depend d where d.objid = p.oid and d.deptype = 'e') -- دوال الإضافات (extensions) ملهاش دعوة
  loop
    execute format('alter function %s set search_path = public', f.sig);
  end loop;
end $$;

-- ---------- 4) المريض يعيد جدولة موعد من غير طبيب (حجز البوابة/التطبيق) ----------
-- قبل كده check_slot كان بيترفض دايمًا بـ «المعالج غير موجود» لأن حجز المريض بيتسجل من غير طبيب لحد ما الاستقبال يأكد.
create or replace function patient_reschedule(p_id uuid, p_date date, p_time text) returns void
language plpgsql security definer set search_path = public as $$
declare c customers; a appointments; hrs int; pat patients; bs booking_settings; sched jsonb; free int; pending int;
begin
  c := require_patient();
  select bst.* into bs from booking_settings bst order by created_at limit 1;
  if bs.id is not null and not bs.allow_patient_rescheduling then raise exception 'تعديل الموعد من البوابة موقوف — تواصل مع المركز'; end if;
  select * into a from appointments where id = p_id and patient_id = c.patient_id for update;
  if a.id is null then raise exception 'الموعد غير موجود'; end if;
  if a.status not in ('new','confirmed','rescheduled') then raise exception 'لا يمكن تعديل موعد بحالته الحالية'; end if;
  select cancel_before_hours into hrs from center_info limit 1;
  if (a.date + a.time::time) - (now() at time zone 'Africa/Cairo') < make_interval(hours => coalesce(hrs, 24)) then
    raise exception 'لا يمكن تعديل الموعد قبله بأقل من % ساعة — تواصل مع المركز', coalesce(hrs, 24);
  end if;
  if a.therapist_id is not null then
    perform check_slot(a.therapist_id, p_date, p_time, a.duration_min, p_id);
  else
    -- نفس قاعدة patient_book: المركز فاتح + الوقت جوّه ساعاته + فيه طبيب فاضي أكتر من الحجوزات اللي لسه من غير طبيب
    if p_time !~ '^\d{2}:\d{2}$' then raise exception 'صيغة الوقت غير صحيحة'; end if;
    if p_date < riyadh_today() then raise exception 'لا يمكن الحجز في تاريخ سابق'; end if;
    select e.value into sched from center_info ci, jsonb_array_elements(ci.week_schedule) e where e.value->>'day' = lower(to_char(p_date, 'Dy')) limit 1;
    if sched is null or not coalesce((sched->>'open')::boolean, false) then raise exception 'المركز مغلق في هذا اليوم'; end if;
    if p_time < sched->>'from' or p_time >= sched->>'to' then raise exception 'الوقت خارج ساعات عمل المركز (% - %)', sched->>'from', sched->>'to'; end if;
    free := free_therapists_count(a.service_id, p_date, p_time, a.duration_min);
    select count(*) into pending from appointments x where x.therapist_id is null and x.date = p_date and x.id <> p_id
      and x.status not in ('cancelled','no_show','completed')
      and p_time::time < x.time::time + make_interval(mins => x.duration_min) and x.time::time < p_time::time + make_interval(mins => a.duration_min);
    if free - pending < 1 then raise exception 'الوقت ده اتحجز — اختر وقت تاني'; end if;
  end if;
  update appointments set date = p_date, time = p_time, status = 'rescheduled', updated_at = now() where id = p_id;
  update invoices set date = p_date where appointment_id = p_id and status in ('due','draft');
  select * into pat from patients where id = a.patient_id;
  perform notify_staff('appointment_rescheduled', 'المريض غيّر موعده', pat.full_name || ' — ' || a.no || ' إلى ' || p_date || ' ' || p_time, a.no, '/appointments', pat.id);
end $$;
revoke execute on function patient_reschedule(uuid, date, text) from public, anon;
grant execute on function patient_reschedule(uuid, date, text) to authenticated;

-- ---------- 5) فهارس المفاتيح الأجنبية ----------
do $$
declare r record; cols text; idx text;
begin
  for r in
    select c.conname, c.conrelid::regclass as tbl, c.conrelid, c.conkey
    from pg_constraint c
    where c.contype = 'f' and c.connamespace = 'public'::regnamespace
      and not exists (
        select 1 from pg_index i
        where i.indrelid = c.conrelid and (i.indkey::int2[])[0:array_length(c.conkey, 1) - 1] = c.conkey)
  loop
    select string_agg(quote_ident(a.attname), ', ' order by k.ord) into cols
    from unnest(r.conkey) with ordinality k(attnum, ord) join pg_attribute a on a.attrelid = r.conrelid and a.attnum = k.attnum;
    idx := left(r.conname, 55) || '_idx';
    execute format('create index if not exists %I on %s (%s)', idx, r.tbl, cols);
  end loop;
end $$;

-- ---------- 6) حد يومي لترجمات غير الموظفين (Edge Function translate) ----------
alter table translations add column if not exists requested_by uuid;
create index if not exists translations_requested_by_idx on translations (requested_by, created_at);
