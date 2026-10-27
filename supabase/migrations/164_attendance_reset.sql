-- 164 (طلب المستخدم 2026-10-19 «خليه صفر»): صفحة الحضور والانصراف تبدأ العدّ من النهارده.
--  - center_info.attendance_since = 2026-10-19 (السجلات القديمة مااتمسحتش — بس مش داخلة في التقرير).
--  - «غائب» مابيتحسبش على اليوم الحالي ولا اللي بعده لحد ما اليوم يخلص (اللي لسه ماسجّلش حضوره النهارده مش غائب).
alter table center_info add column if not exists attendance_since date;

CREATE OR REPLACE FUNCTION public.attendance_report(p_from date, p_to date)
 RETURNS TABLE(employee_id uuid, employee_name text, role text, date date, check_in timestamp with time zone, check_out timestamp with time zone, status text)
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare v_since date;
begin
  perform require_perm('attendance', 'edit');
  select max(attendance_since) into v_since from center_info;
  return query
    select e.id, e.name, e.role, d.d::date, a.check_in, a.check_out,
      attendance_status(e.id, d.d::date, a.check_in, a.check_out)
    from employees e
    cross join generate_series(greatest(p_from, coalesce(v_since, p_from)), p_to, interval '1 day') as d(d)
    left join attendance a on a.employee_id = e.id and a.date = d.d::date
    where e.active and (attendance_schedule(e.id, d.d::date) is not null or a.id is not null)
      and (a.id is not null or d.d::date < riyadh_today())
    order by d.d desc, e.name;
end $function$;
