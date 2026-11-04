-- 937: المريض بيشوف خطط تمارينه من حسابه. القراءة من دالة مقصورة على ملفه، ومفيش وصول مباشر لجداول التمارين.
create or replace function public.my_exercise_plans() returns jsonb
language sql stable security definer set search_path to 'public' as $$
  select coalesce(jsonb_agg(jsonb_build_object(
    'id', p.id, 'date', p.date, 'notes', p.notes,
    'exercises', (select coalesce(jsonb_agg(jsonb_build_object('name', e.name, 'description', e.description, 'media', e.media) order by x.ord), '[]'::jsonb)
                  from unnest(p.exercise_ids) with ordinality as x(id, ord) join ortho_exercises e on e.id = x.id)
  ) order by p.date desc, p.created_at desc), '[]'::jsonb)
  from ortho_exercise_plans p
  where p.patient_id = my_patient_id() and my_patient_id() is not null;
$$;
revoke all on function public.my_exercise_plans() from public, anon;
grant execute on function public.my_exercise_plans() to authenticated;
