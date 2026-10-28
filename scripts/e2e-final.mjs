// اختبار تكامل على Supabase الحقيقي للتعديلات الأخيرة (هجرات 920–922 + Push):
// الرواتب الثابتة (تسجيل/تكرار/صرف/صلاحيات/منع تعديل الراتب الشخصي)، المخزون (توريد/صرف/صرف أكتر من المتاح/صلاحيات)،
// الخدمة الجديدة «إدارة فقط» افتراضيًا، تذكيرات المواعيد 4/2/1 ساعة، ودالة Push (السر + «مفيش جهاز»).
// بيعمل موظفين ومريض وصنف وخدمة مؤقتين ويمسحهم في الآخر — البيانات الحقيقية ما بتتلمسش.
//   node scripts/e2e-final.mjs
import { allDayHours, api, cairoDate, deleteEmployee, env, login, loginAdmin, randomPassword, sql, suite } from './_harness.mjs';

const { check, section, save } = suite();
const PW = randomPassword();
const made = { employees: [], therapist: null, patient: null, item: null, service: null };
const err = (r) => r?.error?.message ?? '';
const STAFF = { acc: { phone: '01200000971', digits: '201200000971', name: 'محاسب نهائي اختبار', role: 'accountant' }, recep: { phone: '01200000972', digits: '201200000972', name: 'استقبال نهائي اختبار', role: 'reception' } };

try {
  section('التجهيز');
  const admin = await loginAdmin();
  for (const s of Object.values(STAFF)) {
    const r = await api(admin, 'POST', 'staff', { name: s.name, phone: s.phone, country: 'EG', password: PW, role: s.role, workHours: allDayHours() });
    if (r.body?.id) { made.employees.push(r.body.id); s.id = r.body.id; }
    check(`حساب ${s.name}`, r.status === 201, JSON.stringify(r.body).slice(0, 120));
  }
  const recep = await login(STAFF.recep.digits, PW);
  const { data: au } = await admin.auth.getUser();
  const [me] = await sql(`select id from employees where auth_user_id = '${au.user?.id}' limit 1`);

  section('الرواتب الثابتة (922)');
  const period = cairoDate(0).slice(0, 7);
  const st = await admin.from('salary_settings').upsert({ employee_id: STAFF.acc.id, monthly_salary: 6000, pay_day: 31, active: true });
  check('المدير يحدد راتب ثابت ويوم صرف للموظف', !st.error, err(st));
  const p1 = await admin.from('salary_payments').insert({ employee_id: STAFF.acc.id, employee_name: STAFF.acc.name, period, amount: 6000, due_date: `${period}-28` }).select().single();
  check('تسجيل راتب الشهر «مستحق»', !p1.error && p1.data?.status === 'due' && Number(p1.data?.amount) === 6000, err(p1));
  const dup = await admin.from('salary_payments').insert({ employee_id: STAFF.acc.id, employee_name: STAFF.acc.name, period, amount: 6000, due_date: `${period}-28` }).select();
  check('تسجيل نفس الشهر مرتين مرفوض (فهرس فريد)', !!dup.error && /salary_payments_one_per_month|duplicate/i.test(err(dup)), err(dup) || 'accepted!');
  const noDate = await admin.from('salary_payments').update({ status: 'paid' }).eq('id', p1.data?.id).select();
  check('«مدفوع» من غير تاريخ دفع مرفوض', !!noDate.error, err(noDate) || 'accepted!');
  const paid = await admin.from('salary_payments').update({ status: 'paid', paid_on: cairoDate(0), method: 'cash' }).eq('id', p1.data?.id).select().single();
  check('تسجيل الصرف بتاريخ الدفع الفعلي', !paid.error && paid.data?.status === 'paid' && paid.data?.paid_on === cairoDate(0), err(paid));
  const delPaid = await admin.from('salary_payments').delete().eq('id', p1.data?.id).select('id');
  check('الراتب المدفوع ما بيتمسحش', !delPaid.error && (delPaid.data ?? []).length === 0, err(delPaid) || 'deleted!');
  const rRead = await recep.from('salary_payments').select('id');
  check('الاستقبال ما يشوفش الرواتب', !rRead.error && (rRead.data ?? []).length === 0, err(rRead));
  const rIns = await recep.from('salary_payments').insert({ employee_id: STAFF.recep.id, employee_name: 'x', period, amount: 1, due_date: `${period}-01` }).select();
  check('الاستقبال ما يقدرش يسجّل راتب', !!rIns.error, err(rIns) || 'inserted!');
  if (me?.id) {
    const self = await admin.from('salary_settings').upsert({ employee_id: me.id, monthly_salary: 99999, pay_day: 1 }).select();
    check('محدش يحدد راتبه هو (حتى المدير)', !!self.error, err(self) || 'saved!');
  }
  const rep = await admin.from('salary_payments').select('employee_name, amount, status').eq('period', period).eq('employee_id', STAFF.acc.id);
  check('تقرير الشهر بيرجّع الراتب بحالته', (rep.data ?? []).length === 1 && rep.data[0].status === 'paid', JSON.stringify(rep.data));

  section('المخزون');
  const it = await admin.rpc('save_item', { p: { name: 'شاش طبي نهائي اختبار', category: 'مستلزمات', unit: 'لفة', quantity: 10, minQuantity: 3, costPrice: 12, salePrice: 0, supplier: '', active: true } });
  const [item] = await sql(`select id, quantity from inventory_items where name = 'شاش طبي نهائي اختبار'`);
  made.item = item?.id;
  check('إضافة صنف بكمية 10', !it.error && Number(item?.quantity) === 10, err(it));
  const buy = await admin.rpc('add_stock_movement', { p: { itemId: made.item, type: 'purchase', quantity: 5, unitCost: 13, reference: 'فاتورة 1', note: '' } });
  const out = await admin.rpc('add_stock_movement', { p: { itemId: made.item, type: 'issue', quantity: 4, unitCost: 0, reference: 'غرفة الجبس', note: '' } });
  const [q2] = await sql(`select quantity from inventory_items where id = '${made.item}'`);
  check('توريد 5 وصرف 4 ← الكمية 11', !buy.error && !out.error && Number(q2.quantity) === 11, err(buy) || err(out) || q2.quantity);
  const over = await admin.rpc('add_stock_movement', { p: { itemId: made.item, type: 'issue', quantity: 50, unitCost: 0, reference: '', note: '' } });
  check('صرف أكتر من المتاح مرفوض', /المتاحة/.test(err(over)), err(over) || 'accepted!');
  const [mv] = await sql(`select count(*)::int n from stock_movements where item_id = '${made.item}'`);
  check('كل حركة متسجّلة (افتتاحي + توريد + صرف)', mv.n === 3, mv.n);
  const recepDel = await recep.rpc('delete_item', { p_id: made.item });
  check('الاستقبال ما يقدرش يمسح صنف', !!recepDel.error, err(recepDel) || 'deleted!');

  section('الخدمات — الجديدة «إدارة فقط» (921)');
  const sv = await admin.rpc('save_service', { p: { name: 'خدمة نهائي اختبار', category: 'اختبار', description: '', price: 100, durationMin: 15, therapistIds: [], active: true } });
  const [svc] = await sql(`select id, show_on_site from services where name = 'خدمة نهائي اختبار'`);
  made.service = svc?.id;
  check('خدمة جديدة من غير اختيار الظهور ← «إدارة فقط»', !sv.error && svc?.show_on_site === false, err(sv) || JSON.stringify(svc));
  const pub = await recep.rpc('public_catalog');
  const listed = JSON.stringify(pub.data ?? '').includes('خدمة نهائي اختبار');
  check('الخدمة الجديدة مش ظاهرة في قايمة الحجز الإلكتروني', !listed, err(pub));

  section('تذكيرات المواعيد 4 / 2 / 1 ساعة (921)');
  const [pr] = await sql(`select reminder_offsets from notification_prefs`);
  check('الإعداد = 4 و2 و1 ساعة', JSON.stringify(pr.reminder_offsets) === '[4,2,1]', JSON.stringify(pr.reminder_offsets));
  const th = await admin.rpc('save_therapist', { p: { name: 'د. نهائي اختبار', title: 'اختبار', phone: '', serviceIds: ['sv_exam'], workHours: allDayHours(), onLeave: [], active: true, defaultDurationMin: 30 } });
  made.therapist = th.data?.id ?? th.data;
  const [pat] = await sql(`insert into patients (full_name, first_name, father_name, family_name, phone, gender, nationality, referral_source, file_no)
    values ('عادل سمير نهائياختبار', 'عادل', 'سمير', 'نهائياختبار', '+201200000973', 'male', 'saudi', 'friend', '') returning id`);
  made.patient = pat.id;
  const bk = await admin.rpc('book_appointment', { p: { patientId: pat.id, type: 'initial', serviceId: 'sv_exam', therapistId: made.therapist, date: cairoDate(3), time: '20:00', location: 'center' } });
  const apId = bk.data?.id ?? bk.data;
  const sch = await sql(`select offset_minutes, status from notification_schedule where appointment_id = '${apId}' order by offset_minutes desc`);
  check('الحجز بيجدول 3 تذكيرات بس: قبلها بـ 4 و2 و1 ساعة', JSON.stringify(sch.map((x) => x.offset_minutes)) === '[240,120,60]' && sch.every((x) => x.status === 'pending'), JSON.stringify(sch));
  await recep.rpc('set_appointment_status', { p_id: apId, p_status: 'cancelled', p_reason: 'اختبار', p_therapist: null });
  const sch2 = await sql(`select status from notification_schedule where appointment_id = '${apId}'`);
  check('إلغاء الموعد بيلغي تذكيراته', sch2.length === 3 && sch2.every((x) => x.status === 'cancelled'), JSON.stringify(sch2));

  section('Push — دالة الإرسال على الخادم');
  const [cfg] = await sql(`select notify_url, hook_secret is not null as has_secret from push_config where id = 1`);
  check('قاعدة البيانات متوصّلة بدالة push (push_config)', !!cfg?.notify_url && cfg.has_secret, JSON.stringify(cfg ?? null));
  if (cfg?.notify_url) {
    const bad = await fetch(cfg.notify_url, { method: 'POST', headers: { 'Content-Type': 'application/json', 'x-push-secret': 'wrong' }, body: JSON.stringify({ notification_id: '00000000-0000-0000-0000-000000000000' }) });
    check('دالة push بترفض الطلب من غير السر الصحيح', bad.status === 401, bad.status);
    const [n] = await sql(`insert into notifications (audience, employee_id, kind, title, body, push_status) values ('staff', '${STAFF.recep.id}', 'test', 'اختبار إشعار', 'اختبار', 'pending') returning id`);
    let st2 = '';
    for (let i = 0; i < 20 && !['no_device', 'sent', 'failed'].includes(st2); i++) { await new Promise((r) => setTimeout(r, 1500)); st2 = (await sql(`select push_status from notifications where id = '${n.id}'`))[0].push_status; }
    check('إشعار لموظف من غير جهاز مشترك ← الدالة اشتغلت وسجّلت «مفيش جهاز»', st2 === 'no_device', st2);
    await sql(`delete from notifications where id = '${n.id}'`);
  }
} catch (e) {
  check('تنفيذ الاختبارات بدون أخطاء غير متوقعة', false, e.message);
} finally {
  console.log('— تنظيف');
  try {
    if (made.patient) await sql(`delete from notification_schedule where patient_id = '${made.patient}'; delete from patients where id = '${made.patient}';`);
    if (made.item) await sql(`delete from stock_movements where item_id = '${made.item}'; delete from inventory_items where id = '${made.item}';`);
    if (made.service) await sql(`delete from services where id = '${made.service}';`);
    for (const id of made.employees) { await sql(`delete from salary_payments where employee_id = '${id}'; delete from salary_settings where employee_id = '${id}'; delete from attendance where employee_id = '${id}'; delete from notifications where employee_id = '${id}';`); await deleteEmployee(id); }
    if (made.therapist) await sql(`delete from therapist_services where therapist_id = '${made.therapist}'; delete from therapists where id = '${made.therapist}';`);
  } catch (e) { console.log('  تنظيف ناقص:', e.message); }
  save('e2e-final-results.json');
}
