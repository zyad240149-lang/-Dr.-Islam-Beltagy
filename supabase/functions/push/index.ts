// Edge Function «push» — إرسال Web Push (VAPID) للأجهزة اللي وافقت على الإشعارات. ثلاث نقاط:
//   POST /push          ← من قاعدة البيانات (push_request عن طريق pg_net) بهيدر x-push-secret: يبعت إشعار واحد (notifications.id)
//                          لكل أجهزة صاحبه (مريض أو موظف) ويسجّل النتيجة في notifications.push_*. الإشعار بيتحجز قبل الإرسال
//                          (pending/failed ← sending) فالتريجر والمُرسِل الدوري ما يبعتوش نفس الإشعار مرتين.
//   POST /push/send     ← من لوحة الإدارة (JWT الموظف + صلاحية campaigns): إشعار لكل زوار الموقع اللي ثبّتوا التطبيق (source='site').
//   POST /push/receipt  ← من Service Worker الجهاز: «وصل» / «اتفتح» بتوكن HMAC مربوط بالإشعار (من غير دخول).
// المفاتيح على Supabase secrets بس: VAPID_PUBLIC_KEY / VAPID_PRIVATE_KEY / VAPID_SUBJECT / PUSH_HOOK_SECRET (مش في الكود ولا الواجهة).
import webpush from 'npm:web-push@3.6.7';
import { createClient } from 'npm:@supabase/supabase-js@2.49.1';

const SB_URL = Deno.env.get('SUPABASE_URL')!;
const SERVICE = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
const ANON = Deno.env.get('SUPABASE_ANON_KEY')!;
const SECRET = Deno.env.get('PUSH_HOOK_SECRET') ?? '';
const VAPID_PUBLIC = Deno.env.get('VAPID_PUBLIC_KEY') ?? '';
const VAPID_PRIVATE = Deno.env.get('VAPID_PRIVATE_KEY') ?? '';
if (VAPID_PUBLIC && VAPID_PRIVATE) webpush.setVapidDetails(Deno.env.get('VAPID_SUBJECT') ?? 'mailto:clinic@beltagy-ortho.pages.dev', VAPID_PUBLIC, VAPID_PRIVATE);
const db = createClient(SB_URL, SERVICE, { auth: { persistSession: false, autoRefreshToken: false } });

const CORS = { 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type', 'Access-Control-Allow-Methods': 'POST, OPTIONS' };
const json = (b: unknown, status = 200) => new Response(JSON.stringify(b), { status, headers: { ...CORS, 'Content-Type': 'application/json' } });

// توكن الإيصال: HMAC(id) بنفس سر الـ hook — الجهاز يقدر يبلّغ «وصل/اتفتح» للإشعار ده بس
async function receiptToken(id: string) {
  const key = await crypto.subtle.importKey('raw', new TextEncoder().encode(SECRET), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
  const sig = new Uint8Array(await crypto.subtle.sign('HMAC', key, new TextEncoder().encode(id)));
  return btoa(String.fromCharCode(...sig)).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '').slice(0, 32);
}

type Sub = { id: string; endpoint: string; p256dh: string; auth: string };
// إرسال لكل جهاز؛ الاشتراك اللي الخدمة بتقول إنه انتهى (404/410) بيتمسح
async function sendAll(subs: Sub[], payload: unknown) {
  let ok = 0, fail = 0, removed = 0, err = '';
  await Promise.all(subs.map(async (s) => {
    try {
      await webpush.sendNotification({ endpoint: s.endpoint, keys: { p256dh: s.p256dh, auth: s.auth } }, JSON.stringify(payload), { TTL: 6 * 3600, urgency: 'high' });
      ok++;
      await db.from('push_subscriptions').update({ last_used_at: new Date().toISOString() }).eq('id', s.id);
    } catch (e) {
      const code = (e as { statusCode?: number }).statusCode;
      if (code === 404 || code === 410) { removed++; await db.from('push_subscriptions').delete().eq('id', s.id); }
      else { fail++; err = `${code ?? ''} ${(e as { body?: string }).body ?? (e as Error).message}`.trim().slice(0, 300); }
    }
  }));
  return { ok, fail, removed, err };
}

async function hook(req: Request) {
  if (!SECRET || req.headers.get('x-push-secret') !== SECRET) return json({ error: 'unauthorized' }, 401);
  if (!VAPID_PUBLIC || !VAPID_PRIVATE) return json({ error: 'VAPID keys not configured' }, 500);
  const { notification_id: id } = await req.json().catch(() => ({}));
  if (!id) return json({ error: 'notification_id required' }, 400);
  // حجز الإشعار (مرة واحدة بس) — لو اتبعت قبل كده أو بيتبعت دلوقتي من طلب تاني ما بنعملش حاجة
  const { data: claimed } = await db.from('notifications').update({ push_status: 'sending' }).eq('id', id).in('push_status', ['pending', 'failed', 'no_device']).select('id, audience, customer_id, employee_id, title, body, push_title, push_body, link, kind');
  const n = claimed?.[0];
  if (!n) return json({ skipped: 'not pending' });
  let uid: string | null = null;
  if (n.employee_id) uid = (await db.from('employees').select('auth_user_id').eq('id', n.employee_id).maybeSingle()).data?.auth_user_id ?? null;
  else if (n.customer_id) uid = (await db.from('customers').select('auth_user_id').eq('id', n.customer_id).maybeSingle()).data?.auth_user_id ?? null;
  const subs = uid ? ((await db.from('push_subscriptions').select('id, endpoint, p256dh, auth').eq('auth_user_id', uid)).data ?? []) : [];
  if (!subs.length) {
    await db.from('notifications').update({ push_status: 'no_device', push_error: null }).eq('id', id);
    return json({ status: 'no_device' });
  }
  const payload = {
    title: n.push_title || n.title, body: n.push_body || n.body,
    url: n.link || (n.customer_id ? '/me' : '/'), tag: n.kind,
    id: n.id, rt: await receiptToken(n.id), rcpt: `${SB_URL}/functions/v1/push/receipt`,
  };
  const r = await sendAll(subs, payload);
  if (r.ok > 0) await db.from('notifications').update({ push_status: 'sent', push_sent_at: new Date().toISOString(), push_error: null }).eq('id', id);
  else await db.from('notifications').update({ push_status: r.fail ? 'failed' : 'no_device', push_error: r.err || null }).eq('id', id);
  return json({ status: r.ok > 0 ? 'sent' : r.fail ? 'failed' : 'no_device', ...r });
}

async function receipt(req: Request) {
  const { id, rt, ev } = await req.json().catch(() => ({}));
  if (!id || !rt || rt !== await receiptToken(String(id))) return json({ error: 'invalid' }, 400);
  const col = ev === 'open' ? 'opened_at' : 'delivered_at';
  await db.from('notifications').update({ [col]: new Date().toISOString() }).eq('id', id).is(col, null);
  return json({ ok: true });
}

// إشعار من الإدارة لكل اللي ثبّتوا التطبيق من الموقع — للموظف اللي عنده صلاحية إرسال الإشعارات بس
async function broadcast(req: Request) {
  const auth = req.headers.get('Authorization') ?? '';
  const user = createClient(SB_URL, ANON, { global: { headers: { Authorization: auth } }, auth: { persistSession: false } });
  const [{ data: admin }, { data: perm }] = await Promise.all([user.rpc('is_admin'), user.rpc('has_perm', { p_area: 'campaigns', p_op: 'create' })]);
  if (!admin && !perm) return json({ error: 'ليس لديك صلاحية إرسال الإشعارات.' }, 403);
  if (!VAPID_PUBLIC || !VAPID_PRIVATE) return json({ error: 'مفاتيح الإشعارات (VAPID) مش مضبوطة على الخادم.' }, 500);
  const { title, body, url } = await req.json().catch(() => ({}));
  if (!String(title ?? '').trim() || !String(body ?? '').trim()) return json({ error: 'العنوان والنص مطلوبين.' }, 400);
  const subs = (await db.from('push_subscriptions').select('id, endpoint, p256dh, auth').eq('source', 'site')).data ?? [];
  const r = await sendAll(subs, { title: String(title).slice(0, 120), body: String(body).slice(0, 400), url: String(url || '/'), tag: 'site' });
  return json({ total: subs.length, sent: r.ok, failed: r.fail, removed: r.removed });
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: CORS });
  if (req.method !== 'POST') return json({ error: 'method not allowed' }, 405);
  const path = new URL(req.url).pathname.replace(/\/+$/, '');
  try {
    if (path.endsWith('/push/receipt')) return await receipt(req);
    if (path.endsWith('/push/send')) return await broadcast(req);
    return await hook(req);
  } catch (e) {
    return json({ error: (e as Error).message }, 500);
  }
});
