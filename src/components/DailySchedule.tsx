// جدول المواعيد اليومي في الواجهة الرئيسية: Timeline لليوم من فتح المركز لإغلاقه (من «مواعيد العمل» في الإعدادات)،
// عمود لكل طبيب شغّال في اليوم ده، وكل الخانات ظاهرة حتى الفاضية. البيانات من المواعيد الفعلية (db ← Supabase + Realtime)،
// فأي حجز جديد بيظهر في خانته فورًا من غير Refresh.
import { useEffect, useMemo, useState } from 'react';
import { db } from '../data/db';
import { useDbVersion } from '../hooks/useDb';
import { Button, EmptyState } from './ui';
import { Icon } from '../utils/icons';
import { addDaysYmd, fmtDate, fmtTime, initials, todayYmd, riyadhNow } from '../utils/format';
import type { Appointment, AppointmentStatus, Therapist } from '../types';
import { ActorBadges } from './AppointmentActor';

const toMin = (t: string) => { const [h, m] = t.split(':').map(Number); return h * 60 + (m || 0); };
const toHm = (n: number) => `${String(Math.floor(n / 60)).padStart(2, '0')}:${String(n % 60).padStart(2, '0')}`;
const DAY_KEYS = ['sun', 'mon', 'tue', 'wed', 'thu', 'fri', 'sat'] as const;
const dayKeyOf = (ymd: string) => DAY_KEYS[new Date(ymd + 'T00:00:00').getDay()];

// الحالات بالمسميات المطلوبة: محجوز / مؤكد / حضر / ملغي …
const SLOT_STATUS: Record<AppointmentStatus, { label: string; cls: string }> = {
  new: { label: 'محجوز', cls: 'booked' }, rescheduled: { label: 'محجوز (معاد جدولته)', cls: 'booked' },
  confirmed: { label: 'مؤكد', cls: 'confirmed' }, on_way: { label: 'مؤكد', cls: 'confirmed' },
  arrived: { label: 'حضر', cls: 'arrived' }, in_progress: { label: 'حضر — قيد الزيارة', cls: 'arrived' },
  completed: { label: 'مكتمل', cls: 'done' }, no_show: { label: 'لم يحضر', cls: 'noshow' }, cancelled: { label: 'ملغي', cls: 'cancelled' },
} as Record<AppointmentStatus, { label: string; cls: string }>;
const NO_DOCTOR = '__none__';

// onlyDoctorId: حساب الدكتور بيشوف عموده هو بس (من غير اختيار طبيب)
export default function DailySchedule({ onOpen, onBook, onlyDoctorId }: { onOpen: (a: Appointment) => void; onBook?: (preset: { therapistId?: string; date: string; time: string }) => void; onlyDoctorId?: string }) {
  useDbVersion();
  const [date, setDate] = useState(todayYmd());
  const [doctorPick, setDoctor] = useState('');
  const doctor = onlyDoctorId || doctorPick;
  const center = db.center();
  const day = center.weekSchedule.find((d) => d.day === dayKeyOf(date));
  // مدة الخانة = مدة الموعد الافتراضية من الإعدادات (ولو مش متحددة: خطوة الحجز)
  const step = Math.max(5, center.defaultAppointmentMin || center.slotStepMin || 30);

  const data = useMemo(() => {
    const appts = db.appointments().filter((a) => a.date === date);
    // دوام كل طبيب في اليوم ده من جدوله المسجّل (إجازة/مش من أيام عمله = مش بيظهر إلا لو عنده مواعيد)
    const working = (t: Therapist) => { const w = db.doctorDay(t.id, date); return w.status === 'ok' ? { from: w.doctorFrom!, to: w.doctorTo! } : null; };
    const cols = db.allTherapists()
      .filter((t) => (t.active && working(t)) || appts.some((a) => a.therapistId === t.id))
      .map((t) => ({ id: t.id, name: t.name, title: t.title, wh: t.active ? working(t) : null }));
    if (appts.some((a) => !a.therapistId || !db.therapist(a.therapistId) && !cols.some((c) => c.id === a.therapistId))) cols.push({ id: NO_DOCTOR, name: 'بدون طبيب محدد', title: '', wh: null });
    return { appts, cols };
  }, [date, db.appointments().length, db.appointments(), db.allTherapists(), center]);

  if (!day || !day.open) {
    return (
      <Shell date={date} setDate={setDate}>
        <EmptyState icon="calendar" title="المركز مغلق في هاليوم" text="حسب «مواعيد العمل» في الإعدادات — اختر يوم ثاني." />
      </Shell>
    );
  }
  const open = toMin(day.from), close = toMin(day.to);
  const times: string[] = [];
  for (let t = open; t + step <= close; t += step) times.push(toHm(t));
  const cols = data.cols.filter((c) => !doctor || c.id === doctor);
  if (times.length === 0) return <Shell date={date} setDate={setDate}><EmptyState icon="clock" title="ساعات العمل غير مضبوطة" text="راجع «مواعيد العمل» في الإعدادات." /></Shell>;
  if (cols.length === 0) {
    return <Shell date={date} setDate={setDate}><EmptyState icon="users" title="ما فيه أطباء يعملون في هاليوم" text="راجع أيام وساعات عمل الأطباء من «الموظفون ← المعالجون»." /></Shell>;
  }

  const colOf = (a: Appointment) => (a.therapistId && data.cols.some((c) => c.id === a.therapistId) ? a.therapistId : NO_DOCTOR);
  // الخانة اللي بيبدأ فيها الموعد + عدد الخانات اللي بيغطيها (موعد ساعة = خانتين لو الخانة نص ساعة)
  const startsAt = (colId: string, slot: string) => data.appts
    .filter((a) => colOf(a) === colId && toMin(a.time) >= toMin(slot) && toMin(a.time) < toMin(slot) + step)
    .sort((x, y) => x.time.localeCompare(y.time) || Number(x.status === 'cancelled') - Number(y.status === 'cancelled'));
  const covering = (colId: string, slot: string) => data.appts.find((a) => a.status !== 'cancelled' && colOf(a) === colId
    && toMin(a.time) < toMin(slot) && toMin(a.time) + a.durationMin > toMin(slot));
  const inShift = (c: (typeof cols)[number], slot: string) => {
    if (c.id === NO_DOCTOR) return true;
    return !!c.wh && !db.doctorTimeIssue(c.id, date, slot, step); // جوّه دوام الطبيب نفسه
  };
  const isPast = (slot: string) => date < todayYmd() || (date === todayYmd() && toMin(slot) + step <= (riyadhNow().getHours() * 60 + riyadhNow().getMinutes()));
  const active = data.appts.filter((a) => a.status !== 'cancelled');

  return (
    <Shell date={date} setDate={setDate} extra={
      !onlyDoctorId && data.cols.length > 1 && (
        <select className="input ds-doctor" value={doctor} onChange={(e) => setDoctor(e.target.value)} aria-label="الطبيب">
          <option value="">كل الأطباء</option>
          {data.cols.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
        </select>
      )}
      summary={<>من <span className="num">{fmtTime(day.from)}</span> إلى <span className="num">{fmtTime(day.to)}</span> · خانة كل <span className="num">{step}</span> دقيقة · <span className="num">{active.length}</span> موعد</>}>
      {/* Timeline رأسي (نفس شكل «معاد»): الوقت + نقطة وخط، وكارت لكل حجز، والخانات الفاضية «متاح» مع الأطباء المتاحين */}
      <div className="tl">
        {/* الوقت اللي فات مايظهرش — إلا لو فيه موعد محجوز فيه */}
        {(() => { const shown = times.filter((slot) => !isPast(slot) || cols.some((c) => startsAt(c.id, slot).length > 0 || covering(c.id, slot)));
          return shown.length === 0 ? <p className="muted" style={{ padding: 12 }}>انتهت مواعيد اليوم.</p> : shown.map((slot, ri) => {
          const here = cols.flatMap((c) => startsAt(c.id, slot));
          const liveHere = here.filter((a) => a.status !== 'cancelled');
          const freeDocs = cols.filter((c) => c.id !== NO_DOCTOR && inShift(c, slot) && !startsAt(c.id, slot).some((a) => a.status !== 'cancelled') && !covering(c.id, slot));
          const busyCont = cols.filter((c) => covering(c.id, slot));
          const past = isPast(slot);
          const now = !past && date === todayYmd() && toMin(slot) <= (riyadhNow().getHours() * 60 + riyadhNow().getMinutes());
          const dot = liveHere.length ? 'busy' : freeDocs.length ? 'free' : 'off';
          return (
            <div key={slot} className={`tl-row ${past ? 'tl-row--past' : ''} ${now ? 'tl-row--now' : ''}`}>
              <div className="tl-rail">
                <div className="tl-time num">{fmtTime(slot)}</div>
                <span className={`tl-dot tl-dot--${dot}`} />
                {ri < shown.length - 1 && <span className="tl-line" />}
              </div>
              <div className="tl-body">
                {here.map((a) => {
                  const p = db.patient(a.patientId); const st = SLOT_STATUS[a.status] ?? { label: a.status, cls: 'booked' };
                  return (
                    <button type="button" key={a.id} className={`tl-card tl-card--${st.cls}`} onClick={() => onOpen(a)} title="تفاصيل الموعد">
                      <span className="avatar">{initials(p?.fullName ?? '؟')}</span>
                      <span className="tl-card__main">
                        <span className="tl-card__name">{p?.fullName ?? 'مريض'}</span>
                        <span className="tl-card__meta">{db.service(a.serviceId)?.name ?? '—'} · {db.therapist(a.therapistId)?.name ?? 'بدون طبيب'}</span>
                        <span className="tl-card__meta"><span className="num">{fmtTime(a.time)}</span> · <span className="num">{a.durationMin}</span> دقيقة{a.status !== 'cancelled' && <Countdown date={a.date} time={a.time} />}</span>
                        <span className="tl-card__actors"><ActorBadges a={a} /></span>
                      </span>
                      <span className={`tl-pill tl-pill--${st.cls}`}>{st.label}</span>
                    </button>
                  );
                })}
                {busyCont.length > 0 && liveHere.length === 0 && (
                  <div className="tl-cont">مستمر: {busyCont.map((c) => { const a = covering(c.id, slot)!; return `${db.patient(a.patientId)?.fullName ?? 'مريض'} (${c.name})`; }).join(' · ')}</div>
                )}
                {freeDocs.length > 0 && !past ? (
                  <div className="tl-free">
                    <span className="tl-free__label">{past ? 'فات الوقت' : 'متاح'}</span>
                    {!past && freeDocs.map((c) => onBook
                      ? <button type="button" key={c.id} className="tl-chip" onClick={() => onBook({ therapistId: c.id, date, time: slot })}><Icon name="calendarPlus" size={13} /> {c.name}</button>
                      : <span key={c.id} className="tl-chip tl-chip--static">{c.name}</span>)}
                  </div>
                ) : null}
              </div>
            </div>
          );
        }); })()}
      </div>
      <div className="ds-legend">
        <span><i className="ds-dot ds-dot--free" />متاح</span><span><i className="ds-dot ds-dot--booked" />محجوز</span><span><i className="ds-dot ds-dot--confirmed" />مؤكد</span>
        <span><i className="ds-dot ds-dot--arrived" />حضر</span><span><i className="ds-dot ds-dot--done" />مكتمل</span><span><i className="ds-dot ds-dot--cancelled" />ملغي</span>
      </div>
    </Shell>
  );
}

// عدّاد تنازلي للموعد (باقي / الموعد الآن / فات) — نفس فكرة «معاد»
function Countdown({ date, time }: { date: string; time: string }) {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => { const id = setInterval(() => setNow(Date.now()), 30000); return () => clearInterval(id); }, []);
  const diff = new Date(`${date}T${time}:00`).getTime() - now;
  if (Number.isNaN(diff)) return null;
  const m = Math.round(Math.abs(diff) / 60000);
  const txt = Math.abs(diff) < 60000 ? 'الموعد الآن' : `${diff > 0 ? 'باقي' : 'فات بـ'} ${m >= 60 ? `${Math.floor(m / 60)}س ` : ''}${m % 60}د`;
  return <span className={`tl-count ${diff > 0 ? 'tl-count--up' : ''}`}> · <Icon name="clock" size={12} /> {txt}</span>;
}

function Shell({ date, setDate, extra, summary, children }: { date: string; setDate: (d: string) => void; extra?: React.ReactNode; summary?: React.ReactNode; children: React.ReactNode }) {
  const today = todayYmd();
  return (
    <section className="card ds-card">
      <div className="card__head ds-head">
        <div>
          <h2>جدول المواعيد اليومي</h2>
          <p className="muted-sm" style={{ margin: 0 }}>{fmtDate(date)}{date === today ? ' — اليوم' : ''}{summary && <> · {summary}</>}</p>
        </div>
        <div className="ds-nav">
          <Button size="sm" variant="outline" onClick={() => setDate(addDaysYmd(date, -1))} aria-label="اليوم السابق"><Icon name="chevron" size={15} /></Button>
          <input type="date" className="input ds-date" value={date} onChange={(e) => e.target.value && setDate(e.target.value)} aria-label="اختر اليوم" />
          <Button size="sm" variant="outline" onClick={() => setDate(addDaysYmd(date, 1))} aria-label="اليوم التالي"><Icon name="chevronLeft" size={15} /></Button>
          {date !== today && <Button size="sm" variant="ghost" onClick={() => setDate(today)}>اليوم</Button>}
          {extra}
        </div>
      </div>
      <div className="card__body">{children}</div>
    </section>
  );
}
