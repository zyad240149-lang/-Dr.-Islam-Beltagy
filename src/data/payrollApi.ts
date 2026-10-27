// «الرواتب والتارجت» — طبقة بيانات مستقلة عن db.ts. كل الحسابات (الإيراد المؤهل، النسبة، المكافأة، المتبقي، حالة الصرف)
// على الخادم (هجرة 112) — الواجهة بتعرض بس. لوحة المدير للمدير العام بس، و my_target للأخصائي (بياناته هو بس).
import { supabase } from '../lib/supabase';

export type SubjectType = 'therapist' | 'employee';
export type BonusMethod = 'none' | 'pct_target' | 'pct_revenue' | 'fixed';
export type BonusCondition = 'reach' | 'exceed' | 'always';
export type RevenueBasis = 'collected' | 'invoiced';
export type PaySystem = 'base_commission' | 'commission_only' | 'base_only';
export type PeriodStatus = 'open' | 'approved' | 'closed';
export type PayStatus = 'not_approved' | 'nothing' | 'unpaid' | 'partial' | 'paid';
export type PayoutKind = 'salary' | 'bonus';
export type PayoutMethod = 'cash' | 'transfer';

export interface LiveCalc {
  hasPlan: boolean; planId: string | null; effectiveFrom: string | null; baseSalary: number; target: number;
  bonusMethod: BonusMethod; bonusRate: number; bonusFixed: number; bonusCondition: BonusCondition; basis: RevenueBasis;
  qualifying: number; invoiced: number; collected: number; visits: number; qualifyingVisits: number; booked: number;
  pct: number | null; remaining: number | null; reached: boolean; eligible: boolean; bonus: number; bonusAtTarget: number;
  paySystem: PaySystem; payDay: number | null;
}
export interface DueSnap {
  baseSalary: number; target: number; bonusMethod: BonusMethod; bonusRate: number; bonusFixed: number; bonusCondition: BonusCondition; basis: RevenueBasis;
  qualifying: number; invoiced: number; collected: number; visits: number; pct: number | null; reached: boolean; computedBonus: number;
  salaryDue: number; bonusDue: number; approvedAt: string; updatedAt: string | null; autoSync?: boolean;
}
export interface PayrollRow {
  type: SubjectType; id: string; name: string; role: string; title: string; active: boolean; account: string | null;
  live: LiveCalc; dueId: string | null; due: DueSnap | null;
  paidSalary: number; paidBonus: number; lastPaidOn: string | null; payStatus: PayStatus; payDate: string | null; overdue: boolean;
}
export interface Overview {
  period: string; from: string; to: string; today: string; status: PeriodStatus; approvedAt: string | null; closedAt: string | null;
  basis: RevenueBasis; rows: PayrollRow[];
}
export interface VisitRow {
  appointmentId: string | null; date: string; fileNo: string; patient?: string; service: string; invoiceNo: string | null; source: string;
  valueNet: number; collected: number; qualifying: number; paymentStatus: string; countedElsewhere?: boolean;
}
export interface PlanVersion {
  id: string; effectiveFrom: string; baseSalary: number; target: number; bonusMethod: BonusMethod; bonusRate: number; bonusFixed: number;
  bonusCondition: BonusCondition; note: string; createdAt: string; createdBy: string | null;
}
export interface Payout {
  id: string; no: string; period: string; kind: PayoutKind; amount: number; paidOn: string; method: PayoutMethod; reference: string; note: string;
  status: 'paid' | 'void'; createdBy: string | null; createdAt: string; voidReason: string | null; subject?: string; subjectType?: SubjectType; role?: string;
}
export interface AuditEntry { at: string; actor: string; action: string; period: string | null; subject?: string | null; reason: string | null; details: Record<string, unknown> }
export interface SubjectDetail { name: string; dueId: string | null; visits: VisitRow[]; plans: PlanVersion[]; payouts: Payout[]; audit: AuditEntry[] }
export interface MyTarget extends LiveCalc {
  period: string; from: string; to: string; today: string; daysLeft: number; name: string;
  approved: boolean; approvedBonus: number | null; paidBonus: number;
  visitsList: VisitRow[]; daily: { date: string; amount: number }[];
}
export interface PlanInput {
  type: SubjectType; id: string; effectiveFrom: string; baseSalary: number; target?: number;
  bonusMethod?: BonusMethod; bonusRate?: number; bonusFixed?: number; bonusCondition?: BonusCondition; paySystem?: PaySystem; payDay?: number | null; note?: string;
}

// الفواتير والمدفوعات (المدير)
export interface FinInvoice { id: string; no: string; date: string; patient: string; service: string; status: string; total: number; tax: number; paid: number; remaining: number; therapist: string | null }
export interface FinPayment { id: string; date: string; amount: number; method: string; invoiceNo: string; patient: string; service: string; therapist: string | null }
export interface FinSale { id: string; date: string; no: string; product: string; qty: number; total: number; method: string; customer: string | null }
export interface FinPayout {
  id: string; no: string; kind: PayoutKind; period: string; subject: string; subjectType: SubjectType; role: string; amount: number;
  paidOn: string; method: PayoutMethod; reference: string; note: string; status: 'paid' | 'void'; paidBy: string | null; createdAt: string; voidReason: string | null;
}
export interface FinanceMonth {
  period: string; from: string; to: string;
  totals: { invoiced: number; outstanding: number; collected: number; productSales: number; salaries: number; bonuses: number };
  invoices: FinInvoice[]; payments: FinPayment[]; productSales: FinSale[]; payouts: FinPayout[];
}

type Result<T> = ({ ok: true } & T) | { ok: false; error: string };
const clean = (m: string) => m.replace(/^.*?ERROR:\s*/, '').replace(/\s*\(SQLSTATE.*$/, '').trim() || 'حدث خطأ غير متوقع.';
const fail = (m: string) => ({ ok: false as const, error: clean(m) });
const num = (v: unknown) => Number(v ?? 0);
const numOrNull = (v: unknown) => (v == null ? null : Number(v));

const toLive = (c: any): LiveCalc => ({
  hasPlan: !!c?.hasPlan, planId: c?.planId ?? null, effectiveFrom: c?.effectiveFrom ?? null, baseSalary: num(c?.baseSalary), target: num(c?.target),
  bonusMethod: c?.bonusMethod ?? 'none', bonusRate: num(c?.bonusRate), bonusFixed: num(c?.bonusFixed), bonusCondition: c?.bonusCondition ?? 'reach',
  basis: c?.basis ?? 'collected', qualifying: num(c?.qualifying), invoiced: num(c?.invoiced), collected: num(c?.collected),
  visits: num(c?.visits), qualifyingVisits: num(c?.qualifyingVisits), booked: num(c?.booked), pct: numOrNull(c?.pct), remaining: numOrNull(c?.remaining),
  reached: !!c?.reached, eligible: !!c?.eligible, bonus: num(c?.bonus), bonusAtTarget: num(c?.bonusAtTarget),
  paySystem: c?.paySystem ?? 'base_only', payDay: c?.payDay == null ? null : Number(c.payDay),
});
const toDue = (d: any): DueSnap | null => (d ? {
  baseSalary: num(d.baseSalary), target: num(d.target), bonusMethod: d.bonusMethod ?? 'none', bonusRate: num(d.bonusRate), bonusFixed: num(d.bonusFixed),
  bonusCondition: d.bonusCondition ?? 'reach', basis: d.basis ?? 'collected', qualifying: num(d.qualifying), invoiced: num(d.invoiced), collected: num(d.collected),
  visits: num(d.visits), pct: numOrNull(d.pct), reached: !!d.reached, computedBonus: num(d.computedBonus), salaryDue: num(d.salaryDue), bonusDue: num(d.bonusDue),
  approvedAt: d.approvedAt, updatedAt: d.updatedAt ?? null, autoSync: d.autoSync !== false,
} : null);
const toVisit = (v: any): VisitRow => ({ ...v, valueNet: num(v.valueNet), collected: num(v.collected), qualifying: num(v.qualifying) });
const toPayout = (p: any): Payout => ({ ...p, amount: num(p.amount) });

// الشهر الحالي بتوقيت السعودية (YYYY-MM)
export const currentPeriod = () => new Date().toLocaleDateString('en-CA', { timeZone: 'Africa/Cairo' }).slice(0, 7);
export const shiftPeriod = (p: string, by: number) => { const [y, m] = p.split('-').map(Number); const d = new Date(Date.UTC(y, m - 1 + by, 1)); return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}`; };
// آخر 24 شهر (الأحدث أولًا) — ولإعدادات السريان كمان 3 شهور جاية
export const recentPeriods = (count = 24) => Array.from({ length: count }, (_, i) => shiftPeriod(currentPeriod(), -i));
export const effectivePeriods = () => [3, 2, 1].map((i) => shiftPeriod(currentPeriod(), i)).concat(recentPeriods(12));

// إيراد الأخصائي المؤهل في الشهور اللي فاتت — مرجع للمدير وهو بيحدد التارجت
export interface RevenuePoint { period: string; qualifying: number; visits: number }
export interface RevenueRef { months: RevenuePoint[]; avg: number | null; avgVisit: number | null }
export function revenueRef(months: RevenuePoint[]): RevenueRef {
  const active = months.filter((m) => m.visits > 0);
  const visits = active.reduce((s, m) => s + m.visits, 0);
  const total = active.reduce((s, m) => s + m.qualifying, 0);
  return { months, avg: active.length ? Math.round(total / active.length) : null, avgVisit: visits ? Math.round(total / visits) : null };
}

// نفس معادلة الخادم (payroll_bonus_amount) — للمعاينة في نافذة الإعدادات بس
export function previewBonus(method: BonusMethod, rate: number, fixed: number, target: number, revenue: number) {
  if (method === 'pct_target') return Math.round(target * rate) / 100;
  if (method === 'pct_revenue') return Math.round(revenue * rate) / 100;
  if (method === 'fixed') return fixed;
  return 0;
}

export const payrollApi = {
  async overview(period: string, raw = false): Promise<Result<{ data: Overview }>> {
    const { data, error } = await supabase.rpc('payroll_overview', { p_period: period });
    if (error) return fail(error.message);
    // مستحق ما اتصرف منه شي ولا اتعدّل يدويًا والشهر مش مقفول: نعرض الأرقام الحية (الزيارات الجديدة تنعكس فورًا) — والخادم بيحدّثه قبل أي صرف
    const liveDue = (r: any) => !raw && !!r.due && r.due.autoSync !== false && data.status !== 'closed' && num(r.paidSalary) + num(r.paidBonus) === 0 && r.type === 'therapist';
    return { ok: true, data: { ...data, rows: (data.rows ?? []).map((r: any) => ({ ...r, live: toLive(r.live), due: liveDue(r) ? null : toDue(r.due), paidSalary: num(r.paidSalary), paidBonus: num(r.paidBonus), payDate: r.payDate ?? null, overdue: !!r.overdue })) } };
  },
  async detail(type: SubjectType, id: string, period: string): Promise<Result<{ data: SubjectDetail }>> {
    const { data, error } = await supabase.rpc('payroll_subject_detail', { p_type: type, p_id: id, p_period: period });
    if (error) return fail(error.message);
    return { ok: true, data: { ...data, visits: (data.visits ?? []).map(toVisit), payouts: (data.payouts ?? []).map(toPayout),
      plans: (data.plans ?? []).map((p: any) => ({ ...p, baseSalary: num(p.baseSalary), target: num(p.target), bonusRate: num(p.bonusRate), bonusFixed: num(p.bonusFixed) })) } };
  },
  async savePlan(input: PlanInput): Promise<Result<object>> {
    const { error } = await supabase.rpc('payroll_save_plan', { p: input });
    return error ? fail(error.message) : { ok: true };
  },
  // آخر «months» شهور قبل الشهر ده لكل أخصائي (المثبّت لو موجود، وإلا المباشر)
  async history(period: string, months = 3): Promise<Map<string, RevenueRef>> {
    const periods = Array.from({ length: months }, (_, i) => shiftPeriod(period, -(i + 1)));
    const res = await Promise.all(periods.map((p) => this.overview(p)));
    const by = new Map<string, RevenuePoint[]>();
    res.forEach((r, i) => {
      if (!r.ok) return;
      for (const row of r.data.rows) {
        if (row.type !== 'therapist') continue;
        const src = row.due ?? row.live;
        by.set(row.id, [...(by.get(row.id) ?? []), { period: periods[i], qualifying: src.qualifying, visits: src.visits }]);
      }
    });
    return new Map([...by].map(([id, list]) => [id, revenueRef(list)]));
  },
  async setBasis(basis: RevenueBasis): Promise<Result<object>> {
    const { error } = await supabase.rpc('payroll_set_basis', { p_basis: basis });
    return error ? fail(error.message) : { ok: true };
  },
  // مفيش اعتماد شهر: بيثبّت مستحق الشخص ده بالأرقام المباشرة لحظة الصرف/تحديد المكافأة، وبيرجّع الصف محدّث
  async ensureRow(period: string, row: PayrollRow): Promise<Result<{ row: PayrollRow }>> {
    const { error } = await supabase.rpc('payroll_ensure_due', { p_period: period, p_type: row.type, p_id: row.id });
    if (error) return fail(error.message);
    const o = await this.overview(period, true);
    if (!o.ok) return o;
    const u = o.data.rows.find((x) => x.type === row.type && x.id === row.id);
    return u ? { ok: true, row: u } : fail('تعذّر تحميل المستحق');
  },
  async approve(period: string, note = ''): Promise<Result<{ added: number }>> {
    const { data, error } = await supabase.rpc('payroll_approve_period', { p_period: period, p_note: note });
    return error ? fail(error.message) : { ok: true, added: num(data?.added) };
  },
  // إلغاء اعتماد الشهر — بيرجع مفتوح لو مفيش أي صرف عليه
  async reopen(period: string, reason: string): Promise<Result<object>> {
    const { error } = await supabase.rpc('payroll_reopen_period', { p_period: period, p_reason: reason });
    return error ? fail(error.message) : { ok: true };
  },
  async close(period: string, note = ''): Promise<Result<object>> {
    const { error } = await supabase.rpc('payroll_close_period', { p_period: period, p_note: note });
    return error ? fail(error.message) : { ok: true };
  },
  async recalc(dueId: string, reason: string): Promise<Result<object>> {
    const { error } = await supabase.rpc('payroll_recalc_due', { p_due: dueId, p_reason: reason });
    return error ? fail(error.message) : { ok: true };
  },
  // نسبة المكافأة بعد الوصول للتارجت — المبلغ بيتحسب على الخادم
  async setBonusRate(dueId: string, method: 'pct_target' | 'pct_revenue', rate: number, note: string): Promise<Result<{ bonusDue: number }>> {
    const { data, error } = await supabase.rpc('payroll_set_bonus_rate', { p_due: dueId, p_method: method, p_rate: rate, p_note: note });
    return error ? fail(error.message) : { ok: true, bonusDue: num(data?.bonusDue) };
  },
  async adjust(dueId: string, salary: number, bonus: number, reason: string): Promise<Result<object>> {
    const { error } = await supabase.rpc('payroll_adjust_due', { p_due: dueId, p_salary: salary, p_bonus: bonus, p_reason: reason });
    return error ? fail(error.message) : { ok: true };
  },
  async pay(input: { dueId: string; kind: PayoutKind; amount: number; paidOn: string; method: PayoutMethod; reference: string; note: string; clientKey: string }): Promise<Result<{ no: string; amount: number; remaining: number; duplicate: boolean }>> {
    const { data, error } = await supabase.rpc('payroll_pay', { p: input });
    return error ? fail(error.message) : { ok: true, no: data.no, amount: num(data.amount), remaining: num(data.remaining), duplicate: !!data.duplicate };
  },
  async voidPayout(id: string, reason: string): Promise<Result<object>> {
    const { error } = await supabase.rpc('payroll_void_payout', { p_id: id, p_reason: reason });
    return error ? fail(error.message) : { ok: true };
  },
  async logs(from: string, to: string): Promise<Result<{ payouts: Payout[]; audit: AuditEntry[] }>> {
    const { data, error } = await supabase.rpc('payroll_log_list', { p_from: from, p_to: to });
    return error ? fail(error.message) : { ok: true, payouts: (data.payouts ?? []).map(toPayout), audit: data.audit ?? [] };
  },
  async myTarget(period: string): Promise<Result<{ data: MyTarget }>> {
    const { data, error } = await supabase.rpc('my_target', { p_period: period });
    if (error) return fail(error.message);
    return { ok: true, data: { ...data, ...toLive(data), daysLeft: num(data.daysLeft), approvedBonus: numOrNull(data.approvedBonus), paidBonus: num(data.paidBonus),
      visitsList: (data.visitsList ?? []).map(toVisit), daily: (data.daily ?? []).map((d: any) => ({ date: d.date, amount: num(d.amount) })) } };
  },
  async finance(period: string): Promise<Result<{ data: FinanceMonth }>> {
    const { data, error } = await supabase.rpc('finance_month', { p_period: period });
    if (error) return fail(error.message);
    const t = data.totals ?? {};
    return {
      ok: true,
      data: {
        period: data.period, from: data.from, to: data.to,
        totals: { invoiced: num(t.invoiced), outstanding: num(t.outstanding), collected: num(t.collected), productSales: num(t.productSales), salaries: num(t.salaries), bonuses: num(t.bonuses) },
        invoices: (data.invoices ?? []).map((r: any) => ({ ...r, total: num(r.total), tax: num(r.tax), paid: num(r.paid), remaining: num(r.remaining) })),
        payments: (data.payments ?? []).map((r: any) => ({ ...r, amount: num(r.amount) })),
        productSales: (data.productSales ?? []).map((r: any) => ({ ...r, qty: num(r.qty), total: num(r.total) })),
        payouts: (data.payouts ?? []).map((r: any) => ({ ...r, amount: num(r.amount) })),
      },
    };
  },
};
