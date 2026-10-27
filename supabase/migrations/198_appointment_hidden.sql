-- إخفاء موعد من قوائم الواجهة بدون إلغائه (السجل والفاتورة والحسابات تفضل زي ما هي)
alter table appointments add column if not exists hidden boolean not null default false;
update appointments set hidden = true where id = 'f09a1e03-1212-4b9d-8b25-fb2b9461b706';
