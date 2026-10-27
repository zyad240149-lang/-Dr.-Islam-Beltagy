-- الأوقات اللي عدّت النهارده بتتعرض «فات» (معطّلة) بدل ما تختفي
create or replace function doctor_day_slots(p_therapist uuid, p_service text, p_date date) returns jsonb
language plpgsql stable security definer set search_path = public as $$
declare th therapists; svc services; sched jsonb; step int; t int; o int; cl int; dur int; now_min int; is_today boolean; out jsonb := '[]'; busy boolean; hhmm text;
begin
  if p_therapist is null then return jsonb_build_object('status', 'no_doctor', 'slots', '[]'::jsonb); end if;
  select * into th from therapists where id = p_therapist and active;
  if th.id is null then return jsonb_build_object('status', 'no_doctor', 'slots', '[]'::jsonb); end if;
  select * into svc from services where id = p_service and active;
  if svc.id is null or not exists (select 1 from therapist_services ts where ts.therapist_id = p_therapist and ts.service_id = p_service) then
    return jsonb_build_object('status', 'not_offered', 'slots', '[]'::jsonb);
  end if;
  if p_date < riyadh_today() then return jsonb_build_object('status', 'past', 'slots', '[]'::jsonb); end if;
  select e.value into sched from center_info c, jsonb_array_elements(c.week_schedule) e where e.value->>'day' = lower(to_char(p_date, 'Dy')) limit 1;
  if sched is null or not coalesce((sched->>'open')::boolean, false) then return jsonb_build_object('status', 'closed', 'slots', '[]'::jsonb); end if;
  if exists (select 1 from holidays h where h.date = p_date and h.active and (h.branch_id is null or h.branch_id = th.branch_id)) then
    return jsonb_build_object('status', 'holiday', 'slots', '[]'::jsonb);
  end if;
  if exists (select 1 from jsonb_array_elements(th.on_leave) l where p_date between (l.value->>'from')::date and (l.value->>'to')::date)
     or exists (select 1 from staff_requests r join employees e on e.id = r.employee_id
                where e.therapist_id = p_therapist and r.status = 'approved' and r.type = 'leave' and p_date between r.from_date and r.to_date) then
    return jsonb_build_object('status', 'leave', 'slots', '[]'::jsonb);
  end if;
  step := greatest(coalesce((select slot_step_min from center_info limit 1), 30), 5);
  dur := svc.duration_min;
  o := split_part(sched->>'from', ':', 1)::int * 60 + split_part(sched->>'from', ':', 2)::int;
  cl := split_part(sched->>'to', ':', 1)::int * 60 + split_part(sched->>'to', ':', 2)::int;
  is_today := p_date = riyadh_today();
  now_min := extract(hour from now() at time zone 'Africa/Cairo')::int * 60 + extract(minute from now() at time zone 'Africa/Cairo')::int;
  t := o;
  while t <= cl loop
    hhmm := lpad((t / 60)::text, 2, '0') || ':' || lpad((t % 60)::text, 2, '0');
    if is_today and t <= now_min then
      out := out || jsonb_build_array(jsonb_build_object('time', hhmm, 'available', false, 'past', true)); -- فات
    else
      busy := exists (select 1 from appointments a where a.therapist_id = p_therapist and a.date = p_date and a.status <> 'cancelled'
                      and hhmm::time < a.time::time + make_interval(mins => a.duration_min) and a.time::time < hhmm::time + make_interval(mins => dur));
      out := out || jsonb_build_array(jsonb_build_object('time', hhmm, 'available', not busy));
    end if;
    t := t + step;
  end loop;
  return jsonb_build_object('status', 'ok', 'slots', out);
end $$;
revoke execute on function doctor_day_slots(uuid, text, date) from public;
grant execute on function doctor_day_slots(uuid, text, date) to anon, authenticated;

grant execute on function doctor_day_slots(uuid, text, date) to anon, authenticated;
