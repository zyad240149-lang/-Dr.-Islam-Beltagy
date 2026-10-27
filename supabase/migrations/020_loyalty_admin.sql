-- ===================================================================
-- نظام الولاء والنقاط الكامل — يعيد استخدام الجداول الحالية بالكامل، بدون أي جدول جديد:
-- loyalty_ledger, loyalty_redemptions, discount_codes, coupon_usage, patients, center_info (كإعدادات).
-- التعديلات كلها ALTER TABLE (إضافة أعمدة) على الجداول الأربعة أعلاه، وإعادة تعريف RPCs بنفس الأسماء.
-- ===================================================================

-- ===== 1) إعدادات النظام قابلة للتعديل بدل Hard Code (على center_info، الجدول الوحيد للإعدادات) =====
alter table center_info add column if not exists loyalty_session_points int not null default 2 check (loyalty_session_points >= 0);
alter table center_info add column if not exists loyalty_package_points int not null default 4 check (loyalty_package_points >= 0);
alter table center_info add column if not exists loyalty_redeem_cost int not null default 30 check (loyalty_redeem_cost > 0);

create or replace function update_loyalty_settings(p_session_points int, p_package_points int, p_redeem_cost int) returns void
language plpgsql security definer set search_path = public as $$
begin
  perform require_perm('settings', 'edit');
  if p_session_points < 0 or p_package_points < 0 or p_redeem_cost <= 0 then raise exception 'قيم غير صحيحة'; end if;
  update center_info set loyalty_session_points = p_session_points, loyalty_package_points = p_package_points, loyalty_redeem_cost = p_redeem_cost where id = 1;
  perform log_action('تحديث إعدادات نقاط الولاء');
end $$;
revoke execute on function update_loyalty_settings(int, int, int) from public, anon;
grant execute on function update_loyalty_settings(int, int, int) to authenticated;

-- ===== 2) تقييد كود المكافأة بمريض واحد + بيانات الإلغاء (على discount_codes الموجود) =====
alter table discount_codes add column if not exists patient_id uuid references patients(id) on delete set null;
alter table discount_codes add column if not exists cancel_reason text;
alter table discount_codes add column if not exists cancelled_by uuid references employees(id) on delete set null;
alter table discount_codes add column if not exists cancelled_at timestamptz;
create index if not exists idx_discount_codes_patient on discount_codes(patient_id);

-- ===== 3) بيانات المستفيد (لو المكافأة "لشخص آخر") + مفتاح تكرار لمنع استبدال مزدوج (على loyalty_redemptions الموجود) =====
alter table loyalty_redemptions add column if not exists beneficiary_name text;
alter table loyalty_redemptions add column if not exists beneficiary_phone text;
alter table loyalty_redemptions add column if not exists beneficiary_relation text;
alter table loyalty_redemptions add column if not exists idempotency_key text;
create unique index if not exists uq_loyalty_redemptions_idem on loyalty_redemptions(idempotency_key) where idempotency_key is not null;

-- ===================================================================
-- 4) احتساب النقاط: 2 نقطة لأي جلسة/كشف مكتمل ومؤهل (بلا فرق بين مستقلة أو ضمن خطة) — بقيمة الإعداد لا رقم ثابت
-- ===================================================================
create or replace function complete_session(p_id uuid, p jsonb default '{}') returns void
language plpgsql security definer set search_path = public as $$
declare s treatment_sessions; a appointments; pkg packages; left_n int; thr int; pts int;
begin
  perform require_perm('sessions', 'edit');
  select * into s from treatment_sessions where id = p_id for update;
  if s.id is null or not can_see_patient(s.patient_id) then raise exception 'الجلسة غير موجودة'; end if;
  if s.status = 'completed' then raise exception 'الجلسة مكتملة بالفعل'; end if;
  perform update_session(p_id, coalesce(p, '{}'));
  update treatment_sessions set status = 'completed', completed_at = now() where id = p_id;
  select * into a from appointments where id = s.appointment_id for update;
  if a.id is not null then
    update appointments set status = 'completed', updated_at = now() where id = a.id;
    if a.package_id is not null then
      select * into pkg from packages where id = a.package_id for update;
      if pkg.id is not null and pkg.used_sessions < pkg.total_sessions then
        update packages set used_sessions = used_sessions + 1,
          status = case when used_sessions + 1 >= total_sessions then 'completed' else status end
        where id = pkg.id;
        left_n := pkg.total_sessions - pkg.used_sessions - 1;
        select package_low_threshold into thr from center_info limit 1;
        if left_n > 0 and left_n <= thr then
          perform notify_staff('package_low', 'باقة قاربت على النفاد', (select full_name from patients where id = pkg.patient_id) || ': تبقّى ' || left_n || ' جلسة', pkg.id::text, '/patients/' || pkg.patient_id, pkg.patient_id);
        end if;
      end if;
    end if;
  end if;
  if s.plan_id is not null then perform recalc_plan(s.plan_id); end if;
  select loyalty_session_points into pts from center_info limit 1;
  perform award_loyalty_points(s.patient_id, 'session', coalesce(pts, 2), 'نقاط إتمام جلسة/كشف', 'session', s.id);
  perform notify_patient(s.patient_id, 'session_completed', 'اكتملت جلستك', 'تم تسجيل إكمال الجلسة رقم ' || s.session_no || ' — شكرًا لالتزامك', s.id::text);
  perform log_action('إكمال الجلسة رقم ' || s.session_no, s.patient_id);
end $$;

-- ===================================================================
-- 5) شراء باقة: 4 نقاط ثابتة (بقيمة الإعداد) مرة واحدة فقط، بغض النظر عن عدد جلسات الباقة
-- ===================================================================
create or replace function sell_package(p_patient uuid, p_package_plan uuid) returns jsonb
language plpgsql security definer set search_path = public as $$
declare pp package_plans; v uuid; pts int;
begin
  perform require_perm('packages', 'create');
  select * into pp from package_plans where id = p_package_plan and active;
  if pp.id is null then raise exception 'الباقة غير متاحة'; end if;
  if not exists (select 1 from patients where id = p_patient) then raise exception 'اختر المريض'; end if;
  insert into packages (patient_id, name, service_ids, total_sessions, price, start_date, expiry_date, status)
  values (p_patient, pp.name, pp.service_ids, pp.total_sessions, pp.price, riyadh_today(), riyadh_today() + pp.valid_days, 'active') returning id into v;
  perform new_invoice(p_patient, pp.name, pp.price, 'due', riyadh_today(), null, v, null, null);
  select loyalty_package_points into pts from center_info limit 1;
  perform award_loyalty_points(p_patient, 'package', coalesce(pts, 4), 'نقاط شراء باقة: ' || pp.name, 'package', v);
  perform log_action('بيع ' || pp.name || ' بقيمة ' || pp.price || ' ر.س', p_patient);
  return jsonb_build_object('id', v);
end $$;

-- ===================================================================
-- 6) الاستبدال: تكلفة ثابتة من الإعدادات (30 نقطة افتراضيًا) = جلسة مجانية واحدة، لنفس المريض أو لمستفيد آخر
-- Idempotent (مفتاح تكرار) + قفل معاملة لكل مريض يمنع Race Condition عند الضغط المتكرر
-- ===================================================================
drop function if exists redeem_loyalty_points(uuid);
create or replace function redeem_loyalty_points(p_patient uuid, p_beneficiary_name text default null, p_beneficiary_phone text default null,
  p_beneficiary_relation text default null, p_idempotency_key text default null) returns jsonb
language plpgsql security definer set search_path = public as $$
declare emp uuid; bal int; cost int; code text; dc_id uuid; reward_val numeric; existing loyalty_redemptions; ben_patient uuid; ben_digits text;
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
    code := 'FREE-' || upper(substr(md5(random()::text || clock_timestamp()::text), 1, 6));
    exit when not exists (select 1 from discount_codes where code = code);
  end loop;
  insert into discount_codes (code, type, value, valid_from, valid_to, max_uses, min_amount, active, note, created_by, patient_id)
  values (code, 'fixed', reward_val, riyadh_today(), riyadh_today() + 365, 1, 0, true, 'مكافأة نقاط ولاء — جلسة مجانية', emp, coalesce(ben_patient, case when p_beneficiary_phone is null then p_patient else null end))
  returning id into dc_id;
  insert into loyalty_redemptions (patient_id, points_used, discount_code_id, created_by, beneficiary_name, beneficiary_phone, beneficiary_relation, idempotency_key)
  values (p_patient, cost, dc_id, emp, nullif(trim(coalesce(p_beneficiary_name, '')), ''), nullif(trim(coalesce(p_beneficiary_phone, '')), ''), nullif(trim(coalesce(p_beneficiary_relation, '')), ''), p_idempotency_key);
  perform award_loyalty_points(p_patient, 'redeem', -cost, 'استبدال ' || cost || ' نقطة — كود ' || code, 'redemption', dc_id);
  perform log_action('استبدال ' || cost || ' نقطة ولاء مقابل كود ' || code || case when p_beneficiary_name is not null then ' — للمستفيد: ' || p_beneficiary_name else '' end, p_patient);
  return jsonb_build_object('code', code, 'remaining', bal - cost);
end $$;
revoke execute on function redeem_loyalty_points(uuid, text, text, text, text) from public, anon;
grant execute on function redeem_loyalty_points(uuid, text, text, text, text) to authenticated;

-- ===================================================================
-- 7) استخدام الكود على فاتورة: يضيف التحقق من تطابق المريض (القفل الجديد) فوق كل التحقق الحالي — لا يُخصم نقاط مرة أخرى هنا إطلاقًا
-- ===================================================================
create or replace function apply_discount_code(p_invoice uuid, p_code text) returns jsonb
language plpgsql security definer set search_path = public as $$
declare inv invoices; dc discount_codes; amount numeric; t date := riyadh_today();
begin
  perform require_perm('invoices', 'edit');
  select * into inv from invoices where id = p_invoice for update;
  if inv.id is null then raise exception 'الفاتورة غير موجودة'; end if;
  if inv.status = 'cancelled' then raise exception 'الفاتورة ملغاة'; end if;
  if inv.discount_code is not null then raise exception 'تم تطبيق الكود % على هذه الفاتورة بالفعل', inv.discount_code; end if;
  select * into dc from discount_codes where code = upper(trim(p_code)) for update;
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
  perform log_action('تطبيق كود الخصم ' || dc.code || ' (' || amount || ' ر.س) على ' || inv.no, inv.patient_id);
  return jsonb_build_object('amount', amount);
end $$;

-- ===================================================================
-- 8) إلغاء كود لم يُستخدم — يرجّع النقاط تلقائيًا (Reversal) بدل حذف أي سجل قديم
-- ===================================================================
create or replace function cancel_discount_code(p_id uuid, p_reason text default '') returns void
language plpgsql security definer set search_path = public as $$
declare dc discount_codes; emp uuid; red loyalty_redemptions;
begin
  emp := require_perm('discounts', 'edit');
  select * into dc from discount_codes where id = p_id for update;
  if dc.id is null then raise exception 'الكود غير موجود'; end if;
  if dc.used_count > 0 then raise exception 'لا يمكن إلغاء كود تم استخدامه بالفعل'; end if;
  if not dc.active then raise exception 'الكود متوقف بالفعل'; end if;
  update discount_codes set active = false, cancel_reason = nullif(trim(p_reason), ''), cancelled_by = emp, cancelled_at = now() where id = p_id;
  select * into red from loyalty_redemptions where discount_code_id = p_id;
  if red.id is not null then
    perform award_loyalty_points(red.patient_id, 'reversal', red.points_used, 'إرجاع نقاط — إلغاء كود ' || dc.code || coalesce(': ' || nullif(trim(p_reason), ''), ''), 'cancel_redemption', p_id);
  end if;
  perform log_action('إلغاء كود خصم ' || dc.code || coalesce(' — السبب: ' || nullif(trim(p_reason), ''), ''), dc.patient_id);
end $$;
revoke execute on function cancel_discount_code(uuid, text) from public, anon;
grant execute on function cancel_discount_code(uuid, text) to authenticated;

-- دعم عملية "إرجاع" (reversal) صراحة في سجل النقاط، بجانب الأنواع الحالية
alter table loyalty_ledger drop constraint if exists loyalty_ledger_kind_check;
alter table loyalty_ledger add constraint loyalty_ledger_kind_check check (kind in ('session','plan_session','package','redeem','adjust','reversal'));

-- ===================================================================
-- 9) بحث مريض برقم الجوال (لواجهة "الولاء والنقاط")
-- ===================================================================
create or replace function find_patient_by_phone(p_phone text) returns jsonb
language plpgsql stable security definer set search_path = public as $$
declare pat patients; digits text := regexp_replace(coalesce(p_phone, ''), '\D', '', 'g');
begin
  perform require_perm('loyalty', 'view');
  if digits = '' then raise exception 'أدخل رقم الجوال'; end if;
  select * into pat from patients where regexp_replace(phone, '\D', '', 'g') like '%' || right(digits, 9) order by registered_at desc limit 1;
  if pat.id is null then return null; end if;
  return jsonb_build_object('id', pat.id, 'fullName', pat.full_name, 'phone', pat.phone, 'fileNo', pat.file_no);
end $$;
revoke execute on function find_patient_by_phone(text) from public, anon;
grant execute on function find_patient_by_phone(text) to authenticated;

-- ===================================================================
-- 10) ملخص نقاط مريض — يضيف عدد المكافآت المتاحة (رصيد ÷ تكلفة المكافأة)
-- ===================================================================
create or replace function patient_loyalty_summary(p_patient uuid) returns jsonb
language plpgsql stable security definer set search_path = public as $$
declare bal int; earned int; redeemed int; redemptions int; cost int;
begin
  if not can_see_patient(p_patient) then raise exception 'غير مصرح' using errcode = '42501'; end if;
  select coalesce(loyalty_redeem_cost, 30) into cost from center_info limit 1;
  select coalesce(sum(points), 0) into bal from loyalty_ledger where patient_id = p_patient;
  select coalesce(sum(points), 0) into earned from loyalty_ledger where patient_id = p_patient and points > 0;
  select coalesce(sum(-points), 0) into redeemed from loyalty_ledger where patient_id = p_patient and kind = 'redeem';
  select count(*) into redemptions from loyalty_redemptions where patient_id = p_patient;
  return jsonb_build_object('balance', bal, 'totalEarned', earned, 'totalRedeemed', redeemed, 'redemptionsCount', redemptions,
    'availableRewards', bal / cost, 'redeemCost', cost);
end $$;

create or replace function my_loyalty_summary() returns jsonb
language plpgsql stable security definer set search_path = public as $$
declare pid uuid := my_patient_id(); bal int; earned int; redeemed int; redemptions int; cost int;
begin
  if pid is null then raise exception 'غير مصرح' using errcode = '42501'; end if;
  select coalesce(loyalty_redeem_cost, 30) into cost from center_info limit 1;
  select coalesce(sum(points), 0) into bal from loyalty_ledger where patient_id = pid;
  select coalesce(sum(points), 0) into earned from loyalty_ledger where patient_id = pid and points > 0;
  select coalesce(sum(-points), 0) into redeemed from loyalty_ledger where patient_id = pid and kind = 'redeem';
  select count(*) into redemptions from loyalty_redemptions where patient_id = pid;
  return jsonb_build_object('balance', bal, 'totalEarned', earned, 'totalRedeemed', redeemed, 'redemptionsCount', redemptions,
    'availableRewards', bal / cost, 'redeemCost', cost);
end $$;
revoke execute on function my_loyalty_summary() from public, anon;
grant execute on function my_loyalty_summary() to authenticated;

drop policy if exists loyalty_ledger_select on loyalty_ledger;
create policy loyalty_ledger_select on loyalty_ledger for select using (has_perm('loyalty', 'view') or can_see_patient(patient_id) or patient_id = my_patient_id());

-- ===================================================================
-- 11) سجل النقاط — بدون تغيير جوهري (كان صحيحًا)، معاد تعريفه هنا فقط للتناسق مع الإصدار
-- ===================================================================
create or replace function loyalty_ledger_list(p_patient uuid default null, p_limit int default 300) returns table (
  id uuid, patient_id uuid, patient_name text, kind text, points int, reason text, balance_after int,
  employee_name text, discount_code text, created_at timestamptz
)
language plpgsql stable security definer set search_path = public as $$
begin
  if p_patient is not null then
    if not can_see_patient(p_patient) then raise exception 'غير مصرح' using errcode = '42501'; end if;
  else
    perform require_perm('loyalty', 'view');
  end if;
  return query
    select l.id, l.patient_id, p.full_name, l.kind, l.points, l.reason, l.balance_after,
      e.name, dc.code, l.created_at
    from loyalty_ledger l
    join patients p on p.id = l.patient_id
    left join employees e on e.id = l.employee_id
    left join discount_codes dc on l.ref_type = 'redemption' and dc.id = l.ref_id
    where (p_patient is null or l.patient_id = p_patient)
    order by l.created_at desc
    limit p_limit;
end $$;

-- ===================================================================
-- 12) أكواد المكافآت — يضيف حالة "expired" وبيانات المستفيد
-- ===================================================================
drop function if exists loyalty_codes_list();
create or replace function loyalty_codes_list() returns table (
  id uuid, code text, patient_id uuid, patient_name text, reward numeric, created_at timestamptz,
  status text, used_at timestamptz, used_by_name text, points_used int, cancel_reason text,
  beneficiary_name text, beneficiary_phone text, beneficiary_relation text
)
language plpgsql stable security definer set search_path = public as $$
begin
  perform require_perm('loyalty', 'view');
  return query
    select lr.id, dc.code, lr.patient_id, p.full_name, dc.value, lr.created_at,
      case
        when dc.used_count > 0 then 'used'
        when not dc.active then 'cancelled'
        when dc.valid_to < riyadh_today() then 'expired'
        else 'unused'
      end,
      cu.used_at, e.name, lr.points_used, dc.cancel_reason,
      lr.beneficiary_name, lr.beneficiary_phone, lr.beneficiary_relation
    from loyalty_redemptions lr
    join discount_codes dc on dc.id = lr.discount_code_id
    join patients p on p.id = lr.patient_id
    left join coupon_usage cu on cu.coupon_id = dc.id
    left join employees e on e.id = cu.used_by
    order by lr.created_at desc;
end $$;
revoke execute on function loyalty_codes_list() from public, anon;
grant execute on function loyalty_codes_list() to authenticated;
revoke execute on function apply_discount_code(uuid, text) from public, anon;
grant execute on function apply_discount_code(uuid, text) to authenticated;
