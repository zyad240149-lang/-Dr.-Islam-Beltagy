import { CompletenessBadge, IncompleteAlert } from '../components/PatientCompleteness';
import { isPatientComplete } from '../utils/patientGaps';
import { fmtInvoiceStamp } from '../utils/format';
import { patientMatches } from '../utils/phoneUtils';
import { PackagePaymentPanel, useInstallmentRequests } from '../components/PackagePayment';
import { empName, fixedPackageOf, installmentsApi, instStateOf, INST_STATE, requestFor } from '../data/installments';
import { InstallmentStateBadge, InstallmentSummary } from '../components/InstallmentSummary';
import { useDetails } from '../components/DetailsHost';
import InstallmentPatientsTab from '../components/InstallmentPatientsTab';
import { useEffect, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { db, newestInvoiceFirst, normalizeCode } from '../data/db';
import { useDbVersion, useLoading } from '../hooks/useDb';
import { Button, EmptyState, Skeleton, StatusBadge, Modal, Input, Select } from '../components/ui';
import { ConfirmDialog, FilterBar, IconAction, RowActions, useCan } from '../components/common';
import { StatCard } from '../components/StatCard';
import { INVOICE_STATUS, PAYMENT_METHOD_LABEL, PAYMENT_METHOD_OPTIONS, addDaysYmd, amountToArabicWords, exportCsv, fmtDate, fmtDateTime, money, tsToYmd, todayYmd } from '../utils/format';
import { useToast } from '../hooks/useToast';
import type { Invoice, Package, Payment, PaymentMethod } from '../types';
import { Icon } from '../utils/icons';
import { phoneMatches } from '../utils/phoneUtils';
import { InvoiceWhatsappButton, InvoiceFileButtons } from '../components/InvoiceActions';
import PlanSessionBooking from '../components/PlanSessionBooking';
import { autoPlanPriceInfo } from '../components/PatientForms';
import { EditAppointmentModal } from '../components/AppointmentActions';

// فاتورة موعد لسه ينفع يتعدّل موعدها (مش ملغي/مكتمل) → «تعديل» بيفتح تعديل الخدمة/السعر/الموعد مرة واحدة، والفاتورة بتتحدّث معاه
const editableAppt = (i: Invoice) => { const a = i.appointmentId ? db.appointment(i.appointmentId) : undefined; return a && a.status !== 'cancelled' ? a : undefined; };

const SentTag = ({ i }: { i: Invoice }) => (<>
  {i.sentAt ? <span className="muted" style={{ fontSize: 12, display: 'block' }}>أُرسلت واتساب · {fmtDate(tsToYmd(i.sentAt))}</span> : null}
</>);

// قالب الفاتورة المطبوعة — مستقل (بياخد بس رقم الفاتورة ويجيب كل بياناته من db) عشان
// يتعرض جوه المودال وقت الطباعة، وكمان يترسم "مخفي" برّه الشاشة لحظة توليد PDF لإرساله واتساب.
export function InvoicePrintTemplate({ invoiceId }: { invoiceId: string }) {
  const invoice = db.invoice(invoiceId);
  if (!invoice) return null;
  const center = db.center();
  const patient = db.patient(invoice.patientId);
  const payments = db.paymentsForInvoice(invoice.id).filter((p) => !p.voidedAt);
  const appt = invoice.appointmentId ? db.appointment(invoice.appointmentId) : undefined;
  const plan = invoice.planId ? db.plan(invoice.planId) : undefined;
  const doctor = appt?.therapistId ? db.therapist(appt.therapistId) : plan?.therapistId ? db.therapist(plan.therapistId) : undefined;
  const pkg = invoice.packageId ? db.raw().packages.find((x) => x.id === invoice.packageId) : undefined;
  const qty = pkg?.totalSessions ?? 1;
  const unitPrice = qty > 1 ? invoice.price / qty : invoice.price;
  const lastPaymentMethod = payments.length ? PAYMENT_METHOD_LABEL[payments[payments.length - 1].method] : '—';
  const stampMs = payments.length ? payments[payments.length - 1].date : invoice.createdAt || Date.parse(invoice.date + 'T00:00:00');
  return (
    <div className="pinv" dir="rtl">
      <div className="pinv__top">
        <div className="pinv__brand">
          <img src={`${import.meta.env.BASE_URL}brand/logo.svg`} alt="" />
          <div><h1>{center.name}</h1><p>{[center.city, center.district, center.street].filter(Boolean).join(' – ')}</p><p className="num">{center.phone}</p></div>
        </div>
        <div className="pinv__title"><h2>فاتورة</h2><p className="num">{invoice.no}</p></div>
      </div>
      <dl className="pinv__meta">
        <div><dt>التاريخ</dt><dd className="num">{fmtInvoiceStamp(stampMs)}</dd></div>
        <div><dt>رقم الملف</dt><dd className="num">{patient?.fileNo}</dd></div>
        <div><dt>اسم المريض</dt><dd>{patient?.fullName}</dd></div>
        <div><dt>الطبيب</dt><dd>{doctor?.name ?? '—'}</dd></div>
        <div><dt>طريقة الدفع</dt><dd>{lastPaymentMethod}</dd></div>
      </dl>
      <table className="pinv__table">
        <thead><tr><th>#</th><th>الخدمة</th><th>الكمية</th><th>سعر الوحدة</th><th>الخصم</th><th>الإجمالي</th></tr></thead>
        <tbody><tr>
          <td>1</td><td>{invoice.serviceName}</td><td className="num">{qty}</td><td className="num">{money(unitPrice)}</td><td className="num">{money(invoice.discount)}</td><td className="num">{money(invoice.total)}</td>
        </tr></tbody>
      </table>
      <dl className="pinv__totals">
        <div><dt>الإجمالي قبل الخصم</dt><dd className="num">{money(invoice.price)}</dd></div>
        <div><dt>الخصم</dt><dd className="num">{money(invoice.discount)}</dd></div>
        <div className="pinv__grand"><dt>الإجمالي المستحق</dt><dd className="num">{money(invoice.total)}</dd></div>
        <div><dt>المدفوع</dt><dd className="num">{money(invoice.paid)}</dd></div>
        <div><dt>المتبقي</dt><dd className="num">{money(invoice.remaining)}</dd></div>
      </dl>
      <p className="pinv__words">{amountToArabicWords(invoice.total)}</p>
      <PackageInvoiceBlock invoice={invoice} pkg={pkg} />
      <div className="pinv__sign"><span>توقيع المريض</span><span>توقيع موظف الاستقبال</span></div>
    </div>
  );
}

// باقات 4/6 جلسات: تفاصيل السداد (كامل أو على دفعتين) في الفاتورة المطبوعة / PDF
function PackageInvoiceBlock({ invoice, pkg }: { invoice: Invoice; pkg?: Package }) {
  const pays = db.paymentsForInvoice(invoice.id).filter((p) => !p.voidedAt).sort((a, b) => a.date - b.date);
  const name = (id?: string | null) => (id ? db.employees().find((e) => e.id === id)?.name : undefined) ?? '—';
  const first = pays.find((p) => p.installmentNo === 1), second = pays.find((p) => p.installmentNo === 2);
  const approver = first?.installmentApprovedBy ?? second?.installmentApprovedBy;
  const state = invoice.remaining <= 0 ? 'مدفوع بالكامل' : invoice.paid > 0 ? 'مدفوع جزئيًا' : 'بانتظار الدفع';
  return (
    <div className="pinv__pkg" dir="rtl">
      {pkg && <div><dt>الباقة / عدد الجلسات</dt><dd>{pkg.name} — {pkg.totalSessions} جلسات</dd></div>}
      <div><dt>{pkg ? 'إجمالي قيمة الباقة' : 'إجمالي الفاتورة'}</dt><dd className="num">{invoice.total.toFixed(2)}</dd></div>
      {first ? (<>
        <div><dt>الدفعة الأولى — {fmtDateTime(first.date)}</dt><dd className="num">{first.amount.toFixed(2)}</dd></div>
        <div><dt>الدفعة الثانية{second ? ` — ${fmtDateTime(second.date)}` : ''}</dt><dd className="num">{second ? second.amount.toFixed(2) : '—'}</dd></div>
      </>) : pays.length === 1 && invoice.remaining <= 0 ? <div><dt>دفع كامل — {fmtDateTime(pays[0].date)}</dt><dd className="num">{pays[0].amount.toFixed(2)}</dd></div>
        : pays.map((p, i) => <div key={p.id}><dt>دفعة {i + 1} — {fmtDateTime(p.date)}</dt><dd className="num">{p.amount.toFixed(2)}</dd></div>)}
      <div><dt>إجمالي المدفوع</dt><dd className="num">{invoice.paid.toFixed(2)}</dd></div>
      <div><dt>المبلغ المتبقي</dt><dd className="num">{invoice.remaining.toFixed(2)}</dd></div>
      <div><dt>حالة الدفع</dt><dd>{state}{first ? ' — على دفعتين' : ''}</dd></div>
      <div><dt>المحاسب</dt><dd>{name(pays[pays.length - 1]?.createdBy ?? invoice.createdBy)}</dd></div>
      {approver && <div><dt>وافق على التقسيط</dt><dd>{name(approver)}</dd></div>}
    </div>
  );
}

// توليد PDF فعلي للفاتورة (لإرساله كملف واتساب — واتساب مبيسمحش بإرفاق ملف تلقائي عن طريق رابط، فبننزّل
// PDF جاهز على جهاز الموظف وهو بس يرفقه في المحادثة اللي بتتفتح) — بيرسم القالب مخفي برّه الشاشة، يصوّره
// canvas، ويحوّله PDF بنفس مقاس A4.
function saveBlob(blob: Blob, name: string) {
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob); a.download = name;
  document.body.appendChild(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(a.href), 5000);
}
export async function downloadInvoicePdf(invoiceId: string): Promise<void> {
  const invoice = db.invoice(invoiceId);
  saveBlob(await buildInvoicePdf(invoiceId), `${invoice?.no ?? 'invoice'}.pdf`);
}
export async function buildInvoicePdf(invoiceId: string): Promise<Blob> {
  const invoice = db.invoice(invoiceId);
  if (!invoice) throw new Error('الفاتورة غير موجودة.');
  const [{ default: html2canvas }, { jsPDF }] = await Promise.all([import('html2canvas'), import('jspdf')]);
  const host = document.createElement('div');
  host.style.cssText = 'position:fixed;top:0;left:-10000px;width:780px;background:#fff;padding:24px;direction:rtl;';
  host.dir = 'rtl';
  document.body.appendChild(host);
  const { createRoot } = await import('react-dom/client');
  const root = createRoot(host);
  await new Promise<void>((resolve) => {
    root.render(<InvoicePrintTemplate invoiceId={invoiceId} />);
    setTimeout(resolve, 60); // نستنى الـDOM يترسم
  });
  const imgs = Array.from(host.querySelectorAll('img'));
  await Promise.all(imgs.map((img) => img.complete ? Promise.resolve() : new Promise((res) => { img.onload = res; img.onerror = res; })));
  try {
    const canvas = await html2canvas(host, { scale: 2, useCORS: true, backgroundColor: '#ffffff' });
    const pdf = new jsPDF({ unit: 'mm', format: 'a4' });
    const pageW = pdf.internal.pageSize.getWidth();
    const pageH = pdf.internal.pageSize.getHeight();
    const imgH = (canvas.height * pageW) / canvas.width;
    const data = canvas.toDataURL('image/jpeg', 0.92);
    // صفحة واحدة دايمًا: لو القالب أطول من A4 بيتصغّر ليناسبها (وبيتوسّط)
    const k = imgH > pageH ? pageH / imgH : 1;
    pdf.addImage(data, 'JPEG', (pageW - pageW * k) / 2, 0, pageW * k, imgH * k);
    return pdf.output('blob');
  } finally {
    root.unmount();
    host.remove();
  }
}

export default function Invoices() {
  useDbVersion();
  const loading = useLoading();
  const can = useCan();
  const [params] = useSearchParams();
  const [tab, setTab] = useState<'invoices' | 'plans' | 'payments' | 'installments'>(params.get('tab') === 'plans' ? 'plans' : params.get('tab') === 'installments' ? 'installments' : 'invoices');
  const [planView, setPlanView] = useState<'draft' | 'issued'>('draft');
  const listReqs = useInstallmentRequests();
  const [planQ, setPlanQ] = useState('');
  const [editingPlanInv, setEditingPlanInv] = useState<string | null>(null);
  const [editingAppt, setEditingAppt] = useState<string | null>(null);
  const editInvoice = (i: Invoice) => { if (can('appointments', 'edit') && editableAppt(i)) setEditingAppt(i.appointmentId!); else setCurrentId(i.id); };
  const [currentId, setCurrentId] = useState<string | null>(params.get('invoice') || null);
  const [q, setQ] = useState(params.get('q') ?? '');
  const [status, setStatus] = useState('');
  const [from, setFrom] = useState('');
  const [to, setTo] = useState('');
  const [kind, setKind] = useState('');
  const [payQ, setPayQ] = useState('');
  const [payMethod, setPayMethod] = useState('');
  const [payFrom, setPayFrom] = useState('');
  const [payTo, setPayTo] = useState('');
  const [editingPay, setEditingPay] = useState<Payment | null>(null);
  const [deletingPay, setDeletingPay] = useState<Payment | null>(null);
  const [deletingInv, setDeletingInv] = useState<string | null>(null);
  const toast = useToast();

  const invoices = db.invoices().filter((i) => {
    const p = db.patient(i.patientId);
    const s = q.trim().toLowerCase();
    return (!s || i.no.toLowerCase().includes(s) || patientMatches(p, s) || i.serviceName.includes(q.trim()))
      && (!status || i.status === status) && (!from || i.date >= from) && (!to || i.date <= to)
      && (!kind || (kind === 'package' ? !!i.packageId : !i.packageId));
  }).sort(newestInvoiceFirst);
  const valid = invoices.filter((i) => i.status !== 'cancelled' && i.status !== 'draft');
  const total = valid.reduce((s, i) => s + i.total, 0);
  const paid = valid.reduce((s, i) => s + i.paid, 0);
  const due = valid.reduce((s, i) => s + i.remaining, 0);
  const discounts = valid.reduce((s, i) => s + i.discount, 0);

  const payments = db.payments().filter((p) => {
    const pt = db.patient(p.patientId);
    const inv = db.invoice(p.invoiceId);
    const s = payQ.trim().toLowerCase();
    const day = tsToYmd(p.date);
    return (!s || patientMatches(pt, s) || inv?.no.toLowerCase().includes(s))
      && (!payMethod || p.method === payMethod) && (!payFrom || day >= payFrom) && (!payTo || day <= payTo);
  });
  const planInvoices = db.invoices().filter((i) => i.planId);
  const draftCount = planInvoices.filter((i) => i.status === 'draft').length;
  const planRows = planInvoices.filter((i) => (planView === 'draft' ? i.status === 'draft' : i.status !== 'draft')).filter((i) => {
    const p = db.patient(i.patientId); const s = planQ.trim().toLowerCase();
    return !s || i.no.toLowerCase().includes(s) || patientMatches(p, s);
  }).sort(newestInvoiceFirst);
  const paySum = (m?: string) => payments.filter((p) => !m || p.method === m).reduce((s, p) => s + p.amount, 0);

  const doExportInvoices = () => exportCsv('الفواتير', ['رقم الفاتورة', 'التاريخ', 'المريض', 'الخدمة/الباقة', 'السعر', 'الخصم', 'الإجمالي', 'المدفوع', 'المتبقي', 'الحالة'],
    invoices.map((i) => [i.no, i.date, db.patient(i.patientId)?.fullName ?? '', i.serviceName, i.price, i.discount, i.total, i.paid, i.remaining, INVOICE_STATUS[i.status].label]));
  const doExportPayments = () => exportCsv('المدفوعات', ['التاريخ', 'المريض', 'الفاتورة', 'الخدمة', 'المبلغ', 'طريقة الدفع', 'ملاحظة'],
    payments.map((p) => [fmtDateTime(p.date), db.patient(p.patientId)?.fullName ?? '', db.invoice(p.invoiceId)?.no ?? '', db.invoice(p.invoiceId)?.serviceName ?? '', p.amount, PAYMENT_METHOD_LABEL[p.method], p.note]));

  return (
    <div className="page">
      <div className="page-head">
        <div><h1>الفواتير والمدفوعات</h1><p>الوضع المالي الكامل: الفواتير وحالة الدفع، وسجل كل دفعة استُلمت.</p></div>
        <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
          <Button variant="outline" icon="doc" onClick={tab === 'invoices' ? doExportInvoices : doExportPayments}>تصدير Excel</Button>
        </div>
      </div>

      <div className="card">
        <div className="tabs"><button className={`tab ${tab === 'invoices' ? 'active' : ''}`} onClick={() => setTab('invoices')}>الفواتير</button><button className={`tab ${tab === 'plans' ? 'active' : ''}`} onClick={() => setTab('plans')}>فواتير الخطط العلاجية {draftCount > 0 && <span className="tab-count num">{draftCount}</span>}</button><button className={`tab ${tab === 'payments' ? 'active' : ''}`} onClick={() => setTab('payments')}>المدفوعات</button><button className={`tab ${tab === 'installments' ? 'active' : ''}`} onClick={() => setTab('installments')}>المرضى المقسّطين</button></div>

        {tab === 'installments' ? <InstallmentPatientsTab onOpenInvoice={setCurrentId} onReviewPlanInvoice={setEditingPlanInv} /> : tab === 'plans' ? (
          <>
            <div className="plan-inv-intro">
              <Icon name="target" size={18} />
              <div>عند إنشاء المعالج خطة علاجية تصل فاتورتها هنا <strong>بانتظار المراجعة</strong>. يراجع الاستقبال السعر والخصم ثم يعتمدها لتصبح مستحقة الدفع.</div>
            </div>
            <div className="plan-inv-bar">
              <div className="svc-tabs" style={{ marginBottom: 0 }}>
                <button type="button" className={`svc-tab ${planView === 'draft' ? 'active' : ''}`} onClick={() => setPlanView('draft')}>بانتظار المراجعة <span className="num">{draftCount}</span></button>
                <button type="button" className={`svc-tab ${planView === 'issued' ? 'active' : ''}`} onClick={() => setPlanView('issued')}>المعتمدة <span className="num">{planInvoices.length - draftCount}</span></button>
              </div>
              <div style={{ minWidth: 240, flex: '0 1 320px' }}>
                <Input id="pinv-q" icon="search" placeholder="اسم المريض أو الجوال أو رقم الملف أو الهوية أو الفاتورة" value={planQ} onChange={(e) => setPlanQ(e.target.value)} />
              </div>
            </div>
            <div className="card__body">
              {planRows.length === 0 ? <EmptyState icon="receipt" title={planView === 'draft' ? 'ما فيه فواتير خطط بانتظار المراجعة' : 'ما فيه فواتير خطط معتمدة'} /> : (
                <div className="table-wrap"><table className="table">
                  <thead><tr><th>رقم الفاتورة</th><th>المريض</th><th>الخطة العلاجية</th><th>أنشأها</th><th>السعر</th><th>الخصم</th><th>الإجمالي</th><th>الحالة</th><th>التقسيط</th><th className="actions"></th></tr></thead>
                  <tbody>{planRows.map((i) => {
                    const st = INVOICE_STATUS[i.status]; const plan = i.planId ? db.plan(i.planId) : undefined;
                    const creator = i.createdBy ? db.employeeById(i.createdBy) : undefined;
                    return (
                      <tr key={i.id}>
                        <td className="num">{i.no}<div className="muted" style={{ fontSize: 12 }}>{fmtDate(i.date)}</div></td>
                        <td style={{ fontWeight: 600 }}>{db.patient(i.patientId)?.fullName} <CompletenessBadge patient={db.patient(i.patientId)} /><div className="muted num" style={{ fontSize: 12, fontWeight: 400 }}>{db.patient(i.patientId)?.phone}</div></td>
                        <td>{plan?.diagnosis ?? '—'}<div className="muted" style={{ fontSize: 12 }}>{i.serviceName.replace('خطة علاج: ', '')}</div></td>
                        <td>{creator?.name ?? '—'}</td>
                        <td className="num">{money(i.price)}</td>
                        <td className="num">{i.discount ? money(i.discount) : '—'}</td>
                        <td className="num" style={{ fontWeight: 700 }}>{money(i.total)}</td>
                        <td><StatusBadge label={st.label} tone={st.tone} /><SentTag i={i} /></td>
                        <td>{listReqs.rows ? <InstallmentStateBadge invoice={i} req={requestFor(listReqs.rows, i.id)} /> : null}</td>
                        <td className="actions"><RowActions>
                          {i.status === 'draft' ? (
                            can('invoices', 'edit') && <Button size="sm" icon="edit" onClick={() => setEditingPlanInv(i.id)}>مراجعة وتعديل</Button>
                          ) : (
                            <>
                              {can('invoices', 'edit') && i.status !== 'cancelled' && <IconAction icon="edit" label="تعديل الفاتورة" onClick={() => setEditingPlanInv(i.id)} />}
                              <Button size="sm" variant="outline" onClick={() => setCurrentId(i.id)}>عرض</Button>
                              {i.status !== 'cancelled' && <InvoiceWhatsappButton invoice={i} size="sm" variant="outline" />}
                            </>
                          )}
                        </RowActions></td>
                      </tr>
                    );
                  })}</tbody>
                </table></div>
              )}
            </div>
          </>
        ) : tab === 'invoices' ? (
          <>
            {!can('financial', 'view') ? null : loading ? <div style={{ padding: 22 }}><Skeleton h={70} /></div> : (
              <div className="kpi-grid" style={{ padding: '18px 22px 0' }}>
                <StatCard icon="wallet" tone="brand" value={money(total)} label="إجمالي الفواتير" />
                <StatCard icon="checkCircle" tone="ok" value={money(paid)} label="المدفوع" />
                <StatCard icon="receipt" tone="warn" value={money(due)} label="المستحق" />
                <StatCard icon="trendDown" tone="info" value={money(discounts)} label="الخصومات" />
              </div>
            )}
            <FilterBar>
              <Input id="inv-q" label="بحث" icon="search" placeholder="اسم المريض أو الجوال أو رقم الملف أو الهوية أو الفاتورة" value={q} onChange={(e) => setQ(e.target.value)} />
              <Select id="inv-status" label="الحالة" value={status} onChange={(e) => setStatus(e.target.value)} options={[{ value: '', label: 'كل الحالات' }, ...Object.entries(INVOICE_STATUS).map(([value, v]) => ({ value, label: v.label }))]} />
              <Select id="inv-kind" label="النوع" value={kind} onChange={(e) => setKind(e.target.value)} options={[{ value: '', label: 'الكل' }, { value: 'service', label: 'جلسات/خدمات' }, { value: 'package', label: 'باقات' }]} />
              <Input id="inv-from" label="من تاريخ" type="date" value={from} onChange={(e) => setFrom(e.target.value)} />
              <Input id="inv-to" label="إلى تاريخ" type="date" value={to} onChange={(e) => setTo(e.target.value)} />
            </FilterBar>
            <div className="card__body">
              {invoices.length === 0 ? <EmptyState icon="receipt" title="ما فيه فواتير مطابقة" /> : (
                <div className="table-wrap"><table className="table">
                  <thead><tr><th>رقم الفاتورة</th><th>التاريخ</th><th>المريض</th><th>الخدمة</th><th>الإجمالي</th><th>المدفوع</th><th>المتبقي</th><th>الحالة</th><th className="actions"></th></tr></thead>
                  <tbody>{invoices.map((i) => { const st = INVOICE_STATUS[i.status]; return (
                    <tr key={i.id}>
                      <td className="num">{i.no}</td><td>{fmtDate(i.date)}</td><td>{db.patient(i.patientId)?.fullName} <CompletenessBadge patient={db.patient(i.patientId)} /></td><td>{i.serviceName}</td>
                      <td className="num">{money(i.total)}</td><td className="num">{money(i.paid)}</td><td className="num">{money(i.remaining)}</td>
                      <td><StatusBadge label={st.label} tone={st.tone} /><SentTag i={i} />{listReqs.rows && requestFor(listReqs.rows, i.id) ? <div style={{ marginTop: 4 }}><InstallmentStateBadge invoice={i} req={requestFor(listReqs.rows, i.id)} /></div> : null}</td>
                      <td className="actions">
                        {i.status === 'draft'
                          ? (can('invoices', 'edit') ? <Button size="sm" onClick={() => setEditingPlanInv(i.id)}>مراجعة وتعديل</Button> : <span className="muted" style={{ fontSize: 12.5 }}>بانتظار الاستقبال</span>)
                          : <div style={{ display: 'flex', gap: 6, justifyContent: 'flex-end' }}>
                            {i.status !== 'cancelled' && <InvoiceWhatsappButton invoice={i} size="sm" variant="outline" />}
                            {can('invoices', 'edit') && i.status !== 'cancelled' && <Button size="sm" variant="outline" icon="edit" onClick={() => editInvoice(i)}>تعديل</Button>}
                            <Button size="sm" variant="outline" onClick={() => setCurrentId(i.id)}>عرض</Button>
                            {can('invoices', 'delete') && <IconAction icon="trash" label="حذف الفاتورة" danger onClick={() => setDeletingInv(i.id)} />}
                          </div>}
                      </td>
                    </tr>
                  );})}</tbody>
                </table></div>
              )}
            </div>
          </>
        ) : (
          <>
            {can('financial', 'view') && <div className="kpi-grid" style={{ padding: '18px 22px 0' }}>
              <StatCard icon="wallet" tone="ok" value={money(paySum())} label="إجمالي المحصّل" />
              <StatCard icon="wallet" tone="brand" value={money(paySum('cash'))} label="نقدًا" />
              <StatCard icon="wallet" tone="info" value={money(paySum('card'))} label="بطاقة" />
              <StatCard icon="wallet" tone="warn" value={money(paySum('transfer'))} label="تحويل" />
            </div>}
            <FilterBar>
              <Input id="pay-q" label="بحث" icon="search" placeholder="اسم المريض أو الجوال أو رقم الملف أو الهوية أو الفاتورة" value={payQ} onChange={(e) => setPayQ(e.target.value)} />
              <Select id="pay-method" label="طريقة الدفع" value={payMethod} onChange={(e) => setPayMethod(e.target.value)} options={[{ value: '', label: 'الكل' }, ...PAYMENT_METHOD_OPTIONS]} />
              <Input id="pay-from" label="من تاريخ" type="date" value={payFrom} onChange={(e) => setPayFrom(e.target.value)} />
              <Input id="pay-to" label="إلى تاريخ" type="date" value={payTo} onChange={(e) => setPayTo(e.target.value)} />
            </FilterBar>
            <div className="card__body">
              {payments.length === 0 ? <EmptyState icon="wallet" title="ما فيه مدفوعات مطابقة" /> : (
                <div className="table-wrap"><table className="table">
                  <thead><tr><th>التاريخ</th><th>المريض</th><th>الفاتورة</th><th>الخدمة</th><th>المبلغ</th><th>طريقة الدفع</th><th>ملاحظة</th><th className="actions"></th></tr></thead>
                  <tbody>{payments.map((p) => (
                    <tr key={p.id}>
                      <td className="num">{fmtDateTime(p.date)}</td><td>{db.patient(p.patientId)?.fullName}</td><td className="num">{db.invoice(p.invoiceId)?.no}</td>
                      <td>{db.invoice(p.invoiceId)?.serviceName}</td><td className="num">{money(p.amount)}</td><td>{PAYMENT_METHOD_LABEL[p.method]}</td><td>{p.note || '—'}</td>
                      <td className="actions"><RowActions>
                        {can('payments', 'edit') && <IconAction icon="edit" label="تعديل الدفعة" onClick={() => setEditingPay(p)} />}
                        {can('payments', 'delete') && <IconAction icon="trash" label="حذف الدفعة" danger onClick={() => setDeletingPay(p)} />}
                      </RowActions></td>
                    </tr>
                  ))}</tbody>
                </table></div>
              )}
            </div>
          </>
        )}
      </div>

      {currentId && db.invoice(currentId) && <InvoiceModal invoiceId={currentId} canEdit={can('invoices', 'edit')} canDelete={can('invoices', 'delete')} canPay={can('payments', 'create')} canEditPay={can('payments', 'edit')} canDeletePay={can('payments', 'delete')} onClose={() => setCurrentId(null)} />}
      {editingPlanInv && db.invoice(editingPlanInv) && <PlanInvoiceModal invoice={db.invoice(editingPlanInv)!} onClose={() => setEditingPlanInv(null)} />}
      {editingPay && <EditPaymentModal payment={editingPay} onClose={() => setEditingPay(null)} />}
      {editingAppt && db.appointment(editingAppt) && <EditAppointmentModal fromInvoices appt={db.appointment(editingAppt)!} onClose={() => setEditingAppt(null)} />}
      {deletingInv && db.invoice(deletingInv) && <ConfirmDeleteInvoice invoice={db.invoice(deletingInv)!} onClose={() => setDeletingInv(null)} />}
      {deletingPay && <ConfirmDialogPayment payment={deletingPay} onClose={() => setDeletingPay(null)} />}
    </div>
  );
}

export function ConfirmDeleteInvoice({ invoice, onClose, onDone }: { invoice: Invoice; onClose: () => void; onDone?: () => void }) {
  const toast = useToast();
  const n = db.paymentsForInvoice(invoice.id).length;
  return (
    <ConfirmDialog title="حذف الفاتورة" confirmLabel="حذف نهائي" onClose={onClose}
      message={`سيتم حذف الفاتورة ${invoice.no} نهائيًا${n ? ` مع ${n} دفعة (${money(invoice.paid)})` : ''}. ما يمكن التراجع.`}
      onConfirm={async () => { const r = await db.deleteInvoice(invoice.id); if (r.ok) { toast.success('تم حذف الفاتورة.'); onDone?.(); } else toast.error(r.error); }} />
  );
}

function ConfirmDialogPayment({ payment, onClose }: { payment: Payment; onClose: () => void }) {
  const toast = useToast();
  return (
    <ConfirmDialog title="حذف الدفعة" onClose={onClose} message={`سيتم حذف دفعة ${money(payment.amount)} وإعادة احتساب المتبقي على الفاتورة ${db.invoice(payment.invoiceId)?.no}.`}
      onConfirm={async () => { await db.deletePayment(payment.id); toast.success('تم حذف الدفعة.'); }} />
  );
}

function InvoiceModal({ invoiceId, canEdit, canDelete, canPay, canEditPay, canDeletePay, onClose }: { invoiceId: string; canEdit: boolean; canDelete: boolean; canPay: boolean; canEditPay: boolean; canDeletePay: boolean; onClose: () => void }) {
  useDbVersion();
  const toast = useToast();
  const invoice = db.invoice(invoiceId) as Invoice;
  const can2 = useCan();
  const [editApptOpen, setEditApptOpen] = useState(false);
  const [delOpen, setDelOpen] = useState(false);
  const apptEditable = can2('appointments', 'edit') ? editableAppt(invoice) : undefined;
  const [amount, setAmount] = useState(invoice.remaining);
  const [method, setMethod] = useState<PaymentMethod>('cash');
  const [note, setNote] = useState('');
  const [discount, setDiscount] = useState(invoice.discount);
  const [price, setPrice] = useState(invoice.price);
  const [name, setName] = useState(invoice.serviceName);
  const [invNote, setInvNote] = useState(invoice.note ?? '');
  const [busy, setBusy] = useState(false);
  const [editPay, setEditPay] = useState<Payment | null>(null);
  const [promo, setPromo] = useState('');
  const [confirm, setConfirm] = useState<{ title: string; message: string; run: () => Promise<void>; label?: string } | null>(null);
  if (!invoice) return null;
  const st = INVOICE_STATUS[invoice.status];
  const payments = db.paymentsForInvoice(invoice.id);
  const center = db.center();
  const patient = db.patient(invoice.patientId);
  const appt = invoice.appointmentId ? db.appointment(invoice.appointmentId) : undefined;
  const doctor = appt ? db.therapist(appt.therapistId) : undefined;
  const pkg = invoice.packageId ? db.raw().packages.find((x) => x.id === invoice.packageId) : undefined;
  const qty = pkg?.totalSessions ?? 1;
  const unitPrice = qty > 1 ? invoice.price / qty : invoice.price;
  const taxRate = invoice.taxRate ?? center.taxRate ?? 0;
  const taxAmount = invoice.taxAmount ?? 0;
  const taxableAmount = invoice.price - invoice.discount;
  const lastPaymentMethod = payments.length ? PAYMENT_METHOD_LABEL[payments[payments.length - 1].method] : '—';
  // باقة 4/6 جلسات: الدفع بـ Workflow خاص (كامل أو دفعتين بموافقة المدير) — بدون تعديل/حذف دفعات ولا تعديل السعر بعد أي دفع
  const fixedPkg = fixedPackageOf(invoice);
  const { openPlan, openVisit } = useDetails();
  const instReqs = useInstallmentRequests();
  // فاتورة خطة علاجية عليها طلب تقسيط = نفس Workflow الباقات
  const planInst = !fixedPkg && !!invoice.planId && !!(instReqs.rows && requestFor(instReqs.rows, invoice.id));
  const governed = !!fixedPkg || planInst;

  const pay = async () => {
    setBusy(true);
    const r = await db.recordPayment(invoice.id, amount, method, note);
    setBusy(false);
    if (!r.ok) { toast.error(r.error); return; }
    toast.success('تم تسجيل الدفعة.');
    setNote('');
    setAmount(db.invoice(invoice.id)?.remaining ?? 0);
  };
  const applyCode = async () => {
    const r = await db.applyDiscountCode(invoice.id, promo);
    if (!r.ok) { toast.error(r.error); return; }
    toast.success('تم تطبيق كود الخصم.');
    setPromo('');
    const inv = db.invoice(invoice.id);
    setDiscount(inv?.discount ?? 0); setAmount(inv?.remaining ?? 0);
  };
  const saveEdits = async () => {
    if (name.trim() !== invoice.serviceName) {
      const n = await db.setInvoiceName(invoice.id, name);
      if (!n.ok) { toast.error(n.error); return; }
    }
    const r = await db.updatePlanInvoice(invoice.id, { price, discount, note: invNote }, false);
    if (r.ok) { toast.success('تم حفظ تعديل الفاتورة.'); setAmount(db.invoice(invoice.id)?.remaining ?? 0); } else toast.error(r.error);
  };
  const sendToAccount = async () => {
    const r = await db.sendCampaign({
      title: 'فاتورتك جاهزة',
      body: `فاتورة ${invoice.no} (${invoice.serviceName}) بقيمة ${money(invoice.total)} — المتبقي ${money(invoice.remaining)}. تقدر تراجعها والدفع من حسابك في النظام.`,
      audience: 'patient', patientId: invoice.patientId,
    });
    if (!r.ok) { toast.error(r.error); return; }
    if (r.delivered > 0) toast.success('تم إرسال إشعار الفاتورة لحساب المريض.');
    else toast.error('المريض ليس له حساب مفعّل في النظام — لم يصل الإشعار.');
  };

  return (
    <Modal title={`الفاتورة ${invoice.no}`} wide onClose={onClose} footer={
      <div className="no-print" style={{ display: 'contents' }}>
        {canDelete && <Button variant="soft-danger" icon="trash" onClick={() => setDelOpen(true)}>حذف</Button>}
        {canEdit && can2('inv_cancel', 'view') && invoice.status !== 'cancelled' && invoice.paid === 0 && <Button variant="ghost" onClick={() => setConfirm({ title: 'إلغاء الفاتورة', label: 'تأكيد الإلغاء', message: `سيتم إلغاء ${invoice.no} ولن تُحسب ضمن المستحقات.`, run: async () => { const r = await db.cancelInvoice(invoice.id); if (r.ok) toast.success('تم إلغاء الفاتورة.'); else toast.error(r.error); } })}>إلغاء الفاتورة</Button>}
        <span style={{ flex: 1 }} />
        {invoice.status !== 'cancelled' && <Button variant="ghost" icon="bell" onClick={sendToAccount}>إرسال الفاتورة لحسابه في النظام</Button>}
        {canEdit && invoice.status !== 'cancelled' && apptEditable && <Button variant="outline" icon="edit" onClick={() => setEditApptOpen(true)}>تعديل</Button>}
        {invoice.status !== 'cancelled' && invoice.status !== 'draft' && <><InvoiceFileButtons invoice={invoice} print={false} /><InvoiceWhatsappButton invoice={invoice} /></>}
        <Button variant="outline" icon="print" onClick={() => window.print()}>طباعة</Button>
        <Button variant="ghost" onClick={onClose}>إغلاق</Button>
      </div>
    }>
      <div className="no-print"><IncompleteAlert patientId={invoice.patientId} /></div>
      <div className="print-area screen-only">
        <div className="row-between" style={{ marginBottom: 16 }}>
          <div><h2 style={{ fontSize: 18 }}>{center.name}</h2><p className="muted" style={{ fontSize: 12.5 }}>{center.city} – {center.district} · {center.phone}</p></div>
          <div style={{ textAlign: 'end' }}><StatusBadge label={st.label} tone={st.tone} /><SentTag i={invoice} /></div>
        </div>
        <dl className="dl" style={{ marginBottom: 16 }}>
          <div><dt>رقم الفاتورة</dt><dd className="num">{invoice.no}</dd></div>
          <div><dt>التاريخ</dt><dd>{fmtDate(invoice.date)}</dd></div>
          <div><dt>المريض</dt><dd>{patient?.fullName} ({patient?.fileNo}) <span className="no-print"><CompletenessBadge patient={patient} /></span></dd></div>
          <div><dt>الجوال</dt><dd className="num">{patient?.phone}</dd></div>
          <div style={{ gridColumn: '1/-1' }}><dt>الخدمة / الباقة</dt><dd>{invoice.serviceName}
            {invoice.planId && <Button size="sm" variant="ghost" icon="target" className="no-print" onClick={() => openPlan(invoice.planId!)}>الخطة العلاجية</Button>}
            </dd></div>
          <div><dt>السعر</dt><dd className="num">{money(invoice.price)}</dd></div>
          <div><dt>الخصم</dt><dd className="num">{money(invoice.discount)}</dd></div>
          <div><dt>الإجمالي</dt><dd className="num">{money(invoice.total)}</dd></div>
          <div><dt>المدفوع</dt><dd className="num">{money(invoice.paid)}</dd></div>
        </dl>
        <div className="review-total"><span>المتبقي</span><strong className="num">{money(invoice.remaining)}</strong></div>
      </div>

      {/* الفاتورة المطبوعة — تظهر عند الطباعة فقط */}
      <div className="print-only print-area">
        <InvoicePrintTemplate invoiceId={invoice.id} />
      </div>

      <div className="screen-only">
        {payments.length > 0 && !governed && (
          <>
            <div className="section-title" style={{ marginTop: 16 }}>الدفعات</div>
            <div className="table-wrap"><table className="table">
              <thead><tr><th>التاريخ</th><th>المبلغ</th><th>الطريقة</th><th>ملاحظة</th><th className="actions no-print"></th></tr></thead>
              <tbody>{payments.map((p) => (
                <tr key={p.id}><td className="num">{fmtDateTime(p.date)}</td><td className="num">{money(p.amount)}</td><td>{PAYMENT_METHOD_LABEL[p.method]}</td><td>{p.note || '—'}</td>
                  <td className="actions no-print"><RowActions>
                    {canEditPay && <IconAction icon="edit" label="تعديل الدفعة" onClick={() => setEditPay(p)} />}
                    {canDeletePay && <IconAction icon="trash" label="حذف الدفعة" danger onClick={() => setConfirm({ title: 'حذف الدفعة', message: `سيتم حذف دفعة ${money(p.amount)} وإعادة احتساب المتبقي على الفاتورة.`, run: async () => { await db.deletePayment(p.id); toast.success('تم حذف الدفعة.'); } })} />}
                  </RowActions></td>
                </tr>
              ))}</tbody>
            </table></div>
          </>
        )}
      </div>

      {invoice.status !== 'cancelled' && (
        <div className="no-print">
          {canEdit && can2('inv_price', 'view') && !(fixedPkg && invoice.paid > 0) && !planInst && !apptEditable && (
            <div className="form-section">
              <div className="form-section-title">تعديل الفاتورة</div>
              <Input id="inv-name" label="الخدمة / وصف الفاتورة" value={name} onChange={(e) => setName(e.target.value)} />
              <div className="grid-form">
                <Input id="inv-price" label="سعر الفاتورة (ج.م)" type="number" min={0} value={price} onChange={(e) => setPrice(Number(e.target.value))} />
                <Input id="inv-disc" label="الخصم (ج.م)" type="number" min={0} max={price} value={discount} onChange={(e) => setDiscount(Number(e.target.value))} />
              </div>
              <div className="field">
                <label htmlFor="inv-edit-note">ملاحظة على الفاتورة</label>
                <textarea id="inv-edit-note" className="input" rows={2} value={invNote} onChange={(e) => setInvNote(e.target.value)} />
              </div>
              <Button variant="outline" icon="edit" onClick={saveEdits}>حفظ تعديل الفاتورة</Button>
            </div>
          )}
          {canEdit && can2('inv_price', 'view') && apptEditable && !fixedPkg && !planInst && invoice.paid <= 0 && (
            <div className="form-section">
              <div className="form-section-title">الخصم</div>
              <div className="grid-form" style={{ alignItems: 'end' }}>
                <Input id="inv-disc2" label="الخصم (ج.م)" type="number" min={0} max={invoice.price} value={discount} onChange={(e) => setDiscount(Number(e.target.value))} />
                <Button variant="outline" icon="check" onClick={async () => { const r = await db.updatePlanInvoice(invoice.id, { price: invoice.price, discount, note: invoice.note ?? '' }, false); if (r.ok) { toast.success('تم حفظ الخصم.'); setAmount(db.invoice(invoice.id)?.remaining ?? 0); } else toast.error(r.error); }}>تطبيق الخصم</Button>
              </div>
            </div>
          )}
          {canEdit && (
            <div className="form-section">
              <div className="form-section-title">كود الخصم</div>
              {invoice.discountCode ? (
                <p className="muted" style={{ fontSize: 13 }}>كود الخصم المطبّق: <strong dir="ltr">{invoice.discountCode}</strong></p>
              ) : (
                <div className="grid-form" style={{ alignItems: 'end' }}>
                  <Input id="inv-code" label="كود خصم" dir="ltr" placeholder="TAMXXXXXX" value={promo} onChange={(e) => setPromo(normalizeCode(e.target.value))} />
                  <div className="field"><Button variant="outline" icon="receipt" onClick={applyCode} disabled={!promo}>تطبيق الكود</Button></div>
                </div>
              )}
            </div>
          )}
          {governed && <PackagePaymentPanel invoice={invoice} pkg={fixedPkg} />}
          {canPay && invoice.remaining > 0 && !governed && (
            <div className="form-section">
              <div className="form-section-title">تسجيل دفعة</div>
              <div className="grid-form grid-form--3">
                <Input id="inv-amount" label="مبلغ الدفعة" type="number" min={1} max={invoice.remaining} value={amount} onChange={(e) => setAmount(Number(e.target.value))} />
                <Select id="inv-method" label="طريقة الدفع" value={method} onChange={(e) => setMethod(e.target.value as PaymentMethod)} options={PAYMENT_METHOD_OPTIONS} />
                <Input id="inv-note" label="ملاحظة" value={note} onChange={(e) => setNote(e.target.value)} />
              </div>
              <Button icon="checkCircle" onClick={pay} loading={busy}>تسجيل دفعة</Button>
            </div>
          )}
        </div>
      )}
      {editPay && <EditPaymentModal payment={editPay} onClose={() => setEditPay(null)} />}
      {delOpen && <ConfirmDeleteInvoice invoice={invoice} onClose={() => setDelOpen(false)} onDone={onClose} />}
      {editApptOpen && apptEditable && <EditAppointmentModal fromInvoices appt={apptEditable} onClose={() => setEditApptOpen(false)} />}
      {confirm && <ConfirmDialog title={confirm.title} message={confirm.message} confirmLabel={confirm.label} onConfirm={confirm.run} onClose={() => setConfirm(null)} />}
    </Modal>
  );
}

export function EditPaymentModal({ payment, onClose }: { payment: Payment; onClose: () => void }) {
  const toast = useToast();
  const [f, setF] = useState({ amount: payment.amount, method: payment.method, note: payment.note });
  const [busy, setBusy] = useState(false);
  const submit = async () => {
    setBusy(true);
    const r = await db.updatePayment(payment.id, f);
    setBusy(false);
    if (!r.ok) { toast.error(r.error); return; }
    toast.success('تم تعديل الدفعة.');
    onClose();
  };
  return (
    <Modal title="تعديل الدفعة" onClose={onClose} footer={<><Button variant="outline" onClick={onClose} disabled={busy}>إلغاء</Button><Button onClick={submit} loading={busy}>حفظ</Button></>}>
      <Input id="ep-amount" label="المبلغ" type="number" min={1} value={f.amount} onChange={(e) => setF({ ...f, amount: Number(e.target.value) })} />
      <Select id="ep-method" label="طريقة الدفع" value={f.method} onChange={(e) => setF({ ...f, method: e.target.value as PaymentMethod })} options={PAYMENT_METHOD_OPTIONS} />
      <Input id="ep-note" label="ملاحظة" value={f.note} onChange={(e) => setF({ ...f, note: e.target.value })} />
    </Modal>
  );
}

function PlanInvoiceModal({ invoice, onClose }: { invoice: Invoice; onClose: () => void }) {
  useDbVersion();
  const toast = useToast();
  const can = useCan();
  const { openPlan } = useDetails();
  const inv0 = db.invoice(invoice.id) ?? invoice;
  const plan = inv0.planId ? db.plan(inv0.planId) : undefined;
  const patient = db.patient(inv0.patientId);
  const incomplete = !!patient && !isPatientComplete(patient); // اعتماد الفاتورة ممنوع والملف ناقص (الخادم بيرفض كمان — هجرة 159)
  const creator = inv0.createdBy ? db.employeeById(inv0.createdBy) : undefined;
  const isDraft = inv0.status === 'draft';
  const { rows: reqRows, reload: reloadReqs } = useInstallmentRequests();
  const req = reqRows ? requestFor(reqRows, inv0.id) : undefined;
  const instState = instStateOf(inv0, req);
  const locked = req?.status === 'pending' || req?.status === 'approved'; // السعر والخصم مقفولين بعد طلب التقسيط
  // طلب الدكتور بييجي بسعر 0 → السعر بيتحدد تلقائي (عرض الخطة أو سعر الخدمة × عدد الجلسات) وتقدر تعدّله
  const autoPrice = plan && !inv0.price ? autoPlanPriceInfo({ therapyType: plan.therapyType ?? '', serviceId: plan.serviceId, totalSessions: plan.totalSessions }) : null;
  const [f, setF] = useState({ price: inv0.price || autoPrice?.price || 0, discount: inv0.discount, note: inv0.note ?? '' });
  const [busy, setBusy] = useState<'save' | 'issue' | 'request' | null>(null);
  // طريقة الدفع: دفع كامل (زي الأول) أو طلب الدفع على دفعتين (يتبعت للمدير والفاتورة لسه هنا في المراجعة)
  const [payMode, setPayMode] = useState<'full' | 'installments'>('full');
  // عدد الجلسات قابل للتعديل في المراجعة؛ السعر بيتحسب تلقائي معاه لو ماتعدّلش بالإيد
  const [sessCount, setSessCount] = useState(plan?.totalSessions ?? 1);
  const [sessOther, setSessOther] = useState((plan?.totalSessions ?? 1) > 12);
  const [priceTouched, setPriceTouched] = useState(!!inv0.price);
  const changeSessions = (n: number) => {
    setSessCount(n);
    if (plan && !priceTouched) setF((x) => ({ ...x, price: autoPlanPriceInfo({ therapyType: plan.therapyType ?? '', serviceId: plan.serviceId, totalSessions: n }).price }));
  };
  const [payMethod, setPayMethod] = useState<PaymentMethod>('cash'); // طريقة دفع «حفظ واعتماد الفاتورة»
  const [instReason, setInstReason] = useState('');
  const today = todayYmd();
  const [d1, setD1] = useState(today);
  const [d2, setD2] = useState(addDaysYmd(today, 30));
  const canRequestInst = can('installments', 'create');
  const total = Math.max(0, f.price - f.discount);
  const half = Math.round((total / 2) * 100) / 100;
  const perSession = sessCount ? total / sessCount : 0;

  const save = async (issue: boolean) => {
    setBusy(issue ? 'issue' : 'save');
    if (plan && sessCount !== plan.totalSessions) {
      const rs = await db.updatePlanSessions(plan.id, sessCount);
      if (!rs.ok) { setBusy(null); toast.error(rs.error); return; }
    }
    const r = await db.updatePlanInvoice(inv0.id, f, issue);
    if (!r.ok) { setBusy(null); toast.error(r.error); return; }
    // إتمام فاتورة عليها تقسيط موافق عليه: مفيش دفع تلقائي — التحصيل بعدين على دفعتين من نافذة الفاتورة
    if (issue && req?.status === 'approved') {
      setBusy(null);
      toast.success('تم إتمام الفاتورة واعتمادها — سجّل الدفعة الأولى من الفاتورة.');
      onClose(); return;
    }
    // «حفظ واعتماد» (دفع كامل) = الفاتورة بتتسجل مدفوعة على طول (المتبقي كاش) وتدخل الحسابات
    if (issue) {
      const inv = db.invoices().find((i) => i.id === inv0.id);
      if (inv && inv.remaining > 0 && can('payments', 'create')) {
        const p = await db.recordPayment(inv.id, inv.remaining, payMethod);
        setBusy(null);
        if (!p.ok) { toast.error(`تم اعتماد الفاتورة، لكن تعذّر تسجيل الدفع: ${p.error ?? ''}`); return; }
        toast.success(`تم اعتماد الفاتورة وتسجيلها مدفوعة (${money(inv.remaining)} — ${PAYMENT_METHOD_LABEL[payMethod]}).`);
        onClose(); return;
      }
    }
    setBusy(null);
    toast.success(issue ? 'تم اعتماد الفاتورة وأصبحت مستحقة الدفع.' : 'تم حفظ تعديلات الفاتورة.');
    onClose();
  };
  const sendRequest = async () => {
    setBusy('request');
    // نحفظ السعر/الخصم الأول (لو اتعدلوا) قبل ما يتقفلوا بالطلب
    if (f.price !== inv0.price || f.discount !== inv0.discount || f.note !== (inv0.note ?? '')) {
      const r0 = await db.updatePlanInvoice(inv0.id, f, false);
      if (!r0.ok) { setBusy(null); toast.error(r0.error); return; }
    }
    const q = await installmentsApi.request(inv0.id, instReason.trim(), d1, d2);
    setBusy(null);
    if (!q.ok) { toast.error(q.error); return; }
    toast.success('تم إرسال طلب الدفع على دفعتين للمدير — تبقى الفاتورة هنا في المراجعة حتى صدور القرار.');
    setPayMode('full'); reloadReqs();
  };

  const canApprove = useCan()('inv_approve', 'view');
  const canPrice = useCan()('inv_price', 'view'); // الخادم بيرفض أي حفظ لفاتورة الخطة من غير الصلاحية دي
  const primaryLabel = req?.status === 'approved' ? 'إتمام واعتماد الفاتورة (تقسيط)' : 'حفظ واعتماد الفاتورة';
  return (
    <Modal title={`${isDraft ? 'مراجعة' : 'تعديل'} فاتورة الخطة العلاجية — ${inv0.no}`} onClose={onClose}
      footer={<>
        <Button variant="outline" onClick={onClose} disabled={!!busy}>إلغاء</Button>
        {!locked && canPrice && <Button variant={isDraft ? 'outline' : 'primary'} onClick={() => save(false)} loading={busy === 'save'} disabled={!!busy}>حفظ التعديل</Button>}
        {isDraft && payMode === 'full' && req?.status !== 'pending' && canApprove && canPrice && <Button icon="check" onClick={() => save(true)} loading={busy === 'issue'} disabled={!!busy || incomplete}>{primaryLabel}</Button>}
      </>}>
      <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', marginBottom: 10 }}>
        <StatusBadge label={INVOICE_STATUS[inv0.status].label} tone={INVOICE_STATUS[inv0.status].tone} />
        {instState !== 'none' && instState !== 'review' && <StatusBadge label={INST_STATE[instState].label} tone={INST_STATE[instState].tone} />}
      </div>
      {isDraft && <IncompleteAlert patientId={inv0.patientId} />}
      <dl className="review-list" style={{ marginBottom: 14 }}>
        <div><dt>المريض</dt><dd>{patient?.fullName} · <span className="num">{patient?.fileNo}</span> · <span className="num">{patient?.phone}</span> <CompletenessBadge patient={patient} /></dd></div>
        <div><dt>الخطة العلاجية</dt><dd>{plan ? <button type="button" style={{ border: 0, background: 'none', color: 'var(--brand-700)', cursor: 'pointer', padding: 0, fontWeight: 600 }} onClick={() => openPlan(plan.id)}>{plan.diagnosis} ← عرض التفاصيل</button> : '—'}</dd></div>
        <div><dt>الخدمة</dt><dd>{inv0.serviceName.replace('خطة علاج: ', '')}</dd></div>
        {plan && <div><dt>المدة</dt><dd>{fmtDate(plan.startDate)} ← {plan.endDate ? fmtDate(plan.endDate) : '—'} · <span className="num">{plan.sessionsPerWeek}</span> جلسات/أسبوع</dd></div>}
        <div><dt>أنشأها</dt><dd>{creator?.name ?? '—'}</dd></div>
      </dl>
      <div className="grid-form">
        {plan && <Select id="pi-sessions" label="عدد الجلسات" value={sessOther ? 'other' : String(sessCount)} disabled={locked || !isDraft}
          onChange={(e) => { if (e.target.value === 'other') setSessOther(true); else { setSessOther(false); changeSessions(Number(e.target.value)); } }}
          options={[...Array.from({ length: 12 }, (_, i) => ({ value: String(i + 1), label: `${i + 1} ${i + 1 === 1 ? 'جلسة' : i + 1 === 2 ? 'جلستين' : i + 1 <= 10 ? 'جلسات' : 'جلسة'}` })), { value: 'other', label: 'عدد آخر (اكتب العدد)' }]} />}
        {plan && sessOther && <Input id="pi-sessions-other" label="اكتب عدد الجلسات" type="number" min={1} max={52} value={sessCount} disabled={locked || !isDraft} onChange={(e) => changeSessions(Number(e.target.value))} />}
        <Input id="pi-price" label="سعر الخطة (ج.م)" type="number" min={0} value={f.price} disabled={locked} onChange={(e) => { setPriceTouched(true); setF({ ...f, price: Number(e.target.value) }); }} />
        <Input id="pi-discount" label="الخصم (ج.م)" type="number" min={0} value={f.discount} disabled={locked} onChange={(e) => setF({ ...f, discount: Number(e.target.value) })} />
      </div>
      {locked && <p className="muted-sm" style={{ marginTop: -6, marginBottom: 10 }}><Icon name="lock" size={13} /> السعر والخصم مُقفلان بعد طلب التقسيط.</p>}
      <div className="field">
        <label htmlFor="pi-note">ملاحظة على الفاتورة</label>
        <textarea id="pi-note" className="input" rows={2} value={f.note} onChange={(e) => setF({ ...f, note: e.target.value })} />
      </div>
      <div className="review-total">
        <div><div style={{ fontWeight: 700 }}>الإجمالي بعد الخصم</div>{plan && <div className="muted" style={{ fontSize: 12.5 }}>≈ <span className="num">{money(Math.round(perSession))}</span> للجلسة ({sessCount} جلسات)</div>}</div>
        <strong className="num" style={{ fontSize: 22, color: 'var(--brand-700)' }}>{money(total)}</strong>
      </div>
      {isDraft && payMode === 'full' && can('payments', 'create') && (
        <div style={{ marginTop: 12, maxWidth: 320 }}>
          <Select id="pi-method" label="طريقة الدفع (عند «حفظ واعتماد الفاتورة»)" value={payMethod} onChange={(e) => setPayMethod(e.target.value as PaymentMethod)} options={PAYMENT_METHOD_OPTIONS} />
          <p className="muted-sm" style={{ marginTop: 4 }}>الاعتماد يسجّل الفاتورة مدفوعة بالكامل بهذه الطريقة.</p>
        </div>
      )}
      {autoPrice && <p className="muted-sm" style={{ marginTop: 6 }}>السعر محسوب تلقائيًا: {autoPrice.note} — يمكنك تعديله.</p>}
      {plan && <PlanSessionBooking plan={plan} canBook={can('appointments', 'create') || can('booking', 'create')}
        ensurePriced={async () => { if (sessCount !== plan.totalSessions) { const rs = await db.updatePlanSessions(plan.id, sessCount); if (!rs.ok) { toast.error(rs.error); return false; } } if ((plan.price ?? 0) > 0) return true; if (f.price <= 0) { toast.error('حدد سعر الخطة أولًا.'); return false; } const r = await db.updatePlanInvoice(inv0.id, f, false); if (!r.ok) { toast.error(r.error); return false; } return true; }} />}

      {/* ---------- التقسيط ---------- */}
      {req?.status === 'pending' && (
        <div className="alert alert-warn" style={{ marginTop: 12 }}><Icon name="clock" size={17} /><div>
          طلب الدفع على دفعتين <strong>بانتظار موافقة المدير</strong> — أرسله {empName(req.requestedBy)} في {fmtDateTime(req.requestedAt)}. ما يمكن إتمام الفاتورة أو تسجيل أي دفعة حتى يتم القرار.
        </div></div>
      )}
      {req?.status === 'approved' && (
        <div className="alert alert-ok" style={{ marginTop: 12 }}><Icon name="checkCircle" size={17} /><div>
          <strong>تمت الموافقة على التقسيط</strong> بواسطة {empName(req.decidedBy)} — {req.decidedAt ? fmtDateTime(req.decidedAt) : ''}.
          {isDraft ? ' الفاتورة للحين في المراجعة: يراجعها المحاسب ويُتمّها، وبعدها تُحصَّل على دفعتين.' : ''}
        </div></div>
      )}
      {req?.status === 'rejected' && (
        <div className="alert alert-danger" style={{ marginTop: 12 }}><Icon name="alert" size={17} /><div>
          تم رفض التقسيط بواسطة {empName(req.decidedBy)}{req.rejectReason ? ` — السبب: «${req.rejectReason}»` : ''}. الدفع الكامل فقط.
        </div></div>
      )}
      {req && req.status !== 'rejected' && <div style={{ marginTop: 12 }}><InstallmentSummary invoice={inv0} req={req} /></div>}

      {isDraft && !req && canRequestInst && (
        <div className="field" style={{ marginTop: 14 }}>
          <label>طريقة الدفع</label>
          <div className="seg">
            <button type="button" className={`seg__btn ${payMode === 'full' ? 'active' : ''}`} onClick={() => setPayMode('full')}>دفع كامل</button>
            <button type="button" className={`seg__btn ${payMode === 'installments' ? 'active' : ''}`} onClick={() => setPayMode('installments')}>طلب الدفع على دفعتين</button>
          </div>
        </div>
      )}
      {isDraft && !req && payMode === 'installments' && (
        <div className="form-section" style={{ marginTop: 6 }}>
          <div className="alert alert-info"><Icon name="shield" size={17} /><div>
            سيُرسل الطلب إلى المدير وستبقى الفاتورة هنا في المراجعة. بعد الموافقة يُتمّ المحاسب الفاتورة ويحصّل: الدفعة الأولى <strong className="num">{money(half)}</strong> والثانية <strong className="num">{money(Math.round((total - half) * 100) / 100)}</strong>.
          </div></div>
          <div className="grid-form">
            <Input id="pi-d1" label="استحقاق الدفعة الأولى" type="date" min={today} value={d1} onChange={(e) => setD1(e.target.value)} />
            <Input id="pi-d2" label="استحقاق الدفعة الثانية" type="date" min={d1} value={d2} onChange={(e) => setD2(e.target.value)} />
          </div>
          <div className="field">
            <label htmlFor="pi-inst-reason">سبب طلب التقسيط (اختياري)</label>
            <textarea id="pi-inst-reason" className="input" rows={2} value={instReason} onChange={(e) => setInstReason(e.target.value)} />
          </div>
          <Button icon="shield" onClick={sendRequest} loading={busy === 'request'} disabled={!!busy || total <= 0 || !d1 || !d2 || d2 <= d1}>إرسال طلب التقسيط للمدير</Button>
        </div>
      )}
      {isDraft && <p className="muted" style={{ fontSize: 12.5, marginTop: 10 }}>ما يمكن تسجيل دفعات على الفاتورة قبل إتمامها واعتمادها.</p>}
    </Modal>
  );
}
