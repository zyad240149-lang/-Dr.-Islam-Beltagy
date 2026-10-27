-- النظام المحاسبي — الدفاتر المساعدة: المصروفات (توسعة الجدول الحالي) + الموردون والمشتريات + المستهلكات + السلف + الأصول + الموازنات
-- ⚠️ جدول expenses موجود من قبل (هجرة 019) — اتوسّع بدل إنشاء جدول مكرر.

-- ---------- المصروفات ----------
create sequence if not exists acc_expense_seq;
alter table expenses add column if not exists no text;
alter table expenses add column if not exists acc_status text not null default 'draft';
alter table expenses add column if not exists account_id uuid references acc_accounts(id) on delete restrict;
alter table expenses add column if not exists treasury_id uuid references acc_treasuries(id) on delete restrict;
alter table expenses add column if not exists vendor_id uuid;
alter table expenses add column if not exists vat_amount numeric(12,2) not null default 0 check (vat_amount >= 0);
alter table expenses add column if not exists cost_center_id uuid references acc_cost_centers(id) on delete set null;
alter table expenses add column if not exists approved_by uuid references employees(id) on delete set null;
alter table expenses add column if not exists approved_at timestamptz;
alter table expenses add column if not exists cancelled_at timestamptz;
alter table expenses add column if not exists cancel_reason text;
alter table expenses add column if not exists attachment_path text;
alter table expenses add column if not exists idem_key text;
do $$ begin
  if not exists (select 1 from pg_constraint where conname = 'expenses_acc_status_chk') then
    alter table expenses add constraint expenses_acc_status_chk check (acc_status in ('draft', 'posted', 'cancelled'));
  end if;
end $$;
create unique index if not exists expenses_no_uq on expenses (no) where no is not null;
create unique index if not exists expenses_idem_uq on expenses (idem_key) where idem_key is not null;
create index if not exists idx_expenses_account on expenses (account_id);
create index if not exists idx_expenses_treasury on expenses (treasury_id);
create index if not exists idx_expenses_cc on expenses (cost_center_id);
create index if not exists idx_expenses_approved_by on expenses (approved_by);
create index if not exists idx_expenses_created_by on expenses (created_by);
create index if not exists idx_expenses_status on expenses (acc_status);

-- ---------- المنتجات: متوسط التكلفة (للمخزون والتكلفة) ----------
alter table products add column if not exists avg_cost numeric(14,4) not null default 0 check (avg_cost >= 0);

-- ---------- الموردون والمشتريات ----------
create sequence if not exists acc_purchase_seq;
create sequence if not exists acc_vp_seq;
create sequence if not exists acc_adv_seq;
create sequence if not exists acc_asset_seq;

create table if not exists acc_vendors (
  id uuid primary key default gen_random_uuid(),
  name text not null, phone text, vat_no text, address text, note text not null default '',
  active boolean not null default true, created_at timestamptz not null default now(),
  created_by uuid references employees(id) on delete set null
);
create unique index if not exists acc_vendors_name_uq on acc_vendors (lower(name));
create index if not exists idx_acc_vendors_by on acc_vendors (created_by);

create table if not exists acc_purchases (
  id uuid primary key default gen_random_uuid(),
  no text not null unique default ('PO-' || lpad(nextval('acc_purchase_seq')::text, 6, '0')),
  vendor_id uuid not null references acc_vendors(id) on delete restrict,
  purchase_date date not null, due_date date,
  kind text not null default 'credit' check (kind in ('cash', 'credit')),
  status text not null default 'draft' check (status in ('draft', 'posted', 'cancelled')),
  vendor_invoice_no text, note text not null default '',
  subtotal numeric(14,2) not null default 0, vat_amount numeric(14,2) not null default 0, total numeric(14,2) not null default 0,
  treasury_id uuid references acc_treasuries(id) on delete restrict,
  attachment_path text, idem_key text unique,
  created_by uuid references employees(id) on delete set null, created_at timestamptz not null default now(),
  approved_by uuid references employees(id) on delete set null, approved_at timestamptz,
  cancelled_at timestamptz, cancelled_by uuid references employees(id) on delete set null, cancel_reason text
);
create index if not exists idx_acc_purchases_vendor on acc_purchases (vendor_id);
create index if not exists idx_acc_purchases_date on acc_purchases (purchase_date);
create index if not exists idx_acc_purchases_status on acc_purchases (status);
create index if not exists idx_acc_purchases_treasury on acc_purchases (treasury_id);
create index if not exists idx_acc_purchases_cb on acc_purchases (created_by);
create index if not exists idx_acc_purchases_ab on acc_purchases (approved_by);
create index if not exists idx_acc_purchases_xb on acc_purchases (cancelled_by);

create table if not exists acc_purchase_items (
  id uuid primary key default gen_random_uuid(),
  purchase_id uuid not null references acc_purchases(id) on delete cascade,
  line_no int not null default 1,
  product_id uuid references products(id) on delete restrict,
  account_id uuid references acc_accounts(id) on delete restrict,
  cost_center_id uuid references acc_cost_centers(id) on delete set null,
  description text not null default '',
  qty numeric(12,3) not null check (qty > 0),
  unit_cost numeric(14,4) not null check (unit_cost >= 0),
  amount numeric(14,2) not null default 0,
  check (product_id is not null or account_id is not null)
);
create index if not exists idx_acc_pitems_purchase on acc_purchase_items (purchase_id);
create index if not exists idx_acc_pitems_product on acc_purchase_items (product_id);
create index if not exists idx_acc_pitems_account on acc_purchase_items (account_id);
create index if not exists idx_acc_pitems_cc on acc_purchase_items (cost_center_id);

create table if not exists acc_vendor_payments (
  id uuid primary key default gen_random_uuid(),
  no text not null unique default ('VP-' || lpad(nextval('acc_vp_seq')::text, 6, '0')),
  purchase_id uuid references acc_purchases(id) on delete restrict,
  vendor_id uuid not null references acc_vendors(id) on delete restrict,
  treasury_id uuid not null references acc_treasuries(id) on delete restrict,
  amount numeric(14,2) not null check (amount > 0),
  pay_date date not null, note text not null default '', attachment_path text,
  status text not null default 'active' check (status in ('active', 'void')),
  void_reason text, voided_at timestamptz, voided_by uuid references employees(id) on delete set null,
  idem_key text unique,
  created_by uuid references employees(id) on delete set null, created_at timestamptz not null default now()
);
create index if not exists idx_acc_vp_purchase on acc_vendor_payments (purchase_id);
create index if not exists idx_acc_vp_vendor on acc_vendor_payments (vendor_id);
create index if not exists idx_acc_vp_treasury on acc_vendor_payments (treasury_id);
create index if not exists idx_acc_vp_cb on acc_vendor_payments (created_by);
create index if not exists idx_acc_vp_vb on acc_vendor_payments (voided_by);

-- ---------- استهلاك المخزون والجرد ----------
create table if not exists acc_stock_consumptions (
  id uuid primary key default gen_random_uuid(),
  product_id uuid not null references products(id) on delete restrict,
  kind text not null default 'consumption' check (kind in ('consumption', 'count')),
  qty int not null check (qty <> 0),
  unit_cost numeric(14,4) not null default 0, total numeric(14,2) not null default 0,
  cons_date date not null, note text not null default '',
  status text not null default 'posted' check (status in ('posted', 'cancelled')),
  cancel_reason text, cancelled_at timestamptz,
  idem_key text unique,
  created_by uuid references employees(id) on delete set null, created_at timestamptz not null default now()
);
create index if not exists idx_acc_cons_product on acc_stock_consumptions (product_id);
create index if not exists idx_acc_cons_cb on acc_stock_consumptions (created_by);

-- ---------- السلف والخصومات ----------
create table if not exists acc_advances (
  id uuid primary key default gen_random_uuid(),
  no text not null unique default ('ADV-' || lpad(nextval('acc_adv_seq')::text, 5, '0')),
  employee_id uuid references employees(id) on delete set null,
  therapist_id uuid references therapists(id) on delete set null,
  person_name text not null,
  amount numeric(14,2) not null check (amount > 0),
  advance_date date not null, treasury_id uuid not null references acc_treasuries(id) on delete restrict,
  note text not null default '',
  status text not null default 'open' check (status in ('open', 'closed', 'cancelled')),
  cancel_reason text, idem_key text unique,
  created_by uuid references employees(id) on delete set null, created_at timestamptz not null default now()
);
create index if not exists idx_acc_adv_emp on acc_advances (employee_id);
create index if not exists idx_acc_adv_th on acc_advances (therapist_id);
create index if not exists idx_acc_adv_t on acc_advances (treasury_id);
create index if not exists idx_acc_adv_cb on acc_advances (created_by);

create table if not exists acc_advance_recoveries (
  id uuid primary key default gen_random_uuid(),
  advance_id uuid not null references acc_advances(id) on delete restrict,
  amount numeric(14,2) not null check (amount > 0),
  rec_date date not null,
  method text not null check (method in ('payroll_deduction', 'cash')),
  treasury_id uuid references acc_treasuries(id) on delete restrict,
  status text not null default 'active' check (status in ('active', 'void')),
  idem_key text unique, note text not null default '',
  created_by uuid references employees(id) on delete set null, created_at timestamptz not null default now()
);
create index if not exists idx_acc_rec_adv on acc_advance_recoveries (advance_id);
create index if not exists idx_acc_rec_t on acc_advance_recoveries (treasury_id);
create index if not exists idx_acc_rec_cb on acc_advance_recoveries (created_by);

-- ---------- الأصول الثابتة والإهلاك ----------
create table if not exists acc_assets (
  id uuid primary key default gen_random_uuid(),
  code text not null unique default ('FA-' || lpad(nextval('acc_asset_seq')::text, 4, '0')),
  name text not null, category text not null default '',
  cost numeric(14,2) not null check (cost > 0),
  salvage numeric(14,2) not null default 0 check (salvage >= 0),
  life_months int not null check (life_months between 1 and 600),
  purchase_date date not null, dep_start date not null,
  funding text not null default 'treasury' check (funding in ('treasury', 'opening', 'payable')),
  treasury_id uuid references acc_treasuries(id) on delete restrict,
  vendor_id uuid references acc_vendors(id) on delete restrict,
  status text not null default 'active' check (status in ('active', 'cancelled')),
  note text not null default '', idem_key text unique, check (salvage < cost),
  created_by uuid references employees(id) on delete set null, created_at timestamptz not null default now()
);
create index if not exists idx_acc_assets_t on acc_assets (treasury_id);
create index if not exists idx_acc_assets_v on acc_assets (vendor_id);
create index if not exists idx_acc_assets_cb on acc_assets (created_by);

create table if not exists acc_depreciation (
  id uuid primary key default gen_random_uuid(),
  asset_id uuid not null references acc_assets(id) on delete restrict,
  month text not null check (month ~ '^[0-9]{4}-(0[1-9]|1[0-2])$'),
  amount numeric(14,2) not null check (amount > 0),
  journal_id uuid references acc_journals(id) on delete restrict,
  created_at timestamptz not null default now(),
  unique (asset_id, month)
);
create index if not exists idx_acc_dep_journal on acc_depreciation (journal_id);

-- ---------- الموازنات ----------
create table if not exists acc_budgets (
  id uuid primary key default gen_random_uuid(),
  period text not null check (period ~ '^[0-9]{4}-(0[1-9]|1[0-2])$'),
  account_id uuid not null references acc_accounts(id) on delete restrict,
  cost_center_id uuid references acc_cost_centers(id) on delete cascade,
  amount numeric(14,2) not null check (amount >= 0),
  updated_by uuid references employees(id) on delete set null, updated_at timestamptz not null default now()
);
create unique index if not exists acc_budgets_uq on acc_budgets (period, account_id, coalesce(cost_center_id, '00000000-0000-0000-0000-000000000000'::uuid));
create index if not exists idx_acc_budgets_account on acc_budgets (account_id);
create index if not exists idx_acc_budgets_cc on acc_budgets (cost_center_id);
create index if not exists idx_acc_budgets_by on acc_budgets (updated_by);

-- ---------- RLS ----------
do $$ declare t text; begin
  foreach t in array array['acc_vendors', 'acc_purchases', 'acc_purchase_items', 'acc_vendor_payments', 'acc_stock_consumptions', 'acc_advances',
    'acc_advance_recoveries', 'acc_assets', 'acc_depreciation', 'acc_budgets'] loop
    execute format('alter table %I enable row level security', t);
    execute format('revoke all on %I from anon', t);
    execute format('revoke insert, update, delete, truncate on %I from authenticated', t);
    execute format('drop policy if exists acc_read on %I', t);
    if t in ('acc_advances', 'acc_advance_recoveries') then
      execute format('create policy acc_read on %I for select using ((select has_perm(''accounting.access'', ''view'')) and (select has_perm(''accounting.payroll.view'', ''view'')))', t);
    else
      execute format('create policy acc_read on %I for select using ((select has_perm(''accounting.access'', ''view'')))', t);
    end if;
  end loop;
end $$;

-- المصروفات: القراءة بصلاحية المحاسبة (إضافة لصلاحية financial القديمة)
drop policy if exists acc_read on expenses;
create policy acc_read on expenses for select using ((select has_perm('accounting.access', 'view')));

-- ---------- مرفقات المستندات المالية (bucket خاص) ----------
insert into storage.buckets (id, name, public) values ('acc-attachments', 'acc-attachments', false) on conflict (id) do nothing;
drop policy if exists acc_att_select on storage.objects;
drop policy if exists acc_att_insert on storage.objects;
drop policy if exists acc_att_delete on storage.objects;
create policy acc_att_select on storage.objects for select to authenticated using (bucket_id = 'acc-attachments' and (select has_perm('accounting.access', 'view')));
create policy acc_att_insert on storage.objects for insert to authenticated with check (bucket_id = 'acc-attachments' and (select has_perm('accounting.access', 'view'))
  and (select has_perm('accounting.expenses.create', 'view') or has_perm('accounting.purchases.manage', 'view') or has_perm('accounting.journals.create', 'view')));
create policy acc_att_delete on storage.objects for delete to authenticated using (bucket_id = 'acc-attachments' and (select has_perm('accounting.settings.manage', 'view')));
