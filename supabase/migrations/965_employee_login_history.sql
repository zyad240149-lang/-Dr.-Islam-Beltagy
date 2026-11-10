-- 965: «آخر دخول» و«مرات الدخول» للموظفين.
-- audit_login (بيتنادى مع كل دخول/فتح للبرنامج بجلسة صالحة) كان بيكتب في audit_logs بس، وعمود employees.last_login ماكانش بيتحدّث
-- ← شاشة الموظفين كانت بتعرض «—» لكل الناس. دلوقتي:
--   (1) audit_login بيحدّث last_login كمان
--   (2) last_login بيتملي من السجل الموجود (آخر دخول فعلي لكل موظف)
--   (3) employee_login_stats(): عدد مرات الدخول وآخر دخول لكل موظف — لمن عنده صلاحية «الموظفون/اطلاع»
--   (4) employee_logins(p_employee, p_limit): سجل مرات دخول موظف واحد (الأحدث الأول) — نفس الصلاحية

create or replace function public.audit_login()
returns void language plpgsql security definer set search_path to 'public' as $$
declare v_emp uuid := my_employee_id();
begin
  if auth.uid() is null then return; end if;
  insert into audit_logs (user_id, employee_id, action, table_name, record_id, new_data)
  values (auth.uid(), v_emp, 'login', case when v_emp is not null then 'employees' else 'customers' end,
          coalesce(v_emp::text, my_customer_id()::text), jsonb_build_object('at', now()));
  if v_emp is not null then update employees set last_login = now() where id = v_emp; end if;
end $$;

update employees e set last_login = l.last
from (select employee_id, max(at) last from audit_logs where action = 'login' and employee_id is not null group by employee_id) l
where l.employee_id = e.id and (e.last_login is null or e.last_login < l.last);

create or replace function public.employee_login_stats()
returns table (employee_id uuid, logins int, last_login timestamptz)
language plpgsql stable security definer set search_path to 'public' as $$
begin
  if not has_perm('employees', 'view') then raise exception 'ليس لديك صلاحية «الموظفون»' using errcode = '42501'; end if;
  return query select a.employee_id, count(*)::int, max(a.at) from audit_logs a
    where a.action = 'login' and a.employee_id is not null group by a.employee_id;
end $$;

create or replace function public.employee_logins(p_employee uuid, p_limit int default 100)
returns table (at timestamptz)
language plpgsql stable security definer set search_path to 'public' as $$
begin
  if not has_perm('employees', 'view') then raise exception 'ليس لديك صلاحية «الموظفون»' using errcode = '42501'; end if;
  return query select a.at from audit_logs a where a.action = 'login' and a.employee_id = p_employee
    order by a.at desc limit greatest(1, least(coalesce(p_limit, 100), 500));
end $$;

revoke all on function public.employee_login_stats() from public, anon;
revoke all on function public.employee_logins(uuid, int) from public, anon;
grant execute on function public.employee_login_stats() to authenticated;
grant execute on function public.employee_logins(uuid, int) to authenticated;
