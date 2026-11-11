import { setMyExtraPerms, setMyPermOverride } from './permissions';
import { createContext, useContext, useEffect, useRef, useState, type ReactNode } from 'react';
import type { Employee } from '../types';
import { db } from '../data/db';
import { supabase } from '../lib/supabase';
import { api } from '../lib/api';
import { map } from '../data/remote';
import { parseStoredPhone, phoneLookupCandidates } from '../utils/phoneUtils';
import { offline, markLoggedOut } from '../offline';
import { net, isNetworkError } from '../offline/net';

const AUTH_DOMAIN = '@clinic.local'; // نفس الدومين اللي الخادم والسكريبتات بينشئوا بيه الحسابات

export const mapEmployee = map.employee;

export function leaveMessage(employeeId: string): string | null {
  const l = db.activeLeave(employeeId);
  if (!l) return null;
  return l.type === 'leave'
    ? 'عندك إجازة معتمدة من ' + l.fromDate + ' إلى ' + l.toDate + ' — ما تقدر تدخل النظام خلال فترة الإجازة.'
    : 'عندك استئذان معتمد اليوم من ' + l.fromTime + ' إلى ' + l.toTime + ' — ما تقدر تدخل النظام خلال هذي الفترة.';
}


export interface PatientSession { customerId: string; patientId: string | null; name: string; phone: string; email: string | null }

interface AuthState {
  user: Employee | null;          // موظف (دور من لوحة الإدارة)
  patient: PatientSession | null; // مريض (بوابة المريض)
  loading: boolean;
  login: (identifier: string, password: string) => Promise<{ ok: boolean; kind?: 'staff' | 'patient'; error?: string }>;
  /** البيانات المحلية بتفضل لنفس المستخدم في كل الحالات (keepOffline اتساب للتوافق) */
  logout: (opts?: { keepOffline?: boolean }) => void;
  /** التطبيق شغّال من لقطة محفوظة بدون اتصال (الدخول الأصلي اتحقق منه قبل كده) */
  offlineSession: boolean;
  /** دخل بجوجل ولسه ماكمّلش الاسم والموبايل والنوع — مالوش أي صفحة غير شاشة الإكمال */
  pendingProfile: PendingProfile | null;
  refreshSession: () => Promise<void>;
}

const AuthContext = createContext<AuthState | null>(null);

export interface PendingProfile { email: string | null; googleName: string }
type Session = { employee: Employee } | { patient: PatientSession } | { pending: PendingProfile } | 'network' | null;

async function applyCloudSession(): Promise<Session> {
  try {
    const me = await api.me();
    if (me.kind === 'pending_profile') return { pending: { email: me.email ?? null, googleName: me.googleName ?? '' } };
    if (me.kind === 'staff') {
      const employee = mapEmployee(me.employee);
      setMyExtraPerms(employee.extraPerms);
      setMyPermOverride(employee.permOverride);
      db.setActor(employee.id);
      // ربط التخزين المحلي بالمستخدم ده (لو اتغيّر المستخدم على الجهاز بيتمسح كل اللي يخص اللي قبله) ثم تشغيل طابور المزامنة
      await offline.init();
      const authUid = (await supabase.auth.getSession()).data.session?.user.id;
      await offline.session.bindUser(employee.id, employee, authUid);
      await offline.start(employee.id);
      // النسخة المحفوظة على الجهاز لنفس المستخدم ← الشاشات بتفتح فورًا منها، والخادم بيبعت «اللي اتغيّر بس» في الخلفية
      // (من غيرها: تحميل كامل لكل البيانات قبل ما الدخول يكمّل)
      const snap = await offline.session.readSnapshot(employee.id).catch(() => undefined);
      if (snap && Object.keys(snap.data).length) { db.hydrateFromSnapshot(snap.data, snap.sync); void db.hydrate(); }
      else await db.hydrate();
      return { employee };
    }
    if (me.kind === 'customer') {
      const c = me.customer;
      return { patient: { customerId: c.id, patientId: c.patient_id ?? null, name: c.name, phone: c.phone, email: c.email ?? null } };
    }
    return null;
  } catch (e) {
    // مفيش اتصال/الخادم واقع (5xx) ≠ الجلسة باطلة: ما نسجّلش الخروج، ونحاول نفتح من النسخة المحلية.
    // 401/403 (الحساب اتوقف أو الصلاحية اتسحبت) = خروج — كان أي خطأ فيه رقم «0» بيتحسب «مفيش إنترنت» ويفتح النسخة المحلية
    const status = (e as { status?: number })?.status;
    if (isNetworkError(e) || !net.isOnline() || status === 0 || (status !== undefined && status >= 500)) return 'network';
    return null;
  }
}

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<Employee | null>(null);
  const [patient, setPatient] = useState<PatientSession | null>(null);
  const [loading, setLoading] = useState(true);
  const [offlineSession, setOfflineSession] = useState(false);
  const [pendingProfile, setPendingProfile] = useState<PendingProfile | null>(null);
  const signingOut = useRef(false);

  // فتح التطبيق بدون اتصال: بيحتاج جلسة محفوظة من دخول سابق ناجح + لقطة لنفس المستخدم + في حدود المدة المسموحة (offline/session.ts)
  const restoreOffline = async (): Promise<boolean> => {
    try {
      await offline.init();
      const r = await offline.session.restore(offline.storedUserId());
      if (!r.ok) return false;
      const employee = r.employee as Employee;
      setMyExtraPerms(employee.extraPerms);
      setMyPermOverride(employee.permOverride);
      db.setActor(employee.id);
      // الطابور الأول: النسخة بتتعرض والعمليات المعلّقة فوقها (لو العكس، اللي اتضاف أوفلاين مابيظهرش بعد إعادة الفتح)
      await offline.start(employee.id);
      db.hydrateFromSnapshot(r.snapshot.data, r.snapshot.sync);
      setPatient(null); setUser(employee); setOfflineSession(true);
      return true;
    } catch { return false; }
  };

  const accept = async (s: Session): Promise<'staff' | 'patient' | 'pending' | null> => {
    if (s === 'network') return (await restoreOffline()) ? 'staff' : null;
    if (!s) return null;
    if ('pending' in s) { setUser(null); setPatient(null); setPendingProfile(s.pending); return 'pending'; }
    setPendingProfile(null);
    if ('employee' in s) {
      const blocked = leaveMessage(s.employee.id);
      if (blocked) { signingOut.current = true; await supabase.auth.signOut(); db.clear(); await offline.wipeAll(); signingOut.current = false; throw new Error(blocked); }
      setPatient(null); setUser(s.employee); setOfflineSession(false); db.recordLogin(); markLoggedOut(false);
      return 'staff';
    }
    setUser(null); setPatient(s.patient); db.recordLogin(); markLoggedOut(false);
    return 'patient';
  };

  useEffect(() => {
    (async () => {
      // تسليم الجلسة من صفحة الدخول في الموقع العام: #sb_access=..&sb_refresh=..
      const h = new URLSearchParams(window.location.hash.slice(1));
      const handoff = !!(h.get('sb_access') && h.get('sb_refresh'));
      if (handoff) {
        const book = h.get('book');
        if (book) { try { sessionStorage.setItem('ortho_pending_book', book); } catch { /* ignore */ } }
        await supabase.auth.setSession({ access_token: h.get('sb_access')!, refresh_token: h.get('sb_refresh')! });
        window.history.replaceState(null, '', window.location.pathname);
      }
      await offline.init();
      // التوكن منتهي (البرنامج اتقفل أكتر من ساعة) ومفيش نت: supabase بيحاول يجدده ويعيد المحاولة ~30 ثانية أو أكتر،
      // والشاشة كانت بتفضل «بتحمّل». لو الموظف ليه نسخة على الجهاز ومستنيناش أكتر من كده ← نفتح منها فورًا،
      // ولما الجلسة توصل (النت رجع) نتحقق منها ونكمّل أونلاين.
      const sessP = supabase.auth.getSession();
      const wait = navigator.onLine === false ? 400 : 4000;
      const first = await Promise.race([sessP, new Promise<'slow'>((ok) => setTimeout(() => ok('slow'), wait))]);
      // بس لو فيه جلسة دخول محفوظة فعلًا — بعد «تسجيل الخروج» supabase بيمسحها، فمابنفتحش بيانات المرضى من غير دخول
      const hasStoredSession = (() => { try { return Object.keys(localStorage).some((k) => /^sb-.*-auth-token$/.test(k) && !!JSON.parse(localStorage.getItem(k) || 'null')?.refresh_token); } catch { return false; } })();
      if (first === 'slow' && hasStoredSession && offline.storedUserId() && (await restoreOffline())) {
        setLoading(false);
        void sessP.then(async ({ data: late }) => {
          if (!late.session || !net.isOnline()) return;
          const s = await applyCloudSession();
          if (s && s !== 'network' && 'employee' in s) { setUser(s.employee); setOfflineSession(false); }
          else if (s === null) window.dispatchEvent(new CustomEvent('session-expired'));
        }).catch(() => {});
        return;
      }
      const { data } = first === 'slow' ? await sessP : first;
      if (data.session) {
        try {
          const s = await applyCloudSession();
          const k = await accept(s);
          if (!k && s !== 'network') await supabase.auth.signOut(); // «network» ما بتنهيش الجلسة أبدًا
        }
        catch { /* إجازة معتمدة — تم إنهاء الجلسة */ }
      } else if (offline.storedUserId() && !net.isOnline()) {
        // التوكن منتهي ومفيش إنترنت لتجديده (getSession بترجّع null): الجلسة المحفوظة لسه موجودة، فنفتح من اللقطة المحلية
        await restoreOffline();
      }
      setLoading(false);
    })();
    // سحب الجلسة من الخادم (توكن التجديد اتلغى/الحساب اتعطّل) ← خروج فوري. العمليات المعلّقة بتفضل محفوظة لنفس المستخدم بس.
    const { data: sub } = supabase.auth.onAuthStateChange((event) => {
      if (event === 'SIGNED_OUT' && !signingOut.current) {
        markLoggedOut(true);
        setMyExtraPerms(undefined); setMyPermOverride(null); db.setActor(null); db.clear(); offline.stop();
        setUser(null); setPatient(null); setPendingProfile(null); setOfflineSession(false);
      }
    });
    return () => sub.subscription.unsubscribe();
  }, []);

  // رجوع الإنترنت وإحنا شغّالين من اللقطة: نتحقق من الجلسة فعليًا قبل ما نكمّل (لو الصلاحية اتسحبت نخرج)
  useEffect(() => {
    if (!offlineSession) return;
    return net.subscribe(() => {
      if (!net.isOnline()) return;
      void (async () => {
        const s = await applyCloudSession();
        if (s && s !== 'network' && 'employee' in s) { setUser(s.employee); setOfflineSession(false); }
        else if (s === null) window.dispatchEvent(new CustomEvent('session-expired'));
      })();
    });
  }, [offlineSession]);

  const login: AuthState['login'] = async (identifier, password) => {
    const id = identifier.trim().toLowerCase();
    // موظف: اسم المستخدم — مريض: رقم الجوال. لو المدخل رقم جوال، بنجرب كل صيغه (E.164 والصيغ القديمة) عشان الحسابات القديمة تفضل شغالة
    const e164 = parseStoredPhone(id).e164;
    const variants = e164 ? phoneLookupCandidates(e164).map((v) => v.replace(/^\+/, '')) : [];
    const emails = Array.from(new Set([id + AUTH_DOMAIN, ...variants.map((v) => v + AUTH_DOMAIN), ...variants.map((v) => 'c' + v + AUTH_DOMAIN)]));
    let lastErr = '';
    for (const email of emails) {
      const { data, error } = await supabase.auth.signInWithPassword({ email, password });
      if (error) { lastErr = error.message; continue; }
      if (!data.session) continue;
      let s: Session;
      try {
        s = await applyCloudSession();
        const k = await accept(s);
        if (k && k !== 'pending') return { ok: true, kind: k };
      } catch (e) { return { ok: false, error: (e as Error).message }; }
      await supabase.auth.signOut();
      // الخادم مارّدش (مش إن الحساب موقوف) — كانت بتظهر «غير مفعّل» وده بيضلّل
      if (s === 'network') return { ok: false, error: 'كلمة المرور صح، بس الخادم مارّدش — حدّث الصفحة وجرّب تاني بعد شوية.' };
      return { ok: false, error: 'هذا الحساب غير مفعّل.' };
    }
    return { ok: false, error: /fetch|network/i.test(lastErr) ? 'تعذّر الاتصال بالخادم — تحقق من الإنترنت.' : 'رقم الجوال أو كلمة المرور غير صحيحة.' };
  };

  const logout: AuthState['logout'] = (opts) => {
    markLoggedOut(true); // قبل أي حاجة: لو الصفحة اتقفلت قبل ما supabase يمسح الجلسة، البرنامج مايفتحش أوفلاين
    signingOut.current = true;
    supabase.auth.signOut().catch(() => {}).finally(() => { signingOut.current = false; });
    setMyExtraPerms(undefined);
    setMyPermOverride(null);
    db.setActor(null);
    db.clear();
    // النسخة المتشفّرة والعمليات المعلّقة بتفضل على الجهاز لنفس الموظف ← الدخول الجاي بيفتح فورًا ويجيب «اللي اتغيّر بس»
    // (من غيرها كل دخول كان تحميل كامل لكل البيانات). موظف تاني يدخل على نفس الجهاز ← bindUser بيمسح كل حاجة الأول.
    // الدخول بدون إنترنت بعد الخروج مش ممكن: signOut بيمسح جلسة Supabase المحفوظة.
    void opts;
    offline.stop();
    setUser(null); setPatient(null); setPendingProfile(null); setOfflineSession(false);
  };

  /** بعد ما مريض جوجل يكمّل بياناته: نقرا الحساب من الخادم تاني */
  const refreshSession = async () => { await accept(await applyCloudSession()); };

  return <AuthContext.Provider value={{ user, patient, loading, login, logout, offlineSession, pendingProfile, refreshSession }}>{children}</AuthContext.Provider>;
}

export function useAuth() {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error('useAuth must be used within AuthProvider');
  return ctx;
}
