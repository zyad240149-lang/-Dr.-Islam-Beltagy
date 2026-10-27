// الألم والأعراض (Subjective) المنظّم في تقييم العلاج الطبيعي — نفس الاختيارات اللي الخادم بيتحقق منها (هجرة 076: physio_subjective).
import { lbl, rowKey, type Opt } from './physioObjective';

const o = (pairs: Array<[string, string]>): Opt[] => pairs.map(([value, label]) => ({ value, label }));
export const LOCATION = o([['head', 'Head'], ['face', 'Face'], ['jaw', 'Jaw'], ['neck', 'Neck'], ['shoulder', 'Shoulder'], ['upper_arm', 'Upper Arm'], ['elbow', 'Elbow'], ['forearm', 'Forearm'],
  ['wrist', 'Wrist'], ['hand', 'Hand'], ['chest', 'Chest'], ['upper_back', 'Upper Back'], ['lower_back', 'Lower Back'], ['abdomen', 'Abdomen'], ['pelvis', 'Pelvis'], ['hip', 'Hip'],
  ['thigh', 'Thigh'], ['knee', 'Knee'], ['lower_leg', 'Lower Leg'], ['ankle', 'Ankle'], ['foot', 'Foot'], ['multiple', 'Multiple Areas'], ['other', 'Other']]);
export const RADIATION = o([['none', 'No Radiation'], ['right', 'Right Side'], ['left', 'Left Side'], ['bilateral', 'Bilateral'], ['proximal', 'Proximal'], ['distal', 'Distal'],
  ['upper_limb', 'To Upper Limb'], ['lower_limb', 'To Lower Limb'], ['back', 'To Back'], ['chest', 'To Chest'], ['abdomen', 'To Abdomen'], ['other', 'Other']]);
export const ONSET = o([['sudden', 'Sudden'], ['gradual', 'Gradual'], ['traumatic', 'Traumatic'], ['non_traumatic', 'Non-traumatic'], ['post_operative', 'Post-operative'],
  ['insidious', 'Insidious'], ['recurrent', 'Recurrent'], ['flare_up', 'Flare-up of Chronic Condition'], ['unknown', 'Unknown'], ['other', 'Other']]);
export const DURATION_UNITS = o([['hours', 'Hours'], ['days', 'Days'], ['weeks', 'Weeks'], ['months', 'Months'], ['years', 'Years']]);
export const CHARACTER = o([['dull', 'Dull'], ['aching', 'Aching'], ['sharp', 'Sharp'], ['stabbing', 'Stabbing'], ['throbbing', 'Throbbing'], ['burning', 'Burning'], ['shooting', 'Shooting'],
  ['cramping', 'Cramping'], ['pressure', 'Pressure'], ['tightness', 'Tightness'], ['soreness', 'Soreness'], ['numbness', 'Numbness'], ['tingling', 'Tingling'], ['pins_needles', 'Pins and Needles'],
  ['electric', 'Electric Shock-like'], ['itching', 'Itching'], ['deep', 'Deep'], ['superficial', 'Superficial'], ['other', 'Other']]);
export const PATTERN = o([['constant', 'Constant'], ['intermittent', 'Intermittent'], ['episodic', 'Episodic'], ['activity', 'Activity-related'], ['night', 'Night Pain'],
  ['morning', 'Morning Symptoms'], ['variable', 'Variable'], ['other', 'Other']]);
export const AGGRAVATING = o([['walking', 'Walking'], ['running', 'Running'], ['standing', 'Standing'], ['sitting', 'Sitting'], ['stairs', 'Stairs'], ['bending', 'Bending'], ['lifting', 'Lifting'],
  ['carrying', 'Carrying'], ['reaching', 'Reaching'], ['pushing', 'Pushing'], ['pulling', 'Pulling'], ['exercise', 'Exercise'], ['sleeping', 'Sleeping'], ['turning_bed', 'Turning in Bed'],
  ['driving', 'Driving'], ['prolonged_activity', 'Prolonged Activity'], ['prolonged_standing', 'Prolonged Standing'], ['prolonged_sitting', 'Prolonged Sitting'], ['movement', 'Movement'],
  ['weight_bearing', 'Weight Bearing'], ['repetitive', 'Repetitive Movement'], ['specific_movement', 'Specific Movement'], ['specific_position', 'Specific Position'], ['coughing', 'Coughing'],
  ['sneezing', 'Sneezing'], ['straining', 'Straining'], ['cold', 'Cold'], ['heat', 'Heat'], ['morning', 'Morning'], ['night', 'Night'], ['other', 'Other']]);
export const RELIEVING = o([['rest', 'Rest'], ['position_change', 'Changing Position'], ['medication', 'Medication'], ['ice', 'Ice / Cold'], ['heat', 'Heat'], ['stretching', 'Stretching'],
  ['exercise', 'Exercise'], ['massage', 'Massage'], ['physiotherapy', 'Physiotherapy'], ['lying_down', 'Lying Down'], ['sitting', 'Sitting'], ['standing', 'Standing'], ['elevation', 'Elevation'],
  ['compression', 'Compression'], ['sleep', 'Sleep'], ['other', 'Other']]);
export const HISTORY = o([['none', 'No Significant Medical History'], ['previous_injury', 'Previous Injury'], ['previous_surgery', 'Previous Surgery'], ['previous_physio', 'Previous Physiotherapy'],
  ['chronic', 'Chronic Medical Condition'], ['neurological', 'Neurological Condition'], ['musculoskeletal', 'Musculoskeletal Condition'], ['cardiovascular', 'Cardiovascular Condition'],
  ['respiratory', 'Respiratory Condition'], ['diabetes', 'Diabetes'], ['hypertension', 'Hypertension'], ['osteoporosis', 'Osteoporosis'], ['cancer', 'Cancer History'], ['other', 'Other']]);

export type Pick = { items: string[]; other?: string };
export interface MedRow { key: string; name: string; dosage?: string; frequency?: string; notes?: string }
export interface Subjective {
  location?: Pick; radiation?: Pick; onset?: Pick; duration?: { value: number | null; unit: string };
  character?: Pick; pattern?: Pick; aggravating?: Pick; relieving?: Pick;
  history?: Pick & { surgery?: string; injury?: string }; medications?: MedRow[];
}
const PICKS = ['location', 'radiation', 'onset', 'character', 'pattern', 'aggravating', 'relieving', 'history'] as const;
const NAMES: Record<string, string> = { location: 'Location of Pain', radiation: 'Radiation / Spread', onset: 'Onset', character: 'Character of Pain', pattern: 'Pain Pattern',
  aggravating: 'Aggravating Factors', relieving: 'Relieving Factors', history: 'Medical/Surgical History' };
export const SUBJ_OPTS: Record<(typeof PICKS)[number], Opt[]> = { location: LOCATION, radiation: RADIATION, onset: ONSET, character: CHARACTER, pattern: PATTERN, aggravating: AGGRAVATING, relieving: RELIEVING, history: HISTORY };

export const pickText = (k: (typeof PICKS)[number], p?: Pick) => (p?.items ?? []).map((i) => (i === 'other' ? (p?.other?.trim() || 'Other') : lbl(SUBJ_OPTS[k], i))).join(', ');
export const durationText = (d?: { value: number | null; unit: string }) => (d?.value ? `${d.value} ${d.value === 1 ? d.unit.replace(/s$/, '') : d.unit}` : '');
export const medText = (m: MedRow) => [m.name, m.dosage, m.frequency, m.notes].map((x) => (x ?? '').trim()).filter(Boolean).join(' — ');

/** قبل الحفظ: شيل الفاضي ونضّف النصوص */
export function cleanSubjective(x: Subjective): Subjective {
  const out: Subjective = {};
  const t = (s?: string) => (s ?? '').trim();
  for (const k of PICKS) {
    const p = x[k];
    if (p && (p.items.length || t(p.other))) {
      const base: Pick & { surgery?: string; injury?: string } = { items: p.items, other: p.items.includes('other') ? t(p.other) : '' };
      if (k === 'history') { const h = p as Subjective['history']; base.surgery = p.items.includes('previous_surgery') ? t(h?.surgery) : ''; base.injury = p.items.includes('previous_injury') ? t(h?.injury) : ''; }
      (out as Record<string, unknown>)[k] = base;
    }
  }
  if (x.duration?.value) out.duration = { value: x.duration.value, unit: x.duration.unit };
  const meds = (x.medications ?? []).filter((m) => t(m.name)).map((m) => ({ key: m.key || rowKey(), name: t(m.name), dosage: t(m.dosage), frequency: t(m.frequency), notes: t(m.notes) }));
  if (meds.length) out.medications = meds;
  return out;
}

/** أخطاء واضحة قبل الإرسال (والخادم بيتحقق تاني) */
export function subjectiveError(x: Subjective): string | null {
  for (const k of PICKS) if (x[k]?.items.includes('other') && !(x[k]?.other ?? '').trim()) return `${NAMES[k]}: اكتب تفاصيل «Other».`;
  if (x.history?.items.includes('previous_surgery') && !(x.history.surgery ?? '').trim()) return 'Medical/Surgical History: اكتب تفاصيل العملية (Surgery Details).';
  if (x.history?.items.includes('previous_injury') && !(x.history.injury ?? '').trim()) return 'Medical/Surgical History: اكتب تفاصيل الإصابة (Injury Details).';
  const d = x.duration;
  if (d && d.value != null && (!(d.value > 0) || !d.unit)) return 'Duration: اكتب رقم موجب واختر الوحدة.';
  return null;
}

/** سطور العرض في ملف المريض */
export function subjectiveLines(x: Subjective): Array<[string, string]> {
  const out: Array<[string, string]> = [];
  for (const k of PICKS) {
    let v = pickText(k, x[k]);
    if (k === 'history' && x.history) v = [v, x.history.surgery ? `Surgery: ${x.history.surgery}` : '', x.history.injury ? `Injury: ${x.history.injury}` : ''].filter(Boolean).join(' — ');
    if (k === 'onset' && x.duration?.value) { if (v) out.push([NAMES.onset, v]); out.push(['Duration', durationText(x.duration)]); continue; }
    if (v) out.push([NAMES[k], v]);
  }
  if (!x.onset?.items.length && x.duration?.value) out.push(['Duration', durationText(x.duration)]);
  if (x.medications?.length) out.push(['Medications', x.medications.map(medText).join('\n')]);
  return out;
}
