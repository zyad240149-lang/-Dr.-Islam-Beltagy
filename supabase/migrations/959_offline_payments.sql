-- 959: تسجيل الدفعات من غير إنترنت بمفتاح عملية (idempotency) — نفس فكرة offline_book_appointment (هجرة 190).
-- الجهاز بيولّد مفتاح للدفعة قبل أول محاولة؛ لو الاتصال قطع بعد ما الخادم حفظ، إعادة الإرسال بنفس المفتاح بترجع نفس النتيجة
-- ومابتسجّلش الدفعة مرتين. التحقق والصلاحيات كلها جوّه record_payment زي ما هي (require_perm('payments','create')).
create or replace function public.offline_exec(p_key uuid, p_kind text, p jsonb) returns jsonb
language plpgsql security definer set search_path = public as $$
declare prev offline_ops; res jsonb := '{}'::jsonb; me uuid := my_employee_id();
begin
  if p_key is null then raise exception 'مفتاح العملية مطلوب'; end if;
  -- نفس المفتاح بيتنفّذ مرة واحدة بس حتى لو جه من تبويبين/جهازين في نفس اللحظة
  perform pg_advisory_xact_lock(hashtextextended('offline_ops:' || p_key::text, 0));
  select * into prev from offline_ops where key = p_key;
  if prev.key is not null then
    if prev.employee_id is distinct from me then raise exception 'مفتاح العملية مستخدم من موظف آخر'; end if;
    return prev.result;
  end if;
  if p_kind = 'payment.record' then
    perform record_payment((p->>'invoiceId')::uuid, (p->>'amount')::numeric, p->>'method', coalesce(p->>'note', ''));
    res := jsonb_build_object('ok', true);
  else
    raise exception 'نوع عملية غير مدعوم: %', p_kind;
  end if;
  insert into offline_ops (key, employee_id, kind, result) values (p_key, me, p_kind, res);
  return res;
end $$;
revoke all on function public.offline_exec(uuid, text, jsonb) from public, anon;
grant execute on function public.offline_exec(uuid, text, jsonb) to authenticated;
