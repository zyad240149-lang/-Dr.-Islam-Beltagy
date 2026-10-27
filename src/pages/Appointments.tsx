import { CompletenessBadge, IncompleteAlert } from '../components/PatientCompleteness';
import { PendingSyncTag } from '../components/OfflineStatus';
import { isPatientComplete } from '../utils/patientGaps';
import { patientMatches } from '../utils/phoneUtils';
import { isEn } from '../i18n';
import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import type { Appointment } from '../types';
import { db } from '../data/db';
import { useSearchParams } from 'react-router-dom';
import { useDbVersion, useLoading } from '../hooks/useDb';
import { Icon } from '../utils/icons';
import { Button, EmptyState, Skeleton, StatusBadge, Modal, Input, Select } from '../components/ui';
import { ConfirmDialog, FilterBar, useCan } from '../components/common';
import { useAuth } from '../services/auth';
import { isScopedToOwnPatients } from '../services/permissions';
import { APPT_STATUS, APPT_TYPE_LABEL, fmtDate, fmtShortDate, fmtTime, money, todayYmd, addDaysYmd, ymdLocal } from '../utils/format';
import BookingWizard from '../components/BookingWizard';
import ScheduleGrid, { type Preset } from '../components/ScheduleGrid';
import { ActorBadges, ActorDetails } from '../components/AppointmentActor';
import { RescheduleModal, CancelModal, EditAppointmentModal, StatusMenu, useStatusWithDoctor, useConfirmAppointment, CONFIRMABLE, attendanceOpen } from '../components/AppointmentActions';
import { PlanModal } from '../components/PatientForms';
import { useDetails } from '../components/DetailsHost';
import { useToast } from '../hooks/useToast';
import { phoneMatches } from '../utils/phoneUtils';

function Countdown({ target }: { target: number }) {
  const [now, setNow] = useState(Date.now());
  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(t);
  }, []);
  const diff = target - now;
  if (diff <= 0) return <span className="muted-sm">الموعد حان</span>;
  const s = Math.floor(diff / 1000);
  const days = Math.floor(s / 86400);
  const hours = Math.floor((s % 86400) / 3600);
  const mins = Math.floor((s % 3600) / 60);
  const secs = s % 60;
  const p2 = (n: number) => String(n).padStart(2, '0');
  const unit = (n: number, one: string, two: string, many: string) => (n === 1 ? one : n === 2 ? two : n <= 10 ? `${n} ${many}` : `${n} ${one}`);
  // أكتر من يوم: «باقي 4 أيام و1 ساعة» بالكلام؛ أقل من يوم: عدّاد ساعات:دقايق:ثواني (dir=ltr عشان الأرقام ماتتقلبش جنب الكلام العربي)
  const en = (n: number, w: string) => `${n} ${w}${n === 1 ? '' : 's'}`;
  const text = days > 0
    ? isEn
      ? `${en(days, 'day')}${hours > 0 ? ` ${en(hours, 'hour')}` : ''}`
      : `${unit(days, 'يوم', 'يومين', 'أيام')}${hours > 0 ? ` و${unit(hours, 'ساعة', 'ساعتين', 'ساعات')}` : ''}`
    : null;
  return (
    <span className="muted-sm tl-countdown" style={{ display: 'inline-flex', alignItems: 'center', gap: 4, whiteSpace: 'nowrap' }}>
      <Icon name="clock" size={13} />
      باقي {text ?? <bdi dir="ltr" className="num">{p2(hours)}:{p2(mins)}:{p2(secs)}</bdi>}
    </span>
  );
}

function ConfirmApptButton({ appt }: { appt: Appointment }) {
  const [run, busy, doctorModal] = useConfirmAppointment();
  return <><Button variant="outline" size="sm" icon="check" onClick={() => run(appt)} loading={busy}>تأكيد</Button>{doctorModal}</>;
}

export default function Appointments() {
  useDbVersion();
  const loading = useLoading();
  const navigate = useNavigate();
  const can = useCan();
  const toast = useToast();
  const { user } = useAuth();
  // أي حساب دكتور (دور المعالج أو حساب مربوط بملف دكتور) بيشوف مواعيده هو بس
  const scoped = isScopedToOwnPatients(user?.role) || !!user?.therapistId;
  const [date, setDate] = useState(todayYmd());
  const [view, setView] = useState<'day' | 'week' | 'month' | 'list'>('day');
  const [params] = useSearchParams();
  const [listPage, setListPage] = useState(1);
  const [booking, setBooking] = useState(false);
  const [preset, setPreset] = useState<Preset | null>(null); // حجز من خانة فاضية في الجدول: الدكتور والتاريخ والوقت محددين مسبقًا
  const [detail, setDetail] = useState<Appointment | null>(null);
  const [reschedule, setReschedule] = useState<Appointment | null>(null);
  const [editing, setEditing] = useState<Appointment | null>(null);
  const [cancel, setCancel] = useState<Appointment | null>(null);
  const [deleting, setDeleting] = useState<Appointment | null>(null);
  const [planningFor, setPlanningFor] = useState<Appointment | null>(null);
  const [q, setQ] = useState(params.get('q') ?? '');
  const [status, setStatus] = useState('');
  const [src, setSrc] = useState('');
  const [therapist, setTherapist] = useState(scoped && user ? (user.therapistId ?? "") : '');

  const match = (a: Appointment) => {
    if (scoped && user && a.therapistId !== (user.therapistId ?? "")) return false;
    if (status && a.status !== status) return false;
    if (src && (a.source ?? 'staff') !== src) return false;
    if (therapist && a.therapistId !== therapist) return false;
    if (q.trim()) {
      const p = db.patient(a.patientId);
      const s = q.trim().toLowerCase();
      if (!(patientMatches(p, s) || a.no.toLowerCase().includes(s))) return false;
    }
    return true;
  };
  const weekStart = (() => { const d = new Date(date + 'T00:00:00'); d.setDate(d.getDate() - d.getDay()); return ymdLocal(d); })();
  const weekDays = Array.from({ length: 7 }, (_, i) => addDaysYmd(weekStart, i));
  const dayAppts = db.appointmentsForDate(date).filter(match);
  const monthStart = date.slice(0, 8) + '01';
  const monthFirstDow = new Date(monthStart + 'T00:00:00').getDay();
  const monthDays = new Date(Number(date.slice(0, 4)), Number(date.slice(5, 7)), 0).getDate();
  const monthCells: Array<string | null> = [...Array(monthFirstDow).fill(null), ...Array.from({ length: monthDays }, (_, i) => monthStart.slice(0, 8) + String(i + 1).padStart(2, '0'))];
  const listAll = db.appointments().filter(match).sort((a, b) => (a.date + a.time < b.date + b.time ? 1 : -1));
  const LIST_SIZE = 15;
  const listPages = Math.max(1, Math.ceil(listAll.length / LIST_SIZE));
  const nav = (dir: 1 | -1) => setDate((d) => (view === 'month' ? ymdLocal(new Date(Number(d.slice(0, 4)), Number(d.slice(5, 7)) - 1 + dir, 1)) : addDaysYmd(d, (view === 'day' ? 1 : 7) * dir)));
  const headLabel = view === 'day' ? fmtDate(date) : view === 'week' ? `${fmtShortDate(weekStart)} – ${fmtShortDate(addDaysYmd(weekStart, 6))}` : new Date(monthStart + 'T00:00:00').toLocaleDateString('ar-SA-u-nu-latn', { month: 'long', year: 'numeric' });
  const canBook = can('booking', 'create') || can('appointments', 'create');

  return (
    <div className="page">
      <div className="page-head">
        <div><h1>المواعيد</h1><p>{scoped ? 'مواعيدك اليومية والأسبوعية.' : 'جدول المواعيد اليومي والأسبوعي لكل المعالجين.'}</p></div>
        {canBook && <Button icon="calendarPlus" onClick={() => setBooking(true)}>حجز موعد جديد</Button>}
      </div>

      <div className="card">
        <FilterBar>
          <Input id="ap-q" label="بحث" icon="search" placeholder="اسم المريض أو الجوال أو رقم الملف أو الهوية أو رقم الموعد" value={q} onChange={(e) => setQ(e.target.value)} />
          <Select id="ap-status" label="الحالة" value={status} onChange={(e) => setStatus(e.target.value)} options={[{ value: '', label: 'كل الحالات' }, ...Object.entries(APPT_STATUS).map(([value, v]) => ({ value, label: v.label }))]} />
          <Select id="ap-src" label="مصدر الحجز" value={src} onChange={(e) => setSrc(e.target.value)} options={[{ value: '', label: 'كل الحجوزات' }, { value: 'online', label: 'حجوزات أونلاين من الموقع' }, { value: 'staff', label: 'حجوزات من الإدارة' }]} />
          {!scoped && <Select id="ap-th" label="المعالج" value={therapist} onChange={(e) => setTherapist(e.target.value)} options={[{ value: '', label: 'كل المعالجين' }, ...db.allTherapists().map((t) => ({ value: t.id, label: t.name }))]} />}
        </FilterBar>
        <div className="card__head" style={{ flexWrap: 'wrap', gap: 10 }}>
          <div className="date-nav">
            {view !== 'list' && <button className="icon-btn" onClick={() => nav(-1)} aria-label="السابق"><Icon name="chevron" size={16} className="flip-x" /></button>}
            <strong>{view === 'list' ? `كل المواعيد (${listAll.length})` : headLabel}</strong>
            {view !== 'list' && <button className="icon-btn" onClick={() => nav(1)} aria-label="التالي"><Icon name="chevron" size={16} /></button>}
            <Button variant={date === todayYmd() ? 'primary' : 'outline'} size="sm" onClick={() => setDate(todayYmd())}>اليوم</Button>
            {(view === 'day' || view === 'week') && <Button variant={date === addDaysYmd(todayYmd(), 1) ? 'primary' : 'outline'} size="sm" onClick={() => setDate(addDaysYmd(todayYmd(), 1))}>غدًا</Button>}
            {view !== 'list' && <input type="date" className="input" style={{ width: 'auto', minWidth: 150 }} value={date} onChange={(e) => e.target.value && setDate(e.target.value)} aria-label="اختر التاريخ" />}
          </div>
          <span className="spacer" />
          <div className="row-actions">
            <Button size="sm" variant={view === 'day' ? 'primary' : 'outline'} onClick={() => setView('day')}>يومي</Button>
            <Button size="sm" variant={view === 'week' ? 'primary' : 'outline'} onClick={() => setView('week')}>أسبوعي</Button>
            <Button size="sm" variant={view === 'month' ? 'primary' : 'outline'} onClick={() => setView('month')}>شهري</Button>
            <Button size="sm" variant={view === 'list' ? 'primary' : 'outline'} onClick={() => { setView('list'); setListPage(1); }}>قائمة</Button>
          </div>
        </div>

        <div className="card__body">
          {loading ? <Skeleton h={260} /> : (view === 'day' || view === 'week') ? (
            <>
              {q.trim() && (() => {
                const hits = db.appointments().filter(match).sort((x, y) => (x.date + x.time < y.date + y.time ? 1 : -1));
                return (
                  <div className="ap-results" role="status">
                    <strong style={{ fontSize: 13.5 }}>نتائج البحث ({hits.length})</strong>
                    {hits.length === 0 ? <p className="muted" style={{ margin: '6px 0 0' }}>ما فيه نتائج مطابقة للبحث.</p> : hits.slice(0, 8).map((x) => (
                      <button key={x.id} type="button" onClick={() => { setDate(x.date); setDetail(x); }}>
                        <span><strong>{db.patient(x.patientId)?.fullName}</strong> {x.pendingSync && <PendingSyncTag />}<CompletenessBadge patient={db.patient(x.patientId)} /> <span className="muted-sm">· {db.service(x.serviceId)?.name}</span></span>
                        <span className="muted-sm num">{fmtDate(x.date)} · {fmtTime(x.time)} · {db.therapist(x.therapistId)?.name ?? '—'}</span>
                      </button>
                    ))}
                    {hits.length > 8 && <p className="muted-sm" style={{ margin: '4px 0 0' }}>وغيرها {hits.length - 8} — استخدم «قائمة» لعرض الكل.</p>}
                  </div>
                );
              })()}
              <ScheduleGrid mode={view} date={date} doctorId={therapist} scopedDoctorId={scoped && user ? (user.therapistId ?? '__none__') : undefined}
                matches={match} searching={!!q.trim() || !!status || !!src} canBook={canBook}
                onOpen={setDetail} onBook={(p) => { setPreset(p); setBooking(true); }} />
              {view === 'day' && (
                <div style={{ marginTop: 18 }}>
                  <div className="section-title">كل مواعيد اليوم ({dayAppts.length})</div>
                  {dayAppts.length === 0 ? <p className="muted">ما فيه مواعيد في هاليوم.</p> : (
                    <div className="timeline">
                      {dayAppts.map((a) => {
                        const p = db.patient(a.patientId); const svc = db.service(a.serviceId); const th = db.therapist(a.therapistId); const st = APPT_STATUS[a.status];
                        const live = a.status !== 'completed' && a.status !== 'cancelled' && a.status !== 'no_show';
                        return (
                          <div className="tl-row" key={a.id}>
                            <div className="tl-time num">{fmtTime(a.time)}</div>
                            <div className={`tl-card st-${a.status}`}>
                              <div className="tl-card__info">
                                <strong>{p?.fullName}</strong> {a.pendingSync && <PendingSyncTag />}{p && !isPatientComplete(p) && <CompletenessBadge patient={p} />}
                                <span className="muted-sm">{svc?.name} · {APPT_TYPE_LABEL[a.type]} · {th?.name ?? 'بدون طبيب'}</span>
                              </div>
                              <StatusBadge label={st.label} tone={st.tone} />
                              {live && <Countdown target={new Date(`${a.date}T${a.time}:00+03:00`).getTime()} />}
                              {CONFIRMABLE.includes(a.status) && attendanceOpen(a) && can('appointments', 'edit') && can('appt_confirm', 'view') && <ConfirmApptButton appt={a} />}
                              <Button variant="outline" size="sm" onClick={() => setDetail(a)}>التفاصيل</Button>
                            </div>
                          </div>
                        );
                      })}
                    </div>
                  )}
                </div>
              )}
            </>
          ) : view === 'month' ? (
            <div className="table-wrap"><table className="table" style={{ tableLayout: 'fixed' }}>
              <thead><tr>{['الأحد', 'الاثنين', 'الثلاثاء', 'الأربعاء', 'الخميس', 'الجمعة', 'السبت'].map((d) => <th key={d}>{d}</th>)}</tr></thead>
              <tbody>{Array.from({ length: Math.ceil(monthCells.length / 7) }, (_, w) => (
                <tr key={w}>{monthCells.slice(w * 7, w * 7 + 7).concat(Array(7).fill(null)).slice(0, 7).map((d, i) => {
                  const list = d ? db.appointmentsForDate(d).filter(match) : [];
                  return <td key={i} style={{ verticalAlign: 'top', height: 84, cursor: d ? 'pointer' : undefined, background: d === todayYmd() ? 'var(--brand-50)' : undefined }} onClick={() => { if (d) { setDate(d); setView('day'); } }}>
                    {d && <><strong className="num">{Number(d.slice(8))}</strong>{list.length > 0 && <div><span className="badge badge--brand num">{list.length} موعد</span><div className="muted-sm num">{list.filter((a) => a.status === 'completed').length} مكتمل</div></div>}</>}
                  </td>;
                })}</tr>))}</tbody></table></div>
          ) : view === 'list' ? (
            listAll.length === 0 ? <EmptyState icon="calendar" title="ما فيه مواعيد" text="ما فيه مواعيد مطابقة." /> : (
              <>
                <div className="table-wrap"><table className="table">
                  <thead><tr><th>رقم الموعد</th><th>التاريخ</th><th>الوقت</th><th>المريض</th><th>الخدمة</th><th>الطبيب</th><th>الحالة</th><th>حجزه / ألغاه</th><th></th></tr></thead>
                  <tbody>{listAll.slice((listPage - 1) * LIST_SIZE, listPage * LIST_SIZE).map((a) => { const st = APPT_STATUS[a.status]; return (
                    <tr key={a.id}><td className="num">{a.no}</td><td>{fmtDate(a.date)}</td><td className="num">{fmtTime(a.time)}</td><td>{db.patient(a.patientId)?.fullName} {a.pendingSync && <PendingSyncTag />}<CompletenessBadge patient={db.patient(a.patientId)} /></td><td>{db.service(a.serviceId)?.name}</td><td>{db.therapist(a.therapistId)?.name}</td><td><StatusBadge label={st.label} tone={st.tone} /></td><td><ActorBadges a={a} /></td>
                      <td><Button variant="outline" size="sm" onClick={() => setDetail(a)}>التفاصيل</Button></td></tr>); })}</tbody></table></div>
                <div className="row-between" style={{ marginTop: 12 }}><span className="muted">صفحة <span className="num">{listPage}</span> من <span className="num">{listPages}</span></span>
                  <span className="row-actions"><Button variant="outline" size="sm" disabled={listPage <= 1} onClick={() => setListPage(listPage - 1)}>السابق</Button><Button variant="outline" size="sm" disabled={listPage >= listPages} onClick={() => setListPage(listPage + 1)}>التالي</Button></span></div>
              </>
            )
          ) : null}
        </div>
      </div>

      {detail && (
        <AppointmentDetailModal
          appt={db.appointment(detail.id) ?? detail}
          onClose={() => setDetail(null)}
          onOpenPatient={() => { setDetail(null); navigate(`/patients/${detail.patientId}`); }}
          onReschedule={() => { setReschedule(detail); setDetail(null); }}
          onEdit={() => { setEditing(detail); setDetail(null); }}
          onCancel={() => { setCancel(detail); setDetail(null); }}
          onOpenSession={() => { setDetail(null); navigate(`/sessions?appt=${detail.id}`); }}
          onDelete={() => { setDeleting(detail); setDetail(null); }}
          onCreatePlan={() => { setPlanningFor(detail); setDetail(null); }}
        />
      )}
      {reschedule && <RescheduleModal appt={reschedule} onClose={() => setReschedule(null)} />}
      {editing && <EditAppointmentModal appt={editing} onClose={() => setEditing(null)} />}
      {cancel && <CancelModal appt={cancel} onClose={() => setCancel(null)} />}
      {booking && <BookingWizard onClose={() => { setBooking(false); setPreset(null); }} presetTherapistId={preset?.therapistId} presetDate={preset?.date} presetTime={preset?.time} />}
      {deleting && <ConfirmDialog title="حذف الموعد" onClose={() => setDeleting(null)}
        message={`سيتم حذف الموعد ${deleting.no} وفاتورته غير المدفوعة نهائيًا. للاحتفاظ بالسجل استخدم «إلغاء الموعد» بدل الحذف.`}
        onConfirm={async () => { const r = await db.deleteAppointment(deleting.id); if (r.ok) toast.success('تم حذف الموعد.'); else toast.error(r.error); }} />}
      {planningFor && <PlanModal patientId={planningFor.patientId} presetServiceId={planningFor.serviceId} onClose={() => setPlanningFor(null)} />}
    </div>
  );
}

const endTime = (t: string, min: number) => { const [h, m] = t.split(':').map(Number); const x = h * 60 + m + min; return `${String(Math.floor(x / 60) % 24).padStart(2, '0')}:${String(x % 60).padStart(2, '0')}`; };

export function AppointmentDetailModal({ appt, onClose, onOpenPatient, onReschedule, onEdit, onCancel, onDelete, onCreatePlan }: {
  appt: Appointment; onClose: () => void; onOpenPatient: () => void; onReschedule: () => void; onEdit: () => void; onCancel: () => void; onOpenSession?: () => void; onDelete: () => void; onCreatePlan: () => void;
}) {
  useDbVersion();
  const can = useCan();
  const toast = useToast();
  const a = db.appointment(appt.id) ?? appt;
  const p = db.patient(a.patientId); const svc = db.service(a.serviceId); const th = db.therapist(a.therapistId);
  const st = APPT_STATUS[a.status];
  const canAct = a.status !== 'completed' && a.status !== 'cancelled' && can('appointments', 'edit');
  const plan = a.planId ? db.plan(a.planId) : undefined;
  const pkg = a.packageId ? db.raw().packages.find((x) => x.id === a.packageId) : undefined;
  const { openVisit } = useDetails();
  const [confirmAppt, busy, doctorModal] = useConfirmAppointment();
  return (
    <Modal title={`تفاصيل الموعد ${a.no}`} onClose={onClose} footer={
      <div style={{ display: 'flex', flexDirection: 'column', gap: 10, width: '100%' }}>
        {/* المريض */}
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8, width: '100%' }}>
          {can('patients') && <Button variant="ghost" onClick={onOpenPatient}>فتح ملف المريض</Button>}
        </div>
        {/* الموعد */}
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8, width: '100%' }}>
          {CONFIRMABLE.includes(a.status) && attendanceOpen(a) && can('appointments', 'edit') && can('appt_confirm', 'view') && <Button variant="primary" icon="check" onClick={() => confirmAppt(a)} loading={busy}>تأكيد</Button>}
          {canAct && <Button variant="outline" icon="edit" onClick={onEdit}>تعديل</Button>}
          <span className="spacer" />
          {canAct && can('appt_cancel', 'view') && <Button variant="danger" onClick={onCancel}>إلغاء الموعد</Button>}
          {can('appointments', 'delete') && <Button variant="soft-danger" icon="trash" onClick={onDelete}>حذف</Button>}
        </div>
      </div>
    }>
      <div style={{ marginBottom: 14 }}><StatusBadge label={st.label} tone={st.tone} /></div>
      <IncompleteAlert patientId={a.patientId} />
      <dl className="dl" style={{ marginBottom: 16 }}>
        <div><dt>المريض</dt><dd>{p?.fullName} <CompletenessBadge patient={p} /></dd></div>
        <div><dt>رقم الملف</dt><dd className="num">{p?.fileNo || '—'}{p?.fileNo && <button type="button" className="btn btn--outline btn--sm" style={{ marginInlineStart: 8 }} onClick={() => navigator.clipboard.writeText(p.fileNo).then(() => toast.success('تم نسخ رقم الملف'), () => toast.error('تعذّر النسخ'))}>نسخ</button>}</dd></div>
        <div><dt>الجوال</dt><dd className="num" style={{ textAlign: 'start' }}><span dir="ltr">{p?.phone || '—'}</span>{p?.phone && <button type="button" className="btn btn--outline btn--sm" style={{ marginInline: 8, display: 'inline-flex', alignItems: 'center', gap: 6, fontWeight: 600 }} onClick={() => navigator.clipboard.writeText(p!.phone).then(() => toast.success('تم نسخ رقم الجوال'), () => toast.error('تعذّر النسخ'))}><Icon name="copy" size={15} /> نسخ الجوال</button>}</dd></div>
        <div><dt>النوع</dt><dd>{APPT_TYPE_LABEL[a.type]}</dd></div>
        <div><dt>الخدمة</dt><dd>{svc?.name}</dd></div>
        <div><dt>المعالج</dt><dd>{th?.name}</dd></div>
        <div><dt>التاريخ</dt><dd>{fmtDate(a.date)}</dd></div>
        <div><dt>الوقت</dt><dd className="num">{fmtTime(a.time)} – {fmtTime(endTime(a.time, a.durationMin))}</dd></div>
        <ActorDetails a={a} />
        {a.notes && <div style={{ gridColumn: '1/-1' }}><dt>ملاحظات</dt><dd>{a.notes}</dd></div>}
        <div><dt>السعر</dt><dd className="num">{money(a.price)}</dd></div>
        <div><dt>الباقة</dt><dd>{pkg ? pkg.name : 'بدون باقة'}</dd></div>
        <div><dt>الخطة العلاجية</dt><dd>{plan ? plan.diagnosis : '—'}</dd></div>
      </dl>
      {canAct && <StatusMenu appt={a} />}
      {doctorModal}
      {a.cancelReason && <div className="alert alert-danger" style={{ marginTop: 14 }}><Icon name="alert" size={16} /><div>سبب الإلغاء: {a.cancelReason}</div></div>}
    </Modal>
  );
}
