// يولّد docs/FEATURE_INVENTORY.md و docs/REQUIREMENTS_TRACEABILITY.md من الكود الفعلي (مش تقديرات):
// الصفحات من App.tsx، والحقول/الأزرار/عمليات الخادم من كل ملف واجهة، وحالة الاختبار من docs/e2e-results.json.
//   node scripts/inventory.mjs
import { readFileSync, readdirSync, statSync, writeFileSync, existsSync } from 'node:fs';
import { join, relative } from 'node:path';

import { fileURLToPath } from 'node:url';
const root = fileURLToPath(new URL('..', import.meta.url));
const src = join(root, 'src');
const walk = (d) => readdirSync(d).flatMap((f) => { const p = join(d, f); return statSync(p).isDirectory() ? walk(p) : [p]; });
const files = walk(src).filter((f) => /\.tsx$/.test(f));

// العمليات اللي ليها اختبار تكامل حقيقي (scripts/e2e.mjs) — نفس الأسماء اللي بيناديها
const readRes = (f) => (existsSync(join(root, 'docs', f)) ? JSON.parse(readFileSync(join(root, 'docs', f), 'utf8')) : null);
const parts = [readRes('e2e-results.json'), readRes('e2e-modules-results.json')].filter(Boolean);
const e2e = parts.length ? { at: parts.map((p) => p.at).sort().pop(), passed: parts.reduce((n, p) => n + p.passed, 0), failed: parts.reduce((n, p) => n + p.failed, 0), results: parts.flatMap((p) => p.results) } : null;
const TESTED_OPS = new Set(['book_appointment', 'record_payment', 'list_patients', 'payroll_overview', 'dashboard_stats', 'save_therapist',
  'set_appointment_status', 'sell_package', 'cancel_package', 'attendance_check_in', 'package_attendance_list', 'request_package_installment', 'decide_package_installment',
  'product_save', 'product_delete', 'sell_product', 'cancel_product_sale', 'patient_loyalty_summary', 'redeem_loyalty_points', 'loyalty_ledger_list',
  'clock_in', 'clock_out', 'my_attendance_today', 'attendance_report', 'payroll_save_plan', 'payroll_approve_period', 'payroll_pay', 'payroll_void_payout',
  'payroll_close_period', 'payroll_reopen_period', 'my_target', 'finance_month', 'package_plans', 'packages', 'products', 'product_sales', 'discount_codes', 'package_installment_requests',
  'patients(insert)', 'invoices(select)', 'ortho_consultations', 'ortho_fractures', 'api/staff', 'api/me', 'auth.signInWithPassword']);

const count = (s, re) => (s.match(re) ?? []).length;
const rows = files.map((f) => {
  const s = readFileSync(f, 'utf8');
  const rpcs = [...new Set([...s.matchAll(/rpc(?:OrThrow)?(?:<[^>]*>)?\(\s*'([a-z_0-9]+)'/g)].map((m) => m[1]))];
  const tables = [...new Set([...s.matchAll(/from\('([a-z_0-9]+)'\)/g)].map((m) => m[1]))];
  const dbCalls = [...new Set([...s.matchAll(/\bdb\.([a-zA-Z]+)\(/g)].map((m) => m[1]))];
  const orthoCalls = [...new Set([...s.matchAll(/ortho\.(save|remove|list)\('([a-z]+)'/g)].map((m) => `ortho.${m[1]}(${m[2]})`))];
  return {
    file: relative(root, f).replace(/\\/g, '/'),
    inputs: count(s, /<(Input|Select|PasswordInput|PhoneInput|input|select|textarea)\b/g),
    buttons: count(s, /<(Button|IconBtn|IconAction|button)\b/g),
    modals: count(s, /<Modal\b/g),
    tables: count(s, /<table\b/g),
    rpcs, tablesUsed: tables, dbCalls, orthoCalls,
  };
});

const app = readFileSync(join(src, 'App.tsx'), 'utf8');
const routes = [...app.matchAll(/\{ path: '([^']+)', area: '([^']+)'(?:, anyOf: \[[^\]]*\])?, el: <(\w+)/g)].map((m) => ({ path: m[1], area: m[2], comp: m[3] }));
const patientRoutes = [...app.matchAll(/\{ path: '(\/me[^']*)', el: <(\w+)/g)].map((m) => ({ path: m[1], comp: m[2] }));

const tot = rows.reduce((a, r) => ({ inputs: a.inputs + r.inputs, buttons: a.buttons + r.buttons, modals: a.modals + r.modals, tables: a.tables + r.tables }), { inputs: 0, buttons: 0, modals: 0, tables: 0 });
const allRpcs = [...new Set(rows.flatMap((r) => r.rpcs))].sort();
const dataRpcs = [...new Set(walk(src).filter((f) => /\.ts$/.test(f)).flatMap((f) => [...readFileSync(f, 'utf8').matchAll(/rpc(?:OrThrow)?(?:<[^>]*>)?\(\s*'([a-z_0-9]+)'/g)].map((m) => m[1])))].sort();
const opsAll = [...new Set([...allRpcs, ...dataRpcs])].sort();

let md = `# Feature Inventory — عيادة د. إسلام بلتاجي\n\n> مولَّد آليًا من الكود بـ \`node scripts/inventory.mjs\` بتاريخ ${new Date().toISOString().slice(0, 10)}. الأعداد محسوبة من المصدر مباشرة.\n\n`;
md += `## الإجماليات\n\n| البند | العدد |\n|---|---|\n| صفحات لوحة الإدارة (routes) | ${routes.length} |\n| صفحات بوابة المريض (/me) | ${patientRoutes.length} |\n| ملفات واجهة (.tsx) | ${files.length} |\n| حقول إدخال (Input/Select/textarea/…) | ${tot.inputs} |\n| أزرار وإجراءات | ${tot.buttons} |\n| نوافذ (Modal) | ${tot.modals} |\n| جداول | ${tot.tables} |\n| دوال خادم (RPC) مستخدمة من الواجهة | ${opsAll.length} |\n\n`;
md += `## الصفحات\n\n| المسار | الصلاحية (area) | المكوّن |\n|---|---|---|\n${routes.map((r) => `| \`${r.path}\` | ${r.area} | ${r.comp} |`).join('\n')}\n\n`;
md += `بوابة المريض: ${patientRoutes.map((r) => `\`${r.path}\``).join('، ')} — **غير مفعّلة** (لا توجد حسابات مرضى؛ راجع التقرير النهائي).\n\n`;
md += `## لكل ملف واجهة\n\n| الملف | حقول | أزرار | نوافذ | جداول | عمليات الخادم |\n|---|---|---|---|---|---|\n`;
md += rows.filter((r) => r.inputs || r.buttons || r.rpcs.length || r.tablesUsed.length || r.orthoCalls.length)
  .sort((a, b) => a.file.localeCompare(b.file))
  .map((r) => `| \`${r.file}\` | ${r.inputs} | ${r.buttons} | ${r.modals} | ${r.tables} | ${[...r.rpcs.map((x) => `rpc:${x}`), ...r.tablesUsed.map((x) => `table:${x}`), ...r.orthoCalls].join(', ') || (r.dbCalls.length ? `db.${r.dbCalls.slice(0, 6).join(', db.')}${r.dbCalls.length > 6 ? '…' : ''}` : '—')} |`).join('\n');
md += `\n\n## دوال الخادم المستخدمة (${opsAll.length})\n\n${opsAll.map((x) => `\`${x}\``).join(' · ')}\n`;
writeFileSync(join(root, 'docs/FEATURE_INVENTORY.md'), md);

let tr = `# Requirements Traceability — عيادة د. إسلام بلتاجي\n\n> مولَّد آليًا. «مختبَر» = له اختبار تكامل حقيقي على Supabase في \`scripts/e2e.mjs\` (آخر تشغيل: ${e2e ? `${e2e.at} — ${e2e.passed} نجح / ${e2e.failed} فشل` : 'لم يُشغَّل'}). «غير مختبَر آليًا» = الكود موجود ومربوط بالخادم لكن مالوش اختبار آلي بعد.\n\n`;
tr += `## نتائج اختبارات التكامل\n\n| الاختبار | النتيجة |\n|---|---|\n${(e2e?.results ?? []).map((r) => `| ${r.name} | ${r.ok ? '✅ نجح' : `❌ فشل — ${r.detail}`} |`).join('\n')}\n\n`;
tr += `## الصفحات ← العمليات ← الحالة\n\n| الصفحة | الصلاحية | العمليات في ملف الصفحة | حالة الاختبار |\n|---|---|---|---|\n`;
const fileOf = (comp) => rows.find((r) => r.file.endsWith(`/${comp}.tsx`));
tr += routes.map((r) => {
  const f = fileOf(r.comp);
  const ops = f ? [...f.rpcs, ...f.tablesUsed.map((t) => `${t}`), ...f.orthoCalls] : [];
  const tested = ops.filter((o) => TESTED_OPS.has(o) || [...TESTED_OPS].some((t) => o.startsWith(t.split('(')[0])));
  const status = !ops.length ? 'عبر طبقة db.ts — غير مختبَر آليًا على مستوى الصفحة' : tested.length ? `مختبَر جزئيًا (${tested.join(', ')})` : 'غير مختبَر آليًا';
  return `| \`${r.path}\` | ${r.area} | ${ops.join(', ') || '—'} | ${status} |`;
}).join('\n');
tr += `\n\n## دوال الخادم ← الاختبار\n\n| الدالة | مختبَرة آليًا |\n|---|---|\n${opsAll.map((o) => `| \`${o}\` | ${TESTED_OPS.has(o) ? '✅' : '—'} |`).join('\n')}\n`;
writeFileSync(join(root, 'docs/REQUIREMENTS_TRACEABILITY.md'), tr);
console.log(JSON.stringify({ routes: routes.length, patientRoutes: patientRoutes.length, files: files.length, ...tot, ops: opsAll.length, testedOps: opsAll.filter((o) => TESTED_OPS.has(o)).length }));
