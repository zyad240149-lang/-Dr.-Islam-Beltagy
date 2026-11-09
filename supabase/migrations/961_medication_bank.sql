-- 961: بنك الأدوية — كل الأدوية في البنك، و shown بتحدد اللي يظهر قدام الطبيب في الروشتة.
-- الافتراضي true عشان كل الأدوية الموجودة تفضل ظاهرة زي ما هي.
alter table ortho_medications add column if not exists shown boolean not null default true;
