# تقرير التسليم — الواتساب، شكوى المريض، الأشعة والتحاليل، الإملاء الصوتي، مواعيد المتابعات (هجرة 929)

## قاعدة البيانات — `supabase/migrations/929_whatsapp_complaint_files_followups.sql` (اتطبقت على المشروع)
كل التغييرات إضافات بس (`add column if not exists` / `create table if not exists`) — مفيش بيانات اتمسحت.

| الجدول | التغيير |
|---|---|
| `patients` | أعمدة جديدة: `phone2` (رقم إضافي)، `whatsapp_mode` (`phone` / `phone2` / `other` / `none` — الافتراضي `phone` = نفس السلوك القديم لكل المرضى الحاليين)، `whatsapp_phone` (رقم واتساب مستقل) |
| `ortho_consultations` | عمود `visit_reason` — «شكوى المريض / سبب الزيارة» (نص حر، فاضي افتراضيًا) |
| `patient_files` | أعمدة `category` (`xray` / `lab` / `other`)، `title` (اسم/وصف)، `file_date` (تاريخ الأشعة/التحليل) + فهرس |
| `ortho_follow_ups` (جديد) | المريض، التشخيص (`consultation_id`)، الطبيب (`doctor_id`)، التاريخ، الساعة، السبب، الملاحظات، الحالة (`scheduled` / `done` / `cancelled`)، الحجز المرتبط (`appointment_id`). RLS: القراءة لمن يرى المرضى، الإضافة/التعديل للطبيب أو الاستقبال، الحذف للمدير أو صلاحية حذف الجلسات. تريجرات تحديث الوقت + سجل التدقيق + مزامنة الأوفلاين |

«اليوم» و«فائتة» و«قادمة» بتتحسب من التاريخ (مش مخزنة) عشان ماتحتاجش مهمة مجدولة تحدّثها.

## الملفات
**جديدة:** `src/components/ContactFields.tsx` · `src/ortho/FollowUps.tsx` · `src/ortho/PatientMedicalFiles.tsx` · `scripts/e2e-followups.mjs` · `scripts/e2e-ui-followups.mjs`

**معدّلة:** `src/types/index.ts` · `src/data/remote.ts` · `src/data/db.ts` · `src/utils/format.ts` · `src/components/PatientForms.tsx` · `src/components/PatientExtras.tsx` · `src/components/DetailsHost.tsx` · `src/components/VoiceDictation.tsx` · `src/components/Layout.tsx` · `src/App.tsx` · `src/pages/PatientProfile.tsx` · `src/pages/Patients.tsx` · `src/ortho/data.ts` · `src/ortho/Consultations.tsx` · `src/ortho/DiagnosisTab.tsx` · `src/ortho/Diagnosis.tsx` · `src/offline/executors.ts` · `src/ortho/ortho.css` · `src/index.css` · `scripts/e2e-ui.mjs` · `package.json`

## الاختبارات (على Supabase الحقيقي — بيانات مؤقتة اتمسحت)
- `npm run test:followups` — قاعدة البيانات والصلاحيات: **29/29**
- `npm run test:ui-followups` — Edge حقيقي، الاستقبال والطبيب من الشاشات: **37/37** (البنود 1–15 كلها)
- `npm run test:ui` — كل صفحات كل الأدوار + صفحة «متابعات المرضى» + الموبايل: **215/215**
- `npm run test:e2e` (الاختبارات القديمة كلها + الجديد): 31/31 · 78/78 · 38/38 · 15/15 · 79/79 · 29/29
- `npm run test:diagnosis`: 42/44 — **فشل قديم مش من التعديلات دي**: نفس الفشل بيحصل على الكود المحفوظ في git قبل التعديلات (الاختبار متوقع 7 مناطق في «كشف الطبيب» ومتوقف عند خطوة الكاحل). محتاج تحديث للاختبار أو مراجعة لشاشة اختيار المناطق.
- `npm run test:unit` 28/28 · `npm run db:lint` 321 دالة — 0 خطأ · `npm run build` ناجح

## حدود معروفة
- **الإملاء الصوتي** بيعتمد على تعرّف الكلام في المتصفح (Chrome / Edge / Safari) — السرعة والدقة للهجة المصرية من خدمة المتصفح نفسها. الاختبار الآلي بيستخدم بديل للميكروفون؛ لازم تجربة بصوت حقيقي على الأجهزة.
- علامات الترقيم بتتكتب لما تتقال: «فاصلة»، «نقطة»، «نقطتين»، «علامة استفهام»، «علامة تعجب»، «سطر جديد» (وبالإنجليزي comma / period …). المتصفح نفسه مابيحطش ترقيم للعربي لوحده.
- المتصفح مابيسمحش لأي موقع يفتح صفحة إعدادات الأذونات مباشرة — النافذة بتعرض الخطوات حسب الجهاز والمتصفح، وبتتقفل لوحدها أول ما الإذن يتفعّل (Chrome/Edge).
- رفع الملفات محتاج إنترنت (زي المطلوب). مواعيد المتابعة بتتحفظ أوفلاين وبتتزامن بعدين زي باقي السجلات الطبية.
- «تحويل لحجز» بيفتح شاشة الحجز العادية بالمريض والطبيب والتاريخ والساعة؛ الحجز اللي يتعمل منها بيتربط بالمتابعة تلقائيًا.
- خانة «ميعاد المتابعة» القديمة (تاريخ بس) فوق الكشف لسه موجودة زي ما هي عشان ماتتغيرش الطباعة والقوايم الحالية.
