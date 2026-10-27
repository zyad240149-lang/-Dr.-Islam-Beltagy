// أدوات مشتركة لاختبارات التكامل على Supabase (e2e.mjs و e2e-modules.mjs)
import { createClient } from '@supabase/supabase-js';
import { writeFileSync, mkdirSync } from 'node:fs';
import { env, sql } from './_env.mjs';

export { env, sql };
export const URL_ = env.SUPABASE_URL;
const ANON = env.VITE_SUPABASE_ANON_KEY;

export function suite() {
  const results = [];
  let failed = 0;
  const check = (name, ok, detail = '') => {
    results.push({ name, ok: !!ok, detail: String(detail ?? '').slice(0, 200) });
    if (!ok) failed++;
    console.log(ok ? '  ✓' : '  ✗', name, ok ? '' : `— ${detail}`);
  };
  const section = (title) => console.log('— ' + title);
  const save = (file) => {
    mkdirSync(new URL('../docs/', import.meta.url), { recursive: true });
    writeFileSync(new URL(`../docs/${file}`, import.meta.url), JSON.stringify({ at: new Date().toISOString(), passed: results.length - failed, failed, results }, null, 2));
    console.log(`\n${results.length - failed}/${results.length} passed`);
    process.exitCode = failed ? 1 : 0;
  };
  return { check, section, save, results };
}

export const client = () => createClient(URL_, ANON, { auth: { persistSession: false, autoRefreshToken: false } });

export async function login(phoneDigits, password) {
  const c = client();
  const { error } = await c.auth.signInWithPassword({ email: `${phoneDigits}@clinic.local`, password });
  if (error) throw new Error(`login failed for ${phoneDigits}: ${error.message}`);
  return c;
}
export const loginAdmin = () => login('201000000000', env.ADMIN_INITIAL_PASSWORD);

export async function api(c, method, path, body) {
  const { data } = await c.auth.getSession();
  const r = await fetch(`${URL_}/functions/v1/api/${path}`, { method, headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${data.session.access_token}` }, body: body ? JSON.stringify(body) : undefined });
  return { status: r.status, body: await r.json().catch(() => null) };
}

/** تاريخ اليوم + n يوم بتوقيت القاهرة، مع تخطي الجمعة (العيادة مقفولة) */
export function cairoDate(addDays = 0) {
  const d = new Date(Date.now() + addDays * 86400000);
  const s = new Intl.DateTimeFormat('en-CA', { timeZone: 'Africa/Cairo' }).format(d);
  return new Date(s + 'T12:00:00Z').getUTCDay() === 5 ? cairoDate(addDays + 1) : s;
}
export const cairoToday = () => new Intl.DateTimeFormat('en-CA', { timeZone: 'Africa/Cairo' }).format(new Date());

/** رقم قومي مصري تجريبي صالح الشكل (14 رقم يبدأ بـ 2) */
export const fakeEgyptianId = () => '2' + Array.from({ length: 13 }, () => Math.floor(Math.random() * 10)).join('');
export const randomPassword = () => 'Test#' + Math.random().toString(36).slice(2, 10);
const ALL_DAYS = ['sun', 'mon', 'tue', 'wed', 'thu', 'fri', 'sat'];
export const allDayHours = () => ALL_DAYS.map((day) => ({ day, from: '00:00', to: '23:59' }));

/** حذف حساب موظف اختبار (الصف + حساب الدخول) */
export async function deleteEmployee(id) {
  const [e] = await sql(`select auth_user_id from employees where id = '${id}'`);
  await sql(`delete from employees where id = '${id}'`);
  if (e?.auth_user_id) await fetch(`${URL_}/auth/v1/admin/users/${e.auth_user_id}`, { method: 'DELETE', headers: { apikey: env.SUPABASE_SERVICE_ROLE_KEY, Authorization: 'Bearer ' + env.SUPABASE_SERVICE_ROLE_KEY } });
}
