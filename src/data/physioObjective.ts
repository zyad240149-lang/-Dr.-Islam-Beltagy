// الفحص (Objective) المنظّم في تقييم العلاج الطبيعي — نفس الاختيارات اللي الخادم بيتحقق منها (هجرة 073: physio_objective).
// القيم المخزّنة مفاتيح ثابتة (value) والعرض بالـ label، عشان أي تعديل في الكلام مايبوّظش البيانات القديمة.
import { supabase } from '../lib/supabase';

export type Opt = { value: string; label: string };
const o = (pairs: Array<[string, string]>): Opt[] => pairs.map(([value, label]) => ({ value, label }));

export const OBSERVATION = o([['normal', 'Normal'], ['good_general', 'Good General Condition'], ['poor_general', 'Poor General Condition'], ['postural_abnormality', 'Postural Abnormality'],
  ['swelling', 'Swelling / Edema'], ['redness', 'Redness'], ['bruising', 'Bruising'], ['atrophy', 'Muscle Atrophy'], ['hypertrophy', 'Muscle Hypertrophy'], ['deformity', 'Deformity'],
  ['scar', 'Scar'], ['skin_changes', 'Skin Changes'], ['limited_movement', 'Limited Movement'], ['difficulty_standing', 'Difficulty in Standing'], ['difficulty_sitting', 'Difficulty in Sitting'],
  ['difficulty_walking', 'Difficulty in Walking'], ['assistive_device', 'Uses Assistive Device'], ['other', 'Other']]);
export const PALPATION = o([['normal', 'Normal'], ['no_tenderness', 'No Tenderness'], ['tenderness', 'Tenderness'], ['mild_tenderness', 'Mild Tenderness'], ['moderate_tenderness', 'Moderate Tenderness'],
  ['severe_tenderness', 'Severe Tenderness'], ['local_pain', 'Local Pain'], ['swelling', 'Swelling / Edema'], ['increased_tone', 'Increased Muscle Tone'], ['decreased_tone', 'Decreased Muscle Tone'],
  ['spasm', 'Muscle Spasm'], ['trigger_point', 'Trigger Point'], ['tightness', 'Tightness'], ['warmth', 'Warmth'], ['coldness', 'Coldness'], ['crepitus', 'Crepitus'], ['scar_tissue', 'Scar Tissue'], ['other', 'Other']]);
export const GAIT = o([['normal', 'Normal'], ['antalgic', 'Antalgic Gait'], ['ataxic', 'Ataxic Gait'], ['steppage', 'Steppage Gait'], ['spastic', 'Spastic Gait'], ['trendelenburg', 'Trendelenburg Gait'],
  ['hemiplegic', 'Hemiplegic Gait'], ['parkinsonian', 'Parkinsonian Gait'], ['foot_drop', 'Foot Drop'], ['unsteady', 'Unsteady Gait'], ['wide_based', 'Wide-Based Gait'], ['circumduction', 'Circumduction Gait'],
  ['shuffling', 'Shuffling Gait'], ['limp', 'Limp'], ['cane', 'Uses Cane'], ['walker', 'Uses Walker'], ['crutches', 'Uses Crutches'], ['wheelchair', 'Uses Wheelchair'], ['other', 'Other']]);
export const SENS_SUP = o([['normal', 'Normal'], ['decreased', 'Decreased'], ['increased', 'Increased'], ['absent', 'Absent'], ['hypersensitivity', 'Hypersensitivity'], ['allodynia', 'Allodynia'],
  ['paresthesia', 'Paresthesia'], ['dysesthesia', 'Dysesthesia'], ['not_tested', 'Not Tested'], ['other', 'Other']]);
export const SENS_DEEP = o([['normal', 'Normal'], ['decreased', 'Decreased'], ['increased', 'Increased'], ['absent', 'Absent'], ['impaired', 'Impaired'], ['not_tested', 'Not Tested'], ['other', 'Other']]);

export const SIDE3 = o([['right', 'Right'], ['left', 'Left'], ['bilateral', 'Bilateral']]);
export const SIDE_ROM = o([['right', 'Right'], ['left', 'Left'], ['bilateral', 'Bilateral'], ['na', 'N/A'], ['midline', 'Midline']]);
export const SIDE_TEST = o([['right', 'Right'], ['left', 'Left'], ['bilateral', 'Bilateral'], ['na', 'N/A']]);
export const GRADES = o([['0', '0/5'], ['1', '1/5'], ['2', '2/5'], ['3', '3/5'], ['4', '4/5'], ['5', '5/5'], ['nt', 'Not Tested']]);
/** شرح درجات Manual Muscle Testing — بيظهر جوه القائمة بس */
export const GRADE_HINT: Record<string, string> = { '0': 'No muscle activation', '1': 'Trace contraction', '2': 'Movement with gravity eliminated', '3': 'Movement against gravity', '4': 'Movement against some resistance', '5': 'Movement against full/maximal resistance' };
export const JOINTS = o([['shoulder', 'Shoulder'], ['elbow', 'Elbow'], ['wrist', 'Wrist'], ['hand', 'Hand'], ['hip', 'Hip'], ['knee', 'Knee'], ['ankle', 'Ankle'],
  ['cervical', 'Cervical Spine'], ['thoracic', 'Thoracic Spine'], ['lumbar', 'Lumbar Spine'], ['other', 'Other']]);
const SPINE = ['Flexion', 'Extension', 'Right Rotation', 'Left Rotation', 'Right Lateral Flexion', 'Left Lateral Flexion'];
export const MOVEMENTS: Record<string, string[]> = {
  shoulder: ['Flexion', 'Extension', 'Abduction', 'Adduction', 'Internal Rotation', 'External Rotation'],
  elbow: ['Flexion', 'Extension', 'Pronation', 'Supination'],
  wrist: ['Flexion', 'Extension', 'Radial Deviation', 'Ulnar Deviation'],
  hand: ['Flexion', 'Extension', 'Abduction', 'Adduction', 'Opposition'],
  hip: ['Flexion', 'Extension', 'Abduction', 'Adduction', 'Internal Rotation', 'External Rotation'],
  knee: ['Flexion', 'Extension'],
  ankle: ['Dorsiflexion', 'Plantarflexion', 'Inversion', 'Eversion'],
  cervical: SPINE, thoracic: SPINE, lumbar: SPINE, other: [],
};
export const ROM_STATUS = o([['normal', 'Normal'], ['mild', 'Mildly Limited'], ['moderate', 'Moderately Limited'], ['severe', 'Severely Limited'],
  ['painful', 'Painful'], ['hypermobile', 'Hypermobile'], ['not_tested', 'Not Tested']]);
export const TEST_RESULT = o([['positive', 'Positive'], ['negative', 'Negative'], ['equivocal', 'Equivocal'], ['not_tested', 'Not Tested']]);
export const REFLEXES = o([['biceps', 'Biceps'], ['triceps', 'Triceps'], ['brachioradialis', 'Brachioradialis'], ['patellar', 'Patellar'], ['achilles', 'Achilles'], ['other', 'Other']]);
export const REFLEX_RESULT = o([['0', '0 — Absent'], ['1+', '1+ — Diminished'], ['2+', '2+ — Normal'], ['3+', '3+ — Brisk'], ['4+', '4+ — Hyperactive / Clonus']]);

export interface MuscleRow { key: string; muscle: string; side: string; grade: string }
export interface RomRow { key: string; joint: string; jointOther?: string; side: string; movement: string; status: string; active?: number | null; passive?: number | null }
export interface TestRow { key: string; test: string; side: string; result: string; notes?: string }
export interface ReflexRow { key: string; reflex: string; reflexOther?: string; side: string; result: string; notes?: string }
export interface Objective {
  observation?: { items: string[]; other?: string };
  palpation?: { items: string[]; notes?: string };
  muscles?: MuscleRow[];
  rom?: RomRow[];
  sensationSuperficial?: { items: string[]; area?: string; other?: string };
  sensationDeep?: { items: string[]; area?: string; other?: string };
  specialTests?: TestRow[];
  reflexes?: ReflexRow[];
  gait?: { items: string[]; device?: string; notes?: string };
}
export const rowKey = () => Math.random().toString(36).slice(2, 10);
export const lbl = (list: Opt[], v: string) => list.find((x) => x.value === v)?.label ?? v;

/** قبل الحفظ: يشيل الصفوف الفاضية والقيم الفاضية — والخادم بيتحقق من الباقي */
export function cleanObjective(x: Objective): Objective {
  const out: Objective = {};
  const t = (s?: string) => (s ?? '').trim();
  if (x.observation?.items.length || t(x.observation?.other)) out.observation = { items: x.observation!.items, other: t(x.observation!.other) };
  if (x.palpation?.items.length || t(x.palpation?.notes)) out.palpation = { items: x.palpation!.items, notes: t(x.palpation!.notes) };
  if (x.muscles?.length) out.muscles = x.muscles.map((r) => ({ ...r, muscle: t(r.muscle) }));
  if (x.rom?.length) out.rom = x.rom.map((r) => ({ ...r, jointOther: t(r.jointOther), active: r.active ?? null, passive: r.passive ?? null }));
  for (const k of ['sensationSuperficial', 'sensationDeep'] as const) {
    const s = x[k]; if (s && (s.items.length || t(s.area) || t(s.other))) out[k] = { items: s.items, area: t(s.area), other: t(s.other) };
  }
  if (x.specialTests?.length) out.specialTests = x.specialTests.map((r) => ({ ...r, test: t(r.test), notes: t(r.notes) }));
  if (x.reflexes?.length) out.reflexes = x.reflexes.map((r) => ({ ...r, reflexOther: t(r.reflexOther), notes: t(r.notes) }));
  if (x.gait?.items.length || t(x.gait?.device) || t(x.gait?.notes)) out.gait = { items: x.gait!.items, device: t(x.gait!.device), notes: t(x.gait!.notes) };
  return out;
}

/** خطأ واضح قبل الإرسال لو صف ناقص (بدل رسالة الخادم) */
export function objectiveError(x: Objective): string | null {
  for (const r of x.muscles ?? []) if (!r.muscle.trim() || !r.side || r.grade === '') return 'Muscle Assessment: كمّل العضلة والجهة والدرجة أو امسح الصف.';
  for (const r of x.rom ?? []) {
    if (!r.joint || !r.side || !r.status) return 'ROM: كمّل المفصل والجهة والحالة أو امسح الصف.';
    if ([r.active, r.passive].some((d) => d != null && (!Number.isFinite(d) || d < -360 || d > 360))) return 'ROM: الدرجة من -360 إلى 360 (القيم السالبة مسموحة).';
  }
  for (const r of x.specialTests ?? []) if (!r.test.trim() || !r.result) return 'Special Tests: كمّل اسم الاختبار والنتيجة أو امسح الصف.';
  for (const r of x.reflexes ?? []) if (!r.reflex || !r.side || !r.result) return 'Reflexes: كمّل الـ Reflex والجهة والنتيجة أو امسح الصف.';
  return null;
}

/** سطور عرض مختصرة لكل جزء (في ملف المريض وتفاصيل الخطة) */
export function objectiveLines(x: Objective): Array<[string, string]> {
  const out: Array<[string, string]> = [];
  const join = (a: string[]) => a.filter(Boolean).join(' · ');
  if (x.observation) out.push(['General Observation', join([...x.observation.items.filter((i) => i !== 'other').map((i) => lbl(OBSERVATION, i)), x.observation.other ?? ''])]);
  if (x.palpation) out.push(['Palpation', join([...x.palpation.items.filter((i) => i !== 'other').map((i) => lbl(PALPATION, i)), x.palpation.notes ?? ''])]);
  if (x.rom?.length) out.push(['ROM', x.rom.map((r) => join([r.joint === 'other' ? (r.jointOther || 'Other') : lbl(JOINTS, r.joint), lbl(SIDE_ROM, r.side), r.movement, lbl(ROM_STATUS, r.status),
    r.active != null ? `AROM ${r.active}°` : '', r.passive != null ? `PROM ${r.passive}°` : ''])).join('\n')]);
  if (x.muscles?.length) out.push(['Muscle Assessment', x.muscles.map((r) => `${r.muscle} — ${lbl(SIDE3, r.side)} — ${lbl(GRADES, r.grade)}`).join('\n')]);
  if (x.sensationSuperficial) out.push(['Sensation — Superficial', join([...x.sensationSuperficial.items.filter((i) => i !== 'other').map((i) => lbl(SENS_SUP, i)), x.sensationSuperficial.other ?? '', x.sensationSuperficial.area ? `Area: ${x.sensationSuperficial.area}` : ''])]);
  if (x.sensationDeep) out.push(['Sensation — Deep', join([...x.sensationDeep.items.filter((i) => i !== 'other').map((i) => lbl(SENS_DEEP, i)), x.sensationDeep.other ?? '', x.sensationDeep.area ? `Area: ${x.sensationDeep.area}` : ''])]);
  if (x.reflexes?.length) out.push(['Reflexes', x.reflexes.map((r) => join([r.reflex === 'other' ? (r.reflexOther || 'Other') : lbl(REFLEXES, r.reflex), lbl(SIDE3, r.side), lbl(REFLEX_RESULT, r.result), r.notes ?? ''])).join('\n')]);
  if (x.specialTests?.length) out.push(['Special Tests', x.specialTests.map((r) => join([r.test, lbl(SIDE_TEST, r.side), lbl(TEST_RESULT, r.result), r.notes ?? ''])).join('\n')]);
  if (x.gait) out.push(['Gait', join([...x.gait.items.filter((i) => i !== 'other').map((i) => lbl(GAIT, i)), x.gait.device ? `Device: ${x.gait.device}` : '', x.gait.notes ?? ''])]);
  return out.filter(([, v]) => v);
}

// ---------- قوائم العضلات والاختبارات الخاصة (من قاعدة البيانات — بتتدار من الإعدادات) ----------
export interface ListItem { id: string; name: string; active: boolean; sort: number }
let cache: { muscles: ListItem[]; tests: ListItem[] } | null = null;
export const physioLists = {
  async load(force = false): Promise<{ muscles: ListItem[]; tests: ListItem[] }> {
    if (cache && !force) return cache;
    const [m, t] = await Promise.all([
      supabase.from('physio_muscles').select('id, name, active, sort').order('sort').order('name'),
      supabase.from('physio_special_tests').select('id, name, active, sort').order('sort').order('name'),
    ]);
    if (m.error || t.error) throw new Error((m.error || t.error)!.message);
    cache = { muscles: m.data ?? [], tests: t.data ?? [] };
    return cache;
  },
  async save(kind: 'muscle' | 'test', id: string | null, name: string, active = true): Promise<{ ok: true } | { ok: false; error: string }> {
    const { error } = await supabase.rpc('physio_list_save', { p_kind: kind, p_id: id, p_name: name, p_active: active });
    if (error) return { ok: false, error: error.message.replace(/^.*?ERROR:\s*/, '') };
    cache = null;
    return { ok: true };
  },
};
