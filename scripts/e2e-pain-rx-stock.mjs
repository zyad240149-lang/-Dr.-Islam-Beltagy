// اختبار تكامل لهجرة 964 على Supabase الحقيقي (من غير متصفح): سجل الألم، سجل الروشتات وملاحظة كل دواء، رسالة تذكير واتساب،
// ومصروفات «مستلزمات طبية» ↔ المخزون (idempotent حتى مع طلبين في نفس اللحظة) — والصلاحيات من الخادم.
// مستقل عن حساب المدير الحقيقي: موظفين ومريض وصنف مؤقتين بمفتاح الخدمة، وكل حاجة بتتمسح في الآخر.
//   node scripts/e2e-pain-rx-stock.mjs
import { client, deleteEmployee, env, login, sql, suite, URL_ } from './_harness.mjs';

const { check, section, save } = suite();
const PW = 'Test#' + Math.random().toString(36).slice(2, 10);
const H = { apikey: env.SUPABASE_SERVICE_ROLE_KEY, Authorization: 'Bearer ' + env.SUPABASE_SERVICE_ROLE_KEY, 'Content-Type': 'application/json' };
const made = { employees: [], patient: null, item: null, keys: [] };
const TAG = 'اختبار964';
const one = async (q) => (await sql(q))[0];

async function tempEmployee(digits, role, name, override) {
  const r = await fetch(`${URL_}/auth/v1/admin/users`, { method: 'POST', headers: H, body: JSON.stringify({ email: `${digits}@clinic.local`, password: PW, email_confirm: true }) });
  const u = await r.json();
  if (!r.ok) throw new Error('auth user: ' + (u.msg || u.message || JSON.stringify(u)));
  const [e] = await sql(`insert into employees (auth_user_id, name, username, role, phone, job_title${override ? ', perm_override' : ''})
    values ('${u.id}', '${name}', '${digits}', '${role}', '+${digits}', '${name}'${override ? `, '${JSON.stringify(override)}'::jsonb` : ''}) returning id`);
  made.employees.push(e.id);
  return { c: await login(digits, PW), id: e.id, digits };
}
const meds = (note) => [{ name: 'Brufen 600', dose: 'قرص', frequency: 'مرتين يوميًا', duration: '5 أيام', notes: note }, { name: 'Myolgin', dose: 'كبسولة', frequency: 'مرة يوميًا', duration: '7 أيام', notes: 'قبل النوم' }];
const BASE = { complaint: '', examination: '', diagnosis: '', region: 'الركبة', side: 'right' };

try {
  section('التجهيز');
  const doc = await tempEmployee('201200000961', 'therapist', `طبيب ${TAG}`);
  const recep = await tempEmployee('201200000962', 'reception', `استقبال ${TAG}`);
  const mgr = await tempEmployee('201200000963', 'system_admin', `مدير ${TAG}`);
  // موظف المصروفات من غير «المخزون: تعديل»
  const acc = await tempEmployee('201200000965', 'accountant', `محاسب ${TAG}`, { expenses: ['view', 'create', 'edit', 'delete'], inventory: ['view'] });
  const [p] = await sql(`insert into patients (full_name, first_name, father_name, family_name, phone, gender, nationality, referral_source, file_no)
    values ('مريض ${TAG}', 'مريض', 'اختبار', '${TAG}', '+201200000966', 'male', 'non_saudi', 'friend', '') returning id`);
  made.patient = p.id;
  const [it] = await sql(`insert into inventory_items (sku, name, category, unit, quantity, min_quantity, cost_price, sale_price, supplier, active)
    values ('T964E2E', 'شاش ${TAG}', 'مستلزمات', 'علبة', 10, 5, 15, 0, '', true) returning id`);
  made.item = it.id;
  check('موظفين ومريض وصنف مؤقتين', doc.id && recep.id && mgr.id && acc.id && made.patient && made.item);

  section('1. سجل الألم');
  const c1 = await doc.c.from('ortho_consultations').insert({ ...BASE, patient_id: made.patient, date: '2026-11-01', pain_score: 7, plan: 'راحة نسبية', medications: meds('بعد الأكل') }).select().single();
  check('تشخيص بدرجة ألم 7 اتحفظ', !c1.error, c1.error?.message);
  const n1 = await doc.c.from('ortho_nursing').insert({ patient_id: made.patient, date: '2026-11-08', sheet: { pain: 4, vsLast: 'أقل', rx: { medications: meds('مع الأكل'), plan: 'كمادات تلج', labs: [], imagingRequests: [], attachments: [] } } }).select().single();
  check('شيت متابعة بدرجة ألم 4 اتحفظ', !n1.error, n1.error?.message);
  const f1 = await doc.c.from('ortho_follow_ups').insert({ patient_id: made.patient, date: '2026-11-09', reason: 'متابعة', notes: '', status: 'done', pain_score: 5 }).select().single();
  check('موعد متابعة بدرجة ألم 5 اتحفظ', !f1.error && f1.data?.pain_score === 5, f1.error?.message);
  const hist = (await recep.c.from('ortho_pain_scores').select('visit_date, score, source').eq('patient_id', made.patient).order('visit_date')).data ?? [];
  check('السجل كله مربوط بتاريخ كل زيارة (7 ← 4 ← 5)', hist.map((h) => `${h.visit_date}:${h.score}`).join(',') === '2026-11-01:7,2026-11-08:4,2026-11-09:5', JSON.stringify(hist));
  const bad = await doc.c.from('ortho_follow_ups').update({ pain_score: 12 }).eq('id', f1.data?.id).select();
  check('درجة ألم 12 مرفوضة من الخادم', !!bad.error, 'اتقبلت');
  const direct = await doc.c.from('ortho_pain_scores').insert({ patient_id: made.patient, visit_date: '2026-11-10', score: 1, source: 'nursing', source_id: crypto.randomUUID() });
  check('محدش يكتب في سجل الألم بإيده (التريجر بس)', !!direct.error, 'اتقبل');
  await doc.c.from('ortho_nursing').update({ sheet: { ...n1.data.sheet, pain: 3 } }).eq('id', n1.data?.id);
  const upd = await one(`select count(*)::int n, max(score)::int s from ortho_pain_scores where source_id = '${n1.data?.id}'`);
  check('تعديل الدرجة في نفس الشيت ← نفس الصف (مفيش تكرار)', upd.n === 1 && upd.s === 3, JSON.stringify(upd));

  section('2. سجل الروشتات وملاحظة كل دواء');
  const rx = (await recep.c.from('ortho_prescriptions').select('id, source, version, instructions').eq('patient_id', made.patient).order('rx_date')).data ?? [];
  check('روشتة التشخيص وروشتة شيت المتابعة اتسجلوا', rx.length === 2 && rx[0].instructions === 'راحة نسبية' && rx[1].instructions === 'كمادات تلج', JSON.stringify(rx));
  const items = (await recep.c.from('ortho_prescription_items').select('name, notes, prescription_id').eq('prescription_id', rx[0]?.id).order('position')).data ?? [];
  check('ملاحظة كل دواء محفوظة في عمودها (بعد الأكل / قبل النوم)', items.map((i) => i.notes).join('|') === 'بعد الأكل|قبل النوم', JSON.stringify(items));
  await doc.c.from('ortho_consultations').update({ medications: meds('على الريق') }).eq('id', c1.data?.id);
  const vers = await sql(`select r.version, i.notes from ortho_prescriptions r join ortho_prescription_items i on i.prescription_id = r.id and i.position = 1 where r.source_id = '${c1.data?.id}' order by r.version`);
  check('تعديل الروشتة = نسخة جديدة والقديمة لسه محفوظة', vers.map((v) => `${v.version}:${v.notes}`).join(',') === '1:بعد الأكل,2:على الريق', JSON.stringify(vers));
  await doc.c.from('ortho_consultations').update({ diagnosis: 'خشونة' }).eq('id', c1.data?.id);
  check('حفظ تاني من غير تغيير في الروشتة ← مفيش نسخة زيادة', (await one(`select count(*)::int n from ortho_prescriptions where source_id = '${c1.data?.id}'`)).n === 2);

  section('3. البيانات بترجع بعد الخروج والدخول تاني');
  await recep.c.auth.signOut();
  const again = await login(recep.digits, PW);
  const back = (await again.from('ortho_pain_scores').select('score').eq('patient_id', made.patient)).data ?? [];
  const backRx = (await again.from('ortho_prescription_items').select('notes').eq('patient_id', made.patient)).data ?? [];
  check('بعد الدخول تاني: سجل الألم والروشتات وملاحظات الأدوية موجودين', back.length === 3 && backRx.some((x) => x.notes === 'بعد الأكل') && backRx.some((x) => x.notes === 'على الريق'), `${back.length} ألم، ${backRx.length} دواء`);
  const anon = await client().from('ortho_pain_scores').select('id').eq('patient_id', made.patient);
  check('من غير دخول: مفيش وصول لسجل الألم', (anon.data ?? []).length === 0);

  section('4. تذكير واتساب');
  const wa = await again.rpc('log_whatsapp_message', { p: { patientId: made.patient, phone: '+201200000966', messageContent: `تذكير بموعد المتابعة مع طبيب ${TAG}`, messageType: 'reminder' } });
  check('رسالة التذكير بتتسجّل في سجل الرسائل (الاستقبال)', !wa.error && !!wa.data?.id, wa.error?.message);
  const noPhone = await again.rpc('log_whatsapp_message', { p: { patientId: made.patient, phone: '', messageContent: 'x', messageType: 'reminder' } });
  check('من غير رقم: الخادم بيرفض', !!noPhone.error, 'اتقبلت');

  section('5. مصروفات «مستلزمات طبية» ↔ المخزون');
  const qty = async () => Number((await one(`select quantity from inventory_items where id = '${made.item}'`)).quantity);
  const K = crypto.randomUUID(); made.keys.push(K);
  const body = { key: K, itemId: made.item, quantity: 5, unitPrice: 20, purchaseDate: '2026-11-10', description: TAG, paymentMethod: 'cash' };
  // نفس الطلب مرتين في نفس اللحظة (ضغطتين / إعادة إرسال) ← مصروف واحد وكمية مرة واحدة
  const [a1, a2] = await Promise.all([mgr.c.rpc('save_supply_expense', { p: body }), mgr.c.rpc('save_supply_expense', { p: body })]);
  check('طلبين بنفس المفتاح في نفس اللحظة: الاتنين نجحوا', !a1.error && !a2.error, a1.error?.message || a2.error?.message);
  const exps = await sql(`select id, amount, category, inventory_item_id, quantity, unit_price from expenses where idem_key = '${K}'`);
  check('مصروف واحد بس بالإجمالي المحسوب (5 × 20 = 100)', exps.length === 1 && Number(exps[0].amount) === 100 && exps[0].category === 'مستلزمات طبية', JSON.stringify(exps));
  check('الكمية زادت مرة واحدة بس (10 ← 15)', (await qty()) === 15, await qty());
  const mv = await sql(`select type, quantity, unit_cost, balance_after from stock_movements where expense_id = '${exps[0]?.id}'`);
  check('حركة إضافة واحدة مربوطة بالمصروف', mv.length === 1 && mv[0].type === 'purchase' && Number(mv[0].quantity) === 5 && Number(mv[0].balance_after) === 15, JSON.stringify(mv));
  check('رد الخادم فيه الرصيد الجديد', a1.data?.balance == 15 && a1.data?.low === false, JSON.stringify(a1.data));
  const e1 = await mgr.c.rpc('save_supply_expense', { p: { ...body, id: exps[0]?.id, key: crypto.randomUUID(), quantity: 8 } });
  check('تعديل الكمية لـ 8 ← تسوية بالفرق (+3) والمبلغ 160', !e1.error && (await qty()) === 18 && Number((await one(`select amount from expenses where id = '${exps[0]?.id}'`)).amount) === 160, e1.error?.message ?? await qty());
  const plain = await mgr.c.rpc('save_expense', { p: { id: exps[0]?.id, category: 'مستلزمات طبية', amount: 1 } });
  check('تعديله كمصروف عادي مرفوض (عشان المخزون مايختلفش)', !!plain.error, 'اتقبل');
  const iss = await mgr.c.rpc('add_stock_movement', { p: { itemId: made.item, type: 'issue', quantity: 14, unitCost: 0, reference: `استخدام ${TAG}`, note: '', key: crypto.randomUUID() } });
  check('الصرف بيخصم من المخزون (18 ← 4)', !iss.error && (await qty()) === 4, iss.error?.message);
  const issMv = await one(`select count(*)::int n from stock_movements where item_id = '${made.item}' and type = 'issue' and reference = 'استخدام ${TAG}'`);
  check('حركة خصم متسجّلة بسببها', issMv.n === 1);
  const note = await one(`select count(*)::int n from notifications where ref_id = '${made.item}' and title = 'صنف قارب على النفاد'`);
  check('تنبيه الحد الأدنى (الرصيد 4 أقل من 5) وصل للموظفين', note.n >= 1);
  const del = await mgr.c.rpc('delete_expense', { p_id: exps[0]?.id });
  check('حذف المصروف بعد ما اتصرف من كميته مرفوض', !!del.error && /اتصرف/.test(del.error.message), del.error?.message ?? 'اتقبل');
  const K2 = crypto.randomUUID(); made.keys.push(K2);
  const b2 = await mgr.c.rpc('save_supply_expense', { p: { ...body, key: K2, quantity: 2, unitPrice: 12.5 } });
  const del2 = await mgr.c.rpc('delete_expense', { p_id: b2.data?.id });
  check('حذف مصروف لسه كميته موجودة ← الكمية بترجع (4 ← 6 ← 4)', !b2.error && !del2.error && (await qty()) === 4, (b2.error ?? del2.error)?.message ?? await qty());

  section('6. الصلاحيات على الخادم');
  const deny = await acc.c.rpc('save_supply_expense', { p: { ...body, key: crypto.randomUUID() } });
  check('من غير «المخزون: تعديل»: شراء مستلزمات للمخزون مرفوض', !!deny.error && /صلاحية/.test(deny.error.message), deny.error?.message ?? 'اتقبل');
  const K3 = crypto.randomUUID(); made.keys.push(K3);
  const allow = await acc.c.rpc('save_expense', { p: { key: K3, category: 'نثريات', amount: 7, description: TAG } });
  const allow2 = await acc.c.rpc('save_expense', { p: { key: K3, category: 'نثريات', amount: 7, description: TAG } });
  check('بس يقدر يسجّل مصروف عادي — والضغطة التانية مابتكررهوش', !allow.error && !allow2.error && (await one(`select count(*)::int n from expenses where idem_key = '${K3}'`)).n === 1, allow.error?.message);
  const docExp = await doc.c.rpc('save_supply_expense', { p: { ...body, key: crypto.randomUUID() } });
  check('الطبيب (من غير «المصروفات») مرفوض', !!docExp.error);
} catch (e) {
  check('الاختبار كمّل للآخر', false, e.message);
} finally {
  section('تنظيف');
  const emp = made.employees.map((x) => `'${x}'`).join(',') || 'null';
  if (made.keys.length) await sql(`delete from stock_movements where expense_id in (select id from expenses where idem_key in (${made.keys.map((k) => `'${k}'`).join(',')}))`);
  await sql(`delete from expenses where created_by in (${emp})`);
  if (made.item) await sql(`delete from stock_movements where item_id = '${made.item}'; delete from notifications where ref_id = '${made.item}'; delete from inventory_items where id = '${made.item}'`);
  if (made.patient) await sql(`delete from whatsapp_messages where patient_id = '${made.patient}'; delete from ortho_follow_ups where patient_id = '${made.patient}'; delete from ortho_nursing where patient_id = '${made.patient}'; delete from ortho_consultations where patient_id = '${made.patient}'; delete from patients where id = '${made.patient}'`);
  await sql(`delete from activity_log where employee_id in (${emp})`);
  for (const id of made.employees) await deleteEmployee(id);
  const left = await one(`select (select count(*) from patients where full_name like '%${TAG}%')::int p, (select count(*) from inventory_items where name like '%${TAG}%')::int i,
    (select count(*) from expenses where description = '${TAG}')::int e, (select count(*) from employees where name like '%${TAG}%')::int emp,
    (select count(*) from ortho_prescriptions where patient_id = '${made.patient ?? '00000000-0000-0000-0000-000000000000'}')::int rx`);
  check('كل بيانات الاختبار اتمسحت', !left.p && !left.i && !left.e && !left.emp && !left.rx, JSON.stringify(left));
  save('e2e-pain-rx-stock-results.json');
}
