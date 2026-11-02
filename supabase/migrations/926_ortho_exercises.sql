-- 926: «التمرينات العلاجية» (Exercise Library): تمرين = اسم + مجموعة + وصف مختصر + صور/فيديوهات (bucket عام exercise-media — محتوى تعليمي مش بيانات مرضى).
-- خطة تمرينات المريض (ortho_exercise_plans): التمرينات المختارة لمريض ومربوطة بتشخيصه. share_token = رابط عام للمريض
-- (/ex/<token>) بيعرض التمرينات بس — من غير اسم المريض أو أي بيانات طبية — عن طريق exercise_share().
create table if not exists ortho_exercises (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  "group" text not null default '',
  description text not null default '',
  media jsonb not null default '[]'::jsonb,
  created_by uuid references employees(id) on delete set null default my_employee_id(),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists ortho_exercise_plans (
  id uuid primary key default gen_random_uuid(),
  patient_id uuid not null references patients(id) on delete cascade,
  consultation_id uuid references ortho_consultations(id) on delete set null,
  date date not null default riyadh_today(),
  exercise_ids uuid[] not null default '{}',
  notes text not null default '',
  share_token uuid not null unique default gen_random_uuid(),
  created_by uuid references employees(id) on delete set null default my_employee_id(),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index if not exists ortho_exercise_plans_patient on ortho_exercise_plans(patient_id, date desc);

do $$ declare t text; begin
  foreach t in array array['ortho_exercises', 'ortho_exercise_plans'] loop
    execute format('alter table %I enable row level security', t);
    execute format('revoke all on %I from anon', t);
    execute format('grant select, insert, update, delete on %I to authenticated', t);
    execute format('drop policy if exists staff_read on %I', t);
    execute format('create policy staff_read on %I for select using ((select has_perm(''patients'', ''view'')))', t);
    execute format('drop policy if exists staff_insert on %I', t);
    execute format('create policy staff_insert on %I for insert with check ((select has_perm(''sessions'', ''create'')))', t);
    execute format('drop policy if exists staff_update on %I', t);
    execute format('create policy staff_update on %I for update using ((select has_perm(''sessions'', ''edit''))) with check ((select has_perm(''sessions'', ''edit'')))', t);
    execute format('drop policy if exists staff_delete on %I', t);
    execute format('create policy staff_delete on %I for delete using ((select has_perm(''sessions'', ''delete'')) or (select is_admin()))', t);
    execute format('drop trigger if exists trg_touch on %I', t);
    execute format('create trigger trg_touch before update on %I for each row execute function ortho_touch()', t);
    execute format('drop trigger if exists trg_audit on %I', t);
    execute format('create trigger trg_audit after insert or update or delete on %I for each row execute function audit_row()', t);
    execute format('drop trigger if exists trg_sync_tombstone on %I', t);
    execute format('create trigger trg_sync_tombstone after delete on %I for each row execute function sync_tombstone()', t);
  end loop;
end $$;

-- صفحة المريض العامة: التمرينات بس (اسم/وصف/ميديا) بالترتيب اللي اتختار
create or replace function exercise_share(p_token uuid) returns jsonb
language sql stable security definer set search_path = public as $$
  select coalesce(jsonb_agg(jsonb_build_object('name', e.name, 'description', e.description, 'media', e.media) order by x.ord), '[]'::jsonb)
  from ortho_exercise_plans p
  cross join lateral unnest(p.exercise_ids) with ordinality as x(id, ord)
  join ortho_exercises e on e.id = x.id
  where p.share_token = p_token;
$$;
revoke all on function exercise_share(uuid) from public;
grant execute on function exercise_share(uuid) to anon, authenticated;

-- الميديا: قراية عامة (روابط ثابتة تتبعت للمريض)، والرفع/الحذف للطاقم
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('exercise-media', 'exercise-media', true, 52428800, array['image/png', 'image/jpeg', 'image/webp', 'image/gif', 'video/mp4', 'video/webm', 'video/quicktime'])
on conflict (id) do update set public = true, file_size_limit = excluded.file_size_limit, allowed_mime_types = excluded.allowed_mime_types;
drop policy if exists exm_staff_write on storage.objects;
create policy exm_staff_write on storage.objects for insert with check (bucket_id = 'exercise-media' and (select has_perm('sessions', 'create')));
drop policy if exists exm_staff_delete on storage.objects;
create policy exm_staff_delete on storage.objects for delete using (bucket_id = 'exercise-media' and (select has_perm('sessions', 'edit')));
