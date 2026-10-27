-- طريقة تسجيل المريض في الموقع (تظهر في ملف المريض): google / phone (رقم + كلمة مرور). null = اتضاف من الإدارة.
alter table patients add column if not exists signup_method text check (signup_method in ('google', 'phone'));

create or replace function set_patient_signup_method() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if new.patient_id is not null and new.auth_user_id is not null then
    update patients set signup_method = case when (select raw_app_meta_data->>'provider' from auth.users where id = new.auth_user_id) = 'google' then 'google' else 'phone' end
    where id = new.patient_id and signup_method is null;
  end if;
  return new;
end $$;
revoke execute on function set_patient_signup_method() from public, anon, authenticated;
drop trigger if exists trg_customer_signup_method on customers;
create trigger trg_customer_signup_method after insert or update of patient_id on customers for each row execute function set_patient_signup_method();

update patients p set signup_method = case when u.raw_app_meta_data->>'provider' = 'google' then 'google' else 'phone' end
from customers c join auth.users u on u.id = c.auth_user_id where c.patient_id = p.id and p.signup_method is null;
