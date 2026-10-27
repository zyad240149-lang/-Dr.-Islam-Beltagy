// قراءة .env للسكريبتات (بدون أي مكتبة)
import { readFileSync } from 'node:fs';
export const env = Object.fromEntries(readFileSync(new URL('../.env', import.meta.url), 'utf8')
  .split(/\r?\n/).filter((l) => /^[A-Z_]+=/.test(l)).map((l) => [l.slice(0, l.indexOf('=')), l.slice(l.indexOf('=') + 1)]));
export const REF = env.SUPABASE_PROJECT_REF;
export async function sql(query) {
  const r = await fetch(`https://api.supabase.com/v1/projects/${REF}/database/query`, {
    method: 'POST', headers: { Authorization: 'Bearer ' + env.SUPABASE_ACCESS_TOKEN, 'Content-Type': 'application/json' }, body: JSON.stringify({ query }),
  });
  const t = await r.text();
  if (!r.ok) throw new Error(`SQL ${r.status}: ${t.slice(0, 800)}`);
  return t ? JSON.parse(t) : null;
}
export async function mgmt(path, init = {}) {
  const r = await fetch(`https://api.supabase.com/v1${path}`, { ...init, headers: { Authorization: 'Bearer ' + env.SUPABASE_ACCESS_TOKEN, ...(init.headers ?? {}) } });
  const t = await r.text();
  if (!r.ok) throw new Error(`${path} ${r.status}: ${t.slice(0, 500)}`);
  try { return JSON.parse(t); } catch { return t; }
}
