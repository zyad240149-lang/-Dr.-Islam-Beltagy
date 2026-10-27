// مواعيد جلسات الخطة العلاجية — مصدر واحد لمكانين:
//  1) «إنشاء خطة علاج جديدة» (PlanModal): مسودة صفوف (اختيارية) بتتحجز بعد حفظ الخطة مباشرة (bookDraftSessions).
//  2) «مراجعة فاتورة الخطة العلاجية» + تفاصيل/تعديل الخطة (PlanSessionBooking): المحجوز فعلًا + حجز الباقي.
// الاتنين بيقروا ويكتبوا نفس المواعيد الحقيقية (appointments.plan_id) عبر book_plan_session (هجرة 165):
// الدكتور إجباري، دوام الدكتور (check_slot)، كل جلسة 30 دقيقة (الجلسة التانية في اليوم بموافقة المدير عند الحضور)، ومايزيدش عن عدد جلسات الخطة.
// الخطة دايمًا ليها فاتورة (مسودة لحد ما الاستقبال يراجعها) فمواعيدها مابتطلعش فواتير منفصلة.
import { useMemo, useState } from 'react';
import { db } from '../data/db';
import { useDbVersion } from '../hooks/useDb';
import { Button, Input, Select } from './ui';
import { useToast } from '../hooks/useToast';
import { useAuth } from '../services/auth';
import { APPT_STATUS, addDaysYmd, fmtDate, fmtTime, todayYmd } from '../utils/format';
import type { Appointment, TreatmentPlan } from '../types';
import { RescheduleModal } from './AppointmentActions';

export type SessionRow = { date: string; time: string; therapistId: string };
export const emptyRow = (therapistId = ''): SessionRow => ({ date: '', time: '', therapistId });
const filled = (r: SessionRow) => !!(r.therapistId && r.date && r.time);
const ACTIVE = (a: Appointment) => a.status !== 'cancelled' && a.status !== 'no_show';
// كل جلسة خطة/باقة 30 دقيقة (نفس durationMin اللي بيبعته الخادم في book_plan_session)
export const PLAN_SESSION_MIN = 30;
const toMin = (t: string) => { const [h, m] = t.split(':').map(Number); return h * 60 + m; };


// المريض عنده موعد تاني (أي نوع) بيتقاطع مع الوقت ده؟ — جلستين في نفس اليوم مسموحين لو في وقتين مختلفين
function patientBusyAt(patientId: string, date: string, time: string): boolean {
  return db.raw().appointments.some((a) => a.patientId === patientId && a.date === date && ACTIVE(a)
    && toMin(time) < toMin(a.time) + (a.durationMin || PLAN_SESSION_MIN) && toMin(a.time) < toMin(time) + PLAN_SESSION_MIN);
}
export function planBookedAppointments(planId: string): Appointment[] {
  return db.raw().appointments.filter((a) => a.planId === planId && ACTIVE(a)).sort((a, b) => (a.date + a.time < b.date + b.time ? -1 : 1));
}
export function defaultPlanDoctor(serviceId: string, preferred?: string | null, userTherapistId?: string | null): string {
  const doctors = db.therapistsForService(serviceId);
  if (preferred && doctors.some((t) => t.id === preferred)) return preferred;
  if (userTherapistId && doctors.some((t) => t.id === userTherapistId)) return userTherapistId;
  return doctors[0]?.id ?? '';
}

// اقتراح تلقائي: أول يوم فيه وقت فاضي للدكتور (ومفيش للمريض موعد متقاطع معاه)، وبعده كل يومين — وتقدر تعدّل أي حاجة
export function suggestSessionRows(o: { patientId: string; serviceId: string; therapistId: string; count: number; from?: string; gapDays?: number; skipDays?: Set<string> }): SessionRow[] {
  const taken = new Set(o.skipDays ?? []);
  const out: SessionRow[] = [];
  let d = o.from && o.from > todayYmd() ? o.from : todayYmd();
  for (let i = 0; i < o.count; i++) {
    let time = '';
    for (let guard = 0; guard < 45; guard++) {
      const slots = o.therapistId && !taken.has(d) ? db.availableSlots(o.therapistId, d, PLAN_SESSION_MIN).filter((t) => !patientBusyAt(o.patientId, d, t)) : [];
      if (slots.length) { time = slots[0]; break; }
      d = addDaysYmd(d, 1);
    }
    out.push({ date: time ? d : '', time, therapistId: o.therapistId });
    if (time) taken.add(d);
    d = addDaysYmd(d, Math.max(1, o.gapDays ?? 2));
  }
  return out;
}

// مشاكل الصفوف قبل الحجز: ناقص، وقتين متقاطعين، موعد تاني للمريض في نفس الوقت، أو خارج دوام الدكتور
// (جلستين في نفس اليوم مسموحين لو وقتهم مختلف — والجلسة التانية في الحضور بموافقة المدير)
export function sessionRowIssues(rows: SessionRow[], patientId: string, _serviceId: string): Record<number, string> {
  const out: Record<number, string> = {};
  rows.forEach((r, i) => {
    if (!r.date && !r.time) return;
    if (!r.therapistId) { out[i] = 'اختر الدكتور'; return; }
    if (!r.date || !r.time) { out[i] = 'اختر التاريخ والوقت'; return; }
    const clash = rows.findIndex((o, j) => j < i && o.date === r.date && o.time && Math.abs(toMin(o.time) - toMin(r.time)) < PLAN_SESSION_MIN);
    if (clash >= 0) { out[i] = `نفس وقت الجلسة ${clash + 1}`; return; }
    if (patientBusyAt(patientId, r.date, r.time)) { out[i] = 'عند المريض موعد تاني في هالوقت'; return; }
    const why = db.doctorTimeIssue(r.therapistId, r.date, r.time, PLAN_SESSION_MIN);
    if (why) out[i] = why;
  });
  return out;
}

// حجز صفوف المسودة على خطة اتحفظت: بالترتيب، ولحد عدد الجلسات الفاضية بس (الخادم بيتحقق تاني)
export async function bookDraftSessions(planId: string, rows: SessionRow[]): Promise<{ booked: number; errors: string[] }> {
  const plan = db.plan(planId);
  if (!plan) return { booked: 0, errors: ['الخطة العلاجية غير موجودة'] };
  const room = Math.max(0, plan.totalSessions - planBookedAppointments(planId).length);
  const ready = rows.filter(filled).slice(0, room);
  const errors: string[] = [];
  let booked = 0;
  for (const r of ready) {
    const res = await db.bookPlanSession({ planId, therapistId: r.therapistId, date: r.date, time: r.time });
    if (res.ok) booked++; else errors.push(`${fmtDate(r.date)} ${fmtTime(r.time)}: ${res.error}`);
  }
  return { booked, errors };
}

// صفوف التحرير (دكتور / تاريخ / وقت) — نفس الشكل في المكانين
export function SessionRowsEditor({ rows, onChange, serviceId, startNo, issues, onBook, busyIndex, disabled }: {
  rows: SessionRow[]; onChange: (i: number, r: SessionRow) => void; serviceId: string; startNo: number;
  issues: Record<number, string>; onBook?: (i: number) => void; busyIndex?: number | 'all' | null; disabled?: boolean;
}) {
  const dur = PLAN_SESSION_MIN;
  const doctors = db.therapistsForService(serviceId);
  return (
    <>
      {rows.map((r, i) => {
        const slots = r.therapistId && r.date ? db.availableSlots(r.therapistId, r.date, dur) : [];
        const set = (patch: Partial<SessionRow>) => onChange(i, { ...r, ...patch, ...(patch.date !== undefined || patch.therapistId !== undefined ? { time: '' } : {}) });
        return (
          <div key={i} style={{ marginBottom: 6 }}>
            <div className="grid-form" style={{ gridTemplateColumns: onBook ? '70px 1fr 1fr 1fr auto' : '70px 1fr 1fr 1fr 36px', alignItems: 'end', gap: 8 }}>
              <div className="num" style={{ paddingBottom: 10, fontWeight: 700 }}>جلسة {startNo + i}</div>
              <Select id={`psb-d-${startNo + i}`} label="الدكتور" value={r.therapistId} onChange={(e) => set({ therapistId: e.target.value })} disabled={disabled}
                options={[{ value: '', label: 'اختر…' }, ...doctors.map((t) => ({ value: t.id, label: t.name }))]} />
              <Input id={`psb-date-${startNo + i}`} label="التاريخ" type="date" min={todayYmd()} value={r.date} onChange={(e) => set({ date: e.target.value })} disabled={disabled} />
              {slots.length || !r.therapistId || !r.date
                ? <Select id={`psb-t-${startNo + i}`} label="الوقت" value={r.time} onChange={(e) => onChange(i, { ...r, time: e.target.value })} disabled={disabled}
                    options={[{ value: '', label: !r.therapistId || !r.date ? 'اختر الدكتور والتاريخ' : 'اختر الوقت' }, ...(r.time && !slots.includes(r.time) ? [r.time] : []).concat(slots).map((t) => ({ value: t, label: fmtTime(t) }))]} />
                // مفيش أوقات مقترحة (يوم مقفول/الدكتور مشغول أو برّه دوامه) → اكتب الوقت بنفسك والخادم بيتحقق
                : <Input id={`psb-t-${startNo + i}`} label="الوقت (اكتبه)" type="time" value={r.time} onChange={(e) => onChange(i, { ...r, time: e.target.value })} disabled={disabled} />}
              {onBook
                ? <Button size="sm" onClick={() => onBook(i)} loading={busyIndex === i} disabled={busyIndex != null || disabled}>حجز</Button>
                : <Button type="button" size="sm" variant="ghost" aria-label="مسح" title="مسح" disabled={disabled} onClick={() => onChange(i, emptyRow(r.therapistId))}>✕</Button>}
            </div>
            {issues[i] && <div style={{ color: 'var(--danger)', fontSize: 12.5, marginTop: 2 }}>{issues[i]}</div>}
          </div>
        );
      })}
    </>
  );
}

// الجدول المحجوز + حجز الباقي — «مراجعة فاتورة الخطة» وتفاصيل/تعديل الخطة
export default function PlanSessionBooking({ plan, canBook, ensurePriced }: { plan: TreatmentPlan; canBook: boolean; ensurePriced?: () => Promise<boolean> }) {
  useDbVersion();
  const toast = useToast();
  const { user } = useAuth();
  const booked = planBookedAppointments(plan.id);
  const remaining = Math.max(0, plan.totalSessions - booked.length);
  const [rows, setRows] = useState<Record<number, SessionRow>>({});
  const [busy, setBusy] = useState<number | 'all' | null>(null);
  const [editing, setEditing] = useState<Appointment | null>(null);
  // الخطة ليها فاتورة (حتى لو مسودة بسعر 0) = مواعيدها مابتطلعش فواتير منفصلة (نفس شرط book_appointment)
  const hasInvoice = db.invoicesForPatient(plan.patientId).some((i) => i.planId === plan.id && i.status !== 'cancelled');
  const priced = (plan.price ?? 0) > 0 || hasInvoice || !!ensurePriced;

  const doctor = defaultPlanDoctor(plan.serviceId, booked[booked.length - 1]?.therapistId || plan.therapistId, user?.therapistId);
  const suggestions = useMemo(() => suggestSessionRows({
    patientId: plan.patientId, serviceId: plan.serviceId, therapistId: doctor, count: remaining,
    from: booked.length ? addDaysYmd(booked[booked.length - 1].date, 1) : plan.startDate,
    gapDays: plan.sessionsPerWeek === 1 && plan.durationWeeks === plan.totalSessions ? 2 : Math.max(1, Math.floor(7 / Math.max(1, plan.sessionsPerWeek))),
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }), [plan.id, booked.length, remaining]);
  const list = Array.from({ length: remaining }, (_, i) => rows[i] ?? suggestions[i] ?? emptyRow(doctor));
  const issues = sessionRowIssues(list, plan.patientId, plan.serviceId);

  const bookOne = async (i: number): Promise<boolean> => {
    const r = list[i];
    const no = booked.length + i + 1;
    if (!filled(r)) { toast.error(`الجلسة ${no}: اختر الدكتور والتاريخ والوقت.`); return false; }
    if (issues[i]) { toast.error(`الجلسة ${no}: ${issues[i]}`); return false; }
    if (ensurePriced && !(await ensurePriced())) return false;
    const res = await db.bookPlanSession({ planId: plan.id, therapistId: r.therapistId, date: r.date, time: r.time });
    if (!res.ok) { toast.error(`الجلسة ${no}: ${res.error}`); return false; }
    setRows({});
    return true;
  };
  const book = async (i: number) => { setBusy(i); if (await bookOne(i)) toast.success('تم حجز الجلسة.'); setBusy(null); };
  const bookAll = async () => {
    const ready = list.map((r, i) => (filled(r) ? i : -1)).filter((i) => i >= 0);
    if (!ready.length) { toast.error('حدد موعد جلسة واحدة على الأقل.'); return; }
    const bad = ready.find((i) => issues[i]);
    if (bad !== undefined) { toast.error(`الجلسة ${booked.length + bad + 1}: ${issues[bad]}`); return; }
    if (ensurePriced && !(await ensurePriced())) return;
    setBusy('all');
    const res = await bookDraftSessions(plan.id, ready.map((i) => list[i]));
    setRows({});
    if (res.booked) toast.success(`تم حجز ${res.booked} جلسة.`);
    res.errors.forEach((e) => toast.error(e));
    setBusy(null);
  };

  return (
    <div style={{ marginTop: 16 }}>
      <h3 style={{ fontSize: 15, margin: '0 0 6px' }}>مواعيد الجلسات <span className="muted num" style={{ fontWeight: 400 }}>({booked.length} من {plan.totalSessions} محجوزة)</span></h3>
      {booked.length > 0 && (
        <div className="table-wrap" style={{ marginBottom: 10 }}><table className="table">
          <thead><tr><th>الجلسة</th><th>التاريخ</th><th>الوقت</th><th>الدكتور</th><th>الحالة</th>{canBook && <th></th>}</tr></thead>
          <tbody>{booked.map((a, i) => <tr key={a.id}><td className="num">{i + 1}</td><td className="num date">{fmtDate(a.date)}</td><td className="num">{fmtTime(a.time)}</td><td>{db.therapist(a.therapistId)?.name ?? '—'}</td><td>{APPT_STATUS[a.status]?.label}</td>{canBook && <td>{['new', 'confirmed', 'rescheduled'].includes(a.status) && <Button size="sm" variant="outline" icon="edit" onClick={() => setEditing(a)}>تعديل الموعد</Button>}</td>}</tr>)}</tbody>
        </table></div>
      )}
      {remaining === 0 ? <p className="muted">كل الجلسات محجوزة.</p>
        : !canBook ? <p className="muted">ما عندك صلاحية حجز المواعيد.</p>
        : plan.status !== 'active' ? <p className="muted">الخطة غير نشطة — ما يمكن حجز جلسات عليها.</p>
        : !priced ? <div className="alert alert-warn"><div>حدد سعر الخطة واضغط «حفظ التعديل» أولًا، وبعدها احجز مواعيد الجلسات (حتى لا تصدر لكل جلسة فاتورة منفصلة).</div></div>
        : (<>
          <p className="muted" style={{ fontSize: 12.5, margin: '0 0 8px' }}>مواعيد مقترحة حسب دوام الدكتور — تقدر تغيّر الدكتور أو التاريخ أو الوقت قبل الحجز. كل جلسة 30 دقيقة، ولو حجزت جلستين في نفس اليوم الثانية بتحتاج موافقة المدير عند الحضور.</p>
          <SessionRowsEditor rows={list} onChange={(i, r) => setRows((x) => ({ ...x, [i]: r }))} serviceId={plan.serviceId}
            startNo={booked.length + 1} issues={issues} onBook={book} busyIndex={busy} />
          {remaining > 1 && <Button variant="outline" onClick={bookAll} loading={busy === 'all'} disabled={busy !== null}>حجز كل الجلسات المحددة</Button>}
        </>)}
      {editing && <RescheduleModal appt={editing} onClose={() => setEditing(null)} />}
    </div>
  );
}
