-- 911: مزامنة تزايدية للأجهزة (Offline-First)
-- الجهاز بيحمّل كل البيانات أول مرة، وبعد كده بيجيب «اللي اتغيّر بس» من آخر مزامنة بدل ما ينزّل 9,000 مريض كل مرة:
--  1) updated_at على كل جدول بيتزامن + تريجر بيحدّثه في أي تعديل (من أي دالة أو شاشة) — الوقت من الخادم مش من الجهاز،
--     فساعة الجهاز الغلط مابتأثرش على المزامنة.
--  2) sync_tombstones: سجل بالصفوف اللي اتحذفت (الجدول + المعرّف + الوقت) — الجهاز بيشيلها من نسخته المحلية.
--     فيه المعرّف بس (من غير أي بيانات)، والقراءة للموظفين بس.

-- 1) updated_at
alter table patients add column if not exists updated_at timestamptz not null default now();
alter table invoices add column if not exists updated_at timestamptz not null default now();
alter table payments add column if not exists updated_at timestamptz not null default now();
alter table treatment_sessions add column if not exists updated_at timestamptz not null default now();
alter table initial_assessments add column if not exists updated_at timestamptz not null default now();
alter table packages add column if not exists updated_at timestamptz not null default now();

create or replace function public.sync_touch()
 returns trigger
 language plpgsql
 set search_path to 'public'
as $function$
begin
  new.updated_at := now();
  return new;
end $function$;
revoke execute on function public.sync_touch() from anon, authenticated, public;

do $$
declare t text;
begin
  foreach t in array array['patients', 'appointments', 'invoices', 'payments', 'treatment_plans', 'treatment_sessions', 'initial_assessments', 'packages'] loop
    execute format('drop trigger if exists trg_sync_touch on public.%I', t);
    execute format('create trigger trg_sync_touch before update on public.%I for each row execute function sync_touch()', t);
    execute format('create index if not exists %I on public.%I (updated_at)', 'idx_' || t || '_updated_at', t);
  end loop;
end $$;

-- 2) الصفوف المحذوفة
create table if not exists public.sync_tombstones (
  id bigserial primary key,
  table_name text not null,
  row_id uuid not null,
  deleted_at timestamptz not null default now()
);
create index if not exists idx_sync_tombstones_at on public.sync_tombstones (table_name, deleted_at);
alter table public.sync_tombstones enable row level security;
drop policy if exists staff_read on public.sync_tombstones;
create policy staff_read on public.sync_tombstones for select using ((select is_staff()));
revoke all on public.sync_tombstones from anon;
grant select on public.sync_tombstones to authenticated;

create or replace function public.sync_tombstone()
 returns trigger
 language plpgsql
 security definer
 set search_path to 'public'
as $function$
begin
  insert into sync_tombstones (table_name, row_id) values (tg_table_name, old.id);
  return old;
end $function$;
revoke execute on function public.sync_tombstone() from anon, authenticated, public;

do $$
declare t text;
begin
  foreach t in array array['patients', 'appointments', 'invoices', 'payments', 'treatment_plans', 'treatment_sessions', 'initial_assessments', 'packages',
                           'ortho_consultations', 'ortho_imaging', 'ortho_fractures', 'ortho_surgeries'] loop
    execute format('drop trigger if exists trg_sync_tombstone on public.%I', t);
    execute format('create trigger trg_sync_tombstone after delete on public.%I for each row execute function sync_tombstone()', t);
  end loop;
end $$;

-- السجل مابيكبرش للأبد: أي جهاز آخر مزامنة ليه أقدم من 60 يوم بيعمل تحميل كامل (src/offline/sync.ts)
select cron.unschedule(jobid) from cron.job where jobname = 'sync-tombstones-prune';
select cron.schedule('sync-tombstones-prune', '17 3 * * *', $$delete from public.sync_tombstones where deleted_at < now() - interval '60 days'$$);
