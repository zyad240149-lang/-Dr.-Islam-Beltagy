-- إصلاح: متغير 'code' كان بنفس اسم العمود في حلقة توليد الكود الفريد (code = code) — ممكن يعمل خطأ غموض أو حلقة لا نهائية.
-- إعادة تعريف الدالة بمتغير v_code، بدون أي تغيير في السلوك. الكود لمرة واحدة (max_uses = 1) ومرتبط بالمريض.
create or replace function redeem_loyalty_points(p_patient uuid, p_beneficiary_name text default null, p_beneficiary_phone text default null,
  p_beneficiary_relation text default null, p_idempotency_key text default null) returns jsonb
language plpgsql security definer set search_path = public as $$
declare emp uuid; bal int; cost int; v_code text; dc_id uuid; reward_val numeric; existing loyalty_redemptions; ben_patient uuid; ben_digits text;
begin
  emp := require_perm('loyalty', 'create');
  if p_idempotency_key is not null then
    select * into existing from loyalty_redemptions where idempotency_key = p_idempotency_key;
    if existing.id is not null then
      return jsonb_build_object('code', (select code from discount_codes where id = existing.discount_code_id),
        'remaining', (select coalesce(sum(points), 0) from loyalty_ledger where patient_id = existing.patient_id));
    end if;
  end if;
  perform pg_advisory_xact_lock(hashtext('loyalty:' || p_patient::text));
  if not exists (select 1 from patients where id = p_patient) then raise exception 'المريض غير موجود'; end if;
  select coalesce(loyalty_redeem_cost, 30) into cost from center_info limit 1;
  select coalesce(sum(points), 0) into bal from loyalty_ledger where patient_id = p_patient;
  if bal < cost then raise exception 'رصيد النقاط أقل من % نقطة — الرصيد الحالي % نقطة', cost, bal; end if;

  -- لو المستفيد شخص آخر وله رقم جوال يطابق مريضًا مسجّلًا، نربط الكود بملفه هو (يقدر يستخدمه بفاتورته)؛
  -- غير كده الكود يُصدر بلا قفل على مريض معيّن، مع الاحتفاظ ببيانات المستفيد للتوثيق فقط.
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
  insert into discount_codes (code, type, value, valid_from, valid_to, max_uses, min_amount, active, note, created_by, patient_id)
  values (v_code, 'fixed', reward_val, riyadh_today(), riyadh_today() + 365, 1, 0, true, 'مكافأة نقاط ولاء — جلسة مجانية', emp, coalesce(ben_patient, case when p_beneficiary_phone is null then p_patient else null end))
  returning id into dc_id;
  insert into loyalty_redemptions (patient_id, points_used, discount_code_id, created_by, beneficiary_name, beneficiary_phone, beneficiary_relation, idempotency_key)
  values (p_patient, cost, dc_id, emp, nullif(trim(coalesce(p_beneficiary_name, '')), ''), nullif(trim(coalesce(p_beneficiary_phone, '')), ''), nullif(trim(coalesce(p_beneficiary_relation, '')), ''), p_idempotency_key);
  perform award_loyalty_points(p_patient, 'redeem', -cost, 'استبدال ' || cost || ' نقطة — كود ' || v_code, 'redemption', dc_id);
  perform log_action('استبدال ' || cost || ' نقطة ولاء مقابل كود ' || v_code || case when p_beneficiary_name is not null then ' — للمستفيد: ' || p_beneficiary_name else '' end, p_patient);
  return jsonb_build_object('code', v_code, 'remaining', bal - cost);
end $$;
revoke execute on function redeem_loyalty_points(uuid, text, text, text, text) from public, anon;
grant execute on function redeem_loyalty_points(uuid, text, text, text, text) to authenticated;
