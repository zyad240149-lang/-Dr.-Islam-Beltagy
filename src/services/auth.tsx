import { setMyExtraPerms, setMyPermOverride } from './permissions';
import { createContext, useContext, useEffect, useRef, useState, type ReactNode } from 'react';
import type { Employee } from '../types';
import { db } from '../data/db';
import { supabase } from '../lib/supabase';
import { api } from '../lib/api';
import { map } from '../data/remote';
import { parseStoredPhone, phoneLookupCandidates } from '../utils/phoneUtils';
import { offline } from '../offline';
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
  /** keepOffline: خروج قسري (انتهاء جلسة) — بنسيب العمليات المعلّقة محفوظة لنفس المستخدم؛ تسجيل الخروج العادي بيمسح كل حاجة محلية */
  logout: (opts?: { keepOffline?: boolean }) => void;
  /** التطبيق شغّال من لقطة محفوظة بدون اتصال (الدخول الأصلي اتحقق منه قبل كده) */
  offlineSession: boolean;
}

const AuthContext = createContext<AuthState | null>(null);

type Session = { employee: Employee } | { patient: PatientSession } | 'network' | null;

async function applyCloudSession(): Promise<Session> {
  try {
    const me = await api.me();
    if (me.kind === 'staff') {
      const employee = mapEmployee(me.employee);
      setMyExtraPerms(employee.extraPerms);
      setMyPermOverride(employee.permOverride);
      db.setActor(employee.id);
      // ربط التخزين المحلي بالمستخدم ده (لو اتغيّر المستخدم على الجهاز بيتمسح كل اللي يخص اللي قبله) ثم تشغيل طابور المزامنة
      await offline.init();
      await offline.session.bindUser(employee.id, employee);
      await offline.start(employee.id);
      await db.hydrate();
      return { employee };
    }
    if (me.kind === 'customer') {
      const c = me.customer;
      return { patient: { customerId: c.id, patientId: c.patient_id ?? null, name: c.name, phone: c.phone, email: c.email ?? null } };
    }
    return null;
  } catch (e) {
    // مفيش اتصال/الخادم واقع ≠ الجلسة باطلة: ما نسجّلش الخروج، ونحاول نفتح من اللقطة المحلية
    if (isNetworkError(e) || !net.isOnline() || /((0|5dd))/.test((e as Error)?.message ?? '')) return 'network';
    return null;
  }
}

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<Employee | null>(null);
  const [patient, setPatient] = useState<PatientSession | null>(null);
  const [loading, setLoading] = useState(true);
  const [offlineSession, setOfflineSession] = useState(false);
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
      db.hydrateFromSnapshot(r.snapshot.data);
      await offline.start(employee.id);
      setPatient(null); setUser(employee); setOfflineSession(true);
      return true;
    } catch { return false; }
  };

  const accept = async (s: Session): Promise<'staff' | 'patient' | null> => {
    if (s === 'network') return (await restoreOffline()) ? 'staff' : null;
    if (!s) return null;
    if ('employee' in s) {
      const blocked = leaveMessage(s.employee.id);
      if (blocked) { signingOut.current = true; await supabase.auth.signOut(); db.clear(); await offline.wipeAll(); signingOut.current = false; throw new Error(blocked); }
      setPatient(null); setUser(s.employee); setOfflineSession(false); db.recordLogin();
      return 'staff';
    }
    setUser(null); setPatient(s.patient); db.recordLogin();
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
      const { data } = await supabase.auth.getSession();
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
        setMyExtraPerms(undefined); setMyPermOverride(null); db.setActor(null); db.clear(); offline.stop();
        setUser(null); setPatient(null); setOfflineSession(false);
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
      try {
        const k = await accept(await applyCloudSession());
        if (k) return { ok: true, kind: k };
      } catch (e) { return { ok: false, error: (e as Error).message }; }
      await supabase.auth.signOut();
      return { ok: false, error: 'هذا الحساب غير مفعّل.' };
    }
    return { ok: false, error: /fetch|network/i.test(lastErr) ? 'تعذّر الاتصال بالخادم — تحقق من الإنترنت.' : 'رقم الجوال أو كلمة المرور غير صحيحة.' };
  };

  const logout: AuthState['logout'] = (opts) => {
    signingOut.current = true;
    supabase.auth.signOut().catch(() => {}).finally(() => { signingOut.current = false; });
    setMyExtraPerms(undefined);
    setMyPermOverride(null);
    db.setActor(null);
    db.clear();
    // خروج عادي = مسح كل بيانات المرضى والعمليات المحلية من الجهاز. خروج قسري (انتهت الجلسة) = بنسيب العمليات المعلّقة لنفس المستخدم
    if (opts?.keepOffline) offline.stop(); else void offline.wipeAll();
    setUser(null); setPatient(null); setOfflineSession(false);
  };

  return <AuthContext.Provider value={{ user, patient, loading, login, logout, offlineSession }}>{children}</AuthContext.Provider>;
}

export function useAuth() {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error('useAuth must be used within AuthProvider');
  return ctx;
}
