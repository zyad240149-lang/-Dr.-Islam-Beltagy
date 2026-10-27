-- 155: سياسات RLS كلها كانت بتنادي دوال الصلاحيات (has_perm / can_see_patient / is_staff / my_*_id / is_gm) لكل صف.
-- الدوال دي مابتعتمدش على الصف (بتعتمد على الموظف المسجّل بس — و can_see_patient حاليًا = is_staff())، فبتتغلّف بـ (SELECT ...)
-- عشان Postgres يحسبها مرة واحدة لكل استعلام (InitPlan). نفس المنطق بالظبط، أسرع بكتير مع آلاف المرضى/المواعيد (154 عملها لجدول المرضى).
-- ⚠️ لو can_see_patient اتغيرت في يوم وبقت بتعتمد على المريض (نطاق «مرضاي فقط»)، لازم ترجع السياسات تمرّر patient_id من غير SELECT.
comment on function can_see_patient(uuid) is 'حاليًا = is_staff() ومابتعتمدش على المريض — سياسات RLS بتنديها مغلّفة بـ (SELECT can_see_patient(NULL)) (هجرة 155). لو بقت بتعتمد على المريض راجع السياسات.';

do $$
declare p record; q text; w text; stmt text; n int := 0;
  function_re constant text := '(has_perm|can_see_patient|is_staff|my_employee_id|my_patient_id|my_customer_id|is_gm)\(';
begin
  for p in select schemaname, tablename, policyname, cmd, qual, with_check from pg_policies where schemaname = 'public' loop
    q := p.qual; w := p.with_check;
    if coalesce(q, '') || coalesce(w, '') !~ function_re then continue; end if;
    if coalesce(q, '') || coalesce(w, '') ~* 'select\s+(has_perm|can_see_patient|is_staff|my_employee_id|my_patient_id|my_customer_id|is_gm)\(' then continue; end if; -- متغلّفة قبل كده
    if q is not null then
      q := regexp_replace(q, 'has_perm\(''([^'']+)''::text, ''([^'']+)''::text\)', '(SELECT has_perm(''\1''::text, ''\2''::text))', 'g');
      q := regexp_replace(q, 'can_see_patient\([^()]*\)', '(SELECT can_see_patient(NULL::uuid))', 'g');
      q := regexp_replace(q, '(is_staff|my_employee_id|my_patient_id|my_customer_id|is_gm)\(\)', '(SELECT \1())', 'g');
    end if;
    if w is not null then
      w := regexp_replace(w, 'has_perm\(''([^'']+)''::text, ''([^'']+)''::text\)', '(SELECT has_perm(''\1''::text, ''\2''::text))', 'g');
      w := regexp_replace(w, 'can_see_patient\([^()]*\)', '(SELECT can_see_patient(NULL::uuid))', 'g');
      w := regexp_replace(w, '(is_staff|my_employee_id|my_patient_id|my_customer_id|is_gm)\(\)', '(SELECT \1())', 'g');
    end if;
    stmt := format('alter policy %I on %I.%I', p.policyname, p.schemaname, p.tablename);
    if q is not null then stmt := stmt || ' using (' || q || ')'; end if;
    if w is not null then stmt := stmt || ' with check (' || w || ')'; end if;
    execute stmt;
    n := n + 1;
  end loop;
  raise notice 'policies wrapped: %', n;
end $$;
