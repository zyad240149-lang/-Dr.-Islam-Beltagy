-- 919: شيت متابعة التمريض — بيتملى في كل زيارة متابعة (الألم، الالتزام، الحركة، الأعراض، العلاج الحالي، الجبس، العمليات).
-- محتوى الشيت كله في sheet (jsonb) عشان أي بند يتضاف للشيت الورقي مايحتاجش هجرة. نفس صلاحيات باقي السجلات الطبية (900).
create table if not exists ortho_nursing (
  id uuid primary key default gen_random_uuid(),
  patient_id uuid not null references patients(id) on delete cascade,
  appointment_id uuid references appointments(id) on delete set null,
  date date not null default riyadh_today(),
  sheet jsonb not null default '{}'::jsonb,
  created_by uuid references employees(id) on delete set null default my_employee_id(),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index if not exists ortho_nursing_patient on ortho_nursing(patient_id, date desc);

alter table ortho_nursing enable row level security;
revoke all on ortho_nursing from anon;
grant select, insert, update, delete on ortho_nursing to authenticated;
drop policy if exists staff_read on ortho_nursing;
create policy staff_read on ortho_nursing for select using ((select has_perm('patients', 'view')));
drop policy if exists staff_insert on ortho_nursing;
create policy staff_insert on ortho_nursing for insert with check ((select has_perm('sessions', 'create')));
drop policy if exists staff_update on ortho_nursing;
create policy staff_update on ortho_nursing for update using ((select has_perm('sessions', 'edit'))) with check ((select has_perm('sessions', 'edit')));
drop policy if exists staff_delete on ortho_nursing;
create policy staff_delete on ortho_nursing for delete using ((select has_perm('sessions', 'delete')) or (select is_admin()));
drop trigger if exists trg_touch on ortho_nursing;
create trigger trg_touch before update on ortho_nursing for each row execute function ortho_touch();
drop trigger if exists trg_audit on ortho_nursing;
create trigger trg_audit after insert or update or delete on ortho_nursing for each row execute function audit_row();
drop trigger if exists trg_sync_tombstone on ortho_nursing;
create trigger trg_sync_tombstone after delete on ortho_nursing for each row execute function sync_tombstone();
