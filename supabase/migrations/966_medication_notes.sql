-- 966: ملاحظة افتراضية لكل دواء في البنك (مثال: «ممنوع النوم بعدها نص ساعة») — بتتنقل لعمود «ملاحظات» في الروشتة لما الدواء يتختار.
alter table ortho_medications add column if not exists notes text not null default '';
