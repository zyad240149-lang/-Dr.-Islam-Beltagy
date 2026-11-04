-- 933: ربط مواعيد المتابعة بالمواعيد في الاتجاهين.
-- حجز نوعه «متابعة» بيتربط بموعد متابعة موجود لنفس المريض في نفس اليوم، أو بيتعمله موعد متابعة جديد.
-- تأجيل الحجز أو إلغاؤه أو تسجيل حضوره بيتنقل لموعد المتابعة المربوط. حالة التأكيد بتتقرا من الحجز نفسه.
alter table ortho_follow_ups add column if not exists auto_created boolean not null default false;

-- الحجز الواحد ليه موعد متابعة واحد: لما موعد يتربط بحجز، الموعد التلقائي المكرر بيتشال وأي موعد تاني بيتفك ربطه
create or replace function public.trg_follow_up_one_per_appointment() returns trigger
language plpgsql security definer set search_path to 'public' as $$
begin
  if new.appointment_id is not null then
    delete from ortho_follow_ups where appointment_id = new.appointment_id and id <> new.id and auto_created;
    update ortho_follow_ups set appointment_id = null where appointment_id = new.appointment_id and id <> new.id;
  end if;
  return new;
end $$;
drop trigger if exists trg_one_per_appointment on ortho_follow_ups;
create trigger trg_one_per_appointment before insert or update of appointment_id on ortho_follow_ups
  for each row execute function public.trg_follow_up_one_per_appointment();

create unique index if not exists ortho_follow_ups_one_appointment on ortho_follow_ups(appointment_id) where appointment_id is not null;

create or replace function public.trg_appointment_follow_up_sync() returns trigger
language plpgsql security definer set search_path to 'public' as $$
declare fu_id uuid; slot time := nullif(new.time, '')::time;
begin
  if tg_op = 'INSERT' then
    if new.type <> 'followup' or new.status = 'cancelled' then return new; end if;
    select id into fu_id from ortho_follow_ups
      where patient_id = new.patient_id and date = new.date and status = 'scheduled' and appointment_id is null
        and (doctor_id is null or doctor_id is not distinct from new.therapist_id)
      order by (time is not distinct from slot) desc, created_at limit 1;
    if fu_id is not null then
      update ortho_follow_ups set appointment_id = new.id, time = slot, doctor_id = new.therapist_id where id = fu_id;
    else
      insert into ortho_follow_ups (patient_id, doctor_id, date, time, notes, status, appointment_id, auto_created)
      values (new.patient_id, new.therapist_id, new.date, slot, new.notes, 'scheduled', new.id, true);
    end if;
    return new;
  end if;

  if new.status = 'cancelled' and old.status <> 'cancelled' then
    update ortho_follow_ups set status = 'cancelled' where appointment_id = new.id and status = 'scheduled';
  elsif new.status in ('arrived', 'in_progress', 'completed') and old.status not in ('arrived', 'in_progress', 'completed') then
    update ortho_follow_ups set status = 'done' where appointment_id = new.id and status = 'scheduled';
  end if;
  if new.date <> old.date or new.time <> old.time or new.therapist_id is distinct from old.therapist_id then
    update ortho_follow_ups set date = new.date, time = slot, doctor_id = new.therapist_id
      where appointment_id = new.id and status = 'scheduled';
  end if;
  return new;
end $$;
drop trigger if exists trg_follow_up_sync on appointments;
create trigger trg_follow_up_sync after insert or update of status, date, time, therapist_id on appointments
  for each row execute function public.trg_appointment_follow_up_sync();

revoke execute on function public.trg_follow_up_one_per_appointment() from public, anon, authenticated;
revoke execute on function public.trg_appointment_follow_up_sync() from public, anon, authenticated;

-- الحجوزات اللي نوعها «متابعة» ولسه جاية تتربط كمان
insert into ortho_follow_ups (patient_id, doctor_id, date, time, notes, status, appointment_id, auto_created)
select a.patient_id, a.therapist_id, a.date, nullif(a.time, '')::time, a.notes, 'scheduled', a.id, true
from appointments a
where a.type = 'followup' and a.status in ('new', 'confirmed', 'on_way', 'rescheduled') and a.date >= current_date
  and not exists (select 1 from ortho_follow_ups f where f.appointment_id = a.id);
