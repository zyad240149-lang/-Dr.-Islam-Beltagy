// نقل الملفات المرفوعة (storage) من المشروع القديم (.env) للجديد (.env.new) — نفس الـ bucket ونفس المسار بالظبط.
// القديم بيتقري بس. بيكمّل من مكانه (docs/.move-files-state.json) ويعيد المحاولة لو الخادم القديم بطيء.
import { readFileSync, writeFileSync, existsSync } from 'node:fs';

const readEnv = (f) => Object.fromEntries(readFileSync(new URL(`../${f}`, import.meta.url), 'utf8').split(/\r?\n/).filter((l) => /^[A-Z_]+=/.test(l)).map((l) => [l.slice(0, l.indexOf('=')), l.slice(l.indexOf('=') + 1)]));
// بعد تحويل الموقع: .env بقى الجديد والقديم اتنقل لـ .env.old
const OLD = readEnv(existsSync(new URL('../.env.old', import.meta.url)) ? '.env.old' : '.env'), NEW = readEnv('.env.new');
const STATE = new URL('../docs/.move-files-state.json', import.meta.url);
const state = existsSync(STATE) ? JSON.parse(readFileSync(STATE, 'utf8')) : { done: {} };
const save = () => writeFileSync(STATE, JSON.stringify(state));
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const H = (E) => ({ apikey: E.SUPABASE_SERVICE_ROLE_KEY, Authorization: 'Bearer ' + E.SUPABASE_SERVICE_ROLE_KEY });
const enc = (p) => p.split('/').map(encodeURIComponent).join('/');

async function retry(fn, label, tries = 10) {
  for (let i = 0; ; i++) {
    try { return await fn(); } catch (e) { if (i >= tries) throw new Error(`${label}: ${e.message}`); await sleep(Math.min(60000, 4000 * (i + 1))); }
  }
}
async function oldSql(query) {
  return retry(async () => {
    const r = await fetch(`https://api.supabase.com/v1/projects/${OLD.SUPABASE_PROJECT_REF}/database/query`, { method: 'POST', headers: { Authorization: 'Bearer ' + OLD.SUPABASE_ACCESS_TOKEN, 'Content-Type': 'application/json' }, body: JSON.stringify({ query }) });
    const t = await r.text(); if (!r.ok) throw new Error(`SQL ${r.status} ${t.slice(0, 120)}`); return JSON.parse(t);
  }, 'list');
}

const objs = await oldSql(`select bucket_id b, name n, coalesce(metadata->>'mimetype', 'application/octet-stream') m, (metadata->>'size')::bigint s from storage.objects where name not like '%/.emptyFolderPlaceholder' order by bucket_id, name`);
const total = objs.reduce((a, o) => a + Number(o.s || 0), 0);
console.log(`ملفات: ${objs.length} (${(total / 1048576).toFixed(1)} MB)`);
let ok = 0, skip = 0;
const failed = [];
for (const o of objs) {
  const key = `${o.b}/${o.n}`;
  if (state.done[key]) { skip++; continue; }
  try {
    const buf = await retry(async () => {
      const r = await fetch(`${OLD.SUPABASE_URL}/storage/v1/object/${o.b}/${enc(o.n)}`, { headers: H(OLD) });
      if (!r.ok) throw new Error(`download ${r.status}`);
      return Buffer.from(await r.arrayBuffer());
    }, `download ${key}`);
    await retry(async () => {
      const r = await fetch(`${NEW.SUPABASE_URL}/storage/v1/object/${o.b}/${enc(o.n)}`, { method: 'POST', headers: { ...H(NEW), 'Content-Type': o.m, 'x-upsert': 'true' }, body: buf });
      if (!r.ok) throw new Error(`upload ${r.status} ${(await r.text()).slice(0, 120)}`);
    }, `upload ${key}`);
    state.done[key] = buf.length; save(); ok++;
    if ((ok + skip) % 10 === 0) console.log(`  … ${ok + skip}/${objs.length}`);
  } catch (e) { failed.push(key); console.log('  ✗', e.message); }
}
console.log(`اتنقل ${ok}، اتنقل قبل كده ${skip}، فشل ${failed.length}`);
if (failed.length) { console.log(failed.join('\n')); process.exit(1); }
console.log('FILES DONE');
