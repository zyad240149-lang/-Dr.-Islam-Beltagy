import SecondSessionRequests from '../components/SecondSessionRequests';
import { useState } from 'react';
import { db } from '../data/db';
import { useDbVersion, useLoading } from '../hooks/useDb';
import { Button, EmptyState, Input, Modal, Select, Skeleton, StatusBadge } from '../components/ui';
import { useCan } from '../components/common';
import { StatCard } from '../components/StatCard';
import { useToast } from '../hooks/useToast';
import { useAuth } from '../services/auth';
import { ROLE_LABEL } from '../services/permissions';
import { fmtDate, fmtDateTime, todayYmd } from '../utils/format';
import type { StaffRequest, StaffRequestStatus, StaffRequestType } from '../types';

const TYPE_LABEL: Record<StaffRequestType, string> = { leave: 'إجازة', permission: 'استئذان', other: 'طلب آخر' };
const STATUS: Record<StaffRequestStatus, { label: string; tone: string }> = {
  pending: { label: 'قيد المراجعة', tone: 'warn' }, approved: { label: 'مقبول', tone: 'ok' }, rejected: { label: 'مرفوض', tone: 'danger' },
};

const daysBetween = (a: string, b: string) => Math.round((Date.parse(b) - Date.parse(a)) / 86400000) + 1;

export function periodText(r: Pick<StaffRequest, 'type' | 'fromDate' | 'toDate' | 'fromTime' | 'toTime'>) {
  if (r.type === 'permission') return `${fmtDate(r.fromDate)} · ${r.fromTime} – ${r.toTime}`;
  const n = daysBetween(r.fromDate, r.toDate);
  return r.fromDate === r.toDate ? `${fmtDate(r.fromDate)} (يوم واحد)` : `${fmtDate(r.fromDate)} ← ${fmtDate(r.toDate)} (${n} أيام)`;
}

export function NewRequestModal({ employeeId, onClose }: { employeeId?: string; onClose: () => void }) {
  const toast = useToast();
  const { user } = useAuth();
  const can = useCan();
  const manager = can('requests', 'edit');
  const employees = db.employees().filter((e) => e.active);
  const [f, setF] = useState({
    employeeId: employeeId ?? user?.id ?? '', type: 'leave' as StaffRequestType, reason: '',
    fromDate: todayYmd(), toDate: todayYmd(), fromTime: '10:00', toTime: '12:00',
  });
  const [busy, setBusy] = useState(false);
  const set = <K extends keyof typeof f>(k: K, v: (typeof f)[K]) => setF((x) => ({ ...x, [k]: v }));
  const emp = db.employeeById(f.employeeId);

  const submit = async () => {
    setBusy(true);
    const r = await db.createStaffRequest(f, manager);
    setBusy(false);
    if (!r.ok) { toast.error(r.error); return; }
    toast.success(manager ? `تم تسجيل ${f.type === 'leave' ? 'الإجازة' : 'الاستئذان'} واعتماده — ${emp?.name ?? 'الموظف'} لن يتمكن من الدخول خلال الفترة.` : 'تم إرسال الطلب للمدير للموافقة.');
    onClose();
  };

  return (
    <Modal title={manager ? 'تسجيل إجازة أو استئذان' : 'طلب إجازة أو استئذان'} onClose={onClose}
      footer={<><Button variant="outline" onClick={onClose} disabled={busy}>إلغاء</Button><Button icon="check" onClick={submit} loading={busy}>{manager ? 'حفظ واعتماد' : 'إرسال الطلب'}</Button></>}>
      {employeeId || !manager ? (
        <div className="choice selected" style={{ marginBottom: 14, pointerEvents: 'none' }}>
          <span style={{ flex: 1 }}><strong>{emp?.name}</strong><span> {emp && ROLE_LABEL[emp.role]}</span></span>
        </div>
      ) : (
        <Select id="rq-emp" label="الموظف" value={f.employeeId} onChange={(e) => set('employeeId', e.target.value)}
          options={employees.map((e) => ({ value: e.id, label: `${e.name} — ${ROLE_LABEL[e.role]}` }))} />
      )}
      <div className="seg" style={{ marginBottom: 14 }}>
        <button type="button" className={`seg__btn ${f.type === 'leave' ? 'active' : ''}`} onClick={() => set('type', 'leave')}>إجازة (أيام)</button>
        <button type="button" className={`seg__btn ${f.type === 'permission' ? 'active' : ''}`} onClick={() => set('type', 'permission')}>استئذان (ساعات)</button>
      </div>
      {f.type === 'leave' ? (
        <div className="grid-form">
          <Input id="rq-from" label="من تاريخ" type="date" value={f.fromDate} onChange={(e) => setF((x) => ({ ...x, fromDate: e.target.value, toDate: x.toDate < e.target.value ? e.target.value : x.toDate }))} />
          <Input id="rq-to" label="إلى تاريخ" type="date" min={f.fromDate} value={f.toDate} onChange={(e) => set('toDate', e.target.value)} />
        </div>
      ) : (
        <div className="grid-form grid-form--3">
          <Input id="rq-day" label="اليوم" type="date" value={f.fromDate} onChange={(e) => set('fromDate', e.target.value)} />
          <Input id="rq-ft" label="من الساعة" type="time" value={f.fromTime} onChange={(e) => set('fromTime', e.target.value)} />
          <Input id="rq-tt" label="إلى الساعة" type="time" value={f.toTime} onChange={(e) => set('toTime', e.target.value)} />
        </div>
      )}
      <div className="field">
        <label htmlFor="rq-reason">السبب *</label>
        <textarea id="rq-reason" className="input" rows={3} value={f.reason} onChange={(e) => set('reason', e.target.value)} placeholder="مثال: ظرف عائلي، موعد طبي…" />
      </div>
      {manager
        ? <div className="alert alert-info">{f.type === 'leave' ? 'ستُعتمد الإجازة مباشرة دون طلب موافقة، ولن يتمكن الموظف من دخول النظام طوال فترتها.' : 'سيُعتمد الاستئذان مباشرة دون طلب موافقة، ولن يتمكن الموظف من دخول النظام طوال فترته.'}</div>
        : <div className="alert alert-info">بعد موافقة المدير لن يتمكن الموظف من دخول النظام طوال فترة {f.type === 'leave' ? 'الإجازة' : 'الاستئذان'}.</div>}
    </Modal>
  );
}

function DecisionModal({ req, approve, onClose }: { req: StaffRequest; approve: boolean; onClose: () => void }) {
  const toast = useToast();
  const [f, setF] = useState({ fromDate: req.fromDate, toDate: req.toDate, fromTime: req.fromTime, toTime: req.toTime, note: '' });
  const [busy, setBusy] = useState(false);
  const emp = db.employeeById(req.employeeId);

  const submit = async () => {
    if (!approve && !f.note.trim()) { toast.error('اكتب سبب الرفض.'); return; }
    setBusy(true);
    const r = await db.decideStaffRequest(req.id, approve ? { approve, ...f } : { approve, note: f.note });
    setBusy(false);
    if (!r.ok) { toast.error(r.error); return; }
    toast.success(approve ? `تم قبول الطلب — ${emp?.name} لن يتمكن من الدخول خلال الفترة المعتمدة.` : 'تم رفض الطلب.');
    onClose();
  };

  return (
    <Modal title={approve ? `قبول طلب ${TYPE_LABEL[req.type]}` : `رفض طلب ${TYPE_LABEL[req.type]}`} onClose={onClose}
      footer={<><Button variant="outline" onClick={onClose} disabled={busy}>إلغاء</Button>
        <Button variant={approve ? 'primary' : 'danger'} icon={approve ? 'check' : 'close'} onClick={submit} loading={busy}>{approve ? 'تأكيد القبول' : 'تأكيد الرفض'}</Button></>}>
      <dl className="review-list" style={{ marginBottom: 14 }}>
        <div><dt>الموظف</dt><dd>{emp?.name}</dd></div>
        <div><dt>المدة المطلوبة</dt><dd>{periodText(req)}</dd></div>
        <div><dt>السبب</dt><dd>{req.reason}</dd></div>
      </dl>
      {approve && (req.type === 'leave' ? (
        <>
          <div className="section-title" style={{ fontSize: 14, marginBottom: 8 }}>مدة الإجازة المعتمدة</div>
          <div className="grid-form">
            <Input id="dc-from" label="من تاريخ" type="date" value={f.fromDate} onChange={(e) => setF((x) => ({ ...x, fromDate: e.target.value, toDate: x.toDate < e.target.value ? e.target.value : x.toDate }))} />
            <Input id="dc-to" label="إلى تاريخ" type="date" min={f.fromDate} value={f.toDate} onChange={(e) => setF({ ...f, toDate: e.target.value })} />
          </div>
          {f.fromDate <= f.toDate && <p className="muted" style={{ fontSize: 13, marginTop: -4, marginBottom: 12 }}>المدة المعتمدة: <strong className="num">{daysBetween(f.fromDate, f.toDate)}</strong> يوم</p>}
        </>
      ) : (
        <>
          <div className="section-title" style={{ fontSize: 14, marginBottom: 8 }}>مدة الاستئذان المعتمدة</div>
          <div className="grid-form grid-form--3">
            <Input id="dc-day" label="اليوم" type="date" value={f.fromDate} onChange={(e) => setF({ ...f, fromDate: e.target.value })} />
            <Input id="dc-ft" label="من الساعة" type="time" value={f.fromTime} onChange={(e) => setF({ ...f, fromTime: e.target.value })} />
            <Input id="dc-tt" label="إلى الساعة" type="time" value={f.toTime} onChange={(e) => setF({ ...f, toTime: e.target.value })} />
          </div>
        </>
      ))}
      <div className="field">
        <label htmlFor="dc-note">{approve ? 'ملاحظة (اختياري)' : 'سبب الرفض *'}</label>
        <textarea id="dc-note" className="input" rows={2} value={f.note} onChange={(e) => setF({ ...f, note: e.target.value })} />
      </div>
    </Modal>
  );
}

export default function Requests() {
  useDbVersion();
  const loading = useLoading();
  const can = useCan();
  const { user } = useAuth();
  const manager = can('requests', 'edit');
  const [tab, setTab] = useState<StaffRequestStatus>('pending');
  const [creating, setCreating] = useState(false);
  const [deciding, setDeciding] = useState<{ req: StaffRequest; approve: boolean } | null>(null);

  const visible = db.staffRequests().filter((r) => manager || r.employeeId === user?.id);
  const byStatus = (s: StaffRequestStatus) => visible.filter((r) => r.status === s);
  const list = byStatus(tab);
  const onLeaveNow = db.employees().filter((e) => db.activeLeave(e.id));

  return (
    <div className="page">
      <div className="page-head">
        <div><h1>طلبات الموظفين</h1><p>{manager ? 'طلبات الإجازة والاستئذان — القبول أو الرفض وتحديد المدة المعتمدة.' : 'طلبات الإجازة والاستئذان الخاصة بك وحالتها.'}</p></div>
        {can('requests', 'create') && <Button icon="calendarPlus" onClick={() => setCreating(true)}>طلب جديد</Button>}
      </div>

      <SecondSessionRequests />
      {loading ? <Skeleton h={90} /> : (
        <div className="kpi-grid">
          <StatCard icon="inbox" tone="warn" value={byStatus('pending').length} label="قيد المراجعة" />
          <StatCard icon="checkCircle" tone="ok" value={byStatus('approved').length} label="مقبولة" />
          <StatCard icon="close" tone="danger" value={byStatus('rejected').length} label="مرفوضة" />
          {manager && <StatCard icon="user" tone="info" value={onLeaveNow.length} label="في إجازة الحين" />}
        </div>
      )}

      <div className="svc-tabs">
        {(['pending', 'approved', 'rejected'] as StaffRequestStatus[]).map((s) => (
          <button key={s} type="button" className={`svc-tab ${tab === s ? 'active' : ''}`} onClick={() => setTab(s)}>
            {STATUS[s].label} <span className="num">{byStatus(s).length}</span>
          </button>
        ))}
      </div>

      {list.length === 0 ? (
        <div className="card"><div className="card__body"><EmptyState icon="inbox" title={tab === 'pending' ? 'ما فيه طلبات بانتظار المراجعة' : 'ما فيه طلبات'} /></div></div>
      ) : (
        <div className="rq-list">
          {list.map((r) => {
            const emp = db.employeeById(r.employeeId);
            const decider = r.decidedBy ? db.employeeById(r.decidedBy) : undefined;
            const active = r.status === 'approved' && db.activeLeave(r.employeeId)?.id === r.id;
            return (
              <article key={r.id} className={`card rq-card rq-card--${r.status}`}>
                <div className="rq-card__main">
                  <div className="rq-card__who">
                    <strong>{emp?.name ?? 'موظف محذوف'}</strong>
                    <span className="muted">{emp && ROLE_LABEL[emp.role]} · قُدّم {fmtDateTime(r.createdAt)}</span>
                  </div>
                  <div className="rq-card__tags">
                    <span className={`rq-type rq-type--${r.type}`}>{TYPE_LABEL[r.type]}</span>
                    <StatusBadge label={STATUS[r.status].label} tone={STATUS[r.status].tone} />
                    {active && <StatusBadge label="سارية الآن" tone="info" />}
                  </div>
                </div>
                <dl className="plan-card__facts">
                  <div><dt>{r.status === 'approved' ? 'المدة المعتمدة' : 'المدة المطلوبة'}</dt><dd>{periodText(r)}</dd></div>
                  <div><dt>السبب</dt><dd>{r.reason}</dd></div>
                  {r.status !== 'pending' && <div><dt>{r.status === 'approved' ? 'بواسطة' : 'رُفض بواسطة'}</dt><dd>{decider?.name ?? 'المدير'}{r.decidedAt ? ` · ${fmtDateTime(r.decidedAt)}` : ''}</dd></div>}
                  {r.decisionNote && <div><dt>{r.status === 'rejected' ? 'سبب الرفض' : 'ملاحظة'}</dt><dd>{r.decisionNote}</dd></div>}
                </dl>
                {manager && r.status === 'pending' && (
                  <div className="rq-card__actions">
                    <Button size="sm" variant="soft-danger" icon="close" onClick={() => setDeciding({ req: r, approve: false })}>رفض</Button>
                    <Button size="sm" icon="check" onClick={() => setDeciding({ req: r, approve: true })}>قبول</Button>
                  </div>
                )}
              </article>
            );
          })}
        </div>
      )}

      {creating && <NewRequestModal onClose={() => setCreating(false)} />}
      {deciding && <DecisionModal req={deciding.req} approve={deciding.approve} onClose={() => setDeciding(null)} />}
    </div>
  );
}
