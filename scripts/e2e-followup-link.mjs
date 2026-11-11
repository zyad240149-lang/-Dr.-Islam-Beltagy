// اختبار ربط مواعيد المتابعة بالمواعيد (هجرة 933) على Supabase الحقيقي وفي متصفح Edge حقيقي.
// بينشئ طبيب واستقبال ومريضين مؤقتين ويمسحهم في الآخر.
//   node scripts/e2e-followup-link.mjs
import { fileURLToPath } from 'node:url';
import { createServer } from 'vite';
import { launchEdge } from './_edge.mjs';
import { allDayHours, api, cairoDate, client, deleteEmployee, login, loginAdmin, randomPassword, sql, suite } from './_harness.mjs';

const { check, section, save } = suite();
const PW = randomPassword();
const PORT = 4693, BASE = `http://127.0.0.1:${PORT}`;
const RECEP = { phone: '01200000933', digits: '201200000933', name: 'استقبال اختبار الربط', role: 'reception' };
const made = { employees: [], therapist: null, patients: [] };
const one = async (q) => (await sql(q))[0];
const waitFor = async (fn, ms = 15000) => { const end = Date.now() + ms; for (;;) { const v = await fn(); if (v || Date.now() > end) return v; await new Promise((r) => setTimeout(r, 400)); } };
const counts = (pid) => one(`select (select count(*) from appointments where patient_id = '${pid}')::int a, (select count(*) from ortho_follow_ups where patient_id = '${pid}')::int f, (select count(*) from invoices where patient_id = '${pid}')::int i`);

let server, browser;
try {
  section('التجهيز');
  const admin = await loginAdmin();
  const th = await admin.rpc('save_therapist', { p: { name: 'د. اختبار الربط', title: 'طبيب اختبار', phone: '', serviceIds: ['old_consult', 'old_op_follow'], workHours: allDayHours(), onLeave: [], active: true, defaultDurationMin: 30 } });
  made.therapist = th.data?.id ?? th.data;
  const r = await api(admin, 'POST', 'staff', { name: RECEP.name, phone: RECEP.phone, country: 'EG', password: PW, role: RECEP.role, workHours: allDayHours() });
  if (r.body?.id) made.employees.push(r.body.id);
  check('طبيب واستقبال مؤقتين', !!made.therapist && r.status === 201, JSON.stringify(r.body).slice(0, 120));
  const recep = await login(RECEP.digits, PW);
  const newPatient = async (phone, last) => {
    const n = await recep.from('patients').insert({ full_name: `مريض اختبار ${last}`, first_name: 'مريض', father_name: 'اختبار', family_name: last, phone, gender: 'male', nationality: 'saudi' }).select('id').single();
    if (n.error) throw new Error(n.error.message);
    made.patients.push(n.data.id);
    return n.data.id;
  };
  const P1 = await newPatient('+201200000931', 'الربط');

  // أول ساعة يوم فيه الخادم بيقبل الحجز (أيام وساعات المركز بتتغير)
  const [center] = await sql(`select week_schedule from center_info limit 1`);
  const openDay = (from) => { for (let i = from; i < from + 14; i++) { const d = cairoDate(i); const k = ['sun', 'mon', 'tue', 'wed', 'thu', 'fri', 'sat'][new Date(d + 'T00:00:00Z').getUTCDay()]; const s = (center.week_schedule ?? []).find((x) => x.day === k); if (s?.open) return { date: d, from: s.from, to: s.to }; } throw new Error('مفيش يوم مفتوح'); };
  const day1 = openDay(1), day2 = openDay(Number(day1.date.slice(8)) === Number(cairoDate(1).slice(8)) ? 2 : 3);
  const at = (d, m) => { const [h, mm] = d.from.split(':').map(Number); const t = h * 60 + mm + m; return `${String(Math.floor(t / 60)).padStart(2, '0')}:${String(t % 60).padStart(2, '0')}`; };
  const book = (pid, date, time, type = 'followup', service = 'old_op_follow') => recep.rpc('book_appointment', { p: { patientId: pid, type, serviceId: service, therapistId: made.therapist, date, time, notes: 'اختبار' } });
  const fuOf = (apptId) => one(`select id, status, date::text, to_char(time, 'HH24:MI') t, doctor_id, appointment_id, auto_created from ortho_follow_ups where appointment_id = '${apptId}'`);

  section('الخادم: الحجز والمتابعة نفس السجل');
  const fu = await recep.from('ortho_follow_ups').insert({ patient_id: P1, doctor_id: made.therapist, date: day1.date, time: at(day1, 0), reason: 'متابعة بعد العملية' }).select().single();
  check('موعد متابعة اتسجل', !fu.error, fu.error?.message);
  const b1 = await book(P1, day1.date, at(day1, 0));
  check('الحجز اتعمل', !b1.error, b1.error?.message);
  const A1 = b1.data?.id;
  const linked = await fuOf(A1);
  check('الحجز اتربط بنفس موعد المتابعة (نفس Appointment ID)', linked?.id === fu.data.id && linked?.auto_created === false, JSON.stringify(linked));
  let c = await counts(P1);
  check('مفيش تكرار: حجز واحد، متابعة واحدة، فاتورة واحدة', c.a === 1 && c.f === 1 && c.i === 1, JSON.stringify(c));
  const dup = await book(P1, day1.date, at(day1, 0));
  c = await counts(P1);
  check('حجز نفس الوقت تاني مرفوض ومن غير متابعة زيادة', !!dup.error && c.a === 1 && c.f === 1, dup.error?.message ?? 'accepted');

  section('الخادم: التغييرات بتتنقل من المواعيد للمتابعات');
  const cf = await recep.rpc('set_appointment_status', { p_id: A1, p_status: 'confirmed' });
  const st = await one(`select a.status from appointments a where a.id = '${A1}'`);
  check('التأكيد اتحفظ في قاعدة البيانات ومقروء من نفس السجل', !cf.error && st.status === 'confirmed' && (await fuOf(A1))?.status === 'scheduled', cf.error?.message);
  const mv = await recep.rpc('reschedule_appointment', { p_id: A1, p_date: day2.date, p_time: at(day2, 30) });
  const moved = await fuOf(A1);
  check('تأجيل الحجز غيّر تاريخ وساعة المتابعة', !mv.error && moved?.date === day2.date && moved?.t === at(day2, 30), mv.error?.message ?? JSON.stringify(moved));
  const cx = await recep.rpc('set_appointment_status', { p_id: A1, p_status: 'cancelled', p_reason: 'اختبار' });
  check('إلغاء الحجز لغى المتابعة', !cx.error && (await fuOf(A1))?.status === 'cancelled', cx.error?.message);
  const inv = await one(`select status from invoices where appointment_id = '${A1}'`);
  check('إلغاء الحجز لغى فاتورته غير المدفوعة', inv?.status === 'cancelled', JSON.stringify(inv));

  section('الخادم: حجز «متابعة» من شاشة المواعيد');
  const P2 = await newPatient('+201200000932', 'الربط تاني');
  const b2 = await book(P2, day1.date, at(day1, 60));
  const auto = await fuOf(b2.data?.id);
  check('حجز نوعه متابعة بيظهر في المتابعات لوحده', !b2.error && auto?.auto_created === true && auto?.status === 'scheduled', b2.error?.message ?? JSON.stringify(auto));
  const b3 = await book(P2, day1.date, at(day1, 120), 'session', 'old_consult');
  check('حجز نوعه تاني مابيعملش متابعة', !b3.error && !(await fuOf(b3.data?.id)), b3.error?.message);
  const today = cairoDate(0);
  await sql(`update appointments set date = '${today}' where id = '${b2.data.id}'`);
  const arr = await recep.rpc('set_appointment_status', { p_id: b2.data.id, p_status: 'arrived' });
  check('تسجيل الحضور خلّى المتابعة «تمت»', !arr.error && (await fuOf(b2.data.id))?.status === 'done', arr.error?.message);

  section('الخادم: منع التكرار والتضارب');
  const second = await recep.from('ortho_follow_ups').insert({ patient_id: P2, doctor_id: made.therapist, date: day2.date, appointment_id: b2.data.id }).select().single();
  const [{ n }] = await sql(`select count(*)::int n from ortho_follow_ups where appointment_id = '${b2.data.id}'`);
  check('الحجز الواحد ليه متابعة واحدة بس', !second.error && n === 1, second.error?.message ?? n);
  const anon = await client().from('ortho_follow_ups').select('id').eq('patient_id', P2);
  check('المتابعات مش ظاهرة لزائر بدون دخول', (anon.data ?? []).length === 0);
  const anonBook = await client().rpc('book_appointment', { p: { patientId: P2, type: 'followup', serviceId: 'old_op_follow', therapistId: made.therapist, date: day2.date, time: at(day2, 60) } });
  check('زائر بدون دخول مايقدرش يحجز', !!anonBook.error, 'accepted!');
  const noFn = await recep.rpc('trg_appointment_follow_up_sync');
  check('دوال التريجر مش متاحة للتشغيل المباشر', !!noFn.error, 'callable!');
  await sql(`delete from invoices where appointment_id = '${b3.data.id}'; delete from appointments where id = '${b3.data.id}'`);

  section('الواجهة: من المتابعات للمواعيد');
  server = await createServer({ configFile: fileURLToPath(new URL('../vite.config.ts', import.meta.url)), root: fileURLToPath(new URL('..', import.meta.url)), server: { port: PORT, strictPort: true, host: '127.0.0.1' }, logLevel: 'error' });
  await server.listen();
  browser = await launchEdge();
  const ctx = await browser.newContext({ viewport: { width: 1366, height: 900 }, locale: 'ar-EG' });
  const p = await ctx.newPage();
  // تشخيص مؤقت: أحداث التحديث اللحظي اللي بتوصل (جدول ونوع الحدث)
  const rtSeen = [];
  p.on('websocket', (ws) => ws.on('framereceived', (f) => { const t = String(f.payload); if (t.includes('postgres_changes') && /"table":"(patients|appointments)"/.test(t)) rtSeen.push(`${(t.match(/"table":"(\w+)"/) ?? [])[1]}:${(t.match(/"type":"(\w+)"/) ?? [])[1]}@${new Date().toISOString().slice(14, 23)}`); }));
  const errors = [];
  p.on('pageerror', (e) => errors.push(e.message));
  p.on('dialog', (d) => void d.accept());
  globalThis.__page = p;
  const P3 = await newPatient('+201200000934', 'الواجهة');
  await p.goto(BASE + '/login');
  await p.fill('#al-phone', RECEP.phone);
  await p.fill('#al-pass', PW);
  await p.click('button[type=submit]');
  await p.waitForURL((u) => u.pathname === '/', { timeout: 30000 });
  const go = (path) => p.evaluate((x) => { window.history.pushState({}, '', x); window.dispatchEvent(new PopStateEvent('popstate')); }, path);

  await go(`/patients/${P3}`);
  await p.getByRole('button', { name: 'مواعيد المتابعة' }).first().click();
  await p.getByRole('button', { name: 'موعد متابعة جديد' }).first().click();
  const m = p.locator('.modal', { hasText: 'تحديد موعد متابعة' }).last();
  await m.locator('select').first().selectOption(made.therapist);
  await m.locator('input[aria-label="يوم المتابعة"]').fill(day1.date);
  await m.locator('input.fu-slots__time').fill(at(day1, 180));
  await m.locator('textarea').first().fill('اختبار ربط الواجهة');
  await m.getByRole('button', { name: 'حفظ' }).click();
  const a3 = await waitFor(() => one(`select a.id, a.no, a.status, a.type, f.id fid from appointments a join ortho_follow_ups f on f.appointment_id = a.id where a.patient_id = '${P3}'`));
  check('حفظ المتابعة من الواجهة عمل حجز حقيقي مربوط', a3?.type === 'followup' && a3?.status === 'new', JSON.stringify(a3));

  await p.reload();
  await go('/follow-ups');
  const row = p.locator('.fu-confirm .fu-item', { hasText: 'مريض اختبار الواجهة' });
  await row.waitFor({ timeout: 20000 });
  check('الموعد ظاهر في «مواعيد محتاجة تأكيد» بعد إعادة التحميل', await row.locator('.badge', { hasText: 'محتاج تأكيد' }).count() === 1);
  await row.locator('.fu-item__main').click();
  const dm = p.locator('.modal', { hasText: 'موعد متابعة' }).last();
  // الفتح async (بيحمّل المتابعات لو لسه ماتحمّلتش) — بنستنى النافذة بدل ما نشيك فورًا
  const opened = await dm.getByRole('button', { name: 'تأكيد الموعد' }).waitFor({ timeout: 15000 }).then(() => true).catch(() => false);
  if (!opened) await p.screenshot({ path: fileURLToPath(new URL('../docs/ui-failures/fu-confirm-open.png', import.meta.url)) }).catch(() => {});
  check('الضغط على الموعد فتح تفاصيله ومعاها زرار التأكيد', opened, (await p.locator('.modal h2').allTextContents()).join(' | '));
  await dm.getByRole('button', { name: 'تأكيد الموعد' }).click();
  const conf = await waitFor(async () => (await one(`select status from appointments where id = '${a3.id}'`))?.status === 'confirmed');
  check('التأكيد من المتابعات اتحفظ على نفس سجل الموعد', !!conf);
  const c3 = await counts(P3);
  check('التأكيد ماعملش حجز تاني', c3.a === 1 && c3.f === 1, JSON.stringify(c3));

  // ١٠/١١: صفحة «المواعيد» اتشالت (/appointments بيفتح «حجز كشف ومتابعة») — نفس الموعد بيظهر هنا «مؤكد» بعد إعادة التحميل
  await p.reload();
  await p.waitForSelector('.page h1', { timeout: 30000 });
  check('بعد إعادة التحميل: الموعد اتشال من «محتاج تأكيد» (اتأكد)', await waitFor(async () => (await p.locator('.fu-confirm .fu-item', { hasText: 'مريض اختبار الواجهة' }).count()) === 0, 20000));

  section('الواجهة: من المواعيد للمتابعات');
  const P4 = await newPatient('+201200000935', 'الاتجاه التاني');
  const b4 = await book(P4, day1.date, at(day1, 240));
  await go('/'); await p.waitForTimeout(500); // تنقل جوّه البرنامج (من غير إعادة تحميل) زي ما كان بيروح للمواعيد ويرجع
  await go('/follow-ups');
  const row4 = p.locator('.fu-confirm .fu-item', { hasText: 'مريض اختبار الاتجاه التاني' });
  const seen4 = await waitFor(async () => (await row4.count()) === 1, 20000);
  if (!seen4) {
    // تشخيص: اللي ظاهر في «محتاج تأكيد» ساعة الفشل + صورة
    const box = await p.locator('.fu-confirm').innerText().catch(() => '(مفيش قسم «محتاج تأكيد»)');
    console.log('    [debug] fu-confirm:', box.replace(/\s+/g, ' ').slice(0, 400));
    console.log('    [debug] booking', b4.data?.id, 'patient', P4);
    console.log('    [debug] realtime frames:', rtSeen.slice(-12).join(' '));
    await p.screenshot({ path: fileURLToPath(new URL('../docs/ui-failures/fu-confirm-missing.png', import.meta.url)) }).catch(() => {});
  }
  check('حجز المواعيد ظاهر في المتابعات «محتاج تأكيد» من غير إعادة تحميل', seen4);
  const cf4 = await recep.rpc('set_appointment_status', { p_id: b4.data.id, p_status: 'confirmed' });
  check('التأكيد من جهاز تاني اتحفظ', !cf4.error, cf4.error?.message);
  check('المتابعات شالته من «محتاج تأكيد» فورًا', await waitFor(async () => (await row4.count()) === 0, 20000));
  check('المتابعة المربوطة بقت «مؤكد» في قاعدة البيانات', await waitFor(async () => (await one(`select a.status from appointments a join ortho_follow_ups f on f.appointment_id = a.id where a.id = '${b4.data.id}'`))?.status === 'confirmed'));

  const P5 = await newPatient('+201200000936', 'تأكيد المواعيد');
  const b5 = await book(P5, day1.date, at(day1, 300));
  // زرار «تأكيد» في «مواعيد محتاجة تأكيد» (بدل صفحة المواعيد القديمة)
  const row5 = p.locator('.fu-confirm .fu-item', { hasText: 'مريض اختبار تأكيد المواعيد' }).first();
  await row5.waitFor({ timeout: 20000 });
  await row5.getByRole('button', { name: 'تأكيد' }).click();
  check('زرار «تأكيد» في «مواعيد محتاجة تأكيد» حفظ في قاعدة البيانات', await waitFor(async () => (await one(`select status from appointments where id = '${b5.data.id}'`))?.status === 'confirmed'));
  check('التأكيد شال الموعد من «محتاج تأكيد»', await waitFor(async () => (await row5.count()) === 0, 20000));

  // إلغاء من نافذة المتابعة (من ملف المريض ← «مواعيد المتابعة»)
  await go(`/patients/${P4}`);
  await p.getByRole('button', { name: 'مواعيد المتابعة' }).first().click();
  const item4 = p.locator('.fu-item').first();
  await item4.waitFor({ timeout: 20000 });
  await item4.locator('.fu-item__main').click();
  const cm = p.locator('.modal', { hasText: 'موعد متابعة' }).last();
  await cm.getByRole('button', { name: 'إلغاء الموعد' }).click();
  const gone = await waitFor(async () => { const x = await one(`select a.status ast, f.status fst from appointments a join ortho_follow_ups f on f.appointment_id = a.id where a.id = '${b4.data.id}'`); return x?.ast === 'cancelled' && x?.fst === 'cancelled'; });
  check('إلغاء الموعد من المتابعات لغى السجلين', !!gone);
  check('الواجهة من غير أخطاء JavaScript', errors.length === 0, errors.join(' | '));
  await ctx.close();
} catch (e) {
  await globalThis.__page?.screenshot({ path: fileURLToPath(new URL('../docs/ui-failures/followup-link.png', import.meta.url)) }).catch(() => {});
  console.log(e.message.split(String.fromCharCode(10)).slice(0, 8).join(' | '));
  check('الاختبار اكتمل من غير استثناء', false, e.message.split('\n')[0]);
} finally {
  await browser?.close().catch(() => {});
  await server?.close().catch(() => {});
  section('تنظيف');
  for (const id of made.patients) await sql(`delete from notifications where patient_id = '${id}'; delete from payments where invoice_id in (select id from invoices where patient_id = '${id}'); delete from ortho_follow_ups where patient_id = '${id}'; delete from invoices where patient_id = '${id}'; delete from appointments where patient_id = '${id}'; delete from patients where id = '${id}';`).catch((e) => check('تنظيف مريض', false, e.message));
  for (const id of made.employees) { await sql(`delete from attendance where employee_id = '${id}';`).catch(() => {}); await deleteEmployee(id); }
  if (made.therapist) await sql(`delete from therapist_services where therapist_id = '${made.therapist}'; delete from therapists where id = '${made.therapist}';`).catch((e) => check('تنظيف الطبيب', false, e.message));
  const [left] = await sql(`select (select count(*) from patients where full_name like 'مريض اختبار %' and phone like '+20120000093%')::int p, (select count(*) from employees where name = '${RECEP.name}')::int e`);
  check('مفيش بيانات اختبار متبقية', left.p === 0 && left.e === 0, JSON.stringify(left));
  save('e2e-followup-link-results.json');
  process.exit(0);
}
