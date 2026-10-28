// اختبارات تكامل لباقي الأقسام: تضارب المواعيد (الدكتور والمريض)، أيام الإغلاق وإجازة الدكتور، الخدمات، الخطط العلاجية،
// أكواد الخصم، الإشعارات للمرضى، الدعم الفني، طلبات الموظفين، الأشعة والكسور والعمليات، التقارير، وبوابة المريض (سجلي الطبي + الحجز والتعديل والإلغاء).
// كل البيانات مؤقتة (أسماء فيها «اختبار») وبتتمسح في الآخر. أيام الإغلاق والإجازة بتتحط بعد أكتر من سنة عشان ماتأثرش على حجوزات حقيقية.
//   node scripts/e2e-sections.mjs
import { allDayHours, api, cairoDate, cairoToday, deleteEmployee, env, fakeEgyptianId, login, loginAdmin, randomPassword, sql, suite, URL_ } from './_harness.mjs';

const { check, section, save } = suite();
const PW = randomPassword();
const STARTED = new Date().toISOString();
const STAFF = {
  recep: { phone: '01200000951', digits: '201200000951', name: 'استقبال اختبار أقسام', role: 'reception' },
  doc: { phone: '01200000952', digits: '201200000952', name: 'طبيب اختبار أقسام', role: 'therapist' },
};
const PORTAL = { phone: '01200000953', digits: '201200000953', name: 'مريض سجل اختبار' };
const ALL_SERVICES = ['sv_exam', 'sv_followup', 'sv_physio', 'sv_cast', 'sv_dressing'];
const made = { employees: [], therapists: [], patients: [], services: [], codes: [], holidays: [], requests: [], tickets: [], campaigns: [] };
const err = (r) => r.error?.message ?? '';
const idOf = (r) => r.data?.id ?? r.data;

try {
  // ============ التجهيز ============
  section('التجهيز');
  const admin = await loginAdmin();
  const newDoctor = async (name) => {
    const r = await admin.rpc('save_therapist', { p: { name, title: 'طبيب اختبار', phone: '', serviceIds: ALL_SERVICES, workHours: allDayHours(), onLeave: [], active: true, defaultDurationMin: 30 } });
    if (r.error) throw new Error('save_therapist: ' + r.error.message);
    made.therapists.push(idOf(r));
    return idOf(r);
  };
  const D1 = await newDoctor('د. اختبار أقسام أول'), D2 = await newDoctor('د. اختبار أقسام تاني');
  check('دكتورين للاختبار', D1 && D2);
  for (const [k, s] of Object.entries(STAFF)) {
    const r = await api(admin, 'POST', 'staff', { name: s.name, phone: s.phone, country: 'EG', password: PW, role: s.role, therapistId: k === 'doc' ? D1 : undefined, workHours: allDayHours() });
    if (r.body?.id) { made.employees.push(r.body.id); s.id = r.body.id; }
    check(`حساب ${s.name}`, r.status === 201, JSON.stringify(r.body).slice(0, 120));
  }
  const recep = await login(STAFF.recep.digits, PW), doc = await login(STAFF.doc.digits, PW);
  const newPatient = async (name, extra = {}) => {
    const [first, father, ...fam] = name.split(' ');
    const { data, error } = await recep.from('patients').insert({ full_name: name, first_name: first, father_name: father, family_name: fam.join(' '), phone: '+2012' + String(Math.floor(Math.random() * 1e8)).padStart(8, '0'), gender: 'male', nationality: 'saudi', national_id: fakeEgyptianId(), referral_source: 'friend', file_no: '', ...extra }).select().single();
    if (error) throw new Error('patient insert: ' + error.message);
    made.patients.push(data.id);
    return data;
  };
  const P = await newPatient('مريض تضارب اختبار'), Q = await newPatient('مريض تاني اختبار');
  const book = (c, p) => c.rpc('book_appointment', { p: { type: 'initial', location: 'center', serviceId: 'sv_exam', ...p } });

  // ============ 1) تضارب المواعيد ============
  section('تضارب المواعيد — الدكتور والمريض');
  const d = cairoDate(8);
  const a1 = await book(recep, { patientId: P.id, therapistId: D1, date: d, time: '17:00' });
  check('حجز المريض مع الدكتور الأول 17:00 (كشف 30 دقيقة)', !a1.error, err(a1));
  const a2 = await book(recep, { patientId: P.id, therapistId: D2, date: d, time: '17:00' });
  check('نفس المريض مع دكتور تاني في نفس الوقت مرفوض', /المريض عنده موعد تاني/.test(err(a2)), err(a2) || 'accepted!');
  const a3 = await book(recep, { patientId: P.id, therapistId: D2, date: d, time: '17:15' });
  check('نفس المريض في وقت متداخل (17:15 جوّه الكشف) مرفوض', /المريض عنده موعد تاني/.test(err(a3)), err(a3) || 'accepted!');
  const a4 = await book(recep, { patientId: P.id, therapistId: D2, date: d, time: '17:30' });
  check('نفس المريض بعد ما الكشف يخلص (17:30) مسموح', !a4.error, err(a4));
  const a5 = await book(recep, { patientId: Q.id, therapistId: D1, date: d, time: '17:10' });
  check('مريض تاني مع نفس الدكتور في وقت متداخل مرفوض', /تم حجزه/.test(err(a5)), err(a5) || 'accepted!');
  const rs = await recep.rpc('reschedule_appointment', { p_id: idOf(a4), p_date: d, p_time: '17:00', p_therapist: null, p_address: null });
  check('إعادة جدولة لوقت المريض مشغول فيه مرفوضة', /المريض عنده موعد تاني/.test(err(rs)), err(rs) || 'accepted!');
  const ud = await recep.rpc('update_appointment_details', { p_id: idOf(a4), p: { time: '17:20' } });
  check('تعديل وقت الموعد لوقت متداخل للمريض مرفوض', /المريض عنده موعد تاني/.test(err(ud)), err(ud) || 'accepted!');
  const [c1, c2] = await Promise.all([book(recep, { patientId: P.id, therapistId: D1, date: d, time: '19:00' }), book(admin, { patientId: P.id, therapistId: D2, date: d, time: '19:00' })]);
  check('حجزين متزامنين لنفس المريض مع دكتورين: واحد بس ينجح', [c1, c2].filter((x) => !x.error).length === 1, `${err(c1) || 'ok'} | ${err(c2) || 'ok'}`);
  const cx = await recep.rpc('set_appointment_status', { p_id: idOf(a1), p_status: 'cancelled', p_reason: 'اختبار', p_therapist: null });
  const a6 = await book(recep, { patientId: P.id, therapistId: D2, date: d, time: '17:00', serviceId: 'sv_followup' });
  check('بعد إلغاء الموعد وقته بيرجع متاح للمريض', !cx.error && !a6.error, err(cx) || err(a6));
  const off = await recep.rpc('book_appointment', { p: { patientId: Q.id, type: 'initial', serviceId: 'sv_exam', therapistId: D2, date: d, time: '23:30', location: 'center' } });
  check('حجز خارج ساعات العمل مرفوض', !!off.error, err(off) || 'accepted!');
  const today = cairoToday();
  if (new Date(today + 'T12:00:00Z').getUTCDay() !== 5) {
    const n1 = await book(recep, { patientId: Q.id, therapistId: D1, date: today, time: '16:00', serviceId: 'sv_followup' });
    const ns = await recep.rpc('set_appointment_status', { p_id: idOf(n1), p_status: 'no_show', p_reason: null, p_therapist: null });
    const n2 = await book(recep, { patientId: Q.id, therapistId: D2, date: today, time: '16:00', serviceId: 'sv_followup' });
    check('موعد «لم يحضر» مابيحجزش وقت المريض', !n1.error && !ns.error && !n2.error, err(n1) || err(ns) || err(n2));
    const back = await recep.rpc('set_appointment_status', { p_id: idOf(n1), p_status: 'confirmed', p_reason: null, p_therapist: null });
    check('رجوع «لم يحضر» لمؤكد والمريض محجوز في نفس الوقت مرفوض', /المريض عنده موعد تاني/.test(err(back)), err(back) || 'accepted!');
  }

  // ============ 2) أيام الإغلاق وإجازة الدكتور ============
  section('أيام إغلاق العيادة وإجازة الدكتور');
  const hd = cairoDate(400);
  const hol = await admin.rpc('save_holiday', { p: { date: hd, reason: 'عيد اختبار' } });
  if (idOf(hol)) made.holidays.push(idOf(hol));
  check('المدير يقفل يوم (عيد)', !hol.error, err(hol));
  const holR = await recep.rpc('save_holiday', { p: { date: cairoDate(401), reason: 'اختبار' } });
  if (idOf(holR)) made.holidays.push(idOf(holR));
  check('الاستقبال ما يقدرش يقفل أيام', !!holR.error, err(holR) || 'saved!');
  const hb = await book(recep, { patientId: Q.id, therapistId: D1, date: hd, time: '18:00' });
  check('الحجز في يوم الإغلاق مرفوض', /مغلق/.test(err(hb)), err(hb) || 'accepted!');
  const hs = await recep.rpc('doctor_day_slots', { p_therapist: D1, p_service: 'sv_exam', p_date: hd });
  check('أوقات يوم الإغلاق: حالة holiday ومفيش أوقات', hs.data?.status === 'holiday' && hs.data.slots.length === 0, JSON.stringify(hs.data ?? err(hs)).slice(0, 100));
  const { data: holList } = await recep.from('holidays').select('date').eq('date', hd);
  check('الاستقبال يشوف أيام الإغلاق (للعرض)', (holList ?? []).length === 1, JSON.stringify(holList));
  const hdel = await admin.rpc('delete_holiday', { p_id: idOf(hol) });
  const hb2 = await book(recep, { patientId: Q.id, therapistId: D1, date: hd, time: '18:00' });
  check('بعد فتح اليوم الحجز بيرجع يشتغل', !hdel.error && !hb2.error, err(hdel) || err(hb2));
  const ld = cairoDate(402);
  const rq = await admin.rpc('create_staff_request', { p: { type: 'leave', employeeId: STAFF.doc.id, fromDate: ld, toDate: ld, reason: 'إجازة اختبار' } });
  if (idOf(rq)) made.requests.push(idOf(rq));
  const recDecide = await recep.rpc('decide_staff_request', { p_id: idOf(rq), p: { approve: true } });
  check('الاستقبال ما يوافقش على طلب إجازة', !!recDecide.error, err(recDecide) || 'approved!');
  const dec = await admin.rpc('decide_staff_request', { p_id: idOf(rq), p: { approve: true, note: 'اختبار' } });
  check('المدير يوافق على إجازة الدكتور', !rq.error && !dec.error, err(rq) || err(dec));
  const lb = await book(recep, { patientId: Q.id, therapistId: D1, date: ld, time: '18:00' });
  check('الحجز مع الدكتور في يوم إجازته مرفوض', /إجازة/.test(err(lb)), err(lb) || 'accepted!');
  const lb2 = await book(recep, { patientId: Q.id, therapistId: D2, date: ld, time: '18:00' });
  check('دكتور تاني في نفس اليوم متاح', !lb2.error, err(lb2));
  const dec2 = await admin.rpc('decide_staff_request', { p_id: idOf(rq), p: { approve: false } });
  check('طلب اتبت فيه مايتبتش فيه تاني', !!dec2.error, err(dec2) || 'decided twice!');

  // ============ 3) الخدمات ============
  section('الخدمات');
  const sv = await admin.rpc('save_service', { p: { name: 'خدمة اختبار أقسام', category: 'اختبار', description: '', price: 250, durationMin: 20, active: true, showOnSite: false, therapistIds: [D1] } });
  if (idOf(sv)) made.services.push(idOf(sv));
  check('المدير يضيف خدمة ويحدد دكاترتها', !sv.error && idOf(sv), err(sv));
  const svR = await recep.rpc('save_service', { p: { name: 'خدمة استقبال اختبار', price: 100, durationMin: 20 } });
  if (idOf(svR)) made.services.push(idOf(svR));
  check('الاستقبال ما يضيفش خدمات', !!svR.error, err(svR) || 'saved!');
  const svBad = await admin.rpc('save_service', { p: { name: 'خدمة سالبة اختبار', price: -5, durationMin: 20 } });
  check('سعر سالب مرفوض', !!svBad.error, err(svBad) || 'saved!');
  const sb = await book(recep, { patientId: Q.id, therapistId: D1, date: cairoDate(9), time: '20:00', serviceId: idOf(sv) });
  const { data: sbInv } = await recep.from('invoices').select('total').eq('appointment_id', idOf(sb)).maybeSingle();
  check('الحجز بالخدمة الجديدة والفاتورة بسعرها', !sb.error && Number(sbInv?.total) === 250, err(sb) || JSON.stringify(sbInv));
  const sbD2 = await book(recep, { patientId: Q.id, therapistId: D2, date: cairoDate(9), time: '21:00', serviceId: idOf(sv) });
  check('دكتور مش مقدّم الخدمة ما يتحجزش عليها', !!sbD2.error, err(sbD2) || 'accepted!');
  const sdel = await admin.rpc('delete_service', { p_id: idOf(sv) });
  const [svRow] = await sql(`select active from services where id = '${idOf(sv)}'`);
  check('حذف خدمة عليها حجوزات = إيقاف (البيانات القديمة بتفضل)', !sdel.error && svRow && svRow.active === false, err(sdel) || JSON.stringify(svRow));

  // ============ 4) أكواد الخصم ============
  section('أكواد الخصم — اتشالت (920)');
  const CODE = 'E2ET' + Math.floor(Math.random() * 1e5);
  const dc = await admin.rpc('save_discount_code', { p: { code: CODE, type: 'percent', value: 25, validFrom: today, validTo: cairoDate(30), maxUses: 1, active: true } });
  if (!dc.error) made.codes.push(CODE);
  check('إنشاء كود خصم بطلب مباشر مرفوض (حتى للمدير)', !!dc.error, err(dc) || 'saved!');
  const dInv = await book(recep, { patientId: Q.id, therapistId: D2, date: cairoDate(9), time: '18:00' });
  const { data: inv1 } = await recep.from('invoices').select('id, total, discount').eq('appointment_id', idOf(dInv)).single();
  const ap = await recep.rpc('apply_discount_code', { p_invoice: inv1?.id, p_code: CODE });
  const { data: inv1b } = await recep.from('invoices').select('total, discount').eq('id', inv1?.id).single();
  check('تطبيق كود خصم على فاتورة بطلب مباشر مرفوض والفاتورة بسعر الخدمة', !!ap.error && Number(inv1b?.discount) === 0 && Number(inv1b?.total) === Number(inv1?.total), err(ap) || JSON.stringify(inv1b));

  // ============ 5) الخطط العلاجية ============
  section('الخطط العلاجية وجلساتها');
  const pd = cairoDate(12);
  const pl = await admin.rpc('save_plan', { p: { patientId: P.id, serviceId: 'sv_physio', therapistId: D1, diagnosis: 'خشونة ركبة اختبار', mainGoal: 'تحسين الحركة', durationWeeks: 1, sessionsPerWeek: 2, totalSessions: 2, startDate: pd, price: 0, status: 'active' } });
  check('إنشاء خطة علاج (جلستين)', !pl.error && idOf(pl), err(pl));
  const busyP = await book(recep, { patientId: P.id, therapistId: D2, date: pd, time: '18:00' });
  const ps1 = await recep.rpc('book_plan_session', { p: { planId: idOf(pl), therapistId: D1, date: pd, time: '18:00' } });
  check('جلسة خطة في وقت المريض مشغول فيه مرفوضة', !busyP.error && /موعد تاني/.test(err(ps1)), err(busyP) || err(ps1) || 'accepted!');
  const { data: busyRow } = await recep.from('appointments').select('plan_id').eq('id', idOf(busyP)).single();
  const { data: busyInv } = await recep.from('invoices').select('total').eq('appointment_id', idOf(busyP)).maybeSingle();
  check('كشف لمريض عنده خطة علاج طبيعي مابيتحسبش جلسة منها وليه فاتورته', busyRow?.plan_id == null && Number(busyInv?.total) === 400, JSON.stringify({ busyRow, busyInv }));
  const ps2 = await recep.rpc('book_plan_session', { p: { planId: idOf(pl), therapistId: D1, date: pd, time: '19:00' } });
  const ps3 = await recep.rpc('book_plan_session', { p: { planId: idOf(pl), therapistId: D1, date: cairoDate(14), time: '19:00' } });
  check('حجز جلستين الخطة', !ps2.error && !ps3.error, err(ps2) || err(ps3));
  const ps4 = await recep.rpc('book_plan_session', { p: { planId: idOf(pl), therapistId: D1, date: cairoDate(16), time: '19:00' } });
  check('جلسة زيادة عن عدد جلسات الخطة مرفوضة', /كل جلسات الخطة محجوزة/.test(err(ps4)), err(ps4) || 'accepted!');
  const { data: planRow } = await recep.from('treatment_plans').select('total_sessions, status').eq('id', idOf(pl)).single();
  check('الخطة محفوظة بعدد الجلسات والحالة', planRow?.total_sessions === 2 && planRow.status === 'active', JSON.stringify(planRow));

  // ============ 6) الأشعة والكسور والعمليات ============
  section('الأشعة والكسور والعمليات');
  const im = await doc.from('ortho_imaging').insert({ patient_id: P.id, kind: 'mri', region: 'الركبة اليمين', requested_at: today, status: 'requested' }).select().single();
  check('الطبيب يطلب أشعة رنين', !im.error, err(im));
  const imU = await doc.from('ortho_imaging').update({ status: 'reviewed', finding: 'قطع جزئي في الغضروف الهلالي (اختبار)' }).eq('id', im.data?.id).select().single();
  check('الطبيب يسجّل نتيجة الأشعة', !imU.error && imU.data?.status === 'reviewed', err(imU));
  const imR = await recep.from('ortho_imaging').insert({ patient_id: P.id, kind: 'xray', region: 'الكتف', requested_at: today, status: 'requested' }).select();
  check('الاستقبال ما يطلبش أشعة', !!imR.error, err(imR) || 'inserted!');
  const imK = await doc.from('ortho_imaging').insert({ patient_id: P.id, kind: 'pet', region: 'الكتف', requested_at: today }).select();
  check('نوع أشعة مش من القائمة مرفوض', !!imK.error, err(imK) || 'inserted!');
  const su = await doc.from('ortho_surgeries').insert({ patient_id: P.id, procedure: 'منظار ركبة اختبار', region: 'الركبة', side: 'right', hospital: 'مستشفى اختبار', date: cairoDate(20), implant: '', status: 'scheduled' }).select().single();
  check('الطبيب يحدد عملية', !su.error, err(su));
  const suBad = await doc.from('ortho_surgeries').insert({ patient_id: P.id, procedure: '   ', region: 'الركبة', side: 'right' }).select();
  check('عملية من غير اسم مرفوضة', !!suBad.error, err(suBad) || 'inserted!');
  const fr = await doc.from('ortho_fractures').insert({ patient_id: P.id, bone: 'عظمة الكعبرة', side: 'left', kind: 'كسر', injury_date: today, cast_date: today, removal_due: cairoDate(42), status: 'casted' }).select().single();
  check('الطبيب يسجّل كسر وجبس وميعاد الفك', !fr.error, err(fr));
  const frR = await recep.from('ortho_fractures').select('id').eq('patient_id', P.id);
  check('الاستقبال يشوف الكسور (عرض فقط)', (frR.data ?? []).length === 1, err(frR));

  // ============ 7) الإشعارات والحملات والدعم وطلبات الموظفين ============
  section('الدعم الفني وطلبات الموظفين والإعدادات');
  const tk = await recep.from('support_tickets').insert({ subject: 'مشكلة طباعة اختبار', description: 'الطابعة مش بتطبع الروشتة', category: 'technical', priority: 'high', no: '' }).select().single();
  if (tk.data?.id) made.tickets.push(tk.data.id);
  check('الاستقبال يفتح تذكرة دعم برقم تلقائي', !tk.error && tk.data?.no, err(tk));
  const adminEmp = (await api(admin, 'GET', 'me')).body?.employee?.id;
  const rp = await admin.from('support_replies').insert({ ticket_id: tk.data?.id, body: 'رد اختبار', employee_id: adminEmp }).select();
  const st = await admin.from('support_tickets').update({ status: 'resolved' }).eq('id', tk.data?.id).select().single();
  check('المدير يرد ويقفل التذكرة', !rp.error && st.data?.status === 'resolved', err(rp) || err(st));
  const tkBad = await recep.from('support_tickets').insert({ subject: '  ', no: '' }).select();
  check('تذكرة من غير عنوان مرفوضة', !!tkBad.error, err(tkBad) || 'inserted!');
  const own = await recep.rpc('create_staff_request', { p: { type: 'permission', fromDate: cairoDate(403), fromTime: '18:00', toTime: '17:00', reason: 'اختبار' } });
  check('استئذان وقت بدايته بعد نهايته مرفوض', !!own.error, err(own) || 'saved!');
  const own2 = await recep.rpc('create_staff_request', { p: { type: 'leave', fromDate: cairoDate(403), toDate: cairoDate(404), reason: 'إجازة اختبار' } });
  if (idOf(own2)) made.requests.push(idOf(own2));
  check('الموظف يقدّم طلب إجازة لنفسه', !own2.error, err(own2));
  const other = await recep.rpc('create_staff_request', { p: { type: 'leave', employeeId: STAFF.doc.id, fromDate: cairoDate(403), toDate: cairoDate(403), reason: 'اختبار' } });
  if (idOf(other)) made.requests.push(idOf(other));
  check('الاستقبال ما يقدّمش طلب باسم موظف تاني', !!other.error, err(other) || 'saved!');
  const ns = await admin.rpc('notification_settings');
  check('إعدادات الإشعارات التلقائية بتفتح للمدير', !ns.error, err(ns));
  const nsR = await recep.rpc('save_notification_settings', { p: { kinds: [] } });
  check('الاستقبال ما يعدّلش إعدادات الإشعارات', !!nsR.error, err(nsR) || 'saved!');

  section('التقارير والبحث ولوحة التحكم');
  const from = cairoDate(-30), to = cairoDate(30);
  const rep = await admin.rpc('report_summary', { p_from: from, p_to: to, p_branch: null, p_therapist: null, p_group: 'day', p_service: null });
  check('تقرير الإيرادات والمواعيد يفتح للمدير', !rep.error && rep.data, err(rep));
  const ds = await admin.rpc('dashboard_stats', { p_branch: null });
  check('لوحة المدير فيها الإيراد', !ds.error && ds.data?.monthRevenue != null, err(ds) || JSON.stringify(ds.data).slice(0, 100));
  const mk = await admin.rpc('marketing_report', { p_month: today.slice(0, 7) });
  check('تقرير التسويق يفتح', !mk.error, err(mk));
  const gs = await recep.rpc('global_search', { p_q: 'تضارب اختبار' });
  check('البحث العام بيلاقي المريض', !gs.error && JSON.stringify(gs.data).includes(P.id), err(gs) || JSON.stringify(gs.data).slice(0, 100));
  const sd = await recep.rpc('staff_directory');
  check('دليل الموظفين بالأسماء بس (من غير موبايلات)', !sd.error && (sd.data ?? []).length > 0 && !JSON.stringify(sd.data).includes(STAFF.doc.digits), err(sd));

  // ============ 8) بوابة المريض: سجلي الطبي والحجز ============
  section('بوابة المريض — سجلي الطبي والحجز والتعديل والإلغاء');
  const reg = await fetch(`${URL_}/functions/v1/api/register`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ name: PORTAL.name, phone: PORTAL.phone, password: PW, confirm: PW }) });
  const regB = await reg.json().catch(() => null);
  const PP = regB?.patientId;
  if (PP) made.patients.push(PP);
  check('إنشاء حساب مريض من الموقع', reg.status === 201 && PP, JSON.stringify(regB));
  const pat = await login('c' + PORTAL.digits, PW);
  const empty = await pat.rpc('patient_medical_record');
  check('سجل طبي فاضي قبل الكشف', !empty.error && empty.data?.consultations?.length === 0 && empty.data?.nextFollowUp === null, err(empty) || JSON.stringify(empty.data).slice(0, 100));
  const follow = cairoDate(14);
  const cons = await doc.from('ortho_consultations').insert({ patient_id: PP, complaint: 'ألم في الكتف اختبار', region: 'الكتف', side: 'right', diagnosis: 'التهاب أوتار الكتف', icd10: 'M75.1', plan: 'راحة وثلج', examination: 'ملاحظة داخلية للطبيب', history: 'تاريخ مرضي', medications: [{ name: 'Celebrex 200mg', dose: 'قرص', frequency: 'مرتين يوميًا', duration: '5 أيام', notes: 'بعد الأكل' }], labs: ['CBC'], imaging_requests: [{ kind: 'xray', region: 'الكتف', view: 'AP' }], follow_up: follow }).select().single();
  check('الطبيب يكتب كشف وروشتة وميعاد متابعة للمريض', !cons.error, err(cons));
  await doc.from('ortho_imaging').insert({ patient_id: PP, kind: 'xray', region: 'الكتف', requested_at: today, status: 'requested' });
  const recd = await pat.rpc('patient_medical_record');
  const rc = recd.data?.consultations?.[0];
  check('المريض يشوف التشخيص والروشتة في «سجلي الطبي»', !recd.error && rc?.diagnosis === 'التهاب أوتار الكتف' && rc.medications?.[0]?.name === 'Celebrex 200mg' && rc.labs?.[0] === 'CBC', err(recd) || JSON.stringify(rc).slice(0, 150));
  check('اسم الطبيب وميعاد المتابعة ظاهرين', rc?.doctor === STAFF.doc.name && recd.data?.nextFollowUp === follow, JSON.stringify({ doctor: rc?.doctor, next: recd.data?.nextFollowUp }));
  check('ملاحظات الفحص الداخلية مش ظاهرة للمريض', !JSON.stringify(recd.data).includes('ملاحظة داخلية'), 'examination leaked');
  check('طلب الأشعة ظاهر في سجله', recd.data?.imaging?.length === 1 && recd.data.imaging[0].kind === 'xray', JSON.stringify(recd.data?.imaging));
  check('المريض مايشوفش سجل مريض تاني', !JSON.stringify(recd.data).includes('خشونة') && !JSON.stringify(recd.data).includes('منظار ركبة'), 'other patient leaked');
  const direct = await pat.from('ortho_consultations').select('id');
  check('المريض مايقراش جداول العظام مباشرة (من الدالة بس)', (direct.data ?? []).length === 0, JSON.stringify(direct.data));
  const staffRec = await recep.rpc('patient_medical_record');
  check('الدالة للمريض بس (الموظف مرفوض)', !!staffRec.error, err(staffRec) || 'allowed!');
  const camp = await admin.rpc('send_campaign', { p: { title: 'عرض اختبار', body: 'خصم اختبار على الكشف', audience: 'patient', patientId: PP } });
  if (idOf(camp)) made.campaigns.push(idOf(camp));
  check('إشعار لمريض محدد بيوصل لحسابه', !camp.error && camp.data?.recipients === 1 && camp.data?.delivered === 1, err(camp) || JSON.stringify(camp.data));
  const { data: pn } = await pat.from('notifications').select('title').eq('audience', 'customer').eq('title', 'عرض اختبار');
  check('المريض شايف الإشعار في بوابته', (pn ?? []).length === 1, JSON.stringify(pn));

  const ob1 = await pat.rpc('patient_book', { p: { therapistId: D1, serviceId: 'sv_exam', date: cairoDate(9), time: '18:30' } });
  check('المريض يحجز كشف أونلاين', !ob1.error, err(ob1));
  const ob1b = await pat.rpc('patient_book', { p: { therapistId: D2, serviceId: 'sv_exam', date: cairoDate(9), time: '20:00' } });
  check('موعد أونلاين واحد في اليوم', !!ob1b.error, err(ob1b) || 'accepted!');
  const mv = await recep.rpc('reschedule_appointment', { p_id: idOf(ob1), p_date: cairoDate(10), p_time: '18:30', p_therapist: null, p_address: null });
  const ob2 = await pat.rpc('patient_book', { p: { therapistId: D2, serviceId: 'sv_exam', date: cairoDate(10), time: '20:00' } });
  check('الموعد اللي اتعادت جدولته بيتحسب (مايتحجزش موعد تاني أونلاين في يومه)', !mv.error && !!ob2.error, err(mv) || err(ob2) || 'accepted!');
  const prs = await pat.rpc('patient_reschedule', { p_id: idOf(ob1), p_date: cairoDate(11), p_time: '19:00' });
  const { data: mine } = await pat.rpc('patient_appointments');
  const moved = (mine ?? []).find((a) => a.id === idOf(ob1));
  check('المريض يغيّر موعده بنفسه', !prs.error && moved?.date === cairoDate(11) && moved.time === '19:00', err(prs) || JSON.stringify(moved));
  const pcl = await pat.rpc('patient_cancel', { p_id: idOf(ob1), p_reason: 'اختبار' });
  const { data: mine2 } = await pat.rpc('patient_appointments');
  check('المريض يلغي موعده', !pcl.error && (mine2 ?? []).find((a) => a.id === idOf(ob1))?.status === 'cancelled', err(pcl));
  const otherCancel = await pat.rpc('patient_cancel', { p_id: idOf(a4), p_reason: 'اختبار' });
  check('المريض مايلغيش موعد مريض تاني', !!otherCancel.error, err(otherCancel) || 'cancelled!');
} catch (e) {
  check('تنفيذ الاختبارات بدون أخطاء غير متوقعة', false, e.message);
} finally {
  section('تنظيف بيانات الاختبار');
  try {
    const q = (a) => a.map((x) => `'${x}'`).join(',');
    const custs = await sql(`select id, auth_user_id from customers where phone = '+${PORTAL.digits}'`);
    if (made.campaigns.length) await sql(`delete from campaigns where id in (${q(made.campaigns)});`);
    await sql(`delete from notifications where customer_id in (select id from customers where phone = '+${PORTAL.digits}'); delete from customers where phone = '+${PORTAL.digits}';`);
    for (const c of custs) if (c.auth_user_id) await fetch(`${URL_}/auth/v1/admin/users/${c.auth_user_id}`, { method: 'DELETE', headers: { apikey: env.SUPABASE_SERVICE_ROLE_KEY, Authorization: 'Bearer ' + env.SUPABASE_SERVICE_ROLE_KEY } });
    if (made.patients.length) await sql(`
      delete from coupon_usage where patient_id in (${q(made.patients)});
      delete from patients where id in (${q(made.patients)});`);
    if (made.codes.length) await sql(`delete from coupon_usage where coupon_id in (select id from discount_codes where code in (${q(made.codes)})); delete from discount_codes where code in (${q(made.codes)});`);
    if (made.services.length) await sql(`delete from therapist_services where service_id in (${q(made.services)}); delete from services where id in (${q(made.services)});`);
    if (made.holidays.length) await sql(`delete from holidays where id in (${q(made.holidays)});`);
    await sql(`delete from holidays where reason like '%اختبار%';`);
    if (made.tickets.length) await sql(`delete from support_replies where ticket_id in (${q(made.tickets)}); delete from support_tickets where id in (${q(made.tickets)});`);
    if (made.employees.length) await sql(`delete from staff_requests where employee_id in (${q(made.employees)});`);
    for (const id of made.employees) await deleteEmployee(id);
    if (made.therapists.length) await sql(`delete from therapist_services where therapist_id in (${q(made.therapists)}); delete from therapists where id in (${q(made.therapists)});`);
    await sql(`delete from register_attempts where phone_last9 = '${PORTAL.digits.slice(-9)}';
      delete from notifications where body like '%اختبار%' or title like '%اختبار%';`); // سجل التدقيق والنشاط بيفضل زي ما هو
    const [left] = await sql(`select (select count(*) from patients where full_name like '%اختبار%')::int p, (select count(*) from employees where name like '%اختبار%')::int e,
      (select count(*) from therapists where name like '%اختبار%')::int t, (select count(*) from services where name like '%اختبار%')::int s, (select count(*) from holidays)::int h,
      (select count(*) from support_tickets where subject like '%اختبار%')::int k, (select count(*) from customers where phone = '+${PORTAL.digits}')::int c`);
    console.log('  متبقي من بيانات الاختبار:', JSON.stringify(left));
  } catch (e) { console.log('  تنظيف ناقص:', e.message); }
  save('e2e-sections-results.json');
}
