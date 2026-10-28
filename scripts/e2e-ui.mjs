// اختبار الواجهة في متصفح حقيقي (Microsoft Edge عن طريق playwright-core) على قاعدة Supabase الحقيقية:
// بيعمل حسابات اختبار مؤقتة (مدير/استقبال/محاسب/طبيب + حساب مريض)، يدخل من شاشة الدخول نفسها، ويفتح كل صفحة لكل دور:
// لازم الصفحة تظهر (عنوان أو «ما فيه صلاحية») من غير شاشة «حدث خطأ غير متوقع» ولا أخطاء JavaScript،
// ومن غير سكرول عرضي على الموبايل، والخط IBM Plex Sans Arabic متحمّل وواصل للحقول.
// بيشغّل Vite بنفسه على بورت 4689 (مش بيلمس سيرفر التطوير على 4660). كل البيانات بتتمسح في الآخر.
//   node scripts/e2e-ui.mjs
import { mkdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { createServer } from 'vite';
import { chromium } from 'playwright-core';
import { allDayHours, api, cairoDate, deleteEmployee, env, fakeEgyptianId, loginAdmin, randomPassword, sql, suite, URL_ } from './_harness.mjs';

const { check, section, save } = suite();
// UI_BASE=https://beltagy-ortho.pages.dev ← يختبر الموقع المنشور نفسه بدل سيرفر Vite محلي
const PORT = 4689, BASE = (process.env.UI_BASE || `http://127.0.0.1:${PORT}`).replace(/\/$/, '');
const PW = randomPassword();
const SHOTS = new URL('../docs/ui-failures/', import.meta.url);
const STAFF = {
  admin: { phone: '01200000961', digits: '201200000961', name: 'مدير واجهة اختبار', role: 'system_admin' },
  recep: { phone: '01200000962', digits: '201200000962', name: 'استقبال واجهة اختبار', role: 'reception' },
  acc: { phone: '01200000963', digits: '201200000963', name: 'محاسب واجهة اختبار', role: 'accountant' },
  doc: { phone: '01200000964', digits: '201200000964', name: 'طبيب واجهة اختبار', role: 'therapist' },
};
const PATIENT = { phone: '01200000965', digits: '201200000965', name: 'مريض واجهة اختبار' };
// نفس مسارات src/App.tsx (من غير التحويلات) — /patients/:id بيتفتح على ملف مريض الاختبار
const STAFF_ROUTES = ['/', '/patients', '/booking', '/appointments', '/body-map', '/sessions', '/services', '/diagnosis', '/consultations', '/imaging', '/fractures',
  '/surgeries', '/employees', '/work-hours', '/requests', '/attendance', '/loyalty', '/support', '/discounts', '/campaigns', '/invoices', '/finance', '/payroll',
  '/payroll/staff', '/payroll/reports', '/product-sales', '/installments', '/inventory', '/reports', '/marketing-report', '/notifications', '/roles', '/settings', '/account'];
const PATIENT_ROUTES = ['/me', '/me/book', '/me/appointments', '/me/file', '/me/exams', '/me/records', '/me/plans', '/me/points', '/me/invoices', '/me/notifications', '/me/account'];
const MOBILE_CHECK = new Set(['/', '/patients', '/booking', '/appointments', '/consultations', '/invoices', '/work-hours', '/payroll', '/inventory', '/diagnosis', '/me', '/me/book', '/me/records', '/me/appointments']);
const made = { employees: [], therapist: null, patients: [] };
// ضوضاء معروفة مش أخطاء في الصفحات: إشعارات المتصفح، Realtime بيعيد الاتصال، وطلبات اتلغت لما الصفحة اتغيرت
const NOISE = /Notification|push|ServiceWorker|service worker|WebSocket|realtime|ERR_ABORTED|AbortError|Failed to load resource.*(favicon|manifest)|Download the React DevTools/i;

let server, browser;
try {
  section('التجهيز');
  const admin = await loginAdmin();
  const th = await admin.rpc('save_therapist', { p: { name: 'د. اختبار واجهة', title: 'طبيب اختبار', phone: '', serviceIds: ['sv_exam', 'sv_followup', 'sv_physio'], workHours: allDayHours(), onLeave: [], active: true, defaultDurationMin: 30 } });
  made.therapist = th.data?.id ?? th.data;
  for (const [k, s] of Object.entries(STAFF)) {
    const r = await api(admin, 'POST', 'staff', { name: s.name, phone: s.phone, country: 'EG', password: PW, role: s.role, therapistId: k === 'doc' ? made.therapist : undefined, workHours: allDayHours() });
    if (r.body?.id) made.employees.push(r.body.id);
    check(`حساب ${s.name}`, r.status === 201, JSON.stringify(r.body).slice(0, 120));
  }
  const reg = await fetch(`${URL_}/functions/v1/api/register`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ name: PATIENT.name, phone: PATIENT.phone, password: PW, confirm: PW }) });
  const regB = await reg.json().catch(() => null);
  if (regB?.patientId) made.patients.push(regB.patientId);
  check('حساب مريض الاختبار', reg.status === 201, JSON.stringify(regB));
  // بيانات تتعرض في الصفحات: رقم قومي + موعد + كشف وروشتة للمريض
  await admin.from('patients').update({ national_id: fakeEgyptianId(), gender: 'male' }).eq('id', regB?.patientId);
  const bk = await admin.rpc('book_appointment', { p: { patientId: regB?.patientId, type: 'initial', serviceId: 'sv_exam', therapistId: made.therapist, date: cairoDate(5), time: '18:00', location: 'center' } });
  check('موعد للمريض', !bk.error, bk.error?.message);
  const docEmp = made.employees[3];
  await sql(`insert into ortho_consultations (patient_id, complaint, region, side, diagnosis, plan, medications, follow_up, created_by)
    values ('${regB?.patientId}', 'ألم ركبة اختبار', 'الركبة', 'right', 'خشونة ركبة اختبار', 'راحة', '[{"name":"Panadol 500mg","dose":"قرص","frequency":"3 مرات","duration":"5 أيام","notes":""}]', '${cairoDate(14)}', '${docEmp}')`);

  if (!process.env.UI_BASE) server = await createServer({ configFile: fileURLToPath(new URL('../vite.config.ts', import.meta.url)), root: fileURLToPath(new URL('..', import.meta.url)), logLevel: 'error', server: { port: PORT, strictPort: true, host: '127.0.0.1' } });
  await server?.listen();
  browser = await chromium.launch({ channel: 'msedge', headless: true });
  mkdirSync(SHOTS, { recursive: true });

  // دخول من الشاشة نفسها + زيارة كل مسار بالتنقل جوّه التطبيق (من غير إعادة تحميل)
  const runRole = async (label, digits, phone, routes, home) => {
    section(`الواجهة — ${label}`);
    const ctx = await browser.newContext({ viewport: { width: 1366, height: 860 }, locale: 'ar-EG' });
    const page = await ctx.newPage();
    const errors = [];
    page.on('pageerror', (e) => errors.push('pageerror: ' + e.message));
    page.on('console', (m) => { if (m.type() === 'error' && !NOISE.test(m.text())) errors.push('console: ' + m.text()); });
    await page.goto(BASE + '/login');
    await page.fill('#al-phone', phone);
    await page.fill('#al-pass', PW);
    await page.click('button[type=submit]');
    const logged = await page.waitForURL((u) => u.pathname === home, { timeout: 30000 }).then(() => true).catch(() => false);
    check(`${label}: الدخول من شاشة الدخول`, logged, page.url());
    if (!logged) { await page.screenshot({ path: fileURLToPath(new URL(`login-${digits}.png`, SHOTS)) }); await ctx.close(); return; }
    for (const path of routes) {
      errors.length = 0;
      await page.evaluate((p) => { window.history.pushState({}, '', p); window.dispatchEvent(new PopStateEvent('popstate')); }, path);
      const ok = await page.waitForSelector('.page h1, .page .empty h3', { timeout: 20000 }).then(() => true).catch(() => false);
      await page.waitForTimeout(600); // بيانات الصفحة بتوصل بعد العنوان
      // لحد ما هياكل التحميل (.skel) تختفي من الصفحة = البيانات وصلت فعلًا؛ لو فضلت 15 ثانية يبقى الصفحة مابتحمّلش بياناتها
      const loaded = await page.waitForFunction(() => !document.querySelector('.page .skel'), null, { timeout: 15000 }).then(() => true).catch(() => false);
      if (!loaded) errors.push('بيانات الصفحة ماوصلتش خلال 15 ثانية (هيكل التحميل لسه ظاهر)');
      const crashed = await page.locator('text=حدث خطأ غير متوقع').count();
      const denied = await page.locator('text=ما فيه صلاحية').count();
      const title = ok ? (await page.locator('.page h1, .page .empty h3').first().textContent())?.trim() : '';
      const good = ok && !crashed && errors.length === 0;
      if (!good) await page.screenshot({ path: fileURLToPath(new URL(`${label.replace(/\s+/g, '-')}${path.replace(/\//g, '_')}.png`, SHOTS)), fullPage: true });
      // UI_SHOTS=1 ← صورة لكل صفحة في docs/ui-shots (للمراجعة بالعين)
      if (process.env.UI_SHOTS && good && !denied) {
        mkdirSync(new URL('../docs/ui-shots/', import.meta.url), { recursive: true });
        await page.screenshot({ path: fileURLToPath(new URL(`../docs/ui-shots/${label.replace(/\s+/g, '-')}${path.replace(/\//g, '_') || '_'}.png`, import.meta.url)) });
      }
      check(`${label}: ${path} ${denied ? '(ما فيه صلاحية)' : `«${title}»`}`, good, crashed ? 'ErrorBoundary' : !ok ? 'الصفحة ماظهرتش خلال 20 ثانية' : errors.join(' | ').slice(0, 300));
      if (MOBILE_CHECK.has(path) && !denied) {
        await page.setViewportSize({ width: 390, height: 844 });
        await page.waitForTimeout(250);
        // لو فيه سكرول: أوسع عنصر طالع برّه الشاشة (عشان يبان مين السبب)
        const { over, culprit } = await page.evaluate(() => {
          const w = window.innerWidth;
          let worst = null, worstOut = 0;
          // القائمة الجانبية المقفولة وأي درج ثابت مابيعملوش سكرول، والعنصر جوّه حاوية بسكرول خاص بيها (جدول) مقصوص فيها
          const hidden = (el) => {
            for (let x = el.parentElement; x && x !== document.body; x = x.parentElement) {
              const cs = getComputedStyle(x);
              if (cs.position === 'fixed' || cs.overflowX !== 'visible') return true;
            }
            return getComputedStyle(el).position === 'fixed';
          };
          for (const el of document.querySelectorAll('body *')) {
            if (hidden(el)) continue;
            const r = el.getBoundingClientRect();
            const out = Math.max(r.right - w, -r.left);
            if (r.width && out > worstOut + 0.5) { worstOut = out; worst = el; }
          }
          const tag = (e) => e ? `${e.tagName.toLowerCase()}${e.id ? '#' + e.id : ''}${e.className && typeof e.className === 'string' && e.className.trim() ? '.' + e.className.trim().split(/\s+/).join('.') : ''}` : '';
          const name = worst ? `${tag(worst.parentElement)} > ${tag(worst)} «${(worst.textContent ?? '').trim().slice(0, 30)}» (${Math.round(worstOut)}px)` : '';
          return { over: document.documentElement.scrollWidth - w, culprit: name };
        });
        check(`${label}: ${path} على الموبايل بدون سكرول عرضي`, over <= 1, `أعرض من الشاشة بـ ${over}px — ${culprit}`);
        await page.setViewportSize({ width: 1366, height: 860 });
      }
    }
    // الخط: متحمّل فعلًا، والحقول واخداه (مش خط المتصفح الافتراضي)
    const font = await page.evaluate(async () => {
      await document.fonts.ready;
      const el = document.querySelector('input.input, select.input, textarea.input');
      return { loaded: document.fonts.check('600 15px "IBM Plex Sans Arabic"'), body: getComputedStyle(document.body).fontFamily, field: el ? getComputedStyle(el).fontFamily : null };
    });
    check(`${label}: خط IBM Plex Sans Arabic متحمّل`, font.loaded && /IBM Plex Sans Arabic/.test(font.body), JSON.stringify(font));
    if (font.field !== null) check(`${label}: الحقول بنفس خط النظام`, /IBM Plex Sans Arabic/.test(font.field), JSON.stringify(font));
    await ctx.close();
  };

  // UI_ROLES=admin,patient لتشغيل أدوار بعينها بس
  const only = (process.env.UI_ROLES ?? '').split(',').filter(Boolean);
  const want = (k) => !only.length || only.includes(k);
  if (want('admin')) await runRole('المدير', STAFF.admin.digits, STAFF.admin.phone, [...STAFF_ROUTES, `/patients/${regB?.patientId}`], '/');
  if (want('recep')) await runRole('الاستقبال', STAFF.recep.digits, STAFF.recep.phone, [...STAFF_ROUTES, `/patients/${regB?.patientId}`], '/');
  if (want('acc')) await runRole('المحاسب', STAFF.acc.digits, STAFF.acc.phone, STAFF_ROUTES, '/');
  if (want('doc')) await runRole('الطبيب', STAFF.doc.digits, STAFF.doc.phone, [...STAFF_ROUTES, `/patients/${regB?.patientId}`], '/');
  if (want('patient')) await runRole('المريض', PATIENT.digits, PATIENT.phone, PATIENT_ROUTES, '/me');

  section('صفحات عامة (بدون دخول)');
  const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, locale: 'ar-EG' });
  const page = await ctx.newPage();
  const errs = [];
  page.on('pageerror', (e) => errs.push(e.message));
  for (const path of ['/', '/login', '/signup']) {
    errs.length = 0;
    await page.goto(BASE + path);
    await page.waitForLoadState('networkidle').catch(() => {});
    const over = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
    check(`${path} بيفتح على الموبايل من غير أخطاء ولا سكرول عرضي`, errs.length === 0 && over <= 1, errs.join(' | ') || `over ${over}px`);
  }
  await ctx.close();
} catch (e) {
  check('تنفيذ الاختبارات بدون أخطاء غير متوقعة', false, e.message);
} finally {
  await browser?.close().catch(() => {});
  await server?.close().catch(() => {});
  section('تنظيف بيانات الاختبار');
  try {
    const custs = await sql(`select id, auth_user_id from customers where phone = '+${PATIENT.digits}'`);
    await sql(`delete from notifications where customer_id in (select id from customers where phone = '+${PATIENT.digits}'); delete from customers where phone = '+${PATIENT.digits}';`);
    for (const c of custs) if (c.auth_user_id) await fetch(`${URL_}/auth/v1/admin/users/${c.auth_user_id}`, { method: 'DELETE', headers: { apikey: env.SUPABASE_SERVICE_ROLE_KEY, Authorization: 'Bearer ' + env.SUPABASE_SERVICE_ROLE_KEY } });
    if (made.patients.length) await sql(`delete from patients where id in (${made.patients.map((x) => `'${x}'`).join(',')});`);
    for (const id of made.employees) { await sql(`delete from attendance where employee_id = '${id}';`); await deleteEmployee(id); }
    if (made.therapist) await sql(`delete from therapist_services where therapist_id = '${made.therapist}'; delete from therapists where id = '${made.therapist}';`);
    await sql(`delete from register_attempts where phone_last9 = '${PATIENT.digits.slice(-9)}';
      delete from notifications where body like '%اختبار%' or title like '%اختبار%';`); // سجل التدقيق والنشاط بيفضل زي ما هو
    const [left] = await sql(`select (select count(*) from patients where full_name like '%اختبار%')::int p, (select count(*) from employees where name like '%اختبار%')::int e, (select count(*) from customers where phone = '+${PATIENT.digits}')::int c`);
    console.log('  متبقي من بيانات الاختبار:', JSON.stringify(left));
  } catch (e) { console.log('  تنظيف ناقص:', e.message); }
  save('e2e-ui-results.json');
}
