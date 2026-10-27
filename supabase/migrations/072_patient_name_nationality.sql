-- ملف المريض: الجنسية (سعودي/غير سعودي) + الاسم مقسّم (الاسم / اسم الأب / العائلة).
-- full_name فاضل زي ما هو (الاسم الكامل = الأجزاء مع بعض) عشان كل الشاشات والتقارير والبحث يفضلوا شغالين.
alter table patients add column if not exists nationality text not null default 'saudi' check (nationality in ('saudi', 'non_saudi'));
alter table patients add column if not exists first_name text not null default '';
alter table patients add column if not exists father_name text not null default '';
alter table patients add column if not exists family_name text not null default '';
-- رقم الأحوال (سعودي) يبدأ بـ 1، ورقم الإقامة (غير سعودي) يبدأ بـ 2 — 10 أرقام
alter table patients drop constraint if exists patients_national_id_format;
alter table patients add constraint patients_national_id_format check (
  coalesce(national_id, '') = '' or (national_id ~ '^\d{10}$' and (
    (nationality = 'saudi' and national_id like '1%') or (nationality = 'non_saudi' and national_id like '2%')))) not valid;
