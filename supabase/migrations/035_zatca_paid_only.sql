-- قسم «الفوترة الإلكترونية»: «بانتظار الإرسال» = الفواتير المدفوعة بالكامل بس (طلب المستخدم 2026-09-26).
-- الفاتورة اللي عليها متبقي (due/partial) مايتسمحش بإرسالها للهيئة لحد ما تتسدد — إلا لو كانت اتبعتت قبل كده (إعادة محاولة/مرفوضة).
create or replace function zatca_enqueue(p_invoice uuid default null) returns int
language plpgsql security definer set search_path = public as $$
declare cfg zatca_config; inv invoices;
begin
  select * into cfg from zatca_config where id = 1;
  if cfg.status <> 'ready' then raise exception 'الربط مع هيئة الزكاة غير مفعّل — فعّله من الإعدادات'; end if;
  if p_invoice is null then return 0; end if;
  if auth.role() <> 'service_role' then perform require_perm('invoices', 'edit'); end if;
  select * into inv from invoices where id = p_invoice;
  if inv.id is null then raise exception 'الفاتورة غير موجودة'; end if;
  if inv.status = 'draft' then raise exception 'الفاتورة % مسودة — اعتمدها أولًا', inv.no; end if;
  if inv.status in ('due','partial') and not exists (select 1 from zatca_documents where invoice_id = inv.id) then
    raise exception 'الفاتورة % لسه مش مدفوعة بالكامل — الإرسال للهيئة للفواتير المدفوعة بالكامل بس', inv.no;
  end if;
  -- المرفوضة: تُعاد كمستند جديد (UUID + ICV جديدين) بعد التصحيح
  update zatca_documents set status = 'pending', xml = null, hash = null, qr = null, icv = null, uuid = gen_random_uuid(), errors = '[]', warnings = '[]', attempts = 0
    where invoice_id = inv.id and status = 'rejected';
  update zatca_documents set status = 'pending', attempts = 0 where invoice_id = inv.id and status in ('error','awaiting');
  if inv.status = 'cancelled' then
    if not exists (select 1 from zatca_documents where invoice_id = inv.id) then raise exception 'الفاتورة % ملغاة قبل إرسالها — لا يوجد ما يُرسل للهيئة', inv.no; end if;
  else
    insert into zatca_documents (invoice_id, kind, doc_no, created_by) values (inv.id, 'invoice', inv.no, my_employee_id())
      on conflict (invoice_id, kind) do nothing;
  end if;
  update invoices set zatca_status = 'pending' where id = inv.id and coalesce(zatca_status, '') not in ('reported','warning','credited');
  perform log_action('تأكيد إرسال ' || inv.no || ' لهيئة الزكاة', inv.patient_id);
  return 1;
end $$;

create or replace function zatca_overview() returns jsonb
language plpgsql stable security definer set search_path = public as $$
declare cfg zatca_config;
begin
  perform require_perm('invoices', 'view');
  select * into cfg from zatca_config where id = 1;
  return jsonb_build_object(
    'environment', cfg.environment, 'status', cfg.status, 'autoSubmit', false,
    'certExpiresAt', cfg.cert_expires_at, 'onboardedAt', cfg.onboarded_at, 'icv', cfg.icv, 'lastError', cfg.last_error,
    'awaiting', (select count(*) from invoices i where i.status = 'paid' and i.zatca_status is null)
              + (select count(*) from zatca_documents where status = 'awaiting'),
    'pending', (select count(*) from zatca_documents where status in ('pending','error')),
    'rejected', (select count(*) from zatca_documents where status = 'rejected'),
    'reported', (select count(*) from zatca_documents where status in ('reported','warning')));
end $$;

