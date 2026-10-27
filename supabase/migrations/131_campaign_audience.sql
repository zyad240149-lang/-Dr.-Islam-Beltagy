-- 131: فلاتر «المستلمون» في «إشعارات المرضى» و«إرسال واتساب يدوي» — مصدر واحد على الخادم (نفس اللي بيتبعت له فعلًا).
-- تصحيحات: «زار قبل كده» = حضر/جاري/مكتمل (مش مكتمل بس — أغلب الزيارات «حضر»)، التواريخ بتوقيت الرياض،
-- و«عندهم حساب» = حساب بوابة مربوط بالملف أو بنفس الجوال (نفس قاعدة التوصيل). الواجهة كانت بتعرض «كل المرضى» للاختيار ده.
create or replace function campaign_audience_ids(aud text, p_source text default null, p_patient uuid default null) returns uuid[]
language sql stable security definer set search_path = public as $$
  select coalesce(array_agg(pt.id order by pt.full_name), '{}') from patients pt
  where pt.active and not coalesce(pt.is_guest, false) and case aud
    when 'source' then pt.referral_source = p_source
    when 'patient' then pt.id = p_patient
    when 'with_account' then exists (select 1 from customers c where c.patient_id = pt.id
         or (c.patient_id is null and right(regexp_replace(c.phone, '\D', '', 'g'), 9) = right(regexp_replace(pt.phone, '\D', '', 'g'), 9)))
    when 'new' then pt.registered_at >= now() - interval '30 days'
    when 'active_plan' then exists (select 1 from treatment_plans tp where tp.patient_id = pt.id and tp.status = 'active')
    when 'inactive' then
      exists (select 1 from appointments ap where ap.patient_id = pt.id and ap.status in ('arrived', 'in_progress', 'completed'))
      and not exists (select 1 from appointments ap2 where ap2.patient_id = pt.id and ap2.date >= riyadh_today() and ap2.status not in ('cancelled', 'no_show', 'completed'))
      and (select max(ap3.date) from appointments ap3 where ap3.patient_id = pt.id and ap3.status in ('arrived', 'in_progress', 'completed')) <= riyadh_today() - 60
    when 'has_sessions' then exists (select 1 from appointments ap join services sv on sv.id = ap.service_id where ap.patient_id = pt.id and ap.date >= riyadh_today()
         and ap.status in ('new', 'confirmed', 'on_way', 'rescheduled') and sv.name not like '%كشف%')
    when 'has_exam' then exists (select 1 from appointments ap join services sv on sv.id = ap.service_id where ap.patient_id = pt.id and ap.date >= riyadh_today()
         and ap.status in ('new', 'confirmed', 'on_way', 'rescheduled') and sv.name like '%كشف%')
    else true end
$$;
revoke execute on function campaign_audience_ids(text, text, uuid) from public, anon, authenticated;

-- للواجهة: المستلمين قبل الإرسال (المعاينة + واتساب)
create or replace function campaign_audience(p_audience text, p_source text default null, p_patient uuid default null) returns uuid[]
language plpgsql stable security definer set search_path = public as $$
begin
  if not (has_perm('campaigns', 'view') or has_perm('whatsapp', 'create')) then raise exception 'لا توجد صلاحية' using errcode = '42501'; end if;
  return campaign_audience_ids(p_audience, p_source, p_patient);
end $$;
revoke execute on function campaign_audience(text, text, uuid) from public, anon;
grant execute on function campaign_audience(text, text, uuid) to authenticated;

CREATE OR REPLACE FUNCTION public.send_campaign(p jsonb)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare meid uuid := require_perm('campaigns', 'create'); aud text := _txt(p, 'audience', 'all'); ids uuid[]; delivered int := 0; v uuid;
begin
  if length(_txt(p, 'title')) < 2 then raise exception 'اكتب عنوان الإشعار'; end if;
  if length(_txt(p, 'body')) < 2 then raise exception 'اكتب نص الإشعار'; end if;
  if aud not in ('all','with_account','source','patient','new','active_plan','inactive','has_sessions','has_exam') then raise exception 'المستلمون غير صحيح'; end if;
  ids := campaign_audience_ids(aud, _txt(p, 'source'), _uuid(p, 'patientId'));
  if array_length(ids, 1) is null then raise exception 'لا يوجد مستلمين بهذا الاختيار'; end if;
  insert into notifications (audience, customer_id, patient_id, kind, title, body)
  select distinct on (c.id) 'customer', c.id, pt.id, 'offer', _txt(p, 'title'), _txt(p, 'body')
  from patients pt join customers c on c.patient_id = pt.id
     or (c.patient_id is null and right(regexp_replace(c.phone, '\D', '', 'g'), 9) = right(regexp_replace(pt.phone, '\D', '', 'g'), 9))
  where pt.id = any(ids);
  get diagnostics delivered = row_count;
  insert into campaigns (title, body, audience, source, patient_id, discount_code_id, recipients, delivered, created_by)
  values (_txt(p, 'title'), _txt(p, 'body'), aud, nullif(p->>'source', ''), _uuid(p, 'patientId'), _uuid(p, 'discountCodeId'),
          array_length(ids, 1), delivered, meid) returning id into v;
  perform log_action('إرسال إشعار للمرضى: ' || _txt(p, 'title') || ' (' || array_length(ids, 1) || ' مستلم، وصل لـ ' || delivered || ' حساب)');
  return jsonb_build_object('id', v, 'recipients', array_length(ids, 1), 'delivered', delivered);
end $function$;
