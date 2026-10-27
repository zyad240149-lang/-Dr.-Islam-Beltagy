-- 008 — حذف آمن: لا يُحذف مريض لديه زيارات/مواعيد/جلسات/مدفوعات (يُعطَّل بدلًا من الحذف)
create or replace function delete_patient(p_id uuid) returns void
language plpgsql security definer set search_path = public as $$
declare pat patients;
begin
  perform require_perm('patients', 'delete');
  select * into pat from patients where id = p_id;
  if pat.id is null then raise exception 'المريض غير موجود'; end if;
  if exists (select 1 from appointments where patient_id = p_id) or exists (select 1 from treatment_sessions where patient_id = p_id) then
    raise exception 'لا يمكن حذف مريض لديه مواعيد أو زيارات مسجّلة — عطّل الملف بدل حذفه للاحتفاظ بالسجل الطبي';
  end if;
  if exists (select 1 from payments where patient_id = p_id) or exists (select 1 from invoices where patient_id = p_id and status <> 'cancelled') then
    raise exception 'لا يمكن حذف مريض لديه فواتير أو مدفوعات — عطّل الملف بدل حذفه';
  end if;
  update customers set patient_id = null where patient_id = p_id;
  delete from patients where id = p_id;
  perform log_action('حذف ملف المريض ' || pat.full_name || ' (' || pat.file_no || ')');
end $$;
grant execute on function delete_patient(uuid) to authenticated;
