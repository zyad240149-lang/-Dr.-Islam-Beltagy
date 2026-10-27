-- استبدال نقاط الولاء: من الإدارة أو من المريض نفسه (من حسابه)، بخيارين:
--   تكلفة المكافأة (30 افتراضيًا) = جلسة مجانية واحدة، والضعف (60) = جلستين.
-- الناتج كود خصم واحد مربوط بالمريض، صالح سنة، ويتستخدم مرة لكل جلسة (جلستين = يتستخدم مرتين، كل مرة على فاتورة).
-- كل الاستبدال في دالة داخلية واحدة (loyalty_redeem_core) — الإدارة والمريض بيناديها بعد التحقق من الهوية.

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
revoke execute on function loyalty_redeem_core(uuid, int, uuid, text, text, text, text) from public, anon, authenticated;

-- الإدارة (صلاحية loyalty:create)
drop function if exists redeem_loyalty_points(uuid, text, text, text, text);
create or replace function redeem_loyalty_points(p_patient uuid, p_sessions int default 1, p_beneficiary_name text default null,
  p_beneficiary_phone text default null, p_beneficiary_relation text default null, p_idempotency_key text default null) returns jsonb
language plpgsql security definer set search_path = public as $$
declare emp uuid;
begin
  emp := require_perm('loyalty', 'create');
  return loyalty_redeem_core(p_patient, p_sessions, emp, p_beneficiary_name, p_beneficiary_phone, p_beneficiary_relation, p_idempotency_key);
end $$;
revoke execute on function redeem_loyalty_points(uuid, int, text, text, text, text) from public, anon;
grant execute on function redeem_loyalty_points(uuid, int, text, text, text, text) to authenticated;

-- المريض من حسابه (الهوية من الجلسة — مايقدرش يستبدل نقاط مريض تاني)
create or replace function patient_redeem_loyalty(p_sessions int default 1, p_idempotency_key text default null) returns jsonb
language plpgsql security definer set search_path = public as $$
declare pid uuid := my_patient_id();
begin
  if pid is null then raise exception 'سجّل الدخول بحساب المريض أولًا' using errcode = '42501'; end if;
  return loyalty_redeem_core(pid, p_sessions, null, null, null, null, p_idempotency_key);
end $$;
revoke execute on function patient_redeem_loyalty(int, text) from public, anon;
grant execute on function patient_redeem_loyalty(int, text) to authenticated;

-- حالة الكود: «مستخدم» بس لما كل مراته تخلص (كود الجلستين بعد أول استخدام لسه صالح لجلسة)
drop function if exists my_loyalty_codes();
create or replace function my_loyalty_codes()
returns table(code text, created_at timestamptz, status text, used_at timestamptz, valid_to date, sessions int, uses_left int)
language plpgsql stable security definer set search_path = public as $$
declare pid uuid := my_patient_id();
begin
  if pid is null then raise exception 'غير مصرح' using errcode = '42501'; end if;
  return query
    select dc.code, lr.created_at,
      case when dc.used_count >= dc.max_uses then 'used' when not dc.active then 'cancelled' when dc.valid_to < riyadh_today() then 'expired' else 'unused' end,
      (select max(cu.used_at) from coupon_usage cu where cu.coupon_id = dc.id), dc.valid_to, dc.max_uses, greatest(dc.max_uses - dc.used_count, 0)
    from loyalty_redemptions lr join discount_codes dc on dc.id = lr.discount_code_id
    where lr.patient_id = pid or dc.patient_id = pid
    order by lr.created_at desc;
end $$;
revoke execute on function my_loyalty_codes() from public, anon;
grant execute on function my_loyalty_codes() to authenticated;

drop function if exists loyalty_codes_list();
create or replace function loyalty_codes_list() returns table (
  id uuid, code text, patient_id uuid, patient_name text, reward numeric, created_at timestamptz,
  status text, used_at timestamptz, used_by_name text, points_used int, cancel_reason text,
  beneficiary_name text, beneficiary_phone text, beneficiary_relation text, sessions int, uses_left int, by_patient boolean
)
language plpgsql stable security definer set search_path = public as $$
begin
  perform require_perm('loyalty', 'view');
  return query
    select lr.id, dc.code, lr.patient_id, p.full_name, dc.value, lr.created_at,
      case when dc.used_count >= dc.max_uses then 'used' when not dc.active then 'cancelled' when dc.valid_to < riyadh_today() then 'expired' else 'unused' end,
      u.used_at, u.used_by_name, lr.points_used, dc.cancel_reason,
      lr.beneficiary_name, lr.beneficiary_phone, lr.beneficiary_relation, dc.max_uses, greatest(dc.max_uses - dc.used_count, 0), lr.created_by is null
    from loyalty_redemptions lr
    join discount_codes dc on dc.id = lr.discount_code_id
    join patients p on p.id = lr.patient_id
    left join lateral (select cu.used_at, e.name as used_by_name from coupon_usage cu left join employees e on e.id = cu.used_by
                       where cu.coupon_id = dc.id order by cu.used_at desc limit 1) u on true
    order by lr.created_at desc;
end $$;
revoke execute on function loyalty_codes_list() from public, anon;
grant execute on function loyalty_codes_list() to authenticated;
