// ======================================================================
// download.ts — تنزيل الجداول للجهاز ومزامنتها تزايديًا (هجرة 911).
//
//  - أول مرة (أو لو النسخة المحلية ناقصة/قديمة): تحميل كامل بالترقيم بالمؤشر (keyset على id) — دفعات 1000 صف،
//    ثابت حتى لو اتضاف صفوف أثناء التحميل (مفيش تخطي ولا تكرار زي offset)، وكل دفعة بتتعاد لوحدها لو الشبكة وقعت.
//  - بعد كده: «اللي اتغيّر بس» (updated_at > آخر علامة) + الصفوف المحذوفة (sync_tombstones) ← دمج بالمعرّف.
//    العلامة من وقت الخادم (مش ساعة الجهاز)، وبنرجع 5 دقايق لورا عشان المعاملات اللي اتأخر حفظها.
//  - التحقق: عدد الصفوف على الجهاز لازم يساوي عدد الخادم (count) — لو اختلف ← تحميل كامل تاني. «مكتمل» مابيتقالش غير بعد ده.
// ======================================================================
import { useSyncExternalStore } from 'react';
import { supabase } from '../lib/supabase';
import { isNetworkError } from '../offline/net';
import type { TableSync } from '../offline/session';

const PAGE = 1000;
const OVERLAP_MS = 5 * 60_000;
const MAX_INCREMENTAL_AGE_MS = 55 * 86400_000; // سجل الحذف بيتمسح بعد 60 يوم (هجرة 911)

// ---------- تقدّم التنزيل (للواجهة) ----------
export interface DownloadState { active: boolean; table: string; label: string; loaded: number; total: number | null }
let state: DownloadState = { active: false, table: '', label: '', loaded: 0, total: null };
const listeners = new Set<() => void>();
const setState = (s: Partial<DownloadState>) => { state = { ...state, ...s }; listeners.forEach((l) => l()); };
export const useDownloadState = () => useSyncExternalStore((l) => { listeners.add(l); return () => { listeners.delete(l); }; }, () => state, () => state);
export const downloadState = () => state;

let running = 0; // جداول بتتزامن في نفس الوقت
const wait = (ms: number) => new Promise((r) => setTimeout(r, ms));

/** طلب بإعادة محاولة للأخطاء المؤقتة (شبكة/5xx) — رفض الصلاحية بيترمي على طول */
async function withRetry<T>(f: () => PromiseLike<{ data: T | null; error: { message: string; code?: string } | null; count?: number | null; status?: number }>): Promise<{ data: T | null; count: number | null }> {
  for (let i = 0; ; i++) {
    const r = await f();
    if (!r.error) return { data: r.data, count: r.count ?? null };
    const temporary = isNetworkError(r.error) || (r.status !== undefined && (r.status === 0 || r.status >= 500));
    if (!temporary || i >= 3) throw new Error(r.error.message);
    await wait(1000 * 2 ** i);
  }
}

/** كل الصفوف (أو اللي اتغيّرت بعد since) بالترتيب على id — دفعة ورا دفعة */
export async function fetchKeyset(table: string, opts: { since?: string | null; label?: string; total?: number | null } = {}): Promise<any[]> {
  const out: any[] = [];
  let after: string | null = null;
  for (;;) {
    const r = await withRetry<any[]>(() => {
      let q = supabase.from(table).select('*').order('id').limit(PAGE);
      if (after) q = q.gt('id', after);
      if (opts.since) q = q.gt('updated_at', opts.since);
      return q;
    });
    const rows = r.data ?? [];
    out.push(...rows);
    if (opts.label) setState({ active: true, table, label: opts.label, loaded: out.length, total: opts.total ?? null });
    if (rows.length < PAGE) return out;
    after = rows[rows.length - 1].id;
  }
}

/** عدد الصفوف اللي المستخدم يحق له يشوفها على الخادم */
export async function countRows(table: string): Promise<number | null> {
  try {
    const r = await withRetry(() => supabase.from(table).select('id', { count: 'exact', head: true }));
    return r.count;
  } catch { return null; }
}

async function tombstones(table: string, since: string | null): Promise<Array<{ row_id: string; deleted_at: string }>> {
  try {
    const r = await withRetry<Array<{ row_id: string; deleted_at: string }>>(() => {
      let q = supabase.from('sync_tombstones').select('row_id, deleted_at').eq('table_name', table).order('deleted_at').limit(10000);
      if (since) q = q.gt('deleted_at', since);
      return q;
    });
    return r.data ?? [];
  } catch { return []; }
}

const shift = (iso: string, ms: number) => new Date(new Date(iso).getTime() + ms).toISOString();
const maxIso = (...xs: Array<string | null | undefined>) => xs.filter(Boolean).reduce<string | null>((m, x) => (!m || x! > m ? x! : m), null);
const stamp = (r: any) => (r.updated_at ?? r.created_at ?? null) as string | null;

/**
 * مزامنة جدول: بيرجّع الصفوف (بعد التحويل) وحالة المزامنة الجديدة.
 * current = نسخة الخادم اللي على الجهاز (من غير العمليات المعلّقة)، prev = حالة آخر مزامنة.
 */
export async function syncTable<T extends { id: string }>(table: string, current: T[] | null, map: (r: any) => T, prev: TableSync | undefined, label: string): Promise<{ rows: T[]; sync: TableSync }> {
  running++;
  try {
    // سبب التحميل الكامل بيتسجّل (شاشة المزامنة + التشخيص): أول مرة، نسخة ناقصة، قديمة، أو العدد ماطابقش
    let why = !current ? 'first' : !prev?.watermark ? 'no-watermark' : !prev.complete ? 'incomplete' : Date.now() - prev.at >= MAX_INCREMENTAL_AGE_MS ? 'stale' : '';
    if (!why && current && prev?.watermark) {
      const [changed, gone] = await Promise.all([
        fetchKeyset(table, { since: shift(prev.watermark, -OVERLAP_MS) }),
        tombstones(table, shift(prev.tombAt ?? prev.watermark, -OVERLAP_MS)),
      ]);
      const byId = new Map(current.map((r) => [r.id, r]));
      for (const r of changed) byId.set(r.id, map(r));
      for (const t of gone) byId.delete(t.row_id);
      const rows = [...byId.values()];
      const serverCount = await countRows(table);
      if (serverCount === null || serverCount === rows.length) {
        return { rows, sync: { rows: rows.length, serverCount, watermark: maxIso(prev.watermark, ...changed.map(stamp)), tombAt: maxIso(prev.tombAt, ...gone.map((t) => t.deleted_at)), at: Date.now(), complete: serverCount === rows.length, mode: 'incremental' } };
      }
      why = `count ${rows.length}/${serverCount}`;
      // العدد مختلف (حذف قديم اتمسح من السجل، أو صلاحيات اتغيّرت) ← تحميل كامل
    }
    const total = await countRows(table);
    setState({ active: true, table, label, loaded: 0, total });
    const raw = await fetchKeyset(table, { label, total });
    let watermark = maxIso(...raw.map(stamp));
    const byId = new Map(raw.map((r) => [r.id, map(r)]));
    // اللي اتضاف/اتعدّل أثناء التحميل (ممكن يكون فاتنا لو الـ id بتاعه أصغر من المؤشر)
    if (watermark) { const late = await fetchKeyset(table, { since: shift(watermark, -OVERLAP_MS) }); for (const r of late) byId.set(r.id, map(r)); watermark = maxIso(watermark, ...late.map(stamp)); }
    const rows = [...byId.values()];
    const serverCount = await countRows(table);
    const gone = await tombstones(table, watermark ? shift(watermark, -OVERLAP_MS) : null);
    return { rows, sync: { rows: rows.length, serverCount, watermark, tombAt: maxIso(...gone.map((t) => t.deleted_at)), at: Date.now(), complete: serverCount !== null && serverCount === rows.length, mode: 'full', why } };
  } finally {
    running--;
    if (!running) setState({ active: false });
  }
}
