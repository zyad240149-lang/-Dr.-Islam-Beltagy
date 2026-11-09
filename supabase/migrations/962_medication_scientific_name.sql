-- 962: المادة الفعالة لأدوية البنك — عشان البحث بـ diclofenac مثلًا يجيب الأسماء التجارية.
alter table ortho_medications add column if not exists scientific_name text not null default '';
