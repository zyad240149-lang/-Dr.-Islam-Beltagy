-- إصلاحات مراجعة التكامل الشاملة (Integration Audit) — بدون أي تغيير في سلوك الميزات الحالية غير المذكورة هنا

-- 1) نقاط الولاء تُسحب عند التراجع عن سببها (حذف جلسة مكتملة / إلغاء باقة)
create or replace function reverse_loyalty_points(p_ref_type text, p_ref_id uuid, p_reason text) returns void
language plpgsql security definer set search_path = public as $$
declare row loyalty_ledger;
begin
  select * into row from loyalty_ledger where ref_type = p_ref_type and ref_id = p_ref_id and kind <> 'adjust' limit 1;
  if row.id is null then return; end if; -- لم تُحتسب نقاط لهذا المرجع أصلًا
  if exists (select 1 from loyalty_ledger where ref_type = 'adjust_' || p_ref_type and ref_id = p_ref_id) then return; end if; -- سبق سحبها
  perform award_loyalty_points(row.patient_id, 'adjust', -row.points, p_reason, 'adjust_' || p_ref_type, p_ref_id);
end $$;

create or replace function delete_session(p_id uuid) returns void
language plpgsql security definer set search_path = public as $$
declare s treatment_sessions; a appointments;
begin
  perform require_perm('sessions', 'delete');
  select * into s from treatment_sessions where id = p_id;
  if s.id is null then raise exception 'الجلسة غير موجودة'; end if;
  select * into a from appointments where id = s.appointment_id;
  if a.id is not null and s.status = 'completed' then
    update appointments set status = 'arrived' where id = a.id;
    if a.package_id is not null then
      update packages set used_sessions = greatest(used_sessions - 1, 0), status = case when status = 'completed' then 'active' else status end where id = a.package_id;
    end if;
  end if;
  if s.status = 'completed' then perform reverse_loyalty_points('session', s.id, 'إلغاء نقاط جلسة محذوفة رقم ' || s.session_no); end if;
  delete from treatment_sessions where id = p_id;
  if s.plan_id is not null then
    perform recalc_plan(s.plan_id);
    update treatment_plans set status = 'active' where id = s.plan_id and status = 'completed'
      and (select count(*) from treatment_sessions where plan_id = s.plan_id and status = 'completed') < total_sessions;
  end if;
  perform log_action('حذف الجلسة رقم ' || s.session_no, s.patient_id);
end $$;

create or replace function cancel_package(p_id uuid) returns void
language plpgsql security definer set search_path = public as $$
declare pk packages; a record;
begin
  perform require_perm('packages', 'edit');
  select * into pk from packages where id = p_id for update;
  if pk.id is null then raise exception 'الباقة غير موجودة'; end if;
  update packages set status = 'cancelled' where id = p_id;
  update invoices set status = 'cancelled' where package_id = p_id and paid = 0;
  perform reverse_loyalty_points('package', p_id, 'إلغاء نقاط باقة ملغاة: ' || pk.name);
  for a in select ap.*, s.name as svc_name from appointments ap join services s on s.id = ap.service_id
           where ap.package_id = p_id and ap.status in ('new','confirmed','on_way','arrived','rescheduled') loop
    update appointments set package_id = null where id = a.id;
    perform new_invoice(pk.patient_id, a.svc_name, a.price, 'due', a.date, a.id, null, null, a.service_id);
  end loop;
  perform log_action('إلغاء الباقة ' || pk.name, pk.patient_id);
end $$;

-- 2) منع Race Condition عند استبدال نقاط الولاء (قفل لكل مريض طوال المعاملة)
create or replace function redeem_loyalty_points(p_patient uuid) returns jsonb
language plpgsql security definer set search_path = public as $$
declare emp uuid; bal int; code text; dc_id uuid; reward_val numeric;
begin
  emp := require_perm('loyalty', 'create');
  perform pg_advisory_xact_lock(hashtext('loyalty:' || p_patient::text));
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

-- 3) تسجيل "أُرسلت الفاتورة" يتطلب صلاحية تعديل الفواتير لا مجرد الاطلاع عليها
create or replace function mark_invoice_sent(p_invoice uuid) returns void
language plpgsql security definer set search_path = public as $$
declare inv invoices;
begin
  perform require_perm('invoices', 'edit');
  select * into inv from invoices where id = p_invoice;
  if inv.id is null or not can_see_patient(inv.patient_id) then raise exception 'الفاتورة غير موجودة'; end if;
  update invoices set sent_at = now() where id = p_invoice;
  perform log_action('إرسال الفاتورة ' || inv.no || ' للمريض عبر واتساب', inv.patient_id);
end $$;

-- 4) إلغاء فاتورة عليها كود خصم يُعيد الكود قابلًا للاستخدام (بدل ما يفضل "مستهلك" على فاتورة ملغاة)، بنفس منطق حذف الفاتورة
create or replace function cancel_invoice(p_invoice uuid) returns void
language plpgsql security definer set search_path = public as $$
declare inv invoices;
begin
  perform require_perm('invoices', 'edit');
  select * into inv from invoices where id = p_invoice for update;
  if inv.id is null then raise exception 'الفاتورة غير موجودة'; end if;
  if inv.paid > 0 then raise exception 'على الفاتورة مدفوعات. احذف الدفعات أولًا'; end if;
  if inv.discount_code_id is not null then update discount_codes set used_count = greatest(used_count - 1, 0) where id = inv.discount_code_id; end if;
  update invoices set status = 'cancelled' where id = p_invoice;
  perform log_action('إلغاء الفاتورة ' || inv.no, inv.patient_id);
end $$;

-- 5) رسالة عربية واضحة لو حاول حد يحذف كود استبدال نقاط ولاء بدل خطأ SQL خام
create or replace function delete_discount_code(p_id uuid) returns void
language plpgsql security definer set search_path = public as $$
declare dc discount_codes;
begin
  perform require_perm('discounts', 'delete');
  select * into dc from discount_codes where id = p_id;
  if dc.id is null then raise exception 'الكود غير موجود'; end if;
  if dc.used_count > 0 or exists (select 1 from invoices where discount_code_id = p_id) then raise exception 'الكود مستخدم في فواتير — أوقفه بدل حذفه'; end if;
  if exists (select 1 from loyalty_redemptions where discount_code_id = p_id) then raise exception 'الكود مرتبط باستبدال نقاط ولاء — لا يمكن حذفه'; end if;
  delete from discount_codes where id = p_id;
  perform log_action('حذف كود خصم ' || dc.code);
end $$;

-- 6) تذاكر الدعم الفني: صاحب التذكرة يقدر يعدّل موضوعها/وصفها بس، وتغيير الحالة/الأولوية/الإسناد يحتاج صلاحية "الدعم الفني"
create or replace function enforce_ticket_update() returns trigger
language plpgsql as $$
begin
  if not has_perm('support', 'edit') then
    if new.status is distinct from old.status or new.priority is distinct from old.priority or new.assigned_to is distinct from old.assigned_to or new.category is distinct from old.category then
      raise exception 'لا تملك صلاحية تغيير حالة التذكرة أو أولويتها أو إسنادها' using errcode = '42501';
    end if;
  end if;
  return new;
end $$;
drop trigger if exists trg_ticket_update on support_tickets;
create trigger trg_ticket_update before update on support_tickets for each row execute function enforce_ticket_update();

revoke execute on function reverse_loyalty_points(text, uuid, text) from public, anon, authenticated;
