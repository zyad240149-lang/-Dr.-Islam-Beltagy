// تبويب «العلاج الطبيعي» في ملف المريض: لوحة مختصرة + التقييم + الخطة + الأهداف + الجلسات + ملاحظات التقدّم.
import { useCallback, useEffect, useMemo, useState } from 'react';
import { db } from '../data/db';
import {
  ELECTROTHERAPY, GOALS, PAIN_CHARACTERS, labelOf, physioApi, planTracking,
  type EvaluationInput, type NoteInput, type PhysioData, type PhysioEvaluation, type PhysioPlan, type PlanInput, type ProgressNote,
} from '../data/physioApi';
import { useAuth } from '../services/auth';
import { useToast } from '../hooks/useToast';
import { Button, EmptyState, ErrorState, Input, Modal, Select, Skeleton, StatusBadge } from './ui';
import { ConfirmDialog, IconAction, RowActions, useCan } from './common';
import { DiagnosisField } from './DiagnosisPicker';
import { StatCard } from './StatCard';
import { PhysioObjectiveFields } from './PhysioObjective';
import { PhysioSubjectiveFields } from './PhysioSubjective';
import { cleanSubjective, subjectiveError, subjectiveLines, type Subjective } from '../data/physioSubjective';
import { cleanObjective, objectiveError, objectiveLines, type Objective } from '../data/physioObjective';
import { age, fmtDate, fmtTime } from '../utils/format';
import type { DiagnosisRef } from '../types';

const SUBTABS = ['التقييم (Evaluation)', 'خطة العلاج (Treatment Plan)', 'الأهداف (Goals)', 'ملاحظات التقدّم (Progress Notes)'];
const PLAN_STATUS: Record<string, { label: string; tone: string }> = {
  active: { label: 'نشطة', tone: 'info' }, completed: { label: 'مكتملة', tone: 'ok' }, cancelled: { label: 'ملغاة', tone: 'muted' },
};
const ONSET_LABEL: Record<string, string> = { sudden: 'مفاجئ (Sudden)', gradual: 'تدريجي (Gradual)' };
const UNIT_LABEL: Record<string, string> = { week: 'أسبوع', month: 'شهر' };
const today = () => new Date().toLocaleDateString('en-CA', { timeZone: 'Africa/Cairo' });
const isYmd = (s: string) => /^\d{4}-\d{2}-\d{2}$/.test(s) && !Number.isNaN(new Date(s + 'T00:00:00').getTime());

function TextArea({ id, label, value, onChange, rows = 2, error }: { id: string; label: string; value: string; onChange: (v: string) => void; rows?: number; error?: string }) {
  return (
    <div className={`field ${error ? 'field--invalid' : ''}`}>
      <label htmlFor={id}>{label}</label>
      <textarea id={id} className="input" rows={rows} value={value} onChange={(e) => onChange(e.target.value)} />
      {error && <div className="field__err">{error}</div>}
    </div>
  );
}

/** اختيار متعدد بشكل شرائح — مع إضافة قيمة مخصصة اختياريًا */
function MultiSelect({ label, options, value, onChange, allowCustom }: {
  label: string; options: ReadonlyArray<{ value: string; label: string }>; value: string[]; onChange: (v: string[]) => void; allowCustom?: boolean;
}) {
  const [custom, setCustom] = useState('');
  const toggle = (v: string) => onChange(value.includes(v) ? value.filter((x) => x !== v) : [...value, v]);
  const extras = value.filter((v) => !options.some((o) => o.value === v));
  const add = () => { const v = custom.trim(); if (v && !value.includes(v)) onChange([...value, v]); setCustom(''); };
  return (
    <div className="field">
      <label>{label}</label>
      <div className="pt-chips" role="group" aria-label={label}>
        {options.map((o) => (
          <button type="button" key={o.value} className={`pt-chip ${value.includes(o.value) ? 'active' : ''}`} aria-pressed={value.includes(o.value)} onClick={() => toggle(o.value)} dir="ltr">{o.label}</button>
        ))}
        {extras.map((v) => <button type="button" key={v} className="pt-chip active" aria-pressed onClick={() => toggle(v)} title="إزالة">{v} ✕</button>)}
      </div>
      {allowCustom && (
        <div className="pt-custom">
          <input className="input" placeholder="هدف مخصص (Custom goal)" value={custom} onChange={(e) => setCustom(e.target.value)} onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); add(); } }} />
          <Button size="sm" variant="outline" onClick={add} disabled={!custom.trim()}>إضافة</Button>
        </div>
      )}
    </div>
  );
}

function PainScale({ id, value, onChange, error }: { id: string; value: number | null; onChange: (v: number) => void; error?: string }) {
  return (
    <div className={`field ${error ? 'field--invalid' : ''}`}>
      <label htmlFor={id}>مقياس الألم (VAS) 0–10 *</label>
      <div className="pt-vas" role="radiogroup" id={id} aria-label="مقياس الألم">
        {Array.from({ length: 11 }, (_, i) => (
          <button type="button" key={i} role="radio" aria-checked={value === i} className={`pt-vas__n ${value === i ? 'active' : ''}`} data-level={i >= 7 ? 'high' : i >= 4 ? 'mid' : 'low'} onClick={() => onChange(i)}>{i}</button>
        ))}
      </div>
      {error && <div className="field__err">{error}</div>}
    </div>
  );
}

const goalOptions = GOALS.map((g) => ({ value: g, label: g }));

// ================= نموذج التقييم (مع الخطة والأهداف) =================
type EvalForm = Omit<EvaluationInput, 'patientId'>;
export type PlanForm = Omit<PlanInput, 'evaluationId'>;

function emptyPlan(): PlanForm {
  return { packageId: null, treatmentPlanId: null, ptFrequency: '', totalSessions: 6, durationValue: 2, durationUnit: 'week', sessionsPerWeek: 3, startDate: today(), followUpDate: null, reevaluationDate: null, shortGoals: [], longGoals: [], notes: '' };
}
function planToForm(p: PhysioPlan): PlanForm {
  return { id: p.id, packageId: p.packageId, treatmentPlanId: p.treatmentPlanId, ptFrequency: p.ptFrequency, totalSessions: p.totalSessions, durationValue: p.durationValue, durationUnit: p.durationUnit, sessionsPerWeek: p.sessionsPerWeek, startDate: p.startDate, followUpDate: p.followUpDate, reevaluationDate: p.reevaluationDate, shortGoals: p.shortGoals, longGoals: p.longGoals, notes: p.notes, status: p.status };
}

function validatePlan(p: PlanForm, done = 0): Record<string, string> {
  const e: Record<string, string> = {};
  if (!Number.isInteger(p.totalSessions) || p.totalSessions < 1 || p.totalSessions > 100) e.totalSessions = 'عدد الجلسات من 1 إلى 100';
  else if (p.totalSessions < done) e.totalSessions = `مسجّل بالفعل ${done} جلسة — ما يمكن التقليل عنها`;
  if (p.sessionsPerWeek != null && (p.sessionsPerWeek < 1 || p.sessionsPerWeek > 7)) e.sessionsPerWeek = 'من 1 إلى 7';
  if (p.durationValue != null && (p.durationValue < 1 || p.durationValue > 52)) e.durationValue = 'من 1 إلى 52';
  if (!isYmd(p.startDate)) e.startDate = 'تاريخ غير صحيح';
  if (p.reevaluationDate && !isYmd(p.reevaluationDate)) e.reevaluationDate = 'تاريخ غير صحيح';
  else if (p.reevaluationDate && p.reevaluationDate < p.startDate) e.reevaluationDate = 'لازم يكون بعد بداية الخطة';
  if (p.followUpDate && !isYmd(p.followUpDate)) e.followUpDate = 'تاريخ غير صحيح';
  else if (p.followUpDate && p.followUpDate < p.startDate) e.followUpDate = 'لازم يكون بعد بداية الخطة';
  return e;
}

function PlanFields({ patientId, f, set, errors }: { patientId: string; f: PlanForm; set: <K extends keyof PlanForm>(k: K, v: PlanForm[K]) => void; errors: Record<string, string> }) {
  const num = (v: string) => (v === '' ? null : Math.trunc(Number(v)));
  return (
    <div className="grid-form">
      <Input id="pp-freq" label="تكرار العلاج (PT Frequency)" placeholder="مثال: 3 sessions/week" value={f.ptFrequency} onChange={(e) => set('ptFrequency', e.target.value)} />
      <Input id="pp-total" label="عدد الجلسات *" type="number" min={1} max={100} value={f.totalSessions} error={errors.totalSessions} onChange={(e) => set('totalSessions', Math.trunc(Number(e.target.value)))} />
      <div className="pt-pair">
        <Input id="pp-dur" label="مدة الخطة" type="number" min={1} max={52} value={f.durationValue ?? ''} error={errors.durationValue} onChange={(e) => set('durationValue', num(e.target.value))} />
        <Select id="pp-unit" label="الوحدة" value={f.durationUnit ?? ''} onChange={(e) => set('durationUnit', (e.target.value || null) as PlanForm['durationUnit'])} options={[{ value: '', label: '—' }, { value: 'week', label: 'أسبوع' }, { value: 'month', label: 'شهر' }]} />
      </div>
      <Input id="pp-spw" label="عدد الجلسات في الأسبوع" type="number" min={1} max={7} value={f.sessionsPerWeek ?? ''} error={errors.sessionsPerWeek} onChange={(e) => set('sessionsPerWeek', num(e.target.value))} />
      <Input id="pp-reeval" label="موعد إعادة التقييم (Re-evaluation)" type="date" value={f.reevaluationDate ?? ''} error={errors.reevaluationDate} onChange={(e) => set('reevaluationDate', e.target.value || null)} />
    </div>
  );
}

function GoalsFields({ f, set }: { f: Pick<PlanForm, 'shortGoals' | 'longGoals'>; set: (k: 'shortGoals' | 'longGoals', v: string[]) => void }) {
  return (
    <>
      <MultiSelect label="أهداف قصيرة المدى (Short Term Goals)" options={goalOptions} value={f.shortGoals} onChange={(v) => set('shortGoals', v)} allowCustom />
      <MultiSelect label="أهداف طويلة المدى (Long Term Goals)" options={goalOptions} value={f.longGoals} onChange={(v) => set('longGoals', v)} allowCustom />
    </>
  );
}

// ================= التقييم جوه نموذج «إنشاء خطة علاج جديدة» (نفس الصفحة) =================
// العمر والشكوى والتشخيص وعدد الجلسات بتيجي من حقول الخطة نفسها — هنا باقي التقييم بس.
export interface PhysioInline {
  painVas: number | null; painLocation: string; onset: EvalForm['onset']; duration: string; painCharacter: string[];
  aggravatingFactors: string; relievingFactors: string; medicalHistory: string; medications: string;
  observation: string; palpation: string; rom: string; muscleAssessment: string; sensationSuperficial: string; sensationDeep: string;
  reflexes: string; specialTests: string; gait: string; objective: Objective; subjective: Subjective; redFlags: boolean | null; redFlagsNotes: string;
  reevaluationDate: string; followUpDate: string; shortGoals: string[]; longGoals: string[];
}
export const newPhysioInline = (): PhysioInline => ({
  painVas: null, painLocation: '', onset: null, duration: '', painCharacter: [], aggravatingFactors: '', relievingFactors: '', medicalHistory: '', medications: '',
  observation: '', palpation: '', rom: '', muscleAssessment: '', sensationSuperficial: '', sensationDeep: '', reflexes: '', specialTests: '', gait: '', objective: {}, subjective: {},
  redFlags: null, redFlagsNotes: '', reevaluationDate: '', followUpDate: '', shortGoals: [], longGoals: [],
});
export function validatePhysioInline(v: PhysioInline, startDate: string): Record<string, string> {
  const e: Record<string, string> = {};
  if (v.painVas == null) e.painVas = 'اختر مستوى الألم من 0 إلى 10';
  if (v.redFlags == null) e.redFlags = 'حدّد نعم أو لا';
  const oe = objectiveError(v.objective); if (oe) e.objective = oe;
  const se = subjectiveError(v.subjective); if (se) e.subjective = se;
  if (v.reevaluationDate && (!isYmd(v.reevaluationDate) || v.reevaluationDate < startDate)) e.reevaluationDate = 'لازم يكون بعد بداية الخطة';
  if (v.followUpDate && (!isYmd(v.followUpDate) || v.followUpDate < startDate)) e.followUpDate = 'لازم يكون بعد بداية الخطة';
  return e;
}
/** حفظ التقييم + خطة العلاج الطبيعي مربوطة بالخطة العلاجية اللي اتعملت */
export async function savePhysioInline(v: PhysioInline, ctx: {
  patientId: string; therapistId: string | null; age: number | null; chiefComplaint: string; diagnosis: string; diagnosisConditionId: string | null;
  treatmentPlanId: string | null; totalSessions: number; durationWeeks: number; sessionsPerWeek: number; startDate: string;
}): Promise<{ ok: true } | { ok: false; error: string }> {
  const r1 = await physioApi.saveEvaluation({
    ...v, ...legacyFromSubjective(v.subjective, v), subjective: cleanSubjective(v.subjective), objective: cleanObjective(v.objective), painVas: v.painVas as number, redFlags: v.redFlags as boolean, patientId: ctx.patientId, therapistId: ctx.therapistId, evalDate: today(), age: ctx.age,
    chiefComplaint: ctx.chiefComplaint, diagnosis: ctx.diagnosis, diagnosisConditionId: ctx.diagnosisConditionId,
  });
  if (!r1.ok) return r1;
  const r2 = await physioApi.savePlan({
    evaluationId: r1.id, packageId: null, treatmentPlanId: ctx.treatmentPlanId, ptFrequency: `${ctx.sessionsPerWeek} sessions/week`, totalSessions: ctx.totalSessions,
    durationValue: ctx.durationWeeks, durationUnit: 'week', sessionsPerWeek: ctx.sessionsPerWeek, startDate: ctx.startDate,
    followUpDate: v.followUpDate || null, reevaluationDate: v.reevaluationDate || null, shortGoals: v.shortGoals, longGoals: v.longGoals, notes: '',
  });
  return r2.ok ? { ok: true } : r2;
}
export function PhysioInlineSections({ v, onChange, errors }: { v: PhysioInline; onChange: (v: PhysioInline) => void; errors: Record<string, string> }) {
  const set = <K extends keyof PhysioInline>(k: K, val: PhysioInline[K]) => onChange({ ...v, [k]: val });
  return (
    <>
      <div className="form-section">
        <div className="form-section-title">Subjective</div>
        <PainScale id="pi-vas" value={v.painVas} onChange={(n) => set('painVas', n)} error={errors.painVas} />
        <div className="grid-form">
          <PhysioSubjectiveFields part="top" idp="pi" value={v.subjective} onChange={(x) => set('subjective', x)} />
        </div>
        <PhysioSubjectiveFields part="character" idp="pi" value={v.subjective} onChange={(x) => set('subjective', x)} />
        <div className="grid-form">
          <PhysioSubjectiveFields part="bottom" idp="pi" value={v.subjective} onChange={(x) => set('subjective', x)} />
        </div>
        {errors.subjective && <div className="pt-alert pt-alert--danger" role="alert" style={{ marginTop: 8 }}>{errors.subjective}</div>}
        <div>
        </div>
      </div>
      <div className="form-section">
        <div className="form-section-title">Objective</div>
        {errors.objective && <div className="pt-alert pt-alert--danger" role="alert" style={{ marginBottom: 10 }}>{errors.objective}</div>}
        <PhysioObjectiveFields idp="pi" value={v.objective} onChange={(o) => set('objective', o)} />
      </div>
      <div className="form-section">
        <div className="form-section-title">Assessment</div>
        <div className="grid-form">
          <Select id="pi-rf" label="علامات الخطر (Red Flags) *" error={errors.redFlags} value={v.redFlags === true ? 'yes' : v.redFlags === false ? 'no' : ''}
            onChange={(e) => set('redFlags', e.target.value === '' ? null : e.target.value === 'yes')} options={[{ value: '', label: '— اختر —' }, { value: 'no', label: 'لا (No)' }, { value: 'yes', label: 'نعم (Yes)' }]} />
          <div style={{ gridColumn: '1 / -1' }}><TextArea id="pi-rfn" label="ملاحظات العلامات الخطيرة (Red Flags Notes) — اكتب ما هي العلامات الخطيرة" value={v.redFlagsNotes ?? ''} onChange={(x) => set('redFlagsNotes', x)} /></div>
          <Input id="pi-reeval" label="موعد إعادة التقييم (Re-evaluation)" type="date" value={v.reevaluationDate} error={errors.reevaluationDate} onChange={(e) => set('reevaluationDate', e.target.value)} />
        </div>
      </div>
      <div className="form-section">
        <div className="form-section-title">الأهداف (Goals)</div>
        <MultiSelect label="أهداف قصيرة المدى (Short Term Goals)" options={goalOptions} value={v.shortGoals} onChange={(x) => set('shortGoals', x)} allowCustom />
        <MultiSelect label="أهداف طويلة المدى (Long Term Goals)" options={goalOptions} value={v.longGoals} onChange={(x) => set('longGoals', x)} allowCustom />
      </div>
    </>
  );
}

/** قيم مبدئية لما التقييم يتفتح بعد إنشاء خطة علاج (من نموذج «إنشاء خطة علاج جديدة») */
export interface EvaluationPreset { age?: number | null; chiefComplaint?: string; onset?: string; diagnosis?: string; diagnosisConditionId?: string | null; plan?: Partial<PlanForm> }

export function EvaluationModal({ patientId, evaluation, plan, done = 0, preset, onClose, onSaved = () => {} }: {
  patientId: string; evaluation?: PhysioEvaluation; plan?: PhysioPlan; done?: number; preset?: EvaluationPreset; onClose: () => void; onSaved?: () => void;
}) {
  const toast = useToast();
  const { user } = useAuth();
  const patient = db.patient(patientId)!;
  const [busy, setBusy] = useState(false);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [serverErr, setServerErr] = useState('');
  const [evalId, setEvalId] = useState(evaluation?.id);
  const [dref, setDref] = useState<DiagnosisRef | null>(null);
  const [f, setF] = useState<EvalForm>(() => evaluation ? { ...evaluation } : {
    therapistId: user?.therapistId ?? null, evalDate: today(), age: age(patient.birthDate), chiefComplaint: patient.mainComplaint || '', painVas: null as unknown as number,
    painLocation: '', onset: null, duration: '', painCharacter: [], aggravatingFactors: '', relievingFactors: '', medicalHistory: patient.medicalHistory || '', medications: '',
    observation: '', palpation: '', rom: '', muscleAssessment: '', sensationSuperficial: '', sensationDeep: '', reflexes: '', specialTests: '', gait: '', objective: {}, subjective: {},
    diagnosis: patient.diagnosis || '', diagnosisConditionId: patient.diagnosisRef?.conditionId ?? null, redFlags: null as unknown as boolean, redFlagsNotes: '',
    ...(preset ? {
      age: preset.age ?? age(patient.birthDate), chiefComplaint: preset.chiefComplaint || patient.mainComplaint || '',
      diagnosis: preset.diagnosis || patient.diagnosis || '', diagnosisConditionId: preset.diagnosisConditionId ?? null,
      onset: /تدريج|gradual/i.test(preset.onset ?? '') ? 'gradual' : /مفاجئ|فجأة|sudden/i.test(preset.onset ?? '') ? 'sudden' : null,
      duration: '', aggravatingFactors: '',
    } : {}),
  });
  const [p, setP] = useState<PlanForm>(() => (plan ? planToForm(plan) : { ...emptyPlan(), ...(preset?.plan ?? {}) }));
  const set = <K extends keyof EvalForm>(k: K, v: EvalForm[K]) => setF((x) => ({ ...x, [k]: v }));
  const setPlan = <K extends keyof PlanForm>(k: K, v: PlanForm[K]) => setP((x) => ({ ...x, [k]: v }));
  const therapists = db.therapists();

  const submit = async () => {
    const e: Record<string, string> = {};
    if (!f.chiefComplaint.trim()) e.chiefComplaint = 'الشكوى الرئيسية مطلوبة';
    if (f.painVas == null || f.painVas < 0 || f.painVas > 10) e.painVas = 'اختر مستوى الألم من 0 إلى 10';
    if (!f.diagnosis.trim()) e.diagnosis = 'التشخيص مطلوب';
    if (typeof f.redFlags !== 'boolean') e.redFlags = 'حدّد نعم أو لا';
    if (f.age != null && (f.age < 0 || f.age > 130)) e.age = 'عمر غير صحيح';
    if (!isYmd(f.evalDate) || f.evalDate > today()) e.evalDate = 'تاريخ غير صحيح (ما يكون في المستقبل)';
    const oe = objectiveError(f.objective ?? {}); if (oe) e.objective = oe;
    const se = subjectiveError(f.subjective ?? {}); if (se) e.subjective = se;
    Object.assign(e, validatePlan(p, done));
    setErrors(e); setServerErr('');
    if (Object.keys(e).length) { toast.error('راجع الحقول المظلّلة بالأحمر.'); return; }
    setBusy(true);
    const r1 = await physioApi.saveEvaluation({ ...f, ...legacyFromSubjective(f.subjective ?? {}, f), subjective: cleanSubjective(f.subjective ?? {}), objective: cleanObjective(f.objective ?? {}), id: evalId, patientId, diagnosisConditionId: dref?.conditionId ?? f.diagnosisConditionId });
    if (!r1.ok) { setBusy(false); setServerErr(r1.error); return; }
    setEvalId(r1.id); // لو الخطة فشلت، إعادة الحفظ تعدّل نفس التقييم بدل تكراره
    const r2 = await physioApi.savePlan({ ...p, evaluationId: r1.id });
    setBusy(false);
    if (!r2.ok) { setServerErr(`تم حفظ التقييم، لكن تعذّر حفظ الخطة: ${r2.error}`); onSaved(); return; }
    toast.success(evaluation ? 'تم تعديل التقييم والخطة.' : 'تم تسجيل التقييم وخطة العلاج.');
    onSaved(); onClose();
  };

  return (
    <Modal title={evaluation ? 'تعديل تقييم العلاج الطبيعي' : 'تقييم علاج طبيعي جديد (Physiotherapy Evaluation)'} wide onClose={onClose}
      footer={<><Button variant="outline" onClick={onClose} disabled={busy}>إلغاء</Button><Button onClick={submit} loading={busy}>حفظ</Button></>}>
      {serverErr && <div className="pt-alert pt-alert--danger" role="alert" style={{ marginBottom: 12 }}>{serverErr}</div>}
      <div className="form-section">
        <div className="form-section-title">1. بيانات المريض (Patient Information)</div>
        <div className="grid-form">
          <Input id="pe-name" label="اسم المريض" value={patient.fullName} disabled />
          <Input id="pe-file" label="رقم الملف" value={patient.fileNo} disabled />
          <Input id="pe-age" label="العمر (Age)" type="number" min={0} max={130} value={f.age ?? ''} error={errors.age} onChange={(e) => set('age', e.target.value === '' ? null : Math.trunc(Number(e.target.value)))} />
        </div>
      </div>
      <div className="form-section">
        <div className="form-section-title">2. Subjective</div>
        <div className="grid-form">
          <Input id="pe-cc" label="الشكوى الرئيسية (Chief Complaint) *" value={f.chiefComplaint} error={errors.chiefComplaint} onChange={(e) => set('chiefComplaint', e.target.value)} />
          <PhysioSubjectiveFields part="top" idp="pe" value={f.subjective ?? {}} onChange={(x) => set('subjective', x)} legacy={f} />
        </div>
        <PainScale id="pe-vas" value={f.painVas} onChange={(v) => set('painVas', v)} error={errors.painVas} />
        <PhysioSubjectiveFields part="character" idp="pe" value={f.subjective ?? {}} onChange={(x) => set('subjective', x)} legacy={f} />
        <div className="grid-form">
          <PhysioSubjectiveFields part="bottom" idp="pe" value={f.subjective ?? {}} onChange={(x) => set('subjective', x)} legacy={f} />
        </div>
        {errors.subjective && <div className="pt-alert pt-alert--danger" role="alert" style={{ marginTop: 8 }}>{errors.subjective}</div>}
        <div>
        </div>
      </div>
      <div className="form-section">
        <div className="form-section-title">3. Objective</div>
        {errors.objective && <div className="pt-alert pt-alert--danger" role="alert" style={{ marginBottom: 10 }}>{errors.objective}</div>}
        <PhysioObjectiveFields idp="pe" value={f.objective ?? {}} onChange={(o) => set('objective', o)} legacy={f} />
      </div>
      <div className="form-section">
        <div className="form-section-title">4. Assessment</div>
        <div className="grid-form">
          <div>
            <Input id="pe-dx" label="التشخيص (Diagnosis) *" value={f.diagnosis} onChange={(e) => set('diagnosis', e.target.value)} />
            {errors.diagnosis && <div className="field__err">{errors.diagnosis}</div>}
          </div>
          <Select id="pe-rf" label="علامات الخطر (Red Flags) *" error={errors.redFlags} value={f.redFlags === true ? 'yes' : f.redFlags === false ? 'no' : ''}
            onChange={(e) => set('redFlags', (e.target.value === '' ? null : e.target.value === 'yes') as boolean)} options={[{ value: '', label: '— اختر —' }, { value: 'no', label: 'لا (No)' }, { value: 'yes', label: 'نعم (Yes)' }]} />
          <div style={{ gridColumn: '1 / -1' }}><TextArea id="pe-rfn" label="ملاحظات العلامات الخطيرة (Red Flags Notes) — اكتب ما هي العلامات الخطيرة" value={f.redFlagsNotes ?? ''} onChange={(x) => set('redFlagsNotes', x)} /></div>
        </div>
      </div>
      <div className="form-section">
        <div className="form-section-title">5. خطة العلاج (Treatment Plan)</div>
        <PlanFields patientId={patientId} f={p} set={setPlan} errors={errors} />
      </div>
      <div className="form-section">
        <div className="form-section-title">6. الأهداف (Goals)</div>
        <GoalsFields f={p} set={setPlan} />
      </div>
    </Modal>
  );
}

function PlanModal({ plan, done, onClose, onSaved, goalsOnly }: { plan: PhysioPlan; done: number; onClose: () => void; onSaved: () => void; goalsOnly?: boolean }) {
  const toast = useToast();
  const [p, setP] = useState<PlanForm>(planToForm(plan));
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState(false);
  const [serverErr, setServerErr] = useState('');
  const setPlan = <K extends keyof PlanForm>(k: K, v: PlanForm[K]) => setP((x) => ({ ...x, [k]: v }));
  const submit = async () => {
    setServerErr('');
    if (goalsOnly) {
      setBusy(true);
      const r = await physioApi.setGoals(plan.id, p.shortGoals, p.longGoals);
      setBusy(false);
      if (!r.ok) { setServerErr(r.error); return; }
      toast.success('تم حفظ الأهداف.'); onSaved(); onClose(); return;
    }
    const e = validatePlan(p, done); setErrors(e);
    if (Object.keys(e).length) { toast.error('راجع الحقول المظلّلة بالأحمر.'); return; }
    setBusy(true);
    const r = await physioApi.savePlan({ ...p, evaluationId: plan.evaluationId });
    setBusy(false);
    if (!r.ok) { setServerErr(r.error); return; }
    toast.success('تم تعديل خطة العلاج.'); onSaved(); onClose();
  };
  return (
    <Modal title={goalsOnly ? 'أهداف العلاج (Goals)' : 'تعديل خطة العلاج (Treatment Plan)'} wide onClose={onClose}
      footer={<><Button variant="outline" onClick={onClose} disabled={busy}>إلغاء</Button><Button onClick={submit} loading={busy}>حفظ</Button></>}>
      {serverErr && <div className="pt-alert pt-alert--danger" role="alert" style={{ marginBottom: 12 }}>{serverErr}</div>}
      {goalsOnly ? <GoalsFields f={p} set={setPlan} /> : (
        <>
          <PlanFields patientId={plan.patientId} f={p} set={setPlan} errors={errors} />
          <p className="muted" style={{ fontSize: 12.5 }}>مسجّل للحين {done} جلسة — ما يمكن تقليل عدد الجلسات عن ذلك. زيادة العدد هي الطريقة المعتمدة لإضافة جلسات بعد انتهاء الباقة.</p>
        </>
      )}
    </Modal>
  );
}

// ================= ملاحظة التقدّم =================
function NoteModal({ plan, evaluation, note, nextNo, onClose, onSaved }: {
  plan: PhysioPlan; evaluation?: PhysioEvaluation; note?: ProgressNote; nextNo: number; onClose: () => void; onSaved: () => void;
}) {
  const toast = useToast();
  const { user } = useAuth();
  const defaultPt = (user?.therapistId && db.therapist(user.therapistId)?.name) || user?.name || '';
  const [f, setF] = useState<NoteInput>(() => note ? { ...note } : {
    planId: plan.id, sessionDate: today(), treatmentSessionId: null, diagnosis: evaluation?.diagnosis ?? '', painVas: null as unknown as number,
    electrotherapy: [], manualTherapy: '', positioning: '', therapeuticExercise: '', ptName: defaultPt, therapistId: user?.therapistId ?? null,
  });
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState(false);
  const [serverErr, setServerErr] = useState('');
  const set = <K extends keyof NoteInput>(k: K, v: NoteInput[K]) => setF((x) => ({ ...x, [k]: v }));
  const sessions = db.sessionsForPatient(plan.patientId);
  const sessionNo = note?.sessionNo ?? nextNo;

  const submit = async () => {
    const e: Record<string, string> = {};
    if (f.painVas == null || f.painVas < 0 || f.painVas > 10) e.painVas = 'اختر مستوى الألم من 0 إلى 10';
    if (!f.ptName.trim()) e.ptName = 'اسم الأخصائي مطلوب';
    if (!isYmd(f.sessionDate) || f.sessionDate > today()) e.sessionDate = 'تاريخ غير صحيح (ما يكون في المستقبل)';
    else if (f.sessionDate < plan.startDate) e.sessionDate = 'قبل بداية الخطة';
    setErrors(e); setServerErr('');
    if (Object.keys(e).length) { toast.error('راجع الحقول المظلّلة بالأحمر.'); return; }
    setBusy(true);
    const r = await physioApi.saveNote({ ...f, id: note?.id, sessionNo: note ? undefined : sessionNo });
    setBusy(false);
    if (!r.ok) { setServerErr(r.error); return; }
    toast.success(note ? 'تم تعديل ملاحظة التقدّم.' : `تم تسجيل الجلسة ${r.tracking.sessionNo}/${r.tracking.total} — المتبقي ${r.tracking.remaining}.`);
    onSaved(); onClose();
  };
  return (
    <Modal title={`ملاحظة تقدّم (Progress Note) — الجلسة ${sessionNo}/${plan.totalSessions}`} wide onClose={onClose}
      footer={<><Button variant="outline" onClick={onClose} disabled={busy}>إلغاء</Button><Button onClick={submit} loading={busy}>حفظ</Button></>}>
      {serverErr && <div className="pt-alert pt-alert--danger" role="alert" style={{ marginBottom: 12 }}>{serverErr}</div>}
      <div className="form-section">
        <div className="form-section-title">1. بيانات الجلسة (Session Information)</div>
        <div className="grid-form">
          <Input id="pn-no" label="رقم الجلسة (Number of PT Session)" value={`${sessionNo} / ${plan.totalSessions}`} disabled />
        </div>
      </div>
      <div className="form-section">
        <div className="form-section-title">2. مقياس الألم (Pain Scale)</div>
        <PainScale id="pn-vas" value={f.painVas} onChange={(v) => set('painVas', v)} error={errors.painVas} />
      </div>
      <div className="form-section">
        <div className="form-section-title">3. التشخيص (Diagnosis)</div>
        <Input id="pn-dx" label="التشخيص" dir="ltr" value={f.diagnosis} onChange={(e) => set('diagnosis', e.target.value)} />
      </div>
      <div className="form-section">
        <div className="form-section-title">4. العلاج الكهربائي (Electrotherapy)</div>
        <MultiSelect label="PT Given — Electrotherapy" options={ELECTROTHERAPY} value={f.electrotherapy} onChange={(v) => set('electrotherapy', v)} />
      </div>
      <div className="form-section">
        <div className="form-section-title">5. العلاج اليدوي (Manual Therapy)</div>
        <TextArea id="pn-mt" label="Manual Therapy" value={f.manualTherapy} onChange={(v) => set('manualTherapy', v)} />
      </div>
      <div className="form-section">
        <div className="form-section-title">6. الوضعية (Positioning)</div>
        <TextArea id="pn-pos" label="Positioning" value={f.positioning} onChange={(v) => set('positioning', v)} />
      </div>
      <div className="form-section">
        <div className="form-section-title">7. التمارين العلاجية (Therapeutic Exercise)</div>
        <TextArea id="pn-ex" label="Therapeutic Exercise" rows={3} value={f.therapeuticExercise} onChange={(v) => set('therapeuticExercise', v)} />
      </div>
      <div className="form-section">
        <div className="form-section-title">8. اسم الأخصائي (PT Name)</div>
        <Input id="pn-pt" label="PT Name *" value={f.ptName} error={errors.ptName} onChange={(e) => set('ptName', e.target.value)} />
      </div>
    </Modal>
  );
}

// ================= تفاصيل العلاج الطبيعي داخل نافذة «الخطة العلاجية» =================
export function PhysioPlanDetails({ treatmentPlanId }: { treatmentPlanId: string }) {
  const can = useCan();
  const allowed = can('physio', 'view');
  const [d, setD] = useState<{ plan: PhysioPlan | null; evaluation: PhysioEvaluation | null; notes: ProgressNote[] } | null | 'err'>(null);
  useEffect(() => { if (allowed) physioApi.forTreatmentPlan(treatmentPlanId).then((r) => setD(r.ok ? r : 'err')); }, [treatmentPlanId, allowed]);
  if (!allowed) return null;
  if (d === null) return <Skeleton h={60} />;
  if (d === 'err') return <p className="muted" style={{ fontSize: 13 }}>تعذّر تحميل تقييم العلاج الطبيعي.</p>;
  const e = d.evaluation, p = d.plan;
  if (!e || !p) return <p className="muted" style={{ fontSize: 13 }}>ما فيه تقييم علاج طبيعي مرتبط بهذه الخطة.</p>;
  const tr = planTracking(p, d.notes);
  return (
    <div className="pt-details">
      <div className="pt-box"><h4>Subjective</h4>
        <Kv k="Pain Scale (VAS)" v={`${e.painVas} / 10`} />
        <SubjectiveView e={e} />
      </div>
      <div className="pt-box"><h4>Objective</h4>
        <ObjectiveView e={e} />
      </div>
      <div className="pt-box"><h4>Assessment</h4>
        <Kv k="Diagnosis" v={e.diagnosis} ltr />
        <Kv k="Red Flags" v={e.redFlags ? 'Yes' : 'No'} />
        {e.redFlagsNotes ? <Kv k="Red Flags Notes" v={e.redFlagsNotes} /> : null}
        <Kv k="Re-evaluation Date" v={p.reevaluationDate ? fmtDate(p.reevaluationDate) : ''} />
        <Kv k="الجلسات" v={`${tr.completed} / ${tr.total} — المتبقية ${tr.remaining}`} />
      </div>
      <div className="pt-box"><h4>الأهداف (Goals)</h4>
        <div className="muted-sm">Short Term</div>
        {p.shortGoals.length ? <ul className="pt-goals" dir="auto">{p.shortGoals.map((g) => <li key={g}>{g}</li>)}</ul> : <p className="muted">—</p>}
        <div className="muted-sm">Long Term</div>
        {p.longGoals.length ? <ul className="pt-goals" dir="auto">{p.longGoals.map((g) => <li key={g}>{g}</li>)}</ul> : <p className="muted">—</p>}
      </div>
    </div>
  );
}

// ================= التبويب =================
/** النصوص القديمة (قبل الاختيارات المنظّمة) — بتتعرض بس لو فيها كلام */
function legacyObjective(e: { observation: string; palpation: string; rom: string; muscleAssessment: string; sensationSuperficial: string; sensationDeep: string; reflexes: string; specialTests: string; gait: string }): Array<[string, string]> {
  return ([['General Observation', e.observation], ['Palpation', e.palpation], ['ROM', e.rom], ['Muscle Assessment', e.muscleAssessment], ['Sensation — Superficial', e.sensationSuperficial],
    ['Sensation — Deep', e.sensationDeep], ['Reflexes', e.reflexes], ['Special Tests', e.specialTests], ['Gait', e.gait]] as Array<[string, string]>).filter(([, v]) => (v ?? '').trim());
}
/** الأعمدة القديمة اللي لسه الخادم والطباعة بيقروها: Onset (مفاجئ/تدريجي) وطبيعة الألم (القايمة القديمة) — بنحدّثهم من الاختيار الجديد لو اتغيّر */
function legacyFromSubjective(s: Subjective, cur: { onset: EvalForm['onset']; painCharacter: string[] }): { onset: EvalForm['onset']; painCharacter: string[] } {
  const on = s.onset?.items[0];
  const OLD = ['dull', 'aching', 'numbness', 'burning', 'stabbing', 'tingling', 'itchy'];
  return {
    onset: on ? (on === 'sudden' || on === 'gradual' ? on : null) : cur.onset,
    painCharacter: s.character ? s.character.items.map((c) => (c === 'itching' ? 'itchy' : c)).filter((c) => OLD.includes(c)) : cur.painCharacter,
  };
}
/** الألم والأعراض: الاختيارات المنظّمة + أي نص قديم لسه موجود */
function SubjectiveView({ e }: { e: PhysioEvaluation }) {
  const rows = subjectiveLines(e.subjective ?? {});
  const has = (k: string) => rows.some(([n]) => n === k);
  const old: Array<[string, string]> = ([
    ['Location of Pain', e.painLocation], ['Onset', e.onset ? ONSET_LABEL[e.onset] : ''], ['Duration', e.duration],
    ['Character of Pain', e.painCharacter.map((c) => labelOf(PAIN_CHARACTERS, c)).join(', ')], ['Aggravating Factors', e.aggravatingFactors],
    ['Relieving Factors', e.relievingFactors], ['Medical/Surgical History', e.medicalHistory], ['Medications', e.medications],
  ] as Array<[string, string]>).filter(([k, v]) => (v ?? '').trim() && !has(k));
  return <>{rows.map(([k, v]) => <Kv key={k} k={k} v={v} ltr />)}{old.map(([k, v]) => <Kv key={'o-' + k} k={k} v={v} />)}</>;
}
function ObjectiveView({ e }: { e: PhysioEvaluation }) {
  const rows = objectiveLines(e.objective ?? {});
  const old = legacyObjective(e);
  if (!rows.length && !old.length) return <Kv k="Objective" v="" />;
  return <>{rows.map(([k, v]) => <Kv key={k} k={k} v={v} ltr />)}{old.map(([k, v]) => <Kv key={'old-' + k} k={`${k} (قديم)`} v={v} />)}</>;
}

const Kv = ({ k, v, ltr }: { k: string; v: React.ReactNode; ltr?: boolean }) => <div className="kv-row"><span>{k}</span><span dir={ltr ? 'ltr' : undefined} style={{ whiteSpace: 'pre-wrap' }}>{v === '' || v == null ? '—' : v}</span></div>;

export default function PhysioTab({ patientId }: { patientId: string }) {
  const can = useCan();
  const toast = useToast();
  const [data, setData] = useState<PhysioData | null>(null);
  const [error, setError] = useState('');
  const [sub, setSub] = useState(0);
  const [modal, setModal] = useState<null | { kind: 'eval'; evaluation?: PhysioEvaluation } | { kind: 'plan' | 'goals'; plan: PhysioPlan } | { kind: 'note'; plan: PhysioPlan; note?: ProgressNote }>(null);
  const [del, setDel] = useState<ProgressNote | null>(null);
  const [planSel, setPlanSel] = useState<string>('');

  const load = useCallback(async () => {
    setError('');
    const r = await physioApi.forPatient(patientId);
    if (r.ok) setData(r.data); else setError(r.error);
  }, [patientId]);
  useEffect(() => { setData(null); load(); }, [load]);

  const plan = useMemo(() => {
    if (!data) return undefined;
    return data.plans.find((p) => p.id === planSel) ?? data.plans.find((p) => p.status === 'active') ?? data.plans[0];
  }, [data, planSel]);
  if (error) return <><ErrorState onRetry={load} /><p className="muted" style={{ textAlign: 'center', fontSize: 12.5 }}>{error}</p></>;
  if (!data) return <div style={{ display: 'grid', gap: 12 }}><Skeleton h={88} /><Skeleton h={40} /><Skeleton h={160} /></div>;

  const evaluation = plan ? data.evaluations.find((e) => e.id === plan.evaluationId) : data.evaluations[0];
  const tr = plan ? planTracking(plan, data.notes) : null;
  const planNotes = plan ? data.notes.filter((n) => n.planId === plan.id) : [];
  const lastNote = planNotes[planNotes.length - 1];
  const pkg = plan?.packageId ? db.packagesForPatient(patientId).find((p) => p.id === plan.packageId) : undefined;
  const nextAppt = db.appointmentsForPatient(patientId)
    .filter((a) => a.date >= today() && !['cancelled', 'completed', 'no_show', 'rescheduled'].includes(a.status))
    .sort((a, b) => (a.date + a.time).localeCompare(b.date + b.time))[0];
  const reevalDue = plan?.reevaluationDate && plan.reevaluationDate <= today();
  const canAddNote = !!plan && can('physio', 'create') && plan.status !== 'cancelled' && (tr?.remaining ?? 0) > 0;
  const noEval = data.evaluations.length === 0;

  return (
    <div className="physio">
      {/* لوحة مختصرة */}
      <div className="stats-grid physio-stats">
        <StatCard icon="stethoscope" tone="brand" value={evaluation?.diagnosis || '—'} label="التشخيص (Diagnosis)" />
        <StatCard icon="alert" tone={((lastNote?.painVas ?? evaluation?.painVas ?? 0) >= 7) ? 'danger' : 'warn'} value={lastNote?.painVas ?? evaluation?.painVas ?? '—'} label="مستوى الألم الحالي /10" />
        <StatCard icon="box" tone="info" value={tr ? `${tr.total} جلسات` : '—'} label="الباقة (Package)" />
        <StatCard icon="refresh" tone={reevalDue ? 'danger' : 'info'} value={plan?.reevaluationDate ? fmtDate(plan.reevaluationDate) : '—'} label={reevalDue ? 'إعادة التقييم مستحقة' : 'موعد إعادة التقييم'} />
      </div>

      <div className="row-between" style={{ marginBottom: 12, gap: 8, flexWrap: 'wrap' }}>
        {data.plans.length > 1 ? (
          <div style={{ minWidth: 240 }}><Select id="pt-plan-sel" label="الخطة المعروضة" value={plan?.id ?? ''} onChange={(e) => setPlanSel(e.target.value)}
            options={data.plans.map((p) => ({ value: p.id, label: `${fmtDate(p.startDate)} — ${p.totalSessions} جلسات — ${PLAN_STATUS[p.status].label}` }))} /></div>
        ) : <span className="muted" style={{ fontSize: 13 }}>{data.evaluations.length} تقييم · {data.plans.length} خطة · {data.notes.length} ملاحظة تقدّم</span>}
        <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
          {can('physio', 'create') && <Button size="sm" variant={noEval ? 'primary' : 'outline'} icon="stethoscope" onClick={() => setModal({ kind: 'eval' })}>{noEval ? 'تقييم جديد' : 'إعادة تقييم (Re-evaluation)'}</Button>}
          {plan && can('physio', 'create') && (
            <Button size="sm" icon="clipboard" disabled={!canAddNote} onClick={() => setModal({ kind: 'note', plan })}
              title={tr && tr.remaining === 0 ? 'انتهت جلسات الخطة — عدّل الخطة لزيادة عدد الجلسات' : undefined}>
              {tr?.nextSessionNo ? `تسجيل الجلسة ${tr.nextSessionNo}/${tr.total}` : 'تسجيل جلسة'}
            </Button>
          )}
        </div>
      </div>
      {plan && tr && tr.remaining === 0 && plan.status !== 'cancelled' && (
        <div className="pt-alert pt-alert--warn" role="status" style={{ marginBottom: 12 }}>
          اكتملت جلسات الخطة ({tr.total}/{tr.total}). ما يمكن تسجيل جلسة إضافية إلا بزيادة عدد الجلسات من «تعديل الخطة»{can('physio', 'edit') ? '' : ' (يتطلب صلاحية تعديل)'}، أو بإعادة تقييم وإنشاء خطة جديدة.
        </div>
      )}

      <div className="tabs tabs--sub" style={{ overflowX: 'auto' }}>{SUBTABS.map((t, i) => <button key={t} className={`tab ${sub === i ? 'active' : ''}`} onClick={() => setSub(i)}>{t}</button>)}</div>
      <div style={{ paddingTop: 14 }}>
        {noEval ? (
          <EmptyState icon="stethoscope" title="ما فيه تقييم علاج طبيعي" text="ابدأ بتقييم أولي — يتضمن الخطة والأهداف، وبعدها تُسجَّل ملاحظة تقدّم لكل جلسة."
            action={can('physio', 'create') ? <Button icon="stethoscope" onClick={() => setModal({ kind: 'eval' })}>تقييم جديد</Button> : undefined} />
        ) : (
          <>
            {sub === 0 && data.evaluations.map((e) => (
              <div key={e.id} className="item-card">
                <div className="row-between" style={{ marginBottom: 8, gap: 8, flexWrap: 'wrap' }}>
                  <strong dir="auto">{e.diagnosis}</strong>
                  <div style={{ display: 'flex', gap: 6, alignItems: 'center' }}>
                    {e.redFlags ? <StatusBadge label="Red Flags: Yes" tone="danger" /> : <StatusBadge label="Red Flags: No" tone="ok" />}
                    {can('physio', 'edit') && <IconAction icon="edit" label="تعديل التقييم" onClick={() => setModal({ kind: 'eval', evaluation: e })} />}
                  </div>
                </div>
                <div className="section-title">Subjective</div>
                <Kv k="العمر (Age)" v={e.age} />
                <Kv k="Chief Complaint" v={e.chiefComplaint} />
                <Kv k="Pain Scale (VAS)" v={`${e.painVas} / 10`} />
                <SubjectiveView e={e} />
                <div className="section-title">Objective</div>
                <ObjectiveView e={e} />
                <div className="section-title">Assessment</div>
                <Kv k="Diagnosis" v={e.diagnosis} ltr />
                <Kv k="Red Flags" v={e.redFlags ? 'Yes' : 'No'} />
        {e.redFlagsNotes ? <Kv k="Red Flags Notes" v={e.redFlagsNotes} /> : null}
                <p className="muted" style={{ fontSize: 12, marginTop: 8 }}>أُنشئ {fmtDate(e.createdAt.slice(0, 10))} بواسطة {db.employeeById(e.createdBy ?? '')?.name ?? '—'}{e.updatedAt !== e.createdAt ? ` · آخر تعديل ${fmtDate(e.updatedAt.slice(0, 10))} بواسطة ${db.employeeById(e.updatedBy ?? '')?.name ?? '—'}` : ''}</p>
              </div>
            ))}

            {sub === 1 && (!plan ? <EmptyState icon="target" title="ما فيه خطة علاج" text="عدّل التقييم وأضف الخطة." /> : (
              <div className="item-card">
                <div className="row-between" style={{ marginBottom: 8 }}>
                  <strong>خطة العلاج (Treatment Plan)</strong>
                  <div style={{ display: 'flex', gap: 6, alignItems: 'center' }}>
                    {can('physio', 'edit') && <IconAction icon="edit" label="تعديل الخطة" onClick={() => setModal({ kind: 'plan', plan })} />}
                  </div>
                </div>
                <Kv k="PT Frequency" v={plan.ptFrequency} />
                <Kv k="عدد الجلسات" v={plan.totalSessions} />
                <Kv k="مدة الخطة" v={plan.durationValue ? `${plan.durationValue} ${UNIT_LABEL[plan.durationUnit ?? 'week']}` : ''} />
                <Kv k="جلسات في الأسبوع" v={plan.sessionsPerWeek ? `${plan.sessionsPerWeek} sessions/week` : ''} />
                <Kv k="Re-evaluation Date" v={plan.reevaluationDate ? fmtDate(plan.reevaluationDate) : ''} />
              </div>
            ))}

            {sub === 2 && (!plan ? <EmptyState icon="target" title="ما فيه خطة" /> : (
              <div className="item-card">
                <div className="row-between" style={{ marginBottom: 8 }}>
                  <strong>الأهداف (Goals)</strong>
                  {can('physio', 'edit') && <Button size="sm" variant="outline" icon="edit" onClick={() => setModal({ kind: 'goals', plan })}>تعديل الأهداف</Button>}
                </div>
                <div className="section-title">Short Term Goals</div>
                {plan.shortGoals.length ? <ul className="pt-goals" dir="auto">{plan.shortGoals.map((g) => <li key={g}>{g}</li>)}</ul> : <p className="muted">ما فيه أهداف.</p>}
                <div className="section-title">Long Term Goals</div>
                {plan.longGoals.length ? <ul className="pt-goals" dir="auto">{plan.longGoals.map((g) => <li key={g}>{g}</li>)}</ul> : <p className="muted">ما فيه أهداف.</p>}
              </div>
            ))}

            {sub === 3 && (planNotes.length === 0 ? <EmptyState icon="clipboard" title="ما فيه ملاحظات تقدّم" text={plan ? 'سجّل أول جلسة من زر «تسجيل الجلسة».' : undefined} /> : [...planNotes].reverse().map((n) => (
              <div key={n.id} className="item-card">
                <div className="row-between" style={{ marginBottom: 8, gap: 8, flexWrap: 'wrap' }}>
                  <strong>الجلسة {n.sessionNo}/{plan!.totalSessions}</strong>
                  <RowActions>
                    {can('physio', 'edit') && <IconAction icon="edit" label="تعديل الملاحظة" onClick={() => setModal({ kind: 'note', plan: plan!, note: n })} />}
                    {can('physio', 'delete') && n.sessionNo === planNotes.length && <IconAction icon="trash" label="حذف الملاحظة" danger onClick={() => setDel(n)} />}
                  </RowActions>
                </div>
                <Kv k="Diagnosis" v={n.diagnosis} ltr />
                <Kv k="Pain Scale" v={`${n.painVas} / 10`} />
                <Kv k="Electrotherapy" v={n.electrotherapy.map((x) => labelOf(ELECTROTHERAPY, x)).join(', ')} ltr />
                <Kv k="Manual Therapy" v={n.manualTherapy} />
                <Kv k="Positioning" v={n.positioning} />
                <Kv k="Therapeutic Exercise" v={n.therapeuticExercise} />
                <Kv k="PT Name" v={n.ptName} />
              </div>
            )))}
          </>
        )}
      </div>

      {modal?.kind === 'eval' && <EvaluationModal patientId={patientId} evaluation={modal.evaluation}
        plan={modal.evaluation ? data.plans.find((p) => p.evaluationId === modal.evaluation!.id) : undefined}
        done={modal.evaluation ? data.notes.filter((n) => n.planId === data.plans.find((p) => p.evaluationId === modal.evaluation!.id)?.id).length : 0}
        onClose={() => setModal(null)} onSaved={() => { setPlanSel(''); load(); }} />}
      {(modal?.kind === 'plan' || modal?.kind === 'goals') && <PlanModal plan={modal.plan} goalsOnly={modal.kind === 'goals'} done={data.notes.filter((n) => n.planId === modal.plan.id).length} onClose={() => setModal(null)} onSaved={load} />}
      {modal?.kind === 'note' && <NoteModal plan={modal.plan} evaluation={data.evaluations.find((e) => e.id === modal.plan.evaluationId)} note={modal.note}
        nextNo={planTracking(modal.plan, data.notes).nextSessionNo ?? modal.plan.totalSessions + 1} onClose={() => setModal(null)} onSaved={load} />}
      {del && <ConfirmDialog title="حذف ملاحظة التقدّم" message={`سيتم حذف ملاحظة الجلسة ${del.sessionNo} نهائيًا (آخر جلسة فقط يمكن حذفها للحفاظ على التسلسل).`}
        onConfirm={async () => { const r = await physioApi.deleteNote(del.id); if (r.ok) { toast.success('تم حذف الملاحظة.'); load(); } else toast.error(r.error); }} onClose={() => setDel(null)} />}
    </div>
  );
}
