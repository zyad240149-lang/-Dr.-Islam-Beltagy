-- إصلاح: حضور الدكتور مكانش بيظهر في تقرير المدير.
-- السبب: التقرير كان بيعرض بس الموظفين اللي ليهم جدول في employees.work_hours، وساعات عمل الدكتور
-- متسجّلة على therapists.work_hours (نموذج المعالج) — فكان بيتشال من التقرير حتى لو سجّل حضور.

-- 1) جدول اليوم: من الموظف، ولو مش موجود من ملف المعالج المربوط بيه
create or replace function attendance_schedule(p_employee uuid, p_date date) returns jsonb
language sql stable security definer set search_path = public as $$
  select w from (
    select coalesce(nullif(e.work_hours, '[]'::jsonb), t.work_hours, '[]'::jsonb) as hours
    from employees e left join therapists t on t.id = e.therapist_id
    where e.id = p_employee
  ) x, jsonb_array_elements(x.hours) w
  where w->>'day' = (array['sun','mon','tue','wed','thu','fri','sat'])[extract(dow from p_date)::int + 1]
  limit 1
$$;

-- 2) أي حد سجّل حضور يظهر في التقرير، حتى لو اليوم مش ضمن جدوله
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
    where e.active and (attendance_schedule(e.id, d.d::date) is not null or a.id is not null)
    order by d.d desc, e.name;
end $$;
