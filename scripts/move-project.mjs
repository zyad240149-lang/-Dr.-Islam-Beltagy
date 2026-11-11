// نقل البيانات من مشروع Supabase القديم (.env) للجديد (.env.new) — طلب الدكتور ١١/١١ (القديم بقى بطيء جدًا).
// الجداول اتبنت في الجديد بـ db-migrate. هنا: كل صفوف جداول public + حسابات الدخول (auth.users/identities) + الملفات (storage).
// الجديد: الجدول بيتمسح الأول (البيانات الافتراضية من الهجرات) وبعدين بيتنسخ القديم بالظبط، والـ triggers والـ FK واقفين أثناء النسخ.
// بيكمّل من مكانه لو اتقطع (docs/.move-state.json). القديم بيتقري بس — مفيش أي تعديل عليه.
//   node scripts/move-project.mjs [--only=table1,table2] [--skip-files] [--audit-days=30]
import { readFileSync, writeFileSync, existsSync } from 'node:fs';

const readEnv = (f) => Object.fromEntries(readFileSync(new URL(`../${f}`, import.meta.url), 'utf8').split(/\r?\n/).filter((l) => /^[A-Z_]+=/.test(l)).map((l) => [l.slice(0, l.indexOf('=')), l.slice(l.indexOf('=') + 1)]));
// بعد تحويل الموقع: .env بقى الجديد والقديم اتنقل لـ .env.old
const OLD = readEnv(existsSync(new URL('../.env.old', import.meta.url)) ? '.env.old' : '.env'), NEW = readEnv('.env.new');
const arg = (k) => process.argv.find((a) => a.startsWith(`--${k}=`))?.split('=')[1];
const ONLY = arg('only')?.split(',');
// --merge: بعد تحويل الموقع للجديد — مفيش مسح، والصف الموجود في الجديد بيفضل زي ما هو (on conflict do nothing)
const MERGE = process.argv.includes('--merge');
const SKIP = (arg('skip') ?? '').split(',').filter(Boolean);
const AUDIT_DAYS = Number(arg('audit-days') ?? 30);
const STATE = new URL('../docs/.move-state.json', import.meta.url);
const state = existsSync(STATE) ? JSON.parse(readFileSync(STATE, 'utf8')) : { done: {} };
const saveState = () => writeFileSync(STATE, JSON.stringify(state, null, 1));
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

function client(E) {
  return async function sql(query, tries = 12) {
    for (let i = 0; ; i++) {
      let r, t;
      try {
        r = await fetch(`https://api.supabase.com/v1/projects/${E.SUPABASE_PROJECT_REF}/database/query`, { method: 'POST', headers: { Authorization: 'Bearer ' + E.SUPABASE_ACCESS_TOKEN, 'Content-Type': 'application/json' }, body: JSON.stringify({ query }) });
        t = await r.text();
      } catch (e) { if (i >= tries) throw e; await sleep(3000 * (i + 1)); continue; }
      if (r.ok) return t ? JSON.parse(t) : null;
      if ((r.status === 429 || r.status >= 500) && i < tries) { await sleep(Math.min(60000, 4000 * (i + 1))); continue; }
      throw new Error(`SQL ${r.status}: ${t.slice(0, 500)}`);
    }
  };
}
const oldSql = client(OLD), newSql = client(NEW);
const qi = (s) => '"' + s.replace(/"/g, '""') + '"';
const lit = (json) => { let tag = 'J' + Math.random().toString(36).slice(2, 8); while (json.includes(`$${tag}$`)) tag += 'x'; return `$${tag}$${json}$${tag}$`; };

async function columns(schema, table) {
  const rows = await newSql(`select column_name c from information_schema.columns where table_schema='${schema}' and table_name='${table}' and is_generated='NEVER' order by ordinal_position`);
  return rows.map((r) => r.c);
}

async function copyTable(schema, table, where = '', chunk = 400) {
  const key = `${schema}.${table}`;
  if (state.done[key]) { console.log('  = ', key, '(اتنسخ قبل كده)'); return; }
  if (SKIP.includes(table)) { console.log('  - ', key, '(متساب)'); return; }
  const full = `${qi(schema)}.${qi(table)}`;
  const [{ n }] = await oldSql(`select count(*)::int n from ${full} ${where}`);
  const cols = await columns(schema, table);
  const colList = cols.map(qi).join(', ');
  if (!MERGE) await newSql(`set session_replication_role = replica; delete from ${full};`);
  let copied = 0;
  for (let off = 0; off < n; off += chunk) {
    const [{ j }] = await oldSql(`select coalesce(jsonb_agg(to_jsonb(t)), '[]')::text j from (select * from ${full} ${where} order by ctid limit ${chunk} offset ${off}) t`);
    await newSql(`set session_replication_role = replica; insert into ${full} (${colList}) overriding system value select ${colList} from jsonb_populate_recordset(null::${full}, ${lit(j)}::jsonb)${MERGE ? ' on conflict do nothing' : ''};`);
    copied += JSON.parse(j).length;
    if (n > chunk) process.stdout.write(`\r  … ${key} ${copied}/${n}`);
  }
  const [{ m }] = await newSql(`select count(*)::int m from ${full}`);
  console.log(`${n > chunk ? '\n' : ''}  ✓ ${key}: ${m}/${n}`);
  if (MERGE ? m < n : m !== n) throw new Error(`${key}: العدد مش مطابق (${m} من ${n})`);
  state.done[key] = n; saveState();
}

async function syncSequences() {
  const seqs = await oldSql(`select schemaname s, sequencename n, coalesce(last_value, 0)::bigint v from pg_sequences where schemaname = 'public'`);
  for (const q of seqs) await newSql(`select setval('${q.s}.${qi(q.n)}', greatest(${q.v} + 1000, (select coalesce(last_value, 1) from ${q.s}.${qi(q.n)})))`);
  console.log(`  ✓ ${seqs.length} sequence فوق أرقام القديم`);
}
async function main() {
  if (process.argv.includes('--seq')) { await syncSequences(); if (process.argv.includes('--seq-only')) { console.log('DONE'); return; } }
  const tables = (await oldSql(`select table_name t from information_schema.tables where table_schema='public' and table_type='BASE TABLE' order by 1`)).map((r) => r.t)
    .filter((t) => !['_migrations', 'audit_logs'].includes(t) && (!ONLY || ONLY.includes(t)))
    .sort((a, b) => (ONLY ? ONLY.indexOf(a) - ONLY.indexOf(b) : 0));
  const newTables = new Set((await newSql(`select table_name t from information_schema.tables where table_schema='public' and table_type='BASE TABLE'`)).map((r) => r.t));
  const missing = tables.filter((t) => !newTables.has(t));
  if (missing.length) console.log('⚠ جداول في القديم مش في الجديد (مش هتتنسخ):', missing.join(', '));
  console.log(`— حسابات الدخول`);
  if (!ONLY) { await copyTable('auth', 'users', '', 200); await copyTable('auth', 'identities', '', 300); }
  console.log(`— جداول public (${tables.length})`);
  for (const t of tables.filter((x) => newTables.has(x))) await copyTable('public', t);
  if (!ONLY) {
    console.log(`— سجل العمليات (آخر ${AUDIT_DAYS} يوم)`);
    await copyTable('public', 'audit_logs', `where at > now() - interval '${AUDIT_DAYS} days'`, 300);
    console.log('— storage.buckets');
    await copyTable('storage', 'buckets', '', 100);
  }
  // العدّادات (sequences) ← أكبر قيمة موجودة
  await newSql(`do $$ declare r record; mx bigint; begin
    for r in select s.relname seq, t.relname tbl, a.attname col from pg_class s join pg_depend d on d.objid = s.oid and d.deptype in ('a','i') join pg_class t on t.oid = d.refobjid
      join pg_attribute a on a.attrelid = t.oid and a.attnum = d.refobjsubid join pg_namespace n on n.oid = s.relnamespace where s.relkind = 'S' and n.nspname = 'public' loop
      execute format('select max(%I) from public.%I', r.col, r.tbl) into mx;
      if mx is not null then perform setval('public.' || quote_ident(r.seq), greatest(mx, (select last_value from pg_sequences where schemaname = 'public' and sequencename = r.seq))); end if;
    end loop; end $$;`);
  console.log('  ✓ sequences');
  console.log('DONE');
}
main().catch((e) => { console.error('FAILED:', e.message); process.exit(1); });
