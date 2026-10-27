import { ARABIC_NAME_ERROR, isArabicName, nameWords } from '../../utils/patientGaps';
import { PAY_STATE, payStateOf, type InstallmentRequest } from '../../data/installments';
import { useEffect, useMemo, useRef, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { Button, EmptyState, Input, Modal, Select, Skeleton, StatusBadge } from '../../components/ui';
import { ConfirmDialog } from '../../components/common';
import { StatCard } from '../../components/StatCard';
import { useToast } from '../../hooks/useToast';
import { useAsync } from '../../hooks/useAsync';
import { useAuth } from '../../services/auth';
import { useLive } from '../../components/PatientLayout';
import { DOCTOR_DAY_MESSAGE, patientApi, ymd, type Catalog, type DoctorDaySlots, type PatientAppointment } from '../../data/patientApi';
import { APPT_STATUS, INVOICE_STATUS, PACKAGE_STATUS, PLAN_STATUS, fmtDate, fmtDateTime, fmtTime, money, todayYmd } from '../../utils/format';
import { Icon } from '../../utils/icons';
import type { Invoice, PatientFile } from '../../types';
import { fileNoText } from '../../utils/phoneUtils';
import { PushStatusCard } from '../../pwa/PushStatusCard';

const ErrorBox = ({ text, retry }: { text: string; retry: () => void }) => (
  <div className="card"><div className="card__body"><EmptyState icon="alert" title="حدث خطأ، حاول مرة ثانية" text={text} action={<Button variant="outline" icon="refresh" onClick={retry}>إعادة المحاولة</Button>} /></div></div>
);
const Head = ({ title, text, action }: { title: string; text?: string; action?: React.ReactNode }) => (
  <div className="page-head"><div><h1>{title}</h1>{text && <p>{text}</p>}</div>{action}</div>
);
const ACTIVE = ['new', 'confirmed', 'rescheduled'];
const REDEEM_POINTS = 30;

function PointsKpi({ live }: { live: number }) {
  const s = useAsync(() => patientApi.loyaltySummary(), [live]);
  if (s.loading && !s.data) return <div className="card kpi"><Skeleton h={38} w={38} r={11} /><Skeleton h={22} w={60} /></div>;
  if (s.error || !s.data) return null;
  return <Link to="/me/points" style={{ textDecoration: 'none' }}><StatCard icon="spark" tone="brand" value={s.data.balance} label="نقاطي" /></Link>;
}

const LOYALTY_KIND_LABEL: Record<string, string> = { session: 'نقاط جلسة', plan_session: 'نقاط جلسة خطة', package: 'نقاط باقة', redeem: 'استبدال نقاط', adjust: 'تعديل إداري' };

// ============ الرئيسية ============
export function PatientDashboard() {
  const live = useLive();
  const { patient } = useAuth();
  const dash = useAsync(() => patientApi.dashboard(), [live]);
  const appts = useAsync(() => patientApi.appointments(), [live]);
  const plans = useAsync(() => patientApi.plans(), [live]);
  const d = dash.data;
  const prev = (appts.data ?? []).filter((a) => !ACTIVE.includes(a.status)).slice(0, 4);
  const activePlan = (plans.data ?? []).find((p) => p.status === 'active');

  return (
    <div className="page">
      <Head title={`مرحبًا، ${patient?.name.split(' ')[0] ?? ''} 👋`} text="نظرة سريعة على مواعيدك وحسابك." action={<Link to="/me/book"><Button icon="calendarPlus">حجز موعد</Button></Link>} />
      {dash.error ? <ErrorBox text={dash.error} retry={dash.reload} /> : dash.loading && !d ? (
        <div className="kpi-grid">{Array.from({ length: 4 }).map((_, i) => <div key={i} className="card kpi"><Skeleton h={38} w={38} r={11} /><Skeleton h={22} w={60} /></div>)}</div>
      ) : d && (
        <div className="kpi-grid">
          <StatCard icon="calendar" tone="brand" value={d.upcomingAppointments} label="مواعيد قادمة" />
          <StatCard icon="checkCircle" tone="ok" value={d.completedAppointments} label="زيارات مكتملة" />
          <StatCard icon="target" tone="info" value={d.activePlans} label="خطط علاج نشطة" />
          <StatCard icon="receipt" tone="warn" value={money(d.dueAmount)} label={`مستحق (${d.dueInvoices} فاتورة)`} />
          <PointsKpi live={live} />
        </div>
      )}

      <div className="grid-2">
        <section className="card">
          <div className="card__head"><h2>موعدك القادم</h2><Link to="/me/appointments" className="link-more">كل المواعيد <Icon name="chevron" size={15} /></Link></div>
          <div className="card__body">
            {d?.next ? (
              <div className="tl-card" style={{ borderInlineStartColor: 'var(--brand)' }}>
                <div className="tl-card__info"><strong>{d.next.service}</strong><span className="muted-sm">{fmtDate(d.next.date)} — <span className="num">{fmtTime(d.next.time)}</span>{d.next.doctor ? ` — ${d.next.doctor}` : ''}</span></div>
                <StatusBadge label={APPT_STATUS[d.next.status as keyof typeof APPT_STATUS]?.label ?? d.next.status} tone={APPT_STATUS[d.next.status as keyof typeof APPT_STATUS]?.tone ?? 'muted'} />
              </div>
            ) : <EmptyState icon="calendarPlus" title="ما فيه مواعيد قادمة" text="احجز موعدك الحين." action={<Link to="/me/book"><Button icon="calendarPlus">حجز موعد</Button></Link>} />}
          </div>
        </section>
        <section className="card">
          <div className="card__head"><h2>خطتك العلاجية</h2><Link to="/me/plans" className="link-more">التفاصيل <Icon name="chevron" size={15} /></Link></div>
          <div className="card__body">
            {activePlan ? (
              <>
                <strong>{activePlan.diagnosis}</strong>
                <div className="muted-sm" style={{ margin: '4px 0 10px' }}>{activePlan.totalSessions} جلسات — تبدأ {fmtDate(activePlan.startDate)}</div>
                <div className="progress"><i style={{ width: `${activePlan.progressPct}%` }} /></div>
                <div className="muted-sm num" style={{ marginTop: 6 }}>{activePlan.progressPct}% مكتمل</div>
              </>
            ) : <EmptyState icon="target" title="ما فيه خطة علاج نشطة" />}
          </div>
        </section>
      </div>

      <section className="card" style={{ marginTop: 18 }}>
        <div className="card__head"><h2>المواعيد السابقة</h2></div>
        <div className="card__body">
          {appts.loading && !appts.data ? <Skeleton h={80} /> : prev.length === 0 ? <EmptyState icon="calendar" title="ما فيه مواعيد سابقة" /> : (
            <div className="table-wrap"><table className="table"><thead><tr><th>التاريخ</th><th>الخدمة</th><th>الطبيب</th><th>الحالة</th></tr></thead>
              <tbody>{prev.map((a) => <tr key={a.id}><td>{fmtDate(a.date)}</td><td>{a.service}</td><td>{a.doctor ?? '—'}</td><td><StatusBadge label={APPT_STATUS[a.status as keyof typeof APPT_STATUS]?.label ?? a.status} tone={APPT_STATUS[a.status as keyof typeof APPT_STATUS]?.tone ?? 'muted'} /></td></tr>)}</tbody></table></div>
          )}
        </div>
      </section>
    </div>
  );
}

// ============ حجز موعد ============
// الدكتور إجباري: مفيش أوقات تتعرض قبل اختياره، والأوقات بتيجي من الخادم لدكتور محدد
// (ساعات المركز + العطلات + إجازته + حجوزاته هو بس) وبتتجدد لحظيًا مع أي حجز/إلغاء (useLive)
type SlotsState = (DoctorDaySlots & { error?: string }) | null;
function useDoctorSlots(doctorId: string, serviceId: string, date: string, refresh: number): SlotsState {
  const [res, setRes] = useState<SlotsState>(null);
  useEffect(() => {
    if (!doctorId || !serviceId || !date) { setRes(null); return; }
    let on = true;
    setRes(null);
    patientApi.doctorSlots(doctorId, serviceId, date).then((r) => on && setRes(r)).catch((e) => on && setRes({ status: 'closed', slots: [], error: (e as Error).message }));
    return () => { on = false; };
  }, [doctorId, serviceId, date, refresh]);
  return res;
}

function DoctorSlotsView({ res, time, onPick, own }: { res: SlotsState; time: string; onPick: (t: string) => void; own?: { date: string; time: string; day: string } }) {
  if (res === null) return <Skeleton h={44} />;
  if (res.error) return <p className="muted">تعذّر تحميل المواعيد — حاول مرة ثانية.</p>;
  if (res.status !== 'ok') return <p className="muted">{DOCTOR_DAY_MESSAGE[res.status]}</p>;
  const isOwn = (t: string) => !!own && own.date === own.day && own.time === t;
  const free = res.slots.filter((s) => s.available || isOwn(s.time));
  return (
    <>
      {res.doctorFrom && res.doctorTo && <p className="muted-sm" style={{ margin: '0 0 8px' }}>دوام الدكتور في هاليوم: <span className="num">{fmtTime(res.doctorFrom)} – {fmtTime(res.doctorTo)}</span></p>}
      {!free.length && <p className="muted">ما فيه مواعيد متاحة لهذا الدكتور في هاليوم — جرّب يوم ثاني.</p>}
      <div className="slots">{res.slots.filter((s) => !s.past).map((s) => (s.available || isOwn(s.time))
        ? <button key={s.time} type="button" className={`slot ${time === s.time ? 'selected' : ''}`} onClick={() => onPick(s.time)}>{fmtTime(s.time)}</button>
        : s.past ? <button key={s.time} type="button" className="slot slot--taken" disabled title="فات">{fmtTime(s.time)} · فات</button>
        : <button key={s.time} type="button" className="slot slot--taken" disabled title="محجوز">✕ {fmtTime(s.time)}</button>)}</div>
    </>
  );
}

const BOOK_STEPS = ['الدكتور', 'الخدمة', 'الموعد', 'التأكيد'];

const nameOk = (s: string) => nameWords(s) >= 3 && isArabicName(s); // ثلاثي وبالعربي — نفس الخادم (هجرة 162)

export function PatientBook() {
  const toast = useToast();
  const navigate = useNavigate();
  const live = useLive();
  const cat = useAsync(() => patientApi.catalog(), []);
  const [step, setStep] = useState(0);
  const [doctorId, setDoctorId] = useState(''); // مفيش قيمة افتراضية ولا «أي دكتور» — لازم المريض يختار بنفسه
  const [serviceId, setServiceId] = useState('');
  const [priceId, setPriceId] = useState('');
  const [date, setDate] = useState('');
  const [time, setTime] = useState('');
  const [notes, setNotes] = useState('');
  const [name, setName] = useState('');
  const [tick, setTick] = useState(0);
  const me = useAsync(() => patientApi.me(), []);
  // الاسم والجوال من ملف المريض المحفوظ — مابيتطلبوش في كل حجز. الاسم بيتطلب مرة واحدة بس لو مش ثلاثي، ويتحفظ في الملف
  const savedName = (me.data?.patient?.full_name ?? '').trim();
  const savedPhone = me.data?.patient?.phone || me.data?.customer?.phone || '';
  const needName = !!me.data && !nameOk(savedName);
  useEffect(() => { if (me.data) setName((v) => v || (isArabicName(savedName) ? savedName : '')); }, [me.data]);
  const [busy, setBusy] = useState(false);
  const [done, setDone] = useState<{ no: string; doctor: string } | null>(null);

  // حجز بدأه الزائر من الموقع العام قبل تسجيل الدخول: نُكمله تلقائيًا (يبقى عليه التأكيد فقط)
  useEffect(() => {
    try {
      const raw = sessionStorage.getItem('ortho_pending_book');
      if (!raw) return;
      sessionStorage.removeItem('ortho_pending_book');
      const p = JSON.parse(raw);
      setDoctorId(p.therapistId ?? ''); setServiceId(p.serviceId ?? ''); setPriceId(p.priceId ?? ''); setDate(p.date ?? ''); setTime(p.time ?? ''); setNotes(p.notes ?? '');
      if (p.therapistId && p.serviceId && p.date && p.time) setStep(3);
      toast.info('أكملنا اختيارك من الموقع — راجعه ثم اضغط «تأكيد الحجز».');
    } catch { /* ignore */ }
  }, []);

  const c = cat.data;
  const doctor = c?.doctors.find((d) => d.id === doctorId) ?? null;
  // الحجز الأونلاين لخدمات «الكشف» بس (الخادم بيرفض غيرها — هجرة 163)
  const offered = c && doctor ? c.services.filter((s) => /كشف/.test(s.name) && (!doctor.serviceIds || doctor.serviceIds.includes(s.id))) : [];
  const service = offered.find((s) => s.id === serviceId) ?? null;
  const slots = useDoctorSlots(doctor && service ? doctor.id : '', service?.id ?? '', date, live + tick);
  const price = service ? (service.prices.find((p) => p.id === priceId)?.price ?? service.price) : 0;

  const pickDoctor = (id: string) => {
    setDoctorId(id); setTime('');
    const d = c?.doctors.find((x) => x.id === id);
    if (d?.serviceIds && !d.serviceIds.includes(serviceId)) { setServiceId(''); setPriceId(''); }
  };
  const canNext = [!!doctor, !!service, !!date && !!time, true][step];
  const blockedMsg = ['يرجى اختيار الدكتور أولًا', 'يرجى اختيار الخدمة أولًا', 'يرجى اختيار التاريخ والوقت أولًا', ''][step];
  const next = () => { if (!canNext) { toast.error(blockedMsg); return; } setStep((s) => Math.min(s + 1, BOOK_STEPS.length - 1)); };

  const submit = async () => {
    if (!doctor) { toast.error('يرجى اختيار الدكتور أولًا'); setStep(0); return; }
    if (!service || !date || !time) { toast.error('أكمل اختيار الخدمة والتاريخ والوقت.'); return; }
    if (needName && !nameOk(name)) { toast.error(ARABIC_NAME_ERROR); return; }
    setBusy(true);
    try {
      if (needName) { await patientApi.updateProfile({ fullName: name.trim().replace(/\s+/g, ' ') }); me.reload(); }
      const r = await patientApi.book({ therapistId: doctor.id, serviceId: service.id, date, time, notes: notes.trim(), priceId: priceId || undefined });
      setDone({ no: r.no, doctor: r.doctor || doctor.name });
      toast.success('تم استلام حجزك.');
    } catch (e) {
      // موعد اتحجز للتو (أو أي رفض من الخادم): نرجّعه لاختيار الوقت ونحدّث المواعيد فورًا
      toast.error((e as Error).message); setTime(''); setStep(2); setTick((t) => t + 1);
    }
    finally { setBusy(false); }
  };

  if (done) return (
    <div className="page"><div className="card"><div className="card__body"><div className="success" style={{ textAlign: 'center' }}>
      <div className="mark"><Icon name="check" size={30} /></div>
      <h1 style={{ fontSize: 20 }}>✅ تم استلام حجزك</h1>
      <p className="muted">رقم الموعد <strong className="num">{done.no}</strong> مع {done.doctor} — سيؤكده المركز وسيصلك إشعار.</p>
      <div style={{ display: 'flex', gap: 8, justifyContent: 'center', marginTop: 14 }}>
        <Button variant="outline" onClick={() => { setDone(null); setStep(0); setDoctorId(''); setServiceId(''); setDate(''); setTime(''); setNotes(''); }}>حجز موعد آخر</Button>
        <Button onClick={() => navigate('/me/appointments')}>مواعيدي</Button>
      </div>
    </div></div></div></div>
  );

  return (
    <div className="page">
      <Head title="حجز موعد" text="اختر الدكتور أولًا — تظهر لك مواعيده المتاحة فقط." />
      {cat.error ? <ErrorBox text={cat.error} retry={cat.reload} /> : cat.loading || !c ? <Skeleton h={220} /> : (
        <>
          <div className="steps">
            {BOOK_STEPS.map((label, i) => (
              <div key={label} style={{ display: 'contents' }}>
                <div className={`step-dot ${i === step ? 'active' : ''} ${i < step ? 'done' : ''}`}>
                  <span className="step-dot__n">{i < step ? <Icon name="check" size={13} /> : i + 1}</span>
                  <span className="hide-sm">{label}</span>
                </div>
                {i < BOOK_STEPS.length - 1 && <span className="step-sep" />}
              </div>
            ))}
          </div>

          {step === 0 && (
            <div className="form-section">
              <div className="form-section-title">اختر الدكتور <span style={{ color: 'var(--danger)' }}>*</span></div>
              {c.doctors.length === 0 ? <p className="muted">ما فيه دكتور متاح للحجز حاليًا — تواصل مع المركز.</p> : (
                <div className="choice-grid choice-grid--compact" role="radiogroup" aria-label="اختر الدكتور" aria-required="true">
                  {c.doctors.map((d) => (
                    <button key={d.id} type="button" role="radio" aria-checked={doctorId === d.id} className={`choice ${doctorId === d.id ? 'selected' : ''}`} onClick={() => pickDoctor(d.id)}>
                      <span style={{ flex: 1, minWidth: 0 }}><strong>{d.name}</strong>{d.title && <span>{d.title}</span>}</span>
                      {doctorId === d.id && <Icon name="check" size={18} />}
                    </button>
                  ))}
                </div>
              )}
              {!doctor && <p className="muted" style={{ marginTop: 10 }}>يرجى اختيار الدكتور لعرض المواعيد المتاحة</p>}
            </div>
          )}

          {step === 1 && doctor && (
            <>
              <div className="form-section">
                <div className="form-section-title">الخدمة مع {doctor.name}</div>
                {offered.length === 0 ? <p className="muted">هذا الدكتور ما يقدّم أي خدمة حاليًا — اختر دكتور ثاني.</p> : (
                  <div className="choice-grid choice-grid--compact">
                    {offered.map((s) => (
                      <button key={s.id} type="button" className={`choice ${serviceId === s.id ? 'selected' : ''}`} onClick={() => { setServiceId(s.id); setPriceId(''); setTime(''); }}>
                        <span style={{ flex: 1, minWidth: 0 }}><strong>{s.name}</strong><span>{s.durationMin} دقيقة</span></span>
                        <span className="choice__price num">{money(s.price)}</span>
                      </button>
                    ))}
                  </div>
                )}
              </div>
              {service && service.prices.length > 0 && (
                <div className="form-section">
                  <div className="form-section-title">السعر</div>
                  <div className="svc-tabs">
                    <button type="button" className={`svc-tab ${!priceId ? 'active' : ''}`} onClick={() => setPriceId('')}>السعر العادي — {money(service.price)}</button>
                    {service.prices.map((p) => <button key={p.id} type="button" className={`svc-tab ${priceId === p.id ? 'active' : ''}`} onClick={() => setPriceId(p.id)}>{p.label} — {money(p.price)}</button>)}
                  </div>
                </div>
              )}
            </>
          )}

          {step === 2 && doctor && service && (
            <div className="form-section">
              <div className="form-section-title">المواعيد المتاحة لـ {doctor.name}</div>
              <Input id="pb-date" label="التاريخ" type="date" min={todayYmd()} value={date} onChange={(e) => { setDate(e.target.value); setTime(''); }} />
              {date ? <DoctorSlotsView res={slots} time={time} onPick={setTime} /> : <p className="muted">اختر التاريخ لعرض مواعيد {doctor.name}.</p>}
            </div>
          )}

          {step === 3 && doctor && service && (
            <div className="form-section">
              <div className="form-section-title">بياناتك</div>
              {needName ? (
                <>
                  <Input id="pb-name" label="اسمك الثلاثي بالعربي * (الاسم واسم الأب واسم الجد)" value={name} onChange={(e) => setName(e.target.value)} required />
                  <p className="muted-sm" style={{ marginTop: -6 }}>يُحفظ في ملفك مرة واحدة ولن يُطلب مرة ثانية في الحجوزات القادمة.</p>
                </>
              ) : (
                <dl className="review-list" style={{ marginBottom: 14 }}>
                  <div><dt>الاسم</dt><dd>{savedName}</dd></div>
                  <div><dt>الجوال</dt><dd className="num" dir="ltr">{savedPhone}</dd></div>
                </dl>
              )}
              <div className="field"><label htmlFor="pb-notes">ملاحظات (اختياري)</label><textarea id="pb-notes" className="input" rows={2} value={notes} onChange={(e) => setNotes(e.target.value)} placeholder="مثال: ألم أسفل الظهر منذ أسبوعين" /></div>
              <dl className="review-list" style={{ marginTop: 14 }}>
                <div><dt>الدكتور</dt><dd>{doctor.name}</dd></div>
                <div><dt>الخدمة</dt><dd>{service.name}</dd></div>
                <div><dt>التاريخ</dt><dd>{fmtDate(date)}</dd></div>
                <div><dt>الوقت</dt><dd className="num">{fmtTime(time)}</dd></div>
              </dl>
              <div className="review-total" style={{ marginTop: 14 }}><span>{service.name}</span><strong className="num">{money(price)}</strong></div>
            </div>
          )}

          <div style={{ display: 'flex', gap: 8, marginTop: 14 }}>
            {step > 0 && <Button variant="outline" onClick={() => setStep((s) => s - 1)} disabled={busy}>رجوع</Button>}
            <span style={{ flex: 1 }} />
            {step < BOOK_STEPS.length - 1
              ? <Button onClick={next} aria-disabled={!canNext} style={canNext ? undefined : { opacity: 0.55 }}>التالي</Button>
              : <Button icon="check" onClick={submit} loading={busy}>تأكيد الحجز</Button>}
          </div>
        </>
      )}
    </div>
  );
}

// ============ مواعيدي ============
function RescheduleModal({ appt, cat, onClose, onDone }: { appt: PatientAppointment; cat: Catalog; onClose: () => void; onDone: () => void }) {
  const toast = useToast();
  const doctor = cat.doctors.find((d) => d.id === appt.therapist_id) ?? null;
  const [date, setDate] = useState('');
  const [time, setTime] = useState('');
  const [busy, setBusy] = useState(false);
  const slots = useDoctorSlots(doctor ? doctor.id : '', appt.service_id, date, 0);
  const submit = async () => {
    setBusy(true);
    try { await patientApi.reschedule(appt.id, date, time); toast.success('تم تعديل الموعد.'); onDone(); onClose(); }
    catch (e) { toast.error((e as Error).message); } finally { setBusy(false); }
  };
  return (
    <Modal title={`تعديل الموعد ${appt.no}`} onClose={onClose} footer={<><Button variant="outline" onClick={onClose} disabled={busy}>إلغاء</Button><Button icon="check" onClick={submit} loading={busy} disabled={!doctor || !date || !time}>حفظ الموعد الجديد</Button></>}>
      <p className="muted" style={{ marginBottom: 12 }}>الموعد الحالي: {fmtDate(appt.date)} {fmtTime(appt.time)} — {appt.doctor}</p>
      <Input id="rs-date" label="التاريخ الجديد" type="date" min={todayYmd()} value={date} onChange={(e) => { setDate(e.target.value); setTime(''); }} />
      {!doctor ? <p className="muted">هذا الموعد بدون دكتور محدد — تواصل مع المركز لتعديله.</p> : date && <DoctorSlotsView res={slots} time={time} onPick={setTime} own={{ date: appt.date, time: appt.time, day: date }} />}
    </Modal>
  );
}

// سجل كشوفات المريض: كل مواعيده اللي خدمتها «كشف» (من الأحدث للأقدم)
export function PatientExams() {
  const live = useLive();
  const list = useAsync(() => patientApi.appointments(), [live]);
  const exams = (list.data ?? []).filter((a) => (a.service ?? '').includes('كشف')).sort((a, b) => (a.date + a.time < b.date + b.time ? 1 : -1));
  const done = exams.filter((a) => ['arrived', 'in_progress', 'completed'].includes(a.status)).length;
  return (
    <div className="page">
      <Head title="سجل الكشوفات" text={exams.length ? `${exams.length} كشف — تم منها ${done}.` : 'كشوفاتك السابقة والقادمة.'} />
      {list.error ? <ErrorBox text={list.error} retry={list.reload} /> : list.loading && !list.data ? <Skeleton h={120} /> : exams.length === 0 ? (
        <div className="card"><div className="card__body"><EmptyState icon="stethoscope" title="ما فيه كشوفات" text="ما عندك أي كشف مسجّل للحين." /></div></div>
      ) : (
        <div className="card"><div className="card__body"><div className="cm-history">{exams.map((a) => {
          const st = APPT_STATUS[a.status as keyof typeof APPT_STATUS];
          return (
            <article key={a.id} className="cm-item">
              <div className="row-between"><strong>{a.service}</strong>{st && <StatusBadge label={st.label} tone={st.tone} />}</div>
              <p><span className="num">{fmtDate(a.date)} · {fmtTime(a.time)}</span>{a.doctor ? <> — <span data-no-i18n>{a.doctor}</span></> : null}</p>
              {a.status === 'cancelled' && a.cancel_reason && <p className="muted">سبب الإلغاء: {a.cancel_reason}</p>}
            </article>
          );
        })}</div></div></div>
      )}
    </div>
  );
}

export function PatientAppointments() {
  const live = useLive();
  const toast = useToast();
  const list = useAsync(() => patientApi.appointments(), [live]);
  const cat = useAsync(() => patientApi.catalog(), []);
  const [tab, setTab] = useState<'up' | 'past'>('up');
  const [cancel, setCancel] = useState<PatientAppointment | null>(null);
  const [resched, setResched] = useState<PatientAppointment | null>(null);
  const rows = (list.data ?? []).filter((a) => (tab === 'up' ? ACTIVE.includes(a.status) : !ACTIVE.includes(a.status)));
  const upCount = (list.data ?? []).filter((a) => ACTIVE.includes(a.status)).length;
  const hrs = cat.data?.center.cancelBeforeHours ?? 24;

  return (
    <div className="page">
      <Head title="مواعيدي" text={`تقدر تعدّل أو إلغاء الموعد قبله بـ ${hrs} ساعة على الأقل.`} action={<Link to="/me/book"><Button icon="calendarPlus">حجز موعد</Button></Link>} />
      <div className="card">
        <div className="tabs"><button className={`tab ${tab === 'up' ? 'active' : ''}`} onClick={() => setTab('up')}>القادمة <span className="tab-count num">{upCount}</span></button><button className={`tab ${tab === 'past' ? 'active' : ''}`} onClick={() => setTab('past')}>السابقة</button></div>
        <div className="card__body">
          <PushStatusCard />
      {list.error ? <ErrorBox text={list.error} retry={list.reload} /> : list.loading && !list.data ? <Skeleton h={120} /> : rows.length === 0 ? <EmptyState icon="calendar" title="ما فيه مواعيد" /> : (
            <div className="table-wrap"><table className="table">
              <thead><tr><th>رقم الموعد</th><th>التاريخ</th><th>الوقت</th><th>الخدمة</th><th>الطبيب</th><th>الحالة</th><th className="actions"></th></tr></thead>
              <tbody>{rows.map((a) => { const st = APPT_STATUS[a.status as keyof typeof APPT_STATUS]; return (
                <tr key={a.id}><td className="num">{a.no}</td><td>{fmtDate(a.date)}</td><td className="num">{fmtTime(a.time)}</td><td>{a.service}</td><td>{a.doctor ?? '—'}</td>
                  <td><StatusBadge label={st?.label ?? a.status} tone={st?.tone ?? 'muted'} /></td>
                  <td className="actions">{ACTIVE.includes(a.status) && <span style={{ display: 'flex', gap: 6 }}>
                    <Button size="sm" variant="outline" onClick={() => setResched(a)} disabled={!cat.data}>تعديل</Button>
                    <Button size="sm" variant="soft-danger" onClick={() => setCancel(a)}>إلغاء</Button></span>}</td></tr>); })}</tbody>
            </table></div>
          )}
        </div>
      </div>
      {resched && cat.data && <RescheduleModal appt={resched} cat={cat.data} onClose={() => setResched(null)} onDone={list.reload} />}
      {cancel && <ConfirmDialog title="إلغاء الموعد" confirmLabel="نعم، إلغاء الموعد" message={`هل أنت متأكد من إلغاء موعدك رقم ${cancel.no} بتاريخ ${fmtDate(cancel.date)}؟`}
        onClose={() => setCancel(null)}
        onConfirm={async () => { try { await patientApi.cancel(cancel.id); toast.success('تم إلغاء الموعد.'); list.reload(); } catch (e) { toast.error((e as Error).message); } }} />}
    </div>
  );
}

// ============ ملفي ============
function ProfileModal({ p, onClose, onDone }: { p: any; onClose: () => void; onDone: () => void }) {
  const toast = useToast();
  const [f, setF] = useState({ fullName: p.full_name ?? '', email: p.email ?? '', gender: p.gender ?? 'male', birthDate: p.birth_date ?? '', city: p.city ?? '', district: p.district ?? '', street: p.street ?? '', address: p.address ?? '', emergencyContactName: p.emergency_contact_name ?? '', emergencyContactPhone: p.emergency_contact_phone ?? '' });
  const [busy, setBusy] = useState(false);
  const set = (k: keyof typeof f, v: string) => setF((x) => ({ ...x, [k]: v }));
  const submit = async () => {
    if (!nameOk(f.fullName)) { toast.error(ARABIC_NAME_ERROR); return; }
    if (f.email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(f.email)) { toast.error('البريد الإلكتروني غير صحيح.'); return; }
    setBusy(true);
    try { await patientApi.updateProfile(f); toast.success('تم حفظ البيانات بنجاح.'); onDone(); onClose(); } catch (e) { toast.error((e as Error).message); } finally { setBusy(false); }
  };
  return (
    <Modal title="تعديل بياناتي" onClose={onClose} footer={<><Button variant="outline" onClick={onClose} disabled={busy}>إلغاء</Button><Button onClick={submit} loading={busy}>حفظ</Button></>}>
      <Input id="pf-name" label="الاسم الثلاثي بالعربي *" value={f.fullName} onChange={(e) => set('fullName', e.target.value)} />
      <div className="grid-form"><Input id="pf-email" label="البريد الإلكتروني" dir="ltr" value={f.email} onChange={(e) => set('email', e.target.value)} />
        <Select id="pf-gender" label="الجنس" value={f.gender} onChange={(e) => set('gender', e.target.value)} options={[{ value: 'male', label: 'رجل' }, { value: 'female', label: 'امرأة' }]} /></div>
      <div className="grid-form"><Input id="pf-birth" label="تاريخ الميلاد" type="date" value={f.birthDate} onChange={(e) => set('birthDate', e.target.value)} /><Input id="pf-city" label="المدينة" value={f.city} onChange={(e) => set('city', e.target.value)} /></div>
      <div className="grid-form"><Input id="pf-district" label="الحي" value={f.district} onChange={(e) => set('district', e.target.value)} /><Input id="pf-street" label="الشارع" value={f.street} onChange={(e) => set('street', e.target.value)} /></div>
      <div className="grid-form"><Input id="pf-ecn" label="اسم جهة الطوارئ" value={f.emergencyContactName} onChange={(e) => set('emergencyContactName', e.target.value)} /><Input id="pf-ecp" label="جوال الطوارئ" dir="ltr" value={f.emergencyContactPhone} onChange={(e) => set('emergencyContactPhone', e.target.value)} /></div>
    </Modal>
  );
}

export function PatientFilePage() {
  const live = useLive();
  const toast = useToast();
  const { patient } = useAuth();
  const me = useAsync(() => patientApi.me(), [live]);
  const files = useAsync(() => patientApi.files(), [live]);
  const [edit, setEdit] = useState(false);
  const [del, setDel] = useState<PatientFile | null>(null);
  const [uploading, setUploading] = useState(false);
  const input = useRef<HTMLInputElement>(null);
  const camera = useRef<HTMLInputElement>(null);
  const p = me.data?.patient;

  const upload = async (file: File | undefined) => {
    if (!file || !p) return;
    setUploading(true);
    try { await patientApi.upload(p.id, file, patient?.name ?? ''); toast.success('تم رفع الملف.'); files.reload(); } catch (e) { toast.error((e as Error).message); }
    finally { setUploading(false); if (input.current) input.current.value = ''; if (camera.current) camera.current.value = ''; }
  };
  const open = async (f: PatientFile) => { const u = await patientApi.fileUrl(f.filePath); if (u) window.open(u, '_blank', 'noopener'); else toast.error('تعذّر فتح الملف.'); };

  return (
    <div className="page">
      <Head title="ملفي" text="بياناتك الشخصية ومستنداتك." action={p && <Button variant="outline" icon="edit" onClick={() => setEdit(true)}>تعديل بياناتي</Button>} />
      {me.error ? <ErrorBox text={me.error} retry={me.reload} /> : me.loading && !p ? <Skeleton h={180} /> : p && (
        <section className="card" style={{ marginBottom: 18 }}><div className="card__body">
          <dl className="dl">
            <div><dt>الاسم</dt><dd>{p.full_name}</dd></div><div><dt>رقم الملف</dt><dd className="num">{fileNoText(p.file_no)}</dd></div>
            <div><dt>الجوال</dt><dd className="num">{p.phone}</dd></div><div><dt>البريد</dt><dd>{p.email || '—'}</dd></div>
            <div><dt>تاريخ الميلاد</dt><dd>{p.birth_date ? fmtDate(p.birth_date) : '—'}</dd></div><div><dt>الجنس</dt><dd>{p.gender === 'female' ? 'امرأة' : 'رجل'}</dd></div>
            <div><dt>العنوان</dt><dd>{[p.city, p.district, p.street].filter(Boolean).join(' – ') || p.address || '—'}</dd></div><div><dt>الطبيب المسؤول</dt><dd>{me.data?.doctor ?? '—'}</dd></div>
          </dl>
        </div></section>
      )}
      <section className="card">
        <div className="card__head"><h2>الملفات والمرفقات</h2>
          <span style={{ display: 'flex', flexWrap: 'wrap', gap: 8 }}>
            <input ref={input} type="file" hidden accept=".pdf,.png,.jpg,.jpeg,.webp,.doc,.docx,.txt" onChange={(e) => upload(e.target.files?.[0])} />
            <input ref={camera} type="file" hidden accept="image/*" capture="environment" onChange={(e) => upload(e.target.files?.[0])} />
            <Button size="sm" icon="doc" loading={uploading} onClick={() => input.current?.click()}>رفع ملف</Button>
            <Button size="sm" variant="outline" icon="camera" loading={uploading} onClick={() => camera.current?.click()}>التقاط صورة</Button>
          </span></div>
        <div className="card__body">
          {files.loading && !files.data ? <Skeleton h={60} /> : (files.data ?? []).length === 0 ? <EmptyState icon="doc" title="ما فيه ملفات" text="تقدر ترفع تقارير أو صور أو مستندات (حتى 10 ميجابايت)." /> : (
            <div className="table-wrap"><table className="table"><thead><tr><th>الملف</th><th>رفعه</th><th>التاريخ</th><th className="actions"></th></tr></thead>
              <tbody>{(files.data ?? []).map((f) => <tr key={f.id}><td>{f.fileName}<div className="muted-sm num">{(f.sizeBytes / 1024).toFixed(0)} ك.ب</div></td><td>{f.uploadedByName || '—'}</td><td className="num">{fmtDateTime(f.createdAt)}</td>
                <td className="actions"><span style={{ display: 'flex', gap: 6 }}><Button size="sm" variant="outline" onClick={() => open(f)}>عرض</Button>{f.uploadedBy && <Button size="sm" variant="soft-danger" onClick={() => setDel(f)}>حذف</Button>}</span></td></tr>)}</tbody></table></div>
          )}
        </div>
      </section>
      {edit && p && <ProfileModal p={p} onClose={() => setEdit(false)} onDone={me.reload} />}
      {del && <ConfirmDialog title="حذف الملف" message={`سيتم حذف الملف «${del.fileName}» نهائيًا.`} onClose={() => setDel(null)} onConfirm={async () => { try { await patientApi.removeFile(del); toast.success('تم حذف الملف.'); files.reload(); } catch (e) { toast.error((e as Error).message); } }} />}
    </div>
  );
}

// ============ خطط العلاج ============
export function PatientPlans() {
  const live = useLive();
  const plans = useAsync(() => patientApi.plans(), [live]);
  return (
    <div className="page">
      <Head title="خطط العلاج" text="الخطط التي وضعها لك الطبيب وتقدّمك فيها." />
      {plans.error ? <ErrorBox text={plans.error} retry={plans.reload} /> : plans.loading && !plans.data ? <Skeleton h={140} /> : (plans.data ?? []).length === 0 ? <div className="card"><div className="card__body"><EmptyState icon="target" title="ما فيه خطط علاج" /></div></div> : (
        <div className="plan-grid">{(plans.data ?? []).map((p) => { const st = PLAN_STATUS[p.status]; return (
          <article key={p.id} className="card" style={{ padding: 16 }}>
            <div className="row-between"><strong>{p.diagnosis}</strong><StatusBadge label={st?.label ?? p.status} tone={st?.tone ?? 'muted'} /></div>
            <div className="muted-sm" style={{ margin: '6px 0 10px' }}>{p.mainGoal}</div>
            <div className="progress"><i style={{ width: `${p.progressPct}%` }} /></div>
            <div className="muted-sm num" style={{ margin: '6px 0 10px' }}>{p.progressPct}% من {p.totalSessions} جلسات</div>
            <dl className="plan-card__facts"><div><dt>البداية</dt><dd>{fmtDate(p.startDate)}</dd></div><div><dt>النهاية المتوقعة</dt><dd>{p.endDate ? fmtDate(p.endDate) : '—'}</dd></div></dl>
            {p.notes && <p className="muted-sm" style={{ marginTop: 8 }}>{p.notes}</p>}
          </article>); })}</div>
      )}
    </div>
  );
}

// ============ نقاطي ============
export function PatientPoints() {
  const live = useLive();
  const summary = useAsync(() => patientApi.loyaltySummary(), [live]);
  const history = useAsync(() => patientApi.loyaltyHistory(), [live]);
  const codes = useAsync(() => patientApi.loyaltyCodes(), [live]);
  const s = summary.data;
  const [busy, setBusy] = useState<0 | 1 | 2>(0);
  const [newCode, setNewCode] = useState<{ code: string; sessions: number } | null>(null);
  const [redeemErr, setRedeemErr] = useState('');
  const redeem = async (n: 1 | 2) => {
    setBusy(n); setRedeemErr('');
    try {
      const r = await patientApi.redeemLoyalty(n);
      setNewCode({ code: r.code, sessions: r.sessions });
      summary.reload(); codes.reload(); history.reload();
    } catch (e) { setRedeemErr((e as Error).message); }
    setBusy(0);
  };
  return (
    <div className="page">
      <Head title="نقاطي" text={`كل ${REDEEM_POINTS} نقطة = جلسة علاج طبيعي مجانية، و${REDEEM_POINTS * 2} نقطة = جلستين. استبدل نقاطك بنفسك من هنا.`} />
      {summary.error ? <ErrorBox text={summary.error} retry={summary.reload} /> : summary.loading && !s ? (
        <div className="kpi-grid">{Array.from({ length: 3 }).map((_, i) => <div key={i} className="card kpi"><Skeleton h={38} w={38} r={11} /><Skeleton h={22} w={60} /></div>)}</div>
      ) : s && (
        <>
          <div className="kpi-grid">
            <StatCard icon="spark" tone="brand" value={s.balance} label="رصيدك الحالي" />
            <StatCard icon="checkCircle" tone="ok" value={s.totalEarned} label="إجمالي المكتسب" />
            <StatCard icon="receipt" tone="info" value={s.totalRedeemed} label="إجمالي المستبدل" />
          </div>
          <section className="card" style={{ marginBottom: 18 }}>
            <div className="card__head"><h2>استبدال النقاط</h2></div>
            <div className="card__body">
              {newCode && (
                <div className="alert alert-success" style={{ marginBottom: 12 }}>
                  <Icon name="checkCircle" size={17} />
                  <div>تم الاستبدال 🎁 كودك: <strong dir="ltr" style={{ fontSize: 17 }}>{newCode.code}</strong> — صالح لـ {newCode.sessions === 2 ? 'جلستين' : 'جلسة واحدة'}. قدّمه للاستقبال عند الدفع.</div>
                </div>
              )}
              {redeemErr && <div className="alert alert-danger" style={{ marginBottom: 12 }}>{redeemErr}</div>}
              <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap' }}>
                <Button icon="spark" loading={busy === 1} disabled={!!busy || s.balance < REDEEM_POINTS} onClick={() => redeem(1)}>استبدال {REDEEM_POINTS} نقطة = جلسة</Button>
                <Button icon="spark" variant="outline" loading={busy === 2} disabled={!!busy || s.balance < REDEEM_POINTS * 2} onClick={() => redeem(2)}>استبدال {REDEEM_POINTS * 2} نقطة = جلستين</Button>
              </div>
              {s.balance < REDEEM_POINTS && <p className="muted" style={{ fontSize: 13, marginTop: 8 }}>تحتاج إلى {REDEEM_POINTS - s.balance} نقطة إضافية لأول جلسة مجانية.</p>}
            </div>
          </section>
        </>
      )}

      {(codes.data ?? []).length > 0 && (
        <section className="card" style={{ marginBottom: 18 }}>
          <div className="card__head"><h2>أكواد الجلسات المجانية</h2></div>
          <div className="card__body">
            <div className="table-wrap"><table className="table">
              <thead><tr><th>الكود</th><th>الجلسات</th><th>الحالة</th><th>تاريخ الاستبدال</th><th>صالح حتى</th></tr></thead>
              <tbody>
                {(codes.data ?? []).map((c) => (
                  <tr key={c.code}>
                    <td dir="ltr"><strong>{c.code}</strong></td>
                    <td>{c.sessions === 2 ? `جلستين (متبقي ${c.usesLeft})` : 'جلسة'}</td>
                    <td>{({ unused: 'غير مستخدم', used: 'مستخدم', cancelled: 'ملغي', expired: 'منتهي' } as const)[c.status]}</td>
                    <td>{fmtDateTime(new Date(c.createdAt).getTime())}</td>
                    <td className="num">{c.validTo}</td>
                  </tr>
                ))}
              </tbody>
            </table></div>
            <p className="muted" style={{ fontSize: 13, marginTop: 10 }}>قدّم الكود للاستقبال عند الدفع — كود الجلسة يُستخدم مرة، وكود الجلستين مرتين (مرة لكل جلسة).</p>
          </div>
        </section>
      )}

      <section className="card">
        <div className="card__head"><h2>آخر الحركات</h2></div>
        <div className="card__body">
          {history.error ? <ErrorBox text={history.error} retry={history.reload} /> : history.loading && !history.data ? <Skeleton h={120} /> : (history.data ?? []).length === 0 ? <EmptyState icon="spark" title="ما فيه حركات نقاط بعد" /> : (
            <div className="table-wrap"><table className="table">
              <thead><tr><th>نوع العملية</th><th>النقاط</th><th>الرصيد بعده</th><th>السبب</th><th>التاريخ</th></tr></thead>
              <tbody>
                {(history.data ?? []).map((h) => (
                  <tr key={h.id}>
                    <td>{LOYALTY_KIND_LABEL[h.kind] ?? h.kind}</td>
                    <td className="num" style={{ color: h.points > 0 ? 'var(--ok)' : 'var(--danger)', fontWeight: 700 }}>{h.points > 0 ? `+${h.points}` : h.points}</td>
                    <td className="num">{h.balanceAfter}</td>
                    <td>{h.reason}</td>
                    <td>{fmtDateTime(new Date(h.createdAt).getTime())}</td>
                  </tr>
                ))}
              </tbody>
            </table></div>
          )}
        </div>
      </section>
    </div>
  );
}

// ============ الفواتير ============
export function PatientInvoices() {
  const live = useLive();
  const inv = useAsync(() => patientApi.invoices(), [live]);
  const pk = useAsync(() => patientApi.packages(), [live]);
  const list = inv.data?.invoices ?? [];
  const payState = (i: Invoice) => {
    const req = (pk.data?.requests ?? []).find((r) => r.invoiceId === i.id && r.status !== 'cancelled');
    return PAY_STATE[payStateOf(i, req ? ({ status: req.status } as InstallmentRequest) : undefined)];
  };
  const due = list.filter((i) => i.status === 'due' || i.status === 'partial').reduce((s, i) => s + i.remaining, 0);
  return (
    <div className="page">
      <Head title="الفواتير" text="فواتيرك ومدفوعاتك. الدفع يتم في المركز." />
      {inv.error ? <ErrorBox text={inv.error} retry={inv.reload} /> : inv.loading && !inv.data ? <Skeleton h={140} /> : (
        <>
          <div className="kpi-grid"><StatCard icon="receipt" tone="warn" value={money(due)} label="المبلغ المستحق" /><StatCard icon="wallet" tone="ok" value={money(list.reduce((s, i) => s + i.paid, 0))} label="إجمالي المدفوع" /></div>
          {(pk.data?.packages ?? []).filter((k) => k.status !== 'cancelled').length > 0 && (
            <section className="card" style={{ marginBottom: 18 }}>
              <div className="card__head"><h2>باقاتي</h2></div>
              <div className="card__body"><div className="table-wrap"><table className="table">
                <thead><tr><th>الباقة</th><th>عدد الجلسات</th><th>المستخدمة</th><th>المتبقية</th><th>حالة الباقة</th><th>حالة الدفع</th></tr></thead>
                <tbody>{(pk.data?.packages ?? []).filter((k) => k.status !== 'cancelled').map((k) => {
                  const i = list.find((x) => x.packageId === k.id);
                  const ps = i ? payState(i) : null;
                  const st = PACKAGE_STATUS[k.status] ?? { label: k.status, tone: 'muted' };
                  return <tr key={k.id}><td><strong>{k.name}</strong></td><td className="num">{k.totalSessions}</td><td className="num">{k.usedSessions}/{k.totalSessions}</td><td className="num">{k.totalSessions - k.usedSessions}</td>
                    <td><StatusBadge label={st.label} tone={st.tone} /></td><td>{ps ? <StatusBadge label={ps.label} tone={ps.tone} /> : '—'}</td></tr>;
                })}</tbody>
              </table></div></div>
            </section>
          )}
          <section className="card"><div className="card__body">
            {list.length === 0 ? <EmptyState icon="receipt" title="ما فيه فواتير" /> : (
              <div className="table-wrap"><table className="table"><thead><tr><th>الفاتورة</th><th>التاريخ</th><th>البيان</th><th>الإجمالي</th><th>المدفوع</th><th>المتبقي</th><th>الحالة</th></tr></thead>
                <tbody>{list.map((i) => { const st = INVOICE_STATUS[i.status]; return <tr key={i.id}><td className="num">{i.no}</td><td>{fmtDate(i.date)}</td><td>{i.serviceName}</td><td className="num">{money(i.total)}</td><td className="num">{money(i.paid)}</td><td className="num">{money(i.remaining)}</td><td>{i.packageId && (pk.data?.packages ?? []).some((k) => k.id === i.packageId && k.kind) ? <StatusBadge label={payState(i).label} tone={payState(i).tone} /> : <StatusBadge label={st.label} tone={st.tone} />}</td></tr>; })}</tbody></table></div>
            )}
          </div></section>
        </>
      )}
    </div>
  );
}

// ============ الإشعارات ============
// زر فتح الصفحة المرتبطة بالإشعار (رابط الإشعار من الخادم: /me/invoices، /me/plans، /me/appointments...)
const OPEN_LABEL: Record<string, string> = { invoices: 'عرض الفواتير', plans: 'عرض الخطة العلاجية', appointments: 'عرض مواعيدي', '': 'فتح حسابي' };

export function PatientNotifications() {
  const live = useLive();
  const navigate = useNavigate();
  const list = useAsync(() => patientApi.notifications(), [live]);
  const unread = (list.data ?? []).filter((n) => !n.read).length;
  const mark = async (id?: string) => { await patientApi.markRead(id); list.reload(); };
  return (
    <div className="page">
      <Head title="الإشعارات" text={unread ? `عندك ${unread} إشعار غير مقروء.` : 'كل الإشعارات مقروءة.'} action={unread > 0 ? <Button variant="outline" onClick={() => mark()}>تحديد الكل كمقروء</Button> : undefined} />
      <PushStatusCard />
      {list.error ? <ErrorBox text={list.error} retry={list.reload} /> : list.loading && !list.data ? <Skeleton h={120} /> : (list.data ?? []).length === 0 ? <div className="card"><div className="card__body"><EmptyState icon="bell" title="ما فيه إشعارات" /></div></div> : (
        <div className="card"><div className="card__body"><div className="cm-history">{(list.data ?? []).map((n) => (
          <article key={n.id} className="cm-item" style={{ opacity: n.read ? 0.7 : 1, borderInlineStart: n.read ? undefined : '3px solid var(--brand)' }}>
            <div className="row-between"><strong>{n.title}</strong><span className="muted num" style={{ fontSize: 12 }}>{fmtDateTime(n.createdAt)}</span></div>
            <p>{n.body}</p>
            {n.link?.startsWith('/me') && <Button size="sm" variant="outline" style={{ marginInlineEnd: 8 }} onClick={() => { void mark(n.id); navigate(n.link!); }}>{OPEN_LABEL[n.link.split('/')[2] ?? ''] ?? 'فتح'}</Button>}
            {!n.read && <Button size="sm" variant="ghost" onClick={() => mark(n.id)}>تحديد كمقروء</Button>}
          </article>))}</div></div></div>
      )}
    </div>
  );
}
