-- الحجز وتعديل المواعيد من غير قيد «ساعات دوام الطبيب» (طلب المستخدم 2026-09-30): أي وقت جوّه ساعات عمل المركز مسموح.
-- لسه بيتحقق من: المركز فاتح + الوقت جوّه ساعاته + العطلات + إجازة الطبيب + إن الطبيب مالوش موعد تاني في نفس الوقت.
CREATE OR REPLACE FUNCTION public.check_slot(p_therapist uuid, p_date date, p_time text, p_dur integer, p_exclude uuid DEFAULT NULL::uuid)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare d text := lower(to_char(p_date, 'Dy')); sched jsonb; th therapists; wh jsonb; br uuid;
begin
  if p_time !~ '^\d{2}:\d{2}$' then raise exception 'صيغة الوقت غير صحيحة'; end if;
  if p_date < riyadh_today() then raise exception 'لا يمكن الحجز في تاريخ سابق'; end if;
  select e.value into sched from center_info c, jsonb_array_elements(c.week_schedule) e where e.value->>'day' = d limit 1;
  if sched is null or not coalesce((sched->>'open')::boolean, false) then raise exception 'المركز مغلق في هذا اليوم'; end if;
  if p_time < sched->>'from' or p_time >= sched->>'to' then raise exception 'الوقت خارج ساعات عمل المركز (% - %)', sched->>'from', sched->>'to'; end if;

  select * into th from therapists where id = p_therapist;
  if th.id is null or not th.active then raise exception 'المعالج غير موجود أو غير نشط'; end if;
  br := th.branch_id;
  if exists (select 1 from holidays where date = p_date and active and (branch_id is null or branch_id = br)) then
    raise exception 'المركز مغلق في هذا اليوم — اختر يومًا آخر';
  end if;
  if exists (select 1 from jsonb_array_elements(th.on_leave) l where p_date between (l.value->>'from')::date and (l.value->>'to')::date)
     or exists (select 1 from staff_requests r join employees e on e.id = r.employee_id
                where e.therapist_id = p_therapist and r.status = 'approved' and r.type = 'leave' and p_date between r.from_date and r.to_date) then
    raise exception 'المعالج في إجازة في هذا التاريخ';
  end if;
  -- (اتشال) التحقق من ساعات دوام الطبيب — الحجز والتعديل مسموحين في أي وقت جوّه ساعات المركز

  perform pg_advisory_xact_lock(hashtext(p_therapist::text || p_date::text));
  if exists (select 1 from appointments a
             where a.therapist_id = p_therapist and a.date = p_date and a.status <> 'cancelled' and a.id is distinct from p_exclude
               and p_time::time < a.time::time + make_interval(mins => a.duration_min)
               and a.time::time < p_time::time + make_interval(mins => p_dur)) then
    raise exception 'المعالج لديه موعد آخر في هذا الوقت';
  end if;
end $function$
;
