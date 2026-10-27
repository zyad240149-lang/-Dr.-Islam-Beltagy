-- 171: جلسات الخطة/الباقة = 30 دقيقة، ورفع منع «جلسة خطة/باقة واحدة في اليوم» وقت الحجز (قرار المستخدم).
-- الجلستين في نفس اليوم بقوا مسموحين لو في وقتين مختلفين؛ المنع الوحيد وقت الحجز = تقاطع وقت مع موعد تاني للمريض نفسه.
-- قاعدة الحضور (124–129) فاضلة زي ما هي: الجلسة التانية في اليوم عند تسجيل الحضور بموافقة المدير وبعد ساعة، وحد أقصى جلستين.

create or replace function book_plan_session(p jsonb) returns jsonb
language plpgsql security definer set search_path = public as $$
declare pl treatment_plans; v_date date := nullif(p->>'date', '')::date; v_time text := nullif(p->>'time', ''); used int;
begin
  perform require_any(array['booking:create', 'appointments:create']);
  select * into pl from treatment_plans where id = _uuid(p, 'planId') for update;
  if pl.id is null or not can_see_patient(pl.patient_id) then raise exception 'الخطة العلاجية غير موجودة'; end if;
  if pl.status <> 'active' then raise exception 'الخطة العلاجية ليست نشطة — لا يمكن حجز جلسات عليها'; end if;
  if v_date is null then raise exception 'اختر التاريخ'; end if;
  select count(*)::int into used from appointments
   where plan_id = pl.id and status not in ('cancelled', 'no_show');
  if used >= pl.total_sessions then
    raise exception 'كل جلسات الخطة محجوزة بالفعل (% من %) — عدّل موعد موجود أو زوّد عدد جلسات الخطة', used, pl.total_sessions;
  end if;
  perform pg_advisory_xact_lock(hashtext('pt-day:' || pl.patient_id::text || v_date::text));
  if v_time is not null and exists (
       select 1 from appointments x
        where x.patient_id = pl.patient_id and x.date = v_date and x.status not in ('cancelled', 'no_show')
          and v_time::time < x.time::time + make_interval(mins => x.duration_min)
          and x.time::time < v_time::time + interval '30 minutes') then
    raise exception 'عند المريض موعد تاني في هالوقت يوم % — اختر وقتًا مختلفًا', to_char(v_date, 'YYYY-MM-DD');
  end if;
  return book_appointment(jsonb_build_object('patientId', pl.patient_id, 'type', 'session', 'serviceId', pl.service_id, 'planId', pl.id, 'durationMin', 30)
    || (p - 'patientId' - 'serviceId' - 'planId' - 'packageId' - 'guest' - 'priceId' - 'durationMin' - 'location' - 'address'));
end $$;
revoke execute on function book_plan_session(jsonb) from public, anon;
grant execute on function book_plan_session(jsonb) to authenticated;

-- نقل/تعديل موعد جلسة خطة/باقة: المنع بس لو الوقت الجديد بيتقاطع مع جلسة خطة/باقة تانية للمريض
create or replace function guard_plan_session_day() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if new.plan_id is null and new.package_id is null then return new; end if;
  if new.date is not distinct from old.date and new.time is not distinct from old.time then return new; end if;
  if new.status not in ('new', 'confirmed', 'rescheduled', 'on_way') then return new; end if;
  perform pg_advisory_xact_lock(hashtext('pt-day:' || new.patient_id::text || new.date::text));
  if exists (select 1 from appointments x where x.patient_id = new.patient_id and x.date = new.date and x.id <> new.id
              and x.status in ('new', 'confirmed', 'rescheduled', 'on_way', 'arrived', 'in_progress') and (x.plan_id is not null or x.package_id is not null)
              and new.time::time < x.time::time + make_interval(mins => x.duration_min)
              and x.time::time < new.time::time + make_interval(mins => new.duration_min)) then
    raise exception 'المريض عنده جلسة خطة/باقة في هالوقت يوم % — اختر وقتًا مختلفًا', to_char(new.date, 'YYYY-MM-DD');
  end if;
  return new;
end $$;
revoke execute on function guard_plan_session_day() from public, anon, authenticated;
drop trigger if exists appointments_plan_session_day on appointments;
create trigger appointments_plan_session_day before update of date, time on appointments
  for each row execute function guard_plan_session_day();
