-- يسد ثغرة: منع دخول الموظف أثناء إجازة/استئذان معتمد كان يتم في الواجهة (auth.tsx) فقط —
-- أي طلب مباشر لأي RPC بتوكن صالح كان يعمل رغم الإجازة المعتمدة (has_perm لا يتحقق من ذلك).
-- الإصلاح على مستوى has_perm فقط (وليس my_employee_id) حتى تبقى قراءة الموظف لسجلّ إجازته
-- الخاص (staff_requests self-read عبر my_employee_id في RLS) شغّالة ليعرض النظام سبب المنع.

create or replace function is_on_leave(p_employee_id uuid) returns boolean
language sql stable security definer set search_path = public as $$
  select exists (
    select 1 from staff_requests r
    where r.employee_id = p_employee_id and r.status = 'approved' and r.type in ('leave', 'permission')
      and riyadh_today() between r.from_date and r.to_date
      and (r.type = 'leave' or to_char(now() at time zone 'Africa/Cairo', 'HH24:MI') between r.from_time and r.to_time)
  )
$$;

create or replace function has_perm(p_area text, p_op text) returns boolean
language sql stable security definer set search_path = public as $$
  select exists (
    select 1 from employees e
    where e.auth_user_id = auth.uid() and e.active and not is_on_leave(e.id)
      and (e.role = 'system_admin'
        or exists (select 1 from role_permissions rp where rp.role = e.role and rp.area = p_area and p_op = any(rp.ops)))
  )
$$;

-- my_active_leave تُعاد كما هي (تعتمد على my_employee_id فقط) لتبقى قادرة على قراءة سجل
-- الإجازة الخاص بالموظف نفسه وعرض رسالة المنع في الواجهة قبل تسجيل الخروج.
