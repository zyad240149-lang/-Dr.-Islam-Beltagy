// حالة الفاتورة للعرض (١١/١١): أي حجز لسه «غير مؤكد» (جديد / اتأجّل) ومفيش عليه ولا دفعة ← فاتورته «مستحقة»،
// حتى لو قيمتها صفر (متابعة مجانية) — بدل «مدفوعة». الحالة المتسجلة على الخادم زي ما هي؛ ده عرض بس.
// لو اتسجلت دفعة فعلًا على الحجز (دفع مقدّم) بتفضل حالتها الحقيقية عشان الأرقام ماتكدبش.
import { db } from './db';
import { INVOICE_STATUS } from '../utils/format';
import type { InvoiceStatus } from '../types';

const UNCONFIRMED = new Set(['new', 'rescheduled']);

type InvLike = { status: string; paid?: number | null; id?: string; no?: string; appointmentId?: string | null };

export function invoiceStatusOf(i: InvLike): InvoiceStatus {
  const st = i.status as InvoiceStatus;
  if (st !== 'paid' || Number(i.paid ?? 0) > 0) return st;
  const apptId = i.appointmentId !== undefined ? i.appointmentId
    : (i.id ? db.invoice(i.id)?.appointmentId : undefined) ?? (i.no ? db.invoices().find((x) => x.no === i.no)?.appointmentId : undefined);
  const a = apptId ? db.appointment(apptId) : undefined;
  return a && UNCONFIRMED.has(a.status) ? 'due' : st;
}

export const invoiceStatusLabel = (i: InvLike): { label: string; tone: string } =>
  INVOICE_STATUS[invoiceStatusOf(i)] ?? { label: i.status, tone: 'muted' };
