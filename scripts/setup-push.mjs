// تشغيل إشعارات Push على الخادم: (1) أسرار VAPID + سر الـ hook على Supabase secrets، (2) نشر Edge Function «push»،
// (3) ضبط push_config (رابط الدالة + السر) عشان قاعدة البيانات تنادي الدالة. المفاتيح من .env (VITE_VAPID_PUBLIC_KEY /
// VAPID_PRIVATE_KEY / VAPID_SUBJECT / PUSH_HOOK_SECRET) — مابتتطبعش. إعادة التشغيل آمنة (بيحدّث نفس القيم).
//   node scripts/setup-push.mjs
import { readFileSync } from 'node:fs';
import { env, REF, sql } from './_env.mjs';

const need = ['VITE_VAPID_PUBLIC_KEY', 'VAPID_PRIVATE_KEY', 'PUSH_HOOK_SECRET'];
for (const k of need) if (!env[k]) throw new Error(`${k} مش موجود في .env`);
const H = { Authorization: 'Bearer ' + env.SUPABASE_ACCESS_TOKEN };

const s = await fetch(`https://api.supabase.com/v1/projects/${REF}/secrets`, {
  method: 'POST', headers: { ...H, 'Content-Type': 'application/json' },
  body: JSON.stringify([
    { name: 'VAPID_PUBLIC_KEY', value: env.VITE_VAPID_PUBLIC_KEY },
    { name: 'VAPID_PRIVATE_KEY', value: env.VAPID_PRIVATE_KEY },
    { name: 'VAPID_SUBJECT', value: env.VAPID_SUBJECT || 'mailto:clinic@beltagy-ortho.pages.dev' },
    { name: 'PUSH_HOOK_SECRET', value: env.PUSH_HOOK_SECRET },
  ]),
});
console.log('secrets:', s.status, s.ok ? 'ok' : (await s.text()).slice(0, 200));
if (!s.ok) process.exit(1);

const fd = new FormData();
fd.append('metadata', JSON.stringify({ name: 'push', entrypoint_path: 'index.ts', verify_jwt: false }));
fd.append('file', new Blob([readFileSync(new URL('../supabase/functions/push/index.ts', import.meta.url))], { type: 'application/typescript' }), 'index.ts');
const d = await fetch(`https://api.supabase.com/v1/projects/${REF}/functions/deploy?slug=push`, { method: 'POST', headers: H, body: fd });
console.log('deploy push:', d.status, d.ok ? 'ok' : (await d.text()).slice(0, 300));
if (!d.ok) process.exit(1);

const url = `${env.SUPABASE_URL}/functions/v1/push`;
await sql(`insert into push_config (id, notify_url, hook_secret) values (1, '${url}', '${env.PUSH_HOOK_SECRET.replace(/'/g, "''")}')
  on conflict (id) do update set notify_url = excluded.notify_url, hook_secret = excluded.hook_secret`);
const [c] = await sql('select notify_url, hook_secret is not null as has_secret from push_config where id = 1');
console.log('push_config:', JSON.stringify(c));
