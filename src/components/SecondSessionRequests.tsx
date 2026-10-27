// طلبات «جلسة ثانية في نفس اليوم» — بتظهر في «طلبات الموظفين»: المدير يوافق (الجلسة بتتسجّل فورًا) أو يرفض بسبب،
// وباقي الموظفين بيشوفوا حالة طلباتهم. المصدر: جدول second_session_requests (RPC: request/decide_second_session).
import { useCallback, useEffect, useState } from 'react';
import { supabase } from '../lib/supabase';
import { db } from '../data/db';
import { Button, Input, Modal, StatusBadge } from './ui';
import { useToast } from '../hooks/useToast';
import { useAuth } from '../services/auth';
import { fmtDateTime } from '../utils/format';

interface Req { id: string; source: 'package' | 'plan'; ref_id: string; patient_id: string; therapist_id: string | null; status: 'pending' | 'approved' | 'rejected'; requested_by: string | null; requested_at: string; decided_by: string | null; reject_reason: string }
const STATUS = { pending: { label: 'بانتظار موافقة المدير', tone: 'warning' }, approved: { label: 'تمت الموافقة وسُجّلت الجلسة', tone: 'ok' }, rejected: { label: 'مرفوض', tone: 'danger' } } as const;
const clean = (m: string) => m.replace(/^.*?ERROR:\s*/, '');

export default function SecondSessionRequests() {
  const toast = useToast();
  const { user } = useAuth();
  const isManager = user?.role === 'system_admin' || user?.role === 'center_manager';
  const [rows, setRows] = useState<Req[]>([]);
  const [busy, setBusy] = useState<string | null>(null);
  const [rejecting, setRejecting] = useState<Req | null>(null);
  const [reason, setReason] = useState('');
  const load = useCallback(async () => {
    const since = new Date(Date.now() - 7 * 864e5).toISOString().slice(0, 19) + 'Z';
    const { data } = await supabase.from('second_session_requests').select('*').or(`status.eq.pending,requested_at.gte.${since}`).order('requested_at', { ascending: false }).limit(50);
    setRows((data as Req[]) ?? []);
  }, []);
  useEffect(() => { void load(); const t = setInterval(() => void load(), 30_000); return () => clearInterval(t); }, [load]);

  const decide = async (r: Req, approve: boolean, why = '') => {
    setBusy(r.id);
    const { data, error } = await supabase.rpc('decide_second_session', { p_id: r.id, p_approve: approve, p_reason: why });
    setBusy(null);
    if (error) { toast.error(clean(error.message)); void load(); return; }
    if (approve) { const x = data as { sessionNo: number; total: number }; toast.success(`تمت الموافقة وتسجيل الجلسة ${x.sessionNo} من ${x.total}.`); }
    else toast.success('تم رفض الطلب.');
    setRejecting(null); setReason('');
    void db.refresh('appointments', 'packages', 'plans', 'sessions', 'activity'); void load();
  };
  const mine = isManager ? rows : rows.filter((r) => r.requested_by === user?.id);
  if (!mine.length) return null;
  const name = (id: string | null) => (id ? db.employees().find((e) => e.id === id)?.name : null) ?? '—';
  return (
    <section className="card" style={{ marginBottom: 18 }}>
      <div className="card__head"><h2>طلبات جلسة ثانية في نفس اليوم <span className="num muted">({mine.filter((r) => r.status === 'pending').length} بانتظار)</span></h2></div>
      <div className="card__body">
        <div className="table-wrap"><table className="table">
          <thead><tr><th>المريض</th><th>الدكتور</th><th>طلبه</th><th>الوقت</th><th>الحالة</th>{isManager && <th></th>}</tr></thead>
          <tbody>{mine.map((r) => (
            <tr key={r.id}>
              <td><strong>{db.patient(r.patient_id)?.fullName ?? '—'}</strong> <span className="muted-sm num">{db.patient(r.patient_id)?.fileNo}</span></td>
              <td>{db.therapist(r.therapist_id ?? '')?.name ?? '—'}</td>
              <td>{name(r.requested_by)}</td>
              <td className="num date">{fmtDateTime(Date.parse(r.requested_at))}</td>
              <td><StatusBadge label={STATUS[r.status].label + (r.status === 'rejected' && r.reject_reason ? ` — ${r.reject_reason}` : '')} tone={STATUS[r.status].tone} /></td>
              {isManager && <td>{r.status === 'pending' && <span style={{ display: 'flex', gap: 6 }}>
                <Button size="sm" icon="check" loading={busy === r.id} disabled={!!busy} onClick={() => decide(r, true)}>موافقة وتسجيل</Button>
                <Button size="sm" variant="soft-danger" disabled={!!busy} onClick={() => { setRejecting(r); setReason(''); }}>رفض</Button>
              </span>}</td>}
            </tr>
          ))}</tbody>
        </table></div>
      </div>
      {rejecting && (
        <Modal title="رفض طلب الجلسة الثانية" onClose={() => setRejecting(null)} footer={<><Button variant="outline" onClick={() => setRejecting(null)}>إلغاء</Button><Button variant="danger" loading={busy === rejecting.id} onClick={() => decide(rejecting, false, reason)}>رفض</Button></>}>
          <Input id="ssr-reason" label="سبب الرفض *" value={reason} onChange={(e) => setReason(e.target.value)} />
        </Modal>
      )}
    </section>
  );
}
