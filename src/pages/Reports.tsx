import { useEffect, useState, type ReactNode } from 'react';
import { createPortal } from 'react-dom';
import { db } from '../data/db';
import { useDbVersion, useLoading } from '../hooks/useDb';
import { Button, EmptyState, Skeleton, StatusBadge, Modal } from '../components/ui';
import { IconAction, RowActions, useCan } from '../components/common';
import { APPT_STATUS, PAYMENT_METHOD_LABEL, fmtDate, fmtDateTime, fmtTime, money, riyadhTodayYmd, ymdLocal, addDaysYmd } from '../utils/format';
import { Icon } from '../utils/icons';
import type { Appointment } from '../types';
// التقرير المطبوع بيتنقل لآخر body — غير كده الطباعة بتطلع صفحة بيضا (المحتوى جوه حاوية فيها scroll)
const PrintPortal = ({ children }: { children: ReactNode }) => createPortal(<div className="print-portal">{children}</div>, document.body);

type PeriodType = 'day' | 'week' | 'month' | 'year';
type TabId = 'daily' | 'weekly' | 'monthly' | 'yearly' | 'completed' | 'cancelled' | 'scheduled';

const TABS: { id: TabId; label: string; period?: PeriodType; status?: 'completed' | 'cancelled' | 'scheduled' }[] = [
  { id: 'daily', label: 'التقرير اليومي', period: 'day' },
  { id: 'weekly', label: 'التقرير الأسبوعي', period: 'week' },
  { id: 'monthly', label: 'التقرير الشهري', period: 'month' },
  { id: 'yearly', label: 'التقرير السنوي', period: 'year' },
  { id: 'completed', label: 'المكتملة', status: 'completed' },
  { id: 'cancelled', label: 'الملغاة', status: 'cancelled' },
  { id: 'scheduled', label: 'المجدولة', status: 'scheduled' },
];
const PDF_LABEL: Record<TabId, string> = {
  daily: 'تصدير التقرير اليومي PDF', weekly: 'تصدير التقرير الأسبوعي PDF', monthly: 'تصدير التقرير الشهري PDF', yearly: 'تصدير التقرير السنوي PDF',
  completed: 'تصدير تقرير الزيارات المكتملة PDF', cancelled: 'تصدير تقرير الزيارات الملغاة PDF', scheduled: 'تصدير تقرير الزيارات المجدولة PDF',
};
const SCHEDULED_STATUSES = new Set(['new', 'confirmed', 'rescheduled']);
const PERIOD_TYPE_LABEL: Record<PeriodType, string> = { day: 'يوم', week: 'أسبوع', month: 'شهر', year: 'سنة' };

function periodRange(type: PeriodType, anchor: string): [string, string] {
  const d = new Date(anchor + 'T00:00:00');
  if (type === 'day') return [anchor, anchor];
  if (type === 'week') { const start = addDaysYmd(anchor, -d.getDay()); return [start, addDaysYmd(start, 6)]; }
  if (type === 'month') {
    const y = d.getFullYear(), m = d.getMonth(); const last = new Date(y, m + 1, 0).getDate();
    return [`${y}-${String(m + 1).padStart(2, '0')}-01`, `${y}-${String(m + 1).padStart(2, '0')}-${String(last).padStart(2, '0')}`];
  }
  const y = d.getFullYear(); return [`${y}-01-01`, `${y}-12-31`];
}
function shiftAnchor(type: PeriodType, anchor: string, dir: 1 | -1): string {
  const d = new Date(anchor + 'T00:00:00');
  if (type === 'day') d.setDate(d.getDate() + dir);
  else if (type === 'week') d.setDate(d.getDate() + dir * 7);
  else if (type === 'month') d.setMonth(d.getMonth() + dir);
  else d.setFullYear(d.getFullYear() + dir);
  return ymdLocal(d);
}
function periodLabel(type: PeriodType, from: string, to: string): string {
  if (type === 'day') return fmtDate(from);
  if (type === 'week') return `${fmtDate(from)} — ${fmtDate(to)}`;
  if (type === 'month') return new Date(from + 'T00:00:00').toLocaleDateString('ar-SA-u-ca-gregory-nu-latn', { month: 'long', year: 'numeric' });
  return new Date(from + 'T00:00:00').getFullYear().toString();
}

function visitInfo(a: Appointment) {
  const patient = db.patient(a.patientId);
  const service = db.service(a.serviceId);
  const therapist = db.therapist(a.therapistId);
  const invoice = db.invoices().find((i) => i.appointmentId === a.id);
  const payments = invoice ? db.paymentsForInvoice(invoice.id) : [];
  const methods = Array.from(new Set(payments.map((p) => PAYMENT_METHOD_LABEL[p.method]))).join('، ');
  return { patient, service, therapist, invoice, methods };
}

function VisitFields({ a, fin }: { a: Appointment; fin: boolean }) {
  const { patient, service, therapist, invoice, methods } = visitInfo(a);
  const st = APPT_STATUS[a.status];
  return (
    <dl className="review-list">
      <div><dt>رقم الزيارة</dt><dd className="num">{a.no}</dd></div>
      <div><dt>اسم المريض</dt><dd>{patient?.fullName ?? '—'}</dd></div>
      <div><dt>رقم الهاتف</dt><dd className="num">{patient?.phone ?? '—'}</dd></div>
      <div><dt>الطبيب / المنفذ</dt><dd>{therapist?.name ?? '—'}</dd></div>
      <div><dt>الخدمة</dt><dd>{service?.name ?? '—'}</dd></div>
      <div><dt>التاريخ</dt><dd>{fmtDate(a.date)}</dd></div>
      <div><dt>الوقت</dt><dd className="num">{fmtTime(a.time)}</dd></div>
      <div><dt>الحالة</dt><dd>{st.label}</dd></div>
      {fin && <div><dt>السعر</dt><dd className="num">{money(a.price)}</dd></div>}
      {fin && invoice && <div><dt>المبلغ المدفوع</dt><dd className="num">{money(invoice.paid)}</dd></div>}
      {fin && invoice && <div><dt>المبلغ المتبقي</dt><dd className="num">{money(invoice.remaining)}</dd></div>}
      {fin && methods && <div><dt>طريقة الدفع</dt><dd>{methods}</dd></div>}
      {a.notes && <div><dt>الملاحظات</dt><dd>{a.notes}</dd></div>}
      {a.cancelReason && <div><dt>سبب الإلغاء</dt><dd>{a.cancelReason}</dd></div>}
    </dl>
  );
}

function VisitModal({ a, fin, autoPrint, onClose }: { a: Appointment; fin: boolean; autoPrint?: boolean; onClose: () => void }) {
  const center = db.center();
  useEffect(() => {
    if (!autoPrint) return;
    const t = setTimeout(() => window.print(), 150);
    return () => clearTimeout(t);
  }, [autoPrint]);
  return (
    <Modal title={`تفاصيل الزيارة ${a.no}`} onClose={onClose} footer={
      <><Button variant="outline" onClick={onClose}>إغلاق</Button><Button icon="print" onClick={() => window.print()}>طباعة / PDF</Button></>
    }>
      <div className="screen-only"><VisitFields a={a} fin={fin} /></div>
      <PrintPortal>
        <div className="rp-print-head"><h1>{center.name}</h1><p>تفاصيل الزيارة رقم {a.no}</p><p>تاريخ الإصدار: {fmtDateTime(Date.now())}</p></div>
        <VisitFields a={a} fin={fin} />
      </PrintPortal>
    </Modal>
  );
}


type Agg = { n: number; done: number; canc: number; paid: number };
const emptyAgg = (): Agg => ({ n: 0, done: 0, canc: 0, paid: 0 });
const MONTHS = ['يناير', 'فبراير', 'مارس', 'أبريل', 'مايو', 'يونيو', 'يوليو', 'أغسطس', 'سبتمبر', 'أكتوبر', 'نوفمبر', 'ديسمبر'];
const pct = (x: number, t: number) => (t ? Math.round((x / t) * 100) : 0);
const LIST_MAX = 38;

// ورقة التقرير المطبوعة: صفحة 1 ملخص + صفحة 2 تفاصيل مختصرة — بحد أقصى ورقتين A4
function SummarySheet({ visits, fin, title, label, period }: { visits: Appointment[]; fin: boolean; title: string; label: string; period: PeriodType }) {
  const center = db.center();
  const total = emptyAgg();
  let remaining = 0, expected = 0;
  const bySvc = new Map<string, Agg>(), byDoc = new Map<string, Agg>(), byBucket = new Map<string, Agg>();
  const byStatus = new Map<string, number>(), byMethod = new Map<string, number>();
  const add = (e: Agg, a: Appointment, paid: number) => { e.n++; if (a.status === 'completed') e.done++; if (a.status === 'cancelled') e.canc++; e.paid += paid; };
  const bump = (m: Map<string, Agg>, k: string, a: Appointment, paid: number) => { const e = m.get(k) ?? emptyAgg(); add(e, a, paid); m.set(k, e); };
  for (const a of visits) {
    const inv = db.invoices().find((i) => i.appointmentId === a.id && i.status !== 'cancelled');
    const live = a.status !== 'cancelled';
    const paid = inv && live ? inv.paid : 0;
    if (live) { remaining += inv ? inv.remaining : 0; expected += a.price; }
    if (inv && live) for (const p of db.paymentsForInvoice(inv.id)) byMethod.set(p.method, (byMethod.get(p.method) ?? 0) + p.amount);
    add(total, a, paid);
    bump(bySvc, db.service(a.serviceId)?.name ?? '—', a, paid);
    bump(byDoc, db.therapist(a.therapistId)?.name ?? '—', a, paid);
    bump(byBucket, period === 'year' ? a.date.slice(0, 7) : a.date, a, paid);
    byStatus.set(a.status, (byStatus.get(a.status) ?? 0) + 1);
  }
  const sched = visits.filter((a) => SCHEDULED_STATUSES.has(a.status)).length;
  const top = (m: Map<string, Agg>) => Array.from(m.entries()).sort((x, y) => y[1].n - x[1].n).slice(0, 8);
  const buckets = Array.from(byBucket.entries()).sort((x, y) => (x[0] < y[0] ? -1 : 1));
  const bucketLabel = (k: string) => (period === 'year' ? `${MONTHS[Number(k.slice(5, 7)) - 1]} ${k.slice(0, 4)}` : fmtDate(k));
  const showList = period === 'day' || (period === 'week' && visits.length <= LIST_MAX);
  const page2 = visits.length > 0 && (showList || buckets.length > 1);

  const RankTable = ({ head, rows }: { head: string; rows: [string, Agg][] }) => (
    <table className="rp-mini">
      <thead><tr><th>{head}</th><th>الزيارات</th><th>مكتملة</th>{fin && <th>المحصّل</th>}<th style={{ width: '28%' }}>النسبة</th></tr></thead>
      <tbody>{rows.length === 0 ? <tr><td colSpan={5} className="rp-empty">ما فيه بيانات</td></tr> : rows.map(([k, v]) => (
        <tr key={k}><td>{k}</td><td className="num">{v.n}</td><td className="num">{v.done}</td>{fin && <td className="num">{money(v.paid)}</td>}
          <td><div className="rp-bar"><i style={{ width: `${pct(v.n, total.n)}%` }} /><span className="num">{pct(v.n, total.n)}%</span></div></td></tr>
      ))}</tbody>
    </table>
  );
  const Head = ({ sub }: { sub?: string }) => (
    <div className="rp-head">
      <div className="rp-head__brand">
        <img src={`${import.meta.env.BASE_URL}brand/logo.svg`} alt="" width={44} height={44} style={{ width: 44, height: 44, objectFit: "contain" }} />
        <div><strong>{center.name}</strong><span>{[center.city && center.district ? `${center.city} – ${center.district}` : center.city, center.phone].filter(Boolean).join(' · ')}</span></div>
      </div>
      <div className="rp-head__title"><strong>{title}{sub ? ` — ${sub}` : ''}</strong><span>الفترة: {label}</span><span>تاريخ الإصدار: {fmtDateTime(Date.now())}</span></div>
    </div>
  );
  const Sign = () => <div className="rp-sign"><span>اعتماد المسؤول: ................................</span><span>التوقيع: ................................</span></div>;

  return (
    <div className="rp-doc">
      <section className="rp-page">
        <Head />
        <h3 className="rp-h">المؤشرات الرئيسية</h3>
        <div className="rp-kpis">
          <div><b className="num">{total.n}</b><span>إجمالي الزيارات</span></div>
          <div className="ok"><b className="num">{total.done}</b><span>مكتملة · {pct(total.done, total.n)}%</span></div>
          <div className="info"><b className="num">{sched}</b><span>مجدولة</span></div>
          <div className="bad"><b className="num">{total.canc}</b><span>ملغاة · {pct(total.canc, total.n)}%</span></div>
        </div>
        {fin && (<>
          <h3 className="rp-h">الملخص المالي</h3>
          <table className="rp-mini rp-fin"><tbody>
            <tr><th>قيمة الزيارات</th><td className="num">{money(expected)}</td><th>المحصّل</th><td className="num">{money(total.paid)}</td><th>المتبقي</th><td className="num">{money(remaining)}</td></tr>
            <tr><th>طرق الدفع</th><td colSpan={5}>{byMethod.size ? Array.from(byMethod.entries()).map(([m, v]) => `${PAYMENT_METHOD_LABEL[m] ?? m}: ${money(v)}`).join('   ·   ') : '—'}</td></tr>
          </tbody></table>
        </>)}
        <h3 className="rp-h">حسب الخدمة</h3>
        <RankTable head="الخدمة" rows={top(bySvc)} />
        <h3 className="rp-h">حسب الطبيب</h3>
        <RankTable head="الطبيب" rows={top(byDoc)} />
        <h3 className="rp-h">حالات الزيارات</h3>
        <div className="rp-status">{visits.length === 0 ? <span className="rp-empty">ما فيه زيارات في هذي الفترة</span> : Array.from(byStatus.entries()).sort((x, y) => y[1] - x[1]).map(([st, n]) => (
          <span key={st}><b className="num">{n}</b> {APPT_STATUS[st as Appointment['status']]?.label ?? st}</span>
        ))}</div>
        {!page2 && <Sign />}
      </section>

      {page2 && (
        <section className="rp-page rp-page--2">
          <Head sub="التفاصيل" />
          {showList ? (<>
            <h3 className="rp-h">قائمة الزيارات{visits.length > LIST_MAX ? ` (أول ${LIST_MAX} من ${visits.length})` : ''}</h3>
            <table className="rp-mini rp-list"><thead><tr>{period !== 'day' && <th>التاريخ</th>}<th>الوقت</th><th>المريض</th><th>الخدمة</th><th>الطبيب</th><th>الحالة</th>{fin && <th>السعر</th>}</tr></thead>
              <tbody>{visits.slice(0, LIST_MAX).map((a) => <tr key={a.id}>{period !== 'day' && <td>{fmtDate(a.date)}</td>}<td className="num">{fmtTime(a.time)}</td><td>{db.patient(a.patientId)?.fullName ?? '—'}</td><td>{db.service(a.serviceId)?.name ?? '—'}</td><td>{db.therapist(a.therapistId)?.name ?? '—'}</td><td>{APPT_STATUS[a.status].label}</td>{fin && <td className="num">{money(a.price)}</td>}</tr>)}</tbody></table>
          </>) : (<>
            <h3 className="rp-h">{period === 'year' ? 'التوزيع الشهري' : 'التوزيع اليومي'}</h3>
            <table className="rp-mini rp-list"><thead><tr><th>{period === 'year' ? 'الشهر' : 'اليوم'}</th><th>الزيارات</th><th>مكتملة</th><th>ملغاة</th>{fin && <th>المحصّل</th>}</tr></thead>
              <tbody>{buckets.map(([k, v]) => <tr key={k}><td>{bucketLabel(k)}</td><td className="num">{v.n}</td><td className="num">{v.done}</td><td className="num">{v.canc}</td>{fin && <td className="num">{money(v.paid)}</td>}</tr>)}
                <tr className="rp-total"><td>الإجمالي</td><td className="num">{total.n}</td><td className="num">{total.done}</td><td className="num">{total.canc}</td>{fin && <td className="num">{money(total.paid)}</td>}</tr></tbody></table>
          </>)}
          <Sign />
        </section>
      )}
    </div>
  );
}

export default function Reports() {
  useDbVersion();
  const loading = useLoading();
  const can = useCan();
  const fin = can('financial', 'view');
  const [tab, setTab] = useState<TabId>('daily');
  const [periodType, setPeriodType] = useState<PeriodType>('day');
  const [anchor, setAnchor] = useState(riyadhTodayYmd());
  const [openVisit, setOpenVisit] = useState<{ a: Appointment; autoPrint?: boolean } | null>(null);

  const activeTab = TABS.find((t) => t.id === tab)!;
  const [from, to] = periodRange(periodType, anchor);
  const visits = db.appointmentsInRange(from, to)
    .filter((a) => !activeTab.status || (activeTab.status === 'scheduled' ? SCHEDULED_STATUSES.has(a.status) : a.status === activeTab.status))
    .sort((a, b) => (a.date + a.time < b.date + b.time ? -1 : 1));

  const selectTab = (t: typeof TABS[number]) => { setTab(t.id); if (t.period) setPeriodType(t.period); };

  return (
    <div className="page">
      <div className="page-head">
        <div><h1>التقارير</h1><p>تقارير الزيارات — يومي، أسبوعي، شهري، سنوي، وحسب الحالة.</p></div>
        <Button variant="outline" icon="print" onClick={() => window.print()}>{PDF_LABEL[tab]}</Button>
      </div>

      <div className="card" style={{ marginBottom: 18 }}>
        <div className="tabs" style={{ overflowX: 'auto' }}>{TABS.map((t) => <button key={t.id} className={`tab ${tab === t.id ? 'active' : ''}`} onClick={() => selectTab(t)}>{t.label}</button>)}</div>
        <div className="card__body row-between" style={{ flexWrap: 'wrap', gap: 12 }}>
          <div className="date-nav">
            <Button variant="outline" size="sm" onClick={() => setAnchor((a) => shiftAnchor(periodType, a, -1))} aria-label={`${PERIOD_TYPE_LABEL[periodType]} سابق`}><Icon name="chevron" size={15} /></Button>
            <strong style={{ minWidth: 'min(160px, 40vw)', textAlign: 'center' }}>{periodLabel(periodType, from, to)}</strong>
            <Button variant="outline" size="sm" onClick={() => setAnchor((a) => shiftAnchor(periodType, a, 1))} aria-label={`${PERIOD_TYPE_LABEL[periodType]} تالٍ`}><Icon name="chevronLeft" size={15} /></Button>
            <Button variant="ghost" size="sm" onClick={() => setAnchor(riyadhTodayYmd())}>اليوم</Button>
          </div>
          {activeTab.status && (
            <div className="seg">
              {(['day', 'week', 'month', 'year'] as PeriodType[]).map((p) => (
                <button key={p} type="button" className={`seg__btn ${periodType === p ? 'active' : ''}`} onClick={() => setPeriodType(p)}>{PERIOD_TYPE_LABEL[p]}</button>
              ))}
            </div>
          )}
          <span className="muted" style={{ fontSize: 13 }}>{visits.length} زيارة</span>
        </div>
      </div>

      <div className="screen-only">
        {loading ? <Skeleton h={220} /> : visits.length === 0 ? (
          <div className="card"><div className="card__body"><EmptyState icon="calendar" title="ما فيه زيارات في هذي الفترة" /></div></div>
        ) : (
          <div className="card"><div className="card__body">
            <div className="table-wrap"><table className="table">
              <thead><tr><th>التاريخ</th><th>الوقت</th><th>المريض</th><th>الخدمة</th><th>الطبيب/المنفذ</th><th>الحالة</th>{fin && <th>السعر</th>}<th className="actions">الإجراءات</th></tr></thead>
              <tbody>{visits.map((a) => {
                const { patient, service, therapist } = visitInfo(a);
                const st = APPT_STATUS[a.status];
                return (
                  <tr key={a.id}>
                    <td>{fmtDate(a.date)}</td><td className="num">{fmtTime(a.time)}</td>
                    <td>{patient?.fullName ?? '—'}</td><td>{service?.name ?? '—'}</td><td>{therapist?.name ?? '—'}</td>
                    <td><StatusBadge label={st.label} tone={st.tone} /></td>
                    {fin && <td className="num">{money(a.price)}</td>}
                    <td className="actions">
                      <RowActions>
                        <IconAction icon="doc" label="عرض التفاصيل" onClick={() => setOpenVisit({ a })} />
                        <IconAction icon="print" label="طباعة / PDF" onClick={() => setOpenVisit({ a, autoPrint: true })} />
                      </RowActions>
                    </td>
                  </tr>
                );
              })}</tbody>
            </table></div>
          </div></div>
        )}
      </div>

      {!openVisit && (
        <PrintPortal>
          <SummarySheet visits={visits} fin={fin} title={TABS.find((t) => t.id === tab)!.label} label={periodLabel(periodType, from, to)} period={periodType} />
        </PrintPortal>
      )}

      {openVisit && <VisitModal a={openVisit.a} fin={fin} autoPrint={openVisit.autoPrint} onClose={() => setOpenVisit(null)} />}
    </div>
  );
}
