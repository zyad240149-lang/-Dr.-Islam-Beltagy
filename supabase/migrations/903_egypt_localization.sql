-- 903 (مولَّد بـ scripts/gen-egypt-migration.mjs): توطين مصر في دوال القاعدة
--  • الرقم القومي المصري (14 رقم يبدأ بـ 2/3) للمصري، ورقم جواز السفر (6–20 حرف/رقم) للأجنبي — بدل الهوية/الإقامة السعودية
--  • «مصري / أجنبي» بدل «سعودي / غير سعودي» (القيم المخزنة saudi/non_saudi زي ما هي)، و ج.م بدل ر.س
--  • مكافأة الولاء بقيمة جلسة التأهيل sv_physio

CREATE OR REPLACE FUNCTION public.apply_discount(p_invoice uuid, p_amount numeric)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare inv invoices;
begin
  perform require_perm('inv_price', 'view');
  perform require_perm('invoices', 'edit');
  select * into inv from invoices where id = p_invoice for update;
  if inv.id is null then raise exception 'الفاتورة غير موجودة'; end if;
  if inv.status = 'cancelled' then raise exception 'الفاتورة ملغاة'; end if;
  if p_amount < 0 or p_amount > inv.price then raise exception 'قيمة الخصم غير صحيحة'; end if;
  if inv.price - p_amount < inv.paid then raise exception 'الإجمالي بعد الخصم أقل من المدفوع فعلًا'; end if;
  update invoices set discount = p_amount where id = p_invoice;
  perform recalc_invoice(p_invoice);
  perform log_action('خصم ' || p_amount || ' ج.م على ' || inv.no, inv.patient_id);
end $function$
;

CREATE OR REPLACE FUNCTION public.apply_discount_code(p_invoice uuid, p_code text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare inv invoices; dc discount_codes; amount numeric; t date := riyadh_today();
begin
  perform require_perm('invoices', 'edit');
  select * into inv from invoices where id = p_invoice for update;
  if inv.id is null then raise exception 'الفاتورة غير موجودة'; end if;
  if inv.status = 'cancelled' then raise exception 'الفاتورة ملغاة'; end if;
  if inv.discount_code is not null then raise exception 'تم تطبيق الكود % على هالفاتورة بالفعل', inv.discount_code; end if;
  select * into dc from discount_codes where id = find_discount_code(p_code) for update;
  if dc.id is null then raise exception 'كود الخصم غير صحيح'; end if;
  if dc.patient_id is not null and dc.patient_id <> inv.patient_id then raise exception 'هذا الكود خاص بمريض آخر ولا يمكن استخدامه هنا'; end if;
  if not dc.active then raise exception 'كود الخصم موقوف'; end if;
  if dc.used_count >= dc.max_uses then raise exception 'تم استهلاك كل مرات استخدام الكود'; end if;
  if t < dc.valid_from then raise exception 'الكود يبدأ من %', dc.valid_from; end if;
  if t > dc.valid_to then raise exception 'انتهت صلاحية الكود في %', dc.valid_to; end if;
  if inv.price < dc.min_amount then raise exception 'الكود يتطلب حدًّا أدنى للطلب % — قيمة الفاتورة %', dc.min_amount, inv.price; end if;
  amount := least(inv.price, case when dc.type = 'percent' then round(inv.price * dc.value / 100) else dc.value end);
  if inv.price - amount < inv.paid then raise exception 'الإجمالي بعد الخصم أقل من المدفوع فعلًا'; end if;
  update invoices set discount = amount, discount_code = dc.code, discount_code_id = dc.id,
    service_name = case when amount >= inv.price then 'جلسة مجانية - مكافأة ولاء' else service_name end
  where id = p_invoice;
  update discount_codes set used_count = used_count + 1 where id = dc.id;
  insert into coupon_usage (coupon_id, invoice_id, patient_id, amount, used_by) values (dc.id, p_invoice, inv.patient_id, amount, my_employee_id());
  perform recalc_invoice(p_invoice);
  perform log_action('تطبيق كود الخصم ' || dc.code || ' (' || amount || ' ج.م) على ' || inv.no, inv.patient_id);
  return jsonb_build_object('amount', amount);
end $function$
;

CREATE OR REPLACE FUNCTION public.create_invoice(p jsonb)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare v uuid; pat patients; it jsonb; subtotal numeric := 0; names text := ''; disc numeric := _num(p, 'discount');
begin
  perform require_perm('invoices', 'create');
  select * into pat from patients where id = _uuid(p, 'patientId');
  if pat.id is null then raise exception 'اختر المريض'; end if;
  if jsonb_typeof(p->'items') <> 'array' or jsonb_array_length(p->'items') = 0 then raise exception 'أضف بندًا واحدًا على الأقل'; end if;
  for it in select * from jsonb_array_elements(p->'items') loop
    if _txt(it, 'description') = '' then raise exception 'وصف البند مطلوب'; end if;
    if _num(it, 'qty', 1) <= 0 or _num(it, 'unitPrice', -1) < 0 then raise exception 'تحقق من كمية وسعر البند «%»', _txt(it, 'description'); end if;
    subtotal := subtotal + _num(it, 'qty', 1) * _num(it, 'unitPrice');
    names := names || case when names = '' then '' else '، ' end || _txt(it, 'description');
  end loop;
  if disc < 0 or disc > subtotal then raise exception 'قيمة الخصم غير صحيحة'; end if;
  insert into invoices (no, patient_id, appointment_id, plan_id, service_name, price, discount, status, date, tax_rate, note, created_by)
  values (next_counter('invoice', 'INV-'), pat.id, _uuid(p, 'appointmentId'), _uuid(p, 'planId'), left(names, 300), subtotal, disc, 'due',
          coalesce(nullif(p->>'date', '')::date, riyadh_today()), (select tax_rate from center_info limit 1), _txt(p, 'note'), my_employee_id())
  returning id into v;
  insert into invoice_items (invoice_id, service_id, description, qty, unit_price)
  select v, nullif(e->>'serviceId', ''), trim(e->>'description'), coalesce(nullif(e->>'qty', '')::numeric, 1), (e->>'unitPrice')::numeric
  from jsonb_array_elements(p->'items') e;
  perform recalc_invoice(v);
  perform log_action('إصدار فاتورة يدوية ' || (select no from invoices where id = v) || ' بقيمة ' || subtotal || ' ج.م', pat.id);
  perform notify_patient(pat.id, 'invoice', 'فاتورة جديدة', 'تم إصدار فاتورة بقيمة ' || (select total from invoices where id = v) || ' ج.م', v::text);
  return jsonb_build_object('id', v);
end $function$
;

CREATE OR REPLACE FUNCTION public.delete_payment(p_id uuid)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare pay payments;
begin
  perform require_perm('payments', 'delete');
  select * into pay from payments where id = p_id;
  if pay.id is null then raise exception 'الدفعة غير موجودة'; end if;
  if exists (select 1 from invoices i join packages k on k.id = i.package_id where i.id = pay.invoice_id and k.kind is not null) or exists (select 1 from package_installment_requests where invoice_id = pay.invoice_id and status in ('pending','approved','rejected')) then
    raise exception 'دفعات باقات الجلسات لا تُحذف — استخدم إلغاء الدفعة (يحتفظ بالسجل)'; end if;
  delete from payments where id = p_id;
  perform recalc_invoice(pay.invoice_id);
  perform log_action('حذف دفعة ' || pay.amount || ' ج.م من ' || (select no from invoices where id = pay.invoice_id), pay.patient_id);
end $function$
;

CREATE OR REPLACE FUNCTION public.invoices_notify_issued()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
begin
  if new.patient_id is not null and new.status not in ('draft', 'cancelled')
     and (tg_op = 'INSERT' or old.status in ('draft')) then
    begin
      -- نفس شكل المفتاح التلقائي (invoice:<id>:<customer>) — فأي مسار تاني بيبعت «فاتورة» لنفس الفاتورة بيتمنع تكراره
      perform notify_patient_keyed(new.patient_id, 'invoice', 'فاتورة جديدة رقم ' || new.no,
        'تم إصدار فاتورة رقم ' || new.no || ' بإجمالي ' || new.total || ' ج.م. التفاصيل والمدفوعات في صفحة الفواتير.',
        new.id::text, 'invoice:' || new.id, null, null, '/me/invoices', 'invoice.issued', null);
    exception when others then raise warning 'invoice notify: %', sqlerrm;
    end;
  end if;
  return null;
end $function$
;

CREATE OR REPLACE FUNCTION public.list_patients(p_q text DEFAULT ''::text, p_gender text DEFAULT ''::text, p_source text DEFAULT ''::text, p_active text DEFAULT ''::text, p_doctor uuid DEFAULT NULL::uuid, p_sort text DEFAULT 'registered_desc'::text, p_limit integer DEFAULT 20, p_offset integer DEFAULT 0, p_gaps text DEFAULT ''::text)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare pat text; res jsonb; lim int := least(greatest(coalesce(p_limit, 20), 1), 200); off int := greatest(coalesce(p_offset, 0), 0); v_ok boolean;
begin
  perform require_perm('patients', 'view');
  v_ok := can_see_patient(null); -- بتتحسب مرة واحدة (مش لكل صف): بتعتمد على الموظف مش على المريض
  if not v_ok then return jsonb_build_object('total', 0, 'rows', '[]'::jsonb); end if;
  pat := '%' || replace(replace(replace(trim(coalesce(p_q, '')), '\', '\'), '%', '\%'), '_', '\_') || '%';
  with f as (
    select p.*, t.name as doctor_name,
      case when p_sort = 'last_visit_desc' then (select max(a.date) from appointments a where a.patient_id = p.id and a.status in ('completed','arrived','in_progress')) end as sort_visit
    from patients p left join therapists t on t.id = p.doctor_id
    where not p.is_guest
      and (trim(coalesce(p_q, '')) = '' or patient_q_match(p.full_name, p.phone, p.file_no, p.national_id, p_q))
      and (coalesce(p_gender, '') = '' or p.gender = p_gender)
      and (coalesce(p_source, '') = '' or p.referral_source = p_source)
      and (coalesce(p_active, '') = '' or p.active = (p_active = 'on'))
      and (p_doctor is null or p.doctor_id = p_doctor)
      and (coalesce(p_gaps, '') = ''
        or (p_gaps = 'any' and cardinality(patient_missing_fields(p)) > 0)
        or (p_gaps = 'id' and case when p.nationality = 'non_saudi' then coalesce(p.national_id, '') !~ '^[A-Za-z0-9]{6,20}$' else coalesce(p.national_id, '') !~ '^[23][0-9]{13}$' end)
        or (p_gaps = 'phone' and length(regexp_replace(coalesce(p.phone, ''), '\D', '', 'g')) < 9)
        or (p_gaps = 'name' and name_words(p.full_name) < 3)
        or (p_gaps = 'nationality' and (p.nationality_unconfirmed or coalesce(p.nationality, '') not in ('saudi', 'non_saudi')))
        or (p_gaps = 'gender' and coalesce(p.gender, '') not in ('male', 'female')))
  ), pg as (
    select f.*, row_number() over (order by
      case when trim(coalesce(p_q, '')) = '' then 0 else patient_q_rank(f.file_no, f.national_id, f.phone, p_q) end asc,
      case when trim(coalesce(p_q, '')) = '' then 0 else patient_name_rank(f.full_name, p_q) end asc,
      case when p_sort = 'name_asc' then f.full_name end asc, case when p_sort = 'name_desc' then f.full_name end desc,
      case when p_sort = 'file_asc' then coalesce(nullif(regexp_replace(f.file_no, '\D', '', 'g'), '')::bigint, 0) end asc,
      case when p_sort = 'file_desc' then coalesce(nullif(regexp_replace(f.file_no, '\D', '', 'g'), '')::bigint, 0) end desc,
      case when p_sort = 'last_visit_desc' then f.sort_visit end desc nulls last,
      case when p_sort = 'registered_asc' then f.registered_at end asc,
      f.registered_at desc) as rn from f
  ), pgp as (select * from pg where rn > off and rn <= off + lim)
  select jsonb_build_object('total', (select count(*) from f),
    'rows', coalesce((select jsonb_agg(to_jsonb(x) order by x.rn) from (
      select pgp.*,
        (select max(a.date) from appointments a where a.patient_id = pgp.id and a.status in ('completed','arrived','in_progress')) as last_visit,
        (select min(a.date) from appointments a where a.patient_id = pgp.id and a.status in ('new','confirmed','rescheduled') and a.date >= riyadh_today()) as next_visit,
        (select coalesce(sum(i.remaining), 0) from invoices i where i.patient_id = pgp.id and i.status in ('due','partial')) as balance,
        exists (select 1 from customers c where c.patient_id = pgp.id) as has_account
      from pgp) x), '[]'))
  into res;
  return res;
end $function$
;

CREATE OR REPLACE FUNCTION public.loyalty_redeem_core(p_patient uuid, p_sessions integer, p_emp uuid, p_beneficiary_name text, p_beneficiary_phone text, p_beneficiary_relation text, p_idempotency_key text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare bal int; unit int; cost int; v_code text; dc_id uuid; reward_val numeric; existing loyalty_redemptions; ben_patient uuid; ben_digits text;
  n int := coalesce(p_sessions, 1);
begin
  if n not in (1, 2) then raise exception 'اختر جلسة واحدة أو جلستين'; end if;
  if p_idempotency_key is not null then
    select * into existing from loyalty_redemptions where idempotency_key = p_idempotency_key;
    if existing.id is not null then
      return jsonb_build_object('code', (select code from discount_codes where id = existing.discount_code_id), 'sessions', n,
        'remaining', (select coalesce(sum(points), 0) from loyalty_ledger where patient_id = existing.patient_id));
    end if;
  end if;
  perform pg_advisory_xact_lock(hashtext('loyalty:' || p_patient::text)); -- منع الاستبدال المزدوج بالتوازي
  if p_idempotency_key is not null then
    select * into existing from loyalty_redemptions where idempotency_key = p_idempotency_key;
    if existing.id is not null then
      return jsonb_build_object('code', (select code from discount_codes where id = existing.discount_code_id), 'sessions', n,
        'remaining', (select coalesce(sum(points), 0) from loyalty_ledger where patient_id = existing.patient_id));
    end if;
  end if;
  if not exists (select 1 from patients where id = p_patient) then raise exception 'المريض غير موجود'; end if;
  select coalesce(loyalty_redeem_cost, 30) into unit from center_info limit 1;
  cost := unit * n;
  select coalesce(sum(points), 0) into bal from loyalty_ledger where patient_id = p_patient;
  if bal < cost then raise exception 'رصيد النقاط أقل من % نقطة — الرصيد الحالي % نقطة', cost, bal; end if;

  if nullif(trim(coalesce(p_beneficiary_phone, '')), '') is not null then
    ben_digits := regexp_replace(p_beneficiary_phone, '\D', '', 'g');
    select id into ben_patient from patients where regexp_replace(phone, '\D', '', 'g') like '%' || right(ben_digits, 9) order by registered_at desc limit 1;
  end if;

  select price into reward_val from services where id = 'sv_physio';
  reward_val := coalesce(reward_val, 250);
  loop
    v_code := 'FREE-' || upper(substr(md5(random()::text || clock_timestamp()::text), 1, 6));
    exit when not exists (select 1 from discount_codes where discount_codes.code = v_code);
  end loop;
  -- قيمة الكود = جلسة واحدة لكل استخدام، وعدد مرات الاستخدام = عدد الجلسات
  insert into discount_codes (code, type, value, valid_from, valid_to, max_uses, min_amount, active, note, created_by, patient_id)
  values (v_code, 'fixed', reward_val, riyadh_today(), riyadh_today() + 365, n, 0, true,
    'مكافأة نقاط ولاء — ' || case when n = 2 then 'جلستين مجانيتين' else 'جلسة مجانية' end, p_emp,
    coalesce(ben_patient, case when p_beneficiary_phone is null then p_patient else null end))
  returning id into dc_id;
  insert into loyalty_redemptions (patient_id, points_used, discount_code_id, created_by, beneficiary_name, beneficiary_phone, beneficiary_relation, idempotency_key)
  values (p_patient, cost, dc_id, p_emp, nullif(trim(coalesce(p_beneficiary_name, '')), ''), nullif(trim(coalesce(p_beneficiary_phone, '')), ''),
    nullif(trim(coalesce(p_beneficiary_relation, '')), ''), p_idempotency_key);
  perform award_loyalty_points(p_patient, 'redeem', -cost, 'استبدال ' || cost || ' نقطة (' || n || ' جلسة) — كود ' || v_code, 'redemption', dc_id);
  perform log_action('استبدال ' || cost || ' نقطة ولاء مقابل كود ' || v_code || ' (' || n || ' جلسة)'
    || case when p_emp is null then ' — من حساب المريض' else '' end
    || case when p_beneficiary_name is not null then ' — للمستفيد: ' || p_beneficiary_name else '' end, p_patient);
  if p_emp is null then
    perform notify_staff('loyalty', 'استبدال نقاط من المريض', (select full_name from patients where id = p_patient) || ' — كود ' || v_code || ' (' || n || ' جلسة)', v_code, '/loyalty', p_patient);
  end if;
  return jsonb_build_object('code', v_code, 'sessions', n, 'points', cost, 'remaining', bal - cost);
end $function$
;

CREATE OR REPLACE FUNCTION public.online_accounts(p_q text DEFAULT ''::text)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare q text := trim(coalesce(p_q, '')); pat text := '%' || trim(coalesce(p_q, '')) || '%';
begin
  perform require_perm('online_accounts', 'view');
  return coalesce((
    select jsonb_agg(row_to_json(x) order by x."memberSince" desc) from (
      select c.id as "customerId", p.id as "patientId", coalesce(nullif(p.full_name, ''), c.name) as name, coalesce(nullif(p.phone, ''), c.phone) as phone,
        nullif(regexp_replace(coalesce(p.file_no, ''), '\D', '', 'g'), '') as "fileNo",
        case when p.nationality = 'non_saudi' then 'جواز سفر' when p.nationality = 'saudi' then 'رقم قومي' end as "idType",
        nullif(p.national_id, '') as "nationalId", c.member_since as "memberSince", c.email,
        case when exists (select 1 from auth.identities i where i.user_id = c.auth_user_id and i.provider = 'google') then 'google' else 'phone' end as "signupMethod",
        coalesce(to_jsonb(patient_missing_fields(p)), '[]'::jsonb) as missing,
        (select count(*) from appointments a where a.patient_id = p.id and a.status <> 'cancelled')::int as "bookings",
        (select count(*) from appointments a where a.patient_id = p.id and a.source = 'online')::int as "onlineBookings",
        (select min(a.date)::text from appointments a where a.patient_id = p.id and a.status in ('new', 'confirmed', 'on_way', 'rescheduled') and a.date >= riyadh_today()) as "nextDate",
        (select max(a.date)::text from appointments a where a.patient_id = p.id and a.status <> 'cancelled' and a.date < riyadh_today()) as "lastDate"
      from customers c left join patients p on p.id = c.patient_id
      where coalesce(p.notes, '') not in ('TEST_SEED', 'QA_CLEANUP')
        and (q = '' or patient_q_match(coalesce(p.full_name, c.name), coalesce(p.phone, c.phone), p.file_no, p.national_id, q) or patient_q_match(c.name, c.phone, null, null, q))
    ) x), '[]'::jsonb);
end $function$
;

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
  if total = 0 then raise exception 'ما فيه صفوف'; end if;
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
      if fn = '' or fa = '' or fam = '' then reason := 'لازم يكون الاسم ثلاثيًا (الاسم + الأب + العائلة)';
      elsif ph !~ '^\+?\d{9,15}$' then reason := 'رقم الجوال غير صحيح';
      elsif nat not in ('saudi', 'non_saudi') then reason := 'الجنسية غير محددة';
      elsif nid = '' then reason := 'الرقم القومي / جواز السفر مطلوب';
      elsif not ((nat = 'saudi' and nid ~ '^[23][0-9]{13}$') or (nat = 'non_saudi' and nid ~ '^[A-Za-z0-9]{6,20}$')) then reason := 'الرقم القومي (14 رقم) أو رقم جواز السفر غير صحيح';
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

CREATE OR REPLACE FUNCTION public.patient_missing_fields(p patients)
 RETURNS text[]
 LANGUAGE sql
 STABLE
 SET search_path TO 'public'
AS $function$
  select array_remove(array[
    case when name_words(p.full_name) < 3 or not is_arabic_name(regexp_replace(coalesce(p.full_name, ''), '\s+', ' ', 'g')) then 'الاسم الثلاثي بالعربي' end,
    case when length(regexp_replace(coalesce(p.phone, ''), '\D', '', 'g')) < 9 then 'رقم الجوال' end,
    case when coalesce(p.nationality, '') not in ('saudi', 'non_saudi') or coalesce(p.nationality_unconfirmed, false) then 'الجنسية (مصري / أجنبي)' end,
    case when (coalesce(p.nationality, 'saudi') <> 'non_saudi' and coalesce(p.national_id, '') !~ '^[23][0-9]{13}$')
           or (p.nationality = 'non_saudi' and coalesce(p.national_id, '') !~ '^[A-Za-z0-9]{6,20}$')
         then case when p.nationality = 'non_saudi' then 'رقم جواز السفر' else 'الرقم القومي' end end,
    case when coalesce(p.gender, '') not in ('male', 'female') then 'الجنس' end
  ], null)
$function$
;

CREATE OR REPLACE FUNCTION public.payments_notify()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare inv invoices;
begin
  if new.voided_at is null and new.amount > 0 then
    select * into inv from invoices where id = new.invoice_id;
    begin
      perform notify_patient_keyed(coalesce(new.patient_id, inv.patient_id), 'payment', 'تم تسجيل دفعة',
        'تم تسجيل دفعة ' || new.amount || ' ج.م على الفاتورة ' || coalesce(inv.no, '') || '. المتبقي ' || coalesce(inv.remaining, 0) || ' ج.م.',
        new.id::text, 'payment:' || new.id, null, null, '/me/invoices', 'payment.recorded', null);
    exception when others then raise warning 'payment notify: %', sqlerrm;
    end;
  end if;
  return null;
end $function$
;

CREATE OR REPLACE FUNCTION public.payroll_pay(p jsonb)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare emp uuid := require_gm('create'); d payroll_dues; per payroll_periods; k text := _txt(p, 'kind'); m text := coalesce(nullif(_txt(p, 'method'), ''), 'transfer');
  amt numeric; dt date; key text := nullif(_txt(p, 'clientKey'), ''); paid numeric; due_amt numeric; v uuid; vno text; ex payroll_payouts;
begin
  if key is not null then
    select * into ex from payroll_payouts where client_key = key;
    if ex.id is not null then return jsonb_build_object('id', ex.id, 'no', ex.no, 'amount', ex.amount, 'duplicate', true); end if;
  end if;
  begin amt := round((p->>'amount')::numeric, 2); exception when others then raise exception 'اكتب مبلغ صحيح'; end;
  begin dt := coalesce(nullif(p->>'paidOn', '')::date, riyadh_today()); exception when others then raise exception 'تاريخ الصرف غير صحيح'; end;
  if amt is null or amt <= 0 then raise exception 'لازم يكون مبلغ الصرف أكبر من صفر'; end if;
  if dt > riyadh_today() then raise exception 'تاريخ الصرف ما ينفع يكون في المستقبل'; end if;
  if k not in ('salary', 'bonus') then raise exception 'نوع المستحق غير صحيح'; end if;
  if m not in ('cash', 'transfer') then raise exception 'طريقة الصرف غير صحيحة'; end if;
  select * into d from payroll_dues where id = _uuid(p, 'dueId') for update;
  if d.id is null then raise exception 'المستحق غير موجود — اعتمد الشهر أولًا'; end if;
  -- بعد القفل: لو نفس العملية (نفس المفتاح) اتسجّلت في نفس اللحظة من ضغطة تانية، نرجّعها بدل ما نسجّل مرتين
  if key is not null then
    select * into ex from payroll_payouts where client_key = key;
    if ex.id is not null then return jsonb_build_object('id', ex.id, 'no', ex.no, 'amount', ex.amount, 'duplicate', true); end if;
  end if;
  select * into per from payroll_periods where period = d.period;
  if per.status not in ('approved', 'closed') then raise exception 'اعتمد الشهر أولًا قبل الصرف'; end if;
  due_amt := case when k = 'salary' then d.salary_due else d.bonus_due end;
  select coalesce(sum(amount), 0) into paid from payroll_payouts where due_id = d.id and kind = k and status = 'paid';
  if k = 'bonus' and d.subject_type = 'therapist' and paid + amt > due_amt then
    update payroll_dues set bonus_due = paid + amt, auto_sync = false, updated_at = now(), updated_by = emp where id = d.id;
    perform payroll_log('صرف مكافأة بدون استحقاق تارجت (رفع المكافأة المعتمدة)', d.period, d.subject_name, _txt(p, 'note'),
      jsonb_build_object('before', due_amt, 'after', paid + amt, 'amount', amt, 'qualifying', d.qualifying, 'target', d.monthly_target));
    due_amt := paid + amt;
  end if;
  if due_amt <= 0 then raise exception '% — ما فيه % مستحق', d.subject_name, case when k = 'salary' then 'راتب' else 'مكافأة' end; end if;
  if paid + amt > due_amt then raise exception 'المبلغ أكبر من المتبقي (% ج.م)', due_amt - paid; end if;
  vno := 'PR-' || lpad(nextval('payroll_payout_no_seq')::text, 6, '0');
  insert into payroll_payouts (no, due_id, kind, amount, paid_on, method, reference, note, client_key, created_by)
  values (vno, d.id, k, amt, dt, m, _txt(p, 'reference'), _txt(p, 'note'), key, emp) returning id into v;
  perform payroll_log(case when k = 'salary' then 'صرف راتب' else 'صرف مكافأة' end, d.period, d.subject_name, _txt(p, 'note'),
    jsonb_build_object('no', vno, 'amount', amt, 'paidOn', dt, 'method', m, 'reference', _txt(p, 'reference'), 'remainingAfter', due_amt - paid - amt));
  return jsonb_build_object('id', v, 'no', vno, 'amount', amt, 'remaining', due_amt - paid - amt);
end $function$
;

CREATE OR REPLACE FUNCTION public.record_payment(p_invoice uuid, p_amount numeric, p_method text, p_note text DEFAULT ''::text)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare inv invoices; pk packages; req package_installment_requests; n_paid int; inst int; governed boolean;
begin
  perform require_perm('payments', 'create');
  select * into inv from invoices where id = p_invoice for update;
  if inv.id is null then raise exception 'الفاتورة غير موجودة'; end if;
  if inv.status = 'cancelled' then raise exception 'ما يمكن الدفع على فاتورة ملغاة'; end if;
  if inv.status = 'draft' then raise exception 'الفاتورة بانتظار المراجعة والاعتماد أولًا'; end if;
  if not is_payment_method(p_method) then raise exception 'طريقة الدفع غير صحيحة'; end if;
  if p_amount is null or p_amount <= 0 or p_amount > inv.remaining then raise exception 'المبلغ لازم يكون بين 1 و % ج.م', inv.remaining; end if;

  if inv.package_id is not null then select * into pk from packages where id = inv.package_id; end if;
  -- خاضعة للتقسيط: باقة 4/6 دايمًا، أو فاتورة خطة علاجية عليها طلب تقسيط (بانتظار/موافق/مرفوض)
  governed := pk.kind is not null or (inv.plan_id is not null and exists (select 1 from package_installment_requests where invoice_id = inv.id and status in ('pending','approved','rejected')));
  if governed then
    if pk.status = 'cancelled' then raise exception 'الباقة ملغاة'; end if;
    select * into req from package_installment_requests where invoice_id = inv.id and status in ('pending','approved') limit 1;
    select count(*) into n_paid from payments where invoice_id = inv.id and voided_at is null;
    if req.status = 'pending' then
      raise exception 'طلب الدفع على دفعتين بانتظار موافقة المدير — ما يمكن تسجيل أي دفعة الحين';
    elsif req.status = 'approved' then
      if req.total <> inv.total then raise exception 'قيمة الفاتورة تغيّرت بعد الموافقة على التقسيط — يلزم طلب جديد'; end if;
      if n_paid = 0 then
        if p_amount <> req.first_amount then raise exception 'الدفعة الأولى لازم تكون % ج.م بالضبط (50%%)', req.first_amount; end if;
        inst := 1;
      else
        if p_amount <> inv.remaining then raise exception 'الدفعة الثانية لازم تكون المتبقي بالكامل: % ج.م', inv.remaining; end if;
        inst := 2;
      end if;
    else
      -- بدون موافقة (أو بعد الرفض): الدفع الكامل فقط
      if n_paid > 0 or p_amount <> inv.remaining then
        raise exception 'الدفع الجزئي غير مسموح لهذه الفاتورة بدون موافقة المدير — ادفع المبلغ كاملًا (% ج.م) أو أرسل طلب الدفع على دفعتين', inv.remaining;
      end if;
    end if;
  end if;

  insert into payments (invoice_id, patient_id, amount, method, note, created_by, installment_no, installment_approved_by)
  values (p_invoice, inv.patient_id, p_amount, p_method, coalesce(p_note, ''), my_employee_id(), inst, case when inst is not null then req.decided_by end);
  perform recalc_invoice(p_invoice);
  perform log_action('تسجيل ' || case inst when 1 then 'الدفعة الأولى ' when 2 then 'الدفعة الثانية ' else 'دفعة ' end
    || p_amount || ' ج.م على ' || inv.no, inv.patient_id);
end $function$
;

CREATE OR REPLACE FUNCTION public.request_package_installment(p_invoice uuid, p_reason text DEFAULT NULL::text, p_first_due date DEFAULT NULL::date, p_second_due date DEFAULT NULL::date)
 RETURNS uuid
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare emp uuid; inv invoices; pk packages; v uuid; first_amt numeric; d1 date; d2 date;
begin
  emp := require_perm('installments', 'create');
  select * into inv from invoices where id = p_invoice for update;
  if inv.id is null then raise exception 'الفاتورة غير موجودة'; end if;
  if inv.package_id is not null then select * into pk from packages where id = inv.package_id; end if;
  if pk.kind is null and inv.plan_id is null then raise exception 'الدفع على دفعتين متاح فقط لباقة 4 جلسات وباقة 6 جلسات وفواتير الخطط العلاجية'; end if;
  if inv.status = 'draft' and inv.plan_id is null then raise exception 'اعتمد الفاتورة أولًا'; end if;
  if inv.status = 'cancelled' or pk.status = 'cancelled' then raise exception 'الفاتورة أو الباقة ملغاة'; end if;
  if inv.total <= 0 then raise exception 'إجمالي الفاتورة صفر'; end if;
  if inv.paid > 0 then raise exception 'تم تسجيل دفع على الفاتورة بالفعل — ما يمكن طلب التقسيط'; end if;
  if exists (select 1 from package_installment_requests where invoice_id = inv.id and status = 'pending') then raise exception 'فيه طلب بانتظار موافقة المدير لهذه الفاتورة'; end if;
  if exists (select 1 from package_installment_requests where invoice_id = inv.id and status = 'approved') then raise exception 'تمت الموافقة على التقسيط لهذه الفاتورة بالفعل'; end if;
  if exists (select 1 from package_installment_requests where invoice_id = inv.id and status = 'rejected') then
    raise exception 'تم رفض التقسيط لهذه الفاتورة — الدفع الكامل فقط'; end if;
  d1 := coalesce(p_first_due, riyadh_today());
  d2 := coalesce(p_second_due, d1 + 30);
  if d1 < riyadh_today() then raise exception 'تاريخ استحقاق الدفعة الأولى ما ينفع يكون في الماضي'; end if;
  if d2 <= d1 then raise exception 'لازم يكون تاريخ استحقاق الدفعة الثانية بعد الأولى'; end if;
  first_amt := round(inv.total / 2, 2);
  insert into package_installment_requests (invoice_id, package_id, plan_id, patient_id, total, first_amount, second_amount, reason, requested_by, first_due_date, second_due_date)
  values (inv.id, pk.id, inv.plan_id, inv.patient_id, inv.total, first_amt, inv.total - first_amt, nullif(trim(coalesce(p_reason, '')), ''), emp, d1, d2)
  returning id into v;
  perform notify_staff('installment_request', 'طلب دفع على دفعتين',
    (select full_name from patients where id = inv.patient_id) || ' — ' || coalesce(pk.name, inv.service_name) || ' (' || inv.total || ' ج.م)', v::text, '/installments', inv.patient_id);
  perform log_action('طلب دفع ' || coalesce(pk.name, inv.service_name) || ' على دفعتين (' || first_amt || ' بتاريخ ' || d1 || ' + ' || (inv.total - first_amt) || ' بتاريخ ' || d2 || ') — ' || inv.no, inv.patient_id);
  return v;
end $function$
;

CREATE OR REPLACE FUNCTION public.run_automations()
 RETURNS integer
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare c center_info; n int := 0; r record; t date := riyadh_today(); now_r timestamp := now() at time zone 'Africa/Cairo';
begin
  if not is_staff() then return 0; end if;
  select * into c from center_info limit 1;
  for r in select a.*, p.full_name, s.name svc from appointments a join patients p on p.id = a.patient_id join services s on s.id = a.service_id
           where a.status in ('new','confirmed','rescheduled') and (a.date + a.time::time) > now_r
             and (a.date + a.time::time) - now_r <= make_interval(hours => c.reminder_hours_before)
             and not exists (select 1 from notifications x where x.kind = 'appointment_soon' and x.ref_id = a.no) loop
    perform notify_staff('appointment_soon', 'موعد قريب', r.full_name || ' — ' || r.svc || ' — ' || r.date || ' ' || r.time, r.no, '/appointments', r.patient_id);
    n := n + 1;
  end loop;
  update packages set status = 'expired' where status = 'active' and expiry_date < t;
  for r in select pk.*, p.full_name from packages pk join patients p on p.id = pk.patient_id
           where pk.status = 'active' and pk.expiry_date between t and t + 7
             and not exists (select 1 from notifications x where x.kind = 'package_expiring' and x.ref_id = pk.id::text) loop
    perform notify_staff('package_expiring', 'باقة على وشك الانتهاء', r.name || ' لـ ' || r.full_name || ' تنتهي ' || r.expiry_date, r.id::text, '/patients/' || r.patient_id, r.patient_id);
    n := n + 1;
  end loop;
  for r in select i.*, p.full_name from invoices i join patients p on p.id = i.patient_id
           where i.status in ('due','partial') and i.date < t
             and not exists (select 1 from notifications x where x.kind = 'payment_due' and x.ref_id = i.no) loop
    perform notify_staff('payment_due', 'مبلغ مستحق متأخر', r.no || ' — ' || r.full_name || ': متبقٍ ' || r.remaining || ' ج.م', r.no, '/invoices', r.patient_id);
    perform notify_patient(r.patient_id, 'payment_due', 'مبلغ مستحق', 'عليك مبلغ ' || r.remaining || ' ج.م على الفاتورة ' || r.no, r.no);
    n := n + 1;
  end loop;
  for r in select * from inventory_items it where it.active and it.quantity <= it.min_quantity
             and not exists (select 1 from notifications x where x.kind = 'stock_low' and x.ref_id = it.id || ':' || it.quantity) loop
    perform notify_staff('stock_low', 'مخزون منخفض', r.name || ': الكمية ' || r.quantity || ' ' || r.unit || ' (الحد الأدنى ' || r.min_quantity || ')', r.id || ':' || r.quantity, '/inventory');
    n := n + 1;
  end loop;
  return n;
end $function$
;

CREATE OR REPLACE FUNCTION public.save_expense(p jsonb)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare v uuid := _uuid(p, 'id'); emp uuid;
begin
  emp := require_perm('financial', case when v is null then 'create' else 'edit' end);
  if _txt(p, 'category') = '' then raise exception 'بند المصروف مطلوب'; end if;
  if _num(p, 'amount') <= 0 then raise exception 'قيمة المصروف لازم تكون أكبر من صفر'; end if;
  if v is not null then
    update expenses set category = _txt(p, 'category'), amount = _num(p, 'amount'), description = _txt(p, 'description'),
      expense_date = coalesce(nullif(p->>'expenseDate', '')::date, expense_date), payment_method = _txt(p, 'paymentMethod', 'cash'), updated_at = now()
    where id = v;
  else
    insert into expenses (branch_id, category, amount, description, expense_date, payment_method, created_by)
    values (_uuid(p, 'branchId'), _txt(p, 'category'), _num(p, 'amount'), _txt(p, 'description'), coalesce(nullif(p->>'expenseDate', '')::date, riyadh_today()), _txt(p, 'paymentMethod', 'cash'), emp)
    returning id into v;
  end if;
  perform log_action('تسجيل مصروف: ' || _txt(p, 'category') || ' — ' || _num(p, 'amount') || ' ج.م');
  return jsonb_build_object('id', v);
end $function$
;

CREATE OR REPLACE FUNCTION public.save_service(p jsonb)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare v text := nullif(p->>'id', ''); is_new boolean := v is null or not exists (select 1 from services where id = nullif(p->>'id', ''));
begin
  perform require_perm('services', case when is_new then 'create' else 'edit' end);
  if length(_txt(p, 'name')) < 2 then raise exception 'اسم الخدمة مطلوب'; end if;
  if _num(p, 'price', -1) < 0 then raise exception 'السعر غير صحيح'; end if;
  if _num(p, 'durationMin', 0) < 5 then raise exception 'مدة الخدمة غير صحيحة'; end if;
  if is_new then
    v := coalesce(v, 'sv_' || substr(replace(gen_random_uuid()::text, '-', ''), 1, 8));
    insert into services (id, name, category, description, price, duration_min, active, show_on_site, branch_id)
    values (v, _txt(p, 'name'), _txt(p, 'category'), _txt(p, 'description'), _num(p, 'price'), _num(p, 'durationMin')::int,
            coalesce((p->>'active')::boolean, true), coalesce((p->>'showOnSite')::boolean, true), _uuid(p, 'branchId'));
  else
    update services set name = _txt(p, 'name'), category = _txt(p, 'category'), description = _txt(p, 'description'), price = _num(p, 'price'),
      duration_min = _num(p, 'durationMin')::int, active = coalesce((p->>'active')::boolean, active),
      show_on_site = coalesce((p->>'showOnSite')::boolean, show_on_site), branch_id = _uuid(p, 'branchId')
    where id = v;
  end if;
  if p ? 'therapistIds' then
    delete from therapist_services where service_id = v;
    insert into therapist_services (therapist_id, service_id)
    select t::uuid, v from jsonb_array_elements_text(p->'therapistIds') t where exists (select 1 from therapists where id = t::uuid);
  end if;
  perform log_action(case when is_new then 'إضافة' else 'تعديل' end || ' خدمة: ' || _txt(p, 'name') || ' — ' || _num(p, 'price') || ' ج.م');
  return jsonb_build_object('id', v);
end $function$
;

CREATE OR REPLACE FUNCTION public.sell_package(p_patient uuid, p_package_plan uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare pp package_plans; v uuid; pts int; inv uuid;
begin
  perform require_perm('packages', 'create');
  select * into pp from package_plans where id = p_package_plan and active;
  if pp.id is null then raise exception 'الباقة غير متاحة'; end if;
  if not exists (select 1 from patients where id = p_patient) then raise exception 'اختر المريض'; end if;
  -- عدد الجلسات بييجي من الكتالوج (ثابت 4 أو 6 للباقات الثابتة) — مفيش أي مدخل يغيّره وقت البيع
  insert into packages (patient_id, name, service_ids, total_sessions, price, start_date, expiry_date, status, kind, plan_id)
  values (p_patient, pp.name, pp.service_ids, pp.total_sessions, pp.price, riyadh_today(), riyadh_today() + pp.valid_days,
          case when pp.kind is not null then 'pending_payment' else 'active' end, pp.kind, pp.id)
  returning id into v;
  inv := new_invoice(p_patient, pp.name, pp.price, 'due', riyadh_today(), null, v, null, null);
  select loyalty_package_points into pts from center_info limit 1;
  perform award_loyalty_points(p_patient, 'package', coalesce(pts, 4), 'نقاط شراء باقة: ' || pp.name, 'package', v);
  perform log_action('بيع ' || pp.name || ' (' || pp.total_sessions || ' جلسات) بقيمة ' || pp.price || ' ج.م'
    || case when pp.kind is not null then ' — بانتظار الدفع' else '' end, p_patient);
  return jsonb_build_object('id', v, 'invoiceId', inv);
end $function$
;

CREATE OR REPLACE FUNCTION public.sell_product(p_product uuid, p_qty integer, p_discount numeric DEFAULT 0, p_patient uuid DEFAULT NULL::uuid, p_customer_name text DEFAULT NULL::text, p_payment_method text DEFAULT 'cash'::text, p_idempotency_key text DEFAULT NULL::text, p_nationality text DEFAULT NULL::text, p_national_id text DEFAULT NULL::text, p_tax_rate numeric DEFAULT NULL::numeric)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare emp uuid; pr products; v_sub numeric; v_disc numeric := coalesce(p_discount, 0); v_rate numeric; v_tax numeric; v_total numeric;
  v_no text; v_id uuid; existing product_sales; v_nat text; v_nid text;
begin
  emp := require_perm('products', 'create');
  if p_idempotency_key is not null then
    select * into existing from product_sales where idempotency_key = p_idempotency_key;
    if existing.id is not null then return jsonb_build_object('id', existing.id, 'invoiceNo', existing.invoice_no, 'duplicate', true); end if;
  end if;
  if p_qty is null or p_qty <= 0 then raise exception 'لازم تكون الكمية المطلوبة أكبر من صفر'; end if;
  if not is_payment_method(coalesce(p_payment_method, 'cash')) then raise exception 'طريقة الدفع غير صحيحة'; end if;
  -- قفل صف المنتج: عمليتين بيع في نفس اللحظة مايقدروش يبيعوا نفس الكمية مرتين
  select * into pr from products where id = p_product for update;
  if pr.id is null then raise exception 'المنتج غير موجود'; end if;
  if not pr.active then raise exception 'المنتج «%» غير متاح للبيع', pr.name; end if;
  if pr.quantity <= 0 then raise exception 'المنتج «%» غير متوفر — الكمية صفر', pr.name; end if;
  if p_qty > pr.quantity then raise exception 'الكمية المطلوبة (%) أكبر من المتاح (%)', p_qty, pr.quantity; end if;
  if p_patient is not null and not exists (select 1 from patients where id = p_patient) then raise exception 'المريض غير موجود'; end if;
  v_sub := round(pr.price * p_qty, 2);
  if v_disc < 0 or v_disc > v_sub then raise exception 'لازم يكون الخصم بين 0 و %', v_sub; end if;
  if p_tax_rate is not null then
    if p_tax_rate < 0 or p_tax_rate > 20 then raise exception 'نسبة الضريبة لازم تكون من 0 إلى 20'; end if;
    v_rate := round(p_tax_rate, 2);
  elsif p_patient is not null then
    v_rate := patient_tax_rate(p_patient);
  else
    v_nat := nullif(trim(coalesce(p_nationality, '')), '');
    v_nat := coalesce(v_nat, 'saudi'); -- عميل بدون جنسية = مصري (الضريبة صفر للكل)
    if v_nat not in ('saudi','non_saudi') then raise exception 'اختر جنسية العميل (مصري / أجنبي)'; end if;
    v_nid := nullif(translate(trim(coalesce(p_national_id, '')), '٠١٢٣٤٥٦٧٨٩', '0123456789'), '');
    if v_nid is not null and v_nat = 'saudi' and v_nid !~ '^[23][0-9]{13}$' then raise exception 'الرقم القومي 14 رقم يبدأ بـ 2 أو 3'; end if;
    if v_nat = 'non_saudi' then v_nid := null; end if;
    v_rate := case when v_nat = 'non_saudi' then coalesce((select foreign_tax_rate from center_info limit 1), 15) else 0 end;
  end if;
  v_rate := coalesce(v_rate, 0);
  v_tax := round((v_sub - v_disc) * v_rate / 100, 2);
  v_total := v_sub - v_disc + v_tax;
  v_no := 'PS-' || lpad(nextval('product_sale_no_seq')::text, 6, '0');
  insert into product_sales (invoice_no, product_id, product_name, product_sku, qty, unit_price, subtotal, discount, tax_rate, tax_amount, total,
    payment_method, patient_id, customer_name, employee_id, idempotency_key, buyer_nationality, buyer_national_id)
  values (v_no, pr.id, pr.name, pr.sku, p_qty, pr.price, v_sub, v_disc, v_rate, v_tax, v_total, coalesce(p_payment_method, 'cash'), p_patient,
    case when p_patient is null then nullif(trim(coalesce(p_customer_name, '')), '') end, emp, p_idempotency_key, v_nat, v_nid)
  returning id into v_id;
  -- الخصم من الكمية بعد نجاح تسجيل الفاتورة، في نفس المعاملة
  update products set quantity = quantity - p_qty, updated_at = now() where id = pr.id;
  insert into product_stock_moves (product_id, kind, qty, qty_after, ref_sale, employee_id) values (pr.id, 'sale', -p_qty, pr.quantity - p_qty, v_id, emp);
  perform log_action('بيع ' || p_qty || ' × ' || pr.name || ' — فاتورة ' || v_no || ' بإجمالي ' || v_total, p_patient);
  return jsonb_build_object('id', v_id, 'invoiceNo', v_no, 'remaining', pr.quantity - p_qty);
end $function$
;

CREATE OR REPLACE FUNCTION public.send_invoice_notice(p_appt uuid, p_status text)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare a appointments; inv invoices; t text;
begin
  select * into a from appointments where id = p_appt;
  if a.id is null then return; end if;
  select * into inv from invoices where appointment_id = a.id and status not in ('cancelled', 'draft') order by created_at desc limit 1;
  if inv.id is null and a.plan_id is not null then select * into inv from invoices where plan_id = a.plan_id and status not in ('cancelled', 'draft') order by created_at limit 1; end if;
  if inv.id is null and a.package_id is not null then select * into inv from invoices where package_id = a.package_id and status not in ('cancelled', 'draft') order by created_at limit 1; end if;
  if inv.id is null then return; end if;
  t := 'فاتورتك رقم ' || inv.no || case when p_status = 'arrived' then ' (بعد الحضور)' else '' end;
  if exists (select 1 from notifications n where n.patient_id = a.patient_id and n.kind = 'invoice' and n.ref_id = inv.id::text and n.title = t) then return; end if;
  perform notify_patient(a.patient_id, 'invoice', t,
    'الإجمالي ' || inv.total || ' ج.م — المدفوع ' || coalesce(inv.paid, 0) || ' ج.م' || case when coalesce(inv.paid, 0) < inv.total then ' — المتبقي ' || (inv.total - coalesce(inv.paid, 0)) || ' ج.م' else ' — مدفوعة بالكامل' end, inv.id::text);
end $function$
;

CREATE OR REPLACE FUNCTION public.update_payment(p_id uuid, p_amount numeric, p_method text, p_note text)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare pay payments; inv invoices;
begin
  perform require_perm('payments', 'edit');
  select * into pay from payments where id = p_id;
  if pay.id is null then raise exception 'الدفعة غير موجودة'; end if;
  if pay.voided_at is not null then raise exception 'الدفعة ملغاة'; end if;
  select * into inv from invoices where id = pay.invoice_id for update;
  if exists (select 1 from packages where id = inv.package_id and kind is not null) or exists (select 1 from package_installment_requests where invoice_id = inv.id and status in ('pending','approved','rejected')) then
    raise exception 'دفعات باقات الجلسات لا تُعدَّل — استخدم إلغاء الدفعة ثم سجّلها من جديد'; end if;
  if not is_payment_method(p_method) then raise exception 'طريقة الدفع غير صحيحة'; end if;
  if p_amount is null or p_amount <= 0 or p_amount > inv.remaining + pay.amount then
    raise exception 'المبلغ لازم يكون بين 1 و % ج.م', inv.remaining + pay.amount;
  end if;
  update payments set amount = p_amount, method = p_method, note = coalesce(p_note, '') where id = p_id;
  perform recalc_invoice(inv.id);
  perform log_action('تعديل دفعة على ' || inv.no || ' إلى ' || p_amount || ' ج.م', inv.patient_id);
end $function$
;

CREATE OR REPLACE FUNCTION public.update_plan_invoice(p_invoice uuid, p_price numeric, p_discount numeric, p_note text, p_issue boolean)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare inv invoices;
begin
  perform require_perm('inv_price', 'view');
  if p_issue then perform require_perm('inv_approve', 'view'); end if;
  perform require_perm('invoices', 'edit');
  select * into inv from invoices where id = p_invoice for update;
  if inv.id is null then raise exception 'الفاتورة غير موجودة'; end if;
  if p_price < 0 or p_discount < 0 then raise exception 'السعر والخصم لازم ما يكونا سالبين'; end if;
  if p_discount > p_price then raise exception 'الخصم ما ينفع يتجاوز السعر'; end if;
  if p_price - p_discount < inv.paid then raise exception 'الإجمالي ما ينفع يقل عن المدفوع (% ج.م)', inv.paid; end if;
  update invoices set price = p_price, discount = p_discount, note = trim(coalesce(p_note, '')),
    status = case when p_issue and status = 'draft' then 'due' else status end
  where id = p_invoice;
  update invoice_items set unit_price = p_price, qty = 1 where invoice_id = p_invoice
    and (select count(*) from invoice_items where invoice_id = p_invoice) = 1;
  if inv.plan_id is not null then update treatment_plans set price = p_price where id = inv.plan_id; end if;
  perform recalc_invoice(p_invoice);
  if p_issue and inv.status = 'draft' then
    perform notify_patient(inv.patient_id, 'invoice', 'فاتورة خطتك العلاجية', 'تم إصدار فاتورة بقيمة ' || (select total from invoices where id = p_invoice) || ' ج.م', p_invoice::text);
  end if;
  perform log_action(case when p_issue then 'اعتماد وإصدار' else 'تعديل' end || ' فاتورة الخطة العلاجية ' || inv.no, inv.patient_id);
end $function$
;

CREATE OR REPLACE FUNCTION public.void_package_payment(p_id uuid, p_reason text)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare emp uuid; pay payments; inv invoices; pk packages;
begin
  emp := require_perm('installments', 'edit');
  select * into pay from payments where id = p_id for update;
  if pay.id is null then raise exception 'الدفعة غير موجودة'; end if;
  if pay.voided_at is not null then raise exception 'الدفعة ملغاة بالفعل'; end if;
  if nullif(trim(coalesce(p_reason, '')), '') is null then raise exception 'اكتب سبب إلغاء الدفعة'; end if;
  select * into inv from invoices where id = pay.invoice_id for update;
  select * into pk from packages where id = inv.package_id;
  if pk.kind is null and not exists (select 1 from package_installment_requests where invoice_id = inv.id and status in ('approved','rejected','pending')) then
    raise exception 'الإلغاء بالسجل مخصص لدفعات الباقات وفواتير التقسيط'; end if;
  if pk.kind is not null and pk.used_sessions > 0 then raise exception 'ما يمكن إلغاء الدفعة — تم استخدام % جلسة من الباقة', pk.used_sessions; end if;
  -- الدفعة الأولى مايتلغيش وفيه دفعة تانية سارية
  if pay.installment_no = 1 and exists (select 1 from payments where invoice_id = inv.id and installment_no = 2 and voided_at is null) then
    raise exception 'ألغِ الدفعة الثانية أولًا'; end if;
  update payments set voided_at = now(), voided_by = emp, void_reason = trim(p_reason) where id = p_id;
  perform recalc_invoice(inv.id);
  perform log_action('إلغاء دفعة ' || pay.amount || ' ج.م من ' || inv.no || ' — السبب: ' || trim(p_reason), inv.patient_id);
end $function$
;

