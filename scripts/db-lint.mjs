// فحص ثابت لكل دوال plpgsql في القاعدة (plpgsql_check): عمود أو جدول أو دالة مش موجودة، نوع غلط، متغير مش متعرّف…
// الأخطاء دي مابتظهرش غير لما الكود يوصل للسطر ده وقت التشغيل — الفحص بيمسك كل المسارات مرة واحدة.
// الإضافة بتتركّب مؤقتًا وبتتشال في الآخر لو ماكانتش موجودة. الفحص كله استعلام واحد (Management API عليه حد طلبات).
//   node scripts/db-lint.mjs
import { writeFileSync } from 'node:fs';
import { sql } from './_env.mjs';

const [had] = await sql(`select count(*)::int n from pg_extension where extname = 'plpgsql_check'`);
if (!had.n) await sql('create extension plpgsql_check schema extensions');
try {
  // دوال التريجر بتتفحص على الجدول المربوطة بيه؛ اللي مش مربوطة بجدول (بقايا) بتتخطى
  const rows = await sql(`
    with fns as (
      select p.oid, p.proname, pg_get_function_identity_arguments(p.oid) args, p.prorettype = 'trigger'::regtype is_trg,
        (select t.tgrelid from pg_trigger t where t.tgfoid = p.oid and not t.tgisinternal limit 1) trel
      from pg_proc p join pg_namespace n on n.oid = p.pronamespace join pg_language l on l.oid = p.prolang
      where n.nspname = 'public' and l.lanname = 'plpgsql' and p.prorettype <> 'event_trigger'::regtype),
    checked as (select * from fns where not (is_trg and trel is null))
    select f.proname, f.args, c.level, c.message, c.lineno, left(c.query, 160) query,
      (select count(*) from fns)::int total, (select count(*) from fns where is_trg and trel is null)::int skipped
    from checked f
    left join lateral extensions.plpgsql_check_function_tb(f.oid, coalesce(f.trel, 0), fatal_errors => false, other_warnings => false, extra_warnings => false) c on true
    where c.level = 'error' or f.oid = (select min(oid) from checked)`);
  const total = rows[0]?.total ?? 0, skipped = rows[0]?.skipped ?? 0;
  const found = rows.filter((r) => r.level === 'error').map(({ total: _t, skipped: _s, ...r }) => r);
  // إنذارات كاذبة معروفة: جدول مؤقت بتعمله الدالة نفسها وقت التشغيل، أو تريجر بيقرا عمود بعد ما يتأكد من اسم الجدول (tg_table_name)
  const names = [...new Set(found.map((p) => p.proname))];
  const defs = names.length ? Object.fromEntries((await sql(`select proname, pg_get_functiondef(p.oid) d from pg_proc p join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public' and proname in (${names.map((x) => `'${x}'`).join(',')})`)).map((r) => [r.proname, r.d])) : {};
  const falsePositive = (p) => {
    const def = defs[p.proname] ?? '';
    const tmp = /relation "(\w+)" does not exist/.exec(p.message);
    if (tmp && new RegExp(`create\\s+temp(orary)?\\s+table\\s+(if\\s+not\\s+exists\\s+)?${tmp[1]}\\b`, 'i').test(def)) return true;
    return /record "(old|new)" has no field/.test(p.message) && /tg_table_name\s*=/.test(def);
  };
  const problems = found.filter((p) => !falsePositive(p));
  const ignored = found.length - problems.length;
  writeFileSync(new URL('../docs/db-lint-results.json', import.meta.url), JSON.stringify({ at: new Date().toISOString(), functions: total, skippedUnboundTriggers: skipped, ignoredFalsePositives: ignored, problems }, null, 2));
  for (const p of problems) console.log(`  ✗ ${p.proname}(${p.args}) سطر ${p.lineno}: ${p.message}${p.query ? ` — ${p.query}` : ''}`);
  console.log(`\n${total} دالة اتفحصت (${skipped} تريجر مش مربوط اتخطى، ${ignored} إنذار كاذب معروف) — ${problems.length} خطأ`);
  process.exitCode = problems.length ? 1 : 0;
} finally {
  if (!had.n) await sql('drop extension if exists plpgsql_check');
}
