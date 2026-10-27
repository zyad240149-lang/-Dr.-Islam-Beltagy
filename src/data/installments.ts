import { todayYmd } from '../utils/format';
// باقات 4/6 جلسات: الدفع الكامل أو على دفعتين بموافقة المدير.
// كل القواعد مطبّقة على الخادم (هجرة 049) — هنا قراءة الطلبات + استدعاء الـ RPC + حساب «حالة الدفع» للعرض.
import { supabase } from '../lib/supabase';
import { db } from './db';
import type { Invoice, Package, PackageKind } from '../types';

export type InstallmentStatus = 'pending' | 'approved' | 'rejected' | 'cancelled';
export interface InstallmentRequest {
  id: string; invoiceId: string; packageId: string; patientId: string; total: number; firstAmount: number; secondAmount: number;
  reason: string | null; status: InstallmentStatus; requestedBy: string | null; requestedAt: number;
  decidedBy: string | null; decidedAt: number | null; rejectReason: string | null;
  planId: string | null; firstDueDate: string | null; secondDueDate: string | null;
}
type Result<T = object> = ({ ok: true } & T) | { ok: false; error: string };
const clean = (m: string) => m.replace(/^.*?ERROR:\s*/, '').replace(/\s*\(SQLSTATE.*$/, '').trim() || 'حدث خطأ غير متوقع.';

const toReq = (r: any): InstallmentRequest => ({
  id: r.id, invoiceId: r.invoice_id, packageId: r.package_id, patientId: r.patient_id, total: Number(r.total),
  firstAmount: Number(r.first_amount), secondAmount: Number(r.second_amount), reason: r.reason, status: r.status,
  requestedBy: r.requested_by, requestedAt: new Date(r.requested_at).getTime(), decidedBy: r.decided_by,
  decidedAt: r.decided_at ? new Date(r.decided_at).getTime() : null, rejectReason: r.reject_reason,
  planId: r.plan_id ?? null, firstDueDate: r.first_due_date ?? null, secondDueDate: r.second_due_date ?? null,
});

export const PACKAGE_KIND_LABEL: Record<PackageKind, string> = { pkg4: 'باقة 4 جلسات', pkg6: 'باقة 6 جلسات' };
export const PACKAGE_KIND_SESSIONS: Record<PackageKind, number> = { pkg4: 4, pkg6: 6 };

export const REQ_STATUS: Record<InstallmentStatus, { label: string; tone: string }> = {
  pending: { label: 'بانتظار موافقة المدير', tone: 'warn' }, approved: { label: 'المدير وافق على التقسيط', tone: 'ok' },
  rejected: { label: 'المدير رفض التقسيط', tone: 'danger' }, cancelled: { label: 'ملغي', tone: 'muted' },
};

// حالات الدفع المطلوبة لباقات 4/6
export type PayState = 'awaiting_payment' | 'awaiting_approval' | 'approved' | 'rejected' | 'partial' | 'paid' | 'cancelled';
export const PAY_STATE: Record<PayState, { label: string; tone: string }> = {
  awaiting_payment: { label: 'بانتظار الدفع', tone: 'muted' },
  awaiting_approval: { label: 'بانتظار موافقة التقسيط', tone: 'warn' },
  approved: { label: 'المدير وافق على التقسيط', tone: 'info' },
  rejected: { label: 'تم رفض التقسيط', tone: 'danger' },
  partial: { label: 'مدفوع جزئيًا', tone: 'warn' },
  paid: { label: 'مدفوع بالكامل', tone: 'ok' },
  cancelled: { label: 'ملغاة', tone: 'danger' },
};

/** الباقة الثابتة (4/6) المرتبطة بالفاتورة — لو مش موجودة يبقى الفاتورة على نظام الدفع العادي */
export function fixedPackageOf(inv: Invoice): Package | undefined {
  if (!inv.packageId) return undefined;
  const p = db.raw().packages.find((x) => x.id === inv.packageId);
  return p?.kind ? p : undefined;
}

/** آخر طلب يخص الفاتورة: المفتوح (بانتظار/موافق) أولًا، وإلا آخر رفض */
export function requestFor(reqs: InstallmentRequest[], invoiceId: string) {
  const mine = reqs.filter((r) => r.invoiceId === invoiceId).sort((a, b) => b.requestedAt - a.requestedAt);
  return mine.find((r) => r.status === 'pending' || r.status === 'approved') ?? mine.find((r) => r.status === 'rejected');
}

export function payStateOf(inv: Invoice, req?: InstallmentRequest): PayState {
  if (inv.status === 'cancelled') return 'cancelled';
  if (inv.remaining <= 0 && inv.total > 0) return 'paid';
  if (inv.paid > 0) return 'partial';
  if (req?.status === 'pending') return 'awaiting_approval';
  if (req?.status === 'approved') return 'approved';
  if (req?.status === 'rejected') return 'rejected';
  return 'awaiting_payment';
}

export const empName = (id: string | null | undefined) => (id ? db.employees().find((e) => e.id === id)?.name : undefined) ?? '—';

export const installmentsApi = {
  async list(): Promise<Result<{ rows: InstallmentRequest[] }>> {
    const { data, error } = await supabase.from('package_installment_requests').select('*').order('requested_at', { ascending: false }).limit(2000);
    return error ? { ok: false, error: clean(error.message) } : { ok: true, rows: (data ?? []).map(toReq) };
  },
  async request(invoiceId: string, reason: string, firstDue?: string, secondDue?: string): Promise<Result> {
    const { error } = await supabase.rpc('request_package_installment', { p_invoice: invoiceId, p_reason: reason || null, p_first_due: firstDue || null, p_second_due: secondDue || null });
    return error ? { ok: false, error: clean(error.message) } : { ok: true };
  },
  async decide(id: string, approve: boolean, reason: string): Promise<Result> {
    const { error } = await supabase.rpc('decide_package_installment', { p_id: id, p_approve: approve, p_reason: reason || null });
    return error ? { ok: false, error: clean(error.message) } : { ok: true };
  },
  async updateDates(id: string, firstDue: string, secondDue: string): Promise<Result> {
    const { error } = await supabase.rpc('update_installment_dates', { p_id: id, p_first_due: firstDue, p_second_due: secondDue });
    return error ? { ok: false, error: clean(error.message) } : { ok: true };
  },
  async voidPayment(paymentId: string, reason: string): Promise<Result> {
    const { error } = await supabase.rpc('void_package_payment', { p_id: paymentId, p_reason: reason });
    if (error) return { ok: false, error: clean(error.message) };
    await db.refresh('invoices', 'payments', 'packages', 'activity');
    return { ok: true };
  },
  subscribe(cb: () => void) {
    const ch = supabase.channel(`installments-live-${crypto.randomUUID()}`);
    let t: ReturnType<typeof setTimeout> | null = null;
    ch.on('postgres_changes', { event: '*', schema: 'public', table: 'package_installment_requests' }, () => { if (t) clearTimeout(t); t = setTimeout(cb, 300); });
    ch.subscribe();
    return () => { if (t) clearTimeout(t); supabase.removeChannel(ch); };
  },
};

// ---------- حالة التقسيط + جدول الدفعات (للعرض في الخطة/الفاتورة/ملف المريض) ----------
export type InstState = 'review' | 'pending' | 'approved' | 'awaiting_completion' | 'rejected' | 'completed' | 'none';
export const INST_STATE: Record<Exclude<InstState, 'none'>, { label: string; tone: string }> = {
  review: { label: 'قيد المراجعة', tone: 'muted' },
  pending: { label: 'بانتظار موافقة المدير', tone: 'warn' },
  approved: { label: 'المدير وافق على التقسيط', tone: 'info' },
  awaiting_completion: { label: 'المدير وافق على التقسيط — بانتظار إتمام الفاتورة', tone: 'warn' },
  rejected: { label: 'المدير رفض التقسيط', tone: 'danger' },
  completed: { label: 'مكتمل', tone: 'ok' },
};
export function instStateOf(inv: Invoice, req?: InstallmentRequest): InstState {
  if (!req) return inv.status === 'draft' ? 'review' : 'none';
  if (req.status === 'pending') return 'pending';
  if (req.status === 'rejected') return 'rejected';
  if (req.status !== 'approved') return 'none';
  if (inv.status === 'draft') return 'awaiting_completion';
  if (inv.remaining <= 0 && inv.total > 0) return 'completed';
  return 'approved';
}
export type InstRowState = 'due' | 'paid' | 'overdue' | 'cancelled' | 'upcoming';
export const INST_ROW: Record<InstRowState, { label: string; tone: string }> = {
  due: { label: 'مستحقة', tone: 'warn' }, paid: { label: 'مدفوعة', tone: 'ok' }, overdue: { label: 'متأخرة', tone: 'danger' },
  cancelled: { label: 'ملغاة', tone: 'muted' }, upcoming: { label: 'لم يحن موعدها', tone: 'info' },
};
export interface InstRow { no: 1 | 2; amount: number; dueDate: string | null; state: InstRowState; paidAt: number | null }
export function installmentRows(inv: Invoice, req: InstallmentRequest): InstRow[] {
  const pays = db.paymentsForInvoice(inv.id).filter((p) => !p.voidedAt);
  const today = todayYmd();
  const row = (no: 1 | 2, amount: number, due: string | null): InstRow => {
    const p = pays.find((x) => x.installmentNo === no);
    let state: InstRowState;
    if (inv.status === 'cancelled' || req.status === 'rejected' || req.status === 'cancelled') state = 'cancelled';
    else if (p) state = 'paid';
    else if (due && due < today) state = 'overdue';
    else if (no === 2 && !pays.some((x) => x.installmentNo === 1)) state = 'upcoming';
    else state = 'due';
    return { no, amount, dueDate: due, state, paidAt: p?.date ?? null };
  };
  return [row(1, req.firstAmount, req.firstDueDate), row(2, req.secondAmount, req.secondDueDate)];
}
