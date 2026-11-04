-- 939: خطة دفع العملية (دفعات متوقعة بس). مابتسجلش إيراد؛ الفاتورة والتحصيل لسه عند «إنهاء العملية».
create table if not exists ortho_surgery_payment_stages (
  id uuid primary key default gen_random_uuid(),
  surgery_id uuid not null references ortho_surgeries(id) on delete cascade,
  position integer not null default 0,
  name text not null check (length(trim(name)) > 0),
  amount numeric not null default 0 check (amount >= 0),
  due_date date,
  created_by uuid references employees(id) on delete set null default my_employee_id(),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index if not exists ortho_surgery_payment_stages_surgery on ortho_surgery_payment_stages(surgery_id, position);
alter table ortho_surgery_payment_stages enable row level security;
drop policy if exists staff_read on ortho_surgery_payment_stages;
create policy staff_read on ortho_surgery_payment_stages for select using ((select has_perm('patients', 'view')));
drop policy if exists staff_insert on ortho_surgery_payment_stages;
create policy staff_insert on ortho_surgery_payment_stages for insert with check ((select has_perm('sessions', 'create')));
drop policy if exists staff_update on ortho_surgery_payment_stages;
create policy staff_update on ortho_surgery_payment_stages for update using ((select has_perm('sessions', 'edit'))) with check ((select has_perm('sessions', 'edit')));
drop policy if exists staff_delete on ortho_surgery_payment_stages;
create policy staff_delete on ortho_surgery_payment_stages for delete using ((select has_perm('sessions', 'delete')) or (select is_admin()));
grant select, insert, update, delete on ortho_surgery_payment_stages to authenticated;

drop trigger if exists trg_touch on ortho_surgery_payment_stages;
create trigger trg_touch before update on ortho_surgery_payment_stages for each row execute function ortho_touch();
drop trigger if exists trg_audit on ortho_surgery_payment_stages;
create trigger trg_audit after insert or update or delete on ortho_surgery_payment_stages for each row execute function audit_row();
drop trigger if exists trg_sync_tombstone on ortho_surgery_payment_stages;
create trigger trg_sync_tombstone after delete on ortho_surgery_payment_stages for each row execute function sync_tombstone();

create or replace function public.trg_surgery_payment_stage_guard() returns trigger
language plpgsql security definer set search_path to 'public' as $$
declare sid uuid := case when tg_op = 'DELETE' then old.surgery_id else new.surgery_id end;
begin
  if exists (select 1 from ortho_surgeries where id = sid and status = 'done') then
    raise exception 'العملية منتهية — خطة الدفع ماتتعدلش';
  end if;
  if tg_op = 'DELETE' then return old; end if;
  return new;
end $$;
drop trigger if exists trg_payment_stage_guard on ortho_surgery_payment_stages;
create trigger trg_payment_stage_guard before insert or update or delete on ortho_surgery_payment_stages for each row execute function public.trg_surgery_payment_stage_guard();
revoke execute on function public.trg_surgery_payment_stage_guard() from public, anon, authenticated;

do $$ begin
  if exists (select 1 from pg_publication where pubname = 'supabase_realtime')
     and not exists (select 1 from pg_publication_tables where pubname = 'supabase_realtime' and tablename = 'ortho_surgery_payment_stages') then
    alter publication supabase_realtime add table ortho_surgery_payment_stages;
  end if;
end $$;
