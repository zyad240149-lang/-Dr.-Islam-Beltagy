// مواعيد المتابعات (هجرة 929): سجل متابعة مستقل مربوط بالمريض والتشخيص والطبيب — مش حجز مؤكد.
// التحويل لحجز فعلي بزرار واضح («تحويل لحجز») بيفتح الحجز العادي، والحجز اللي يتعمل بيتربط بالمتابعة.
// الحالة المخزنة: scheduled / done / cancelled — «اليوم» و«فائتة» و«قادمة» بتتحسب من التاريخ.
import { useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { Button, EmptyState, Modal } from '../components/ui';
import BookingWizard from '../components/BookingWizard';
import { useCan } from '../components/common';
import { useAuth } from '../services/auth';
import { db } from '../data/db';
import { useDbVersion } from '../hooks/useDb';
import { Icon } from '../utils/icons';
import { fmtDate, fmtTime, todayYmd } from '../utils/format';
import { normalizeSearch, phoneMatches } from '../utils/phoneUtils';
import { addDays, ortho, useOrthoVersion, type FollowUp } from './data';
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
  return hint || db.patient(patientId)?.doctorId || user?.therapistId || '';
}

export type FuDraft = Omit<FollowUp, 'id' | 'status' | 'appointmentId' | 'consultationId'> & { key?: string };
const emptyDraft = (patientId: string, doctorId: string): FuDraft => ({ patientId, doctorId, date: addDays(todayYmd(), 7), time: '', reason: '', notes: '' });

// ---------- نافذة موعد متابعة (جديد / تعديل + تمت / إلغاء / تحويل لحجز) ----------
// onDraft: من جوّه تشخيص لسه ما اتحفظش — بيرجّع البيانات بدل ما يحفظ (بتتحفظ مع التشخيص)
export function FollowUpModal({ patientId, consultationId, initial, doctorHint, onDraft, onClose }: {
  patientId: string; consultationId?: string | null; initial?: FollowUp | FuDraft; doctorHint?: string | null; onDraft?: (d: FuDraft) => void; onClose: () => void;
}) {
  useDbVersion();
  const perm = useFuCan();
  const { run, busy } = useRun();
  const doc = useDefaultDoctor(patientId, doctorHint);
  const saved = initial && 'id' in initial ? initial as FollowUp : null;
  const [f, setF] = useState<FuDraft>(() => (initial ? { ...initial, time: hhmm(initial.time) } : emptyDraft(patientId, doc)));
  const [book, setBook] = useState<number | null>(null); // وقت فتح الحجز — عشان نلاقي الحجز اللي اتعمل ونربطه
  const set = <K extends keyof FuDraft>(k: K, v: FuDraft[K]) => setF((x) => ({ ...x, [k]: v }));
  const canSave = !!f.date && (saved ? perm.edit : perm.add);

  const save = (patch: Partial<FollowUp> = {}, msg = 'تم حفظ موعد المتابعة') => {
    if (onDraft && !saved) { onDraft(f); onClose(); return; }
    void run(() => ortho.save('follow_ups', {
      ...(saved ?? {}), patientId, consultationId: saved?.consultationId || consultationId || '', doctorId: f.doctorId, date: f.date, time: f.time, reason: f.reason.trim(), notes: f.notes.trim(),
      status: saved?.status ?? 'scheduled', appointmentId: saved?.appointmentId ?? '', ...patch,
    } as FollowUp), msg, onClose);
  };
  const closeBooking = () => {
    const since = book ?? Date.now();
    setBook(null);
    // الحجز اللي اتعمل للمريض ده من ساعة ما اتفتح الحجز بيتربط بالمتابعة
    const a = db.appointments().filter((x) => x.patientId === patientId && x.createdAt >= since - 5000 && x.status !== 'cancelled').sort((x, y) => y.createdAt - x.createdAt)[0];
    if (a && saved) void run(() => ortho.save('follow_ups', { ...saved, appointmentId: a.id }), `اتربط الحجز ${a.no} بموعد المتابعة`);
  };
  const appt = saved?.appointmentId ? db.appointment(saved.appointmentId) : undefined;

  return (
    <Modal title={saved ? 'موعد متابعة' : 'تحديد موعد متابعة'} onClose={onClose} footer={<>
      {saved && perm.edit && saved.status === 'scheduled' && <>
        <Button variant="outline" icon="check" loading={busy} onClick={() => save({ status: 'done' }, 'اتسجّلت المتابعة «تمت»')}>تمت المتابعة</Button>
        <Button variant="soft-danger" icon="close" loading={busy} onClick={() => window.confirm('إلغاء موعد المتابعة ده؟') && save({ status: 'cancelled' }, 'اتلغى موعد المتابعة')}>إلغاء الموعد</Button>
      </>}
      {saved && perm.edit && saved.status !== 'scheduled' && <Button variant="outline" icon="refresh" loading={busy} onClick={() => save({ status: 'scheduled' }, 'رجع موعد المتابعة «مجدول»')}>إرجاع كموعد مجدول</Button>}
      {saved && perm.del && <Button variant="soft-danger" icon="trash" loading={busy} onClick={() => window.confirm('حذف موعد المتابعة نهائيًا؟') && void run(() => ortho.remove('follow_ups', saved.id), 'تم الحذف', onClose)}>حذف</Button>}
      <Button variant="outline" onClick={onClose}>إغلاق</Button>
      {canSave && <Button icon="check" loading={busy} onClick={() => save()}>{onDraft && !saved ? 'إضافة للتشخيص' : 'حفظ'}</Button>}
    </>}>
      <p className="muted" style={{ marginTop: 0 }}>
        <Link to={`/patients/${patientId}`} onClick={onClose} className="ortho-cell-strong">{patientName(patientId)}</Link>
        <span className="badge badge--brand" style={{ marginInlineStart: 8 }}>ملف <span className="num">{patientFile(patientId)}</span></span>
        {saved && <span style={{ marginInlineStart: 8 }}><FuBadge f={saved} /></span>}
      </p>
      <div className="grid-form">
        <Field label="تاريخ المتابعة *"><input type="date" className="input" value={f.date} min={saved ? undefined : todayYmd()} disabled={!canSave} onChange={(e) => set('date', e.target.value)} /></Field>
        <Field label="الساعة"><input type="time" className="input" value={f.time} disabled={!canSave} onChange={(e) => set('time', e.target.value)} /></Field>
        <Field label="الطبيب المسؤول">
          <select className="input" value={f.doctorId} disabled={!canSave} onChange={(e) => set('doctorId', e.target.value)}>
            <option value="">غير محدد</option>
            {db.allTherapists().map((t) => <option key={t.id} value={t.id}>{t.name}</option>)}
          </select>
        </Field>
      </div>
      <Field label="سبب المتابعة"><textarea className="input" rows={2} dir="auto" value={f.reason} disabled={!canSave} onChange={(e) => set('reason', e.target.value)} placeholder="مثلاً: متابعة بعد الحقن، مراجعة الأشعة، فك الجبس…" /></Field>
      <Field label="ملاحظات"><textarea className="input" rows={2} dir="auto" value={f.notes} disabled={!canSave} onChange={(e) => set('notes', e.target.value)} /></Field>
      {saved && (
        <div className="fu-book">
          {appt ? <span><Icon name="calendar" size={15} /> اتحوّل لحجز <b className="num">{appt.no}</b> — {fmtDate(appt.date)} <span className="num">{fmtTime(appt.time)}</span></span>
            : <span className="muted-sm">ده موعد متابعة بس — مش حجز مؤكد.</span>}
          {!appt && perm.book && saved.status === 'scheduled' && <Button size="sm" variant="outline" icon="calendarPlus" onClick={() => setBook(Date.now())}>تحويل لحجز فعلي</Button>}
          {saved.consultationId && <span className="muted-sm">من تشخيص يوم {fmtDate(ortho.list('consultations').find((c) => c.id === saved.consultationId)?.date ?? '') || '—'}</span>}
        </div>
      )}
      {book !== null && saved && <BookingWizard presetPatientId={patientId} presetTherapistId={f.doctorId || undefined} presetDate={f.date} presetTime={f.time || undefined} onClose={closeBooking} />}
    </Modal>
  );
}

// ---------- قايمة متابعات ----------
export function FollowUpList({ items, onOpen, showPatient }: { items: FollowUp[]; onOpen: (f: FollowUp) => void; showPatient?: boolean }) {
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
          {f.appointmentId && <span className="badge badge--info">محجوز</span>}
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
        {all.length === 0 ? <EmptyState icon="calendar" title="مفيش مواعيد متابعة" text="المتابعات بتتحدد من التشخيص (خطوة «تحديد موعد متابعة») أو من هنا." /> : <>
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

/** خطوة «تحديد موعد متابعة» جوّه التشخيص: المتابعات المحفوظة للتشخيص ده + الجديدة (بتتحفظ مع حفظ التشخيص) */
export function FollowUpStep({ patientId, consultationId, pending, onPending, doctorHint }: {
  patientId: string; consultationId?: string; pending: FuDraft[]; onPending: (p: FuDraft[]) => void; doctorHint?: string | null;
}) {
  useOrthoVersion();
  const perm = useFuCan();
  const [edit, setEdit] = useState<FollowUp | FuDraft | 'new' | null>(null);
  if (!patientId) return <p className="muted">مواعيد المتابعة بتتفتح بعد ما التشخيص يتربط بملف المريض.</p>;
  const mine = consultationId ? ortho.list('follow_ups', patientId).filter((f) => f.consultationId === consultationId).sort(byWhen) : [];
  const t = todayYmd();
  const others = ortho.list('follow_ups', patientId).filter((f) => f.consultationId !== consultationId && f.status === 'scheduled' && f.date >= t).sort(byWhen);
  return (
    <div>
      <p className="muted-sm" style={{ marginTop: 0 }}>حدد ميعاد أو أكتر لمتابعة المريض — المتابعة مش حجز مؤكد، وتقدر تحوّلها لحجز من «متابعات المرضى» أو من ملف المريض.</p>
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
        <FollowUpModal patientId={patientId} consultationId={consultationId} doctorHint={doctorHint} initial={edit === 'new' ? undefined : edit}
          onDraft={(d) => {
            const old = edit !== 'new' && !('id' in edit) ? edit : null;
            const item = { ...d, key: old?.key ?? crypto.randomUUID() };
            onPending(old ? pending.map((x) => (x === old ? item : x)) : [...pending, item]);
          }}
          onClose={() => setEdit(null)} />
      )}
    </div>
  );
}

/** بعد حفظ التشخيص: المتابعات الجديدة بتتسجل مربوطة بيه */
export async function savePendingFollowUps(patientId: string, consultationId: string, pending: FuDraft[]) {
  for (const d of pending) {
    await ortho.save('follow_ups', { patientId, consultationId, doctorId: d.doctorId, date: d.date, time: d.time, reason: d.reason.trim(), notes: d.notes.trim(), status: 'scheduled', appointmentId: '' });
  }
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

export default function FollowUpsPage() {
  useOrthoVersion();
  useDbVersion();
  const t = todayYmd();
  const [view, setView] = useState<View>(() => (window.matchMedia?.('(max-width: 640px)').matches ? 'day' : 'month'));
  const [cursor, setCursor] = useState(t);
  const [filter, setFilter] = useState<FuState | ''>('');
  const [q, setQ] = useState('');
  const [open, setOpen] = useState<FollowUp | null>(null);
  const [adding, setAdding] = useState(false);

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
  const DayList = ({ day }: { day: string }) => {
    const items = byDay.get(day) ?? [];
    return items.length ? <FollowUpList items={items} onOpen={setOpen} showPatient /> : <p className="cx-empty">مفيش متابعات في اليوم ده.</p>;
  };

  return (
    <div className="page">
      <PageHead title="متابعات المرضى" sub="مواعيد متابعة كل المرضى — المتابعة مش حجز مؤكد ويمكن تحويلها لحجز">
        <Button icon="plus" onClick={() => setAdding(true)}>موعد متابعة جديد</Button>
      </PageHead>
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
                <div className="seg" role="tablist" aria-label="طريقة العرض">
                  {([['month', 'شهري'], ['week', 'أسبوعي'], ['day', 'يومي']] as [View, string][]).map(([k, l]) => <button key={k} type="button" role="tab" aria-selected={view === k} className={`seg__btn ${view === k ? 'active' : ''}`} onClick={() => setView(k)}>{l}</button>)}
                </div>
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
                      {!(byDay.get(d) ?? []).length && <span className="muted-sm">—</span>}
                    </div>
                  ))}
                </div>
              )}
              {view === 'day' && <DayList day={cursor} />}
            </>}
          </LoadState>
        </div>
      </section>
      {open && <FollowUpModal patientId={open.patientId} initial={open} onClose={() => setOpen(null)} />}
      {adding && <NewFollowUp onClose={() => setAdding(false)} />}
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