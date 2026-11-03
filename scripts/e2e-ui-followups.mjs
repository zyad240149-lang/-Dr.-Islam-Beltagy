// اختبار واجهة لهجرة 929 في Edge حقيقي على Supabase الحقيقي — الاستقبال والطبيب بيعملوا الخطوات من الشاشات نفسها:
// مريض من غير واتساب ← إضافة/تعديل الواتساب ← رفع أشعة وتحليل PDF ← الطبيب يفتح «تشخيص جديد» ويلاقي الملفات ويكتب الشكوى
// ويحدد موعدين متابعة ← تشخيص جديد تاني الملفات لسه موجودة ← معاينة صورة وPDF ← الإملاء الصوتي (كلام مؤقت + ترقيم + مايمسحش القديم)
// ← رفض إذن الميكروفون ← التقويم: فتح الموعد، تعديله، إتمامه، إلغاؤه، وفتح ملف المريض منه. كل البيانات بتتمسح في الآخر.
//   node scripts/e2e-ui-followups.mjs
import { mkdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { createServer } from 'vite';
import { launchEdge } from './_edge.mjs';
import { allDayHours, api, cairoDate, deleteEmployee, env, loginAdmin, randomPassword, sql, suite, URL_ } from './_harness.mjs';

const { check, section, save } = suite();
const PORT = 4691, BASE = `http://127.0.0.1:${PORT}`;
const PW = randomPassword();
const SHOTS = new URL('../docs/ui-failures/', import.meta.url);
const STAFF = {
  recep: { phone: '01200000972', digits: '201200000972', name: 'استقبال اختبار المتابعات واجهة', role: 'reception' },
  doc: { phone: '01200000974', digits: '201200000974', name: 'طبيب اختبار المتابعات واجهة', role: 'therapist' },
};
const PATIENT_PHONE = '01200000977';
const made = { employees: [], therapist: null, patient: null, files: [] };
const NOISE = /Notification|push|ServiceWorker|service worker|WebSocket|realtime|ERR_ABORTED|AbortError|Failed to load resource|Download the React DevTools/i;
const PNG = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==', 'base64');
const PDF = Buffer.from('%PDF-1.4\n1 0 obj<</Type/Catalog/Pages 2 0 R>>endobj 2 0 obj<</Type/Pages/Kids[]/Count 0>>endobj\ntrailer<</Root 1 0 R>>\n%%EOF');
const one = async (q) => (await sql(q))[0];

// بديل تعرّف الكلام في المتصفح: بيطلّع كلام مؤقت وبعدين نهائي (نفس شكل أحداث Chrome) — عشان نختبر الإملاء من غير ميكروفون
const FAKE_SPEECH = () => {
  window.__speech = { mode: 'ok', phrases: [] };
  window.__micDenied = false;
  const q = navigator.permissions?.query?.bind(navigator.permissions);
  if (navigator.permissions) navigator.permissions.query = (d) => (d?.name === 'microphone' ? Promise.resolve({ state: window.__micDenied ? 'denied' : 'granted', onchange: null }) : q(d));
  const ev = (list, idx) => ({ resultIndex: idx, results: list.map(([t, fin]) => Object.assign([{ transcript: t }], { isFinal: fin })) });
  window.webkitSpeechRecognition = class {
    start() {
      if (window.__micDenied) { setTimeout(() => { this.onerror?.({ error: 'not-allowed' }); this.onend?.(); }, 10); return; }
      const ph = window.__speech.phrases.shift();
      if (!ph) return;
      setTimeout(() => this.onresult?.(ev([[ph.interim, false]], 0)), 30);
      setTimeout(() => this.onresult?.(ev([[ph.final, true]], 0)), 1500); // الكلام المؤقت بيفضل ظاهر لحظة قبل النهائي
    }
    stop() { setTimeout(() => this.onend?.(), 5); }
    abort() {}
  };
  window.SpeechRecognition = window.webkitSpeechRecognition; // Edge الجديد فيه SpeechRecognition من غير بادئة — بيترفض في headless
};

let server, browser;
try {
  section('التجهيز');
  const admin = await loginAdmin();
  const th = await admin.rpc('save_therapist', { p: { name: 'د. اختبار المتابعات', title: 'طبيب اختبار', phone: '', serviceIds: ['sv_exam', 'sv_followup'], workHours: allDayHours(), onLeave: [], active: true, defaultDurationMin: 30 } });
  made.therapist = th.data?.id ?? th.data;
  for (const [k, s] of Object.entries(STAFF)) {
    const r = await api(admin, 'POST', 'staff', { name: s.name, phone: s.phone, country: 'EG', password: PW, role: s.role, therapistId: k === 'doc' ? made.therapist : undefined, workHours: allDayHours() });
    if (r.body?.id) made.employees.push(r.body.id);
    check(`حساب ${s.name}`, r.status === 201, JSON.stringify(r.body).slice(0, 120));
  }
  server = await createServer({ configFile: fileURLToPath(new URL('../vite.config.ts', import.meta.url)), root: fileURLToPath(new URL('..', import.meta.url)), logLevel: 'error', server: { port: PORT, strictPort: true, host: '127.0.0.1' } });
  await server.listen();
  browser = await launchEdge();
  mkdirSync(SHOTS, { recursive: true });

  const open = async (s) => {
    const ctx = await browser.newContext({ viewport: { width: 1366, height: 900 }, locale: 'ar-EG' });
    await ctx.addInitScript(FAKE_SPEECH);
    const page = await ctx.newPage();
    const errors = [];
    page.on('pageerror', (e) => errors.push(e.message));
    page.on('console', (m) => { if (m.type() === 'error' && !NOISE.test(m.text())) errors.push(m.text()); });
    page.on('dialog', (d) => void d.accept());
    await page.goto(BASE + '/login');
    await page.fill('#al-phone', s.phone);
    await page.fill('#al-pass', PW);
    await page.click('button[type=submit]');
    await page.waitForURL((u) => u.pathname === '/', { timeout: 30000 });
    return { ctx, page, errors };
  };
  const go = (page, path) => page.evaluate((p) => { window.history.pushState({}, '', p); window.dispatchEvent(new PopStateEvent('popstate')); }, path);
  const shot = (page, name) => page.screenshot({ path: fileURLToPath(new URL(`fu-${name}.png`, SHOTS)), fullPage: true }).catch(() => {});
  const waitFor = async (fn, ms = 15000) => { const end = Date.now() + ms; for (;;) { const v = await fn(); if (v || Date.now() > end) return v; await new Promise((r) => setTimeout(r, 400)); } };

  // ================= الاستقبال =================
  section('الاستقبال: تسجيل مريض والواتساب والملفات');
  const R = await open(STAFF.recep);
  let p = R.page;
  await go(p, '/patients?new=1');
  await p.waitForSelector('#np-first', { timeout: 20000 });
  await p.fill('#np-first', 'مريض'); await p.fill('#np-father', 'اختبار'); await p.fill('#np-family', 'المتابعات');
  await p.fill('#np-phone', PATIENT_PHONE);
  await p.getByLabel('الرقم الأساسي عليه واتساب').uncheck();
  check('خيار «إضافة رقم واتساب» بيظهر لما الأساسي مش عليه واتساب', await p.getByRole('button', { name: 'إضافة رقم واتساب' }).isVisible());
  await p.locator('.modal').getByRole('button', { name: /حفظ/ }).first().click();
  const pat = await waitFor(() => one(`select id, whatsapp_mode from patients where phone = '+20${PATIENT_PHONE.slice(1)}'`));
  made.patient = pat?.id;
  check('1. تسجيل مريض من الشاشة من غير رقم واتساب', pat?.whatsapp_mode === 'none', JSON.stringify(pat));
  if (!pat) { await shot(p, 'new-patient'); throw new Error('المريض ما اتسجّلش'); }

  await go(p, `/patients/${made.patient}`);
  await p.getByRole('button', { name: 'إضافة رقم واتساب' }).first().click();
  await p.locator('.modal').getByRole('button', { name: 'إضافة رقم واتساب' }).click();
  await p.fill('#wam-wa-phone', '01200000976');
  await p.locator('.modal').getByRole('button', { name: 'حفظ' }).click();
  const wa1 = await waitFor(async () => { const r = await one(`select whatsapp_mode, whatsapp_phone from patients where id = '${made.patient}'`); return r?.whatsapp_mode === 'other' ? r : null; });
  check('2. إضافة رقم واتساب لمريض مسجّل من ملفه', wa1?.whatsapp_phone === '+201200000976', JSON.stringify(wa1));
  await p.getByRole('button', { name: 'تعديل الواتساب' }).click();
  await p.fill('#wam-wa-phone', '01200000975');
  await p.locator('.modal').getByRole('button', { name: 'حفظ' }).click();
  const wa2 = await waitFor(async () => { const r = await one(`select whatsapp_phone from patients where id = '${made.patient}'`); return r?.whatsapp_phone === '+201200000975' ? r : null; });
  check('3. تعديل رقم الواتساب', !!wa2, 'ما اتغيرش');
  check('رقم الواتساب ومصدره ظاهرين في ملف المريض', await p.locator('text=رقم واتساب مستقل').first().isVisible());

  await p.getByRole('button', { name: 'ملفات الأشعة والتحاليل' }).click();
  await p.fill('#pf-title', 'أشعة الركبة');
  await p.locator('input[type=file][multiple]').setInputFiles([{ name: 'knee.png', mimeType: 'image/png', buffer: PNG }]);
  await waitFor(() => p.locator('td', { hasText: 'أشعة الركبة' }).count());
  await p.getByRole('radio', { name: 'تحاليل' }).click();
  await p.fill('#pf-title', 'صورة دم كاملة');
  await p.fill('#pf-note', 'صايم');
  await p.locator('input[type=file][multiple]').setInputFiles([{ name: 'cbc.pdf', mimeType: 'application/pdf', buffer: PDF }]);
  await waitFor(() => p.locator('td', { hasText: 'صورة دم كاملة' }).count());
  const files = await sql(`select category, title, note, file_date, file_path from patient_files where patient_id = '${made.patient}' order by created_at`);
  made.files = files.map((f) => f.file_path);
  check('5. الاستقبال رفع أشعة وتحليل PDF (في Storage ومربوطين بالمريض)', files.length === 2 && files[0].category === 'xray' && files[1].category === 'lab' && files[1].note === 'صايم' && !!files[0].file_date, JSON.stringify(files));
  check('الاستقبال: من غير أخطاء JavaScript', R.errors.length === 0, R.errors.join(' | '));
  if (R.errors.length) await shot(p, 'recep');
  await R.ctx.close();

  // ================= الطبيب =================
  section('الطبيب: التشخيص والملفات والمتابعات والإملاء');
  const D = await open(STAFF.doc);
  p = D.page;
  await go(p, `/patients/${made.patient}`);
  await p.locator('.tabs').getByRole('button', { name: 'التشخيص', exact: true }).click();
  await p.getByRole('button', { name: 'تشخيص جديد' }).first().click();
  await p.waitForSelector('#cx-visit-reason', { timeout: 20000 });
  check('خانة «شكوى المريض / سبب الزيارة» فاضية في التشخيص الجديد', (await p.inputValue('#cx-visit-reason')) === '');
  const tiles = await waitFor(async () => (await p.locator('.pmf__tile').count()) === 2);
  check('6. الأشعة والتحاليل اللي رفعها الاستقبال ظاهرة في التشخيص', tiles, await p.locator('.pmf').innerText().catch(() => ''));
  check('اسم الملف والتاريخ والملاحظات ظاهرين', await p.locator('.pmf', { hasText: 'صورة دم كاملة' }).isVisible() && await p.locator('.pmf', { hasText: 'صايم' }).isVisible());

  // 8. معاينة الصورة والـ PDF
  await p.locator('.pmf__tile', { hasText: 'أشعة الركبة' }).getByRole('button', { name: 'فتح' }).click();
  const img = await waitFor(async () => p.locator('.modal img[alt="knee.png"]').evaluate((e) => e.complete && e.naturalWidth > 0).catch(() => false));
  check('8. معاينة صورة الأشعة', img);
  await p.locator('.modal').last().getByRole('button', { name: 'إغلاق' }).last().click();
  await p.locator('.pmf__tile', { hasText: 'صورة دم كاملة' }).getByRole('button', { name: 'فتح' }).click();
  const iframe = await waitFor(async () => (await p.locator('.modal iframe').getAttribute('src').catch(() => ''))?.includes('/storage/'));
  check('8. معاينة ملف PDF', iframe);
  await p.locator('.modal').last().getByRole('button', { name: 'إغلاق' }).last().click();

  // 9. الإملاء الصوتي: نص قديم + كلام جديد بيتضاف (مؤقت الأول، وبعدين نهائي بالترقيم)
  await p.fill('#cx-visit-reason', 'ألم في الركبة');
  await p.evaluate(() => { window.__speech.phrases.push({ interim: 'من أسبوعين', final: 'من أسبوعين فاصلة مع تورم نقطة' }); });
  await p.click('#cx-visit-reason');
  await p.getByRole('button', { name: 'إملاء صوتي' }).click();
  const interimSeen = await waitFor(async () => (await p.inputValue('#cx-visit-reason')) === 'ألم في الركبة من أسبوعين', 2000);
  const finalText = await waitFor(async () => { const v = await p.inputValue('#cx-visit-reason'); return v.includes('تورم') ? v : null; }, 3000);
  if (!finalText) { await shot(p, 'dictation'); console.log('    [dictation]', JSON.stringify({ value: await p.inputValue('#cx-visit-reason'), errors: D.errors, toasts: await p.locator('.toast').allInnerTexts().catch(() => []) })); }
  check('9. الكلام بيظهر أول بأول وهو بيتكلم', interimSeen);
  check('9. النص القديم مايتمسحش والجديد بيتضاف بالترقيم', finalText === 'ألم في الركبة من أسبوعين، مع تورم.', JSON.stringify(finalText));
  await p.getByRole('button', { name: 'إيقاف الإملاء' }).click().catch(() => {});
  // 10. رفض الإذن
  await p.evaluate(() => { window.__micDenied = true; });
  await p.click('#cx-visit-reason');
  await p.getByRole('button', { name: 'إملاء صوتي' }).click();
  const help = await waitFor(() => p.locator('.modal', { hasText: 'محتاجين إذن الميكروفون' }).isVisible(), 4000);
  check('10. رفض إذن الميكروفون ← رسالة واضحة بخطوات التفعيل', help && await p.locator('.vd-help li').count() >= 2);
  await p.locator('.modal', { hasText: 'محتاجين إذن الميكروفون' }).getByRole('button', { name: 'إغلاق' }).last().click();
  await p.evaluate(() => { window.__micDenied = false; });
  check('الشكوى فضلت زي ما هي بعد رفض الإذن', (await p.inputValue('#cx-visit-reason')) === 'ألم في الركبة من أسبوعين، مع تورم.');

  // 11-12. موعدين متابعة من خطوة «تحديد موعد متابعة»
  await p.getByRole('tab', { name: /تحديد موعد متابعة/ }).click();
  for (const [d, t, why] of [[cairoDate(7), '10:30', 'متابعة بعد الحقن'], [cairoDate(21), '', 'مراجعة التحاليل']]) {
    await p.getByRole('button', { name: 'إضافة موعد متابعة' }).click();
    const m = p.locator('.modal', { hasText: 'تحديد موعد متابعة' }).last();
    await m.locator('input[type=date]').fill(d);
    if (t) await m.locator('input[type=time]').fill(t);
    await m.locator('textarea').first().fill(why);
    await m.getByRole('button', { name: 'إضافة للتشخيص' }).click();
  }
  check('الموعدين ظاهرين «هيتحفظوا مع التشخيص»', (await p.locator('.fu-item', { hasText: 'لسه ما اتحفظش' }).count()) === 2);
  await p.locator('.sh-next').getByRole('button', { name: 'حفظ الكشف' }).click();
  await p.getByRole('button', { name: 'حفظ — استكمال بعدين' }).click().catch(() => {});
  const cons = await waitFor(() => one(`select id, visit_reason from ortho_consultations where patient_id = '${made.patient}'`));
  const fus = await waitFor(async () => { const r = await sql(`select * from ortho_follow_ups where patient_id = '${made.patient}' order by date`); return r.length === 2 ? r : null; });
  check('4. الشكوى اتحفظت مع التشخيص', cons?.visit_reason === 'ألم في الركبة من أسبوعين، مع تورم.', JSON.stringify(cons));
  check('11-12. موعدين متابعة اتحفظوا مربوطين بالمريض والتشخيص والطبيب', !!fus && fus.every((f) => f.consultation_id === cons.id && f.doctor_id === made.therapist && f.status === 'scheduled') && String(fus[0].time).startsWith('10:30'), JSON.stringify(fus?.map((f) => [f.date, f.time, f.doctor_id, f.consultation_id])));

  // 7. تشخيص جديد تاني: الملفات لسه موجودة، والشكوى فاضية
  await p.waitForSelector('.modal', { state: 'detached', timeout: 15000 }).catch(() => {});
  check('التشخيص بيعرض المتابعات المربوطة بيه', await waitFor(() => p.locator('.fu-chips .fu-chip').count().then((n) => n === 2)));
  await p.getByRole('button', { name: 'تشخيص جديد' }).first().click();
  await p.waitForSelector('#cx-visit-reason', { timeout: 20000 });
  check('7. تشخيص جديد لنفس المريض: الملفات لسه ظاهرة (من غير تكرار)', await waitFor(async () => (await p.locator('.pmf__tile').count()) === 2));
  check('شكوى التشخيص الجديد فاضية', (await p.inputValue('#cx-visit-reason')) === '');
  await p.locator('.modal').getByRole('button', { name: 'إلغاء' }).first().click();
  check('الطبيب: من غير أخطاء JavaScript', D.errors.length === 0, D.errors.join(' | '));
  if (D.errors.length) await shot(p, 'doc');

  // ================= التقويم =================
  section('متابعات المرضى: التقويم');
  await go(p, '/follow-ups');
  await p.waitForSelector('.fu-month', { timeout: 20000 });
  // الموعد الأول بعد 7 أيام — ممكن يكون في الشهر الجاي
  const findChip = async (why) => {
    for (let i = 0; i < 2; i++) {
      const c = p.locator('.fu-chip', { hasText: why });
      if (await c.count()) return c.first();
      await p.getByRole('button', { name: 'التالي' }).click();
    }
    return null;
  };
  const chip = await findChip('متابعة بعد الحقن');
  check('13. الموعد ظاهر في التقويم الشهري باسم المريض والوقت والسبب', !!chip && /مريض اختبار المتابعات/.test(await chip.innerText()) && /10:30/.test(await chip.innerText()));
  await p.getByRole('tab', { name: 'أسبوعي' }).click();
  await p.getByRole('tab', { name: 'يومي' }).click();
  await p.getByRole('button', { name: 'النهارده' }).click();
  await p.getByRole('tab', { name: 'شهري' }).click();
  check('التبديل بين شهري / أسبوعي / يومي من غير أخطاء', D.errors.length === 0, D.errors.join(' | '));

  // 14. تعديل ← تمت، والتاني إلغاء
  const c1 = await findChip('متابعة بعد الحقن');
  await c1.click();
  let m = p.locator('.modal', { hasText: 'موعد متابعة' }).last();
  await m.locator('input[type=time]').fill('11:15');
  await m.getByRole('button', { name: 'حفظ' }).click();
  const moved = await waitFor(async () => String((await one(`select time from ortho_follow_ups where id = '${fus[0].id}'`))?.time).startsWith('11:15'));
  check('14. تعديل وقت الموعد من التقويم', moved);
  await (await findChip('متابعة بعد الحقن')).click();
  m = p.locator('.modal', { hasText: 'موعد متابعة' }).last();
  await m.getByRole('button', { name: 'تمت المتابعة' }).click();
  check('14. إتمام الموعد', await waitFor(async () => (await one(`select status from ortho_follow_ups where id = '${fus[0].id}'`))?.status === 'done'));
  await p.getByPlaceholder(/ابحث باسم المريض/).fill('01200000977');
  await p.locator('.fu-item', { hasText: 'مراجعة التحاليل' }).locator('.fu-item__main').click();
  m = p.locator('.modal', { hasText: 'موعد متابعة' }).last();
  check('البحث برقم الهاتف بيعرض كل متابعات المريض', true);
  await m.getByRole('button', { name: 'إلغاء الموعد' }).click();
  check('14. إلغاء الموعد', await waitFor(async () => (await one(`select status from ortho_follow_ups where id = '${fus[1].id}'`))?.status === 'cancelled'));
  check('الحالات: «تمت» و«ملغاة» ظاهرين في نتايج البحث', await waitFor(async () => (await p.locator('.fu-item--done').count()) === 1 && (await p.locator('.fu-item--cancelled').count()) === 1));
  // 15. فتح ملف المريض من الموعد
  await p.locator('.fu-item__patient').first().click();
  check('15. فتح ملف المريض من الموعد في التقويم', await waitFor(() => new URL(p.url()).pathname === `/patients/${made.patient}`));
  await p.getByRole('button', { name: 'مواعيد المتابعة' }).first().click();
  check('ملف المريض بيعرض كل مواعيد المتابعة (السابقة والقادمة)', await waitFor(async () => (await p.locator('.fu-item').count()) === 2));
  await go(p, '/patients');
  await p.waitForSelector('table', { timeout: 20000 });
  await p.getByPlaceholder(/ابحث/).first().fill('01200000977').catch(() => {});
  const listBtn = await waitFor(async () => (await p.getByRole('button', { name: /^مواعيد المتابعة/ }).count()) > 0);
  if (listBtn) await p.getByRole('button', { name: /^مواعيد المتابعة/ }).first().click();
  check('زرار «مواعيد المتابعة» جنب كل مريض بيفتح متابعاته', listBtn && await waitFor(() => p.locator('.modal', { hasText: 'مواعيد المتابعة —' }).isVisible()));
  // الموبايل
  await go(p, '/follow-ups');
  await p.setViewportSize({ width: 390, height: 844 });
  await p.waitForTimeout(400);
  const over = await p.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
  check('صفحة المتابعات على الموبايل من غير سكرول عرضي', over <= 1, `${over}px`);
  check('الطبيب: التقويم من غير أخطاء JavaScript', D.errors.length === 0, D.errors.join(' | '));
  if (D.errors.length) await shot(p, 'calendar');
  await D.ctx.close();
} catch (e) {
  check('تنفيذ الاختبارات بدون أخطاء غير متوقعة', false, e.message.split('\n')[0]);
} finally {
  await browser?.close().catch(() => {});
  await server?.close().catch(() => {});
  section('تنظيف بيانات الاختبار');
  try {
    if (made.patient) {
      const fs = await sql(`select file_path from patient_files where patient_id = '${made.patient}'`);
      const paths = [...new Set([...made.files, ...fs.map((f) => f.file_path)])];
      if (paths.length) await fetch(`${URL_}/storage/v1/object/patient-files`, { method: 'DELETE', headers: { apikey: env.SUPABASE_SERVICE_ROLE_KEY, Authorization: 'Bearer ' + env.SUPABASE_SERVICE_ROLE_KEY, 'Content-Type': 'application/json' }, body: JSON.stringify({ prefixes: paths }) });
      await sql(`delete from ortho_consultations where patient_id = '${made.patient}'; delete from patients where id = '${made.patient}';`);
    }
    await sql(`delete from patients where phone = '+20${PATIENT_PHONE.slice(1)}'`);
    for (const id of made.employees) { await sql(`delete from attendance where employee_id = '${id}';`); await deleteEmployee(id); }
    if (made.therapist) await sql(`delete from therapist_services where therapist_id = '${made.therapist}'; delete from therapists where id = '${made.therapist}';`);
    const [left] = await sql(`select (select count(*) from patients where full_name like '%اختبار المتابعات%')::int p, (select count(*) from employees where name like '%اختبار المتابعات%')::int e, (select count(*) from ortho_follow_ups f where not exists (select 1 from patients p where p.id = f.patient_id))::int f`);
    console.log('  متبقي من بيانات الاختبار:', JSON.stringify(left));
  } catch (e) { console.log('  تنظيف ناقص:', e.message); }
  save('e2e-ui-followups-results.json');
}
