// اختبار واجهة لهجرة 964 في Edge حقيقي على Supabase الحقيقي — من الشاشات نفسها:
// موعد المتابعة: درجة الألم اللي فاتت + الحالية + «تحسّن/ساء/ثابت» + روشتة الزيارة اللي فاتت بملاحظات الأدوية ← حفظ ← تحديث الصفحة ← خروج ودخول.
// شيت «متابعة المريض» جوّه التشخيص: المقارنة و«مقارنة بآخر زيارة» بتتعلّم لوحدها + روشتة جديدة بملاحظة دواء (القديمة بتفضل في السجل).
// أيقونة واتساب الحجز: التذكير (اسم المريض والدكتور والتاريخ والوقت على رقم المريض) + التمارين + الفاتورة + رسالة «مفيش رقم».
// المصروفات ← «مستلزمات طبية» ← المخزون (ضغطتين = مرة واحدة) + الصرف وتنبيه الحد الأدنى. كل البيانات بتتمسح في الآخر.
//   node scripts/e2e-ui-pain-rx.mjs
import { mkdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { createServer } from 'vite';
import { launchEdge } from './_edge.mjs';
import { allDayHours, api, cairoDate, cairoToday, deleteEmployee, env, loginAdmin, randomPassword, sql, suite, URL_ } from './_harness.mjs';
const PNG = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==', 'base64');

const { check, section, save } = suite();
const PORT = 4698, BASE = `http://127.0.0.1:${PORT}`;
const PW = randomPassword();
const TAG = 'واجهة964';
const STAFF = { phone: '01200000946', digits: '201200000946', name: `مدير ${TAG}` };
const PHONE = '+201200000947';
const SHOTS = new URL('../docs/ui-shots/', import.meta.url);
const made = { employees: [], therapist: null, patient: null, item: null };
const NOISE = /Notification|push|ServiceWorker|service worker|WebSocket|realtime|ERR_ABORTED|AbortError|Failed to load resource|Download the React DevTools|ERR_NAME_NOT_RESOLVED|wa\.me/i;
const one = async (q) => (await sql(q))[0];
const waitFor = async (f, ms = 15000) => { const end = Date.now() + ms; for (;;) { try { const v = await f(); if (v) return v; } catch { /* لسه */ } if (Date.now() > end) return null; await new Promise((r) => setTimeout(r, 300)); } };

let server, browser;
try {
  section('التجهيز');
  const admin = await loginAdmin();
  const th = await admin.rpc('save_therapist', { p: { name: `د. ${TAG}`, title: 'طبيب اختبار', phone: '', serviceIds: ['old_exam', 'old_consult'], workHours: allDayHours(), onLeave: [], active: true, defaultDurationMin: 30 } });
  made.therapist = th.data?.id ?? th.data;
  const r = await api(admin, 'POST', 'staff', { name: STAFF.name, phone: STAFF.phone, country: 'EG', password: PW, role: 'system_admin', workHours: allDayHours() });
  if (r.body?.id) made.employees.push(r.body.id);
  check('حساب مدير وطبيب للاختبار', r.status === 201 && !!made.therapist, JSON.stringify(r.body).slice(0, 120));
  const [p] = await sql(`insert into patients (full_name, first_name, father_name, family_name, phone, gender, nationality, referral_source, file_no, doctor_id)
    values ('مريض ${TAG}', 'مريض', 'اختبار', '${TAG}', '${PHONE}', 'male', 'non_saudi', 'friend', '', '${made.therapist}') returning id`);
  made.patient = p.id;
  const before = cairoDate(-6);
  await sql(`insert into ortho_consultations (patient_id, date, complaint, region, side, examination, diagnosis, plan, pain_score, medications, complete)
    values ('${made.patient}', '${before}', 'ألم الركبة', 'الركبة', 'right', '', 'خشونة الركبة', 'راحة نسبية', 7,
    '[{"name":"Brufen 600","dose":"قرص","frequency":"مرتين يوميًا","duration":"5 أيام","notes":"بعد الأكل"}]'::jsonb, true)`);
  // حجز متابعة النهارده مربوط بالمتابعة (ساعة برّه دوام المركز بتترفض لو اتحجزت من الشاشة — فالحجز جاهز من الأول)
  const [ap] = await sql(`insert into appointments (no, patient_id, type, service_id, therapist_id, date, time, duration_min, status) values ('T964-${Date.now() % 100000}', '${made.patient}', 'followup', 'old_consult', '${made.therapist}', '${cairoToday()}', '23:30', 30, 'confirmed') returning id`);
  const [fu] = await sql(`insert into ortho_follow_ups (patient_id, doctor_id, date, time, reason, status, appointment_id) values ('${made.patient}', '${made.therapist}', '${cairoToday()}', '23:30', 'متابعة ${TAG}', 'scheduled', '${ap.id}') returning id`);
  await sql(`delete from invoices where appointment_id = '${ap.id}'`);
  const [it] = await sql(`insert into inventory_items (sku, name, category, unit, quantity, min_quantity, cost_price, sale_price, supplier, active)
    values ('T964UI', 'جبس ${TAG}', 'مستلزمات', 'لفة', 6, 5, 10, 0, '', true) returning id`);
  made.item = it.id;
  // أشعة مرفوعة قبل كده في ملف المريض (بتاريخها) — لازم تظهر في موعد المتابعة وشيت المتابعة
  await sql(`insert into patient_files (patient_id, file_path, file_name, file_type, size_bytes, category, title, file_date, uploaded_by_name, note)
    values ('${made.patient}', '${made.patient}/e2e-964-knee.png', 'knee.png', 'image/png', 68, 'xray', 'أشعة الركبة ${TAG}', '${before}', 'اختبار', '')`);

  server = await createServer({ configFile: fileURLToPath(new URL('../vite.config.ts', import.meta.url)), root: fileURLToPath(new URL('..', import.meta.url)), logLevel: 'error', server: { port: PORT, strictPort: true, host: '127.0.0.1' } });
  await server.listen();
  browser = await launchEdge();
  mkdirSync(SHOTS, { recursive: true });
  const open = async () => {
    const ctx = await browser.newContext({ viewport: { width: 1366, height: 900 }, locale: 'ar-EG' });
    await ctx.addInitScript(() => { window.__opened = []; const o = window.open.bind(window); window.open = (u, ...a) => { window.__opened.push(String(u ?? '')); return o(u, ...a); }; });
    const page = await ctx.newPage();
    const errors = [];
    page.on('pageerror', (e) => errors.push(e.message));
    page.on('console', (m) => { if (m.type() === 'error' && !NOISE.test(m.text())) errors.push(m.text()); });
    page.on('dialog', (d) => void d.accept());
    await page.goto(BASE + '/login');
    await page.fill('#al-phone', STAFF.phone);
    await page.fill('#al-pass', PW);
    await page.click('button[type=submit]');
    await page.waitForURL((u) => u.pathname === '/', { timeout: 30000 });
    return { ctx, page, errors };
  };
  const go = (page, path) => page.evaluate((x) => { window.history.pushState({}, '', x); window.dispatchEvent(new PopStateEvent('popstate')); }, path);
  const shot = (page, name) => page.screenshot({ path: fileURLToPath(new URL(`964-${name}.png`, SHOTS)), fullPage: true }).catch(() => {});
  const toastHas = (page, text) => waitFor(async () => (await page.getByText(text).count()) > 0, 8000);

  let { ctx, page: pg, errors } = await open();
  const openFollowUp = async (page) => {
    await go(page, `/patients/${made.patient}`);
    await page.locator('.tabs').getByRole('button', { name: 'مواعيد المتابعة', exact: true }).click({ timeout: 20000 });
    await page.locator('.fu-item', { hasText: `متابعة ${TAG}` }).locator('.fu-item__main').click({ timeout: 20000 });
    return page.locator('.modal', { hasText: 'موعد متابعة' }).last();
  };

  section('1. موعد المتابعة: الألم والروشتة اللي فاتت');
  let m = await openFollowUp(pg);
  const prevTxt = await waitFor(async () => (await m.getByTestId('pain-prev').innerText()).trim());
  check('درجة الألم في الزيارة اللي فاتت ظاهرة (7/10)', prevTxt === '7/10', prevTxt);
  await m.getByTestId('pain-compare').getByRole('radio', { name: '3', exact: true }).click();
  check('المقارنة: «تحسّن» لما الألم قلّ من 7 لـ 3', /تحسّن/.test(await m.getByTestId('pain-trend').innerText()), await m.getByTestId('pain-trend').innerText().catch(() => ''));
  await m.getByTestId('pain-compare').getByRole('radio', { name: '9', exact: true }).click();
  check('المقارنة: «ساء» لما الألم زاد لـ 9', /ساء/.test(await m.getByTestId('pain-trend').innerText()));
  await m.getByTestId('pain-compare').getByRole('radio', { name: '7', exact: true }).click();
  check('المقارنة: «ثابت» لما الألم نفس الدرجة', /ثابت/.test(await m.getByTestId('pain-trend').innerText()));
  await m.getByTestId('pain-compare').getByRole('radio', { name: '3', exact: true }).click();
  const rxText = await m.getByTestId('prev-rx').innerText();
  check('روشتة الزيارة اللي فاتت ظاهرة بالدواء والجرعة وملاحظته', /Brufen 600/.test(rxText) && /مرتين يوميًا/.test(rxText) && /بعد الأكل/.test(rxText) && /راحة نسبية/.test(rxText), rxText.slice(0, 160));
  check('موعد المتابعة: الأشعة المرفوعة قبل كده ظاهرة باسمها وتاريخها', !!await waitFor(async () => { const t = await m.locator('.pmf').first().innerText(); return t.includes(`أشعة الركبة ${TAG}`) && /اترفع/.test(t); }), await m.locator('.pmf').first().innerText().catch(() => ''));
  check('موعد المتابعة: زرار رفع أشعة وزرار رفع تحاليل', (await m.getByRole('button', { name: /^رفع / }).count()) === 2);
  await shot(pg, 'followup-pain');
  await m.getByRole('button', { name: 'حفظ', exact: true }).click();
  const saveToast = await waitFor(async () => (await pg.locator('.toast').allInnerTexts()).join(' | '), 5000);
  const saved = await waitFor(async () => (await one(`select f.pain_score, s.score from ortho_follow_ups f left join ortho_pain_scores s on s.source_id = f.id where f.id = '${fu.id}'`))?.score === 3);
  check('الحفظ: درجة الألم في المتابعة وصف في سجل الألم بتاريخ الزيارة', !!saved, saveToast + ' ' + JSON.stringify(await one(`select pain_score, time, appointment_id from ortho_follow_ups where id = '${fu.id}'`)));
  await pg.reload();
  await pg.waitForLoadState('domcontentloaded');
  m = await openFollowUp(pg);
  check('بعد تحديث الصفحة: الدرجة المحفوظة (3) لسه متعلّمة', !!await waitFor(async () => (await m.getByTestId('pain-compare').getByRole('radio', { name: '3', exact: true }).getAttribute('aria-checked')) === 'true'));

  section('2. أيقونة واتساب الحجز');
  await m.locator('.bk-wa__btn').first().click();
  const items = await m.locator('.bk-wa__menu [role=menuitem]').allInnerTexts();
  check('القايمة فيها: تذكير بالموعد / إرسال التمارين / إرسال الفاتورة', ['تذكير بالموعد', 'إرسال التمارين', 'إرسال الفاتورة'].every((x) => items.some((y) => y.includes(x))), items.join(' | '));
  await m.locator('.bk-wa__menu').getByRole('menuitem', { name: /تذكير بالموعد/ }).click();
  const url = decodeURIComponent(await waitFor(() => pg.evaluate(() => window.__opened.find((u) => u.includes('wa.me')) ?? ''), 8000) ?? '');
  for (const x of ctx.pages()) if (x !== pg) await x.close().catch(() => {});
  check('التذكير بيفتح واتساب على رقم الموبايل المسجّل', url.includes('wa.me/201200000947'), url.slice(0, 120) + ' toasts: ' + (await pg.locator('.toast').allInnerTexts()).join(' | '));
  check('الرسالة فيها اسم المريض واسم الدكتور والتاريخ والوقت', url.includes(`مريض ${TAG}`) && url.includes(`د. ${TAG}`) && /الساعة/.test(url) && /\d{4}|نوفمبر|ديسمبر|يناير/.test(url), url.slice(0, 300));
  check('التذكير اتسجّل في سجل رسائل واتساب', !!await waitFor(async () => (await one(`select count(*)::int n from whatsapp_messages where patient_id = '${made.patient}' and message_type = 'reminder'`)).n === 1));
  await m.locator('.bk-wa__btn').first().click();
  await m.locator('.bk-wa__menu').getByRole('menuitem', { name: /إرسال الفاتورة/ }).click();
  check('إرسال الفاتورة من غير فاتورة ← رسالة واضحة', !!await toastHas(pg, 'مفيش فاتورة للحجز ده لسه.'));
  await m.locator('.bk-wa__btn').first().click();
  await m.locator('.bk-wa__menu').getByRole('menuitem', { name: /إرسال التمارين/ }).click();
  check('إرسال التمارين بيفتح نافذة التمرينات (نفس مسار ExerciseSend)', !!await waitFor(() => pg.locator('.modal', { hasText: 'إرسال التمرينات عبر واتساب' }).isVisible()));
  await pg.locator('.modal', { hasText: 'إرسال التمرينات عبر واتساب' }).getByRole('button', { name: 'إغلاق' }).last().click();
  // مريض من غير رقم
  await sql(`update patients set phone = '', whatsapp_mode = 'phone' where id = '${made.patient}'`);
  await pg.reload(); await pg.waitForLoadState('domcontentloaded');
  // الرقم اتمسح من الخادم مباشرة ← نستنى نسخة الجهاز تتحدّث من الخادم (الصفحة بتفتح الأول من النسخة المحفوظة)
  await waitFor(() => pg.evaluate(async (id) => { const { db } = await import('/src/data/db.ts'); await db.refresh('patients'); return db.patient(id)?.phone === ''; }, made.patient), 20000);
  m = await openFollowUp(pg);
  await m.locator('.bk-wa__btn').first().click();
  await m.locator('.bk-wa__menu').getByRole('menuitem', { name: /تذكير بالموعد/ }).click();
  check('من غير رقم موبايل ← رسالة واضحة ومفيش واتساب بيتفتح', !!await toastHas(pg, 'مفيش رقم موبايل مسجّل في ملف المريض'));
  await sql(`update patients set phone = '${PHONE}' where id = '${made.patient}'`);
  await m.getByRole('button', { name: 'إغلاق' }).last().click();

  section('3. شيت «متابعة المريض» جوّه التشخيص');
  await go(pg, '/diagnosis?tab=done');
  await pg.getByPlaceholder(/ابحث باسم المريض/).fill('01200000947');
  await pg.locator('.dx-pat', { hasText: `مريض ${TAG}` }).getByRole('button', { name: 'متابعة', exact: true }).click({ timeout: 20000 });
  const cm = pg.locator('.modal').last();
  const pc = cm.getByTestId('pain-compare');
  check('الشيت بيعرض آخر درجة ألم (3 من موعد المتابعة)', (await waitFor(async () => (await pc.getByTestId('pain-prev').innerText()).trim())) === '3/10');
  await pc.getByRole('radio', { name: '5', exact: true }).click();
  check('المقارنة «ساء» (3 ← 5)', /ساء/.test(await pc.getByTestId('pain-trend').innerText()));
  check('«الألم مقارنة بآخر زيارة» اتعلّمت «أكثر» لوحدها', (await cm.getByRole('radio', { name: 'أكثر', exact: true }).getAttribute('aria-checked')) === 'true');
  check('روشتة الزيارة اللي فاتت ظاهرة في الشيت', /بعد الأكل/.test(await cm.getByTestId('prev-rx').innerText()));
  const nf = cm.getByTestId('nu-files');
  check('شيت المتابعة: الأشعة والتحاليل المرفوعة قبل كده ظاهرة بتاريخها', !!await waitFor(async () => (await nf.innerText()).includes(`أشعة الركبة ${TAG}`)), await nf.innerText().catch(() => ''));
  // رفع تحليل جديد من شيت المتابعة ← بيتسجل في ملف المريض وبيظهر هنا على طول
  await nf.locator('input[type=file]').nth(1).setInputFiles({ name: 'cbc-964.png', mimeType: 'image/png', buffer: PNG });
  const up = await waitFor(async () => (await one(`select count(*)::int n from patient_files where patient_id = '${made.patient}' and category = 'lab'`)).n === 1);
  check('شيت المتابعة: رفع تحليل جديد اتسجل في ملف المريض بتصنيف «تحاليل»', !!up);
  check('التحليل الجديد ظاهر في الشيت', !!await waitFor(async () => (await nf.innerText()).includes('cbc-964')), await nf.innerText().catch(() => ''));
  await cm.getByTestId('prev-rx').getByRole('button', { name: 'نفس الأدوية في الروشتة الجديدة' }).click();
  const note = cm.getByLabel('ملاحظة الدواء 1');
  await note.fill('قبل النوم');
  await cm.locator('textarea.cx-rxnotes').fill('كمادات تلج');
  await shot(pg, 'nursing-pain-rx');
  await cm.locator('.nu-inline').getByRole('button', { name: 'حفظ', exact: true }).last().click();
  const nu = await waitFor(async () => one(`select id, sheet from ortho_nursing where patient_id = '${made.patient}'`));
  check('الشيت اتحفظ بدرجة الألم 5 و«أكثر»', nu?.sheet?.pain === 5 && nu?.sheet?.vsLast === 'أكثر', JSON.stringify(nu?.sheet ?? {}).slice(0, 160));
  const rxs = await waitFor(async () => { const r = await sql(`select r.source, i.notes from ortho_prescriptions r join ortho_prescription_items i on i.prescription_id = r.id where r.patient_id = '${made.patient}' order by r.rx_date`); return r.length === 2 ? r : null; });
  check('الروشتة الجديدة اتسجلت بملاحظة الدواء والقديمة لسه في السجل', rxs?.[0]?.notes === 'بعد الأكل' && rxs?.[1]?.notes === 'قبل النوم', JSON.stringify(rxs));

  section('4. المصروفات ← مستلزمات طبية ← المخزون');
  await go(pg, '/invoices');
  await pg.locator('.tabs').getByRole('button', { name: 'المصروفات', exact: true }).click({ timeout: 20000 });
  await pg.getByRole('button', { name: 'إضافة مصروف' }).click();
  const em = pg.locator('.modal', { hasText: 'إضافة مصروف' }).last();
  await em.locator('#exp-cat').selectOption('مستلزمات طبية');
  await em.locator('#exp-item').selectOption(made.item);
  await em.locator('#exp-qty').fill('4');
  await em.locator('#exp-unit-price').fill('12.5');
  check('الإجمالي بيتحسب لوحده (4 × 12.5 = 50)', /50/.test(await em.locator('#exp-total').inputValue()), await em.locator('#exp-total').inputValue());
  check('تاريخ الشراء والرصيد بعد الحفظ ظاهرين', (await em.locator('#exp-date').count()) === 1 && /10/.test(await em.getByTestId('exp-stock-after').innerText()));
  await em.getByRole('button', { name: 'حفظ', exact: true }).dblclick();
  const ex = await waitFor(async () => { const r = await sql(`select id, amount, quantity from expenses where inventory_item_id = '${made.item}'`); return r.length ? r : null; });
  await pg.waitForTimeout(1500);
  const exAll = await sql(`select id from expenses where inventory_item_id = '${made.item}'`);
  check('ضغطتين على «حفظ» = مصروف واحد بـ 50', exAll.length === 1 && Number(ex?.[0]?.amount) === 50, JSON.stringify(exAll));
  check('الكمية زادت في المخزون مرة واحدة (6 ← 10)', Number((await one(`select quantity from inventory_items where id = '${made.item}'`)).quantity) === 10);
  check('هجرة 969: سعر التكلفة بتاع الصنف بقى سعر الشراء (12.5)', Number((await one(`select cost_price from inventory_items where id = '${made.item}'`)).cost_price) === 12.5);
  check('المصروف ظاهر في الجدول مربوط بالمنتج', !!await waitFor(() => pg.getByTestId('exp-stock-link').first().isVisible()));
  // «+ صنف جديد» من المصروفات: الصنف بيتضاف للمخزون بالكمية — ضغطتين = صنف واحد ومصروف واحد
  await pg.getByRole('button', { name: 'إضافة مصروف' }).click();
  const en = pg.locator('.modal', { hasText: 'إضافة مصروف' }).last();
  await en.locator('#exp-cat').selectOption('مستلزمات طبية');
  await en.locator('#exp-item').selectOption('__new_item__');
  await en.locator('#exp-new-item').fill(`شاش جديد ${TAG}`);
  await en.locator('#exp-new-unit').fill('علبة');
  await en.locator('#exp-qty').fill('3');
  await en.locator('#exp-unit-price').fill('20');
  await en.getByRole('button', { name: 'حفظ', exact: true }).dblclick();
  const ni = await waitFor(async () => { const r = await sql(`select id, quantity, unit, category from inventory_items where name = 'شاش جديد ${TAG}'`); return r.length ? r : null; });
  await pg.waitForTimeout(1500);
  const niAll = await sql(`select i.id, i.quantity, i.unit, i.category, (select count(*) from expenses e where e.inventory_item_id = i.id)::int ex, (select max(amount) from expenses e where e.inventory_item_id = i.id) amt from inventory_items i where name = 'شاش جديد ${TAG}'`);
  made.newItem = niAll[0]?.id ?? ni?.[0]?.id;
  check('صنف جديد من المصروفات اتضاف للمخزون (صنف واحد، 3 علبة، فئة مستلزمات طبية)', niAll.length === 1 && Number(niAll[0].quantity) === 3 && niAll[0].unit === 'علبة' && niAll[0].category === 'مستلزمات طبية', JSON.stringify(niAll));
  check('الصنف الجديد: مصروف واحد بـ 60 مربوط بيه', niAll[0]?.ex === 1 && Number(niAll[0]?.amt) === 60, JSON.stringify(niAll));
  check('الصنف الجديد: سعر التكلفة 20 (سعر الشراء)', Number((await one(`select cost_price from inventory_items where id = '${made.newItem}'`)).cost_price) === 20);
  await go(pg, '/inventory');
  check('الصنف الجديد ظاهر في صفحة المخزون', !!await waitFor(() => pg.locator('tr', { hasText: `شاش جديد ${TAG}` }).first().isVisible()));

  section('5. المخزون: الصرف وتنبيه الحد الأدنى');
  await go(pg, '/inventory');
  const row = pg.locator('tr', { hasText: `جبس ${TAG}` });
  await row.getByRole('button', { name: 'صرف / استخدام' }).click({ timeout: 20000 });
  const mm = pg.locator('.modal', { hasText: 'حركة مخزون' }).last();
  await mm.locator('#mv-qty').fill('6');
  await mm.locator('#mv-ref').fill(`استخدام ${TAG}`);
  await mm.getByRole('button', { name: 'تسجيل' }).click();
  check('الصرف خصم من المخزون (10 ← 4)', !!await waitFor(async () => Number((await one(`select quantity from inventory_items where id = '${made.item}'`)).quantity) === 4));
  check('تنبيه الحد الأدنى ظهر للمستخدم', !!await toastHas(pg, 'وصل للحد الأدنى'));
  check('شريط الأصناف اللي عند الحد الأدنى فيه الصنف', !!await waitFor(async () => (await pg.getByTestId('inv-low').innerText()).includes(`جبس ${TAG}`)));
  await row.getByRole('button', { name: 'سجل الحركات' }).click();
  const hist = await pg.locator('.modal', { hasText: 'سجل حركات' }).last().innerText();
  check('سجل الحركات: التوريد «من مصروف» والصرف بسببه', /من مصروف/.test(hist) && hist.includes(`استخدام ${TAG}`), hist.slice(0, 200));
  await shot(pg, 'inventory');
  check('مفيش أخطاء JavaScript', errors.length === 0, errors.join(' | ').slice(0, 300));
  await ctx.close();

  section('6. خروج ودخول تاني');
  ({ ctx, page: pg, errors } = await open());
  m = await openFollowUp(pg);
  check('بعد الدخول تاني: درجة الألم 3 لسه محفوظة في موعد المتابعة', !!await waitFor(async () => (await m.getByTestId('pain-compare').getByRole('radio', { name: '3', exact: true }).getAttribute('aria-checked')) === 'true'));
  await m.getByTestId('prev-rx').getByRole('button', { name: /سجل الروشتات/ }).click();
  const log = await m.getByTestId('rx-log').innerText();
  check('سجل الروشتات فيه الروشتتين بملاحظاتهم', /بعد الأكل/.test(log) && /قبل النوم/.test(log), log.slice(0, 200));
  check('مفيش أخطاء JavaScript بعد الدخول تاني', errors.length === 0, errors.join(' | ').slice(0, 300));
  await ctx.close();
} catch (e) {
  console.log(e.message.split('\n').slice(0, 6).join('\n'));
  check('تنفيذ الاختبارات بدون أخطاء غير متوقعة', false, e.message.split('\n')[0]);
} finally {
  await browser?.close().catch(() => {});
  await server?.close().catch(() => {});
  section('تنظيف بيانات الاختبار');
  try {
    const emp = made.employees.map((x) => `'${x}'`).join(',') || 'null';
    const extra = await sql(`select id from inventory_items where name = 'شاش جديد ${TAG}'`);
    for (const { id } of extra) await sql(`delete from stock_movements where item_id = '${id}'; delete from expenses where inventory_item_id = '${id}'; delete from notifications where ref_id = '${id}'; delete from inventory_items where id = '${id}'`);
    if (made.item) await sql(`delete from stock_movements where item_id = '${made.item}'; delete from expenses where inventory_item_id = '${made.item}'; delete from notifications where ref_id = '${made.item}'; delete from inventory_items where id = '${made.item}'`);
    if (made.patient) {
      const fs = await sql(`select file_path from patient_files where patient_id = '${made.patient}'`);
      if (fs.length) await fetch(`${URL_}/storage/v1/object/patient-files`, { method: 'DELETE', headers: { apikey: env.SUPABASE_SERVICE_ROLE_KEY, Authorization: 'Bearer ' + env.SUPABASE_SERVICE_ROLE_KEY, 'Content-Type': 'application/json' }, body: JSON.stringify({ prefixes: fs.map((f) => f.file_path) }) });
      await sql(`delete from patient_files where patient_id = '${made.patient}'`);
    }
    if (made.patient) await sql(`delete from whatsapp_messages where patient_id = '${made.patient}'; delete from ortho_exercise_plans where patient_id = '${made.patient}'; delete from ortho_follow_ups where patient_id = '${made.patient}'; delete from ortho_nursing where patient_id = '${made.patient}'; delete from ortho_consultations where patient_id = '${made.patient}'; delete from notifications where patient_id = '${made.patient}'; delete from appointments where patient_id = '${made.patient}'; delete from patients where id = '${made.patient}'`);
    await sql(`delete from activity_log where employee_id in (${emp})`);
    for (const id of made.employees) { await sql(`delete from attendance where employee_id = '${id}';`); await deleteEmployee(id); }
    if (made.therapist) await sql(`delete from therapist_services where therapist_id = '${made.therapist}'; delete from therapists where id = '${made.therapist}';`);
    const [left] = await sql(`select (select count(*) from patients where full_name like '%${TAG}%')::int p, (select count(*) from employees where name like '%${TAG}%')::int e, (select count(*) from inventory_items where name like '%${TAG}%')::int i, (select count(*) from therapists where name like '%${TAG}%')::int t`);
    check('كل بيانات الاختبار اتمسحت', !left.p && !left.e && !left.i && !left.t, JSON.stringify(left));
  } catch (e) { check('التنظيف', false, e.message); }
  save('e2e-ui-pain-rx-results.json');
}
