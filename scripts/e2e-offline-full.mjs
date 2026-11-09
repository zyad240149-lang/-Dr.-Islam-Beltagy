// اختبار Offline-First شامل على جهازين حقيقيين (استقبال + دكتور، كل واحد سياق متصفح منفصل = IndexedDB منفصل) وقاعدة Supabase الحقيقية.
// السيناريو (كل ده من غير إنترنت على الجهازين في نفس الوقت):
//  - الاستقبال: ملف مريض جديد (من الشاشة) + حجز له + تعديل ميعاده، تعديل/تأكيد/إلغاء حجوزات مرضى موجودين، دفعة على فاتورة، بحث في كل المرضى.
//  - الدكتور: نفس المريض الجديد (نفس الاسم والرقم) على جهازه + تشخيص عليه، تشخيص مؤقت بالاسم الثلاثي، تشخيص + أشعة + تحليل لمريض موجود.
//  - فتح كل الصفحات من غير نت (مفيش أخطاء JavaScript)، إعادة تحميل التطبيق وفيه عمليات معلّقة، نت متقطع (503 + رد ضايع + فصل/رجوع ٣ مرات).
//  - بعد الرجوع: مفيش ملف مريض مكرر (الدمج تلقائي)، التشخيصات اترَبطت بالملف الحقيقي من غير أي سؤال، مفيش حجز/تشخيص/دفعة مكررة.
// كل بيانات الاختبار بتتمسح في الآخر.   node scripts/e2e-offline-full.mjs
import { fileURLToPath } from 'node:url';
import { createServer } from 'vite';
import { launchEdge } from './_edge.mjs';
import { allDayHours, api, cairoDate, deleteEmployee, loginAdmin, randomPassword, sql, suite } from './_harness.mjs';

const { check, section, save } = suite();
const PORT = 4694, BASE = `http://127.0.0.1:${PORT}`;
const PW = randomPassword();
const STARTED = new Date().toISOString();
const TAG = 'شاملاختبار'; // اسم العيلة لكل مرضى الاختبار (للتنظيف)
const STAFF = {
  recep: { phone: '01200000961', digits: '201200000961', name: 'استقبال شامل اختبار', role: 'reception' },
  doc: { phone: '01200000962', digits: '201200000962', name: 'دكتور شامل اختبار', role: 'system_admin' },
};
const NEWP = { name: `هاني فؤاد ${TAG}`, phone: '01200000969' };          // اتسجّل من غير نت على الجهازين
const TEMP = { name: `مؤقت كريم ${TAG}`, phone: '01200000967' };          // تشخيص مؤقت بالاسم — الاستقبال بيسجّله بعدين
const made = { employees: [], therapist: null };
const DAY = cairoDate(4);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const until = async (f, ms = 60000, every = 800) => { const t = Date.now(); for (;;) { const v = await f().catch(() => null); if (v) return v; if (Date.now() - t > ms) return null; await sleep(every); } };
const q1 = (s) => sql(s).then((r) => r[0]);
const NO_LINK_MSG = /محتاج(ة)? ربط|يحتاج مراجعة وربط|اختار المريض|اختر المريض|غير مرتبط|بانتظار ملف المريض/;
const IGNORE_CONSOLE = /Failed to load resource|ERR_INTERNET_DISCONNECTED|ERR_CONNECTION|net::ERR|WebSocket|realtime|Failed to fetch|NetworkError|AuthRetryableFetchError|status of 503|\[vite\]|Download the React DevTools/i;

const testPatients = `select id from patients where family_name = '${TAG}' or full_name like '%${TAG}%'`;
const cleanup = async () => {
  await sql(`
    delete from ortho_imaging where patient_id in (${testPatients});
    delete from ortho_follow_ups where patient_id in (${testPatients});
    delete from ortho_consultations where pending_patient->>'name' like '%${TAG}%' or patient_id in (${testPatients});
    delete from payments where patient_id in (${testPatients});
    delete from invoice_items where invoice_id in (select id from invoices where patient_id in (${testPatients}));
    delete from invoices where patient_id in (${testPatients});
    delete from treatment_sessions where patient_id in (${testPatients});
    delete from appointments where patient_id in (${testPatients});
    delete from activity_log where patient_id in (${testPatients});
    delete from patients where id in (${testPatients});`).catch((e) => console.log('  cleanup:', e.message.slice(0, 200)));
};

const idbOps = (page) => page.evaluate(() => new Promise((resolve) => {
  const r = indexedDB.open('ortho-offline');
  r.onerror = () => resolve([]);
  r.onsuccess = () => {
    const d = r.result;
    if (!d.objectStoreNames.contains('ops')) { resolve([]); return; }
    const g = d.transaction('ops', 'readonly').objectStore('ops').getAll();
    g.onsuccess = () => resolve((g.result ?? []).map((o) => ({ id: o.id, kind: o.kind, status: o.status, entityId: o.entityId, lastError: o.lastError, sealed: !!o.sealed })));
    g.onerror = () => resolve([]);
  };
}));
const snapReady = (page) => page.evaluate(() => new Promise((resolve) => {
  const r = indexedDB.open('ortho-offline');
  r.onerror = () => resolve(false);
  r.onsuccess = () => {
    const d = r.result;
    if (!d.objectStoreNames.contains('kv')) { resolve(false); return; }
    const g = d.transaction('kv', 'readonly').objectStore('kv').get('snap:meta');
    g.onsuccess = () => resolve(!!(g.result?.sync?.patients?.complete && g.result?.sync?.appointments && (g.result.tables ?? []).includes('ortho')));
    g.onerror = () => resolve(false);
  };
}));
// طبقة البيانات نفسها اللي الشاشات بتستخدمها (نفس نسخة الموديول في سيرفر التطوير) — للعمليات اللي الشاشة بتاعتها طويلة (حجز بخطوات)
const app = (page, fn, arg) => page.evaluate(async ([src, a]) => {
  const { db } = await import('/src/data/db.ts');
  const { ortho } = await import('/src/ortho/data.ts');
  const { offline } = await import('/src/offline/index.ts');
  const f = new Function('db', 'ortho', 'offline', 'a', `return (async () => { ${src} })()`);
  return f(db, ortho, offline, a);
}, [fn, arg]);

let server, browser, lastPage;
try {
  section('التجهيز');
  await cleanup();
  for (const s of Object.values(STAFF)) for (const { id } of await sql(`select id from employees where username = '${s.digits}'`)) { await sql(`delete from attendance where employee_id = '${id}';`); await deleteEmployee(id); }
  await sql(`delete from therapist_services where therapist_id in (select id from therapists where name = 'د. شامل اختبار'); delete from therapists where name = 'د. شامل اختبار';`);
  const admin = await loginAdmin();
  const th = await admin.rpc('save_therapist', { p: { name: 'د. شامل اختبار', title: 'طبيب اختبار', phone: '+' + STAFF.doc.digits, serviceIds: ['old_exam'], workHours: allDayHours(), onLeave: [], active: true, defaultDurationMin: 30 } });
  made.therapist = th.data?.id ?? th.data;
  check('ملف طبيب الاختبار', !th.error && !!made.therapist, th.error?.message);
  for (const [k, s] of Object.entries(STAFF)) {
    const r = await api(admin, 'POST', 'staff', { name: s.name, phone: s.phone, country: 'EG', password: PW, role: s.role, therapistId: k === 'doc' ? made.therapist : undefined, workHours: allDayHours() });
    if (r.body?.id) made.employees.push(r.body.id);
    check(`حساب ${s.name}`, r.status === 201, JSON.stringify(r.body).slice(0, 120));
  }
  // مريض موجود على الخادم + ٣ حجوزات (تعديل/تأكيد/إلغاء من غير نت) + فاتورة عليها متبقي
  const P1 = (await sql(`insert into patients (full_name, first_name, father_name, family_name, phone, gender, nationality, referral_source, file_no)
    values ('سعيد ماهر ${TAG}', 'سعيد', 'ماهر', '${TAG}', '+201200000966', 'male', 'saudi', 'friend', '') returning id, file_no`))[0];
  // مريض قديم ماحدش فتح ملفه على الجهاز ده — للبحث المحلي برقم الملف/الموبايل
  const P2 = (await sql(`insert into patients (full_name, first_name, father_name, family_name, phone, gender, nationality, referral_source, file_no)
    values ('نادر سليم ${TAG}', 'نادر', 'سليم', '${TAG}', '+201200000965', 'male', 'saudi', 'friend', '') returning id, file_no`))[0];
  const book = async (time) => { const r = await admin.rpc('book_appointment', { p: { patientId: P1.id, type: 'initial', serviceId: 'old_exam', therapistId: made.therapist, date: DAY, time, location: 'center' } }); if (r.error) throw new Error('book ' + r.error.message); return r.data?.id ?? r.data; };
  const A2 = await book('10:00'), A3 = await book('12:00'), A4 = await book('13:00');
  const inv = await admin.rpc('create_invoice', { p: { patientId: P1.id, items: [{ description: 'كشف اختبار شامل', qty: 1, unitPrice: 300 }] } });
  const INV = inv.data?.id;
  const invRow = INV ? await q1(`select status, remaining from invoices where id = '${INV}'`) : null;
  check('بيانات الخادم: مريضين + ٣ حجوزات + فاتورة بمتبقي', !!A2 && !!A3 && !!A4 && !!INV && Number(invRow?.remaining) > 0, JSON.stringify({ inv: inv.error?.message, invRow }));
  const migrated = !!(await q1(`select count(*)::int n from pg_proc where proname = 'offline_exec'`)).n;

  server = await createServer({ configFile: fileURLToPath(new URL('../vite.config.ts', import.meta.url)), root: fileURLToPath(new URL('..', import.meta.url)), logLevel: 'error', server: { port: PORT, strictPort: true, host: '127.0.0.1', hmr: false } });
  await server.listen();
  browser = await launchEdge();
  const device = async (who) => {
    const ctx = await browser.newContext({ viewport: { width: 1366, height: 860 }, locale: 'ar-EG' });
    const page = await ctx.newPage();
    const errors = [], consoleErr = [];
    page.on('pageerror', (e) => errors.push('pageerror: ' + e.message));
    page.on('console', (m) => { if (m.type() === 'error' && !IGNORE_CONSOLE.test(m.text())) consoleErr.push(m.text().slice(0, 200)); });
    page.on('dialog', (d) => d.accept());
    lastPage = page;
    await page.goto(BASE + '/login');
    await page.fill('#al-phone', who.phone); await page.fill('#al-pass', PW); await page.click('button[type=submit]');
    check(`${who.name}: الدخول بإنترنت`, await page.waitForURL((u) => u.pathname === '/', { timeout: 60000 }).then(() => true).catch(() => false), page.url());
    return { ctx, page, errors, consoleErr };
  };
  const nav = async (page, path) => {
    await page.evaluate((p) => { window.history.pushState({}, '', p); window.dispatchEvent(new PopStateEvent('popstate')); }, path);
    await page.waitForSelector('.page h1, .page-head h1', { timeout: 20000 });
    await page.waitForTimeout(500);
  };
  const R = await device(STAFF.recep);
  const D = await device(STAFF.doc);
  // كل الصفحات مرة بإنترنت (في سيرفر التطوير ملفاتها بتتحمّل أول مرة بس — في الإنتاج الـ Service Worker بيخزّنها مسبقًا)
  const PAGES = ['/', '/patients', '/appointments', '/booking', '/diagnosis', '/consultations', '/imaging', '/medications', '/follow-ups', '/surgeries', '/fractures',
    '/invoices', '/payments', '/finance', '/inventory', '/services', '/employees', '/roles', '/reports', '/sessions', '/settings', '/work-hours', '/exercises', '/notifications'];
  for (const p of PAGES) { await nav(D.page, p).catch(() => {}); }
  for (const p of ['/', '/patients', '/appointments', '/booking', '/invoices', '/payments', '/work-hours']) await nav(R.page, p).catch(() => {});
  await R.page.evaluate(() => import('/src/pages/PatientProfile.tsx')).catch(() => {});
  check('الجهازين نزّلوا البيانات على الجهاز (IndexedDB)', !!(await until(() => snapReady(R.page), 120000, 1500)) && !!(await until(() => snapReady(D.page), 120000, 1500)));

  // ======================= 1) النت بيفصل =======================
  section('1) النت بيفصل عن الجهازين في نفس الوقت');
  await R.ctx.setOffline(true); await D.ctx.setOffline(true);
  await sleep(1500);
  check('التطبيق عارف إنه من غير نت (الجهازين)', await app(R.page, `return !(await import('/src/offline/net.ts')).net.isOnline()`) && await app(D.page, `return !(await import('/src/offline/net.ts')).net.isOnline()`));

  section('2) الاستقبال من غير نت');
  // بحث محلي في كل المرضى (حتى اللي ماتفتحش ملفه قبل كده) بالاسم/الموبايل/رقم الملف
  await nav(R.page, '/patients');
  const searchHit = async (q, name) => { await R.page.fill('#pt-q', q); return !!(await until(async () => (await R.page.locator('tr', { hasText: name }).count()) > 0, 10000, 400)); };
  check('بحث بالاسم من غير نت (مريض ماتفتحش قبل كده)', await searchHit('نادر سليم', `نادر سليم ${TAG}`));
  check('بحث برقم الموبايل من غير نت', await searchHit('01200000965', `نادر سليم ${TAG}`));
  check('بحث برقم الملف من غير نت', await searchHit(String(P2.file_no).replace(/^\D+/, ''), `نادر سليم ${TAG}`), P2.file_no);
  // ملف مريض جديد من الشاشة
  await nav(R.page, '/'); // صفحة تانية الأول عشان «المرضى» تتفتح من جديد بـ ?new=1 (الاستقبال مالوش «مواعيد العمل»)
  await nav(R.page, '/patients?new=1');
  if (!(await R.page.waitForSelector('#np-name', { timeout: 20000 }).then(() => true).catch(() => false))) {
    console.log('  [debug new-patient]', R.page.url(), (await R.page.locator('main, .page').first().innerText().catch(() => '')).replace(/\s+/g, ' ').slice(0, 400));
    throw new Error('نموذج المريض الجديد ماظهرش');
  }
  const [f1, f2, f3] = NEWP.name.split(' ');
  await R.page.fill('#np-name', `${f1} ${f2} ${f3}`); await R.page.fill('#np-phone', NEWP.phone);
  await R.page.locator('.modal').getByRole('button', { name: 'حفظ', exact: true }).click();
  const rCreate = await until(async () => (await idbOps(R.page)).find((o) => o.kind === 'patient.create'), 15000);
  check('ملف المريض الجديد اتحفظ على الجهاز (متشفّر في الطابور)', !!rCreate && rCreate.sealed, JSON.stringify(await idbOps(R.page)));
  const R_LOCAL = rCreate?.entityId;
  // حجز للمريض الجديد + تعديل ميعاده (قبل ما يتبعت) — من طبقة البيانات زي ما شاشة الحجز بتنادي
  const b1 = await app(R.page, `const r = await db.createAppointment({ patientId: a.pid, type: 'initial', serviceId: 'old_exam', therapistId: a.th, date: a.day, time: '15:00', location: 'center' }); return r.ok ? r.appointment.id : r.error;`, { pid: R_LOCAL, th: made.therapist, day: DAY });
  check('حجز للمريض الجديد من غير نت', typeof b1 === 'string' && b1.length === 36, b1);
  const rs1 = await app(R.page, `return (await db.rescheduleAppointment(a.id, a.day, '15:30')).ok`, { id: b1, day: DAY });
  const rs2 = await app(R.page, `return (await db.rescheduleAppointment(a.id, a.day, '11:00')).ok`, { id: A2, day: DAY });
  await app(R.page, `await db.setAppointmentStatus(a.id, 'confirmed'); return true`, { id: A3 });
  await app(R.page, `await db.setAppointmentStatus(a.id, 'cancelled', 'إلغاء اختبار أوفلاين'); return true`, { id: A4 });
  check('تعديل ميعاد الحجز الجديد + تعديل/تأكيد/إلغاء حجوزات موجودة من غير نت', rs1 === true && rs2 === true);
  const apShown = await app(R.page, `const x = db.raw().appointments; const g = (id) => x.find((y) => y.id === id); return [g(a.b1)?.time, g(a.A2)?.time, g(a.A3)?.status, g(a.A4)?.status].join('|')`, { b1, A2, A3, A4 });
  check('الحجوزات ظاهرة على الجهاز بالتعديلات (15:30 · 11:00 · مؤكد · ملغي)', apShown === '15:30|11:00|confirmed|cancelled', apShown);
  const pay = await app(R.page, `return await db.recordPayment(a.inv, 100, 'cash', 'دفعة أوفلاين اختبار')`, { inv: INV });
  const invLocal = await app(R.page, `const i = db.raw().invoices.find((x) => x.id === a.inv); return i && [i.paid, i.remaining, i.status].join('|')`, { inv: INV });
  check('دفعة على فاتورة من غير نت ← الفاتورة بتبان مدفوع جزء على الجهاز', pay?.ok === true && invLocal === `100|${Number(invRow?.remaining) - 100}|partial`, JSON.stringify({ pay, invLocal }));
  const rOps = await idbOps(R.page);
  check('طابور الاستقبال: مريض + حجز (تعديله اندمج فيه) + تعديل + تأكيد + إلغاء + دفعة', ['patient.create', 'appointment.create', 'appointment.reschedule', 'appointment.status', 'appointment.cancel', 'payment.record'].every((k) => rOps.some((o) => o.kind === k)) && rOps.filter((o) => o.kind === 'appointment.create').length === 1, JSON.stringify(rOps.map((o) => o.kind)));

  section('3) الدكتور من غير نت (جهاز تاني)');
  // نفس المريض الجديد اتسجّل على جهاز الدكتور كمان (الجهازين مش شايفين بعض) + تشخيص عليه
  const D_LOCAL = await app(D.page, `const p = await db.createPatient({ nationality: 'saudi', firstName: '', fatherName: '', familyName: '', fullName: a.name, phone: a.phone, email: '', gender: 'male', genderUnknown: true, birthDate: '', nationalId: '', city: '', district: '', street: '', address: '', notes: '', doctorId: null, referralSource: 'friend', emergencyContactName: '', emergencyContactPhone: '', mainComplaint: '', diagnosis: '', medicalHistory: '' }); return p.id`, NEWP);
  check('الدكتور سجّل نفس المريض على جهازه بمعرّف محلي مختلف', typeof D_LOCAL === 'string' && D_LOCAL !== R_LOCAL);
  const C_LOCAL = await app(D.page, `return await ortho.save('consultations', { patientId: a.pid, date: a.today, complaint: 'ألم ركبة شامل اختبار', region: 'الركبة', side: 'right', examination: '', diagnosis: 'Knee OA offline full test', plan: 'علاج طبيعي', history: '', painScore: 6, icd10: '', medications: [{ name: 'Celebrex 200', dose: 'قرص', frequency: 'مرتين', duration: '5 أيام', notes: '' }], labs: [], imagingRequests: [], attachments: [], followUp: '', sheet: {}, complete: true, appointmentId: null, visitReason: '' })`, { pid: D_LOCAL, today: DAY });
  const IMG = await app(D.page, `return await ortho.save('imaging', { patientId: a.pid, kind: 'xray', region: 'الركبة — AP', requestedAt: a.today, status: 'requested', finding: '', attachments: [] })`, { pid: D_LOCAL, today: DAY });
  const C_P1 = await app(D.page, `return await ortho.save('consultations', { patientId: a.pid, date: a.today, complaint: 'متابعة', region: 'الكتف', side: 'left', examination: '', diagnosis: 'Frozen shoulder offline full test', plan: '', history: '', painScore: 3, icd10: '', medications: [], labs: ['CBC'], imagingRequests: [], attachments: [], followUp: '', sheet: {}, complete: true, appointmentId: null, visitReason: '' })`, { pid: P1.id, today: DAY });
  const LAB = await app(D.page, `return await ortho.save('imaging', { patientId: a.pid, kind: 'lab', region: 'CBC', requestedAt: a.today, status: 'requested', finding: '', attachments: [] })`, { pid: P1.id, today: DAY });
  // تشخيص مؤقت بالاسم الثلاثي والرقم (المريض لسه ماتسجّلش خالص)
  const C_TEMP = await app(D.page, `return await ortho.save('consultations', { patientId: '', pendingPatient: { name: a.name, phone: a.phone }, date: a.today, complaint: 'كاحل', region: 'الكاحل والقدم', side: 'left', examination: '', diagnosis: 'Ankle sprain temp name test', plan: '', history: '', painScore: 4, icd10: '', medications: [], labs: [], imagingRequests: [], attachments: [], followUp: '', sheet: {}, complete: true, appointmentId: null, visitReason: '' })`, { ...TEMP, today: DAY });
  const dOps = await idbOps(D.page);
  check('طابور الدكتور: مريض + ٢ تشخيص + أشعة + تحليل + تشخيص مؤقت (كلهم متشفّرين)', dOps.length === 6 && dOps.every((o) => o.sealed), JSON.stringify(dOps.map((o) => o.kind)));
  check('التشخيص على المريض المحلي مستني ملفه (مش هيتبعت قبله)', dOps.filter((o) => o.kind === 'ortho.save').length === 5);
  await nav(D.page, '/diagnosis?tab=done');
  check('الدكتور شايف التشخيص المؤقت عادي باسمه — من غير أي رسالة ربط', (await D.page.locator(`[data-unlinked="${C_TEMP}"]`, { hasText: TEMP.name }).count()) === 1 && !NO_LINK_MSG.test(await D.page.locator('body').innerText()));
  await nav(D.page, '/diagnosis');
  check('شاشة «بانتظار التشخيص» من غير رسالة ربط', !NO_LINK_MSG.test(await D.page.locator('body').innerText()));

  section('4) كل الصفحات بتفتح من غير نت');
  const broken = [];
  for (const p of PAGES) {
    const ok = await nav(D.page, p).then(() => true).catch(() => false);
    const txt = ok ? await D.page.locator('.page').first().innerText().catch(() => '') : '';
    if (!ok || /حدث خطأ غير متوقع|Something went wrong/.test(txt)) broken.push(p);
  }
  check(`${PAGES.length - broken.length}/${PAGES.length} صفحة فتحت من غير نت`, broken.length === 0, broken.join(' '));
  check('مفيش أخطاء JavaScript وقت التنقل من غير نت', D.errors.length === 0, D.errors.slice(0, 3).join(' | '));

  section('5) إعادة تحميل التطبيق وفيه عمليات معلّقة (واي فاي شغال بس الخادم مش واصل)');
  // سيرفر التطوير مالوش Service Worker، فإعادة التحميل من غير شبكة خالص بتتختبر في e2e-offline.mjs (نسخة الإنتاج).
  // هنا: الموقع نفسه بيفتح، بس أي طلب لـ Supabase بيقع (زي شبكة من غير إنترنت) — التطبيق لازم يفتح من الجهاز وطابوره كامل.
  const SB = /supabase\.co/;
  for (const x of [R, D]) { await x.ctx.route(SB, (r) => r.abort('internetdisconnected')); await x.ctx.setOffline(false); }
  await R.page.reload().catch(() => {}); await D.page.reload().catch(() => {});
  await R.page.waitForSelector('.page h1, .page-head h1', { timeout: 45000 }).catch(() => {});
  await D.page.waitForSelector('.page h1, .page-head h1', { timeout: 45000 }).catch(() => {});
  check('بعد إعادة الفتح: طابور الاستقبال كامل', (await idbOps(R.page)).length === rOps.length, `${(await idbOps(R.page)).length} vs ${rOps.length}`);
  check('بعد إعادة الفتح: طابور الدكتور كامل', (await idbOps(D.page)).length === dOps.length);
  await nav(R.page, '/patients');
  await R.page.fill('#pt-q', 'هاني فؤاد');
  check('المريض الجديد لسه ظاهر على جهاز الاستقبال بعد إعادة الفتح', !!(await until(async () => (await R.page.locator('tr', { hasText: NEWP.name }).count()) > 0, 15000)));
  check('الخادم ماوصلهوش ولا حاجة لسه', (await q1(`select count(*)::int n from patients where full_name = '${NEWP.name}'`)).n === 0 && (await q1(`select count(*)::int n from ortho_consultations where diagnosis like '%offline full test%'`)).n === 0);
  for (const x of [R, D]) { await x.ctx.setOffline(true); await x.ctx.unroute(SB); }

  section('6) نت متقطع: الخادم بيرجع 503 + رد بيضيع بعد الحفظ + فصل/رجوع ٣ مرات');
  // الدكتور يرفع الأول: مريضه المحلي (نفس الاسم والرقم) يوصل الخادم كملف جديد، وبعدين الاستقبال
  let failN = 0, dropN = 0;
  await D.ctx.route('**/rest/v1/ortho_consultations**', async (route) => {
    if (route.request().method() !== 'POST') return route.continue();
    if (failN < 1) { failN++; return route.fulfill({ status: 503, body: '{"message":"service unavailable"}', contentType: 'application/json' }); }
    if (dropN < 1) { dropN++; await route.fetch(); return route.abort('connectionreset'); } // الخادم حفظ والرد ضاع
    return route.continue();
  });
  for (let i = 0; i < 3; i++) { await D.ctx.setOffline(false); await sleep(900); await D.ctx.setOffline(true); await sleep(600); }
  await D.ctx.setOffline(false);
  const force = async (page) => app(page, `await offline.syncNow(true); return offline.queue.pendingCount()`).catch(() => -1);
  const dDone = await until(async () => (await force(D.page)) === 0, 120000, 2500);
  check('طابور الدكتور خلص لوحده بعد النت المتقطع', !!dDone, JSON.stringify(await idbOps(D.page)));
  check('الـ 503 والرد الضايع حصلوا فعلًا', failN === 1 && dropN === 1, `503=${failN} drop=${dropN}`);
  await R.ctx.setOffline(false);
  const rDone = await until(async () => { const n = await force(R.page); const ops = await idbOps(R.page); return n === 0 || (ops.length === 1 && ops[0].kind === 'payment.record' && !migrated) ? ops : null; }, 120000, 2500);
  check('طابور الاستقبال خلص (الدفعة بس ممكن تستنى تحديث الخادم)', !!rDone, JSON.stringify(await idbOps(R.page)));
  check('مفيش ولا عملية «فشل» أو «تعارض» محتاجة قرار (الجهازين)', [...(await idbOps(R.page)), ...(await idbOps(D.page))].every((o) => o.status !== 'failed' && o.status !== 'conflict'), JSON.stringify([...(await idbOps(R.page)), ...(await idbOps(D.page))]));

  section('7) قاعدة البيانات بعد المزامنة');
  const pats = await sql(`select id, file_no from patients where full_name = '${NEWP.name}'`);
  check('المريض اللي اتسجّل على الجهازين = ملف واحد بس (اتدمج تلقائي)', pats.length === 1, JSON.stringify(pats));
  const REAL = pats[0]?.id;
  check('بمعرّف واحد من الجهازين (مفيش معرّف ضايع)', [R_LOCAL, D_LOCAL].includes(REAL), REAL);
  const cons = await sql(`select id, patient_id from ortho_consultations where diagnosis = 'Knee OA offline full test'`);
  check('تشخيص الدكتور على المريض المحلي اتربط بالملف الحقيقي (مرة واحدة)', cons.length === 1 && cons[0].patient_id === REAL && cons[0].id === C_LOCAL, JSON.stringify(cons));
  const img = await sql(`select patient_id from ortho_imaging where id in ('${IMG}', '${LAB}')`);
  check('الأشعة والتحليل وصلوا مرة واحدة على الملفات الصح', img.length === 2 && img.some((x) => x.patient_id === REAL) && img.some((x) => x.patient_id === P1.id), JSON.stringify(img));
  const cp1 = await sql(`select id from ortho_consultations where patient_id = '${P1.id}'`);
  check('تشخيص المريض الموجود وصل مرة واحدة رغم الـ 503 والرد الضايع', cp1.length === 1 && cp1[0].id === C_P1, JSON.stringify(cp1));
  const appts = await sql(`select id, patient_id, time::text t, status from appointments where patient_id in ('${P1.id}', '${REAL}') order by time`);
  const g = (id) => appts.find((x) => x.id === id);
  // الحجز بيتعمل على الخادم برقم حجز حقيقي (book_appointment) — مفتاح العملية بيمنع التكرار، والمعرّف المحلي بيتشال من الجهاز بعد المزامنة
  const mine = appts.filter((x) => x.patient_id === REAL);
  check('حجز المريض الجديد وصل مرة واحدة على الملف الحقيقي بالميعاد المعدّل (15:30)', mine.length === 1 && mine[0].t.startsWith('15:30') && mine[0].status !== 'cancelled', JSON.stringify(appts));
  check('المعرّف المحلي للحجز اتشال من الجهاز (مفيش حجز مكرر ظاهر)', await app(R.page, `return db.raw().appointments.filter((x) => x.patientId === a.real || x.id === a.b1).map((x) => x.id).join()`, { real: REAL, b1 }).then((ids) => ids === mine[0]?.id), mine[0]?.id);
  check('تعديل الميعاد (11:00) + التأكيد + الإلغاء وصلوا الخادم', g(A2)?.t?.startsWith('11:00') && g(A3)?.status === 'confirmed' && g(A4)?.status === 'cancelled', JSON.stringify(appts));
  const pays = await sql(`select amount from payments where invoice_id = '${INV}' and voided_at is null`);
  if (migrated) check('الدفعة وصلت مرة واحدة بس', pays.length === 1 && Number(pays[0].amount) === 100, JSON.stringify(pays));
  else check('الدفعة محفوظة على الجهاز ومااتبعتتش من غير مفتاح (مستنية هجرة 959) — مفيش تكرار', pays.length === 0 && (await idbOps(R.page)).filter((o) => o.kind === 'payment.record').length === 1, JSON.stringify(pays));

  section('8) التشخيص المؤقت بالاسم بيتربط تلقائي لما الاستقبال يسجّل المريض');
  const t0 = await q1(`select patient_id, link_status from ortho_consultations where id = '${C_TEMP}'`);
  check('التشخيص المؤقت وصل الخادم (مستني ملف — مش ظاهر للدكتور كرسالة)', t0 && t0.patient_id === null, JSON.stringify(t0));
  const [tf, tm, tl] = TEMP.name.split(' ');
  await sql(`insert into patients (full_name, first_name, father_name, family_name, phone, gender, nationality, referral_source, file_no) values ('${TEMP.name}', '${tf}', '${tm}', '${tl}', '+2${TEMP.phone}', 'male', 'saudi', 'friend', '')`);
  const t1 = await until(() => q1(`select c.patient_id, c.link_method from ortho_consultations c join patients p on p.id = c.patient_id where c.id = '${C_TEMP}' and p.full_name = '${TEMP.name}'`), 20000, 1000);
  check('اتربط تلقائي بملف الاستقبال (auto) من غير ما حد يختار', t1?.link_method === 'auto', JSON.stringify(t1));
  await D.page.goto(BASE + `/diagnosis?patient=${REAL}`);
  check('ملف المريض الحقيقي عند الدكتور فيه تشخيصه', !!(await until(async () => (await D.page.locator('.page', { hasText: 'Knee OA offline full test' }).count()) > 0, 30000)));
  await D.page.goto(BASE + '/diagnosis?tab=done');
  await sleep(2500);
  check('مفيش أي رسالة ربط عند الدكتور بعد المزامنة', !NO_LINK_MSG.test(await D.page.locator('body').innerText()));
  check('الاستقبال: مفيش أخطاء JavaScript', R.errors.length === 0, R.errors.slice(0, 3).join(' | '));
  check('الدكتور: مفيش أخطاء JavaScript', D.errors.length === 0, D.errors.slice(0, 3).join(' | '));
  check('مفيش أخطاء Console غير أخطاء الشبكة المتوقعة', R.consoleErr.length + D.consoleErr.length === 0, [...R.consoleErr, ...D.consoleErr].slice(0, 4).join(' | '));
} catch (e) {
  check('تنفيذ الاختبار بدون أخطاء غير متوقعة', false, (e.stack ?? e.message).split('\n').slice(0, 4).join(' | '));
  if (lastPage) console.log('  آخر شاشة:', ((await lastPage.locator('body').textContent().catch(() => '')) ?? '').replace(/\s+/g, ' ').slice(0, 500));
} finally {
  await browser?.close().catch(() => {});
  await server?.close().catch(() => {});
  section('تنظيف بيانات الاختبار');
  try {
    await cleanup();
    for (const id of made.employees) { await sql(`delete from attendance where employee_id = '${id}'; delete from activity_log where employee_id = '${id}'; delete from offline_ops where employee_id = '${id}';`).catch(() => {}); await deleteEmployee(id); }
    if (made.therapist) await sql(`delete from therapist_services where therapist_id = '${made.therapist}'; delete from therapists where id = '${made.therapist}';`);
    await sql(`delete from notifications where (body like '%اختبار%' or title like '%اختبار%') and created_at >= '${STARTED}';
      delete from sync_tombstones where deleted_at >= '${STARTED}' and table_name in ('patients', 'appointments', 'ortho_consultations', 'ortho_imaging', 'invoices', 'payments');`).catch(() => {});
    await sql(`update counters set value = coalesce((select max(replace(file_no, 'TM-', '')::int) from patients where file_no ~ '^TM-[0-9]+$'), 0) where name = 'patient';`).catch(() => {});
    const left = await q1(`select (select count(*) from patients where family_name = '${TAG}' or full_name like '%${TAG}%')::int p, (select count(*) from ortho_consultations where diagnosis like '%offline full test%' or pending_patient->>'name' like '%${TAG}%')::int c, (select count(*) from employees where name like '%شامل اختبار%')::int e`);
    console.log('  متبقي:', JSON.stringify(left));
  } catch (e) { console.log('  تنظيف ناقص:', e.message); }
  save('e2e-offline-full-results.json');
}
