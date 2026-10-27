-- شرائح إضافية لإشعارات المرضى: مرضى جدد (30 يوم)، عليهم خطة علاج نشطة، أو حضروا قبل كده ومجوش (60 يوم فأكثر)
alter table campaigns drop constraint if exists campaigns_audience_check;
alter table campaigns add constraint campaigns_audience_check
  check (audience in ('all','with_account','source','patient','new','active_plan','inactive'));

create or replace function send_campaign(p jsonb) returns jsonb
language plpgsql security definer set search_path = public as $$
declare meid uuid := require_perm('campaigns', 'create'); aud text := _txt(p, 'audience', 'all'); ids uuid[]; delivered int := 0; v uuid;
begin
  if length(_txt(p, 'title')) < 2 then raise exception 'اكتب عنوان الإشعار'; end if;
  if length(_txt(p, 'body')) < 2 then raise exception 'اكتب نص الإشعار'; end if;
  if aud not in ('all','with_account','source','patient','new','active_plan','inactive') then raise exception 'المستلمون غير صحيح'; end if;
  select coalesce(array_agg(id), '{}') into ids from patients pt
  where pt.active and case aud
    when 'source' then pt.referral_source = _txt(p, 'source')
    when 'patient' then pt.id = _uuid(p, 'patientId')
    when 'with_account' then exists (select 1 from customers c where c.patient_id = pt.id)
    when 'new' then pt.registered_at >= now() - interval '30 days'
    when 'active_plan' then exists (select 1 from treatment_plans tp where tp.patient_id = pt.id and tp.status = 'active')
    when 'inactive' then
      exists (select 1 from appointments ap where ap.patient_id = pt.id and ap.status = 'completed')
      and not exists (select 1 from appointments ap2 where ap2.patient_id = pt.id and ap2.date >= current_date and ap2.status not in ('cancelled','no_show'))
      and coalesce((select max(ap3.date) from appointments ap3 where ap3.patient_id = pt.id and ap3.status = 'completed'), current_date) <= current_date - 60
    else true end;
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
end $$;
