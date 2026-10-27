-- شيت الكشف الرقمي (شيت التمريض + شيت كشف الورك والركبة + أماكن الألم على خريطة الجسم): كل الاختيارات بتتخزن هنا،
-- والملخص النصي بيتكتب في complaint/history/examination/diagnosis زي الأول (القوايم والروشتة وسجل المريض شغالين بيه)
alter table ortho_consultations
  add column if not exists sheet jsonb not null default '{}'::jsonb check (jsonb_typeof(sheet) = 'object');
