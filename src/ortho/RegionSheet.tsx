// شيت كشف الطبيب لأي منطقة من regionSheets (الكاحل والقدم / الرقبة والكتف / الكوع والرسغ واليد / أسفل الظهر) — نفس شكل وعناصر شيت الورك والركبة.
// + اختيار الشيت: الشيتات بتيجي من مكان الألم في الشيت العام، والطبيب يقدر يضيف منطقة تانية.
import { Fragment, useState, type ReactNode } from 'react';
import { BodyFigure, regionById, type BodyView, type PinSide } from '../components/BodyFigure';
import { Icon } from '../utils/icons';
import { Box, Checks, Ck, MRC_OPTS, Pick, REFLEX_OPTS, Row, SelCell, Txt, painLabel, sheetApi } from './ExamSheet';
import type { ExamSheet, Side } from './data';
import { DxSheet } from './DxSheet';
import { SHEET_ORDER, SHEET_TAB, boxNeedsNotes, boxNotesKey, type Field, type RegionSheetDef, type SheetId } from './regionSheets';

const SIDES: [Side, string][] = [['right', 'Right'], ['left', 'Left'], ['both', 'Bilateral']];

const REFLEX4_OPTS: [string, string][] = [...REFLEX_OPTS, ['Brisk', 'Brisk (↑)']];

export function RegionSheetForm({ def, sheet, onChange, side, onSide, icd10, onIcd10, onOpenMap }: {
  def: RegionSheetDef; sheet: ExamSheet; onChange: (f: (s: ExamSheet) => ExamSheet) => void; side: Side; onSide: (s: Side) => void;
  icd10: string; onIcd10: (v: string) => void; onOpenMap: () => void;
}) {
  const a = sheetApi(sheet, onChange);
  const k = (x: string) => `${def.prefix}.${x}`;
  const field = (f: Field, i: number): ReactNode => {
    switch (f.t) {
      case 'checks': return (
        <Fragment key={i}>
          {f.label && <div className="sh-lbl">{f.label}</div>}
          <div className={f.cols ? 'sh-cols' : undefined}><Checks a={a} g={k(f.g)} items={f.items} none={f.none} /></div>
        </Fragment>
      );
      case 'pick': return <Row key={i} label={f.label}><Pick a={a} g={k(f.g)} items={f.items} /></Row>;
      case 'text': return <Txt key={i} a={a} k={k(f.k)} label={f.label} stack={f.stack} />;
      case 'side': return <Row key={i} label="Side:">{SIDES.map(([v, l]) => <Ck key={v} on={side === v} onToggle={() => onSide(side === v ? 'na' : v)}>{l}</Ck>)}</Row>;
      case 'cols': return (
        <div key={i} className={`sh-split${f.cols.length === 3 ? ' sh-split--3' : ''}`}>
          {f.cols.map((c, j) => <div key={j}>{c.title && <div className="sh-lbl">{c.title}</div>}{c.f.map(field)}</div>)}
        </div>
      );
      case 'rom': return (
        <table key={i} className="sh-tbl">
          <thead><tr><th>{f.title}</th>{!f.noNormal && <th>Normal</th>}<th>Rt.</th><th>Lt.</th></tr></thead>
          <tbody>{f.rows.map(([m, normal]) => (
            <tr key={m}><td>{m}</td>{!f.noNormal && <td className="num">{normal}</td>}
              {['rt', 'lt'].map((sd) => <td key={sd}><input className="sh-in" dir="ltr" inputMode="numeric" aria-label={`${m} ${sd}`} value={a.txt(k(`${f.k}.${m}.${sd}`))} onChange={(e) => a.set(k(`${f.k}.${m}.${sd}`), e.target.value)} /></td>)}
            </tr>
          ))}</tbody>
        </table>
      );
      case 'grade': return (
        <table key={i} className="sh-tbl">
          <thead><tr><th>{f.title}</th><th>Rt.</th><th>Lt.</th></tr></thead>
          <tbody>{f.rows.map(([r, label]) => (
            <tr key={r}><td>{r} <small>({label})</small></td>
              {['rt', 'lt'].map((sd) => <SelCell key={sd} a={a} k={k(`${f.k}.${r}.${sd}`)} label={`${r} ${sd}`} options={f.opts === 'mrc' ? MRC_OPTS : f.opts === 'reflex4' ? REFLEX4_OPTS : REFLEX_OPTS} />)}
            </tr>
          ))}</tbody>
        </table>
      );
      case 'ticks': {
        const withSub = f.rows.some(([, sub]) => sub);
        return (
          <Fragment key={i}>
            <table className="sh-tbl">
              <thead><tr><th>{f.title}</th>{withSub && <th>{f.sub ?? 'Area'}</th>}<th>Rt.</th><th>Lt.</th></tr></thead>
              <tbody>{f.rows.map(([r, sub, color]) => (
                <tr key={r}><td>{color && <span className="sh-sw" style={{ background: color }} />}{r}</td>{withSub && <td>{sub}</td>}
                  {['Rt', 'Lt'].map((sd) => <td key={sd}><input type="checkbox" className="sh-tick" aria-label={`${r} ${sd}`} checked={a.has(k(f.g), `${r} ${sd}`)} onChange={() => a.toggle(k(f.g), `${r} ${sd}`)} /></td>)}
                </tr>
              ))}</tbody>
            </table>
            {f.note && <p className="sh-note">{f.note}</p>}
          </Fragment>
        );
      }
      case 'key': return (
        <Fragment key={i}>
          <table className="sh-tbl">
            <thead><tr><th>{f.title}</th><th>Area</th></tr></thead>
            <tbody>{f.rows.map(([r, area, color]) => <tr key={r}><td><span className="sh-sw" style={{ background: color }} />{r}</td><td>{area}</td></tr>)}</tbody>
          </table>
          {f.note && <p className="sh-note">{f.note}</p>}
        </Fragment>
      );
      case 'imaging': return (
        <Fragment key={i}>
          {f.mods.map((m) => (
            <div className="sh-img" key={m}>
              <div className="sh-img__top">
                <Ck on={a.has(k(f.k), m)} onToggle={() => a.toggle(k(f.k), m)}>{m}:</Ck>
              </div>
              <Txt a={a} k={k(`${f.k}.${m}`)} placeholder="Finding — اكتب النتيجة" />
            </div>
          ))}
          <Txt a={a} k={k(`${f.k}.prev`)} label="Previous imaging:" stack />
          <Txt a={a} k={k(`${f.k}.other`)} label="Others:" />
        </Fragment>
      );
      case 'dxmap': return (
        <div key={i} className="sh-dxmap">
          <button type="button" className="sh-add" dir="rtl" onClick={onOpenMap}><Icon name="body" size={15} /> اختيار من خريطة الجسم</button>
          <label className="sh-line"><span className="sh-line__l">ICD-10</span><input className="sh-in sh-in--num" dir="ltr" placeholder="M25.5" value={icd10} onChange={(e) => onIcd10(e.target.value.toUpperCase())} /></label>
        </div>
      );
      case 'dxsheet': return <DxSheet key={i} a={a} prefix={def.prefix} id={f.id} />;
      case 'notes': return <textarea key={i} className="sh-in sh-notes" dir="auto" aria-label="Notes" value={a.txt(k(f.k))} onChange={(e) => a.set(k(f.k), e.target.value)} />;
    }
  };
  return (
    <div className="sh" dir="ltr">
      <div className="sh-grid sh-grid--3">
        {def.boxes.map((b, i) => (
          <Box key={i} n={i + 1} tone={b.tone} wide={b.wide} title={b.tone === 'red' ? <><Icon name="alert" size={15} /> {b.title.replace('⚠ ', '')}</> : b.title}>{b.f.map(field)}
            {boxNeedsNotes(b) && <><div className="sh-lbl">ملاحظات</div><textarea className="sh-in sh-notes" dir="auto" aria-label="ملاحظات" value={a.txt(k(boxNotesKey(b)))} onChange={(e) => a.set(k(boxNotesKey(b)), e.target.value)} /></>}</Box>
        ))}
      </div>
    </div>
  );
}

/** كل شيتات كشف الطبيب ظاهرة دايمًا كتابات — اللي من مكان الألم أو اتكتب فيه عليه علامة ●، و✕ جنبه بيمسح اللي اتكتب فيه */
export function SheetSwitch({ active, onPick, onRemove, ids = SHEET_ORDER, label = 'شيت الكشف:' }: { active: SheetId[]; onPick: (id: SheetId) => void; onRemove: (id: SheetId) => void; ids?: SheetId[]; label?: string }) {
  return (
    <div className="sh-regions" role="group" aria-label={label}>
      <span className="sh-regions__l">{label}</span>
      {ids.map((id) => { const on = active.includes(id); return (
        <span key={id} className={`sh-region${on ? ' is-on' : ''}`}>
          {/* «شيت الكشف:» مكتوبة قبل الأزرار — فكلمة «كشف» مابتتكررش في كل زرار */}
          <button type="button" aria-pressed={on} className="sh-region__pick" onClick={() => onPick(id)}>{SHEET_TAB[id].replace(/^كشف /, '')}</button>
          {on && <button type="button" className="sh-region__x" aria-label={`إلغاء ${SHEET_TAB[id]}`} title="إلغاء ومسح اللي اتكتب فيه" onClick={() => onRemove(id)}><Icon name="close" size={14} /></button>}
        </span>
      ); })}
    </div>
  );
}

/** خريطة الجسم في كشف الطبيب: نفس أماكن الألم بتاعة الشيت العام (خانة 5) — تعليم/شيل مكان بيغيّر شيت المنطقة اللي بيظهر */
export function DoctorPainMap({ sheet, onChange }: { sheet: ExamSheet; onChange: (f: (s: ExamSheet) => ExamSheet) => void }) {
  const [view, setView] = useState<BodyView>('front');
  const [hovered, setHovered] = useState<string | null>(null);
  const [startOpen] = useState(() => !sheet.pain.length); // مفتوحة أول مرة بس لو مفيش مكان متحدد (مابتتقفلش لوحدها بعد أول ضغطة)
  const toggle = (id: string, side: PinSide) => {
    const k = side ? `${id}:${side}` : id;
    onChange((x) => ({ ...x, pain: x.pain.includes(k) ? x.pain.filter((p) => p !== k) : [...x.pain, k] }));
  };
  return (
    <details className="sh-docmap" open={startOpen}>
      <summary><Icon name="body" size={16} /> مكان الألم: {sheet.pain.length ? sheet.pain.map(painLabel).join('، ') : 'لسه ما اتحددش'}</summary>
      <div className="sh-docmap__body">
        <BodyFigure key={view} view={view} compact selected={null} hovered={hovered} marked={new Set(sheet.pain)} onSelect={toggle} onHover={setHovered} />
        <div className="dx-hint">{hovered ? regionById(hovered)?.name : 'اختار المنطقة والجهة — ممكن أكتر من مكان'}</div>
      </div>
    </details>
  );
}
