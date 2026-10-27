-- كل معالج بيقدّم كل الخدمات (طلب المستخدم): اختيار «الخدمات التي يقدمها» اتشال من نموذج المعالج.
-- therapist_services بيفضل موجود لأن دوال الحجز بتتحقق منه، فبنخليه دايمًا مليان بكل التوليفات.
insert into therapist_services (therapist_id, service_id)
select t.id, s.id from therapists t cross join services s
on conflict do nothing;

create or replace function fill_therapist_services() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if tg_table_name = 'therapists' then
    insert into therapist_services (therapist_id, service_id) select new.id, s.id from services s on conflict do nothing;
  else
    insert into therapist_services (therapist_id, service_id) select t.id, new.id from therapists t on conflict do nothing;
  end if;
  return null;
end $$;

drop trigger if exists trg_therapist_all_services on therapists;
create trigger trg_therapist_all_services after insert on therapists for each row execute function fill_therapist_services();
drop trigger if exists trg_service_all_therapists on services;
create trigger trg_service_all_therapists after insert on services for each row execute function fill_therapist_services();
