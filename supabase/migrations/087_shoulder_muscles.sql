-- MMT: عضلات حركات الكتف (Shoulder Flexor وغيره) في قائمة Muscle Assessment — مع خيار «Other» الموجود (يظهر حقل نصي).
insert into physio_muscles (name, sort)
select v.name, (select coalesce(max(sort), 0) from physio_muscles) + v.o from (values
  ('Shoulder Flexors', 1), ('Shoulder Extensors', 2), ('Shoulder Abductors', 3), ('Shoulder Adductors', 4),
  ('Shoulder Internal Rotators', 5), ('Shoulder External Rotators', 6)) as v(name, o)
where not exists (select 1 from physio_muscles m where lower(trim(m.name)) = lower(v.name));
