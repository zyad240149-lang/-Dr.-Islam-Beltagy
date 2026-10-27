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
| `npm run test:e2e` | اختبارات التكامل الحقيقية على Supabase — `e2e.mjs` (أساسي) + `e2e-modules.mjs` (الأقسام) + `e2e-patient.mjs` (حساب المريض والحجز أونلاين)، بتنشئ بيانات اختبار وتمسحها |
| `node scripts/supabase-check.mjs` | فحص الاتصال بالمشروع |
| `node scripts/inventory.mjs` | إعادة توليد جرد الشاشات وجدول التتبع في `docs/` |

## النشر
1. `npm run build` ثم ارفع محتوى `dist/` على أي استضافة ملفات ثابتة (Cloudflare Pages / Netlify / Vercel).
2. اضبط على الاستضافة `VITE_SUPABASE_URL` و `VITE_SUPABASE_ANON_KEY` فقط (قبل البناء).
3. وجّه كل المسارات لـ `index.html` (SPA fallback).
4. في Supabase → Authentication → URL Configuration: أضف دومين الموقع.

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
