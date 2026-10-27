-- طلب المدير 2026-10-12: التارجت = الفواتير المؤكدة على مواعيد باسم الأخصائي (دكتور الموعد) — الموعد لازم يتأكد (حضر/جاري/مكتمل).
-- مابقاش بيتحسب لمين سجّل الجلسة. القيمة = صافي فاتورة الموعد (أو حصته من فاتورة الخطة/الباقة).
create or replace function target_visits(p_therapist uuid, p_from date, p_to date, p_exclude_due uuid default null)
returns table (appointment_id uuid, visit_date date, visit_time text, appt_status text, file_no text, patient_name text, service_name text,
               invoice_no text, source text, value_net numeric, collected numeric, payment_status text, counted_elsewhere boolean)
language sql stable security definer set search_path = public as $$
  with v as (
    select a.id, a.date, a.time, a.status, a.plan_id, a.package_id, a.service_id, a.patient_id
    from appointments a
    where a.date between p_from and p_to and a.status in ('arrived', 'in_progress', 'completed')
      and a.therapist_id = p_therapist
  )
  select v.id, v.date, v.time, v.status, coalesce(p.file_no, ''), coalesce(p.full_name, ''), coalesce(sv.name, ''),
    coalesce(own.no, sh.no),
    case when own.n > 0 then 'visit' when sh.n > 0 then sh.src else 'none' end,
    round(coalesce(case when own.n > 0 then own.net else sh.net end, 0), 2),
    round(coalesce(case when own.n > 0 then own.coll else sh.coll end, 0), 2),
    coalesce(case when own.n > 0 then own.st else sh.st end, 'none'),
    exists (select 1 from payroll_due_visits dv where dv.appointment_id = v.id and dv.due_id is distinct from p_exclude_due)
  from v
  left join patients p on p.id = v.patient_id
  left join services sv on sv.id = v.service_id
  left join lateral (
    select count(*) as n, string_agg(i.no, '، ' order by i.no) as no,
      sum(greatest(i.price - i.discount, 0)) as net,
      sum(case when i.total > 0 then greatest(i.price - i.discount, 0) * least(i.paid / i.total, 1) else 0 end) as coll,
      case when bool_and(i.remaining <= 0) then 'paid' when bool_or(i.paid > 0) then 'partial' else 'due' end as st
    from invoices i where i.appointment_id = v.id and i.status not in ('cancelled', 'draft')
  ) own on true
  left join lateral (
    -- فاتورة واحدة لخطة علاجية أو باقة: الصافي ÷ عدد الجلسات، لأول «عدد الجلسات» زيارة منفذة بس
    select x.n, x.no, x.src, x.net / greatest(x.sessions, 1) as net, x.coll / greatest(x.sessions, 1) as coll, x.st
    from (
      select count(*) as n, string_agg(i.no, '، ' order by i.no) as no, 'plan'::text as src, max(tp.total_sessions) as sessions,
        sum(greatest(i.price - i.discount, 0)) as net,
        sum(case when i.total > 0 then greatest(i.price - i.discount, 0) * least(i.paid / i.total, 1) else 0 end) as coll,
        case when bool_and(i.remaining <= 0) then 'paid' when bool_or(i.paid > 0) then 'partial' else 'due' end as st
      from treatment_plans tp join invoices i on i.plan_id = tp.id and i.appointment_id is null and i.status not in ('cancelled', 'draft')
      where tp.id = v.plan_id
      having count(*) > 0
      union all
      select count(*), string_agg(i.no, '، ' order by i.no), 'package', max(pk.total_sessions),
        sum(greatest(i.price - i.discount, 0)),
        sum(case when i.total > 0 then greatest(i.price - i.discount, 0) * least(i.paid / i.total, 1) else 0 end),
        case when bool_and(i.remaining <= 0) then 'paid' when bool_or(i.paid > 0) then 'partial' else 'due' end
      from packages pk join invoices i on i.package_id = pk.id and i.appointment_id is null and i.status not in ('cancelled', 'draft')
      where pk.id = v.package_id and v.plan_id is null
      having count(*) > 0
    ) x
    where (select count(*) from appointments a2
           where a2.status in ('arrived', 'in_progress', 'completed')
             and ((x.src = 'plan' and a2.plan_id = v.plan_id) or (x.src = 'package' and a2.package_id = v.package_id))
             and (a2.date, a2.time, a2.id::text) < (v.date, v.time, v.id::text)) < greatest(x.sessions, 1)
    limit 1
  ) sh on true
$$;
update center_info set target_revenue_basis = 'invoiced' where id is not null;
