-- 165: حجز مواعيد جلسات الخطة العلاجية من مكانين («إنشاء خطة علاج جديدة» و«مراجعة فاتورة الخطة العلاجية»)
-- على نفس المواعيد الحقيقية (appointments.plan_id). قبل كده الخادم ماكانش بيمنع:
--   - حجز مواعيد أكتر من عدد جلسات الخطة («7 من 6 محجوزة»)
--   - حجز جلستين خطة/باقة للمريض في نفس اليوم (المنع كان عند تسجيل الحضور بس — قاعدة 124–129)
-- book_plan_session: غلاف لـ book_appointment بيقفل الخطة ويفحص القاعدتين، وبعدها نفس الحجز بالظبط
-- (الدكتور إجباري + دوام الدكتور check_slot + مفيش فاتورة منفصلة لأن الخطة ليها فاتورة).
-- book_appointment نفسه ماتغيّرش (الحجز العادي والربط التلقائي بالخطة زي ما هم).

create or replace function book_plan_session(p jsonb) returns jsonb
language plpgsql security definer set search_path = public as $$
declare pl treatment_plans; v_date date := nullif(p->>'date', '')::date; used int;
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
  if exists (select 1 from appointments x where x.patient_id = pl.patient_id and x.date = v_date
              and x.status not in ('cancelled', 'no_show') and (x.plan_id is not null or x.package_id is not null)) then
    raise exception 'المريض عنده جلسة خطة/باقة محجوزة يوم % — جلسة واحدة في اليوم', to_char(v_date, 'YYYY-MM-DD');
  end if;
  return book_appointment(jsonb_build_object('patientId', pl.patient_id, 'type', 'session', 'serviceId', pl.service_id, 'planId', pl.id)
    || (p - 'patientId' - 'serviceId' - 'planId' - 'packageId' - 'guest' - 'priceId' - 'durationMin' - 'location' - 'address'));
end $$;
revoke execute on function book_plan_session(jsonb) from public, anon;
grant execute on function book_plan_session(jsonb) to authenticated;

-- نقل موعد جلسة خطة/باقة (إعادة جدولة) ليوم فيه جلسة خطة/باقة تانية محجوزة للمريض = مرفوض.
-- بيقارن بالمواعيد المحجوزة بس (مش اللي حضرت) عشان مايكسرش «الجلسة التانية بموافقة المدير» في حضور الباقات.
create or replace function guard_plan_session_day() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if new.plan_id is null and new.package_id is null then return new; end if;
  if new.date is not distinct from old.date then return new; end if;
  if new.status not in ('new', 'confirmed', 'rescheduled', 'on_way') then return new; end if;
  perform pg_advisory_xact_lock(hashtext('pt-day:' || new.patient_id::text || new.date::text));
  if exists (select 1 from appointments x where x.patient_id = new.patient_id and x.date = new.date and x.id <> new.id
              and x.status in ('new', 'confirmed', 'rescheduled', 'on_way') and (x.plan_id is not null or x.package_id is not null)) then
    raise exception 'المريض عنده جلسة خطة/باقة محجوزة يوم % — جلسة واحدة في اليوم', to_char(new.date, 'YYYY-MM-DD');
  end if;
  return new;
end $$;
revoke execute on function guard_plan_session_day() from public, anon, authenticated;
drop trigger if exists appointments_plan_session_day on appointments;
create trigger appointments_plan_session_day before update of date on appointments
  for each row execute function guard_plan_session_day();
