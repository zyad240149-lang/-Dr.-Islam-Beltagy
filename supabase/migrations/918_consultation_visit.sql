-- 918: ربط التشخيص بالزيارة (الموعد اللي اتعمله حضور) — قائمة «بانتظار التشخيص» بتعتمد على حالة الحضور + تشخيص الزيارة نفسها.
-- الزيارة الواحدة ليها تشخيص واحد بس (فهرس فريد): الضغط المتكرر أو إعادة إرسال الطلب ما يعملوش تشخيص مكرر للزيارة.
-- حذف الموعد ما بيمسحش التشخيص (set null) — التاريخ المرضي بيفضل. الكشوفات القديمة من غير زيارة (null).
alter table ortho_consultations
  add column if not exists appointment_id uuid references appointments(id) on delete set null;
create unique index if not exists ortho_consultations_appointment_uq on ortho_consultations(appointment_id) where appointment_id is not null;
