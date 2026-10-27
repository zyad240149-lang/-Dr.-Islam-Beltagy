// قسم «Objective» في تقييم العلاج الطبيعي — نفس الخانات التسعة ونفس ترتيبها وحجمها في النموذج،
// بس كل خانة بقت Dropdown: الضغط عليها بيفتح قائمة الاختيارات تحتها، والاختيار بيظهر جوه نفس الخانة.
import { useEffect, useRef, useState, type ReactNode } from 'react';
import {
  GAIT, GRADES, GRADE_HINT, JOINTS, MOVEMENTS, OBSERVATION, PALPATION, REFLEXES, REFLEX_RESULT, ROM_STATUS, SENS_DEEP, SENS_SUP, SIDE3, SIDE_ROM, SIDE_TEST, TEST_RESULT,
  lbl, physioLists, rowKey, type ListItem, type MuscleRow, type Objective, type Opt, type ReflexRow, type RomRow, type TestRow,
} from '../data/physioObjective';

/** الخانة نفسها: مستطيل بنفس شكل خانة الكتابة — بيعرض الاختيار أو placeholder، والضغط بيفتح القائمة */
export function DropBox({ id, label, text, placeholder, children, wide }: { id: string; label: string; text: string; placeholder: string; children: (close: () => void) => ReactNode; wide?: boolean }) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!open) return;
    const out = (e: MouseEvent) => { if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false); };
    const esc = (e: KeyboardEvent) => { if (e.key === 'Escape') { e.stopPropagation(); setOpen(false); } };
    document.addEventListener('mousedown', out); document.addEventListener('keydown', esc, true);
    return () => { document.removeEventListener('mousedown', out); document.removeEventListener('keydown', esc, true); };
  }, [open]);
  return (
    <div className="field pt-dd" ref={ref}>
      <label htmlFor={id}>{label}</label>
      <button type="button" id={id} className={`input pt-dd__box ${open ? 'is-open' : ''}`} aria-haspopup="listbox" aria-expanded={open} onClick={() => setOpen(!open)}>
        <span className={`pt-dd__text ${text ? '' : 'is-ph'}`} dir="auto">{text || placeholder}</span>
        <span className="pt-dd__arrow" aria-hidden>▾</span>
      </button>
      {open && <div className={`pt-dd__pop ${wide ? 'pt-dd__pop--wide' : ''}`} role="dialog" aria-label={label}>{children(() => setOpen(false))}</div>}
    </div>
  );
}

/** قائمة اختيار متعدد جوه الـ Dropdown (علامة ✓ جنب المختار) */
function OptionList({ options, value, onToggle }: { options: Opt[]; value: string[]; onToggle: (v: string) => void }) {
  return (
    <ul className="pt-dd__list" role="listbox" aria-multiselectable>
      {options.map((o) => (
        <li key={o.value} role="option" aria-selected={value.includes(o.value)} className={value.includes(o.value) ? 'sel' : ''} onClick={() => onToggle(o.value)} dir="auto">
          <span className="pt-dd__check">{value.includes(o.value) ? '✓' : ''}</span>{o.label}
        </li>
      ))}
    </ul>
  );
}

export const Done = ({ close }: { close: () => void }) => <div className="pt-dd__foot"><button type="button" className="btn btn--primary btn--sm" onClick={close}>تم</button></div>;
export const Sel = ({ label, value, onChange, options, placeholder = '— Select —' }: { label: string; value: string; onChange: (v: string) => void; options: Opt[]; placeholder?: string }) => (
  <label className="pt-dd__f"><span>{label}</span>
    <select className="input" dir="ltr" value={value} onChange={(e) => onChange(e.target.value)}><option value="">{placeholder}</option>{options.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}</select>
  </label>
);
export const Txt = ({ label, value, onChange, placeholder, type = 'text', list, max }: { label: string; value: string; onChange: (v: string) => void; placeholder?: string; type?: string; list?: string; max?: number }) => (
  <label className="pt-dd__f"><span>{label}</span>
    <input className="input" dir="ltr" type={type} list={list} min={type === 'number' ? 0 : undefined} max={type === 'number' ? (max ?? 360) : undefined} placeholder={placeholder} value={value} onChange={(e) => onChange(e.target.value)} autoComplete="off" />
  </label>
);

const multiText = (opts: Opt[], items: string[], other?: string) => items.map((i) => (i === 'other' ? (other?.trim() || 'Other') : lbl(opts, i))).join(', ');

/** قوائم اختيار (متعدد أو واحد) + Other ← Please specify — وأي تفاصيل شرطية تانية (specify) تحت الخانة بس لو الاختيار بتاعها متعلّم */
export type MV = { items: string[]; other?: string; [k: string]: unknown };
export function MultiDrop({ id, label, placeholder, options, value, onChange, extra, legacy, single, searchable, specify, otherLabel = 'Please specify...' }: {
  id: string; label: string; placeholder: string; options: Opt[]; value: MV; onChange: (fn: (prev: MV) => MV) => void;
  extra?: { text: string; node: ReactNode }; legacy?: string; single?: boolean; searchable?: boolean;
  specify?: Array<{ when: string; field: string; placeholder: string }>; otherLabel?: string;
}) {
  const [q, setQ] = useState('');
  const text = [multiText(options, value.items, value.other), extra?.text].filter(Boolean).join(' — ') || (legacy ? `(قديم) ${legacy}` : '');
  const shown = q.trim() ? options.filter((o) => o.label.toLowerCase().includes(q.trim().toLowerCase())) : options;
  return (
    <div>
      <DropBox id={id} label={label} text={text} placeholder={placeholder}>
        {(close) => (<>
          {searchable && <div className="pt-dd__search"><input className="input" dir="ltr" placeholder="Search…" value={q} onChange={(e) => setQ(e.target.value)} autoFocus /></div>}
          <OptionList options={shown} value={value.items} onToggle={(v) => {
            if (single) { onChange((p) => ({ ...p, items: p.items[0] === v ? [] : [v] })); close(); return; }
            onChange((p) => ({ ...p, items: p.items.includes(v) ? p.items.filter((x) => x !== v) : [...p.items, v] }));
          }} />
          {extra?.node}
          {!single && <Done close={close} />}
        </>)}
      </DropBox>
      {(specify ?? []).filter((s) => value.items.includes(s.when)).map((s) => (
        <input key={s.field} className="input pt-dd__other" placeholder={s.placeholder} value={String(value[s.field] ?? '')} onChange={(e) => { const o = e.target.value; onChange((p) => ({ ...p, [s.field]: o })); }} />
      ))}
      {value.items.includes('other') && <input className="input pt-dd__other" placeholder={otherLabel} value={value.other ?? ''} onChange={(e) => { const o = e.target.value; onChange((p) => ({ ...p, other: o })); }} />}
    </div>
  );
}

/** قوائم بعناصر متعددة (Muscle / ROM / Special Tests / Reflexes): نموذج صغير جوه الـ Dropdown + العناصر المضافة (تعديل/حذف) */
export function EntriesDrop<T extends { key: string }>({ id, label, placeholder, rows, onChange, empty, line, form, valid, legacy, addLabel }: {
  id: string; label: string; placeholder: string; rows: T[]; onChange: (rows: T[]) => void; empty: () => T; line: (r: T) => string;
  form: (d: T, set: (p: Partial<T>) => void) => ReactNode; valid: (d: T) => boolean; legacy?: string; addLabel: string;
}) {
  const [draft, setDraft] = useState<T>(empty);
  const [editing, setEditing] = useState<string | null>(null);
  const set = (p: Partial<T>) => setDraft((d) => ({ ...d, ...p }));
  const save = () => {
    if (!valid(draft)) return;
    onChange(editing ? rows.map((r) => (r.key === editing ? { ...draft, key: editing } : r)) : [...rows, { ...draft, key: rowKey() }]);
    setDraft(empty()); setEditing(null);
  };
  const text = rows.map(line).join('\n') || (legacy ? `(قديم) ${legacy}` : '');
  return (
    <DropBox id={id} label={label} text={text} placeholder={placeholder} wide>
      {(close) => (<>
        {rows.length > 0 && (
          <ul className="pt-dd__entries">
            {rows.map((r) => (
              <li key={r.key} className={editing === r.key ? 'sel' : ''}>
                <button type="button" className="pt-dd__entry" dir="ltr" title="تعديل" onClick={() => { setDraft({ ...r }); setEditing(r.key); }}>{line(r)}</button>
                <button type="button" className="pt-dd__x" aria-label="حذف" title="حذف" onClick={() => { onChange(rows.filter((x) => x.key !== r.key)); if (editing === r.key) { setDraft(empty()); setEditing(null); } }}>✕</button>
              </li>
            ))}
          </ul>
        )}
        <div className="pt-dd__form">{form(draft, set)}</div>
        <div className="pt-dd__foot">
          {editing && <button type="button" className="btn btn--outline btn--sm" onClick={() => { setDraft(empty()); setEditing(null); }}>إلغاء التعديل</button>}
          <button type="button" className="btn btn--outline btn--sm" disabled={!valid(draft)} onClick={save}>{editing ? 'تحديث' : addLabel}</button>
          <button type="button" className="btn btn--primary btn--sm" onClick={() => { if (valid(draft)) save(); close(); }}>تم</button>
        </div>
      </>)}
    </DropBox>
  );
}

const ASSIST = ['cane', 'walker', 'crutches', 'wheelchair'];

export function PhysioObjectiveFields({ idp, value, onChange, legacy }: {
  idp: string; value: Objective; onChange: (v: Objective) => void;
  /** النص القديم (قبل الاختيارات) لكل خانة — بيتعرض جوه الخانة لو مفيش اختيار */
  legacy?: Partial<Record<'observation' | 'palpation' | 'rom' | 'muscleAssessment' | 'sensationSuperficial' | 'sensationDeep' | 'reflexes' | 'specialTests' | 'gait', string>>;
}) {
  const [lists, setLists] = useState<{ muscles: ListItem[]; tests: ListItem[] }>({ muscles: [], tests: [] });
  useEffect(() => { physioLists.load().then(setLists).catch(() => {}); }, []);
  // آخر قيمة دايمًا (مش قيمة الـ render) — عشان اختيارين ورا بعض بسرعة مايضيعوش بعض
  const cur = useRef(value); cur.current = value;
  const set = <K extends keyof Objective>(k: K, v: Objective[K] | ((prev: Objective[K]) => Objective[K])) => {
    const next = { ...cur.current, [k]: typeof v === 'function' ? (v as (p: Objective[K]) => Objective[K])(cur.current[k]) : v };
    cur.current = next; onChange(next);
  };
  const mv = (k: 'observation' | 'sensationSuperficial' | 'sensationDeep' | 'gait') => (fn: (p: MV) => MV) =>
    set(k, ((prev: Objective[typeof k]) => ({ ...(prev ?? { items: [] }), ...fn((prev as MV) ?? { items: [] }) })) as never);
  const L = (k: keyof NonNullable<typeof legacy>) => (legacy?.[k] ?? '').trim();
  const ss = value.sensationSuperficial ?? { items: [] };
  const sd = value.sensationDeep ?? { items: [] };
  const gait = value.gait ?? { items: [] };
  const palp = value.palpation ?? { items: [] };
  // ROM: قيم سالبة مسموحة (مدى حركي سالب) من -360 إلى 360
  const n = (s: string) => { if (s === '' || s === '-') return null; const v = Number(s); return Number.isFinite(v) ? Math.max(-360, Math.min(360, v)) : null; };
  const otherOr = (v: string, other?: string) => (v === 'other' ? (other?.trim() || 'Other') : v);

  return (
    <div className="grid-form">
      <MultiDrop id={`${idp}-obs`} label="General Observation" placeholder="Select General Observation..." options={OBSERVATION} legacy={L('observation')}
        value={value.observation ?? { items: [] }} onChange={mv('observation')} />
      <MultiDrop id={`${idp}-palp`} label="Palpation" placeholder="Select Palpation..." options={PALPATION} legacy={L('palpation')}
        value={{ items: palp.items, other: palp.notes }} onChange={(fn) => set('palpation', (prev) => { const r = fn({ items: prev?.items ?? [], other: prev?.notes }); return { items: r.items, notes: r.other }; })} />

      <EntriesDrop<RomRow> id={`${idp}-rom`} label="Range of Motion (ROM)" placeholder="Select ROM..." addLabel="Add ROM" legacy={L('rom')}
        rows={value.rom ?? []} onChange={(r) => set('rom', r)}
        empty={() => ({ key: '', joint: '', side: '', movement: '', status: '', active: null, passive: null })}
        valid={(d) => !!d.joint && !!d.side && !!d.status && (d.joint !== 'other' || !!d.jointOther?.trim())}
        line={(r) => [r.joint === 'other' ? (r.jointOther || 'Other') : lbl(JOINTS, r.joint), lbl(SIDE_ROM, r.side), r.movement, lbl(ROM_STATUS, r.status),
          r.active != null ? `AROM ${r.active}°` : '', r.passive != null ? `PROM ${r.passive}°` : ''].filter(Boolean).join(' — ')}
        form={(d, s) => (<>
          <Sel label="Joint" value={d.joint} options={JOINTS} onChange={(v) => s({ joint: v, movement: '' })} />
          {d.joint === 'other' && <Txt label="Joint" placeholder="Please specify..." value={d.jointOther ?? ''} onChange={(v) => s({ jointOther: v })} />}
          <Sel label="Side" value={d.side} options={SIDE_ROM.filter((x) => x.value !== 'midline')} onChange={(v) => s({ side: v })} />
          {d.joint && d.joint !== 'other'
            ? <Sel label="Movement" value={d.movement} options={MOVEMENTS[d.joint].map((m) => ({ value: m, label: m }))} onChange={(v) => s({ movement: v })} />
            : d.joint === 'other' ? <Txt label="Movement" value={d.movement} onChange={(v) => s({ movement: v })} /> : null}
          <Sel label="ROM Status" value={d.status} options={ROM_STATUS} onChange={(v) => s({ status: v })} />
          <Txt label="Active ROM °" type="number" value={d.active == null ? '' : String(d.active)} onChange={(v) => s({ active: n(v) })} />
          <Txt label="Passive ROM °" type="number" value={d.passive == null ? '' : String(d.passive)} onChange={(v) => s({ passive: n(v) })} />
        </>)} />
      <EntriesDrop<MuscleRow> id={`${idp}-mus`} label="Muscle Assessment" placeholder="Select Muscle Assessment..." addLabel="Add Muscle" legacy={L('muscleAssessment')}
        rows={value.muscles ?? []} onChange={(r) => set('muscles', r)}
        empty={() => ({ key: '', muscle: '', side: '', grade: '' })}
        valid={(d) => !!d.muscle.trim() && d.muscle !== 'other' && !!d.side && !!d.grade}
        line={(r) => `${r.muscle} — ${lbl(SIDE3, r.side)} — ${lbl(GRADES, r.grade)}`}
        form={(d, s) => {
          const known = lists.muscles.some((m) => m.name === d.muscle);
          const pick = d.muscle === '' ? '' : known ? d.muscle : 'other';
          return (<>
            <Sel label="Muscle" placeholder="Select Muscle" value={pick} options={[...lists.muscles.filter((m) => m.active || m.name === d.muscle).map((m) => ({ value: m.name, label: m.name })), { value: 'other', label: 'Other' }]}
              onChange={(v) => s({ muscle: v === 'other' ? ' ' : v })} />
            {pick === 'other' && <Txt label="Muscle" placeholder="Please specify..." value={d.muscle.trim()} onChange={(v) => s({ muscle: v || ' ' })} />}
            <Sel label="Side" value={d.side} options={SIDE3} onChange={(v) => s({ side: v })} />
            <Sel label="Strength" placeholder="Select Grade" value={d.grade} options={GRADES.map((g) => ({ value: g.value, label: GRADE_HINT[g.value] ? `${g.label} — ${GRADE_HINT[g.value]}` : g.label }))} onChange={(v) => s({ grade: v })} />
          </>);
        }} />

      <MultiDrop id={`${idp}-ss`} label="Sensation — Superficial" placeholder="Select Superficial Sensation..." options={SENS_SUP} legacy={L('sensationSuperficial')}
        value={ss} onChange={mv('sensationSuperficial')}
        extra={{ text: ss.area?.trim() ? `Area: ${ss.area.trim()}` : '', node: <div className="pt-dd__form"><Txt label="Location / Area (optional)" value={ss.area ?? ''} onChange={(v) => set('sensationSuperficial', (p) => ({ items: [], ...p, area: v }))} /></div> }} />
      <MultiDrop id={`${idp}-sd`} label="Sensation — Deep" placeholder="Select Deep Sensation..." options={SENS_DEEP} legacy={L('sensationDeep')}
        value={sd} onChange={mv('sensationDeep')}
        extra={{ text: sd.area?.trim() ? `Area: ${sd.area.trim()}` : '', node: <div className="pt-dd__form"><Txt label="Location / Area (optional)" value={sd.area ?? ''} onChange={(v) => set('sensationDeep', (p) => ({ items: [], ...p, area: v }))} /></div> }} />

      <EntriesDrop<ReflexRow> id={`${idp}-ref`} label="Reflexes" placeholder="Select Reflex..." addLabel="Add Reflex" legacy={L('reflexes')}
        rows={value.reflexes ?? []} onChange={(r) => set('reflexes', r)}
        empty={() => ({ key: '', reflex: '', side: '', result: '', notes: '' })}
        valid={(d) => !!d.reflex && !!d.side && !!d.result && (d.reflex !== 'other' || !!d.reflexOther?.trim())}
        line={(r) => [otherOr(r.reflex === 'other' ? 'other' : lbl(REFLEXES, r.reflex), r.reflexOther), lbl(SIDE3, r.side), lbl(REFLEX_RESULT, r.result), r.notes?.trim() ?? ''].filter(Boolean).join(' — ')}
        form={(d, s) => (<>
          <Sel label="Reflex" placeholder="Select Reflex" value={d.reflex} options={REFLEXES} onChange={(v) => s({ reflex: v })} />
          {d.reflex === 'other' && <Txt label="Reflex" placeholder="Please specify..." value={d.reflexOther ?? ''} onChange={(v) => s({ reflexOther: v })} />}
          <Sel label="Side" value={d.side} options={SIDE3} onChange={(v) => s({ side: v })} />
          <Sel label="Result" value={d.result} options={REFLEX_RESULT} onChange={(v) => s({ result: v })} />
          <Txt label="Notes (optional)" value={d.notes ?? ''} onChange={(v) => s({ notes: v })} />
        </>)} />
      <EntriesDrop<TestRow> id={`${idp}-st`} label="Special Tests" placeholder="Select Special Test..." addLabel="Add Test" legacy={L('specialTests')}
        rows={value.specialTests ?? []} onChange={(r) => set('specialTests', r)}
        empty={() => ({ key: '', test: '', side: 'na', result: '', notes: '' })}
        valid={(d) => !!d.test.trim() && d.test !== 'other' && !!d.result}
        line={(r) => [r.test, lbl(SIDE_TEST, r.side), lbl(TEST_RESULT, r.result), r.notes?.trim() ?? ''].filter(Boolean).join(' — ')}
        form={(d, s) => {
          const known = lists.tests.some((t) => t.name === d.test);
          const pick = d.test === '' ? '' : known ? d.test : 'other';
          return (<>
            <Sel label="Test Name" placeholder="Select Test" value={pick} options={[...lists.tests.filter((t) => t.active || t.name === d.test).map((t) => ({ value: t.name, label: t.name })), { value: 'other', label: 'Other' }]}
              onChange={(v) => s({ test: v === 'other' ? ' ' : v })} />
            {pick === 'other' && <Txt label="Test Name" placeholder="Please specify..." value={d.test.trim()} onChange={(v) => s({ test: v || ' ' })} />}
            <Sel label="Result" placeholder="Select Result" value={d.result} options={TEST_RESULT} onChange={(v) => s({ result: v })} />
            <Sel label="Side" value={d.side} options={SIDE_TEST} onChange={(v) => s({ side: v || 'na' })} />
            <Txt label="Notes (optional)" value={d.notes ?? ''} onChange={(v) => s({ notes: v })} />
          </>);
        }} />

      <MultiDrop id={`${idp}-gait`} label="Gait" placeholder="Select Gait..." options={GAIT} legacy={L('gait')}
        value={gait} onChange={mv('gait')}
        extra={gait.items.some((i) => ASSIST.includes(i)) || gait.device?.trim()
          ? { text: gait.device?.trim() ? `Device: ${gait.device.trim()}` : '', node: <div className="pt-dd__form"><Txt label="Assistive Device" placeholder="e.g. single-point cane" value={gait.device ?? ''} onChange={(v) => set('gait', (p) => ({ items: [], ...p, device: v }))} /></div> }
          : undefined} />
    </div>
  );
}
