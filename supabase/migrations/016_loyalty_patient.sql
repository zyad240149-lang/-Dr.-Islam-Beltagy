-- يتيح للمريض نفسه (حساب عميل) الاطلاع على رصيد نقاطه وسجل حركاته من واجهته الخاصة (/me)
create or replace function my_loyalty_summary() returns jsonb
language plpgsql stable security definer set search_path = public as $$
declare pid uuid := my_patient_id(); bal int; earned int; redeemed int; redemptions int;
begin
  if pid is null then raise exception 'غير مصرح' using errcode = '42501'; end if;
  select coalesce(sum(points), 0) into bal from loyalty_ledger where patient_id = pid;
  select coalesce(sum(points), 0) into earned from loyalty_ledger where patient_id = pid and points > 0;
  select coalesce(sum(-points), 0) into redeemed from loyalty_ledger where patient_id = pid and kind = 'redeem';
  select count(*) into redemptions from loyalty_redemptions where patient_id = pid;
  return jsonb_build_object('balance', bal, 'totalEarned', earned, 'totalRedeemed', redeemed, 'redemptionsCount', redemptions);
end $$;

revoke execute on function my_loyalty_summary() from public, anon;
grant execute on function my_loyalty_summary() to authenticated;

-- يسمح للمريض بقراءة سطور حركاته الخاصة (لعرض "آخر الحركات") — بدون أي كتابة
drop policy if exists loyalty_ledger_select on loyalty_ledger;
create policy loyalty_ledger_select on loyalty_ledger for select using (has_perm('loyalty', 'view') or can_see_patient(patient_id) or patient_id = my_patient_id());
