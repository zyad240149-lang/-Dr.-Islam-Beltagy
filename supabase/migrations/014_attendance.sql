-- حضور وانصراف الموظفين + احتساب الالتزام بمواعيد العمل (WorkHours في employees.work_hours)
create table if not exists attendance (
  id uuid primary key default gen_random_uuid(),
  employee_id uuid not null references employees(id) on delete cascade,
  date date not null,
  check_in timestamptz,
  check_out timestamptz,
  created_at timestamptz not null default now(),
  unique (employee_id, date)
);

alter table attendance enable row level security;

create policy attendance_select on attendance for select
  using (employee_id = my_employee_id() or has_perm('attendance', 'edit'));

revoke insert, update, delete on attendance from authenticated;
grant select on attendance to authenticated;

-- الالتزام: الحضور في الوقت أو قبله (بسماحية 10 دقائق) والانصراف في وقته أو بعده (بنفس السماحية)
-- يوم بدون جدول عمل محدد لهذا الموظف = غير مُطالب بالحضور (نعتبره ملتزمًا ولا يظهر في أي من القسمين)
create or replace function attendance_schedule(p_employee uuid, p_date date) returns jsonb
language sql stable security definer set search_path = public as $$
  select w from employees, jsonb_array_elements(coalesce(work_hours, '[]'::jsonb)) w
  where employees.id = p_employee
    and w->>'day' = (array['sun','mon','tue','wed','thu','fri','sat'])[extract(dow from p_date)::int + 1]
  limit 1
$$;

create or replace function attendance_status(p_employee uuid, p_date date, p_check_in timestamptz, p_check_out timestamptz) returns text
language plpgsql stable security definer set search_path = public as $$
declare sched jsonb := attendance_schedule(p_employee, p_date); grace interval := interval '10 minutes';
declare exp_from time; exp_to time;
begin
  if sched is null then return 'no_schedule'; end if;
  exp_from := (sched->>'from')::time; exp_to := (sched->>'to')::time;
  if p_check_in is null then return 'absent'; end if;
  if ((p_check_in at time zone 'Africa/Cairo')::time) > (exp_from + grace) then return 'non_compliant'; end if;
  if p_check_out is not null and ((p_check_out at time zone 'Africa/Cairo')::time) < (exp_to - grace) then return 'non_compliant'; end if;
  return 'compliant';
end $$;

create or replace function clock_in() returns jsonb
language plpgsql security definer set search_path = public as $$
declare v uuid := my_employee_id(); d date := riyadh_today(); r attendance;
begin
  if v is null then raise exception 'غير مصرح — سجّل الدخول بحساب موظف' using errcode = '42501'; end if;
  insert into attendance (employee_id, date, check_in) values (v, d, now())
    on conflict (employee_id, date) do update set check_in = coalesce(attendance.check_in, excluded.check_in)
    returning * into r;
  perform log_action('تسجيل حضور');
  return jsonb_build_object('id', r.id, 'date', r.date, 'checkIn', r.check_in, 'checkOut', r.check_out);
end $$;

create or replace function clock_out() returns jsonb
language plpgsql security definer set search_path = public as $$
declare v uuid := my_employee_id(); d date := riyadh_today(); r attendance;
begin
  if v is null then raise exception 'غير مصرح — سجّل الدخول بحساب موظف' using errcode = '42501'; end if;
  select * into r from attendance where employee_id = v and date = d;
  if r.id is null or r.check_in is null then raise exception 'سجّل الحضور أولًا قبل الانصراف'; end if;
  if r.check_out is not null then raise exception 'تم تسجيل الانصراف مسبقًا'; end if;
  update attendance set check_out = now() where id = r.id returning * into r;
  perform log_action('تسجيل انصراف');
  return jsonb_build_object('id', r.id, 'date', r.date, 'checkIn', r.check_in, 'checkOut', r.check_out);
end $$;

create or replace function my_attendance_today() returns jsonb
language sql stable security definer set search_path = public as $$
  select jsonb_build_object('id', id, 'date', date, 'checkIn', check_in, 'checkOut', check_out)
  from attendance where employee_id = my_employee_id() and date = riyadh_today()
$$;

-- تقرير الحضور لمدير/مسؤول النظام لمدى تاريخي — يشمل الموظفين النشطين وحالتهم لكل يوم له جدول عمل
create or replace function attendance_report(p_from date, p_to date) returns table (
  employee_id uuid, employee_name text, role text, date date, check_in timestamptz, check_out timestamptz, status text
)
language plpgsql stable security definer set search_path = public as $$
begin
  perform require_perm('attendance', 'edit');
  return query
    select e.id, e.name, e.role, d.d::date, a.check_in, a.check_out,
      attendance_status(e.id, d.d::date, a.check_in, a.check_out)
    from employees e
    cross join generate_series(p_from, p_to, interval '1 day') as d(d)
    left join attendance a on a.employee_id = e.id and a.date = d.d::date
    where e.active and attendance_schedule(e.id, d.d::date) is not null
    order by d.d desc, e.name;
end $$;

revoke execute on function clock_in(), clock_out(), my_attendance_today(), attendance_report(date, date) from public, anon;
grant execute on function clock_in(), clock_out(), my_attendance_today(), attendance_report(date, date) to authenticated;

-- ops: 'view' = تسجيل حضوره/انصرافه هو فقط (كل الأدوار)، 'edit' = رؤية تقرير الفريق كله
insert into role_permissions (role, area, ops) values
  ('system_admin', 'attendance', '{view,create,edit,delete}'),
  ('center_manager', 'attendance', '{view,create,edit,delete}'),
  ('secretary', 'attendance', '{view,edit}'),
  ('reception', 'attendance', '{view}'),
  ('accountant', 'attendance', '{view}'),
  ('therapist', 'attendance', '{view}')
on conflict (role, area) do update set ops = excluded.ops;
