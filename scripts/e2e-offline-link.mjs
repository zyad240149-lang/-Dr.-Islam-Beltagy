// سيناريو الاستقبال والدكتور بدون إنترنت على جهازين مختلفين (هجرة 924):
//  1) الجهازين بيدخلوا بإنترنت وينزّلوا البيانات ← النت بيفصل عن الاتنين.
//  2) الاستقبال بيفتح ملف مريض جديد بالاسم الثلاثي (على الجهاز بس).
//  3) الدكتور من جهاز تاني بيفتح «ملف تشخيص جديد» بنفس الاسم ويحفظ التشخيص (على الجهاز بس) — المريض مش ظاهر عنده.
//  4) النت بيرجع: الدكتور يرفع الأول (التشخيص يستنى «بانتظار ملف المريض») ← الاستقبال يرفع ← الخادم يربطهم.
//  5) التشخيص ظاهر في ملف المريض الأساسي وفي «المرضى اللي اتشخصوا»، ومفيش ملف مكرر.
//  6) اسمين متشابهين (ملفين بنفس الاسم): مفيش دمج — «يحتاج مراجعة وربط»، والمستخدم بيختار الملف ويربط.
// كل بيانات الاختبار بتتمسح في الآخر.   node scripts/e2e-offline-link.mjs
import { fileURLToPath } from 'node:url';
import { createServer } from 'vite';
import { launchEdge } from './_edge.mjs';
import { allDayHours, api, deleteEmployee, loginAdmin, randomPassword, sql, suite } from './_harness.mjs';

const { check, section, save } = suite();
const PORT = 4693, BASE = `http://127.0.0.1:${PORT}`;
const PW = randomPassword();
const STAFF = {
  recep: { phone: '01200000971', digits: '201200000971', name: 'استقبال ربط اختبار', role: 'reception' },
  doc: { phone: '01200000972', digits: '201200000972', name: 'دكتور ربط اختبار', role: 'system_admin' },
};
const P = { first: 'وليد', father: 'سامر', family: 'ربطاختبار', phone: '01200000979' };
const NAME = `${P.first} ${P.father} ${P.family}`;
const TWIN = 'تامر نبيل مراجعةاختبار'; // ملفين بنفس الاسم ← مراجعة
const made = { employees: [] };
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
// مربعات كشف الطبيب بتبدأ مقفولة في الكشف الجديد (src/ortho/ExamSheet.tsx BoxOpenDefault) — بنفتح اللي محتاجينه
let docPage;
const openBox = async (t) => {
  const h = docPage.locator('.modal .sh-box.is-closed .sh-box__h', { hasText: t });
  if (await h.count()) { await h.locator('.sh-box__t').click(); await sleep(300); }
};
const openDx = () => openBox('Diagnosis Sheet');
const until = async (f, ms = 60000, every = 700) => { const t = Date.now(); for (;;) { const v = await f().catch(() => null); if (v) return v; if (Date.now() - t > ms) return null; await sleep(every); } };
const q1 = (s) => sql(s).then((r) => r[0]);
const cleanup = async () => {
  await sql(`delete from ortho_imaging where patient_id in (select id from patients where family_name in ('ربطاختبار', 'مراجعةاختبار'));
    delete from ortho_consultations where pending_patient->>'name' like '%اختبار%' or patient_id in (select id from patients where family_name in ('ربطاختبار', 'مراجعةاختبار'));
    delete from patients where family_name in ('ربطاختبار', 'مراجعةاختبار');`);
};
const idbOps = (page) => page.evaluate(() => new Promise((resolve) => {
  const r = indexedDB.open('ortho-offline');
  r.onerror = () => resolve([]);
  r.onsuccess = () => {
    const d = r.result;
    if (!d.objectStoreNames.contains('ops')) { resolve([]); return; }
    const g = d.transaction('ops', 'readonly').objectStore('ops').getAll();
    g.onsuccess = () => resolve((g.result ?? []).map((o) => ({ kind: o.kind, status: o.status, entityId: o.entityId, lastError: o.lastError })));
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
    g.onsuccess = () => resolve(!!(g.result?.sync?.patients?.complete && (g.result.tables ?? []).includes('ortho')));
    g.onerror = () => resolve(false);
  };
}));

let server, browser, lastPage;
try {
  section('التجهيز');
  await cleanup();
  for (const s of Object.values(STAFF)) for (const { id } of await sql(`select id from employees where username = '${s.digits}'`)) { await sql(`delete from attendance where employee_id = '${id}';`); await deleteEmployee(id); }
  const admin = await loginAdmin();
  for (const s of Object.values(STAFF)) {
    const r = await api(admin, 'POST', 'staff', { name: s.name, phone: s.phone, country: 'EG', password: PW, role: s.role, workHours: allDayHours() });
    if (r.body?.id) made.employees.push(r.body.id);
    check(`حساب ${s.name}`, r.status === 201, JSON.stringify(r.body).slice(0, 120));
  }
  // ملفين قدام بنفس الاسم (سيناريو عدم التأكد)
  await sql(`select set_config('app.legacy_import', 'on', true);
    insert into patients (full_name, first_name, father_name, family_name, phone, gender, nationality, referral_source, file_no)
    values ('${TWIN}', 'تامر', 'نبيل', 'مراجعةاختبار', '+201200000977', 'male', 'saudi', 'friend', ''),
           ('${TWIN}', 'تامر', 'نبيل', 'مراجعةاختبار', '+201200000978', 'male', 'saudi', 'friend', '');`);
  const twins = await sql(`select id from patients where full_name = '${TWIN}' order by file_no`);
  check('ملفين بنفس الاسم لسيناريو المراجعة', twins.length === 2);

  server = await createServer({ configFile: fileURLToPath(new URL('../vite.config.ts', import.meta.url)), root: fileURLToPath(new URL('..', import.meta.url)), logLevel: 'error', server: { port: PORT, strictPort: true, host: '127.0.0.1', hmr: false } });
  await server.listen();
  browser = await launchEdge();

  // كل جهاز = سياق متصفح منفصل (تخزين IndexedDB منفصل — مايشوفوش بيانات بعض)
  const device = async (who) => {
    const ctx = await browser.newContext({ viewport: { width: 1366, height: 860 }, locale: 'ar-EG' });
    const page = await ctx.newPage();
    const errors = [];
    page.on('pageerror', (e) => errors.push('pageerror: ' + e.message));
    page.on('dialog', (d) => d.accept());
    lastPage = page;
    await page.goto(BASE + '/login');
    await page.fill('#al-phone', who.phone); await page.fill('#al-pass', PW); await page.click('button[type=submit]');
    check(`${who.name}: الدخول بإنترنت`, await page.waitForURL((u) => u.pathname === '/', { timeout: 60000 }).then(() => true).catch(() => false), page.url());
    return { ctx, page, errors };
  };
  const nav = async (page, path) => {
    await page.evaluate((p) => { window.history.pushState({}, '', p); window.dispatchEvent(new PopStateEvent('popstate')); }, path);
    await page.waitForSelector('.page h1', { timeout: 20000 });
    await page.waitForTimeout(800);
  };
  const R = await device(STAFF.recep);
  const D = await device(STAFF.doc);
  // نفتح الشاشات مرة بإنترنت عشان ملفاتها تتحمّل (بعدين بتشتغل من غير شبكة)
  await nav(R.page, '/patients');
  await nav(R.page, '/work-hours');
  // صفحة ملف المريض بتتفتح بعد الحفظ — في نسخة الإنتاج ملفاتها متخزّنة مسبقًا (Service Worker)، هنا (سيرفر التطوير) بنحمّلها بإيدينا
  await R.page.evaluate(() => import('/src/pages/PatientProfile.tsx')).catch(() => {});
  await nav(D.page, '/diagnosis');
  await nav(D.page, '/patients');
  await nav(D.page, '/diagnosis');
  check('الجهازين نزّلوا البيانات على الجهاز (IndexedDB)', !!(await until(() => snapReady(R.page), 120000, 1500)) && !!(await until(() => snapReady(D.page), 120000, 1500)));

  section('1) النت بيفصل عن الجهازين');
  await R.ctx.setOffline(true); await D.ctx.setOffline(true);
  await sleep(1500);

  section('2) الاستقبال (بدون إنترنت): ملف مريض جديد');
  await nav(R.page, '/'); // صفحة تانية الأول عشان «المرضى» تتفتح من جديد بـ ?new=1 (الاستقبال مالوش «مواعيد العمل»)
  await nav(R.page, '/patients?new=1');
  await R.page.waitForSelector('#np-name', { timeout: 20000 });
  await R.page.fill('#np-name', `${P.first} ${P.father} ${P.family}`);
  await R.page.fill('#np-phone', P.phone);
  await R.page.locator('.modal').getByRole('button', { name: 'حفظ', exact: true }).click();
  const rOps = await until(async () => { const o = await idbOps(R.page); return o.some((x) => x.kind === 'patient.create') ? o : null; }, 15000);
  check('ملف المريض اتحفظ على جهاز الاستقبال (IndexedDB) بمعرّف محلي', !!rOps, JSON.stringify(await idbOps(R.page)));
  const localPatientId = rOps?.find((x) => x.kind === 'patient.create')?.entityId;
  check('الخادم ماوصلهوش حاجة لسه', (await q1(`select count(*)::int n from patients where full_name = '${NAME}'`)).n === 0);

  section('3) الدكتور (جهاز تاني، بدون إنترنت): «فتح ملف تشخيص جديد» بالاسم الثلاثي');
  await nav(D.page, '/diagnosis');
  check('المريض الجديد مش ظاهر عند الدكتور (الجهازين مش شايفين بعض)', (await D.page.locator('text=' + NAME).count()) === 0);
  await D.page.getByRole('button', { name: 'فتح ملف تشخيص جديد' }).click();
  const nameInput = D.page.locator('.modal input.input').first();
  await nameInput.fill(`${P.first} ${P.father}`);
  check('الاسم الثنائي مش مقبول (لازم ثلاثي)', await D.page.locator('.modal__foot button', { hasText: 'ابدأ التشخيص بالاسم ده' }).isDisabled());
  await nameInput.fill(`${P.first}  ${P.father} ${P.family}`); // مسافة زيادة — المطابقة بتتجاهلها
  check('رسالة «مفيش إنترنت — هيتحفظ على الجهاز»', (await D.page.locator('.modal', { hasText: 'مفيش إنترنت دلوقتي' }).count()) === 1);
  await D.page.locator('.modal__foot button', { hasText: 'ابدأ التشخيص بالاسم ده' }).click();
  await D.page.waitForSelector('.modal .dx-unlinked', { state: 'attached', timeout: 10000 });
  check('نموذج التشخيص اتفتح باسم المريض في خانة 1 (من غير رسالة ربط)', (await D.page.locator('.modal .dx-unlinked').getAttribute('data-name'))?.replace(/\s+/g, ' ').trim() === NAME && !/ربط/.test(await D.page.locator('.modal .sh-visitlink').allInnerTexts().then((x) => x.join(' '))));
  await D.page.locator('.sh-tabs button', { hasText: 'كشف الطبيب' }).click();
  await D.page.locator('.sh-region__pick', { hasText: 'الكاحل والقدم' }).click();
  docPage = D.page;
  await openBox('Chief Complaint');
  await D.page.locator('.sh-ck', { hasText: 'Ankle pain' }).first().locator('input').check();
  await openDx();
  await D.page.locator('.modal .sh-line', { hasText: 'Primary Diagnosis' }).locator('input').fill('Lateral ankle sprain offline test');
  await D.page.locator('.modal__foot button', { hasText: 'حفظ الكشف' }).click();
  const ask = D.page.locator('.modal__foot button', { hasText: 'التشخيص اكتمل' });
  if (await ask.count()) await ask.click();
  await D.page.waitForFunction(() => !document.querySelector('.modal'), null, { timeout: 20000 });
  await sleep(1000);
  const dOps = await idbOps(D.page);
  check('التشخيص اتحفظ على جهاز الدكتور (IndexedDB) بمعرّف مستقل', dOps.some((x) => x.kind === 'ortho.save'), JSON.stringify(dOps));
  const consultId = dOps.find((x) => x.kind === 'ortho.save')?.entityId;
  // طلب المستخدم: مفيش أي رسالة «محتاج ربط»/«اختار المريض»/«غير مرتبط» للدكتور — التشخيص ظاهر عادي باسمه في «اتشخصوا»
  await nav(D.page, '/diagnosis?tab=done');
  check('التشخيص ظاهر عادي في «المرضى اللي اتشخصوا» باسم المريض (محفوظ على الجهاز)', (await D.page.locator(`[data-unlinked="${consultId}"]`, { hasText: NAME }).count()) === 1);
  const NO_LINK_MSG = /محتاج(ة)? ربط|يحتاج مراجعة وربط|اختار المريض|غير مرتبط|بانتظار ملف المريض/;
  check('مفيش أي رسالة ربط للدكتور (شاشة التشخيص بكل تبويباتها)', !NO_LINK_MSG.test(await D.page.locator('body').innerText()) && !NO_LINK_MSG.test((await (async () => { await nav(D.page, '/diagnosis'); return D.page.locator('body').innerText(); })())));

  section('4) النت بيرجع — الدكتور يرفع الأول، بعده الاستقبال');
  await D.ctx.setOffline(false);
  const waiting = await until(async () => { const c = await q1(`select patient_id, link_status, pending_patient from ortho_consultations where id = '${consultId}'`); return c ? c : null; }, 90000, 1500);
  check('التشخيص وصل الخادم تلقائيًا (من غير ضغط زرار)', !!waiting, JSON.stringify(waiting));
  check('ومستني ملف الاستقبال («بانتظار ملف المريض»)', waiting?.patient_id === null && waiting?.link_status === 'waiting', JSON.stringify(waiting));
  await R.ctx.setOffline(false);
  const pat = await until(() => q1(`select id, file_no from patients where full_name = '${NAME}'`), 90000, 1500);
  check('ملف المريض وصل الخادم بنفس المعرّف المحلي', pat?.id === localPatientId, JSON.stringify(pat));
  const linked = await until(async () => { const c = await q1(`select patient_id, link_status, link_method from ortho_consultations where id = '${consultId}'`); return c?.patient_id ? c : null; }, 30000, 1000);
  check('5) الخادم ربط التشخيص بملف المريض الأساسي تلقائي', linked?.patient_id === pat?.id && linked?.link_method === 'auto' && linked?.link_status === null, JSON.stringify(linked));
  check('مفيش ملف مريض مكرر', (await q1(`select count(*)::int n from patients where norm_ar_name(full_name) = norm_ar_name('${NAME}')`)).n === 1);
  check('مفيش تشخيص مكرر', (await q1(`select count(*)::int n from ortho_consultations where patient_id = '${pat?.id}'`)).n === 1);

  section('5) التشخيص ظاهر في ملف المريض وفي «المرضى اللي اتشخصوا»');
  await D.page.goto(BASE + `/diagnosis?patient=${pat?.id}`);
  check('ملف المريض الأساسي فيه التشخيص (جهاز الدكتور)', !!(await until(async () => (await D.page.locator('.page', { hasText: 'Lateral ankle sprain offline test' }).count()) > 0, 30000)));
  const fileNo = String(pat?.file_no ?? '###').replace(/^TM-/, '');
  let bar = '';
  await until(async () => (bar = await D.page.locator('.dx-patbar').innerText().catch(() => '')).replace(/\s+/g, ' ').includes(fileNo), 20000);
  check('برقم ملف الاستقبال', bar.replace(/\s+/g, ' ').includes(String(pat?.file_no ?? '###').replace(/^TM-/, '')), `${bar.replace(/\s+/g, ' ')} / ${pat?.file_no}`);
  await R.page.goto(BASE + `/diagnosis?tab=done`);
  check('ظاهر في «المرضى اللي اتشخصوا» (جهاز الاستقبال)', !!(await until(async () => (await R.page.locator('.page', { hasText: NAME }).count()) > 0, 30000)));
  check('مابقاش ظاهر كتشخيص بالاسم (بقى على ملف المريض)', (await R.page.locator(`[data-unlinked="${consultId}"]`).count()) === 0);

  section('6) اسمين متشابهين: مفيش دمج — «يحتاج مراجعة» والربط يدوي');
  await D.page.goto(BASE + '/diagnosis');
  await D.page.waitForSelector('.page h1', { timeout: 20000 }); await sleep(1500);
  await D.ctx.setOffline(true); await sleep(800);
  await D.page.getByRole('button', { name: 'فتح ملف تشخيص جديد' }).click();
  await D.page.locator('.modal input.input').first().fill(TWIN);
  check('النافذة بتقترح الملفات الموجودة بنفس الاسم', (await D.page.locator('.modal .dx-hits__row', { hasText: TWIN }).count()) === 2);
  await D.page.locator('.modal__foot button', { hasText: 'ابدأ التشخيص بالاسم ده' }).click();
  await D.page.waitForSelector('.modal .dx-unlinked', { state: 'attached', timeout: 10000 });
  await D.page.locator('.sh-tabs button', { hasText: 'كشف الطبيب' }).click();
  await D.page.locator('.sh-region__pick', { hasText: 'الكاحل والقدم' }).click();
  await openDx();
  await D.page.locator('.modal .sh-line', { hasText: 'Primary Diagnosis' }).locator('input').fill('Twin review test');
  await D.page.locator('.modal__foot button', { hasText: 'حفظ الكشف' }).click();
  if (await D.page.locator('.modal__foot button', { hasText: 'التشخيص اكتمل' }).count()) await D.page.locator('.modal__foot button', { hasText: 'التشخيص اكتمل' }).click();
  await D.page.waitForFunction(() => !document.querySelector('.modal'), null, { timeout: 20000 });
  const twinId = (await idbOps(D.page)).find((x) => x.kind === 'ortho.save')?.entityId;
  await D.ctx.setOffline(false);
  const review = await until(() => q1(`select patient_id, link_status, link_note from ortho_consultations where id = '${twinId}' and link_status is not null`), 90000, 1500);
  check('مااتدمجش تلقائي — «يحتاج مراجعة»', review?.patient_id === null && review?.link_status === 'review', JSON.stringify(review));
  check('الملفين لسه موجودين زي ما هما', (await q1(`select count(*)::int n from patients where full_name = '${TWIN}'`)).n === 2);
  // مش متأكدين ← مابيتربطش بملف غلط، ومفيش أي رسالة للدكتور؛ بيروح لقايمة المراجعة الداخلية (الإعدادات ← مراجعة ربط التشخيصات)
  await D.page.goto(BASE + '/diagnosis?tab=done');
  const row = D.page.locator(`[data-unlinked="${twinId}"]`);
  check('عند الدكتور: التشخيص ظاهر عادي باسمه — من غير «يحتاج مراجعة»', !!(await until(async () => (await row.count()) === 1, 30000)) && !NO_LINK_MSG.test(await D.page.locator('body').innerText()));
  await D.page.goto(BASE + '/settings');
  await D.page.locator('.tab', { hasText: 'مراجعة ربط التشخيصات' }).click();
  const rv = D.page.locator(`[data-review="${twinId}"]`);
  check('في قايمة المراجعة الداخلية (الإعدادات)', !!(await until(async () => (await rv.count()) === 1, 30000)));
  await rv.locator('input').first().fill(TWIN);
  await rv.locator('.gsearch__hit', { hasText: TWIN }).nth(1).click();
  await rv.getByRole('button', { name: 'ربط', exact: true }).click();
  const man = await until(() => q1(`select patient_id, link_method from ortho_consultations where id = '${twinId}' and patient_id is not null`), 15000);
  check('الربط من قايمة المراجعة ربطه بالملف اللي اتختار', !!man && twins.some((t) => t.id === man.patient_id) && man.link_method === 'manual', JSON.stringify(man));
  await sleep(1500);
  check('اختفى من قايمة المراجعة', (await D.page.locator(`[data-review="${twinId}"]`).count()) === 0);
  check('مفيش أخطاء في الصفحات', R.errors.length + D.errors.length === 0, [...R.errors, ...D.errors].slice(0, 3).join(' | '));
} catch (e) {
  check('تنفيذ الاختبار بدون أخطاء غير متوقعة', false, e.message);
  if (lastPage) console.log('  آخر شاشة:', ((await lastPage.locator('body').textContent().catch(() => '')) ?? '').replace(/\s+/g, ' ').slice(0, 600));
} finally {
  await browser?.close().catch(() => {});
  await server?.close().catch(() => {});
  section('تنظيف بيانات الاختبار');
  try {
    await cleanup();
    for (const id of made.employees) { await sql(`delete from attendance where employee_id = '${id}';`); await deleteEmployee(id); }
    await sql(`update counters set value = coalesce((select max(replace(file_no, 'TM-', '')::int) from patients where file_no ~ '^TM-[0-9]+$'), 0) where name = 'patient';`);
    const left = await q1(`select (select count(*) from patients where family_name in ('ربطاختبار', 'مراجعةاختبار'))::int p, (select count(*) from employees where name like '%ربط اختبار%')::int e, (select count(*) from patients)::int total`);
    console.log('  متبقي:', JSON.stringify(left));
  } catch (e) { console.log('  تنظيف ناقص:', e.message); }
  save('e2e-offline-link-results.json');
}
