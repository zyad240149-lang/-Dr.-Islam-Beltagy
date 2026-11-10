// اختبار هجرة 963 (صلاحية لكل قسم) داخل معاملة بتتلغي بالكامل — مفيش حاجة بتتحفظ: node scripts/test-rollback-963.mjs
import { tx, migration, report } from './_rollback.mjs';
import { sql } from './_env.mjs';
import { existsSync } from 'node:fs';

const [recep] = await sql(`select auth_user_id a, id e, role from employees where role in ('reception', 'secretary') and active and auth_user_id is not null limit 1`);
const R = recep.role;
const before = await sql(`select role, area, ops from role_permissions where area in ('patients','sessions','appointments','financial')`);
const has = (role, area, op) => before.some((r) => r.role === role && r.area === area && r.ops.includes(op));
const want = (role, area, op) => area === 'expenses' ? has(role, 'financial', op)
  : op === 'view' ? has(role, 'patients', 'view')
  : area === 'follow_ups' && op !== 'delete' ? has(role, 'sessions', op) || has(role, 'appointments', op)
  : has(role, 'sessions', op);
const AREAS = ['follow_ups', 'diagnosis', 'imaging', 'injections', 'fractures', 'surgeries', 'nursing', 'medications', 'exercises', 'expenses'];
const OPS = ['view', 'create', 'edit', 'delete'];
const roles = [...new Set(before.map((r) => r.role))];

const t = tx().raw(migration(existsSync(new URL('../supabase/migrations/963_section_permissions.sql', import.meta.url)) ? '963_section_permissions.sql' : '963_section_permissions.sql.pending'));
for (const role of roles) for (const a of AREAS) {
  const exp = OPS.filter((o) => want(role, a, o)).sort().join(',');
  t.ok(`${role} / ${a} = {${exp}} زي ما كان`, `if (select coalesce(array_to_string(array(select unnest(ops) order by 1), ','), '') from role_permissions where role = '${role}' and area = '${a}') is distinct from '${exp}' then raise exception 'لقيت %', (select ops from role_permissions where role = '${role}' and area = '${a}'); end if`);
}
// تقفيل فعلي على الخادم: الموظف (استقبال/سكرتير) بصلاحية الزيارات كاملة بس من غير «الأدوية» ← ممنوع يضيف دواء للبنك
t.raw(`update role_permissions set ops = '{view,create,edit,delete}' where role = '${R}' and area = 'sessions';`)
  .raw(`insert into role_permissions (role, area, ops) values ('${R}', 'medications', '{view}'), ('${R}', 'exercises', '{view,create}'), ('${R}', 'expenses', '{}') on conflict (role, area) do update set ops = excluded.ops;`)
  .as(recep.a)
  .rejects('من غير إضافة «الأدوية»: الخادم يرفض إضافة دواء (رغم صلاحية الزيارات)', `insert into ortho_medications (name) values ('اختبار 963')`)
  .ok('بإضافة «التمرينات العلاجية»: يضيف تمرين', `insert into ortho_exercises (name) values ('اختبار 963')`)
  .rejects('من غير «المصروفات»: يرفض تسجيل مصروف', `perform save_expense('{"category":"اختبار","amount":1}'::jsonb)`)
  .ok('من غير «المصروفات» و«الأرقام المالية»: مايشوفش المصروفات', `if exists (select 1 from expenses) and not (select has_perm('financial','view')) then raise exception 'شايف المصروفات'; end if`)
  .as(null);
report(await t.run());
