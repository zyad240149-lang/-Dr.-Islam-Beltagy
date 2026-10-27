-- إصلاح: قناة المزامنة الحية في لوحة الإدارة (clinic-live) مشتركة في 15 جدول، و5 منهم ما كانوش ضمن
-- منشور supabase_realtime. في الحالة دي Supabase بيسيب القناة "SUBSCRIBED" بس ما بيبعتش أي حدث خالص
-- (ولا حتى للمواعيد)، فأي تغيير من جهاز/موظف/مريض تاني ما كانش بيظهر إلا بعد تحديث الصفحة يدويًا.
do $$
declare t text;
begin
  foreach t in array array['packages', 'discount_codes', 'campaigns', 'employees', 'plan_services'] loop
    begin
      execute format('alter publication supabase_realtime add table %I', t);
    exception when duplicate_object then null; when undefined_table then null;
    end;
  end loop;
end $$;
