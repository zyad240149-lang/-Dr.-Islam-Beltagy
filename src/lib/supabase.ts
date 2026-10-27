import { createClient } from '@supabase/supabase-js';
import { net } from '../offline/net';

const url = import.meta.env.VITE_SUPABASE_URL as string;
const anonKey = import.meta.env.VITE_SUPABASE_ANON_KEY as string;

// أي رفض من الخادم سببه «بيانات المريض غير مكتملة» (هجرة 159 — DETAIL = incomplete_patient:<id>) بيفتح نافذة
// «استكمال البيانات» من أي شاشة (IncompleteHost)، مهما كان المسار اللي نادى الخادم
const watchFetch: typeof fetch = async (input, init) => {
  let res: Response;
  try { res = await fetch(input, init); } catch (e) { net.reportFailure(); throw e; } // فشل شبكة ← حالة «غير متصل» (offline/net.ts)
  if (res.status < 500) net.reportSuccess();
  if (res.status >= 400 && res.status < 500 && !String(input instanceof Request ? input.url : input).includes('/auth/v1/')) {
    res.clone().json().then((j) => {
      // الجلسة ما تطابق موظف نشط (انتهت/اتحذف الحساب) → LAYOUT يطلّع «انتهت الجلسة» ويرجّع لصفحة الدخول
      const m = String(j?.message ?? j?.error ?? '');
      if (m.includes('سجّل الدخول بحساب موظف') || m.includes('سجّل الدخول أولًا')) window.dispatchEvent(new CustomEvent('session-expired'));
      const d = typeof j?.details === 'string' ? j.details : '';
      if (d.startsWith('incomplete_patient:')) window.dispatchEvent(new CustomEvent('patient-incomplete', { detail: { patientId: d.slice('incomplete_patient:'.length), missing: j.hint ?? '' } }));
    }).catch(() => {});
  }
  return res;
};

export const supabase = createClient(url, anonKey, {
  auth: { persistSession: true, autoRefreshToken: true },
  global: { fetch: watchFetch },
});
