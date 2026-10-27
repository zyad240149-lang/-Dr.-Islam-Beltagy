-- «تم فتح مشاركة الفاتورة» — سجل نشاط فقط. بدون API مفيش تأكيد إن واتساب أرسل فعلًا، فمابنوسمش الفاتورة «مُرسلة» (sent_at) من هنا.
create or replace function log_invoice_share(p_invoice uuid, p_method text default 'share') returns void
language plpgsql security definer set search_path = public as $$
declare inv invoices;
begin
  perform require_perm('invoices', 'view');
  select * into inv from invoices where id = p_invoice;
  if inv.id is null or not can_see_patient(inv.patient_id) then raise exception 'الفاتورة غير موجودة'; end if;
  perform log_action('تم فتح مشاركة الفاتورة ' || inv.no || case when p_method = 'share' then ' (مشاركة الجهاز)' else ' (تنزيل + فتح واتساب)' end, inv.patient_id);
end $$;
revoke execute on function log_invoice_share(uuid, text) from public, anon;
grant execute on function log_invoice_share(uuid, text) to authenticated;
