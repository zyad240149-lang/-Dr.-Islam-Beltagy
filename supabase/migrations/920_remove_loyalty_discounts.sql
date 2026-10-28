-- 920: إزالة نقاط الولاء وأكواد الخصم من النظام (طلب العيادة) — من غير مسح أي بيانات:
-- الجداول القديمة (loyalty_ledger / loyalty_redemptions / discount_codes) وأعمدة الفواتير (discount_code / discount_code_id) زي ما هي
-- عشان أي فاتورة قديمة يفضل حسابها وتاريخها سليم. اللي اتقفل: كسب نقاط جديدة، وأي طلب مباشر (API) يطبّق كود أو يستبدل نقاط.
-- الخصم اليدوي اللي الموظف بيكتبه على الفاتورة (apply_discount) مش جزء من ده — فاضل زي ما هو.

-- 1) مفيش نقاط بتتكسب تاني من أي مسار (إنهاء جلسة / جلسة خطة / بيع باقة …) — الدالة بقت ما بتعملش حاجة
create or replace function public.award_loyalty_points(p_patient uuid, p_kind text, p_points integer, p_reason text, p_ref_type text default null, p_ref_id uuid default null)
returns void language plpgsql security definer set search_path to 'public' as $$
begin
  return; -- نقاط الولاء اتشالت (920)
end $$;
update center_info set loyalty_session_points = 0, loyalty_package_points = 0;

-- 2) قفل دوال الأكواد والنقاط قدام المستخدمين (الواجهة ما بقتش بتناديها؛ ده بيمنع الطلب المباشر برّه الواجهة)
do $$
declare f record;
begin
  for f in
    select p.oid::regprocedure as sig from pg_proc p join pg_namespace n on n.oid = p.pronamespace
     where n.nspname = 'public' and p.proname = any (array[
       'apply_discount_code', 'save_discount_code', 'find_discount_code', 'delete_discount_code', 'cancel_discount_code',
       'loyalty_codes_list', 'loyalty_ledger_list', 'my_loyalty_codes', 'my_loyalty_summary', 'patient_loyalty_summary',
       'patient_redeem_loyalty', 'redeem_loyalty_points', 'update_loyalty_settings'])
  loop
    execute format('revoke execute on function %s from public, anon, authenticated', f.sig);
  end loop;
end $$;
