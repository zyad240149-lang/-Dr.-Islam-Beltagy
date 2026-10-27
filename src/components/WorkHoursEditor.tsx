// محرر «أيام وساعات العمل» — واحد لكل الموظفين (معالج أو استقبال أو محاسب...) في نوافذ الإضافة والتعديل.
import { Button, Select } from './ui';
import { db } from '../data/db';
import { WEEKDAY_LABEL, fmtTime } from '../utils/format';
import type { WorkDay, WorkHours } from '../types';

const DAYS: WorkDay[] = ['sun', 'mon', 'tue', 'wed', 'thu', 'fri', 'sat']; // بترتيب getDay — لقراءة WEEKDAY_LABEL
export const DAY_ORDER: WorkDay[] = ['sat', 'sun', 'mon', 'tue', 'wed', 'thu', 'fri']; // السبت أول الأسبوع
export const byDayOrder = (a: { day: WorkDay }, b: { day: WorkDay }) => DAY_ORDER.indexOf(a.day) - DAY_ORDER.indexOf(b.day);
export const dayLabel = (d: WorkDay) => WEEKDAY_LABEL[DAYS.indexOf(d)];
export const defaultHours = (): WorkHours[] => (['sun', 'mon', 'tue', 'wed', 'thu'] as WorkDay[]).map((day) => ({ day, from: '09:00', to: '17:00' }));
export const cleanHours = (h: WorkHours[]) => [...h].sort(byDayOrder).map(({ day, from, to, breakFrom, breakTo, branchId }) => ({ day, from, to, ...(breakFrom && breakTo ? { breakFrom, breakTo } : {}), ...(branchId ? { branchId } : {}) }));
export const hoursError = (h: WorkHours[]) => (h.some((x) => !x.from || !x.to || x.from >= x.to) ? 'وقت بداية الدوام لازم يسبق نهايته في كل يوم.' : null);
// الفرع اللي الموظف فيه يوم معيّن (لو عنده أكتر من فرع حسب الأيام) — null لو اليوم ده مش يوم عمل أو مفيش فرع محدد له
export function branchForDay(hours: WorkHours[], day: WorkDay): { id: string; name: string } | null {
  const h = hours.find((x) => x.day === day);
  if (!h?.branchId) return null;
  const b = db.branches().find((x) => x.id === h.branchId);
  return b ? { id: b.id, name: b.name } : null;
}
// نفس الفكرة من تاريخ (yyyy-mm-dd) — بيحسب يوم الأسبوع بنفسه
export function branchForDate(hours: WorkHours[], dateYmd: string): { id: string; name: string } | null {
  const day = DAYS[new Date(dateYmd + 'T00:00:00').getDay()];
  return branchForDay(hours, day);
}

const toMin = (t: string) => +t.slice(0, 2) * 60 + +t.slice(3, 5);
const toHm = (n: number) => `${String(Math.floor(n / 60)).padStart(2, '0')}:${String(n % 60).padStart(2, '0')}`;
// الأوقات المتاحة للاختيار: اليوم كله (كل 15 دقيقة) — بالـ ص/م مكتوبة صريحة، والأوقات برّه ساعات المركز العامة
// بتتعلّم بس («خارج ساعات المركز») من غير ما تتمنع، عشان أي دكتور/فرع يقدر يختار الوقت اللي يناسبه فعلًا
// (خانة الوقت الأصلية على الموبايل كانت بتخلّي 5 العصر تتسجّل 05:00 الصبح بالغلط)
function timeOptions(extra: string[]) {
  const open = db.center().weekSchedule.filter((d) => d.open);
  const lo = open.length ? Math.min(...open.map((d) => toMin(d.from))) : 8 * 60;
  const hi = open.length ? Math.max(...open.map((d) => toMin(d.to))) : 22 * 60;
  const list: string[] = [];
  for (let t = 0; t <= 23 * 60 + 45; t += 15) list.push(toHm(t));
  for (const x of extra) if (x && !list.includes(x)) list.push(x);
  list.sort();
  return list.map((t) => ({ value: t, label: t < toHm(lo) || t > toHm(hi) ? `${fmtTime(t)} (خارج ساعات المركز)` : fmtTime(t) }));
}
// ملخص مقروء: «السبت، الاثنين: 5:00 م – 9:00 م — العيادة»
export function hoursSummary(h: WorkHours[]) {
  const branchName = (id?: string | null) => (id && db.branches().find((b) => b.id === id)?.name) || '';
  const groups = new Map<string, WorkDay[]>();
  for (const x of [...h].sort(byDayOrder)) { const k = `${fmtTime(x.from)} – ${fmtTime(x.to)}|${branchName(x.branchId)}`; groups.set(k, [...(groups.get(k) ?? []), x.day]); }
  return [...groups].map(([k, days]) => { const [time, branch] = k.split('|'); return `${days.map(dayLabel).join('، ')}: ${time}${branch ? ` — ${branch}` : ''}`; }).join(' · ');
}

export function WorkHoursEditor({ id, hours, onChange }: { id: string; hours: WorkHours[]; onChange: (h: WorkHours[]) => void }) {
  // اليوم الجديد بياخد مواعيد أول يوم
  const toggleDay = (day: WorkDay) => onChange(hours.some((x) => x.day === day) ? hours.filter((x) => x.day !== day) : [...hours, { day, from: hours[0]?.from ?? '09:00', to: hours[0]?.to ?? '17:00' }].sort(byDayOrder));
  // كل يوم بيتعدّل لوحده بس — والتطبيق على باقي الأيام بزرار صريح
  const setHour = (day: WorkDay, k: 'from' | 'to', v: string) => onChange(hours.map((x) => (x.day === day ? { ...x, [k]: v } : x)));
  const setDayBranch = (day: WorkDay, branchId: string) => onChange(hours.map((x) => (x.day === day ? { ...x, branchId: branchId || null } : x)));
  const applyAll = (src: WorkHours) => onChange(hours.map((x) => ({ ...x, from: src.from, to: src.to })));
  const opts = timeOptions(hours.flatMap((h) => [h.from, h.to]));
  const err = hoursError(hours);
  // عمود الفرع بيظهر بس لو فيه أكتر من فرع نشط (أغلب المنشآت فرع واحد — مفيش داعي نعقّد شاشتهم)
  const branches = db.branches().filter((b) => b.active);
  const showBranch = branches.length > 1;
  return (
    <>
      <div className="check-grid" style={{ marginBottom: 10 }}>{DAY_ORDER.map((d) => {
        const on = hours.some((h) => h.day === d);
        return <label key={d} className={`check-pill ${on ? 'on' : ''}`}><input type="checkbox" checked={on} onChange={() => toggleDay(d)} />{dayLabel(d)}</label>;
      })}</div>
      {hours.length === 0 && <p className="muted-sm">اختر أيام العمل.</p>}
      {hours.map((h, i) => (
        <div key={h.day} className="grid-form" style={{ alignItems: 'end', gridTemplateColumns: showBranch ? 'minmax(70px,.6fr) repeat(2, minmax(0,1fr)) minmax(120px,1fr)' : 'minmax(70px,.6fr) repeat(2, minmax(0,1fr))' }}>
          <div className="field"><label>{dayLabel(h.day)}</label>
            {i === 0 && hours.length > 1 && <Button type="button" size="sm" variant="ghost" onClick={() => applyAll(h)}>تطبيق على كل الأيام</Button>}
          </div>
          <Select id={`${id}-from-${h.day}`} label="من" value={h.from} onChange={(e) => setHour(h.day, 'from', e.target.value)} options={opts} />
          <Select id={`${id}-to-${h.day}`} label="إلى" value={h.to} onChange={(e) => setHour(h.day, 'to', e.target.value)} options={opts} />
          {showBranch && (
            <Select id={`${id}-branch-${h.day}`} label="الفرع" value={h.branchId ?? ''} onChange={(e) => setDayBranch(h.day, e.target.value)}
              options={[{ value: '', label: '— بدون تحديد —' }, ...branches.map((b) => ({ value: b.id, label: b.name }))]} />
          )}
        </div>
      ))}
      {hours.length > 0 && (
        <div className={`alert ${err ? 'alert-warn' : 'alert-info'}`} style={{ marginTop: 6 }}>
          <div><strong>سيُحفظ كالتالي:</strong> {hoursSummary(hours)}{err ? ` — ${err}` : ''}</div>
        </div>
      )}
    </>
  );
}
