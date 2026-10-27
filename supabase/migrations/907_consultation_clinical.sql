-- الكشف السريري لطبيب العظام: تاريخ مرضي، درجة الألم، كود ICD-10، روشتة أدوية، تحاليل، طلبات أشعة، صور أشعة مرفوعة، ميعاد متابعة
alter table ortho_consultations
  add column if not exists history text not null default '',
  add column if not exists pain_score smallint check (pain_score between 0 and 10),
  add column if not exists icd10 text not null default '',
  add column if not exists medications jsonb not null default '[]'::jsonb check (jsonb_typeof(medications) = 'array'),
  add column if not exists labs jsonb not null default '[]'::jsonb check (jsonb_typeof(labs) = 'array'),
  add column if not exists imaging_requests jsonb not null default '[]'::jsonb check (jsonb_typeof(imaging_requests) = 'array'),
  add column if not exists attachments jsonb not null default '[]'::jsonb check (jsonb_typeof(attachments) = 'array'),
  add column if not exists follow_up date;
