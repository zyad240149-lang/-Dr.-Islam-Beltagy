-- ٩/١١: تكملة 958 — أكتر من مريض في نفس الميعاد مع نفس الدكتور.
-- القيد الفريد (دكتور + يوم + ساعة) كان لسه بيرفض الحجز التاني بـ duplicate key. الفهرس العادي idx_appointments_doctor_day لسه موجود للسرعة.
drop index if exists public.uq_therapist_slot;
