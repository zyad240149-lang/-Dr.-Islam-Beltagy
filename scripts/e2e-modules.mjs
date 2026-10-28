// اختبارات تكامل للأقسام: اكتمال بيانات المريض (مصر)، الباقات والتقسيط، المنتجات، الولاء، حضور الموظفين، الرواتب والتارجت.
// كل البيانات مؤقتة (أسماء فيها «اختبار») وبتتمسح في الآخر. الرواتب بتتختبر على شهر 2020-01 عشان ماتلمسش أي شهر حقيقي.
//   node scripts/e2e-modules.mjs
import { randomUUID } from 'node:crypto';
import { allDayHours, api, cairoDate, cairoToday, deleteEmployee, fakeEgyptianId, login, loginAdmin, randomPassword, sql, suite } from './_harness.mjs';

const { check, section, save } = suite();
const PW = randomPassword();
const PAY_PERIOD = '2020-01';
const STARTED = new Date().toISOString();
const STAFF = {
  recep: { phone: '01200000911', digits: '201200000911', name: 'استقبال اختبار وحدات', role: 'reception' },
  acc: { phone: '01200000912', digits: '201200000912', name: 'محاسب اختبار وحدات', role: 'accountant' },
  doc: { phone: '01200000913', digits: '201200000913', name: 'طبيب اختبار وحدات', role: 'therapist' },
};
const made = { employees: [], therapist: null, patients: [], packagePlans: [], product: null, codes: [], payroll: false };
const err = (r) => r.error?.message ?? '';
const rows = (r) => r.data ?? [];

try {
  // ============ التجهيز ============
  section('التجهيز');
  const admin = await loginAdmin();
  const th = await admin.rpc('save_therapist', { p: { name: 'د. اختبار وحدات', title: 'طبيب اختبار', phone: '+' + STAFF.doc.digits, serviceIds: ['sv_exam', 'sv_followup', 'sv_physio'], workHours: allDayHours(), onLeave: [], active: true, defaultDurationMin: 30 } });
  made.therapist = th.data?.id ?? th.data;
  check('ملف طبيب الاختبار', !th.error && made.therapist, err(th));
  for (const [k, s] of Object.entries(STAFF)) {
    const r = await api(admin, 'POST', 'staff', { name: s.name, phone: s.phone, country: 'EG', password: PW, role: s.role, therapistId: k === 'doc' ? made.therapist : undefined, workHours: allDayHours() });
    if (r.body?.id) { made.employees.push(r.body.id); s.id = r.body.id; }
    check(`حساب ${s.name}`, r.status === 201, JSON.stringify(r.body).slice(0, 120));
  }
  const recep = await login(STAFF.recep.digits, PW), acc = await login(STAFF.acc.digits, PW), doc = await login(STAFF.doc.digits, PW);
  const newPatient = async (name, extra) => {
    const [first, father, ...fam] = name.split(' ');
    const { data, error } = await recep.from('patients').insert({ full_name: name, first_name: first, father_name: father, family_name: fam.join(' '), phone: '+2012' + String(Math.floor(Math.random() * 1e8)).padStart(8, '0'), gender: 'male', nationality: 'saudi', referral_source: 'friend', file_no: '', ...extra }).select().single();
    if (error) throw new Error('patient insert: ' + error.message);
    made.patients.push(data.id);
    return data;
  };
  const P = await newPatient('مريض اختبار وحدات', { national_id: fakeEgyptianId() });

  // ============ 1) اكتمال بيانات المريض — الهوية المصرية ============
  section('اكتمال بيانات المريض (الرقم القومي المصري)');
  const P0 = await newPatient('مريض ناقص اختبار', {});
  const day = cairoDate(7);
  const b = await recep.rpc('book_appointment', { p: { patientId: P0.id, type: 'initial', serviceId: 'sv_exam', therapistId: made.therapist, date: day, time: '19:00', location: 'center' } });
  const ap0 = b.data?.id ?? b.data;
  check('حجز موعد (حالة جديد) لمريض بدون رقم قومي مسموح', !b.error && ap0, err(b));
  const c1 = await recep.rpc('set_appointment_status', { p_id: ap0, p_status: 'confirmed', p_reason: null, p_therapist: null });
  check('تأكيد الموعد مسموح من غير رقم قومي (بقى اختياري — هجرة 915)', !c1.error, err(c1));
  const u1 = await recep.from('patients').update({ national_id: '1234567890' }).eq('id', P0.id).select();
  check('رقم هوية بالشكل السعودي (10 أرقام) مرفوض من القاعدة', !!u1.error, err(u1) || 'saved!');
  const u2 = await recep.from('patients').update({ nationality: 'non_saudi', national_id: '12' }).eq('id', P0.id).select();
  check('رقم جواز سفر قصير مرفوض', !!u2.error, err(u2) || 'saved!');
  await recep.from('patients').update({ national_id: fakeEgyptianId() }).eq('id', P0.id);
  const c3 = await recep.rpc('set_appointment_status', { p_id: ap0, p_status: 'confirmed', p_reason: null, p_therapist: null });
  check('رقم قومي مصري (14 رقم) → التأكيد ينجح', !c3.error, err(c3));
  const PF = await newPatient('مريض أجنبي اختبار', { nationality: 'non_saudi', national_id: 'A1234567' });
  const gaps = await recep.rpc('list_patients', { p_q: 'أجنبي اختبار', p_gender: '', p_source: '', p_active: '', p_doctor: null, p_sort: 'registered_desc', p_limit: 5, p_offset: 0, p_gaps: 'id' });
  check('الأجنبي برقم جواز سفر يعتبر ملفه مكتمل', !gaps.error && !rows(gaps).rows?.some((r) => r.id === PF.id), err(gaps));

  // ============ 2) الباقات والحضور ============
  section('الباقات وحضور الجلسات');
  const pp = await admin.from('package_plans').insert({ name: 'باقة اختبار تأهيل 3 جلسات', service_ids: ['sv_physio'], total_sessions: 3, price: 900, valid_days: 30, active: true }).select().single();
  if (pp.data) made.packagePlans.push(pp.data.id);
  check('إضافة باقة للكتالوج (المدير)', !pp.error, err(pp));
  const sR = await recep.rpc('sell_package', { p_patient: P.id, p_package_plan: pp.data?.id });
  check('الاستقبال ما يقدرش يبيع باقة (عرض فقط)', !!sR.error, err(sR) || 'sold!');
  const sold = await acc.rpc('sell_package', { p_patient: P.id, p_package_plan: pp.data?.id });
  const pkgId = sold.data?.id;
  check('المحاسب يبيع الباقة', !sold.error && pkgId, err(sold));
  const { data: pkg } = await admin.from('packages').select('status, total_sessions, price').eq('id', pkgId).single();
  check('الباقة فعّالة بعدد جلسات وسعر الكتالوج', pkg?.status === 'active' && pkg.total_sessions === 3 && Number(pkg.price) === 900, JSON.stringify(pkg));
  const { data: pinv } = await admin.from('invoices').select('id, total, status').eq('package_id', pkgId).single();
  check('فاتورة الباقة اتعملت بقيمتها', Number(pinv?.total) === 900 && pinv?.status === 'due', JSON.stringify(pinv));
  const [ls1] = await sql(`select count(*)::int n from loyalty_ledger where patient_id = '${P.id}'`);
  check('شراء الباقة ما بيضيفش نقاط ولاء (النقاط اتشالت — 920)', ls1.n === 0, JSON.stringify(ls1));
  const ci = await recep.rpc('attendance_check_in', { p_source: 'package', p_id: pkgId, p_appointment: null, p_therapist: made.therapist, p_second: false });
  check('تسجيل حضور جلسة من الباقة (زيارة مباشرة)', !ci.error && ci.data?.sessionNo === 1 && ci.data?.remaining === 2, JSON.stringify(ci.data ?? err(ci)));
  const ci2 = await recep.rpc('attendance_check_in', { p_source: 'package', p_id: pkgId, p_appointment: null, p_therapist: made.therapist, p_second: false });
  check('جلسة ثانية في نفس اليوم مرفوضة بدون موافقة المدير', /حضر جلسة اليوم|موافقة المدير/.test(err(ci2)), err(ci2) || 'accepted!');
  const pal = await recep.rpc('package_attendance_list', { p_q: 'مريض اختبار وحدات' });
  const prow = rows(pal).find?.((r) => r.packageId === pkgId);
  check('قائمة حضور الباقات بتعرض المتبقي صح', prow && prow.remaining === 2 && prow.total === 3, JSON.stringify(prow ?? err(pal)).slice(0, 150));
  const pay = await acc.rpc('record_payment', { p_invoice: pinv?.id, p_amount: 300, p_method: 'cash', p_note: 'اختبار' });
  check('دفعة جزئية على فاتورة الباقة', !pay.error, err(pay));
  const cR = await recep.rpc('cancel_package', { p_id: pkgId });
  check('الاستقبال ما يقدرش يلغي باقة', !!cR.error, err(cR) || 'cancelled!');
  const cA = await admin.rpc('cancel_package', { p_id: pkgId });
  check('المدير يلغي الباقة', !cA.error, err(cA));
  const { data: pinv2 } = await admin.from('invoices').select('status, paid').eq('id', pinv?.id).single();
  check('فاتورة عليها مدفوعات مابتتلغيش مع الباقة', pinv2?.status !== 'cancelled' && Number(pinv2?.paid) === 300, JSON.stringify(pinv2));
  const [ls2] = await sql(`select count(*)::int n from loyalty_ledger where patient_id = '${P.id}'`);
  check('إلغاء الباقة ما بيسجّلش حركات نقاط', ls2.n === 0, JSON.stringify(ls2));
  const ci3 = await recep.rpc('attendance_check_in', { p_source: 'package', p_id: pkgId, p_appointment: null, p_therapist: made.therapist, p_second: false });
  check('حضور على باقة ملغاة مرفوض', !!ci3.error, err(ci3) || 'accepted!');

  section('تقسيط الباقات (4 جلسات)');
  const pp4 = await admin.from('package_plans').insert({ kind: 'pkg4', name: 'باقة اختبار 4 جلسات', service_ids: ['sv_physio'], total_sessions: 4, price: 1200, valid_days: 60, active: true }).select().single();
  if (pp4.data) made.packagePlans.push(pp4.data.id);
  const s4 = await acc.rpc('sell_package', { p_patient: PF.id, p_package_plan: pp4.data?.id });
  const { data: pk4 } = await admin.from('packages').select('status').eq('id', s4.data?.id).single();
  check('باقة الـ4 جلسات بتبدأ «بانتظار الدفع»', !s4.error && pk4?.status === 'pending_payment', err(s4) || pk4?.status);
  const inv4 = s4.data?.invoiceId;
  const rq = await recep.rpc('request_package_installment', { p_invoice: inv4, p_reason: 'اختبار', p_first_due: null, p_second_due: null });
  check('الاستقبال يطلب الدفع على دفعتين', !rq.error && rq.data, err(rq));
  const dR = await recep.rpc('decide_package_installment', { p_id: rq.data, p_approve: true, p_reason: null });
  check('الاستقبال ما يقدرش يوافق على التقسيط', !!dR.error, err(dR) || 'approved!');
  const dA = await admin.rpc('decide_package_installment', { p_id: rq.data, p_approve: true, p_reason: null });
  check('المدير يوافق على التقسيط', !dA.error, err(dA));
  const { data: req } = await admin.from('package_installment_requests').select('status, first_amount, second_amount').eq('id', rq.data).single();
  check('القسطين نص الإجمالي', req?.status === 'approved' && Number(req.first_amount) === 600 && Number(req.second_amount) === 600, JSON.stringify(req));
  const rq2 = await recep.rpc('request_package_installment', { p_invoice: inv4, p_reason: null, p_first_due: null, p_second_due: null });
  check('طلب تقسيط تاني لنفس الفاتورة مرفوض', !!rq2.error, err(rq2) || 'accepted!');

  // ============ 3) المنتجات ============
  section('بيع المنتجات والمخزون');
  const sku = 'TST-' + Math.random().toString(36).slice(2, 8).toUpperCase();
  const prod = await admin.rpc('product_save', { p: { sku, name: 'منتج اختبار', price: 150, quantity: 3, category: 'دعامات', active: true } });
  made.product = prod.data;
  check('إضافة منتج بكمية افتتاحية', !prod.error && prod.data, err(prod));
  const dup = await admin.rpc('product_save', { p: { sku, name: 'مكرر', price: 10, quantity: 1 } });
  check('كود منتج (SKU) مكرر مرفوض', !!dup.error, err(dup) || 'accepted!');
  const neg = await admin.rpc('product_save', { p: { sku: sku + 'X', name: 'سالب', price: -5 } });
  check('سعر سالب مرفوض', !!neg.error, err(neg) || 'accepted!');
  const sell = (c, qty, key, extra = {}) => c.rpc('sell_product', { p_product: made.product, p_qty: qty, p_discount: 0, p_patient: null, p_customer_name: 'عميل اختبار', p_payment_method: 'cash', p_idempotency_key: key, p_nationality: null, p_national_id: null, p_tax_rate: null, ...extra });
  const sD = await sell(doc, 1, null);
  check('الطبيب ما يقدرش يبيع منتجات', !!sD.error, err(sD) || 'sold!');
  const key1 = randomUUID();
  const s1 = await sell(recep, 2, key1);
  check('الاستقبال يبيع 2 لعميل بدون جنسية (مصري افتراضي)', !s1.error && s1.data?.remaining === 1, err(s1) || JSON.stringify(s1.data));
  const { data: sale1 } = await admin.from('product_sales').select('total, tax_amount, status').eq('id', s1.data?.id).single();
  check('إجمالي البيع 300 بدون ضريبة', Number(sale1?.total) === 300 && Number(sale1?.tax_amount) === 0, JSON.stringify(sale1));
  const s1b = await sell(recep, 2, key1);
  const { data: q1 } = await admin.from('products').select('quantity').eq('id', made.product).single();
  check('تكرار نفس العملية (نفس المفتاح) مابيخصمش مرتين', s1b.data?.duplicate === true && q1?.quantity === 1, JSON.stringify(s1b.data ?? err(s1b)) + ` qty=${q1?.quantity}`);
  const s2 = await sell(recep, 2, null);
  check('بيع كمية أكبر من المتاح مرفوض', !!s2.error, err(s2) || 'sold!');
  const [r1, r2] = await Promise.all([sell(recep, 1, randomUUID()), sell(acc, 1, randomUUID())]);
  check('بيعتين متزامنتين لآخر قطعة: واحدة بس تنجح', [r1, r2].filter((x) => !x.error).length === 1, `${err(r1) || 'ok'} | ${err(r2) || 'ok'}`);
  const { data: q2 } = await admin.from('products').select('quantity').eq('id', made.product).single();
  check('المخزون صفر بعد البيع', q2?.quantity === 0, q2?.quantity);
  const xR = await recep.rpc('cancel_product_sale', { p_id: s1.data?.id, p_reason: 'اختبار' });
  check('الاستقبال ما يقدرش يلغي بيع', !!xR.error, err(xR) || 'cancelled!');
  const xA = await admin.rpc('cancel_product_sale', { p_id: s1.data?.id, p_reason: 'اختبار' });
  const { data: q3 } = await admin.from('products').select('quantity').eq('id', made.product).single();
  check('المدير يلغي البيع والكمية ترجع للمخزون', !xA.error && q3?.quantity === 2, err(xA) || `qty=${q3?.quantity}`);
  const xA2 = await admin.rpc('cancel_product_sale', { p_id: s1.data?.id, p_reason: 'اختبار' });
  check('إلغاء نفس البيع مرتين مرفوض', !!xA2.error, err(xA2) || 'accepted!');
  const del = await admin.rpc('product_delete', { p_id: made.product });
  check('حذف منتج له مبيعات = تعطيله بس', del.data === 'disabled', del.data ?? err(del));

  // ============ 4) نقاط الولاء ============
  section('نقاط الولاء — اتشالت (920)');
  await sql(`select award_loyalty_points('${P.id}', 'adjust', 40, 'رصيد اختبار', null, null)`);
  const [lp] = await sql(`select count(*)::int n from loyalty_ledger where patient_id = '${P.id}'`);
  check('كسب النقاط متوقف من الخادم (award_loyalty_points ما بتعملش حاجة)', lp.n === 0, JSON.stringify(lp));
  const lR = await recep.rpc('redeem_loyalty_points', { p_patient: P.id, p_sessions: 1, p_idempotency_key: randomUUID() });
  check('استبدال النقاط بطلب مباشر مرفوض', !!lR.error, err(lR) || 'redeemed!');
  const lS = await recep.rpc('patient_loyalty_summary', { p_patient: P.id });
  check('ملخص النقاط بطلب مباشر مرفوض', !!lS.error, err(lS) || 'returned!');
  const lA = await admin.rpc('update_loyalty_settings', { p: { sessionPoints: 5 } });
  check('حتى المدير ما يقدرش يرجّع إعدادات النقاط بطلب مباشر', !!lA.error, err(lA) || 'updated!');

  // ============ 5) حضور وانصراف الموظفين ============
  section('حضور وانصراف الموظفين');
  const t0 = await recep.rpc('my_attendance_today');
  check('مفيش حضور مسجّل في البداية', !t0.error && t0.data === null, JSON.stringify(t0.data ?? err(t0)));
  const o0 = await recep.rpc('clock_out');
  check('انصراف قبل الحضور مرفوض', /سجّل الحضور أولًا/.test(err(o0)), err(o0) || 'accepted!');
  const i1 = await recep.rpc('clock_in');
  check('تسجيل الحضور', !i1.error && i1.data?.checkIn, err(i1));
  const i2 = await recep.rpc('clock_in');
  check('تسجيل الحضور مرتين بيحتفظ بأول وقت', i2.data?.checkIn === i1.data?.checkIn, `${i1.data?.checkIn} vs ${i2.data?.checkIn}`);
  const o1 = await recep.rpc('clock_out');
  check('تسجيل الانصراف', !o1.error && o1.data?.checkOut, err(o1));
  const o2 = await recep.rpc('clock_out');
  check('الانصراف مرتين مرفوض', /مسبقًا/.test(err(o2)), err(o2) || 'accepted!');
  const today = cairoToday();
  const repR = await recep.rpc('attendance_report', { p_from: today, p_to: today });
  check('الاستقبال ما يشوفش تقرير حضور الكل', !!repR.error, err(repR) || 'visible!');
  const repA = await admin.rpc('attendance_report', { p_from: today, p_to: today });
  const myRow = rows(repA).find?.((r) => r.employee_id === STAFF.recep.id);
  check('المدير يشوف حضور الموظف في التقرير', myRow && myRow.check_in && myRow.check_out, err(repA) || JSON.stringify(myRow));

  // ============ 6) الرواتب والتارجت (شهر 2020-01 للاختبار فقط) ============
  section(`الرواتب والتارجت (شهر ${PAY_PERIOD} للاختبار)`);
  const [busy] = await sql(`select (select count(*) from payroll_periods where period = '${PAY_PERIOD}')::int as periods,
    (select count(*) from comp_plans where effective_from <= '${PAY_PERIOD}')::int as plans`);
  if (busy.periods || busy.plans) {
    check(`شهر ${PAY_PERIOD} فاضي قبل الاختبار (أمان)`, false, `فيه بيانات حقيقية: ${JSON.stringify(busy)} — اتلغى قسم الرواتب`);
  } else {
    made.payroll = true;
    const base = { type: 'therapist', id: made.therapist, effectiveFrom: PAY_PERIOD, baseSalary: 3000, target: 1000, bonusMethod: 'pct_revenue', bonusRate: 10, bonusCondition: 'reach', paySystem: 'base_commission' };
    const pr = await recep.rpc('payroll_save_plan', { p: base });
    check('الاستقبال ما يقدرش يحدد رواتب', !!pr.error, err(pr) || 'saved!');
    const pBad = await admin.rpc('payroll_save_plan', { p: { ...base, bonusRate: 150 } });
    check('نسبة عمولة أكبر من 100% مرفوضة', !!pBad.error, err(pBad) || 'saved!');
    const pT = await admin.rpc('payroll_save_plan', { p: base });
    check('المدير يحدد راتب + عمولة 10% للطبيب', !pT.error, err(pT));
    const pE = await admin.rpc('payroll_save_plan', { p: { type: 'employee', id: STAFF.recep.id, effectiveFrom: PAY_PERIOD, baseSalary: 2500 } });
    check('المدير يحدد راتب ثابت للاستقبال', !pE.error, err(pE));
    const pW = await admin.rpc('payroll_save_plan', { p: { type: 'employee', id: STAFF.doc.id, effectiveFrom: PAY_PERIOD, baseSalary: 1000 } });
    check('راتب ثابت لحساب طبيب كموظف إداري مرفوض', !!pW.error, err(pW) || 'saved!');
    // زيارة مكتملة ومدفوعة في شهر الاختبار (تجهيز مباشر — الحجز الطبيعي مايقبلش تاريخ قديم)
    const apId = randomUUID(), invId = randomUUID();
    await sql(`set session_replication_role = replica;
      insert into appointments (id, no, patient_id, type, service_id, therapist_id, location, address, date, time, duration_min, status, price, notes, source)
        values ('${apId}', 'TST-PAY-${apId.slice(0, 6)}', '${P.id}', 'initial', 'sv_exam', '${made.therapist}', 'center', '', '${PAY_PERIOD}-15', '17:00', 30, 'completed', 1200, 'اختبار رواتب', 'staff');
      insert into invoices (id, no, patient_id, appointment_id, service_name, price, discount, total, paid, remaining, status, date)
        values ('${invId}', 'TST-INV-${invId.slice(0, 6)}', '${P.id}', '${apId}', 'كشف عظام', 1200, 0, 1200, 1200, 0, 'paid', '${PAY_PERIOD}-15');
      set session_replication_role = origin;`);
    // «تارجتي» اتشالت (هجرة 908): ولا الطبيب ولا الاستقبال يقدروا يطلبوها
    const mt = await doc.rpc('my_target', { p_period: PAY_PERIOD });
    check('«تارجتي» مش متاحة للطبيب', !!mt.error, 'visible!');
    const mtR = await recep.rpc('my_target', { p_period: PAY_PERIOD });
    check('«تارجتي» مش متاحة للاستقبال', !!mtR.error, 'visible!');
    const ap = await admin.rpc('payroll_approve_period', { p_period: PAY_PERIOD, p_note: 'اختبار' });
    check('اعتماد الشهر بيثبّت مستحقين (الطبيب والاستقبال)', !ap.error && ap.data?.added === 2, err(ap) || JSON.stringify(ap.data));
    const ov = await admin.rpc('payroll_overview', { p_period: PAY_PERIOD });
    const tRow = ov.data?.rows?.find((r) => r.id === made.therapist), eRow = ov.data?.rows?.find((r) => r.id === STAFF.recep.id);
    check('مستحق الطبيب: راتب 3000 + عمولة 120', Number(tRow?.due?.salaryDue) === 3000 && Number(tRow?.due?.bonusDue) === 120, JSON.stringify(tRow?.due ?? err(ov)).slice(0, 150));
    check('مستحق الاستقبال: راتب 2500', Number(eRow?.due?.salaryDue) === 2500, JSON.stringify(eRow?.due).slice(0, 100));
    const payKey = randomUUID();
    const pay1 = await admin.rpc('payroll_pay', { p: { dueId: tRow?.dueId, kind: 'salary', amount: 3000, method: 'cash', paidOn: `${PAY_PERIOD}-31`, clientKey: payKey } });
    check('صرف راتب الطبيب', !pay1.error && pay1.data?.remaining === 0, err(pay1) || JSON.stringify(pay1.data));
    const pay1b = await admin.rpc('payroll_pay', { p: { dueId: tRow?.dueId, kind: 'salary', amount: 3000, method: 'cash', paidOn: `${PAY_PERIOD}-31`, clientKey: payKey } });
    check('تكرار نفس الصرف (نفس المفتاح) مابيتسجّلش مرتين', pay1b.data?.duplicate === true, JSON.stringify(pay1b.data ?? err(pay1b)));
    const pOver = await admin.rpc('payroll_pay', { p: { dueId: tRow?.dueId, kind: 'salary', amount: 1, method: 'cash', paidOn: `${PAY_PERIOD}-31` } });
    check('صرف أكتر من المستحق مرفوض', !!pOver.error, err(pOver) || 'paid!');
    const pFut = await admin.rpc('payroll_pay', { p: { dueId: eRow?.dueId, kind: 'salary', amount: 100, method: 'cash', paidOn: cairoDate(30) } });
    check('صرف بتاريخ في المستقبل مرفوض', !!pFut.error, err(pFut) || 'paid!');
    const pB = await admin.rpc('payroll_pay', { p: { dueId: tRow?.dueId, kind: 'bonus', amount: 120, method: 'transfer', paidOn: `${PAY_PERIOD}-31` } });
    check('صرف العمولة', !pB.error, err(pB));
    const re = await admin.rpc('payroll_reopen_period', { p_period: PAY_PERIOD, p_reason: 'اختبار' });
    check('إلغاء اعتماد شهر عليه صرف مرفوض', !!re.error, err(re) || 'reopened!');
    const fm = await admin.rpc('finance_month', { p_period: PAY_PERIOD });
    check('المالية: رواتب 3000 + عمولات 120 + فواتير 1200', Number(fm.data?.totals?.salaries) === 3000 && Number(fm.data?.totals?.bonuses) === 120 && Number(fm.data?.totals?.invoiced) === 1200, JSON.stringify(fm.data?.totals ?? err(fm)));
    const fmR = await recep.rpc('finance_month', { p_period: PAY_PERIOD });
    check('الاستقبال ما يشوفش المالية', !!fmR.error, err(fmR) || 'visible!');
    const cl = await admin.rpc('payroll_close_period', { p_period: PAY_PERIOD, p_note: 'اختبار' });
    check('إغلاق الشهر', !cl.error, err(cl));
    const v1 = await admin.rpc('payroll_void_payout', { p_id: pay1.data?.id, p_reason: 'اختبار إلغاء' });
    const v2 = await admin.rpc('payroll_void_payout', { p_id: pay1.data?.id, p_reason: 'اختبار إلغاء' });
    check('إلغاء صرف مرة واحدة بس', !v1.error && !!v2.error, `${err(v1) || 'ok'} | ${err(v2) || 'ok'}`);
    const fm2 = await admin.rpc('finance_month', { p_period: PAY_PERIOD });
    check('الصرف الملغي مابيتحسبش في الرواتب', Number(fm2.data?.totals?.salaries) === 0, JSON.stringify(fm2.data?.totals));
  }
} catch (e) {
  check('تنفيذ الاختبارات بدون أخطاء غير متوقعة', false, e.message);
} finally {
  section('تنظيف بيانات الاختبار');
  try {
    if (made.payroll) await sql(`
      delete from payroll_payouts where due_id in (select id from payroll_dues where period = '${PAY_PERIOD}');
      delete from payroll_dues where period = '${PAY_PERIOD}';
      delete from payroll_periods where period = '${PAY_PERIOD}';
      delete from payroll_audit where period = '${PAY_PERIOD}';`);
    if (made.product) await sql(`delete from product_sales where product_id = '${made.product}'; delete from products where id = '${made.product}';`);
    const pats = made.patients.map((id) => `'${id}'`).join(',');
    if (pats) await sql(`delete from loyalty_redemptions where patient_id in (${pats});
      delete from discount_codes where patient_id in (${pats})${made.codes.length ? ` or code in (${made.codes.map((c) => `'${c}'`).join(',')})` : ''};
      delete from activity_log where patient_id in (${pats}); delete from patients where id in (${pats});`);
    if (made.packagePlans.length) await sql(`delete from package_plans where id in (${made.packagePlans.map((id) => `'${id}'`).join(',')});`);
    const emps = made.employees.map((id) => `'${id}'`).join(',');
    if (emps) await sql(`delete from activity_log where employee_id in (${emps});`);
    for (const id of made.employees) await deleteEmployee(id);
    if (made.therapist) await sql(`delete from therapist_services where therapist_id = '${made.therapist}'; delete from therapists where id = '${made.therapist}';`);
    await sql(`delete from activity_log where action like '%اختبار%';
      delete from notifications where body like '%اختبار%' or title like '%اختبار%';
      delete from audit_logs where at >= '${STARTED}' and (coalesce(new_data, old_data)::text like '%اختبار%' or table_name in ('packages', 'payments', 'invoices', 'appointments', 'patients'));`);
    const [left] = await sql(`select (select count(*) from patients where full_name like '%اختبار%')::int p, (select count(*) from employees where name like '%اختبار%')::int e,
      (select count(*) from products where name like '%اختبار%')::int pr, (select count(*) from payroll_dues where period = '${PAY_PERIOD}')::int d`);
    console.log('  متبقي من بيانات الاختبار:', JSON.stringify(left));
  } catch (e) { console.log('  تنظيف ناقص:', e.message); }
  save('e2e-modules-results.json');
}
