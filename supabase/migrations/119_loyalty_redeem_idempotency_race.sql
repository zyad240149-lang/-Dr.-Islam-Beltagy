-- ضغطتين في نفس اللحظة بنفس مفتاح التكرار: التانية كانت بتستنى القفل وبعدين ترجع «الرصيد 0» بدل نفس الكود.
-- (الخصم كان مرة واحدة أصلًا.) الإصلاح: إعادة فحص المفتاح بعد أخذ القفل. اكتُشف في staff-extra-perms-e2e 2026-10-12.
create or replace function loyalty_redeem_core(p_patient uuid, p_sessions int, p_emp uuid, p_beneficiary_name text, p_beneficiary_phone text,
  p_beneficiary_relation text, p_idempotency_key text) returns jsonb
language plpgsql security definer set search_path = public as $$
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

  select price into reward_val from services where id = 'sv_pt';
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
end $$;
