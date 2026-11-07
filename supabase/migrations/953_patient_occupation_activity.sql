-- 953: الوظيفة والنشاط البدني في «البيانات الأساسية» لملف المريض (نفس اختيارات خانة 1 في الكشف، أكتر من اختيار)
alter table patients add column if not exists occupation text[] not null default '{}';
alter table patients add column if not exists activity text[] not null default '{}';
