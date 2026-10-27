import { useEffect, useState } from 'react';
import { db } from '../data/db';
import { useDbVersion, useLoading } from '../hooks/useDb';
import { Button, Skeleton } from '../components/ui';
import { useCan } from '../components/common';
import { useToast } from '../hooks/useToast';
import { WEEKDAY_LABEL } from '../utils/format';
import type { DaySchedule, WorkDay } from '../types';

// الأسبوع السعودي يبدأ السبت
const WEEK: WorkDay[] = ['sat', 'sun', 'mon', 'tue', 'wed', 'thu', 'fri'];
const JS_DAYS: WorkDay[] = ['sun', 'mon', 'tue', 'wed', 'thu', 'fri', 'sat'];
const dayLabel = (d: WorkDay) => WEEKDAY_LABEL[JS_DAYS.indexOf(d)];

function Switch({ on, disabled, onChange, label }: { on: boolean; disabled?: boolean; onChange: (v: boolean) => void; label: string }) {
  return (
    <button type="button" role="switch" aria-checked={on} aria-label={label} disabled={disabled}
      className={`switch ${on ? 'on' : ''}`} onClick={() => onChange(!on)}><i /></button>
  );
}

export default function WorkHours() {
  useDbVersion();
  const loading = useLoading();
  const toast = useToast();
  const can = useCan();
  const canEdit = can('workhours', 'edit');
  const center = db.center();

  const [week, setWeek] = useState<DaySchedule[]>(center.weekSchedule);
  const [dirty, setDirty] = useState(false);
  const [saving, setSaving] = useState(false);

  useEffect(() => { if (!dirty) setWeek(center.weekSchedule); }, [center.weekSchedule, dirty]);

  const byDay = (d: WorkDay) => week.find((x) => x.day === d) ?? { day: d, open: false, from: '09:00', to: '21:00' };
  const patchDay = (d: WorkDay, p: Partial<DaySchedule>) => {
    setDirty(true);
    setWeek((w) => WEEK.map((day) => (day === d ? { ...byDay(day), ...p } : w.find((x) => x.day === day) ?? byDay(day))));
  };
  const copyToOpenDays = (d: WorkDay) => {
    const src = byDay(d);
    setDirty(true);
    setWeek(WEEK.map((day) => { const cur = byDay(day); return cur.open ? { ...cur, from: src.from, to: src.to } : cur; }));
  };
  const saveWeek = async () => {
    setSaving(true);
    const r = await db.updateWeekSchedule(WEEK.map(byDay));
    setSaving(false);
    if (!r.ok) { toast.error(r.error); return; }
    setDirty(false);
    toast.success('تم حفظ أيام وساعات عمل المركز.');
  };

  const openDays = WEEK.filter((d) => byDay(d).open).length;

  return (
    <div className="page">
      <div className="page-head">
        <div><h1>مواعيد العمل</h1><p>أيام وساعات عمل المركز. يُحدَّد دوام كل موظف من نافذة إضافة/تعديل الموظف. ما يُقبل الحجز في يوم مغلق أو خارج ساعاته.</p></div>
      </div>

      <section className="card" style={{ marginBottom: 18 }}>
        <div className="card__head">
          <h2>أيام عمل المركز</h2>
          <span className="muted" style={{ fontSize: 13 }}><span className="num">{openDays}</span> أيام عمل · <span className="num">{7 - openDays}</span> إجازة</span>
        </div>
        <div className="card__body">
          {loading ? <Skeleton h={260} /> : (
            <div className="wh-week">
              {WEEK.map((d) => {
                const s = byDay(d);
                return (
                  <div key={d} className={`wh-day ${s.open ? '' : 'wh-day--off'}`}>
                    <div className="wh-day__name">
                      <Switch on={s.open} disabled={!canEdit} label={`${dayLabel(d)} — يوم عمل`} onChange={(v) => patchDay(d, { open: v })} />
                      <strong>{dayLabel(d)}</strong>
                    </div>
                    {s.open ? (
                      <div className="wh-day__times">
                        <label><span>من</span><input type="time" className="input" value={s.from} disabled={!canEdit} onChange={(e) => patchDay(d, { from: e.target.value })} /></label>
                        <label><span>إلى</span><input type="time" className="input" value={s.to} disabled={!canEdit} onChange={(e) => patchDay(d, { to: e.target.value })} /></label>
                        {s.from >= s.to && <span className="field__err" style={{ fontSize: 12 }}>البداية بعد النهاية</span>}
                        {canEdit && <button type="button" className="link-more wh-copy" onClick={() => copyToOpenDays(d)}>تطبيق على كل الأيام</button>}
                      </div>
                    ) : <span className="muted wh-day__closed">مغلق — إجازة</span>}
                  </div>
                );
              })}
            </div>
          )}
          {canEdit && (
            <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end', marginTop: 16 }}>
              {dirty && <Button variant="outline" onClick={() => { setWeek(center.weekSchedule); setDirty(false); }} disabled={saving}>تراجع</Button>}
              <Button icon="check" onClick={saveWeek} loading={saving} disabled={!dirty}>حفظ أيام العمل</Button>
            </div>
          )}
        </div>
      </section>
    </div>
  );
}
