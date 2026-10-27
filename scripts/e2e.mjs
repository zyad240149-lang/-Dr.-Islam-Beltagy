// اختبارات تكامل حقيقية على مشروع Supabase: دخول، أدوار، صلاحيات RLS، حجز، فواتير، مدفوعات، أقسام العظام.
// بتنشئ حسابات وبيانات اختبار مؤقتة (أسماء فيها «اختبار») وبتمسحها في الآخر — مابتلمسش أي بيانات تانية.
//   node scripts/e2e.mjs
import { ADMIN_DIGITS, api, cairoDate, client, deleteEmployee, login, loginAdmin, sql, suite } from './_harness.mjs';

const { check, save } = suite();

const PW = 'Test#' + Math.random().toString(36).slice(2, 10);
const RECEP = { phone: '01200000901', digits: '201200000901' }, DOC = { phone: '01200000902', digits: '201200000902' };
const created = { employees: [], patient: null, therapist: null };

try {
  console.log('— الدخول والهوية');
  const anon = client();
  const { data: anonRows, error: anonErr } = await anon.from('patients').select('id').limit(1);
  check('الزائر بدون دخول ما يقدر يقرا المرضى', !anonErr ? (anonRows ?? []).length === 0 : true, anonErr?.message ?? `rows=${anonRows?.length}`);
  const bad = await client().auth.signInWithPassword({ email: `${ADMIN_DIGITS}@clinic.local`, password: 'wrong-password' });
  check('كلمة مرور غلط مرفوضة', !!bad.error, bad.error?.message);
  const admin = await loginAdmin();
  const me = await api(admin, 'GET', 'me');
  check('المدير يدخل و /api/me يرجّع موظف', me.status === 200 && me.body?.kind === 'staff' && me.body.employee.role === 'system_admin', JSON.stringify(me.body).slice(0, 120));

  console.log('— إدارة الموظفين');
  const th = await admin.rpc('save_therapist', { p: { name: 'د. اختبار آلي', title: 'طبيب اختبار', phone: '+' + DOC.digits, serviceIds: [], workHours: ['sun', 'mon', 'tue', 'wed', 'thu', 'sat'].map((day) => ({ day, from: '16:00', to: '22:00' })), onLeave: [], active: true, defaultDurationMin: 30 } });
  created.therapist = th.data?.id ?? th.data;
  check('إنشاء ملف طبيب (save_therapist)', !th.error && created.therapist, th.error?.message);
  const r1 = await api(admin, 'POST', 'staff', { name: 'استقبال اختبار آلي', phone: RECEP.phone, country: 'EG', password: PW, role: 'reception', jobTitle: 'استقبال' });
  check('إنشاء حساب استقبال', r1.status === 201, JSON.stringify(r1.body).slice(0, 150)); if (r1.body?.id) created.employees.push(r1.body.id);
  const r2 = await api(admin, 'POST', 'staff', { name: 'طبيب اختبار آلي', phone: DOC.phone, country: 'EG', password: PW, role: 'therapist', therapistId: created.therapist, jobTitle: 'طبيب' });
  check('إنشاء حساب طبيب مربوط بملفه', r2.status === 201, JSON.stringify(r2.body).slice(0, 150)); if (r2.body?.id) created.employees.push(r2.body.id);
  const dup = await api(admin, 'POST', 'staff', { name: 'مكرر', phone: RECEP.phone, country: 'EG', password: PW, role: 'reception' });
  check('رقم موظف مكرر مرفوض', dup.status === 409, dup.status);
  const weak = await api(admin, 'POST', 'staff', { name: 'ضعيف', phone: '01200000903', country: 'EG', password: '123', role: 'reception' });
  check('كلمة مرور قصيرة مرفوضة', weak.status === 400, weak.status);
  const recep = await login(RECEP.digits, PW);
  const doc = await login(DOC.digits, PW);
  const rStaff = await api(recep, 'POST', 'staff', { name: 'محاولة', phone: '01200000904', country: 'EG', password: PW, role: 'system_admin' });
  check('الاستقبال ما يقدر ينشئ موظفين', rStaff.status === 403, rStaff.status);

  console.log('— المرضى');
  const { data: pat, error: pErr } = await recep.from('patients').insert({ full_name: 'مريض اختبار آلي', first_name: 'مريض', father_name: 'اختبار', family_name: 'آلي', phone: '+201200000999', gender: 'male', nationality: 'non_saudi', referral_source: 'friend', file_no: '' }).select().single();
  created.patient = pat?.id;
  check('الاستقبال يضيف مريض ورقم الملف يتولد تلقائي', !pErr && pat?.file_no, pErr?.message ?? pat?.file_no);
  const { data: reread } = await admin.from('patients').select('full_name, phone').eq('id', created.patient).single();
  check('المريض محفوظ فعلًا في القاعدة', reread?.phone === '+201200000999', JSON.stringify(reread));
  const list = await recep.rpc('list_patients', { p_q: 'اختبار', p_gender: '', p_source: '', p_active: '', p_doctor: null, p_sort: 'registered_desc', p_limit: 20, p_offset: 0, p_gaps: '' });
  check('بحث المرضى بالاسم (list_patients)', !list.error && list.data?.rows?.some((r) => r.id === created.patient), list.error?.message);

  console.log('— المواعيد');
  const date = cairoDate(7);
  const book = (c, time, pid = created.patient) => c.rpc('book_appointment', { p: { patientId: pid, type: 'initial', serviceId: 'sv_exam', therapistId: created.therapist, date, time, location: 'center' } });
  const b1 = await book(recep, '17:00');
  const apptId = b1.data?.id ?? b1.data;
  check('حجز موعد من الاستقبال', !b1.error && apptId, b1.error?.message);
  const b2 = await book(recep, '17:00');
  check('حجز نفس الوقت لنفس الطبيب مرفوض من الخادم', !!b2.error, b2.error?.message ?? 'accepted!');
  const b3 = await book(recep, '23:30');
  check('حجز خارج ساعات العمل مرفوض', !!b3.error, b3.error?.message ?? 'accepted!');
  const [p1, p2] = await Promise.all([book(recep, '18:00'), book(admin, '18:00')]);
  check('حجزين متزامنين على نفس الوقت: واحد بس ينجح', [p1, p2].filter((x) => !x.error).length === 1, `${p1.error?.message ?? 'ok'} | ${p2.error?.message ?? 'ok'}`);

  console.log('— الفواتير والمدفوعات');
  const { data: inv } = await recep.from('invoices').select('*').eq('appointment_id', apptId).maybeSingle();
  check('الفاتورة اتعملت تلقائيًا مع الحجز بسعر الخدمة', inv && Number(inv.total) === 400, JSON.stringify(inv && { total: inv.total, status: inv.status }));
  if (inv) {
    const over = await recep.rpc('record_payment', { p_invoice: inv.id, p_amount: 1000, p_method: 'cash', p_note: '' });
    check('دفع أكبر من المتبقي مرفوض', !!over.error, over.error?.message ?? 'accepted!');
    const pay = await recep.rpc('record_payment', { p_invoice: inv.id, p_amount: 150, p_method: 'cash', p_note: 'اختبار' });
    check('تسجيل دفعة جزئية', !pay.error, pay.error?.message);
    const { data: inv2 } = await recep.from('invoices').select('paid, remaining, status').eq('id', inv.id).single();
    check('الخادم حسب المدفوع والمتبقي والحالة', Number(inv2.paid) === 150 && Number(inv2.remaining) === 250 && inv2.status === 'partial', JSON.stringify(inv2));
  }

  console.log('— الصلاحيات المالية');
  const payrollR = await recep.rpc('payroll_overview', { p_period: date.slice(0, 7) });
  check('الاستقبال ما يشوفش الرواتب', !!payrollR.error, payrollR.error?.message ?? 'visible!');
  const payrollA = await admin.rpc('payroll_overview', { p_period: date.slice(0, 7) });
  check('المدير يشوف الرواتب', !payrollA.error, payrollA.error?.message);
  const statsR = await recep.rpc('dashboard_stats');
  check('لوحة الاستقبال بدون أرقام الإيراد', !statsR.error && statsR.data?.monthRevenue == null, JSON.stringify(statsR.data ?? statsR.error).slice(0, 120));

  console.log('— أقسام العظام (RLS)');
  const cons = { patient_id: created.patient, complaint: 'ألم في الركبة (اختبار)', region: 'الركبة', side: 'right', diagnosis: 'تشخيص اختبار', plan: '' };
  const rc = await recep.from('ortho_consultations').insert(cons).select();
  check('الاستقبال ما يقدرش يكتب تشخيص', !!rc.error, rc.error?.message ?? 'inserted!');
  const dc = await doc.from('ortho_consultations').insert(cons).select().single();
  check('الطبيب يسجّل كشف وتشخيص', !dc.error && dc.data?.id, dc.error?.message);
  check('الكشف محفوظ باسم الطبيب', dc.data?.created_by === r2.body?.id, dc.data?.created_by);
  const rr = await recep.from('ortho_consultations').select('id').eq('id', dc.data?.id);
  check('الاستقبال يقرا الكشف (عرض فقط)', (rr.data ?? []).length === 1, rr.error?.message);
  const emptyDx = await doc.from('ortho_consultations').insert({ ...cons, diagnosis: '  ' }).select();
  check('تشخيص فاضي مرفوض من القاعدة', !!emptyDx.error, emptyDx.error?.message ?? 'accepted!');
  const fr = await doc.from('ortho_fractures').insert({ patient_id: created.patient, bone: 'الكعبرة', side: 'left', kind: 'كسر', injury_date: date, cast_date: date, removal_due: cairoDate(-1) }).select();
  check('موعد فك الجبس قبل التركيب مرفوض', !!fr.error, fr.error?.message ?? 'accepted!');
  const recDel = await recep.from('ortho_consultations').delete().eq('id', dc.data?.id).select('id');
  check('الاستقبال ما يقدرش يحذف كشف', !recDel.error && (recDel.data ?? []).length === 0, recDel.error?.message ?? `deleted ${recDel.data?.length}`);
  const aud = await sql(`select count(*)::int n from audit_logs where table_name = 'ortho_consultations' and record_id = '${dc.data?.id}'`);
  check('إضافة الكشف متسجلة في سجل التدقيق', aud[0].n >= 1, aud[0].n);
} catch (e) {
  check('تنفيذ الاختبارات بدون أخطاء غير متوقعة', false, e.message);
} finally {
  console.log('— تنظيف بيانات الاختبار');
  try {
    if (created.patient) await sql(`
      delete from payments where patient_id = '${created.patient}';
      delete from invoice_items where invoice_id in (select id from invoices where patient_id = '${created.patient}');
      delete from invoices where patient_id = '${created.patient}';
      delete from appointments where patient_id = '${created.patient}';
      delete from patients where id = '${created.patient}';`);
    for (const id of created.employees) await deleteEmployee(id);
    if (created.therapist) await sql(`delete from therapist_services where therapist_id = '${created.therapist}'; delete from therapists where id = '${created.therapist}';`);
    await sql(`delete from activity_log where action like '%اختبار%'; delete from notifications where body like '%اختبار%';`);
    console.log('  تم');
  } catch (e) { console.log('  تنظيف ناقص:', e.message); }
  save('e2e-results.json');
}
