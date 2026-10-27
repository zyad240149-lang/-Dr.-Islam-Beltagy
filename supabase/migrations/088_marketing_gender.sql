-- تقرير التسويق: تفصيل حسب النوع (ذكر/أنثى) كمان
create or replace function marketing_report(p_month text) returns jsonb
language plpgsql stable security definer set search_path = public as $$
declare m0 date; m1 date; prev0 date; res jsonb;
begin
  perform require_perm('reports', 'view');
  if p_month !~ '^\d{4}-(0[1-9]|1[0-2])$' then raise exception 'اختر شهرًا صحيحًا'; end if;
  m0 := (p_month || '-01')::date; m1 := (m0 + interval '1 month')::date; prev0 := (m0 - interval '1 month')::date;
  select jsonb_build_object(
    'month', p_month,
    'bySource', coalesce((select jsonb_agg(jsonb_build_object('source', s, 'n', n) order by n desc, s) from (
        select coalesce(nullif(referral_source, ''), 'other') s, count(*)::int n from patients
        where not is_guest and can_see_patient(id) and (registered_at at time zone 'Africa/Cairo')::date >= m0 and (registered_at at time zone 'Africa/Cairo')::date < m1 group by 1) x), '[]'),
    'bySourceGender', coalesce((select jsonb_agg(jsonb_build_object('source', s, 'gender', g, 'n', n) order by s, g) from (
        select coalesce(nullif(referral_source, ''), 'other') s, coalesce(nullif(gender, ''), 'male') g, count(*)::int n from patients
        where not is_guest and can_see_patient(id) and (registered_at at time zone 'Africa/Cairo')::date >= m0 and (registered_at at time zone 'Africa/Cairo')::date < m1 group by 1, 2) x), '[]'),
    'previous', coalesce((select jsonb_agg(jsonb_build_object('source', s, 'n', n)) from (
        select coalesce(nullif(referral_source, ''), 'other') s, count(*)::int n from patients
        where not is_guest and can_see_patient(id) and (registered_at at time zone 'Africa/Cairo')::date >= prev0 and (registered_at at time zone 'Africa/Cairo')::date < m0 group by 1) x), '[]'),
    'trend', coalesce((select jsonb_agg(jsonb_build_object('month', mo, 'source', s, 'n', n) order by mo, s) from (
        select to_char((registered_at at time zone 'Africa/Cairo')::date, 'YYYY-MM') mo, coalesce(nullif(referral_source, ''), 'other') s, count(*)::int n from patients
        where not is_guest and can_see_patient(id) and (registered_at at time zone 'Africa/Cairo')::date >= (m0 - interval '11 months')::date and (registered_at at time zone 'Africa/Cairo')::date < m1 group by 1, 2) x), '[]')
  ) into res;
  return res;
end $$;
revoke execute on function marketing_report(text) from public, anon;
grant execute on function marketing_report(text) to authenticated;
