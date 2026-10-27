-- 146: (1) رقم الهوية/الإقامة بقى إلزامي في الاستيراد (طلب الإدارة: المريض يتضاف ببياناته كاملة: اسم ثلاثي + هوية سعودي/غير سعودي).
--      (2) وضع «استبدال»: patient_import_wipe بيحذف كل المرضى (وكل سجلاتهم) ماعدا المريض اللي إيميله zyad240149@gmail.com — للمدير العام بس،
--          بتأكيد مكتوب «حذف»، ورفض لو فيه فاتورة اتبعتت لهيئة الزكاة، ورفض لو المريض المحتفظ بيه مش موجود. بيتنفّذ مرة واحدة لكل مفتاح (idempotent).
--      (3) patient_import_check(p_rows, p_replace): في وضع الاستبدال بيقارن التكرار بالمريض المحتفظ بيه بس (الباقي هيتحذف).

drop function if exists patient_import_check(jsonb);
drop function if exists import_dup_of(text, text, text, text, date);

create or replace function import_dup_of(p_file_no text, p_nid text, p_phone text, p_name text, p_birth date, p_only_email text default null)
returns table (kind text, matched_by text, match_file_no text, match_name text)
language plpgsql stable security definer set search_path = public as $$
declare m patients; digits text := right(regexp_replace(coalesce(p_phone, ''), '\D', '', 'g'), 9);
begin
  if coalesce(p_file_no, '') <> '' then
    select * into m from patients x where x.file_no = p_file_no and (p_only_email is null or lower(x.email) = p_only_email) limit 1;
    if m.id is not null then return query select 'duplicate', 'file_no', m.file_no, m.full_name; return; end if;
  end if;
  if coalesce(p_nid, '') <> '' then
    select * into m from patients x where x.national_id = p_nid and (p_only_email is null or lower(x.email) = p_only_email) limit 1;
    if m.id is not null then return query select 'duplicate', 'national_id', m.file_no, m.full_name; return; end if;
  end if;
  if length(digits) >= 9 then
    select * into m from patients x where right(regexp_replace(x.phone, '\D', '', 'g'), 9) = digits and (p_only_email is null or lower(x.email) = p_only_email) limit 1;
    if m.id is not null then return query select 'duplicate', 'phone', m.file_no, m.full_name; return; end if;
  end if;
  if p_birth is not null and import_norm_name(p_name) <> '' then
    select * into m from patients x where x.birth_date = p_birth and import_norm_name(x.full_name) = import_norm_name(p_name) and (p_only_email is null or lower(x.email) = p_only_email) limit 1;
    if m.id is not null then return query select 'possible', 'name_birth', m.file_no, m.full_name; return; end if;
  end if;
end $$;
revoke execute on function import_dup_of(text, text, text, text, date, text) from public, anon, authenticated;

create or replace function patient_import_check(p_rows jsonb, p_replace boolean default false) returns jsonb
language plpgsql stable security definer set search_path = public as $$
declare e jsonb; d record; outj jsonb := '[]'; b date;
begin
  perform require_perm('patient_import', 'create');
  if jsonb_typeof(p_rows) <> 'array' then raise exception 'صيغة غير صحيحة'; end if;
  if jsonb_array_length(p_rows) > 1000 then raise exception 'الحد الأقصى 1000 صف في الفحص الواحد'; end if;
  for e in select * from jsonb_array_elements(p_rows) loop
    b := null;
    begin b := nullif(e ->> 'birthDate', '')::date; exception when others then b := null; end;
    select * into d from import_dup_of(nullif(trim(e ->> 'fileNo'), ''), nullif(trim(e ->> 'nationalId'), ''), e ->> 'phone',
      trim(coalesce(e ->> 'firstName', '') || ' ' || coalesce(e ->> 'fatherName', '') || ' ' || coalesce(e ->> 'familyName', '')), b,
      case when p_replace then 'zyad240149@gmail.com' else null end);
    if d.kind is not null then
      outj := outj || jsonb_build_object('i', (e ->> 'i')::int, 'kind', d.kind, 'by', d.matched_by, 'matchFileNo', d.match_file_no, 'matchName', d.match_name);
    end if;
  end loop;
  return outj;
end $$;
revoke execute on function patient_import_check(jsonb, boolean) from public, anon;
grant execute on function patient_import_check(jsonb, boolean) to authenticated;

create or replace function patient_import_wipe(p_key text, p_confirm text) returns jsonb
language plpgsql security definer set search_path = public as $$
declare emp uuid; keep uuid; prev jsonb; n int; res jsonb;
begin
  emp := require_perm('patient_import', 'create');
  if not is_gm() then raise exception 'الاستبدال (حذف المرضى الحاليين) للمدير العام فقط' using errcode = '42501'; end if;
  if p_confirm is distinct from 'حذف' then raise exception 'اكتب كلمة «حذف» للتأكيد'; end if;
  if coalesce(trim(p_key), '') = '' or length(p_key) > 80 then raise exception 'مفتاح العملية غير صحيح'; end if;
  perform pg_advisory_xact_lock(hashtext('patient-import:' || p_key));
  select result into prev from patient_import_batches where key = p_key;
  if prev is not null then return prev || jsonb_build_object('replayed', true); end if;
  select id into keep from patients where lower(email) = 'zyad240149@gmail.com' and not is_guest order by registered_at limit 1;
  if keep is null then raise exception 'المريض المحتفظ به (zyad240149@gmail.com) غير موجود — لم يتم حذف أي شيء'; end if;
  if exists (select 1 from zatca_documents z join invoices i on i.id = z.invoice_id where i.patient_id <> keep) then
    raise exception 'فيه فواتير مرسلة لهيئة الزكاة لمرضى سيتم حذفهم — لا يمكن حذفها قانونيًا. لم يتم حذف أي شيء';
  end if;
  select count(*) into n from patients where id <> keep;
  begin
    delete from patients where id <> keep;
  exception when others then
    raise exception 'تعذّر الحذف لوجود سجلات مرتبطة محمية — لم يتم حذف أي شيء (%)', sqlstate;
  end;
  res := jsonb_build_object('key', p_key, 'wiped', n, 'kept', 1);
  insert into patient_import_batches (key, created_by, total, added, duplicates, review, rejected, result) values (p_key, emp, n, 0, 0, 0, 0, res);
  perform log_action('استبدال المرضى قبل الاستيراد — حُذف ' || n || ' مريض واحتُفظ بمريض واحد', null);
  return res;
end $$;
revoke execute on function patient_import_wipe(text, text) from public, anon;
grant execute on function patient_import_wipe(text, text) to authenticated;

CREATE OR REPLACE FUNCTION public.patient_import_commit(p_key text, p_rows jsonb)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  emp uuid; e jsonb; prev jsonb; res jsonb := '[]'; n_add int := 0; n_dup int := 0; n_rev int := 0; n_rej int := 0; total int;
  i int; fn text; fa text; fam text; nat text; nid text; ph text; gen text; em text; src text; doc uuid; bd date; fno text; act boolean; force boolean;
  d record; new_id uuid; reason text; full_name text; num int; outj jsonb;
begin
  emp := require_perm('patient_import', 'create');
  if coalesce(trim(p_key), '') = '' or length(p_key) > 80 then raise exception 'مفتاح الدفعة غير صحيح'; end if;
  if jsonb_typeof(p_rows) <> 'array' then raise exception 'صيغة غير صحيحة'; end if;
  total := jsonb_array_length(p_rows);
  if total = 0 then raise exception 'لا توجد صفوف'; end if;
  if total > 500 then raise exception 'الحد الأقصى 500 صف في الدفعة الواحدة'; end if;

  perform pg_advisory_xact_lock(hashtext('patient-import:' || p_key));
  select result into prev from patient_import_batches where key = p_key;
  if prev is not null then return prev || jsonb_build_object('replayed', true); end if; -- نفس الدفعة اتنفّذت قبل كده

  perform set_config('app.import_mode', 'on', true);
  for e in select * from jsonb_array_elements(p_rows) loop
    i := (e ->> 'i')::int; reason := null; new_id := null; fno := null; bd := null;
    fn := trim(coalesce(e ->> 'firstName', '')); fa := trim(coalesce(e ->> 'fatherName', '')); fam := trim(coalesce(e ->> 'familyName', ''));
    nat := coalesce(e ->> 'nationality', ''); nid := trim(coalesce(e ->> 'nationalId', '')); ph := regexp_replace(coalesce(e ->> 'phone', ''), '\s', '', 'g');
    gen := nullif(coalesce(e ->> 'gender', ''), ''); em := trim(coalesce(e ->> 'email', '')); src := coalesce(nullif(e ->> 'referralSource', ''), 'other');
    force := coalesce((e ->> 'force')::boolean, false); act := coalesce((e ->> 'active')::boolean, true);
    fno := nullif(trim(coalesce(e ->> 'fileNo', '')), '');
    full_name := trim(fn || ' ' || fa || ' ' || fam);
    begin
      if fn = '' or fa = '' or fam = '' then reason := 'الاسم لازم يكون ثلاثي (الاسم + الأب + العائلة)';
      elsif ph !~ '^\+?\d{9,15}$' then reason := 'رقم الجوال غير صحيح';
      elsif nat not in ('saudi', 'non_saudi') then reason := 'الجنسية غير محددة';
      elsif nid = '' then reason := 'رقم الهوية/الإقامة مطلوب';
      elsif not (nid ~ '^\d{10}$' and ((nat = 'saudi' and nid like '1%') or (nat = 'non_saudi' and nid like '2%'))) then reason := 'رقم الهوية/الإقامة غير صحيح';
      elsif gen is not null and gen not in ('male', 'female') then reason := 'النوع غير صحيح';
      elsif em <> '' and em !~ '^[^@\s]+@[^@\s]+\.[^@\s]+$' then reason := 'البريد الإلكتروني غير صحيح';
      elsif src not in ('instagram', 'facebook', 'twitter', 'snapchat', 'tiktok', 'whatsapp', 'google', 'friend', 'ad', 'website', 'other') then reason := 'مصدر المعرفة غير صحيح';
      elsif nullif(e ->> 'doctorId', '') is not null and not exists (select 1 from therapists t where t.id = (e ->> 'doctorId')::uuid) then reason := 'الطبيب غير موجود';
      elsif length(coalesce(e ->> 'notes', '')) > 4000 or length(coalesce(e ->> 'medicalHistory', '')) > 4000 or length(coalesce(e ->> 'mainComplaint', '')) > 2000 or length(coalesce(e ->> 'diagnosis', '')) > 2000 then reason := 'نص طويل جدًا';
      end if;
      if reason is null and nullif(e ->> 'birthDate', '') is not null then
        begin bd := (e ->> 'birthDate')::date; exception when others then reason := 'تاريخ الميلاد غير صحيح'; end;
        if reason is null and (bd > riyadh_today() or bd < date '1900-01-01') then reason := 'تاريخ الميلاد غير منطقي'; end if;
      end if;
      if reason is not null then
        res := res || jsonb_build_object('i', i, 'status', 'rejected', 'reason', reason); n_rej := n_rej + 1; continue;
      end if;

      select * into d from import_dup_of(fno, nullif(nid, ''), ph, full_name, bd);
      if d.kind = 'duplicate' then
        res := res || jsonb_build_object('i', i, 'status', 'duplicate', 'reason', case d.matched_by when 'file_no' then 'رقم الملف موجود بالفعل' when 'national_id' then 'رقم الهوية موجود بالفعل' else 'رقم الجوال مسجّل لمريض موجود' end,
          'matchFileNo', d.match_file_no);
        n_dup := n_dup + 1; continue;
      end if;
      if d.kind = 'possible' and not force then
        res := res || jsonb_build_object('i', i, 'status', 'review', 'reason', 'نفس الاسم وتاريخ الميلاد لمريض موجود', 'matchFileNo', d.match_file_no);
        n_rev := n_rev + 1; continue;
      end if;

      insert into patients (file_no, full_name, first_name, father_name, family_name, nationality, national_id, phone, email, gender, birth_date, address, city, district, street,
                            referral_source, emergency_contact_name, emergency_contact_phone, notes, main_complaint, diagnosis, medical_history, doctor_id, active)
      values (coalesce(fno, ''), full_name, fn, fa, fam, nat, nid, ph, em, gen, bd, trim(coalesce(e ->> 'address', '')), trim(coalesce(e ->> 'city', '')), trim(coalesce(e ->> 'district', '')), trim(coalesce(e ->> 'street', '')),
              src, trim(coalesce(e ->> 'emergencyContactName', '')), trim(coalesce(e ->> 'emergencyContactPhone', '')), trim(coalesce(e ->> 'notes', '')), trim(coalesce(e ->> 'mainComplaint', '')),
              trim(coalesce(e ->> 'diagnosis', '')), trim(coalesce(e ->> 'medicalHistory', '')), nullif(e ->> 'doctorId', '')::uuid, act)
      returning id, file_no into new_id, fno;
      -- رقم ملف مستورد بصيغة TM-123: العدّاد بيتخطّاه عشان الترقيم التلقائي بعدين مايتصادمش
      if fno ~ '^TM-\d+$' then
        num := substring(fno from 4)::int;
        update counters set value = greatest(value, num) where name = 'patient';
      end if;
      res := res || jsonb_build_object('i', i, 'status', 'added', 'id', new_id, 'fileNo', fno); n_add := n_add + 1;
    exception when others then
      res := res || jsonb_build_object('i', i, 'status', 'rejected', 'reason', case when sqlstate = '23505' then 'رقم الملف أو الجوال مكرر' else 'تعذّر حفظ الصف' end);
      n_rej := n_rej + 1;
    end;
  end loop;

  outj := jsonb_build_object('key', p_key, 'total', total, 'added', n_add, 'duplicates', n_dup, 'review', n_rev, 'rejected', n_rej, 'results', res);
  insert into patient_import_batches (key, created_by, total, added, duplicates, review, rejected, result) values (p_key, emp, total, n_add, n_dup, n_rev, n_rej, outj);
  perform log_action('استيراد مرضى من Excel — أُضيف ' || n_add || '، مكرر ' || n_dup || '، للمراجعة ' || n_rev || '، مرفوض ' || n_rej, null);
  return outj;
end $function$
;
