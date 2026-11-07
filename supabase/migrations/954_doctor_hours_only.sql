-- 954: الحجز بمواعيد الدكتور بس — ساعات عمل المركز وأيام قفله مابقتش بتحدّ الحجز.
-- الإجازات الرسمية، وإجازات/استئذانات الدكتور، واستراحته لسه بتتطبّق.
-- centerFrom/centerTo بيفضلوا في الرد (نفس قيم الدكتور) عشان أي واجهة قديمة بتقراهم ماتقعش.

create or replace function public.doctor_day_window(p_therapist uuid, p_date date)
returns jsonb language plpgsql stable security definer set search_path to 'public' as $function$
declare th therapists; wh jsonb; d text := lower(to_char(p_date, 'Dy')); blocks jsonb := '[]';
begin
  select * into th from therapists where id = p_therapist;
  if th.id is null or not th.active then return jsonb_build_object('status', 'no_doctor'); end if;
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
    'centerFrom', wh->>'from', 'centerTo', wh->>'to', 'doctorFrom', wh->>'from', 'doctorTo', wh->>'to',
    'start', _hm(wh->>'from'), 'lastStart', _hm(wh->>'to'), 'end', _hm(wh->>'to'), 'blocks', blocks);
end $function$;

create or replace function public.doctor_window_reason(w jsonb, t integer, dur integer)
returns text language sql immutable set search_path to 'public' as $function$
  select case
    when t < _hm(w->>'doctorFrom') or t + dur > _hm(w->>'doctorTo') then 'doctor'
    when exists (select 1 from jsonb_array_elements(w->'blocks') b where t < (b.value->>'to')::int and (b.value->>'from')::int < t + dur) then 'blocked'
  end
$function$;
