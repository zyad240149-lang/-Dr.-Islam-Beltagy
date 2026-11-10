// تفاصيل الزيارة: أزرار «تغيير الموعد» / «إلغاء الموعد» / «حذف» بتفتح نوافذها فعلًا وبتشتغل لحد قاعدة البيانات،
// ورجوع المتصفح (زرار/سحب الموبايل) بيقفل النافذة المفتوحة بس.
//   node scripts/e2e-visit-actions.mjs   (بيشغّل Vite بنفسه على 4671)
import { fileURLToPath } from 'node:url';
import { createServer } from 'vite';
import { launchEdge } from './_edge.mjs';
import { allDayHours, api, cairoDate, deleteEmployee, loginAdmin, randomPassword, sql, suite, URL_ } from './_harness.mjs';

const { check, section, save } = suite();
const PORT = 4671, BASE = `http://127.0.0.1:${PORT}`, PW = randomPassword();
const ADMIN = { phone: '01200000941', digits: '201200000941', name: 'مدير أزرار الزيارة اختبار' };
const PAT = { phone: '01200000942', name: 'مريض أزرار الزيارة اختبار' };
const made = { emp: null, th: null, patient: null, appts: [] };
let server, browser;
try {
  section('التجهيز');
  const admin = await loginAdmin();
  const th = await admin.rpc('save_therapist', { p: { name: 'د. أزرار الزيارة', title: 'طبيب اختبار', phone: '', serviceIds: ['old_exam'], workHours: allDayHours(), onLeave: [], active: true, defaultDurationMin: 30 } });
  made.th = th.data?.id ?? th.data;
  const r = await api(admin, 'POST', 'staff', { name: ADMIN.name, phone: ADMIN.phone, country: 'EG', password: PW, role: 'system_admin', workHours: allDayHours() });
  made.emp = r.body?.id;
  check('حساب المدير', r.status === 201, JSON.stringify(r.body).slice(0, 120));
  const reg = await fetch(`${URL_}/functions/v1/api/register`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ name: PAT.name, phone: PAT.phone, gender: 'male', password: PW, confirm: PW }) });
  made.patient = (await reg.json().catch(() => null))?.patientId;
  const book = async (time) => {
    const b = await admin.rpc('book_appointment', { p: { patientId: made.patient, type: 'initial', serviceId: 'old_exam', therapistId: made.th, date: cairoDate(0), time, location: 'center' } });
    const id = b.data?.id ?? b.data; if (id) made.appts.push(id); return id;
  };
  const a1 = await book('23:00'), a2 = await book('23:15'), a3 = await book('23:30');
  check('3 مواعيد للمريض', !!(a1 && a2 && a3));

  server = await createServer({ configFile: fileURLToPath(new URL('../vite.config.ts', import.meta.url)), root: fileURLToPath(new URL('..', import.meta.url)), logLevel: 'error', server: { port: PORT, strictPort: true, host: '127.0.0.1' } });
  await server.listen();
  browser = await launchEdge();
  const page = await (await browser.newContext({ viewport: { width: 1366, height: 860 }, locale: 'ar-EG' })).newPage();
  const errors = []; page.on('pageerror', (e) => errors.push(e.message));
  await page.goto(BASE + '/login');
  await page.fill('#al-phone', ADMIN.phone); await page.fill('#al-pass', PW); await page.click('button[type=submit]');
  check('الدخول', await page.waitForURL((u) => u.pathname === '/', { timeout: 90000 }).then(() => true).catch(() => false));
  const go = (p) => page.evaluate((x) => { window.history.pushState({}, '', x); window.dispatchEvent(new PopStateEvent('popstate')); }, p);
  // نفتح تفاصيل الزيارة من ملف المريض ← «الزيارات»؛ أسهل: من «حجز كشف ومتابعة» يوم الموعد
  const openVisit = async (no) => {
    await go('/follow-ups'); await page.waitForSelector('.page h1', { timeout: 20000 });

    await page.waitForTimeout(800);
    const btn = page.locator('li.dsch__row', { hasText: PAT.name }).nth(no).getByRole('button', { name: 'تفاصيل' });
    await page.screenshot({ path: fileURLToPath(new URL('../docs/ui-failures/visit-list.png', import.meta.url)) }).catch(() => {});
    await btn.click({ timeout: 10000 });
    await page.waitForSelector('.modal', { timeout: 10000 });
  };
  const status = async (id) => (await sql(`select status, left(time::text, 5) t from appointments where id = '${id}'`))[0];

  section('تغيير الموعد');
  await openVisit(0);
  await page.locator('.modal__foot').getByRole('button', { name: 'تغيير الموعد' }).click();
  await page.waitForTimeout(1200);
  const resOpen = await page.locator('.modal').count();
  const resTitle = await page.locator('.modal h2').first().textContent().catch(() => '');
  check('نافذة تغيير الموعد فتحت وفضلت مفتوحة', resOpen === 1 && !/الزيارة/.test(resTitle ?? ''), `modals=${resOpen} title=${resTitle}`);
  await page.screenshot({ path: fileURLToPath(new URL('../docs/ui-failures/visit-reschedule.png', import.meta.url)) }).catch(() => {});
  await page.goBack(); await page.waitForTimeout(800);
  // «تغيير الموعد» بيتفتح مكان تفاصيل الزيارة — الرجوع بيقفلها بس ويرجّع لتفاصيل الزيارة (خطوة واحدة لورا)، ورجوع تاني يقفل التفاصيل
  const afterBack = await page.locator('.modal h2').allTextContents();
  check('رجوع المتصفح قفل نافذة تغيير الموعد بس ورجّع لتفاصيل الزيارة (لسه في نفس الصفحة)', afterBack.length === 1 && /الزيارة/.test(afterBack[0]) && page.url().includes('/follow-ups'), `${page.url()} ${afterBack.join('|')}`);
  await page.goBack(); await page.waitForTimeout(800);
  check('رجوع تاني قفل تفاصيل الزيارة (لسه في نفس الصفحة)', (await page.locator('.modal').count()) === 0 && page.url().includes('/follow-ups'), page.url());

  section('إلغاء الموعد');
  await openVisit(0);
  await page.locator('.modal__foot').getByRole('button', { name: 'إلغاء الموعد' }).click();
  await page.waitForTimeout(1200);
  check('نافذة الإلغاء فتحت', (await page.locator('.modal').count()) === 1, await page.locator('.modal h2').first().textContent().catch(() => ''));
  // ١٠/١١: الإلغاء من غير سبب — مابنكتبش حاجة في الخانة
  await page.locator('.modal__foot button').filter({ hasText: 'تأكيد الإلغاء' }).last().click();
  await page.waitForTimeout(800); await page.screenshot({ path: fileURLToPath(new URL('../docs/ui-failures/visit-cancel.png', import.meta.url)) }).catch(() => {});
  const cancelled = await (async () => { for (let i = 0; i < 20; i++) { if ((await status(a1))?.status === 'cancelled') return true; await page.waitForTimeout(500); } return false; })();
  check('الموعد اتلغى في قاعدة البيانات', cancelled, JSON.stringify(await status(a1)));

  section('حذف');
  await page.keyboard.press('Escape').catch(() => {});
  await openVisit(0);
  await page.locator('.modal__foot').getByRole('button', { name: 'حذف' }).click();
  await page.waitForTimeout(1000);
  check('نافذة تأكيد الحذف فتحت', (await page.locator('.modal', { hasText: 'حذف الموعد' }).count()) === 1);
  await page.screenshot({ path: fileURLToPath(new URL('../docs/ui-failures/visit-delete-before.png', import.meta.url)) }).catch(() => {});
  await page.locator('.modal__foot').getByRole('button', { name: /تأكيد/ }).last().click();
  await page.waitForTimeout(2500);
  await page.screenshot({ path: fileURLToPath(new URL('../docs/ui-failures/visit-delete.png', import.meta.url)) }).catch(() => {});
  const left = await sql(`select count(*)::int n from appointments where id in ('${a2}','${a3}')`);
  check('موعد اتمسح من قاعدة البيانات', left[0].n === 1, `باقي ${left[0].n} من 2`);
  check('من غير أخطاء JavaScript', errors.length === 0, errors.join(' | ').slice(0, 300));
} catch (e) {
  check('تنفيذ الاختبار بدون أخطاء غير متوقعة', false, String(e?.stack ?? e).split('\n').slice(0, 3).join(' | '));
} finally {
  section('تنظيف');
  try {
    if (made.patient) {
      await sql(`delete from invoices where patient_id = '${made.patient}'; delete from appointments where patient_id = '${made.patient}';`);
      const c = await sql(`select auth_user_id from customers where patient_id = '${made.patient}'`).catch(() => []);
      await sql(`delete from customers where patient_id = '${made.patient}'; delete from patients where id = '${made.patient}';`).catch(() => {});
      for (const x of c) if (x.auth_user_id) await sql(`delete from auth.users where id = '${x.auth_user_id}'`).catch(() => {});
    }
    if (made.emp) { await sql(`delete from attendance where employee_id = '${made.emp}'`); await deleteEmployee(made.emp); }
    if (made.th) await sql(`delete from therapists where id = '${made.th}'`).catch(() => {});
  } catch (e) { console.log('  تنظيف ناقص:', e.message); }
  await browser?.close(); await server?.close();
  save('e2e-visit-actions-results.json');
  setTimeout(() => process.exit(), 200);
}
