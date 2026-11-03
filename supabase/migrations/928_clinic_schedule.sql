-- 928: مواعيد وعناوين وأرقام فرعين الدكتور (بيانات العيادة الفعلية)
--  • العيادة — شارع الشركات: السبت والاثنين والأربعاء 1 ظهرًا – 8 مساءً (0472557970 / 01070072413 / 01222552399)
--  • مركز الرواد لجراحة العظام — دسوق أمام المستشفى العام: الأحد والثلاثاء والخميس 4 – 8 مساءً (0472573999 / 0472563999)
update branches set city = 'دسوق', district = 'كوبري البدالة', phone = '01070072413',
  address = 'شارع الشركات – كوبري البدالة – بجوار مسجد السمادوني – خلف صيدلية الأمانة'
where name = 'العيادة — شارع الشركات';
update branches set city = 'دسوق', phone = '0472573999', address = 'أمام المستشفى العام'
where name = 'مركز الرواد لجراحة العظام';

with b as (
  select (select id from branches where name = 'العيادة — شارع الشركات' limit 1) as main,
         (select id from branches where name = 'مركز الرواد لجراحة العظام' limit 1) as rowad
)
update therapists t set work_hours = (
  select jsonb_build_array(
    jsonb_build_object('day', 'sat', 'from', '13:00', 'to', '20:00', 'branchId', b.main),
    jsonb_build_object('day', 'sun', 'from', '16:00', 'to', '20:00', 'branchId', b.rowad),
    jsonb_build_object('day', 'mon', 'from', '13:00', 'to', '20:00', 'branchId', b.main),
    jsonb_build_object('day', 'tue', 'from', '16:00', 'to', '20:00', 'branchId', b.rowad),
    jsonb_build_object('day', 'wed', 'from', '13:00', 'to', '20:00', 'branchId', b.main),
    jsonb_build_object('day', 'thu', 'from', '16:00', 'to', '20:00', 'branchId', b.rowad)
  ) from b
)
where t.name like '%بلتاجي%' and (select main from b) is not null and (select rowad from b) is not null;
