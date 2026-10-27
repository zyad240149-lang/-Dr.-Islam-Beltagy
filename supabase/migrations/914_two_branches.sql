-- الدكتور بيشتغل في فرعين (3 أيام في كل فرع): هنا تصحيح بيانات الفرع الأول (كانت بيانات افتراضية ما اتعدّلتش)،
-- إضافة الفرع التاني، وربط جدول الدكتور (work_hours) بالفرع المناسب لكل يوم — من غير أي فصل في المرضى/المواعيد/الفواتير.

-- الفرع الأول: كان لسه بالاسم/المدينة الافتراضية (العيادة الرئيسية / القاهرة) من أول إعداد — نظبطه ببيانات العيادة الحقيقية
update branches set name = 'العيادة — شارع الشركات', city = 'دسوق', district = 'كوبري البدالة', address = 'شارع الشركات – كوبري البدالة – بجوار مسجد السمادوني – خلف صيدلية الأمانة', phone = '01070072413'
where name = 'العيادة الرئيسية' and coalesce(address, '') = '';

insert into branches (name, city, address)
select 'مركز الرواد لجراحة العظام', 'دسوق', 'أمام المستشفى العام'
where not exists (select 1 from branches where name = 'مركز الرواد لجراحة العظام');

-- تحديد الفرع لكل يوم في جدول د. إسلام بلتاجي: السبت/الاثنين/الأربعاء العيادة — الأحد/الثلاثاء/الخميس مركز الرواد
with b as (
  select
    (select id from branches where name = 'العيادة — شارع الشركات' limit 1) as main,
    (select id from branches where name = 'مركز الرواد لجراحة العظام' limit 1) as rowad
)
update therapists t set work_hours = (
  select jsonb_agg(
    case
      when e.value->>'day' in ('sat', 'mon', 'wed') then e.value || jsonb_build_object('branchId', (select main from b))
      when e.value->>'day' in ('sun', 'tue', 'thu') then e.value || jsonb_build_object('branchId', (select rowad from b))
      else e.value
    end
  )
  from jsonb_array_elements(t.work_hours) e
)
where t.name = 'د. إسلام بلتاجي' and (select main from b) is not null and (select rowad from b) is not null;
