-- يضيف نوع 'lab' (تحليل معملي) لجدول ortho_imaging عشان طلبات التحاليل تتتابع زي طلبات الأشعة بالظبط (مطلوبة ← وصلت ← تمت القراءة)
-- وعمود attachments لإرفاق نتيجة الأشعة/التحليل (ملف أو صورة) بمجرد ما توصل
alter table ortho_imaging drop constraint if exists ortho_imaging_kind_check;
alter table ortho_imaging add constraint ortho_imaging_kind_check check (kind in ('xray', 'mri', 'ct', 'dexa', 'us', 'lab'));
alter table ortho_imaging add column if not exists attachments jsonb not null default '[]'::jsonb;
