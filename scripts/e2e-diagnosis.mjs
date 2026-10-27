// اختبار قسم «تشخيص المريض» على Supabase الحقيقي + متصفح حقيقي (Edge عن طريق playwright-core):
// الربط بالزيارة (هجرة 918)، قايمة «بانتظار التشخيص» من الحضور الفعلي، التشخيص الناقص واستكماله، البحث بالاسم وجزء منه والموبايل،
// ملف المريض بكل تشخيصاته (القديم بيفضل)، الصلاحيات، ومنع تشخيصين لنفس الزيارة — على الكمبيوتر والموبايل.
// بيعمل حسابات ومرضى ومواعيد مؤقتة ويمسحهم في الآخر. بيشغّل Vite بنفسه على بورت 4691 (مش بيلمس سيرفر التطوير).
//   node scripts/e2e-diagnosis.mjs
import { fileURLToPath } from 'node:url';
import { createServer } from 'vite';
import { chromium } from 'playwright-core';
import { allDayHours, api, cairoToday, deleteEmployee, login, loginAdmin, randomPassword, sql, suite } from './_harness.mjs';

const { check, section, save } = suite();
const PORT = 4691, BASE = `http://127.0.0.1:${PORT}`;
const PW = randomPassword();
const STAFF = {
  admin: { phone: '01200000981', digits: '201200000981', name: 'مدير تشخيص اختبار', role: 'system_admin' },
  doc: { phone: '01200000982', digits: '201200000982', name: 'طبيب تشخيص اختبار', role: 'therapist' },
  recep: { phone: '01200000983', digits: '201200000983', name: 'استقبال تشخيص اختبار', role: 'reception' },
};
// مريض «أ» عنده تشخيصين قدام + زيارة النهارده، مريض «ب» أول زيارة النهارده
const PA = { first: 'سامح', father: 'عادل', family: 'تشخيصاختبار', phone: '+201200000984', local: '01200000984' };
const PB = { first: 'منى', father: 'كمال', family: 'تشخيصاختبار', phone: '+201200000985', local: '01200000985' };
const made = { employees: [], therapist: null, patients: [], appts: [] };
const NOISE = /Notification|push|ServiceWorker|service worker|WebSocket|realtime|ERR_ABORTED|AbortError|Failed to load resource.*(favicon|manifest)|Download the React DevTools/i;
const today = cairoToday();
const q1 = (s) => sql(s).then((r) => r[0]);

let server, browser, lastPage;
try {
  section('التجهيز');
  const admin = await loginAdmin();
  const th = await admin.rpc('save_therapist', { p: { name: 'د. تشخيص اختبار', title: 'طبيب اختبار', phone: '', serviceIds: ['sv_exam', 'sv_followup'], workHours: allDayHours(), onLeave: [], active: true, defaultDurationMin: 30 } });
  made.therapist = th.data?.id ?? th.data;
  check('طبيب (معالج) للمواعيد', !!made.therapist, th.error?.message);
  for (const [k, s] of Object.entries(STAFF)) {
    const r = await api(admin, 'POST', 'staff', { name: s.name, phone: s.phone, country: 'EG', password: PW, role: s.role, therapistId: k === 'doc' ? made.therapist : undefined, workHours: allDayHours() });
    if (r.body?.id) made.employees.push(r.body.id);
    check(`حساب ${s.name}`, r.status === 201, JSON.stringify(r.body).slice(0, 120));
  }
  const [adminEmp, docEmp] = made.employees;
  for (const P of [PA, PB]) {
    const p = await q1(`insert into patients (full_name, first_name, father_name, family_name, phone, gender, nationality, referral_source, file_no)
      values ('${P.first} ${P.father} ${P.family}', '${P.first}', '${P.father}', '${P.family}', '${P.phone}', 'male', 'saudi', 'friend', '') returning id, file_no`);
    P.id = p.id; P.fileNo = p.file_no; made.patients.push(p.id);
  }
  check('مريضين للاختبار', PA.id && PB.id);
  // تشخيصين قدام لمريض «أ» (سجّلهم الطبيب)
  for (const [d, dx] of [['2026-09-01', 'خشونة ركبة يمين اختبار قديم 1'], ['2026-10-01', 'تمزق غضروف اختبار قديم 2']]) {
    await sql(`insert into ortho_consultations (patient_id, date, complaint, region, side, diagnosis, created_by, complete) values ('${PA.id}', '${d}', 'ألم ركبة', 'الركبة', 'right', '${dx}', '${docEmp}', true)`);
  }
  check('تشخيصين قدام لمريض «أ»', (await q1(`select count(*)::int n from ortho_consultations where patient_id = '${PA.id}'`)).n === 2);
  // مواعيد النهارده + تسجيل حضور (حالة «حضر» — نفس دالة الاستقبال)
  // أول ميعاد فاضي النهارده جوّه ساعات عمل المركز (الحجز بيرفض الوقت اللي فات أو برّه المواعيد)
  const SLOTS = ['20:00', '20:30', '21:00', '21:30', '19:00', '19:30', '18:00', '18:30', '17:00', '17:30', '16:00', '16:30'];
  for (const P of [PA, PB]) {
    let id, err;
    for (const time of SLOTS) {
      const bk = await admin.rpc('book_appointment', { p: { patientId: P.id, type: 'initial', serviceId: 'sv_exam', therapistId: made.therapist, date: today, time, location: 'center' } });
      id = bk.data?.id ?? bk.data; err = bk.error?.message;
      if (!bk.error && id) break;
    }
    if (id) made.appts.push(id);
    P.appt = id;
    check(`حجز موعد النهارده لـ ${P.first}`, !!id, err);
  }
  // قبل الحضور: الحجز لوحده مايظهرش في قايمة الانتظار (بيتأكد في الواجهة تحت)
  const recepC = await login(STAFF.recep.digits, PW);

  section('قاعدة البيانات: الربط بالزيارة والصلاحيات');
  const docC = await login(STAFF.doc.digits, PW);
  const tmp = await docC.from('ortho_consultations').insert({ patient_id: PB.id, appointment_id: PB.appt, complaint: '', diagnosis: '', complete: false }).select().single();
  check('تشخيص ناقص (شكوى وتشخيص فاضيين) بيتحفظ «يحتاج استكمال»', !tmp.error && tmp.data?.complete === false, tmp.error?.message);
  const dup = await docC.from('ortho_consultations').insert({ patient_id: PB.id, appointment_id: PB.appt, complaint: 'x', diagnosis: 'x' }).select();
  check('تشخيص تاني لنفس الزيارة مرفوض (فهرس فريد)', !!dup.error && /ortho_consultations_appointment_uq|duplicate/i.test(dup.error.message), dup.error?.message ?? 'accepted!');
  const recepIns = await recepC.from('ortho_consultations').insert({ patient_id: PB.id, complaint: 'x', diagnosis: 'x' }).select();
  check('الاستقبال ما يقدرش يسجّل تشخيص', !!recepIns.error || (recepIns.data ?? []).length === 0, 'inserted!');
  await sql(`delete from ortho_consultations where patient_id = '${PB.id}'`); // الواجهة هتعمل تشخيص «ب» من الأول
  for (const P of [PA, PB]) {
    const st = await recepC.rpc('set_appointment_status', { p_id: P.appt, p_status: 'arrived', p_reason: null, p_therapist: null });
    check(`تسجيل حضور ${P.first} (من الاستقبال)`, !st.error, st.error?.message);
  }

  server = await createServer({ configFile: fileURLToPath(new URL('../vite.config.ts', import.meta.url)), root: fileURLToPath(new URL('..', import.meta.url)), logLevel: 'error', server: { port: PORT, strictPort: true, host: '127.0.0.1' } });
  await server.listen();
  browser = await chromium.launch({ channel: 'msedge', headless: true });

  const open = async (who, viewport = { width: 1366, height: 860 }) => {
    const ctx = await browser.newContext({ viewport, locale: 'ar-EG' });
    const page = await ctx.newPage();
    const errors = [];
    page.on('pageerror', (e) => errors.push('pageerror: ' + e.message));
    page.on('console', (m) => { if (m.type() === 'error' && !NOISE.test(m.text()) && !/Failed to load resource/.test(m.text())) errors.push('console: ' + m.text()); });
    // الطلب اللي فشل نفسه (أوضح من رسالة «Failed to load resource»)
    page.on('response', async (r) => { if (r.status() >= 400 && !NOISE.test(r.url())) errors.push(`HTTP ${r.status()} ${r.request().method()} ${r.url().replace(/^https?:\/\/[^/]+/, '').slice(0, 160)} ${(await r.text().catch(() => '')).slice(0, 160)}`); });
    page.on('dialog', (d) => d.accept());
    lastPage = page;
    await page.goto(BASE + '/login');
    await page.fill('#al-phone', who.phone);
    await page.fill('#al-pass', PW);
    await page.click('button[type=submit]');
    const ok = await page.waitForURL((u) => u.pathname === '/', { timeout: 30000 }).then(() => true).catch(() => false);
    check(`${who.name}: الدخول`, ok, page.url());
    // الدخول بيجرّب كذا صيغة للرقم (auth.tsx) فأول محاولة بترجع 400 عادي — الأخطاء اللي بتتحسب من صفحة التشخيص بس
    errors.length = 0;
    return { ctx, page, errors };
  };
  const goto = async (page, path) => {
    await page.evaluate((p) => { window.history.pushState({}, '', p); window.dispatchEvent(new PopStateEvent('popstate')); }, path);
    await page.waitForSelector('.page h1', { timeout: 20000 });
    await page.waitForFunction(() => !document.querySelector('.page .skel'), null, { timeout: 20000 }).catch(() => {});
    await page.waitForTimeout(700);
  };
  const queueRow = (page, P) => page.locator('.dx-queue__row', { hasText: `${P.first} ${P.father}` });
  const dbConsults = (P) => sql(`select id, appointment_id, complete, diagnosis, complaint, created_by from ortho_consultations where patient_id = '${P.id}' order by date, created_at`);
  // تحديد خانة في الشيت (نفس اللي الطبيب بيعمله) + حفظ
  // تبويب الطبيب: لو مفيش مكان ألم متحدد بيطلب اختيار المنطقة (شيت المنطقة بيتحدد من مكان الألم)
  const openDoctor = async (page, region) => {
    await page.locator('.sh-tabs button', { hasText: 'كشف الطبيب' }).click();
    if (await page.locator('.sh-choose').count()) await page.locator('.sh-choose button', { hasText: region }).click();
    else if (!(await page.locator('.sh-regions button[aria-selected=true]', { hasText: region }).count())) await page.locator('.sh-regions select').selectOption({ label: region });
  };
  const tick = (page, text) => page.locator('.sh-ck', { hasText: text }).first().locator('input').check();
  const saveAnswer = async (page, answer) => {
    await page.locator('.modal__foot button', { hasText: 'حفظ الكشف' }).click();
    if (answer) await page.locator('.modal__foot button', { hasText: answer }).click();
    await page.waitForFunction(() => !document.querySelector('.modal'), null, { timeout: 20000 });
    await page.waitForTimeout(1200);
  };

  section('الواجهة — بانتظار التشخيص (الكمبيوتر)');
  const A = await open(STAFF.admin);
  await goto(A.page, '/diagnosis');
  const rowA = queueRow(A.page, PA), rowB = queueRow(A.page, PB);
  check('مريض «أ» اللي اتعمله حضور ظاهر في «بانتظار التشخيص»', await rowA.count() === 1);
  check('مريض «ب» اللي اتعمله حضور ظاهر في «بانتظار التشخيص»', await rowB.count() === 1);
  const apA = await q1(`select no from appointments where id = '${PA.appt}'`);
  const rowText = (await rowA.textContent()) ?? '';
  check('الصف فيه الموبايل ورقم الملف ورقم الزيارة والطبيب', rowText.includes('1200000984') && rowText.includes(PA.fileNo.replace(/\D/g, '')) && rowText.includes(apA.no) && rowText.includes('د. تشخيص اختبار'), rowText.slice(0, 200));

  // تشخيص مريض «أ» كامل ← يتربط بزيارته، ويختفي من الانتظار، والقديم يفضل
  await rowA.locator('button', { hasText: 'تشخيص' }).click();
  await A.page.waitForSelector('.modal .sh-visitlink');
  check('نافذة التشخيص مربوطة بزيارة «أ»', ((await A.page.locator('.sh-visitlink').textContent()) ?? '').includes(apA.no));
  await openDoctor(A.page, 'الورك والركبة');
  await tick(A.page, 'Knee pain');
  await tick(A.page, 'Meniscal tear');
  await saveAnswer(A.page, 'التشخيص اكتمل');
  const ca = await dbConsults(PA);
  const newA = ca.find((c) => c.appointment_id === PA.appt);
  check('التشخيص الجديد اتحفظ مربوط بزيارة «أ» ومكتمل', newA && newA.complete === true && /Meniscal tear/.test(newA.diagnosis), JSON.stringify(newA));
  check('التشخيصات القديمة لمريض «أ» لسه موجودة (3 تشخيصات)', ca.length === 3 && ca.filter((c) => /قديم/.test(c.diagnosis)).length === 2, ca.length);
  check('الطبيب اللي سجّل التشخيص اتسجّل (created_by)', newA?.created_by === adminEmp, newA?.created_by);
  await A.page.waitForSelector('.dx-views', { timeout: 10000 });
  check('بعد الحفظ رجع لقايمة «بانتظار التشخيص» و«ب» لسه فيها', await queueRow(A.page, PB).count() === 1);
  check('مريض «أ» اختفى من «بانتظار التشخيص» بعد الاكتمال', await queueRow(A.page, PA).count() === 0);

  // مريض «ب»: حفظ ناقص ← يفضل «يحتاج استكمال» ← استكمال نفس السجل
  await queueRow(A.page, PB).locator('button', { hasText: 'تشخيص' }).click();
  await A.page.waitForSelector('.modal .sh-visitlink');
  await saveAnswer(A.page, 'حفظ — استكمال بعدين');
  let cb = await dbConsults(PB);
  check('التشخيص الناقص اتحفظ «يحتاج استكمال» ومربوط بزيارة «ب»', cb.length === 1 && cb[0].complete === false && cb[0].appointment_id === PB.appt, JSON.stringify(cb));
  const rowB2 = queueRow(A.page, PB);
  check('مريض «ب» فاضل في الانتظار بعلامة «يحتاج استكمال» وزرار «استكمال»', await rowB2.locator('text=يحتاج استكمال').count() === 1 && await rowB2.locator('button', { hasText: 'استكمال' }).count() === 1);
  await rowB2.locator('button', { hasText: 'استكمال' }).click();
  await A.page.waitForSelector('.modal');
  // «ب» بيشتكي من الكاحل ← شيت «الكاحل والقدم»
  await openDoctor(A.page, 'الكاحل والقدم');
  check('شيت الكاحل والقدم بيفتح لما المنطقة كاحل', await A.page.locator('.modal .sh-box__h', { hasText: 'Special Tests' }).count() === 1 && await A.page.locator('.modal .sh-ck', { hasText: 'Thompson test' }).count() === 1);
  await tick(A.page, 'Ankle pain');
  await tick(A.page, 'Lateral ankle sprain');
  await saveAnswer(A.page, 'التشخيص اكتمل');
  cb = await dbConsults(PB);
  check('الاستكمال عدّل نفس السجل (مفيش تشخيص مكرر) وبقى مكتمل بتشخيص الكاحل', cb.length === 1 && cb[0].complete === true && /Lateral ankle sprain/.test(cb[0].diagnosis), JSON.stringify(cb));
  await A.page.waitForSelector('.dx-views', { timeout: 10000 });
  check('مريض «ب» اختفى من الانتظار بعد الاستكمال', await queueRow(A.page, PB).count() === 0);
  check('«اتشخص النهارده» بيعد المريضين', /اتشخص النهارده\s*[2-9]/.test((await A.page.locator('.card__head', { hasText: 'مرضى بانتظار التشخيص' }).textContent()) ?? ''));

  section('الواجهة — المرضى اللي اتشخصوا (بحث)');
  await A.page.locator('.dx-views button', { hasText: 'المرضى اللي اتشخصوا' }).click();
  await A.page.waitForTimeout(500);
  const search = A.page.locator('.filter-bar input');
  const results = () => A.page.locator('.dx-pat');
  await search.fill(`${PA.first} ${PA.father}`);
  await A.page.waitForTimeout(400);
  check('بحث بالاسم الكامل/الجزء الأول يلاقي مريض «أ» بس', await results().count() === 1 && ((await results().first().textContent()) ?? '').includes(PA.first));
  await search.fill(PA.family.slice(0, 6));
  await A.page.waitForTimeout(400);
  const both = await results().count();
  check('بحث بجزء من الاسم (العائلة) يلاقي المريضين', both >= 2, both);
  await search.fill(PB.local);
  await A.page.waitForTimeout(400);
  check('بحث برقم الموبايل يلاقي مريض «ب»', await results().count() === 1 && ((await results().first().textContent()) ?? '').includes(PB.first));
  await search.fill('مريض مش موجود خالص 123');
  await A.page.waitForTimeout(400);
  check('بحث من غير نتايج بيعرض رسالة واضحة', await A.page.locator('text=مفيش مريض متشخّص بالاسم أو الرقم ده').count() === 1);
  await search.fill(PA.phone.slice(-9));
  await A.page.waitForTimeout(400);
  await results().first().click();
  await A.page.waitForSelector('text=ملف تشخيصات المريض');
  await A.page.waitForTimeout(1500);
  const cards = A.page.locator('.dxh');
  check('ملف مريض «أ» فيه التشخيصات التلاتة', await cards.count() === 3, await cards.count());
  const fileText = (await A.page.locator('.page').textContent()) ?? '';
  check('التشخيصات القديمة ظاهرة بالتشخيص والطبيب اللي سجّلها', fileText.includes('قديم 1') && fileText.includes('قديم 2') && fileText.includes(STAFF.doc.name), '');
  check('التشخيص الجديد ظاهر برقم الزيارة واسم اللي سجّله', fileText.includes(apA.no) && fileText.includes(STAFF.admin.name));
  check('الشيت مفتوح بالتفصيل لكل التشخيصات', await A.page.locator('.dxh-sheet iframe').count() === 3);
  // تشخيص جديد من الملف نفسه (من غير زيارة مفتوحة) ← سجل رابع والقديم يفضل
  await A.page.getByRole('button', { name: 'تشخيص', exact: true }).first().click();
  await A.page.waitForSelector('.modal');
  await openDoctor(A.page, 'الورك والركبة');
  await tick(A.page, 'Stiffness');
  await tick(A.page, 'Bursitis');
  await saveAnswer(A.page, 'التشخيص اكتمل');
  const ca2 = await dbConsults(PA);
  check('تشخيص جديد من ملف المريض اتضاف كسجل مستقل (4) والقديم زي ما هو', ca2.length === 4 && ca.every((o) => ca2.some((n) => n.id === o.id && n.diagnosis === o.diagnosis)), ca2.length);
  check('صفحة التشخيص بدون أخطاء JavaScript (الكمبيوتر)', A.errors.length === 0, A.errors.join(' | ').slice(0, 300));
  await A.ctx.close();

  section('الواجهة — الموبايل');
  const M = await open(STAFF.admin, { width: 390, height: 844 });
  await goto(M.page, '/diagnosis');
  const overW = await M.page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
  check('«بانتظار التشخيص» على الموبايل من غير سكرول عرضي', overW <= 1, `${overW}px`);
  await M.page.locator('.dx-views button', { hasText: 'المرضى اللي اتشخصوا' }).click();
  await M.page.locator('.filter-bar input').fill(PB.local);
  await M.page.waitForTimeout(500);
  check('البحث بالموبايل شغال على الموبايل', await M.page.locator('.dx-pat').count() === 1);
  await M.page.locator('.dx-pat').first().click();
  await M.page.waitForSelector('text=ملف تشخيصات المريض');
  await M.page.waitForTimeout(1200);
  const overF = await M.page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
  check('ملف تشخيصات المريض على الموبايل من غير سكرول عرضي', overF <= 1, `${overF}px`);
  check('صفحة التشخيص بدون أخطاء JavaScript (الموبايل)', M.errors.length === 0, M.errors.join(' | ').slice(0, 300));
  await M.ctx.close();

  section('الواجهة — صلاحيات الاستقبال');
  const R = await open(STAFF.recep);
  await goto(R.page, '/diagnosis');
  const denied = await R.page.locator('text=ما فيه صلاحية').count();
  const btns = await R.page.locator('.dx-queue__act button').count();
  check('الاستقبال: مفيش زرار تشخيص/استكمال لو مالوش صلاحية تسجيل', denied > 0 || btns === 0, `buttons ${btns}`);
  await R.ctx.close();
} catch (e) {
  check('تنفيذ الاختبارات بدون أخطاء غير متوقعة', false, e.message);
  if (lastPage) {
    await lastPage.screenshot({ path: fileURLToPath(new URL('../docs/ui-failures/diagnosis-failure.png', import.meta.url)), fullPage: true }).catch(() => {});
    console.log('  آخر شاشة:', ((await lastPage.locator('.page').textContent().catch(() => '')) ?? '').replace(/\s+/g, ' ').slice(0, 900));
  }
} finally {
  await browser?.close().catch(() => {});
  await server?.close().catch(() => {});
  section('تنظيف بيانات الاختبار');
  try {
    if (made.patients.length) {
      const ids = made.patients.map((x) => `'${x}'`).join(',');
      // المواعيد والفواتير بتتمسح مع المريض (cascade) — زي e2e-ui
      await sql(`delete from ortho_consultations where patient_id in (${ids}); delete from ortho_imaging where patient_id in (${ids}); delete from patients where id in (${ids});`);
    }
    for (const id of made.employees) { await sql(`delete from attendance where employee_id = '${id}';`); await deleteEmployee(id); }
    if (made.therapist) await sql(`delete from therapist_services where therapist_id = '${made.therapist}'; delete from therapists where id = '${made.therapist}';`);
    await sql(`delete from notifications where body like '%تشخيصاختبار%' or title like '%تشخيصاختبار%';`);
    const left = await q1(`select (select count(*) from patients where family_name = 'تشخيصاختبار')::int p, (select count(*) from employees where name like '%تشخيص اختبار%')::int e`);
    console.log('  متبقي من بيانات الاختبار:', JSON.stringify(left));
  } catch (e) { console.log('  تنظيف ناقص:', e.message); }
  save('e2e-diagnosis-results.json');
}
