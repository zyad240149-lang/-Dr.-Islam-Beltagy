-- ٩/١١: حجز أكتر من مريض في نفس الميعاد مع نفس الدكتور (منع المريض في مكانين في نفس الوقت لسه موجود)
CREATE OR REPLACE FUNCTION public.appointments_no_overlap()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare c appointments; v_doc text;
begin
  if new.status = 'cancelled' then return new; end if;
  if current_setting('app.allow_overlap', true) = 'on' then return new; end if; -- حضور مباشر من «حضور مرضى الباقات»
  -- ٩/١١: أكتر من مريض في نفس الميعاد مع نفس الدكتور مسموح (المنع اتشال)
  -- المريض: مايبقاش في مكانين في نفس الوقت (أي دكتور، أي خدمة). الموعد اللي خلص أو ماحضرهوش مابيحجزش وقته.
  if new.patient_id is not null and new.status not in ('no_show', 'completed') then
    perform pg_advisory_xact_lock(hashtext('pt-appt:' || new.patient_id::text || new.date::text));
    select a.* into c from appointments a
     where a.patient_id = new.patient_id and a.date = new.date and a.id is distinct from new.id
       and a.status not in ('cancelled', 'no_show', 'completed')
       and _hm(new.time) < _hm(a.time) + a.duration_min and _hm(a.time) < _hm(new.time) + new.duration_min
     order by a.time limit 1;
    if c.id is not null then
      select name into v_doc from therapists where id = c.therapist_id;
      raise exception 'المريض عنده موعد تاني في نفس الوقت (% – %)% — اختر وقتًا مختلفًا',
        c.time, to_char(c.time::time + make_interval(mins => c.duration_min), 'HH24:MI'), coalesce(' مع ' || v_doc, '');
    end if;
  end if;
  return new;
end $function$;

CREATE OR REPLACE FUNCTION public.check_slot(p_therapist uuid, p_date date, p_time text, p_dur integer, p_exclude uuid DEFAULT NULL::uuid)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare th therapists; w jsonb; t int; why text;
begin
  if p_therapist is null then raise exception 'لازم اختيار الدكتور قبل تأكيد الحجز.'; end if;
  select * into th from therapists where id = p_therapist;
  if th.id is null or not th.active then raise exception 'الدكتور غير موجود أو غير نشط — اختر دكتور ثاني'; end if;
  if p_time !~ '^\d{2}:\d{2}$' then raise exception 'صيغة الوقت غير صحيحة'; end if;
  if p_date < riyadh_today() then raise exception 'ما يمكن الحجز في تاريخ سابق'; end if;
  if coalesce(p_dur, 0) <= 0 then raise exception 'مدة الزيارة غير صحيحة'; end if;
  w := doctor_day_window(p_therapist, p_date);
  case w->>'status'
    when 'closed' then raise exception 'المركز مغلق في هاليوم';
    when 'holiday' then raise exception 'المركز مغلق في هاليوم — اختر يوم ثاني';
    when 'leave' then raise exception 'الدكتور في إجازة في هذا التاريخ';
    when 'no_hours' then raise exception 'ما تم تحديد مواعيد عمل لهذا الدكتور — حدّدها من «المعالجين» أولًا';
    when 'off_day' then raise exception 'الدكتور ما يعمل في هاليوم — اختر يومًا من أيام عمله';
    when 'ok' then null;
    else raise exception 'الدكتور غير متاح';
  end case;
  t := _hm(p_time);
  why := doctor_window_reason(w, t, p_dur);
  if why = 'center' then raise exception 'الوقت خارج ساعات عمل المركز (% - %)', w->>'centerFrom', w->>'centerTo'; end if;
  if why = 'doctor' then raise exception 'الوقت خارج مواعيد عمل الدكتور (% - %)', w->>'doctorFrom', w->>'doctorTo'; end if;
  if why = 'blocked' then raise exception 'الدكتور غير متاح في هالوقت (استراحة أو استئذان)'; end if;

  -- ٩/١١: أكتر من مريض في نفس الميعاد مسموح — مفيش منع تداخل للدكتور
end $function$;
