/* Service Worker — عيادة د. إسلام بلتاجي لجراحة العظام والكسور (PWA)
   القواعد:
   - أي طلب لدومين تاني (Supabase: auth / rest / functions / realtime، Google Fonts...) ما بنلمسوش خالص → الدخول والـ API مايتكسروش.
   - طلبات POST/PATCH/DELETE مابتتخزنش أبدًا.
   - التنقل بين الصفحات (navigation): الشبكة أولًا، ولو مفيش إنترنت → نسخة التطبيق المخزنة، وإلا صفحة offline.html.
   - ملفات البناء (/assets/*.js|css بأسماء فيها hash): من الكاش أولًا (مابتتغيرش أبدًا بنفس الاسم).
   - الأيقونات والشعار: stale-while-revalidate.
   - الأوفلاين: وقت التثبيت بنحمّل كل ملفات البناء (precache-manifest.json اللي بيتولّد وقت البناء) عشان أي شاشة تفتح بدون إنترنت
     حتى لو ما اتزارتش قبل كده؛ وخطوط Google بتتخزّن عند أول استخدام. بيانات المرضى والـ API مابتتخزنش هنا خالص —
     بتتخزن في IndexedDB (src/offline/) مربوطة بالمستخدم وبتتمسح عند الخروج. */
// رقم البناء بيتحط وقت البناء (vite.config.ts) — أي نشر جديد = SW جديد وكاش جديد للملفات (بيانات IndexedDB مابتتلمسش)
const BUILD = 'dev';
const VERSION = 'v6-' + BUILD;
const SHELL = `ortho-shell-${VERSION}`;
const ASSETS = `ortho-assets-${VERSION}`;
const BASE = new URL(self.registration.scope).pathname; // '/' محليًا أو '/admin/' لما اللوحة تتنشر تحت مسار
const P = (x) => BASE + x;
const PRECACHE = [BASE, P('offline.html'), P('manifest.webmanifest'), P('icons/icon.svg'), P('icons/icon.svg'), P('brand/logo.svg')];

self.addEventListener('install', (event) => {
  // Cloudflare بيحوّل offline.html لـ /offline (308) — الرد المحوَّل مايينفعش يترد على تنقّل (المتصفح بيرفضه)، فنخزّنه كرد عادي
  event.waitUntil(caches.open(SHELL).then((c) => Promise.all(PRECACHE.map(async (u) => {
    const res = await fetch(u);
    if (!res.ok) throw new Error('precache ' + u + ' ' + res.status);
    const clean = res.redirected ? new Response(await res.blob(), { status: 200, headers: res.headers }) : res;
    await c.put(u, clean);
  }))));
  // كل ملفات التطبيق (الأقسام اللي بتتحمّل بالطلب) لازم تتخزّن كلها قبل ما النسخة دي تشتغل: لو ملف فشل التثبيت بيفشل
  // والنسخة القديمة (الكاملة) بتفضل شغالة — عشان ماتبقاش فيه نسخة ناقصة تفتح شاشة بيضا بدون إنترنت. المتصفح بيعيد المحاولة لوحده.
  event.waitUntil((async () => {
    if (BUILD === 'dev') return; // سيرفر التطوير: مفيش manifest
    const m = await (await fetch(P('precache-manifest.json'), { cache: 'no-store' })).json();
    const cache = await caches.open(ASSETS);
    const files = (m.files || []).map((f) => P(f));
    for (let i = 0; i < files.length; i += 6) {
      await Promise.all(files.slice(i, i + 6).map(async (u) => {
        if (await caches.match(u, { ignoreVary: true })) { const hit = await caches.match(u, { ignoreVary: true }); return cache.put(u, hit); }
        const r = await fetch(u, { cache: 'no-cache' });
        if (!r.ok) throw new Error('precache ' + u + ' ' + r.status);
        await cache.put(u, r.redirected ? new Response(await r.blob(), { status: 200, headers: r.headers }) : r);
      }));
    }
  })());
  // مابنعملش skipWaiting تلقائي: الواجهة بتعرض "تحديث متاح" والمستخدم يقرر (عشان مايضيعش نموذج مفتوح)
});

self.addEventListener('message', (event) => {
  if (event.data && event.data.type === 'SKIP_WAITING') self.skipWaiting();
});

self.addEventListener('activate', (event) => {
  event.waitUntil((async () => {
    const keep = [SHELL, ASSETS];
    for (const k of await caches.keys()) if (!keep.includes(k)) await caches.delete(k);
    if (self.registration.navigationPreload) await self.registration.navigationPreload.enable();
    await self.clients.claim();
  })());
});

self.addEventListener('fetch', (event) => {
  const req = event.request;
  if (req.method !== 'GET') return;
  const url = new URL(req.url);
  if (url.origin === 'https://fonts.googleapis.com' || url.origin === 'https://fonts.gstatic.com') {
    // خط التطبيق: نخزّنه عند أول استخدام عشان الشكل ما يتغيّرش بدون إنترنت
    event.respondWith((async () => {
      const cache = await caches.open(ASSETS);
      const hit = await cache.match(req, { ignoreVary: true });
      const net = fetch(req).then((res) => { if (res.ok || res.type === 'opaque') cache.put(req, res.clone()); return res; }).catch(() => hit);
      return hit || net;
    })());
    return;
  }
  if (url.origin !== self.location.origin) return;           // Supabase وأي API خارجي: الشبكة مباشرة
  if (url.pathname.startsWith('/@') || url.pathname.startsWith('/src/') || url.pathname.startsWith('/node_modules/')) return; // سيرفر التطوير (Vite HMR)

  if (req.mode === 'navigate') {
    event.respondWith((async () => {
      try {
        const preloaded = await event.preloadResponse;
        // شبكة بطيئة جدًا (مثلًا إنترنت ضعيف) ← بعد 6 ثواني نفتح النسخة المخزنة بدل ما الشاشة تفضل بيضا
        const cached = await caches.match(BASE, { ignoreVary: true });
        const res = preloaded || await (cached ? Promise.race([fetch(req), new Promise((_, rej) => setTimeout(() => rej(new Error('slow')), 6000))]) : fetch(req));
        if (res.ok) (await caches.open(SHELL)).put(BASE, res.clone());
        return res;
      } catch {
        return (await caches.match(BASE, { ignoreVary: true })) || (await caches.match(P('offline.html'), { ignoreVary: true }));
      }
    })());
    return;
  }

  if (url.pathname.startsWith(P('assets/'))) {
    event.respondWith((async () => {
      const hit = await caches.match(req, { ignoreVary: true }); // ignoreVary: طلبات الـ module بتبعت Origin والمخزّن اتجاب من غير — من غيره المطابقة بتفشل أوفلاين
      if (hit) return hit;
      const res = await fetch(req);
      if (res.ok) (await caches.open(ASSETS)).put(req, res.clone());
      return res;
    })());
    return;
  }

  if (url.pathname.startsWith(P('icons/')) || url.pathname.startsWith(P('brand/')) || url.pathname === P('manifest.webmanifest')) {
    event.respondWith((async () => {
      const cache = await caches.open(SHELL);
      const hit = await cache.match(req, { ignoreVary: true });
      const net = fetch(req).then((res) => { if (res.ok) cache.put(req, res.clone()); return res; }).catch(() => hit);
      return hit || net;
    })());
  }
});

/* ---------- Push Notifications ---------- */
self.addEventListener('push', (event) => {
  let data = {};
  try { data = event.data ? event.data.json() : {}; } catch { data = { body: event.data ? event.data.text() : '' }; }
  const title = data.title || 'عيادة د. إسلام بلتاجي لجراحة العظام والكسور';
  // إيصال «وصل للجهاز»: الإشعار اتسجّل في النظام → اتبعت لخدمة الإشعارات → الجهاز ده استقبله فعلًا (مش دليل إن المستخدم شافه)
  const receipt = (ev) => (data.id && data.rt && /^https:\/\//.test(data.rcpt || '')
    ? fetch(data.rcpt, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ id: data.id, rt: data.rt, ev }) }).catch(() => {})
    : Promise.resolve());
  event.waitUntil(Promise.all([receipt('delivered'), self.registration.showNotification(title, {
    body: data.body || '',
    icon: P('icons/icon.svg'),
    badge: P('icons/icon.svg'),
    tag: data.tag || undefined,
    lang: 'ar',
    dir: 'rtl',
    data: { url: data.url || '/', id: data.id, rt: data.rt, rcpt: data.rcpt },
  })]));
});

self.addEventListener('notificationclick', (event) => {
  event.notification.close();
  const d = event.notification.data || {};
  // إيصال «اتفتح»: المستخدم ضغط على الإشعار
  if (d.id && d.rt && /^https:\/\//.test(d.rcpt || '')) fetch(d.rcpt, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ id: d.id, rt: d.rt, ev: 'open' }) }).catch(() => {});
  // روابط الإشعارات بتيجي زي '/appointments' — بتتفتح جوّه نطاق اللوحة
  const target = new URL(String((event.notification.data && event.notification.data.url) || '/').replace(/^\//, ''), self.registration.scope).href;
  event.waitUntil((async () => {
    const wins = await self.clients.matchAll({ type: 'window', includeUncontrolled: true });
    for (const w of wins) {
      if (new URL(w.url).origin === self.location.origin) {
        await w.focus();
        if ('navigate' in w) return w.navigate(target);
        return;
      }
    }
    return self.clients.openWindow(target);
  })());
});
