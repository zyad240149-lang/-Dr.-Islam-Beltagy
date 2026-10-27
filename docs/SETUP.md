# التشغيل والنشر — عيادة د. إسلام بلتاجي

## المكوّنات
- **الواجهة:** React 18 + TypeScript + Vite (`src/`)، عربي RTL، PWA.
- **الخادم:** Supabase (Postgres 17 + Auth + Storage + Edge Functions + pg_cron) — مشروع `jdhnxfhwwszxykizrahb` (eu-west-1).
- **قاعدة البيانات:** `supabase/migrations/` (000 → 902) — كل منطق العمل (الحجز، الفواتير، الصلاحيات) داخل دوال RPC وسياسات RLS.
- **Edge Function `api`:** `supabase/functions/api/index.ts` — `/api/me`، إدارة حسابات الموظفين، و`/api/register` (إنشاء حساب مريض من الموقع) — إنشاء حساب دخول يحتاج service_role، فمكانه الخادم بس.

## التشغيل محليًا
```bash
npm install
cp .env.example .env   # واملا القيم
npm run dev            # http://127.0.0.1:4660
```

## الأوامر
| الأمر | الوظيفة |
|---|---|
| `npm run build` | فحص الأنواع + بناء الإنتاج في `dist/` |
| `node scripts/db-migrate.mjs` | تطبيق الهجرات اللي لسه ماتطبقتش (بيسجّلها في `_migrations`) |
| `node scripts/db-migrate.mjs --dry` | عرض الهجرات المعلّقة بدون تطبيق |
| `node scripts/deploy-function.mjs` | نشر Edge Function `api` |
| `node scripts/create-admin.mjs 01xxxxxxxxx <password> "الاسم"` | إنشاء مدير نظام (مرة واحدة على مشروع جديد) |
| `npm run test:e2e` | اختبارات التكامل الحقيقية على Supabase — `e2e.mjs` (أساسي) + `e2e-modules.mjs` (الباقات/المنتجات/الولاء/الرواتب) + `e2e-patient.mjs` (حساب المريض والحجز أونلاين) + `e2e-consult.mjs` (الكشف والروشتة) + `e2e-sections.mjs` (تضارب المواعيد، أيام الإغلاق والإجازات، الخدمات، الخطط، الخصم، الدعم، الطلبات، الأشعة والكسور والعمليات، التقارير، «سجلي الطبي»)، بتنشئ بيانات اختبار وتمسحها |
| `npm run test:ui` | اختبار الواجهة في Microsoft Edge (playwright-core): دخول كل دور (مدير/استقبال/محاسب/طبيب/مريض) من شاشة الدخول وفتح كل صفحة — من غير شاشة خطأ ولا أخطاء JavaScript ولا سكرول عرضي على الموبايل، والخط متحمّل. صور أي فشل في `docs/ui-failures/` |
| `npm run db:lint` | فحص ثابت لكل دوال القاعدة (plpgsql_check، بيتركّب مؤقتًا): عمود/جدول/دالة مش موجودة أو نوع غلط |
| `npm run test:all` | الثلاثة ورا بعض |
| `node scripts/supabase-check.mjs` | فحص الاتصال بالمشروع |
| `node scripts/inventory.mjs` | إعادة توليد جرد الشاشات وجدول التتبع في `docs/` |

## النشر (Cloudflare Pages)
الموقع المنشور: **https://beltagy-ortho.pages.dev**

`npm run deploy` (`scripts/deploy-pages.mjs`): بيبني، يتأكد إن مفيش مفتاح سري (service_role / access token / توكن Cloudflare) جوّه `dist/`، يعمل مشروع `beltagy-ortho` لو مش موجود، ويرفع بـ wrangler. محتاج `CLOUDFLARE_API_TOKEN` في `.env` (صلاحية Pages).
- كل المسارات بتفتح `index.html` تلقائي (مفيش `404.html` ← Pages بيعتبره SPA).
- `public/_headers`: هيدرز أمان + تخزين ملفات `assets/` سنة (اسمها فيه هاش).
- اختبار الموقع المنشور نفسه: `UI_BASE=https://beltagy-ortho.pages.dev node scripts/e2e-ui.mjs`.
- **مطلوب مرة واحدة (يدوي):** Supabase → Authentication → URL Configuration: Site URL = `https://beltagy-ortho.pages.dev` (حاليًا localhost). الدخول بالموبايل وكلمة المرور شغال من غيرها، بس لازمة لأي لينك بيتبعت بالإيميل مستقبلًا.
- دومين خاص: Cloudflare → Pages → beltagy-ortho → Custom domains، وبعدها ضيفه في Supabase بنفس الطريقة.

## النسخ الاحتياطي والاسترجاع
- الخطة المجانية: نسخة يومية تلقائية بتتحفظ 7 أيام (Database → Backups). الاسترجاع من نفس الصفحة.
- نسخة يدوية قبل أي هجرة خطرة: `pg_dump` بسلسلة الاتصال من Project Settings → Database.
- **ممنوع** تشغيل هجرة فيها `drop`/`truncate` على بيانات حقيقية بدون نسخة احتياطية متأكد منها.

## الرجوع عن هجرة (Rollback)
الهجرات مش بتتعكس تلقائيًا. للرجوع: اكتب هجرة جديدة بتعكس التغيير (مثلاً `create trigger` لو اتشال بـ 901)،
أو استرجع النسخة الاحتياطية اليومية. الهجرات 900–902 هي الخاصة بالعيادة؛ 000–198 هي الأساس.

## الأمان — مطلوب منك
- **غيّر مفتاح service_role و access token** (اتبعتوا في المحادثة): Project Settings → API → Roll، و Account → Access Tokens → Revoke. وحدّث `.env`.
- غيّر كلمة مرور المدير الأولى من «حسابي» بعد أول دخول.
- `SUPABASE_SERVICE_ROLE_KEY` و `SUPABASE_ACCESS_TOKEN` لازم يفضلوا خارج أي متغير `VITE_` (اتأكدنا إنهم مش في `dist/`).

## الوضع بدون إنترنت
الواجهة فيها طابور عمليات أوفلاين (IndexedDB — `src/offline/`) لإضافة المرضى والحجز والإلغاء، وبيتزامن لما الاتصال يرجع،
والخادم بيمنع التكرار (`offline_book_appointment` بمفتاح فريد). **ملاحظة:** خدمة التشغيل بدون إنترنت (Service Worker) شغالة في نسخة الإنتاج بس.
