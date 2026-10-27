-- صلاحيات إضافية لكل موظف على حدة (طلب المدير 2026-10-12): «إرسال واتساب للعملاء» و«استبدال نقاط الولاء».
-- إضافية فوق صلاحيات الدور (مابتشيلش حاجة)، والمدير بيفعّلها/يعطّلها لكل موظف من غير ما يديه صلاحيات المدير.
alter table employees add column if not exists extra_perms jsonb not null default '{}'::jsonb;
do $$ begin
  if not exists (select 1 from pg_constraint where conname = 'employees_extra_perms_chk') then
    alter table employees add constraint employees_extra_perms_chk check (jsonb_typeof(extra_perms) = 'object'
      and (extra_perms - 'whatsapp' - 'loyalty') = '{}'::jsonb);
  end if;
end $$;

-- has_perm: الدور OR الصلاحية الإضافية للموظف نفسه (نفس شروط النشاط والإجازة)
create or replace function has_perm(p_area text, p_op text) returns boolean
language sql stable security definer set search_path = public as $$
  select exists (
    select 1 from employees e
    where e.auth_user_id = auth.uid() and e.active and not is_on_leave(e.id)
      and (e.role = 'system_admin'
        or exists (select 1 from role_permissions rp where rp.role = e.role and rp.area = p_area and p_op = any(rp.ops))
        or coalesce(e.extra_perms -> p_area, '[]'::jsonb) ? p_op)
  )
$$;

-- Area جديدة: whatsapp (create = إرسال). الأدوار اللي كانت بتبعت من الواجهة قبل كده بتفضل تبعت.
insert into role_permissions (role, area, ops) values
  ('system_admin', 'whatsapp', array['view', 'create']), ('center_manager', 'whatsapp', array['view', 'create']),
  ('reception', 'whatsapp', array['view', 'create']), ('secretary', 'whatsapp', array['view', 'create']),
  ('accountant', 'whatsapp', array[]::text[]), ('therapist', 'whatsapp', array[]::text[])
on conflict (role, area) do nothing;

-- تفعيل/تعطيل الصلاحيتين لموظف (المدير أو من له تعديل الأدوار)
create or replace function set_employee_extra_perms(p_employee uuid, p_whatsapp boolean, p_loyalty boolean) returns jsonb
language plpgsql security definer set search_path = public as $$
declare me uuid := require_perm('roles', 'edit'); e employees; v jsonb := '{}'::jsonb;
begin
  select * into e from employees where id = p_employee for update;
  if e.id is null then raise exception 'الموظف غير موجود'; end if;
  if p_whatsapp then v := v || '{"whatsapp":["view","create"]}'; end if;
  if p_loyalty then v := v || '{"loyalty":["view","create"]}'; end if;
  update employees set extra_perms = v where id = p_employee;
  insert into activity_log (employee_id, action)
  values (me, format('تعديل صلاحيات %s: واتساب=%s، استبدال النقاط=%s', e.name, case when p_whatsapp then 'مفعّل' else 'معطّل' end, case when p_loyalty then 'مفعّل' else 'معطّل' end));
  return v;
end $$;
revoke execute on function set_employee_extra_perms(uuid, boolean, boolean) from public, anon;
grant execute on function set_employee_extra_perms(uuid, boolean, boolean) to authenticated;

-- سجل رسائل واتساب: بصلاحية whatsapp، ونطاق المريض، والحالة «pending» (wa.me بيفتح المحادثة والموظف بيضغط إرسال — مانقدرش نأكد التسليم)
create or replace function log_whatsapp_message(p jsonb) returns jsonb
language plpgsql security definer set search_path = public as $$
declare v uuid; pid uuid := _uuid(p, 'patientId'); ph text := regexp_replace(coalesce(_txt(p, 'phone'), ''), '[^0-9+]', '', 'g');
begin
  perform require_perm('whatsapp', 'create');
  if ph = '' or length(ph) > 20 then raise exception 'رقم الجوال غير صحيح'; end if;
  if pid is not null and not can_see_patient(pid) then raise exception 'لا توجد صلاحية لهذه العملية' using errcode = '42501'; end if;
  if length(coalesce(_txt(p, 'messageContent'), '')) > 4000 then raise exception 'الرسالة طويلة جدًا'; end if;
  insert into whatsapp_messages (patient_id, phone, template_id, message_type, message_content, status, sent_at)
  values (pid, ph, _uuid(p, 'templateId'), left(coalesce(nullif(_txt(p, 'messageType'), ''), 'general'), 40), _txt(p, 'messageContent'), 'pending', now())
  returning id into v;
  return jsonb_build_object('id', v);
end $$;

-- قراءة السجل: صاحب صلاحية واتساب كمان
drop policy if exists staff_read on whatsapp_messages;
create policy staff_read on whatsapp_messages for select using (
  (has_perm('whatsapp', 'view') or has_perm('campaigns', 'view') or has_perm('invoices', 'view') or has_perm('patients', 'view')) and can_see_patient(patient_id));
