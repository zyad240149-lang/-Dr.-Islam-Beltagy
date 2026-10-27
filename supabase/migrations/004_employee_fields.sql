alter table employees add column if not exists work_hours jsonb not null default '[]';
