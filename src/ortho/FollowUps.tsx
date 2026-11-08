// مواعيد المتابعات (هجرة 929 و933): المتابعة اللي ليها طبيب وساعة بتتربط بسجل حجز واحد في «المواعيد» (appointment_id).
// حالة التأكيد بتتقرا من الحجز نفسه، والتغييرات بتتنقل في الاتجاهين (تريجر trg_follow_up_sync على الخادم).
// الحالة المخزنة: scheduled / done / cancelled — «اليوم» و«فائتة» و«قادمة» بتتحسب من التاريخ.
import { useEffect, useMemo, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import { Button, EmptyState, Modal } from '../components/ui';
import BookingWizard from '../components/BookingWizard';
import { useCan } from '../components/common';
import { useDetails } from '../components/DetailsHost';
import { net } from '../offline/net';
import { useAuth } from '../services/auth';
import { DOCTOR_DAY_LABEL, db } from '../data/db';
import { useDbVersion } from '../hooks/useDb';
import { isScopedToOwnPatients } from '../services/permissions';
import { Icon } from '../utils/icons';
import { APPT_STATUS, fmtDate, fmtTime, riyadhNow, todayYmd, waLink, whatsappNumber } from '../utils/format';
import type { Appointment } from '../types';
import { normalizeSearch, phoneMatches } from '../utils/phoneUtils';
import { FOLLOW_UP_KIND, addDays, ortho, useOrthoVersion, type FollowUp, type FollowUpKind } from './data';
import { Field, LoadState, PageHead, PatientSelect, SearchBox, patientFile, patientName, useRun } from './kit';

export type FuState = 'upcoming' | 'today' | 'done' | 'missed' | 'cancelled';
export const FU_STATE: Record<FuState, [string, string]> = {
  upcoming: ['متابعة قادمة', 'brand'], today: ['متابعة اليوم', 'warn'], done: ['متابعة تمت', 'ok'], missed: ['متابعة فائتة', 'danger'], cancelled: ['متابعة ملغاة', 'muted'],
};
export function fuState(f: Pick<FollowUp, 'status' | 'date'>, today = todayYmd()): FuState {
  if (f.status === 'done') return 'done';
  if (f.status === 'cancelled') return 'cancelled';
  return f.date < today ? 'missed' : f.date === today ? 'today' : 'upcoming';
}
const hhmm = (t?: string) => (t ? String(t).slice(0, 5) : '');
const byWhen = (a: FollowUp, b: FollowUp) => a.date.localeCompare(b.date) || hhmm(a.time).localeCompare(hhmm(b.time));
export const fuWhen = (f: Pick<FollowUp, 'date' | 'time'>) => `${fmtDate(f.date)}${f.time ? ` — ${fmtTime(hhmm(f.time))}` : ''}`;

/** الإضافة/التعديل: الطبيب (sessions) أو الاستقبال (appointments) — نفس سياسات الخادم */
export function useFuCan() {
  const can = useCan();
  return {
    add: can('sessions', 'create') || can('appointments', 'create'),
    edit: can('sessions', 'edit') || can('appointments', 'edit'),
    del: can('sessions', 'delete'),
    book: can('booking', 'create') || can('appointments', 'create'),
  };
}

export function FuBadge({ f }: { f: Pick<FollowUp, 'status' | 'date'> }) {
  const [label, tone] = FU_STATE[fuState(f)];
  return <span className={`badge badge--${tone}`}>{label}</span>;
}

/** الطبيب الافتراضي: طبيب الزيارة ← الطبيب المسؤول عن المريض ← حساب الطبيب اللي فاتح */
function useDefaultDoctor(patientId: string, hint?: string | null) {
  const { user } = useAuth();
  const active = db.therapists();
  const ok = (id?: string | null) => (id && active.some((t) => t.id === id) ? id : '');
  // الطبيب الموقوف مايتحطش افتراضي؛ ولو فيه طبيب نشط واحد بس يتختار لوحده
  return ok(hint) || ok(db.patient(patientId)?.doctorId) || ok(user?.therapistId) || (active.length === 1 ? active[0].id : '');
}

export type FuDraft = Omit<FollowUp, 'id' | 'status' | 'appointmentId' | 'consultationId'> & { key?: string; serviceId?: string };

// ---------- الربط بالحجز ----------
const NEEDS_CONFIRM = new Set(['new', 'rescheduled']);
/** الخدمات اللي الطبيب بيقدمها، وخدمات المتابعة الأرخص الأول */
function followUpServices(doctorId: string) {
  const th = db.therapist(doctorId);
  const list = db.services().filter((s) => !th || th.serviceIds.includes(s.id));
  const rank = (name: string) => (/متابع/.test(name) ? 0 : /استشار/.test(name) ? 1 : 2);
  return [...list].sort((a, b) => rank(a.name) - rank(b.name) || a.price - b.price);
}
const kindOfService = (name = ''): FollowUpKind | '' => (/عملي|جراح/.test(name) ? 'surgery' : /اشع|أشع|صور|سونار/.test(name) ? 'imaging' : '');
/** بيعمل الحجز ويرجّع رقمه — نفس دالة الحجز العادية (فحص الوقت والفاتورة والإشعارات) */
async function bookFollowUp(d: { patientId: string; doctorId: string; date: string; time: string; reason: string }, serviceId?: string) {
  const svc = serviceId || followUpServices(d.doctorId)[0]?.id;
  if (!svc) throw new Error('مفيش خدمة متاحة للطبيب ده — ضيف خدمة الأول.');
  const r = await db.createAppointment({ patientId: d.patientId, type: 'followup', serviceId: svc, therapistId: d.doctorId, date: d.date, time: hhmm(d.time), notes: d.reason ? `متابعة: ${d.reason}` : 'متابعة' });
  if (!r.ok) throw new Error(r.error);
  return r.appointment.id;
}
/** شارة حالة الحجز المربوط */
function ApptBadge({ a }: { a: Appointment }) {
  if (NEEDS_CONFIRM.has(a.status)) return <span className="badge badge--warn">محتاج تأكيد</span>;
  const st = APPT_STATUS[a.status];
  return <span className={`badge badge--${st.tone}`}>{st.label}</span>;
}

const emptyDraft = (patientId: string, doctorId: string): FuDraft => ({ patientId, doctorId, date: todayYmd(), time: '', reason: '', notes: '' });

// ---------- نافذة موعد متابعة (جديد / تعديل + تمت / إلغاء / تحويل لحجز / تسجيل حضور) ----------
// الطبيب الأول ← أيام الأسبوعين الجايين (شغال/إجازة/مقفول) ← أوقات دوام الطبيب في اليوم ده (فاضي/محجوز/فيه متابعة/فات)،
// وتحتها كل اللي عند الطبيب في اليوم ده (حجوزات + متابعات) عشان مايتحطش موعدين فوق بعض.
// onDraft: من جوّه تشخيص لسه ما اتحفظش — بيرجّع البيانات بدل ما يحفظ (بتتحفظ مع التشخيص)
const WD = ['الأحد', 'الاثنين', 'الثلاثاء', 'الأربعاء', 'الخميس', 'الجمعة', 'السبت'];
const weekday = (ymd: string) => WD[new Date(ymd + 'T00:00:00').getDay()];
const dayNum = (ymd: string) => Number(ymd.slice(8, 10));
const longDay = (ymd: string) => new Intl.DateTimeFormat('ar-EG', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' }).format(new Date(ymd + 'T00:00:00'));
const minOf = (t: string) => { const [h, m] = t.split(':').map(Number); return h * 60 + (m || 0); };
const near = (a: string, b: string, dur: number) => Math.abs(minOf(a) - minOf(b)) < dur;
const DAYS_AHEAD = 14;

function DoctorDayPlan({ doctorId, date, exceptId }: { doctorId: string; date: string; exceptId?: string }) {
  const appts = db.appointmentsForDate(date).filter((a) => a.therapistId === doctorId && a.status !== 'cancelled');
  const fus = ortho.list('follow_ups').filter((x) => x.date === date && x.doctorId === doctorId && x.status !== 'cancelled' && x.id !== exceptId);
  const rows = [
    ...appts.map((a) => ({ key: a.id, time: a.time, who: patientName(a.patientId), what: db.service(a.serviceId)?.name ?? 'حجز', kind: 'appt' as const, done: a.status === 'completed' || a.status === 'arrived' || a.status === 'in_progress' })),
    ...fus.map((x) => ({ key: x.id, time: hhmm(x.time), who: patientName(x.patientId), what: x.reason || 'متابعة', kind: 'fu' as const, done: x.status === 'done' })),
  ].sort((a, b) => (a.time || '99').localeCompare(b.time || '99'));
  return (
    <div className="fu-plan">
      <div className="fu-plan__h">عند الدكتور في اليوم ده <span className="num">{rows.length}</span></div>
      {rows.length === 0 ? <p className="muted-sm" style={{ margin: 0 }}>اليوم فاضي — مفيش حجوزات ولا متابعات.</p> : (
        <ul className="fu-plan__list">
          {rows.map((r) => (
            <li key={r.key} className={`fu-plan__row fu-plan__row--${r.kind}`}>
              <span className="num fu-plan__t">{r.time ? fmtTime(r.time) : 'من غير ساعة'}</span>
              <span className={`badge badge--${r.kind === 'appt' ? 'info' : 'brand'}`}>{r.kind === 'appt' ? 'حجز' : 'متابعة'}</span>
              <b>{r.who}</b><span className="muted-sm">{r.what}{r.done ? (r.kind === 'appt' ? ' · حضر' : ' · تمت') : ''}</span>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

export function FollowUpModal({ patientId, patientLabel, consultationId, initial, doctorHint, presetDate, onDraft, onSaved, onClose }: {
  patientId: string; patientLabel?: string; consultationId?: string | null; initial?: FollowUp | FuDraft; doctorHint?: string | null; presetDate?: string; onDraft?: (d: FuDraft) => void; onSaved?: (id: string) => void; onClose: () => void;
}) {
  useDbVersion();
  useOrthoVersion();
  const perm = useFuCan();
  const { run, busy } = useRun();
  const doc = useDefaultDoctor(patientId, doctorHint);
  const saved = initial && 'id' in initial ? initial as FollowUp : null;
  const [f, setF] = useState<FuDraft>(() => (initial ? { ...initial, time: hhmm(initial.time) } : { ...emptyDraft(patientId, doc), ...(presetDate ? { date: presetDate } : {}) }));
  const [book, setBook] = useState<number | null>(null); // وقت فتح الحجز — عشان نلاقي الحجز اللي اتعمل ونربطه
  const createdId = useRef<string | undefined>(undefined); // لو الحجز فشل بعد حفظ المتابعة، إعادة المحاولة ماتكررهاش
  const [checkIn, setCheckIn] = useState(false);
  const set = <K extends keyof FuDraft>(k: K, v: FuDraft[K]) => setF((x) => ({ ...x, [k]: v }));
  const canSave = !!f.date && (saved ? perm.edit : perm.add);
  const t = todayYmd();
  const dur = db.therapist(f.doctorId)?.defaultDurationMin || 30;

  const appt = saved?.appointmentId ? db.appointment(saved.appointmentId) : undefined;
  const linked = appt && appt.status !== 'cancelled' ? appt : undefined;
  const services = followUpServices(f.doctorId);
  const [svc, setSvc] = useState(() => services[0]?.id ?? '');
  const svcId = services.some((s) => s.id === svc) ? svc : services[0]?.id ?? '';
  // النوع بييجي من الخدمة المختارة؛ الموعد المحجوز بيحتفظ بنوعه
  const kind = linked ? f.kind ?? '' : kindOfService(db.service(svcId)?.name);
  const row = (patch: Partial<FollowUp>, id?: string) => ({
    ...(saved ?? {}), id: id ?? saved?.id ?? createdId.current, patientId, consultationId: saved?.consultationId || consultationId || '', doctorId: f.doctorId, date: f.date, time: f.time, reason: f.reason.trim(), notes: f.notes.trim(), kind,
    status: saved?.status ?? 'scheduled', appointmentId: linked?.id ?? '', ...patch,
  } as FollowUp);

  /** بيحفظ المتابعة والحجز المربوط بيها مع بعض، ويرجّع رقم الحجز */
  const persist = async (patch: Partial<FollowUp> = {}) => {
    const status = patch.status ?? saved?.status ?? 'scheduled';
    if (linked && status === 'done' && !['arrived', 'in_progress', 'completed'].includes(linked.status)) await db.setAppointmentStatus(linked.id, 'arrived');
    if (linked && status === 'cancelled') await db.setAppointmentStatus(linked.id, 'cancelled', 'إلغاء من مواعيد المتابعة');
    if (linked && status === 'scheduled') {
      if (!f.time) throw new Error('الموعد محجوز — لازم تختار ساعة.');
      if (!f.doctorId) throw new Error('الموعد محجوز — لازم تختار الطبيب.');
      if (f.date !== linked.date || f.time !== linked.time || f.doctorId !== linked.therapistId) {
        const r = await db.rescheduleAppointment(linked.id, f.date, f.time, f.doctorId);
        if (!r.ok) throw new Error(r.error);
      }
    }
    const canBook = !linked && status === 'scheduled' && !!f.time && !!f.doctorId && perm.book && net.isOnline();
    if (canBook) { const issue = db.doctorTimeIssue(f.doctorId, f.date, f.time, dur); if (issue) throw new Error(issue); }
    const id = await ortho.save('follow_ups', row(patch));
    createdId.current = id;
    onSaved?.(id);
    let apptId = linked?.id ?? '';
    if (canBook) {
      apptId = await bookFollowUp({ patientId, doctorId: f.doctorId, date: f.date, time: f.time, reason: f.reason.trim() }, svcId);
      await ortho.save('follow_ups', row({ ...patch, appointmentId: apptId }, id));
    }
    void ortho.reload('follow_ups');
    return apptId;
  };
  const save = (patch: Partial<FollowUp> = {}, msg?: string) => {
    if (onDraft && !saved) { onDraft({ ...f, serviceId: svcId, kind }); onClose(); return; }
    const willBook = !linked && !!f.time && !!f.doctorId && perm.book;
    const text = msg ?? (linked ? 'اتحفظ الموعد في المتابعات والمواعيد' : willBook && net.isOnline() ? 'اتحجز الموعد وظهر في المواعيد والمتابعات' : willBook ? 'اتحفظت المتابعة — افتحها واحفظها لما النت يرجع عشان تتحجز' : 'اتحفظت المتابعة — مش هتظهر في المواعيد لحد ما تحدد الساعة');
    void run(() => persist(patch), text, onClose);
  };
  // التأكيد على نفس سجل الحجز؛ ولو لسه مفيش حجز بيتعمل الأول
  const confirmAppt = () => void run(async () => {
    const id = await persist();
    if (!id) throw new Error(net.isOnline() ? 'اختار الطبيب والساعة الأول عشان الموعد يتأكد.' : 'تأكيد الموعد محتاج اتصال بالإنترنت.');
    await db.setAppointmentStatus(id, 'confirmed');
  }, 'اتأكد الموعد في المتابعات والمواعيد', onClose);
  const closeBooking = () => {
    const since = book ?? Date.now();
    setBook(null);
    // الحجز اللي اتعمل للمريض ده من ساعة ما اتفتح الحجز بيتربط بالمتابعة
    const a = db.appointments().filter((x) => x.patientId === patientId && x.createdAt >= since - 5000 && x.status !== 'cancelled').sort((x, y) => y.createdAt - x.createdAt)[0];
    if (a && saved) void run(() => ortho.save('follow_ups', { ...saved, appointmentId: a.id }), `اتربط الحجز ${a.no} بموعد المتابعة`);
  };

  // الأيام: من النهارده (أو تاريخ المتابعة لو قديم) أسبوعين قدام، وحالة الطبيب في كل يوم
  const start = saved && f.date < t ? f.date : t;
  const days = Array.from({ length: DAYS_AHEAD }, (_, i) => addDays(start, i));
  if (!days.includes(f.date)) days.push(f.date);
  // الترتيب: آخر يوم الأول وبعدين الأقرب لحد النهارده (طلب ٨/١١)
  days.sort((x, y) => y.localeCompare(x));
  const dayState = (d: string) => (f.doctorId ? db.doctorDay(f.doctorId, d).status : 'ok');
  const win = f.doctorId ? db.doctorDay(f.doctorId, f.date) : null;
  // الأوقات: كل بدايات دوام الطبيب في اليوم ده + الوقت المختار لو برّه الدوام
  const slots = f.doctorId ? db.doctorSlots(f.doctorId, f.date, dur) : [];
  const taken = new Set(f.doctorId ? db.takenSlots(f.doctorId, f.date, dur, saved?.appointmentId || undefined) : []);
  const otherFus = ortho.list('follow_ups').filter((x) => x.date === f.date && x.doctorId === f.doctorId && x.status !== 'cancelled' && x.id !== saved?.id && x.time);
  const now = new Date(); const nowMin = now.getHours() * 60 + now.getMinutes();
  const slotState = (s: string): 'free' | 'taken' | 'fu' | 'past' => {
    if (f.date === t && minOf(s) < nowMin && s !== f.time) return 'past';
    if (taken.has(s)) return 'taken';
    if (otherFus.some((x) => near(hhmm(x.time), s, dur))) return 'fu';
    return 'free';
  };
  const freeCount = slots.filter((s) => slotState(s) === 'free').length;
  // المواعيد الفعلية = دوام الطبيب جوّه ساعات المركز (الطبيب ممكن يكون مسجّل طول اليوم والمركز فاتح من 4 لـ 10)
  const maxT = (a?: string, b?: string) => (!a ? b : !b ? a : a > b ? a : b) ?? '';
  const minT = (a?: string, b?: string) => (!a ? b : !b ? a : a < b ? a : b) ?? '';
  const effFrom = maxT(win?.doctorFrom, win?.centerFrom), effTo = minT(win?.doctorTo, win?.centerTo);
  const outside = !!f.time && f.doctorId && win?.status === 'ok' && !slots.includes(f.time);

  // تسجيل حضور: الحجز المربوط بيتعلّم «حضر»، ولو مفيش حجز بيتعمل حجز بأقرب وقت فاضي النهارده مع نفس الطبيب ويتعلّم «حضر» — والمتابعة «تمت»
  const todaySlots = f.doctorId ? db.availableSlots(f.doctorId, t, dur, undefined, patientId) : [];
  const [ciTime, setCiTime] = useState('');
  const doCheckIn = () => void run(async () => {
    if (!saved) return;
    let apptId = linked?.id ?? '';
    if (!apptId) {
      if (!f.doctorId) throw new Error('اختار الطبيب المسؤول الأول.');
      const time = ciTime || todaySlots[0];
      if (!time) throw new Error('مفيش وقت فاضي عند الطبيب النهارده — اختار طبيب تاني أو احجز من «حجز موعد».');
      // المتابعة بتتنقل للنهارده الأول عشان الحجز الجديد يتربط بيها هي ومايتعملش سجل متابعة تاني
      await ortho.save('follow_ups', { ...saved, date: t, time, appointmentId: '' });
      const r = await db.createAppointment({ patientId, type: 'followup', serviceId: svcId, therapistId: f.doctorId, date: t, time, notes: `حضور متابعة${f.reason ? ': ' + f.reason : ''}` });
      if (!r.ok) throw new Error(r.error);
      apptId = r.appointment.id;
    }
    await db.setAppointmentStatus(apptId, 'arrived');
    await ortho.save('follow_ups', { ...saved, date: linked ? saved.date : t, time: linked ? saved.time : ciTime || todaySlots[0], appointmentId: apptId, status: 'done' });
    void ortho.reload('follow_ups');
  }, 'اتسجّل حضور المريض — والمتابعة بقت «تمت»', () => { setCheckIn(false); onClose(); });
  const canCheckIn = !!saved && saved.status === 'scheduled' && saved.date <= t && perm.book;

  return (
    <Modal wide title={saved ? 'موعد متابعة' : 'تحديد موعد متابعة'} onClose={onClose} footer={<>
      {saved && perm.edit && saved.status === 'scheduled' && (!linked || NEEDS_CONFIRM.has(linked.status)) && <Button icon="checkCircle" loading={busy} onClick={confirmAppt}>تأكيد الموعد</Button>}
      {saved && perm.edit && saved.status === 'scheduled' && <>
        <Button variant="outline" icon="check" loading={busy} onClick={() => save({ status: 'done' }, 'اتسجّلت المتابعة «تمت»')}>تمت المتابعة</Button>
        <Button variant="soft-danger" icon="close" loading={busy} onClick={() => window.confirm(linked ? 'إلغاء الموعد؟ هيتلغي من المتابعات والمواعيد مع بعض.' : 'إلغاء موعد المتابعة ده؟') && save({ status: 'cancelled' }, 'اتلغى موعد المتابعة')}>إلغاء الموعد</Button>
      </>}
      {saved && perm.edit && saved.status !== 'scheduled' && <Button variant="outline" icon="refresh" loading={busy} onClick={() => save({ status: 'scheduled' }, 'رجع موعد المتابعة «مجدول»')}>إرجاع كموعد مجدول</Button>}
      {saved && perm.del && <Button variant="soft-danger" icon="trash" loading={busy} onClick={() => window.confirm(linked ? 'حذف موعد المتابعة نهائيًا؟ الحجز المربوط بيه هيتلغي.' : 'حذف موعد المتابعة نهائيًا؟') && void run(async () => { if (linked) await db.setAppointmentStatus(linked.id, 'cancelled', 'حذف موعد المتابعة'); await ortho.remove('follow_ups', saved.id); }, 'تم الحذف', onClose)}>حذف</Button>}
      <Button variant="outline" onClick={onClose}>إغلاق</Button>
      {canSave && <Button icon="check" loading={busy} onClick={() => { if (!f.time && !linked && !window.confirm('مااخترتش ساعة — المتابعة مش هتظهر في المواعيد لحد ما تحدد الساعة. تحفظها كده؟')) return; save(); }}>{onDraft && !saved ? 'إضافة للتشخيص' : 'حفظ'}</Button>}
    </>}>
      <div className="fu-who">
        {patientId ? <>
        <Link to={`/patients/${patientId}`} onClick={onClose} className="ortho-cell-strong">{patientName(patientId)}</Link>
        <span className="badge badge--brand">ملف <span className="num">{patientFile(patientId)}</span></span>
        </> : <><b className="ortho-cell-strong">{patientLabel || '—'}</b> <span className="badge badge--warn">هيتربط بالملف تلقائي</span></>}
        {saved && <FuBadge f={saved} />}
        {appt && <span className="badge badge--info">حجز <span className="num">{appt.no}</span></span>}
        {appt && <ApptBadge a={appt} />}
      </div>

      {canCheckIn && (
        <div className="fu-checkin">
          <div className="fu-checkin__msg"><Icon name="checkCircle" size={18} /><span>{saved!.date === t ? 'متابعة المريض النهارده' : 'المتابعة كان ميعادها فات'} — لما المريض يوصل سجّل حضوره.</span></div>
          {!checkIn ? <Button icon="checkCircle" onClick={() => (appt && appt.status !== 'cancelled' ? doCheckIn() : setCheckIn(true))} loading={busy}>تسجيل حضور المريض</Button> : (
            <div className="fu-checkin__form">
              <Field label="الخدمة"><select className="input" value={svc} onChange={(e) => setSvc(e.target.value)}>{services.map((s) => <option key={s.id} value={s.id}>{s.name} — {s.price} ج.م</option>)}</select></Field>
              <Field label="وقت الحضور (النهارده)">
                <select className="input" value={ciTime || todaySlots[0] || ''} onChange={(e) => setCiTime(e.target.value)}>
                  {todaySlots.length ? todaySlots.map((s) => <option key={s} value={s}>{fmtTime(s)}</option>) : <option value="">مفيش وقت فاضي النهارده</option>}
                </select>
              </Field>
              <Button icon="check" loading={busy} disabled={!todaySlots.length || !svc} onClick={doCheckIn}>تأكيد الحضور</Button>
              <Button variant="outline" onClick={() => setCheckIn(false)}>رجوع</Button>
            </div>
          )}
        </div>
      )}

      <Field label="الطبيب المسؤول">
        <select className="input" value={f.doctorId} disabled={!canSave} onChange={(e) => setF((x) => ({ ...x, doctorId: e.target.value, time: '' }))}>
          <option value="">اختار الطبيب</option>
          {db.allTherapists().filter((th) => th.active || th.id === saved?.doctorId).map((th) => <option key={th.id} value={th.id}>{th.name}</option>)}
        </select>
      </Field>

      <div className="field">
        <label>يوم المتابعة *</label>
        {/* اختيار اليوم من التقويم بس (طلب ٨/١١) — كروت الأيام اتشالت */}
        <div className="fu-datepick">
          <Icon name="calendar" size={18} />
          <input type="date" className="input" aria-label="يوم المتابعة" value={f.date} min={saved ? undefined : t} disabled={!canSave}
            onChange={(e) => e.target.value && setF((x) => ({ ...x, date: e.target.value, time: '' }))} />
        </div>
      </div>

      <div className="fu-dayhead">
        <b>{longDay(f.date)}</b>
        {!f.doctorId ? <span className="muted-sm">اختار الطبيب عشان تظهر مواعيد عمله</span>
          : win && win.status !== 'ok' ? <span className="badge badge--warn">{DOCTOR_DAY_LABEL[win.status]}</span>
          : win && <span className="muted-sm">مواعيد عمل الطبيب: <b className="num">{fmtTime(effFrom)} – {fmtTime(effTo)}</b> · <span className="num">{freeCount}</span> وقت فاضي</span>}
      </div>

      {f.doctorId && win?.status === 'ok' && (
        <div className="field">
          <label>الساعة</label>
          <div className="fu-slots" role="radiogroup" aria-label="ساعة المتابعة">
            {slots.map((s) => {
              const st = slotState(s);
              return (
                <button key={s} type="button" role="radio" aria-checked={f.time === s} disabled={!canSave || st === 'past'}
                  className={`fu-slot fu-slot--${st} ${f.time === s ? 'is-on' : ''}`} onClick={() => set('time', f.time === s ? '' : s)}
                  title={st === 'taken' ? 'فيه حجز للطبيب في الوقت ده' : st === 'fu' ? 'فيه متابعة تانية في الوقت ده' : st === 'past' ? 'الوقت فات' : ''}>
                  <span className="num">{fmtTime(s)}</span>
                  {st !== 'free' && st !== 'past' && <small>{st === 'taken' ? 'محجوز' : 'متابعة'}</small>}
                </button>
              );
            })}
          </div>
          <div className="fu-slots__foot">
            <span className="muted-sm">وقت معيّن برّه الشبكة؟</span>
            <input type="time" className="input fu-slots__time" value={f.time} disabled={!canSave} onChange={(e) => set('time', e.target.value)} />
            {outside && <span className="badge badge--warn">برّه مواعيد عمل الطبيب</span>}
          </div>
        </div>
      )}
      {f.doctorId && win?.status !== 'ok' && (
        <Field label="الساعة (اختياري)"><input type="time" className="input fu-slots__time" value={f.time} disabled={!canSave} onChange={(e) => set('time', e.target.value)} /></Field>
      )}

      {!linked && canSave && f.doctorId && services.length > 0 && (
        <Field label="الخدمة">
          <select className="input" value={svcId} onChange={(e) => setSvc(e.target.value)}>{services.map((s) => <option key={s.id} value={s.id}>{s.name} — {s.price} ج.م</option>)}</select>
        </Field>
      )}
      {f.doctorId && <DoctorDayPlan doctorId={f.doctorId} date={f.date} exceptId={saved?.id} />}

      <div className="grid-form" style={{ marginTop: 12 }}>
        <Field label="سبب المتابعة"><textarea className="input" rows={2} dir="auto" value={f.reason} disabled={!canSave} onChange={(e) => set('reason', e.target.value)} placeholder="مثلاً: متابعة بعد الحقن، مراجعة الأشعة، فك الجبس…" /></Field>
        <Field label="ملاحظات"><textarea className="input" rows={2} dir="auto" value={f.notes} disabled={!canSave} onChange={(e) => set('notes', e.target.value)} /></Field>
      </div>

      {saved && (
        <div className="fu-book">
          {appt ? <span><Icon name="calendar" size={15} /> نفس الموعد في «المواعيد»: <b className="num">{appt.no}</b> — {fmtDate(appt.date)} <span className="num">{fmtTime(appt.time)}</span> <Link to={`/appointments?q=${encodeURIComponent(appt.no)}`} onClick={onClose}>فتح في المواعيد</Link></span>
            : <span className="muted-sm">لسه مش في «المواعيد» — حدد الساعة واحفظ عشان يتحجز.</span>}
          {!linked && perm.book && saved.status === 'scheduled' && <Button size="sm" variant="outline" icon="calendarPlus" onClick={() => setBook(Date.now())}>تحويل لحجز فعلي</Button>}
          {saved.consultationId && <span className="muted-sm">من تشخيص يوم {fmtDate(ortho.list('consultations').find((c) => c.id === saved.consultationId)?.date ?? '') || '—'}</span>}
        </div>
      )}
      {book !== null && saved && <BookingWizard presetPatientId={patientId} presetTherapistId={f.doctorId || undefined} presetDate={f.date} presetTime={f.time || undefined} onClose={closeBooking} />}
    </Modal>
  );
}

// ---------- قايمة متابعات ----------
/** إرسال ميعاد المتابعة للمريض على واتساب (رسالة جاهزة بالميعاد والطبيب) */
export function fuWhatsappText(f: Pick<FollowUp, 'patientId' | 'date' | 'time' | 'doctorId' | 'reason'>) {
  const p = db.patient(f.patientId);
  const doc = f.doctorId ? db.therapist(f.doctorId)?.name : '';
  return [`أهلاً ${p?.fullName ?? ''}،`, `ميعاد متابعتك${doc ? ` مع ${doc}` : ''}: ${longDay(f.date)}${f.time ? ` الساعة ${fmtTime(hhmm(f.time))}` : ''}.`,
    f.reason && f.reason !== 'متابعة' ? `السبب: ${f.reason}` : '', 'عيادة د. إسلام بلتاجي لجراحة العظام والكسور — نتمنى لك السلامة.'].filter(Boolean).join(String.fromCharCode(10));
}
function FuWhatsapp({ f }: { f: FollowUp }) {
  const p = db.patient(f.patientId);
  // رقم الواتساب المسجّل، ولو مفيش: الموبايل — ولو مفيش خالص واتساب بيفتح ويختار الشخص
  const n = p ? whatsappNumber(p) || p.phone || '' : '';
  return <a className="btn btn--outline btn--sm" href={waLink(n, fuWhatsappText(f))} target="_blank" rel="noopener noreferrer" onClick={(e) => e.stopPropagation()}><Icon name="share" size={14} /> إرسال الموعد واتساب</a>;
}

export function FollowUpList({ items, onOpen, showPatient }: { items: FollowUp[]; onOpen: (f: FollowUp) => void; showPatient?: boolean }) {
  useDbVersion();
  const { openVisit } = useDetails();
  const perm = useFuCan();
  const { run, busy } = useRun();
  if (!items.length) return <p className="cx-empty">مفيش مواعيد متابعة.</p>;
  return (
    <ul className="fu-list">
      {items.map((f) => (
        <li key={f.id} className={`fu-item fu-item--${fuState(f)}`}>
          <button type="button" className="fu-item__main" onClick={() => onOpen(f)}>
            <span className="fu-item__when num">{fuWhen(f)}</span>
            <span className="fu-item__reason" dir="auto">{f.reason || 'متابعة'}</span>
            {f.doctorId && <span className="muted-sm">{db.therapist(f.doctorId)?.name}</span>}
          </button>
          {showPatient && <Link to={`/patients/${f.patientId}`} className="fu-item__patient">{patientName(f.patientId)}</Link>}
          <FuBadge f={f} />
          {f.status === 'scheduled' && f.date >= todayYmd() && <FuWhatsapp f={f} />}
          {/* التفاصيل: الحجز المربوط (تفاصيل الموعد) — ولو مفيش حجز: نافذة المتابعة نفسها */}
          <Button size="sm" variant="outline" icon="eye" onClick={() => (f.appointmentId && db.appointment(f.appointmentId) ? openVisit(f.appointmentId) : onOpen(f))}>تفاصيل</Button>
          {(() => {
            const a = f.appointmentId ? db.appointment(f.appointmentId) : undefined;
            if (!a) return f.status === 'scheduled' ? <span className="badge">لسه مش في المواعيد</span> : null;
            return <>
              <ApptBadge a={a} />
              {perm.edit && f.status === 'scheduled' && NEEDS_CONFIRM.has(a.status) && <Button size="sm" icon="checkCircle" loading={busy} onClick={() => void run(() => db.setAppointmentStatus(a.id, 'confirmed'), 'اتأكد الموعد في المتابعات والمواعيد')}>تأكيد</Button>}
            </>;
          })()}
        </li>
      ))}
    </ul>
  );
}

/** كل متابعات المريض (القادمة فوق والسابقة تحت) + إضافة — في ملف المريض ونافذة «مواعيد المتابعة» */
export function PatientFollowUps({ patientId }: { patientId: string }) {
  useOrthoVersion();
  const perm = useFuCan();
  const [edit, setEdit] = useState<FollowUp | 'new' | null>(null);
  const all = ortho.list('follow_ups', patientId).sort(byWhen);
  const t = todayYmd();
  const next = all.filter((f) => f.status === 'scheduled' && f.date >= t);
  const past = all.filter((f) => !next.includes(f)).reverse();
  return (
    <div>
      <div className="row-between" style={{ marginBottom: 10 }}>
        <span className="muted-sm">{all.length ? `${next.length} قادمة · ${past.length} سابقة` : ''}</span>
        {perm.add && <Button size="sm" icon="plus" onClick={() => setEdit('new')}>موعد متابعة جديد</Button>}
      </div>
      <LoadState kind="follow_ups">
        {all.length === 0 ? <EmptyState icon="calendar" title="مفيش مواعيد متابعة" text="المتابعات بتتحدد من التشخيص (تبويب «الخطة العلاجية») أو من هنا." /> : <>
          <div className="section-title">القادمة</div>
          <FollowUpList items={next} onOpen={setEdit} />
          {past.length > 0 && <><div className="section-title" style={{ marginTop: 14 }}>السابقة</div><FollowUpList items={past} onOpen={setEdit} /></>}
        </>}
      </LoadState>
      {edit && <FollowUpModal patientId={patientId} initial={edit === 'new' ? undefined : edit} onClose={() => setEdit(null)} />}
    </div>
  );
}

export function FollowUpsModal({ patientId, onClose }: { patientId: string; onClose: () => void }) {
  return <Modal wide title={`مواعيد المتابعة — ${patientName(patientId)}`} onClose={onClose}><PatientFollowUps patientId={patientId} /></Modal>;
}

const unlinkedFromStep = new Map<string, Set<string>>();
/** خطوة «تحديد موعد متابعة» جوّه التشخيص: الموعد بيتحفظ فورًا، ولو التشخيص لسه جديد بيترتبط بيه عند حفظه */
export function FollowUpStep({ patientId, patientLabel, consultationId, pending, onPending, doctorHint }: {
  patientId: string; patientLabel?: string; consultationId?: string; pending: FuDraft[]; onPending: (p: FuDraft[]) => void; doctorHint?: string | null;
}) {
  useOrthoVersion();
  const perm = useFuCan();
  const [edit, setEdit] = useState<FollowUp | FuDraft | 'new' | null>(null);
  const mine = patientId && consultationId ? ortho.list('follow_ups', patientId).filter((f) => f.consultationId === consultationId).sort(byWhen) : [];
  const t = todayYmd();
  const others = !patientId ? [] : ortho.list('follow_ups', patientId).filter((f) => f.consultationId !== consultationId && f.status === 'scheduled' && f.date >= t).sort(byWhen);
  return (
    <div>
      <p className="muted-sm" style={{ marginTop: 0 }}>حدد ميعاد أو أكتر لمتابعة المريض — الموعد بيتحفظ أول ما تدوس «حفظ» من غير حفظ التشخيص، واللي ليه ساعة بيظهر في «المواعيد».</p>
      {mine.length > 0 && <><div className="section-title">متابعات التشخيص ده</div><FollowUpList items={mine} onOpen={setEdit} /></>}
      {pending.length > 0 && <>
        <div className="section-title">هتتحفظ مع التشخيص</div>
        <ul className="fu-list">
          {pending.map((d, i) => (
            <li key={d.key ?? i} className="fu-item fu-item--upcoming">
              <button type="button" className="fu-item__main" onClick={() => setEdit(d)}>
                <span className="fu-item__when num">{fuWhen(d)}</span><span className="fu-item__reason" dir="auto">{d.reason || 'متابعة'}</span>
              </button>
              <span className="badge badge--warn">لسه ما اتحفظش</span>
              <button type="button" className="icon-btn icon-btn--sm icon-btn--danger" aria-label="شيل الموعد" onClick={() => onPending(pending.filter((x) => x !== d))}><Icon name="trash" size={15} /></button>
            </li>
          ))}
        </ul>
      </>}
      {perm.add && <Button icon="plus" onClick={() => setEdit('new')} style={{ marginTop: 10 }}>إضافة موعد متابعة</Button>}
      {others.length > 0 && <><div className="section-title" style={{ marginTop: 14 }}>متابعات قادمة تانية للمريض</div><FollowUpList items={others} onOpen={setEdit} /></>}
      {edit && (
        <FollowUpModal patientId={patientId} patientLabel={patientLabel} consultationId={consultationId} doctorHint={doctorHint} initial={edit === 'new' ? undefined : edit}
          onDraft={edit === 'new' ? (patientId ? undefined : (d) => onPending([...pending, d])) : !('id' in edit) ? (d) => onPending(pending.map((x) => (x === edit ? { ...d, key: edit.key } : x))) : undefined}
          onSaved={consultationId ? undefined : (id) => unlinkedFromStep.set(patientId, (unlinkedFromStep.get(patientId) ?? new Set<string>()).add(id))}
          onClose={() => setEdit(null)} />
      )}
    </div>
  );
}

/** «موعد المتابعة» جوّه خطة العلاج: الموعد بيتحفظ فورًا في المتابعات (واللي ليه ساعة بيتحجز في «المواعيد»).
 *  التاريخ المقترح = نهاية الخطة، والسبب «متابعة بعد خطة العلاج». */
export function PlanFollowUps({ patientId, endDate, doctorHint }: { patientId: string; endDate?: string; doctorHint?: string | null }) {
  useOrthoVersion();
  const perm = useFuCan();
  const doc = useDefaultDoctor(patientId, doctorHint);
  const [edit, setEdit] = useState<FollowUp | FuDraft | null>(null);
  const t = todayYmd();
  const upcoming = ortho.list('follow_ups', patientId).filter((f) => f.status === 'scheduled' && f.date >= t).sort(byWhen);
  const date = endDate && endDate >= t ? endDate : t;
  return (
    <div>
      <p className="muted-sm" style={{ marginTop: 0 }}>حدد ميعاد متابعة للمريض بعد الخطة أو أثناءها — بيتحفظ أول ما تدوس «حفظ» في نافذة الموعد، واللي ليه ساعة وطبيب بيظهر في «المواعيد».</p>
      {upcoming.length > 0 ? <FollowUpList items={upcoming} onOpen={setEdit} /> : <div className="muted-sm">مفيش متابعات قادمة للمريض.</div>}
      {perm.add && <Button icon="plus" style={{ marginTop: 10 }} onClick={() => setEdit({ ...emptyDraft(patientId, doc), date, reason: 'متابعة بعد خطة العلاج' })}>تحديد موعد متابعة</Button>}
      {edit && <FollowUpModal patientId={patientId} doctorHint={doctorHint} initial={edit} onClose={() => setEdit(null)} />}
    </div>
  );
}

/** بعد حفظ التشخيص: المتابعات الجديدة بتتسجل مربوطة بيه */
export async function savePendingFollowUps(patientId: string, consultationId: string, pending: FuDraft[], canBook = true): Promise<string[]> {
  const problems: string[] = [];
  // المتابعات اللي اتحفظت من خطوة التشخيص قبل ما التشخيص نفسه يتحفظ بتترتبط بيه دلوقتي
  for (const id of unlinkedFromStep.get(patientId) ?? []) {
    const f = ortho.list('follow_ups', patientId).find((x) => x.id === id);
    if (f && !f.consultationId) await ortho.save('follow_ups', { ...f, consultationId });
  }
  unlinkedFromStep.delete(patientId);
  for (const d of pending) {
    const row = { patientId, consultationId, doctorId: d.doctorId, date: d.date, time: d.time, reason: d.reason.trim(), notes: d.notes.trim(), kind: d.kind ?? '', status: 'scheduled' as const, appointmentId: '' };
    const id = await ortho.save('follow_ups', row);
    if (!d.time || !d.doctorId || !canBook || !net.isOnline()) continue;
    // التشخيص والمتابعة اتحفظوا؛ فشل الحجز بيتعرض للمستخدم ومايضيعش الكشف
    try {
      const appointmentId = await bookFollowUp({ patientId, doctorId: d.doctorId, date: d.date, time: d.time, reason: d.reason.trim() }, d.serviceId);
      await ortho.save('follow_ups', { ...row, id, appointmentId });
    } catch (e) { problems.push(`متابعة ${fmtDate(d.date)}: ${(e as Error).message}`); }
  }
  return problems;
}

/** سطر صغير في كارت التشخيص بالمتابعات المربوطة بيه */
export function FollowUpsOfConsult({ consultationId, patientId }: { consultationId: string; patientId: string }) {
  useOrthoVersion();
  const [edit, setEdit] = useState<FollowUp | null>(null);
  const list = ortho.list('follow_ups', patientId).filter((f) => f.consultationId === consultationId).sort(byWhen);
  if (!list.length) return null;
  return (
    <div className="fu-chips">
      <span className="cx-dx__l">المتابعات</span>
      {list.map((f) => <button key={f.id} type="button" className={`fu-chip fu-chip--${fuState(f)}`} onClick={() => setEdit(f)}>{fuWhen(f)}{f.reason ? ` · ${f.reason}` : ''}</button>)}
      {edit && <FollowUpModal patientId={patientId} initial={edit} onClose={() => setEdit(null)} />}
    </div>
  );
}

// ================= صفحة «متابعات المرضى» — تقويم شهري/أسبوعي/يومي =================
type View = 'month' | 'week' | 'day';
const WEEKDAYS = ['السبت', 'الأحد', 'الاثنين', 'الثلاثاء', 'الأربعاء', 'الخميس', 'الجمعة'];
const ymd = (d: Date) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
const parse = (s: string) => new Date(s + 'T00:00:00');
/** أول يوم في الأسبوع (السبت) */
const weekStart = (s: string) => { const d = parse(s); return addDays(s, -((d.getDay() + 1) % 7)); };
const monthTitle = (s: string) => new Intl.DateTimeFormat('ar-EG', { month: 'long', year: 'numeric' }).format(parse(s));
const dayTitle = (s: string) => new Intl.DateTimeFormat('ar-EG', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' }).format(parse(s));
const FILTERS: [FuState | '', string][] = [['', 'الكل'], ['upcoming', 'قادمة'], ['today', 'اليوم'], ['done', 'تمت'], ['missed', 'فائتة'], ['cancelled', 'ملغاة']];

/** جدول اليوم: كل الحجوزات والمتابعات مرتبة بالساعة، والأوقات الفاضية الجاية عند الأطباء */
function DaySchedule({ date, follows, filtered, onOpen, onBook }: {
  date: string; follows: FollowUp[]; filtered: boolean; onOpen: (f: FollowUp) => void; onBook: (p: { date: string; time: string; doctorId?: string }) => void;
}) {
  const { user } = useAuth();
  const { openVisit } = useDetails();
  const perm = useFuCan();
  const { run, busy } = useRun();
  const today = todayYmd();
  const ownOnly = isScopedToOwnPatients(user?.role) || !!user?.therapistId;
  const mine = (doctorId?: string | null) => !ownOnly || doctorId === user?.therapistId;
  const allFu = ortho.list('follow_ups');
  const appts = db.appointmentsForDate(date).filter((a) => a.status !== 'cancelled' && mine(a.therapistId));
  const rows = [
    ...appts.flatMap((a) => {
      const fu = allFu.find((x) => x.appointmentId === a.id);
      if (filtered && !(fu && follows.includes(fu))) return [];
      return [{ key: a.id, time: hhmm(a.time), patientId: a.patientId, doctorId: a.therapistId, fu, appt: a }];
    }),
    ...follows.filter((f) => mine(f.doctorId) && !appts.some((a) => a.id === f.appointmentId)).map((f) => ({ key: f.id, time: hhmm(f.time), patientId: f.patientId, doctorId: f.doctorId, fu: f, appt: undefined as Appointment | undefined })),
  ];

  // الأوقات الفاضية: وقت لسه ماعدّاش وطبيب واحد على الأقل فاضي فيه
  const doctors = db.therapists().filter((d) => mine(d.id));
  const now = riyadhNow(); const nowMin = now.getHours() * 60 + now.getMinutes();
  const free = new Map<string, string[]>();
  if (!filtered && date >= today) for (const d of doctors) {
    const dur = d.defaultDurationMin || 30;
    const taken = new Set(db.takenSlots(d.id, date, dur));
    const fus = allFu.filter((x) => x.date === date && x.doctorId === d.id && x.status !== 'cancelled' && x.time);
    for (const s of db.doctorSlots(d.id, date, dur)) {
      if ((date === today && minOf(s) <= nowMin) || taken.has(s) || fus.some((x) => near(hhmm(x.time), s, dur))) continue;
      free.set(s, [...(free.get(s) ?? []), d.id]);
    }
  }
  const lines = [
    ...rows.map((r) => ({ at: r.time || '99:99', order: 0, r, freeAt: '' })),
    ...[...free.keys()].map((s) => ({ at: s, order: 1, r: undefined, freeAt: s })),
  ].sort((a, b) => a.at.localeCompare(b.at) || a.order - b.order);

  const pending = rows.filter((r) => r.appt && NEEDS_CONFIRM.has(r.appt.status)).length;
  if (!lines.length) return <p className="cx-empty">{filtered ? 'مفيش مواعيد بالفلتر ده في اليوم ده.' : 'مفيش حجوزات في اليوم ده، والأطباء مش شغالين فيه.'}</p>;
  return (
    <>
      <div className="fu-sched__sum muted-sm">
        <span><b className="num">{rows.length}</b> موعد</span>
        <span><b className="num">{pending}</b> محتاج تأكيد</span>
        {!filtered && <span><b className="num">{free.size}</b> وقت فاضي</span>}
      </div>
      <div className="table-wrap">
        <table className="table fu-sched">
          <thead><tr><th>الساعة</th><th>المريض</th><th>النوع</th><th>الخدمة / السبب</th><th>الطبيب</th><th>الحالة</th><th className="actions" aria-label="إجراء" /></tr></thead>
          <tbody>
            {lines.map(({ r, freeAt }) => {
              if (!r) {
                const ids = free.get(freeAt)!;
                return (
                  <tr key={`free-${freeAt}`} className="fu-sched__free">
                    <td className="num">{fmtTime(freeAt)}</td>
                    <td colSpan={3} className="muted-sm">فاضي</td>
                    <td className="muted-sm">{ids.map((id) => db.therapist(id)?.name).join('، ')}</td>
                    <td />
                    <td className="actions">{perm.book && <Button size="sm" variant="outline" icon="plus" onClick={() => onBook({ date, time: freeAt, doctorId: ids.length === 1 ? ids[0] : undefined })}>حجز</Button>}</td>
                  </tr>
                );
              }
              const { fu, appt } = r;
              return (
                <tr key={r.key}>
                  <td className="num"><b>{r.time ? fmtTime(r.time) : 'من غير ساعة'}</b></td>
                  <td>
                    <button type="button" className="fu-sched__who" onClick={() => (fu ? onOpen(fu) : openVisit(appt!.id))}>{patientName(r.patientId)}</button>
                    <div className="muted-sm">ملف <span className="num">{patientFile(r.patientId)}</span></div>
                  </td>
                  <td><span className={`badge badge--${fu ? 'brand' : 'info'}`}>{fu ? (fu.kind ? FOLLOW_UP_KIND[fu.kind] : 'متابعة') : 'حجز'}</span></td>
                  <td dir="auto">{(appt && db.service(appt.serviceId)?.name) || fu?.reason || '—'}</td>
                  <td>{r.doctorId ? db.therapist(r.doctorId)?.name : '—'}</td>
                  <td>{appt ? <ApptBadge a={appt} /> : <FuBadge f={fu!} />}</td>
                  <td className="actions">{appt && perm.edit && NEEDS_CONFIRM.has(appt.status) && <Button size="sm" icon="checkCircle" loading={busy} onClick={() => void run(() => db.setAppointmentStatus(appt.id, 'confirmed'), 'اتأكد الموعد في المتابعات والمواعيد')}>تأكيد</Button>}</td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </>
  );
}

export default function FollowUpsPage({ tabs, pageTitle }: { tabs?: React.ReactNode; pageTitle?: string } = {}) {
  useOrthoVersion();
  useDbVersion();
  const t = todayYmd();
  const [view, setView] = useState<View>('day'); // ٨/١١: يومي بس (اختيار شهري/أسبوعي اتشال)
  const [bookAt, setBookAt] = useState<{ date: string; time: string; doctorId?: string } | null>(null);
  const [cursor, setCursor] = useState(t);
  const [filter, setFilter] = useState<FuState | ''>('');
  const [q, setQ] = useState('');
  const [open, setOpen] = useState<FollowUp | null>(null);
  const [adding, setAdding] = useState(false);
  const { openVisit } = useDetails();
  const perm = useFuCan();
  const { run, busy } = useRun();
  // أي تغيير في الحجوزات بينعكس على المتابعات المربوطة (التريجر بيغيرها على الخادم)
  const apptPrint = db.appointments().map((a) => `${a.id}${a.status}${a.date}${a.time}${a.therapistId}`).join();
  useEffect(() => { void ortho.reload('follow_ups'); }, [apptPrint]);
  // كل المواعيد الجاية اللي لسه محتاجة تأكيد — أي نوع، مش المتابعات بس
  const toConfirm = db.appointments().filter((a) => NEEDS_CONFIRM.has(a.status) && a.date >= t).sort((a, b) => (a.date + a.time).localeCompare(b.date + b.time));

  const all = ortho.list('follow_ups').sort(byWhen);
  const term = q.trim();
  const matches = (f: FollowUp) => {
    if (!term) return true;
    const p = db.patient(f.patientId);
    return normalizeSearch(p?.fullName).includes(normalizeSearch(term)) || phoneMatches(p?.phone, term) || phoneMatches(p?.phone2, term) || String(p?.fileNo ?? '') === term.replace(/\D/g, '');
  };
  const shown = all.filter((f) => (!filter || fuState(f, t) === filter) && matches(f));
  const counts = useMemo(() => {
    const c: Record<string, number> = { '': all.length };
    for (const f of all) { const s = fuState(f, t); c[s] = (c[s] ?? 0) + 1; }
    return c;
  }, [all, t]);
  const byDay = useMemo(() => {
    const m = new Map<string, FollowUp[]>();
    for (const f of shown) { const l = m.get(f.date) ?? []; l.push(f); m.set(f.date, l); }
    return m;
  }, [shown]);

  const step = (n: number) => setCursor((c) => {
    if (view === 'day') return addDays(c, n);
    if (view === 'week') return addDays(c, 7 * n);
    const d = parse(c); return ymd(new Date(d.getFullYear(), d.getMonth() + n, 1));
  });
  const title = view === 'month' ? monthTitle(cursor) : view === 'week' ? `${fmtDate(weekStart(cursor))} — ${fmtDate(addDays(weekStart(cursor), 6))}` : dayTitle(cursor);

  // الشهر: من سبت الأسبوع اللي فيه يوم 1 لحد ما الشهر يخلص (5 أو 6 أسابيع)
  const monthDays = (() => {
    const d = parse(cursor); const first = ymd(new Date(d.getFullYear(), d.getMonth(), 1));
    const start = weekStart(first); const days: string[] = [];
    for (let i = 0; i < 42; i++) { const x = addDays(start, i); if (i >= 35 && parse(x).getMonth() !== d.getMonth()) break; days.push(x); }
    return days;
  })();
  const inMonth = (s: string) => parse(s).getMonth() === parse(cursor).getMonth();
  const Chip = ({ f }: { f: FollowUp }) => (
    <button type="button" className={`fu-chip fu-chip--${fuState(f, t)}`} onClick={() => setOpen(f)} title={`${patientName(f.patientId)} — ${f.reason}`}>
      {f.time && <b className="num">{hhmm(f.time)}</b>} {patientName(f.patientId)}{f.reason ? <span className="fu-chip__r"> · {f.reason}</span> : null}
    </button>
  );
  // الحجوزات العادية (من غير متابعة مربوطة) بتظهر كعدد في الشهر والأسبوع
  const plainCount = (d: string) => (filter ? 0 : db.appointmentsForDate(d).filter((a) => a.status !== 'cancelled' && !all.some((x) => x.appointmentId === a.id)).length);
  const PlainMore = ({ day }: { day: string }) => {
    const n = plainCount(day);
    return n ? <button type="button" className="fu-more" onClick={() => { setCursor(day); setView('day'); }}><span className="num">{n}</span> حجز</button> : null;
  };

  return (
    <div className="page">
      <PageHead title={pageTitle ?? "متابعات المرضى"} sub="مواعيد متابعة كل المرضى — نفس سجلات «المواعيد»، والتأكيد من هنا أو من هناك بيظهر في الاتنين">
        <Button icon="plus" onClick={() => setAdding(true)}>موعد متابعة جديد</Button>
      </PageHead>
      {tabs}
      {toConfirm.length > 0 && (
        <section className="card fu-confirm" aria-label="مواعيد محتاجة تأكيد">
          <div className="card__body">
            <div className="section-title">مواعيد محتاجة تأكيد <span className="num">{toConfirm.length}</span></div>
            <ul className="fu-list">
              {toConfirm.map((a) => {
                const fu = all.find((x) => x.appointmentId === a.id);
                return (
                  <li key={a.id} className="fu-item fu-item--upcoming">
                    <button type="button" className="fu-item__main" onClick={async () => {
                      // بعد فتح الصفحة مباشرة المتابعات ممكن تكون لسه بتتحمّل — حجز نوعه متابعة لازم يفتح متابعته
                      if (!fu && a.type === 'followup') await ortho.reload('follow_ups');
                      const match = fu ?? ortho.list('follow_ups').find((x) => x.appointmentId === a.id);
                      if (match) setOpen(match); else openVisit(a.id);
                    }}>
                      <span className="fu-item__when num">{fmtDate(a.date)} — {fmtTime(a.time)}</span>
                      <span className="fu-item__reason" dir="auto">{db.service(a.serviceId)?.name ?? 'موعد'}</span>
                      {a.therapistId && <span className="muted-sm">{db.therapist(a.therapistId)?.name}</span>}
                    </button>
                    <Link to={`/patients/${a.patientId}`} className="fu-item__patient">{patientName(a.patientId)}</Link>
                    <ApptBadge a={a} />
                    {perm.edit && <Button size="sm" icon="checkCircle" loading={busy} onClick={() => void run(() => db.setAppointmentStatus(a.id, 'confirmed'), 'اتأكد الموعد في المتابعات والمواعيد')}>تأكيد</Button>}
                  </li>
                );
              })}
            </ul>
          </div>
        </section>
      )}
      <section className="card">
        <div className="filter-bar fu-bar">
          <div className="field"><SearchBox value={q} onChange={setQ} placeholder="ابحث باسم المريض أو رقم الهاتف أو رقم الملف" /></div>
          <div className="cx-chips">{FILTERS.map(([k, l]) => <button key={k} type="button" className={`cx-chip ${filter === k ? 'is-on' : ''}`} onClick={() => setFilter(k)}>{l} <span className="num">{counts[k] ?? 0}</span></button>)}</div>
        </div>
        <div className="card__body">
          <LoadState kind="follow_ups">
            {term ? (
              <>
                <div className="section-title">نتايج البحث — كل مواعيد المتابعة ({shown.length})</div>
                <FollowUpList items={shown} onOpen={setOpen} showPatient />
              </>
            ) : <>
              <div className="fu-cal__nav">
                {/* ٨/١١: العرض يومي بس */}
                <div className="fu-cal__move">
                  <button type="button" className="icon-btn" aria-label="السابق" onClick={() => step(-1)}><Icon name="chevron" size={18} /></button>
                  <button type="button" className="btn btn--outline btn--sm" onClick={() => setCursor(t)}>النهارده</button>
                  <button type="button" className="icon-btn" aria-label="التالي" onClick={() => step(1)}><Icon name="chevronLeft" size={18} /></button>
                  <h2 className="fu-cal__title">{title}</h2>
                </div>
              </div>
              {view === 'month' && (
                <div className="fu-month" role="grid">
                  {WEEKDAYS.map((w) => <div key={w} className="fu-month__wd" role="columnheader">{w}</div>)}
                  {monthDays.map((d) => {
                    const items = byDay.get(d) ?? [];
                    return (
                      <div key={d} role="gridcell" className={`fu-month__day ${inMonth(d) ? '' : 'is-out'} ${d === t ? 'is-today' : ''}`}>
                        <button type="button" className="fu-month__n num" onClick={() => { setCursor(d); setView('day'); }} aria-label={`عرض يوم ${fmtDate(d)}`}>{parse(d).getDate()}</button>
                        {items.slice(0, 3).map((f) => <Chip key={f.id} f={f} />)}
                        {items.length > 3 && <button type="button" className="fu-more" onClick={() => { setCursor(d); setView('day'); }}>+{items.length - 3} كمان</button>}
                        <PlainMore day={d} />
                      </div>
                    );
                  })}
                </div>
              )}
              {view === 'week' && (
                <div className="fu-week">
                  {Array.from({ length: 7 }, (_, i) => addDays(weekStart(cursor), i)).map((d, i) => (
                    <div key={d} className={`fu-week__day ${d === t ? 'is-today' : ''}`}>
                      <button type="button" className="fu-week__h" onClick={() => { setCursor(d); setView('day'); }}>{WEEKDAYS[i]} <span className="num">{fmtDate(d)}</span></button>
                      {(byDay.get(d) ?? []).map((f) => <Chip key={f.id} f={f} />)}
                      <PlainMore day={d} />
                      {!(byDay.get(d) ?? []).length && !plainCount(d) && <span className="muted-sm">—</span>}
                    </div>
                  ))}
                </div>
              )}
              {view === 'day' && <DaySchedule date={cursor} follows={byDay.get(cursor) ?? []} filtered={!!filter} onOpen={setOpen} onBook={setBookAt} />}
            </>}
          </LoadState>
        </div>
      </section>
      {open && <FollowUpModal patientId={open.patientId} initial={open} onClose={() => setOpen(null)} />}
      {adding && <NewFollowUp onClose={() => setAdding(false)} />}
      {bookAt && <BookingWizard presetDate={bookAt.date} presetTime={bookAt.time} presetTherapistId={bookAt.doctorId} onClose={() => setBookAt(null)} />}
    </div>
  );
}

/** موعد متابعة جديد من الصفحة: اختيار المريض الأول */
function NewFollowUp({ onClose }: { onClose: () => void }) {
  const [pid, setPid] = useState('');
  if (pid) return <FollowUpModal patientId={pid} onClose={onClose} />;
  return (
    <Modal title="موعد متابعة جديد — اختار المريض" onClose={onClose}>
      <PickPatient onPick={setPid} />
    </Modal>
  );
}
function PickPatient({ onPick }: { onPick: (id: string) => void }) {
  const [v, setV] = useState('');
  return <Field label="المريض"><PatientSelect value={v} onChange={(id) => { setV(id); if (id) onPick(id); }} /></Field>;
}