-- 946: تصدير ملف المرضى لازم يعدّي على الخادم: فحص الصلاحية وتسجيل العملية قبل ما الملف يتعمل.
create or replace function public.authorize_patient_export() returns void
language plpgsql security definer set search_path to 'public' as $$
begin
  perform require_perm('patient_export', 'view');
  perform log_action('تصدير ملف المرضى (Excel)', null::uuid);
end $$;
revoke all on function public.authorize_patient_export() from public, anon;
grant execute on function public.authorize_patient_export() to authenticated;
