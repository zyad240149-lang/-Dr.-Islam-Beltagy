-- 143: تسجيل جلسة الخطة بقى من «حضور مرضى الباقات» فقط (attendance_check_in) — زرار «اكتمال الجلسة» في كروت الخطط اتقفل لكل الأدوار.
-- الدالة فاضلة موجودة بس بترفض لأي حد، عشان مايبقاش فيه طريق تاني يسجّل جلسة من غير حضور ورقم جلسة وقواعد اليوم.
create or replace function complete_next_plan_session(p_plan uuid) returns jsonb
language plpgsql security definer set search_path = public as $$
begin
  raise exception 'تسجيل جلسة الخطة بيتم من «حضور مرضى الباقات» فقط' using errcode = '42501';
end $$;
