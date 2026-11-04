// باقي الأقسام داخل معاملة بتتلغي بالكامل: node scripts/test-rollback-rest.mjs
// اكتمال الملف، الإشعارات والتذكير، الحضور، إيقاف الموظف، التمارين، ملفات الاستقبال، العزل، التقارير.
import { tx, migration, report } from './_rollback.mjs';
import { sql } from './_env.mjs';
import { writeFileSync } from 'node:fs';
import { randomUUID } from 'node:crypto';

const [admin] = await sql(`select auth_user_id a, id e, therapist_id t from employees where role = 'system_admin' and active and auth_user_id is not null limit 1`);
const [recep] = await sql(`select auth_user_id a, id e from employees where role in ('reception', 'secretary') and active and auth_user_id is not null limit 1`);
const [doc] = await sql(`select auth_user_id a, id e from employees where role = 'therapist' and active and auth_user_id is not null limit 1`);
const [svc] = await sql(`select id, price from services where active and price > 0 order by price limit 1`);
const TH = admin.t;
const U1 = randomUUID(), U2 = randomUUID();

const set = (k, v) => `insert into _s values ('${k}', (${v})::text) on conflict (k) do update set v = excluded.v`;
const get = (k) => `(select v from _s where k = '${k}')`;
const eq = (a, b, msg) => `if (${a}) is distinct from (${b}) then raise exception '${msg}: % بدل %', (${a}), (${b}); end if`;
const day = `(select v::date from _s where k = 'day')`;
// العدّ من دالة مؤقتة بصلاحية المالك: الموظف مابيشوفش إشعارات المريض (RLS) فالعدّ بهويته دايمًا صفر
const notifCount = (kind, cust) => `pg_temp.nc('${kind}', ${get(cust)}::uuid)`;
const book = (pid, time) => `book_appointment(jsonb_build_object('patientId', ${pid}, 'type', 'initial', 'location', 'center', 'serviceId', '${svc.id}', 'therapistId', '${TH}', 'date', ${day}, 'time', '${time}'))`;

const t = tx();
t.raw(migration('936_reports_exclude_voided_payments.sql')).raw(migration('937_patient_exercises.sql'));
t.raw(`create function pg_temp.nc(k text, c uuid) returns bigint language sql security definer as $f$ select count(*) from public.notifications where kind = k and customer_id = c $f$;`)
  .raw(`create function pg_temp.nref(r text, c uuid) returns bigint language sql security definer as $f$ select count(*) from public.notifications where ref_id = r and customer_id = c $f$;`)
  .raw(`create temp table _s (k text primary key, v text); grant all on _s to public;`)
  .raw(`insert into _s values ('day', (select d::text from generate_series(current_date + 21, current_date + 60, interval '1 day') d where extract(dow from d) <> 5 limit 1));`)
  .raw(`insert into _s select 'p' || g, gen_random_uuid()::text from generate_series(1, 2) g; insert into _s values ('u1', '${U1}'), ('u2', '${U2}');`);
for (const n of [1, 2]) {
  t.raw(`insert into auth.users (id, email, aud, role) values ((select v::uuid from _s where k='u${n}'), 'rb${n}-' || gen_random_uuid() || '@clinic.local', 'authenticated', 'authenticated');`);
  t.raw(`insert into patients (id, file_no, full_name, first_name, father_name, family_name, phone, gender, nationality, referral_source)
    values ((select v::uuid from _s where k='p${n}'), '', 'مريض رول باك ${n === 1 ? 'الأول' : 'الثاني'} تجريبي', 'مريض', 'رول', 'باك تجريبي', '+20108${n}${String(1000000 + Math.floor(Math.random() * 8999999)).slice(0, 7)}', 'male', 'saudi', 'facebook');`);
  t.raw(`insert into _s values ('c${n}', gen_random_uuid()::text); insert into customers (id, auth_user_id, patient_id, name, phone) values ((select v::uuid from _s where k='c${n}'), (select v::uuid from _s where k='u${n}'), (select v::uuid from _s where k='p${n}'), 'مريض رول', (select phone from patients where id = (select v::uuid from _s where k='p${n}')));`);
}

// ===== اكتمال الملف =====
t.raw(`update patients set gender = null where id = (select v::uuid from _s where k='p2');`);
t.as(recep.a)
  .ok('الاكتمال: مريض من غير نوع يتحجز له', set('a2', `(${book(get('p2'), '18:00')}->>'id')`))
  .rejects('الاكتمال: مريض من غير نوع موعده مايتأكدش', `perform set_appointment_status(${get('a2')}::uuid, 'confirmed', null, null)`, 'غير مكتملة');
t.as(null).raw(`update patients set gender = 'female' where id = (select v::uuid from _s where k='p2');`);
t.as(recep.a)
  .ok('الاكتمال: بعد إدخال النوع الموعد يتأكد', `perform set_appointment_status(${get('a2')}::uuid, 'confirmed', null, null); ${eq(`(select status from appointments where id = ${get('a2')}::uuid)`, `'confirmed'`, 'الحالة')}`);

// ===== الإشعارات =====
t.ok('الإشعار: الحجز بيبعت إشعار لحساب المريض الصحيح', `${set('a1', `(${book(get('p1'), '16:00')}->>'id')`)}; ${eq(notifCount('appointment_new', 'c1'), '1', 'حجز جديد')}; ${eq(`pg_temp.nref(${get('a1')}, ${get('c2')}::uuid)`, '0', 'وصل لحساب غلط')}`)
  .ok('الإشعار: التأكيد مرة واحدة بس', `perform set_appointment_status(${get('a1')}::uuid, 'confirmed', null, null); ${eq(notifCount('appointment_confirmed', 'c1'), '1', 'التأكيد')}`)
  .ok('التذكير: 3 مواعيد 4 و2 وساعة قبل الموعد', eq(`(select array_agg(offset_minutes order by offset_minutes) from notification_schedule where appointment_id = ${get('a1')}::uuid and status = 'pending')`, `array[60, 120, 240]`, 'التذكيرات'));
t.as(null)
  .ok('التذكير: الإرسال بيطلع إشعار واحد ومايتكررش', `update notification_schedule set scheduled_at = now() - interval '1 minute' where appointment_id = ${get('a1')}::uuid and offset_minutes = 60; perform notifications_dispatch(); perform notifications_dispatch(); ${eq(notifCount('appointment_reminder', 'c1'), '1', 'عدد التذكيرات')}; ${eq(`(select status from notification_schedule where appointment_id = ${get('a1')}::uuid and offset_minutes = 60)`, `'sent'`, 'حالة التذكير')}`);
t.as(recep.a)
  .ok('الإشعار: الإلغاء بيوصل ويلغي التذكيرات الباقية', `perform set_appointment_status(${get('a1')}::uuid, 'cancelled', 'اختبار', null); ${eq(notifCount('appointment_cancelled', 'c1'), '1', 'الإلغاء')}; ${eq(`(select count(*) from notification_schedule where appointment_id = ${get('a1')}::uuid and status = 'pending')`, '0', 'تذكيرات باقية')}`);
t.as(admin.a)
  .ok('الإشعار: الفاتورة بتوصل لصاحبها', `${set('inv', `(create_invoice(jsonb_build_object('patientId', ${get('p1')}, 'items', jsonb_build_array(jsonb_build_object('description', 'أشعة', 'qty', 1, 'unitPrice', 200))))->>'id')`)}; if ${notifCount('invoice', 'c1')} < 1 then raise exception 'مفيش إشعار فاتورة'; end if`)
  .ok('الإشعار: الدفعة بتوصل لصاحبها', `perform record_payment(${get('inv')}::uuid, 200, 'cash', ''); execute 'set constraints all immediate'; if ${notifCount('payment', 'c1')} < 1 then raise exception 'مفيش إشعار دفعة'; end if`);

// ===== الحضور =====
t.as(recep.a)
  .rejects('الحضور: انصراف قبل حضور مرفوض', `perform clock_out()`, 'الحضور')
  .ok('الحضور: تسجيل الحضور بتاريخ القاهرة', `perform clock_in(); ${eq(`(my_attendance_today()->>'date')::date`, `(now() at time zone 'Africa/Cairo')::date`, 'التاريخ')}`)
  .ok('الحضور: الحضور مرتين بيحتفظ بأول وقت', `perform clock_in(); ${eq(`(select count(*) from attendance where employee_id = '${recep.e}' and date = (now() at time zone 'Africa/Cairo')::date)`, '1', 'التكرار')}`)
  .ok('الحضور: الانصراف بيتسجل', `perform clock_out(); ${eq(`my_attendance_today()->>'checkOut' is not null`, 'true', 'الانصراف')}`)
  .rejects('الحضور: الانصراف مرتين مرفوض', `perform clock_out()`, 'مسبق')
  .rejects('الحضور: الاستقبال مايشوفش تقرير الكل', `perform * from attendance_report(current_date, current_date)`);
t.as(admin.a)
  .ok('الحضور: المدير يشوف السجل مربوط بالموظف', `if not exists (select 1 from attendance_report((now() at time zone 'Africa/Cairo')::date, (now() at time zone 'Africa/Cairo')::date) r where r.employee_id = '${recep.e}' and r.check_out is not null) then raise exception 'مش ظاهر'; end if`);

// ===== إيقاف الموظف =====
t.as(null).raw(`update employees set active = false where id = '${recep.e}';`);
t.as(recep.a)
  .ok('الموظف الموقوف مايشوفش بيانات المرضى', eq(`(select count(*) from patients)`, '0', 'عدد المرضى'))
  .rejects('الموظف الموقوف مايقدرش يحجز', `perform ${book(get('p1'), '19:00')}`);
t.as(null).raw(`update employees set active = true where id = '${recep.e}';`);

// ===== التمارين =====
t.as(doc?.a ?? admin.a)
  .ok('التمارين: إضافة تمرين بملف فيديو', `insert into ortho_exercises (name, "group", description, media) values ('تمرين رول باك', 'الركبة', 'وصف', '[{"path":"x/video.mp4","type":"video/mp4"}]'::jsonb) returning id into strict v_detail; ${set('ex', 'v_detail')}; v_detail := ''`)
  .ok('التمارين: خطة مربوطة بالمريض', `insert into ortho_exercise_plans (patient_id, date, exercise_ids, notes, share_token) values (${get('p1')}::uuid, current_date, array[${get('ex')}::uuid], 'يوميًا', gen_random_uuid()) returning id into strict v_detail; ${set('pl', 'v_detail')}; v_detail := ''`);
t.as(U1)
  .ok('التمارين: توكن غلط مابيرجّعش حاجة', eq(`jsonb_array_length(exercise_share(gen_random_uuid()))`, '0', 'توكن غلط'))
  .ok('التمارين: المريض يشوف خطته من حسابه', `${eq(`jsonb_array_length(my_exercise_plans())`, '1', 'عدد الخطط')}; ${eq(`my_exercise_plans()->0->'exercises'->0->>'name'`, `'تمرين رول باك'`, 'اسم التمرين')}`)
  .ok('العزل: المريض مايقراش جدول الخطط مباشرة', eq(`(select count(*) from ortho_exercise_plans)`, '0', 'الخطط'))
  .ok('العزل: المريض يشوف فواتيره بس', `${eq(`(select count(*) from invoices where patient_id = ${get('p2')}::uuid)`, '0', 'فواتير غيره')}; if (select count(*) from invoices where patient_id = ${get('p1')}::uuid) < 1 then raise exception 'فواتيره مش ظاهرة'; end if`)
  .ok('العزل: المريض مايشوفش ملف مريض تاني', eq(`(select count(*) from patients where id = ${get('p2')}::uuid)`, '0', 'الملف'))
  .ok('العزل: المريض مايشوفش الموظفين', eq(`(select count(*) from employees)`, '0', 'الموظفين'))
  .ok('العزل: المريض يشوف إشعاراته بس', eq(`(select count(*) from notifications where customer_id = ${get('c2')}::uuid)`, '0', 'إشعارات غيره'));
t.as(U2)
  .ok('العزل: مريض تاني مايشوفش تمارين غيره', eq(`jsonb_array_length(my_exercise_plans())`, '0', 'عدد الخطط'));

// ===== ملفات الاستقبال في التشخيص =====
t.as(recep.a)
  .ok('الملفات: الاستقبال يضيف أشعة لملف المريض', `insert into patient_files (patient_id, uploaded_by, uploaded_by_name, file_path, file_name, file_type, size_bytes, category, title) values (${get('p1')}::uuid, '${recep.a}', 'استقبال', 'rb/x.jpg', 'x.jpg', 'image/jpeg', 10, 'xray', 'أشعة ركبة') returning id into strict v_detail; ${set('f', 'v_detail')}; v_detail := ''`);
t.as(doc?.a ?? admin.a)
  .ok('الملفات: الطبيب يشوف الأشعة', eq(`(select category from patient_files where id = ${get('f')}::uuid)`, `'xray'`, 'الملف'));
t.as(U1).ok('الملفات: المريض يشوف ملفه', eq(`(select count(*) from patient_files where id = ${get('f')}::uuid)`, '1', 'الملف'));
t.as(U2).ok('العزل: مريض تاني مايشوفش الملف', eq(`(select count(*) from patient_files where id = ${get('f')}::uuid)`, '0', 'الملف'));

// ===== التقارير =====
const month = `to_char(now() at time zone 'Africa/Cairo', 'YYYY-MM')`;
const today = `(now() at time zone 'Africa/Cairo')::date`;
t.as(admin.a)
  .ok('التقارير: الإيراد من قاعدة البيانات', `if (report_summary(${today}, ${today})->>'revenue')::numeric < 200 then raise exception 'الإيراد ناقص'; end if`)
  .ok('التقارير: فلتر تاريخ قديم مابيحسبش النهارده', eq(`(report_summary(date '2020-01-01', date '2020-01-02')->>'revenue')::numeric`, '0', 'إيراد فترة قديمة'))
  .rejects('التقارير: فترة معكوسة مرفوضة', `perform report_summary(${today}, ${today} - 5)`)
  .ok('التقارير: التسويق بيحسب مصدر المريض الجديد', `if not exists (select 1 from jsonb_array_elements(marketing_report(${month})->'bySource') s where s->>'source' = 'facebook' and (s->>'n')::int >= 2) then raise exception 'المصدر ناقص: %', marketing_report(${month})->'bySource'; end if`)
  .ok('التقارير: لوحة التحكم فيها الدفعة', `${set('dash', `dashboard_stats(null)->>'monthRevenue'`)}; if ${get('dash')}::numeric < 200 then raise exception 'الإيراد %', ${get('dash')}; end if`);
t.as(null).raw(`update payments set voided_at = now() where invoice_id = (select v::uuid from _s where k = 'inv'); select recalc_invoice((select v::uuid from _s where k = 'inv'));`);
t.as(admin.a)
  .ok('التقارير: لوحة التحكم مابتحسبش الدفعة الملغاة', eq(`(dashboard_stats(null)->>'monthRevenue')::numeric`, `${get('dash')}::numeric - 200`, 'الإيراد'))
  .ok('المالية: الشهر مابيحسبش الدفعة الملغاة', eq(`(select count(*) from jsonb_array_elements(finance_month(${month})->'payments') x where x->>'invoiceNo' = (select no from invoices where id = ${get('inv')}::uuid))`, '0', 'دفعة ملغاة ظاهرة'));
t.as(null);

const results = await t.run();
report(results);
writeFileSync(new URL('../docs/rollback-rest-results.json', import.meta.url), JSON.stringify({ at: new Date().toISOString(), results }, null, 2));
const [{ p, i, a, n, u }] = await sql(`select (select count(*)::int from patients) p, (select count(*)::int from invoices) i, (select count(*)::int from appointments) a, (select count(*)::int from notifications) n, (select count(*)::int from auth.users) u`);
console.log(`بعد الإلغاء: مرضى ${p} · فواتير ${i} · مواعيد ${a} · إشعارات ${n} · حسابات ${u}`);
setTimeout(() => process.exit(process.exitCode ?? 0), 100);
