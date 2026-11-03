-- 930: السجلات الطبية في Realtime — التشخيص والأشعة والمتابعات وباقي سجلات العظام بتوصل الأجهزة التانية فورًا
-- (patient_files موجود بالفعل). سياسات RLS بتتطبّق على Realtime زي القراية العادية بالظبط: كل مستخدم بيوصله اللي مسموح له يشوفه بس.
do $$
declare t text;
begin
  foreach t in array array['ortho_consultations', 'ortho_imaging', 'ortho_follow_ups', 'ortho_nursing', 'ortho_injections', 'ortho_fractures', 'ortho_surgeries'] loop
    if not exists (select 1 from pg_publication_tables where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = t) then
      execute format('alter publication supabase_realtime add table public.%I', t);
    end if;
  end loop;
end $$;
