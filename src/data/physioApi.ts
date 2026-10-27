// ملف العلاج الطبيعي (Physiotherapy) — التقييم ← الخطة والأهداف ← ملاحظات التقدّم لكل جلسة.
import type { Objective } from './physioObjective';
import type { Subjective } from './physioSubjective';
// القراءة مباشرة من الجداول (RLS: صلاحية physio/view + نطاق المريض)، والكتابة كلها عبر RPC على الخادم (هجرة 055).
import { supabase } from '../lib/supabase';

export const PAIN_CHARACTERS = [
  { value: 'dull', label: 'Dull' }, { value: 'aching', label: 'Aching' }, { value: 'numbness', label: 'Numbness' },
  { value: 'burning', label: 'Burning' }, { value: 'stabbing', label: 'Stabbing' }, { value: 'tingling', label: 'Tingling' }, { value: 'itchy', label: 'Itchy' },
] as const;
export const ELECTROTHERAPY = [
  { value: 'tens', label: 'TENS' }, { value: 'swt', label: 'SWT' }, { value: 'laser', label: 'Laser' }, { value: 'ifc', label: 'IFC' },
  { value: 'us', label: 'US' }, { value: 'nmes', label: 'NMES' }, { value: 'game_ready', label: 'Game Ready' }, { value: 'cryotherapy', label: 'Cryotherapy' },
  { value: 'iontophoresis', label: 'Iontophoresis' }, { value: 'phonophoresis', label: 'Phonophoresis' },
] as const;
export const GOALS = [
  'To decrease pain', 'To improve balance / proprioception', 'To decrease inflammation / swelling', 'To correct gait abnormalities',
  'To improve ROM and joint flexibility', 'To correct posture', 'To decrease muscle tightness / spasm', 'To improve coordination',
  'To improve muscle strength', 'To improve functional limitation', 'To improve muscle endurance', 'To enhance Quality of Life',
];
export const labelOf = (list: ReadonlyArray<{ value: string; label: string }>, v: string) => list.find((x) => x.value === v)?.label ?? v;

export type Onset = 'sudden' | 'gradual';
export interface PhysioEvaluation {
  id: string; patientId: string; therapistId: string | null; evalDate: string; age: number | null;
  chiefComplaint: string; painVas: number; painLocation: string; onset: Onset | null; duration: string; painCharacter: string[];
  aggravatingFactors: string; relievingFactors: string; medicalHistory: string; medications: string;
  observation: string; palpation: string; rom: string; muscleAssessment: string; sensationSuperficial: string; sensationDeep: string;
  reflexes: string; specialTests: string; gait: string;
  /** الفحص المنظّم (هجرة 073) — النصوص اللي فوق قديمة وفاضلة للقراءة */
  objective: Objective;
  /** الألم والأعراض المنظّم (هجرة 076) — الأعمدة النصية القديمة فاضلة للقراءة */
  subjective: Subjective;
  diagnosis: string; diagnosisConditionId: string | null; redFlags: boolean; redFlagsNotes: string;
  createdAt: string; updatedAt: string; createdBy: string | null; updatedBy: string | null;
}
export type PlanStatus = 'active' | 'completed' | 'cancelled';
export interface PhysioPlan {
  id: string; patientId: string; evaluationId: string; packageId: string | null; treatmentPlanId: string | null;
  ptFrequency: string; totalSessions: number; durationValue: number | null; durationUnit: 'week' | 'month' | null; sessionsPerWeek: number | null;
  startDate: string; followUpDate: string | null; reevaluationDate: string | null; shortGoals: string[]; longGoals: string[];
  status: PlanStatus; notes: string; createdAt: string; updatedAt: string; createdBy: string | null; updatedBy: string | null;
}
export interface ProgressNote {
  id: string; planId: string; patientId: string; sessionNo: number; sessionDate: string; treatmentSessionId: string | null;
  diagnosis: string; painVas: number; electrotherapy: string[]; manualTherapy: string; positioning: string; therapeuticExercise: string;
  ptName: string; therapistId: string | null; createdAt: string; updatedAt: string; createdBy: string | null; updatedBy: string | null;
}
export interface Tracking { planId: string; total: number; completed: number; remaining: number; nextSessionNo: number | null; status: PlanStatus; reevaluationDate: string | null; followUpDate: string | null }
export interface PhysioData { evaluations: PhysioEvaluation[]; plans: PhysioPlan[]; notes: ProgressNote[] }

export type EvaluationInput = Omit<PhysioEvaluation, 'id' | 'createdAt' | 'updatedAt' | 'createdBy' | 'updatedBy' | 'age'> & { id?: string; age: number | null };
export type PlanInput = Omit<PhysioPlan, 'id' | 'patientId' | 'status' | 'createdAt' | 'updatedAt' | 'createdBy' | 'updatedBy'> & { id?: string; status?: PlanStatus };
export type NoteInput = Omit<ProgressNote, 'id' | 'patientId' | 'sessionNo' | 'createdAt' | 'updatedAt' | 'createdBy' | 'updatedBy'> & { id?: string; sessionNo?: number };

type Result<T> = ({ ok: true } & T) | { ok: false; error: string };
const clean = (m: string) => m.replace(/^.*?ERROR:\s*/, '').replace(/\s*\(SQLSTATE.*$/, '').trim() || 'حدث خطأ غير متوقع.';
const fail = (m: string) => ({ ok: false as const, error: clean(m) });

// كل صف في القوائم الديناميكية محتاج key ثابت للواجهة (الصفوف المحفوظة قبل كده ممكن تيجي من غيره)
const withKeys = (o: Objective): Objective => {
  const k = <T extends { key?: string }>(a?: T[]) => a?.map((r, i) => ({ ...r, key: r.key || `r${i}` }));
  return { ...o, muscles: k(o.muscles) as Objective['muscles'], rom: k(o.rom) as Objective['rom'], specialTests: k(o.specialTests) as Objective['specialTests'], reflexes: k(o.reflexes) as Objective['reflexes'] };
};
const toEval = (r: any): PhysioEvaluation => ({
  id: r.id, patientId: r.patient_id, therapistId: r.therapist_id, evalDate: r.eval_date, age: r.age,
  chiefComplaint: r.chief_complaint, painVas: r.pain_vas, painLocation: r.pain_location, onset: r.onset, duration: r.duration, painCharacter: r.pain_character ?? [],
  aggravatingFactors: r.aggravating_factors, relievingFactors: r.relieving_factors, medicalHistory: r.medical_history, medications: r.medications,
  observation: r.observation, palpation: r.palpation, rom: r.rom, muscleAssessment: r.muscle_assessment, sensationSuperficial: r.sensation_superficial,
  sensationDeep: r.sensation_deep, reflexes: r.reflexes, specialTests: r.special_tests, gait: r.gait,
  objective: withKeys(r.objective ?? {}),
  subjective: { ...(r.subjective ?? {}), medications: (r.subjective?.medications ?? undefined)?.map((m: any, i: number) => ({ ...m, key: m.key || `m${i}` })) },
  diagnosis: r.diagnosis, diagnosisConditionId: r.diagnosis_condition_id, redFlags: r.red_flags, redFlagsNotes: r.red_flags_notes,
  createdAt: r.created_at, updatedAt: r.updated_at, createdBy: r.created_by, updatedBy: r.updated_by,
});
const toPlan = (r: any): PhysioPlan => ({
  id: r.id, patientId: r.patient_id, evaluationId: r.evaluation_id, packageId: r.package_id, treatmentPlanId: r.treatment_plan_id,
  ptFrequency: r.pt_frequency, totalSessions: r.total_sessions, durationValue: r.duration_value, durationUnit: r.duration_unit, sessionsPerWeek: r.sessions_per_week,
  startDate: r.start_date, followUpDate: r.follow_up_date, reevaluationDate: r.reevaluation_date, shortGoals: r.short_goals ?? [], longGoals: r.long_goals ?? [],
  status: r.status, notes: r.notes, createdAt: r.created_at, updatedAt: r.updated_at, createdBy: r.created_by, updatedBy: r.updated_by,
});
const toNote = (r: any): ProgressNote => ({
  id: r.id, planId: r.plan_id, patientId: r.patient_id, sessionNo: r.session_no, sessionDate: r.session_date, treatmentSessionId: r.treatment_session_id,
  diagnosis: r.diagnosis, painVas: r.pain_vas, electrotherapy: r.electrotherapy ?? [], manualTherapy: r.manual_therapy, positioning: r.positioning,
  therapeuticExercise: r.therapeutic_exercise, ptName: r.pt_name, therapistId: r.therapist_id,
  createdAt: r.created_at, updatedAt: r.updated_at, createdBy: r.created_by, updatedBy: r.updated_by,
});

export const physioApi = {
  /** كل بيانات العلاج الطبيعي لمريض (Get Evaluation / Plans / Progress Notes) */
  async forPatient(patientId: string): Promise<Result<{ data: PhysioData }>> {
    const [e, p, n] = await Promise.all([
      supabase.from('physio_evaluations').select('*').eq('patient_id', patientId).order('eval_date', { ascending: false }).order('created_at', { ascending: false }),
      supabase.from('physio_plans').select('*').eq('patient_id', patientId).order('created_at', { ascending: false }),
      supabase.from('physio_progress_notes').select('*').eq('patient_id', patientId).order('session_no', { ascending: true }),
    ]);
    const err = e.error || p.error || n.error;
    if (err) return fail(err.message);
    return { ok: true, data: { evaluations: (e.data ?? []).map(toEval), plans: (p.data ?? []).map(toPlan), notes: (n.data ?? []).map(toNote) } };
  },
  async saveEvaluation(input: EvaluationInput): Promise<Result<{ id: string }>> {
    const { data, error } = await supabase.rpc('physio_save_evaluation', { p: input });
    return error ? fail(error.message) : { ok: true, id: data as string };
  },
  /** إنشاء/تعديل الخطة مع الأهداف */
  async savePlan(input: PlanInput): Promise<Result<{ id: string }>> {
    const { data, error } = await supabase.rpc('physio_save_plan', { p: input });
    return error ? fail(error.message) : { ok: true, id: data as string };
  },
  async setGoals(planId: string, shortGoals: string[], longGoals: string[]): Promise<Result<object>> {
    const { error } = await supabase.rpc('physio_set_goals', { p_plan: planId, p_short: shortGoals, p_long: longGoals });
    return error ? fail(error.message) : { ok: true };
  },
  async saveNote(input: NoteInput): Promise<Result<{ tracking: Tracking & { noteId: string; sessionNo: number } }>> {
    const { data, error } = await supabase.rpc('physio_save_note', { p: input });
    return error ? fail(error.message) : { ok: true, tracking: data };
  },
  async deleteNote(id: string): Promise<Result<object>> {
    const { error } = await supabase.rpc('physio_delete_note', { p_id: id });
    return error ? fail(error.message) : { ok: true };
  },
  /** التقييم وخطة العلاج الطبيعي المربوطين بخطة علاجية (لنافذة تفاصيل الخطة) */
  async forTreatmentPlan(treatmentPlanId: string): Promise<Result<{ plan: PhysioPlan | null; evaluation: PhysioEvaluation | null; notes: ProgressNote[] }>> {
    const p = await supabase.from('physio_plans').select('*').eq('treatment_plan_id', treatmentPlanId).order('created_at', { ascending: false }).limit(1).maybeSingle();
    if (p.error) return fail(p.error.message);
    if (!p.data) return { ok: true, plan: null, evaluation: null, notes: [] };
    const [e, n] = await Promise.all([
      supabase.from('physio_evaluations').select('*').eq('id', p.data.evaluation_id).maybeSingle(),
      supabase.from('physio_progress_notes').select('*').eq('plan_id', p.data.id).order('session_no'),
    ]);
    if (e.error || n.error) return fail((e.error || n.error)!.message);
    return { ok: true, plan: toPlan(p.data), evaluation: e.data ? toEval(e.data) : null, notes: (n.data ?? []).map(toNote) };
  },
  async tracking(planId: string): Promise<Result<{ tracking: Tracking }>> {
    const { data, error } = await supabase.rpc('physio_plan_tracking', { p_plan: planId });
    return error ? fail(error.message) : { ok: true, tracking: data };
  },
};

/** عدّاد الجلسات محليًا من البيانات المحمّلة (نفس منطق physio_plan_tracking على الخادم) */
export function planTracking(plan: PhysioPlan, notes: ProgressNote[]): Tracking {
  const completed = notes.filter((n) => n.planId === plan.id).length;
  return {
    planId: plan.id, total: plan.totalSessions, completed, remaining: Math.max(plan.totalSessions - completed, 0),
    nextSessionNo: completed < plan.totalSessions ? completed + 1 : null, status: plan.status,
    reevaluationDate: plan.reevaluationDate, followUpDate: plan.followUpDate,
  };
}
