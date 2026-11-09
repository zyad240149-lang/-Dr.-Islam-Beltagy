// اختيار الفترة في الفواتير والمدفوعات: الكل / اليوم / الأسبوع / الشهر / يوم محدد / من — إلى. القيمة كلها عند الصفحة، فالإجماليات والجدول بيتغيروا معاها.
import { Input } from './ui';
import { addDaysYmd, fmtDate, todayYmd } from '../utils/format';

export type PeriodMode = 'all' | 'today' | 'week' | 'month' | 'date' | 'range';
export interface Period { mode: PeriodMode; from: string; to: string }
export const ALL_PERIOD: Period = { mode: 'all', from: '', to: '' };

const OPTIONS: [PeriodMode, string][] = [['all', 'الكل'], ['today', 'اليوم'], ['week', 'الأسبوع'], ['month', 'الشهر'], ['date', 'يوم محدد'], ['range', 'من — إلى']];

function periodFor(mode: PeriodMode, cur: Period): Period {
  const t = todayYmd();
  if (mode === 'today') return { mode, from: t, to: t };
  if (mode === 'week') { // الأسبوع بيبدأ السبت
    const from = addDaysYmd(t, -((new Date(t + 'T00:00:00').getDay() + 1) % 7));
    return { mode, from, to: addDaysYmd(from, 6) };
  }
  if (mode === 'month') {
    const [y, m] = t.split('-').map(Number);
    return { mode, from: `${t.slice(0, 7)}-01`, to: `${t.slice(0, 7)}-${String(new Date(y, m, 0).getDate()).padStart(2, '0')}` };
  }
  if (mode === 'date') { const d = cur.from || t; return { mode, from: d, to: d }; }
  if (mode === 'range') return { mode, from: cur.from, to: cur.to };
  return ALL_PERIOD;
}

export function PeriodFilter({ id, value, onChange }: { id: string; value: Period; onChange: (p: Period) => void }) {
  const { mode, from, to } = value;
  return (
    <div style={{ padding: '14px 22px 0' }}>
      <div className="seg dx-views" role="group" aria-label="الفترة" style={{ marginBottom: 0 }}>
        {OPTIONS.map(([m, label]) => (
          <button key={m} type="button" aria-pressed={mode === m} className={`seg__btn ${mode === m ? 'active' : ''}`} onClick={() => onChange(periodFor(m, value))}>{label}</button>
        ))}
      </div>
      {mode === 'date' && <div style={{ maxWidth: 260, marginTop: 10 }}><Input id={`${id}-day`} label="اليوم" type="date" value={from} onChange={(e) => onChange({ mode, from: e.target.value, to: e.target.value })} /></div>}
      {mode === 'range' && (
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 12, marginTop: 10 }}>
          <div style={{ flex: '1 1 200px', maxWidth: 260 }}><Input id={`${id}-from`} label="من تاريخ" type="date" value={from} onChange={(e) => onChange({ mode, from: e.target.value, to })} /></div>
          <div style={{ flex: '1 1 200px', maxWidth: 260 }}><Input id={`${id}-to`} label="إلى تاريخ" type="date" value={to} min={from || undefined} onChange={(e) => onChange({ mode, from, to: e.target.value })} /></div>
        </div>
      )}
      {mode !== 'all' && (from || to) && <p className="muted" style={{ margin: '8px 0 0', fontSize: 13 }}>الفترة: {from === to ? fmtDate(from) : `${from ? fmtDate(from) : 'البداية'} — ${to ? fmtDate(to) : 'النهارده'}`}</p>}
    </div>
  );
}
