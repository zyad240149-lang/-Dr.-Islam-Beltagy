// اختبار هجرة 964 (سجل الألم + سجل الروشتات + مصروفات المستلزمات ↔ المخزون) داخل معاملة بتتلغي بالكامل — مفيش حاجة بتتحفظ.
//   node scripts/test-rollback-964.mjs
import { existsSync } from 'node:fs';
import { tx, migration, report } from './_rollback.mjs';
import { sql } from './_env.mjs';

const FILE = '964_pain_rx_history_supply_expenses.sql';
const [admin] = await sql(`select auth_user_id a from employees where role = 'system_admin' and active and auth_user_id is not null limit 1`);
const [recep] = await sql(`select auth_user_id a, role from employees where role in ('reception', 'secretary') and active and auth_user_id is not null limit 1`);
const applied = (await sql(`select count(*)::int n from public._migrations where name = '${FILE}'`))[0].n > 0;

const P = '00000000-0000-4000-8000-000000000964';
const C = '00000000-0000-4000-8000-0000000009c1', N = '00000000-0000-4000-8000-0000000009a1', F = '00000000-0000-4000-8000-0000000009f1';
const IT = '00000000-0000-4000-8000-0000000009e1';
const meds = (note) => JSON.stringify([{ name: 'Brufen 600', dose: 'قرص', frequency: 'مرتين يوميًا', duration: '5 أيام', notes: note }, { name: ' ', dose: '', frequency: '', duration: '', notes: '' }]);
const one = (q) => `(${q})`;

const t = tx();
if (!applied) t.raw(migration(existsSync(new URL(`../supabase/migrations/${FILE}`, import.meta.url)) ? FILE : FILE + '.pending'));
t.raw(`insert into patients (id, full_name, first_name, father_name, family_name, phone, gender, nationality, referral_source, file_no)
  values ('${P}', 'مريض اختبار 964', 'مريض', 'اختبار', '964', '+201200000964', 'male', 'non_saudi', 'friend', '');`)
  .raw(`insert into inventory_items (id, sku, name, category, unit, quantity, min_quantity, cost_price, sale_price, supplier, active) values ('${IT}', 'T964', 'شاش اختبار 964', 'مستلزمات', 'علبة', 10, 5, 15, 0, '', true);`)

  // ---------- الألم ----------
  .ok('تشخيص بدرجة ألم 6 ← صف في سجل الألم بتاريخ الزيارة', `insert into ortho_consultations (id, patient_id, date, complaint, region, side, examination, diagnosis, plan, pain_score, medications)
     values ('${C}', '${P}', '2026-11-01', '', 'الركبة', 'right', '', '', 'راحة نسبية', 6, '${meds('بعد الأكل')}'::jsonb);
     if ${one(`select score from ortho_pain_scores where source = 'consultation' and source_id = '${C}' and visit_date = '2026-11-01'`)} is distinct from 6 then raise exception 'مفيش صف'; end if`)
  .ok('تعديل الدرجة ← نفس الصف بيتحدّث (مفيش تكرار)', `update ortho_consultations set pain_score = 7 where id = '${C}';
     if ${one(`select count(*) from ortho_pain_scores where source_id = '${C}'`)} <> 1 or ${one(`select score from ortho_pain_scores where source_id = '${C}'`)} <> 7 then raise exception 'غلط'; end if`)
  .ok('شيت متابعة بألم 4 ← صف تاني بتاريخه', `insert into ortho_nursing (id, patient_id, date, sheet) values ('${N}', '${P}', '2026-11-08', jsonb_build_object('pain', 4, 'rx', jsonb_build_object('medications', '${meds('قبل النوم')}'::jsonb, 'plan', 'كمادات تلج', 'labs', '["CBC"]'::jsonb, 'imagingRequests', '[]'::jsonb)));
     if ${one(`select score from ortho_pain_scores where source = 'nursing' and source_id = '${N}'`)} is distinct from 4 then raise exception 'مفيش صف'; end if`)
  .ok('مسح الدرجة من الشيت (\'\') ← الصف بيتشال', `update ortho_nursing set sheet = sheet || '{"pain": ""}' where id = '${N}';
     if exists (select 1 from ortho_pain_scores where source_id = '${N}') then raise exception 'لسه موجود'; end if;
     update ortho_nursing set sheet = sheet || '{"pain": 3}' where id = '${N}'`)
  .ok('موعد متابعة بألم 2 ← صف، وإلغاء الموعد بيشيله', `insert into ortho_follow_ups (id, patient_id, date, reason, notes, status, pain_score) values ('${F}', '${P}', '2026-11-09', 'متابعة', '', 'scheduled', 2);
     if ${one(`select score from ortho_pain_scores where source = 'follow_up' and source_id = '${F}'`)} is distinct from 2 then raise exception 'مفيش صف'; end if;
     update ortho_follow_ups set status = 'cancelled' where id = '${F}';
     if exists (select 1 from ortho_pain_scores where source_id = '${F}') then raise exception 'لسه موجود بعد الإلغاء'; end if;
     update ortho_follow_ups set status = 'done' where id = '${F}'`)
  .rejects('درجة ألم 11 في المتابعة مرفوضة', `update ortho_follow_ups set pain_score = 11 where id = '${F}'`)
  .ok('السجل بالترتيب: 7 (1/11) ← 3 (8/11) ← 2 (9/11)', `if ${one(`select string_agg(score::text, ',' order by visit_date) from ortho_pain_scores where patient_id = '${P}'`)} <> '7,3,2' then raise exception '%', ${one(`select string_agg(score::text, ',' order by visit_date) from ortho_pain_scores where patient_id = '${P}'`)}; end if`)

  // ---------- الروشتات ----------
  .ok('روشتة التشخيص ← نسخة 1 بدواء واحد (السطر الفاضي اتشال) وملاحظته «بعد الأكل»', `if ${one(`select count(*) from ortho_prescriptions where source_id = '${C}'`)} <> 1 then raise exception 'عدد النسخ'; end if;
     if ${one(`select string_agg(i.name || '|' || i.notes, ',') from ortho_prescription_items i join ortho_prescriptions r on r.id = i.prescription_id where r.source_id = '${C}'`)} <> 'Brufen 600|بعد الأكل' then raise exception 'الأصناف'; end if;
     if ${one(`select instructions from ortho_prescriptions where source_id = '${C}'`)} <> 'راحة نسبية' then raise exception 'التعليمات'; end if`)
  .ok('حفظ نفس الروشتة تاني ← مفيش نسخة جديدة', `update ortho_consultations set diagnosis = 'خشونة' where id = '${C}';
     if ${one(`select count(*) from ortho_prescriptions where source_id = '${C}'`)} <> 1 then raise exception 'اتكررت'; end if`)
  .ok('تعديل ملاحظة الدواء ← نسخة 2 والقديمة لسه محفوظة', `update ortho_consultations set medications = '${meds('قبل النوم')}'::jsonb where id = '${C}';
     if ${one(`select string_agg(r.version || ':' || i.notes, ',' order by r.version) from ortho_prescriptions r join ortho_prescription_items i on i.prescription_id = r.id where r.source_id = '${C}'`)} <> '1:بعد الأكل,2:قبل النوم' then raise exception 'النسخ غلط'; end if`)
  .ok('روشتة شيت المتابعة ← سجل لوحدها بالتحاليل والتعليمات', `if ${one(`select count(*) from ortho_prescriptions where source = 'nursing' and source_id = '${N}' and instructions = 'كمادات تلج' and labs = '["CBC"]'::jsonb`)} <> 1 then raise exception 'مش متسجلة'; end if;
     update ortho_nursing set sheet = sheet || '{"pain": 5}' where id = '${N}';
     if ${one(`select count(*) from ortho_prescriptions where source_id = '${N}'`)} <> 1 then raise exception 'تعديل الألم عمل نسخة روشتة'; end if`)
  .ok('حذف التشخيص ← درجة الألم بتاعته بتتشال والروشتات بتفضل في السجل', `delete from ortho_consultations where id = '${C}';
     if exists (select 1 from ortho_pain_scores where source_id = '${C}') then raise exception 'الألم لسه موجود'; end if;
     if ${one(`select count(*) from ortho_prescriptions where source_id = '${C}'`)} <> 2 then raise exception 'الروشتات اتمسحت'; end if`)

  // ---------- المصروفات ↔ المخزون (بهوية المدير) ----------
  .as(admin.a)
  .ok('شراء 5 علب × 20 ← مصروف 100 والرصيد 15 وحركة توريد مربوطة بالمصروف', `perform save_supply_expense('{"key":"k964-a","itemId":"${IT}","quantity":5,"unitPrice":20,"purchaseDate":"2026-11-10","description":"اختبار 964"}'::jsonb);
     if ${one(`select amount from expenses where idem_key = 'k964-a'`)} <> 100 then raise exception 'المبلغ'; end if;
     if ${one(`select category from expenses where idem_key = 'k964-a'`)} <> 'مستلزمات طبية' then raise exception 'البند'; end if;
     if ${one(`select quantity from inventory_items where id = '${IT}'`)} <> 15 then raise exception 'الرصيد'; end if;
     if ${one(`select count(*) from stock_movements m join expenses e on e.id = m.expense_id where e.idem_key = 'k964-a' and m.type = 'purchase' and m.quantity = 5 and m.unit_cost = 20`)} <> 1 then raise exception 'الحركة'; end if`)
  .ok('نفس الطلب تاني (إعادة إرسال) ← مفيش مصروف ولا كمية زيادة', `if not (save_supply_expense('{"key":"k964-a","itemId":"${IT}","quantity":5,"unitPrice":20}'::jsonb)->>'duplicate')::boolean then raise exception 'مش متعلّم مكرر'; end if;
     if ${one(`select count(*) from expenses where idem_key = 'k964-a'`)} <> 1 or ${one(`select quantity from inventory_items where id = '${IT}'`)} <> 15 then raise exception 'اتكرر'; end if;
     if ${one(`select count(*) from stock_movements where item_id = '${IT}'`)} <> 1 then raise exception 'حركة مكررة'; end if`)
  .ok('تعديل الكمية من 5 لـ 3 ← تسوية بالنقص 2 والمبلغ 60 (وإعادة نفس التعديل مابتخصمش تاني)', `perform save_supply_expense(jsonb_build_object('id', ${one(`select id from expenses where idem_key = 'k964-a'`)}, 'key', 'k964-e1', 'itemId', '${IT}', 'quantity', 3, 'unitPrice', 20));
     perform save_supply_expense(jsonb_build_object('id', ${one(`select id from expenses where idem_key = 'k964-a'`)}, 'key', 'k964-e1', 'itemId', '${IT}', 'quantity', 3, 'unitPrice', 20));
     if ${one(`select quantity from inventory_items where id = '${IT}'`)} <> 13 then raise exception 'الرصيد %', ${one(`select quantity from inventory_items where id = '${IT}'`)}; end if;
     if ${one(`select amount from expenses where idem_key = 'k964-a'`)} <> 60 then raise exception 'المبلغ'; end if`)
  .rejects('تعديل مصروف المستلزمات من «save_expense» العادي مرفوض', `perform save_expense(jsonb_build_object('id', ${one(`select id from expenses where idem_key = 'k964-a'`)}, 'category', 'مستلزمات طبية', 'amount', 999))`, 'مربوط بالمخزون')
  .ok('صرف 9 ← الرصيد 4 (أقل من الحد الأدنى 5) وإشعار «قارب على النفاد»', `perform add_stock_movement('{"itemId":"${IT}","type":"issue","quantity":9,"reference":"استخدام في الجبس","key":"k964-i"}'::jsonb);
     if ${one(`select quantity from inventory_items where id = '${IT}'`)} <> 4 then raise exception 'الرصيد'; end if;
     if not exists (select 1 from notifications where title = 'صنف قارب على النفاد' and body like 'شاش اختبار 964%') then raise exception 'مفيش إشعار'; end if`)
  .rejects('حذف مصروف اتصرف من كميته مرفوض (الشراء والصرف جوّه الفحص بيتلغوا معاه)', `perform save_supply_expense('{"key":"k964-b","itemId":"${IT}","quantity":2,"unitPrice":10}'::jsonb);
     perform add_stock_movement('{"itemId":"${IT}","type":"issue","quantity":5,"reference":"استخدام","key":"k964-i2"}'::jsonb);
     perform delete_expense(${one(`select id from expenses where idem_key = 'k964-b'`)})`, 'اتصرف')
  .ok('حذف مصروف المستلزمات ← الكمية بترجع من المخزون', `perform add_stock_movement('{"itemId":"${IT}","type":"purchase","quantity":10,"unitCost":15,"key":"k964-p"}'::jsonb);
     perform delete_expense(${one(`select id from expenses where idem_key = 'k964-a'`)});
     if exists (select 1 from expenses where idem_key = 'k964-a') then raise exception 'المصروف لسه موجود'; end if;
     if ${one(`select quantity from inventory_items where id = '${IT}'`)} <> 11 then raise exception 'الرصيد %', ${one(`select quantity from inventory_items where id = '${IT}'`)}; end if`)
  .ok('المصروف العادي بمفتاح: ضغطتين = مصروف واحد', `perform save_expense('{"key":"k964-n","category":"نثريات","amount":12}'::jsonb); perform save_expense('{"key":"k964-n","category":"نثريات","amount":12}'::jsonb);
     if ${one(`select count(*) from expenses where idem_key = 'k964-n'`)} <> 1 then raise exception 'اتكرر'; end if`)
  .rejects('شراء من غير منتج مرفوض', `perform save_supply_expense('{"key":"k964-x","quantity":1,"unitPrice":1}'::jsonb)`, 'اختار المنتج')
  .rejects('شراء بكمية صفر مرفوض', `perform save_supply_expense('{"key":"k964-y","itemId":"${IT}","quantity":0,"unitPrice":1}'::jsonb)`, 'الكمية')
  .rejects('الواجهة ماتقدرش تكتب في سجل الألم بإيدها', `insert into ortho_pain_scores (patient_id, visit_date, score, source, source_id) values ('${P}', '2026-11-10', 1, 'nursing', gen_random_uuid())`)
  .rejects('الواجهة ماتقدرش تعدّل روشتة قديمة في السجل', `update ortho_prescription_items set notes = 'x' where patient_id = '${P}'; if not found then raise exception 'ممنوع (مفيش صفوف ظاهرة للتعديل)'; end if`)
  .as(null);

// ---------- الصلاحيات: استقبال/سكرتير بـ«المصروفات» كاملة بس من غير «المخزون/تعديل» ----------
if (recep) {
  t.raw(`insert into role_permissions (role, area, ops) values ('${recep.role}', 'expenses', '{view,create,edit,delete}'), ('${recep.role}', 'inventory', '{view}') on conflict (role, area) do update set ops = excluded.ops;`)
    .raw(`update employees set perm_override = null where auth_user_id = '${recep.a}';`)
    .as(recep.a)
    .rejects('من غير «المخزون: تعديل»: الخادم يرفض شراء مستلزمات للمخزون', `perform save_supply_expense('{"key":"k964-r","itemId":"${IT}","quantity":1,"unitPrice":1}'::jsonb)`, 'صلاحية')
    .ok('بس يقدر يسجّل مصروف عادي', `perform save_expense('{"key":"k964-r2","category":"نثريات","amount":5}'::jsonb)`)
    .as(null);
}
report(await t.run());
