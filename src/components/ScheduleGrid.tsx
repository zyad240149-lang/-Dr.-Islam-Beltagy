// جدول المواعيد (Day / Week): الوقت عمودي والأطباء أعمدة. كل موعد Block ممتد بطول مدته الفعلية، وكل خانة فاضية زرار حجز مباشر.
// المصدر: المواعيد الفعلية في db (Supabase + Realtime) فأي حجز/إلغاء بيظهر فورًا من غير Refresh. الأوقات من «مواعيد العمل» (ساعات المركز) + إجازة الدكتور + المواعيد القائمة.
// الحجز نفسه بيتحقق منه الخادم (check_slot + تريجر منع التداخل) — الواجهة هنا عرض وتسهيل بس.
import { useEffect, useMemo, useState } from 'react';
import { db, DOCTOR_DAY_LABEL, type DoctorDayWindow } from '../data/db';
import { useDbVersion } from '../hooks/useDb';
import { EmptyState } from './ui';
import { Icon } from '../utils/icons';
import { APPT_STATUS, fmtTime, riyadhNow, todayYmd } from '../utils/format';
import type { Appointment, AppointmentStatus } from '../types';
import { bookedTitle, isOnline, Who } from './AppointmentActor';

const ROW_H = 58; // ارتفاع خانة واحدة (بكسل)
const toMin = (t: string) => { const [h, m] = t.split(':').map(Number); return h * 60 + (m || 0); };
const toHm = (n: number) => `${String(Math.floor(n / 60) % 24).padStart(2, '0')}:${String(n % 60).padStart(2, '0')}`;
const DAY_KEYS = ['sun', 'mon', 'tue', 'wed', 'thu', 'fri', 'sat'] as const;
const dayKeyOf = (ymd: string) => DAY_KEYS[new Date(ymd + 'T00:00:00').getDay()];

// الحالة: لون + نص + أيقونة (مش لون بس)
const ST: Record<string, { label: string; cls: string; icon: string }> = {
  new: { label: 'محجوز', cls: 'booked', icon: 'clock' }, rescheduled: { label: 'محجوز (معاد جدولته)', cls: 'booked', icon: 'refresh' },
  confirmed: { label: 'مؤكد', cls: 'confirmed', icon: 'check' }, on_way: { label: 'مؤكد', cls: 'confirmed', icon: 'check' },
  arrived: { label: 'حضر', cls: 'arrived', icon: 'user' }, in_progress: { label: 'قيد الجلسة', cls: 'arrived', icon: 'user' },
  completed: { label: 'مكتمل', cls: 'done', icon: 'checkCircle' }, no_show: { label: 'لم يحضر', cls: 'noshow', icon: 'alert' },
};
const stOf = (s: AppointmentStatus | string) => ST[s] ?? { label: APPT_STATUS[s as AppointmentStatus]?.label ?? String(s), cls: 'booked', icon: 'clock' };

function useIsMobile() {
  const [m, setM] = useState(() => typeof window !== 'undefined' && window.matchMedia('(max-width: 768px)').matches);
  useEffect(() => {
    const mq = window.matchMedia('(max-width: 768px)'); const on = () => setM(mq.matches);
    mq.addEventListener('change', on); return () => mq.removeEventListener('change', on);
  }, []);
  return m;
}
function useMinuteClock() {
  const [, setT] = useState(0);
  useEffect(() => { const id = setInterval(() => setT((x) => x + 1), 30_000); return () => clearInterval(id); }, []);
  const n = riyadhNow(); return n.getHours() * 60 + n.getMinutes();
}

export interface Preset { therapistId: string; date: string; time: string }
interface Col { key: string; title: string; sub?: string; therapistId: string; date: string; onLeave: boolean; win: DoctorDayWindow }
const colWin = (therapistId: string, d: string) => db.doctorDay(therapistId, d);

// توزيع المواعيد المتداخلة على «مسارات» جنب بعض (نادرًا — بيانات قديمة)
function lanes(list: Appointment[]): Map<string, { lane: number; of: number }> {
  const out = new Map<string, { lane: number; of: number }>();
  const sorted = [...list].sort((a, b) => toMin(a.time) - toMin(b.time));
  let group: Appointment[] = []; let groupEnd = -1;
  const flush = () => { const ends: number[] = []; for (const a of group) { let l = ends.findIndex((e) => e <= toMin(a.time)); if (l < 0) { l = ends.length; ends.push(0); } ends[l] = toMin(a.time) + a.durationMin; out.set(a.id, { lane: l, of: 0 }); } for (const a of group) out.get(a.id)!.of = Math.max(1, ends.length); group = []; };
  for (const a of sorted) { if (group.length && toMin(a.time) >= groupEnd) { flush(); groupEnd = -1; } group.push(a); groupEnd = Math.max(groupEnd, toMin(a.time) + a.durationMin); }
  if (group.length) flush();
  return out;
}

export default function ScheduleGrid({ mode, date, doctorId, scopedDoctorId, matches, searching, canBook, onOpen, onBook }: {
  mode: 'day' | 'week'; date: string; doctorId: string; scopedDoctorId?: string; matches: (a: Appointment) => boolean; searching: boolean; canBook: boolean;
  onOpen: (a: Appointment) => void; onBook: (p: Preset) => void;
}) {
  useDbVersion();
  const mobile = useIsMobile();
  const nowMin = useMinuteClock();
  const center = db.center();
  const today = todayYmd();
  const step = Math.max(5, center.slotStepMin || 30);
  const [mobileDoc, setMobileDoc] = useState('');

  // الأعمدة: يوم = الأطباء، أسبوع = أيام الأسبوع لطبيب واحد
  const therapists = db.allTherapists().filter((t) => t.active && (!scopedDoctorId || t.id === scopedDoctorId));
  const weekStart = (() => { const d = new Date(date + 'T00:00:00'); d.setDate(d.getDate() - d.getDay()); return d; })();
  const weekDays = Array.from({ length: 7 }, (_, i) => { const d = new Date(weekStart); d.setDate(d.getDate() + i); return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`; });
  const activeDoctor = mode === 'week' ? (doctorId || scopedDoctorId || therapists[0]?.id || '') : (mobile ? (mobileDoc || doctorId || therapists[0]?.id || '') : doctorId);

  const cols: Col[] = useMemo(() => {
    if (mode === 'week') {
      const th = db.therapist(activeDoctor);
      return weekDays.map((d) => ({ key: d, title: new Date(d + 'T00:00:00').toLocaleDateString(document.documentElement.lang === 'en' ? 'en-GB' : 'ar-SA-u-nu-latn', { weekday: 'long' }), sub: `${d.slice(8)}/${d.slice(5, 7)}`, therapistId: activeDoctor, date: d, ...(() => { const win = th ? colWin(th.id, d) : { status: 'no_doctor' as const }; return { win, onLeave: win.status === 'leave' }; })() }));
    }
    const dayAppts = db.appointmentsForDate(date);
    const list = therapists.filter((t) => !activeDoctor || t.id === activeDoctor);
    // طبيب غير نشط عنده مواعيد في اليوم لسه بيظهر عشان المواعيد ماتختفيش
    const extra = db.allTherapists().filter((t) => !t.active && dayAppts.some((a) => a.therapistId === t.id && a.status !== 'cancelled') && (!activeDoctor || t.id === activeDoctor));
    return [...list, ...extra].map((t) => ({ key: t.id, title: t.name, sub: t.title, therapistId: t.id, date, ...(() => { const win = colWin(t.id, date); return { win, onLeave: win.status === 'leave' }; })() }));
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [mode, date, activeDoctor, therapists.length, db.appointments(), db.allTherapists(), center]);

  // ساعات الجدول: أوسع فترة بين الأيام المعروضة
  const range = (() => {
    let lo = 24 * 60, hi = 0;
    for (const c of cols) { const d = center.weekSchedule.find((x) => x.day === dayKeyOf(c.date)); if (d?.open) { lo = Math.min(lo, toMin(d.from)); hi = Math.max(hi, toMin(d.to)); } }
    return hi > lo ? { lo, hi } : null;
  })();

  if (!therapists.length) return <EmptyState icon="users" title="ما فيه أطباء" text="أضف طبيبًا من «الموظفون» حتى يظهر جدول المواعيد." />;
  if (!range) return <EmptyState icon="calendar" title="المركز مغلق" text={mode === 'day' ? 'المركز مغلق في هاليوم حسب «مواعيد العمل» — اختر يوم ثاني.' : 'المركز مغلق طول هذا الأسبوع حسب «مواعيد العمل».'} />;

  // اللي فات مش بيظهر: النهارده الجدول بيبدأ من أول خانة بعد الوقت الحالي بتوقيت القاهرة
  let lo = range.lo;
  if (mode === 'day' && date === today) { while (lo <= nowMin) lo += step; }
  // المحجوز لازم يفضل ظاهر: الجدول بيبدأ من أقدم موعد في اليوم (حتى لو فات)، والخانات الفاضية اللي فاتت بتتعرض فاضية من غير حجز
  const dayActive = mode === 'day' ? db.appointmentsForDate(date).filter((x) => x.status !== 'cancelled' && cols.some((c) => c.therapistId === x.therapistId)) : [];
  const firstAppt = dayActive.length ? Math.min(...dayActive.map((x) => toMin(x.time))) : Infinity;
  const hasEarlier = date === today && firstAppt < lo;
  if (hasEarlier) lo = Math.max(range.lo, range.lo + Math.floor((firstAppt - range.lo) / step) * step);
  if (mode === 'day' && date === today && !hasEarlier && lo > range.hi) {
    return <EmptyState icon="clock" title="انتهت مواعيد اليوم" text="ما فيه خانات قادمة اليوم بتوقيت القاهرة — اختر يوم ثاني (زر «غدًا»)." />;
  }
  const slots: number[] = []; for (let t = lo; t <= range.hi; t += step) slots.push(t);
  const ppm = ROW_H / step;
  const base = lo; // أول دقيقة معروضة
  const total = slots.length * ROW_H;

  const apptsOf = (c: Col) => db.appointmentsForDate(c.date).filter((a) => a.therapistId === c.therapistId && a.status !== 'cancelled');
  const isPastSlot = (d: string, t: number) => d < today || (d === today && t <= nowMin);
  const openDay = (d: string) => center.weekSchedule.find((x) => x.day === dayKeyOf(d));
  const inHours = (d: string, t: number) => { const w = openDay(d); return !!w?.open && t >= toMin(w.from) && t <= toMin(w.to); };

  // إحصائيات اليوم
  let freeCount = 0, apptCount = 0;
  const colData = cols.map((c) => {
    const list = apptsOf(c);
    apptCount += list.length;
    const lane = lanes(list);
    const cells = slots.map((t) => {
      const covered = list.some((a) => toMin(a.time) < t + step && toMin(a.time) + a.durationMin > t);
      // خارج دوام الدكتور نفسه (أو يوم إجازته/مش من أيام عمله) = «غير متاح» — نفس قواعد الحجز على الخادم
      const offDoctor = c.win.status !== 'ok' || !!db.doctorTimeIssue(c.therapistId, c.date, toHm(t), step);
      const state: 'free' | 'busy' | 'past' | 'off' | 'closed' = !inHours(c.date, t) ? 'closed' : covered ? 'busy' : offDoctor ? 'off' : isPastSlot(c.date, t) ? 'past' : 'free';
      if (state === 'free') freeCount++;
      return { t, state };
    });
    const upcoming = c.date === today ? list.filter((a) => toMin(a.time) > nowMin && a.status !== 'completed' && a.status !== 'no_show').sort((a, b) => toMin(a.time) - toMin(b.time))[0] : undefined;
    return { c, list, lane, cells, upcomingId: upcoming?.id };
  });
  const dayFull = mode === 'day' && date >= today && freeCount === 0 && colData.length > 0 && !colData.every((x) => x.c.win.status !== 'ok');

  return (
    <div className="tg-wrap">
      {mobile && mode === 'day' && therapists.length > 1 && (
        <div className="tg-docs" role="tablist" aria-label="اختر الدكتور">
          {therapists.map((t) => <button key={t.id} type="button" role="tab" aria-selected={activeDoctor === t.id} className={`tg-doc ${activeDoctor === t.id ? 'on' : ''}`} onClick={() => setMobileDoc(t.id)}>{t.name}</button>)}
        </div>
      )}
      <div className="tg-summary muted-sm">
        <span><Icon name="calendar" size={13} /> <span className="num">{apptCount}</span> موعد</span>
        <span><Icon name="plus" size={13} /> <span className="num">{freeCount}</span> خانة متاحة</span>
        {mode === 'week' && <span><Icon name="user" size={13} /> {db.therapist(activeDoctor)?.name}</span>}
      </div>
      {dayFull && <div className="alert alert-info" style={{ marginBottom: 10 }}><Icon name="alert" size={16} /><div>اليوم ممتلئ بالكامل — ما فيه خانات متاحة. جرّب يوم ثاني.</div></div>}
      {apptCount === 0 && !searching && <div className="alert alert-info" style={{ marginBottom: 10 }}><Icon name="calendar" size={16} /><div>ما فيه مواعيد {mode === 'day' ? 'اليوم' : 'هذا الأسبوع'} — اضغط على أي خانة «متاح» للحجز.</div></div>}

      <div className="tg-scroll">
        <div className="tg" style={{ gridTemplateColumns: `64px repeat(${cols.length}, minmax(${mobile ? 0 : mode === 'week' ? 120 : 160}px, 1fr))` }}>
          {/* الرأس */}
          <div className="tg-corner" />
          {colData.map(({ c, list, cells }) => (
            <div key={c.key} className={`tg-head ${c.date === today && mode === 'week' ? 'is-today' : ''}`}>
              <strong>{c.title}</strong>
              <span className="muted-sm">{c.sub ? `${c.sub} · ` : ''}<span className="num">{list.length}</span> موعد · <span className="num">{cells.filter((x) => x.state === 'free').length}</span> متاح</span>
              {c.win.status === 'ok'
                ? <span className="muted-sm">الدوام: <span className="num">{fmtTime(c.win.doctorFrom!)} – {fmtTime(c.win.doctorTo!)}</span></span>
                : c.win.status !== 'closed' && <span className="tg-tag"><Icon name="alert" size={11} /> {c.win.status === 'leave' ? 'في إجازة' : DOCTOR_DAY_LABEL[c.win.status]}</span>}
            </div>
          ))}
          {/* محور الوقت */}
          <div className="tg-axis" style={{ height: total }}>
            {slots.map((t) => <div key={t} className="tg-axis__t num" style={{ height: ROW_H }}>{fmtTime(toHm(t))}</div>)}
          </div>
          {/* أعمدة الأطباء/الأيام */}
          {colData.map(({ c, list, lane, cells, upcomingId }) => (
            <div key={c.key} className="tg-col" style={{ height: total }}>
              {cells.map(({ t, state }) => {
                const time = toHm(t);
                if (state === 'busy') return <div key={t} className="tg-cell tg-cell--busy" style={{ height: ROW_H }} aria-hidden />;
                if (state === 'free') return canBook
                  ? <button key={t} type="button" className="tg-cell tg-cell--free" style={{ height: ROW_H }} onClick={() => onBook({ therapistId: c.therapistId, date: c.date, time })}
                      aria-label={`حجز ${c.title} ${c.date} ${fmtTime(time)}`}><Icon name="plus" size={14} /><span>متاح</span></button>
                  : <div key={t} className="tg-cell tg-cell--free tg-cell--static" style={{ height: ROW_H }}><span>متاح</span></div>;
                if (state === 'past') return <div key={t} className="tg-cell tg-cell--past" style={{ height: ROW_H }} aria-hidden />;
                return <div key={t} className="tg-cell tg-cell--off" style={{ height: ROW_H }}><span>غير متاح</span></div>;
              })}
              {/* خط الوقت الحالي */}
              {c.date === today && nowMin >= base && nowMin <= range.hi + step && <div className="tg-now" style={{ top: (nowMin - base) * ppm }} aria-hidden />}
              {/* المواعيد */}
              {list.filter((a) => toMin(a.time) + a.durationMin > base).map((a) => {
                const st = stOf(a.status); const p = db.patient(a.patientId);
                const top = Math.max(0, (toMin(a.time) - base) * ppm); const h = Math.max((toMin(a.time) + a.durationMin - Math.max(toMin(a.time), base)) * ppm, 26);
                const ln = lane.get(a.id) ?? { lane: 0, of: 1 };
                const start = toMin(a.time), end = start + a.durationMin;
                const current = c.date === today && nowMin >= start && nowMin < end && a.status !== 'completed' && a.status !== 'no_show';
                const dim = searching && !matches(a);
                const compact = h < 64;
                return (
                  <button key={a.id} type="button" onClick={() => onOpen(a)} title={`${p?.fullName ?? ''} — ${db.service(a.serviceId)?.name ?? ''} — ${fmtTime(a.time)} – ${fmtTime(toHm(end))}${bookedTitle(a) ? ' — ' + bookedTitle(a) : ''}`}
                    className={`tg-appt tg-appt--${st.cls} ${current ? 'is-current' : ''} ${dim ? 'is-dim' : ''} ${searching && !dim ? 'is-hit' : ''}`}
                    style={{ top, height: h - 2, insetInlineStart: `${(ln.lane * 100) / ln.of}%`, width: `calc(${100 / ln.of}% - 3px)` }}>
                    <span className="tg-appt__top"><Icon name={st.icon} size={12} /><span className="tg-appt__st">{st.label}</span>{isOnline(a) && <b className="tg-badge tg-badge--web" title="حجزه المريض بنفسه من الموقع">حجز أونلاين من الموقع</b>}{a.createdByKind === 'staff' && <b className="tg-badge tg-badge--by" title={bookedTitle(a)}><span>حجزه:</span> <Who name={a.createdByName?.split(' ')[0]} role={a.createdByRole} /></b>}{current && <b className="tg-badge tg-badge--now">الآن</b>}{!current && upcomingId === a.id && <b className="tg-badge">التالي</b>}</span>
                    <strong className="tg-appt__name">{p?.fullName ?? 'مريض'}{a.pendingSync && <span title="بانتظار المزامنة — لم يصل للخادم بعد" aria-label="بانتظار المزامنة"> ⟳</span>}</strong>
                    {!compact && <span className="tg-appt__svc">{db.service(a.serviceId)?.name ?? '—'}</span>}
                    <span className="tg-appt__time num">{fmtTime(a.time)} – {fmtTime(toHm(end))}</span>
                  </button>
                );
              })}
            </div>
          ))}
        </div>
      </div>
      <div className="ds-legend tg-legend">
        <span><i className="tg-sw tg-sw--free" />متاح (اضغط للحجز)</span><span><i className="tg-sw tg-sw--booked" />محجوز</span><span><i className="tg-sw tg-sw--confirmed" />مؤكد</span>
        <span><i className="tg-sw tg-sw--arrived" />حضر</span><span><i className="tg-sw tg-sw--done" />مكتمل</span><span><i className="tg-sw tg-sw--off" />غير متاح</span>
      </div>
    </div>
  );
}
