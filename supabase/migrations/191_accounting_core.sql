-- ===================================================================
-- النظام المحاسبي (2026-10-24) — الأساس: دليل الحسابات + القيد المزدوج + الفترات + الخزائن + سجل التدقيق
-- مبدأ: القيود المرحّلة لا تُعدَّل ولا تُحذف (تريجر على القاعدة نفسها) — التصحيح بقيد عكسي فقط.
-- كل الكتابة RPC فقط (SECURITY DEFINER + require_perm). الجداول مقروءة بـ RLS لصلاحية accounting.access.
-- للتراجع الكامل: admin/supabase/accounting_down.sql
-- ===================================================================

-- ---------- 1) دليل الحسابات ----------
create table if not exists acc_accounts (
  id uuid primary key default gen_random_uuid(),
  code text not null unique,
  name text not null,
  name_en text,
  type text not null check (type in ('asset', 'liability', 'equity', 'revenue', 'expense')),
  parent_id uuid references acc_accounts(id) on delete restrict,
  postable boolean not null default true,
  system_key text unique,
  active boolean not null default true,
  created_at timestamptz not null default now()
);
create index if not exists idx_acc_accounts_parent on acc_accounts (parent_id);

-- ---------- 2) الفترات (الصف يوجد فقط للشهر المقفول/المعاد فتحه) ----------
create table if not exists acc_periods (
  month text primary key check (month ~ '^[0-9]{4}-(0[1-9]|1[0-2])$'),
  status text not null default 'closed' check (status in ('open', 'closed')),
  closed_at timestamptz, closed_by uuid references employees(id) on delete set null,
  reopened_at timestamptz, reopened_by uuid references employees(id) on delete set null,
  note text not null default ''
);
create index if not exists idx_acc_periods_closed_by on acc_periods (closed_by);
create index if not exists idx_acc_periods_reopened_by on acc_periods (reopened_by);

create or replace function acc_period_closed(d date) returns boolean
language sql stable security definer set search_path = public as $$
  select exists (select 1 from acc_periods where month = to_char(d, 'YYYY-MM') and status = 'closed')
$$;

-- ---------- 3) مراكز التكلفة ----------
create table if not exists acc_cost_centers (
  id uuid primary key default gen_random_uuid(),
  code text not null unique, name text not null, active boolean not null default true,
  created_at timestamptz not null default now()
);

-- ---------- 4) القيود ----------
create sequence if not exists acc_journal_seq;
create table if not exists acc_journals (
  id uuid primary key default gen_random_uuid(),
  no text not null unique default ('JV-' || lpad(nextval('acc_journal_seq')::text, 6, '0')),
  entry_date date not null,
  posted_at timestamptz,
  description text not null default '',
  status text not null default 'draft' check (status in ('draft', 'posted')),
  source_type text not null default 'manual',
  source_id uuid,
  source_event text not null default 'v1',
  source_no text,
  fingerprint text,
  currency text not null default 'SAR',
  total numeric(14,2) not null default 0,
  reversal_of uuid references acc_journals(id) on delete restrict,
  reversed_by uuid references acc_journals(id) on delete restrict,
  idem_key text unique,
  attachment_path text,
  created_by uuid references employees(id) on delete set null,
  approved_by uuid references employees(id) on delete set null,
  posted_by uuid references employees(id) on delete set null,
  created_at timestamptz not null default now()
);
-- مفتاح منع التكرار: نفس المستند + نفس الحدث = قيد واحد فقط مهما أُعيد الطلب
create unique index if not exists acc_journals_source_uq on acc_journals (source_type, source_id, source_event) where source_id is not null;
create index if not exists idx_acc_journals_date on acc_journals (entry_date);
create index if not exists idx_acc_journals_source on acc_journals (source_type, source_id);
create index if not exists idx_acc_journals_status on acc_journals (status);
create index if not exists idx_acc_journals_reversal_of on acc_journals (reversal_of);
create index if not exists idx_acc_journals_reversed_by on acc_journals (reversed_by);
create index if not exists idx_acc_journals_created_by on acc_journals (created_by);
create index if not exists idx_acc_journals_approved_by on acc_journals (approved_by);
create index if not exists idx_acc_journals_posted_by on acc_journals (posted_by);

create table if not exists acc_journal_lines (
  id uuid primary key default gen_random_uuid(),
  journal_id uuid not null references acc_journals(id) on delete cascade,
  line_no int not null default 1,
  account_id uuid not null references acc_accounts(id) on delete restrict,
  debit numeric(14,2) not null default 0 check (debit >= 0),
  credit numeric(14,2) not null default 0 check (credit >= 0),
  memo text,
  cost_center_id uuid references acc_cost_centers(id) on delete set null,
  party_type text,
  party_id uuid,
  treasury_id uuid,
  therapist_id uuid,
  service_name text,
  reconciled_at timestamptz,
  constraint acc_line_one_side check (debit = 0 or credit = 0),
  constraint acc_line_nonzero check (debit + credit > 0)
);
create index if not exists idx_acc_lines_journal on acc_journal_lines (journal_id);
create index if not exists idx_acc_lines_account on acc_journal_lines (account_id);
create index if not exists idx_acc_lines_cc on acc_journal_lines (cost_center_id);
create index if not exists idx_acc_lines_party on acc_journal_lines (party_type, party_id);
create index if not exists idx_acc_lines_treasury on acc_journal_lines (treasury_id);

-- ---------- 5) سجل الأخطاء وسجل التدقيق ----------
create table if not exists acc_posting_errors (
  id uuid primary key default gen_random_uuid(),
  source_type text not null, source_id uuid not null,
  message text not null, attempts int not null default 1,
  first_at timestamptz not null default now(), last_at timestamptz not null default now(),
  resolved_at timestamptz
);
create unique index if not exists acc_posting_errors_open_uq on acc_posting_errors (source_type, source_id) where resolved_at is null;

create table if not exists acc_audit (
  id bigint generated always as identity primary key,
  at timestamptz not null default now(),
  employee_id uuid references employees(id) on delete set null,
  action text not null, entity text not null, entity_id text, detail jsonb not null default '{}'::jsonb
);
create index if not exists idx_acc_audit_at on acc_audit (at desc);
create index if not exists idx_acc_audit_emp on acc_audit (employee_id);

create or replace function acc_audit_log(p_action text, p_entity text, p_id text default null, p_detail jsonb default '{}'::jsonb) returns void
language sql security definer set search_path = public as $$
  insert into acc_audit (employee_id, action, entity, entity_id, detail) values (my_employee_id(), p_action, p_entity, p_id, coalesce(p_detail, '{}'::jsonb))
$$;

create or replace function acc_audit_immutable() returns trigger language plpgsql as $$
begin raise exception 'سجل التدقيق لا يُعدَّل ولا يُحذف'; end $$;
drop trigger if exists trg_acc_audit_immutable on acc_audit;
create trigger trg_acc_audit_immutable before update or delete on acc_audit for each row execute function acc_audit_immutable();

-- ---------- 6) الصلاحيات ----------
create or replace function acc_require(p text default 'access') returns uuid
language plpgsql stable security definer set search_path = public as $$
declare v uuid;
begin
  v := require_perm('accounting.access', 'view');
  if p <> 'access' then perform require_perm('accounting.' || p, 'view'); end if;
  return v;
end $$;

-- سطور الرواتب لا يراها إلا من عنده accounting.payroll.view
create or replace function acc_can_see_source(p_type text) returns boolean
language sql stable security definer set search_path = public as $$
  select case when p_type in ('payroll_due', 'payroll_payout', 'advance', 'advance_recovery')
    then has_perm('accounting.payroll.view', 'view') else true end
$$;

-- ---------- 7) تحويل مفتاح الحساب → id ----------
create or replace function acc_account_id(p text) returns uuid
language plpgsql stable security definer set search_path = public as $$
declare v uuid;
begin
  if p ~* '^[0-9a-f]{8}-[0-9a-f]{4}-' then return p::uuid; end if;
  select id into v from acc_accounts where system_key = p;
  if v is null then select id into v from acc_accounts where code = p; end if;
  if v is null then raise exception 'حساب غير معرّف في دليل الحسابات: %', p; end if;
  return v;
end $$;

-- ---------- 8) تريجرات حماية القيود ----------
create or replace function acc_journal_guard() returns trigger language plpgsql security definer set search_path = public as $$
declare dr numeric; cr numeric; n int; bad int;
begin
  if tg_op = 'INSERT' then
    new.status := 'draft'; new.posted_at := null; new.reversed_by := null;
    if new.created_by is null then new.created_by := my_employee_id(); end if;
    return new;
  end if;
  if tg_op = 'DELETE' then
    if old.status = 'posted' then raise exception 'لا يمكن حذف قيد مرحّل — استخدم قيدًا عكسيًا'; end if;
    return old;
  end if;
  -- UPDATE
  if old.status = 'posted' then
    if old.reversed_by is null and new.reversed_by is not null
       and (to_jsonb(new) - 'reversed_by') = (to_jsonb(old) - 'reversed_by') then return new; end if;
    raise exception 'القيد المرحّل لا يمكن تعديله — استخدم قيدًا عكسيًا أو قيد تسوية';
  end if;
  if new.status = 'posted' then
    select coalesce(sum(debit), 0), coalesce(sum(credit), 0), count(*) into dr, cr, n from acc_journal_lines where journal_id = new.id;
    if n < 2 then raise exception 'القيد يحتاج سطرين على الأقل'; end if;
    if dr <> cr then raise exception 'القيد غير متوازن: المدين % لا يساوي الدائن %', dr, cr; end if;
    if dr <= 0 then raise exception 'قيمة القيد يجب أن تكون أكبر من صفر'; end if;
    select count(*) into bad from acc_journal_lines l join acc_accounts a on a.id = l.account_id where l.journal_id = new.id and (not a.postable or not a.active);
    if bad > 0 then raise exception 'القيد يحتوي حسابًا رئيسيًا أو موقوفًا لا يُرحَّل عليه'; end if;
    if acc_period_closed(new.entry_date) then raise exception 'الفترة المحاسبية % مقفلة', to_char(new.entry_date, 'YYYY-MM'); end if;
    new.posted_at := now(); new.total := dr; new.posted_by := coalesce(new.posted_by, my_employee_id());
  end if;
  return new;
end $$;
drop trigger if exists trg_acc_journal_guard on acc_journals;
create trigger trg_acc_journal_guard before insert or update or delete on acc_journals for each row execute function acc_journal_guard();

create or replace function acc_line_guard() returns trigger language plpgsql security definer set search_path = public as $$
declare st text; jid uuid;
begin
  if tg_op = 'DELETE' then jid := old.journal_id; else jid := new.journal_id; end if;
  select status into st from acc_journals where id = jid;
  if st = 'posted' then
    if tg_op = 'UPDATE' then
      if (to_jsonb(new) - 'reconciled_at') = (to_jsonb(old) - 'reconciled_at') then return new; end if;
    end if;
    raise exception 'سطور القيد المرحّل لا تُعدَّل ولا تُحذف';
  end if;
  if tg_op = 'DELETE' then return old; end if;
  return new;
end $$;
drop trigger if exists trg_acc_line_guard on acc_journal_lines;
create trigger trg_acc_line_guard before insert or update or delete on acc_journal_lines for each row execute function acc_line_guard();

-- ---------- 9) إنشاء القيد (داخلي — يمنع التكرار بمفتاح المصدر) ----------
create or replace function acc_create_journal(
  p_date date, p_desc text, p_type text, p_source uuid, p_event text, p_source_no text, p_lines jsonb,
  p_post boolean default true, p_idem text default null, p_fp text default null, p_attachment text default null,
  p_reversal_of uuid default null, p_by uuid default null
) returns uuid
language plpgsql security definer set search_path = public as $$
declare j uuid; l jsonb; n int := 0; d numeric; c numeric;
begin
  if p_source is not null then
    insert into acc_journals (entry_date, description, source_type, source_id, source_event, source_no, fingerprint, attachment_path, reversal_of, created_by, idem_key)
    values (p_date, left(coalesce(p_desc, ''), 500), p_type, p_source, coalesce(p_event, 'v1'), p_source_no, p_fp, p_attachment, p_reversal_of, p_by, p_idem)
    on conflict (source_type, source_id, source_event) where source_id is not null do nothing
    returning id into j;
    if j is null then select id into j from acc_journals where source_type = p_type and source_id = p_source and source_event = coalesce(p_event, 'v1'); return j; end if;
  else
    if p_idem is not null then
      select id into j from acc_journals where idem_key = p_idem;
      if j is not null then return j; end if;
    end if;
    insert into acc_journals (entry_date, description, source_type, source_id, source_event, source_no, fingerprint, attachment_path, reversal_of, created_by, idem_key)
    values (p_date, left(coalesce(p_desc, ''), 500), p_type, null, coalesce(p_event, 'v1'), p_source_no, p_fp, p_attachment, p_reversal_of, p_by, p_idem)
    returning id into j;
  end if;
  for l in select * from jsonb_array_elements(coalesce(p_lines, '[]'::jsonb)) loop
    d := round(coalesce(nullif(l->>'debit', '')::numeric, 0), 2); c := round(coalesce(nullif(l->>'credit', '')::numeric, 0), 2);
    continue when d = 0 and c = 0;
    n := n + 1;
    insert into acc_journal_lines (journal_id, line_no, account_id, debit, credit, memo, cost_center_id, party_type, party_id, treasury_id, therapist_id, service_name)
    values (j, n, acc_account_id(l->>'account'), d, c, nullif(l->>'memo', ''), nullif(l->>'costCenter', '')::uuid, nullif(l->>'partyType', ''),
            nullif(l->>'partyId', '')::uuid, nullif(l->>'treasury', '')::uuid, nullif(l->>'therapist', '')::uuid, nullif(l->>'service', ''));
  end loop;
  if p_post then update acc_journals set status = 'posted' where id = j; end if;
  return j;
end $$;

-- ---------- 10) القيد العكسي (داخلي) ----------
create or replace function acc_reverse_journal(p_id uuid, p_reason text default null, p_date date default null) returns uuid
language plpgsql security definer set search_path = public as $$
declare o acc_journals; r uuid; d date;
begin
  select * into o from acc_journals where id = p_id for update;
  if o.id is null then raise exception 'القيد غير موجود'; end if;
  if o.status <> 'posted' then raise exception 'يمكن عكس القيود المرحّلة فقط'; end if;
  if o.reversed_by is not null then return o.reversed_by; end if;
  if o.reversal_of is not null then raise exception 'لا يمكن عكس قيد عكسي'; end if;
  d := coalesce(p_date, riyadh_today());
  if acc_period_closed(d) then raise exception 'الفترة المحاسبية % مقفلة — لا يمكن ترحيل عكس القيد فيها', to_char(d, 'YYYY-MM'); end if;
  r := acc_create_journal(d, 'عكس القيد ' || o.no || coalesce(' — ' || p_reason, ''), 'reversal', o.id, 'reverse', o.no,
    (select jsonb_agg(jsonb_build_object('account', account_id, 'debit', credit, 'credit', debit, 'memo', memo, 'costCenter', cost_center_id,
       'partyType', party_type, 'partyId', party_id, 'treasury', treasury_id, 'therapist', therapist_id, 'service', service_name) order by line_no)
     from acc_journal_lines where journal_id = o.id), true, null, null, null, o.id, my_employee_id());
  update acc_journals set reversed_by = r where id = o.id;
  return r;
end $$;

-- ---------- 11) تطبيق حالة مستند مصدر: «قيد نشط واحد لكل مستند» ----------
-- لو الحالة المطلوبة (البصمة) مطابقة للقيد النشط = لا شيء (إعادة الطلب آمنة). لو اختلفت = عكس القديم + قيد جديد. لو null = عكس فقط (إلغاء/حذف).
create or replace function acc_apply_source(p_type text, p_id uuid, p_date date, p_desc text, p_no text, p_lines jsonb) returns uuid
language plpgsql security definer set search_path = public as $$
declare act acc_journals; fp text; n int;
begin
  perform pg_advisory_xact_lock(hashtextextended(p_type || ':' || p_id::text, 0));
  select * into act from acc_journals where source_type = p_type and source_id = p_id and status = 'posted' and reversed_by is null
    order by created_at desc, no desc limit 1;
  if p_lines is not null and jsonb_array_length(p_lines) = 0 then p_lines := null; end if;
  fp := case when p_lines is null then null else md5(p_date::text || p_lines::text) end;
  if act.id is not null then
    if fp is not null and act.fingerprint = fp then return act.id; end if;
    perform acc_reverse_journal(act.id, 'تعديل المستند الأصلي أو إلغاؤه');
  end if;
  if p_lines is null then return null; end if;
  select count(*) + 1 into n from acc_journals where source_type = p_type and source_id = p_id;
  return acc_create_journal(p_date, p_desc, p_type, p_id, 'v' || n, p_no, p_lines, true, null, fp, null, null, my_employee_id());
end $$;

-- ---------- 12) الترحيل الآمن (التريجرات): الفشل يُسجَّل ولا يُعطّل العملية الأصلية ----------
create or replace function acc_try_post(p_type text, p_id uuid) returns void
language plpgsql security definer set search_path = public as $$
begin
  begin
    perform acc_post_source(p_type, p_id);
    update acc_posting_errors set resolved_at = now() where source_type = p_type and source_id = p_id and resolved_at is null;
  exception when others then
    insert into acc_posting_errors (source_type, source_id, message) values (p_type, p_id, left(sqlerrm, 500))
    on conflict (source_type, source_id) where resolved_at is null
    do update set message = excluded.message, attempts = acc_posting_errors.attempts + 1, last_at = now();
  end;
end $$;

-- ---------- 13) الخزائن والبنوك ----------
create table if not exists acc_treasuries (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  kind text not null check (kind in ('cash', 'bank')),
  account_id uuid not null unique references acc_accounts(id) on delete restrict,
  opening_balance numeric(14,2) not null default 0,
  opening_date date,
  active boolean not null default true,
  created_at timestamptz not null default now()
);
create table if not exists acc_method_map (
  method text primary key,
  treasury_id uuid not null references acc_treasuries(id) on delete restrict
);
create index if not exists idx_acc_method_map_t on acc_method_map (treasury_id);

create table if not exists acc_transfers (
  id uuid primary key default gen_random_uuid(),
  from_treasury uuid not null references acc_treasuries(id) on delete restrict,
  to_treasury uuid not null references acc_treasuries(id) on delete restrict,
  amount numeric(14,2) not null check (amount > 0),
  transfer_date date not null, note text not null default '',
  idem_key text unique, created_by uuid references employees(id) on delete set null,
  created_at timestamptz not null default now(), check (from_treasury <> to_treasury)
);
create index if not exists idx_acc_transfers_from on acc_transfers (from_treasury);
create index if not exists idx_acc_transfers_to on acc_transfers (to_treasury);
create index if not exists idx_acc_transfers_by on acc_transfers (created_by);

create table if not exists acc_cash_counts (
  id uuid primary key default gen_random_uuid(),
  treasury_id uuid not null references acc_treasuries(id) on delete restrict,
  count_date date not null,
  book_balance numeric(14,2) not null, counted numeric(14,2) not null, diff numeric(14,2) not null,
  note text not null default '', idem_key text unique,
  created_by uuid references employees(id) on delete set null, created_at timestamptz not null default now()
);
create index if not exists idx_acc_cash_counts_t on acc_cash_counts (treasury_id);
create index if not exists idx_acc_cash_counts_by on acc_cash_counts (created_by);

create or replace function acc_treasury_for_method(p_method text) returns acc_treasuries
language plpgsql stable security definer set search_path = public as $$
declare t acc_treasuries;
begin
  select tr.* into t from acc_method_map m join acc_treasuries tr on tr.id = m.treasury_id where m.method = p_method;
  if t.id is null then
    select tr.* into t from acc_treasuries tr join acc_accounts a on a.id = tr.account_id
    where a.system_key = case when p_method = 'cash' then 'cash' else 'bank' end;
  end if;
  if t.id is null then raise exception 'لا توجد خزنة/حساب بنكي مرتبط بطريقة الدفع %', p_method; end if;
  return t;
end $$;

-- ---------- 14) RLS: قراءة فقط لمن له accounting.access ----------
do $$ declare t text; begin
  foreach t in array array['acc_accounts', 'acc_periods', 'acc_cost_centers', 'acc_journals', 'acc_journal_lines', 'acc_posting_errors', 'acc_audit', 'acc_treasuries', 'acc_method_map', 'acc_transfers', 'acc_cash_counts'] loop
    execute format('alter table %I enable row level security', t);
    execute format('revoke all on %I from anon', t);
    execute format('revoke insert, update, delete, truncate on %I from authenticated', t);
  end loop;
end $$;

do $$ declare t text; begin
  foreach t in array array['acc_accounts', 'acc_periods', 'acc_cost_centers', 'acc_posting_errors', 'acc_treasuries', 'acc_method_map', 'acc_transfers', 'acc_cash_counts'] loop
    execute format('drop policy if exists acc_read on %I', t);
    execute format('create policy acc_read on %I for select using ((select has_perm(''accounting.access'', ''view'')))', t);
  end loop;
end $$;
drop policy if exists acc_read on acc_audit;
create policy acc_read on acc_audit for select using ((select has_perm('accounting.access', 'view')) and (select has_perm('accounting.reports.view', 'view')));
drop policy if exists acc_read on acc_journals;
create policy acc_read on acc_journals for select using ((select has_perm('accounting.access', 'view')) and (select acc_can_see_source(source_type)));
drop policy if exists acc_read on acc_journal_lines;
create policy acc_read on acc_journal_lines for select using (
  (select has_perm('accounting.access', 'view')) and exists (select 1 from acc_journals j where j.id = journal_id and acc_can_see_source(j.source_type)));

-- ---------- 15) دليل الحسابات الافتراضي ----------
insert into acc_accounts (code, name, name_en, type, parent_id, postable, system_key) values
  ('1000', 'الأصول', 'Assets', 'asset', null, false, null),
  ('1100', 'النقدية والبنوك', 'Cash & Banks', 'asset', null, false, null),
  ('1200', 'الذمم المدينة', 'Receivables', 'asset', null, false, null),
  ('1500', 'الأصول الثابتة', 'Fixed Assets', 'asset', null, false, null),
  ('2000', 'الخصوم', 'Liabilities', 'liability', null, false, null),
  ('3000', 'حقوق الملكية', 'Equity', 'equity', null, false, null),
  ('4000', 'الإيرادات', 'Revenue', 'revenue', null, false, null),
  ('5000', 'تكلفة المبيعات والمستهلكات', 'Cost of Sales', 'expense', null, false, null),
  ('6000', 'المصروفات التشغيلية والإدارية', 'Operating Expenses', 'expense', null, false, null)
on conflict (code) do nothing;

do $$
declare p_cash uuid := (select id from acc_accounts where code = '1100'); p_ar uuid := (select id from acc_accounts where code = '1200');
        p_fa uuid := (select id from acc_accounts where code = '1500'); p_liab uuid := (select id from acc_accounts where code = '2000');
        p_eq uuid := (select id from acc_accounts where code = '3000'); p_rev uuid := (select id from acc_accounts where code = '4000');
        p_cos uuid := (select id from acc_accounts where code = '5000'); p_op uuid := (select id from acc_accounts where code = '6000');
        p_assets uuid := (select id from acc_accounts where code = '1000');
begin
  update acc_accounts set parent_id = p_assets where code in ('1100', '1200', '1500') and parent_id is null;
  insert into acc_accounts (code, name, name_en, type, parent_id, postable, system_key) values
    ('1110', 'الصندوق الرئيسي', 'Main Cash', 'asset', p_cash, true, 'cash'),
    ('1120', 'الحساب البنكي', 'Bank Account', 'asset', p_cash, true, 'bank'),
    ('1210', 'ذمم المرضى (العملاء)', 'Patient Receivables', 'asset', p_ar, true, 'ar'),
    ('1220', 'سلف الموظفين', 'Staff Advances', 'asset', p_ar, true, 'staff_advances'),
    ('1300', 'المخزون', 'Inventory', 'asset', p_assets, true, 'inventory'),
    ('1400', 'ضريبة القيمة المضافة — مدخلات', 'Input VAT', 'asset', p_assets, true, 'vat_in'),
    ('1510', 'أصول ثابتة', 'Fixed Assets (Cost)', 'asset', p_fa, true, 'fixed_assets'),
    ('1590', 'مجمع الإهلاك', 'Accumulated Depreciation', 'asset', p_fa, true, 'accum_deprec'),
    ('2110', 'الموردون', 'Accounts Payable', 'liability', p_liab, true, 'ap'),
    ('2120', 'ضريبة القيمة المضافة — مخرجات', 'Output VAT', 'liability', p_liab, true, 'vat_out'),
    ('2130', 'رواتب مستحقة', 'Salaries Payable', 'liability', p_liab, true, 'salary_payable'),
    ('2140', 'عمولات ومكافآت مستحقة', 'Commissions Payable', 'liability', p_liab, true, 'bonus_payable'),
    ('3100', 'رأس المال', 'Capital', 'equity', p_eq, true, 'capital'),
    ('3200', 'أرباح مبقاة', 'Retained Earnings', 'equity', p_eq, true, 'retained'),
    ('3300', 'أرصدة افتتاحية', 'Opening Balance Equity', 'equity', p_eq, true, 'opening_equity'),
    ('4100', 'إيرادات الخدمات الطبية', 'Medical Services Revenue', 'revenue', p_rev, true, 'rev_services'),
    ('4200', 'إيرادات بيع المنتجات', 'Product Sales Revenue', 'revenue', p_rev, true, 'rev_products'),
    ('4300', 'إيرادات أخرى', 'Other Revenue', 'revenue', p_rev, true, 'rev_other'),
    ('5100', 'تكلفة المنتجات المباعة', 'Cost of Goods Sold', 'expense', p_cos, true, 'cogs'),
    ('5200', 'تكلفة المستهلكات الطبية', 'Medical Consumables', 'expense', p_cos, true, 'consumables'),
    ('6100', 'الرواتب والأجور', 'Salaries & Wages', 'expense', p_op, true, 'salaries_exp'),
    ('6110', 'العمولات والمكافآت', 'Commissions & Bonuses', 'expense', p_op, true, 'commission_exp'),
    ('6200', 'الإيجار', 'Rent', 'expense', p_op, true, null),
    ('6210', 'الكهرباء والمياه', 'Utilities', 'expense', p_op, true, null),
    ('6220', 'الاتصالات والإنترنت', 'Telecom & Internet', 'expense', p_op, true, null),
    ('6230', 'الصيانة والإصلاحات', 'Maintenance', 'expense', p_op, true, null),
    ('6240', 'التسويق والإعلان', 'Marketing', 'expense', p_op, true, null),
    ('6250', 'مستلزمات مكتبية وإدارية', 'Office Supplies', 'expense', p_op, true, null),
    ('6260', 'رسوم حكومية وتراخيص', 'Government Fees & Licences', 'expense', p_op, true, null),
    ('6270', 'مصاريف بنكية وعمولات دفع', 'Bank & Payment Fees', 'expense', p_op, true, null),
    ('6280', 'مصروفات عامة أخرى', 'General Expenses', 'expense', p_op, true, 'expense_general'),
    ('6300', 'مصروف الإهلاك', 'Depreciation Expense', 'expense', p_op, true, 'deprec_exp'),
    ('6900', 'فروق جرد الخزنة', 'Cash Over/Short', 'expense', p_op, true, 'cash_diff')
  on conflict (code) do nothing;
end $$;

insert into acc_treasuries (name, kind, account_id, opening_date)
select 'الصندوق الرئيسي', 'cash', id, riyadh_today() from acc_accounts where system_key = 'cash'
  and not exists (select 1 from acc_treasuries where account_id = (select id from acc_accounts where system_key = 'cash'));
insert into acc_treasuries (name, kind, account_id, opening_date)
select 'الحساب البنكي', 'bank', id, riyadh_today() from acc_accounts where system_key = 'bank'
  and not exists (select 1 from acc_treasuries where account_id = (select id from acc_accounts where system_key = 'bank'));

insert into acc_method_map (method, treasury_id)
select m, (select id from acc_treasuries where kind = case when m = 'cash' then 'cash' else 'bank' end order by created_at limit 1)
from unnest(array['cash', 'mada', 'card', 'cash_atm', 'apple_pay', 'stc_pay', 'urpay', 'transfer', 'sadad', 'tabby', 'tamara', 'cheque', 'online', 'other']) m
on conflict (method) do nothing;

-- ---------- 16) الصلاحيات التفصيلية (مساحات single-op: view = مسموح) ----------
do $$
declare a text;
  areas text[] := array['accounting.access', 'accounting.expenses.create', 'accounting.expenses.approve', 'accounting.purchases.manage',
    'accounting.payroll.view', 'accounting.payroll.manage', 'accounting.journals.create', 'accounting.journals.post',
    'accounting.reports.view', 'accounting.settings.manage', 'accounting.periods.close'];
begin
  foreach a in array areas loop
    insert into role_permissions (role, area, ops) values
      ('system_admin', a, array['view']),
      ('center_manager', a, case when a in ('accounting.access', 'accounting.expenses.create', 'accounting.expenses.approve', 'accounting.purchases.manage',
        'accounting.journals.create', 'accounting.journals.post', 'accounting.reports.view') then array['view'] else array[]::text[] end),
      ('accountant', a, case when a in ('accounting.access', 'accounting.expenses.create', 'accounting.purchases.manage',
        'accounting.journals.create', 'accounting.journals.post', 'accounting.reports.view') then array['view'] else array[]::text[] end),
      ('reception', a, array[]::text[]), ('secretary', a, array[]::text[]), ('therapist', a, array[]::text[])
    on conflict (role, area) do nothing;
  end loop;
end $$;
