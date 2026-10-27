// تطبيق ملفات supabase/migrations بالترتيب على مشروع Supabase (Management API)
// كل ملف بيتسجّل في جدول _migrations بعد نجاحه، فإعادة التشغيل بتكمّل من حيث وقفت ومابتكرّرش حاجة.
// الاستخدام: node scripts/db-migrate.mjs            (كل اللي لسه ماتطبّقش)
//            node scripts/db-migrate.mjs --dry      (عرض بس)
import { readdirSync, readFileSync } from 'node:fs';
import { sql, REF } from './_env.mjs';

const dir = new URL('../supabase/migrations/', import.meta.url);
const dry = process.argv.includes('--dry');
await sql('create table if not exists public._migrations (name text primary key, applied_at timestamptz not null default now()); revoke all on public._migrations from anon, authenticated;');
const done = new Set((await sql('select name from public._migrations')).map((r) => r.name));
const files = readdirSync(dir).filter((f) => f.endsWith('.sql')).sort();
const todo = files.filter((f) => !done.has(f));
console.log(`project ${REF}: ${files.length} files, ${done.size} applied, ${todo.length} pending`);
for (const f of todo) {
  if (dry) { console.log('  would apply', f); continue; }
  const body = readFileSync(new URL(f, dir), 'utf8');
  try {
    await sql(body + `\n;insert into public._migrations(name) values ('${f}') on conflict do nothing;`);
    console.log('  ✓', f);
  } catch (e) {
    console.error('  ✗', f, '\n', e.message);
    process.exit(1);
  }
}
console.log('done');
