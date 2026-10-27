import { isArabicName, patientGaps } from '../utils/patientGaps';
import { useRef, useState } from 'react';
import { db } from '../data/db';
import { Modal, Button, Input, Select } from './ui';
import { PhoneInput } from './PhoneInput';
import { phoneErrorMessage, phoneMatches, normalizeSearch, type PhoneErrorCode } from '../utils/phoneUtils';
import { Icon } from '../utils/icons';
import { useToast } from '../hooks/useToast';
import { DiagnosisField } from './DiagnosisPicker';
import { PatientFilesTab } from './PatientExtras';
import { useCan } from './common';
import { LinkedFiles } from './DetailsHost';
import { PhysioInlineSections, newPhysioInline, savePhysioInline, validatePhysioInline, type PhysioInline } from './PhysioTab';
import { useAuth } from '../services/auth';
import { TextPick } from './TextPick';
import PlanSessionBooking, { SessionRowsEditor, bookDraftSessions, defaultPlanDoctor, emptyRow, sessionRowIssues, suggestSessionRows, type SessionRow } from './PlanSessionBooking';
import { EMAIL_RE, NID_RE, PASSPORT_RE, REFERRAL_SOURCE_LABEL, toLatinDigits, WEEKDAY_LABEL, addDaysYmd, fmtDate, fmtTime, money, planScheduleError, planScheduleFor, planTotalSessions, sessionsLabel, todayYmd, wordCount } from '../utils/format';
import type { InitialAssessment, Patient, PlanStatus, ReferralSource, TreatmentPlan } from '../types';

function TextArea({ id, label, value, onChange, rows = 2, placeholder }: { id: string; label: string; value: string; onChange: (v: string) => void; rows?: number; placeholder?: string }) {
  return <div className="field"><label htmlFor={id}>{label}</label><textarea id={id} className="input" rows={rows} placeholder={placeholder} value={value} onChange={(e) => onChange(e.target.value)} /></div>;
}

const footer = (onClose: () => void, submit: () => void, busy: boolean, label = 'حفظ') => (
  <><Button variant="outline" onClick={onClose} disabled={busy}>إلغاء</Button><Button onClick={submit} loading={busy}>{label}</Button></>
);

// اختيارات «بيانات الحالة» في خطة العلاج — بتتحفظ كنص في نفس الخانات (painOnset / chiefComplaint)
const opt = (xs: string[]) => [...xs.map((x) => ({ value: x, label: x })), { value: 'other', label: 'أخرى (Other)' }];
const GOAL_OPTS = opt(['تقليل الألم (Decrease Pain)', 'تحسين مدى الحركة (Improve ROM)', 'تقوية العضلات (Improve Strength)', 'تحسين التوازن (Improve Balance)', 'تقليل التورّم/الالتهاب (Decrease Swelling)',
  'تحسين المشي (Improve Gait)', 'تصحيح القوام (Correct Posture)', 'تقليل الشد العضلي (Decrease Spasm)', 'العودة للأنشطة اليومية (Return to Daily Activities)', 'العودة للرياضة (Return to Sport)',
  'التأهيل بعد العملية (Post-operative Rehabilitation)', 'تحسين جودة الحياة (Improve Quality of Life)']);
const PAIN_ONSET_OPTS = opt(['مفاجئ (Sudden)', 'تدريجي (Gradual)', 'بعد إصابة/حادثة (Traumatic)', 'بعد سقوط (Fall)', 'بعد رفع شيء ثقيل (Lifting)', 'بعد عملية (Post-operative)', 'بعد مجهود رياضي (Sports)',
  'دون سبب واضح (Insidious)', 'متكرر (Recurrent)', 'نوبة لحالة مزمنة (Flare-up)', 'غير معروف (Unknown)']);
const COMPLAINT_OPTS = opt(['ألم (Pain)', 'تيبّس (Stiffness)', 'ضعف عضلي (Weakness)', 'تنميل/وخز (Numbness / Tingling)', 'تورّم (Swelling)', 'محدودية الحركة (Limited Movement)',
  'صعوبة في المشي (Difficulty Walking)', 'مشاكل توازن (Balance Problems)', 'شد عضلي (Muscle Spasm)', 'صداع (Headache)', 'مشكلة في القوام (Posture Problem)',
  'إصابة رياضية (Sports Injury)', 'تأهيل بعد عملية (Post-operative Rehabilitation)', 'تأهيل عصبي (Neurological Rehabilitation)']);

export function EditPatientModal({ patient, onClose }: { patient: Patient; onClose: () => void }) {
  const toast = useToast();
  const [f, setF] = useState(() => ({ nationality: 'saudi' as const, ...patient, ...(patient.genderUnknown ? { gender: '' as unknown as Patient['gender'] } : {}), ...(patient.firstName || patient.fatherName || patient.familyName ? {} : splitName(patient.fullName)) }));
  const [idErrs, setIdErrs] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');
  const [phoneErr, setPhoneErr] = useState<PhoneErrorCode | null>(null);
  const [ecPhoneErr, setEcPhoneErr] = useState<PhoneErrorCode | null>(null);
  const [tried, setTried] = useState(false);
  const set = <K extends keyof Patient>(k: K, v: Patient[K]) => setF((x) => ({ ...x, [k]: v }));
  const submit = async () => {
    setTried(true);
    const ie = identityErrors(f); setIdErrs(ie);
    if (Object.keys(ie).length) { setErr(Object.values(ie)[0]); return; }
    if (phoneErr) { setErr(phoneErrorMessage(phoneErr)!); return; }
    if (ecPhoneErr) { setErr('جوال الطوارئ: ' + phoneErrorMessage(ecPhoneErr)); return; }
    const phone = f.phone;
    if (f.email && !EMAIL_RE.test(f.email.trim())) { setErr('البريد الإلكتروني غير صحيح.'); return; }
    setBusy(true);
    // الجنس مش متسجّل (ملف قديم) وماتختارش: مايتكتبش «رجل» افتراضيًا
    const { gender: g0, genderUnknown: _gu, nationalityUnconfirmed: _nu, ...rest } = f;
    const keep = g0 ? { gender: g0 } : {};
    // الموظف اختار الجنسية بنفسه في النموذج وحفظ = الجنسية بقت مؤكدة (ملفات الاستيراد القديم كانت «غير مؤكدة»)
    try { await db.updatePatient(patient.id, { ...rest, ...keep, nationalityUnconfirmed: false, firstName: f.firstName?.trim(), fatherName: f.fatherName?.trim(), familyName: f.familyName?.trim(), nationalId: (f.nationalId ?? '').trim(), fullName: joinName(f), phone, email: (f.email ?? '').trim() }); toast.success('تم حفظ البيانات بنجاح.'); onClose(); }
    catch (e) { setErr((e as Error).message); } finally { setBusy(false); }
  };
  return (
    <Modal title="تعديل بيانات المريض" wide onClose={onClose} footer={footer(onClose, submit, busy)}>
      {err && <div className="alert alert-danger" style={{ marginBottom: 12 }}>{err}</div>}
      {(() => {
        // الناقص لحد دلوقتي (من اللي مكتوب في النموذج) — الملف بيبقى «مكتمل» تلقائيًا أول ما الحقول دي تتملى صح وتتحفظ
        const g = patientGaps({ fullName: joinName(f), phone: f.phone, nationalId: f.nationalId, nationality: f.nationality, nationalityUnconfirmed: false, genderUnknown: !f.gender });
        return g.length
          ? <div className="alert alert-warn" style={{ marginBottom: 12 }}><div>ليصبح الملف <strong>مكتمل</strong> (ليتسنى تأكيد الموعد واعتماد الفاتورة): {g.join('، ')}.</div></div>
          : <div className="alert alert-ok" style={{ marginBottom: 12 }}><div>✓ البيانات الإلزامية كاملة — بعد الحفظ ستصبح حالة الملف «مكتمل».</div></div>;
      })()}
      <div className="form-section">
        <div className="form-section-title">البيانات الأساسية</div>
        <div className="grid-form">
          <IdentityFields idp="ep" f={f} set={(k, v) => setF((x) => ({ ...x, [k]: v }))} errors={idErrs} />
          <PhoneInput id="ep-phone" label="رقم الجوال" value={f.phone} showError={tried} onChange={(v, e) => { set('phone', v); setPhoneErr(e); }} />
          <Input id="ep-email" label="البريد الإلكتروني" dir="ltr" value={f.email ?? ''} onChange={(e) => set('email', e.target.value)} />
          <Select id="ep-gender" label="النوع" value={f.gender} onChange={(e) => set('gender', e.target.value as Patient['gender'])} options={[...(!f.gender ? [{ value: '', label: '— غير محدد —' }] : []), { value: 'male', label: 'رجل' }, { value: 'female', label: 'امرأة' }]} />
          <Input id="ep-birth" label="تاريخ الميلاد" type="date" value={f.birthDate} max={todayYmd()} onChange={(e) => set('birthDate', e.target.value)} />
          <Select id="ep-doctor" label="الطبيب المسؤول" value={f.doctorId ?? ''} onChange={(e) => set('doctorId', e.target.value || null)} options={[{ value: '', label: 'غير محدد' }, ...db.allTherapists().map((t) => ({ value: t.id, label: t.name }))]} />
          <Select id="ep-source" label="كيف عرف عن المركز" value={f.referralSource} onChange={(e) => set('referralSource', e.target.value as ReferralSource)} options={Object.entries(REFERRAL_SOURCE_LABEL).map(([value, label]) => ({ value, label }))} />
        </div>
      </div>
      <div className="form-section">
        <div className="form-section-title">العنوان</div>
        <div className="grid-form">
          <Input id="ep-city" label="المدينة" value={f.city ?? ''} onChange={(e) => set('city', e.target.value)} />
          <Input id="ep-district" label="الحي" value={f.district ?? ''} onChange={(e) => set('district', e.target.value)} />
          <Input id="ep-street" label="الشارع" value={f.street ?? ''} onChange={(e) => set('street', e.target.value)} />
          <Input id="ep-address" label="العنوان (تفاصيل)" value={f.address} onChange={(e) => set('address', e.target.value)} />
        </div>
      </div>
      <div className="form-section">
        <div className="form-section-title">جهة اتصال الطوارئ</div>
        <div className="grid-form">
          <Input id="ep-ecname" label="جهة اتصال الطوارئ" value={f.emergencyContactName} onChange={(e) => set('emergencyContactName', e.target.value)} />
          <PhoneInput id="ep-ecphone" label="جوال الطوارئ" required={false} value={f.emergencyContactPhone} showError={tried} onChange={(v, e) => { set('emergencyContactPhone', v); setEcPhoneErr(e); }} />
        </div>
      </div>
      <div className="form-section">
        <div className="form-section-title">الحالة الطبية</div>
        <div className="grid-form">
          <Input id="ep-complaint" label="الشكوى الرئيسية" value={f.mainComplaint} onChange={(e) => set('mainComplaint', e.target.value)} />
          <DiagnosisField id="ep-diag" label="التشخيص" value={f.diagnosis} dref={f.diagnosisRef} onChange={(text, dref) => setF((x) => ({ ...x, diagnosis: text, diagnosisRef: dref }))} />
        </div>
        <TextArea id="ep-history" label="التاريخ المرضي" value={f.medicalHistory} onChange={(v) => set('medicalHistory', v)} />
        <TextArea id="ep-notes" label="ملاحظات" value={f.notes} onChange={(v) => set('notes', v)} />
      </div>
    </Modal>
  );
}

// الاسم مقسّم (الاسم / اسم الأب / العائلة) + الجنسية + الرقم القومي/جواز السفر — مشترك بين الإضافة والتعديل
const splitName = (full: string) => { const w = full.trim().split(/\s+/).filter(Boolean); return { firstName: w[0] ?? '', fatherName: w[1] ?? '', familyName: w.slice(2).join(' ') }; };
const joinName = (f: { firstName?: string; fatherName?: string; familyName?: string }) => [f.firstName, f.fatherName, f.familyName].map((x) => (x ?? '').trim()).filter(Boolean).join(' ');
const idLabel = (n?: string) => (n === 'non_saudi' ? 'رقم جواز السفر' : 'الرقم القومي');
function identityErrors(f: { firstName?: string; fatherName?: string; familyName?: string; nationality?: string; nationalId?: string }) {
  const e: Record<string, string> = {};
  // الاسم بالعربي (هجرة 162 — الخادم بيعتبر الملف «غير مكتمل» لو الاسم مش عربي)
  if (!f.firstName?.trim()) e.firstName = 'أدخل الاسم.'; else if (!isArabicName(f.firstName)) e.firstName = 'اكتب الاسم بالعربي.';
  if (!f.fatherName?.trim()) e.fatherName = 'أدخل اسم الأب.'; else if (!isArabicName(f.fatherName)) e.fatherName = 'اكتب اسم الأب بالعربي.';
  if (!f.familyName?.trim()) e.familyName = 'أدخل اسم العائلة.'; else if (!isArabicName(f.familyName)) e.familyName = 'اكتب اسم العائلة بالعربي.';
  const id = (f.nationalId ?? '').trim();
  if (id) {
    if (f.nationality === 'non_saudi') { if (!PASSPORT_RE.test(id)) e.nationalId = 'رقم جواز السفر من 6 إلى 20 حرف/رقم إنجليزي.'; }
    else if (!NID_RE.test(id)) e.nationalId = 'الرقم القومي 14 رقم يبدأ بـ 2 أو 3.';
  }
  return e;
}
function IdentityFields({ idp, f, set, errors }: { idp: string; f: { firstName?: string; fatherName?: string; familyName?: string; nationality?: string; nationalId?: string }; set: (k: 'firstName' | 'fatherName' | 'familyName' | 'nationality' | 'nationalId', v: string) => void; errors: Record<string, string> }) {
  return (
    <>
      <div className="field" style={{ gridColumn: '1 / -1' }}>
        <label>الجنسية</label>
        <div className="seg" style={{ maxWidth: 360 }}>
          <button type="button" className={`seg__btn ${f.nationality !== 'non_saudi' ? 'active' : ''}`} onClick={() => set('nationality', 'saudi')}>مصري</button>
          <button type="button" className={`seg__btn ${f.nationality === 'non_saudi' ? 'active' : ''}`} onClick={() => set('nationality', 'non_saudi')}>أجنبي</button>
        </div>
      </div>
      <Input id={`${idp}-first`} label="الاسم *" value={f.firstName ?? ''} onChange={(e) => set('firstName', e.target.value)} error={errors.firstName} />
      <Input id={`${idp}-father`} label="اسم الأب *" value={f.fatherName ?? ''} onChange={(e) => set('fatherName', e.target.value)} error={errors.fatherName} />
      <Input id={`${idp}-family`} label="العائلة *" value={f.familyName ?? ''} onChange={(e) => set('familyName', e.target.value)} error={errors.familyName} />
      <Input id={`${idp}-nid`} label={idLabel(f.nationality)} dir="ltr" inputMode={f.nationality === 'non_saudi' ? 'text' : 'numeric'} maxLength={f.nationality === 'non_saudi' ? 20 : 14} value={f.nationalId ?? ''} onChange={(e) => set('nationalId', f.nationality === 'non_saudi' ? e.target.value.replace(/[^A-Za-z0-9]/g, '').toUpperCase() : toLatinDigits(e.target.value).replace(/\D/g, ''))} error={errors.nationalId} />
    </>
  );
}

export function NewPatientModal({ onClose, onCreated }: { onClose: () => void; onCreated: (id: string) => void }) {
  const toast = useToast();
  const [busy, setBusy] = useState(false);
  const [f, setF] = useState({ nationality: 'saudi' as 'saudi' | 'non_saudi', firstName: '', fatherName: '', familyName: '', fullName: '', phone: '', email: '', gender: 'male' as 'male' | 'female', birthDate: '', nationalId: '', city: '', district: '', street: '', address: '', notes: '', doctorId: '', referralSource: 'google' as ReferralSource });
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [phoneErr, setPhoneErr] = useState<PhoneErrorCode | null>('required');
  const [tried, setTried] = useState(false);
  const [dup, setDup] = useState<{ id: string; name: string; fileNo: string } | null>(null); // نفس الجوال موجود → تنبيه بدل ملف مكرر
  const set = <K extends keyof typeof f>(k: K, v: (typeof f)[K]) => setF((x) => ({ ...x, [k]: v }));
  const submit = async () => {
    setTried(true);
    const errs: Record<string, string> = {};
    Object.assign(errs, identityErrors(f));
    const phone = f.phone;
    if (phoneErr) errs.phone = phoneErrorMessage(phoneErr)!;
    if (f.email && !EMAIL_RE.test(f.email.trim())) errs.email = 'البريد الإلكتروني غير صحيح.';
    if (f.birthDate && f.birthDate > todayYmd()) errs.birthDate = 'تاريخ الميلاد غير صحيح.';
    setErrors(errs);
    if (Object.keys(errs).length) return;
    // نفس الرقم مسموح لعيلة واحدة — التنبيه بس لو نفس الاسم كمان (تكرار حقيقي)
    const fullName = joinName(f);
    const existing = phone ? db.patients().find((x) => phoneMatches(x.phone, phone) && normalizeSearch(x.fullName) === normalizeSearch(fullName)) : undefined;
    if (existing) { setDup({ id: existing.id, name: existing.fullName, fileNo: existing.fileNo }); return; }
    setDup(null);
    setBusy(true);
    try {
      const p = await db.createPatient({ ...f, firstName: f.firstName.trim(), fatherName: f.fatherName.trim(), familyName: f.familyName.trim(), nationalId: f.nationalId.trim(), fullName: joinName(f), phone: phone!, email: f.email.trim(), doctorId: f.doctorId || null, emergencyContactName: '', emergencyContactPhone: '', mainComplaint: '', diagnosis: '', medicalHistory: '' });
      toast.success(`تم تسجيل المريض برقم ملف ${p.fileNo}`);
      onCreated(p.id);
    } catch (e) { toast.error((e as Error).message); } finally { setBusy(false); }
  };
  return (
    <Modal title="فتح ملف مريض جديد" wide onClose={onClose} footer={footer(onClose, submit, busy)}>
      {dup && (
        <div className="alert alert-danger" role="alert" style={{ marginBottom: 14 }}>
          <Icon name="alert" size={17} />
          <div style={{ flex: 1 }}>هذا المريض مسجّل بالفعل <strong>{dup.name}</strong> ({dup.fileNo}) — ما يمكن إنشاء ملف مكرر.</div>
          <Button variant="outline" type="button" onClick={() => onCreated(dup.id)}>فتح الملف الحالي</Button>
        </div>
      )}
      <div className="form-section">
        <div className="form-section-title">البيانات الأساسية</div>
        <div className="grid-form">
          <IdentityFields idp="np" f={f} set={(k, v) => setF((x) => ({ ...x, [k]: v }))} errors={errors} />
          <PhoneInput id="np-phone" label="رقم الجوال *" value={f.phone} showError={tried} onChange={(v, e) => { set('phone', v); setPhoneErr(e); }} />
          <Select id="np-gender" label="الجنس" value={f.gender} onChange={(e) => set('gender', e.target.value as 'male' | 'female')} options={[{ value: 'male', label: 'رجل' }, { value: 'female', label: 'امرأة' }]} />
        </div>
      </div>
      <div className="form-section">
        <div className="form-section-title">تفاصيل أخرى</div>
        <div className="grid-form">
          <Select id="np-doctor" label="الطبيب المسؤول" value={f.doctorId} onChange={(e) => set('doctorId', e.target.value)} options={[{ value: '', label: 'غير محدد' }, ...db.allTherapists().map((t) => ({ value: t.id, label: t.name }))]} />
          <Select id="np-source" label="كيف عرفت عن المركز؟" value={f.referralSource} onChange={(e) => set('referralSource', e.target.value as ReferralSource)} options={Object.entries(REFERRAL_SOURCE_LABEL).map(([value, label]) => ({ value, label }))} />
        </div>
        <TextArea id="np-notes" label="ملاحظات" value={f.notes} onChange={(v) => set('notes', v)} />
      </div>
    </Modal>
  );
}

type AssessmentForm = Omit<InitialAssessment, 'id' | 'date'>;
export function AssessmentModal({ patientId, assessment, onClose }: { patientId: string; assessment?: InitialAssessment; onClose: () => void }) {
  const toast = useToast();
  const [busy, setBusy] = useState(false);
  const [f, setF] = useState<AssessmentForm>(assessment ?? {
    patientId, mainComplaint: '', onsetDate: '', medicalHistory: '', priorInjuries: '', priorSurgeries: '', medications: '', allergies: '',
    medicalDiagnosis: '', painLevel: 5, rom: '', muscleStrength: '', balance: '', gait: '', specialTests: '', therapistNotes: '', goals: '', plan: '', suggestedSessions: 8,
  });
  const set = <K extends keyof AssessmentForm>(k: K, v: AssessmentForm[K]) => setF((x) => ({ ...x, [k]: v }));
  const submit = async () => {
    if (!f.mainComplaint.trim() || !f.medicalDiagnosis.trim()) { toast.error('أدخل الشكوى الرئيسية والتشخيص الطبي على الأقل.'); return; }
    setBusy(true);
    await db.saveAssessment({ ...f, id: assessment?.id });
    setBusy(false);
    toast.success(assessment ? 'تم تعديل التقييم.' : 'تم تسجيل التقييم الأولي.');
    onClose();
  };
  return (
    <Modal title={assessment ? 'تعديل التقييم الأولي' : 'إضافة تقييم أولي'} wide onClose={onClose} footer={footer(onClose, submit, busy)}>
      <div className="form-section">
        <div className="form-section-title">الشكوى والتشخيص</div>
        <div className="grid-form">
          <Input id="as-complaint" label="الشكوى الرئيسية *" value={f.mainComplaint} onChange={(e) => set('mainComplaint', e.target.value)} />
          <DiagnosisField id="as-diag" label="التشخيص الطبي *" value={f.medicalDiagnosis} dref={f.diagnosisRef} onChange={(text, dref) => setF((x) => ({ ...x, medicalDiagnosis: text, diagnosisRef: dref }))} />
          <Input id="as-onset" label="تاريخ بداية الأعراض" type="date" value={f.onsetDate} onChange={(e) => set('onsetDate', e.target.value)} />
          <Input id="as-pain" label="مستوى الألم (0-10)" type="number" min={0} max={10} value={f.painLevel} onChange={(e) => set('painLevel', Math.min(10, Math.max(0, Number(e.target.value))))} />
        </div>
      </div>
      <div className="form-section">
        <div className="form-section-title">التاريخ الطبي</div>
        <div className="grid-form">
          <Input id="as-injuries" label="إصابات سابقة" value={f.priorInjuries} onChange={(e) => set('priorInjuries', e.target.value)} />
          <Input id="as-surgeries" label="عمليات سابقة" value={f.priorSurgeries} onChange={(e) => set('priorSurgeries', e.target.value)} />
          <Input id="as-meds" label="الأدوية الحالية" value={f.medications} onChange={(e) => set('medications', e.target.value)} />
          <Input id="as-allergies" label="الحساسية" value={f.allergies} onChange={(e) => set('allergies', e.target.value)} />
        </div>
        <TextArea id="as-history" label="التاريخ المرضي" value={f.medicalHistory} onChange={(v) => set('medicalHistory', v)} />
      </div>
      <div className="form-section">
        <div className="form-section-title">الفحص السريري</div>
        <div className="grid-form">
          <Input id="as-rom" label="مدى الحركة (ROM)" value={f.rom} onChange={(e) => set('rom', e.target.value)} />
          <Input id="as-strength" label="القوة العضلية" value={f.muscleStrength} onChange={(e) => set('muscleStrength', e.target.value)} />
          <Input id="as-balance" label="التوازن" value={f.balance} onChange={(e) => set('balance', e.target.value)} />
          <Input id="as-gait" label="المشي" value={f.gait} onChange={(e) => set('gait', e.target.value)} />
          <Input id="as-tests" label="الاختبارات الخاصة" value={f.specialTests} onChange={(e) => set('specialTests', e.target.value)} />
          <Input id="as-sessions" label="عدد الجلسات المقترح" type="number" min={1} value={f.suggestedSessions} onChange={(e) => set('suggestedSessions', Number(e.target.value))} />
        </div>
      </div>
      <div className="form-section">
        <div className="form-section-title">الأهداف وخطة العلاج</div>
        <TextArea id="as-goals" label="الأهداف" value={f.goals} onChange={(v) => set('goals', v)} />
        <TextArea id="as-plan" label="خطة العلاج المقترحة" value={f.plan} onChange={(v) => set('plan', v)} />
        <TextArea id="as-notes" label="ملاحظات المعالج" value={f.therapistNotes} onChange={(v) => set('therapistNotes', v)} />
      </div>
    </Modal>
  );
}

// عروض جاهزة (عروض اليوم الوطني) — عدد الجلسات وسعرها الإجمالي
const PLAN_OFFERS = [
  { label: '6 جلسات', sessions: 6, price: 1096 },
  { label: '4 جلسات', sessions: 4, price: 796 },
];

type PlanForm =Omit<TreatmentPlan, 'id' | 'progressPct' | 'endDate'>;

// بيانات الحالة المبدئية من ملف المريض وآخر تقييم: العمر، بداية الألم، الشكوى
function caseInfoFor(patientId: string) {
  const p = db.patient(patientId);
  const a = db.assessmentsForPatient(patientId)[0];
  let age: number | null = null;
  if (p?.birthDate) {
    const b = new Date(p.birthDate + 'T00:00:00'), n = new Date();
    age = n.getFullYear() - b.getFullYear() - (n < new Date(n.getFullYear(), b.getMonth(), b.getDate()) ? 1 : 0);
    if (!(age >= 0 && age <= 120)) age = null;
  }
  return { patientAge: age, painOnset: a?.onsetDate || '', chiefComplaint: a?.mainComplaint || p?.mainComplaint || '' };
}

// أسعار الجلسات من «خدمات خطط العلاج» حسب نوع العلاج المختار، وإلا العروض الافتراضية
function offersFor(therapyType: string) {
  const typeOffers = db.planServices().find((p) => p.name === therapyType)?.offers ?? [];
  return typeOffers.length ? typeOffers.map((o) => ({ label: sessionsLabel(o.sessions), ...o })) : PLAN_OFFERS;
}
// السعر التلقائي: لو فيه عرض بنفس عدد الجلسات ياخد سعره، وإلا سعر الخدمة × عدد الجلسات
export function autoPlanPriceInfo(f: Pick<PlanForm, 'therapyType' | 'serviceId' | 'totalSessions'>) {
  const offer = offersFor(f.therapyType).find((o) => o.sessions === f.totalSessions);
  if (offer) return { price: offer.price, note: `سعر عرض ${offer.label}` };
  const unit = db.service(f.serviceId)?.price ?? 0;
  return { price: unit * f.totalSessions, note: `${money(unit)} للجلسة × ${f.totalSessions} جلسة` };
}
const autoPlanPrice = (f: Pick<PlanForm, 'therapyType' | 'serviceId' | 'totalSessions'>) => autoPlanPriceInfo(f).price;
export function PlanModal({ patientId, plan, presetServiceId, presetDiagnosis, onClose }: { patientId?: string; plan?: TreatmentPlan; presetServiceId?: string; presetDiagnosis?: string; onClose: () => void }) {
  const toast = useToast();
  const can = useCan();
  const { user } = useAuth();
  const [busy, setBusy] = useState(false);
  const services = db.allServices();
  const [pid, setPid] = useState(patientId ?? plan?.patientId ?? '');
  const [patientQuery, setPatientQuery] = useState('');
  const patient = pid ? db.patient(pid) : undefined;
  const searchResults = !pid && patientQuery.trim() ? db.searchPatients(patientQuery).slice(0, 8) : [];
  const initialService = presetServiceId ?? (services.find((s) => s.id === 'sv_pt') ?? services[0])?.id ?? '';
  const initialSessions = pid ? db.assessmentsForPatient(pid)[0]?.suggestedSessions ?? 8 : 8;
  const [f, setF] = useState<PlanForm>(plan ? { ...plan, price: plan.price ?? 0, totalSessions: planTotalSessions(plan.durationWeeks, plan.sessionsPerWeek) } : {
    patientId: pid, serviceId: initialService, diagnosis: presetDiagnosis ?? (pid ? db.assessmentsForPatient(pid)[0]?.medicalDiagnosis || db.patient(pid)?.diagnosis || '' : ''),
    diagnosisRef: presetDiagnosis ? null : pid ? (db.assessmentsForPatient(pid)[0]?.diagnosisRef ?? db.patient(pid)?.diagnosisRef ?? null) : null, mainGoal: '', shortTermGoals: '', longTermGoals: '', ...(pid ? caseInfoFor(pid) : { patientAge: null, painOnset: '', chiefComplaint: '' }),
    ...planScheduleFor(initialSessions, 2), therapyType: '',
    exercises: '', devices: '', therapistNotes: '', notes: '', price: autoPlanPrice({ therapyType: '', serviceId: initialService, totalSessions: initialSessions }),
    startDate: todayYmd(), status: 'active',
  });
  // السعر بيتحسب تلقائي لحد ما المستخدم يكتب سعر بإيده (الخطة القائمة بتحتفظ بسعرها)
  const [priceTouched, setPriceTouched] = useState(!!plan);
  // بعد إنشاء الخطة: يفتح تقييم العلاج الطبيعي الكامل (Subjective/Objective/Assessment/Goals) مربوط بنفس الخطة
  const physioAllowed = !plan && can('physio', 'create');
  const [withPhysio, setWithPhysio] = useState(physioAllowed);
  const [pi, setPi] = useState<PhysioInline>(newPhysioInline);
  const [piErrors, setPiErrors] = useState<Record<string, string>>({});
  // الدكتور بيختار عدد الجلسات بس — السعر والمواعيد بيحددهم الاستقبال/المحاسب من «فواتير الخطط العلاجية»
  const doctorMode = true; // (2026-10-14 بطلب الإدارة) الكل — مش الدكتور بس — بيختار عدد الجلسات بس؛ السعر والمواعيد من «مراجعة فاتورة الخطة»
  const [docCount, setDocCount] = useState(plan?.totalSessions ?? 6);
  const [docOther, setDocOther] = useState((plan?.totalSessions ?? 6) > 12);
  // مواعيد الجلسات (اختياري) وقت إنشاء الخطة: بتتحجز بعد الحفظ كمواعيد حقيقية مربوطة بالخطة — ونفسها بتظهر في «مراجعة فاتورة الخطة»
  const canBook = can('appointments', 'create') || can('booking', 'create');
  const [withDates, setWithDates] = useState(false);
  const [draft, setDraft] = useState<SessionRow[]>([]);
  const draftDoctor = defaultPlanDoctor(f.serviceId, null, user?.therapistId);
  const draftCount = Number.isInteger(docCount) && docCount >= 1 && docCount <= 52 ? docCount : 0;
  const draftRows = Array.from({ length: draftCount }, (_, i) => draft[i] ?? emptyRow(draftDoctor));
  const draftIssues = withDates && pid ? sessionRowIssues(draftRows, pid, f.serviceId) : {};
  const suggestDraft = () => setDraft(suggestSessionRows({ patientId: pid, serviceId: f.serviceId, therapistId: draftDoctor, count: draftCount }));
  // أشعة الخطة الجديدة: بتترفع وتترتبط بالخطة بعد الحفظ
  const [xrays, setXrays] = useState<File[]>([]);
  const xrayInput = useRef<HTMLInputElement>(null);
  const set = <K extends keyof PlanForm>(k: K, v: PlanForm[K]) => setF((x) => {
    const next = { ...x, [k]: v };
    if (k === 'durationWeeks' || k === 'sessionsPerWeek') next.totalSessions = planTotalSessions(next.durationWeeks, next.sessionsPerWeek);
    if (k === 'durationWeeks' || k === 'sessionsPerWeek' || k === 'startDate') next.sessionDates = null;
    if (!priceTouched && k !== 'price') next.price = autoPlanPrice(next);
    return next;
  });
  const offers = offersFor(f.therapyType);
  const auto = autoPlanPriceInfo(f);
  const pickPatient = (id: string) => {
    setPid(id);
    const p = db.patient(id);
    const a = db.assessmentsForPatient(id)[0];
    const info = caseInfoFor(id);
    setF((x) => {
      const base = { ...x, patientId: id, patientAge: x.patientAge ?? info.patientAge, painOnset: x.painOnset || info.painOnset, chiefComplaint: x.chiefComplaint || info.chiefComplaint };
      return x.diagnosis ? base : { ...base, diagnosis: a?.medicalDiagnosis || p?.diagnosis || '', diagnosisRef: a?.diagnosisRef ?? p?.diagnosisRef ?? null };
    });
  };
  const submit = async () => {
    // المريض لازم يكون موجود (البحث بس — إضافة مريض جديد من صفحة المرضى)
    const targetId = pid;
    if (!targetId) { toast.error('اختر المريض من البحث.'); return; }
    if (f.patientAge != null && !(Number.isInteger(f.patientAge) && f.patientAge >= 0 && f.patientAge <= 120)) { toast.error('العمر غير صحيح.'); return; }
    if (doctorMode && !(Number.isInteger(docCount) && docCount >= 1 && docCount <= 52)) { toast.error('عدد الجلسات من 1 إلى 52.'); return; }
    const fp = doctorMode ? { ...f, durationWeeks: docCount, sessionsPerWeek: 1, sessionDates: null, price: plan?.price ?? 0, startDate: plan?.startDate ?? todayYmd() } : f;
    const schedErr = planScheduleError(fp.durationWeeks, fp.sessionsPerWeek);
    if (schedErr) { toast.error(schedErr); return; }
    if (f.price < 0) { toast.error('السعر ما ينفع يكون سالبًا.'); return; }
    const bookRows = !plan && withDates && canBook ? draftRows.filter((r) => r.date || r.time) : [];
    const firstIssue = Object.entries(draftIssues)[0];
    if (bookRows.length && firstIssue) { toast.error(`الجلسة ${Number(firstIssue[0]) + 1}: ${firstIssue[1]}`); return; }
    // كل الخانات اختيارية: لو تقييم العلاج الطبيعي ناقص، الخطة بتتحفظ من غيره
    const physioOk = physioAllowed && withPhysio && Object.keys(validatePhysioInline(pi, f.startDate)).length === 0 && !!(f.chiefComplaint ?? '').trim();
    setBusy(true);
    const before = new Set(db.plansForPatient(targetId).map((x) => x.id));
    try {
      await db.savePlan({ ...fp, totalSessions: planTotalSessions(fp.durationWeeks, fp.sessionsPerWeek), patientId: targetId, id: plan?.id });
    } catch (e) {
      // رسالة الخادم (مثلًا صلاحية أو قيمة غير صحيحة) — والزرار يرجع يشتغل بدل ما يفضل «جارٍ الحفظ»
      setBusy(false); toast.error((e as Error).message || 'تعذّر حفظ الخطة.'); return;
    }
    if (plan) {
      // تعديل الخطة بعد عملها: فاتورتها تتحدّث بنفس السعر والخدمة وعدد الجلسات (نفس قيود تعديل الفاتورة: مايقلّش عن المدفوع، ولا يتعدّل لو مقفول)
      const inv = db.invoicesForPatient(targetId).find((i) => i.planId === plan.id && i.status !== 'cancelled');
      const total = planTotalSessions(f.durationWeeks, f.sessionsPerWeek);
      if (inv) {
        const desc = `خطة علاج: ${f.therapyType || db.service(f.serviceId)?.name || ''} (${total} جلسات)`;
        if (inv.price !== f.price) {
          const r = await db.updatePlanInvoice(inv.id, { price: f.price, discount: Math.min(inv.discount, f.price), note: inv.note ?? '' }, false);
          if (!r.ok) toast.error(`عُدّلت الخطة، لكن الفاتورة ${inv.no} لم تُعدَّل: ${r.error}`);
        }
        if (inv.serviceName !== desc) { const n = await db.setInvoiceName(inv.id, desc); if (!n.ok) toast.error(`عُدّلت الخطة، لكن وصف الفاتورة لم يتغير: ${n.error}`); }
      }
    }
    toast.success(plan ? 'تم تعديل خطة العلاج وفاتورتها.' : f.price > 0 ? 'تم إنشاء خطة العلاج وأُرسلت فاتورتها للاستقبال للمراجعة.' : 'تم إنشاء خطة العلاج.');
    if (physioAllowed && withPhysio && !physioOk) toast.info('تقييم العلاج الطبيعي ناقص فلم يُحفظ — تقدر تضيفه لاحقًا من ملف المريض ← «العلاج الطبيعي».');
    if (physioOk) {
      const created = db.plansForPatient(targetId).find((x) => !before.has(x.id));
      const r = await savePhysioInline(pi, {
        patientId: targetId, therapistId: user?.therapistId ?? null, age: f.patientAge ?? null, chiefComplaint: (f.chiefComplaint ?? '').trim(),
        diagnosis: f.diagnosis.trim(), diagnosisConditionId: f.diagnosisRef?.conditionId ?? null, treatmentPlanId: created?.id ?? null,
        totalSessions: planTotalSessions(f.durationWeeks, f.sessionsPerWeek), durationWeeks: f.durationWeeks, sessionsPerWeek: f.sessionsPerWeek, startDate: f.startDate,
      });
      if (!r.ok) toast.error(`تم إنشاء الخطة، لكن تعذّر حفظ تقييم العلاج الطبيعي: ${r.error} — تقدر تضيفه من ملف المريض ← «العلاج الطبيعي».`);
      else toast.success('تم حفظ تقييم العلاج الطبيعي مع الخطة.');
    }
    if (!plan && xrays.length) {
      const created = db.plansForPatient(targetId).find((x) => !before.has(x.id));
      let failed = 0;
      for (const file of xrays) { const r = await db.uploadPatientFile(targetId, file, '', { planId: created?.id ?? null }); if (!r.ok) { failed++; toast.error(`${file.name}: ${r.error}`); } }
      if (failed < xrays.length) toast.success('تم رفع الأشعة مع الخطة.');
    }
    if (bookRows.length) {
      const created = db.plansForPatient(targetId).find((x) => !before.has(x.id));
      if (created) {
        const r = await bookDraftSessions(created.id, bookRows);
        if (r.booked) toast.success(`تم حجز ${r.booked} جلسة للخطة — تظهر في «مراجعة فاتورة الخطة العلاجية».`);
        r.errors.forEach((e) => toast.error(e));
        if (r.errors.length) toast.info('حُفظت الخطة — أكمل حجز الجلسات المتبقية من «مراجعة فاتورة الخطة العلاجية».');
      }
    }
    setBusy(false);
    onClose();
  };
  return (
    <Modal title={plan ? 'تعديل خطة العلاج' : 'إنشاء خطة علاج جديدة'} wide onClose={onClose} footer={footer(onClose, submit, busy)}>
      {!patientId && !plan && (
        <div className="form-section">
          <div className="form-section-title">المريض</div>
          <div className="field">
            {pid && patient ? (
              <div className="choice selected">
                <span style={{ flex: 1 }}><strong>{patient.fullName}</strong><span> {patient.fileNo} · <span className="num">{patient.phone}</span></span></span>
                <Button type="button" variant="ghost" size="sm" onClick={() => { setPid(''); setPatientQuery(''); }}>تغيير</Button>
              </div>
            ) : (
              <>
                  <>
                    <Input id="pl-patient" icon="search" placeholder="ابحث بالاسم أو الجوال أو رقم الملف أو الرقم القومي" value={patientQuery} onChange={(e) => setPatientQuery(e.target.value)} />
                    {searchResults.length > 0 && (
                      <div className="choice-grid" style={{ marginTop: 8 }}>
                        {searchResults.map((p) => (
                          <button key={p.id} type="button" className="choice" onClick={() => pickPatient(p.id)}>
                            <span><strong>{p.fullName}</strong><span> {p.fileNo} · <span className="num">{p.phone}</span></span></span>
                          </button>
                        ))}
                      </div>
                    )}
                    {patientQuery.trim() && searchResults.length === 0 && <p className="muted" style={{ marginTop: 6 }}>ما فيه نتائج مطابقة.</p>}
                  </>
              </>
            )}
          </div>
        </div>
      )}
      <div className="form-section">
        <div className="form-section-title">بيانات الحالة</div>
        <div className="grid-form">
          <Select id="pl-age" label="العمر" value={f.patientAge == null ? '' : String(f.patientAge)} onChange={(e) => set('patientAge', e.target.value === '' ? null : Number(e.target.value))}
            options={[{ value: '', label: 'اختر العمر...' }, ...Array.from({ length: 100 }, (_, i) => ({ value: String(i + 1), label: `${i + 1} سنة` }))]} />
        </div>
        <TextPick id="pl-onset" label="بداية ظهور الألم" placeholder="اختر كيف بدأ الألم..." single options={PAIN_ONSET_OPTS} value={f.painOnset ?? ''} onChange={(v) => set('painOnset', v)} />
        <TextPick id="pl-complaint" label="شكوى المريض" placeholder="اختر شكوى المريض..." options={COMPLAINT_OPTS} value={f.chiefComplaint ?? ''} onChange={(v) => set('chiefComplaint', v)} />
      </div>
      <div className="form-section">
        <div className="form-section-title">التشخيص والهدف</div>
        <div className="grid-form">
          <DiagnosisField id="pl-diag" label="التشخيص" value={f.diagnosis} dref={f.diagnosisRef} onChange={(text, dref) => setF((x) => ({ ...x, diagnosis: text, diagnosisRef: dref }))} />
          <TextPick id="pl-goal" label="الهدف الرئيسي" placeholder="اختر الهدف الرئيسي..." options={GOAL_OPTS} value={f.mainGoal} onChange={(v) => set('mainGoal', v)} />
          {db.planServices().length > 0 ? (
            <Select id="pl-type" label="نوع العلاج" value={f.therapyType} onChange={(e) => set('therapyType', e.target.value)}
              options={[{ value: '', label: 'اختر...' }, ...db.planServices().map((p) => ({ value: p.name, label: p.name })), ...(f.therapyType && !db.planServices().some((p) => p.name === f.therapyType) ? [{ value: f.therapyType, label: f.therapyType }] : [])]} />
          ) : (
            <Input id="pl-type" label="نوع العلاج" value={f.therapyType} onChange={(e) => set('therapyType', e.target.value)} />
          )}
        </div>
      </div>
      {plan ? (
        <div className="form-section"><LinkedFiles patientId={plan.patientId} planId={plan.id} /></div>
      ) : pid && (
        <div className="form-section">
          <div className="row-between" style={{ marginBottom: 8 }}>
            <div className="form-section-title" style={{ margin: 0 }}>أشعة الخطة</div>
            <input ref={xrayInput} type="file" hidden multiple accept=".pdf,.png,.jpg,.jpeg,.webp" onChange={(e) => { const list = Array.from(e.target.files ?? []); setXrays((x) => [...x, ...list]); e.target.value = ''; }} />
            <Button type="button" size="sm" variant="outline" icon="doc" onClick={() => xrayInput.current?.click()}>رفع أشعة</Button>
          </div>
          {xrays.length === 0 ? <p className="muted" style={{ fontSize: 13 }}>صور أشعة أو تقارير (صورة أو PDF، حتى 10 ميجابايت) — تُرفع وتُربط بالخطة عند الحفظ.</p> : (
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8 }}>
              {xrays.map((file, i) => (
                <span key={i} className="choice selected" style={{ gap: 6 }}>
                  {file.name}
                  <button type="button" aria-label="حذف" style={{ background: 'none', border: 0, cursor: 'pointer' }} onClick={() => setXrays((x) => x.filter((_, j) => j !== i))}>✕</button>
                </span>
              ))}
            </div>
          )}
          <details style={{ marginTop: 10 }}><summary className="muted" style={{ cursor: 'pointer', fontSize: 13 }}>كل مرفقات المريض السابقة</summary><PatientFilesTab patientId={pid} /></details>
        </div>
      )}
      {physioAllowed && (
        <>
          <label className="pt-optin">
            <input type="checkbox" checked={withPhysio} onChange={(e) => setWithPhysio(e.target.checked)} />
            <span><strong>تقييم علاج طبيعي كامل (Physiotherapy Evaluation)</strong><br />
              <span className="muted">يُؤخذ العمر والشكوى والتشخيص وعدد الجلسات من الخطة أعلاه. بعد الحفظ سجّل Progress Note لكل جلسة من ملف المريض ← «العلاج الطبيعي».</span></span>
          </label>
          {withPhysio && <PhysioInlineSections v={pi} onChange={setPi} errors={piErrors} />}
        </>
      )}
      {doctorMode ? (
        <div className="form-section">
          <div className="form-section-title">عدد الجلسات</div>
          <div className="grid-form grid-form--3">
            <Select id="pl-count" label="عدد الجلسات *" value={docOther ? 'other' : String(docCount)}
              onChange={(e) => { if (e.target.value === 'other') { setDocOther(true); } else { setDocOther(false); setDocCount(Number(e.target.value)); } }}
              options={[...Array.from({ length: 12 }, (_, i) => ({ value: String(i + 1), label: `${i + 1} ${i + 1 === 1 ? 'جلسة' : i + 1 === 2 ? 'جلستين' : i + 1 <= 10 ? 'جلسات' : 'جلسة'}` })), { value: 'other', label: 'عدد آخر (اكتب العدد)' }]} />
            {docOther && <Input id="pl-count-other" label="اكتب عدد الجلسات" type="number" min={1} max={52} value={docCount} onChange={(e) => setDocCount(Number(e.target.value))} />}
            {plan && <Select id="pl-status2" label="الحالة" value={f.status} onChange={(e) => set('status', e.target.value as PlanStatus)} options={[{ value: 'active', label: 'نشطة' }, { value: 'paused', label: 'متوقفة' }, { value: 'completed', label: 'مكتملة' }]} />}
          </div>
          <div className="alert alert-info" style={{ marginTop: 12 }}>بعد الحفظ يُرسل طلب إلى الاستقبال/المحاسب في «فواتير الخطط العلاجية» لتحديد سعر الخطة وحجز موعد كل جلسة.</div>
        </div>
      ) : null}
      {doctorMode && !plan && pid && canBook ? (
        <div className="form-section">
          <label className="pt-optin" style={{ marginBottom: withDates ? 10 : 0 }}>
            <input type="checkbox" checked={withDates} onChange={(e) => { setWithDates(e.target.checked); if (e.target.checked && !draft.some((r) => r.date)) suggestDraft(); }} />
            <span><strong>تحديد مواعيد الجلسات الحين (اختياري)</strong><br />
              <span className="muted">تاريخ ووقت ودكتور كل جلسة — تُحجز مواعيد فعلية مرتبطة بالخطة بعد الحفظ، دون فواتير منفصلة. وما تتركه فارغًا تُكمله من «مراجعة فاتورة الخطة العلاجية».</span></span>
          </label>
          {withDates && (<>
            <div className="row-between" style={{ marginBottom: 8 }}>
              <span className="muted" style={{ fontSize: 12.5 }}>مقترحة حسب دوام الدكتور — كل جلسة 30 دقيقة، والجلسة التانية في نفس اليوم بموافقة المدير عند الحضور.</span>
              <Button type="button" size="sm" variant="outline" icon="refresh" onClick={suggestDraft}>اقتراح المواعيد تلقائيًا</Button>
            </div>
            <SessionRowsEditor rows={draftRows} serviceId={f.serviceId} startNo={1} issues={draftIssues}
              onChange={(i, r) => setDraft((d) => { const n = Array.from({ length: draftCount }, (_, k) => d[k] ?? emptyRow(draftDoctor)); n[i] = r; return n; })} />
          </>)}
        </div>
      ) : null}
      {doctorMode && plan ? (
        plan.status === 'active' ? <div className="form-section"><PlanSessionBooking plan={plan} canBook={canBook} /></div> : null
      ) : doctorMode ? null : (<>
      <div className="form-section">
        <div className="form-section-title">عدد الجلسات والسعر</div>
        <div className="offer-grid">
          {offers.map((o) => {
            const active = f.totalSessions === o.sessions && f.price === o.price;
            return (
              <button key={o.label} type="button" className={`offer ${active ? 'active' : ''}`}
                onClick={() => { setPriceTouched(false); setF((x) => ({ ...x, ...planScheduleFor(o.sessions, x.sessionsPerWeek), price: o.price, sessionDates: null })); }}>
                <strong>{o.label}</strong>
                <span className="num">{money(o.price)}</span>
              </button>
            );
          })}
          <button type="button" className={`offer offer--custom ${!offers.some((o) => o.sessions === f.totalSessions && o.price === f.price) ? 'active' : ''}`}
            onClick={() => { setPriceTouched(true); document.getElementById('pl-price')?.focus(); }}>
            <strong>سعر مخصص</strong>
            <span>حدد المدة والسعر</span>
          </button>
        </div>
        <div className="review-total" style={{ gap: 16, flexWrap: 'wrap', marginTop: 14 }}>
          <div style={{ flex: 1, minWidth: 180 }}>
            <div style={{ fontWeight: 700 }}>سعر الخطة العلاجية</div>
            <div className="muted" style={{ fontSize: 12.5 }}>
              {priceTouched
                ? <>سعر مكتوب يدويًا. <button type="button" className="link-more" style={{ fontSize: 12.5, background: "none", border: 0, padding: 0, cursor: "pointer" }} onClick={() => { setPriceTouched(false); setF((x) => ({ ...x, price: autoPlanPrice(x) })); }}>رجوع للسعر التلقائي ({money(auto.price)})</button></>
                : <>محسوب تلقائيًا: {auto.note} — يتغيّر مع عدد الجلسات، وتقدر تكتب سعر مختلف.</>}
              {' '}{plan ? 'تعديل السعر هنا يعدّل فاتورة الخطة أيضًا (ما يقل عن المدفوع).' : 'تُرسل الفاتورة لقسم «فواتير الخطط العلاجية» ليراجعها الاستقبال ويعتمدها.'}
            </div>
          </div>
          <div style={{ width: 170 }}>
            <Input id="pl-price" label="السعر (ج.م)" type="number" min={0} value={f.price}
              onChange={(e) => { setPriceTouched(true); set('price', Number(e.target.value)); }} />
          </div>
        </div>
      </div>
      <div className="form-section">
        <div className="form-section-title">الجدول الزمني</div>
        <div className="grid-form grid-form--3">
          <Input id="pl-weeks" label="مدة الخطة (أسابيع)" type="number" min={1} max={52} value={f.durationWeeks} onChange={(e) => set('durationWeeks', Number(e.target.value))} />
          <Input id="pl-week" label="جلسات/أسبوع" type="number" min={1} max={7} value={f.sessionsPerWeek} onChange={(e) => set('sessionsPerWeek', Number(e.target.value))} />
          <Input id="pl-total" label="إجمالي الجلسات (محسوب تلقائيًا)" type="number" value={f.totalSessions} readOnly disabled
            hint={`${f.durationWeeks} أسبوع × ${f.sessionsPerWeek} جلسة/أسبوع`} />
          <Input id="pl-start" label="تاريخ أول جلسة" type="date" value={f.startDate} onChange={(e) => set('startDate', e.target.value)} />
          {plan && <Select id="pl-status" label="الحالة" value={f.status} onChange={(e) => set('status', e.target.value as PlanStatus)} options={[{ value: 'active', label: 'نشطة' }, { value: 'paused', label: 'متوقفة' }, { value: 'completed', label: 'مكتملة' }]} />}
        </div>
        <div className="field" style={{ marginTop: 12 }}>
          <label>مواعيد الجلسات — محسوبة من تاريخ أول جلسة، وتقدر تعدّل أي تاريخ (تُزاح الجلسات التي بعده معه)</label>
          {f.sessionDates && <button type="button" className="link-more" style={{ fontSize: 12.5, background: 'none', border: 0, padding: 0, cursor: 'pointer' }} onClick={() => setF((x) => ({ ...x, sessionDates: null }))}>رجوع للمواعيد التلقائية</button>}
          <PlanScheduleList startDate={f.startDate} sessionsPerWeek={f.sessionsPerWeek} total={f.totalSessions} dates={f.sessionDates} onEdit={(d) => setF((x) => ({ ...x, sessionDates: d }))} />
        </div>
        {!plan && <div className="alert alert-info" style={{ marginTop: 14 }}>سيتم ربط مواعيد المريض القادمة غير المرتبطة بخطة بهذه الخطة تلقائيًا، ولن تصدر فواتير منفصلة لمواعيد الخطة.</div>}
      </div>
      </>)}
    </Modal>
  );
}

export function SellPackageModal({ patientId, onClose }: { patientId: string; onClose: () => void }) {
  const toast = useToast();
  const [busy, setBusy] = useState(false);
  const plans = db.packagePlans();
  const [planId, setPlanId] = useState(plans[0]?.id ?? '');
  const plan = plans.find((p) => p.id === planId);
  const submit = async () => {
    if (!planId) return;
    setBusy(true);
    await db.sellPackage(patientId, planId);
    setBusy(false);
    toast.success(plan?.kind
      ? 'تم إنشاء الباقة والفاتورة — الباقة تتفعّل بعد السداد الكامل (دفع كامل أو دفعتين بموافقة المدير) من الفواتير.'
      : 'تم بيع الباقة للمريض، وأُضيفت فاتورة جديدة بقيمتها.');
    onClose();
  };
  return (
    <Modal title="بيع باقة" onClose={onClose} footer={plans.length ? footer(onClose, submit, busy, 'تأكيد البيع') : undefined}>
      {plans.length === 0 ? <p className="muted">ما فيه باقات مفعّلة في كتالوج الباقات (الإعدادات ← الباقات).</p> : (
        <>
          <Select id="sp-plan" label="الباقة" value={planId} onChange={(e) => setPlanId(e.target.value)} options={plans.map((p) => ({ value: p.id, label: `${p.name} — ${money(p.price)}` }))} />
          {plan && (
            <dl className="dl" style={{ marginTop: 14 }}>
              <div><dt>عدد الجلسات</dt><dd className="num">{plan.totalSessions}</dd></div>
              <div><dt>صلاحية الباقة</dt><dd>{plan.validDays} يومًا من تاريخ البيع</dd></div>
              <div><dt>السعر</dt><dd className="num">{money(plan.price)}</dd></div>
              <div><dt>الخدمات المشمولة</dt><dd>{plan.serviceIds.map((id) => db.service(id)?.name).filter(Boolean).join('، ')}</dd></div>
            </dl>
          )}
        </>
      )}
    </Modal>
  );
}

// جدول مواعيد جلسات الخطة: المتوقع من تاريخ أول جلسة، والفعلي لو الجلسة اتعملت أو اتحجز لها موعد
// جدول مواعيد جلسات الخطة: المتوقع من تاريخ أول جلسة (أو المعدّل يدويًا)، والفعلي لو الجلسة اتعملت أو اتحجز لها موعد.
// onEdit موجود = التواريخ قابلة للتعديل: تغيير جلسة بيزحزح الجلسات اللي بعدها بنفس الفرق.
export function PlanScheduleList({ startDate, sessionsPerWeek, total, dates: custom, onEdit, actual }: {
  startDate: string; sessionsPerWeek: number; total: number; dates?: string[] | null; onEdit?: (dates: string[]) => void;
  actual?: (i: number) => { date: string; time?: string; label: string } | undefined;
}) {
  if (!startDate || total < 1) return null;
  const dates = planDates(startDate, sessionsPerWeek, total, custom);
  const edit = (i: number, v: string) => {
    if (!v || !onEdit) return;
    const delta = Math.round((Date.parse(v) - Date.parse(dates[i])) / 86400000);
    onEdit(dates.map((d, j) => (j === i ? v : j > i ? addDaysYmd(d, delta) : d)));
  };
  return (
    <div className="table-wrap" style={{ marginTop: 10, maxHeight: 320, overflowY: 'auto' }}>
      <table className="table">
        <thead><tr><th>الجلسة</th><th>اليوم</th><th>التاريخ</th><th>الحالة</th></tr></thead>
        <tbody>{dates.map((d, i) => {
          const a = actual?.(i);
          const date = a?.date ?? d;
          return (
            <tr key={i}>
              <td className="num">{i + 1}</td>
              <td>{WEEKDAY_LABEL[new Date(date + 'T00:00:00').getDay()]}</td>
              <td className="num">{onEdit && !a
                ? <input type="date" className="input" style={{ height: 38, maxWidth: 170 }} aria-label={`تاريخ الجلسة ${i + 1}`} value={d} min={i > 0 ? dates[i - 1] : undefined} onChange={(e) => edit(i, e.target.value)} />
                : <>{fmtDate(date)}{a?.time ? ` · ${fmtTime(a.time)}` : ''}</>}</td>
              <td className={a ? '' : 'muted'}>{a?.label ?? (custom ? 'معدّل' : 'متوقع')}</td>
            </tr>
          );
        })}</tbody>
      </table>
    </div>
  );
}
// المواعيد المعدّلة لو عددها مطابق، وإلا المحسوبة من تاريخ أول جلسة
export const planDates = (startDate: string, sessionsPerWeek: number, total: number, custom?: string[] | null) =>
  custom && custom.length === total ? custom : db.planSessionDates(startDate, sessionsPerWeek, total);
