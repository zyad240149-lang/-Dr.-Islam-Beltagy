-- 140: القيم الافتراضية للتواريخ كانت current_date (توقيت UTC على الخادم) — أي سجل بيتعمل من 12 لـ 3 الفجر بتوقيت السعودية
-- (حجز من البوابة أو الموقع بالليل مثلًا) كان بياخد تاريخ اليوم اللي فات. باقي النظام بيستخدم riyadh_today().
alter table public.invoices alter column date set default riyadh_today();
alter table public.expenses alter column expense_date set default riyadh_today();
alter table public.treatment_plans alter column start_date set default riyadh_today();
alter table public.treatment_sessions alter column date set default riyadh_today();
alter table public.prescriptions alter column prescription_date set default riyadh_today();
alter table public.packages alter column start_date set default riyadh_today();
