import { patientMatches } from '../utils/phoneUtils';
// «طلبات تقسيط الباقات» — المدير يوافق/يرفض طلبات الدفع على دفعتين لباقات 4/6 جلسات، ويشوف سجل القرارات.
// المحاسب يشوف طلباته وحالتها بس (الموافقة محتاجة صلاحية installments/edit، والخادم بيمنع الموافقة على طلبك إنت).
import { useState } from 'react';
import { db } from '../data/db';
import { installmentsApi, empName, instStateOf, INST_STATE, payStateOf, PAY_STATE, REQ_STATUS, type InstallmentRequest, type InstallmentStatus } from '../data/installments';
import { useDetails } from '../components/DetailsHost';
import { useInstallmentRequests } from '../components/PackagePayment';
import { Button, EmptyState, Input, Modal, Select, Skeleton, StatusBadge } from '../components/ui';
import { FilterBar, useCan } from '../components/common';
import { StatCard } from '../components/StatCard';
import { Icon } from '../utils/icons';
import { useToast } from '../hooks/useToast';
import { useAuth } from '../services/auth';
import { useDbVersion } from '../hooks/useDb';
import { fmtDate, fmtDateTime, money } from '../utils/format';

function DecideModal({ req, approve, onClose, onDone }: { req: InstallmentRequest; approve: boolean; onClose: () => void; onDone: () => void }) {
  const toast = useToast();
  const [reason, setReason] = useState('');
  const [busy, setBusy] = useState(false);
  const p = db.patient(req.patientId);
  const pkg = db.raw().packages.find((x) => x.id === req.packageId);
  const submit = async () => {
    setBusy(true);
    const r = await installmentsApi.decide(req.id, approve, reason.trim());
    setBusy(false);
    if (!r.ok) { toast.error(r.error); return; }
    toast.success(approve ? 'تمت الموافقة — فُتح خيار الدفع على دفعتين للمحاسب لهذه الفاتورة.' : 'تم رفض الطلب.');
    onDone(); onClose();
  };
  return (
    <Modal title={approve ? 'الموافقة على الدفع على دفعتين' : 'رفض الدفع على دفعتين'} onClose={onClose} footer={
      <><Button variant="outline" onClick={onClose} disabled={busy}>رجوع</Button>
        <Button variant={approve ? 'primary' : 'danger'} icon={approve ? 'check' : 'close'} onClick={submit} loading={busy}>{approve ? 'تأكيد الموافقة' : 'تأكيد الرفض'}</Button></>
    }>
      <dl className="review-list" style={{ marginBottom: 14 }}>
        <div><dt>المريض</dt><dd>{p?.fullName} ({p?.fileNo})</dd></div>
        <div><dt>{pkg ? 'الباقة' : 'الخدمة'}</dt><dd>{pkg ? `${pkg.name} — ${pkg.totalSessions} جلسات` : db.invoice(req.invoiceId)?.serviceName}</dd></div>
        <div><dt>إجمالي الباقة</dt><dd className="num">{money(req.total)}</dd></div>
        {req.planId && <div><dt>الخطة العلاجية</dt><dd>{db.plan(req.planId)?.diagnosis ?? '—'}</dd></div>}
        <div><dt>الدفعة الأولى</dt><dd className="num">{money(req.firstAmount)}{req.firstDueDate ? ` — تستحق ${fmtDate(req.firstDueDate)}` : ''}</dd></div>
        <div><dt>الدفعة الثانية</dt><dd className="num">{money(req.secondAmount)}{req.secondDueDate ? ` — تستحق ${fmtDate(req.secondDueDate)}` : ''}</dd></div>
        <div><dt>المحاسب</dt><dd>{empName(req.requestedBy)} — {fmtDateTime(req.requestedAt)}</dd></div>
        {req.reason && <div><dt>سبب الطلب</dt><dd>{req.reason}</dd></div>}
      </dl>
      {!approve && (
        <div className="field">
          <label htmlFor="dc-reason">سبب الرفض (اختياري)</label>
          <textarea id="dc-reason" className="input" rows={2} value={reason} onChange={(e) => setReason(e.target.value)} />
        </div>
      )}
      {approve && <div className="alert alert-info"><Icon name="shield" size={17} /><div>الموافقة تفتح الدفع على دفعتين لهذه الفاتورة فقط (50% + 50%)، والمبالغ ثابتة ما يغيّرها المحاسب.</div></div>}
    </Modal>
  );
}

function DatesModal({ req, onClose, onDone }: { req: InstallmentRequest; onClose: () => void; onDone: () => void }) {
  const toast = useToast();
  const [d1, setD1] = useState(req.firstDueDate ?? '');
  const [d2, setD2] = useState(req.secondDueDate ?? '');
  const [busy, setBusy] = useState(false);
  const submit = async () => {
    setBusy(true);
    const r = await installmentsApi.updateDates(req.id, d1, d2);
    setBusy(false);
    if (!r.ok) { toast.error(r.error); return; }
    toast.success('تم تعديل تواريخ الاستحقاق.'); onDone(); onClose();
  };
  return (
    <Modal title="تعديل تواريخ استحقاق الدفعات" onClose={onClose} footer={<><Button variant="outline" onClick={onClose} disabled={busy}>رجوع</Button><Button icon="check" onClick={submit} loading={busy}>حفظ</Button></>}>
      <p className="muted-sm" style={{ marginBottom: 10 }}>المبالغ ثابتة (50% + 50%) — التعديل على التواريخ فقط ويُسجَّل في سجل النشاط.</p>
      <div className="grid-form">
        <Input id="dt-1" label="استحقاق الدفعة الأولى" type="date" value={d1} onChange={(e) => setD1(e.target.value)} />
        <Input id="dt-2" label="استحقاق الدفعة الثانية" type="date" min={d1} value={d2} onChange={(e) => setD2(e.target.value)} />
      </div>
    </Modal>
  );
}

export default function Installments() {
  useDbVersion();
  const can = useCan();
  const { user } = useAuth();
  const { rows, error, reload } = useInstallmentRequests();
  const [status, setStatus] = useState<'' | InstallmentStatus>('pending');
  const [q, setQ] = useState('');
  const [deciding, setDeciding] = useState<{ req: InstallmentRequest; approve: boolean } | null>(null);
  const [dating, setDating] = useState<InstallmentRequest | null>(null);
  const { openPlan } = useDetails();
  const canDecide = can('installments', 'edit');

  const all = rows ?? [];
  const list = all.filter((r) => {
    const p = db.patient(r.patientId);
    const inv = db.invoice(r.invoiceId);
    const t = q.trim();
    return (!status || r.status === status) && (!t || patientMatches(p, t) || !!inv?.no.includes(t));
  });
  const count = (s: InstallmentStatus) => all.filter((r) => r.status === s).length;

  return (
    <div className="page">
      <div className="page-head">
        <div><h1>طلبات تقسيط الباقات</h1><p>طلبات الدفع على دفعتين (باقات 4/6 جلسات وفواتير الخطط العلاجية) — {canDecide ? 'الموافقة أو الرفض من هنا.' : 'متابعة حالة طلباتك.'}</p></div>
      </div>
      {error && <div className="alert alert-danger"><Icon name="alert" size={17} /><div>{error}</div></div>}
      {rows === null ? <Skeleton h={240} /> : (
        <>
          <div className="kpi-grid">
            <StatCard icon="clock" tone="warn" value={count('pending')} label="بانتظار الموافقة" />
            <StatCard icon="checkCircle" tone="ok" value={count('approved')} label="تمت الموافقة" />
            <StatCard icon="alert" tone="danger" value={count('rejected')} label="مرفوضة" />
          </div>
          <FilterBar>
            <Input id="in-q" icon="search" placeholder="اسم المريض أو الجوال أو رقم الملف أو الهوية أو الفاتورة" value={q} onChange={(e) => setQ(e.target.value)} />
            <Select id="in-status" value={status} onChange={(e) => setStatus(e.target.value as InstallmentStatus | '')}
              options={[{ value: '', label: 'كل الطلبات (سجل الموافقات)' }, ...(['pending', 'approved', 'rejected'] as InstallmentStatus[]).map((s) => ({ value: s, label: REQ_STATUS[s].label }))]} />
          </FilterBar>
          {list.length === 0 ? <div className="card"><div className="card__body"><EmptyState icon="shield" title={status === 'pending' ? 'ما فيه طلبات بانتظار الموافقة' : 'ما فيه طلبات'} /></div></div> : (
            <div className="table-wrap"><table className="table">
              <thead><tr><th>المريض</th><th>الباقة</th><th>الفاتورة</th><th>الإجمالي</th><th>الدفعتين والاستحقاق</th><th>حالة التقسيط</th><th>المحاسب / وقت الطلب</th><th>السبب</th><th>حالة الطلب</th><th>حالة الدفع</th><th>القرار</th><th className="actions"></th></tr></thead>
              <tbody>{list.map((r) => {
                const p = db.patient(r.patientId);
                const pkg = db.raw().packages.find((x) => x.id === r.packageId);
                const inv = db.invoice(r.invoiceId);
                const ps = inv ? PAY_STATE[payStateOf(inv, r)] : null;
                const mine = user?.id === r.requestedBy;
                return (
                  <tr key={r.id}>
                    <td><strong>{p?.fullName ?? '—'}</strong><div className="muted-sm">{p?.fileNo}</div></td>
                    <td>{pkg ? <>{pkg.name}<div className="muted-sm">{pkg.totalSessions} جلسات</div></> : <>{inv?.serviceName}<div>{r.planId ? <button type="button" style={{ border: 0, background: 'none', color: 'var(--brand-700)', cursor: 'pointer', padding: 0, fontSize: 12.5 }} onClick={() => openPlan(r.planId!)}>خطة علاجية ← عرض</button> : <span className="muted-sm">خطة علاجية</span>}</div></>}</td>
                    <td className="num">{inv?.no ?? '—'}</td>
                    <td className="num">{money(r.total)}</td>
                    <td className="num">{money(r.firstAmount)}<div className="muted-sm">{r.firstDueDate ? fmtDate(r.firstDueDate) : '—'}</div>{money(r.secondAmount)}<div className="muted-sm">{r.secondDueDate ? fmtDate(r.secondDueDate) : '—'}</div></td>
                    <td>{inv ? (() => { const s = instStateOf(inv, r); return s === 'none' || s === 'review' ? '—' : <StatusBadge label={INST_STATE[s].label} tone={INST_STATE[s].tone} />; })() : '—'}</td>
                    <td>{empName(r.requestedBy)}<div className="muted-sm">{fmtDateTime(r.requestedAt)}</div></td>
                    <td>{r.reason || '—'}</td>
                    <td><StatusBadge label={REQ_STATUS[r.status].label} tone={REQ_STATUS[r.status].tone} /></td>
                    <td>{ps ? <StatusBadge label={ps.label} tone={ps.tone} /> : '—'}</td>
                    <td>{r.decidedAt ? <>{empName(r.decidedBy)}<div className="muted-sm">{fmtDateTime(r.decidedAt)}</div>{r.rejectReason && <div className="muted-sm">السبب: {r.rejectReason}</div>}</> : '—'}</td>
                    <td className="actions">
                      {r.status === 'approved' && canDecide && inv && inv.remaining > 0 && <Button size="sm" variant="ghost" icon="calendar" onClick={() => setDating(r)}>التواريخ</Button>}
                      {r.status === 'pending' && canDecide && (mine
                        ? <span className="muted-sm">طلبك — يحتاج مديرًا آخر</span>
                        : <div style={{ display: 'flex', gap: 6 }}>
                            <Button size="sm" icon="check" onClick={() => setDeciding({ req: r, approve: true })}>موافقة</Button>
                            <Button size="sm" variant="soft-danger" onClick={() => setDeciding({ req: r, approve: false })}>رفض</Button>
                          </div>)}
                    </td>
                  </tr>
                );
              })}</tbody>
            </table></div>
          )}
        </>
      )}
      {dating && <DatesModal req={dating} onClose={() => setDating(null)} onDone={reload} />}
      {deciding && <DecideModal req={deciding.req} approve={deciding.approve} onClose={() => setDeciding(null)} onDone={reload} />}
    </div>
  );
}
