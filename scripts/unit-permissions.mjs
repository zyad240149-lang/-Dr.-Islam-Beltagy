// اختبارات نظام الصلاحيات (من غير متصفح): كل قسم في القائمة والمسارات ليه صلاحية باسم عربي مطابق وظاهرة في شاشة الأدوار،
// والأدوار الحالية في قاعدة البيانات بتفضل تفتح نفس الأقسام والأزرار اللي كانت بتفتحها قبل فصل أقسام العظام والمصروفات.
//   node scripts/unit-permissions.mjs            (بيقرا role_permissions من Supabase لو .env موجود)
import { build } from 'esbuild';
import { mkdtempSync, writeFileSync, readFileSync, readdirSync, rmSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { pathToFileURL, fileURLToPath } from 'node:url';
import { suite } from './_harness.mjs';

const { check, section, save } = suite();
const ROOT = fileURLToPath(new URL('..', import.meta.url));
const src = (p) => readFileSync(join(ROOT, p), 'utf8');
const fwd = (p) => JSON.stringify(join(ROOT, p).replace(/\\/g, '/'));
const dir = mkdtempSync(join(tmpdir(), 'ortho-perm-'));
const entry = join(dir, 'entry.ts');
writeFileSync(join(dir, 'db-stub.ts'), `export const state: { m: any } = { m: {} };\nexport const db = { permissions: () => state.m };\n`);
writeFileSync(entry, `
export * from ${fwd('src/services/defaultPermissions.ts')};
export { AREA_HELP, AREA_GROUPS } from ${fwd('src/services/permissionHelp.ts')};
export { AREA_LABEL, can, setMyPermOverride, setMyExtraPerms } from ${fwd('src/services/permissions.ts')};
export { state } from './db-stub.ts';
`);
const out = join(dir, 'bundle.mjs');
await build({
  entryPoints: [entry], bundle: true, format: 'esm', platform: 'node', outfile: out, logLevel: 'silent',
  plugins: [{ name: 'db-stub', setup(b) { b.onResolve({ filter: /data\/db$/ }, () => ({ path: join(dir, 'db-stub.ts') })); } }],
});
const P = await import(pathToFileURL(out).href);
rmSync(dir, { recursive: true, force: true });
const { AREAS, AREA_LABEL, AREA_HELP, AREA_GROUPS, ROLES, can, state, setMyPermOverride, withLegacy, defaultPermissions } = P;

// أقسام مش متعرضة في شاشة الأدوار عن قصد (نفس HIDDEN في Roles.tsx + roles/payroll للمدير العام بس)
const rolesSrc = src('src/pages/Roles.tsx');
const HIDDEN = new Set([...rolesSrc.match(/const HIDDEN = new Set<Area>\(\[([\s\S]*?)\]\)/)[1].matchAll(/'([^']+)'/g)].map((m) => m[1]).concat(['roles', 'payroll']));
const inGroups = new Set(AREA_GROUPS.flatMap((g) => g.areas));

section('كل قسم في القائمة الجانبية ليه صلاحية باسمه');
const nav = [...src('src/components/Layout.tsx').matchAll(/\{ to: '([^']+)', label: '([^']+)', icon: '[^']+', area: '([^']+)'(, anyOf)?/g)].map((m) => ({ to: m[1], label: m[2], area: m[3], any: !!m[4] }));
check('القائمة اتقرت', nav.length >= 15, nav.length);
const navCount = nav.reduce((c, n) => ({ ...c, [n.area]: (c[n.area] ?? 0) + 1 }), {});
for (const n of nav) {
  if (n.any) continue; // «مواعيد شغلي» لأي موظف
  check(`«${n.label}» (${n.to}): الصلاحية «${n.area}» معرّفة`, AREAS.includes(n.area) && !!AREA_LABEL[n.area] && !!AREA_HELP[n.area], n.area);
  if (n.area !== 'roles' && n.area !== 'payroll') check(`«${n.label}»: ظاهرة في شاشة الأدوار`, inGroups.has(n.area) && !HIDDEN.has(n.area), n.area);
  if (navCount[n.area] === 1) check(`«${n.label}»: اسم الصلاحية = اسم القسم`, AREA_LABEL[n.area] === n.label, AREA_LABEL[n.area]);
}
for (const a of ['diagnosis', 'surgeries', 'medications', 'exercises', 'follow_ups', 'expenses', 'imaging', 'injections', 'fractures', 'nursing', 'inventory'])
  check(`قسم «${AREA_LABEL[a]}» ليه صلاحية لوحده`, inGroups.has(a) && !HIDDEN.has(a), a);

section('كل مسار محمي بصلاحية معرّفة');
const routes = [...src('src/App.tsx').matchAll(/\{ path: '([^']+)', area: '([^']+)'/g)].map((m) => ({ path: m[1], area: m[2] }));
for (const r of routes) check(`${r.path} ← ${r.area}`, AREAS.includes(r.area) && !!AREA_LABEL[r.area], r.area);
for (const [p, a] of [['/diagnosis', 'diagnosis'], ['/consultations', 'diagnosis'], ['/follow-ups', 'follow_ups'], ['/surgeries', 'surgeries'], ['/medications', 'medications'], ['/exercises', 'exercises'], ['/imaging', 'imaging'], ['/fractures', 'fractures']])
  check(`${p} بيتقفل بصلاحية «${AREA_LABEL[a]}»`, routes.find((r) => r.path === p)?.area === a, routes.find((r) => r.path === p)?.area);

section('الأسماء والشرح والترجمة');
const shown = AREAS.filter((a) => !HIDDEN.has(a));
for (const a of shown) check(`${a}: في مجموعة في شاشة الأدوار`, inGroups.has(a) || a === 'roles' || a === 'payroll', a);
const labels = Object.values(AREA_LABEL);
const dup = labels.filter((l, i) => labels.indexOf(l) !== i);
check('مفيش اسمين صلاحية متكررين', dup.length === 0, dup.join('، '));
const en = {};
for (const f of readdirSync(join(ROOT, 'src/i18n/en'))) if (/^\d/.test(f)) Object.assign(en, JSON.parse(src('src/i18n/en/' + f)));
const norm = (s) => s.replace(/\s+/g, ' ').trim();
const enKeys = new Set(Object.keys(en).map(norm));
for (const a of shown) {
  check(`ترجمة اسم «${AREA_LABEL[a]}»`, enKeys.has(norm(AREA_LABEL[a])), a);
  check(`ترجمة شرح «${AREA_LABEL[a]}»`, enKeys.has(norm(AREA_HELP[a].desc)), AREA_HELP[a].desc.slice(0, 40));
}
for (const g of AREA_GROUPS) check(`ترجمة مجموعة «${g.title}»`, enKeys.has(norm(g.title)) && enKeys.has(norm(g.hint)), g.title);

section('الأقسام الجديدة بتورث من الصلاحيات القديمة لحد ما تتحفظ');
const ops = ['view', 'create', 'edit', 'delete'];
// قبل الفصل: الشاشة بتتفتح بـ«المرضى»، والإضافة/التعديل/الحذف بـ«الزيارات» (والمتابعات: الزيارات أو المواعيد، والمصروفات: الأرقام المالية)
const OLD = {
  view: (m, a) => (a === 'expenses' ? m.financial : m.patients)?.includes('view'),
  op: (m, a, o) => a === 'expenses' ? m.financial?.includes(o) : a === 'follow_ups' && o !== 'delete' ? (m.sessions?.includes(o) || m.appointments?.includes(o)) : m.sessions?.includes(o),
};
const NEW_AREAS = ['follow_ups', 'diagnosis', 'imaging', 'injections', 'fractures', 'surgeries', 'nursing', 'medications', 'exercises', 'expenses'];
function sameAsBefore(label, m, who) {
  state.m = { [who]: m };
  // القسم اللي اتحفظله صف صريح (من شاشة الأدوار) مابيورثش — بيتقارن بس اللي لسه موروث
  for (const a of NEW_AREAS.filter((x) => !(x in m))) for (const o of ops) {
    const before = !!(o === 'view' ? OLD.view(m, a) : OLD.op(m, a, o));
    const after = can(who, a, o);
    if (before !== after) return check(`${label}: ${AREA_LABEL[a]} / ${o} زي ما كانت`, false, `قبل ${before} بعد ${after}`);
  }
  check(`${label}: كل الأقسام الجديدة زي ما كانت`, true);
}
let live = null;
if (existsSync(join(ROOT, '.env'))) {
  try {
    const { sql } = await import('./_env.mjs');
    const rows = await sql('select role, area, ops from role_permissions');
    live = {};
    for (const r of rows) (live[r.role] ??= {})[r.area] = r.ops;
    const emps = await sql('select name, role, perm_override from employees where perm_override is not null');
    for (const role of Object.keys(live)) sameAsBefore(`دور ${role} (قاعدة البيانات)`, live[role], role);
    // الموظف المخصّص: نفس الحساب على صلاحيات دوره + المخصّص
    for (const e of emps) {
      setMyPermOverride(e.perm_override); state.m = { [e.role]: live[e.role] ?? {} };
      const merged = { ...(live[e.role] ?? {}), ...e.perm_override };
      let ok = true;
      for (const a of NEW_AREAS.filter((x) => !(x in merged))) for (const o of ops) if (!!(o === 'view' ? OLD.view(merged, a) : OLD.op(merged, a, o)) !== can(e.role, a, o)) ok = false;
      check(`موظف مخصّص «${e.name}»: نفس الصلاحيات`, ok);
      setMyPermOverride(null);
    }
  } catch (e) { check('قراءة الصلاحيات من قاعدة البيانات', false, e.message.slice(0, 120)); }
}
const def = defaultPermissions();
for (const r of ROLES) if (r !== 'system_admin') {
  const raw = Object.fromEntries(Object.entries(def[r]).filter(([a]) => !NEW_AREAS.includes(a)));
  if (r === 'therapist') continue; // الدكتور واخد أقسام العظام صريحة
  state.m = { [r]: def[r] };
  const want = withLegacy(raw);
  check(`الافتراضي لدور ${r} = الموروث`, NEW_AREAS.every((a) => ops.every((o) => can(r, a, o) === !!want[a]?.includes(o))));
}

section('الصلاحيات اللي مالهاش قسم في البرنامج اتشالت');
for (const a of P.REMOVED_AREAS) {
  check(`«${a}» مش في شاشة الأدوار ولا في التعريفات`, !AREAS.includes(a) && !(a in AREA_LABEL) && !(a in AREA_HELP) && !inGroups.has(a), a);
  check(`«${a}» مش مستخدمة في الكود`, !readdirSync(join(ROOT, 'src/pages')).some((f) => f.endsWith('.tsx') && src('src/pages/' + f).includes(`can('${a}'`)), a);
}
check('صفوف قديمة للصلاحيات دي بتتشال عند الحفظ', JSON.stringify(withLegacy({ patients: ['view'], online_accounts: ['view'], pt_f_doctor: ['view'] })).indexOf('online_accounts') < 0);

section('شيل الصلاحية بيقفل القسم فعلًا');
const base = { patients: ['view', 'create', 'edit'], sessions: ['view', 'create', 'edit', 'delete'], financial: ['view'] };
state.m = { reception: base };
check('من غير قيمة محفوظة: التشخيص مفتوح (موروث)', can('reception', 'diagnosis', 'view') && can('reception', 'diagnosis', 'create'));
state.m = { reception: { ...base, diagnosis: [], exercises: ['view'], expenses: [] } };
check('التشخيص اتشال: مقفول رغم صلاحية المرضى', !can('reception', 'diagnosis', 'view') && !can('reception', 'diagnosis', 'create'));
check('التمرينات اطلاع بس: مفيش إضافة', can('reception', 'exercises', 'view') && !can('reception', 'exercises', 'create'));
check('المصروفات اتشالت: مقفولة رغم الأرقام المالية', !can('reception', 'expenses', 'view'));
check('باقي الأقسام زي ما هي', can('reception', 'surgeries', 'create') && can('reception', 'patients', 'edit'));
setMyPermOverride({ diagnosis: ['view'] });
check('موظف مخصّص: التشخيص اطلاع بس', can('reception', 'diagnosis', 'view') && !can('reception', 'diagnosis', 'create'));
setMyPermOverride({ patients: [] });
check('موظف مخصّص شايل المرضى: الأقسام اللي مالهاش قيمة بتورث من المخصّص', !can('reception', 'surgeries', 'view') && can('reception', 'surgeries', 'create'));
setMyPermOverride(null);

save('unit-permissions-results.json');
