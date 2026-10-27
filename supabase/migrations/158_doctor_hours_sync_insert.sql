-- 158: تزامن ساعات الدكتور كمان وقت إنشاء/ربط حساب الطبيب (157 كانت على التعديل بس)
-- لما حساب موظف يتربط بملف معالج: لو ملف المعالج له جدول ← الحساب ياخده؛ لو لأ والحساب له جدول ← ملف المعالج ياخده.
create or replace function public.sync_employee_hours_on_link()
returns trigger language plpgsql security definer set search_path to 'public'
as $$
declare twh jsonb;
begin
  if new.therapist_id is null then return new; end if;
  if tg_op = 'UPDATE' and old.therapist_id is not distinct from new.therapist_id then return new; end if;
  select work_hours into twh from therapists where id = new.therapist_id;
  if jsonb_typeof(twh) = 'array' and jsonb_array_length(twh) > 0 then
    new.work_hours := twh;
  elsif jsonb_typeof(new.work_hours) = 'array' and jsonb_array_length(new.work_hours) > 0 then
    update therapists set work_hours = new.work_hours where id = new.therapist_id;
  end if;
  return new;
end $$;
revoke all on function public.sync_employee_hours_on_link() from public, anon, authenticated;
drop trigger if exists trg_sync_employee_hours_link on employees;
create trigger trg_sync_employee_hours_link before insert or update of therapist_id on employees
  for each row execute function sync_employee_hours_on_link();

-- الربط بقى مسؤولية التريجر اللي فوق؛ تريجر 157 على employees يفضل على تعديل الساعات بس
drop trigger if exists trg_sync_employee_hours on employees;
create trigger trg_sync_employee_hours after update of work_hours on employees
  for each row when (old.work_hours is distinct from new.work_hours) execute function sync_employee_hours_to_therapist();

update employees e set work_hours = t.work_hours from therapists t
where e.therapist_id = t.id and jsonb_array_length(coalesce(t.work_hours, '[]')) > 0 and e.work_hours is distinct from t.work_hours;
