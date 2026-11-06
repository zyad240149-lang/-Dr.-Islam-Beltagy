-- 951: الاسم والموبايل مطابقين = نفس المريض، حتى لو النوع أو السن مختلفين في الملف (غالبًا اتسجلوا غلط، زي النوع الافتراضي).
-- الاختلاف في النوع/السن بيوقف الربط بس لما مايكونش فيه موبايل مطابق. وبعد التحديث بنعيد مطابقة التشخيصات اللي لسه مش مربوطة.

create or replace function public.ortho_try_link(p_id uuid) returns void
language plpgsql security definer set search_path to 'public' as $$
declare c ortho_consultations; v_name text; v_phone text; v_age int; v_gender text;
  n_all int; n_ok int; v_pick uuid; v_phone_ok boolean; v_recent boolean; n_ph int; n_ph_ok int; v_ph_pick uuid;
begin
  select * into c from ortho_consultations where id = p_id and patient_id is null;
  if not found then return; end if;
  v_name := norm_ar_name(c.pending_patient->>'name');
  v_phone := right(regexp_replace(coalesce(c.pending_patient->>'phone', ''), '\D', '', 'g'), 9);
  v_age := case when coalesce(c.pending_patient->>'age', '') ~ '^\d{1,3}$' then (c.pending_patient->>'age')::int end;
  v_gender := nullif(c.pending_patient->>'gender', '');
  if array_length(string_to_array(v_name, ' '), 1) is distinct from null and array_length(string_to_array(v_name, ' '), 1) < 3 then
    update ortho_consultations set link_status = 'review', link_note = 'الاسم أقل من ثلاثي — اختار ملف المريض يدويًا' where id = p_id;
    return;
  end if;
  with cand as (
    select p.id, p.registered_at,
      (length(v_phone) = 9 and right(regexp_replace(coalesce(p.phone, ''), '\D', '', 'g'), 9) = v_phone) as phone_eq,
      (length(v_phone) = 9 and length(regexp_replace(coalesce(p.phone, ''), '\D', '', 'g')) >= 9
         and right(regexp_replace(p.phone, '\D', '', 'g'), 9) <> v_phone) as phone_clash,
      (v_gender is not null and p.gender is not null and p.gender <> v_gender) as gender_clash,
      (v_age is not null and p.birth_date is not null and abs(extract(year from age(c.date, p.birth_date)) - v_age) > 1) as age_clash
    from patients p where names_typo_close(p.full_name, v_name)
  )
  select count(*), count(*) filter (where not (phone_clash or ((gender_clash or age_clash) and not phone_eq))),
         (array_agg(id) filter (where not (phone_clash or ((gender_clash or age_clash) and not phone_eq))))[1],
         bool_or(phone_eq) filter (where not (phone_clash or ((gender_clash or age_clash) and not phone_eq))),
         bool_or(abs(registered_at::date - c.date) <= 2) filter (where not (phone_clash or ((gender_clash or age_clash) and not phone_eq)))
    into n_all, n_ok, v_pick, v_phone_ok, v_recent from cand;
  if n_ok = 1 and (v_phone_ok or (n_all = 1 and v_recent)) then
    perform ortho_link_consult(p_id, v_pick, 'auto');
  elsif n_all = 0 then
    -- مفيش اسم قريب: الموبايل هو اللي بيحسم
    if length(v_phone) = 9 then
      select count(*),
             count(*) filter (where not ((v_gender is not null and p.gender is not null and p.gender <> v_gender)
               or (v_age is not null and p.birth_date is not null and abs(extract(year from age(c.date, p.birth_date)) - v_age) > 1))),
             (array_agg(p.id) filter (where not ((v_gender is not null and p.gender is not null and p.gender <> v_gender)
               or (v_age is not null and p.birth_date is not null and abs(extract(year from age(c.date, p.birth_date)) - v_age) > 1))))[1]
        into n_ph, n_ph_ok, v_ph_pick
        from patients p where right(regexp_replace(coalesce(p.phone, ''), '\D', '', 'g'), 9) = v_phone;
      if n_ph = 1 and n_ph_ok = 1 then
        perform ortho_link_consult(p_id, v_ph_pick, 'auto');
        return;
      elsif n_ph > 0 then
        update ortho_consultations set link_status = 'review', link_note = 'الموبايل ده على ملف باسم مختلف أو على أكتر من ملف — راجع واختار' where id = p_id;
        return;
      end if;
    end if;
    update ortho_consultations set link_status = 'waiting', link_note = 'مفيش ملف مريض بالاسم أو الموبايل ده لسه — هيتربط تلقائي أول ما ملف الاستقبال يوصل' where id = p_id;
  else
    update ortho_consultations set link_status = 'review', link_note = case
      when n_ok > 1 then 'فيه ' || n_ok || ' ملفات بنفس الاسم أو قريبة منه — اختار الملف الصح'
      when n_ok = 0 then 'فيه ملف بنفس الاسم أو قريب منه بس بياناته مختلفة (الموبايل/السن/النوع) — راجع واختار'
      else 'فيه ملف بنفس الاسم أو قريب منه بس قديم ومفيش موبايل يأكد إنه نفس الشخص — راجع واختار' end
    where id = p_id;
  end if;
end $$;
revoke execute on function public.ortho_try_link(uuid) from anon, authenticated, public;

do $$ declare x uuid; begin
  for x in select id from ortho_consultations where patient_id is null loop perform ortho_try_link(x); end loop;
end $$;
