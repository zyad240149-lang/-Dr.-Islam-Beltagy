// ======================================================================
// offline/index.ts — نقطة التجميع: التخزين + الطابور + الجلسة المحلية + محفّزات المزامنة. المرجع الوحيد للواجهة وطبقة db.
// ما بيستوردش db (عشان مايبقاش فيه دوران) — db بتسجّل نفسها عبر offline.setHooks().
// ======================================================================
import { useSyncExternalStore } from 'react';
import { openStore, memoryStore, type KV } from './idb';
import { OfflineQueue, type OfflineOp } from './queue';
import { OfflineSession, type TableSync } from './session';
import { executeOp } from './executors';
import { net } from './net';
import { supabase } from '../lib/supabase';

export interface OfflineHooks {
  exportSnapshot: () => { data: Record<string, unknown>; sync: Record<string, TableSync> };
  /** بعد مزامنة ناجحة: حمّل الجداول من الخادم (هتشيل علامة «معلّق» وتجيب أرقام الملفات/المواعيد الحقيقية) */
  refreshAfterSync: () => Promise<void>;
}

let store: KV = memoryStore();
let queue = new OfflineQueue(store);
let session = new OfflineSession(store);
let hooks: OfflineHooks | null = null;
let userId: string | null = null;
let initP: Promise<void> | null = null;
let timers: Array<() => void> = [];
let snapTimer: ReturnType<typeof setTimeout> | null = null;
let lastSnap = 0;
let syncing = false;
let inflight: Promise<void> | null = null;
let lastSummary: { at: number; done: number; failed: number; conflicts: number } | null = null;
let lastSyncOkAt = 0;          // آخر مرة الطابور خلص كله بنجاح على الخادم
let snapError: string | null = null; // آخر فشل في حفظ النسخة على الجهاز (امتلاء التخزين مثلًا)

const webLock = <T,>(f: () => Promise<T>): Promise<T | undefined> => {
  const locks = (typeof navigator !== 'undefined' ? (navigator as Navigator & { locks?: LockManager }).locks : undefined);
  if (!locks?.request) return f();
  return locks.request('ortho-offline-sync', { ifAvailable: true }, async (lock) => (lock ? f() : undefined)) as Promise<T | undefined>;
};

const stateListeners = new Set<() => void>();
let version = 0;
const bump = () => { version++; stateListeners.forEach((l) => l()); };

export const offline = {
  /** فتح التخزين (مرة واحدة). آمن يتنادى كذا مرة. لو IndexedDB غير متاح بنكمّل بذاكرة مؤقتة وفيه تحذير في الواجهة. */
  init(): Promise<void> {
    return (initP ??= (async () => {
      store = await openStore();
      queue = new OfflineQueue(store, { lock: webLock });
      session = new OfflineSession(store);
      queue.subscribe(bump);
      net.subscribe(bump);
      bump();
    })());
  },
  get queue() { return queue; },
  get session() { return session; },
  get persistent() { return store.persistent; },
  get userId() { return userId; },
  setHooks(h: OfflineHooks) { hooks = h; },
  /** بعد ما نعرف مين المستخدم (دخول ناجح أو استرجاع بدون إنترنت): حمّل طابوره وشغّل محفّزات المزامنة */
  async start(uid: string) {
    await offline.init();
    userId = uid;
    await queue.load(uid);
    offline.stopTriggers();
    const onVis = () => { if (document.visibilityState === 'visible') void offline.syncNow(); };
    document.addEventListener('visibilitychange', onVis);
    const unsub = net.subscribe(() => { if (net.isOnline()) void offline.syncNow(); });
    const iv = setInterval(() => { if (net.isOnline() && queue.pendingCount()) void offline.syncNow(); }, 30_000);
    timers = [() => document.removeEventListener('visibilitychange', onVis), unsub, () => clearInterval(iv)];
    void offline.syncNow();
  },
  stopTriggers() { timers.forEach((t) => t()); timers = []; if (snapTimer) { clearTimeout(snapTimer); snapTimer = null; } },
  /** إيقاف + تفريغ الذاكرة (من غير مسح التخزين — ده للخروج القسري بسبب سحب الجلسة) */
  stop() { offline.stopTriggers(); queue.unload(); userId = null; bump(); },
  /** مسح كل حاجة محلية (تسجيل الخروج / تبديل المستخدم) */
  async wipeAll() { offline.stopTriggers(); queue.unload(); userId = null; await offline.init(); await store.clearAll(); lastSnap = 0; bump(); },

  /** لقطة البيانات: بتتأجّل وبتتجمّع (مش كل تغيير) لأن حجمها كبير */
  scheduleSnapshot() {
    if (!userId || !hooks || snapTimer) return;
    const wait = Math.max(5_000, 30_000 - (Date.now() - lastSnap));
    snapTimer = setTimeout(() => { snapTimer = null; void offline.saveSnapshotNow(); }, wait);
  },
  async saveSnapshotNow() {
    if (!userId || !hooks) return;
    try { const s = hooks.exportSnapshot(); await session.saveSnapshot(userId, s.data, s.sync); lastSnap = Date.now(); snapError = null; }
    catch (e) { snapError = e instanceof Error ? e.message : String(e); bump(); } // تخزين ممتلئ/ممنوع — نكمّل أونلاين، والواجهة بتعرض السبب
  },

  /** قراءة معرّف المستخدم من جلسة Supabase المحفوظة (من غير شبكة) */
  storedUserId(): string | null {
    try {
      for (let i = 0; i < localStorage.length; i++) {
        const k = localStorage.key(i)!;
        if (/^sb-.*-auth-token$/.test(k)) {
          const j = JSON.parse(localStorage.getItem(k) || 'null');
          if (j?.refresh_token && j?.user?.id) return String(j.user.id);
        }
      }
    } catch { /* ignore */ }
    return null;
  },

  isSyncing: () => syncing || queue.isRunning(),
  lastSyncOkAt: () => lastSyncOkAt,
  snapshotError: () => snapError,
  lastSnapshotAt: () => lastSnap,
  /** المساحة المستخدمة/المتاحة وهل التخزين دائم (المتصبح ممكن يمسح غير الدائم لما المساحة تقل) */
  async storageInfo(): Promise<{ usage: number | null; quota: number | null; persisted: boolean | null }> {
    try {
      const est = await navigator.storage?.estimate?.();
      const persisted = (await navigator.storage?.persisted?.()) ?? null;
      return { usage: est?.usage ?? null, quota: est?.quota ?? null, persisted };
    } catch { return { usage: null, quota: null, persisted: null }; }
  },
  lastSummary: () => lastSummary,

  /** مزامنة الآن. force = تجاهل تأخير إعادة المحاولة (زرار المستخدم). لو فيه مزامنة شغّالة بنستناها (مش بنرجع فورًا) عشان اللي بيستدعي يقرا نتيجة حقيقية. */
  async syncNow(force = false): Promise<void> {
    if (inflight) { await inflight; if (!force || !queue.pendingCount()) return; }
    if (!userId || !queue.pendingCount()) return;
    if (!net.isOnline()) { if (force) await net.probe(); if (!net.isOnline()) return; }
    inflight = (async () => {
      syncing = true; bump();
      try {
        // بنتأكد من وجود جلسة صالحة قبل الإرسال (getSession بيجدّد التوكن لو لزم)
        const { data, error } = await supabase.auth.getSession();
        if (!data.session) {
          if (error && /fetch|network/i.test(error.message)) { net.reportFailure(); return; }
          window.dispatchEvent(new CustomEvent('session-expired'));
          return;
        }
        const s = await queue.run(executeOp, { force });
        lastSummary = { at: Date.now(), done: s.done, failed: s.failed, conflicts: s.conflicts };
        if (!queue.pendingCount()) lastSyncOkAt = Date.now();
        if (s.authError) window.dispatchEvent(new CustomEvent('session-expired'));
        if (s.done > 0 && hooks) { await session.touchVerified(); await hooks.refreshAfterSync().catch(() => {}); }
      } finally { syncing = false; inflight = null; bump(); }
    })();
    await inflight;
  },
};

export type { OfflineOp };

export interface OfflineState { online: boolean; pending: number; attention: number; syncing: boolean; persistent: boolean; version: number }
let cached: OfflineState | null = null;
function snapshot(): OfflineState {
  const next: OfflineState = { online: net.isOnline(), pending: queue.pendingCount(), attention: queue.needsAttention(), syncing: offline.isSyncing(), persistent: store.persistent, version };
  if (cached && cached.online === next.online && cached.pending === next.pending && cached.attention === next.attention && cached.syncing === next.syncing && cached.persistent === next.persistent && cached.version === next.version) return cached;
  return (cached = next);
}
export function useOfflineState(): OfflineState {
  return useSyncExternalStore((l) => { stateListeners.add(l); return () => { stateListeners.delete(l); }; }, snapshot, snapshot);
}
