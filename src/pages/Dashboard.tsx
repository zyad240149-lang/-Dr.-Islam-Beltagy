import { useEffect, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import type { Appointment } from '../types';
import { db, type DashboardStats } from '../data/db';
import { useDbVersion, useLoading } from '../hooks/useDb';
import { Icon } from '../utils/icons';
import { Button, EmptyState, Skeleton, StatusBadge } from '../components/ui';
import { IconAction } from '../components/common';
import { APPT_STATUS, APPT_TYPE_LABEL, fmtDate, fmtTime, initials, money, todayYmd } from '../utils/format';
import { ConfirmDialog, useCan } from '../components/common';
import BookingWizard from '../components/BookingWizard';
import { useAuth } from '../services/auth';
import { useToast } from '../hooks/useToast';
import { AppointmentDetailModal } from './Appointments';
import { RescheduleModal, CancelModal, EditAppointmentModal, useConfirmAppointment, CONFIRMABLE, attendanceOpen } from '../components/AppointmentActions';
import { PlanModal } from '../components/PatientForms';
import DailySchedule from '../components/DailySchedule';
import DoctorPatients, { dailyMotivation, dayGreeting, doctorTitle } from '../components/DoctorPatients';

function Kpi({ icon, tone, value, label }: { icon: string; tone: string; value: string | number; label: string }) {
  return (
    <div className="card kpi">
      <div className="kpi__top"><span className={`kpi__ic kpi__ic--${tone}`}><Icon name={icon} size={19} /></span></div>
      <div><div className="kpi__value num">{value}</div><div className="kpi__label">{label}</div></div>
    </div>
  );
}

export default function Dashboard() {
  const { user } = useAuth();
  const navigate = useNavigate();
  const toast = useToast();
  const loading = useLoading();
  const can = useCan();
  const [booking, setBooking] = useState(false);
  const [slotBooking, setSlotBooking] = useState<{ therapistId?: string; date: string; time: string } | null>(null);
  const [stats, setStats] = useState<DashboardStats | null>(null);
  const [detail, setDetail] = useState<Appointment | null>(null);
  const [reschedule, setReschedule] = useState<Appointment | null>(null);
  const [editing, setEditing] = useState<Appointment | null>(null);
  const [cancel, setCancel] = useState<Appointment | null>(null);
  const [deleting, setDeleting] = useState<Appointment | null>(null);
  const [planningFor, setPlanningFor] = useState<Appointment | null>(null);
  const [tab, setTab] = useState<'all' | 'confirmed' | 'pending'>('all');
  const [selected, setSelected] = useState<Appointment | null>(null);
  const version = useDbVersion();
  useEffect(() => { db.dashboardStats().then(setStats); }, [version]);
  const canBook = can('booking', 'create') || can('appointments', 'create');
  const canConfirmAppt = (can('appointments', 'edit') || can('booking', 'edit')) && can('appt_confirm', 'view');
  const [confirmAppt, , doctorModal] = useConfirmAppointment();
  if (!user) return null;

  const today = todayYmd();
  const doctorId = user.therapistId ?? ''; // حساب دكتور: مواعيده هو بس
  const todayAppts = db.todayAppointments().filter((a) => !doctorId || a.therapistId === doctorId).sort((a, b) => (a.time < b.time ? -1 : 1));
  const activeToday = todayAppts.filter((a) => a.status !== 'cancelled');
  const pendingToday = todayAppts.filter((a) => a.status === 'new');
  const confirmedToday = todayAppts.filter((a) => a.status !== 'new' && a.status !== 'cancelled');
  const confirmationRate = activeToday.length ? Math.round((confirmedToday.length / activeToday.length) * 100) : 0;
  const patients = db.patients();
  const completedToday = stats?.completedToday ?? todayAppts.filter((a) => a.status === 'completed').length;
  const totalPatients = stats?.totalPatients ?? patients.length;
  const revenueMonth = stats?.monthRevenue ?? null;
  const dueTotal = stats?.outstanding ?? null;
  const alerts = stats?.unreadNotifications ?? db.unreadCount();

  // أحدث حجز بانتظار التأكيد — أحدث موعد بحالة «جديد» (بغضّ النظر عن تاريخه، حجز حديث ممكن يكون لأي يوم قادم)
  // لو المستخدم دوس على أي موعد من «جدول اليوم» يظهر هو في البطاقة بدل الأحدث تلقائيًا
  const latestPending = db.appointments().filter((a) => a.status === 'new' && (!doctorId || a.therapistId === doctorId)).sort((a, b) => b.createdAt - a.createdAt)[0];
  const shown = selected ? (db.appointment(selected.id) ?? selected) : latestPending;
  const lp = shown ? { p: db.patient(shown.patientId), svc: db.service(shown.serviceId), th: db.therapist(shown.therapistId) } : null;
  const shownStatus = shown ? APPT_STATUS[shown.status] : null;

  const scheduleList = tab === 'confirmed' ? confirmedToday : tab === 'pending' ? pendingToday : activeToday;
  // حساب دكتور: «دكتور + الاسم + جملة تحفيز» ومرضاه (جلسات/كشوفات) بدل عدّادات المركز
  const doctorName = doctorId ? db.therapist(doctorId)?.name ?? user.name : '';

  return (
    <div className="page">
      {doctorModal}
      <div className="page-head">
        {doctorId ? <div>
            <div style={{ fontSize: 15, fontWeight: 600, color: 'var(--muted)', marginBottom: 2 }}>{dayGreeting()}</div>
            <h1 style={{ marginBottom: 6 }}>{doctorTitle(doctorName)}</h1>
            <p style={{ fontSize: 15.5, fontWeight: 600, color: 'var(--brand-700)', margin: 0 }}>{dailyMotivation()}</p>
          </div>
          : <div><h1>مرحبًا، {user.name.split(' ')[0]}</h1><p>نظرة سريعة على أداء المركز اليوم.</p></div>}
        {canBook && <Button icon="calendarPlus" onClick={() => setBooking(true)}>حجز موعد جديد</Button>}
      </div>

      {doctorId ? <DoctorPatients therapistId={doctorId} /> : loading ? (
        <div className="kpi-grid">{Array.from({ length: 4 }).map((_, i) => <div key={i} className="card kpi"><Skeleton h={38} w={38} r={11} /><Skeleton h={22} w={60} /><Skeleton h={12} w={80} /></div>)}</div>
      ) : (
        <>
          <div className="kpi-grid">
            <Kpi icon="trend" tone="brand" value={`${confirmationRate}%`} label="نسبة التأكيد" />
            <Kpi icon="clock" tone="warn" value={pendingToday.length} label="قيد الانتظار" />
            <Kpi icon="checkCircle" tone="ok" value={confirmedToday.length} label="مؤكدة" />
            <Kpi icon="calendar" tone="info" value={activeToday.length} label="مواعيد" />
          </div>
          <div className="kpi-grid">
            <Kpi icon="checkCircle" tone="ok" value={completedToday} label="مكتملة اليوم" />
            {(user.role === 'system_admin' || user.role === 'center_manager') && <Kpi icon="users" tone="info" value={totalPatients} label="إجمالي المرضى" />}
            {revenueMonth !== null && <Kpi icon="wallet" tone="ok" value={money(revenueMonth)} label="إيرادات الشهر" />}
            {dueTotal !== null && <Kpi icon="receipt" tone="warn" value={money(dueTotal)} label="المبالغ المستحقة غير المحصّلة" />}
            <Kpi icon="bell" tone="brand" value={alerts} label="التنبيهات غير المقروءة" />
          </div>
          {(dueTotal ?? 0) > 0 && (
            <div className="alert alert-warn" style={{ marginBottom: 18 }}>
              <Icon name="receipt" size={17} />
              <div style={{ flex: 1 }}>مبالغ مستحقة غير محصّلة: <strong className="num">{money(dueTotal ?? 0)}</strong></div>
              <Link to="/invoices" className="link-more">عرض الفواتير <Icon name="chevron" size={14} /></Link>
            </div>
          )}
        </>
      )}

      <DailySchedule onOpen={(a) => setDetail(a)} onBook={canBook ? setSlotBooking : undefined} onlyDoctorId={doctorId || undefined} />

      <div className="dash-cols">
        <section className="card dash-col--wide">
          <div className="card__head row-between" style={{ flexWrap: 'wrap' }}>
            <h2>جدول اليوم</h2>
            <div className="svc-tabs" style={{ marginBottom: 0 }}>
              <button type="button" className={`svc-tab ${tab === 'all' ? 'active' : ''}`} onClick={() => setTab('all')}>الكل</button>
              <button type="button" className={`svc-tab ${tab === 'confirmed' ? 'active' : ''}`} onClick={() => setTab('confirmed')}>مؤكد</button>
              <button type="button" className={`svc-tab ${tab === 'pending' ? 'active' : ''}`} onClick={() => setTab('pending')}>قيد الانتظار</button>
            </div>
            <Link to="/appointments" className="link-more">عرض الكل <Icon name="chevron" size={15} /></Link>
          </div>
          <div className="card__body">
            {loading ? <Skeleton h={140} /> : scheduleList.length === 0 ? (
              <EmptyState icon="calendarPlus" title="ما فيه مواعيد في هذا التصنيف" text={tab === 'all' ? 'احجز موعد جديد وسيظهر هنا فورًا.' : undefined}
                action={tab === 'all' && canBook ? <Button icon="calendarPlus" onClick={() => setBooking(true)}>حجز موعد جديد</Button> : undefined} />
            ) : (
              <div className="timeline">
                {scheduleList.map((a) => {
                  const p = db.patient(a.patientId); const svc = db.service(a.serviceId); const th = db.therapist(a.therapistId); const st = APPT_STATUS[a.status];
                  return (
                    <div className="tl-row" key={a.id}>
                      <div className="tl-time num">{fmtTime(a.time)}</div>
                      <div
                        className={`tl-card st-${a.status} ${shown?.id === a.id ? 'tl-card--active' : ''}`}
                        style={{ cursor: 'pointer' }}
                        onClick={() => setSelected(a)}
                      >
                        <div className="tl-card__info">
                          <strong>{p?.fullName}</strong>
                          <span className="muted-sm">{svc?.name} · {th?.name}</span>
                        </div>
                        <StatusBadge label={st.label} tone={st.tone} />
                        {CONFIRMABLE.includes(a.status) && attendanceOpen(a) && canConfirmAppt && <IconAction icon="check" label="تأكيد" onClick={() => confirmAppt(a)} />}
                        <IconAction icon="edit" label="التفاصيل" onClick={() => setDetail(a)} />
                      </div>
                    </div>
                  );
                })}
              </div>
            )}
          </div>
        </section>

        <section className="card dash-col--narrow">
          <div className="card__head">
            <h2>{selected ? 'الموعد المحدّد' : 'أحدث حجز'}</h2>
            {shown && shownStatus && <StatusBadge label={shown.status === 'new' ? 'بانتظار تأكيدك' : shownStatus.label} tone={shown.status === 'new' ? 'warn' : shownStatus.tone} />}
          </div>
          <div className="card__body">
            {loading ? <Skeleton h={140} /> : !shown || !lp ? (
              <EmptyState icon="calendarPlus" title="ما فيه حجوزات بانتظار التأكيد" />
            ) : (
              <>
                {selected && <Button variant="ghost" size="sm" icon="close" onClick={() => setSelected(null)} style={{ marginBottom: 8 }}>رجوع لأحدث حجز</Button>}
                <div style={{ display: 'flex', gap: 12, alignItems: 'center', marginBottom: 14 }}>
                  <span className="avatar">{lp.p ? initials(lp.p.fullName) : '؟'}</span>
                  <div style={{ minWidth: 0 }}>
                    <strong style={{ display: 'block' }}>{lp.p?.fullName ?? '—'}</strong>
                    <span className="muted num" style={{ fontSize: 13 }}>{lp.p?.phone}</span>
                  </div>
                </div>
                <dl className="dl" style={{ marginBottom: 16 }}>
                  <div><dt>الخدمة</dt><dd>{lp.svc?.name} ({APPT_TYPE_LABEL[shown.type]})</dd></div>
                  <div><dt>المعالج</dt><dd>{lp.th?.name ?? '—'}</dd></div>
                  <div><dt>التاريخ والوقت</dt><dd className="num">{fmtDate(shown.date)} · {fmtTime(shown.time)}</dd></div>
                </dl>
                {CONFIRMABLE.includes(shown.status) && attendanceOpen(shown) && canConfirmAppt ? (
                  <Button style={{ width: '100%' }} icon="check" onClick={() => confirmAppt(shown)}>تأكيد</Button>
                ) : (
                  <Button style={{ width: '100%' }} variant="outline" onClick={() => setDetail(shown)}>عرض التفاصيل</Button>
                )}
              </>
            )}
          </div>
        </section>
      </div>

      {booking && <BookingWizard onClose={() => setBooking(false)} />}
      {slotBooking && <BookingWizard presetTherapistId={slotBooking.therapistId} presetDate={slotBooking.date} presetTime={slotBooking.time} onClose={() => setSlotBooking(null)} />}
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
      {deleting && (
        <ConfirmDialog title="حذف الموعد" onClose={() => setDeleting(null)}
          message={`سيتم حذف الموعد ${deleting.no} وفاتورته غير المدفوعة نهائيًا. للاحتفاظ بالسجل استخدم «إلغاء الموعد» بدل الحذف.`}
          onConfirm={async () => { const r = await db.deleteAppointment(deleting.id); if (r.ok) toast.success('تم حذف الموعد.'); else toast.error(r.error); }} />
      )}
      {planningFor && <PlanModal patientId={planningFor.patientId} presetServiceId={planningFor.serviceId} onClose={() => setPlanningFor(null)} />}
    </div>
  );
}
