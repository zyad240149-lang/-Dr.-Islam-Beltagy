-- 197: السماح بتسجيل أكتر من مريض بنفس رقم الجوال (عيلة واحدة) لو الاسم مختلف — الرفض يفضل بس لو نفس الاسم ونفس الجوال (تكرار حقيقي).
-- قبل كده كان أي تطابق في آخر 9 أرقام من الجوال بيترفض فورًا بغض النظر عن الاسم.
create or replace function public.patients_before_insert() returns trigger
language plpgsql security definer set search_path to 'public'
as $function$
declare dup patients; legacy boolean := coalesce(current_setting('app.legacy_import', true), '') = 'on';
begin
  if new.file_no is null or new.file_no = '' then new.file_no := next_patient_file_no(); end if;
  if legacy then if length(trim(new.full_name)) < 1 then raise exception 'اسم المريض مطلوب'; end if; return new; end if;
  if length(trim(new.full_name)) < 2 then raise exception 'اسم المريض مطلوب'; end if; -- استيراد الملف القديم: جوال ناقص/مكرر مسموح (والنواقص بتتعلّم في الواجهة)
  if length(regexp_replace(new.phone, '\D', '', 'g')) < 9 then raise exception 'رقم الجوال غير صحيح'; end if;
  select * into dup from patients x
    where right(regexp_replace(x.phone, '\D', '', 'g'), 9) = right(regexp_replace(new.phone, '\D', '', 'g'), 9)
      and search_norm(x.full_name) = search_norm(new.full_name)
    limit 1;
  if dup.id is not null then raise exception 'هذا المريض مسجّل بالفعل برقم الملف %', dup.file_no; end if;
  return new;
end $function$;
