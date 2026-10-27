// ======================================================================
// net.ts — حالة الاتصال الفعلية. navigator.onLine لوحدها مش موثوقة (ممكن تقول «متصل» وهو على شبكة من غير إنترنت)،
// فبنجمع: حدث online/offline + نتيجة آخر طلبات فعلية (supabase.ts بيبلّغنا) + فحص خفيف دوري لملف من نفس الموقع.
// ======================================================================
type Listener = () => void;

let online = typeof navigator === 'undefined' ? true : navigator.onLine !== false;
let lastChange = Date.now();
const listeners = new Set<Listener>();
let probeTimer: ReturnType<typeof setTimeout> | null = null;
let probing = false;

function set(v: boolean) {
  if (v === online) return;
  online = v; lastChange = Date.now();
  listeners.forEach((l) => l());
}

export const net = {
  isOnline: () => online,
  since: () => lastChange,
  subscribe(l: Listener): () => void { listeners.add(l); return () => { listeners.delete(l); }; },
  /** طلب فعلي نجح (أي رد من الخادم حتى لو 4xx) ← إحنا متصلين */
  reportSuccess() { set(true); },
  /** طلب فشل على مستوى الشبكة (fetch رمى TypeError) ← غالبًا مفيش اتصال؛ نتأكد بفحص */
  reportFailure() { set(false); scheduleProbe(2_000); },
  /** فحص فعلي: ملف صغير من نفس الموقع (بدون كاش) */
  async probe(): Promise<boolean> {
    if (probing) return online;
    probing = true;
    try {
      const ctl = new AbortController();
      const t = setTimeout(() => ctl.abort(), 5_000);
      const r = await fetch(`${import.meta.env.BASE_URL}version.json?p=${Date.now()}`, { cache: 'no-store', signal: ctl.signal });
      clearTimeout(t);
      // ملف الـ SW الاحتياطي (offline.html) مش بيتقدّم لهذا المسار، فأي رد ناجح = وصلنا للسيرفر
      set(r.ok || r.status < 500);
    } catch { set(false); }
    finally { probing = false; }
    if (!online) scheduleProbe(15_000);
    return online;
  },
};

function scheduleProbe(ms: number) {
  if (typeof window === 'undefined') return;
  if (probeTimer) clearTimeout(probeTimer);
  probeTimer = setTimeout(() => { probeTimer = null; void net.probe(); }, ms);
}

if (typeof window !== 'undefined') {
  window.addEventListener('offline', () => set(false));
  window.addEventListener('online', () => { void net.probe(); }); // نتأكد قبل ما نقول «متصل»
}

/** هل الخطأ ده مشكلة اتصال (مش رفض من الخادم)؟ */
export function isNetworkError(e: unknown): boolean {
  if (!e) return false;
  const msg = typeof e === 'string' ? e : (e as { message?: string }).message ?? '';
  const name = (e as { name?: string }).name ?? '';
  if (name === 'TypeError' || name === 'AuthRetryableFetchError' || name === 'AbortError') return true;
  return /failed to fetch|networkerror|network request failed|load failed|fetch failed|timeout|timed out|ECONN|ENOTFOUND|ETIMEDOUT|net::ERR/i.test(msg);
}
