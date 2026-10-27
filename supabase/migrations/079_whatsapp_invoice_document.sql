-- إرسال ملف الفاتورة PDF كمستند (Document) عبر WhatsApp Business Cloud API — من الخادم (Edge Function "whatsapp") مش من المتصفح.
-- بيستخدم جدول whatsapp_messages الموجود (019) كسجل واحد للإرسال: pending → sent | failed.

alter table whatsapp_messages
  add column if not exists invoice_id uuid references invoices(id) on delete set null,
  add column if not exists channel text not null default 'whatsapp',
  add column if not exists file_name text,
  add column if not exists media_id text,
  add column if not exists provider text,
  add column if not exists sent_by uuid;

create index if not exists idx_whatsapp_messages_invoice on whatsapp_messages (invoice_id, created_at desc);
-- عملية إرسال واحدة جارية لكل فاتورة: الضغط المتكرر أو طلبين في نفس اللحظة مايعملوش رسالتين
create unique index if not exists uq_whatsapp_invoice_pending on whatsapp_messages (invoice_id) where status = 'pending' and invoice_id is not null;

-- سياق الإرسال بصلاحيات المستخدم نفسه (بتتنادى من الدالة بتوكنه): الفاتورة موجودة + المستخدم يشوفها + مريضها ظاهر له.
-- رقم الجوال بييجي من قاعدة البيانات هنا، مش من الواجهة.
create or replace function whatsapp_invoice_context(p_invoice uuid) returns jsonb
language plpgsql stable security definer set search_path = public as $$
declare inv invoices; pat patients;
begin
  perform require_perm('invoices', 'view');
  select * into inv from invoices where id = p_invoice;
  if inv.id is null or not can_see_patient(inv.patient_id) then raise exception 'لا توجد فاتورة لإرسالها.'; end if;
  if inv.status = 'cancelled' then raise exception 'الفاتورة ملغاة — لا يمكن إرسالها.'; end if;
  if inv.status = 'draft' then raise exception 'الفاتورة لسه مسودة — اعتمدها أولًا.'; end if;
  select * into pat from patients where id = inv.patient_id;
  return jsonb_build_object('invoiceId', inv.id, 'invoiceNo', inv.no, 'patientId', pat.id, 'patientName', pat.full_name, 'phone', coalesce(pat.phone, ''),
    'centerName', coalesce((select name from center_info limit 1), ''));
end $$;
revoke execute on function whatsapp_invoice_context(uuid) from public, anon;
grant execute on function whatsapp_invoice_context(uuid) to authenticated;
