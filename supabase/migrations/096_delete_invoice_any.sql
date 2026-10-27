-- حذف فاتورة: مسموح لصلاحية invoices:delete حتى لو عليها دفعات (الدفعات بتتحذف معاها).
-- الممنوع بس: فاتورة اتبعتت/اتوقّعت لهيئة الزكاة (لازم إشعار دائن بدل الحذف).
create or replace function delete_invoice(p_invoice uuid) returns void
language plpgsql security definer set search_path = public as $$
declare inv invoices; n_pay int;
begin
  perform require_perm('invoices', 'delete');
  select * into inv from invoices where id = p_invoice for update;
  if inv.id is null then raise exception 'الفاتورة غير موجودة'; end if;
  if exists (select 1 from zatca_documents where invoice_id = p_invoice and status <> 'awaiting') then
    raise exception 'الفاتورة % اتبعتت لهيئة الزكاة — لا يمكن حذفها (ألغِها ليصدر إشعار دائن)', inv.no;
  end if;
  delete from zatca_documents where invoice_id = p_invoice;
  select count(*) into n_pay from payments where invoice_id = p_invoice;
  if inv.discount_code_id is not null then update discount_codes set used_count = greatest(used_count - 1, 0) where id = inv.discount_code_id; end if;
  delete from invoices where id = p_invoice; -- الدفعات وبنود الفاتورة وطلبات التقسيط بتتحذف تلقائيًا (cascade)
  perform log_action('حذف الفاتورة ' || inv.no || case when n_pay > 0 then ' مع ' || n_pay || ' دفعة' else '' end, inv.patient_id);
end $$;
revoke all on function delete_invoice(uuid) from public, anon;
grant execute on function delete_invoice(uuid) to authenticated;
