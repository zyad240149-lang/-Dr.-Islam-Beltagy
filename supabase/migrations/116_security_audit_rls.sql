-- مراجعة أمنية 2026-10-12
-- 1) is_staff() كانت بتقبل موظف في إجازة/استئذان معتمد (my_employee_id بتتحقق من active بس) — بقت زي has_perm.
--    my_employee_id() متسابة زي ما هي عمدًا (قراءة الموظف لطلب إجازته الخاص).
create or replace function is_staff() returns boolean
language sql stable security definer set search_path = public as $$
  select exists (select 1 from employees e where e.auth_user_id = auth.uid() and e.active and not is_on_leave(e.id))
$$;

-- 2) سياسات كانت «صلاحية OR can_see_patient» — و can_see_patient = is_staff، فأي موظف (حتى من غير أي صلاحية)
--    كان يقدر يقرا الروشتات ورسائل واتساب (فيها جوال المريض) وسجل نقاط الولاء. بقت «صلاحية AND نطاق المريض».
drop policy if exists staff_read on prescriptions;
create policy staff_read on prescriptions for select using (
  (has_perm('prescriptions', 'view') or has_perm('patients', 'view')) and can_see_patient(patient_id));

drop policy if exists staff_read on prescription_items;
create policy staff_read on prescription_items for select using (exists (
  select 1 from prescriptions p where p.id = prescription_items.prescription_id
    and (has_perm('prescriptions', 'view') or has_perm('patients', 'view')) and can_see_patient(p.patient_id)));

drop policy if exists staff_read on whatsapp_messages;
create policy staff_read on whatsapp_messages for select using (
  (has_perm('campaigns', 'view') or has_perm('invoices', 'view') or has_perm('patients', 'view')) and can_see_patient(patient_id));

drop policy if exists loyalty_redemptions_select on loyalty_redemptions;
create policy loyalty_redemptions_select on loyalty_redemptions for select using (
  (has_perm('loyalty', 'view') or has_perm('patients', 'view')) and can_see_patient(patient_id));

drop policy if exists loyalty_ledger_select on loyalty_ledger;
create policy loyalty_ledger_select on loyalty_ledger for select using (
  ((has_perm('loyalty', 'view') or has_perm('patients', 'view')) and can_see_patient(patient_id)) or patient_id = my_patient_id());

-- 3) تعديل بيانات المريض: with check كان من غير نطاق المريض
drop policy if exists staff_update on patients;
create policy staff_update on patients for update
  using (has_perm('patients', 'edit') and can_see_patient(id))
  with check (has_perm('patients', 'edit') and can_see_patient(id));

-- 4) دوال مساعدة نقية كانت متاحة للزائر من غير لزوم
do $$ declare f record; begin
  for f in select p.oid::regprocedure as sig from pg_proc p join pg_namespace n on n.oid = p.pronamespace
           where n.nspname = 'public' and p.proname in ('phone_digits_match', 'physio_txt', 'physio_arr', 'physio_int', 'physio_date', 'normalize_discount_code') loop
    execute format('revoke execute on function %s from anon, public', f.sig);
    execute format('grant execute on function %s to authenticated', f.sig);
  end loop;
end $$;
