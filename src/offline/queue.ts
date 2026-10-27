// ======================================================================
// queue.ts — طابور العمليات المحلية + محرك المزامنة. ما بيعتمدش على Supabase ولا React (قابل للاختبار لوحده):
// التنفيذ الفعلي على الخادم بيتحقن من برّه (executors.ts).
//
// القواعد:
//  - كل عملية ليها معرّف فريد (id) بيتحفظ في IndexedDB قبل أي محاولة إرسال، فبيصمد بعد إغلاق التطبيق.
//  - المحرك بينفّذ العمليات بالترتيب. عملية بتعتمد على عملية قبلها (dependsOn) بتستنى لحد ما تنجح.
//  - فشل مؤقت (شبكة/خادم) ← إعادة محاولة بتأخير متزايد. فشل تحقق من الخادم ← «failed» (بيتعدّل أو يتلغي).
//    تعارض مع بيانات الخادم ← «conflict» (المستخدم يقرر؛ مفيش كتابة فوق أي حاجة بصمت).
//  - عملية انقطع الاتصال في نصها (syncing) بترجع pending عند الفتح؛ الخادم بيتعامل مع التكرار (executors) فمفيش تكرار.
// ======================================================================
import type { KV } from './idb';

export type OpKind = 'patient.create' | 'patient.update' | 'appointment.create' | 'appointment.reschedule' | 'appointment.cancel' | 'assessment.save';
export type OpStatus = 'pending' | 'syncing' | 'failed' | 'conflict';

export interface OfflineOp {
  id: string;                 // معرّف العملية (idempotency key)
  kind: OpKind;
  userId: string;             // الموظف اللي سجّلها — مش بتتبعت لحد غيره
  entityId: string;           // المريض/الموعد/التقييم المتأثر
  label: string;              // وصف قصير للعرض
  payload: Record<string, unknown>;
  base?: Record<string, unknown>; // قيم الحقول وقت التعديل (لكشف تعارض التعديل)
  dependsOn?: string;         // entityId لعملية إنشاء لازم تنجح الأول
  createdAt: number;
  status: OpStatus;
  attempts: number;
  nextAttemptAt: number;
  lastError?: string;
  conflict?: ConflictInfo;
}

export interface ConflictInfo {
  reason: 'slot_taken' | 'server_changed' | 'duplicate_patient' | 'other';
  message: string;
  fields?: string[];          // الحقول اللي اتغيّرت على الخادم
  serverValues?: Record<string, unknown>;
  existingId?: string;        // مريض موجود بنفس الجوال (duplicate_patient)
}

export type ExecResult =
  | { type: 'done' }
  | { type: 'retry'; error: string }                 // فشل مؤقت: شبكة/خادم
  | { type: 'auth'; error: string }                  // الجلسة منتهية/الصلاحية اتسحبت
  | { type: 'failed'; error: string }                // رفض من الخادم (تحقق)
  | { type: 'conflict'; conflict: ConflictInfo };

export type Executor = (op: OfflineOp) => Promise<ExecResult>;

export type Resolution =
  | { type: 'keep-mine' }                            // اكتب تعديلي (بعد ما شفت اللي على الخادم)
  | { type: 'keep-server' }                          // اتجاهل تعديلي
  | { type: 'use-existing' }                         // اربط بالمريض الموجود بدل إنشاء جديد
  | { type: 'retime'; date: string; time: string; therapistId?: string } // غيّر الموعد وحاول تاني
  | { type: 'discard' };

const BACKOFF_BASE_MS = 5_000;
const BACKOFF_MAX_MS = 5 * 60_000;
export const backoff = (attempts: number) => Math.min(BACKOFF_MAX_MS, BACKOFF_BASE_MS * 2 ** Math.max(0, attempts - 1));

export const uuid = (): string =>
  (typeof crypto !== 'undefined' && 'randomUUID' in crypto)
    ? crypto.randomUUID()
    : 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, (c) => { const r = (Math.random() * 16) | 0; return (c === 'x' ? r : (r & 0x3) | 0x8).toString(16); });

export interface QueueEvents { change: () => void; done: (op: OfflineOp) => void }

export class OfflineQueue {
  private ops: OfflineOp[] = [];
  private listeners = new Set<() => void>();
  private doneListeners = new Set<(op: OfflineOp) => void>();
  private running = false;
  private loaded = false;
  lastRunAt = 0;
  lastRunError: string | null = null;

  constructor(private store: KV, private opts: { now?: () => number; lock?: <T>(f: () => Promise<T>) => Promise<T | undefined> } = {}) {}
  private now() { return this.opts.now ? this.opts.now() : Date.now(); }

  /** تحميل الطابور من التخزين (عند فتح التطبيق). عملية كانت «syncing» (التطبيق اتقفل في نصها) ترجع pending. */
  async load(userId: string | null) {
    const all = await this.store.ops.getAll<OfflineOp>();
    this.ops = all.filter((o) => userId && o.userId === userId).sort((a, b) => a.createdAt - b.createdAt);
    for (const o of this.ops) if (o.status === 'syncing') { o.status = 'pending'; await this.store.ops.put(o); }
    this.loaded = true;
    this.emit();
  }
  /** عمليات مستخدم تاني ما بتتحمّلش في الذاكرة ولا بتتبعت (بتتمسح عند تغيير المستخدم — شوف session.ts) */
  unload() { this.ops = []; this.loaded = false; this.emit(); }

  subscribe(l: () => void): () => void { this.listeners.add(l); return () => { this.listeners.delete(l); }; }
  onDone(l: (op: OfflineOp) => void): () => void { this.doneListeners.add(l); return () => { this.doneListeners.delete(l); }; }
  private emit() { this.listeners.forEach((l) => l()); }

  list(): OfflineOp[] { return this.ops.slice(); }
  pendingCount(): number { return this.ops.length; }
  needsAttention(): number { return this.ops.filter((o) => o.status === 'failed' || o.status === 'conflict').length; }
  isRunning() { return this.running; }
  get(id: string) { return this.ops.find((o) => o.id === id); }
  hasPendingFor(entityId: string) { return this.ops.some((o) => o.entityId === entityId || o.dependsOn === entityId); }

  async enqueue(input: Omit<OfflineOp, 'id' | 'createdAt' | 'status' | 'attempts' | 'nextAttemptAt'> & { id?: string }): Promise<OfflineOp> {
    const op: OfflineOp = { ...input, id: input.id ?? uuid(), createdAt: this.now(), status: 'pending', attempts: 0, nextAttemptAt: 0 };
    // حفظ في التخزين الأول — لو فشل (ممتلئ/ممنوع) نرمي الخطأ والواجهة تقول للمستخدم إن التغيير ما اتحفظش
    await this.store.ops.put(op);
    this.ops.push(op);
    this.emit();
    return op;
  }

  private async save(op: OfflineOp) { await this.store.ops.put(op); this.emit(); }
  private async remove(op: OfflineOp) { await this.store.ops.del(op.id); this.ops = this.ops.filter((o) => o.id !== op.id); this.emit(); }

  /** تشغيل المزامنة مرة واحدة. بيرجّع ملخّص. محمي من التشغيل المتزامن (نفس التبويب + بين التبويبات عبر lock). */
  async run(exec: Executor, opts: { force?: boolean } = {}): Promise<{ done: number; failed: number; conflicts: number; retry: number; authError: boolean }> {
    const summary = { done: 0, failed: 0, conflicts: 0, retry: 0, authError: false };
    if (this.running || !this.loaded) return summary;
    this.running = true; this.emit();
    const body = async () => {
      // نمشي على نسخة؛ العمليات اللي بتتضاف أثناء التشغيل بتتاخد في الجولة اللي بعدها
      const skipped = new Set<string>();
      for (const op of this.ops.slice()) {
        if (op.status === 'failed' || op.status === 'conflict') { skipped.add(op.entityId); continue; }
        if (!opts.force && op.nextAttemptAt > this.now()) { skipped.add(op.entityId); summary.retry++; continue; }
        // عملية معتمدة على إنشاء لسه ما خلصش (أو فشل/تعارض) تستنى
        if (op.dependsOn && (skipped.has(op.dependsOn) || this.ops.some((o) => o !== op && o.entityId === op.dependsOn && o.kind.endsWith('.create')))) {
          const blocker = this.ops.find((o) => o !== op && o.entityId === op.dependsOn && o.kind.endsWith('.create'));
          if (blocker) { skipped.add(op.entityId); continue; }
        }
        // لو فيه عملية أقدم على نفس العنصر لسه ما خلصتش، نحافظ على الترتيب
        if (this.ops.some((o) => o !== op && o.entityId === op.entityId && o.createdAt < op.createdAt)) { skipped.add(op.entityId); continue; }
        op.status = 'syncing'; op.attempts += 1; await this.save(op);
        let r: ExecResult;
        try { r = await exec(op); } catch (e) { r = { type: 'retry', error: e instanceof Error ? e.message : String(e) }; }
        if (r.type === 'done') {
          await this.remove(op); summary.done++;
          this.doneListeners.forEach((l) => l(op));
        } else if (r.type === 'retry') {
          op.status = 'pending'; op.lastError = r.error; op.nextAttemptAt = this.now() + backoff(op.attempts); await this.save(op);
          summary.retry++; skipped.add(op.entityId);
          break; // الشبكة/الخادم واقع — مفيش فايدة نكمّل؛ الجولة الجاية
        } else if (r.type === 'auth') {
          op.status = 'pending'; op.lastError = r.error; op.attempts -= 1; await this.save(op);
          summary.authError = true;
          break; // الجلسة محتاجة تجديد/تسجيل دخول — ما نحرقش محاولات
        } else if (r.type === 'conflict') {
          op.status = 'conflict'; op.conflict = r.conflict; op.lastError = r.conflict.message; await this.save(op);
          summary.conflicts++; skipped.add(op.entityId);
        } else {
          op.status = 'failed'; op.lastError = r.error; await this.save(op);
          summary.failed++; skipped.add(op.entityId);
        }
      }
    };
    try {
      if (this.opts.lock) await this.opts.lock(body); else await body();
      this.lastRunError = null;
    } catch (e) { this.lastRunError = e instanceof Error ? e.message : String(e); }
    finally { this.running = false; this.lastRunAt = this.now(); this.emit(); }
    return summary;
  }

  /** إعادة محاولة عملية فاشلة (من غير ما نفقد بياناتها) */
  async retry(id: string) {
    const op = this.get(id); if (!op) return;
    if (op.status === 'conflict') return; // التعارض بيتحل بقرار، مش بإعادة محاولة عمياء
    op.status = 'pending'; op.nextAttemptAt = 0; op.lastError = undefined; await this.save(op);
  }
  async retryAll() { for (const o of this.ops.slice()) if (o.status === 'failed') await this.retry(o.id); }

  /** حل تعارض/فشل بقرار المستخدم */
  async resolve(id: string, res: Resolution): Promise<void> {
    const op = this.get(id); if (!op) return;
    if (res.type === 'discard' || res.type === 'keep-server') {
      // لو الملغي «إنشاء»، العمليات اللي معتمدة عليه (مواعيد المريض ده) ما ينفعش تكمّل — بتتحوّل لفشل واضح
      if (op.kind.endsWith('.create')) {
        for (const o of this.ops.slice()) if (o.dependsOn === op.entityId) { o.status = 'failed'; o.lastError = 'اتلغى المريض اللي مربوط بيه الموعد ده'; await this.save(o); }
      }
      await this.remove(op); return;
    }
    if (res.type === 'keep-mine') {
      op.payload = { ...op.payload, __force: true }; // الخادم هيكتب فوق بعد ما المستخدم شاف الفرق
      op.status = 'pending'; op.conflict = undefined; op.lastError = undefined; op.nextAttemptAt = 0; await this.save(op); return;
    }
    if (res.type === 'use-existing') {
      const existing = op.conflict?.existingId; if (!existing) return;
      // كل العمليات المعتمدة على المريض الجديد تتحوّل للمريض الموجود
      for (const o of this.ops.slice()) {
        if (o.dependsOn === op.entityId) {
          o.payload = { ...o.payload, patientId: existing }; o.dependsOn = undefined; o.status = 'pending'; o.lastError = undefined; o.nextAttemptAt = 0; await this.save(o);
        }
      }
      await this.remove(op); return;
    }
    if (res.type === 'retime') {
      const to = { date: res.date, time: res.time, ...(res.therapistId ? { therapistId: res.therapistId } : {}) };
      if (op.kind === 'appointment.create') op.payload = { ...op.payload, p: { ...(op.payload.p as object), ...to }, local: { ...(op.payload.local as object), ...to } };
      else op.payload = { ...op.payload, ...to, local: { ...(op.payload.local as object), ...to } };
      op.status = 'pending'; op.conflict = undefined; op.lastError = undefined; op.nextAttemptAt = 0; await this.save(op);
    }
  }

  /** تعديل بيانات عملية فاشلة (تصحيح خطأ تحقق) وإعادة المحاولة */
  async editPayload(id: string, patch: Record<string, unknown>) {
    const op = this.get(id); if (!op) return;
    op.payload = { ...op.payload, ...patch }; op.status = 'pending'; op.lastError = undefined; op.nextAttemptAt = 0; await this.save(op);
  }

  async clearAll() { this.ops = []; await this.store.clearAll(); this.emit(); }
}
