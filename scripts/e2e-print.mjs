// اختبار «طباعة وإرسال» التشخيص في متصفح حقيقي (Edge) — على الموقع المنشور (UI_BASE) أو سيرفر Vite محلي:
// حساب مدير + مريض + تشخيص مؤقتين ← ملف التشخيص ← «طباعة وإرسال» ← طباعة (تابة جديدة فيها الصفحات + print) و«تحميل PDF» (ملف PDF سليم).
// كل البيانات بتتمسح في الآخر.
//   UI_BASE=https://beltagy-ortho.pages.dev node scripts/e2e-print.mjs
import { fileURLToPath } from 'node:url';
import { readFileSync } from 'node:fs';
import { createServer } from 'vite';
import { chromium } from 'playwright-core';
import { allDayHours, api, deleteEmployee, loginAdmin, randomPassword, sql, suite } from './_harness.mjs';

const { check, section, save } = suite();
// قفل المتصفح وتابة الطباعة لسه بتحمّل بيرمي خطأ داخلي من playwright — مش من الموقع
process.on('unhandledRejection', (e) => { if (!/has been closed/.test(String(e))) throw e; });
const PORT = 4693;
const BASE = (process.env.UI_BASE || `http://127.0.0.1:${PORT}`).replace(/\/$/, '');
const PW = randomPassword();
const ADMIN = { phone: '01200000991', name: 'مدير طباعة اختبار' };
const made = { employees: [], patient: null };
let server, browser;
try {
  section('التجهيز');
  const admin = await loginAdmin();
  const r = await api(admin, 'POST', 'staff', { name: ADMIN.name, phone: ADMIN.phone, country: 'EG', password: PW, role: 'system_admin', workHours: allDayHours() });
  if (r.body?.id) made.employees.push(r.body.id);
  check('حساب مدير للاختبار', r.status === 201, JSON.stringify(r.body).slice(0, 120));
  const [p] = await sql(`insert into patients (full_name, first_name, father_name, family_name, phone, gender, nationality, referral_source, file_no)
    values ('حسام طارق طباعةاختبار', 'حسام', 'طارق', 'طباعةاختبار', '+201200000992', 'male', 'saudi', 'friend', '') returning id`);
  made.patient = p.id;
  const sheet = { on: ['n.visit|متابعة', 'n.cc|ألم', 'x.cc|Knee pain', 'x.dx.knee|Osteoarthritis', 'af.cc|Ankle pain', 'af.dx.ankle|Ankle sprain (ATFL / CFL)'], txt: { 'n.name': 'حسام طارق طباعةاختبار', 'x.notes': 'Rest.' }, meds: [], pain: ['knee:right', 'ankle_foot:right'] };
  await sql(`insert into ortho_consultations (patient_id, complaint, region, side, diagnosis, plan, medications, sheet, complete, created_by)
    values ('${p.id}', 'Knee pain', 'الركبة', 'right', 'Knee: Osteoarthritis', 'راحة', '[{"name":"Panadol 500mg","dose":"قرص","frequency":"3 مرات","duration":"5 أيام","notes":""}]', '${JSON.stringify(sheet).replace(/'/g, "''")}'::jsonb, true, '${made.employees[0]}')`);
  check('مريض وتشخيص للاختبار', !!made.patient);

  if (!process.env.UI_BASE) {
    server = await createServer({ configFile: fileURLToPath(new URL('../vite.config.ts', import.meta.url)), root: fileURLToPath(new URL('..', import.meta.url)), logLevel: 'error', server: { port: PORT, strictPort: true, host: '127.0.0.1' } });
    await server.listen();
  }
  browser = await chromium.launch({ channel: 'msedge', headless: true });
  const ctx = await browser.newContext({ viewport: { width: 1366, height: 860 }, locale: 'ar-EG', acceptDownloads: true });
  // print() في كل صفحة (والتابات الجديدة) بيتعدّ بدل ما يفتح نافذة الطباعة
  await ctx.addInitScript(() => { window.__printed = 0; window.print = () => { window.__printed++; }; });
  const page = await ctx.newPage();
  const errors = [];
  page.on('pageerror', (e) => errors.push('pageerror: ' + e.message));
  page.on('console', (m) => { if (m.type() === 'error' && !/Failed to load resource|WebSocket|realtime|Notification|ServiceWorker/i.test(m.text())) errors.push('console: ' + m.text()); });
  section(`الطباعة — ${BASE}`);
  await page.goto(BASE + '/login');
  await page.fill('#al-phone', ADMIN.phone);
  await page.fill('#al-pass', PW);
  await page.click('button[type=submit]');
  check('الدخول', await page.waitForURL((u) => u.pathname === '/', { timeout: 30000 }).then(() => true).catch(() => false), page.url());
  errors.length = 0;
  await page.evaluate((id) => { window.history.pushState({}, '', `/diagnosis?patient=${id}`); window.dispatchEvent(new PopStateEvent('popstate')); }, made.patient);
  await page.waitForSelector('.dxh', { timeout: 30000 });
  await page.locator('.dxh button', { hasText: 'طباعة وإرسال' }).first().click();
  await page.waitForSelector('.out-act');

  // طباعة
  const popupP = ctx.waitForEvent('page', { timeout: 15000 }).catch(() => null);
  await page.locator('.out-act', { hasText: 'طباعة' }).first().click();
  const popup = await popupP;
  check('«طباعة» بتفتح تابة الطباعة', !!popup);
  if (popup) {
    const ok = await popup.waitForFunction(() => window.__printed > 0, null, { timeout: 15000 }).then(() => true).catch(() => false);
    const info = await popup.evaluate(() => ({ pages: document.querySelectorAll('.page').length, title: document.title, text: (document.body?.innerText ?? '').slice(0, 120), printed: window.__printed })).catch((e) => ({ err: e.message }));
    check('تابة الطباعة فيها صفحات التشخيص', info.pages >= 2, JSON.stringify(info));
    check('print() اتنادت في تابة الطباعة', ok, JSON.stringify(info));
    await popup.close().catch(() => {});
  }
  check('الصفحة الأصلية ما اتطبعتش', (await page.evaluate(() => window.__printed)) === 0);

  // تحميل PDF
  const dlP = page.waitForEvent('download', { timeout: 60000 }).catch(() => null);
  await page.locator('.out-act', { hasText: 'تحميل PDF' }).click();
  const dl = await dlP;
  check('«تحميل PDF» بينزّل ملف', !!dl, errors.join(' | ').slice(0, 300));
  if (dl) {
    const path = fileURLToPath(new URL('../docs/ui-failures/print-test.pdf', import.meta.url));
    await dl.saveAs(path);
    const buf = readFileSync(path);
    const pages = (buf.toString('latin1').match(/\/Type\s*\/Page[^s]/g) || []).length;
    check('الملف PDF سليم وفيه صفحات', buf.subarray(0, 5).toString() === '%PDF-' && pages >= 2, `${buf.length} bytes, ${pages} pages, ${dl.suggestedFilename()}`);
  }
  const toast = await page.locator('.toast, [role=status], [role=alert]').allTextContents().catch(() => []);
  check('مفيش أخطاء JavaScript', errors.length === 0, (errors.join(' | ') + ' || ' + toast.join(' / ')).slice(0, 400));

  // التقارير: الطباعة بتخطيط مخصّص — وقت الطباعة القايمة الجانبية والأزرار بيختفوا وورقة التقرير (عنوان + فترة + تاريخ إصدار) بتظهر
  section('طباعة التقارير');
  await page.evaluate(() => { window.history.pushState({}, '', '/reports'); window.dispatchEvent(new PopStateEvent('popstate')); });
  await page.waitForSelector('.page h1', { timeout: 20000 });
  await page.waitForTimeout(1500);
  await page.emulateMedia({ media: 'print' });
  const pr = await page.evaluate(() => {
    const shown = (el) => !!el && getComputedStyle(el).display !== 'none' && getComputedStyle(el).visibility !== 'hidden' && el.getBoundingClientRect().height > 0;
    const sidebar = document.querySelector('.sidebar, aside, nav');
    const doc = document.querySelector('.rp-doc, .print-only, .print-area');
    return { sidebar: shown(sidebar), doc: shown(doc), text: (doc?.innerText ?? '').slice(0, 160) };
  });
  await page.emulateMedia({ media: 'screen' });
  check('طباعة التقرير: القايمة الجانبية مخفية', !pr.sidebar, JSON.stringify(pr));
  check('طباعة التقرير: ورقة التقرير المخصّصة ظاهرة', pr.doc, JSON.stringify(pr));

  // تقرير الرواتب: بيتطبع في تابة لوحدها بجدول
  await page.evaluate(() => { window.history.pushState({}, '', '/payroll'); window.dispatchEvent(new PopStateEvent('popstate')); });
  await page.waitForSelector('.page-head h1', { timeout: 20000 });
  await page.waitForTimeout(1500);
  const payP = ctx.waitForEvent('page', { timeout: 15000 }).catch(() => null);
  await page.locator('button', { hasText: 'طباعة التقرير' }).click();
  const payPop = await payP;
  const payOk = payPop ? await payPop.waitForFunction(() => window.__printed > 0 && document.querySelector('table'), null, { timeout: 15000 }).then(() => true).catch(() => false) : false;
  const payTitle = payPop ? await payPop.evaluate(() => document.querySelector('h1')?.textContent ?? '').catch(() => '') : '';
  check('تقرير الرواتب بيتطبع بجدول وعنوان في تابة لوحدها', payOk && /تقرير الرواتب/.test(payTitle), payTitle);
  await payPop?.close().catch(() => {});
} catch (e) {
  check('تنفيذ الاختبار بدون أخطاء غير متوقعة', false, e.message);
} finally {
  await browser?.close().catch(() => {});
  await server?.close().catch(() => {});
  section('تنظيف');
  try {
    if (made.patient) await sql(`delete from ortho_consultations where patient_id = '${made.patient}'; delete from patients where id = '${made.patient}';`);
    for (const id of made.employees) { await sql(`delete from attendance where employee_id = '${id}';`); await deleteEmployee(id); }
  } catch (e) { console.log('  تنظيف ناقص:', e.message); }
  save('e2e-print-results.json');
}
