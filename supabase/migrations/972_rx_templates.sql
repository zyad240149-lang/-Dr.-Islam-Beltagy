-- 972: «روشتات جاهزة» — الطبيب بيسمّي روشتة (مثال: خشونة) ويحط فيها أدوية بجرعاتها، وفي التشخيص بيضغط عليها تنزل كلها في الروشتة.
-- items = [{name, dose, frequency, duration, notes}] — نفس شكل أدوية الكشف. صلاحيات قسم «الأدوية» (زي ortho_medications).
create table if not exists ortho_rx_templates (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  items jsonb not null default '[]'::jsonb,
  notes text not null default '',
  created_by uuid references employees(id) on delete set null default my_employee_id(),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

alter table ortho_rx_templates enable row level security;
revoke all on ortho_rx_templates from anon;
grant select, insert, update, delete on ortho_rx_templates to authenticated;
drop policy if exists staff_read on ortho_rx_templates;
create policy staff_read on ortho_rx_templates for select using ((select has_perm('patients', 'view')) or (select has_perm('medications', 'view')) or (select has_perm('diagnosis', 'view')));
drop policy if exists staff_insert on ortho_rx_templates;
create policy staff_insert on ortho_rx_templates for insert with check ((select has_perm('medications', 'create')));
drop policy if exists staff_update on ortho_rx_templates;
create policy staff_update on ortho_rx_templates for update using ((select has_perm('medications', 'edit'))) with check ((select has_perm('medications', 'edit')));
drop policy if exists staff_delete on ortho_rx_templates;
create policy staff_delete on ortho_rx_templates for delete using ((select has_perm('medications', 'delete')) or (select is_admin()));
drop trigger if exists trg_touch on ortho_rx_templates;
create trigger trg_touch before update on ortho_rx_templates for each row execute function ortho_touch();
drop trigger if exists trg_audit on ortho_rx_templates;
create trigger trg_audit after insert or update or delete on ortho_rx_templates for each row execute function audit_row();
drop trigger if exists trg_sync_tombstone on ortho_rx_templates;
create trigger trg_sync_tombstone after delete on ortho_rx_templates for each row execute function sync_tombstone();
do $$ begin
  if not exists (select 1 from pg_publication_tables where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'ortho_rx_templates') then
    alter publication supabase_realtime add table public.ortho_rx_templates;
  end if;
end $$;
