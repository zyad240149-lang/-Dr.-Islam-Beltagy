-- 963: صلاحية لكل قسم من أقسام العظام والمصروفات (شاشة «الأدوار والصلاحيات»).
-- قبل كده: كل الأقسام دي كانت بتتقري بـ«المرضى» وبتتكتب بـ«الزيارات» (والمصروفات بـ«الأرقام المالية») — فمكانش ينفع تقفل قسم لوحده.
-- 1) كل دور (وكل موظف بصلاحيات مخصّصة) بياخد في الأقسام الجديدة نفس اللي كان بيقدر عليه قبل كده بالظبط (نفس opsOf في defaultPermissions.ts).
--    on conflict do nothing: لو المدير حفظ شاشة الأدوار قبل الهجرة، اختياره هو اللي بيفضل.
-- 2) سياسات RLS والدوال بقت بصلاحية القسم نفسه. القراءة فضلت مسموحة كمان لمن عنده «المرضى» (الروشتة بتقرا بنك الأدوية،
--    وملف المريض بيقرا التشخيص) — والإخفاء في الواجهة بصلاحية «اطلاع» القسم.

create or replace function public._perm_legacy() returns table (area text, op text, src text)
language sql immutable as $$
  select a, o, case when o = 'view' then 'patients' else 'sessions' end
  from unnest(array['diagnosis','imaging','injections','fractures','surgeries','nursing','medications','exercises']) a,
       unnest(array['view','create','edit','delete']) o
  union all values
    ('follow_ups','view','patients'), ('follow_ups','create','sessions'), ('follow_ups','create','appointments'),
    ('follow_ups','edit','sessions'), ('follow_ups','edit','appointments'), ('follow_ups','delete','sessions'),
    ('expenses','view','financial'), ('expenses','create','financial'), ('expenses','edit','financial'), ('expenses','delete','financial')
$$;

-- 1) الأدوار
insert into role_permissions (role, area, ops)
select r.role, l.area, coalesce(array_agg(distinct l.op) filter (where rp.ops @> array[l.op]), '{}')
from (select distinct role from role_permissions) r
cross join public._perm_legacy() l
left join role_permissions rp on rp.role = r.role and rp.area = l.src
group by r.role, l.area
on conflict (role, area) do nothing;

-- 1ب) الموظفين بصلاحيات مخصّصة: لو المخصّص فيه قسم من الأقسام القديمة، القسم الجديد بيتحسب من (الدور + المخصّص)
do $$
declare e record; a text; merged jsonb; clean jsonb; o jsonb;
begin
  for e in select id, role, perm_override from employees where perm_override is not null loop
    select coalesce(jsonb_object_agg(rp.area, to_jsonb(rp.ops)), '{}'::jsonb) || e.perm_override into merged from role_permissions rp where rp.role = e.role;
    clean := e.perm_override;
    for a in select distinct l.area from public._perm_legacy() l loop
      continue when clean ? a;
      continue when not exists (select 1 from public._perm_legacy() l where l.area = a and e.perm_override ? l.src);
      select coalesce(jsonb_agg(distinct l.op), '[]'::jsonb) into o from public._perm_legacy() l where l.area = a and coalesce(merged -> l.src, '[]'::jsonb) ? l.op;
      clean := clean || jsonb_build_object(a, o);
    end loop;
    if clean is distinct from e.perm_override then update employees set perm_override = clean where id = e.id; end if;
  end loop;
end $$;

drop function public._perm_legacy();

-- 2) سياسات الجداول: كل جدول بصلاحية قسمه
do $$
declare t record; ins text; upd text;
begin
  for t in select * from (values
    ('ortho_consultations', 'diagnosis'), ('ortho_imaging', 'imaging'), ('ortho_injections', 'injections'), ('ortho_fractures', 'fractures'),
    ('ortho_surgeries', 'surgeries'), ('ortho_surgery_stages', 'surgeries'), ('ortho_surgery_payment_stages', 'surgeries'),
    ('ortho_nursing', 'nursing'), ('ortho_medications', 'medications'), ('ortho_exercises', 'exercises'), ('ortho_exercise_plans', 'exercises'),
    ('ortho_follow_ups', 'follow_ups')
  ) x(tbl, area) loop
    ins := format('(select has_perm(%L, ''create''))', t.area);
    upd := format('(select has_perm(%L, ''edit''))', t.area);
    -- حفظ التشخيص بيسجّل معاه طلبات الأشعة والتحاليل ومواعيد المتابعة المكتوبة فيه
    if t.tbl in ('ortho_imaging', 'ortho_follow_ups') then ins := ins || ' or (select has_perm(''diagnosis'', ''create''))'; end if;
    -- تأكيد/تحويل موعد المتابعة لحجز من جدول المواعيد
    if t.tbl = 'ortho_follow_ups' then upd := upd || ' or (select has_perm(''appointments'', ''edit''))'; end if;
    execute format('drop policy if exists staff_read on %I', t.tbl);
    execute format('drop policy if exists staff_insert on %I', t.tbl);
    execute format('drop policy if exists staff_update on %I', t.tbl);
    execute format('drop policy if exists staff_delete on %I', t.tbl);
    execute format('create policy staff_read on %I for select using ((select has_perm(''patients'', ''view'')) or (select has_perm(%L, ''view'')))', t.tbl, t.area);
    execute format('create policy staff_insert on %I for insert with check (%s)', t.tbl, ins);
    execute format('create policy staff_update on %I for update using (%s) with check (%s)', t.tbl, upd, upd);
    execute format('create policy staff_delete on %I for delete using ((select has_perm(%L, ''delete'')) or (select is_admin()))', t.tbl, t.area);
  end loop;
end $$;

-- صور وفيديوهات التمرينات
drop policy if exists exm_staff_write on storage.objects;
drop policy if exists exm_staff_delete on storage.objects;
create policy exm_staff_write on storage.objects for insert with check (bucket_id = 'exercise-media' and (select has_perm('exercises', 'create')));
create policy exm_staff_delete on storage.objects for delete using (bucket_id = 'exercise-media' and (select has_perm('exercises', 'edit')));

-- المصروفات
drop policy if exists staff_read on expenses;
create policy staff_read on expenses for select using ((select has_perm('expenses', 'view')) or (select has_perm('financial', 'view')));

-- 3) الدوال: نفس التعريف الحالي بالظبط مع تغيير الصلاحية بس (ولو النص اتغيّر ومالقيناش الصلاحية القديمة: الهجرة بتقف)
do $$
declare f record; def text; nd text;
begin
  for f in select * from (values
    ('public.finish_surgery(jsonb)', 'require_perm(''sessions'', ''edit'')', 'require_perm(''surgeries'', ''edit'')'),
    ('public.link_consultation(uuid,uuid)', 'has_perm(''sessions'', ''edit'')', 'has_perm(''diagnosis'', ''edit'')'),
    ('public.save_expense(jsonb)', 'require_perm(''financial'',', 'require_perm(''expenses'','),
    ('public.delete_expense(uuid)', 'require_perm(''financial'', ''delete'')', 'require_perm(''expenses'', ''delete'')')
  ) x(fn, old, new) loop
    def := pg_get_functiondef(f.fn::regprocedure);
    nd := replace(def, f.old, f.new);
    if nd = def then raise exception 'الدالة % مافيهاش %', f.fn, f.old; end if;
    execute nd;
  end loop;
end $$;

-- 4) صلاحيات اتشالت من البرنامج (تبويب الحسابات الأونلاين، استيراد/تصدير Excel، فلاتر مصدر المعرفة/الطبيب/الحالة — كلها اتشالت من صفحة المرضى ٨/١١)
delete from role_permissions where area in ('online_accounts', 'patient_import', 'patient_export', 'pt_f_source', 'pt_f_doctor', 'pt_f_status');
update employees set perm_override = perm_override - array['online_accounts', 'patient_import', 'patient_export', 'pt_f_source', 'pt_f_doctor', 'pt_f_status']
where perm_override ?| array['online_accounts', 'patient_import', 'patient_export', 'pt_f_source', 'pt_f_doctor', 'pt_f_status'];
