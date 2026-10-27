// ======================================================================
// pwa.ts — المرجع الوحيد لكل ما يخص التطبيق كـ PWA:
//   اكتشاف المنصة/وضع التشغيل، التقاط install prompt الرسمي للمتصفح، تسجيل وتحديث الـ Service Worker، والإشعارات (Web Push).
// الواجهة (InstallButton / PwaUpdateBanner / PushToggle) بتقرا الحالة من هنا عبر usePwa() فقط.
// ======================================================================
import { useSyncExternalStore } from 'react';
import { supabase } from '../lib/supabase';

interface BeforeInstallPromptEvent extends Event {
  prompt(): Promise<void>;
  userChoice: Promise<{ outcome: 'accepted' | 'dismissed' }>;
}

// ---------- اكتشاف المنصة ----------
// الأولوية لـ feature detection (display-mode / navigator.standalone / maxTouchPoints / userAgentData)؛ الـ user-agent آخر حل.
const nav = typeof navigator !== 'undefined' ? navigator : ({} as Navigator);
const uaData = (nav as Navigator & { userAgentData?: { mobile: boolean; platform: string } }).userAgentData;
const ua = nav.userAgent ?? '';

// iPadOS 13+ بيقدّم نفسه كـ Mac — الفرق إنه شاشة لمس
export const isIOS = /iPad|iPhone|iPod/.test(ua) || (/Macintosh/.test(ua) && (nav.maxTouchPoints ?? 0) > 1);
export const isAndroid = uaData ? /android/i.test(uaData.platform) : /Android/i.test(ua);
export const isMobile = uaData ? uaData.mobile || isIOS : isIOS || isAndroid || /Mobi/i.test(ua);
export const isDesktop = !isMobile && !isIOS;
export const isMacOS = !isIOS && (uaData ? /mac/i.test(uaData.platform) : /Macintosh/.test(ua));
// Safari الحقيقي على iOS (Chrome/Firefox/Edge على iOS بيضيفوا CriOS/FxiOS/EdgiOS — "Add to Home Screen" موجودة فيهم من iOS 16.4 عبر قائمة المشاركة برضه)
export const isIOSSafari = isIOS && /Safari/.test(ua) && !/CriOS|FxiOS|EdgiOS|OPiOS/.test(ua);
export const isMacSafari = isMacOS && /Safari/.test(ua) && !/Chrome|Chromium|Edg\//.test(ua);

export function isStandalone(): boolean {
  if (typeof window === 'undefined') return false;
  return ['standalone', 'fullscreen', 'minimal-ui', 'window-controls-overlay'].some((m) => window.matchMedia(`(display-mode: ${m})`).matches)
    || (nav as Navigator & { standalone?: boolean }).standalone === true; // Safari iOS
}

// ---------- الحالة (store بسيط مع useSyncExternalStore) ----------
const INSTALLED_KEY = 'ortho_pwa_installed';
const ls = { get: (k: string) => { try { return localStorage.getItem(k); } catch { return null; } }, set: (k: string, v: string | null) => { try { if (v === null) localStorage.removeItem(k); else localStorage.setItem(k, v); } catch { /* ignore */ } } };

interface PwaState {
  standalone: boolean;          // شغال الآن كتطبيق مثبت (مش في تبويب متصفح)
  installed: boolean;           // مثبت على الجهاز (من داخل التطبيق، أو اتثبت من المتصفح ده)
  canInstall: boolean;          // المتصفح أطلق beforeinstallprompt → نقدر نعرض نافذة التثبيت الرسمية
  updateReady: boolean;         // فيه نسخة جديدة من التطبيق مستنية تفعيل
  swActive: boolean;
}
let promptEvent: BeforeInstallPromptEvent | null = null;
let waitingWorker: ServiceWorker | null = null;
let state: PwaState = { standalone: isStandalone(), installed: isStandalone() || ls.get(INSTALLED_KEY) === '1', canInstall: false, updateReady: false, swActive: false };
const listeners = new Set<() => void>();
function set(patch: Partial<PwaState>) { state = { ...state, ...patch }; listeners.forEach((l) => l()); }
export function usePwa(): PwaState {
  return useSyncExternalStore((l) => { listeners.add(l); return () => listeners.delete(l); }, () => state, () => state);
}

// طريقة التثبيت المتاحة الآن على الجهاز ده
export type InstallMethod = 'native' | 'ios' | 'mac-safari' | 'manual' | 'none';
export function installMethod(s: PwaState = state): InstallMethod {
  if (s.standalone || s.installed) return 'none';
  if (s.canInstall) return 'native';                 // Chrome/Edge (ويندوز/ماك/أندرويد): نافذة التثبيت الرسمية
  if (isIOS) return 'ios';                           // iPhone/iPad: مفيش prompt برمجي — تعليمات المشاركة ← إضافة للشاشة الرئيسية
  if (isMacSafari) return 'mac-safari';              // Safari على ماك (Sonoma+): File ← Add to Dock
  if (isAndroid) return 'manual';                    // أندرويد بمتصفح ما أطلقش الحدث: قائمة المتصفح ← تثبيت / إضافة للشاشة الرئيسية
  return 'none';                                     // متصفح مكتبي مش بيدعم التثبيت (Firefox مثلًا) أو الشروط لسه مش مستوفاة
}

export async function promptInstall(): Promise<'accepted' | 'dismissed' | 'unavailable'> {
  if (!promptEvent) return 'unavailable';
  const e = promptEvent;
  promptEvent = null;                                // الحدث بيتستخدم مرة واحدة بس
  set({ canInstall: false });
  await e.prompt();
  const { outcome } = await e.userChoice;
  return outcome;
}

// ---------- التسجيل (يُستدعى مرة واحدة من main.tsx قبل رسم React عشان مانفوّتش beforeinstallprompt) ----------
export function initPwa() {
  if (typeof window === 'undefined') return;
  window.addEventListener('beforeinstallprompt', (e) => {
    e.preventDefault();                              // نمنع الشريط الافتراضي ونعرض زرنا بدلًا منه
    promptEvent = e as BeforeInstallPromptEvent;
    ls.set(INSTALLED_KEY, null);                     // المتصفح بيطلق الحدث بس لو التطبيق مش مثبت → يعني اتشال
    set({ canInstall: true, installed: false });
  });
  window.addEventListener('appinstalled', () => {
    promptEvent = null;
    ls.set(INSTALLED_KEY, '1');
    set({ canInstall: false, installed: true });
  });
  window.matchMedia('(display-mode: standalone)').addEventListener?.('change', () => set({ standalone: isStandalone(), installed: isStandalone() || state.installed }));

  if (!('serviceWorker' in navigator) || import.meta.env.DEV) return;
  // الـ SW بيشتغل بس على HTTPS أو localhost (قيد المتصفح نفسه)
  window.addEventListener('load', async () => {
    try {
      const reg = await navigator.serviceWorker.register(`${import.meta.env.BASE_URL}sw.js`, { scope: import.meta.env.BASE_URL, updateViaCache: 'none' });
      set({ swActive: !!reg.active });
      const track = (w: ServiceWorker | null) => {
        if (!w) return;
        w.addEventListener('statechange', () => {
          if (w.state === 'installed' && navigator.serviceWorker.controller) { waitingWorker = w; set({ updateReady: true }); }
          if (w.state === 'activated') set({ swActive: true });
        });
      };
      if (reg.waiting && navigator.serviceWorker.controller) { waitingWorker = reg.waiting; set({ updateReady: true }); }
      track(reg.installing);
      reg.addEventListener('updatefound', () => track(reg.installing));
      setInterval(() => reg.update().catch(() => {}), 60 * 60 * 1000); // فحص تحديثات كل ساعة
      let reloaded = false;
      navigator.serviceWorker.addEventListener('controllerchange', () => { if (!reloaded && waitingWorker) { reloaded = true; location.reload(); } });
    } catch (err) {
      console.warn('تعذّر تسجيل Service Worker', err);
    }
  });
}

export function applyUpdate() {
  waitingWorker?.postMessage({ type: 'SKIP_WAITING' });
}

// ---------- Web Push ----------
const VAPID_PUBLIC_KEY = import.meta.env.VITE_VAPID_PUBLIC_KEY as string | undefined;

export type PushSupport = 'supported' | 'unsupported' | 'ios-needs-install' | 'not-configured';
export function pushSupport(): PushSupport {
  if (!VAPID_PUBLIC_KEY) return 'not-configured';
  // iOS/iPadOS 16.4+: الإشعارات متاحة بس للتطبيق المثبت على الشاشة الرئيسية (مش في تبويب Safari)
  if (isIOS && !isStandalone()) return 'ios-needs-install';
  if (!('serviceWorker' in navigator) || !('PushManager' in window) || !('Notification' in window)) return 'unsupported';
  return 'supported';
}

function b64ToUint8(b64: string) {
  const pad = '='.repeat((4 - (b64.length % 4)) % 4);
  const raw = atob((b64 + pad).replace(/-/g, '+').replace(/_/g, '/'));
  return Uint8Array.from(raw, (c) => c.charCodeAt(0));
}

export async function currentPushSubscription(): Promise<PushSubscription | null> {
  if (pushSupport() !== 'supported') return null;
  const reg = await navigator.serviceWorker.getRegistration(import.meta.env.BASE_URL);
  return (await reg?.pushManager.getSubscription()) ?? null;
}

// يطلب الإذن (لازم من ضغطة زر — Safari بيرفض أي طلب مش جاي من تفاعل المستخدم) ويسجّل الاشتراك في قاعدة البيانات
export async function enablePush(): Promise<{ ok: true } | { ok: false; error: string }> {
  const sup = pushSupport();
  if (sup === 'not-configured') return { ok: false, error: 'الإشعارات غير مفعّلة على الخادم بعد (مفتاح VAPID غير مضبوط).' };
  if (sup === 'ios-needs-install') return { ok: false, error: 'على iPhone/iPad ثبّت التطبيق على الشاشة الرئيسية أولًا، ثم فعّل الإشعارات من داخله.' };
  if (sup === 'unsupported') return { ok: false, error: 'هذا المتصفح ما يدعم الإشعارات.' };
  const perm = await Notification.requestPermission();
  if (perm !== 'granted') return { ok: false, error: perm === 'denied' ? 'الإشعارات محظورة لهذا الموقع — فعّلها من إعدادات المتصفح.' : 'ما تم منح إذن الإشعارات.' };
  const reg = await navigator.serviceWorker.ready;
  const sub = (await reg.pushManager.getSubscription()) ?? await reg.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: b64ToUint8(VAPID_PUBLIC_KEY!) });
  const j = sub.toJSON();
  const { error } = await supabase.rpc('save_push_subscription', {
    p_endpoint: sub.endpoint, p_p256dh: j.keys?.p256dh ?? '', p_auth: j.keys?.auth ?? '', p_user_agent: ua.slice(0, 300),
  });
  if (error) return { ok: false, error: error.message };
  return { ok: true };
}

export async function disablePush(): Promise<void> {
  const sub = await currentPushSubscription();
  if (!sub) return;
  await supabase.rpc('delete_push_subscription', { p_endpoint: sub.endpoint });
  await sub.unsubscribe();
}

// إرسال إشعار تجريبي لأجهزة المستخدم الحالي (عبر Edge Function "push")
export async function sendTestPush(): Promise<{ ok: boolean; error?: string; sent?: number }> {
  const { data, error } = await supabase.functions.invoke('push/test', { body: {} });
  if (error) return { ok: false, error: error.message };
  return { ok: true, sent: (data as { sent?: number })?.sent ?? 0 };
}
