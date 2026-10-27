-- 166: مين حجز الموعد ومين لغاه — بيتسجّل على الخادم بتريجر (مش من الواجهة)، فبيغطي كل الدوال
-- (book_appointment / patient_book / book_plan_session / attendance_check_in / set_appointment_status / patient_cancel / ...)
-- وأي تعديل مباشر على الجدول.
-- النوع: staff = موظف (الاسم والوظيفة بيتحفظوا لقطة وقت العملية عشان يفضلوا حتى لو الموظف اتمسح أو اتغيّرت وظيفته)
--        patient = المريض نفسه من الموقع/بوابة المريض، system = عملية آلية (service role / مهمة دورية) أو مش معروف.

begin;

alter table appointments add column if not exists created_by_kind text;
alter table appointments add column if not exists created_by_name text;
alter table appointments add column if not exists created_by_role text;
alter table appointments add column if not exists cancelled_at timestamptz;
alter table appointments add column if not exists cancelled_by uuid references employees(id) on delete set null;
alter table appointments add column if not exists cancelled_by_kind text;
alter table appointments add column if not exists cancelled_by_name text;
alter table appointments add column if not exists cancelled_by_role text;

alter table appointments drop constraint if exists appointments_created_by_kind_check;
alter table appointments add constraint appointments_created_by_kind_check check (created_by_kind is null or created_by_kind in ('staff', 'patient', 'system'));
alter table appointments drop constraint if exists appointments_cancelled_by_kind_check;
alter table appointments add constraint appointments_cancelled_by_kind_check check (cancelled_by_kind is null or cancelled_by_kind in ('staff', 'patient', 'system'));
create index if not exists idx_appointments_cancelled_by on appointments(cancelled_by) where cancelled_by is not null;

-- ===== المواعيد القديمة (قبل التريجر، ومن غير تشغيل تريجرات الجدول عشان قيود الحجز ماتترفضش على مواعيد تاريخية) =====
alter table appointments disable trigger user;
-- الحجز: الموظف المنشئ (created_by) أو المريض أونلاين
update appointments a set created_by_kind = 'staff', created_by_name = e.name, created_by_role = e.role
  from employees e where a.created_by = e.id and a.created_by_kind is null;
update appointments set created_by_kind = 'patient' where created_by_kind is null and source = 'online';
update appointments set created_by_kind = 'system' where created_by_kind is null and created_by is not null;
-- الباقي (قديم من غير منشئ) بيفضل null = «غير معروف»

-- الإلغاء: من سجل تغيير الحالة (appointment_status_history.changed_by = auth.uid() وقتها)
with last_cancel as (
  select distinct on (h.appointment_id) h.appointment_id, h.changed_by, h.changed_at
  from appointment_status_history h
  where h.new_status = 'cancelled'
  order by h.appointment_id, h.changed_at desc
)
update appointments a set
  cancelled_at = lc.changed_at,
  cancelled_by = e.id,
  cancelled_by_kind = case when e.id is not null then 'staff'
                           when exists (select 1 from customers c where c.auth_user_id = lc.changed_by) then 'patient'
                           else 'system' end,
  cancelled_by_name = e.name,
  cancelled_by_role = e.role
from last_cancel lc
left join employees e on e.auth_user_id = lc.changed_by
where a.id = lc.appointment_id and a.status = 'cancelled' and a.cancelled_at is null;
-- ملغي من غير سجل: وقت آخر تعديل بس، والمنفّذ غير معروف (إلا لو السبب الافتراضي لإلغاء المريض)
update appointments set cancelled_at = updated_at,
  cancelled_by_kind = case when cancel_reason = 'إلغاء من المريض' then 'patient' else null end
  where status = 'cancelled' and cancelled_at is null;
alter table appointments enable trigger user;

-- ===== التريجر =====
create or replace function appointments_track_actor() returns trigger
language plpgsql security definer set search_path = public as $$
declare v_emp employees; v_is_customer boolean;
begin
  select * into v_emp from employees where auth_user_id = auth.uid() and active limit 1;
  v_is_customer := v_emp.id is null and auth.uid() is not null
    and exists (select 1 from customers where auth_user_id = auth.uid());

  if tg_op = 'INSERT' then
    if v_emp.id is not null then
      new.created_by := coalesce(new.created_by, v_emp.id);
    end if;
    if new.created_by is not null then
      if v_emp.id is null or v_emp.id <> new.created_by then
        select * into v_emp from employees where id = new.created_by;
      end if;
      new.created_by_kind := 'staff';
      new.created_by_name := v_emp.name;
      new.created_by_role := v_emp.role;
    elsif v_is_customer or new.source = 'online' then
      new.created_by_kind := 'patient';
      new.created_by_name := null;
      new.created_by_role := null;
    else
      new.created_by_kind := 'system';
    end if;
    if new.status = 'cancelled' then
      new.cancelled_at := now();
      new.cancelled_by := v_emp.id;
      new.cancelled_by_kind := case when v_emp.id is not null then 'staff' when v_is_customer then 'patient' else 'system' end;
      new.cancelled_by_name := v_emp.name;
      new.cancelled_by_role := v_emp.role;
    end if;
    return new;
  end if;

  -- UPDATE: بيانات الحجز مابتتغيّرش بعد الإنشاء
  new.created_by := old.created_by;
  new.created_by_kind := old.created_by_kind;
  new.created_by_name := old.created_by_name;
  new.created_by_role := old.created_by_role;

  if new.status = 'cancelled' and old.status is distinct from 'cancelled' then
    new.cancelled_at := now();
    if v_emp.id is not null then
      new.cancelled_by := v_emp.id;
      new.cancelled_by_kind := 'staff';
      new.cancelled_by_name := v_emp.name;
      new.cancelled_by_role := v_emp.role;
    else
      new.cancelled_by := null;
      new.cancelled_by_kind := case when v_is_customer then 'patient' else 'system' end;
      new.cancelled_by_name := null;
      new.cancelled_by_role := null;
    end if;
  elsif new.status = 'cancelled' then
    -- لسه ملغي: سجل الإلغاء ثابت
    new.cancelled_at := old.cancelled_at;
    new.cancelled_by := old.cancelled_by;
    new.cancelled_by_kind := old.cancelled_by_kind;
    new.cancelled_by_name := old.cancelled_by_name;
    new.cancelled_by_role := old.cancelled_by_role;
  else
    -- الموعد رجع من الإلغاء (أو مااتلغاش): مفيش بيانات إلغاء
    new.cancelled_at := null;
    new.cancelled_by := null;
    new.cancelled_by_kind := null;
    new.cancelled_by_name := null;
    new.cancelled_by_role := null;
  end if;
  return new;
end $$;

revoke execute on function appointments_track_actor() from public, anon, authenticated;

drop trigger if exists trg_appointments_track_actor on appointments;
create trigger trg_appointments_track_actor before insert or update on appointments
  for each row execute function appointments_track_actor();

commit;
