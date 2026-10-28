// الرواتب الثابتة (هجرة 922): salary_settings (الراتب الشهري ويوم الصرف لكل موظف) + salary_payments (سجل واحد لكل موظف في كل شهر).
// كل الصلاحيات على الخادم (RLS): العرض/التعديل بصلاحية الرواتب، ومحدش يعدّل راتبه هو. التكرار لنفس الشهر ممنوع بفهرس فريد.
import { supabase } from '../lib/supabase';

export type SalaryStatus = 'due' | 'paid';
export type SalaryMethod = 'cash' | 'bank' | 'wallet' | 'other';
export const SALARY_METHOD: Record<SalaryMethod, string> = { cash: 'كاش', bank: 'تحويل بنكي', wallet: 'محفظة إلكترونية', other: 'أخرى' };
export interface SalarySetting { employeeId: string; monthlySalary: number; payDay: number; active: boolean; note: string }
export interface SalaryPayment {
  id: string; employeeId: string | null; employeeName: string; period: string; amount: number; dueDate: string;
  status: SalaryStatus; paidOn: string | null; method: SalaryMethod; note: string; updatedAt: string;
}
type R<T = void> = { ok: true; data: T } | { ok: false; error: string };

const msg = (e: { message?: string; code?: string } | null) => {
  const m = e?.message ?? '';
  if (e?.code === '23505' || /salary_payments_one_per_month|duplicate key/i.test(m)) return 'راتب الشهر ده متسجّل للموظف ده بالفعل.';
  if (/row-level security|permission denied|42501/i.test(m) || e?.code === '42501') return 'ليس لديك صلاحية لهذه العملية (ومحدش يقدر يسجّل أو يعدّل راتبه هو).';
  if (/salary_paid_has_date/.test(m)) return 'تاريخ الدفع مطلوب للراتب المدفوع.';
  if (/Failed to fetch|NetworkError/i.test(m)) return 'مفيش اتصال بالإنترنت — الرواتب محتاجة اتصال.';
  return m || 'تعذّر تنفيذ العملية.';
};
const setting = (r: any): SalarySetting => ({ employeeId: r.employee_id, monthlySalary: Number(r.monthly_salary), payDay: r.pay_day, active: r.active, note: r.note ?? '' });
const payment = (r: any): SalaryPayment => ({
  id: r.id, employeeId: r.employee_id, employeeName: r.employee_name, period: r.period, amount: Number(r.amount), dueDate: r.due_date,
  status: r.status, paidOn: r.paid_on, method: r.method, note: r.note ?? '', updatedAt: r.updated_at,
});

/** تاريخ الاستحقاق: يوم الصرف في شهر الاستحقاق (لو الشهر أقصر — آخر يوم فيه) */
export function dueDateOf(period: string, payDay: number) {
  const [y, m] = period.split('-').map(Number);
  const last = new Date(y, m, 0).getDate();
  return `${period}-${String(Math.min(Math.max(1, payDay), last)).padStart(2, '0')}`;
}

export const salaryApi = {
  async load(): Promise<R<{ settings: SalarySetting[]; payments: SalaryPayment[] }>> {
    const [s, p] = await Promise.all([
      supabase.from('salary_settings').select('*'),
      supabase.from('salary_payments').select('*').order('period', { ascending: false }),
    ]);
    if (s.error || p.error) return { ok: false, error: msg(s.error ?? p.error) };
    return { ok: true, data: { settings: (s.data ?? []).map(setting), payments: (p.data ?? []).map(payment) } };
  },
  async saveSetting(x: SalarySetting): Promise<R> {
    const { error } = await supabase.from('salary_settings').upsert({ employee_id: x.employeeId, monthly_salary: x.monthlySalary, pay_day: x.payDay, active: x.active, note: x.note });
    return error ? { ok: false, error: msg(error) } : { ok: true, data: undefined };
  },
  /** راتب الشهر (مستحق) — لو اتسجّل قبل كده بيرجع رسالة واضحة بدل سجل مكرر */
  async create(x: { employeeId: string; employeeName: string; period: string; amount: number; dueDate: string; note?: string }): Promise<R> {
    const { error } = await supabase.from('salary_payments').insert({ employee_id: x.employeeId, employee_name: x.employeeName, period: x.period, amount: x.amount, due_date: x.dueDate, note: x.note ?? '' });
    return error ? { ok: false, error: msg(error) } : { ok: true, data: undefined };
  },
  async update(id: string, patch: Partial<{ amount: number; dueDate: string; status: SalaryStatus; paidOn: string | null; method: SalaryMethod; note: string }>): Promise<R> {
    const row: Record<string, unknown> = {};
    if (patch.amount !== undefined) row.amount = patch.amount;
    if (patch.dueDate !== undefined) row.due_date = patch.dueDate;
    if (patch.status !== undefined) row.status = patch.status;
    if (patch.paidOn !== undefined) row.paid_on = patch.paidOn;
    if (patch.method !== undefined) row.method = patch.method;
    if (patch.note !== undefined) row.note = patch.note;
    const { data, error } = await supabase.from('salary_payments').update(row).eq('id', id).select('id');
    if (error) return { ok: false, error: msg(error) };
    return data?.length ? { ok: true, data: undefined } : { ok: false, error: 'ليس لديك صلاحية تعديل الراتب ده.' };
  },
  async remove(id: string): Promise<R> {
    const { data, error } = await supabase.from('salary_payments').delete().eq('id', id).select('id');
    if (error) return { ok: false, error: msg(error) };
    return data?.length ? { ok: true, data: undefined } : { ok: false, error: 'الراتب المدفوع ما بيتمسحش — ألغِ الصرف الأول، أو مالكش صلاحية.' };
  },
};
