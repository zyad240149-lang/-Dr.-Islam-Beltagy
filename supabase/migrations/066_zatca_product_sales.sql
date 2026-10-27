-- فواتير بيع المنتجات في «الفوترة الإلكترونية»: نفس طابور zatca_documents ونفس السلسلة (ICV/PIH)،
-- الإرسال بالتأكيد اليدوي بس، والإلغاء بعد التوقيع بيولّد إشعار دائن بانتظار التأكيد.
alter table zatca_documents alter column invoice_id drop not null;
alter table zatca_documents add column if not exists product_sale_id uuid references product_sales(id) on delete restrict;
alter table zatca_documents drop constraint if exists zatca_documents_one_source;
alter table zatca_documents add constraint zatca_documents_one_source check ((invoice_id is null) <> (product_sale_id is null));
create unique index if not exists uq_zatca_doc_sale_kind on zatca_documents(product_sale_id, kind) where product_sale_id is not null;
create index if not exists zatca_documents_product_sale_idx on zatca_documents(product_sale_id);
alter table zatca_documents drop constraint if exists zatca_documents_status_check;
alter table zatca_documents add constraint zatca_documents_status_check check (status in ('pending','awaiting','reported','warning','rejected','error'));

alter table product_sales add column if not exists zatca_status text;
alter table product_sales add column if not exists zatca_qr text;

-- تأكيد إرسال فاتورة بيع منتج (أو إشعارها الدائن)
create or replace function zatca_enqueue_sale(p_sale uuid) returns int
language plpgsql security definer set search_path = public as $$
declare cfg zatca_config; s product_sales;
begin
  select * into cfg from zatca_config where id = 1;
  if cfg.status <> 'ready' then raise exception 'الربط مع هيئة الزكاة غير مفعّل — فعّله من الإعدادات'; end if;
  if auth.role() <> 'service_role' then perform require_perm('invoices', 'edit'); end if;
  select * into s from product_sales where id = p_sale;
  if s.id is null then raise exception 'فاتورة البيع غير موجودة'; end if;
  update zatca_documents set status = 'pending', xml = null, hash = null, qr = null, icv = null, uuid = gen_random_uuid(), errors = '[]', warnings = '[]', attempts = 0
    where product_sale_id = s.id and status = 'rejected';
  update zatca_documents set status = 'pending', attempts = 0 where product_sale_id = s.id and status in ('error','awaiting');
  if s.status = 'cancelled' then
    if not exists (select 1 from zatca_documents where product_sale_id = s.id) then raise exception 'الفاتورة % ملغاة قبل إرسالها — لا يوجد ما يُرسل للهيئة', s.invoice_no; end if;
  else
    insert into zatca_documents (product_sale_id, kind, doc_no, created_by) values (s.id, 'invoice', s.invoice_no, my_employee_id())
      on conflict (product_sale_id, kind) where product_sale_id is not null do nothing;
  end if;
  update product_sales set zatca_status = 'pending' where id = s.id and coalesce(zatca_status, '') not in ('reported','warning','credited');
  perform log_action('تأكيد إرسال ' || s.invoice_no || ' لهيئة الزكاة', s.patient_id);
  return 1;
end $$;
revoke execute on function zatca_enqueue_sale(uuid) from public, anon;
grant execute on function zatca_enqueue_sale(uuid) to authenticated, service_role;

-- إلغاء فاتورة بيع: لو اتوقّعت = إشعار دائن بانتظار التأكيد، لو لسه = تتشال من الطابور
create or replace function zatca_on_sale_cancel() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if new.status = 'cancelled' and old.status <> 'cancelled' then
    if exists (select 1 from zatca_documents where product_sale_id = new.id and kind = 'invoice' and xml is not null) then
      insert into zatca_documents (product_sale_id, kind, doc_no, reason, status, created_by)
      values (new.id, 'credit', 'CN-' || new.invoice_no, 'إلغاء الفاتورة ' || new.invoice_no, 'awaiting', my_employee_id())
      on conflict (product_sale_id, kind) where product_sale_id is not null do nothing;
      update product_sales set zatca_status = 'awaiting' where id = new.id;
    else
      delete from zatca_documents where product_sale_id = new.id and kind = 'invoice' and xml is null;
      update product_sales set zatca_status = null where id = new.id and zatca_status is not null;
    end if;
  end if;
  return new;
end $$;
drop trigger if exists trg_zatca_on_sale_cancel on product_sales;
create trigger trg_zatca_on_sale_cancel after update of status on product_sales for each row execute function zatca_on_sale_cancel();

-- عدّادات القسم بتشمل فواتير البيع
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
              + (select count(*) from product_sales s where s.status = 'completed' and s.zatca_status is null)
              + (select count(*) from zatca_documents where status = 'awaiting'),
    'pending', (select count(*) from zatca_documents where status in ('pending','error')),
    'rejected', (select count(*) from zatca_documents where status = 'rejected'),
    'reported', (select count(*) from zatca_documents where status in ('reported','warning')));
end $$;
