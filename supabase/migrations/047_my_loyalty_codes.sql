-- أكواد الجلسات المجانية الخاصة بالمريض نفسه (صفحة «نقاطي» في حساب المريض) — يشوف أكواده بس.
create or replace function my_loyalty_codes() returns table (code text, created_at timestamptz, status text, used_at timestamptz, valid_to date)
language plpgsql stable security definer set search_path = public as $$
declare pid uuid := my_patient_id();
begin
  if pid is null then raise exception 'غير مصرح' using errcode = '42501'; end if;
  return query
    select dc.code, lr.created_at,
      case when dc.used_count > 0 then 'used' when not dc.active then 'cancelled' when dc.valid_to < riyadh_today() then 'expired' else 'unused' end,
      (select max(cu.used_at) from coupon_usage cu where cu.coupon_id = dc.id), dc.valid_to
    from loyalty_redemptions lr join discount_codes dc on dc.id = lr.discount_code_id
    where lr.patient_id = pid or dc.patient_id = pid
    order by lr.created_at desc;
end $$;
revoke execute on function my_loyalty_codes() from public, anon;
grant execute on function my_loyalty_codes() to authenticated;
