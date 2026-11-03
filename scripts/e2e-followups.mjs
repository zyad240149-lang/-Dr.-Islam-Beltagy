// اختبار تكامل لهجرة 929 على Supabase الحقيقي: رقم الواتساب، شكوى المريض، ملفات الأشعة والتحاليل من الاستقبال، ومواعيد المتابعة.
// مستقل عن حساب المدير: بينشئ طبيب واستقبال ومريض مؤقتين بمفتاح الخدمة ويمسحهم في الآخر.
//   node scripts/e2e-followups.mjs
import { cairoDate, client, deleteEmployee, env, login, sql, suite, URL_ } from './_harness.mjs';

const { check, save } = suite();
const PW = 'Test#' + Math.random().toString(36).slice(2, 10);
const H = { apikey: env.SUPABASE_SERVICE_ROLE_KEY, Authorization: 'Bearer ' + env.SUPABASE_SERVICE_ROLE_KEY, 'Content-Type': 'application/json' };
const created = { employees: [], patient: null, files: [], consults: [] };

async function tempEmployee(digits, role, name) {
  const r = await fetch(`${URL_}/auth/v1/admin/users`, { method: 'POST', headers: H, body: JSON.stringify({ email: `${digits}@clinic.local`, password: PW, email_confirm: true }) });
  const u = await r.json();
  if (!r.ok) throw new Error('auth user: ' + (u.msg || u.message || JSON.stringify(u)));
  const [e] = await sql(`insert into employees (auth_user_id, name, username, role, phone, job_title) values ('${u.id}', '${name}', '${digits}', '${role}', '+${digits}', '${name}') returning id`);
  created.employees.push(e.id);
  return login(digits, PW);
}
// الأعمدة النصية الإجبارية زي ما الواجهة بتبعتها
const BASE = { complaint: '', examination: '', diagnosis: '', plan: '', region: 'الركبة', side: 'right' };
const PNG = Uint8Array.from(atob('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg=='), (ch) => ch.charCodeAt(0));
const PDF = new TextEncoder().encode('%PDF-1.4\n1 0 obj<</Type/Catalog/Pages 2 0 R>>endobj 2 0 obj<</Type/Pages/Kids[]/Count 0>>endobj\ntrailer<</Root 1 0 R>>\n%%EOF');

try {
  console.log('— تجهيز حسابات مؤقتة');
  // الأرقام لازم تبقى مختلفة عن e2e-consult عشان الاختبارين مايتخانقوش لو اشتغلوا مع بعض
  const doc = await tempEmployee('201200000929', 'therapist', 'طبيب اختبار المتابعات');
  const recep = await tempEmployee('201200000928', 'reception', 'استقبال اختبار المتابعات');
  const [th] = await sql(`select id from therapists where active order by name limit 1`);
  check('تجهيز طبيب واستقبال', doc && recep && th?.id);

  console.log('— 1-3. رقم الواتساب');
  const np = await recep.from('patients').insert({ full_name: 'مريض اختبار المتابعات', first_name: 'مريض', father_name: 'اختبار', family_name: 'المتابعات', phone: '+201200000997', gender: 'male', nationality: 'non_saudi', referral_source: 'friend', file_no: '', whatsapp_mode: 'none' }).select().single();
  created.patient = np.data?.id;
  check('1. تسجيل مريض من غير رقم واتساب', !np.error && np.data?.whatsapp_mode === 'none' && np.data?.whatsapp_phone === '', np.error?.message);
  const def = await sql(`select column_default from information_schema.columns where table_name = 'patients' and column_name = 'whatsapp_mode'`);
  check('المرضى القدام: الواتساب = الرقم الأساسي افتراضيًا', String(def[0]?.column_default).includes("'phone'"), def[0]?.column_default);
  const add = await recep.from('patients').update({ whatsapp_mode: 'other', whatsapp_phone: '+201200000996' }).eq('id', created.patient).select().single();
  check('2. إضافة رقم واتساب لمريض مسجّل بالفعل', !add.error && add.data?.whatsapp_mode === 'other' && add.data?.whatsapp_phone === '+201200000996', add.error?.message);
  const chg = await recep.from('patients').update({ phone2: '+201200000995', whatsapp_mode: 'phone2', whatsapp_phone: '' }).eq('id', created.patient).select().single();
  check('3. تعديل الواتساب ليبقى على الرقم الإضافي', !chg.error && chg.data?.phone2 === '+201200000995' && chg.data?.whatsapp_mode === 'phone2', chg.error?.message);
  const del = await recep.from('patients').update({ whatsapp_mode: 'none', whatsapp_phone: '' }).eq('id', created.patient).select().single();
  check('3. حذف رقم الواتساب', !del.error && del.data?.whatsapp_mode === 'none', del.error?.message);
  const bad = await recep.from('patients').update({ whatsapp_mode: 'fax' }).eq('id', created.patient).select();
  check('قيمة غير صالحة لاختيار الواتساب مرفوضة', !!bad.error, 'accepted!');

  console.log('— 4. شكوى المريض / سبب الزيارة');
  const c1 = await doc.from('ortho_consultations').insert({ ...BASE, patient_id: created.patient, visit_reason: 'ألم في الركبة اليمين من أسبوعين، وتورم بعد المشي' }).select().single();
  if (c1.data) created.consults.push(c1.data.id);
  check('4. حفظ شكوى المريض مع التشخيص', !c1.error && c1.data?.visit_reason?.startsWith('ألم في الركبة'), c1.error?.message);
  const c1back = (await recep.from('ortho_consultations').select('visit_reason').eq('id', c1.data?.id).single()).data;
  check('4. الشكوى بتظهر عند الرجوع للتشخيص', !!c1back?.visit_reason && c1back.visit_reason === c1.data?.visit_reason);

  console.log('— 5-8. الأشعة والتحاليل من الاستقبال');
  const { data: ru } = await recep.auth.getUser();
  const upload = async (name, bytes, type, category, title) => {
    const path = `${created.patient}/e2e-${Date.now()}-${name}`;
    const up = await recep.storage.from('patient-files').upload(path, new Blob([bytes], { type }), { contentType: type });
    if (up.error) return { error: up.error };
    created.files.push(path);
    return recep.from('patient_files').insert({ patient_id: created.patient, uploaded_by: ru.user.id, uploaded_by_name: 'استقبال اختبار المتابعات', file_path: path, file_name: name, file_type: type, size_bytes: bytes.length, note: 'ملاحظة اختبار', category, title, file_date: cairoDate(0) }).select().single();
  };
  const x = await upload('knee.png', PNG, 'image/png', 'xray', 'أشعة عادية على الركبة');
  check('5. الاستقبال يرفع صورة أشعة (Storage + سجل الملف)', !x.error && x.data?.category === 'xray' && x.data?.title === 'أشعة عادية على الركبة', x.error?.message);
  const l = await upload('cbc.pdf', PDF, 'application/pdf', 'lab', 'صورة دم كاملة');
  check('5. الاستقبال يرفع نتيجة تحليل PDF', !l.error && l.data?.category === 'lab' && l.data?.file_date === cairoDate(0), l.error?.message);
  const dl = await doc.from('patient_files').select('*').eq('patient_id', created.patient);
  check('6. الطبيب يشوف الأشعة والتحاليل في ملف المريض', !dl.error && dl.data?.length === 2, dl.error?.message ?? dl.data?.length);
  const c2 = await doc.from('ortho_consultations').insert({ ...BASE, patient_id: created.patient, visit_reason: '' }).select().single();
  if (c2.data) created.consults.push(c2.data.id);
  const dl2 = await doc.from('patient_files').select('id').eq('patient_id', created.patient);
  check('7. تشخيص جديد لنفس المريض: الملفات لسه موجودة ومن غير تكرار', !c2.error && dl2.data?.length === 2 && c2.data?.visit_reason === '', c2.error?.message ?? dl2.data?.length);
  for (const [f, type] of [[x.data, 'image/png'], [l.data, 'application/pdf']]) {
    const s = await doc.storage.from('patient-files').createSignedUrl(f.file_path, 60);
    const r = s.data?.signedUrl ? await fetch(s.data.signedUrl) : null;
    check(`8. معاينة ${type} برابط موقّع`, r?.ok && r.headers.get('content-type')?.includes(type), s.error?.message ?? r?.status);
  }
  const anon = await client().storage.from('patient-files').download(x.data.file_path);
  check('الملفات الطبية مش متاحة لزائر بدون دخول', !!anon.error, 'downloaded!');
  const anonRows = await client().from('patient_files').select('id').eq('patient_id', created.patient);
  check('سجلات الملفات مش ظاهرة لزائر بدون دخول', (anonRows.data ?? []).length === 0);

  console.log('— 11-14. مواعيد المتابعة');
  const f1 = await doc.from('ortho_follow_ups').insert({ patient_id: created.patient, consultation_id: c1.data.id, doctor_id: th.id, date: cairoDate(7), time: '10:30', reason: 'متابعة بعد الحقن', notes: 'يجيب الأشعة' }).select().single();
  check('11. موعد متابعة من داخل التشخيص (مربوط بالمريض والتشخيص والطبيب)', !f1.error && f1.data?.status === 'scheduled' && f1.data?.consultation_id === c1.data.id && f1.data?.doctor_id === th.id, f1.error?.message);
  const f2 = await doc.from('ortho_follow_ups').insert({ patient_id: created.patient, consultation_id: c1.data.id, date: cairoDate(21), reason: 'مراجعة نتيجة التحاليل' }).select().single();
  const f3 = await recep.from('ortho_follow_ups').insert({ patient_id: created.patient, date: cairoDate(0), time: '18:00', reason: 'متابعة من الاستقبال' }).select().single();
  check('12. أكتر من موعد لنفس المريض (طبيب + استقبال)', !f2.error && !f3.error, f2.error?.message ?? f3.error?.message);
  const cal = await recep.from('ortho_follow_ups').select('id').gte('date', cairoDate(0)).lte('date', cairoDate(40)).eq('patient_id', created.patient);
  check('13. كل المتابعات بتظهر في مدى التقويم', cal.data?.length === 3, cal.error?.message ?? cal.data?.length);
  const byConsult = await doc.from('ortho_follow_ups').select('id').eq('consultation_id', c1.data.id);
  check('6. المتابعات المربوطة بالتشخيص', byConsult.data?.length === 2);
  const [pcount] = await sql(`select count(*)::int n from patients where phone = '+201200000997'`);
  check('إضافة متابعات ماعملتش ملف مريض جديد', pcount.n === 1, pcount.n);
  const mv = await recep.from('ortho_follow_ups').update({ date: cairoDate(8), time: '11:00' }).eq('id', f1.data.id).select().single();
  check('14. تعديل موعد المتابعة', !mv.error && mv.data?.date === cairoDate(8) && String(mv.data?.time).startsWith('11:00'), mv.error?.message);
  const cn = await recep.from('ortho_follow_ups').update({ status: 'cancelled' }).eq('id', f2.data.id).select().single();
  check('14. إلغاء موعد المتابعة', !cn.error && cn.data?.status === 'cancelled', cn.error?.message);
  const dn = await doc.from('ortho_follow_ups').update({ status: 'done' }).eq('id', f3.data.id).select().single();
  check('14. إتمام موعد المتابعة', !dn.error && dn.data?.status === 'done', dn.error?.message);
  const badSt = await doc.from('ortho_follow_ups').update({ status: 'missed' }).eq('id', f1.data.id).select();
  check('الحالة المخزّنة مقيّدة (فائتة/اليوم بتتحسب من التاريخ)', !!badSt.error, 'accepted!');
  const recDel = await recep.from('ortho_follow_ups').delete().eq('id', f1.data.id).select('id');
  check('الاستقبال ما يقدرش يحذف موعد متابعة (يلغيه بس)', !!recDel.error || (recDel.data ?? []).length === 0, 'deleted!');
  const anonFu = await client().from('ortho_follow_ups').select('id').eq('patient_id', created.patient);
  check('المتابعات مش ظاهرة لزائر بدون دخول', (anonFu.data ?? []).length === 0);
  await sql(`delete from ortho_consultations where id = '${c1.data.id}'`);
  const [after] = await sql(`select count(*)::int n, count(consultation_id)::int linked from ortho_follow_ups where patient_id = '${created.patient}'`);
  check('حذف التشخيص مابيمسحش المتابعات (بتفضل في ملف المريض)', after.n === 3 && after.linked === 0, JSON.stringify(after));
} catch (e) {
  check('الاختبار اكتمل من غير استثناء', false, e.message);
} finally {
  console.log('— تنظيف');
  if (created.files.length) await fetch(`${URL_}/storage/v1/object/patient-files`, { method: 'DELETE', headers: H, body: JSON.stringify({ prefixes: created.files }) });
  if (created.patient) await sql(`delete from ortho_consultations where patient_id = '${created.patient}'; delete from patients where id = '${created.patient}'`);
  for (const id of created.employees) await deleteEmployee(id);
  save('e2e-followups-results.json');
}
