-- إعادة إرسال الإشعار الدائن لفاتورة ملغاة (زر «إرسال للهيئة الآن» بعد تعذّر الإرسال): الفاتورة الملغاة
-- ما بتدخلش الطابور كفاتورة جديدة، بس المستندات المتعلّقة بيها (الإشعار الدائن) بترجع للانتظار.
create or replace function zatca_enqueue(p_invoice uuid default null) returns int
language plpgsql security definer set search_path = public as $$
declare cfg zatca_config; n int := 0; inv invoices;
begin
  select * into cfg from zatca_config where id = 1;
  if cfg.status <> 'ready' then return 0; end if;
  if p_invoice is not null then
    if auth.role() <> 'service_role' then perform require_perm('invoices', 'edit'); end if;
    select * into inv from invoices where id = p_invoice;
    if inv.id is null then raise exception 'الفاتورة غير موجودة'; end if;
    if inv.status = 'draft' then raise exception 'لا يمكن إرسال فاتورة مسودة للهيئة'; end if;
    update zatca_documents set status = 'pending', xml = null, hash = null, qr = null, icv = null, uuid = gen_random_uuid(), errors = '[]', warnings = '[]', attempts = 0
      where invoice_id = inv.id and status = 'rejected';
    update zatca_documents set status = 'pending', attempts = 0 where invoice_id = inv.id and status = 'error';
    if inv.status = 'cancelled' then
      if not exists (select 1 from zatca_documents where invoice_id = inv.id) then raise exception 'فاتورة ملغاة قبل إرسالها — لا يوجد ما يُرسل للهيئة'; end if;
      return 1;
    end if;
    insert into zatca_documents (invoice_id, kind, doc_no, created_by) values (inv.id, 'invoice', inv.no, my_employee_id())
      on conflict (invoice_id, kind) do nothing;
    update invoices set zatca_status = 'pending' where id = inv.id and coalesce(zatca_status, '') not in ('reported','warning');
    return 1;
  end if;
  if auth.role() <> 'service_role' then raise exception 'غير مسموح'; end if;
  with due as (
    select i.id, i.no from invoices i
    where i.status in ('due','partial','paid') and i.created_at >= cfg.onboarded_at
      and not exists (select 1 from zatca_documents d where d.invoice_id = i.id and d.kind = 'invoice')
      and (i.paid > 0 or i.sent_at is not null or i.created_at < now() - interval '20 hours')
  ), ins as (
    insert into zatca_documents (invoice_id, kind, doc_no) select id, 'invoice', no from due on conflict do nothing returning invoice_id
  )
  update invoices set zatca_status = 'pending' where id in (select invoice_id from ins);
  get diagnostics n = row_count;
  return n;
end $$;
