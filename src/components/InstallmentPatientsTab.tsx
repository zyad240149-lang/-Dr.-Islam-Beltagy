// تبويب «المرضى المقسّطين» في صفحة الفواتير والمدفوعات: كل فاتورة (باقة أو خطة علاجية) عليها طلب دفع على دفعتين،
// مع الدفعة الأولى والتانية (المبلغ/الاستحقاق/الحالة) والمدفوع والمتبقي.
import { patientMatches } from '../utils/phoneUtils';
import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { db } from '../data/db';
import { useInstallmentRequests } from './PackagePayment';
import { INST_ROW, installmentRows, REQ_STATUS, type InstallmentRequest } from '../data/installments';
import { useDetails } from './DetailsHost';
import { EmptyState, Input, Select, Skeleton, StatusBadge } from './ui';
import { FilterBar, IconAction, RowActions, useCan } from './common';
import { Button } from './ui';
import { StatCard } from './StatCard';
import { fmtDate, money } from '../utils/format';

type View = 'open' | 'overdue' | 'done' | 'all';

export default function InstallmentPatientsTab({ onOpenInvoice, onReviewPlanInvoice }: { onOpenInvoice: (id: string) => void; onReviewPlanInvoice: (id: string) => void }) {
  const can = useCan();
  const { rows, error } = useInstallmentRequests();
  const { openPlan } = useDetails();
  const navigate = useNavigate();
  const [q, setQ] = useState('');
  const [view, setView] = useState<View>('open');
  if (rows === null) return <div style={{ padding: 22 }}><Skeleton h={70} /><Skeleton h={220} style={{ marginTop: 12 }} /></div>;
  if (error) return <div style={{ padding: 22 }}><EmptyState icon="alert" title="تعذّر تحميل طلبات التقسيط" text={error} /></div>;

  const items = rows
    .filter((r: InstallmentRequest) => r.status !== 'cancelled')
    .map((r) => {
      const inv = db.invoice(r.invoiceId);
      const patient = db.patient(r.patientId);
      const inst = inv ? installmentRows(inv, r) : [];
      const done = !!inv && (inv.status === 'paid' || inv.remaining <= 0);
      const overdue = inst.some((x) => x.state === 'overdue');
      const st = r.planId && db.plan(r.planId) ? db.planStats(r.planId) : null;
      return { r, inv, patient, inst, done, overdue, st };
    })
    .filter((x) => x.inv);

  const term = q.trim().toLowerCase();
  const shown = items.filter((x) => {
    if (view === 'open' && (x.done || x.r.status === 'rejected')) return false;
    if (view === 'overdue' && !x.overdue) return false;
    if (view === 'done' && !x.done) return false;
    if (!term) return true;
    return patientMatches(x.patient, term) || (x.inv?.no ?? '').toLowerCase().includes(term);
  }).sort((a, b) => b.r.requestedAt - a.r.requestedAt);

  const open = items.filter((x) => !x.done && x.r.status !== 'rejected');
  const remaining = open.reduce((s, x) => s + (x.inv?.remaining ?? 0), 0);
  const overdueCount = items.filter((x) => x.overdue).length;

  return (
    <>
      <div className="kpi-grid" style={{ padding: '18px 22px 0' }}>
        <StatCard icon="users" tone="brand" value={new Set(open.map((x) => x.r.patientId)).size} label="مرضى بتقسيط جاري" />
        <StatCard icon="clock" tone="warn" value={open.filter((x) => x.r.status === 'pending').length} label="بانتظار موافقة المدير" />
        <StatCard icon="alert" tone="danger" value={overdueCount} label="دفعات متأخرة" />
        <StatCard icon="wallet" tone="info" value={money(remaining)} label="المتبقي على المقسّطين" />
      </div>
      <FilterBar>
        <Input id="inst-q" label="بحث" icon="search" placeholder="اسم المريض أو الجوال أو رقم الملف أو الهوية أو الفاتورة" value={q} onChange={(e) => setQ(e.target.value)} />
        <Select id="inst-view" label="العرض" value={view} onChange={(e) => setView(e.target.value as View)}
          options={[{ value: 'open', label: 'التقسيط الجاري' }, { value: 'overdue', label: 'عليهم دفعات متأخرة' }, { value: 'done', label: 'سددوا بالكامل' }, { value: 'all', label: 'الكل' }]} />
      </FilterBar>
      {shown.length === 0 ? <EmptyState icon="wallet" title="ما فيه مرضى مقسّطين" text="أي فاتورة باقة أو خطة علاجية عليها طلب دفع على دفعتين ستظهر هنا." /> : (
        <div className="table-wrap"><table className="table">
          <thead><tr><th>المريض</th><th>الفاتورة</th><th>الإجمالي</th><th>الدفعة الأولى</th><th>الدفعة الثانية</th><th>المدفوع</th><th>المتبقي</th><th>الجلسات</th><th>الطلب</th><th className="actions"></th></tr></thead>
          <tbody>{shown.map(({ r, inv, patient, inst, st }) => {
            const rs = REQ_STATUS[r.status];
            const sessionsDone = !!st && st.total > 0 && st.remaining === 0;
            const isDraft = inv!.status === 'draft';
            // الضغط على الصف = يفتح الخطة في «خطط العلاج»؛ الأزرار جوه الصف ليها شغلها لوحدها
            const goPlan = () => { if (r.planId) navigate(`/plans?plan=${r.planId}`); else navigate(`/patients/${r.patientId}`); };
            return (
              <tr key={r.id} className={`row-link ${sessionsDone ? 'row-ready' : ''}`} onClick={goPlan} title={r.planId ? 'فتح الخطة في «خطط العلاج»' : 'فتح ملف المريض'}>
                <td><strong>{patient?.fullName ?? '—'}</strong><div className="muted-sm"><span className="num">{patient?.fileNo}</span> · <span className="num">{patient?.phone}</span></div></td>
                <td className="num">{inv!.no}<div className="muted-sm">{r.planId ? 'خطة علاجية' : 'باقة'}</div></td>
                <td className="num">{money(r.total)}</td>
                {inst.map((x) => (
                  <td key={x.no}>
                    <div className="num">{money(x.amount)}</div>
                    <div className="muted-sm">{x.dueDate ? fmtDate(x.dueDate) : '—'}</div>
                    <StatusBadge label={INST_ROW[x.state].label} tone={INST_ROW[x.state].tone} />
                  </td>
                ))}
                <td className="num" style={{ color: 'var(--ok)' }}>{money(inv!.paid)}</td>
                <td className="num" style={{ color: inv!.remaining > 0 ? 'var(--warn)' : undefined }}>{money(inv!.remaining)}</td>
                <td>{st ? <><span className="num">{st.completed} / {st.total}</span>{sessionsDone && <div><StatusBadge label="اكتملت الجلسات" tone="ok" /></div>}</> : '—'}</td>
                <td><StatusBadge label={rs.label} tone={rs.tone} /></td>
                <td className="actions" onClick={(e) => e.stopPropagation()}><RowActions>
                  {isDraft && r.planId && can('invoices', 'edit')
                    ? <Button size="sm" variant={sessionsDone ? 'primary' : 'outline'} icon="receipt" onClick={() => onReviewPlanInvoice(inv!.id)}>{sessionsDone ? 'إصدار الفاتورة' : 'مراجعة وتعديل'}</Button>
                    : <Button size="sm" variant={sessionsDone ? 'primary' : 'outline'} icon="receipt" onClick={() => onOpenInvoice(inv!.id)}>{sessionsDone ? 'إصدار الفاتورة' : 'الفاتورة'}</Button>}
                  {r.planId && <IconAction icon="eye" label="تفاصيل الخطة والدفعات" onClick={() => openPlan(r.planId!)} />}
                  <IconAction icon="user" label="ملف المريض" onClick={() => navigate(`/patients/${r.patientId}`)} />
                </RowActions></td>
              </tr>
            );
          })}</tbody>
        </table></div>
      )}
    </>
  );
}
