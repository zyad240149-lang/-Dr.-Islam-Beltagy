-- تتبّع إرسال الفاتورة للمريض + تعديل وصف الفاتورة
alter table invoices add column if not exists sent_at timestamptz;

create or replace function mark_invoice_sent(p_invoice uuid) returns void
language plpgsql security definer set search_path = public as $$
declare inv invoices;
begin
  perform require_perm('invoices', 'view');
  select * into inv from invoices where id = p_invoice;
  if inv.id is null or not can_see_patient(inv.patient_id) then raise exception 'الفاتورة غير موجودة'; end if;
  update invoices set sent_at = now() where id = p_invoice;
  perform log_action('إرسال الفاتورة ' || inv.no || ' للمريض عبر واتساب', inv.patient_id);
end $$;

create or replace function set_invoice_name(p_invoice uuid, p_name text) returns void
language plpgsql security definer set search_path = public as $$
declare inv invoices; v text := trim(coalesce(p_name, ''));
begin
  perform require_perm('invoices', 'edit');
  if v = '' then raise exception 'وصف الفاتورة مطلوب'; end if;
  select * into inv from invoices where id = p_invoice for update;
  if inv.id is null then raise exception 'الفاتورة غير موجودة'; end if;
  if inv.status = 'cancelled' then raise exception 'الفاتورة ملغاة'; end if;
  update invoices set service_name = left(v, 300) where id = p_invoice;
  update invoice_items set description = left(v, 300) where invoice_id = p_invoice
    and (select count(*) from invoice_items where invoice_id = p_invoice) = 1;
  perform log_action('تعديل وصف الفاتورة ' || inv.no, inv.patient_id);
end $$;

revoke execute on function mark_invoice_sent(uuid), set_invoice_name(uuid, text) from public, anon;
grant execute on function mark_invoice_sent(uuid), set_invoice_name(uuid, text) to authenticated;
