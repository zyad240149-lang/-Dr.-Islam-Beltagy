// التحقق إن كل حاجة اتنقلت من المشروع القديم (.env.old) للجديد (.env) — طلب الدكتور ١١/١١.
// لكل جدول: كل صف في القديم لازم يكون موجود في الجديد بنفس المحتوى بالظبط (md5 للصف كله) — مش مجرد نفس العدد.
// الصفوف اللي اتضافت أو اتعدّلت في الجديد بعد تحويل الموقع بتتحسب لوحدها (مش غلط).
// + حسابات الدخول (وكلمات السر المشفّرة) + الملفات (المسار والحجم) + العدّادات + دوال الخادم وأسرارها. القديم بيتقري بس.
//   node scripts/verify-move.mjs
import { readFileSync, writeFileSync } from 'node:fs';

const readEnv = (f) => Object.fromEntries(readFileSync(new URL(`../${f}`, import.meta.url), 'utf8').split(/\r?\n/).filter((l) => /^[A-Z_]+=/.test(l)).map((l) => [l.slice(0, l.indexOf('=')), l.slice(l.indexOf('=') + 1)]));
const OLD = readEnv('.env.old'), NEW = readEnv('.env');
if (OLD.SUPABASE_PROJECT_REF === NEW.SUPABASE_PROJECT_REF) throw new Error('.env و .env.old نفس المشروع');
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
function client(E) {
  return async function sql(query) {
    for (let i = 0; ; i++) {
      let r, t;
      try {
        r = await fetch(`https://api.supabase.com/v1/projects/${E.SUPABASE_PROJECT_REF}/database/query`, { method: 'POST', headers: { Authorization: 'Bearer ' + E.SUPABASE_ACCESS_TOKEN, 'Content-Type': 'application/json' }, body: JSON.stringify({ query }) });
        t = await r.text();
      } catch (e) { if (i >= 12) throw e; await sleep(3000 * (i + 1)); continue; }
      if (r.ok) return t ? JSON.parse(t) : null;
      if ((r.status === 429 || r.status >= 500) && i < 12) { await sleep(Math.min(60000, 4000 * (i + 1))); continue; }
      throw new Error(`SQL ${r.status}: ${t.slice(0, 300)}`);
    }
  };
}
const oldSql = client(OLD), newSql = client(NEW);
const mgmt = async (E, path) => (await fetch(`https://api.supabase.com/v1/projects/${E.SUPABASE_PROJECT_REF}${path}`, { headers: { Authorization: 'Bearer ' + E.SUPABASE_ACCESS_TOKEN } })).json();
const qi = (s) => '"' + s.replace(/"/g, '""') + '"';
const report = { at: new Date().toISOString(), tables: {}, problems: [] };
const problem = (m) => { report.problems.push(m); console.log('  ✗', m); };

// بصمة كل صف (المفتاح الأساسي ← md5 للصف كله) — بدفعات عشان الجداول الكبيرة
async function fingerprints(sql, schema, table, pk, where = '') {
  const map = new Map();
  let last = null;
  for (;;) {
    const filt = [where, last !== null ? `${qi(pk)}::text > '${String(last).replace(/'/g, "''")}'` : ''].filter(Boolean).join(' and ');
    const rows = await sql(`select ${qi(pk)}::text k, md5(to_jsonb(t)::text) h from ${qi(schema)}.${qi(table)} t ${filt ? 'where ' + filt : ''} order by ${qi(pk)}::text limit 5000`);
    for (const r of rows) map.set(r.k, r.h);
    if (rows.length < 5000) break;
    last = rows[rows.length - 1].k;
  }
  return map;
}
async function pkOf(schema, table) {
  const r = await newSql(`select a.attname c from pg_index i join pg_attribute a on a.attrelid = i.indrelid and a.attnum = any(i.indkey) where i.indrelid = '${qi(schema)}.${qi(table)}'::regclass and i.indisprimary`);
  return r.length === 1 ? r[0].c : null;
}

async function compareTable(schema, table, { contentCheck = true, ignoreCols = [] } = {}) {
  const key = `${schema}.${table}`;
  const pk = await pkOf(schema, table);
  if (!pk) {
    const [{ n: o }] = await oldSql(`select count(*)::int n from ${qi(schema)}.${qi(table)}`);
    const [{ n: w }] = await newSql(`select count(*)::int n from ${qi(schema)}.${qi(table)}`);
    report.tables[key] = { old: o, new: w, mode: 'count' };
    if (w < o) problem(`${key}: ${w} في الجديد من ${o}`);
    return;
  }
  // الأعمدة اللي بتتغيّر لوحدها في الجديد (زي last_login) مش جزء من المقارنة
  const proj = ignoreCols.length ? `(to_jsonb(t) - array[${ignoreCols.map((c) => `'${c}'`).join(',')}])` : 'to_jsonb(t)';
  const fp = async (sql) => {
    if (!contentCheck) return new Map((await sql(`select ${qi(pk)}::text k from ${qi(schema)}.${qi(table)}`)).map((r) => [r.k, '']));
    if (!ignoreCols.length) return fingerprints(sql, schema, table, pk);
    return new Map((await sql(`select ${qi(pk)}::text k, md5(${proj}::text) h from ${qi(schema)}.${qi(table)} t`)).map((r) => [r.k, r.h]));
  };
  const [o, w] = [await fp(oldSql), await fp(newSql)];
  let missing = 0, changed = 0;
  const missingIds = [], changedIds = [];
  for (const [k, h] of o) {
    if (!w.has(k)) { missing++; if (missingIds.length < 5) missingIds.push(k); }
    else if (contentCheck && w.get(k) !== h) { changed++; if (changedIds.length < 5) changedIds.push(k); }
  }
  const added = [...w.keys()].filter((k) => !o.has(k)).length;
  report.tables[key] = { old: o.size, new: w.size, missing, changed, addedAfterMove: added };
  if (missing) problem(`${key}: ${missing} صف ناقص في الجديد (${missingIds.join(', ')})`);
  if (changed) console.log(`  ~ ${key}: ${changed} صف محتواه مختلف (${changedIds.join(', ')}) — هيتراجع`);
  return { changedIds };
}

const t0 = Date.now();
console.log('— جداول public');
const tables = (await oldSql(`select table_name t from information_schema.tables where table_schema='public' and table_type='BASE TABLE' and table_name <> '_migrations' order by 1`)).map((r) => r.t);
const newTables = new Set((await newSql(`select table_name t from information_schema.tables where table_schema='public' and table_type='BASE TABLE'`)).map((r) => r.t));
for (const t of tables) {
  if (!newTables.has(t)) { problem(`public.${t}: الجدول مش موجود في الجديد`); continue; }
  // سجل العمليات (288MB على القديم، معظمه سجلات اختبارات) — نقله متأجل لحد ما القديم يتعافى (قرار الدكتور)، فمش جزء من الفحص هنا
  if (t === 'audit_logs' && !process.argv.includes('--audit')) { report.tables['public.audit_logs'] = { skipped: 'audit-postponed' }; continue; }
  // audit_logs كبير وسجل ثابت — بنتأكد إن كل صف موجود بس (من غير مقارنة محتوى = قراية خفيفة على القديم)
  // employees: last_login بيتحدّث مع كل دخول في الجديد · counters: الأرقام بتزيد مع الشغل في الجديد
  const opts = t === 'audit_logs' ? { contentCheck: false } : t === 'employees' ? { ignoreCols: ['last_login', 'updated_at'] } : t === 'counters' ? { ignoreCols: ['value', 'n', 'last', 'current'] } : {};
  await compareTable('public', t, opts);
  process.stdout.write(`\r  ${Object.keys(report.tables).length}/${tables.length} `);
}
console.log('');

console.log('— حسابات الدخول');
for (const t of ['users', 'identities']) await compareTable('auth', t, { ignoreCols: ['last_sign_in_at', 'updated_at', 'confirmed_at', 'email_confirmed_at', 'raw_app_meta_data', 'raw_user_meta_data', 'identity_data', 'is_sso_user'] });
const pw = async (sql) => new Map((await sql(`select id::text k, md5(coalesce(encrypted_password, '')) h from auth.users`)).map((r) => [r.k, r.h]));
const [po, pn] = [await pw(oldSql), await pw(newSql)];
const pwBad = [...po].filter(([k, h]) => pn.get(k) !== h).length;
if (pwBad) problem(`auth.users: ${pwBad} كلمة سر مختلفة`); else console.log(`  ✓ كلمات السر المشفّرة: ${po.size} مطابقة`);

console.log('— الملفات (storage)');
const files = async (sql) => new Map((await sql(`select bucket_id || '/' || name k, coalesce(metadata->>'size', '?') s from storage.objects where name not like '%.emptyFolderPlaceholder'`)).map((r) => [r.k, r.s]));
const [fo, fn] = [await files(oldSql), await files(newSql)];
const fMissing = [...fo.keys()].filter((k) => !fn.has(k));
const fSize = [...fo].filter(([k, s]) => fn.has(k) && fn.get(k) !== s);
report.files = { old: fo.size, new: fn.size, missing: fMissing.length, sizeDiff: fSize.length };
if (fMissing.length) problem(`storage: ${fMissing.length} ملف ناقص: ${fMissing.slice(0, 5).join(', ')}`);
if (fSize.length) problem(`storage: ${fSize.length} ملف حجمه مختلف: ${fSize.slice(0, 5).map(([k]) => k).join(', ')}`);
if (!fMissing.length && !fSize.length) console.log(`  ✓ ${fo.size} ملف بنفس المسار والحجم`);

console.log('— العدّادات (sequences)');
const seq = async (sql) => new Map((await sql(`select sequencename k, coalesce(last_value, 0)::bigint v from pg_sequences where schemaname = 'public'`)).map((r) => [r.k, Number(r.v)]));
const [so, sn] = [await seq(oldSql), await seq(newSql)];
const seqBad = [...so].filter(([k, v]) => (sn.get(k) ?? -1) < v);
if (seqBad.length) problem(`sequences أقل من القديم: ${seqBad.map(([k]) => k).join(', ')}`); else console.log(`  ✓ ${so.size} sequence كلها فوق أرقام القديم`);

console.log('— تكوين قاعدة البيانات');
const shape = `select
 (select count(*) from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname='public')::int functions,
 (select md5(string_agg(md5(pg_get_functiondef(p.oid)), ',' order by md5(pg_get_functiondef(p.oid)))) from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname='public' and p.prokind='f') functions_code,
 (select count(*) from pg_trigger t join pg_class c on c.oid=t.tgrelid join pg_namespace n on n.oid=c.relnamespace where n.nspname='public' and not t.tgisinternal)::int triggers,
 (select md5(string_agg(policyname||tablename||coalesce(qual,'')||coalesce(with_check,''), ',' order by tablename, policyname)) from pg_policies where schemaname in ('public','storage')) policies,
 (select md5(string_agg(indexdef, ',' order by indexdef)) from pg_indexes where schemaname='public') indexes,
 (select md5(string_agg(tablename, ',' order by tablename)) from pg_publication_tables where pubname='supabase_realtime') realtime,
 (select md5(string_agg(schedule||command, ',' order by jobname, schedule)) from cron.job) cron,
 (select md5(string_agg(id||public::text||coalesce(file_size_limit::text,'')||coalesce(array_to_string(allowed_mime_types,','),''), ',' order by id)) from storage.buckets) buckets,
 (select md5(string_agg(rolname||coalesce(array_to_string(rolconfig,','),''), ',' order by rolname)) from pg_roles where rolname in ('anon','authenticated','authenticator')) role_settings,
 (select string_agg(extname, ',' order by extname) from pg_extension) extensions`;
const [ao] = await oldSql(shape), [an] = await newSql(shape);
for (const k of Object.keys(ao)) { if (String(ao[k]) === String(an[k])) console.log(`  ✓ ${k}`); else problem(`تكوين «${k}» مختلف`); }
report.shape = { old: ao, new: an };

console.log('— دوال الخادم والأسرار');
const fnNames = async (E) => (await mgmt(E, '/functions')).map((f) => `${f.slug}:${f.verify_jwt}`).sort().join(',');
const [fo2, fn2] = [await fnNames(OLD), await fnNames(NEW)];
if (fo2 === fn2) console.log(`  ✓ ${fo2}`); else problem(`Edge Functions: القديم ${fo2} — الجديد ${fn2}`);
const secretNames = async (E) => (await mgmt(E, '/secrets')).map((s) => s.name).filter((n) => !n.startsWith('SUPABASE_')).sort().join(',');
const [so2, sn2] = [await secretNames(OLD), await secretNames(NEW)];
if (so2 === sn2) console.log(`  ✓ أسرار: ${so2}`); else problem(`أسرار الدوال: القديم ${so2} — الجديد ${sn2}`);
const [pc] = await newSql(`select notify_url from push_config where id = 1`);
if (!String(pc?.notify_url ?? '').includes(NEW.SUPABASE_PROJECT_REF)) problem(`push_config بيشاور على: ${pc?.notify_url}`); else console.log('  ✓ الإشعارات بتشاور على الجديد');

const totals = Object.values(report.tables).filter((t) => !t.skipped).reduce((a, t) => ({ old: a.old + t.old, missing: a.missing + (t.missing ?? 0), changed: a.changed + (t.changed ?? 0), added: a.added + (t.addedAfterMove ?? 0) }), { old: 0, missing: 0, changed: 0, added: 0 });
report.totals = totals;
console.log(`\nصفوف القديم: ${totals.old} — ناقص في الجديد: ${totals.missing} — محتوى مختلف: ${totals.changed} — اتضاف في الجديد بعد التحويل: ${totals.added}`);
console.log(report.problems.length ? `مشاكل: ${report.problems.length}` : 'كل حاجة اتنقلت ✓');
console.log(`(${Math.round((Date.now() - t0) / 1000)} ثانية)`);
writeFileSync(new URL('../docs/move-verify.json', import.meta.url), JSON.stringify(report, null, 1));
setTimeout(() => process.exit(report.problems.length ? 1 : 0), 100);
