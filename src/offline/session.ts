// ======================================================================
// session.ts — ربط البيانات المحلية بالمستخدم + لقطة البيانات للتشغيل بدون إنترنت.
//
// الأمان:
//  - كل اللقطة والطابور مرتبطين بمعرّف الموظف (userId). لو سجّل دخول موظف تاني على نفس الجهاز، كل بيانات الأول بتتمسح
//    قبل ما أي شاشة تتعرض — فمفيش بيانات مريض بتتسرّب بين حسابين على جهاز مشترك.
//  - اللقطة بتتحفظ من بيانات جت من الخادم بعد تطبيق صلاحيات الموظف (RLS)، يعني فيها بس اللي يحق له يشوفه.
//  - بتتمسح بالكامل عند «تسجيل الخروج» (لو فيه تغييرات معلّقة الواجهة بتحذّر الأول).
//  - الدخول بدون إنترنت مش «تجاوز للمصادقة»: بيحتاج جلسة Supabase محفوظة من دخول سابق ناجح على نفس الجهاز لنفس المستخدم،
//    وفي حدود OFFLINE_MAX_DAYS من آخر تحقق ناجح على الخادم.
// ======================================================================
import type { KV } from './idb';

export const OFFLINE_MAX_DAYS = 14;
const META = 'meta';
const SNAP = 'snapshot';

export interface OfflineMeta { userId: string; employee: unknown; lastVerifiedAt: number }
export interface Snapshot { userId: string; savedAt: number; data: Record<string, unknown> }

export class OfflineSession {
  constructor(private store: KV, private now: () => number = Date.now) {}

  async getMeta(): Promise<OfflineMeta | undefined> { return this.store.get<OfflineMeta>(META); }

  /** بعد دخول ناجح من الخادم. لو المستخدم اتغيّر ← امسح كل حاجة تخص اللي قبله. يرجّع true لو اتمسح. */
  async bindUser(userId: string, employee: unknown): Promise<boolean> {
    const m = await this.getMeta();
    let wiped = false;
    if (m && m.userId !== userId) { await this.store.clearAll(); wiped = true; }
    await this.store.set(META, { userId, employee, lastVerifiedAt: this.now() } satisfies OfflineMeta);
    return wiped;
  }
  async touchVerified() { const m = await this.getMeta(); if (m) await this.store.set(META, { ...m, lastVerifiedAt: this.now() }); }

  async saveSnapshot(userId: string, data: Record<string, unknown>) {
    await this.store.set(SNAP, { userId, savedAt: this.now(), data } satisfies Snapshot);
  }

  /**
   * هل مسموح نفتح التطبيق بدون إنترنت بلقطة محفوظة؟ شروط (كلها):
   *  1) فيه جلسة Supabase محفوظة من دخول سابق (storedUserId)  2) نفس المستخدم اللي اللقطة بتاعته
   *  3) آخر تحقق ناجح من الخادم في حدود OFFLINE_MAX_DAYS  4) اللقطة موجودة وسليمة.
   */
  async restore(storedUserId: string | null): Promise<{ ok: true; employee: unknown; snapshot: Snapshot } | { ok: false; reason: 'no-session' | 'no-snapshot' | 'other-user' | 'expired' }> {
    if (!storedUserId) return { ok: false, reason: 'no-session' };
    const m = await this.getMeta();
    const s = await this.store.get<Snapshot>(SNAP);
    if (!m || !s) return { ok: false, reason: 'no-snapshot' };
    if (m.userId !== storedUserId || s.userId !== storedUserId) return { ok: false, reason: 'other-user' };
    if (this.now() - m.lastVerifiedAt > OFFLINE_MAX_DAYS * 86400_000) return { ok: false, reason: 'expired' };
    return { ok: true, employee: m.employee, snapshot: s };
  }

  async wipe() { await this.store.clearAll(); }
}
