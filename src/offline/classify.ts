// classify.ts — تصنيف ردود الخادم لنتائج تنفيذ (بدون أي اعتماد على Supabase/المتصفح، عشان يتجرّب لوحده).
import { isNetworkError } from './net';
import type { ConflictInfo, ExecResult } from './queue';

export const norm = (v: unknown) => (v === null || v === undefined || v === '' ? null : typeof v === 'object' ? JSON.stringify(v) : String(v));
export const SLOT_MSG = /حجزه|محجوز|تعارض|غير متاح|خارج|إجازة|اجازة|مغلق|عطلة|استراحة|لا يعمل|ما يعمل|مواعيد عمل|الموعد|سابق/;
export const DUP_PHONE = /مسجّل بالفعل|مسجل بالفعل/;

export interface PgErr { message?: string; code?: string; details?: string; hint?: string }
export const clean = (m: string) => m.replace(/^.*?ERROR:\s*/, '').trim();

/** تصنيف رد Supabase ← نتيجة تنفيذ */
export function classify(error: PgErr | null | undefined, status?: number): ExecResult | null {
  if (!error) return null;
  const msg = clean(error.message ?? 'خطأ غير معروف');
  if (isNetworkError(error) || (status !== undefined && (status === 0 || status === 408 || status === 429 || status >= 500))) return { type: 'retry', error: msg };
  if (status === 401 || error.code === 'PGRST301' || /jwt|سجّل الدخول/i.test(msg)) return { type: 'auth', error: msg };
  if (status === 403 || /permission|صلاحية|غير مصرح|غير مسموح/i.test(msg)) return { type: 'failed', error: 'لا تملك صلاحية هذه العملية (ربما اتغيّرت صلاحياتك): ' + msg };
  return { type: 'failed', error: msg };
}

export const asConflict = (c: ConflictInfo): ExecResult => ({ type: 'conflict', conflict: c });


export function bookingError(error: PgErr, status?: number): ExecResult {
  const c = classify(error, status);
  if (c && c.type !== 'failed') return c;
  const msg = clean(error.message ?? '');
  if (/غير موجود|غير نشط|لا يقدم|اختر|مطلوب|غير مكتملة/.test(msg)) return { type: 'failed', error: msg }; // بيانات ناقصة/غلط مش تعارض وقت
  return SLOT_MSG.test(msg) ? asConflict({ reason: 'slot_taken', message: msg }) : { type: 'failed', error: msg };
}
