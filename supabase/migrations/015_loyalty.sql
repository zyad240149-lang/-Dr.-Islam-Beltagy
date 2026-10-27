-- نظام ولاء بالنقاط: سجل حركات + استبدال بكود خصم (يعيد استخدام discount_codes/coupon_usage الموجودين)
-- القواعد: جلسة مستقلة (بلا خطة) = 2 نقطة، جلسة ضمن خطة علاجية = 1 نقطة، شراء باقة = نقطة لكل جلسة في الباقة.
-- 30 نقطة = جلسة مجانية (كود خصم بقيمة سعر خدمة "العلاج الطبيعي" sv_pt، استخدام واحد فقط).

create table if not exists loyalty_ledger (
  id uuid primary key default gen_random_uuid(),
  patient_id uuid not null references patients(id) on delete cascade,
  kind text not null check (kind in ('session','plan_session','package','redeem','adjust')),
  points int not null check (points <> 0),
  reason text not null,
  ref_type text,
  ref_id uuid,
  balance_after int not null,
  employee_id uuid references employees(id) on delete set null,
  created_at timestamptz not null default now()
);
-- يمنع احتساب النقاط مرتين لنفس الجلسة/الباقة
create unique index if not exists uq_loyalty_ledger_ref on loyalty_ledger(ref_type, ref_id) where ref_type is not null;
create index if not exists idx_loyalty_ledger_patient on loyalty_ledger(patient_id, created_at desc);
alter table loyalty_ledger enable row level security;
drop policy if exists loyalty_ledger_select on loyalty_ledger;
create policy loyalty_ledger_select on loyalty_ledger for select using (has_perm('loyalty', 'view') or can_see_patient(patient_id));
revoke insert, update, delete on loyalty_ledger from authenticated;
grant select on loyalty_ledger to authenticated;

create table if not exists loyalty_redemptions (
  id uuid primary key default gen_random_uuid(),
  patient_id uuid not null references patients(id) on delete cascade,
  points_used int not null default 30,
  discount_code_id uuid not null references discount_codes(id) on delete restrict,
  created_by uuid references employees(id) on delete set null,
  created_at timestamptz not null default now()
);
create index if not exists idx_loyalty_redemptions_patient on loyalty_redemptions(patient_id);
alter table loyalty_redemptions enable row level security;
drop policy if exists loyalty_redemptions_select on loyalty_redemptions;
create policy loyalty_redemptions_select on loyalty_redemptions for select using (has_perm('loyalty', 'view') or can_see_patient(patient_id));
revoke insert, update, delete on loyalty_redemptions from authenticated;
grant select on loyalty_redemptions to authenticated;

-- إضافة نقاط بشكل آمن من مصادقية داخلية فقط (تُنادى من دوال أخرى security definer) — idempotent عبر ref_type/ref_id
create or replace function award_loyalty_points(p_patient uuid, p_kind text, p_points int, p_reason text, p_ref_type text default null, p_ref_id uuid default null) returns void
language plpgsql security definer set search_path = public as $$
declare bal int;
begin
  if p_points = 0 then return; end if;
  if p_ref_type is not null and p_ref_id is not null and exists (select 1 from loyalty_ledger where ref_type = p_ref_type and ref_id = p_ref_id) then
    return; -- سبق احتساب النقاط لنفس المرجع
  end if;
  select coalesce(sum(points), 0) into bal from loyalty_ledger where patient_id = p_patient;
  bal := bal + p_points;
  insert into loyalty_ledger (patient_id, kind, points, reason, ref_type, ref_id, balance_after, employee_id)
  values (p_patient, p_kind, p_points, p_reason, p_ref_type, p_ref_id, bal, my_employee_id());
end $$;

-- ===== إعادة تعريف complete_session لإضافة احتساب النقاط عند الإتمام الفعلي (بدون تغيير أي سلوك سابق) =====
create or replace function complete_session(p_id uuid, p jsonb default '{}') returns void
language plpgsql security definer set search_path = public as $$
declare s treatment_sessions; a appointments; pkg packages; left_n int; thr int;
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
  if s.plan_id is null then
    perform award_loyalty_points(s.patient_id, 'session', 2, 'نقاط إتمام جلسة', 'session', s.id);
  else
    perform award_loyalty_points(s.patient_id, 'plan_session', 1, 'نقاط إتمام جلسة ضمن خطة علاجية', 'session', s.id);
  end if;
  perform notify_patient(s.patient_id, 'session_completed', 'اكتملت جلستك', 'تم تسجيل إكمال الجلسة رقم ' || s.session_no || ' — شكرًا لالتزامك', s.id::text);
  perform log_action('إكمال الجلسة رقم ' || s.session_no, s.patient_id);
end $$;

-- ===== إعادة تعريف sell_package لإضافة نقاط بعدد جلسات الباقة عند الشراء =====
create or replace function sell_package(p_patient uuid, p_package_plan uuid) returns jsonb
language plpgsql security definer set search_path = public as $$
declare pp package_plans; v uuid;
begin
  perform require_perm('packages', 'create');
  select * into pp from package_plans where id = p_package_plan and active;
  if pp.id is null then raise exception 'الباقة غير متاحة'; end if;
  if not exists (select 1 from patients where id = p_patient) then raise exception 'اختر المريض'; end if;
  insert into packages (patient_id, name, service_ids, total_sessions, price, start_date, expiry_date, status)
  values (p_patient, pp.name, pp.service_ids, pp.total_sessions, pp.price, riyadh_today(), riyadh_today() + pp.valid_days, 'active') returning id into v;
  perform new_invoice(p_patient, pp.name, pp.price, 'due', riyadh_today(), null, v, null, null);
  perform award_loyalty_points(p_patient, 'package', pp.total_sessions, 'نقاط شراء باقة: ' || pp.name, 'package', v);
  perform log_action('بيع ' || pp.name || ' بقيمة ' || pp.price || ' ر.س', p_patient);
  return jsonb_build_object('id', v);
end $$;

-- استبدال 30 نقطة بكود خصم = جلسة علاج طبيعي مجانية (Transaction واحدة — إما تتم كل الخطوات أو ولا شيء)
create or replace function redeem_loyalty_points(p_patient uuid) returns jsonb
language plpgsql security definer set search_path = public as $$
declare emp uuid; bal int; code text; dc_id uuid; reward_val numeric;
begin
  emp := require_perm('loyalty', 'create');
  if not exists (select 1 from patients where id = p_patient) then raise exception 'المريض غير موجود'; end if;
  select coalesce(sum(points), 0) into bal from loyalty_ledger where patient_id = p_patient;
  if bal < 30 then raise exception 'رصيد النقاط أقل من 30 نقطة'; end if;
  select price into reward_val from services where id = 'sv_pt';
  reward_val := coalesce(reward_val, 250);
  loop
    code := 'FREE-' || upper(substr(md5(random()::text || clock_timestamp()::text), 1, 6));
    exit when not exists (select 1 from discount_codes where code = code);
  end loop;
  insert into discount_codes (code, type, value, valid_from, valid_to, max_uses, min_amount, active, note, created_by)
  values (code, 'fixed', reward_val, riyadh_today(), riyadh_today() + 365, 1, 0, true, 'مكافأة نقاط ولاء — جلسة مجانية', emp)
  returning id into dc_id;
  insert into loyalty_redemptions (patient_id, points_used, discount_code_id, created_by) values (p_patient, 30, dc_id, emp);
  perform award_loyalty_points(p_patient, 'redeem', -30, 'استبدال 30 نقطة — كود ' || code, 'redemption', dc_id);
  perform log_action('استبدال 30 نقطة ولاء مقابل كود ' || code, p_patient);
  return jsonb_build_object('code', code, 'remaining', bal - 30);
end $$;

-- ملخص نقاط مريض (للعرض داخل ملفه)
create or replace function patient_loyalty_summary(p_patient uuid) returns jsonb
language plpgsql stable security definer set search_path = public as $$
declare bal int; earned int; redeemed int; redemptions int;
begin
  if not can_see_patient(p_patient) then raise exception 'غير مصرح' using errcode = '42501'; end if;
  select coalesce(sum(points), 0) into bal from loyalty_ledger where patient_id = p_patient;
  select coalesce(sum(points), 0) into earned from loyalty_ledger where patient_id = p_patient and points > 0;
  select coalesce(sum(-points), 0) into redeemed from loyalty_ledger where patient_id = p_patient and kind = 'redeem';
  select count(*) into redemptions from loyalty_redemptions where patient_id = p_patient;
  return jsonb_build_object('balance', bal, 'totalEarned', earned, 'totalRedeemed', redeemed, 'redemptionsCount', redemptions);
end $$;

-- سجل النقاط (كل المرضى أو مريض واحد)
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

-- أكواد الاستبدال (سجل مكافآت النقاط فقط، منفصل عن أكواد الخصم التسويقية)
create or replace function loyalty_codes_list() returns table (
  id uuid, code text, patient_id uuid, patient_name text, reward numeric, created_at timestamptz,
  status text, used_at timestamptz, used_by_name text
)
language plpgsql stable security definer set search_path = public as $$
begin
  perform require_perm('loyalty', 'view');
  return query
    select lr.id, dc.code, lr.patient_id, p.full_name, dc.value, lr.created_at,
      case when not dc.active and dc.used_count = 0 then 'cancelled' when dc.used_count > 0 then 'used' else 'unused' end,
      cu.used_at, e.name
    from loyalty_redemptions lr
    join discount_codes dc on dc.id = lr.discount_code_id
    join patients p on p.id = lr.patient_id
    left join coupon_usage cu on cu.coupon_id = dc.id
    left join employees e on e.id = cu.used_by
    order by lr.created_at desc;
end $$;

revoke execute on function redeem_loyalty_points(uuid), patient_loyalty_summary(uuid), loyalty_ledger_list(uuid, int), loyalty_codes_list() from public, anon;
grant execute on function redeem_loyalty_points(uuid), patient_loyalty_summary(uuid), loyalty_ledger_list(uuid, int), loyalty_codes_list() to authenticated;

do $$ begin
  begin alter publication supabase_realtime add table loyalty_ledger; exception when others then null; end;
  begin alter publication supabase_realtime add table loyalty_redemptions; exception when others then null; end;
end $$;

-- صلاحيات القسم الجديد: النقاط تظهر داخل ملف المريض للجميع (can_see_patient فقط)، أما صفحة الإدارة/الاستبدال فتحتاج 'loyalty'
insert into role_permissions (role, area, ops) values
  ('system_admin', 'loyalty', '{view,create,edit,delete}'),
  ('center_manager', 'loyalty', '{view,create,edit,delete}'),
  ('secretary', 'loyalty', '{view,create}'),
  ('reception', 'loyalty', '{view,create}'),
  ('accountant', 'loyalty', '{view,create}'),
  ('therapist', 'loyalty', '{}')
on conflict (role, area) do update set ops = excluded.ops;
