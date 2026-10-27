-- 157: مواعيد كل دكتور حسب جدوله المسجّل فعليًا (طلب المستخدم 2026-10-18 — بيلغي قرار 061 «من غير قيد دوام الطبيب»)
-- المصدر الوحيد للإتاحة على الخادم = doctor_day_window(): بيستخدمها check_slot (كل الحجوزات والتعديلات) وdoctor_day_slots (بوابة المريض + الموقع)
-- القواعد: المركز فاتح + مش عطلة + الدكتور مش في إجازة + اليوم من أيام عمله + بداية الموعد ≥ بداية دوامه
--          + الموعد يخلص قبل/مع نهاية دوامه + بداية الموعد ≤ إغلاق المركز (062) + مايتقاطعش مع استراحته أو استئذان معتمد
--          + مايتقاطعش مع موعد تاني لنفس الدكتور. كل حسابات الوقت بالدقايق (كانت time + interval بتلف بعد 12 بالليل فتعدّي تعارض 23:00).

create or replace function public._hm(p text) returns int
language sql immutable set search_path to 'public'
as $$ select case when p ~ '^\d{2}:\d{2}$' then split_part(p, ':', 1)::int * 60 + split_part(p, ':', 2)::int end $$;

create or replace function public.doctor_day_window(p_therapist uuid, p_date date)
returns jsonb language plpgsql stable security definer set search_path to 'public'
as $$
declare th therapists; sched jsonb; wh jsonb; d text := lower(to_char(p_date, 'Dy')); blocks jsonb := '[]';
begin
  select * into th from therapists where id = p_therapist;
  if th.id is null or not th.active then return jsonb_build_object('status', 'no_doctor'); end if;
  select e.value into sched from center_info c, jsonb_array_elements(c.week_schedule) e where e.value->>'day' = d limit 1;
  if sched is null or not coalesce((sched->>'open')::boolean, false) then return jsonb_build_object('status', 'closed'); end if;
  if exists (select 1 from holidays h where h.date = p_date and h.active and (h.branch_id is null or h.branch_id = th.branch_id)) then
    return jsonb_build_object('status', 'holiday');
  end if;
  if exists (select 1 from jsonb_array_elements(coalesce(th.on_leave, '[]')) l where p_date between (l.value->>'from')::date and (l.value->>'to')::date)
     or exists (select 1 from staff_requests r join employees e on e.id = r.employee_id
                where e.therapist_id = p_therapist and r.status = 'approved' and r.type = 'leave' and p_date between r.from_date and r.to_date) then
    return jsonb_build_object('status', 'leave');
  end if;
  if jsonb_typeof(th.work_hours) is distinct from 'array' or jsonb_array_length(th.work_hours) = 0 then return jsonb_build_object('status', 'no_hours'); end if;
  select e.value into wh from jsonb_array_elements(th.work_hours) e where e.value->>'day' = d limit 1;
  if wh is null or _hm(wh->>'from') is null or _hm(wh->>'to') is null or _hm(wh->>'from') >= _hm(wh->>'to') then
    return jsonb_build_object('status', 'off_day');
  end if;
  if _hm(wh->>'breakFrom') is not null and _hm(wh->>'breakTo') > _hm(wh->>'breakFrom') then
    blocks := blocks || jsonb_build_array(jsonb_build_object('from', _hm(wh->>'breakFrom'), 'to', _hm(wh->>'breakTo')));
  end if;
  select blocks || coalesce(jsonb_agg(jsonb_build_object('from', _hm(r.from_time), 'to', _hm(r.to_time))), '[]') into blocks
  from staff_requests r join employees e on e.id = r.employee_id
  where e.therapist_id = p_therapist and r.status = 'approved' and r.type = 'permission' and p_date between r.from_date and r.to_date
    and _hm(r.from_time) is not null and _hm(r.to_time) > _hm(r.from_time);
  return jsonb_build_object('status', 'ok',
    'centerFrom', sched->>'from', 'centerTo', sched->>'to', 'doctorFrom', wh->>'from', 'doctorTo', wh->>'to',
    'start', greatest(_hm(sched->>'from'), _hm(wh->>'from')), 'lastStart', _hm(sched->>'to'), 'end', _hm(wh->>'to'), 'blocks', blocks);
end $$;

-- سبب رفض وقت معيّن جوّه نافذة اليوم (null = الوقت ده يصلح): before/after_center/after_doctor/blocked
create or replace function public.doctor_window_reason(w jsonb, t int, dur int)
returns text language sql immutable set search_path to 'public'
as $$
  select case
    when t < _hm(w->>'centerFrom') or t > _hm(w->>'centerTo') then 'center'
    when t < _hm(w->>'doctorFrom') or t + dur > _hm(w->>'doctorTo') then 'doctor'
    when exists (select 1 from jsonb_array_elements(w->'blocks') b where t < (b.value->>'to')::int and (b.value->>'from')::int < t + dur) then 'blocked'
  end
$$;

create or replace function public.check_slot(p_therapist uuid, p_date date, p_time text, p_dur integer, p_exclude uuid default null::uuid)
returns void language plpgsql security definer set search_path to 'public'
as $function$
declare th therapists; w jsonb; t int; why text;
begin
  if p_therapist is null then raise exception 'يجب اختيار الدكتور قبل تأكيد الحجز.'; end if;
  select * into th from therapists where id = p_therapist;
  if th.id is null or not th.active then raise exception 'الدكتور غير موجود أو غير نشط — اختر دكتورًا آخر'; end if;
  if p_time !~ '^\d{2}:\d{2}$' then raise exception 'صيغة الوقت غير صحيحة'; end if;
  if p_date < riyadh_today() then raise exception 'لا يمكن الحجز في تاريخ سابق'; end if;
  if coalesce(p_dur, 0) <= 0 then raise exception 'مدة الجلسة غير صحيحة'; end if;
  w := doctor_day_window(p_therapist, p_date);
  case w->>'status'
    when 'closed' then raise exception 'المركز مغلق في هذا اليوم';
    when 'holiday' then raise exception 'المركز مغلق في هذا اليوم — اختر يومًا آخر';
    when 'leave' then raise exception 'الدكتور في إجازة في هذا التاريخ';
    when 'no_hours' then raise exception 'لم يتم تحديد مواعيد عمل لهذا الدكتور — حدّدها من «المعالجين» أولًا';
    when 'off_day' then raise exception 'الدكتور لا يعمل في هذا اليوم — اختر يومًا من أيام عمله';
    when 'ok' then null;
    else raise exception 'الدكتور غير متاح';
  end case;
  t := _hm(p_time);
  why := doctor_window_reason(w, t, p_dur);
  if why = 'center' then raise exception 'الوقت خارج ساعات عمل المركز (% - %)', w->>'centerFrom', w->>'centerTo'; end if;
  if why = 'doctor' then raise exception 'الوقت خارج مواعيد عمل الدكتور (% - %)', w->>'doctorFrom', w->>'doctorTo'; end if;
  if why = 'blocked' then raise exception 'الدكتور غير متاح في هذا الوقت (استراحة أو استئذان)'; end if;

  -- قفل لكل (دكتور + يوم): حجزين في نفس اللحظة بيتنفذوا واحد ورا التاني، والتاني بيشوف حجز الأول ويترفض
  perform pg_advisory_xact_lock(hashtext(p_therapist::text || p_date::text));
  if exists (select 1 from appointments a
             where a.therapist_id = p_therapist and a.date = p_date and a.status <> 'cancelled' and a.id is distinct from p_exclude
               and t < _hm(a.time) + a.duration_min and _hm(a.time) < t + p_dur) then
    raise exception 'عذرًا، هذا الموعد تم حجزه للتو. يرجى اختيار موعد آخر.';
  end if;
end $function$;

-- أوقات دكتور في يوم (بوابة المريض + الموقع العام): بس الأوقات اللي جوّه دوامه، وavailable=false = محجوز
create or replace function public.doctor_day_slots(p_therapist uuid, p_service text, p_date date)
returns jsonb language plpgsql stable security definer set search_path to 'public'
as $function$
declare th therapists; svc services; w jsonb; step int; t int; dur int; now_min int; is_today boolean; out jsonb := '[]'; busy boolean; hhmm text;
begin
  if p_therapist is null then return jsonb_build_object('status', 'no_doctor', 'slots', '[]'::jsonb); end if;
  select * into th from therapists where id = p_therapist and active;
  if th.id is null then return jsonb_build_object('status', 'no_doctor', 'slots', '[]'::jsonb); end if;
  select * into svc from services where id = p_service and active;
  if svc.id is null or not exists (select 1 from therapist_services ts where ts.therapist_id = p_therapist and ts.service_id = p_service) then
    return jsonb_build_object('status', 'not_offered', 'slots', '[]'::jsonb);
  end if;
  if p_date < riyadh_today() then return jsonb_build_object('status', 'past', 'slots', '[]'::jsonb); end if;
  w := doctor_day_window(p_therapist, p_date);
  if w->>'status' <> 'ok' then return jsonb_build_object('status', w->>'status', 'slots', '[]'::jsonb); end if;
  step := greatest(coalesce((select slot_step_min from center_info limit 1), 30), 5);
  dur := svc.duration_min;
  is_today := p_date = riyadh_today();
  now_min := extract(hour from now() at time zone 'Africa/Cairo')::int * 60 + extract(minute from now() at time zone 'Africa/Cairo')::int;
  t := _hm(w->>'centerFrom');
  while t <= (w->>'lastStart')::int loop
    if doctor_window_reason(w, t, dur) is null then
      hhmm := lpad((t / 60)::text, 2, '0') || ':' || lpad((t % 60)::text, 2, '0');
      if is_today and t <= now_min then
        out := out || jsonb_build_array(jsonb_build_object('time', hhmm, 'available', false, 'past', true));
      else
        busy := exists (select 1 from appointments a where a.therapist_id = p_therapist and a.date = p_date and a.status <> 'cancelled'
                        and t < _hm(a.time) + a.duration_min and _hm(a.time) < t + dur);
        out := out || jsonb_build_array(jsonb_build_object('time', hhmm, 'available', not busy));
      end if;
    end if;
    t := t + step;
  end loop;
  return jsonb_build_object('status', 'ok', 'slots', out, 'doctorFrom', w->>'doctorFrom', 'doctorTo', w->>'doctorTo');
end $function$;

-- شبكة الأمان على الجدول: نفس حساب التعارض بالدقايق
create or replace function public.appointments_no_overlap()
returns trigger language plpgsql security definer set search_path to 'public'
as $function$
begin
  if new.therapist_id is null or new.status = 'cancelled' then return new; end if;
  if current_setting('app.allow_overlap', true) = 'on' then return new; end if; -- حضور مباشر من «حضور مرضى الباقات»
  perform pg_advisory_xact_lock(hashtext(new.therapist_id::text || new.date::text));
  if exists (select 1 from appointments a where a.therapist_id = new.therapist_id and a.date = new.date and a.status <> 'cancelled' and a.id is distinct from new.id
             and _hm(new.time) < _hm(a.time) + a.duration_min and _hm(a.time) < _hm(new.time) + new.duration_min) then
    raise exception 'عذرًا، هذا الموعد تم حجزه للتو. يرجى اختيار موعد آخر.';
  end if;
  return new;
end $function$;

-- للوحة الإدارة: العطلات + إجازات/استئذانات الأطباء المعتمدة (من غير السبب) — عشان الأوقات المعروضة تطابق check_slot
-- (جدول staff_requests مقفول RLS على صاحب الطلب والمدير، فالاستقبال ماكانش بيشوف إجازة الدكتور)
create or replace function public.schedule_blocks()
returns jsonb language plpgsql stable security definer set search_path to 'public'
as $$
begin
  if not is_staff() then raise exception 'غير مصرح'; end if;
  return jsonb_build_object(
    'holidays', coalesce((select jsonb_agg(jsonb_build_object('date', h.date, 'branchId', h.branch_id)) from holidays h where h.active and h.date >= riyadh_today() - 1), '[]'),
    'requests', coalesce((select jsonb_agg(jsonb_build_object('therapistId', e.therapist_id, 'type', r.type, 'from', r.from_date, 'to', r.to_date, 'fromTime', r.from_time, 'toTime', r.to_time))
                          from staff_requests r join employees e on e.id = r.employee_id
                          where e.therapist_id is not null and r.status = 'approved' and r.type in ('leave', 'permission') and r.to_date >= riyadh_today() - 1), '[]'));
end $$;

revoke all on function public.doctor_day_window(uuid, date) from public, anon;
revoke all on function public.schedule_blocks() from public, anon;
grant execute on function public.schedule_blocks() to authenticated;
grant execute on function public.doctor_day_window(uuid, date) to authenticated;
revoke all on function public.check_slot(uuid, date, text, integer, uuid) from anon;
grant execute on function public._hm(text) to anon, authenticated;
grant execute on function public.doctor_window_reason(jsonb, int, int) to anon, authenticated;
grant execute on function public.doctor_day_slots(uuid, text, date) to anon, authenticated;

-- ساعات الدكتور مكانها واحد: ملف المعالج (therapists.work_hours) هو اللي الحجز بيقرا منه، وحساب الموظف المربوط بيتزامن معاه في الاتجاهين
create or replace function public.sync_therapist_hours_to_employee()
returns trigger language plpgsql security definer set search_path to 'public'
as $$
begin
  update employees set work_hours = new.work_hours where therapist_id = new.id and work_hours is distinct from new.work_hours;
  return new;
end $$;
create or replace function public.sync_employee_hours_to_therapist()
returns trigger language plpgsql security definer set search_path to 'public'
as $$
begin
  if new.therapist_id is not null then
    update therapists set work_hours = coalesce(new.work_hours, '[]') where id = new.therapist_id and work_hours is distinct from coalesce(new.work_hours, '[]');
  end if;
  return new;
end $$;
revoke all on function public.sync_therapist_hours_to_employee() from public, anon, authenticated;
revoke all on function public.sync_employee_hours_to_therapist() from public, anon, authenticated;
drop trigger if exists trg_sync_therapist_hours on therapists;
create trigger trg_sync_therapist_hours after update of work_hours on therapists
  for each row when (old.work_hours is distinct from new.work_hours) execute function sync_therapist_hours_to_employee();
drop trigger if exists trg_sync_employee_hours on employees;
create trigger trg_sync_employee_hours after update of work_hours, therapist_id on employees
  for each row when (old.work_hours is distinct from new.work_hours or old.therapist_id is distinct from new.therapist_id) execute function sync_employee_hours_to_therapist();

-- تصحيح لمرة واحدة: حساب الموظف المربوط ياخد ساعات ملف المعالج (اللي الواجهة كانت بتعرضها والحجز بيقرا منها)
update employees e set work_hours = t.work_hours from therapists t where e.therapist_id = t.id and e.work_hours is distinct from t.work_hours;

-- أي تعديل في ساعات الدكتور / ساعات المركز / العطلات يوصل كل الشاشات المفتوحة فورًا
do $$
declare tb text;
begin
  foreach tb in array array['therapists', 'center_info', 'holidays'] loop
    if not exists (select 1 from pg_publication_tables where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = tb) then
      execute format('alter publication supabase_realtime add table public.%I', tb);
    end if;
  end loop;
end $$;

-- بوابة المريض: تعديل الموعد لوقت فات النهارده كان بيعدّي (الحجز الجديد كان بيرفضه بس)
CREATE OR REPLACE FUNCTION public.patient_reschedule(p_id uuid, p_date date, p_time text)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare c customers; a appointments; hrs int; pat patients; bs booking_settings;
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
  if a.therapist_id is null then raise exception 'هذا الموعد بدون دكتور محدد — تواصل مع المركز لتعديله'; end if;
  perform pg_advisory_xact_lock(hashtext('pt-day-book:' || c.patient_id::text || p_date::text));
  if exists (select 1 from appointments x where x.patient_id = c.patient_id and x.date = p_date and x.status not in ('cancelled', 'no_show', 'rescheduled') and x.id <> p_id) then
    raise exception 'عندك موعد محجوز في نفس اليوم — الحجز الإلكتروني موعد واحد في اليوم. للحجز الإضافي تواصل مع المركز';
  end if;
  if p_date = riyadh_today() and p_time <= to_char(now() at time zone 'Africa/Cairo', 'HH24:MI') then raise exception 'الوقت ده فات — اختر وقت لاحق'; end if;
  perform check_slot(a.therapist_id, p_date, p_time, a.duration_min, p_id);
  update appointments set date = p_date, time = p_time, status = 'rescheduled', updated_at = now() where id = p_id;
  update invoices set date = p_date where appointment_id = p_id and status in ('due','draft');
  select * into pat from patients where id = a.patient_id;
  perform notify_staff('appointment_rescheduled', 'المريض غيّر موعده', pat.full_name || ' — ' || a.no || ' إلى ' || p_date || ' ' || p_time, a.no, '/appointments', pat.id);
end $function$

;
