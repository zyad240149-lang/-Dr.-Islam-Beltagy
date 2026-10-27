-- إنهاء إجازة/استئذان معتمد مبكرًا يدويًا — عشان المدير يقدر «يفك» إجازة موظف ويرجّعه للعمل فورًا
-- بدل ما ينتظر لتاريخ النهاية المحدد. بنستخدم status='rejected' مع ملاحظة توضيحية بدل إضافة حالة جديدة،
-- عشان is_on_leave()/my_active_leave()/activeLeave() (كلهم بيتحققوا من status='approved') يوقفوا الحجب فورًا
-- بغضّ النظر عن تاريخ النهاية الأصلي (تقليص التاريخ وحده ما كان يكفي لو الإجازة بدأت النهارده بالظبط).
create or replace function end_staff_leave(p_id uuid) returns void
language plpgsql security definer set search_path = public as $$
declare meid uuid := require_perm('requests', 'edit'); rq staff_requests; emp employees;
begin
  select * into rq from staff_requests where id = p_id for update;
  if rq.id is null then raise exception 'الطلب غير موجود'; end if;
  if rq.status <> 'approved' then raise exception 'الطلب ليس إجازة/استئذان معتمدًا حاليًا'; end if;
  select * into emp from employees where id = rq.employee_id;
  update staff_requests set
    status = 'rejected',
    decision_note = trim(both ' ' from coalesce(nullif(decision_note, ''), '') || ' — أُنهيت مبكرًا وعاد الموظف للعمل في ' || to_char(now() at time zone 'Africa/Cairo', 'YYYY-MM-DD HH24:MI')),
    decided_by = meid, decided_at = now()
  where id = p_id;
  perform log_action('إنهاء إجازة/استئذان مبكرًا للموظف ' || coalesce(emp.name, ''));
end $$;

revoke execute on function end_staff_leave(uuid) from public, anon;
grant execute on function end_staff_leave(uuid) to authenticated;
