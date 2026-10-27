-- حجز المكالمة: الموظف يختار سعودي/غير سعودي — بيحدد الضريبة تلقائيًا (0% / 15%) على فاتورة الموعد
create or replace function guest_patient(g jsonb) returns patients
language plpgsql security definer set search_path = public as $$
declare pat patients; digits text := regexp_replace(coalesce(g->>'phone', ''), '\D', '', 'g'); nm text := trim(coalesce(g->>'fullName', ''));
  nat text := case when g->>'nationality' = 'non_saudi' then 'non_saudi' else 'saudi' end;
begin
  if length(digits) < 9 then raise exception 'رقم الجوال غير صحيح'; end if;
  select * into pat from patients where right(regexp_replace(phone, '\D', '', 'g'), 9) = right(digits, 9) order by is_guest, registered_at desc limit 1;
  if pat.id is not null then return pat; end if;
  if length(nm) < 2 then raise exception 'اسم المريض مطلوب'; end if;
  insert into patients (file_no, full_name, phone, is_guest, nationality, notes) values ('', nm, g->>'phone', true, nat, 'حجز عن طريق مكالمة') returning * into pat;
  return pat;
end $$;
revoke execute on function guest_patient(jsonb) from public, anon, authenticated;
