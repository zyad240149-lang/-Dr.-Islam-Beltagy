import { IncompleteAlert } from './PatientCompleteness';
import { INCOMPLETE_MESSAGE, isPatientComplete } from '../utils/patientGaps';
import { InvoiceFileButtons, InvoiceWhatsappButton } from './InvoiceActions';
import { sendWhatsApp } from '../data/whatsappSend';
import { useState, type ReactNode } from 'react';
import type { Appointment, PaymentMethod } from '../types';
import { db, DOCTOR_DAY_LABEL } from '../data/db';
import { Modal, Button, Input, Select } from './ui';
import { Icon } from '../utils/icons';
import { fmtDate, fmtTime, APPT_STATUS, APPT_TYPE_LABEL, money, waLink, riyadhTodayYmd, PAYMENT_METHOD_OPTIONS } from '../utils/format';
import { useToast } from '../hooks/useToast';
import { useCan } from './common';
import { useInstallmentRequests } from './PackagePayment';
import { requestFor } from '../data/installments';

// «تعديل» واحد: الخدمة + السعر + الدكتور + التاريخ/الوقت + نوع الجلسة + الملاحظات. الحفظ بيحدّث الموعد والفاتورة المرتبطة معًا (قبل التأكيد أو بعده).
// السعر (= الفاتورة) بيتعدّل من قسم الفواتير بس (fromInvoices)؛ من المواعيد السعر بيفضل زي ما هو
export function EditAppointmentModal({ appt, onClose, fromInvoices = false }: { appt: Appointment; onClose: () => void; fromInvoices?: boolean }) {
  const toast = useToast();
  const [serviceId, setServiceId] = useState(appt.serviceId);
  const [therapistId, setTherapistId] = useState(appt.therapistId || '');
  const location = 'center';
  const [type, setType] = useState(appt.type === 'home' ? 'session' : appt.type);
  const address = '';
  const [notes, setNotes] = useState(appt.notes ?? '');
  const [date, setDate] = useState(appt.date);
  const [time, setTime] = useState(appt.time);
  const [price, setPrice] = useState(String(appt.price ?? ''));
  const inv = db.invoices().find((i) => i.appointmentId === appt.id && i.status !== 'cancelled');
  const plan = appt.planId ? db.plan(appt.planId) : undefined;
  const [busy, setBusy] = useState(false);
  const done = appt.status === 'completed';
  const services = db.services();
  const duration = db.service(serviceId)?.durationMin ?? appt.durationMin;
  const therapists = done ? db.therapists().filter((t) => t.active || t.id === appt.therapistId) : db.therapistsForService(serviceId);
  // أوقات الدكتور المختار فقط — المحجوز ✕ ومعطّل، وموعده الحالي متاح له
  const free = therapistId ? db.availableSlots(therapistId, date, duration, appt.id, appt.patientId) : [];
  // محجوز للدكتور، أو المريض عنده فيه موعد تاني مع دكتور تاني
  const taken = therapistId ? [...db.takenSlots(therapistId, date, duration, appt.id), ...db.patientBusySlots(appt.patientId, therapistId, date, duration, appt.id)] : [];
  const all = Array.from(new Set([...free, ...taken, ...(date === appt.date && therapistId === appt.therapistId ? [appt.time] : [])])).sort();

  const submit = async () => {
    if (!therapistId) { toast.error('يرجى اختيار الدكتور أولًا'); return; }
    if (!/^\d{2}:\d{2}$/.test(time)) { toast.error('اختر الوقت.'); return; }
    const pr = Number(price);
    if (price.trim() === '' || !Number.isFinite(pr) || pr < 0) { toast.error('أدخل سعرًا صحيحًا.'); return; }
    // نفس قواعد الخادم: الوقت الجديد لازم يكون جوّه دوام الدكتور (الخادم بيتحقق تاني)
    const moved = date !== appt.date || time !== appt.time || therapistId !== appt.therapistId || serviceId !== appt.serviceId;
    const issue = !done && moved ? db.doctorTimeIssue(therapistId, date, time, duration) : null;
    if (issue) { toast.error(issue); return; }
    setBusy(true);
    const r = await db.updateAppointmentDetails(appt.id, { serviceId, therapistId, type, location, address, notes, date, time, price: fromInvoices ? pr : (serviceId !== appt.serviceId ? undefined : (appt.price ?? pr)) });
    setBusy(false);
    if (!r.ok) { toast.error(r.error); return; }
    toast.success(inv ? 'تم حفظ التعديل في الموعد والفاتورة.' : 'تم حفظ تعديل الموعد.');
    onClose();
  };

  return (
    <Modal title={`تعديل ${appt.no}`} onClose={onClose} footer={
      <><Button variant="outline" onClick={onClose} disabled={busy}>إلغاء</Button><Button onClick={submit} loading={busy}>حفظ التعديل</Button></>
    }>
      <Select label="الخدمة" value={serviceId} onChange={(e) => { setServiceId(e.target.value); if (!done) setTime(''); const sv = services.find((x) => x.id === e.target.value); if (sv) setPrice(String(sv.price)); }}
        options={services.map((s) => ({ value: s.id, label: `${s.name} (${money(s.price)})` }))} />
      {fromInvoices && <Input label="السعر (ج.م)" type="number" min={0} value={price} onChange={(e) => setPrice(e.target.value)} />}
      <p className="muted-sm" style={{ marginTop: -6, marginBottom: 14 }}>
        {inv ? `سيُعدَّل السعر والخدمة في الفاتورة ${inv.no}${inv.paid > 0 ? ` (المدفوع ${money(inv.paid)} — ما يقل السعر عنه)` : ''}.` : plan ? 'الموعد ضمن خطة علاجية — يُسجَّل السعر على الموعد، ويُعدَّل سعر الخطة نفسها من فاتورة الخطة.' : 'ما فيه فاتورة مرتبطة بالموعد.'}
      </p>
      <Select label="الدكتور" value={therapistId} onChange={(e) => { setTherapistId(e.target.value); if (!done) setTime(''); }}
        options={[...(therapistId ? [] : [{ value: '', label: 'اختر الدكتور' }]), ...therapists.map((t) => ({ value: t.id, label: t.name }))]} />
      {done && <p className="muted-sm" style={{ marginBottom: 10 }}><Icon name="check" size={13} /> موعد مكتمل — التعديل تصحيح للسجل والفاتورة (التاريخ والوقت بحرية).</p>}
      <Input label="التاريخ" type="date" value={date} max={done ? riyadhTodayYmd() : undefined} onChange={(e) => { setDate(e.target.value); if (!done) setTime(''); }} />
      {done ? <Input label="الوقت" type="time" value={time} onChange={(e) => setTime(e.target.value)} /> : <div className="field">
        <label>{therapistId ? `المواعيد المتاحة لـ ${db.therapist(therapistId)?.name ?? ''}` : 'الوقت'}</label>
        {!therapistId ? <p className="muted">يرجى اختيار الدكتور لعرض المواعيد المتاحة</p> : all.length ? (
          <div className="slots">{all.map((s) => (taken.includes(s) && s !== time && !free.includes(s))
            ? <button key={s} type="button" className="slot slot--taken" disabled title="محجوز">✕ {fmtTime(s)}</button>
            : <button key={s} type="button" className={`slot ${time === s ? 'selected' : ''}`} onClick={() => setTime(s)}>{fmtTime(s)}</button>)}</div>
        ) : <p className="muted">ما فيه مواعيد لهذا الدكتور في هاليوم — جرّب يوم ثاني.</p>}
      </div>}
      <Select label="نوع الجلسة" value={type} onChange={(e) => setType(e.target.value as typeof type)}
        options={Object.entries(APPT_TYPE_LABEL).filter(([v]) => v !== 'home').map(([value, label]) => ({ value, label }))} />
      <div className="field" style={{ marginBottom: 0 }}>
        <label htmlFor="ea-notes">ملاحظات</label>
        <textarea id="ea-notes" className="input" rows={3} value={notes} onChange={(e) => setNotes(e.target.value)} />
      </div>
    </Modal>
  );
}

export function RescheduleModal({ appt, onClose }: { appt: Appointment; onClose: () => void }) {
  const toast = useToast();
  const [date, setDate] = useState(appt.date);
  const [time, setTime] = useState('');
  const therapists = db.therapistsForService(appt.serviceId);
  // حجز البوابة بييجي من غير طبيب — نبدأ بأول طبيب عشان الأوقات تظهر (وتقدر تغيّره)
  const [therapistId, setTherapistId] = useState(appt.therapistId || therapists[0]?.id || '');
  const [busy, setBusy] = useState(false);
  const slots = date && therapistId ? db.availableSlots(therapistId, date, appt.durationMin, appt.id, appt.patientId) : [];
  // المحجوز للدكتور ده بيظهر ✕ ومعطّل — عشان تشوف متى هو فاضي من نظرة واحدة
  const takenSlots = date && therapistId ? [...db.takenSlots(therapistId, date, appt.durationMin, appt.id), ...db.patientBusySlots(appt.patientId, therapistId, date, appt.durationMin, appt.id)] : [];
  const allSlots = Array.from(new Set([...slots, ...takenSlots])).sort();

  const submit = async () => {
    if (!therapistId) { toast.error('اختر المعالج.'); return; }
    if (!/^\d{2}:\d{2}$/.test(time)) { toast.error('اختر الوقت الجديد أو اكتبه.'); return; }
    const issue = db.doctorTimeIssue(therapistId, date, time, appt.durationMin);
    if (issue) { toast.error(issue); return; }
    setBusy(true);
    const r = await db.rescheduleAppointment(appt.id, date, time, therapistId);
    setBusy(false);
    if (!r.ok) { toast.error(r.error || 'تعذّر تغيير الموعد.'); return; }
    toast.success('تم تأكيد إعادة الجدولة');
    onClose();
  };

  return (
    <Modal title={`إعادة جدولة ${appt.no}`} onClose={onClose} footer={
      <><Button variant="outline" onClick={onClose} disabled={busy}>إلغاء</Button><Button onClick={submit} loading={busy}>تأكيد إعادة الجدولة</Button></>
    }>
      <dl className="dl" style={{ marginBottom: 16 }}>
        <div><dt>التاريخ الحالي</dt><dd>{fmtDate(appt.date)}</dd></div>
        <div><dt>الوقت الحالي</dt><dd className="num">{fmtTime(appt.time)}</dd></div>
        <div style={{ gridColumn: '1/-1' }}><dt>المعالج الحالي</dt><dd>{db.therapist(appt.therapistId)?.name ?? 'لم يُحدَّد بعد'}</dd></div>
      </dl>
      <Select label="المعالج" value={therapistId} onChange={(e) => { setTherapistId(e.target.value); setTime(''); }}
        options={therapists.map((t) => ({ value: t.id, label: t.name }))} />
      <Input label="التاريخ الجديد" type="date" value={date} onChange={(e) => { setDate(e.target.value); setTime(''); }} />
      <div className="field">
        <label>الوقت الجديد</label>
        {allSlots.length ? <div className="slots">{allSlots.map((s) => (slots.includes(s)
          ? <button key={s} type="button" className={`slot ${time === s ? 'selected' : ''}`} onClick={() => setTime(s)}>{fmtTime(s)}</button>
          : <button key={s} type="button" className="slot slot--taken" disabled title="محجوز">✕ {fmtTime(s)}</button>))}</div>
          : <p className="muted">{(() => { const w = therapistId && date ? db.doctorDay(therapistId, date) : null; return w && w.status !== 'ok' ? `${DOCTOR_DAY_LABEL[w.status]} — اختر يوم ثاني.` : 'ما فيه أوقات متاحة في هاليوم — اكتب الوقت أدناه.'; })()}</p>}
      </div>
      {/* تعديل حر: أي وقت (مش لازم على خانات الـ 30 دقيقة) — جوّه دوام الطبيب بس، والخادم بيتحقق من دوامه وتعارضه */}
      <Input id="rs-time" label="أو اكتب أي وقت" type="time" value={time} onChange={(e) => setTime(e.target.value)} style={{ direction: 'ltr' }} />
    </Modal>
  );
}

export function CancelModal({ appt, onClose }: { appt: Appointment; onClose: () => void }) {
  const toast = useToast();
  const [reason, setReason] = useState('');
  const [busy, setBusy] = useState(false);
  const submit = async () => {
    setBusy(true);
    await db.setAppointmentStatus(appt.id, 'cancelled', reason);
    setBusy(false);
    toast.success('تم إلغاء الموعد');
    onClose();
  };
  return (
    <Modal title="إلغاء الموعد" onClose={onClose} footer={
      <><Button variant="outline" onClick={onClose} disabled={busy}>رجوع</Button><Button variant="danger" onClick={submit} loading={busy}>تأكيد الإلغاء</Button></>
    }>
      <div className="alert alert-danger" style={{ marginBottom: 16 }}><Icon name="alert" size={17} /><div>هل أنت متأكد من إلغاء هذا الموعد رقم <span className="num">{appt.no}</span>؟</div></div>
      <Input label="سبب الإلغاء" placeholder="اختياري" value={reason} onChange={(e) => setReason(e.target.value)} />
    </Modal>
  );
}

async function sendInvoiceToAccount(appt: Appointment, toast: ReturnType<typeof useToast>) {
  const inv = db.invoices().find((i) => i.appointmentId === appt.id);
  const patient = db.patient(appt.patientId);
  const body = inv ? `فاتورتك لموعد ${fmtDate(appt.date)}: ${money(inv.total)} — تقدر تراجعها من حسابك.` : `تم تأكيد موعدك بتاريخ ${fmtDate(appt.date)}.`;
  const r = await db.sendCampaign({ title: 'فاتورة الموعد', body, audience: 'patient', patientId: appt.patientId });
  if (!r.ok) { toast.error(r.error); return; }
  if (r.recipients === 0) toast.error(`${patient?.fullName ?? 'المريض'} ما عنده حساب في بوابة العملاء بعد.`);
  else toast.success('تم إرسال الفاتورة لحساب المريض.');
}

// نص الرسالة يختلف حسب حالة الموعد — قبل التأكيد ما نقولش «تأكيد»، وبعده رسالة تأكيد لطيفة ومكتملة.
function appointmentWhatsappMessage(appt: Appointment): string {
  const name = db.patient(appt.patientId)?.fullName?.split(' ')[0] ?? '';
  const hello = name ? `مرحبًا ${name} 🌿` : 'مرحبًا 🌿';
  const when = `يوم ${fmtDate(appt.date)} الساعة ${fmtTime(appt.time)}`;
  const center = 'عيادة د. إسلام بلتاجي لجراحة العظام والكسور';
  const inv = db.invoices().find((i) => i.appointmentId === appt.id);
  const invoiceLine = inv ? ` قيمة الفاتورة: ${money(inv.total)}.` : '';

  switch (appt.status) {
    case 'new':
      return `${hello}\nتم استلام حجزك في ${center}    ${when}. طلبك الحين بانتظار تأكيد المركز، وسنوافيك بالتأكيد في أقرب وقت. شكرًا لثقتك بنا!`;
    case 'confirmed':
    case 'rescheduled':
      return `${hello}\nيسعدنا تأكيد موعدك في ${center} ${when}.${invoiceLine} بانتظارك، ونتمنى لك دوام الصحة والعافية 🌟`;
    case 'on_way':
      return `${hello}\nموعدك اليوم ${fmtTime(appt.time)} في ${center} — نراك قريبًا بإذن الله 🌿`;
    case 'arrived':
    case 'in_progress':
      return `${hello}\nحيّاك الله في ${center}! فريقنا جاهز لاستقبالك.`;
    case 'completed':
      return `${hello}\nشكرًا لزيارتك ${center}  ${when}. يسعدنا أنك كنت معنا، ونتمنى لك الشفاء العاجل ودوام الصحة 🌟 بانتظار زيارتك القادمة.`;
    case 'cancelled':
      return `${hello}\nنود إعلامك بإلغاء موعدك الذي كان مقررًا ${when} في ${center}. تقدر تحجز موعد جديد في أي وقت يناسبك — نتشرف بخدمتك.`;
    case 'no_show':
      return `${hello}\nلاحظنا أنك لم تتمكن من حضور موعدك ${when} في ${center}. تقدر تعيد الحجز بسهولة في أي وقت — بانتظارك 🌿`;
    default:
      return `${hello}\nبخصوص موعدك ${when} في ${center}.`;
  }
}

export function sendAppointmentWhatsapp(appt: Appointment, toast: ReturnType<typeof useToast>) {
  const patient = db.patient(appt.patientId);
  if (!patient?.phone) { toast.error('ما فيه رقم جوال للمريض.'); return; }
  sendWhatsApp({ phone: patient.phone, text: appointmentWhatsappMessage(appt), patientId: patient.id, type: 'appointment' });
}

// حضور الباقات/الخطط لسه بياخد موعد اليوم بس (نفس قاعدة الخادم) وقبل ما يتسجّل حضوره
const PRE_ATTENDANCE: Appointment['status'][] = ['new', 'confirmed', 'rescheduled', 'on_way'];
const canCheckInSession = (a: Appointment) => (a.planId || a.packageId) && PRE_ATTENDANCE.includes(a.status) && a.date === riyadhTodayYmd();

export function StatusMenu({ appt }: { appt: Appointment }) {
  const toast = useToast();
  const [changeStatus, doctorModal] = useStatusWithDoctor();
  const [checkInBusy, setCheckInBusy] = useState(false);
  const [renewPkg, setRenewPkg] = useState<ReturnType<typeof db.raw>['packages'][number] | null>(null);
  // «تأكيد» (= حضر، مع تسجيل الدفع) زرار لوحده في تفاصيل الموعد — هنا «لم يحضر» بس
  const options: Array<[Appointment['status'], string]> = attendanceOpen(appt) ? [['no_show', 'لم يحضر']] : [];
  // فاتورة الموعد المفتوح بس (فاتورته، أو فاتورة الخطة/الباقة اللي تبعها)
  const inv = db.invoices().find((i) => i.status !== 'cancelled' && (i.appointmentId === appt.id || (!!appt.planId && i.planId === appt.planId) || (!!appt.packageId && i.packageId === appt.packageId)));
  const checkInSession = async () => {
    setCheckInBusy(true);
    const r = await db.attendanceCheckInForAppointment(appt);
    setCheckInBusy(false);
    if (!r.ok) { toast.error(r.error); return; }
    const patientName = db.patient(appt.patientId)?.fullName ?? '';
    toast.success(`تم تسجيل حضور ${patientName} — الجلسة ${r.sessionNo} من ${r.total}، المتبقي ${r.remaining}.`);
    if (r.remaining <= 0 && appt.packageId) {
      const pkg = db.raw().packages.find((x) => x.id === appt.packageId);
      if (pkg) setRenewPkg(pkg);
    }
  };
  if (appt.status === 'in_progress') return <p className="muted-sm">الزيارة قيد التنفيذ — استخدم «إنهاء الزيارة» لإتمامها.</p>;
  return (
    <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
      {canCheckInSession(appt) && (
        <Button variant="primary" size="sm" icon="checkCircle" loading={checkInBusy} onClick={checkInSession}>تسجيل حضور الجلسة (خصم من الباقة/الخطة)</Button>
      )}
      {options.filter(([s]) => s !== appt.status).map(([s, label]) => (
        <Button key={s} variant="outline" size="sm" onClick={async () => { if (await changeStatus(appt, s)) toast.success(`تم تحديث الحالة إلى: ${APPT_STATUS[s].label}`); }}>
          {label}
        </Button>
      ))}
      {(appt.status === 'confirmed' || appt.status === 'arrived') && (
        <Button variant="success" size="sm" icon="receipt" onClick={() => sendInvoiceToAccount(appt, toast)}>إرسال الفاتورة لحسابه</Button>
      )}
      {inv && <><InvoiceFileButtons invoice={inv} size="sm" /><InvoiceWhatsappButton invoice={inv} size="sm" variant="outline" /></>}
      {doctorModal}
      {renewPkg && <RenewPackageModal pkg={renewPkg} onClose={() => setRenewPkg(null)} />}
    </div>
  );
}

// آخر جلسة في الباقة: زرار تجديد يبيع نفس الباقة من كتالوج الباقات للمريض تلقائيًا (فاتورة جديدة بنفس السعر)
function RenewPackageModal({ pkg, onClose }: { pkg: ReturnType<typeof db.raw>['packages'][number]; onClose: () => void }) {
  const toast = useToast();
  const [busy, setBusy] = useState(false);
  const plan = db.packagePlanFor(pkg);
  const patient = db.patient(pkg.patientId);
  const renew = async () => {
    setBusy(true);
    const r = await db.renewPackage(pkg.patientId, pkg);
    setBusy(false);
    if (!r.ok) { toast.error(r.error); return; }
    toast.success('تم تجديد الباقة وإنشاء فاتورتها.');
    onClose();
  };
  return (
    <Modal title="اكتملت جلسات الباقة" onClose={onClose} footer={
      <><Button variant="outline" onClick={onClose} disabled={busy}>ليس الآن</Button><Button icon="checkCircle" onClick={renew} loading={busy} disabled={!plan}>تجديد الباقة</Button></>
    }>
      <p>باقة <strong>{pkg.name}</strong> للمريض <strong>{patient?.fullName}</strong> خلصت جلساتها.</p>
      {plan ? <p className="muted-sm">سيُنشأ باقة جديدة ({plan.totalSessions} جلسات — {money(plan.price)}) وفاتورتها تلقائيًا.</p>
        : <p className="muted-sm" style={{ color: 'var(--danger)' }}>ما قدرنا نلاقي نفس الباقة في كتالوج الباقات — افتح «بيع باقة» من ملف المريض واختَرها يدويًا.</p>}
    </Modal>
  );
}

// الحالات اللي محتاجة طبيب محدد
const NEEDS_DOCTOR: Appointment['status'][] = ['confirmed', 'on_way', 'arrived', 'in_progress', 'completed'];

// تغيير حالة الموعد، ولو الموعد من غير طبيب (حجز من الموبايل) بيسأل عن الطبيب الأول.
// الاستخدام: const [changeStatus, doctorModal] = useStatusWithDoctor(); ... {doctorModal}
export function useStatusWithDoctor(): [(appt: Appointment, status: Appointment['status']) => Promise<boolean>, ReactNode] {
  const [pending, setPending] = useState<{ appt: Appointment; status: Appointment['status']; resolve: (ok: boolean) => void } | null>(null);
  const change = (appt: Appointment, status: Appointment['status']) => {
    if (appt.therapistId || !NEEDS_DOCTOR.includes(status)) return db.setAppointmentStatus(appt.id, status).then(() => true);
    return new Promise<boolean>((resolve) => setPending({ appt, status, resolve }));
  };
  const modal = pending && (
    <PickDoctorModal appt={pending.appt} status={pending.status}
      onDone={(ok) => { pending.resolve(ok); setPending(null); }} />
  );
  return [change, modal];
}

function PickDoctorModal({ appt, status, onDone }: { appt: Appointment; status: Appointment['status']; onDone: (ok: boolean) => void }) {
  const toast = useToast();
  const [busy, setBusy] = useState(false);
  const doctors = db.therapistsForService(appt.serviceId);
  const free = new Set(doctors.filter((t) => !db.takenSlots(t.id, appt.date, appt.durationMin ?? 30).includes(appt.time)).map((t) => t.id));
  const [th, setTh] = useState(doctors.find((t) => free.has(t.id))?.id ?? '');
  const submit = async () => {
    if (!th) { toast.error('اختر الطبيب.'); return; }
    setBusy(true);
    try { await db.setAppointmentStatus(appt.id, status, undefined, th); onDone(true); }
    catch (e) { toast.error((e as Error).message); setBusy(false); }
  };
  return (
    <Modal title="اختر الطبيب" onClose={() => onDone(false)}
      footer={<><Button variant="outline" onClick={() => onDone(false)} disabled={busy}>إلغاء</Button><Button onClick={submit} loading={busy}>{APPT_STATUS[status].label === 'مؤكد' ? 'تأكيد' : 'حفظ'}</Button></>}>
      <p className="muted" style={{ marginBottom: 12 }}>
        هذا الحجز من المريض دون طبيب — {db.patient(appt.patientId)?.fullName} · {db.service(appt.serviceId)?.name} · {fmtDate(appt.date)} {fmtTime(appt.time)}
      </p>
      <Select id="pick-doctor" label="الطبيب *" value={th} onChange={(e) => setTh(e.target.value)}
        options={[{ value: '', label: 'اختر...' }, ...doctors.map((t) => ({ value: t.id, label: free.has(t.id) ? t.name : `${t.name} (مشغول في هالوقت)` }))]} />
    </Modal>
  );
}

// «تأكيد» = حضر: بيفتح شاشة مراجعة قبل أي حاجة — طريقة الدفع (كاش/بطاقة/تحويل/بدون دفع) والمبلغ، أو «تعديل» الموعد/الفاتورة.
// بعد «تأكيد» في الشاشة: الحالة «حضر» (مع اختيار الطبيب لو الحجز من غيره)، والدفعة بتتسجل بالطريقة المختارة.
// نفس السلوك في كل مكان فيه زرار «تأكيد» (الجدول، التفاصيل، لوحة المعلومات).
export const CONFIRMABLE: Appointment['status'][] = ['new', 'confirmed', 'rescheduled', 'on_way'];
// «تأكيد» (حضر) و«لم يحضر» في يوم الموعد أو بعده بس — نفس شرط set_appointment_status على الخادم (هجرة 141)
export const attendanceOpen = (a: Appointment) => a.date <= riyadhTodayYmd();
export function useConfirmAppointment(): [(appt: Appointment) => Promise<void>, boolean, ReactNode] {
  const [busy, setBusy] = useState(false);
  const [changeStatus, doctorModal] = useStatusWithDoctor();
  const [target, setTarget] = useState<Appointment | null>(null);
  const run = async (appt: Appointment) => { setTarget(appt); };
  const modal = (
    <>
      {doctorModal}
      {target && <ConfirmCheckModal appt={target} changeStatus={changeStatus} setBusy={setBusy} onClose={() => setTarget(null)} />}
    </>
  );
  return [run, busy, modal];
}

type PayChoice = PaymentMethod | 'none';
const PAY_CHOICES: { value: PayChoice; label: string }[] = [
  ...PAYMENT_METHOD_OPTIONS.map((o) => ({ value: o.value as PayChoice, label: o.label })), { value: 'none', label: 'بدون دفع الحين' },
];
function ConfirmCheckModal({ appt, changeStatus, setBusy, onClose }: { appt: Appointment; changeStatus: (a: Appointment, s: Appointment['status']) => Promise<boolean>; setBusy: (b: boolean) => void; onClose: () => void }) {
  const toast = useToast();
  const can = useCan();
  const canPay = can('payments', 'create');
  const canEdit = can('appointments', 'edit');
  const [editing, setEditing] = useState(false);
  const [saving, setSaving] = useState(false);
  const canApprove = can('invoices', 'edit') && can('inv_approve', 'view');
  const [approving, setApproving] = useState(false);
  const live = db.appointment(appt.id) ?? appt;
  // الفاتورة اللي هيتدفع عليها: فاتورة الموعد نفسه، ولو مفيش = فاتورة الخطة العلاجية أو الباقة اللي الموعد تبعها
  const apptInv = db.invoices().find((i) => i.appointmentId === appt.id && i.status !== 'cancelled');
  const sharedInv = apptInv ? undefined
    : (live.planId ? db.invoices().find((i) => i.planId === live.planId && !i.appointmentId && i.status !== 'cancelled') : undefined)
      ?? (live.packageId ? db.invoices().find((i) => i.packageId === live.packageId && !i.appointmentId && i.status !== 'cancelled') : undefined);
  const inv = apptInv ?? sharedInv;
  const isDraft = inv?.status === 'draft'; // فاتورة الخطة لسه بانتظار المراجعة — مفيش دفع عليها قبل الاعتماد
  const due = inv && !isDraft ? inv.remaining : 0;
  // فاتورة عليها طلب تقسيط: المبلغ بيحدده النظام (الأولى 50% بالظبط ثم المتبقي) — والطلب المعلّق = مفيش دفع لحد قرار المدير
  const { rows: instRows } = useInstallmentRequests();
  const instReq = inv && instRows ? requestFor(instRows, inv.id) : undefined;
  const instPending = instReq?.status === 'pending';
  const instFixed = instReq?.status === 'approved' && due > 0
    ? (db.paymentsForInvoice(inv!.id).some((p) => !p.voidedAt) ? due : Math.min(instReq.firstAmount, due)) : null;
  const [method, setMethod] = useState<PayChoice>(canPay && due > 0 ? 'cash' : 'none');
  const approvePlanInvoice = async () => {
    if (!inv) return;
    setApproving(true);
    const r = await db.updatePlanInvoice(inv.id, { price: inv.price, discount: inv.discount, note: inv.note ?? '' }, true);
    setApproving(false);
    if (!r.ok) { toast.error(r.error); return; }
    if (canPay) setMethod('cash');
    toast.success('تم اعتماد فاتورة الخطة — اختر طريقة الدفع.');
  };
  // خصم على الفاتورة قبل الدفع (بصلاحية تعديل الفاتورة وسعرها، وقبل أي دفعة أو طلب تقسيط)
  const canDiscount = !!inv && !isDraft && inv.status !== 'cancelled' && can('invoices', 'edit') && can('inv_price', 'view') && inv.paid <= 0 && !instReq;
  const [disc, setDisc] = useState('');
  const [discBusy, setDiscBusy] = useState(false);
  const applyDiscount = async () => {
    if (!inv) return;
    const d = Number(disc);
    if (!Number.isFinite(d) || d < 0 || d > inv.price) { toast.error('الخصم لازم يكون بين 0 وسعر الفاتورة.'); return; }
    setDiscBusy(true);
    const r = await db.updatePlanInvoice(inv.id, { price: inv.price, discount: d, note: inv.note ?? '' }, false);
    setDiscBusy(false);
    if (!r.ok) { toast.error(r.error); return; }
    setAmount('');
    toast.success(d > 0 ? `تم تطبيق خصم ${money(d)} على الفاتورة.` : 'تم إلغاء الخصم.');
  };
  const [amount, setAmount] = useState('');
  const amt = method === 'none' || instPending ? 0 : instFixed != null ? instFixed : amount === '' ? due : Number(amount);
  const err = method !== 'none' && (!(amt > 0) || amt > due) ? `لازم يكون المبلغ بين 1 و ${money(due)}` : '';
  const patient = db.patient(live.patientId);
  const doctor = live.therapistId ? db.therapist(live.therapistId) : undefined;
  // ملف ناقص = مفيش تأكيد ولا اعتماد فاتورة (الخادم بيرفض كمان — هجرة 159)
  const incomplete = !!patient && !isPatientComplete(patient);

  const confirm = async () => {
    if (incomplete) { toast.error(INCOMPLETE_MESSAGE); return; }
    if (err) { toast.error(err); return; }
    setSaving(true);
    try {
      if (!(await changeStatus(live, 'arrived'))) { setSaving(false); return; }
      setBusy(true);
      if (inv && method !== 'none' && amt > 0) {
        const r = await db.recordPayment(inv.id, amt, method);
        if (!r.ok) { toast.error(`تم التأكيد، لكن تعذّر تسجيل الدفع: ${r.error ?? ''}`); onClose(); return; }
        toast.success(`تم التأكيد وإضافة ${money(amt)} إلى الحسابات.`);
      } else toast.success('تم التأكيد.');
      onClose();
    } catch (e) { toast.error((e as Error).message); }
    finally { setSaving(false); setBusy(false); }
  };

  if (editing) return <EditAppointmentModal appt={live} onClose={() => setEditing(false)} />;
  return (
    <Modal title="مراجعة وتأكيد الحضور" onClose={() => !saving && onClose()} footer={
      <>
        <Button variant="outline" onClick={onClose} disabled={saving}>إلغاء</Button>
        {canEdit && <Button variant="outline" icon="edit" onClick={() => setEditing(true)} disabled={saving}>تعديل</Button>}
        <Button icon="check" onClick={confirm} loading={saving} disabled={!!err || incomplete}>تأكيد</Button>
      </>
    }>
      <IncompleteAlert patientId={live.patientId} />
      <dl className="review-list">
        <div><dt>المريض</dt><dd><strong>{patient?.fullName ?? '—'}</strong></dd></div>
        <div><dt>الخدمة</dt><dd>{db.service(live.serviceId)?.name ?? '—'}</dd></div>
        <div><dt>الموعد</dt><dd>{fmtDate(live.date)} {fmtTime(live.time)}{doctor ? ` · ${doctor.name}` : ''}</dd></div>
        {inv && <div><dt>{sharedInv ? (live.planId ? 'فاتورة الخطة العلاجية' : 'فاتورة الباقة') : 'الفاتورة'}</dt><dd><span className="num">{inv.no}</span> — الإجمالي {money(inv.total)}{isDraft ? ' · بانتظار المراجعة' : ''}</dd></div>}
        <div><dt>المتبقي للدفع</dt><dd className="num"><strong>{money(inv ? inv.remaining : 0)}</strong></dd></div>
      </dl>
      {isDraft && (
        <div className="alert alert-warn" style={{ marginTop: 12, display: 'flex', gap: 10, alignItems: 'center', flexWrap: 'wrap', justifyContent: 'space-between' }}>
          <span>فاتورة الخطة العلاجية للحين بانتظار المراجعة — لازم اعتمادها قبل تسجيل الدفع.</span>
          {canApprove && <Button size="sm" icon="check" onClick={approvePlanInvoice} loading={approving} disabled={saving || incomplete}>اعتماد فاتورة الخطة الحين</Button>}
        </div>
      )}
      {canDiscount && (
        <div className="grid-form" style={{ marginTop: 12, alignItems: 'end' }}>
          <Input id="cf-disc" label={`الخصم (ج.م)${inv && inv.discount > 0 ? ` — الحالي ${money(inv.discount)}` : ''}`} type="number" min={0} max={inv?.price} value={disc} placeholder="0" onChange={(e) => setDisc(e.target.value)} />
          <Button variant="outline" onClick={applyDiscount} loading={discBusy} disabled={saving || disc === ''}>تطبيق الخصم</Button>
        </div>
      )}
      {!inv && <p className="muted-sm" style={{ marginTop: 10 }}>ما فيه فاتورة على هذي الزيارة — ما فيه مبلغ للدفع.</p>}
      {inv && !isDraft && due <= 0 && <p className="muted-sm" style={{ marginTop: 10 }}>الفاتورة مدفوعة بالكامل.</p>}
      {due > 0 && sharedInv && canPay && <p className="muted-sm" style={{ marginTop: 10, marginBottom: 0 }}>ستُسجَّل الدفعة على {live.planId ? 'فاتورة الخطة العلاجية' : 'فاتورة الباقة'} — اكتب المبلغ المدفوع الحين.</p>}
      {due > 0 && instPending && <div className="alert alert-warn" style={{ marginTop: 12 }}>على الفاتورة طلب دفع على دفعتين بانتظار موافقة المدير — لا دفع حتى صدور القرار. تقدر تأكّد الحضور فقط.</div>}
      {due > 0 && !instPending && (canPay ? (
        <div className="grid-form" style={{ marginTop: 12 }}>
          <Select id="cf-method" label="طريقة الدفع" value={method} onChange={(e) => { setMethod(e.target.value as PayChoice); setAmount(''); }} options={PAY_CHOICES} />
          {method !== 'none' && instFixed != null && <Input id="cf-amount" label={db.paymentsForInvoice(inv!.id).some((p) => !p.voidedAt) ? 'الدفعة الثانية (المتبقي) — يحددها النظام' : 'الدفعة الأولى (50%) — يحددها النظام'} value={money(instFixed)} disabled readOnly />}
          {method !== 'none' && instFixed == null && <Input id="cf-amount" label="المبلغ (ج.م)" type="number" min={1} max={due} step="0.01" value={amount === '' ? String(due) : amount} onChange={(e) => setAmount(e.target.value)} error={err || undefined} />}
        </div>
      ) : null)}
      <p className="muted-sm" style={{ marginTop: 10 }}>هل تحتاج إلى تغيير الخدمة أو السعر أو الوقت؟ اضغط «تعديل» قبل التأكيد.</p>
    </Modal>
  );
}
