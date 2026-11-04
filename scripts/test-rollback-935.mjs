// اختبار هجرات 934 و935 داخل معاملة بتتلغي بالكامل: node scripts/test-rollback-935.mjs
import { tx, migration, report } from './_rollback.mjs';
import { sql } from './_env.mjs';
import { writeFileSync } from 'node:fs';

const [admin] = await sql(`select auth_user_id a, therapist_id t from employees where role = 'system_admin' and active and auth_user_id is not null limit 1`);
const [recep] = await sql(`select auth_user_id a from employees where role in ('reception', 'secretary') and active and auth_user_id is not null limit 1`);
if (!admin || !recep) throw new Error('مفيش حساب مدير/استقبال للاختبار');

const set = (k, v) => `insert into _s values ('${k}', (${v})::text) on conflict (k) do update set v = excluded.v`;
const get = (k) => `(select v from _s where k = '${k}')`;
const eq = (a, b, msg) => `if (${a}) is distinct from (${b}) then raise exception '${msg}: %', (${a}); end if`;

const t = tx()
  .raw(migration('934_register_requires_gender.sql'))
  .raw(migration('935_surgery_stages_followup_kind_inventory.sql'))
  .raw(`create temp table _s (k text primary key, v text); grant all on _s to public;`)
  .raw(`insert into _s values ('p', (select id::text from (insert_placeholder) x));`.replace(`(select id::text from (insert_placeholder) x)`, `gen_random_uuid()::text`))
  .raw(`insert into patients (id, file_no, full_name, first_name, father_name, family_name, phone, gender, national_id, nationality)
        values ((select v::uuid from _s where k='p'), '', 'مريض رول باك تجريبي', 'مريض', 'رول', 'باك تجريبي', '+201099999' || lpad((floor(random()*999))::text, 3, '0'), 'male', '2' || lpad((floor(random()*1e13))::bigint::text, 13, '0'), 'saudi');`);

// ===== التسجيل =====
t.as(null)
  .rejects('التسجيل: النوع فاضي مرفوض', `perform register_customer(gen_random_uuid(), 'محمد أحمد علي', '+201000000111', '', null, null)`, 'النوع')
  .rejects('التسجيل: نوع غير صحيح مرفوض', `perform register_customer(gen_random_uuid(), 'محمد أحمد علي', '+201000000111', '', null, 'x')`, 'النوع');

// ===== العمليات =====
t.as(admin.a)
  .ok('العملية: إنشاء بالمريض والاسم والمستشفى', `insert into ortho_surgeries (patient_id, procedure, region, side, hospital, date, implant, status, notes) values (${get('p')}::uuid, 'تثبيت كسر', 'الساق', 'right', 'مستشفى دسوق', current_date, '', 'in_progress', '') returning id into strict v_detail; ${set('s', 'v_detail')}; v_detail := ''`)
  .rejects('العملية: الإنهاء من التعديل المباشر مرفوض', `update ortho_surgeries set status = 'done' where id = ${get('s')}::uuid`, 'إنهاء')
  .rejects('العملية: الإنهاء من غير مراحل مرفوض', `perform finish_surgery(jsonb_build_object('id', ${get('s')}, 'price', 1000))`, 'مراحل')
  .ok('العملية: مراحل يكتبها الطبيب بأي عدد', `insert into ortho_surgery_stages (surgery_id, position, name, details) select ${get('s')}::uuid, g, 'مرحلة ' || g, 'تفاصيل' from generate_series(1, 7) g; ${eq(`(select count(*) from ortho_surgery_stages where surgery_id = ${get('s')}::uuid)`, '7', 'عدد المراحل')}`)
  .rejects('العملية: مراحل ماخلصتش تمنع الإنهاء', `perform finish_surgery(jsonb_build_object('id', ${get('s')}, 'price', 1000))`, 'ماخلصتش')
  .ok('العملية: تحديث الحالة بيسجل وقت الإنجاز', `update ortho_surgery_stages set status = 'done' where surgery_id = ${get('s')}::uuid; ${eq(`(select count(*) from ortho_surgery_stages where surgery_id = ${get('s')}::uuid and done_at is null)`, '0', 'done_at')}`)
  .rejects('العملية: مدفوع أكبر من المستحق مرفوض', `perform finish_surgery(jsonb_build_object('id', ${get('s')}, 'price', 100, 'paid', 200, 'method', 'cash'))`, 'أكبر');

// ===== المخزون =====
t.ok('المخزون: إضافة صنف بكود ورصيد', `perform save_item('{"sku":"RB-TEST-1","name":"شاش اختبار","unit":"علبة","quantity":10,"minQuantity":3,"costPrice":5}'::jsonb); ${set('i', `(select id from inventory_items where sku = 'RB-TEST-1')`)}`)
  .rejects('المخزون: كود مكرر مرفوض', `perform save_item('{"sku":"rb-test-1","name":"تاني"}'::jsonb)`, 'الكود')
  .rejects('المخزون: صرف من غير سبب مرفوض', `perform add_stock_movement(jsonb_build_object('itemId', ${get('i')}, 'type', 'issue', 'quantity', 1))`, 'سبب')
  .ok('المخزون: صرف بيخصم ويسجل الرصيد والمسؤول', `perform add_stock_movement(jsonb_build_object('itemId', ${get('i')}, 'type', 'issue', 'quantity', 2, 'reference', 'غرفة الجبس')); ${eq(`(select quantity from inventory_items where id = ${get('i')}::uuid)`, '8', 'الرصيد')}; ${eq(`(select balance_after from stock_movements where item_id = ${get('i')}::uuid and type = 'issue')`, '8', 'الرصيد بعد الحركة')}; ${eq(`(select employee_id is not null from stock_movements where item_id = ${get('i')}::uuid and type = 'issue')`, 'true', 'المسؤول')}`)
  .ok('المخزون: نفس المفتاح مابيخصمش مرتين', `perform add_stock_movement(jsonb_build_object('itemId', ${get('i')}, 'type', 'issue', 'quantity', 1, 'reference', 'x', 'key', 'k1')); perform add_stock_movement(jsonb_build_object('itemId', ${get('i')}, 'type', 'issue', 'quantity', 1, 'reference', 'x', 'key', 'k1')); ${eq(`(select quantity from inventory_items where id = ${get('i')}::uuid)`, '7', 'الرصيد')}`)
  .rejects('المخزون: صرف فوق المتاح مرفوض', `perform add_stock_movement(jsonb_build_object('itemId', ${get('i')}, 'type', 'issue', 'quantity', 100, 'reference', 'x'))`, 'المتاحة')
  .ok('المخزون: تنبيه عند الوصول للحد الأدنى', `perform add_stock_movement(jsonb_build_object('itemId', ${get('i')}, 'type', 'issue', 'quantity', 4, 'reference', 'x')); ${eq(`(select quantity from inventory_items where id = ${get('i')}::uuid)`, '3', 'الرصيد')}`)
  .rejects('المخزون: صنف له حركات مايتمسحش', `perform delete_item(${get('i')}::uuid)`, 'متوقف')
  .ok('المخزون: تقرير الرصيد والقيمة صحيح', `${eq(`(select (r->>'closing')::numeric from jsonb_array_elements(inventory_report(current_date, current_date)->'rows') r where r->>'sku' = 'RB-TEST-1')`, '3', 'الإقفال')}; ${eq(`(select (r->>'value')::numeric from jsonb_array_elements(inventory_report(current_date, current_date)->'rows') r where r->>'sku' = 'RB-TEST-1')`, '15', 'القيمة')}`);

// ===== الإنهاء المالي =====
t.ok('العملية: الإنهاء بيعمل فاتورة ودفعة وخصم مخزون', `perform finish_surgery(jsonb_build_object('id', ${get('s')}, 'price', 1000, 'cost', 400, 'paid', 600, 'method', 'cash', 'supplies', jsonb_build_array(jsonb_build_object('itemId', ${get('i')}, 'qty', 1)))); ${set('inv', `(select invoice_id from ortho_surgeries where id = ${get('s')}::uuid)`)}; ${eq(`(select total from invoices where id = ${get('inv')}::uuid)`, '1000', 'الإجمالي')}; ${eq(`(select paid from invoices where id = ${get('inv')}::uuid)`, '600', 'المدفوع')}; ${eq(`(select remaining from invoices where id = ${get('inv')}::uuid)`, '400', 'المتبقي')}; ${eq(`(select status from invoices where id = ${get('inv')}::uuid)`, `'partial'`, 'حالة الفاتورة')}; ${eq(`(select quantity from inventory_items where id = ${get('i')}::uuid)`, '2', 'خصم المخزون')}`)
  .ok('العملية: الضغط على إنهاء مرتين مابيكررش الإيراد', `perform finish_surgery(jsonb_build_object('id', ${get('s')}, 'price', 9999, 'paid', 9999, 'method', 'cash')); ${eq(`(select count(*) from invoices where patient_id = ${get('p')}::uuid)`, '1', 'عدد الفواتير')}; ${eq(`(select count(*) from payments where patient_id = ${get('p')}::uuid)`, '1', 'عدد الدفعات')}; ${eq(`(select price from ortho_surgeries where id = ${get('s')}::uuid)`, '1000', 'السعر')}; ${eq(`(select quantity from inventory_items where id = ${get('i')}::uuid)`, '2', 'خصم مكرر')}`)
  .rejects('العملية: المنتهية مراحلها ماتتعدلش', `update ortho_surgery_stages set name = 'تعديل' where surgery_id = ${get('s')}::uuid`, 'منتهية')
  .rejects('العملية: المنتهية سعرها مايتعدلش', `update ortho_surgeries set price = 1 where id = ${get('s')}::uuid`, 'منتهية')
  .rejects('العملية: عليها فاتورة ماتتمسحش', `delete from ortho_surgeries where id = ${get('s')}::uuid`, 'فاتورة');

// ===== المتابعة والحجز =====
const svc = `(select id from services where active limit 1)`;
const day = (n) => `(current_date + ${n} + case when extract(dow from current_date + ${n}) = 5 then 1 else 0 end)`;
t.ok('المتابعة: جهّز كشف للمريض', `insert into ortho_consultations (patient_id, date, complaint, region, side, diagnosis) values (${get('p')}::uuid, current_date, 'ألم', 'الركبة', 'right', 'تشخيص') returning id into strict v_detail; ${set('c', 'v_detail')}; v_detail := ''`)
  .rejects('المتابعة من التشخيص: النوع إلزامي', `insert into ortho_follow_ups (patient_id, consultation_id, date) values (${get('p')}::uuid, ${get('c')}::uuid, current_date + 7)`, 'نوع')
  .rejects('المتابعة: نوع غير معروف مرفوض', `insert into ortho_follow_ups (patient_id, consultation_id, date, kind) values (${get('p')}::uuid, ${get('c')}::uuid, current_date + 7, 'other')`)
  .as(null)
  .ok('المتابعة: حجز نوعه متابعة بيعمل سجل متابعة واحد', `insert into appointments (no, patient_id, therapist_id, service_id, type, date, time, status) values ('RB-1', ${get('p')}::uuid, '${admin.t}', ${svc}, 'followup', ${day(9)}, '10:00', 'new') returning id into strict v_detail; ${set('a', 'v_detail')}; v_detail := ''; ${eq(`(select count(*) from ortho_follow_ups where appointment_id = ${get('a')}::uuid)`, '1', 'سجلات المتابعة')}`)
  .as(admin.a)
  .ok('المزامنة: تعديل المتابعة بيغيّر الحجز', `update ortho_follow_ups set time = '11:00' where appointment_id = ${get('a')}::uuid; ${eq(`(select time from appointments where id = ${get('a')}::uuid)`, `'11:00'`, 'وقت الحجز')}`)
  .as(null)
  .ok('المزامنة: تعديل الحجز بيغيّر المتابعة', `update appointments set time = '12:00' where id = ${get('a')}::uuid; ${eq(`(select to_char(time, 'HH24:MI') from ortho_follow_ups where appointment_id = ${get('a')}::uuid)`, `'12:00'`, 'وقت المتابعة')}`)
  .as(admin.a)
  .ok('المزامنة: مفيش سجلات مكررة بعد التعديلات', eq(`(select count(*) from ortho_follow_ups where patient_id = ${get('p')}::uuid)`, '1', 'التكرار'))
  .ok('المزامنة: إلغاء المتابعة بيلغي الحجز', `update ortho_follow_ups set status = 'cancelled' where appointment_id = ${get('a')}::uuid; ${eq(`(select status from appointments where id = ${get('a')}::uuid)`, `'cancelled'`, 'حالة الحجز')}`);

// ===== الصلاحيات =====
t.as(recep.a)
  .rejects('الصلاحيات: الاستقبال مايقدرش يصرف فوق المتاح', `perform add_stock_movement(jsonb_build_object('itemId', ${get('i')}, 'type', 'issue', 'quantity', 100, 'reference', 'x', 'overdraw', true))`)
  .rejects('الصلاحيات: دالة الخصم الداخلية مقفولة', `perform stock_move_core(${get('i')}::uuid, 'issue', 1, 0, '', '', null, true, null)`);
t.as(null);

const results = await t.run();
report(results);
writeFileSync(new URL('../docs/rollback-935-results.json', import.meta.url), JSON.stringify({ at: new Date().toISOString(), results }, null, 2));
const [{ c, x }] = await sql(`select (select count(*)::int from patients) c, to_regclass('public.ortho_surgery_stages') x`);
console.log(`بعد الإلغاء: المرضى ${c}، جدول المراحل على الإنتاج: ${x ?? 'مش موجود (الإلغاء شغال)'}`);
setTimeout(() => process.exit(process.exitCode ?? 0), 100);
