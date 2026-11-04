-- 945: الموظف بيظبط أيام وساعات شغله وفرع كل يوم لنفسه بس.
-- الدالة بتعدّل صف الموظف صاحب الحساب، وترجر المزامنة بينقل الساعات لملف الطبيب المربوط.
create or replace function public.save_my_work_hours(p jsonb) returns jsonb
language plpgsql security definer set search_path to 'public' as $$
declare
  me uuid := my_employee_id();
  w jsonb;
  clean jsonb := '[]'::jsonb;
  seen text[] := '{}';
  v_day text; v_from text; v_to text; v_break_from text; v_break_to text; v_branch uuid;
  item jsonb;
begin
  if me is null then raise exception 'الخدمة دي للموظفين بس'; end if;
  if jsonb_typeof(p) <> 'array' then raise exception 'مواعيد العمل غير صحيحة'; end if;
  for w in select * from jsonb_array_elements(p) loop
    v_day := w->>'day'; v_from := w->>'from'; v_to := w->>'to';
    v_break_from := nullif(w->>'breakFrom', ''); v_break_to := nullif(w->>'breakTo', '');
    if v_day is null or v_day not in ('sat', 'sun', 'mon', 'tue', 'wed', 'thu', 'fri') then raise exception 'يوم العمل غير صحيح'; end if;
    if v_day = any(seen) then raise exception 'اليوم متكرر في مواعيد العمل'; end if;
    seen := seen || v_day;
    if coalesce(v_from, '') !~ '^([01][0-9]|2[0-3]):[0-5][0-9]$' or coalesce(v_to, '') !~ '^([01][0-9]|2[0-3]):[0-5][0-9]$' or v_from >= v_to then
      raise exception 'وقت بداية الدوام لازم يسبق نهايته';
    end if;
    if (v_break_from is null) <> (v_break_to is null) then raise exception 'وقت الراحة غير صحيح'; end if;
    if v_break_from is not null and (v_break_from !~ '^([01][0-9]|2[0-3]):[0-5][0-9]$' or v_break_to !~ '^([01][0-9]|2[0-3]):[0-5][0-9]$' or v_break_from >= v_break_to or v_break_from < v_from or v_break_to > v_to) then
      raise exception 'وقت الراحة غير صحيح';
    end if;
    item := jsonb_build_object('day', v_day, 'from', v_from, 'to', v_to);
    if v_break_from is not null then item := item || jsonb_build_object('breakFrom', v_break_from, 'breakTo', v_break_to); end if;
    if nullif(w->>'branchId', '') is not null then
      begin v_branch := (w->>'branchId')::uuid; exception when invalid_text_representation then raise exception 'الفرع غير صحيح'; end;
      if not exists (select 1 from branches where id = v_branch and active) then raise exception 'الفرع غير موجود أو متوقف'; end if;
      item := item || jsonb_build_object('branchId', v_branch);
    end if;
    clean := clean || jsonb_build_array(item);
  end loop;
  update employees set work_hours = clean where id = me and active;
  if not found then raise exception 'الحساب غير نشط'; end if;
  perform log_action('تعديل مواعيد العمل الشخصية');
  return clean;
end $$;
revoke all on function public.save_my_work_hours(jsonb) from public, anon;
grant execute on function public.save_my_work_hours(jsonb) to authenticated;
