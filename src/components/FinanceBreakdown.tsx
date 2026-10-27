import type { ReactNode } from 'react';
import { StatusBadge } from './ui';
import { INVOICE_STATUS, PAYMENT_METHOD_LABEL, money } from '../utils/format';
import type { FinanceMonth } from '../data/payrollApi';
import { PAYOUT_METHOD, ROLE_NAME } from './PayrollKit';
import type { InvoiceStatus } from '../types';

// «ملخص تفصيلي» في «الفواتير والمدفوعات (المدير)»: كل رقم متفصّل (طريقة الدفع، حالة الفواتير، الخدمة، الأخصائي، المنتج، الصادر لكل شخص)
// كله محسوب من نفس بيانات الشهر (finance_month) — مفيش استعلام تاني.
export const r2 = (n: number) => Math.round(n * 100) / 100;
export const sumBy = <T,>(rows: T[], f: (r: T) => number) => r2(rows.reduce((a, r) => a + f(r), 0));
function groupBy<T>(rows: T[], key: (r: T) => string) {
  const m = new Map<string, T[]>();
  for (const r of rows) { const k = key(r); (m.get(k) ?? m.set(k, []).get(k)!).push(r); }
  return [...m.entries()];
}
const pctOf = (part: number, whole: number) => (whole > 0 ? `${Math.round((part / whole) * 1000) / 10}%` : '—');
const methodLabel = (m: string) => PAYMENT_METHOD_LABEL[m] ?? PAYOUT_METHOD[m as 'cash'] ?? m;

function Panel({ title, hint, children }: { title: string; hint?: string; children: ReactNode }) {
  return (
    <div className="card fin-panel">
      <div className="card__body">
        <h3 style={{ margin: '0 0 2px' }}>{title}</h3>
        {hint && <p className="muted-sm" style={{ margin: '0 0 10px' }}>{hint}</p>}
        {children}
      </div>
    </div>
  );
}

export default function FinanceBreakdown({ data }: { data: FinanceMonth }) {
  const invoices = data.invoices.filter((i) => i.status !== 'cancelled');
  const cancelled = data.invoices.length - invoices.length;
  const paidOut = data.payouts.filter((p) => p.status === 'paid');
  const voided = data.payouts.length - paidOut.length;
  const totalIn = r2(data.totals.collected + data.totals.productSales);

  const methods = [...new Set([...data.payments.map((p) => p.method), ...data.productSales.map((s) => s.method)])];
  const byMethod = methods.map((m) => ({
    m,
    pt: sumBy(data.payments.filter((p) => p.method === m), (p) => p.amount),
    pr: sumBy(data.productSales.filter((s) => s.method === m), (s) => s.total),
  })).sort((a, b) => b.pt + b.pr - (a.pt + a.pr));

  const byStatus = groupBy(data.invoices, (i) => i.status);
  const byService = groupBy(invoices, (i) => i.service).sort((a, b) => sumBy(b[1], (i) => i.total) - sumBy(a[1], (i) => i.total));
  const therapists = [...new Set([...invoices.map((i) => i.therapist ?? '—'), ...data.payments.map((p) => p.therapist ?? '—')])];
  const byTherapist = therapists.map((k) => ({
    k,
    n: invoices.filter((i) => (i.therapist ?? '—') === k).length,
    invoiced: sumBy(invoices.filter((i) => (i.therapist ?? '—') === k), (i) => i.total),
    collected: sumBy(data.payments.filter((p) => (p.therapist ?? '—') === k), (p) => p.amount),
  })).sort((a, b) => b.invoiced - a.invoiced);
  const byProduct = groupBy(data.productSales, (s) => s.product).sort((a, b) => sumBy(b[1], (s) => s.total) - sumBy(a[1], (s) => s.total));
  const people = groupBy(paidOut, (p) => p.subject).map(([k, rows]) => ({
    k, role: rows[0].role,
    salary: sumBy(rows.filter((p) => p.kind === 'salary'), (p) => p.amount),
    bonus: sumBy(rows.filter((p) => p.kind === 'bonus'), (p) => p.amount),
  })).sort((a, b) => b.salary + b.bonus - (a.salary + a.bonus));

  const none = <p className="muted" style={{ margin: 0 }}>ما فيه بيانات في هالشهر.</p>;
  return (
    <div className="fin-grid">
      <Panel title="الوارد حسب طريقة الدفع" hint="دفعات المرضى + مبيعات المنتجات بتاريخ الدفع">
        {byMethod.length === 0 ? none : (
          <div className="table-wrap"><table className="table table--compact">
            <thead><tr><th>الطريقة</th><th>دفعات المرضى</th><th>المنتجات</th><th>الإجمالي</th><th>النسبة</th></tr></thead>
            <tbody>{byMethod.map((x) => (
              <tr key={x.m}><td>{methodLabel(x.m)}</td><td className="num">{money(x.pt)}</td><td className="num">{money(x.pr)}</td>
                <td className="num" style={{ fontWeight: 600 }}>{money(r2(x.pt + x.pr))}</td><td className="num">{pctOf(x.pt + x.pr, totalIn)}</td></tr>
            ))}</tbody>
            <tfoot><tr><td>الإجمالي</td><td className="num">{money(data.totals.collected)}</td><td className="num">{money(data.totals.productSales)}</td><td className="num">{money(totalIn)}</td><td /></tr></tfoot>
          </table></div>
        )}
      </Panel>

      <Panel title="فواتير المرضى حسب الحالة" hint={cancelled > 0 ? `${cancelled} فاتورة ملغاة (غير محسوبة في الإجماليات)` : 'الفواتير الصادرة خلال الشهر'}>
        {byStatus.length === 0 ? none : (
          <div className="table-wrap"><table className="table table--compact">
            <thead><tr><th>الحالة</th><th>العدد</th><th>الإجمالي</th><th>المدفوع</th><th>المتبقي</th></tr></thead>
            <tbody>{byStatus.map(([st, rows]) => (
              <tr key={st}>
                <td><StatusBadge label={INVOICE_STATUS[st as InvoiceStatus]?.label ?? st} tone={INVOICE_STATUS[st as InvoiceStatus]?.tone ?? 'muted'} /></td>
                <td className="num">{rows.length}</td><td className="num">{money(sumBy(rows, (i) => i.total))}</td>
                <td className="num">{money(sumBy(rows, (i) => i.paid))}</td><td className="num">{money(sumBy(rows, (i) => i.remaining))}</td>
              </tr>
            ))}</tbody>
          </table></div>
        )}
      </Panel>

      <Panel title="حسب الخدمة" hint="الفواتير الصادرة خلال الشهر (دون الملغاة)">
        {byService.length === 0 ? none : (
          <div className="table-wrap"><table className="table table--compact">
            <thead><tr><th>الخدمة</th><th>الفواتير</th><th>الإجمالي</th><th>المدفوع</th><th>المتبقي</th></tr></thead>
            <tbody>{byService.map(([k, rows]) => (
              <tr key={k}><td>{k}</td><td className="num">{rows.length}</td><td className="num" style={{ fontWeight: 600 }}>{money(sumBy(rows, (i) => i.total))}</td>
                <td className="num">{money(sumBy(rows, (i) => i.paid))}</td><td className="num">{money(sumBy(rows, (i) => i.remaining))}</td></tr>
            ))}</tbody>
            <tfoot><tr><td>الإجمالي</td><td className="num">{invoices.length}</td><td className="num">{money(sumBy(invoices, (i) => i.total))}</td>
              <td className="num">{money(sumBy(invoices, (i) => i.paid))}</td><td className="num">{money(sumBy(invoices, (i) => i.remaining))}</td></tr></tfoot>
          </table></div>
        )}
      </Panel>

      <Panel title="حسب الأخصائي" hint="الفواتير الصادرة والمحصّل خلال الشهر لكل أخصائي">
        {byTherapist.length === 0 ? none : (
          <div className="table-wrap"><table className="table table--compact">
            <thead><tr><th>الأخصائي</th><th>الفواتير</th><th>الإجمالي</th><th>المحصّل</th></tr></thead>
            <tbody>{byTherapist.map((x) => (
              <tr key={x.k}><td data-no-i18n={x.k === '—' ? undefined : true}>{x.k === '—' ? 'بدون أخصائي' : x.k}</td><td className="num">{x.n}</td><td className="num">{money(x.invoiced)}</td><td className="num" style={{ fontWeight: 600 }}>{money(x.collected)}</td></tr>
            ))}</tbody>
          </table></div>
        )}
      </Panel>

      <Panel title="مبيعات المنتجات حسب المنتج">
        {byProduct.length === 0 ? none : (
          <div className="table-wrap"><table className="table table--compact">
            <thead><tr><th>المنتج</th><th>عدد الفواتير</th><th>الكمية</th><th>الإجمالي</th></tr></thead>
            <tbody>{byProduct.map(([k, rows]) => (
              <tr key={k}><td>{k}</td><td className="num">{rows.length}</td><td className="num">{sumBy(rows, (s) => s.qty)}</td><td className="num" style={{ fontWeight: 600 }}>{money(sumBy(rows, (s) => s.total))}</td></tr>
            ))}</tbody>
            <tfoot><tr><td>الإجمالي</td><td className="num">{data.productSales.length}</td><td className="num">{sumBy(data.productSales, (s) => s.qty)}</td><td className="num">{money(data.totals.productSales)}</td></tr></tfoot>
          </table></div>
        )}
      </Panel>

      <Panel title="الصادر لكل شخص" hint={voided > 0 ? `${voided} عملية صرف ملغاة (غير محسوبة)` : 'الرواتب والمكافآت المصروفة بتاريخ الصرف'}>
        {people.length === 0 ? none : (
          <div className="table-wrap"><table className="table table--compact">
            <thead><tr><th>المستفيد</th><th>الوظيفة</th><th>الراتب</th><th>المكافأة</th><th>الإجمالي</th></tr></thead>
            <tbody>{people.map((x) => (
              <tr key={x.k}><td data-no-i18n>{x.k}</td><td>{ROLE_NAME[x.role] ?? x.role}</td><td className="num">{money(x.salary)}</td><td className="num">{money(x.bonus)}</td>
                <td className="num" style={{ fontWeight: 600 }}>{money(r2(x.salary + x.bonus))}</td></tr>
            ))}</tbody>
            <tfoot><tr><td colSpan={2}>الإجمالي</td><td className="num">{money(data.totals.salaries)}</td><td className="num">{money(data.totals.bonuses)}</td><td className="num">{money(r2(data.totals.salaries + data.totals.bonuses))}</td></tr></tfoot>
          </table></div>
        )}
      </Panel>
    </div>
  );
}
