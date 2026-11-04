// عمليات كانت من غير اختبار: حذف الموعد والمريض بقواعدهم، الخدمات والأسعار، المصروفات، الحسابات، الصلاحيات، والتحقق من البيانات.
// بينشئ طبيب واستقبال ومريضين وخدمة مؤقتين ويمسحهم في الآخر، وبيتأكد إن الأعداد رجعت زي ما كانت.
//   node scripts/e2e-crud-gaps.mjs
import { allDayHours, api, cairoDate, client, deleteEmployee, login, loginAdmin, randomPassword, sql, suite } from './_harness.mjs';

const { check, section, save } = suite();
const PW = randomPassword();
const RECEP = { phone: '01200000941', digits: '201200000941', name: 'استقبال اختبار العمليات' };
const made = { employees: [], therapist: null, patients: [], service: null, expense: null };
const one = async (q) => (await sql(q))[0];
const totals = () => one(`select (select count(*) from patients)::int patients, (select count(*) from services)::int services, (select count(*) from expenses)::int expenses, (select count(*) from appointments)::int appts, (select count(*) from invoices)::int invoices, (select count(*) from payments)::int payments, (select count(*) from acc_journals)::int journals, (select count(*) from employees)::int employees, (select count(*) from therapists)::int therapists`);

const before = await totals();
try {
  section('التجهيز');
  const admin = await loginAdmin();
  const th = await admin.rpc('save_therapist', { p: { name: 'د. اختبار العمليات', title: 'طبيب اختبار', phone: '', serviceIds: ['old_consult'], workHours: allDayHours(), onLeave: [], active: true, defaultDurationMin: 30 } });
  made.therapist = th.data?.id ?? th.data;
  const r = await api(admin, 'POST', 'staff', { name: RECEP.name, phone: RECEP.phone, country: 'EG', password: PW, role: 'reception', workHours: allDayHours() });
  if (r.body?.id) made.employees.push(r.body.id);
  check('حسابات مؤقتة', !!made.therapist && r.status === 201, JSON.stringify(r.body).slice(0, 120));
  const recep = await login(RECEP.digits, PW);
  const anon = client();

  section('المرضى: إضافة وتعديل وحذف وصلاحيات');
  const add = (phone, last) => recep.from('patients').insert({ full_name: `مريض اختبار ${last}`, first_name: 'مريض', father_name: 'اختبار', family_name: last, phone, gender: 'male', nationality: 'saudi' }).select('id').single();
  const p1 = await add('+201200000942', 'العمليات');
  if (p1.data) made.patients.push(p1.data.id);
  check('إضافة مريض اتحفظت في القاعدة', !p1.error && !!(await one(`select id from patients where id = '${p1.data?.id}'`)), p1.error?.message);
  const up = await recep.from('patients').update({ notes: 'ملاحظة اختبار' }).eq('id', p1.data.id).select('notes').single();
  check('تعديل المريض اتحفظ', !up.error && (await one(`select notes from patients where id = '${p1.data.id}'`)).notes === 'ملاحظة اختبار', up.error?.message);
  const dupPhone = await add('+201200000942', 'مكرر');
  if (dupPhone.data) made.patients.push(dupPhone.data.id);
  // المنع في شاشة التسجيل بس: فيه أرقام مكررة حقيقية (أهل بيت واحد) فمفيش قيد على القاعدة
  console.log(`    [ملاحظة] رقم مكرر من غير الشاشة: ${dupPhone.error ? 'مرفوض' : 'مقبول من القاعدة'}`);
  const anonP = await anon.from('patients').insert({ full_name: 'زائر اختبار غريب', phone: '+201200000949' }).select('id');
  if (anonP.data?.[0]) made.patients.push(anonP.data[0].id);
  check('زائر بدون دخول مايقدرش يضيف مريض', !!anonP.error, 'accepted');
  const delR = await recep.rpc('delete_patient', { p_id: p1.data.id });
  check('الاستقبال مايقدرش يحذف مريض', !!delR.error, 'deleted');

  section('المواعيد: الحجز والحذف بقواعده');
  const [center] = await sql(`select week_schedule from center_info limit 1`);
  let day = null;
  for (let i = 1; i < 15 && !day; i++) { const d = cairoDate(i); const k = ['sun', 'mon', 'tue', 'wed', 'thu', 'fri', 'sat'][new Date(d + 'T00:00:00Z').getUTCDay()]; const s = (center.week_schedule ?? []).find((x) => x.day === k); if (s?.open) day = { date: d, from: s.from }; }
  const b = await recep.rpc('book_appointment', { p: { patientId: p1.data.id, type: 'session', serviceId: 'old_consult', therapistId: made.therapist, date: day.date, time: day.from, notes: 'اختبار' } });
  check('حجز موعد', !b.error, b.error?.message);
  const bad = await recep.rpc('book_appointment', { p: { patientId: p1.data.id, type: 'session', serviceId: 'old_consult', therapistId: made.therapist, date: day.date, time: '03:00', notes: '' } });
  check('حجز برّه مواعيد المركز مرفوض', !!bad.error, 'accepted');
  const noSvc = await recep.rpc('book_appointment', { p: { patientId: p1.data.id, type: 'session', serviceId: 'مش-موجودة', therapistId: made.therapist, date: day.date, time: day.from } });
  check('خدمة غير موجودة مرفوضة', !!noSvc.error, 'accepted');
  const delHas = await admin.rpc('delete_patient', { p_id: p1.data.id });
  check('مريض عنده مواعيد مايتحذفش حتى من المدير', !!delHas.error && !!(await one(`select id from patients where id = '${p1.data.id}'`)), 'deleted');
  const inv = await one(`select id, total from invoices where appointment_id = '${b.data.id}'`);
  check('الحجز عمل فاتورة مربوطة', !!inv, 'no invoice');
  if (Number(inv.total) > 0) {
    const pay = await admin.rpc('record_payment', { p_invoice: inv.id, p_amount: 1, p_method: 'cash', p_note: 'اختبار' });
    check('تسجيل دفعة اتحفظ', !pay.error && !!(await one(`select id from payments where invoice_id = '${inv.id}'`)), pay.error?.message);
    const delPaid = await admin.rpc('delete_appointment', { p_id: b.data.id });
    check('موعد فاتورته عليها مدفوعات مايتحذفش', !!delPaid.error, 'deleted');
    await sql(`delete from payments where invoice_id = '${inv.id}'`);
  }
  const delRec = await recep.rpc('delete_appointment', { p_id: b.data.id });
  check('حذف الموعد مقيّد بالصلاحية للاستقبال', !!delRec.error, 'deleted');
  const delOk = await admin.rpc('delete_appointment', { p_id: b.data.id });
  check('المدير حذف الموعد وفاتورته', !delOk.error && !(await one(`select id from appointments where id = '${b.data.id}'`)) && !(await one(`select id from invoices where id = '${inv.id}'`)), delOk.error?.message);
  const delP = await admin.rpc('delete_patient', { p_id: p1.data.id });
  check('مريض من غير سجلات اتحذف من المدير', !delP.error && !(await one(`select id from patients where id = '${p1.data.id}'`)), delP.error?.message);

  section('الخدمات والأسعار');
  const svcP = { name: 'خدمة اختبار العمليات', category: 'اختبار', description: '', price: 50, durationMin: 20, active: true, showOnSite: false };
  const denied = await recep.rpc('save_service', { p: svcP });
  check('الاستقبال مايقدرش يضيف خدمة', !!denied.error, 'accepted');
  const neg = await admin.rpc('save_service', { p: { ...svcP, price: -5 } });
  check('سعر سالب مرفوض', !!neg.error, 'accepted');
  const svc = await admin.rpc('save_service', { p: svcP });
  made.service = svc.data?.id ?? (await one(`select id from services where name = '${svcP.name}'`))?.id;
  check('إضافة خدمة اتحفظت', !svc.error && !!made.service, svc.error?.message);
  const svc2 = await admin.rpc('save_service', { p: { ...svcP, id: made.service, price: 75 } });
  check('تعديل السعر اتحفظ', !svc2.error && Number((await one(`select price from services where id = '${made.service}'`)).price) === 75, svc2.error?.message);
  const sp = await admin.from('service_prices').insert({ service_id: made.service, label: 'سعر اختبار', price: 60 }).select('id').single();
  check('سعر إضافي للخدمة اتحفظ', !sp.error, sp.error?.message);
  const delS = await admin.rpc('delete_service', { p_id: made.service });
  const gone = await one(`select id, deleted, active from services where id = '${made.service}'`);
  check('حذف الخدمة اتنفذ', !delS.error && (!gone || gone.deleted === true), delS.error?.message ?? JSON.stringify(gone));

  section('المصروفات');
  const exp = { category: 'اختبار', amount: 25, description: 'مصروف اختبار', expenseDate: cairoDate(0), paymentMethod: 'cash' };
  const expDenied = await recep.rpc('save_expense', { p: exp });
  check('الاستقبال مايقدرش يسجل مصروف', !!expDenied.error, 'accepted');
  const expZero = await admin.rpc('save_expense', { p: { ...exp, amount: 0 } });
  check('مصروف بقيمة صفر مرفوض', !!expZero.error, 'accepted');
  const e1 = await admin.rpc('save_expense', { p: exp });
  made.expense = e1.data?.id ?? (await one(`select id from expenses where description = 'مصروف اختبار'`))?.id;
  check('إضافة مصروف اتحفظت', !e1.error && !!made.expense, e1.error?.message);
  const e2 = await admin.rpc('save_expense', { p: { ...exp, id: made.expense, amount: 30 } });
  check('تعديل المصروف اتحفظ', !e2.error && Number((await one(`select amount from expenses where id = '${made.expense}'`)).amount) === 30, e2.error?.message);
  const e3 = await admin.rpc('delete_expense', { p_id: made.expense });
  check('حذف المصروف اتنفذ', !e3.error && !(await one(`select id from expenses where id = '${made.expense}'`)), e3.error?.message);
  if (!e3.error) made.expense = null;

  section('الحسابات والتقارير (قراءة من غير أي تعديل)');
  const today = cairoDate(0);
  for (const [fn, args] of [['acc_dashboard', {}], ['acc_integrity_check', {}], ['acc_treasury_overview', {}], ['acc_trial_balance', { p_from: `${today.slice(0, 4)}-01-01`, p_to: today }], ['acc_income_statement', { p_from: `${today.slice(0, 4)}-01-01`, p_to: today }], ['acc_balance_sheet', { p_asof: today }]]) {
    const ok = await admin.rpc(fn, args);
    check(`${fn}: بيرد من غير خطأ`, !ok.error, ok.error?.message);
    const no = await recep.rpc(fn, args);
    check(`${fn}: ممنوع على الاستقبال`, !!no.error, 'allowed');
  }
  const integ = await admin.rpc('acc_integrity_check');
  console.log('    [integrity]', JSON.stringify(integ.data).slice(0, 300));

  section('الصلاحيات والأمان');
  const rp = await recep.from('role_permissions').update({ ops: ['view', 'create', 'edit', 'delete'] }).eq('role', 'reception').select('role');
  check('الاستقبال مايقدرش يزوّد صلاحياته', !!rp.error || (rp.data ?? []).length === 0, 'updated');
  const selfUp = await recep.from('employees').update({ role: 'system_admin' }).eq('username', RECEP.digits).select('role');
  check('الموظف مايقدرش يرقّي نفسه لمدير', !!selfUp.error || (selfUp.data ?? []).length === 0, 'updated');
  const [{ role: stillRole }] = await sql(`select role from employees where username = '${RECEP.digits}'`);
  check('دور الموظف فضل زي ما هو', stillRole === 'reception', stillRole);
  for (const t of ['patients', 'invoices', 'payments', 'employees', 'ortho_consultations', 'appointments', 'expenses']) {
    const a = await anon.from(t).select('id').limit(1);
    check(`جدول ${t} مش مقروء من زائر`, (a.data ?? []).length === 0, 'readable');
  }
} catch (e) {
  check('الاختبار اكتمل من غير استثناء', false, e.message.split(String.fromCharCode(10))[0]);
} finally {
  section('تنظيف');
  try {
    if (made.expense) await sql(`delete from expenses where id = '${made.expense}'`);
    for (const id of made.patients) await sql(`delete from notifications where patient_id = '${id}'; delete from payments where patient_id = '${id}'; delete from invoices where patient_id = '${id}'; delete from appointments where patient_id = '${id}'; delete from patients where id = '${id}';`);
    if (made.service) await sql(`delete from service_prices where service_id = '${made.service}'; delete from therapist_services where service_id = '${made.service}'; delete from services where id = '${made.service}';`);
    for (const id of made.employees) { await sql(`delete from attendance where employee_id = '${id}';`); await deleteEmployee(id); }
    if (made.therapist) await sql(`delete from therapist_services where therapist_id = '${made.therapist}'; delete from therapists where id = '${made.therapist}';`);
  } catch (e) { check('التنظيف كمل', false, e.message); }
  const after = await totals();
  check('الأعداد رجعت زي ما كانت (مفيش بيانات اختبار متبقية ولا بيانات ضاعت)', JSON.stringify(before) === JSON.stringify(after), JSON.stringify({ before, after }));
  save('e2e-crud-gaps-results.json');
  process.exit(0);
}
