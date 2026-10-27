// فحص الاتصال بمشروع Supabase باستخدام المفاتيح في .env (بدون طباعة المفتاح)
import { readFileSync } from 'node:fs';

const env = Object.fromEntries(readFileSync(new URL('../.env', import.meta.url), 'utf8')
  .split(/\r?\n/).filter((l) => /^[A-Z_]+=/.test(l)).map((l) => [l.slice(0, l.indexOf('=')), l.slice(l.indexOf('=') + 1)]));
const url = env.SUPABASE_URL, key = env.SUPABASE_SERVICE_ROLE_KEY;
const headers = { apikey: key, Authorization: `Bearer ${key}` };

const payload = JSON.parse(Buffer.from(key.split('.')[1], 'base64url').toString());
console.log('المشروع في المفتاح:', payload.ref, '| الدور:', payload.role, '| ينتهي:', new Date(payload.exp * 1000).toISOString().slice(0, 10));
console.log('المشروع في الرابط :', new URL(url).hostname.split('.')[0]);

const rest = await fetch(`${url}/rest/v1/`, { headers });
console.log('REST API:', rest.status, rest.statusText);
if (rest.ok) {
  const spec = await rest.json();
  const tables = Object.keys(spec.paths ?? {}).filter((p) => p !== '/' && !p.startsWith('/rpc/')).map((p) => p.slice(1));
  const rpcs = Object.keys(spec.paths ?? {}).filter((p) => p.startsWith('/rpc/'));
  console.log('الجداول:', tables.length ? tables.join(', ') : '(لا يوجد — قاعدة بيانات فاضية)');
  console.log('الدوال:', rpcs.length);
}
const users = await fetch(`${url}/auth/v1/admin/users?per_page=1`, { headers });
console.log('Auth Admin API:', users.status, users.statusText);
