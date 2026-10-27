import { useEffect, useState } from 'react';
import { db } from '../data/db';
import { useDbVersion, useLoading } from '../hooks/useDb';
import { Button, Input, Skeleton, StatusBadge } from '../components/ui';
import { ConfirmDialog, useCan } from '../components/common';
import { useToast } from '../hooks/useToast';
import { WEEKDAY_LABEL, fmtDate, todayYmd } from '../utils/format';
import type { DaySchedule, WorkDay } from '../types';

// الأسبوع السعودي يبدأ السبت
const WEEK: WorkDay[] = ['sat', 'sun', 'mon', 'tue', 'wed', 'thu', 'fri'];
const JS_DAYS: WorkDay[] = ['sun', 'mon', 'tue', 'wed', 'thu', 'fri', 'sat'];
const dayLabel = (d: WorkDay) => WEEKDAY_LABEL[JS_DAYS.indexOf(d)];
const fmtDayName = (ymd: string) => WEEKDAY_LABEL[new Date(ymd + 'T12:00:00Z').getUTCDay()];

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
      <Holidays />
    </div>
  );
}

// أيام إغلاق العيادة (عيد، إجازة رسمية، سفر الدكتور): الحجز فيها بيترفض من الخادم، والأوقات بتختفي من شاشة الحجز وبوابة المريض
function Holidays() {
  useDbVersion();
  const toast = useToast();
  const can = useCan();
  const canAdd = can('settings', 'create');
  const canDelete = can('settings', 'delete');
  const [list, setList] = useState<Array<{ id: string; date: string; reason: string }> | null>(null);
  const [error, setError] = useState('');
  const [date, setDate] = useState('');
  const [reason, setReason] = useState('');
  const [busy, setBusy] = useState(false);
  const [del, setDel] = useState<{ id: string; date: string } | null>(null);
  const reload = () => db.holidays().then((x) => { setList(x); setError(''); }).catch((e) => setError((e as Error).message));
  useEffect(() => { void reload(); }, []);
  // مواعيد قائمة في اليوم ده — لازم تتأجل أو تتلغي بعد الإغلاق (الإغلاق مابيلغيهاش لوحده)
  const activeOn = (d: string) => db.appointmentsForDate(d).filter((a) => !['cancelled', 'completed', 'no_show'].includes(a.status)).length;
  const pending = date ? activeOn(date) : 0;

  const add = async () => {
    if (!date) { toast.error('اختر التاريخ.'); return; }
    if (list?.some((h) => h.date === date)) { toast.error('اليوم ده مسجّل إغلاق بالفعل.'); return; }
    setBusy(true);
    const r = await db.saveHoliday(date, reason);
    setBusy(false);
    if (!r.ok) { toast.error(r.error); return; }
    toast.success(pending ? `تم إغلاق اليوم — فيه ${pending} موعد لازم تأجّلهم أو تلغيهم من «المواعيد».` : 'تم إغلاق اليوم — مفيش حجز فيه.');
    setDate(''); setReason('');
    void reload();
  };
  const remove = async () => {
    if (!del) return;
    const r = await db.deleteHoliday(del.id);
    if (!r.ok) { toast.error(r.error); return; }
    toast.success('تم فتح اليوم للحجز.');
    void reload();
  };

  return (
    <section className="card">
      <div className="card__head"><h2>أيام إغلاق العيادة</h2><span className="muted" style={{ fontSize: 13 }}>أعياد وإجازات رسمية — مفيش حجز فيها</span></div>
      <div className="card__body">
        {canAdd && (
          <div className="grid-form" style={{ gridTemplateColumns: 'minmax(150px, 200px) 1fr auto', alignItems: 'end', gap: 10 }}>
            <Input id="hol-date" label="التاريخ" type="date" min={todayYmd()} value={date} onChange={(e) => setDate(e.target.value)} />
            <Input id="hol-reason" label="السبب" placeholder="مثلاً: عيد الأضحى" value={reason} maxLength={120} onChange={(e) => setReason(e.target.value)} />
            <div className="field"><Button icon="plus" onClick={add} loading={busy} disabled={!date}>إغلاق اليوم</Button></div>
          </div>
        )}
        {date && pending > 0 && <p className="field__err" style={{ marginTop: -6, marginBottom: 12 }}>فيه <span className="num">{pending}</span> موعد قائم في {fmtDate(date)} — بعد الإغلاق أجّلهم أو ألغيهم من «المواعيد».</p>}
        {error ? <p className="field__err">{error}</p> : list === null ? <Skeleton h={60} /> : list.length === 0 ? (
          <p className="muted">ما فيه أيام إغلاق قادمة — العيادة بتشتغل حسب أيام العمل اللي فوق.</p>
        ) : (
          <div className="table-wrap"><table className="table"><thead><tr><th>التاريخ</th><th>اليوم</th><th>السبب</th><th>مواعيد قائمة</th>{canDelete && <th />}</tr></thead>
            <tbody>{list.map((h) => { const n = activeOn(h.date); return (
              <tr key={h.id}>
                <td className="num date">{fmtDate(h.date)}</td><td>{fmtDayName(h.date)}</td><td>{h.reason || '—'}</td>
                <td>{n ? <StatusBadge label={String(n)} tone="warn" /> : <span className="muted">—</span>}</td>
                {canDelete && <td style={{ textAlign: 'end' }}><Button size="sm" variant="ghost" icon="trash" onClick={() => setDel({ id: h.id, date: h.date })}>فتح اليوم</Button></td>}
              </tr>); })}</tbody></table></div>
        )}
      </div>
      {del && <ConfirmDialog title="فتح اليوم للحجز" message={`هيرجع يوم ${fmtDate(del.date)} يوم عمل عادي ويقبل الحجز.`} confirmLabel="فتح اليوم" danger={false} onClose={() => setDel(null)} onConfirm={remove} />}
    </section>
  );
}
