// ملاحظة الدواء في البنك (بتتحفظ وبتظهر) + فلتر التاريخ في «المرضى اللي اتشخصوا».
//   node scripts/e2e-med-notes-dxfilter.mjs   (بيشغّل Vite بنفسه على 4672)
import { fileURLToPath } from 'node:url';
import { createServer } from 'vite';
import { launchEdge } from './_edge.mjs';
import { allDayHours, api, deleteEmployee, loginAdmin, randomPassword, sql, suite } from './_harness.mjs';

const { check, section, save } = suite();
const PORT = 4672, BASE = `http://127.0.0.1:${PORT}`, PW = randomPassword();
const ADMIN = { phone: '01200000951', name: 'مدير ملاحظة الدواء اختبار' };
const MED = 'ZZTEST NOTE MED 10MG';
const NOTE = 'ممنوع النوم بعدها نص ساعة';
const shot = (n) => fileURLToPath(new URL(`../docs/ui-failures/${n}.png`, import.meta.url));
let empId, server, browser;
try {
  const admin = await loginAdmin();
  const r = await api(admin, 'POST', 'staff', { name: ADMIN.name, phone: ADMIN.phone, country: 'EG', password: PW, role: 'system_admin', workHours: allDayHours() });
  empId = r.body?.id;
  check('حساب المدير', r.status === 201, JSON.stringify(r.body).slice(0, 120));
  server = await createServer({ configFile: fileURLToPath(new URL('../vite.config.ts', import.meta.url)), root: fileURLToPath(new URL('..', import.meta.url)), logLevel: 'error', server: { port: PORT, strictPort: true, host: '127.0.0.1' } });
  await server.listen();
  browser = await launchEdge();
  const page = await (await browser.newContext({ viewport: { width: 1366, height: 860 }, locale: 'ar-EG' })).newPage();
  const errors = []; page.on('pageerror', (e) => errors.push(e.message));
  await page.goto(BASE + '/login');
  await page.fill('#al-phone', ADMIN.phone); await page.fill('#al-pass', PW); await page.click('button[type=submit]');
  check('الدخول', await page.waitForURL((u) => u.pathname === '/', { timeout: 90000 }).then(() => true).catch(() => false));
  const go = (p) => page.evaluate((x) => { window.history.pushState({}, '', x); window.dispatchEvent(new PopStateEvent('popstate')); }, p);

  section('ملاحظة الدواء');
  await go('/medications'); await page.waitForSelector('.page h1', { timeout: 20000 });
  await page.getByRole('button', { name: 'إضافة دواء للبنك' }).first().click();
  await page.waitForSelector('.modal');
  await page.locator('.modal input.input').first().fill(MED);
  await page.locator('.modal textarea').fill(NOTE);
  await page.screenshot({ path: shot('med-note-modal') });
  await page.locator('.modal__foot').getByRole('button', { name: 'حفظ' }).click();
  await page.waitForTimeout(2500);
  const row = await sql(`select notes from ortho_medications where name = '${MED}'`);
  check('الملاحظة اتحفظت في قاعدة البيانات', row[0]?.notes === NOTE, JSON.stringify(row));
  check('الملاحظة ظاهرة في القايمة', (await page.locator('.item-card', { hasText: MED }).filter({ hasText: NOTE }).count()) === 1);

  section('فلتر التاريخ');
  await go('/diagnosis?tab=done'); await page.waitForSelector('.dx-queue, .empty', { timeout: 30000 });
  await page.waitForTimeout(1500);
  const count = () => page.locator('.dx-queue__row.dx-pat').count();
  const all = await count();
  const counts = {};
  for (const label of ['النهارده', 'امبارح', 'آخر 3 أيام', 'آخر أسبوع']) {
    await page.getByRole('button', { name: label, exact: true }).click(); await page.waitForTimeout(300);
    counts[label] = await count();
  }
  check('الفلاتر بتقلل القايمة بشكل منطقي', counts['آخر 3 أيام'] <= counts['آخر أسبوع'] && counts['آخر أسبوع'] <= all && counts['النهارده'] <= counts['آخر 3 أيام'], JSON.stringify({ all, ...counts }));
  await page.getByRole('button', { name: 'من يوم لـ يوم', exact: true }).click();
  await page.fill('input[aria-label="من يوم"]', '2026-10-27'); await page.fill('input[aria-label="لحد يوم"]', '2026-10-28');
  await page.waitForTimeout(400);
  const dates = await page.locator('.dx-queue__row.dx-pat .dx-queue__time').allTextContents();
  check('من يوم لـ يوم بيعرض الفترة دي بس', dates.every((d) => /27|28/.test(d) && /أكتوبر/.test(d)), dates.join(' | '));
  await page.screenshot({ path: shot('dx-date-filter') });

  section('شيت «فحص سريع» (تاب 2)');
  await page.getByRole('button', { name: 'فتح ملف تشخيص جديد' }).click();
  await page.fill('input[placeholder="مثال: محمد أحمد علي"]', 'محمد احمد اختبار');
  await page.getByRole('button', { name: 'ابدأ التشخيص بالاسم ده' }).click();
  await page.waitForSelector('.sh-tabs', { timeout: 15000 });
  const tabs = (await page.locator('.sh-tabs button').allInnerTexts()).map((t) => t.replace(/\s+/g, ' ').trim());
  check('التاب رقم 2 = «فحص سريع» وبعده «متابعة المريض» رقم 3', /^2\s*فحص سريع/.test(tabs[1] ?? '') && /^3\s*متابعة المريض/.test(tabs[2] ?? ''), tabs.slice(0, 4).join(' | '));
  await page.locator('.sh-tabs button', { hasText: 'فحص سريع' }).click();
  await page.waitForTimeout(500);
  const titles = ['General Examination', 'Local Exam — Side', 'Shoulder', 'Elbow', 'Wrist & Hand', 'Cervical Spine', 'Lumbar Spine', 'Hip', 'Knee', 'Ankle & Foot', 'Neurological Examination', 'Vascular Examination', 'Joint Stability', 'ROM & Muscle Examination', 'Pain Assessment', 'Clinical Impression'];
  const missing = [];
  for (const t of titles) if (!(await page.locator('.modal', { hasText: t }).count())) missing.push(t);
  check('أقسام الورقة ظاهرين (وكل مفصل مربع لوحده)', missing.length === 0, missing.join(', '));
  const nav = await page.locator('.modal button', { hasText: 'التالي: متابعة المريض' }).count() + await page.locator('.modal button', { hasText: 'رجوع: الشيت العام' }).count();
  check('أزرار رجوع/التالي في «فحص سريع»', nav === 2);
  await page.screenshot({ path: shot('quick-exam'), fullPage: false });
  // كل مفصل مربع لوحده بيتفتح ويتقفل
  const knee = page.locator('.sh-box', { hasText: 'Knee' }).filter({ hasNotText: 'General' }).last();
  await knee.getByRole('button', { name: 'فتح' }).click();
  check('مربع «Knee» بيتفتح لوحده وفيه اختباراته', (await knee.getByText('McMurray').count()) === 1 && (await page.locator('.sh-box', { hasText: 'Shoulder' }).getByText('Neer').count()) === 0);
  await page.screenshot({ path: shot('quick-exam-knee'), fullPage: false });
  await knee.getByRole('button', { name: 'إغلاق' }).click();
  // المربع بيفتح بعرض الشاشة كله (sh-box--wide) والاختيارات على أعمدة
  await page.locator('.sh-box', { hasText: 'General Examination' }).getByRole('button', { name: 'فتح' }).click();
  const box = page.locator('.sh-box', { hasText: 'General Examination' });
  const boxW = await box.evaluate((el) => el.getBoundingClientRect().width);
  const gridW = await box.evaluate((el) => el.parentElement.getBoundingClientRect().width);
  check('«General Examination» بيفتح بعرض الشيت كله', boxW > gridW * 0.9, `${Math.round(boxW)} من ${Math.round(gridW)}`);
  await box.scrollIntoViewIfNeeded();
  await page.screenshot({ path: shot('quick-exam-open'), fullPage: false });
  await page.setViewportSize({ width: 412, height: 860 }); await page.waitForTimeout(400);
  await box.scrollIntoViewIfNeeded();
  await page.screenshot({ path: shot('quick-exam-open-phone'), fullPage: false });
  await page.setViewportSize({ width: 1366, height: 860 });
  // رجوع المتصفح/الموبايل: خطوة واحدة لورا (التاب اللي قبلها) — مش يقفل الكشف كله
  const sel = async () => (await page.locator('.sh-tabs button[aria-selected="true"]').innerText()).replace(/\s+/g, ' ').trim();
  await page.locator('.sh-tabs button', { hasText: 'متابعة المريض' }).click(); await page.waitForTimeout(300);
  await page.goBack(); await page.waitForTimeout(500);
  const b1 = await page.locator('.modal').count() ? await sel() : 'اتقفل';
  await page.locator('.sh-tabs button', { hasText: 'الشيت العام' }).click().catch(() => {}); await page.waitForTimeout(300);
  await page.goBack(); await page.waitForTimeout(500);
  const b2 = await page.locator('.modal').count() ? await sel() : 'اتقفل';
  check('رجوع ← التاب اللي قبلها (متابعة المريض ← فحص سريع، الشيت العام ← فحص سريع)', /فحص سريع/.test(b1) && /فحص سريع/.test(b2), `${b1} | ${b2}`);
  await page.goBack(); await page.waitForTimeout(500);
  const b3 = await page.locator('.modal').count() ? await sel() : 'اتقفل';
  check('رجوع تاني ← الشيت العام (أول تاب)', /الشيت العام/.test(b3), b3);
  await page.goBack(); await page.waitForTimeout(600);
  check('لما الخطوات تخلص الرجوع بيقفل الكشف ويفضل في نفس الصفحة', (await page.locator('.modal', { hasText: 'كشف جديد' }).count()) === 0 && page.url().includes('/diagnosis'), page.url());
  await page.locator('.modal__foot').getByRole('button', { name: 'إلغاء' }).click().catch(() => {});
  check('من غير أخطاء JavaScript', errors.length === 0, errors.join(' | ').slice(0, 300));
} catch (e) {
  check('تنفيذ الاختبار بدون أخطاء غير متوقعة', false, String(e?.stack ?? e).split('\n').slice(0, 3).join(' | '));
} finally {
  section('تنظيف');
  await sql(`delete from ortho_medications where name = '${MED}'`).catch(() => {});
  if (empId) { await sql(`delete from attendance where employee_id = '${empId}'`).catch(() => {}); await deleteEmployee(empId).catch(() => {}); }
  await browser?.close(); await server?.close();
  save('e2e-med-notes-dxfilter-results.json');
  setTimeout(() => process.exit(), 200);
}
