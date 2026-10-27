-- 190: حجز موعد بمفتاح عملية (idempotency) — للمزامنة بعد العمل بدون إنترنت (admin/src/offline/).
-- الواجهة بتسجّل الموعد محليًا بمعرّف فريد لكل عملية، ولما الاتصال يرجع بتبعته هنا. لو الإرسال اتكرر (الاتصال قطع بعد ما الخادم نفّذ،
-- أو التطبيق اتفتح تاني وحاول من جديد) بنرجّع نفس الموعد اللي اتعمل من غير ما نحجز مرة تانية.
-- كل قواعد الحجز (الدكتور، دوام الدكتور، التعارض، الصلاحيات، اكتمال بيانات المريض...) بتفضل جوّه book_appointment نفسها — ما اتغيّرتش.
-- إضافة فقط: جدول جديد + دالة جديدة. مفيش تعديل ولا حذف لأي حاجة موجودة.

create table if not exists offline_ops (
  key uuid primary key,
  employee_id uuid,
  kind text not null,
  result jsonb,
  created_at timestamptz not null default now()
);
alter table offline_ops enable row level security; -- من غير سياسات: مفيش وصول مباشر، الدالة (security definer) بس
create index if not exists offline_ops_created_idx on offline_ops (created_at);

create or replace function offline_book_appointment(p_key uuid, p jsonb) returns jsonb
language plpgsql security definer set search_path = public as $$
declare prev offline_ops; res jsonb; me uuid := my_employee_id();
begin
  perform require_any(array['booking:create', 'appointments:create']);
  if p_key is null then raise exception 'مفتاح العملية مطلوب'; end if;
  -- نفس المفتاح بيتنفّذ مرة واحدة بس حتى لو جه من تبويبين/جهازين في نفس اللحظة
  perform pg_advisory_xact_lock(hashtextextended('offline_ops:' || p_key::text, 0));
  select * into prev from offline_ops where key = p_key;
  if prev.key is not null then
    if prev.employee_id is distinct from me then raise exception 'مفتاح العملية مستخدم من موظف آخر'; end if;
    return prev.result;
  end if;
  res := book_appointment(p);
  insert into offline_ops (key, employee_id, kind, result) values (p_key, me, 'appointment.create', res);
  return res;
end $$;
revoke all on function offline_book_appointment(uuid, jsonb) from public, anon;
grant execute on function offline_book_appointment(uuid, jsonb) to authenticated;
