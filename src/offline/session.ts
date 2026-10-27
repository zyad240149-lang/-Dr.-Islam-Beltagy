// ======================================================================
// session.ts — ربط البيانات المحلية بالمستخدم + نسخة البيانات المحفوظة على الجهاز للتشغيل بدون إنترنت.
//
// الأمان:
//  - كل البيانات والطابور مرتبطين بمعرّف الموظف (userId). لو سجّل دخول موظف تاني على نفس الجهاز، كل بيانات الأول
//    (ومفتاح تشفيرها) بتتمسح قبل ما أي شاشة تتعرض — فمفيش بيانات مريض بتتسرّب بين حسابين على جهاز مشترك.
//  - النسخة بتتحفظ من بيانات جت من الخادم بعد تطبيق صلاحيات الموظف (RLS)، يعني فيها بس اللي يحق له يشوفه.
//  - كل جدول متشفّر لوحده (crypto.ts) — sync (أعداد ووقت آخر مزامنة، من غير بيانات مرضى) بس اللي مكشوف عشان شاشة الحالة.
//  - بتتمسح بالكامل عند «تسجيل الخروج» (لو فيه تغييرات معلّقة الواجهة بتحذّر الأول).
//  - الدخول بدون إنترنت مش «تجاوز للمصادقة»: بيحتاج جلسة Supabase محفوظة من دخول سابق ناجح على نفس الجهاز لنفس المستخدم،
//    وفي حدود OFFLINE_MAX_DAYS من آخر تحقق ناجح على الخادم.
// ======================================================================
import type { KV } from './idb';
import { deviceKey, existingKey, isSealed, seal, unseal } from './crypto';

export const OFFLINE_MAX_DAYS = 14;
const META = 'meta';
const SNAP_META = 'snap:meta';
const SNAP_T = (t: string) => 'snap:t:' + t;
const LEGACY_SNAP = 'snapshot'; // النسخة القديمة (لقطة واحدة غير متشفرة) — بتتقري مرة وبتتمسح مع أول حفظ

// userId = الموظف (صاحب البيانات والطابور) · authUid = حساب الدخول في Supabase (اللي الجلسة المحفوظة بتقول عليه)
export interface OfflineMeta { userId: string; authUid?: string; employee: unknown; lastVerifiedAt: number }
/** حالة مزامنة جدول: عدد الصفوف على الجهاز، العدد على الخادم، وعلامة آخر تغيير اتجاب (وقت الخادم) */
export interface TableSync { rows: number; serverCount: number | null; watermark: string | null; tombAt: string | null; at: number; complete: boolean; mode: 'full' | 'incremental'; why?: string }
export interface SnapMeta { userId: string; savedAt: number; tables: string[]; encrypted: boolean; sync: Record<string, TableSync> }
export interface Snapshot { userId: string; savedAt: number; data: Record<string, unknown>; sync: Record<string, TableSync>; encrypted: boolean }

export class OfflineSession {
  constructor(private store: KV, private now: () => number = Date.now) {}

  async getMeta(): Promise<OfflineMeta | undefined> { return this.store.get<OfflineMeta>(META); }

  /** بعد دخول ناجح من الخادم. لو المستخدم اتغيّر ← امسح كل حاجة تخص اللي قبله. يرجّع true لو اتمسح. */
  async bindUser(userId: string, employee: unknown, authUid?: string): Promise<boolean> {
    const m = await this.getMeta();
    let wiped = false;
    if (m && m.userId !== userId) { await this.store.clearAll(); wiped = true; }
    await this.store.set(META, { userId, authUid, employee, lastVerifiedAt: this.now() } satisfies OfflineMeta);
    return wiped;
  }
  async touchVerified() { const m = await this.getMeta(); if (m) await this.store.set(META, { ...m, lastVerifiedAt: this.now() }); }

  /** حفظ النسخة: كل جدول متشفّر في سجل لوحده، والكل في معاملة واحدة (لو التخزين امتلأ النسخة القديمة بتفضل سليمة) */
  async saveSnapshot(userId: string, data: Record<string, unknown>, sync: Record<string, TableSync> = {}) {
    const key = await deviceKey(this.store);
    const tables = Object.keys(data).filter((t) => data[t] !== undefined);
    const entries: Array<[string, unknown]> = [];
    for (const t of tables) entries.push([SNAP_T(t), key ? await seal(key, data[t]) : data[t]]);
    entries.push([SNAP_META, { userId, savedAt: this.now(), tables, encrypted: !!key, sync } satisfies SnapMeta]);
    const stale = (await this.store.keys()).filter((k) => k.startsWith('snap:t:') && !tables.includes(k.slice(7)));
    await this.store.setMany(entries, [...stale, LEGACY_SNAP]);
  }

  /** معلومات النسخة من غير فك تشفير (لشاشة حالة المزامنة) */
  async snapshotInfo(): Promise<SnapMeta | undefined> { return this.store.get<SnapMeta>(SNAP_META); }

  /** قراءة النسخة لمستخدم معيّن. جدول اتعطّب أو مفتاحه ضاع بيتشال ويتعلّم «ناقص» (بيتحمّل تاني من الخادم أول ما يتصل). */
  async readSnapshot(userId: string): Promise<Snapshot | undefined> {
    const m = await this.store.get<SnapMeta>(SNAP_META);
    if (!m) {
      const legacy = await this.store.get<{ userId: string; savedAt: number; data: Record<string, unknown> }>(LEGACY_SNAP);
      return legacy && legacy.userId === userId ? { ...legacy, sync: {}, encrypted: false } : undefined;
    }
    if (m.userId !== userId) return undefined;
    const key = m.encrypted ? await existingKey(this.store) : null;
    const data: Record<string, unknown> = {};
    const sync = { ...m.sync };
    for (const t of m.tables) {
      const raw = await this.store.get(SNAP_T(t));
      try {
        if (isSealed(raw)) { if (!key) throw new Error('no key'); data[t] = await unseal(key, raw); }
        else if (raw !== undefined) data[t] = raw;
        else throw new Error('missing');
      } catch { if (sync[t]) sync[t] = { ...sync[t], complete: false, watermark: null }; }
    }
    return { userId, savedAt: m.savedAt, data, sync, encrypted: m.encrypted };
  }

  /**
   * هل مسموح نفتح التطبيق بدون إنترنت بالنسخة المحفوظة؟ شروط (كلها):
   *  1) فيه جلسة Supabase محفوظة من دخول سابق (storedUserId = حساب الدخول)  2) نفس الحساب اللي النسخة اتربطت بيه
   *     (كان بيقارن حساب الدخول بمعرّف الموظف — قيمتين مختلفتين، فالفتح بدون إنترنت كان دايمًا بيرجع لشاشة الدخول)
   *  3) آخر تحقق ناجح من الخادم في حدود OFFLINE_MAX_DAYS  4) النسخة موجودة وبتتفك.
   */
  async restore(storedUserId: string | null): Promise<{ ok: true; employee: unknown; snapshot: Snapshot } | { ok: false; reason: 'no-session' | 'no-snapshot' | 'other-user' | 'expired' }> {
    if (!storedUserId) return { ok: false, reason: 'no-session' };
    const m = await this.getMeta();
    if (!m) return { ok: false, reason: 'no-snapshot' };
    if ((m.authUid ?? m.userId) !== storedUserId) return { ok: false, reason: 'other-user' };
    if (this.now() - m.lastVerifiedAt > OFFLINE_MAX_DAYS * 86400_000) return { ok: false, reason: 'expired' };
    const s = await this.readSnapshot(m.userId);
    if (!s || !Object.keys(s.data).length) return { ok: false, reason: 'no-snapshot' };
    return { ok: true, employee: m.employee, snapshot: s };
  }

  async wipe() { await this.store.clearAll(); }
}
