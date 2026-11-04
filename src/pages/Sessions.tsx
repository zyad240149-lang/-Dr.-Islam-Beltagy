import { useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import type { TreatmentSession } from '../types';
import { db } from '../data/db';
import { useDbVersion, useLoading } from '../hooks/useDb';
import { Icon } from '../utils/icons';
import { Button, EmptyState, Input, Skeleton, StatusBadge } from '../components/ui';
import { ConfirmDialog, IconAction, RowActions, useCan } from '../components/common';
import SessionModal from '../components/SessionModal';
import { APPT_STATUS, fmtDate, fmtTime, todayYmd } from '../utils/format';
import { patientMatches } from '../utils/phoneUtils';
import { useToast } from '../hooks/useToast';
import { useAuth } from '../services/auth';
import { isScopedToOwnPatients } from '../services/permissions';

export default function Sessions() {
  useDbVersion();
  const loading = useLoading();
  const toast = useToast();
  const can = useCan();
  const { user } = useAuth();
  const scoped = isScopedToOwnPatients(user?.role);
  const mine = <T extends { therapistId: string }>(x: T) => !scoped || x.therapistId === (user?.therapistId ?? "");
  const [params] = useSearchParams();
  const presetApptId = params.get('appt');
  const [q, setQ] = useState('');
  const hit = (patientId: string) => !q.trim() || patientMatches(db.patient(patientId), q);
  const [activeSession, setActiveSession] = useState<TreatmentSession | null>(null);
  const [deleting, setDeleting] = useState<TreatmentSession | null>(null);

  const todaysAppts = db.appointmentsForDate(todayYmd()).filter((a) => ['new', 'confirmed', 'on_way', 'arrived', 'rescheduled'].includes(a.status) && !db.sessionByAppointment(a.id) && mine(a) && hit(a.patientId));
  const inProgress = db.raw().sessions.filter((s) => s.status === 'in_progress' && mine(s) && hit(s.patientId));
  const recentCompleted = db.raw().sessions.filter((s) => s.status === 'completed' && mine(s) && hit(s.patientId)).sort((a, b) => (b.completedAt ?? 0) - (a.completedAt ?? 0)).slice(0, 15);

  const presetAppt = presetApptId ? db.appointment(presetApptId) : null;
  const presetSession = presetAppt ? db.sessionByAppointment(presetAppt.id) : null;

  const start = async (appointmentId: string) => { const s = await db.startSession(appointmentId); toast.success('بدأت الزيارة'); setActiveSession(s); };

  return (
    <div className="page">
      <div className="page-head"><div><h1>الزيارات</h1><p>بدء وتسجيل ومتابعة زيارات العلاج.</p></div></div>
      <div style={{ maxWidth: 380, marginBottom: 14 }}><Input id="ss-q" icon="search" placeholder="اسم المريض أو الجوال أو رقم الملف أو الهوية" value={q} onChange={(e) => setQ(e.target.value)} /></div>

      {presetAppt && (
        <div className="alert alert-info" style={{ marginBottom: 18, alignItems: 'center' }}>
          <Icon name="clipboard" size={17} />
          <div style={{ flex: 1 }}>الموعد {presetAppt.no} — {db.patient(presetAppt.patientId)?.fullName} {presetSession ? (presetSession.status === 'completed' ? '— الزيارة مكتملة.' : '— الزيارة قيد التنفيذ.') : 'جاهز لبدء الزيارة.'}</div>
          {presetSession
            ? can('sessions', 'edit') && <Button size="sm" onClick={() => setActiveSession(presetSession)}>{presetSession.status === 'completed' ? 'عرض/تعديل الزيارة' : 'متابعة الزيارة'}</Button>
            : can('sessions', 'create') && <Button size="sm" icon="clipboard" onClick={() => start(presetAppt.id)}>بدء الزيارة</Button>}
        </div>
      )}

      <section className="card" style={{ marginBottom: 18 }}>
        <div className="card__head"><h2>مواعيد اليوم الجاهزة للبدء</h2></div>
        <div className="card__body">
          {loading ? <Skeleton h={100} /> : todaysAppts.length === 0 ? <EmptyState icon="clipboard" title="ما فيه مواعيد بانتظار البدء اليوم" /> : (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
              {todaysAppts.map((a) => {
                const st = APPT_STATUS[a.status];
                return (
                  <div key={a.id} className="tl-card" style={{ borderInlineStartColor: 'var(--brand)' }}>
                    <div className="tl-card__info"><strong>{db.patient(a.patientId)?.fullName}</strong><span className="muted-sm num">{fmtTime(a.time)} — {db.service(a.serviceId)?.name}</span></div>
                    <StatusBadge label={st.label} tone={st.tone} />
                    {can('sessions', 'create') && <Button size="sm" icon="clipboard" onClick={() => start(a.id)}>بدء الزيارة</Button>}
                  </div>
                );
              })}
            </div>
          )}
        </div>
      </section>

      {inProgress.length > 0 && (
        <section className="card" style={{ marginBottom: 18 }}>
          <div className="card__head"><h2>زيارات قيد التنفيذ</h2></div>
          <div className="card__body">
            {inProgress.map((s) => (
              <div key={s.id} className="tl-card" style={{ borderInlineStartColor: 'var(--info)', marginBottom: 8 }}>
                <div className="tl-card__info"><strong>{db.patient(s.patientId)?.fullName}</strong><span className="muted-sm">زيارة رقم {s.sessionNo} — {fmtDate(s.date)}</span></div>
                {can('sessions', 'edit') && <Button size="sm" onClick={() => setActiveSession(s)}>متابعة الزيارة</Button>}
              </div>
            ))}
          </div>
        </section>
      )}

      <section className="card">
        <div className="card__head"><h2>آخر الزيارات المكتملة</h2></div>
        <div className="card__body">
          {recentCompleted.length === 0 ? <EmptyState icon="checkCircle" title="ما فيه زيارات مكتملة بعد" /> : (
            <div className="table-wrap"><table className="table">
              <thead><tr><th>المريض</th><th>رقم الزيارة</th><th>ضمن الخطة</th><th>التاريخ</th><th>المعالج</th><th>مستوى الألم</th><th className="actions"></th></tr></thead>
              <tbody>{recentCompleted.map((s) => {
                const idx = db.planSessionIndex(s.id);
                return (
                  <tr key={s.id}>
                    <td>{db.patient(s.patientId)?.fullName}</td><td className="num">{s.sessionNo}</td>
                    <td className="num">{idx ? `${idx.index} من ${idx.total}` : '—'}</td>
                    <td>{fmtDate(s.date)}</td><td>{db.therapist(s.therapistId)?.name}</td><td className="num">{s.painScale ?? s.painLevel ?? '—'}</td>
                    <td className="actions"><RowActions>
                      {can('sessions', 'edit') && <IconAction icon="edit" label="تعديل الزيارة" onClick={() => setActiveSession(s)} />}
                      {can('sessions', 'delete') && <IconAction icon="trash" label="حذف الزيارة" danger onClick={() => setDeleting(s)} />}
                    </RowActions></td>
                  </tr>
                );
              })}</tbody>
            </table></div>
          )}
        </div>
      </section>

      {activeSession && <SessionModal session={activeSession} onClose={() => setActiveSession(null)} />}
      {deleting && <ConfirmDialog title="حذف الزيارة" onClose={() => setDeleting(null)}
        message={`سيتم حذف الزيارة رقم ${deleting.sessionNo} لـ ${db.patient(deleting.patientId)?.fullName}. يعود الموعد إلى «حضر» وتُعاد الزيارة إلى رصيد الباقة وتُحدَّث نسبة الخطة.`}
        onConfirm={async () => { await db.deleteSession(deleting.id); toast.success('تم حذف الزيارة.'); }} />}
    </div>
  );
}
