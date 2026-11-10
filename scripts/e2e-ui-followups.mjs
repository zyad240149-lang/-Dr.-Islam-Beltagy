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
  const th = await admin.rpc('save_therapist', { p: { name: 'د. اختبار المتابعات', title: 'طبيب اختبار', phone: '', serviceIds: ['old_exam', 'old_consult'], workHours: allDayHours(), onLeave: [], active: true, defaultDurationMin: 30 } });
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
    globalThis.__lastPage = page;
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
  // ٨/١١ (1c470f7/ebb4d86): خانة اسم واحدة بدل الاسم/الأب/العيلة
  await p.waitForSelector('#np-name', { timeout: 20000 });
  await p.fill('#np-name', 'مريض اختبار المتابعات');
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
  // الأشعة والتحاليل بقت تاب لوحدها (رقم 4) في الكشف — الملفات بتظهر فيها
  await p.locator('.modal .sh-tabs button', { hasText: 'الأشعة والتحاليل' }).click();
  const tiles = await waitFor(async () => (await p.locator('.modal .pmf__tile:visible').count()) === 2);
  check('6. الأشعة والتحاليل اللي رفعها الاستقبال ظاهرة في التشخيص', tiles, await p.locator('.pmf').innerText().catch(() => ''));
  check('اسم الملف والتاريخ والملاحظات ظاهرين', await p.locator('.modal .pmf__tile:visible', { hasText: 'صورة دم كاملة' }).count() === 1 && await p.locator('.modal .pmf__tile:visible', { hasText: 'صايم' }).count() === 1);

  // 8. معاينة الصورة والـ PDF
  await p.locator('.modal .pmf__tile:visible', { hasText: 'أشعة الركبة' }).getByRole('button', { name: 'فتح' }).click();
  const img = await waitFor(async () => p.locator('.modal img[alt="knee.png"]').evaluate((e) => e.complete && e.naturalWidth > 0).catch(() => false));
  check('8. معاينة صورة الأشعة', img);
  await p.locator('.modal').last().getByRole('button', { name: 'إغلاق' }).last().click();
  await p.locator('.modal .pmf__tile:visible', { hasText: 'صورة دم كاملة' }).getByRole('button', { name: 'فتح' }).click();
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

  // 11-12. موعدين متابعة من تاب «موعد المتابعة» (رقم 8 من ١٠/١١)
  await p.locator('.modal .sh-tabs button', { hasText: 'موعد المتابعة' }).click();
  for (const [d, t, why] of [[cairoDate(7), '10:30', 'متابعة بعد الحقن'], [cairoDate(21), '', 'مراجعة التحاليل']]) {
    await p.getByRole('button', { name: 'إضافة موعد متابعة' }).click();
    const m = p.locator('.modal', { hasText: 'تحديد موعد متابعة' }).last();
    await m.getByLabel('يوم المتابعة').fill(d);
    if (t) await m.locator('input.fu-slots__time').fill(t);
    await m.locator('textarea').first().fill(why);
    await m.getByRole('button', { name: /^(إضافة للتشخيص|حفظ)$/ }).click();
    await m.waitFor({ state: 'detached', timeout: 15000 }).catch(() => {});
  }
  // مع ملف مريض: كل موعد بيتحفظ على طول، وبيترتبط بالتشخيص أول ما الكشف يتحفظ
  check('الموعدين ظاهرين في تاب «موعد المتابعة»', (await p.locator('.modal .fu-item').count()) === 2, String(await p.locator('.modal .fu-item').count()));
  await p.locator('.sh-next').getByRole('button', { name: 'حفظ الكشف' }).click();
  const cons = await waitFor(() => one(`select id, visit_reason from ortho_consultations where patient_id = '${made.patient}'`));
  // الموعدين موجودين من قبل حفظ الكشف — نستنى لحد ما الاتنين يترتبطوا بالتشخيص (مش أول ما يبقوا اتنين)
  const fus = await waitFor(async () => { const r = await sql(`select * from ortho_follow_ups where patient_id = '${made.patient}' order by date`); return r.length === 2 && r.every((f) => f.consultation_id) ? r : null; });
  check('4. الشكوى اتحفظت مع التشخيص', cons?.visit_reason === 'ألم في الركبة من أسبوعين، مع تورم.', JSON.stringify(cons));
  check('11-12. موعدين متابعة اتحفظوا مربوطين بالمريض والتشخيص والطبيب', !!fus && fus.every((f) => f.consultation_id === cons.id && f.doctor_id === made.therapist && f.status === 'scheduled') && String(fus[0].time).startsWith('10:30'), JSON.stringify(fus?.map((f) => [f.date, f.time, f.doctor_id, f.consultation_id])));

  // 7. تشخيص جديد تاني: الملفات لسه موجودة، والشكوى فاضية
  await p.waitForSelector('.modal', { state: 'detached', timeout: 15000 }).catch(() => {});
  check('التشخيص بيعرض المتابعات المربوطة بيه', await waitFor(() => p.locator('.fu-chips .fu-chip').count().then((n) => n === 2)));
  await p.getByRole('button', { name: 'تشخيص جديد' }).first().click();
  await p.waitForSelector('#cx-visit-reason', { timeout: 20000 });
  await p.locator('.modal .sh-tabs button', { hasText: 'الأشعة والتحاليل' }).click();
  check('7. تشخيص جديد لنفس المريض: الملفات لسه ظاهرة (من غير تكرار)', await waitFor(async () => (await p.locator('.modal .pmf__tile:visible').count()) === 2));
  check('شكوى التشخيص الجديد فاضية', (await p.inputValue('#cx-visit-reason')) === '');
  await p.locator('.modal').getByRole('button', { name: 'إلغاء' }).first().click();
  check('الطبيب: من غير أخطاء JavaScript', D.errors.length === 0, D.errors.join(' | '));
  if (D.errors.length) await shot(p, 'doc');

  // ================= التقويم =================
  // ٨/١١-٩/١١: الصفحة بقت عرض يومي بس (قايمة سطر لكل ساعة) — الشهري/الأسبوعي والبحث وفلاتر الحالة و«موعد متابعة جديد» اتشالوا
  section('متابعات المرضى: التقويم اليومي');
  const PNAME = 'مريض اختبار المتابعات';
  const openDay = async (days) => {
    await go(p, '/follow-ups');
    await p.waitForSelector('.fu-cal__nav', { timeout: 20000 });
    await p.locator('.fu-cal__move').getByRole('button', { name: 'النهارده' }).click();
    for (let i = 0; i < days; i++) await p.locator('.fu-cal__move').getByRole('button', { name: 'التالي' }).click();
  };
  const dayRow = (text) => p.locator('.dsch__row:not(.dsch__row--free)', { hasText: text });
  const openRow = async (text) => { await waitFor(async () => (await dayRow(text).count()) > 0, 15000); await dayRow(text).first().locator('.dsch__who').click(); return p.locator('.modal', { hasText: 'موعد متابعة' }).last(); };
  await openDay(7);
  await waitFor(async () => (await dayRow(PNAME).count()) > 0, 15000);
  const r1 = (await dayRow(PNAME).first().innerText().catch(() => '')).replace(/\s+/g, ' ');
  check('13. الموعد ظاهر في اليوم بتاعه باسم المريض والوقت', /10:30/.test(r1), r1);
  check('التنقل بين الأيام من غير أخطاء', D.errors.length === 0, D.errors.join(' | '));

  // 14. تعديل الوقت ← تمت، والتاني إلغاء
  let m = await openRow(PNAME);
  await m.locator('input.fu-slots__time').first().fill('11:15');
  await m.getByRole('button', { name: 'حفظ', exact: true }).click();
  const moved = await waitFor(async () => String((await one(`select time from ortho_follow_ups where id = '${fus[0].id}'`))?.time).startsWith('11:15'));
  check('14. تعديل وقت الموعد من اليوم', moved);
  await m.waitFor({ state: 'detached', timeout: 15000 }).catch(() => {});
  m = await openRow(PNAME);
  await m.getByRole('button', { name: 'تمت المتابعة' }).click();
  check('14. إتمام الموعد', await waitFor(async () => (await one(`select status from ortho_follow_ups where id = '${fus[0].id}'`))?.status === 'done'));
  await m.waitFor({ state: 'detached', timeout: 15000 }).catch(() => {});
  await openDay(21);
  m = await openRow('مراجعة التحاليل');
  await m.getByRole('button', { name: 'إلغاء الموعد' }).click();
  check('14. إلغاء الموعد', await waitFor(async () => (await one(`select status from ortho_follow_ups where id = '${fus[1].id}'`))?.status === 'cancelled'));
  await m.waitFor({ state: 'detached', timeout: 15000 }).catch(() => {});

  // تسجيل حضور: متابعة النهارده من غير حجز ← حجز بأقرب وقت فاضي مع نفس الطبيب ويتعلّم «حضر»، والمتابعة «تمت»
  const [todayFu] = await sql(`insert into ortho_follow_ups (patient_id, doctor_id, date, reason) values ('${made.patient}', '${made.therapist}', '${cairoDate(0)}', 'متابعة حضور اختبار') returning id`);
  // تسجيل الحضور بيعمل حجز ← صلاحية الحجز للاستقبال (الطبيب مالوش «حجز» من بعد فصل الصلاحيات ٩٢٢٤be0/963)
  const R2 = await open(STAFF.recep);
  const docPage = p; p = R2.page;
  await openDay(0);
  const cm = await openRow('متابعة حضور اختبار');
  await cm.getByRole('button', { name: 'تسجيل حضور المريض' }).click();
  await cm.getByRole('button', { name: 'تأكيد الحضور' }).click();
  const ci = await waitFor(async () => { const r = await one(`select f.status, a.status ast, a.therapist_id, a.date from ortho_follow_ups f left join appointments a on a.id = f.appointment_id where f.id = '${todayFu.id}'`); return r?.status === 'done' ? r : null; }, 30000);
  check('تسجيل حضور المريض: اتعمل حجز النهارده مع نفس الطبيب واتعلّم «حضر» والمتابعة «تمت»', ci?.ast === 'arrived' && ci?.therapist_id === made.therapist && ci?.date === cairoDate(0), JSON.stringify(ci) + ' ' + (await p.locator('.toast').allInnerTexts().catch(() => [])).join(' | ') + ' ' + (await cm.innerText().catch(() => '')).replace(/\s+/g, ' ').slice(0, 300));
  await cm.waitFor({ state: 'detached', timeout: 15000 }).catch(() => {});
  check('الاستقبال: تسجيل الحضور من غير أخطاء JavaScript', R2.errors.length === 0, R2.errors.join(' | '));
  await R2.ctx.close();
  p = docPage;
  await openDay(0);

  // 15. فتح ملف المريض من الموعد
  const pm = await openRow(PNAME);
  await pm.getByRole('link', { name: PNAME }).first().click();
  check('15. فتح ملف المريض من الموعد في اليوم', await waitFor(() => new URL(p.url()).pathname === `/patients/${made.patient}`));
  await p.getByRole('button', { name: 'مواعيد المتابعة' }).first().click();
  check('ملف المريض بيعرض كل مواعيد المتابعة (السابقة والقادمة)', await waitFor(async () => (await p.locator('.fu-item').count()) >= 2), String(await p.locator('.fu-item').count()));
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
  const lp = globalThis.__lastPage;
  if (lp) {
    console.log('  خطوة:', (e.message.match(/waiting for (.*)/) ?? [])[1] ?? '');
    console.log('  آخر شاشة:', ((await lp.locator('.modal').last().innerText().catch(() => '')) || (await lp.locator('body').innerText().catch(() => ''))).replace(/\s+/g, ' ').slice(0, 700));
    await lp.screenshot({ path: fileURLToPath(new URL('fu-crash.png', SHOTS)), fullPage: true }).catch(() => {});
  }
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
