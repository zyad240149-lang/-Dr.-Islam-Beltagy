// مسح لمرة واحدة (طلب الدكتور ١٠/١١ بالليل — «امسح كله»): البيانات الوهمية/الاختبار اللي فضلت:
//   ٣ تشخيصات فاضية مش مكتملة اتعملت الليلة (كريم اشرف صلاح، عزه فرج خيرالله، احمد حسن برل) + روشتاتها المشتقة
//   المريض الوهمي «عيان وهمي للتشخيص» وكل سجلاته
//   حجز ١١/١١ ٢:١٥ لـ «تيا احمد سالم» وفاتورته (٥٠ جنيه)
//   حساب «مريض حساب تجريبي» (حساب موقع من غير ملف مريض) + حساب الدخول بتاعه
//   مصروف «مصروف اختبار» اللي سابه اختبار
// نسخة احتياطية JSON في backups/ الأول، وبعدين المسح في معاملة واحدة.   --dry = عرض بس
import { writeFileSync, mkdirSync } from 'node:fs';
import { sql } from './_env.mjs';
const dry = process.argv.includes('--dry');
const CONSULTS = ['d7b5a68d-bb61-43ee-aab8-99b58d461e85', 'b9a07b8e-4d21-4b91-bad8-d4f70ba79488', '8023cc51-efe0-45a3-a3c5-865d93e8b786'];
const FAKE_PATIENT = '71477e28-9102-4d9d-a626-567e222a8214';
const APPT = '94fd5b47-d2d5-4d38-b3aa-5cb7b5ac587a';
const CUSTOMER = '8f32d833-1b76-43d8-b081-70006f79c9a7';
const EXPENSE_DESC = 'مصروف اختبار';
const L = (xs) => xs.map((x) => `'${x}'`).join(',');
const q = async (s) => (await sql(s)) ?? [];

const fakeConsults = (await q(`select id from ortho_consultations where patient_id = '${FAKE_PATIENT}'`)).map((r) => r.id);
const allConsults = [...new Set([...CONSULTS, ...fakeConsults])];
const rx = (await q(`select id from ortho_prescriptions where source_id in (${L(allConsults)}) or patient_id = '${FAKE_PATIENT}'`)).map((r) => r.id);
const inv = (await q(`select id from invoices where appointment_id = '${APPT}'`)).map((r) => r.id);
const backup = {
  at: new Date().toISOString(),
  ortho_consultations: await q(`select * from ortho_consultations where id in (${L(allConsults)})`),
  ortho_prescriptions: rx.length ? await q(`select * from ortho_prescriptions where id in (${L(rx)})`) : [],
  ortho_prescription_items: rx.length ? await q(`select * from ortho_prescription_items where prescription_id in (${L(rx)})`) : [],
  ortho_pain_scores: await q(`select * from ortho_pain_scores where source_id in (${L(allConsults)}) or patient_id = '${FAKE_PATIENT}'`),
  patients: await q(`select * from patients where id = '${FAKE_PATIENT}'`),
  appointments: await q(`select * from appointments where id = '${APPT}'`),
  appointment_status_history: await q(`select * from appointment_status_history where appointment_id = '${APPT}'`),
  invoices: inv.length ? await q(`select * from invoices where id in (${L(inv)})`) : [],
  invoice_items: inv.length ? await q(`select * from invoice_items where invoice_id in (${L(inv)})`) : [],
  payments: inv.length ? await q(`select * from payments where invoice_id in (${L(inv)})`) : [],
  customers: await q(`select * from customers where id = '${CUSTOMER}' and not exists (select 1 from patients p where p.id = customers.patient_id)`),
  expenses: await q(`select * from expenses where description = '${EXPENSE_DESC}' and category = 'اختبار'`),
};
console.log('هيتمسح:', JSON.stringify(Object.fromEntries(Object.entries(backup).filter(([k]) => k !== 'at').map(([k, v]) => [k, v.length]))));
if (backup.payments.length) throw new Error('فاتورة الحجز عليها مدفوعات — وقفت');
if (dry) process.exit(0);
mkdirSync(new URL('../backups/', import.meta.url), { recursive: true });
const file = new URL(`../backups/purge-fake-${Date.now()}.json`, import.meta.url);
writeFileSync(file, JSON.stringify(backup, null, 1));
console.log('النسخة الاحتياطية:', decodeURIComponent(file.pathname));
const authUser = backup.customers[0]?.auth_user_id;
await sql(`begin;
  ${rx.length ? `delete from ortho_prescription_items where prescription_id in (${L(rx)}); delete from ortho_prescriptions where id in (${L(rx)});` : ''}
  delete from ortho_pain_scores where source_id in (${L(allConsults)}) or patient_id = '${FAKE_PATIENT}';
  delete from ortho_consultations where id in (${L(allConsults)});
  delete from patients where id = '${FAKE_PATIENT}';
  ${inv.length ? `delete from invoices where id in (${L(inv)});` : ''}
  delete from appointment_status_history where appointment_id = '${APPT}';
  delete from appointments where id = '${APPT}';
  ${backup.customers.length ? `delete from customers where id = '${CUSTOMER}';` : ''}
  ${authUser ? `delete from auth.users where id = '${authUser}';` : ''}
  delete from expenses where description = '${EXPENSE_DESC}' and category = 'اختبار';
commit;`);
const left = await q(`select (select count(*) from ortho_consultations where id in (${L(allConsults)}))::int dx, (select count(*) from patients where id = '${FAKE_PATIENT}')::int fake_patient,
  (select count(*) from appointments where id = '${APPT}')::int appt, (select count(*) from customers where id = '${CUSTOMER}')::int customer, (select count(*) from expenses)::int expenses,
  (select count(*) from patients)::int patients, (select count(*) from ortho_consultations)::int all_dx, (select count(*) from appointments)::int all_appts, (select count(*) from invoices)::int all_inv`);
console.log('بعد المسح:', JSON.stringify(left[0]));
setTimeout(() => process.exit(0), 100);
