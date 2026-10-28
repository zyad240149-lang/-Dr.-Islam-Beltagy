-- 921: (1) تذكير المواعيد قبل الموعد بـ 4 و2 و1 ساعة (بدل 4/3/2/1) — طلب العيادة.
--          التذكيرات المجدولة بتاعة «3 ساعات» اللي لسه ما اتبعتتش بتتلغي، والباقي زي ما هو (مفيش إعادة إرسال لحاجة اتبعتت).
--      (2) الخدمة الجديدة «إدارة فقط» افتراضيًا — ما بتظهرش للحجز الإلكتروني غير لما المدير يفعّلها صراحةً.
--          الخدمات الموجودة ما اتلمستش (الحجز الإلكتروني الشغّال ما بيقفش)، والتعديل ما بيغيّرش الظهور (save_service بيحتفظ بالقيمة).
alter table notification_prefs alter column reminder_offsets set default '{4,2,1}';
update notification_prefs set reminder_offsets = '{4,2,1}' where reminder_offsets = '{4,3,2,1}';
update notification_schedule
   set status = 'cancelled', processed_at = now(), cancel_reason = 'تغيّرت إعدادات التذكير (4 و2 و1 ساعة)'
 where status = 'pending' and offset_minutes = 180;

alter table services alter column show_on_site set default false;
-- نفس القاعدة على الخادم: خدمة جديدة من غير showOnSite صريح = إدارة فقط (حتى لو الطلب جه مباشر من برّه الواجهة)
do $$
declare def text;
begin
  select pg_get_functiondef('public.save_service(jsonb)'::regprocedure) into def;
  if position('coalesce((p->>''showOnSite'')::boolean, true)' in def) > 0 then
    execute replace(def, 'coalesce((p->>''showOnSite'')::boolean, true)', 'coalesce((p->>''showOnSite'')::boolean, false)');
  end if;
end $$;
