// سجل الألم والروشتات للمريض (هجرة 964): «درجة الألم في الزيارة اللي فاتت» و«روشتة الزيارة اللي فاتت» في شيت المتابعة وموعد المتابعة.
// المرجع جداول ortho_pain_scores / ortho_prescriptions(+_items) اللي الخادم بيكتبها بتريجرات. فوقيها اللي اتحفظ على الجهاز ولسه ما اتزامنش
// (أو لسه السجل ما اتحمّلش تاني بعد الحفظ) — من نفس المصادر (التشخيص / شيت المتابعة / موعد المتابعة)، فالشاشة صح أونلاين وأوفلاين.
import { useState } from 'react';
import { Button } from '../components/ui';
import { fmtDate } from '../utils/format';
import { ortho, useOrthoVersion, type ImagingRequest, type Medication, type PainSource } from './data';
import { normRx } from './Rx';

// ---------- الألم ----------
export interface PainEntry { key: string; date: string; score: number; source: PainSource; sourceId: string; createdAt: string }
export const PAIN_SOURCE: Record<PainSource, string> = { consultation: 'كشف', nursing: 'شيت متابعة', follow_up: 'موعد متابعة' };
const toScore = (v: unknown): number | null => {
  if (v === '' || v === null || v === undefined) return null;
  const n = Number(v);
  return Number.isFinite(n) && n >= 0 && n <= 10 ? Math.round(n) : null;
};

/** كل درجات الألم للمريض بتاريخ كل زيارة — الأقدم الأول */
export function painHistory(patientId: string): PainEntry[] {
  const m = new Map<string, PainEntry>();
  for (const r of ortho.list('pain_scores', patientId)) {
    m.set(`${r.source}:${r.sourceId}`, { key: r.id, date: r.visitDate, score: Number(r.score), source: r.source, sourceId: r.sourceId, createdAt: r.createdAt });
  }
  // المصادر نفسها هي آخر نسخة (اللي على الجهاز ممكن تكون أحدث من السجل لحد ما يتحمّل تاني)
  const local = (source: PainSource, id: string, date: string, v: unknown, createdAt: string) => {
    const k = `${source}:${id}`, score = toScore(v);
    if (score === null) { m.delete(k); return; }
    m.set(k, { key: m.get(k)?.key ?? k, date, score, source, sourceId: id, createdAt });
  };
  for (const c of ortho.list('consultations', patientId)) local('consultation', c.id, c.date, c.painScore, String((c as unknown as { createdAt?: string }).createdAt ?? ''));
  for (const n of ortho.list('nursing', patientId)) local('nursing', n.id, n.date, n.sheet?.pain, String((n as unknown as { createdAt?: string }).createdAt ?? ''));
  for (const f of ortho.list('follow_ups', patientId)) local('follow_up', f.id, f.date, f.status === 'cancelled' ? null : f.painScore, f.createdAt ?? '');
  return [...m.values()].sort((a, b) => a.date.localeCompare(b.date) || a.createdAt.localeCompare(b.createdAt));
}

/** آخر درجة ألم قبل الزيارة دي (من غير الزيارة نفسها) — في نفس اليوم أو قبله */
export function previousPain(patientId: string, opts: { excludeSourceId?: string | null; date?: string } = {}): PainEntry | undefined {
  const list = painHistory(patientId).filter((e) => e.sourceId !== opts.excludeSourceId && (!opts.date || e.date <= opts.date));
  return list[list.length - 1];
}

export type PainTrend = 'better' | 'worse' | 'same';
export const PAIN_TREND: Record<PainTrend, { label: string; tone: string; vsLast: string }> = {
  better: { label: 'تحسّن', tone: 'ok', vsLast: 'أقل' }, worse: { label: 'ساء', tone: 'danger', vsLast: 'أكثر' }, same: { label: 'ثابت', tone: 'muted', vsLast: 'كما هو' },
};
export const painTrend = (prev: number | null | undefined, cur: number | '' | null | undefined): PainTrend | null =>
  prev === null || prev === undefined || cur === '' || cur === null || cur === undefined ? null : cur < prev ? 'better' : cur > prev ? 'worse' : 'same';

const level = (n: number) => (n <= 3 ? 'lo' : n <= 6 ? 'mid' : 'hi');

/** درجة الألم الحالية + السابقة + المقارنة (تحسّن / ساء / ثابت) + سجل الدرجات */
export function PainCompare({ patientId, value, onChange, excludeSourceId, date, disabled, title = 'درجة الألم حاليًا (من 10)' }: {
  patientId: string; value: number | ''; onChange: (v: number | '') => void; excludeSourceId?: string | null; date?: string; disabled?: boolean; title?: string;
}) {
  useOrthoVersion();
  const [showAll, setShowAll] = useState(false);
  const prev = patientId ? previousPain(patientId, { excludeSourceId, date }) : undefined;
  const trend = painTrend(prev?.score, value);
  const all = patientId ? painHistory(patientId) : [];
  return (
    <fieldset className="card pain-cmp" data-testid="pain-compare">
      <legend>{title}</legend>
      <div className="pain-cmp__prev">
        {prev
          ? <>الزيارة اللي فاتت: <b className={`pain-cmp__n pain-cmp__n--${level(prev.score)} num`} data-testid="pain-prev">{prev.score}/10</b> <span className="muted-sm">— {PAIN_SOURCE[prev.source]} {fmtDate(prev.date)}</span></>
          : <span className="muted-sm" data-testid="pain-prev-none">مفيش درجة ألم مسجلة قبل كده للمريض.</span>}
        {trend && <span className={`badge badge--${PAIN_TREND[trend].tone} pain-cmp__trend`} data-testid="pain-trend">{PAIN_TREND[trend].label}{prev ? ` (${prev.score} ← ${value})` : ''}</span>}
      </div>
      <div className="cx-chips pain-cmp__pick" role="radiogroup" aria-label="درجة الألم الحالية">
        {Array.from({ length: 11 }, (_, n) => (
          <button key={n} type="button" role="radio" aria-checked={value === n} disabled={disabled} className={`cx-chip num pain-cmp__b pain-cmp__b--${level(n)} ${value === n ? 'is-on' : ''}`} onClick={() => onChange(value === n ? '' : n)}>{n}</button>
        ))}
      </div>
      <div className="pain-cmp__foot">
        <small className="muted">0 = لا يوجد ألم · 10 = أشد ألم</small>
        {all.length > 1 && <button type="button" className="link-btn" onClick={() => setShowAll((x) => !x)}>{showAll ? 'إخفاء سجل الألم' : `سجل الألم (${all.length})`}</button>}
      </div>
      {showAll && (
        <ol className="pain-cmp__log" data-testid="pain-log">
          {all.map((e) => <li key={e.key}><span className="num">{fmtDate(e.date)}</span> <span className="muted-sm">{PAIN_SOURCE[e.source]}</span> <b className={`pain-cmp__n pain-cmp__n--${level(e.score)} num`}>{e.score}/10</b></li>)}
        </ol>
      )}
    </fieldset>
  );
}

// ---------- الروشتات ----------
export interface RxEntry {
  key: string; date: string; source: 'consultation' | 'nursing'; sourceId: string; version: number; meds: Medication[]; instructions: string; labs: string[]; imagingRequests: ImagingRequest[];
  createdAt: string; pending?: boolean;
}
const medKey = (m: Medication[]) => JSON.stringify(m.map((x) => [x.name.trim(), (x.dose ?? '').trim(), (x.frequency ?? '').trim(), (x.duration ?? '').trim(), (x.notes ?? '').trim()]));
const cleanMeds = (list: Medication[] | undefined) => (list ?? []).filter((m) => m?.name?.trim()).map((m) => ({ name: m.name.trim(), dose: (m.dose ?? '').trim(), frequency: (m.frequency ?? '').trim(), duration: (m.duration ?? '').trim(), notes: (m.notes ?? '').trim() }));

/** كل روشتات المريض (كل نسخة اتحفظت) — الأحدث الأول */
export function rxHistory(patientId: string): RxEntry[] {
  const items = ortho.list('prescription_items', patientId);
  const out: RxEntry[] = ortho.list('prescriptions', patientId).map((r) => ({
    key: r.id, date: r.rxDate, source: r.source, sourceId: r.sourceId, version: Number(r.version), instructions: r.instructions ?? '',
    labs: Array.isArray(r.labs) ? r.labs : [], imagingRequests: Array.isArray(r.imagingRequests) ? r.imagingRequests : [], createdAt: r.createdAt,
    meds: items.filter((i) => i.prescriptionId === r.id).sort((a, b) => Number(a.position) - Number(b.position))
      .map((i) => ({ name: i.name, dose: i.dose, frequency: i.frequency, duration: i.duration, notes: i.notes })),
  }));
  // الروشتة اللي على الجهاز أحدث من آخر نسخة في السجل (اتحفظت من غير نت أو السجل لسه ما اتحمّلش) ← بتبان كنسخة «لسه بتتسجل»
  const local = (source: RxEntry['source'], id: string, date: string, rx: { medications?: Medication[]; plan?: string; labs?: string[]; imagingRequests?: ImagingRequest[] }, createdAt: string) => {
    const meds = cleanMeds(rx.medications), instructions = (rx.plan ?? '').trim(), labs = rx.labs ?? [], imagingRequests = (rx.imagingRequests ?? []).filter((x) => x.region?.trim());
    if (!meds.length && !instructions && !labs.length && !imagingRequests.length) return;
    const latest = out.filter((e) => e.sourceId === id).sort((a, b) => b.version - a.version)[0];
    if (latest && medKey(latest.meds) === medKey(meds) && latest.instructions === instructions && JSON.stringify(latest.labs) === JSON.stringify(labs)) return;
    out.push({ key: `local:${id}`, date, source, sourceId: id, version: (latest?.version ?? 0) + 1, meds, instructions, labs, imagingRequests, createdAt: createdAt || new Date().toISOString(), pending: true });
  };
  for (const c of ortho.list('consultations', patientId)) local('consultation', c.id, c.date, c, String((c as unknown as { createdAt?: string }).createdAt ?? ''));
  for (const n of ortho.list('nursing', patientId)) local('nursing', n.id, n.date, normRx(n.sheet?.rx), String((n as unknown as { createdAt?: string }).createdAt ?? ''));
  return out.sort((a, b) => b.date.localeCompare(a.date) || b.createdAt.localeCompare(a.createdAt) || b.version - a.version);
}

/** روشتة الزيارة اللي فاتت: آخر نسخة من آخر زيارة غير الزيارة دي (في نفس اليوم أو قبله) */
export function previousRx(patientId: string, opts: { excludeSourceId?: string | null; date?: string } = {}): RxEntry | undefined {
  return rxHistory(patientId).find((e) => e.sourceId !== opts.excludeSourceId && (!opts.date || e.date <= opts.date) && (e.meds.length || e.instructions));
}

function RxMeds({ e }: { e: RxEntry }) {
  return (
    <>
      {e.meds.length > 0 && (
        <div className="table-wrap"><table className="table prev-rx__t" dir="ltr">
          <thead><tr><th>#</th><th>الدواء</th><th>الجرعة</th><th>التكرار</th><th>المدة</th><th>ملاحظة</th></tr></thead>
          <tbody>{e.meds.map((m, i) => <tr key={i}><td className="num">{i + 1}</td><td><b>{m.name}</b></td><td>{m.dose || '—'}</td><td>{m.frequency || '—'}</td><td>{m.duration || '—'}</td><td dir="auto" data-testid="prev-rx-note">{m.notes || '—'}</td></tr>)}</tbody>
        </table></div>
      )}
      {e.instructions && <p className="prev-rx__ins" dir="auto"><b>ملاحظات الروشتة:</b> {e.instructions}</p>}
      {e.labs.length > 0 && <p className="prev-rx__ins muted-sm" dir="ltr">Labs: {e.labs.join(' • ')}</p>}
    </>
  );
}

/** روشتة الزيارة اللي فاتت (الأدوية والجرعات وملاحظة كل دواء والتعليمات) + سجل كل الروشتات — الروشتة الجديدة مابتمسحش القديمة */
export function PrevRx({ patientId, excludeSourceId, date, onCopy }: { patientId: string; excludeSourceId?: string | null; date?: string; onCopy?: (meds: Medication[], instructions: string) => void }) {
  useOrthoVersion();
  const [log, setLog] = useState(false);
  if (!patientId) return null;
  const prev = previousRx(patientId, { excludeSourceId, date });
  const all = rxHistory(patientId).filter((e) => e.meds.length || e.instructions);
  return (
    <section className="prev-rx" data-testid="prev-rx">
      <div className="prev-rx__h">
        <b>روشتة الزيارة اللي فاتت</b>
        {prev && <span className="muted-sm">{PAIN_SOURCE[prev.source]} {fmtDate(prev.date)}{prev.version > 1 ? ` · نسخة ${prev.version}` : ''}{prev.pending ? ' · لسه بتتسجل' : ''}</span>}
        <span className="spacer" />
        {prev && onCopy && prev.meds.length > 0 && <Button size="sm" variant="outline" icon="copy" onClick={() => onCopy(prev.meds, prev.instructions)}>نفس الأدوية في الروشتة الجديدة</Button>}
        {all.length > 1 && <Button size="sm" variant="ghost" icon="list" onClick={() => setLog((x) => !x)}>{log ? 'إخفاء السجل' : `سجل الروشتات (${all.length})`}</Button>}
      </div>
      {prev ? <RxMeds e={prev} /> : <p className="muted-sm" style={{ margin: 0 }} data-testid="prev-rx-none">مفيش روشتة سابقة للمريض.</p>}
      {log && (
        <ol className="prev-rx__log" data-testid="rx-log">
          {all.map((e) => (
            <li key={e.key}>
              <div className="muted-sm"><b className="num">{fmtDate(e.date)}</b> — {PAIN_SOURCE[e.source]}{e.version > 1 ? ` · نسخة ${e.version} (اتعدّلت)` : ''}{e.pending ? ' · لسه بتتسجل' : ''}</div>
              <RxMeds e={e} />
            </li>
          ))}
        </ol>
      )}
    </section>
  );
}

/** سطر صغير في الشيت العام للتشخيص: آخر درجة ألم مسجلة للمريض والمقارنة بالدرجة اللي اتكتبت دلوقتي */
export function PainHint({ patientId, current, excludeSourceId, date }: { patientId: string; current: number | ''; excludeSourceId?: string | null; date?: string }) {
  useOrthoVersion();
  if (!patientId) return null;
  const prev = previousPain(patientId, { excludeSourceId, date });
  if (!prev) return null;
  const t = painTrend(prev.score, current);
  return (
    <div className="pain-cmp__prev pain-hint" data-testid="pain-hint">
      <span>درجة الألم في الزيارة اللي فاتت: <b className={`pain-cmp__n pain-cmp__n--${level(prev.score)} num`}>{prev.score}/10</b> <span className="muted-sm">— {PAIN_SOURCE[prev.source]} {fmtDate(prev.date)}</span></span>
      {t && <span className={`badge badge--${PAIN_TREND[t].tone}`}>الحالية {current}/10 — {PAIN_TREND[t].label}</span>}
    </div>
  );
}
