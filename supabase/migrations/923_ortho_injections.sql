-- 923: سجل الحقن (INJECTION RECORD — MSK Injection Documentation): مكان الحقن، التركيب المستهدف، نوع المادة، التقنية، تفاصيل المادة (الجرعة/التشغيلة/الصلاحية)، التقييم قبل الحقن والموافقة، الملاحظات، والنتيجة والمتابعة.
-- محتوى الشيت كله في sheet (jsonb) عشان أي بند يتضاف للشيت الورقي مايحتاجش هجرة. نفس صلاحيات باقي السجلات الطبية (900).
create table if not exists ortho_injections (
  id uuid primary key default gen_random_uuid(),
  patient_id uuid not null references patients(id) on delete cascade,
  appointment_id uuid references appointments(id) on delete set null,
  date date not null default riyadh_today(),
  sheet jsonb not null default '{}'::jsonb,
  created_by uuid references employees(id) on delete set null default my_employee_id(),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index if not exists ortho_injections_patient on ortho_injections(patient_id, date desc);

alter table ortho_injections enable row level security;
revoke all on ortho_injections from anon;
grant select, insert, update, delete on ortho_injections to authenticated;
drop policy if exists staff_read on ortho_injections;
create policy staff_read on ortho_injections for select using ((select has_perm('patients', 'view')));
drop policy if exists staff_insert on ortho_injections;
create policy staff_insert on ortho_injections for insert with check ((select has_perm('sessions', 'create')));
drop policy if exists staff_update on ortho_injections;
create policy staff_update on ortho_injections for update using ((select has_perm('sessions', 'edit'))) with check ((select has_perm('sessions', 'edit')));
drop policy if exists staff_delete on ortho_injections;
create policy staff_delete on ortho_injections for delete using ((select has_perm('sessions', 'delete')) or (select is_admin()));
drop trigger if exists trg_touch on ortho_injections;
create trigger trg_touch before update on ortho_injections for each row execute function ortho_touch();
drop trigger if exists trg_audit on ortho_injections;
create trigger trg_audit after insert or update or delete on ortho_injections for each row execute function audit_row();
drop trigger if exists trg_sync_tombstone on ortho_injections;
create trigger trg_sync_tombstone after delete on ortho_injections for each row execute function sync_tombstone();
