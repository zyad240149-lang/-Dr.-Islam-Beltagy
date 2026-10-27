// نشر Edge Function "api" على Supabase (Management API)
// بيرفع معاها src/utils/phoneUtils.ts (نفس تحقق الجوال اللي في الواجهة) مع تحويل import المكتبة لصيغة npm:
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { env, REF } from './_env.mjs';

const require = createRequire(import.meta.url);
const LIB = 'npm:libphonenumber-js@' + require('libphonenumber-js/package.json').version;
const phoneUtils = readFileSync(new URL('../src/utils/phoneUtils.ts', import.meta.url), 'utf8')
  .replace(/from 'libphonenumber-js\/([^']+)'/g, (_, sub) => `from '${LIB}/${sub}'`);
const fd = new FormData();
fd.append('metadata', JSON.stringify({ name: 'api', entrypoint_path: 'index.ts', verify_jwt: false }));
fd.append('file', new Blob([readFileSync(new URL('../supabase/functions/api/index.ts', import.meta.url))], { type: 'application/typescript' }), 'index.ts');
fd.append('file', new Blob([phoneUtils], { type: 'application/typescript' }), 'phoneUtils.ts');
const r = await fetch(`https://api.supabase.com/v1/projects/${REF}/functions/deploy?slug=api`, { method: 'POST', headers: { Authorization: 'Bearer ' + env.SUPABASE_ACCESS_TOKEN }, body: fd });
console.log(r.status, r.ok ? 'deployed api' : (await r.text()).slice(0, 400));
process.exitCode = r.ok ? 0 : 1;
