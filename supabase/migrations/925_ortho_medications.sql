-- 925: قايمة أسامي الأدوية اللي الطبيب بيكتبها للمرضى (مش مخزون): الاسم + المجموعة + الجرعة/التكرار/المدة الافتراضية.
-- بتظهر اقتراحات في الروشتة. نفس صلاحيات باقي السجلات الطبية (900).
create table if not exists ortho_medications (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  "group" text not null default '',
  dose text not null default '',
  frequency text not null default '',
  duration text not null default '',
  created_by uuid references employees(id) on delete set null default my_employee_id(),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create unique index if not exists ortho_medications_name_uq on ortho_medications(lower(name));

alter table ortho_medications enable row level security;
revoke all on ortho_medications from anon;
grant select, insert, update, delete on ortho_medications to authenticated;
drop policy if exists staff_read on ortho_medications;
create policy staff_read on ortho_medications for select using ((select has_perm('patients', 'view')));
drop policy if exists staff_insert on ortho_medications;
create policy staff_insert on ortho_medications for insert with check ((select has_perm('sessions', 'create')));
drop policy if exists staff_update on ortho_medications;
create policy staff_update on ortho_medications for update using ((select has_perm('sessions', 'edit'))) with check ((select has_perm('sessions', 'edit')));
drop policy if exists staff_delete on ortho_medications;
create policy staff_delete on ortho_medications for delete using ((select has_perm('sessions', 'delete')) or (select is_admin()));
drop trigger if exists trg_touch on ortho_medications;
create trigger trg_touch before update on ortho_medications for each row execute function ortho_touch();
drop trigger if exists trg_audit on ortho_medications;
create trigger trg_audit after insert or update or delete on ortho_medications for each row execute function audit_row();
