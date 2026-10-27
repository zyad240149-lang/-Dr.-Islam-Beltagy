-- 150: استيراد ملف المرضى القديم (PATIENTFILE.xlsx — ~9.8 ألف مريض) بكل بياناته الناقصة.
-- - الملف القديم فيه مرضى من غير هوية/جوال، وجوالات مشتركة (عيلة) — بيتحفظوا كلهم، والناقص بيتعلّم ويظهر في صفحة المرضى («بيانات ناقصة»).
-- - الجوال المكرر مسموح في الاستيراد القديم بس (app.legacy_import = on)؛ الإضافة العادية لسه بترفض التكرار.
-- - الجنسية اللي ماتحدّدتش من الملف ولا من الهوية بتتحفظ «سعودي» (القيمة الافتراضية) ومتعلّمة غير مؤكدة (nationality_unconfirmed) لحد ما الموظف يراجعها.
alter table patients add column if not exists nationality_unconfirmed boolean not null default false;

create or replace function patients_before_insert() returns trigger
language plpgsql security definer set search_path = public as $$
declare dup patients; legacy boolean := coalesce(current_setting('app.legacy_import', true), '') = 'on';
begin
  if new.file_no is null or new.file_no = '' then new.file_no := next_counter('patient', 'TM-'); end if;
  if legacy then if length(trim(new.full_name)) < 1 then raise exception 'اسم المريض مطلوب'; end if; return new; end if;
  if length(trim(new.full_name)) < 2 then raise exception 'اسم المريض مطلوب'; end if; -- استيراد الملف القديم: جوال ناقص/مكرر مسموح (والنواقص بتتعلّم في الواجهة)
  if length(regexp_replace(new.phone, '\D', '', 'g')) < 9 then raise exception 'رقم الجوال غير صحيح'; end if;
  select * into dup from patients x where right(regexp_replace(x.phone, '\D', '', 'g'), 9) = right(regexp_replace(new.phone, '\D', '', 'g'), 9) limit 1;
  if dup.id is not null then raise exception 'هذا الرقم مسجّل بالفعل للمريض % (%)', dup.full_name, dup.file_no; end if;
  return new;
end $$;

-- تأكيد الجنسية: أي تعديل في الجنسية أو إضافة هوية صحيحة بيشيل علامة «غير مؤكدة»
create or replace function patients_clear_unconfirmed() returns trigger
language plpgsql set search_path = public as $$
begin
  if new.nationality_unconfirmed and (new.nationality is distinct from old.nationality or (coalesce(new.national_id, '') <> '' and coalesce(old.national_id, '') = '')) then
    new.nationality_unconfirmed := false;
  end if;
  return new;
end $$;
drop trigger if exists trg_patients_unconfirmed on patients;
create trigger trg_patients_unconfirmed before update on patients for each row execute function patients_clear_unconfirmed();
