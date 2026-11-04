// اختبار ترابط الأقسام داخل معاملة بتتلغي بالكامل: node scripts/test-rollback-sections.mjs [migration.sql ...]
import { tx, migration, report } from './_rollback.mjs';
import { sql } from './_env.mjs';
import { writeFileSync } from 'node:fs';

const [admin] = await sql(`select auth_user_id a, id e, therapist_id t from employees where role = 'system_admin' and active and auth_user_id is not null limit 1`);
const [recep] = await sql(`select auth_user_id a, id e from employees where role in ('reception', 'secretary') and active and auth_user_id is not null limit 1`);
const [doc] = await sql(`select auth_user_id a, id e, therapist_id t from employees where role = 'therapist' and active and auth_user_id is not null limit 1`);
const [svc] = await sql(`select s.id, s.price from services s where s.active and s.price > 0 order by s.price limit 1`);
const [wh] = await sql(`select id from therapists where active order by name limit 1`);
const TH = admin.t || wh.id;

const set = (k, v) => `insert into _s values ('${k}', (${v})::text) on conflict (k) do update set v = excluded.v`;
const get = (k) => `(select v from _s where k = '${k}')`;
const eq = (a, b, msg) => `if (${a}) is distinct from (${b}) then raise exception '${msg}: % بدل %', (${a}), (${b}); end if`;
// يوم شغل جاي: بيتخطى الجمعة وأيام الإغلاق، والوقت بييجي من دوام الطبيب الفعلي
const day = `(select v::date from _s where k = 'day')`;

const t = tx();
for (const f of process.argv.slice(2)) t.raw(migration(f));
t.raw(`create temp table _s (k text primary key, v text); grant all on _s to public;`)
  .raw(`insert into _s values ('day', (select d::text from generate_series(current_date + 21, current_date + 60, interval '1 day') d where extract(dow from d) not in (5) limit 1));`)
  .raw(`insert into _s select 'p' || g, gen_random_uuid()::text from generate_series(1, 3) g;`);
for (const n of [1, 2, 3]) t.raw(`insert into patients (id, file_no, full_name, first_name, father_name, family_name, phone, gender, national_id, nationality, birth_date, city, district, street, address)
  values ((select v::uuid from _s where k='p${n}'), '', 'مريض رول باك ${['الأول', 'الثاني', 'الثالث'][n - 1]} تجريبي', 'مريض', 'رول', 'باك تجريبي', '+20109${n}${String(1000000 + Math.floor(Math.random() * 8999999)).slice(0, 7)}', 'male', '2${n}' || lpad((floor(random()*1e12))::bigint::text, 12, '0'), 'saudi', '1990-01-01', 'دسوق', 'حي', 'شارع', 'عنوان');`);

// ===== المرضى =====
t.as(recep.a)
  .ok('المرضى: البحث بالاسم', `if (list_patients('رول باك الأول', '', '', '', null, 'registered_desc', 5, 0, '')::text) not like '%رول باك الأول%' then raise exception 'مش لاقيه'; end if`)
  .ok('المرضى: البحث برقم الملف', `if (list_patients((select file_no from patients where id = ${get('p1')}::uuid), '', '', '', null, 'registered_desc', 5, 0, '')::text) not like '%رول باك الأول%' then raise exception 'مش لاقيه'; end if`)
  .ok('المرضى: البحث بالهاتف', `if (list_patients((select phone from patients where id = ${get('p1')}::uuid), '', '', '', null, 'registered_desc', 5, 0, '')::text) not like '%رول باك الأول%' then raise exception 'مش لاقيه'; end if`);

// ===== الحجز =====
const book = (pid, time) => `book_appointment(jsonb_build_object('patientId', ${pid}, 'type', 'initial', 'location', 'center', 'serviceId', '${svc.id}', 'therapistId', '${TH}', 'date', ${day}, 'time', '${time}'))`;
t.ok('الحجز: الاستقبال يحجز موعد', `perform set_config('app.x', '', true); ${set('a1', `(${book(get('p1'), '16:00')}->>'id')`)}; ${eq(`(select status from appointments where id = ${get('a1')}::uuid)`, `'new'`, 'الحالة')}`)
  .rejects('الحجز: نفس الطبيب ونفس الوقت لمريض تاني مرفوض', `perform ${book(get('p2'), '16:00')}`)
  .ok('الحجز: الحجز بيعمل فاتورة واحدة بسعر الخدمة', `${eq(`(select count(*) from invoices where appointment_id = ${get('a1')}::uuid)`, '1', 'عدد الفواتير')}; ${eq(`(select price from invoices where appointment_id = ${get('a1')}::uuid)`, String(svc.price), 'السعر')}`)
  .ok('الحجز: إعادة الجدولة بتحرر الوقت القديم', `perform reschedule_appointment(${get('a1')}::uuid, ${day}, '17:00', '${TH}', null); ${set('a2', `(${book(get('p2'), '16:00')}->>'id')`)}`)
  .ok('الحجز: الإلغاء بيتسجل ويحرر الوقت', `perform set_appointment_status(${get('a2')}::uuid, 'cancelled', 'اختبار', null); ${eq(`(select status from appointments where id = ${get('a2')}::uuid)`, `'cancelled'`, 'الحالة')}; perform ${book(get('p3'), '16:00')}`);

// ===== الفواتير =====
t.as(admin.a)
  .ok('الفواتير: إنشاء يدوي بإجمالي صحيح', `${set('inv', `(create_invoice(jsonb_build_object('patientId', ${get('p1')}, 'items', jsonb_build_array(jsonb_build_object('description', 'أشعة', 'qty', 2, 'unitPrice', 150)), 'discount', 50))->>'id')`)}; ${eq(`(select total from invoices where id = ${get('inv')}::uuid)`, '250', 'الإجمالي')}; ${eq(`(select status from invoices where id = ${get('inv')}::uuid)`, `'due'`, 'الحالة')}`)
  .rejects('الفواتير: خصم أكبر من الإجمالي مرفوض', `perform create_invoice(jsonb_build_object('patientId', ${get('p1')}, 'items', jsonb_build_array(jsonb_build_object('description', 'x', 'qty', 1, 'unitPrice', 10)), 'discount', 50))`)
  .rejects('المدفوعات: دفع أكبر من المتبقي مرفوض', `perform record_payment(${get('inv')}::uuid, 251, 'cash', '')`)
  .ok('المدفوعات: دفعة جزئية بتحسب المتبقي', `perform record_payment(${get('inv')}::uuid, 100, 'cash', ''); ${eq(`(select remaining from invoices where id = ${get('inv')}::uuid)`, '150', 'المتبقي')}; ${eq(`(select status from invoices where id = ${get('inv')}::uuid)`, `'partial'`, 'الحالة')}`)
  .rejects('الفواتير: عليها مدفوعات ماتتلغيش', `perform cancel_invoice(${get('inv')}::uuid)`, 'مدفوعات')
  .ok('التقارير: الإيراد بيزيد بالدفعة فعلًا', `${set('rev', `(report_summary(current_date, current_date)->>'revenue')`)}; if ${get('rev')}::numeric < 100 then raise exception 'الإيراد %', ${get('rev')}; end if`);

// الدفعة الملغاة ماتتحسبش إيراد (بنلغيها زي void_package_payment)
t.as(null).ok('الإلغاء: تجهيز دفعة ملغاة', `update payments set voided_at = now(), void_reason = 'اختبار' where invoice_id = ${get('inv')}::uuid; perform recalc_invoice(${get('inv')}::uuid); ${eq(`(select paid from invoices where id = ${get('inv')}::uuid)`, '0', 'المدفوع')}`);
t.as(admin.a)
  .ok('التقارير: الدفعة الملغاة ماتتحسبش في report_summary', eq(`(report_summary(current_date, current_date)->>'revenue')::numeric`, `${get('rev')}::numeric - 100`, 'الإيراد'))
  .ok('الفواتير: الملغاة ماتظهرش في المفوتر', `perform cancel_invoice(${get('inv')}::uuid); ${eq(`(select status from invoices where id = ${get('inv')}::uuid)`, `'cancelled'`, 'الحالة')}`);

// ===== الخدمات =====
t.ok('الخدمات: إضافة', `${set('sv', `(save_service(jsonb_build_object('name', 'خدمة رول باك', 'price', 250, 'durationMin', 20, 'active', true, 'showOnSite', false, 'therapistIds', jsonb_build_array('${TH}')))->>'id')`)}; ${eq(`(select price from services where id = ${get('sv')})`, '250', 'السعر')}`)
  .ok('الخدمات: تعديل السعر وإيقاف', `perform save_service(jsonb_build_object('id', ${get('sv')}, 'name', 'خدمة رول باك', 'price', 300, 'durationMin', 20, 'active', false, 'showOnSite', false, 'therapistIds', jsonb_build_array('${TH}'))); ${eq(`(select price from services where id = ${get('sv')})`, '300', 'السعر')}; ${eq(`(select active from services where id = ${get('sv')})`, 'false', 'الإيقاف')}`)
  .rejects('الخدمات: سعر سالب مرفوض', `perform save_service(jsonb_build_object('name', 'x', 'price', -5, 'durationMin', 20))`)
  .ok('الخدمات: حذف', `perform delete_service(${get('sv')}); ${eq(`(select count(*) from services where id = ${get('sv')} and coalesce(active, false))`, '0', 'لسه مفعلة')}`);

// ===== الموظفين والطلبات =====
t.as(recep.a)
  .rejects('الموظفين: الاستقبال مايوافقش على طلب', `perform decide_staff_request(gen_random_uuid(), '{"approve":true}'::jsonb)`);
t.as(admin.a)
  .ok('الطلبات: تقديم طلب إجازة مربوط بالموظف', `${set('rq', `(create_staff_request(jsonb_build_object('type', 'leave', 'employeeId', '${recep.e}', 'fromDate', ${day}, 'toDate', ${day}, 'reason', 'إجازة رول باك'))->>'id')`)}; ${eq(`(select employee_id from staff_requests where id = ${get('rq')}::uuid)`, `'${recep.e}'::uuid`, 'الموظف')}`)
  .ok('الطلبات: الموافقة بتتحفظ', `perform decide_staff_request(${get('rq')}::uuid, '{"approve":true,"note":"تمام"}'::jsonb); ${eq(`(select status from staff_requests where id = ${get('rq')}::uuid)`, `'approved'`, 'الحالة')}`);

// ===== الدعم الفني =====
t.as(recep.a)
  .ok('الدعم: إنشاء تذكرة باسم صاحبها', `insert into support_tickets (subject, description, category, priority, no, created_by) values ('تذكرة رول باك', 'تفاصيل', 'technical', 'high', '', '${recep.e}') returning id into strict v_detail; ${set('tk', 'v_detail')}; v_detail := ''`);
t.as(admin.a)
  .ok('الدعم: المدير يرد والرد يتحفظ', `insert into support_replies (ticket_id, body, employee_id) values (${get('tk')}::uuid, 'رد', '${admin.e}'); update support_tickets set status = 'resolved' where id = ${get('tk')}::uuid; ${eq(`(select status from support_tickets where id = ${get('tk')}::uuid)`, `'resolved'`, 'الحالة')}`);
t.as(recep.a)
  .ok('الدعم: صاحب التذكرة يشوف الرد', eq(`(select count(*) from support_replies where ticket_id = ${get('tk')}::uuid)`, '1', 'الردود'));

// ===== الإشعارات =====
t.as(null)
  .ok('الإشعارات: نفس الحدث مابيتكررش', `insert into customers (auth_user_id, patient_id, name, phone) values (null, ${get('p3')}::uuid, 'مريض رول باك', (select phone from patients where id = ${get('p3')}::uuid)) returning id into strict v_detail; ${set('cu', 'v_detail')}; v_detail := ''; perform notify_patient(${get('p3')}::uuid, 'invoice', 'فاتورة', 'نص', 'ref-rb-1'); perform notify_patient(${get('p3')}::uuid, 'invoice', 'فاتورة', 'نص', 'ref-rb-1'); ${eq(`(select count(*) from notifications where ref_id = 'ref-rb-1' and customer_id = ${get('cu')}::uuid)`, '1', 'العدد')}`)
  .ok('الإشعارات: مهمة الإرسال بتشتغل', `perform 1 from cron.job where jobname = 'notifications-dispatch' and active`);

// ===== العزل والصلاحيات =====
if (doc) t.as(doc.a).rejects('العزل: الطبيب مايشوفش المالية والرواتب', `perform finance_month(to_char(current_date, 'YYYY-MM'))`);
t.as(recep.a)
  .rejects('الصلاحيات: الاستقبال مايكتبش تشخيص', `insert into ortho_consultations (patient_id, date, complaint, region, side, diagnosis) values (${get('p1')}::uuid, current_date, 'x', 'x', 'right', 'x')`)
  .ok('الصلاحيات: الاستقبال مايشوفش الإيراد', eq(`report_summary(current_date, current_date)->>'revenue'`, 'null::text', 'الإيراد'));
t.as(null);

const results = await t.run();
report(results);
writeFileSync(new URL('../docs/rollback-sections-results.json', import.meta.url), JSON.stringify({ at: new Date().toISOString(), results }, null, 2));
const [{ c, i, a }] = await sql(`select (select count(*)::int from patients) c, (select count(*)::int from invoices) i, (select count(*)::int from appointments) a`);
console.log(`بعد الإلغاء: مرضى ${c} · فواتير ${i} · مواعيد ${a}`);
setTimeout(() => process.exit(process.exitCode ?? 0), 100);
