// اختبار أوفلاين حقيقي لملفات الأشعة والتحاليل ومواعيد المتابعة — جهازين (استقبال + دكتور) في Edge بنسخة الإنتاج (Service Worker شغال)
// وقاعدة Supabase الحقيقية. الإنترنت بيتقطع فعلًا عن كل جهاز (setOffline) وبيرجع، وكل نتيجة بتتأكد من القاعدة نفسها.
//  1) الاستقبال يرفع أشعة والإنترنت شغال ← تظهر عند الدكتور جوّه «تشخيص جديد» من غير إعادة تحميل (Realtime)
//  2) الاستقبال من غير إنترنت يرفع تحليل PDF ← بيتحفظ على الجهاز متشفّر، بيفضل بعد إعادة فتح الصفحة من غير إنترنت، ويترفع لوحده لما النت يرجع
//  3) الرد يضيع في النص (الملف اترفع والسجل لأ) ← إعادة المحاولة تكمّل من غير تكرار ملف ولا سجل
//  4) الدكتور من غير إنترنت: الأشعة والتحاليل ظاهرة من نسخة الجهاز + تشخيص جديد بشكوى وموعد متابعة ← يتزامنوا مرة واحدة بس
// كل البيانات بتتمسح في الآخر.   npm run build && node scripts/e2e-offline-files.mjs
import { mkdtempSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';
import { preview } from 'vite';
import { launchEdge } from './_edge.mjs';
import { allDayHours, api, cairoDate, deleteEmployee, env, loginAdmin, randomPassword, sql, suite, URL_ } from './_harness.mjs';

const { check, section, save } = suite();
const ROOT = fileURLToPath(new URL('..', import.meta.url));
const PORT = 4692, BASE = `http://127.0.0.1:${PORT}`;
const PW = randomPassword();
const SHOTS = new URL('../docs/ui-failures/', import.meta.url);
const STAFF = {
  recep: { phone: '01200000982', digits: '201200000982', name: 'استقبال أوفلاين ملفات اختبار', role: 'reception' },
  doc: { phone: '01200000984', digits: '201200000984', name: 'طبيب أوفلاين ملفات اختبار', role: 'therapist' },
};
const made = { employees: [], therapist: null, patient: null };
const NOISE = /Notification|push|ServiceWorker|service worker|WebSocket|realtime|ERR_ABORTED|ERR_INTERNET_DISCONNECTED|ERR_FAILED|AbortError|Failed to load resource|Failed to fetch|NetworkError|Download the React DevTools/i;
const PNG = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==', 'base64');
const PDF = Buffer.from('%PDF-1.4\n1 0 obj<</Type/Catalog/Pages 2 0 R>>endobj 2 0 obj<</Type/Pages/Kids[]/Count 0>>endobj\ntrailer<</Root 1 0 R>>\n%%EOF');
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const until = async (f, ms = 30000, every = 500) => { const t = Date.now(); for (;;) { const v = await f().catch(() => null); if (v) return v; if (Date.now() - t > ms) return null; await sleep(every); } };
const one = async (q) => (await sql(q))[0];
const files = () => sql(`select id, category, title, file_path from patient_files where patient_id = '${made.patient}' order by created_at`);

// الطابور جوّه IndexedDB زي ما هو على الهارد (من غير فك تشفير)
const rawOps = (page) => page.evaluate(() => new Promise((resolve) => {
  const r = indexedDB.open('ortho-offline');
  r.onerror = () => resolve([]);
  r.onsuccess = () => {
    const d = r.result;
    if (!d.objectStoreNames.contains('ops')) { resolve([]); return; }
    d.transaction('ops', 'readonly').objectStore('ops').getAll().onsuccess = (e) => resolve((e.target.result ?? []).map((o) => ({
      kind: o.kind, status: o.status, entityId: o.entityId, hasSealed: !!o.sealed, hasSealedBytes: !!o.sealedBytes,
      plain: 'payload' in o || 'label' in o,
      // أي نص عربي من بيانات المريض أو اسم الملف مكشوف؟
      leak: JSON.stringify(o, (k, v) => (v instanceof ArrayBuffer ? new TextDecoder().decode(v) : v)).includes('صورة دم'),
    })));
  };
}));

let server, edges = [];
try {
  section('التجهيز');
  const admin = await loginAdmin();
  const th = await admin.rpc('save_therapist', { p: { name: 'د. أوفلاين ملفات', title: 'طبيب اختبار', phone: '', serviceIds: ['old_exam'], workHours: allDayHours(), onLeave: [], active: true, defaultDurationMin: 30 } });
  made.therapist = th.data?.id ?? th.data;
  for (const [k, s] of Object.entries(STAFF)) {
    const r = await api(admin, 'POST', 'staff', { name: s.name, phone: s.phone, country: 'EG', password: PW, role: s.role, therapistId: k === 'doc' ? made.therapist : undefined, workHours: allDayHours() });
    if (r.body?.id) made.employees.push(r.body.id);
    check(`حساب ${s.name}`, r.status === 201, JSON.stringify(r.body).slice(0, 120));
  }
  const [p] = await sql(`insert into patients (full_name, first_name, father_name, family_name, phone, gender, nationality, referral_source, file_no)
    values ('مريض أوفلاين ملفات', 'مريض', 'أوفلاين', 'ملفات', '+201200000986', 'male', 'saudi', 'friend', '') returning id`);
  made.patient = p.id;
  server = await preview({ root: ROOT, configFile: join(ROOT, 'vite.config.ts'), logLevel: 'error', preview: { port: PORT, strictPort: true, host: '127.0.0.1' } });
  mkdirSync(SHOTS, { recursive: true });

  // جهاز = متصفح ببروفايل ثابت (نفس IndexedDB والكاش والـ Service Worker بعد إعادة الفتح)
  const device = async (s) => {
    const edge = await launchEdge({ userDataDir: mkdtempSync(join(tmpdir(), 'ortho-files-')) });
    edges.push(edge);
    const ctx = edge.contexts()[0];
    const page = ctx.pages()[0] ?? await ctx.newPage();
    await page.setViewportSize({ width: 1366, height: 900 });
    const errors = [];
    page.on('pageerror', (e) => errors.push(e.message));
    page.on('console', (m) => { if (m.type() === 'error' && !NOISE.test(m.text())) errors.push(m.text()); });
    page.on('dialog', (d) => void d.accept());
    await page.goto(BASE + '/login');
    await page.fill('#al-phone', s.phone); await page.fill('#al-pass', PW); await page.click('button[type=submit]');
    await page.waitForURL((u) => u.pathname === '/', { timeout: 30000 });
    // Service Worker جاهز + البيانات (والسجلات الطبية) نزلت على الجهاز
    await page.evaluate(() => navigator.serviceWorker?.ready.then(() => true));
    await until(() => page.evaluate(() => new Promise((res) => { const r = indexedDB.open('ortho-offline'); r.onsuccess = () => { const d = r.result; if (!d.objectStoreNames.contains('kv')) return res(false); d.transaction('kv').objectStore('kv').get('snap:meta').onsuccess = (e) => res(!!e.target.result); }; r.onerror = () => res(false); })), 60000, 1000);
    const offline = async (on) => { await ctx.setOffline(on); await page.evaluate((o) => window.dispatchEvent(new Event(o ? 'offline' : 'online')), on); };
    return { edge, ctx, page, errors, offline };
  };
  // ملفات الأشعة/التحاليل في التشخيص بقت جوّه تبويب «الأشعة والتحاليل» (Consultations.tsx) — بنروح له ونفتح المربعات
  const showFiles = async (page) => { await page.locator('.sh-tabs button', { hasText: 'الأشعة والتحاليل' }).first().click().catch(() => {}); await page.waitForSelector('.pmf__head', { timeout: 10000 }).catch(() => {}); await sleep(500); for (const h of await page.locator('.pmf__head[aria-expanded=false]').all()) await h.click().catch(() => {}); };
  const go = (page, path) => page.evaluate((x) => { window.history.pushState({}, '', x); window.dispatchEvent(new PopStateEvent('popstate')); }, path);
  const R = await device(STAFF.recep);
  const D = await device(STAFF.doc);
  check('الجهازين دخلوا ونزّلوا البيانات على الجهاز', true);

  // ===== 1) Realtime: الاستقبال يرفع والدكتور شايف «تشخيص جديد» مفتوح =====
  section('1) الاستقبال يرفع أشعة ← تظهر عند الدكتور من غير إعادة تحميل');
  await go(D.page, `/patients/${made.patient}`);
  await D.page.locator('.tabs').getByRole('button', { name: 'التشخيص', exact: true }).click();
  await D.page.getByRole('button', { name: 'تشخيص جديد' }).first().click();
  await D.page.waitForSelector('#cx-visit-reason', { timeout: 20000 });
  await showFiles(D.page);
  check('التشخيص الجديد مفتوح عند الدكتور ومفيش ملفات', await until(async () => (await D.page.locator('.modal .pmf').count()) > 0 && (await D.page.locator('.modal .pmf__tile').count()) === 0));
  await go(R.page, `/patients/${made.patient}`);
  await R.page.getByRole('button', { name: 'ملفات الأشعة والتحاليل' }).click();
  await R.page.fill('#pf-title', 'أشعة الركبة أونلاين');
  await R.page.locator('input[type=file][multiple]').setInputFiles([{ name: 'knee.png', mimeType: 'image/png', buffer: PNG }]);
  check('الأشعة وصلت الخادم', !!(await until(async () => (await files()).length === 1)));
  const live = await until(async () => (await D.page.locator('.modal .pmf__tile', { hasText: 'أشعة الركبة أونلاين' }).count()) === 1, 20000);
  check('ظهرت عند الدكتور جوّه التشخيص المفتوح من غير إعادة تحميل (Realtime)', !!live);
  await D.page.locator('.modal').getByRole('button', { name: 'إلغاء' }).first().click();

  // ===== 2) الاستقبال من غير إنترنت =====
  section('2) الاستقبال من غير إنترنت يرفع تحليل PDF');
  await R.offline(true);
  await R.page.getByRole('radio', { name: 'تحاليل' }).click();
  await R.page.fill('#pf-title', 'صورة دم كاملة أوفلاين');
  await R.page.locator('input[type=file][multiple]').setInputFiles([{ name: 'cbc.pdf', mimeType: 'application/pdf', buffer: PDF }]);
  check('ظاهر في القايمة «بانتظار الرفع»', !!(await until(async () => (await R.page.locator('tr', { hasText: 'صورة دم كاملة أوفلاين' }).locator('text=بانتظار الرفع').count()) === 1, 10000)));
  const ops = await rawOps(R.page);
  const up = ops.find((o) => o.kind === 'file.upload');
  check('الملف اتحفظ في طابور الجهاز (IndexedDB)', !!up, JSON.stringify(ops));
  check('العملية متشفّرة على الجهاز (البيانات والملف نفسه)', !!up && up.hasSealed && up.hasSealedBytes && !up.plain && !up.leak, JSON.stringify(up));
  check('الخادم ماوصلهوش حاجة لسه', (await files()).length === 1);
  // إعادة فتح الصفحة من غير إنترنت (Service Worker) ← الملف لسه في الطابور وظاهر
  await R.page.reload();
  await R.page.waitForSelector('.page h1', { timeout: 30000 }).catch(() => {});
  await go(R.page, `/patients/${made.patient}`);
  await R.page.getByRole('button', { name: 'ملفات الأشعة والتحاليل' }).click().catch(() => {});
  check('بعد إعادة فتح الصفحة من غير إنترنت: الملف لسه موجود «بانتظار الرفع»', !!(await until(async () => (await R.page.locator('tr', { hasText: 'صورة دم كاملة أوفلاين' }).count()) === 1, 15000)));
  check('والأشعة اللي اترفعت قبل كده ظاهرة من نسخة الجهاز', !!(await until(async () => (await R.page.locator('tr', { hasText: 'أشعة الركبة أونلاين' }).count()) === 1, 10000)));

  // ===== 3) الرد بيضيع: الملف اترفع والسجل لأ ← إعادة المحاولة من غير تكرار =====
  section('3) النت يرجع والرد بيضيع في النص ← إعادة المحاولة من غير تكرار');
  let dropped = 0;
  await R.ctx.route('**/rest/v1/patient_files*', async (route) => {
    if (route.request().method() === 'POST' && dropped === 0) { dropped++; await route.abort('connectionreset'); return; }
    await route.continue();
  });
  await R.offline(false);
  const synced = await until(async () => {
    if ((await rawOps(R.page)).length === 0) return true;
    await R.page.evaluate(() => window.dispatchEvent(new Event('online')));
    if (!(await R.page.locator('.modal').count())) await R.page.locator('.offline-badge:visible').first().click().catch(() => {});
    await R.page.getByRole('button', { name: 'مزامنة الآن' }).click({ timeout: 1500 }).catch(() => {});
    return false;
  }, 120000, 3000);
  await R.page.keyboard.press('Escape').catch(() => {});
  const fs = await files();
  check('الرد ضاع مرة فعلًا (السجل اترفض في النص)', dropped === 1, `dropped=${dropped}`);
  check('الطابور خلص لوحده بعد رجوع النت', !!synced, JSON.stringify(await rawOps(R.page)));
  check('التحليل وصل الخادم مرة واحدة بس (مفيش سجل مكرر)', fs.filter((f) => f.title === 'صورة دم كاملة أوفلاين').length === 1 && fs.length === 2, JSON.stringify(fs.map((f) => f.title)));
  const lab = fs.find((f) => f.title === 'صورة دم كاملة أوفلاين');
  const objs = await sql(`select count(*)::int n from storage.objects where bucket_id = 'patient-files' and name like '${made.patient}/%'`);
  check('ملف واحد بس في التخزين لكل سجل (مفيش ملف مكرر)', objs[0].n === 2, `objects=${objs[0].n}`);
  check('بنوع «تحاليل» ومسار جوّه مجلد المريض', lab?.category === 'lab' && lab.file_path.startsWith(made.patient + '/'));
  check('علامة «بانتظار الرفع» اتشالت', !!(await until(async () => (await R.page.locator('tr', { hasText: 'صورة دم كاملة أوفلاين' }).locator('text=بانتظار الرفع').count()) === 0, 15000)));
  await R.ctx.unroute('**/rest/v1/patient_files*');

  // ===== 4) الدكتور من غير إنترنت =====
  section('4) الدكتور من غير إنترنت: الملفات + تشخيص بشكوى وموعد متابعة');
  await until(async () => (await D.page.evaluate(() => document.body.innerText.length)) > 0);
  await sleep(2500); // Realtime ← الكاش اتحدّث بالملف التاني
  await D.offline(true);
  await D.page.getByRole('button', { name: 'تشخيص جديد' }).first().click();
  await D.page.waitForSelector('#cx-visit-reason', { timeout: 20000 });
  await showFiles(D.page);
  check('من غير إنترنت: الأشعة والتحاليل ظاهرة في التشخيص من نسخة الجهاز', !!(await until(async () => (await D.page.locator('.modal .pmf__tile').count()) === 2, 15000)), await D.page.locator('.pmf').innerText().catch(() => ''));
  await D.page.fill('#cx-visit-reason', 'متابعة بعد الأشعة — من غير إنترنت');
  await D.page.locator('.sh-tabs button', { hasText: 'موعد المتابعة' }).first().click(); // تبويب «موعد المتابعة» (رقم ٢) في التشخيص
  await D.page.getByRole('button', { name: 'إضافة موعد متابعة' }).click();
  const m = D.page.locator('.modal', { hasText: 'تحديد موعد متابعة' }).last();
  await m.locator('.fu-datepick input').fill(cairoDate(10)); // اختيار اليوم من التقويم (FollowUps.tsx)
  await m.locator('input.fu-slots__time').fill('12:00');
  await m.locator('textarea').first().fill('متابعة أوفلاين');
  await m.locator('.modal__foot').getByRole('button', { name: /^(إضافة للتشخيص|حفظ)$/ }).click();
  await D.page.locator('.modal__foot').getByRole('button', { name: 'حفظ الكشف' }).last().click();
  await D.page.getByRole('button', { name: 'حفظ — استكمال بعدين' }).click().catch(() => {});
  const dOps = await until(async () => { const o = await rawOps(D.page); return o.length >= 2 ? o : null; }, 15000);
  check('التشخيص وموعد المتابعة اتحفظوا في طابور الجهاز (متشفّرين)', !!dOps && dOps.every((o) => o.hasSealed && !o.plain), JSON.stringify(dOps));
  check('الخادم ماوصلهوش التشخيص لسه', (await one(`select count(*)::int n from ortho_consultations where patient_id = '${made.patient}'`)).n === 0);
  // إعادة فتح الصفحة من غير إنترنت ← لسه في الطابور
  await D.page.reload();
  await D.page.waitForSelector('.page h1', { timeout: 30000 }).catch(() => {});
  check('بعد إعادة فتح الصفحة من غير إنترنت: التشخيص والمتابعة لسه في الطابور', (await rawOps(D.page)).length >= 2);
  await D.offline(false);
  const dSynced = await until(async () => {
    if ((await rawOps(D.page)).length === 0) return true;
    await D.page.evaluate(() => window.dispatchEvent(new Event('online')));
    if (!(await D.page.locator('.modal').count())) await D.page.locator('.offline-badge:visible').first().click().catch(() => {});
    await D.page.getByRole('button', { name: 'مزامنة الآن' }).click({ timeout: 1500 }).catch(() => {});
    return false;
  }, 120000, 3000);
  const cons = await sql(`select id, visit_reason from ortho_consultations where patient_id = '${made.patient}'`);
  const fus = await sql(`select consultation_id, reason, time from ortho_follow_ups where patient_id = '${made.patient}'`);
  check('بعد رجوع النت: الطابور خلص لوحده', !!dSynced, JSON.stringify(await rawOps(D.page)));
  check('التشخيص وصل الخادم مرة واحدة بالشكوى', cons.length === 1 && cons[0].visit_reason === 'متابعة بعد الأشعة — من غير إنترنت', JSON.stringify(cons));
  check('موعد المتابعة وصل مرة واحدة ومربوط بنفس التشخيص', fus.length === 1 && fus[0].consultation_id === cons[0]?.id && String(fus[0].time).startsWith('12:00'), JSON.stringify(fus));
  check('الاستقبال: من غير أخطاء JavaScript', R.errors.length === 0, R.errors.join(' | '));
  check('الدكتور: من غير أخطاء JavaScript', D.errors.length === 0, D.errors.join(' | '));
  if (R.errors.length) await R.page.screenshot({ path: fileURLToPath(new URL('offline-files-recep.png', SHOTS)) });
  if (D.errors.length) await D.page.screenshot({ path: fileURLToPath(new URL('offline-files-doc.png', SHOTS)) });
} catch (e) {
  check('تنفيذ الاختبار بدون أخطاء غير متوقعة', false, e.message.split('\n')[0]);
} finally {
  for (const e of edges) await e.close().catch(() => {});
  await server?.close().catch(() => {});
  section('تنظيف بيانات الاختبار');
  try {
    if (made.patient) {
      const paths = (await sql(`select name from storage.objects where bucket_id = 'patient-files' and name like '${made.patient}/%'`)).map((r) => r.name);
      if (paths.length) await fetch(`${URL_}/storage/v1/object/patient-files`, { method: 'DELETE', headers: { apikey: env.SUPABASE_SERVICE_ROLE_KEY, Authorization: 'Bearer ' + env.SUPABASE_SERVICE_ROLE_KEY, 'Content-Type': 'application/json' }, body: JSON.stringify({ prefixes: paths }) });
      await sql(`delete from ortho_consultations where patient_id = '${made.patient}'; delete from invoices where patient_id = '${made.patient}'; delete from appointments where patient_id = '${made.patient}'; delete from patients where id = '${made.patient}';`);
    }
    for (const id of made.employees) { await sql(`delete from attendance where employee_id = '${id}';`); await deleteEmployee(id); }
    // المواعيد اللي على الطبيب المؤقت لازم تتمسح قبله (كان التنضيف بيقف هنا والطبيب بيفضل)
    if (made.therapist) await sql(`delete from invoices where appointment_id in (select id from appointments where therapist_id = '${made.therapist}'); delete from appointments where therapist_id = '${made.therapist}'; delete from therapist_services where therapist_id = '${made.therapist}'; delete from therapists where id = '${made.therapist}';`);
    const [left] = await sql(`select (select count(*) from patients where full_name like '%أوفلاين ملفات%')::int p, (select count(*) from employees where name like '%أوفلاين ملفات%')::int e, (select count(*) from therapists where name like '%أوفلاين ملفات%')::int t`);
    console.log('  متبقي من بيانات الاختبار:', JSON.stringify(left));
  } catch (e) { console.log('  تنظيف ناقص:', e.message); }
  save('e2e-offline-files-results.json');
}
