// نشر الواجهة على Cloudflare Pages: بناء ← فحص إن مفيش مفتاح سري جوّه dist ← إنشاء المشروع لو مش موجود ← رفع.
// محتاج في .env: CLOUDFLARE_API_TOKEN (صلاحية Pages)، و VITE_SUPABASE_URL / VITE_SUPABASE_ANON_KEY (بيتحطوا في الواجهة وقت البناء).
// المسارات كلها بتفتح index.html (Pages بيعتبره SPA لأن مفيش 404.html).
//   node scripts/deploy-pages.mjs            (المشروع: beltagy-ortho)
//   node scripts/deploy-pages.mjs --skip-build
import { execSync } from 'node:child_process';
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { env } from './_env.mjs';

const PROJECT = env.CLOUDFLARE_PAGES_PROJECT || 'beltagy-ortho';
const ROOT = fileURLToPath(new URL('..', import.meta.url));
const DIST = join(ROOT, 'dist');
const cf = async (path, init = {}) => {
  const r = await fetch(`https://api.cloudflare.com/client/v4${path}`, { ...init, headers: { Authorization: 'Bearer ' + env.CLOUDFLARE_API_TOKEN, 'Content-Type': 'application/json', ...(init.headers ?? {}) } });
  return r.json();
};
if (!env.CLOUDFLARE_API_TOKEN) throw new Error('CLOUDFLARE_API_TOKEN مش موجود في .env');

if (!process.argv.includes('--skip-build')) execSync('npm run build', { cwd: ROOT, stdio: 'inherit' });

// أي مفتاح سري (service_role / access token / توكن Cloudflare) جوّه dist = وقف النشر
const secrets = ['SUPABASE_SERVICE_ROLE_KEY', 'SUPABASE_ACCESS_TOKEN', 'CLOUDFLARE_API_TOKEN'].map((k) => [k, env[k]]).filter(([, v]) => v && v.length > 20);
const files = [];
const walk = (d) => { for (const f of readdirSync(d)) { const p = join(d, f); if (statSync(p).isDirectory()) walk(p); else files.push(p); } };
walk(DIST);
for (const f of files) {
  const s = readFileSync(f, 'latin1');
  for (const [k, v] of secrets) if (s.includes(v)) throw new Error(`${k} موجود جوّه ${f} — النشر اتلغى`);
}
console.log(`فحص الأسرار: ${files.length} ملف — نظيف`);

const accounts = await cf('/accounts');
const account = accounts.result?.[0]?.id;
if (!account) throw new Error('التوكن مالوش حساب Cloudflare: ' + JSON.stringify(accounts.errors));
const existing = await cf(`/accounts/${account}/pages/projects/${PROJECT}`);
if (!existing.success) {
  const made = await cf(`/accounts/${account}/pages/projects`, { method: 'POST', body: JSON.stringify({ name: PROJECT, production_branch: 'main' }) });
  if (!made.success) throw new Error('إنشاء مشروع Pages فشل: ' + JSON.stringify(made.errors));
  console.log(`اتعمل مشروع ${PROJECT} ← https://${made.result.subdomain}`);
}

execSync(`npx --yes wrangler@3.114.15 pages deploy "${DIST}" --project-name ${PROJECT} --branch main --commit-dirty=true`, {
  cwd: ROOT, stdio: 'inherit',
  env: { ...process.env, CLOUDFLARE_API_TOKEN: env.CLOUDFLARE_API_TOKEN, CLOUDFLARE_ACCOUNT_ID: account, WRANGLER_SEND_METRICS: 'false' },
});
const p = await cf(`/accounts/${account}/pages/projects/${PROJECT}`);
console.log(`\nالموقع: https://${p.result?.subdomain}${p.result?.domains?.length ? '  (' + p.result.domains.join(', ') + ')' : ''}`);
