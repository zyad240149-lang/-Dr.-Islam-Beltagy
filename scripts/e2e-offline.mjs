// اختبار Offline-First كامل في متصفح حقيقي (Microsoft Edge) على نسخة الإنتاج (Service Worker شغال) وقاعدة Supabase الحقيقية.
// بيزرع 9,000 مريض اختبار، وبيعمل «انقطاع إنترنت» حقيقي: بيوقف سيرفر الموقع نفسه + بيقطع شبكة المتصفح، وبيقفل التطبيق ويفتحه
// (بروفايل متصفح ثابت = نفس IndexedDB والكاش والـ Service Worker زي الجهاز الحقيقي). كل نتيجة مزامنة بتتأكد من القاعدة نفسها.
// كل البيانات بتتمسح في الآخر.
//   npm run build && node scripts/e2e-offline.mjs
import { mkdtempSync, rmSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';
import { preview } from 'vite';
import { launchEdge } from './_edge.mjs';
import { allDayHours, api, deleteEmployee, env, loginAdmin, randomPassword, sql, suite, URL_ } from './_harness.mjs';

const { check, section, save } = suite();
const ROOT = fileURLToPath(new URL('..', import.meta.url));
const PORT = 4690, BASE = `http://127.0.0.1:${PORT}`;
const PW = randomPassword();
const SEED = 9000;
const L = 'ابتثجحخدذر'; // أرقام ← حروف (الأسماء لازم تبقى عربي بس)
const enc = (n) => String(n).split('').map((d) => L[d]).join('');
const seedName = (i) => `مريض ${enc(i)} اختبار`;
const ADMIN = { phone: '01200000981', digits: '201200000981', name: 'مدير أوفلاين اختبار' };
const NEW1 = { first: 'سامي', father: 'منقطع', family: 'اختبار', phone: '01200000989' };
const NEW2 = { first: 'رامي', father: 'ضائع', family: 'اختبار', phone: '01200000988' };
const made = { employees: [], seeded: false, consult: null };
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const until = async (f, ms = 60000, every = 500) => { const t = Date.now(); for (;;) { const v = await f().catch(() => null); if (v) return v; if (Date.now() - t > ms) return null; await sleep(every); } };

let server = null;
const startServer = async () => { server = await preview({ root: ROOT, configFile: join(ROOT, 'vite.config.ts'), logLevel: 'error', preview: { port: PORT, strictPort: true, host: '127.0.0.1' } }); };
const stopServer = async () => { if (server) { await server.close(); server = null; } };

// قراءة IndexedDB من جوّه الصفحة: حالة النسخة + الطابور + هل جدول المرضى متشفّر فعلًا
const idb = (page) => page.evaluate(() => new Promise((resolve) => {
  const r = indexedDB.open('ortho-offline');
  r.onerror = () => resolve(null);
  r.onsuccess = () => {
    const d = r.result;
    if (!d.objectStoreNames.contains('kv')) { resolve({ meta: null, ops: [], key: false }); return; }
    const tx = d.transaction(['kv', 'ops'], 'readonly');
    const out = {};
    tx.objectStore('kv').get('snap:meta').onsuccess = (e) => { out.meta = e.target.result ?? null; };
    tx.objectStore('kv').get('snap:t:patients').onsuccess = (e) => { const v = e.target.result; out.sealed = !!(v && v.v === 1 && v.ct instanceof ArrayBuffer); out.plainLeak = v ? new TextDecoder().decode(v.ct ?? new ArrayBuffer(0)).includes('مريض') : false; };
    tx.objectStore('kv').get('device-key').onsuccess = (e) => { const k = e.target.result; out.key = !!k; out.keyExtractable = k ? k.extractable : null; };
    tx.objectStore('ops').getAll().onsuccess = (e) => { out.ops = (e.target.result ?? []).map((o) => ({ kind: o.kind, status: o.status, entityId: o.entityId, lastError: o.lastError })); };
    tx.oncomplete = () => resolve(out);
  };
}));
const patientCount = async () => (await sql(`select count(*)::int n from patients`))[0].n;

let ctx = null;
let edgeApp = null;
let lastPage = null; // لصورة الشاشة لو حصل خطأ غير متوقع
const profile = mkdtempSync(join(tmpdir(), 'ortho-offline-'));
const openApp = async (offlineMode) => {
  edgeApp = await launchEdge({ userDataDir: profile });
  ctx = edgeApp.contexts()[0];
  if (offlineMode) await ctx.setOffline(true);
  const page = ctx.pages()[0] ?? await ctx.newPage();
  await page.setViewportSize({ width: 1366, height: 860 });
  page.errors = [];
  page.on('pageerror', (e) => page.errors.push(e.message));
  lastPage = page;
  return page;
};
const closeApp = async () => { await edgeApp?.close(); edgeApp = null; ctx = null; };
const goOffline = async () => { await stopServer(); await ctx?.setOffline(true); };
const goOnline = async () => { await startServer(); await ctx?.setOffline(false); };
const searchPatients = async (page, q) => {
  await page.fill('#pt-q', q);
  const t = Date.now();
  const row = page.locator('tr', { hasText: q }).first();
  const ok = await row.waitFor({ timeout: 15000 }).then(() => true).catch(() => false);
  return { ok, ms: Date.now() - t - 400, row }; // البحث بيتأخر 400ms عمدًا لحد ما تخلص كتابة (debounce)
};
const nav = (page, path) => page.evaluate((p) => { window.history.pushState({}, '', p); window.dispatchEvent(new PopStateEvent('popstate')); }, path);

try {
  section('التجهيز: حساب مدير + 9,000 مريض + كشف ببيانات طبية + نسخة إنتاج');
  const admin = await loginAdmin();
  const r = await api(admin, 'POST', 'staff', { name: ADMIN.name, phone: ADMIN.phone, country: 'EG', password: PW, role: 'system_admin', workHours: allDayHours() });
  if (r.body?.id) made.employees.push(r.body.id);
  check('حساب مدير مؤقت', r.status === 201, JSON.stringify(r.body).slice(0, 100));
  // وضع الاستيراد الرسمي (هجرات 145/150): مفيش 9,000 إشعار للموظفين ولا فحص تكرار صف بصف. رقم الملف بحروف (مايأثرش على ترقيم الملفات الحقيقي)
  made.seeded = true;
  await sql(`select set_config('app.legacy_import', 'on', true), set_config('app.import_mode', 'on', true);
    insert into patients (full_name, first_name, father_name, family_name, phone, gender, nationality, national_id, referral_source, file_no, registered_at)
    select 'مريض ' || translate(i::text, '0123456789', '${L}') || ' اختبار', 'مريض', translate(i::text, '0123456789', '${L}'), 'اختبار',
           '+2015' || lpad(i::text, 8, '0'), 'male', 'saudi', '', 'friend', 'اختبار-' || translate(i::text, '0123456789', '${L}'), now() - (i || ' minutes')::interval
    from generate_series(1, ${SEED}) i;`);
  const [{ id: p4321 }] = await sql(`select id from patients where full_name = '${seedName(4321)}'`);
  made.consult = (await sql(`insert into ortho_consultations (patient_id, complaint, region, side, diagnosis, plan, medications, follow_up)
    values ('${p4321}', 'ألم ركبة اختبار', 'الركبة', 'right', 'تمزق غضروف هلالي اختبار', 'راحة', '[{"name":"Celebrex 200mg","dose":"قرص","frequency":"مرتين","duration":"5 أيام","notes":""}]', current_date + 10) returning id`))[0].id;
  const total = await patientCount();
  const visible = (await sql(`select count(*)::int n from patients where not is_guest`))[0].n;
  check(`اتزرع ${SEED.toLocaleString('en')} مريض (الإجمالي ${total.toLocaleString('en')})`, total >= SEED, total);
  const manifest = JSON.parse(readFileSync(join(ROOT, 'dist/precache-manifest.json'), 'utf8'));
  check('نسخة الإنتاج متبنية ومعاها قايمة ملفات الأوفلاين', manifest.files.length > 50, manifest.files.length);
  await startServer();

  // ============ 1) أول دخول + تنزيل كل المرضى ============
  section('1) أول دخول بإنترنت + تنزيل كل المرضى على الجهاز');
  let page = await openApp(false);
  await page.goto(BASE + '/login');
  await page.fill('#al-phone', ADMIN.phone); await page.fill('#al-pass', PW); await page.click('button[type=submit]');
  check('الدخول بإنترنت', await page.waitForURL((u) => u.pathname === '/', { timeout: 60000 }).then(() => true).catch(() => false), page.url());
  const t0 = Date.now();
  const meta1 = await until(async () => { const s = await idb(page); return s?.meta?.sync?.patients?.complete && s.meta.sync.patients.rows === total ? s : null; }, 180000, 1000);
  check(`كل المرضى اتنزّلوا: ${meta1?.meta.sync.patients.rows?.toLocaleString('en')} على الجهاز = ${meta1?.meta.sync.patients.serverCount?.toLocaleString('en')} على الخادم`, !!meta1, JSON.stringify((await idb(page))?.meta?.sync?.patients));
  check(`زمن التنزيل الكامل + الحفظ المشفّر: ${((Date.now() - t0) / 1000).toFixed(1)} ثانية`, !!meta1);
  check('النسخة على الجهاز متشفّرة (AES-GCM) ومفتاحها مايتصدرش', meta1?.meta.encrypted && meta1.sealed && !meta1.plainLeak && meta1.keyExtractable === false, JSON.stringify({ e: meta1?.meta.encrypted, s: meta1?.sealed, leak: meta1?.plainLeak, x: meta1?.keyExtractable }));
  check('السجل الطبي (الكشوفات) اتنزّل مع البيانات', (meta1?.meta.tables ?? []).includes('ortho'), JSON.stringify(meta1?.meta.tables));
  const swOk = await until(() => page.evaluate(async () => {
    const reg = await navigator.serviceWorker.getRegistration(); if (!reg?.active) return null;
    const m = await (await fetch('/precache-manifest.json')).json();
    let n = 0; for (const k of await caches.keys()) if (k.startsWith('ortho-assets')) n += (await (await caches.open(k)).keys()).length;
    return n >= m.files.length ? { n, need: m.files.length } : null;
  }), 90000, 1000);
  check(`الـ Service Worker خزّن كل ملفات التطبيق (${swOk?.n ?? 0} ملف)`, !!swOk);
  await closeApp();

  // ============ 2) فتح بدون إنترنت + بحث + فتح ملف ============
  section('2) قفل التطبيق وفتحه بدون إنترنت (السيرفر واقف + الشبكة مقطوعة)');
  await stopServer();
  page = await openApp(true);
  await page.goto(BASE + '/patients').catch(() => {});
  const shown = await until(async () => (await page.locator('text=بدون اتصال بالخادم').count()) > 0, 45000);
  check('التطبيق فتح بدون إنترنت من الجهاز وقايمة المرضى جاية من النسخة المحلية', !!shown, (await page.locator('body').innerText().catch(() => '')).slice(0, 200));
  const headTotal = await page.locator('.page-head p').first().innerText().catch(() => '');
  check(`كل المرضى ظاهرين بدون إنترنت (${visible.toLocaleString('en')})`, headTotal.replace(/\D/g, '') === String(visible), headTotal);
  const s1 = await searchPatients(page, seedName(4321));
  check(`بحث بالاسم عن مريض قديم من ${SEED.toLocaleString('en')} بدون إنترنت (${Math.max(0, s1.ms)}ms)`, s1.ok);
  const s2 = await searchPatients(page, '01500001234');
  check('بحث برقم الموبايل بدون إنترنت', s2.ok || (await page.locator('tr', { hasText: seedName(1234) }).count()) > 0);
  await searchPatients(page, seedName(4321));
  await page.locator('tr', { hasText: seedName(4321) }).first().getByRole('button', { name: 'عرض الملف' }).click();
  const prof = await until(async () => page.url().includes(p4321) && (await page.locator('.page', { hasText: seedName(4321) }).count()) > 0, 20000);
  check('فتح ملف المريض بدون إنترنت', !!prof, page.url());
  await nav(page, '/consultations');
  const dx = await until(async () => (await page.locator('text=تمزق غضروف هلالي اختبار').count()) > 0, 20000);
  check('التشخيص والروشتة ظاهرين بدون إنترنت', !!dx);
  await nav(page, '/work-hours');
  const unvisited = await until(async () => (await page.locator('.page h1', { hasText: 'مواعيد العمل' }).count()) > 0, 20000);
  check('صفحة ما اتفتحتش قبل كده بتفتح بدون إنترنت (ملفاتها متخزّنة مسبقًا)', !!unvisited);

  // ============ 3) إضافة وتعديل بدون إنترنت ============
  section('3) إضافة مريض وتعديل مرضى بدون إنترنت');
  await nav(page, '/patients');
  await page.getByRole('button', { name: 'فتح ملف مريض جديد' }).click();
  await page.fill('#np-first', NEW1.first); await page.fill('#np-father', NEW1.father); await page.fill('#np-family', NEW1.family);
  await page.fill('#np-phone', NEW1.phone);
  await page.locator('.modal').getByRole('button', { name: 'حفظ', exact: true }).click();
  const newName = `${NEW1.first} ${NEW1.father} ${NEW1.family}`;
  // بعد الحفظ التطبيق بيفتح ملف المريض الجديد (من الجهاز — لسه ماوصلش الخادم)
  const opened = await until(async () => /\/patients\/[0-9a-f-]{36}$/.test(new URL(page.url()).pathname) && (await page.locator('.page', { hasText: newName }).count()) > 0, 20000);
  check('ملف المريض الجديد اتفتح بعد الحفظ بدون إنترنت', !!opened, page.url());
  await nav(page, '/patients');
  const s3 = await searchPatients(page, newName);
  check('المريض الجديد ظاهر في القايمة فورًا (من غير الخادم)', s3.ok);
  check('ومعلّم «بانتظار المزامنة»', (await page.locator('tr', { hasText: newName }).locator('text=بانتظار المزامنة').count()) > 0);
  let st = await idb(page);
  check('اتحفظ في طابور المزامنة على الجهاز (IndexedDB)', st.ops.some((o) => o.kind === 'patient.create'), JSON.stringify(st.ops));
  const editFamily = async (name, family) => {
    await searchPatients(page, name);
    await page.locator('tr', { hasText: name }).first().getByRole('button', { name: 'تعديل' }).click();
    await page.fill('#ep-family', family);
    await page.locator('.modal').getByRole('button', { name: 'حفظ', exact: true }).click();
    await page.locator('.modal').waitFor({ state: 'detached', timeout: 10000 }).catch(() => {});
  };
  await editFamily(seedName(4321), 'معدلب');
  await editFamily(seedName(1234), 'جهاز');
  st = await idb(page);
  check('تعديلين بدون إنترنت في الطابور', st.ops.filter((o) => o.kind === 'patient.update').length === 2, JSON.stringify(st.ops));
  // جهاز تاني (أونلاين) غيّر نفس المريض على الخادم
  await sql(`update patients set family_name = 'سيرفر', full_name = 'مريض ${enc(1234)} سيرفر' where full_name = '${seedName(1234)}'`);
  await closeApp();

  section('4) قفل التطبيق قبل رجوع الإنترنت وفتحه تاني');
  page = await openApp(true);
  await page.goto(BASE + '/patients').catch(() => {});
  await until(async () => (await page.locator('text=بدون اتصال بالخادم').count()) > 0, 45000);
  const s4 = await searchPatients(page, newName);
  check('المريض اللي اتضاف أوفلاين لسه موجود بعد إعادة الفتح', s4.ok);
  st = await idb(page);
  check('الطابور (3 عمليات) لسه محفوظ بعد إعادة الفتح', st.ops.length === 3, JSON.stringify(st.ops));
  check('الخادم لسه ماوصلهوش حاجة', (await sql(`select count(*)::int n from patients where full_name = '${newName}'`))[0].n === 0);

  // ============ 5) رجوع الإنترنت ← مزامنة تلقائية ============
  section('5) رجوع الإنترنت ← مزامنة تلقائية (من غير ضغط أي زرار)');
  await goOnline();
  const synced = await until(async () => (await sql(`select count(*)::int n from patients where full_name = '${newName}'`))[0].n === 1, 90000, 1500);
  check('المريض الجديد وصل الخادم تلقائيًا', !!synced);
  const [srv] = await sql(`select id, file_no from patients where full_name = '${newName}'`);
  check('بنفس المعرّف اللي اتعمل على الجهاز (مفيش ملف تاني)', srv && (await sql(`select count(*)::int n from patients where phone like '%${NEW1.phone.slice(-9)}'`))[0].n === 1, JSON.stringify(srv));
  const edited = await until(async () => (await sql(`select family_name from patients where id = '${p4321}'`))[0]?.family_name === 'معدلب', 60000, 1500);
  check('التعديل الأوفلاين وصل الخادم', !!edited);
  st = await until(async () => { const x = await idb(page); return x.ops.length === 1 && x.ops[0].status === 'conflict' ? x : null; }, 60000);
  check('تعديل نفس المريض من جهازين ← «تعارض» مستني قرار (مفيش كتابة فوق تعديل الجهاز التاني)', !!st, JSON.stringify((await idb(page)).ops));
  check('قيمة الجهاز التاني على الخادم ماتلمستش', (await sql(`select family_name from patients where phone = '+201500001234'`))[0]?.family_name === 'سيرفر');
  await page.locator('.offline-badge:visible').first().click();
  await page.getByRole('button', { name: 'استخدم تعديلي' }).click();
  const resolved = await until(async () => (await sql(`select family_name from patients where phone = '+201500001234'`))[0]?.family_name === 'جهاز', 30000, 1000);
  check('بعد قرار «استخدم تعديلي» اتكتب تعديل الجهاز', !!resolved);
  await page.keyboard.press('Escape');
  const pendingTag = await until(async () => { await nav(page, '/patients'); const r = await searchPatients(page, newName); return r.ok && (await page.locator('tr', { hasText: newName }).locator('text=بانتظار المزامنة').count()) === 0; }, 30000, 2000);
  check('علامة «بانتظار المزامنة» اتشالت ورقم الملف الحقيقي ظهر', !!pendingTag && (await page.locator('tr', { hasText: newName }).innerText()).includes(String(srv?.file_no ?? '').replace(/\D/g, '')));

  // ============ 6) تغييرات الخادم ← الجهاز (تزايدي + حذف) ============
  section('6) تغييرات على الخادم بتنزل للجهاز (اللي اتغيّر بس + المحذوف)');
  await sql(`update patients set family_name = 'خادم', full_name = 'مريض ${enc(777)} خادم' where full_name = '${seedName(777)}'`);
  await sql(`delete from patients where full_name = '${seedName(888)}'`);
  await page.reload();
  const inc = await until(async () => { const x = await idb(page); const p = x?.meta?.sync?.patients; return p && p.mode === 'incremental' && p.complete && p.rows === (await patientCount()) && x.meta.savedAt > Date.now() - 60000 ? p : null; }, 90000, 1500);
  check('المزامنة بعد الفتح «تزايدية» (اللي اتغيّر بس) ومكتملة', !!inc, JSON.stringify((await idb(page))?.meta?.sync?.patients));
  await closeApp(); await stopServer();
  page = await openApp(true);
  await page.goto(BASE + '/patients').catch(() => {});
  await until(async () => (await page.locator('text=بدون اتصال بالخادم').count()) > 0, 45000);
  check('تعديل الخادم موجود على الجهاز (بدون إنترنت)', (await searchPatients(page, `مريض ${enc(777)} خادم`)).ok);
  await page.fill('#pt-q', seedName(888)); await sleep(1500);
  check('المريض اللي اتحذف من الخادم اتشال من الجهاز', (await page.locator('tr', { hasText: seedName(888) }).count()) === 0);
  check('مفيش أخطاء JavaScript طول السيناريو', page.errors.length === 0, page.errors.join(' | ').slice(0, 300));
  await closeApp();

  // ============ 7) فشل الخادم + ضياع الرد بعد ما الخادم حفظ ============
  section('7) فشل الخادم مؤقتًا + انقطاع الاتصال بعد ما الخادم حفظ (من غير تكرار)');
  await startServer();
  const ctx2 = await launchEdge().then((b) => b.newContext({ viewport: { width: 1366, height: 860 }, locale: 'ar-EG', serviceWorkers: 'block' }));
  const p2 = await ctx2.newPage();
  lastPage = p2;
  let attempt = 0, armed = false, early = 0;
  await ctx2.route('**/rest/v1/patients**', async (route) => {
    if (route.request().method() !== 'POST') return route.continue();
    if (!armed) { early++; return route.continue(); }
    attempt++;
    if (attempt === 1) return route.fulfill({ status: 503, body: '{"message":"service unavailable"}', contentType: 'application/json' }); // الخادم واقع
    if (attempt === 2) { await route.fetch(); return route.abort('connectionreset'); }                                                  // الخادم حفظ والرد ضاع
    return route.continue();
  });
  await p2.goto(BASE + '/login');
  await p2.fill('#al-phone', ADMIN.phone); await p2.fill('#al-pass', PW); await p2.click('button[type=submit]');
  await p2.waitForURL((u) => u.pathname === '/', { timeout: 60000 });
  await until(async () => (await idb(p2))?.meta?.sync?.patients?.complete, 180000, 1000);
  // الـ Service Worker مقفول في الجلسة دي (عشان اعتراض الطلبات يشتغل)، فملفات صفحة المرضى لازم تتحمّل قبل ما الشبكة تقطع
  await nav(p2, `/patients/${p4321}`);
  await p2.waitForSelector('.page h1', { timeout: 30000 });
  await nav(p2, '/patients');
  await p2.waitForSelector('#pt-q', { timeout: 30000 });
  await ctx2.setOffline(true);
  await p2.evaluate(() => window.dispatchEvent(new Event('offline')));
  await p2.getByRole('button', { name: 'فتح ملف مريض جديد' }).click();
  await p2.fill('#np-first', NEW2.first); await p2.fill('#np-father', NEW2.father); await p2.fill('#np-family', NEW2.family); await p2.fill('#np-phone', NEW2.phone);
  await p2.locator('.modal').getByRole('button', { name: 'حفظ', exact: true }).click();
  const queued = await until(async () => (await idb(p2)).ops.some((o) => o.kind === 'patient.create'), 10000);
  check('المريض اتحفظ في الطابور وهو بدون إنترنت', !!queued, `early POSTs=${early}`);
  await nav(p2, '/patients');
  armed = true;
  await ctx2.setOffline(false);
  await p2.evaluate(() => window.dispatchEvent(new Event('online')));
  const name2 = `${NEW2.first} ${NEW2.father} ${NEW2.family}`;
  // إعادة المحاولة بتأخير متزايد — الاختبار بيضغط «مزامنة الآن» عشان مايستناش
  const done2 = await until(async () => {
    if ((await idb(p2)).ops.length === 0) return true;
    if (!(await p2.locator('.modal').count())) await p2.locator('.offline-badge:visible').first().click().catch(() => {});
    await p2.getByRole('button', { name: 'مزامنة الآن' }).click({ timeout: 2000 }).catch(() => {});
    return false;
  }, 90000, 2500);
  check(`الطابور خلص بعد ${attempt} محاولات (503 ← رد ضاع ← نجاح)`, !!done2 && attempt >= 3, `attempts=${attempt} early=${early} ops=${JSON.stringify((await idb(p2)).ops)}`);
  check('المريض اتسجّل مرة واحدة بس على الخادم (مفيش تكرار رغم إعادة الإرسال)', (await sql(`select count(*)::int n from patients where full_name = '${name2}'`))[0].n === 1);
  await ctx2.browser().close();

  // ============ 8) تسجيل الخروج ============
  section('8) تسجيل الخروج بيمسح كل بيانات المرضى ومفتاح التشفير من الجهاز');
  page = await openApp(false);
  await page.goto(BASE + '/');
  await page.locator('.logout-btn').first().click();
  await page.getByRole('button', { name: /تسجيل الخروج|تأكيد/ }).last().click({ timeout: 3000 }).catch(() => {});
  const wiped = await until(async () => { const x = await idb(page); return x && !x.meta && !x.key && x.ops.length === 0 ? x : null; }, 20000);
  check('النسخة المحلية والطابور ومفتاح التشفير اتمسحوا', !!wiped, JSON.stringify(await idb(page)));
  await closeApp(); await stopServer();
  page = await openApp(true);
  await page.goto(BASE + '/patients').catch(() => {});
  await sleep(4000);
  check('بعد الخروج: فتح بدون إنترنت مابيعرضش أي بيانات مرضى', (await page.locator(`text=${seedName(4321)}`).count()) === 0 && !page.url().includes('/patients'), page.url());
  await closeApp();
} catch (e) {
  await lastPage?.screenshot({ path: join(ROOT, 'docs', 'offline-error.png'), fullPage: true }).catch(() => {});
  check('تنفيذ الاختبارات بدون أخطاء غير متوقعة', false, (e.stack ?? e.message).split('\n').filter((l) => !/^\s+-\s/.test(l)).slice(0, 6).join(' | '));
} finally {
  await closeApp().catch(() => {});
  await stopServer().catch(() => {});
  rmSync(profile, { recursive: true, force: true });
  section('تنظيف بيانات الاختبار');
  try {
    if (made.consult) await sql(`delete from ortho_consultations where id = '${made.consult}'`);
    if (made.seeded) await sql(`delete from patients where file_no like 'اختبار-%';`);
    await sql(`delete from patients where full_name in ('${NEW1.first} ${NEW1.father} ${NEW1.family}', '${NEW2.first} ${NEW2.father} ${NEW2.family}');`);
    // سجل التدقيق والنشاط بيفضل زي ما هو (مابنمسحش أي سجل مراجعة) — البيانات بس اللي بتتمسح
    for (const id of made.employees) { await sql(`delete from attendance where employee_id = '${id}';`); await deleteEmployee(id); }
    await sql(`delete from sync_tombstones where table_name in ('patients', 'ortho_consultations') and deleted_at > now() - interval '3 hours';
      delete from notifications where body like '%اختبار%' or title like '%اختبار%';`);
    const [left] = await sql(`select (select count(*) from patients where full_name like '%اختبار%' or file_no like 'اختبار-%')::int p, (select count(*) from employees where name like '%اختبار%')::int e, (select count(*) from patients)::int all_p`);
    console.log('  متبقي من بيانات الاختبار:', JSON.stringify(left));
  } catch (e) { console.log('  تنظيف ناقص:', e.message); }
  save('e2e-offline-results.json');
}
