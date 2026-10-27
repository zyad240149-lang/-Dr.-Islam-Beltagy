-- حقول إضافية لبيانات المركز مطلوبة لطباعة فاتورة ضريبية مبسّطة مطابقة للنموذج الرسمي
-- (رقم السجل التجاري، رقم المبنى، الرمز البريدي) — الباقي (الرقم الضريبي/نسبة الضريبة) موجود من قبل.
alter table center_info add column if not exists cr_number text not null default '';
alter table center_info add column if not exists building_no text not null default '';
alter table center_info add column if not exists postal_code text not null default '';
