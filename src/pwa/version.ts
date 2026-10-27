// اكتشاف نسخة جديدة منشورة: بنقارن رقم بناء الكود الشغال (__BUILD_ID__) بـ version.json اللي على السيرفر.
// بيتفحص كل دقيقة وكل ما المستخدم يرجع للتبويب — ولو اختلف بيظهر شريط «تحديث» بزرار.
import { useEffect, useState } from 'react';

export function useNewVersion(): boolean {
  const [stale, setStale] = useState(false);
  useEffect(() => {
    if (import.meta.env.DEV) return;
    let on = true;
    const check = async () => {
      try {
        const r = await fetch(`${import.meta.env.BASE_URL}version.json?t=${Date.now()}`, { cache: 'no-store' });
        if (!r.ok) return;
        const j = await r.json();
        if (on && j && typeof j.id === 'string' && j.id !== __BUILD_ID__) setStale(true);
      } catch { /* بدون إنترنت — نتجاهل */ }
    };
    void check();
    const t = setInterval(check, 60 * 1000);
    const vis = () => { if (document.visibilityState === 'visible') void check(); };
    document.addEventListener('visibilitychange', vis);
    return () => { on = false; clearInterval(t); document.removeEventListener('visibilitychange', vis); };
  }, []);
  return stale;
}
