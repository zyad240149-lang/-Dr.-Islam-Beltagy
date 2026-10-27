// إنشاء أول مدير نظام (حساب دخول + صف employees مربوط بملف الطبيب)
//   node scripts/create-admin.mjs <رقم الموبايل المصري> <كلمة المرور> "الاسم"
import { env, sql } from './_env.mjs';

const [phone, password, name] = process.argv.slice(2);
if (!/^01[0125]\d{8}$/.test(phone ?? '') || !password || !name) { console.error('الاستخدام: node scripts/create-admin.mjs 01xxxxxxxxx <password> "الاسم"'); process.exit(1); }
if (password.length < 8) { console.error('كلمة المرور 8 خانات على الأقل'); process.exit(1); }
const e164 = '+2' + phone, username = e164.slice(1);
const H = { apikey: env.SUPABASE_SERVICE_ROLE_KEY, Authorization: 'Bearer ' + env.SUPABASE_SERVICE_ROLE_KEY, 'Content-Type': 'application/json' };
const r = await fetch(env.SUPABASE_URL + '/auth/v1/admin/users', { method: 'POST', headers: H, body: JSON.stringify({ email: username + '@clinic.local', password, email_confirm: true }) });
const u = await r.json();
if (!r.ok) { console.error('فشل إنشاء الحساب:', u.msg || u.message || JSON.stringify(u)); process.exit(1); }
const th = (await sql(`select id from therapists where name = 'د. إسلام بلتاجي' limit 1`))[0]?.id ?? null;
await sql(`insert into employees (auth_user_id, name, username, role, phone, therapist_id, job_title)
  values ('${u.id}', '${name.replace(/'/g, "''")}', '${username}', 'system_admin', '${e164}', ${th ? `'${th}'` : 'null'}, 'المدير العام')`);
if (th) await sql(`update therapists set phone = '${e164}' where id = '${th}'`);
console.log('تم إنشاء مدير النظام:', phone);
