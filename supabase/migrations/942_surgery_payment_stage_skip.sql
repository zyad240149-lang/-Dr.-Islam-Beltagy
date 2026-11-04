-- 942: تخطي مرحلة دفع. الدفعة المتخطاة مابتتحسبش في إجمالي الخطة.
alter table ortho_surgery_payment_stages
  add column if not exists status text not null default 'pending' check (status in ('pending', 'skipped'));
