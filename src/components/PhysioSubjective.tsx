// قسم الألم والأعراض (Subjective) في تقييم العلاج الطبيعي — نفس الخانات في نفس أماكنها، بس كل خانة بقت Dropdown
// (نفس مكوّنات PhysioObjective). بيتعرض على 3 أجزاء عشان كل جزء يفضل في نفس مكانه في النموذج:
//   top: Location / Onset / Duration (+ Radiation / Pattern جنبهم في نفس الشبكة)   character: بدل شرائح Character   bottom: Aggravating / Relieving / History / Medications
import { useRef } from 'react';
import { DropBox, Done, EntriesDrop, MultiDrop, Sel, Txt, type MV } from './PhysioObjective';
import {
  AGGRAVATING, CHARACTER, DURATION_UNITS, HISTORY, LOCATION, ONSET, PATTERN, RADIATION, RELIEVING, durationText, medText,
  type MedRow, type Pick, type Subjective,
} from '../data/physioSubjective';

export interface SubjLegacy { painLocation?: string; onset?: string | null; duration?: string; painCharacter?: string[]; aggravatingFactors?: string; relievingFactors?: string; medicalHistory?: string; medications?: string }

export function PhysioSubjectiveFields({ part, idp, value, onChange, legacy }: {
  part: 'top' | 'character' | 'bottom'; idp: string; value: Subjective; onChange: (v: Subjective) => void; legacy?: SubjLegacy;
}) {
  // آخر قيمة دايمًا — عشان اختيارين ورا بعض بسرعة مايضيعوش بعض
  const cur = useRef(value); cur.current = value;
  const set = <K extends keyof Subjective>(k: K, fn: (prev: Subjective[K]) => Subjective[K]) => {
    const next = { ...cur.current, [k]: fn(cur.current[k]) }; cur.current = next; onChange(next);
  };
  const pick = (k: 'location' | 'radiation' | 'onset' | 'character' | 'pattern' | 'aggravating' | 'relieving' | 'history') =>
    (fn: (p: MV) => MV) => set(k, (prev) => fn((prev as MV) ?? { items: [] }) as never);
  const v = (k: keyof Subjective) => ((value[k] as Pick | undefined) ?? { items: [] }) as MV;
  const L = (s?: string | null) => (s ?? '').trim();

  if (part === 'top') {
    const d = value.duration ?? { value: null, unit: '' };
    return (<>
      <MultiDrop id={`${idp}-loc`} label="مكان الألم (Location of Pain)" placeholder="Select Location of Pain..." options={LOCATION} searchable value={v('location')} onChange={pick('location')}
        legacy={L(legacy?.painLocation)} otherLabel="Specify Location..." />
      <MultiDrop id={`${idp}-onset`} label="بداية الألم (Onset)" placeholder="Select Onset..." options={ONSET} single value={v('onset')} onChange={pick('onset')}
        legacy={legacy?.onset ? (legacy.onset === 'sudden' ? 'Sudden' : legacy.onset === 'gradual' ? 'Gradual' : legacy.onset) : ''} />
      <DropBox id={`${idp}-dur`} label="المدة (Duration)" text={durationText(d) || (L(legacy?.duration) ? `(قديم) ${L(legacy?.duration)}` : '')} placeholder="Select Duration...">
        {(close) => (<>
          <div className="pt-dd__form">
            <Txt label="Value" type="number" max={1000} value={d.value == null ? '' : String(d.value)}
              onChange={(x) => set('duration', (p) => ({ unit: p?.unit || 'weeks', value: x === '' ? null : Math.max(0, Number(x)) }))} />
            <Sel label="Unit" value={d.unit} options={DURATION_UNITS} onChange={(x) => set('duration', (p) => ({ value: p?.value ?? null, unit: x }))} />
          </div>
          <Done close={close} />
        </>)}
      </DropBox>
      <MultiDrop id={`${idp}-rad`} label="Radiation / Spread" placeholder="Select Radiation / Spread..." options={RADIATION} value={v('radiation')} onChange={pick('radiation')} />
      <MultiDrop id={`${idp}-pat`} label="Pain Pattern / Timing" placeholder="Select Pain Pattern..." options={PATTERN} value={v('pattern')} onChange={pick('pattern')} />
    </>);
  }

  if (part === 'character') {
    const old = (legacy?.painCharacter ?? []).map((c) => CHARACTER.find((o) => o.value === c)?.label ?? c).join(', ');
    return <MultiDrop id={`${idp}-char`} label="طبيعة الألم/الأعراض (Character of Pain/Symptoms)" placeholder="Select Character of Pain..." options={CHARACTER}
      value={v('character')} onChange={pick('character')} legacy={old} otherLabel="Specify Other Pain Character..." />;
  }

  return (<>
    <MultiDrop id={`${idp}-agg`} label="عوامل تزيد الألم (Aggravating Factors)" placeholder="Select Aggravating Factors..." options={AGGRAVATING} searchable
      value={v('aggravating')} onChange={pick('aggravating')} legacy={L(legacy?.aggravatingFactors)} />
    <MultiDrop id={`${idp}-rel`} label="عوامل تخفف الألم (Relieving Factors)" placeholder="Select Relieving Factors..." options={RELIEVING} searchable
      value={v('relieving')} onChange={pick('relieving')} legacy={L(legacy?.relievingFactors)} />
    <MultiDrop id={`${idp}-hx`} label="التاريخ الطبي/الجراحي (Medical/Surgical History)" placeholder="Select Medical/Surgical History..." options={HISTORY} searchable
      value={v('history')} onChange={pick('history')} legacy={L(legacy?.medicalHistory)} otherLabel="Specify Other History..."
      specify={[{ when: 'previous_surgery', field: 'surgery', placeholder: 'Surgery Details...' }, { when: 'previous_injury', field: 'injury', placeholder: 'Injury Details...' }]} />
    <EntriesDrop<MedRow> id={`${idp}-med`} label="الأدوية (Medications)" placeholder="Select Medications..." addLabel="Add Medication" legacy={L(legacy?.medications)}
      rows={value.medications ?? []} onChange={(r) => set('medications', () => r)}
      empty={() => ({ key: '', name: '', dosage: '', frequency: '', notes: '' })}
      valid={(m) => !!m.name.trim()} line={medText}
      form={(m, s) => (<>
        <Txt label="Medication Name" placeholder="e.g. Ibuprofen" value={m.name} onChange={(x) => s({ name: x })} />
        <Txt label="Dosage (optional)" placeholder="e.g. 400 mg" value={m.dosage ?? ''} onChange={(x) => s({ dosage: x })} />
        <Txt label="Frequency (optional)" placeholder="e.g. 2 times daily" value={m.frequency ?? ''} onChange={(x) => s({ frequency: x })} />
        <Txt label="Notes (optional)" value={m.notes ?? ''} onChange={(x) => s({ notes: x })} />
      </>)} />
  </>);
}
