import { useCallback, useEffect, useMemo, useState } from 'react';
import { Button, EmptyState, ErrorState, Input, Select, Skeleton, StatusBadge } from '../components/ui';
import { FilterBar, IconAction, RowActions, useCan } from '../components/common';
import { StatCard } from '../components/StatCard';
import { INVOICE_STATUS, PAYMENT_METHOD_LABEL, exportCsv, fmtDate, fmtDateTime, money } from '../utils/format';
import { db } from '../data/db';
import { patientMatches, textMatches } from '../utils/phoneUtils';
import { payrollApi,currentPeriod, type FinanceMonth, type FinPayout } from '../data/payrollApi';
import { PAYOUT_KIND, PAYOUT_METHOD, ROLE_NAME, ReasonModal, periodLabel, periodOptions } from '../components/PayrollKit';
import type { InvoiceStatus } from '../types';
import FinanceBreakdown, { sumBy } from '../components/FinanceBreakdown';

type Tab = 'summary' | 'all' | 'invoices' | 'payments' | 'sales' | 'salaries' | 'bonuses';
const TABS: { id: Tab; label: string }[] = [
  { id: 'summary', label: 'ملخص تفصيلي' }, { id: 'all', label: 'دفتر الحركات' }, { id: 'invoices', label: 'فواتير المرضى' }, { id: 'payments', label: 'المدفوعات' },
  { id: 'sales', label: 'مبيعات المنتجات' }, { id: 'salaries', label: 'الرواتب' }, { id: 'bonuses', label: 'مكافآت الأخصائيين' },
];
const ts = (iso: string) => Date.parse(iso);
const methodLabel = (m: string) => PAYMENT_METHOD_LABEL[m] ?? PAYOUT_METHOD[m as 'cash'] ?? m;

// «الفواتير والمدفوعات (المدير)» — كل الوارد (فواتير ومدفوعات المرضى ومبيعات المنتجات) والصادر (صرف الرواتب والمكافآت بتاريخ الصرف) في شهر.
// للمدير العام بس (الخادم بيرفض غيره).
export default function Finance() {
  const can = useCan();
  const [period, setPeriod] = useState(currentPeriod());
  const [data, setData] = useState<FinanceMonth | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [tab, setTab] = useState<Tab>('summary');
  const [q, setQ] = useState('');
  const [cancelling, setCancelling] = useState<FinPayout | null>(null);

  const load = useCallback(async () => {
    setError(null);
    const r = await payrollApi.finance(period);
    if (!r.ok) { setError(r.error); return; }
    setData(r.data);
  }, [period]);
  useEffect(() => { setData(null); load(); }, [load]);

  const term = q.trim();
  const has = (...v: (string | null | undefined)[]) => !term || v.some((x) => !!x && textMatches(x, term));
  const t = data?.totals;
  const net = t ? t.collected + t.productSales - t.salaries - t.bonuses : 0;

  // رقم الملف مش جاي من الخادم في تقرير المالية، فبنجيبه من الفاتورة المحمّلة (رقم الفاتورة ← المريض)
  // (والبحث بالجوال/الهوية/رقم الملف بأي صيغة بيتم على ملف المريض نفسه)
  const patientOf = (invoiceNo: string) => {
    const inv = db.invoices().find((x) => x.no === invoiceNo);
    return inv ? db.patient(inv.patientId) : undefined;
  };
  const invoices = (data?.invoices ?? []).filter((i) => has(i.no, i.patient, i.service, i.therapist) || patientMatches(patientOf(i.no), term));
  const payments = (data?.payments ?? []).filter((p) => has(p.invoiceNo, p.patient, p.service, p.therapist) || patientMatches(patientOf(p.invoiceNo), term));
  const sales = (data?.productSales ?? []).filter((s) => has(s.no, s.product, s.customer, db.searchPatients(term).some((p) => p.fullName === s.customer) ? s.customer : undefined));
  const salaries = (data?.payouts ?? []).filter((p) => p.kind === 'salary' && has(p.no, p.subject));
  const bonuses = (data?.payouts ?? []).filter((p) => p.kind === 'bonus' && has(p.no, p.subject));

  // «الكل»: دفتر واحد — الوارد (دفعات المرضى + مبيعات المنتجات) والصادر (الرواتب والنسب المصروفة)
  const ledger = useMemo(() => [
    ...payments.map((p) => ({ id: 'p' + p.id, at: ts(p.date), type: 'دفعة مريض', ref: p.invoiceNo, party: p.patient, detail: p.service, inAmt: p.amount, outAmt: 0 })),
    ...sales.map((s) => ({ id: 's' + s.id, at: ts(s.date), type: 'فاتورة منتج', ref: s.no, party: s.customer ?? '—', detail: `${s.product} × ${s.qty}`, inAmt: s.total, outAmt: 0 })),
    ...[...salaries, ...bonuses].filter((p) => p.status === 'paid').map((p) => ({ id: 'o' + p.id, at: ts(p.paidOn + 'T12:00:00+03:00'), type: PAYOUT_KIND[p.kind], ref: p.no, party: p.subject, detail: `عن ${periodLabel(p.period)}`, inAmt: 0, outAmt: p.amount })),
  ].sort((a, b) => b.at - a.at), [payments, sales, salaries, bonuses]);

  const counts: Record<Tab, number> = { summary: 0, all: ledger.length, invoices: invoices.length, payments: payments.length, sales: sales.length, salaries: salaries.length, bonuses: bonuses.length };

  const exportTab = () => {
    const name = `${TABS.find((x) => x.id === tab)!.label}-${period}`;
    if (tab === 'summary') return;
    if (tab === 'all') exportCsv(name, ['التاريخ', 'النوع', 'المرجع', 'الطرف', 'التفاصيل', 'وارد', 'صادر'], ledger.map((r) => [fmtDateTime(r.at), r.type, r.ref, r.party, r.detail, r.inAmt, r.outAmt]));
    else if (tab === 'invoices') exportCsv(name, ['رقم الفاتورة', 'التاريخ', 'المريض', 'الخدمة', 'الأخصائي', 'الإجمالي', 'الضريبة', 'المدفوع', 'المتبقي', 'الحالة'], invoices.map((i) => [i.no, i.date, i.patient, i.service, i.therapist ?? '', i.total, i.tax, i.paid, i.remaining, INVOICE_STATUS[i.status as InvoiceStatus]?.label ?? i.status]));
    else if (tab === 'payments') exportCsv(name, ['التاريخ', 'المريض', 'الفاتورة', 'الخدمة', 'الأخصائي', 'المبلغ', 'طريقة الدفع'], payments.map((p) => [fmtDateTime(ts(p.date)), p.patient, p.invoiceNo, p.service, p.therapist ?? '', p.amount, methodLabel(p.method)]));
    else if (tab === 'sales') exportCsv(name, ['رقم الفاتورة', 'التاريخ', 'المنتج', 'الكمية', 'العميل', 'الإجمالي', 'طريقة الدفع'], sales.map((s) => [s.no, fmtDateTime(ts(s.date)), s.product, s.qty, s.customer ?? '', s.total, methodLabel(s.method)]));
    else exportCsv(name, ['السند', 'المستفيد', 'الوظيفة', 'عن شهر', 'المبلغ', 'تاريخ الصرف', 'طريقة الدفع', 'المرجع', 'ملاحظات', 'سجّله', 'الحالة'],
      (tab === 'salaries' ? salaries : bonuses).map((p) => [p.no, p.subject, ROLE_NAME[p.role] ?? p.role, p.period, p.amount, p.paidOn, methodLabel(p.method), p.reference, p.note, p.paidBy ?? '', p.status === 'paid' ? 'مصروف' : 'ملغي']));
  };

  return (
    <div className="page">
      <div className="page-head">
        <div><h1>الفواتير والمدفوعات (المدير)</h1><p>كل فواتير ومدفوعات المرضى ومبيعات المنتجات، وصرف الرواتب والمكافآت — للمدير العام فقط.</p></div>
        <div style={{ minWidth: 200 }}><Select id="fin-period" label="الشهر" value={period} onChange={(e) => setPeriod(e.target.value)} options={periodOptions()} /></div>
      </div>

      {error && !data ? <div className="card"><div className="alert alert-danger" style={{ margin: 16 }}>{error}</div><ErrorState onRetry={load} /></div> : !data || !t ? <Skeleton h={320} /> : (
        <>
          <div className="fin-group-title">الوارد (مبالغ داخلة)</div>
          <div className="fin-kpis">
            <StatCard icon="receipt" tone="brand" value={money(t.invoiced)} label="فواتير المرضى المصدرة" />
            <StatCard icon="wallet" tone="ok" value={money(t.collected)} label="المحصّل من المرضى" />
            <StatCard icon="clock" tone="warn" value={money(t.outstanding)} label="المتبقي على المرضى" />
            <StatCard icon="box" tone="info" value={money(t.productSales)} label="مبيعات المنتجات" />
            <StatCard icon="trend" tone="ok" value={money(Math.round((t.collected + t.productSales) * 100) / 100)} label="إجمالي الوارد (المحصّل + المنتجات)" />
          </div>
          <div className="fin-group-title">الصادر (مبالغ خارجة)</div>
          <div className="fin-kpis">
            <StatCard icon="user" tone="warn" value={money(t.salaries)} label="الرواتب المصروفة" />
            <StatCard icon="target" tone="warn" value={money(t.bonuses)} label="مكافآت الأخصائيين المصروفة" />
            <StatCard icon="wallet" tone="danger" value={money(Math.round((t.salaries + t.bonuses) * 100) / 100)} label="إجمالي الصادر" />
          </div>
          <div className="fin-group-title">الصافي</div>
          <div className="kpi-grid" style={{ marginBottom: 16 }}>
            <StatCard icon="trend" tone={net >= 0 ? 'ok' : 'danger'} value={money(Math.round(net * 100) / 100)} label="الصافي (إجمالي الوارد − إجمالي الصادر)" />
          </div>
          <div className="card">
            <div className="tabs" style={{ overflowX: 'auto' }}>
              {TABS.map((x) => <button key={x.id} className={`tab ${tab === x.id ? 'active' : ''}`} onClick={() => setTab(x.id)}>{x.label} {counts[x.id] > 0 && <span className="tab-count num">{counts[x.id]}</span>}</button>)}
            </div>
            {tab !== 'summary' && <FilterBar>
              <Input id="fin-q" label="بحث" icon="search" placeholder="الاسم أو رقم الملف أو رقم الفاتورة أو السند" value={q} onChange={(e) => setQ(e.target.value)} />
              <div style={{ alignSelf: 'end' }}><Button variant="outline" icon="download" onClick={exportTab}>تصدير Excel (CSV)</Button></div>
            </FilterBar>}
            <div className="card__body">
              {tab === 'summary' ? <FinanceBreakdown data={data} /> : counts[tab] === 0 ? <EmptyState icon="receipt" title="ما فيه سجلات" text={`ما فيه سجلات في ${periodLabel(period)}.`} /> : (
                <div className="table-wrap"><table className="table">
                  {tab === 'all' && <>
                    <thead><tr><th>التاريخ</th><th>النوع</th><th>المرجع</th><th>الطرف</th><th>التفاصيل</th><th>وارد</th><th>صادر</th></tr></thead>
                    <tbody>{ledger.map((r) => (
                      <tr key={r.id}>
                        <td className="num" style={{ whiteSpace: 'nowrap' }}>{fmtDateTime(r.at)}</td>
                        <td><StatusBadge label={r.type} tone={r.outAmt ? 'warn' : 'ok'} /></td>
                        <td className="num">{r.ref}</td><td data-no-i18n>{r.party}</td><td className="muted">{r.detail}</td>
                        <td className="num" style={{ color: 'var(--ok)', fontWeight: 600 }}>{r.inAmt ? money(r.inAmt) : ''}</td>
                        <td className="num" style={{ color: 'var(--danger)', fontWeight: 600 }}>{r.outAmt ? money(r.outAmt) : ''}</td>
                      </tr>
                    ))}</tbody>
                    <tfoot><tr><td colSpan={5}>{`الإجمالي (${ledger.length} حركة)`}</td><td className="num" style={{ color: 'var(--ok)' }}>{money(sumBy(ledger, (r) => r.inAmt))}</td><td className="num" style={{ color: 'var(--danger)' }}>{money(sumBy(ledger, (r) => r.outAmt))}</td></tr></tfoot>
                  </>}
                  {tab === 'invoices' && <>
                    <thead><tr><th>رقم الفاتورة</th><th>التاريخ</th><th>المريض</th><th>الخدمة</th><th>الأخصائي</th><th>الإجمالي</th><th>المدفوع</th><th>المتبقي</th><th>الحالة</th></tr></thead>
                    <tbody>{invoices.map((i) => (
                      <tr key={i.id}>
                        <td className="num">{i.no}</td><td className="num" style={{ whiteSpace: 'nowrap' }}>{fmtDate(i.date)}</td><td data-no-i18n>{i.patient}</td><td>{i.service}</td><td data-no-i18n>{i.therapist ?? '—'}</td>
                        <td className="num">{money(i.total)}</td><td className="num">{money(i.paid)}</td><td className="num">{money(i.remaining)}</td>
                        <td><StatusBadge label={INVOICE_STATUS[i.status as InvoiceStatus]?.label ?? i.status} tone={INVOICE_STATUS[i.status as InvoiceStatus]?.tone ?? 'muted'} /></td>
                      </tr>
                    ))}</tbody>
                    <tfoot><tr><td colSpan={5}>{`الإجمالي (${invoices.length} فاتورة)`}</td><td className="num">{money(sumBy(invoices, (i) => i.total))}</td><td className="num">{money(sumBy(invoices, (i) => i.paid))}</td><td className="num">{money(sumBy(invoices, (i) => i.remaining))}</td><td /></tr></tfoot>
                  </>}
                  {tab === 'payments' && <>
                    <thead><tr><th>التاريخ</th><th>المريض</th><th>الفاتورة</th><th>الخدمة</th><th>الأخصائي</th><th>المبلغ</th><th>طريقة الدفع</th></tr></thead>
                    <tbody>{payments.map((p) => (
                      <tr key={p.id}>
                        <td className="num" style={{ whiteSpace: 'nowrap' }}>{fmtDateTime(ts(p.date))}</td><td data-no-i18n>{p.patient}</td><td className="num">{p.invoiceNo}</td><td>{p.service}</td><td data-no-i18n>{p.therapist ?? '—'}</td>
                        <td className="num" style={{ fontWeight: 600 }}>{money(p.amount)}</td><td>{methodLabel(p.method)}</td>
                      </tr>
                    ))}</tbody>
                    <tfoot><tr><td colSpan={5}>{`الإجمالي (${payments.length} دفعة)`}</td><td className="num">{money(sumBy(payments, (p) => p.amount))}</td><td /></tr></tfoot>
                  </>}
                  {tab === 'sales' && <>
                    <thead><tr><th>رقم الفاتورة</th><th>التاريخ</th><th>المنتج</th><th>الكمية</th><th>العميل</th><th>الإجمالي</th><th>طريقة الدفع</th></tr></thead>
                    <tbody>{sales.map((s) => (
                      <tr key={s.id}>
                        <td className="num">{s.no}</td><td className="num" style={{ whiteSpace: 'nowrap' }}>{fmtDateTime(ts(s.date))}</td><td>{s.product}</td><td className="num">{s.qty}</td><td data-no-i18n>{s.customer ?? '—'}</td>
                        <td className="num" style={{ fontWeight: 600 }}>{money(s.total)}</td><td>{methodLabel(s.method)}</td>
                      </tr>
                    ))}</tbody>
                    <tfoot><tr><td colSpan={3}>{`الإجمالي (${sales.length} فاتورة)`}</td><td className="num">{sumBy(sales, (x) => x.qty)}</td><td /><td className="num">{money(sumBy(sales, (x) => x.total))}</td><td /></tr></tfoot>
                  </>}
                  {(tab === 'salaries' || tab === 'bonuses') && <PayoutRows rows={tab === 'salaries' ? salaries : bonuses} canCancel={can('payroll', 'delete')} onCancel={setCancelling} />}
                </table></div>
              )}
            </div>
          </div>
        </>
      )}

      {cancelling && <ReasonModal title={`إلغاء صرف ${cancelling.no}`} confirmLabel="تأكيد الإلغاء"
        message={`${PAYOUT_KIND[cancelling.kind]} عن ${periodLabel(cancelling.period)} (${money(cancelling.amount)}). سيبقى السند في السجل بحالة «ملغي» ويعود المبلغ إلى المتبقي.`}
        onClose={() => setCancelling(null)} successText="تم إلغاء الصرف."
        onSubmit={async (reason) => { const r = await payrollApi.voidPayout(cancelling.id, reason); if (!r.ok) return r.error; setCancelling(null); load(); return null; }} />}
    </div>
  );
}

function PayoutRows({ rows, canCancel, onCancel }: { rows: FinPayout[]; canCancel: boolean; onCancel: (p: FinPayout) => void }) {
  return (
    <>
      <thead><tr><th>السند</th><th>المستفيد</th><th>الوظيفة</th><th>عن شهر</th><th>المبلغ</th><th>تاريخ الصرف</th><th>طريقة الدفع</th><th>المرجع / الملاحظات</th><th>سجّله</th><th>الحالة</th><th className="actions"></th></tr></thead>
      <tbody>{rows.map((p) => (
        <tr key={p.id} style={p.status === 'void' ? { opacity: 0.6 } : undefined}>
          <td className="num">{p.no}</td><td style={{ whiteSpace: 'nowrap' }} data-no-i18n>{p.subject}</td><td>{ROLE_NAME[p.role] ?? p.role}</td><td style={{ whiteSpace: 'nowrap' }}>{periodLabel(p.period)}</td>
          <td className="num" style={{ fontWeight: 600 }}>{money(p.amount)}</td><td className="num" style={{ whiteSpace: 'nowrap' }}>{fmtDate(p.paidOn)}</td><td>{methodLabel(p.method)}</td>
          <td data-no-i18n>{[p.reference, p.note].filter(Boolean).join(' — ') || '—'}</td><td data-no-i18n>{p.paidBy ?? '—'}</td>
          <td>{p.status === 'paid' ? <StatusBadge label="مصروف" tone="ok" /> : <><StatusBadge label="ملغي" tone="muted" />{p.voidReason && <div className="muted-sm" data-no-i18n>{p.voidReason}</div>}</>}</td>
          <td className="actions"><RowActions>{p.status === 'paid' && canCancel && <IconAction icon="close" label="إلغاء الصرف" danger onClick={() => onCancel(p)} />}</RowActions></td>
        </tr>
      ))}</tbody>
      <tfoot><tr><td colSpan={4}>{`الإجمالي المصروف (${rows.filter((p) => p.status === 'paid').length} سند)`}</td><td className="num">{money(sumBy(rows.filter((p) => p.status === 'paid'), (p) => p.amount))}</td><td colSpan={6} /></tr></tfoot>
    </>
  );
}
