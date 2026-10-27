-- الفوترة الإلكترونية — المرحلة الثانية (الربط مع منصة «فاتورة» التابعة لهيئة الزكاة والضريبة والجمارك)
-- 1) zatca_config: إعدادات الربط + المفتاح الخاص + شهادات الهيئة + سلسلة الفواتير (ICV/PIH). بدون أي سياسة RLS
--    = لا يقرأها ولا يكتبها غير service_role (Edge Function "zatca"). الواجهة بتشوف ملخص آمن بس عبر zatca_overview().
-- 2) zatca_documents: كل مستند اتبعت/هيتبعت للهيئة (فاتورة / إشعار دائن)، بالـ XML الموقّع ورد الهيئة.
-- 3) قفل الفاتورة بعد توقيعها: ممنوع تعديل المبالغ/البنود، والإلغاء بيولّد إشعار دائن تلقائيًا.

create table if not exists zatca_config (
  id int primary key default 1 check (id = 1),
  environment text not null default 'sandbox' check (environment in ('sandbox','simulation','production')),
  status text not null default 'not_configured' check (status in ('not_configured','ready')),
  auto_submit boolean not null default true,
  egs_serial text,
  private_key text,
  csr text,
  compliance_token text, compliance_secret text, compliance_request_id text,
  production_token text, production_secret text,
  cert_expires_at timestamptz,
  icv bigint not null default 0,
  last_hash text not null default 'NWZlY2ViNjZmZmM4NmYzOGQ5NTI3ODZjNmQ2OTZjNzljMmRiYzIzOWRkNGU5MWI0NjcyOWQ3M2EyN2ZiNTdlOQ==',
  lease_until timestamptz,
  last_error text,
  onboarded_at timestamptz,
  onboarded_by uuid references employees(id) on delete set null
);
insert into zatca_config (id) values (1) on conflict (id) do nothing;
alter table zatca_config enable row level security;
revoke all on zatca_config from anon, authenticated;

create table if not exists zatca_documents (
  id uuid primary key default gen_random_uuid(),
  invoice_id uuid not null references invoices(id) on delete restrict,
  kind text not null check (kind in ('invoice','credit')),
  doc_no text not null,
  uuid uuid not null default gen_random_uuid(),
  reason text not null default '',
  status text not null default 'pending' check (status in ('pending','reported','warning','rejected','error')),
  environment text,
  icv bigint, hash text, qr text, xml text, issued_at timestamptz,
  warnings jsonb not null default '[]'::jsonb,
  errors jsonb not null default '[]'::jsonb,
  attempts int not null default 0,
  created_at timestamptz not null default now(),
  submitted_at timestamptz,
  created_by uuid references employees(id) on delete set null
);
create unique index if not exists uq_zatca_doc_kind on zatca_documents(invoice_id, kind);
create index if not exists idx_zatca_docs_status on zatca_documents(status, created_at);
alter table zatca_documents enable row level security;
drop policy if exists staff_read on zatca_documents;
create policy staff_read on zatca_documents for select using (has_perm('invoices','view'));
revoke insert, update, delete on zatca_documents from anon, authenticated;

alter table invoices add column if not exists zatca_status text;   -- null = لم تُرسل | pending | reported | warning | rejected | error
alter table invoices add column if not exists zatca_qr text;        -- رمز QR المرحلة الثانية (بالتوقيع) للطباعة

-- هل الفاتورة «صدرت» للهيئة (اتوقّعت ودخلت السلسلة)؟ بعدها أي تعديل في المبالغ لازم يكون بإشعار دائن
create or replace function zatca_invoice_locked(p_invoice uuid) returns boolean
language sql stable security definer set search_path = public as $$
  select exists (select 1 from zatca_documents where invoice_id = p_invoice and kind = 'invoice' and xml is not null and status <> 'rejected');
$$;

create or replace function zatca_guard_invoice() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if tg_op = 'DELETE' then
    if exists (select 1 from zatca_documents where invoice_id = old.id and xml is not null) then
      raise exception 'لا يمكن حذف فاتورة أُرسلت لهيئة الزكاة — يجب الاحتفاظ بها نظامًا';
    end if;
    delete from zatca_documents where invoice_id = old.id and xml is null;
    return old;
  end if;
  if zatca_invoice_locked(old.id) and (
       new.price is distinct from old.price or new.discount is distinct from old.discount or new.tax_rate is distinct from old.tax_rate
    or new.tax_amount is distinct from old.tax_amount or new.total is distinct from old.total or new.patient_id is distinct from old.patient_id
    or new.date is distinct from old.date or new.service_name is distinct from old.service_name
    or (old.status <> 'cancelled' and new.status = 'draft')) then
    raise exception 'الفاتورة % مُبلّغة لهيئة الزكاة ولا يمكن تعديل مبالغها أو بنودها — ألغِها (يصدر إشعار دائن تلقائيًا) وأصدر فاتورة جديدة', old.no;
  end if;
  return new;
end $$;
drop trigger if exists trg_zatca_guard_invoice on invoices;
create trigger trg_zatca_guard_invoice before update or delete on invoices for each row execute function zatca_guard_invoice();

create or replace function zatca_guard_items() returns trigger
language plpgsql security definer set search_path = public as $$
declare v uuid := coalesce(new.invoice_id, old.invoice_id);
begin
  if zatca_invoice_locked(v) then
    raise exception 'الفاتورة مُبلّغة لهيئة الزكاة ولا يمكن تعديل بنودها — ألغِها وأصدر فاتورة جديدة';
  end if;
  return coalesce(new, old);
end $$;
drop trigger if exists trg_zatca_guard_items on invoice_items;
create trigger trg_zatca_guard_items before insert or update or delete on invoice_items for each row execute function zatca_guard_items();

-- عند إلغاء فاتورة: لو كانت اتبلّغت → إشعار دائن بكامل المبلغ في الطابور. لو لسه ما اتوقّعتش → تتشال من الطابور.
create or replace function zatca_on_cancel() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if new.status = 'cancelled' and old.status <> 'cancelled' then
    if zatca_invoice_locked(new.id) then
      insert into zatca_documents (invoice_id, kind, doc_no, reason, created_by)
      values (new.id, 'credit', 'CN-' || new.no, 'إلغاء الفاتورة ' || new.no, my_employee_id())
      on conflict (invoice_id, kind) do nothing;
      update invoices set zatca_status = 'pending' where id = new.id;
    else
      delete from zatca_documents where invoice_id = new.id and kind = 'invoice' and xml is null;
      update invoices set zatca_status = null where id = new.id and zatca_status is not null;
    end if;
  end if;
  return new;
end $$;
drop trigger if exists trg_zatca_on_cancel on invoices;
create trigger trg_zatca_on_cancel after update of status on invoices for each row execute function zatca_on_cancel();

-- يضيف للطابور الفواتير المستحقة الإرسال:
--   p_invoice = فاتورة بعينها (زر «إرسال للهيئة الآن»، أو إعادة إرسال مرفوضة بعد تصحيحها)
--   بدونها = كل فاتورة صادرة (غير مسودة/ملغاة) بعد تاريخ التفعيل، اتدفع منها أي مبلغ أو اتبعتت للمريض أو عدّى عليها 20 ساعة
--   (الهيئة بتطلب إرسال الفاتورة المبسّطة خلال 24 ساعة من إصدارها).
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
    if inv.status in ('draft','cancelled') then raise exception 'لا يمكن إرسال فاتورة مسودة أو ملغاة للهيئة'; end if;
    -- المرفوضة: تُعاد كمستند جديد (UUID + ICV جديدين) بعد التصحيح
    update zatca_documents set status = 'pending', xml = null, hash = null, qr = null, icv = null, uuid = gen_random_uuid(), errors = '[]', warnings = '[]', attempts = 0
      where invoice_id = inv.id and status = 'rejected';
    update zatca_documents set status = 'pending', attempts = 0 where invoice_id = inv.id and status = 'error';
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

-- حفظ المستند الموقّع + تقديم السلسلة (ICV/PIH) في عملية واحدة — عشان السلسلة ما تتكسرش لو الدالة وقعت في النص
create or replace function zatca_commit_signed(p_doc uuid, p_uuid uuid, p_icv bigint, p_hash text, p_qr text, p_xml text, p_issued timestamptz) returns void
language plpgsql security definer set search_path = public as $$
declare cfg zatca_config;
begin
  select * into cfg from zatca_config where id = 1 for update;
  if p_icv <> cfg.icv + 1 then raise exception 'تعارض في تسلسل الفواتير (ICV) — أعد المحاولة'; end if;
  update zatca_documents set uuid = p_uuid, icv = p_icv, hash = p_hash, qr = p_qr, xml = p_xml, issued_at = p_issued, environment = cfg.environment where id = p_doc and xml is null;
  if not found then raise exception 'المستند موقّع بالفعل'; end if;
  update zatca_config set icv = p_icv, last_hash = p_hash where id = 1;
end $$;

-- ملخص آمن لصفحة الإعدادات (بدون أي مفاتيح أو أسرار)
create or replace function zatca_overview() returns jsonb
language plpgsql stable security definer set search_path = public as $$
declare cfg zatca_config;
begin
  perform require_perm('invoices', 'view');
  select * into cfg from zatca_config where id = 1;
  return jsonb_build_object(
    'environment', cfg.environment, 'status', cfg.status, 'autoSubmit', cfg.auto_submit,
    'certExpiresAt', cfg.cert_expires_at, 'onboardedAt', cfg.onboarded_at, 'icv', cfg.icv, 'lastError', cfg.last_error,
    'pending', (select count(*) from zatca_documents where status in ('pending','error')),
    'rejected', (select count(*) from zatca_documents where status = 'rejected'),
    'reported', (select count(*) from zatca_documents where status in ('reported','warning')));
end $$;

create or replace function zatca_set_auto(p_on boolean) returns void
language plpgsql security definer set search_path = public as $$
begin
  perform require_perm('settings', 'edit');
  update zatca_config set auto_submit = coalesce(p_on, true) where id = 1;
  perform log_action(case when p_on then 'تفعيل' else 'إيقاف' end || ' الإرسال التلقائي للفواتير لهيئة الزكاة');
end $$;

revoke execute on function zatca_commit_signed(uuid, uuid, bigint, text, text, text, timestamptz) from public, anon, authenticated;
grant execute on function zatca_commit_signed(uuid, uuid, bigint, text, text, text, timestamptz) to service_role;
revoke execute on function zatca_enqueue(uuid), zatca_overview(), zatca_set_auto(boolean), zatca_invoice_locked(uuid) from public, anon;
grant execute on function zatca_enqueue(uuid), zatca_overview(), zatca_set_auto(boolean) to authenticated, service_role;
grant execute on function zatca_invoice_locked(uuid) to authenticated, service_role;
