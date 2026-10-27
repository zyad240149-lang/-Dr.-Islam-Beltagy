// اختبار تكامل للكشف السريري (روشتة/تحاليل/طلبات أشعة/صور أشعة/متابعة) على Supabase الحقيقي.
// مستقل عن حساب المدير: بينشئ طبيب واستقبال ومريض مؤقتين بمفتاح الخدمة ويمسحهم في الآخر.
//   node scripts/e2e-consult.mjs
import { cairoDate, client, deleteEmployee, env, login, sql, suite, URL_ } from './_harness.mjs';

const { check, save } = suite();
const PW = 'Test#' + Math.random().toString(36).slice(2, 10);
const H = { apikey: env.SUPABASE_SERVICE_ROLE_KEY, Authorization: 'Bearer ' + env.SUPABASE_SERVICE_ROLE_KEY, 'Content-Type': 'application/json' };
const created = { employees: [], patient: null, files: [] };

async function tempEmployee(digits, role, name) {
  const r = await fetch(`${URL_}/auth/v1/admin/users`, { method: 'POST', headers: H, body: JSON.stringify({ email: `${digits}@clinic.local`, password: PW, email_confirm: true }) });
  const u = await r.json();
  if (!r.ok) throw new Error('auth user: ' + (u.msg || u.message || JSON.stringify(u)));
  const [e] = await sql(`insert into employees (auth_user_id, name, username, role, phone, job_title) values ('${u.id}', '${name}', '${digits}', '${role}', '+${digits}', '${name}') returning id`);
  created.employees.push(e.id);
  return login(digits, PW);
}

try {
  console.log('— تجهيز حسابات مؤقتة');
  const doc = await tempEmployee('201200000912', 'therapist', 'طبيب اختبار الكشف');
  const recep = await tempEmployee('201200000911', 'reception', 'استقبال اختبار الكشف');
  const [pat] = await sql(`insert into patients (full_name, first_name, father_name, family_name, phone, gender, nationality, referral_source, file_no)
    values ('مريض اختبار الكشف', 'مريض', 'اختبار', 'الكشف', '+201200000998', 'male', 'non_saudi', 'friend', '') returning id`);
  created.patient = pat.id;
  check('تجهيز طبيب واستقبال ومريض للاختبار', doc && recep && created.patient);

  const cons = { patient_id: created.patient, complaint: 'ألم في الركبة (اختبار)', region: 'الركبة', side: 'right', diagnosis: 'خشونة الركبة (اختبار)', plan: 'راحة' };

  console.log('— رفع صورة الأشعة');
  const xrayPath = `${created.patient}/xray/e2e-${Date.now()}.png`;
  const png = Uint8Array.from(atob('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg=='), (ch) => ch.charCodeAt(0));
  const up = await doc.storage.from('patient-files').upload(xrayPath, new Blob([png], { type: 'image/png' }), { contentType: 'image/png' });
  check('الطبيب يرفع صورة أشعة في ملف المريض', !up.error, up.error?.message);
  if (!up.error) created.files.push(xrayPath);
  const signed = await doc.storage.from('patient-files').createSignedUrl(xrayPath, 60);
  const fetched = signed.data?.signedUrl ? await fetch(signed.data.signedUrl) : null;
  check('صورة الأشعة تتفتح برابط موقّع', fetched?.ok && fetched.headers.get('content-type')?.includes('image/png'), signed.error?.message ?? fetched?.status);
  const recepView = await recep.storage.from('patient-files').createSignedUrl(xrayPath, 60);
  check('الاستقبال يشوف صورة الأشعة في الكشف', !recepView.error && recepView.data?.signedUrl, recepView.error?.message);
  const anonView = await client().storage.from('patient-files').download(xrayPath);
  check('صورة الأشعة مش متاحة لزائر بدون دخول', !!anonView.error, 'downloaded!');

  console.log('— حفظ واسترجاع الكشف الكامل');
  const meds = [{ name: 'Celecoxib 200mg', dose: 'كبسولة', frequency: 'مرة يوميًا', duration: '10 أيام', notes: '' }, { name: 'Esomeprazole 40mg', dose: 'قرص', frequency: 'قبل الفطار', duration: '10 أيام', notes: '' }];
  const full = { ...cons, history: 'وقع على السلم من أسبوع — سكر', pain_score: 7, icd10: 'M17.1', medications: meds, labs: ['CBC', 'ESR', 'Vitamin D (25-OH)'], imaging_requests: [{ kind: 'xray', region: 'الركبة', view: 'AP & Lateral' }], attachments: [{ path: xrayPath, name: 'knee.png', type: 'image/png', size: png.length }], follow_up: cairoDate(14) };
  const fc = await doc.from('ortho_consultations').insert(full).select().single();
  check('حفظ كشف كامل (تاريخ مرضي + ألم + ICD + روشتة + تحاليل + أشعة + مرفقات + متابعة)', !fc.error && fc.data?.id, fc.error?.message);
  const back = fc.data && (await recep.from('ortho_consultations').select('*').eq('id', fc.data.id).single()).data;
  // jsonb بيعيد ترتيب مفاتيح الكائن، فالمقارنة حقل بحقل
  const sameMeds = (a, b) => a?.length === b.length && b.every((m, i) => Object.keys(m).every((k) => a[i][k] === m[k]));
  check('الروشتة والتحاليل والمرفقات راجعة زي ما اتحفظت', back && sameMeds(back.medications, meds) && back.labs.length === 3 && back.attachments[0]?.path === xrayPath && back.pain_score === 7 && back.icd10 === 'M17.1' && back.follow_up === full.follow_up && back.history === full.history,
    JSON.stringify(back && { m: back.medications?.length, l: back.labs, p: back.pain_score, f: back.follow_up }));
  const edited = await doc.from('ortho_consultations').update({ medications: [meds[0]], pain_score: 4 }).eq('id', fc.data?.id).select().single();
  check('تعديل الروشتة ودرجة الألم', !edited.error && edited.data?.medications.length === 1 && edited.data.pain_score === 4, edited.error?.message);
  const recepEdit = await recep.from('ortho_consultations').update({ pain_score: 1 }).eq('id', fc.data?.id).select('id');
  check('الاستقبال ما يقدرش يعدّل الكشف', !!recepEdit.error || (recepEdit.data ?? []).length === 0, 'updated!');

  console.log('— قيود القاعدة');
  const badPain = await doc.from('ortho_consultations').insert({ ...cons, pain_score: 11 }).select();
  check('درجة ألم أكبر من 10 مرفوضة', !!badPain.error, badPain.error?.message ?? 'accepted!');
  const badMeds = await doc.from('ortho_consultations').insert({ ...cons, medications: { name: 'x' } }).select();
  check('الأدوية لازم تكون قائمة', !!badMeds.error, badMeds.error?.message ?? 'accepted!');
  const plain = await doc.from('ortho_consultations').insert(cons).select().single();
  check('كشف من غير الحقول الجديدة بيتحفظ بقيم افتراضية', !plain.error && Array.isArray(plain.data?.medications) && plain.data.medications.length === 0 && plain.data.pain_score === null && plain.data.follow_up === null, plain.error?.message);

  console.log('— طلب الأشعة في «الأشعة والتحاليل»');
  const imgReq = await doc.from('ortho_imaging').insert({ patient_id: created.patient, kind: 'xray', region: 'الركبة — AP & Lateral', requested_at: full.date ?? cairoDate(0), status: 'requested' }).select().single();
  check('طلب الأشعة من الكشف بيتسجل كـ «مطلوبة»', !imgReq.error && imgReq.data?.status === 'requested', imgReq.error?.message);

  console.log('— حذف الكشف ومرفقاته');
  const del = await doc.from('ortho_consultations').delete().eq('id', fc.data?.id).select('id');
  check('حذف الكشف', !del.error, del.error?.message);
  const rm = await doc.storage.from('patient-files').remove([xrayPath]);
  check('حذف صورة الأشعة من التخزين', !rm.error && (rm.data ?? []).length === 1, rm.error?.message ?? rm.data?.length);
  if (!rm.error) created.files = [];
} catch (e) {
  check('تنفيذ الاختبارات بدون أخطاء غير متوقعة', false, e.message);
} finally {
  console.log('— تنظيف بيانات الاختبار');
  try {
    if (created.files.length) await fetch(`${URL_}/storage/v1/object/patient-files`, { method: 'DELETE', headers: H, body: JSON.stringify({ prefixes: created.files }) });
    if (created.patient) await sql(`delete from ortho_consultations where patient_id = '${created.patient}'; delete from ortho_imaging where patient_id = '${created.patient}'; delete from patients where id = '${created.patient}';`);
    for (const id of created.employees) await deleteEmployee(id);
    console.log('  تم');
  } catch (e) { console.log('  تعذّر التنظيف:', e.message); }
  save('e2e-consult-results.json');
}
