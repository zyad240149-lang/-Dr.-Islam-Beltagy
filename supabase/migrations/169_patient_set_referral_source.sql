-- المريض نفسه يختار «كيف عرفت عن المركز؟» بعد التسجيل (الموقع العام + جوجل)
create or replace function public.patient_set_referral_source(p_source text)
returns void language plpgsql security definer set search_path to 'public'
as $$
declare c customers;
begin
  c := require_patient();
  if p_source is null or p_source not in ('instagram','facebook','twitter','snapchat','tiktok','whatsapp','google','friend','ad','other') then
    raise exception 'اختر مصدرًا من القائمة';
  end if;
  update patients set referral_source = p_source where id = c.patient_id;
end $$;

revoke all on function public.patient_set_referral_source(text) from public, anon;
grant execute on function public.patient_set_referral_source(text) to authenticated;
