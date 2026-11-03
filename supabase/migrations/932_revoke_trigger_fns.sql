-- 932: دوال التريجر مالهاش لازمة تتنفّذ من برّه (ومابتتنفّذش أصلًا غير كتريجر) — بنشيل صلاحية التنفيذ من الزوار والمستخدمين للنظافة
revoke execute on function public.trg_ortho_consult_link() from public, anon, authenticated;
revoke execute on function public.trg_patient_link_pending() from public, anon, authenticated;
