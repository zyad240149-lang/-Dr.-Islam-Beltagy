-- 154: قراءة المرضى كانت بتاخد ~55 ثانية لـ 9.8 ألف مريض لأن سياسة RLS بتنادي has_perm و can_see_patient (دوال definer) لكل صف.
-- الدوال دي مابتعتمدش على الصف (can_see_patient = is_staff())، فبتتغلّف بـ (select ...) عشان Postgres يحسبها مرة واحدة (InitPlan) مش لكل مريض.
drop policy if exists staff_read on patients;
create policy staff_read on patients for select using ((select has_perm('patients', 'view')) and (select can_see_patient(null)));
drop policy if exists staff_update on patients;
create policy staff_update on patients for update
  using ((select has_perm('patients', 'edit')) and (select can_see_patient(null)))
  with check ((select has_perm('patients', 'edit')) and (select can_see_patient(null)));
drop policy if exists p_self on patients;
create policy p_self on patients for select using (id = (select my_patient_id()));
