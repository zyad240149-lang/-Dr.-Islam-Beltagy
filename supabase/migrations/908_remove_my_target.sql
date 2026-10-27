-- إلغاء «تارجتي» (لوحة الأخصائي الشخصية) من كل الأقسام: الصلاحية، الدالة، وإشعارات نسب التارجت اللي كانت بتفتح الصفحة دي.
-- «الرواتب والتارجت» للمدير العام فاضلة زي ما هي.
delete from role_permissions where area = 'mytarget';
revoke execute on function my_target(text) from authenticated;

select cron.unschedule(jobid) from cron.job where jobname = 'notifications-targets';
delete from notification_kinds where kind in ('target_progress', 'target_reached');
