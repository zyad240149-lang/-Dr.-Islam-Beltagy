// اختبارات تكامل لحساب المريض: إنشاء حساب من الموقع، تسجيل الدخول، بوابة المريض، الحجز أونلاين، وعزل البيانات.
// كل البيانات مؤقتة (أسماء فيها «اختبار») وبتتمسح في الآخر.
//   node scripts/e2e-patient.mjs
import { allDayHours, api, cairoDate, client, deleteEmployee, env, fakeEgyptianId, login, loginAdmin, randomPassword, sql, suite, URL_ } from './_harness.mjs';

const { check, section, save } = suite();
const PW = randomPassword();
const P1 = { phone: '01200000931', digits: '201200000931', name: 'مريض بوابة اختبار' };
const P2 = { phone: '01200000932', digits: '201200000932', name: 'مريض ملف قديم اختبار' };
const RECEP = { phone: '01200000933', digits: '201200000933' };
const P3 = { phone: '01200000934', digits: '201200000934' }; // عيلة بموبايل واحد
const P4 = { phone: '01200000935', digits: '201200000935', name: 'مريض قفل اختبار' }; // تخمين الرقم القومي
const made = { therapist: null, employees: [], phones: [P1, P2, P3, P4].map((p) => '+' + p.digits) };
const toArabicDigits = (s) => s.replace(/\d/g, (d) => '٠١٢٣٤٥٦٧٨٩'[d]);
const newFile = (c, full, phone, nid = '') => {
  const [first, father, ...rest] = full.split(' ');
  return c.from('patients').insert({ full_name: full, first_name: first, father_name: father, family_name: rest.join(' '), phone: '+' + phone, gender: 'female', nationality: 'saudi', national_id: nid, referral_source: 'friend', file_no: '' }).select().single();
};
const err = (r) => r.error?.message ?? '';

const register = async (body) => {
  const r = await fetch(`${URL_}/functions/v1/api/register`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
  return { status: r.status, body: await r.json().catch(() => null) };
};

try {
  section('التجهيز');
  const admin = await loginAdmin();
  const th = await admin.rpc('save_therapist', { p: { name: 'د. اختبار بوابة', title: 'طبيب اختبار', phone: '', serviceIds: ['sv_exam', 'sv_followup'], workHours: allDayHours(), onLeave: [], active: true, defaultDurationMin: 30 } });
  made.therapist = th.data?.id ?? th.data;
  check('ملف طبيب الاختبار', !th.error && made.therapist, err(th));
  const rc = await api(admin, 'POST', 'staff', { name: 'استقبال بوابة اختبار', phone: RECEP.phone, country: 'EG', password: PW, role: 'reception', workHours: allDayHours() });
  if (rc.body?.id) made.employees.push(rc.body.id);
  const recep = await login(RECEP.digits, PW);

  section('إنشاء حساب من الموقع');
  const bad1 = await register({ name: 'محمد', phone: P1.phone, password: PW, confirm: PW });
  check('اسم مش ثلاثي مرفوض', bad1.status === 400, JSON.stringify(bad1.body));
  const bad2 = await register({ name: 'Mohamed Ahmed Ali', phone: P1.phone, password: PW, confirm: PW });
  check('اسم بحروف إنجليزي مرفوض', bad2.status === 400, JSON.stringify(bad2.body));
  const bad3 = await register({ name: P1.name, phone: P1.phone, password: '123', confirm: '123' });
  check('كلمة مرور قصيرة مرفوضة', bad3.status === 400, JSON.stringify(bad3.body));
  const bad4 = await register({ name: P1.name, phone: P1.phone, password: PW, confirm: PW + 'x' });
  check('تأكيد كلمة المرور مختلف مرفوض', bad4.status === 400, JSON.stringify(bad4.body));
  const bad5 = await register({ name: P1.name, phone: '0123', password: PW, confirm: PW });
  check('رقم موبايل غلط مرفوض', bad5.status === 400, JSON.stringify(bad5.body));
  const ok = await register({ name: P1.name, phone: P1.phone, email: 'patient.test@example.com', password: PW, confirm: PW });
  check('إنشاء الحساب ينجح ويرجع رقم الملف', ok.status === 201 && ok.body?.patientId, JSON.stringify(ok.body));
  const dup = await register({ name: P1.name, phone: P1.phone, password: PW, confirm: PW });
  check('نفس الرقم مرتين مرفوض', dup.status === 409, JSON.stringify(dup.body));
  const [pf] = await sql(`select full_name, phone, referral_source, file_no from patients where id = '${ok.body?.patientId}'`);
  check('ملف مريض اتعمل تلقائيًا (المصدر: الموقع)', pf?.phone === '+' + P1.digits && pf.referral_source === 'website' && pf.file_no, JSON.stringify(pf));

  section('ربط الحساب بملف موجود — لازم الرقم القومي المسجّل في الملف');
  const { data: old, error: oldErr } = await newFile(recep, P2.name, P2.digits);
  check('الاستقبال فتح ملف للمريض (من غير رقم قومي) قبل ما يعمل حساب', !oldErr && old?.id, oldErr?.message);
  const noId = await register({ name: P2.name, phone: P2.phone, password: PW, confirm: PW, nationalId: fakeEgyptianId() });
  check('ملف من غير رقم قومي ← «كلّم العيادة» ومفيش ربط', noId.status === 409 && noId.body?.code === 'contact_clinic', JSON.stringify(noId.body));
  const [ghost] = await sql(`select (select count(*) from auth.users where email = 'c${P2.digits}@clinic.local')::int u, (select count(*) from customers where phone = '+${P2.digits}')::int c`);
  check('مفيش حساب دخول ولا حساب مريض اتعمل', ghost.u === 0 && ghost.c === 0, JSON.stringify(ghost));
  const NID = fakeEgyptianId();
  const upd = await recep.from('patients').update({ national_id: NID }).eq('id', old?.id);
  check('الاستقبال أضاف الرقم القومي للملف', !upd.error, upd.error?.message);
  const need = await register({ name: P2.name, phone: P2.phone, password: PW, confirm: PW });
  check('من غير رقم قومي ← بيطلب الرقم القومي المسجّل في الملف', need.status === 409 && need.body?.code === 'need_id', JSON.stringify(need.body));
  const wrongId = await register({ name: P2.name, phone: P2.phone, password: PW, confirm: PW, nationalId: NID.slice(0, 13) + ((+NID[13] + 1) % 10) });
  check('رقم قومي غلط ← مرفوض', wrongId.status === 403 && wrongId.body?.code === 'id_mismatch', JSON.stringify(wrongId.body));
  const link = await register({ name: P2.name, phone: P2.phone, password: PW, confirm: PW, nationalId: toArabicDigits(NID.slice(0, 7) + ' ' + NID.slice(7)) });
  check('الرقم الصح (حتى بأرقام عربية ومسافة) ← اتربط بنفس الملف', link.status === 201 && link.body?.patientId === old?.id, JSON.stringify(link.body));
  const [cnt] = await sql(`select count(*)::int n from patients where right(regexp_replace(phone, '\\D', '', 'g'), 9) = '${P2.digits.slice(-9)}'`);
  check('مفيش ملف مكرر لنفس الموبايل', cnt.n === 1, cnt.n);

  section('عيلة بموبايل واحد');
  const ID_A = fakeEgyptianId(), ID_B = fakeEgyptianId();
  const { data: fa, error: faErr } = await newFile(recep, 'أب عيلة اختبار', P3.digits, ID_A);
  const { data: fb, error: fbErr } = await newFile(recep, 'ابن عيلة اختبار', P3.digits, ID_B);
  check('ملفين بنفس الموبايل', fa?.id && fb?.id, faErr?.message || fbErr?.message);
  const fam = await register({ name: 'ابن عيلة اختبار', phone: P3.phone, password: PW, confirm: PW, nationalId: ID_B });
  check('الحساب اتربط بملف صاحب الرقم القومي (الابن) مش أول ملف', fam.status === 201 && fam.body?.patientId === fb?.id, JSON.stringify(fam.body));

  section('الحماية من تخمين الرقم القومي');
  const ID_L = fakeEgyptianId();
  await newFile(recep, P4.name, P4.digits, ID_L);
  const guesses = [];
  for (let i = 0; i < 5; i++) guesses.push((await register({ name: P4.name, phone: P4.phone, password: PW, confirm: PW, nationalId: fakeEgyptianId() })).body?.code);
  check('5 محاولات غلط بترجع «غير مطابق»', guesses.every((c) => c === 'id_mismatch'), guesses.join(','));
  const locked = await register({ name: P4.name, phone: P4.phone, password: PW, confirm: PW, nationalId: ID_L });
  check('بعدها الرقم بيتقفل ساعة (حتى بالرقم الصح)', locked.status === 429 && locked.body?.code === 'locked', JSON.stringify(locked.body));
  const anonCheck = await client().rpc('register_link_check', { p_phone: '+' + P4.digits, p_national_id: ID_L });
  check('دالة الفحص مش متاحة من المتصفح', !!anonCheck.error, err(anonCheck) || 'allowed!');
  const anonReg = await client().rpc('register_customer', { p_auth_user: crypto.randomUUID(), p_name: P4.name, p_phone: '+' + P4.digits, p_email: '', p_national_id: ID_L });
  check('دالة إنشاء العميل مش متاحة من المتصفح', !!anonReg.error, err(anonReg) || 'allowed!');

  section('تسجيل الدخول');
  const wrong = await client().auth.signInWithPassword({ email: `c${P1.digits}@clinic.local`, password: 'wrong-pass' });
  check('كلمة مرور غلط مرفوضة', !!wrong.error, wrong.error?.message);
  const pat = await login('c' + P1.digits, PW);
  const me = await api(pat, 'GET', 'me');
  check('الدخول كمريض و /api/me = customer', me.status === 200 && me.body?.kind === 'customer' && me.body.customer?.patient_id === ok.body?.patientId, JSON.stringify(me.body).slice(0, 150));

  section('بوابة المريض');
  const pme = await pat.rpc('patient_me');
  check('ملفي (patient_me)', !pme.error && pme.data?.patient?.id === ok.body?.patientId, err(pme));
  const dash = await pat.rpc('patient_dashboard');
  check('لوحة المريض (patient_dashboard)', !dash.error && typeof dash.data?.totalAppointments === 'number', err(dash));
  const cat = await pat.rpc('public_catalog');
  check('كتالوج الخدمات والأطباء للحجز', !cat.error && cat.data?.services?.some((s) => s.id === 'sv_exam'), err(cat));
  const date = cairoDate(7);
  const slots = await pat.rpc('doctor_day_slots', { p_therapist: made.therapist, p_service: 'sv_exam', p_date: date });
  const free = slots.data?.slots?.find((s) => s.available && !s.past);
  check('أوقات الطبيب المتاحة', !slots.error && slots.data?.status === 'ok' && free, err(slots) || JSON.stringify(slots.data).slice(0, 120));
  const book = await pat.rpc('patient_book', { p: { therapistId: made.therapist, serviceId: 'sv_exam', date, time: free?.time, notes: 'اختبار' } });
  check('المريض يحجز كشف أونلاين', !book.error && book.data?.id, err(book));
  const mine = await pat.rpc('patient_appointments');
  check('الحجز ظاهر في «مواعيدي»', (mine.data ?? []).some?.((a) => a.id === book.data?.id), err(mine));
  const { data: staffView } = await recep.from('appointments').select('source, status').eq('id', book.data?.id).single();
  check('الاستقبال شايف الحجز ومصدره أونلاين', staffView?.source === 'online', JSON.stringify(staffView));
  const book2 = await pat.rpc('patient_book', { p: { therapistId: made.therapist, serviceId: 'sv_exam', date, time: free?.time } });
  check('حجز نفس الوقت تاني مرفوض', !!book2.error, err(book2) || 'booked!');

  section('عزل البيانات والصلاحيات');
  const { data: seen } = await pat.from('patients').select('id');
  check('المريض بيشوف ملفه هو بس', (seen ?? []).length === 1 && seen[0].id === ok.body?.patientId, JSON.stringify(seen));
  const other = await pat.from('patients').select('id').eq('id', old?.id);
  check('ملف مريض تاني مش ظاهر له', (other.data ?? []).length === 0, JSON.stringify(other.data));
  const lp = await pat.rpc('list_patients', { p_q: '', p_gender: '', p_source: '', p_active: '', p_doctor: null, p_sort: 'registered_desc', p_limit: 5, p_offset: 0, p_gaps: '' });
  check('المريض ما يقدرش يستخدم دوال الموظفين', !!lp.error, err(lp) || 'allowed!');
  const ins = await pat.from('ortho_consultations').insert({ patient_id: ok.body?.patientId, complaint: 'اختبار', diagnosis: 'اختبار' }).select();
  check('المريض ما يقدرش يكتب تشخيص', !!ins.error, err(ins) || 'inserted!');
  const staffApi = await api(pat, 'GET', 'staff');
  check('المريض ما يقدرش يفتح حسابات الموظفين', staffApi.status === 401 || staffApi.status === 403, staffApi.status);
} catch (e) {
  check('تنفيذ الاختبارات بدون أخطاء غير متوقعة', false, e.message);
} finally {
  section('تنظيف بيانات الاختبار');
  try {
    const phones = made.phones.map((p) => `'${p}'`).join(',');
    const custs = await sql(`select id, auth_user_id from customers where phone in (${phones})`);
    await sql(`delete from customers where phone in (${phones});
      delete from register_attempts where phone_last9 in (${made.phones.map((p) => `'${p.slice(-9)}'`).join(',')});
      delete from activity_log where patient_id in (select id from patients where phone in (${phones}));
      delete from patients where phone in (${phones});`);
    for (const c of custs) if (c.auth_user_id) await fetch(`${URL_}/auth/v1/admin/users/${c.auth_user_id}`, { method: 'DELETE', headers: { apikey: env.SUPABASE_SERVICE_ROLE_KEY, Authorization: 'Bearer ' + env.SUPABASE_SERVICE_ROLE_KEY } });
    for (const id of made.employees) { await sql(`delete from activity_log where employee_id = '${id}'`); await deleteEmployee(id); }
    if (made.therapist) await sql(`delete from therapist_services where therapist_id = '${made.therapist}'; delete from therapists where id = '${made.therapist}';`);
    await sql(`delete from activity_log where action like '%اختبار%'; delete from notifications where body like '%اختبار%' or title like '%اختبار%';
      delete from audit_logs where coalesce(new_data, old_data)::text like '%اختبار%' or new_data::text like '%20120000093%';`);
    const [left] = await sql(`select (select count(*) from customers)::int c, (select count(*) from register_attempts)::int a, (select count(*) from patients where full_name like '%اختبار%')::int p, (select count(*) from employees where name like '%اختبار%')::int e`);
    console.log('  متبقي من بيانات الاختبار:', JSON.stringify(left));
  } catch (e) { console.log('  تنظيف ناقص:', e.message); }
  save('e2e-patient-results.json');
}
