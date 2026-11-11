// ١١/١١: المستحق القديم على المريض + توزيع الدفعة: الفواتير القديمة المستحقة الأول (الأقدم فالأحدث)، وبعدين فاتورة الزيارة الحالية.
import { db } from './db';
import { todayYmd } from '../utils/format';
import type { Invoice, PaymentMethod } from '../types';

const SKIP_APPT = new Set(['cancelled', 'no_show']);
const oldestFirst = (a: Invoice, b: Invoice) => a.date.localeCompare(b.date) || (a.createdAt ?? 0) - (b.createdAt ?? 0);

/** فواتير المريض المستحقة من زيارات قبل كده (أو النهارده) غير الفاتورة دي — من غير الباقات، والمواعيد الملغاة/اللي ماحضرهاش */
export function patientOldDue(patientId: string, exceptInvoiceId?: string): Invoice[] {
  const today = todayYmd();
  return db.invoices().filter((i) => i.patientId === patientId && i.id !== exceptInvoiceId && !i.packageId
    && (i.status === 'due' || i.status === 'partial') && i.remaining > 0 && i.date <= today
    && !(i.appointmentId && SKIP_APPT.has(db.appointment(i.appointmentId)?.status ?? ''))).sort(oldestFirst);
}

export const sumRemaining = (list: Invoice[]) => Math.round(list.reduce((s, i) => s + i.remaining, 0) * 100) / 100;

/** يسجّل المبلغ: المستحق القديم الأول وبعدين الفاتورة الحالية. بيقف عند أول خطأ ويرجّع اللي اتسجّل لحد هناك */
export async function payOldestFirst(patientId: string, current: Invoice | undefined, amount: number, method: PaymentMethod): Promise<{ ok: boolean; error?: string; done: Array<{ no: string; amount: number }> }> {
  const targets = [...patientOldDue(patientId, current?.id), ...(current && (current.status === 'due' || current.status === 'partial') && current.remaining > 0 ? [current] : [])];
  let left = Math.round(amount * 100) / 100;
  const done: Array<{ no: string; amount: number }> = [];
  for (const inv of targets) {
    if (left <= 0) break;
    const fresh = db.invoice(inv.id) ?? inv;
    const amt = Math.min(left, fresh.remaining);
    if (amt <= 0) continue;
    const note = current && inv.id !== current.id ? `سداد مستحق قديم — اتدفع في زيارة ${current.no}` : '';
    const r = await db.recordPayment(inv.id, amt, method, note);
    if (!r.ok) return { ok: false, error: `${inv.no}: ${r.error ?? 'تعذّر تسجيل الدفع'}`, done };
    done.push({ no: inv.no, amount: amt });
    left = Math.round((left - amt) * 100) / 100;
  }
  return { ok: true, done };
}
