-- 904: قيد شكل رقم الهوية على جدول المرضى — مصري بدل سعودي (نفس قاعدة patient_missing_fields في 903)
--  • saudi (= مصري): الرقم القومي 14 رقم يبدأ بـ 2 أو 3
--  • non_saudi (= أجنبي): رقم جواز السفر 6–20 حرف/رقم إنجليزي
--  • فاضي مسموح (الملف بيبقى «غير مكتمل» لحد ما يتكتب)
alter table patients drop constraint if exists patients_national_id_format;
alter table patients add constraint patients_national_id_format check (
  coalesce(national_id, '') = ''
  or (nationality = 'saudi' and national_id ~ '^[23][0-9]{13}$')
  or (nationality = 'non_saudi' and national_id ~ '^[A-Za-z0-9]{6,20}$')
);
