// شيت الكشف الرقمي — نفس الورقتين المطبوعتين بتوع العيادة بخاناتهم وترقيمهم:
// «الشيت العام» (يتملى قبل دخول المريض — خريطة الجسم خانة فيه لتحديد مكان الألم) و«شيت كشف الورك والركبة» (12 خانة).
// الاختيارات بتتخزن في consultation.sheet، وsheetSummary بيطلع منها ملخص نصي للشكوى والتاريخ المرضي والفحص والتشخيص
// (القوايم والروشتة وسجل المريض بيعرضوا الملخص ده زي الكشوفات القديمة).
import { useState, type ReactNode } from 'react';
import { BodyFigure, regionById, type BodyView, type PinSide } from '../components/BodyFigure';
import { SIDE_LABEL } from '../data/bodyRegions';
import { fileNoText, normalizePhone, toLatinDigits } from '../utils/phoneUtils';
import { splitName } from '../utils/patientImport';
import { fmtDate } from '../utils/format';
import { Icon } from '../utils/icons';
import type { Patient } from '../types';
import type { CurrentMed, ExamSheet, PendingPatient, Side } from './data';
import { DOCTOR_PREFIXES, REGION_SHEETS, TREATMENT, regionSummary, sheetFilled, type SheetId } from './regionSheets';
import { DxSheet } from './DxSheet';
import { raSummary } from './raScore';
import { nociSummary } from './NociChecklist';
import { dxSummary } from './dxCatalog';
import { medCatalog } from './clinicalLists';

// ---------- بنود الورقتين ----------
const N_VISIT = ['زيارة جديدة', 'متابعة'];
const N_GENDER = ['ذكر', 'أنثى'];
const N_MARITAL = ['أعزب', 'متزوج', 'مطلق', 'أرمل'];
// طلبات الدكتور (٦/١١): الوظيفة + النشاط في البيانات الأساسية، و«آنسة / مدام» و«حمل / رضاعة» للستات
const N_JOB = ['ست بيت', 'أعمال مكتبية', 'أعمال يدوية', 'لا يعمل', 'طفل'];
const N_ACTIVITY = ['بيمارس رياضة بشكل احترافي', 'بيمارس رياضة أحيانًا', 'مجهود كبير مؤخرًا'];
const N_MISS = ['آنسة', 'مدام'];
const N_PREG = ['لا يوجد', 'حمل', 'رضاعة'];
const N_HX_NONE = 'لا توجد أمراض معروفة';
const N_HX = [N_HX_NONE, 'ضغط الدم', 'السكر', 'الكوليسترول', 'أمراض القلب', 'أمراض الغدة الدرقية', 'أمراض الصدر / التنفسي', 'أمراض الكلى', 'أمراض المعدة / القولون', 'هشاشة العظام', 'أمراض روماتيزمية', 'أورام'];
const YES_NO = ['نعم', 'لا'];
const N_ALLERGY_NONE = 'لا توجد حساسية معروفة';
const N_ALLERGY = [N_ALLERGY_NONE, 'أدوية', 'أغذية'];
const N_CC = ['ألم', 'تورم', 'ضعف', 'تنميل / تيبّس', 'صعوبة في الحركة', 'إصابة حديثة', 'متابعة بعد علاج', 'متابعة عملية'];
// النوبات ومعدل تكررها (طلب الدكتور ٧/١١)
const N_EPISODE = ['ألم مستمر', 'على شكل نوبات'];
const N_EP_FREQ = ['يوميًا', 'عدة مرات في الأسبوع', 'أسبوعيًا', 'شهريًا', 'نادرًا'];
const N_SINCE = ['أقل من أسبوع', 'من أسبوع إلى 6 أسابيع', 'من 6 أسابيع إلى 3 أشهر', 'أكثر من 3 أشهر'];

const X_CC = ['Hip pain', 'Knee pain', 'Groin pain', 'Thigh pain', 'Buttock pain', 'Stiffness', 'Swelling', 'Giving way / Instability', 'Clicking / Locking', 'Difficulty walking', 'Difficulty sitting / squatting', 'Follow-up'];
const X_DUR = ['Acute (< 6 weeks)', 'Subacute (6-12 weeks)', 'Chronic (> 12 weeks)'];
const X_SIDE: [Side, string][] = [['right', 'Right'], ['left', 'Left'], ['both', 'Bilateral']];
const X_ONSET = ['Sudden', 'Gradual'];
const X_COURSE = ['Progressive', 'Recurrent', 'Static', 'Improving'];
const X_PREV = ['Medication', 'Physiotherapy', 'Injection', 'Surgery'];
const X_RF = ['History of malignancy', 'Unexplained weight loss', 'Fever / night pain', 'Recent significant trauma', 'Inability to bear weight', 'Severe mechanical symptoms (locking)', 'Neurovascular deficit', 'Signs of infection (redness, hotness)'];
const X_DERM: [root: string, area: string, color: string][] = [
  ['L1', 'Groin / upper thigh', '#9ccc65'], ['L2', 'Anterior thigh', '#f6d55c'], ['L3', 'Medial knee', '#66bb6a'],
  ['L4', 'Medial leg / medial foot', '#4db6ac'], ['L5', 'Dorsum of foot / big toe', '#64b5f6'], ['S1', 'Lateral foot / little toe', '#9f8be0'],
];
const X_PALP_HIP = ['No tenderness', 'ASIS', 'AIIS', 'Greater trochanter', 'Gluteal region', 'Groin tenderness', 'SI joint'];
const X_PALP_KNEE = ['No tenderness', 'Medial joint line', 'Lateral joint line', 'Patella / facet', 'Patellar tendon', 'Tibial tuberosity', 'Pes anserinus'];
const X_ROM_HIP: [string, string][] = [['Flexion', '0–120°'], ['Extension', '0–30°'], ['Abduction', '0–45°'], ['Adduction', '0–30°'], ['Internal rotation', '0–40°'], ['External rotation', '0–60°']];
const X_ROM_KNEE: [string, string][] = [['Flexion', '0–135°'], ['Extension', '0°']];
const X_PATMOB = ['Normal', 'Reduced'];
const X_SPROM = ['Patellar apprehension', 'Crepitus', 'Painful arc'];
const X_MRC: [string, string][] = [['L2', 'Hip flexion'], ['L3', 'Knee extension'], ['L4', 'Ankle dorsiflexion'], ['L5', 'Big toe extension'], ['S1', 'Ankle plantar flexion']];
const X_REFLEX: [string, string][] = [['Knee', 'L3–L4'], ['Ankle', 'S1']];
const X_REFLEX_V = ['Normal', 'Diminished', 'Absent'];
const X_ST_HIP = ['FABER test', 'FADIR test', 'Trendelenburg test', "Ober's test", 'Thomas test', 'Log roll test', 'Stinchfield test'];
const X_ST_KNEE = ['McMurray test', 'Thessaly test', 'Lachman test', 'Anterior drawer', 'Posterior drawer', 'Varus stress test', 'Valgus stress test', 'Patellar apprehension', 'Patellar grind test', 'Noble compression'];
const X_IMG = ['X-ray', 'MRI', 'CT', 'Ultrasound'];
const X_PLAN = ['Medication', 'Physiotherapy', 'Activity modification', 'Injection / Intervention', 'Brace / Support', 'Surgery (if indicated)'];
// نفس البنود لطباعة التشخيص (printDiagnosis) عشان الورقة المطبوعة تفضل مطابقة للشاشة
export const SHEET_LISTS = {
  N_VISIT, N_GENDER, N_MARITAL, N_JOB, N_ACTIVITY, N_MISS, N_PREG, N_HX, YES_NO, N_ALLERGY, N_CC, N_SINCE, N_EPISODE, N_EP_FREQ,
  X_CC, X_DUR, X_SIDE, X_ONSET, X_COURSE, X_PREV, X_RF, X_DERM, X_PALP_HIP, X_PALP_KNEE, X_ROM_HIP, X_ROM_KNEE,
  X_PATMOB, X_SPROM, X_MRC, X_REFLEX, X_ST_HIP, X_ST_KNEE, X_IMG, X_PLAN,
};

// ---------- البيانات ----------
export const emptySheet = (): ExamSheet => ({ on: [], txt: {}, meds: [], pain: [] });
// الكشوفات القديمة والنسخ المحفوظة على الجهاز قبل الشيت: sheet ناقص أو مش موجود
export function normSheet(s: unknown): ExamSheet {
  const x = (s && typeof s === 'object' ? s : {}) as Partial<ExamSheet>;
  return {
    on: Array.isArray(x.on) ? x.on : [],
    txt: x.txt && typeof x.txt === 'object' ? x.txt : {},
    meds: Array.isArray(x.meds) ? x.meds : [],
    pain: Array.isArray(x.pain) ? x.pain : [],
  };
}
// خانة 1 (البيانات الأساسية) و«زيارة جديدة / متابعة» بيتملوا تلقائي من ملف المريض أول ما الكشف يتفتح — مش محتوى
const BASIC_KEYS = ['n.name', 'n.age', 'n.phone', 'n.address'];
const isAutoOn = (o: string) => o.startsWith('n.visit|') || o.startsWith('n.gender|') || o.startsWith('n.job|') || o.startsWith('n.activity|');
export const sheetHasContent = (s: ExamSheet) =>
  s.on.some((o) => !isAutoOn(o)) || s.pain.length > 0 || s.meds.some((m) => m.name.trim())
  || Object.entries(s.txt).some(([k, v]) => !BASIC_KEYS.includes(k) && v.trim());
/** فيه حاجة اتكتبت في الشيت العام (غير اللي اتملى تلقائي من ملف المريض) */
export const nurseStarted = (s: ExamSheet) =>
  s.on.some((o) => o.startsWith('n.') && !isAutoOn(o)) || s.pain.length > 0 || s.meds.some((m) => m.name.trim())
  || Object.entries(s.txt).some(([k, v]) => k.startsWith('n.') && !BASIC_KEYS.includes(k) && v.trim());
/** فيه حاجة متكتبة في شيت الطبيب (عشان استكمال الكشف يفتح عليه على طول) */
export const doctorStarted = (s: ExamSheet) => DOCTOR_PREFIXES.some((p) => s.on.some((o) => o.startsWith(p + '.')) || Object.entries(s.txt).some(([k, v]) => k.startsWith(p + '.') && v.trim()));

const key = (g: string, item: string) => `${g}|${item}`;
const has = (s: ExamSheet, g: string, item: string) => s.on.includes(key(g, item));
const picked = (s: ExamSheet, g: string, items: string[]) => items.filter((i) => has(s, g, i));
const tx = (s: ExamSheet, k: string) => (s.txt[k] ?? '').trim();
// خانة «لا يوجد» (none) بتشيل باقي المجموعة، وأي بند تاني بيشيل «لا يوجد»
function toggleIn(x: ExamSheet, g: string, item: string, none?: string): ExamSheet {
  const k = key(g, item);
  if (x.on.includes(k)) return { ...x, on: x.on.filter((o) => o !== k) };
  const on = !none ? x.on : item === none ? x.on.filter((o) => !o.startsWith(g + '|')) : x.on.filter((o) => o !== key(g, none));
  return { ...x, on: [...on, k] };
}
// اختيار واحد بس من المجموعة (الضغط على المختار تاني بيلغيه)
function pickIn(x: ExamSheet, g: string, item: string): ExamSheet {
  const k = key(g, item);
  const rest = x.on.filter((o) => !o.startsWith(g + '|'));
  return { ...x, on: x.on.includes(k) ? rest : [...rest, k] };
}

/** رقم من خانة مكتوبة: أرقام عربي (٩٢) أو إنجليزي، والفاصلة العشرية «٫» أو «,» أو «.» */
const numOf = (v: string) => parseFloat(toLatinDigits(v).replace(/[٫,،]/g, '.').replace(/[^\d.]/g, ''));
// بيتحسب على الجهاز نفسه من الوزن والطول (من غير نت). الطول بالسنتيمتر (170) أو بالمتر (1.70)
export function bmiOf(s: ExamSheet) {
  const w = numOf(tx(s, 'n.wt')), raw = numOf(tx(s, 'n.ht'));
  const h = raw > 0 && raw < 3 ? raw : raw / 100;
  return w > 0 && h > 0.5 && h < 2.6 ? (w / (h * h)).toFixed(1) : '';
}
// تصنيف الـBMI للكبار — «التقسيم السريع للاستخدام في العيادة» اللي بعته الدكتور (٦/١١)
export type BmiTone = 'info' | 'ok' | 'warn' | 'danger';
export type BmiClass = { label: string; tone: BmiTone; ar: string; detail: string; ortho?: string };
// جدول WHO للبالغين (١٨+) — الحد الأدنى لكل فئة
export const BMI_BANDS: { min: number; label: string; tone: BmiTone; ar: string; detail: string; ortho?: string }[] = [
  { min: 0, label: 'Underweight', tone: 'danger', ar: 'نحافة شديدة', detail: 'Severe thinness (<16)', ortho: 'راجع التغذية وكثافة العظام (هشاشة) — خطر أعلى لكسور الهشاشة وتأخر التئام الجروح' },
  { min: 16, label: 'Underweight', tone: 'info', ar: 'نحافة متوسطة', detail: 'Moderate thinness (16–16.9)', ortho: 'راجع التغذية وكثافة العظام — خطر كسور الهشاشة' },
  { min: 17, label: 'Underweight', tone: 'info', ar: 'نحافة بسيطة', detail: 'Mild thinness (17–18.4)' },
  { min: 18.5, label: 'Normal', tone: 'ok', ar: 'وزن طبيعي', detail: 'Normal (18.5–24.9)' },
  { min: 25, label: 'Overweight', tone: 'warn', ar: 'زيادة وزن', detail: 'Overweight (25–29.9)', ortho: 'زيادة الحمل على الركبة والفخذ — إنقاص الوزن جزء من علاج الخشونة' },
  { min: 30, label: 'Obesity I', tone: 'danger', ar: 'سمنة درجة أولى', detail: 'Obesity class I (30–34.9)', ortho: 'خطر أعلى لخشونة الركبة — يُنصح ببرنامج إنقاص وزن قبل أي جراحة اختيارية' },
  { min: 35, label: 'Obesity II', tone: 'danger', ar: 'سمنة درجة ثانية', detail: 'Obesity class II (35–39.9)', ortho: 'مضاعفات أعلى في تغيير المفاصل (TKA/THA): عدوى، جلطات، مشاكل الجرح — تحسين الوزن قبل الجراحة' },
  { min: 40, label: 'Obesity III', tone: 'danger', ar: 'سمنة مفرطة درجة ثالثة', detail: 'Obesity class III (≥40)', ortho: 'خطر مرتفع جدًا لمضاعفات TKA/THA — كثير من المراكز تؤجل الجراحة الاختيارية حتى BMI < 40' },
];
export function bmiClass(bmi: string): BmiClass | null {
  const b = parseFloat(bmi);
  if (!(b > 0)) return null;
  return [...BMI_BANDS].reverse().find((x) => b >= x.min)!;
}
/** «25.7 — Overweight» */
export const bmiText = (s: ExamSheet) => { const b = bmiOf(s), c = bmiClass(b); return b ? (c ? `${b} — ${c.label}` : b) : ''; };
export const painLabel = (k: string) => {
  const [id, sd] = k.split(':');
  const r = regionById(id);
  return r ? `${r.name}${sd ? ' ' + SIDE_LABEL[sd as 'right' | 'left'] : ''}` : k;
};
function ageOf(birth?: string | null) {
  if (!birth) return '';
  const b = new Date(birth + 'T00:00:00');
  if (isNaN(b.getTime())) return '';
  const n = new Date();
  let y = n.getFullYear() - b.getFullYear();
  if (n.getMonth() < b.getMonth() || (n.getMonth() === b.getMonth() && n.getDate() < b.getDate())) y--;
  return y >= 0 ? String(y) : '';
}

// خانة 1 بتبدأ ببيانات ملف المريض (الخانات اللي لسه ما اتكتبتش في الشيت بس)
export function withPatientBasics(s: ExamSheet, p?: Patient | null): ExamSheet {
  if (!p) return s;
  const txt = { ...s.txt };
  const fill = (k: string, v: string) => { if (!(k in txt)) txt[k] = v; };
  fill('n.name', p.fullName ?? ''); fill('n.age', ageOf(p.birthDate)); fill('n.phone', p.phone ?? ''); fill('n.address', p.address ?? '');
  const g = p.genderUnknown ? '' : p.gender === 'male' ? 'ذكر' : p.gender === 'female' ? 'أنثى' : '';
  let on = g && !s.on.some((o) => o.startsWith('n.gender|')) ? [...s.on, key('n.gender', g)] : s.on;
  // الوظيفة والنشاط من ملف المريض (لو لسه ما اتختارش حاجة منهم في الشيت)
  for (const [grp, vals] of [['n.job', p.occupation], ['n.activity', p.activity]] as const)
    if (vals?.length && !on.some((o) => o.startsWith(grp + '|'))) on = [...on, ...vals.map((v) => key(grp, v))];
  return { ...s, txt, on };
}
/** مريض تاني اتختار في الكشف: خانة 1 بتتملى من ملفه هو */
export function resetPatientBasics(s: ExamSheet, p?: Patient | null): ExamSheet {
  const txt = Object.fromEntries(Object.entries(s.txt).filter(([k]) => !BASIC_KEYS.includes(k)));
  return withPatientBasics({ ...s, txt, on: s.on.filter((o) => !o.startsWith('n.gender|') && !o.startsWith('n.job|') && !o.startsWith('n.activity|')) }, p);
}

// اللي اتعدّل في خانة 1 ← ملف المريض (بيتبعت بعد حفظ الكشف). السن بيتحوّل لتاريخ ميلاد (نفس اليوم والشهر لو متسجلين).
// since = الشيت وقت ما الكشف اتفتح: الخانات اللي ما اتلمستش ما بتتبعتش (تعديل كشف قديم مايرجّعش بيانات قديمة للملف)
const genderOf = (s: ExamSheet) => (has(s, 'n.gender', 'ذكر') ? 'male' : has(s, 'n.gender', 'أنثى') ? 'female' : null);
export function sheetPatientPatch(s: ExamSheet, p: Patient, since?: ExamSheet): { patch: Partial<Patient>; badPhone: boolean } {
  const changed = (k: string) => !since || tx(s, k) !== tx(since, k);
  const patch: Partial<Patient> = {};
  const name = tx(s, 'n.name').replace(/\s+/g, ' ');
  if (changed('n.name') && name && name !== (p.fullName ?? '').trim()) Object.assign(patch, { fullName: name, ...splitName(name) });
  if (changed('n.address') && 'n.address' in s.txt && tx(s, 'n.address') !== (p.address ?? '').trim()) patch.address = tx(s, 'n.address');
  const g = genderOf(s);
  if ((!since || genderOf(since) !== g) && g && (g !== p.gender || p.genderUnknown)) patch.gender = g;
  for (const [grp, items, field] of [['n.job', N_JOB, 'occupation'], ['n.activity', N_ACTIVITY, 'activity']] as const) {
    const now = picked(s, grp, items), was = since ? picked(since, grp, items) : null;
    if ((was ? was.join('|') !== now.join('|') : now.length > 0) && now.join('|') !== (p[field] ?? []).join('|')) patch[field] = now;
  }
  let badPhone = false;
  const phone = tx(s, 'n.phone');
  if (changed('n.phone') && phone && phone !== p.phone) {
    const e164 = normalizePhone(phone);
    if (!e164) badPhone = true; else if (e164 !== p.phone) patch.phone = e164;
  }
  const age = parseInt(toLatinDigits(tx(s, 'n.age')), 10);
  if (changed('n.age') && age >= 0 && age < 120 && String(age) !== ageOf(p.birthDate)) {
    const md = /^\d{4}-(\d{2}-\d{2})$/.exec(p.birthDate ?? '')?.[1] ?? '01-01';
    const y = new Date().getFullYear() - age;
    patch.birthDate = ageOf(`${y}-${md}`) === String(age) ? `${y}-${md}` : `${y - 1}-${md}`;
  }
  return { patch, badPhone };
}

/** بيانات خانة 1 لتشخيص من غير ملف مريض (هجرة 924) — الخادم بيطابق بيها ملف الاستقبال */
export function pendingFromSheet(s: ExamSheet): PendingPatient {
  const g = genderOf(s);
  return { name: tx(s, 'n.name').replace(/\s+/g, ' '), phone: toLatinDigits(tx(s, 'n.phone')), age: toLatinDigits(tx(s, 'n.age')), gender: g ?? '' };
}
/** الاسم ثلاثي على الأقل */
export const isTripleName = (n: string) => n.trim().split(/\s+/).filter(Boolean).length >= 3;

// ---------- الملخص النصي (اللي بيتحفظ في حقول الكشف) ----------
const join = (xs: (string | false | undefined)[], sep = ', ') => xs.filter(Boolean).join(sep);
const sec = (name: string, xs: string[]) => { const t = join(xs); return t ? `${name}: ${t}` : ''; };
const rtLt = (s: ExamSheet, k: string, unit = '') => {
  const r = tx(s, k + '.rt'), l = tx(s, k + '.lt');
  return join([r && `Rt ${r}${unit}`, l && `Lt ${l}${unit}`], ' / ');
};

// side = جهة الكشف (للشيتات حسب المنطقة)؛ شيت الورك والركبة + شيت كل منطقة اتكتب فيها بيتجمعوا في نفس الملخص
export function sheetSummary(s: ExamSheet, side: Side = 'na') {
  const xcc = join([...picked(s, 'x.cc', X_CC), tx(s, 'x.cc.other')]);
  const dur = picked(s, 'x.dur', X_DUR)[0];
  const ncc = join([...picked(s, 'n.cc', N_CC), tx(s, 'n.cc.other'), tx(s, 'n.cc.text')], '، ');
  const pain = s.pain.map(painLabel).join('، ');
  const since = picked(s, 'n.since', N_SINCE)[0];
  const regions = REGION_SHEETS.filter((d) => sheetFilled(s, d.id as SheetId)).map((d) => ({ d, r: regionSummary(d, s, side) }));
  const multi = regions.length + (sheetFilled(s, 'hipknee') ? 1 : 0) > 1;
  const tag = (label: string, t: string) => (t && multi ? `[${label}] ${t}` : t);
  const doctorCc = join([xcc && join([xcc, dur], ' — '), ...regions.map(({ d, r }) => r.complaint && tag(d.tab, r.complaint))], ' · ');
  const complaint = doctorCc || (ncc ? join([ncc, pain], ' — ') : '');

  const meds = s.meds.filter((m) => m.name.trim()).map((m) => join([m.name.trim(), m.dose.trim(), m.freq.trim()], ' ')).join('، ');
  const allergy = join([...picked(s, 'n.allergy', N_ALLERGY), tx(s, 'n.allergy.other')], '، ');
  const injury = picked(s, 'n.injury', YES_NO)[0];
  const onset = picked(s, 'x.onset', X_ONSET)[0], course = picked(s, 'x.course', X_COURSE)[0];
  const prev = join([...picked(s, 'x.prev', X_PREV), tx(s, 'x.prev.other')]);
  const rf = join([...picked(s, 'x.rf', X_RF), tx(s, 'x.rf.other')]);
  const female = has(s, 'n.gender', 'أنثى');
  const job = join(picked(s, 'n.job', N_JOB), '، '), activity = join(picked(s, 'n.activity', N_ACTIVITY), '، ');
  const miss = female ? picked(s, 'n.miss', N_MISS)[0] : '', preg = female ? picked(s, 'n.preg', N_PREG)[0] : '';
  const history = join([
    job && `الوظيفة: ${job}`,
    activity && `النشاط: ${activity}`,
    miss && `الحالة: ${miss}`,
    picked(s, 'n.married', YES_NO)[0] && `متزوج: ${picked(s, 'n.married', YES_NO)[0]}`,
    tx(s, 'n.son') && `اسم الابن الكبير: ${tx(s, 'n.son')}`,
    tx(s, 'n.notes') && `ملاحظات: ${tx(s, 'n.notes')}`,
    preg && preg !== 'لا يوجد' && `⚠ ${preg}`,
    tx(s, 'n.onset') && `بداية المشكلة: ${tx(s, 'n.onset')}`,
    pain && `مكان الألم: ${pain}`,
    since && `منذ: ${since}`,
    (() => {
      const ep = picked(s, 'n.episode', N_EPISODE)[0];
      if (!ep) return '';
      if (ep !== 'على شكل نوبات') return `طبيعة الألم: ${ep}`;
      return `نوبات: ${join([picked(s, 'n.ep.freq', N_EP_FREQ)[0], tx(s, 'n.ep.count') && `${tx(s, 'n.ep.count')} نوبة`, tx(s, 'n.ep.dur') && `مدة النوبة ${tx(s, 'n.ep.dur')}`], ' — ')}`;
    })(),
    injury && `إصابة حديثة: ${join([injury, tx(s, 'n.injury.what')], ' — ')}`,
    tx(s, 'n.done') && `ما تم حتى الآن: ${tx(s, 'n.done')}`,
    sec('الأمراض المزمنة', [...picked(s, 'n.hx', N_HX), tx(s, 'n.hx.other')]),
    picked(s, 'n.smoke', YES_NO)[0] && `التدخين: ${picked(s, 'n.smoke', YES_NO)[0]}`,
    meds && `أدوية حالية: ${meds}`,
    (allergy || tx(s, 'n.allergy.details')) && `الحساسية: ${join([allergy, tx(s, 'n.allergy.details')], ' — ')}`,
    join([onset && `Onset: ${onset}`, course && `Course: ${course}`], ' · '),
    tx(s, 'x.aggr') && `Aggravating: ${tx(s, 'x.aggr')}`,
    tx(s, 'x.reliev') && `Relieving: ${tx(s, 'x.reliev')}`,
    prev && `Previous treatment: ${prev}`,
    rf && `⚠ Red flags: ${rf}`,
  ], '\n');

  const bp = join([tx(s, 'n.bp.sys'), tx(s, 'n.bp.dia')], '/');
  const bmi = bmiText(s);
  const vitals = join([
    bp && `BP ${bp} mmHg`, tx(s, 'n.pulse') && `Pulse ${tx(s, 'n.pulse')}/min`, tx(s, 'n.temp') && `Temp ${tx(s, 'n.temp')}°C`,
    tx(s, 'n.rr') && `RR ${tx(s, 'n.rr')}/min`, tx(s, 'n.wt') && `Wt ${tx(s, 'n.wt')} kg`, tx(s, 'n.ht') && `Ht ${tx(s, 'n.ht')} cm`, bmi && `BMI ${bmi}`,
  ], ' · ');
  const rom = (joint: string, rows: [string, string][]) => join(rows.map(([m]) => { const v = rtLt(s, `x.rom.${joint}.${m}`, '°'); return v && `${m} ${v}`; }));
  const patmob = picked(s, 'x.patmob', X_PATMOB)[0];
  const derm = X_DERM.flatMap(([r]) => ['Rt', 'Lt'].filter((sd) => has(s, 'x.derm', `${r} ${sd}`)).map((sd) => `${r} ${sd}`));
  const img = join([
    ...X_IMG.filter((m) => has(s, 'x.img', m) || tx(s, `x.img.${m}`)).map((m) => join([`${m}:`, tx(s, `x.img.${m}`), tx(s, `x.img.${m}.date`) && `(${tx(s, `x.img.${m}.date`)})`], ' ')),
    tx(s, 'x.img.prev') && `Previous: ${tx(s, 'x.img.prev')}`, tx(s, 'x.img.other'),
  ], '; ');
  const lines: [string, string][] = [
    ['Vitals', vitals],
    ['Palpation', join([sec('Hip', [...picked(s, 'x.palp.hip', X_PALP_HIP), tx(s, 'x.palp.hip.other')]), sec('Knee', [...picked(s, 'x.palp.knee', X_PALP_KNEE), tx(s, 'x.palp.knee.other')])], '; ')],
    ['Hip ROM', rom('hip', X_ROM_HIP)],
    ['Knee ROM', rom('knee', X_ROM_KNEE)],
    ['Special ROM', join([patmob && `Patellar mobility ${patmob.toLowerCase()}`, ...picked(s, 'x.sprom', X_SPROM), tx(s, 'x.sprom.other')])],
    ['Power (MRC)', join(X_MRC.map(([r]) => { const v = rtLt(s, `x.mrc.${r}`, '/5'); return v && `${r} ${v}`; }))],
    ['Reflexes', join(X_REFLEX.map(([n]) => { const v = rtLt(s, `x.refl.${n}`); return v && `${n} ${v}`; }))],
    ['Reduced sensation', join(derm)],
    ['Special tests +ve', join([sec('Hip', [...picked(s, 'x.st.hip', X_ST_HIP), tx(s, 'x.st.hip.other')]), sec('Knee', [...picked(s, 'x.st.knee', X_ST_KNEE), tx(s, 'x.st.knee.other')])], '; ')],
    ['Imaging', img],
  ];
  const examination = join([...lines.map(([l, v]) => v && `${l} — ${v}`), tx(s, 'x.notes'), ...regions.flatMap(({ d, r }) => r.examination.map((t) => tag(d.tab, t))), raSummary(s), nociSummary(s)], '\n');

  const diagnosis = join([dxSummary('x', 'hipknee', (g, i) => has(s, g, i), (k) => tx(s, k)), ...regions.map(({ d, r }) => r.diagnosis && tag(d.tab, r.diagnosis))], ' · ');
  const plan = join([...picked(s, 'x.plan', X_PLAN), tx(s, 'x.plan.fu') && `Follow up after ${tx(s, 'x.plan.fu')}`, tx(s, 'x.plan.other'), ...regions.map(({ d, r }) => r.plan && tag(d.tab, r.plan)), regionSummary(TREATMENT, s, side).plan]);
  return { complaint, history: join([history, ...regions.flatMap(({ d, r }) => r.history.map((t) => tag(d.tab, t)))], '\n'), examination, diagnosis, plan };
}

// ---------- عناصر الشيت ----------
type Change = (f: (s: ExamSheet) => ExamSheet) => void;
export function sheetApi(s: ExamSheet, onChange: Change) {
  return {
    has: (g: string, i: string) => has(s, g, i),
    toggle: (g: string, i: string, none?: string) => onChange((x) => toggleIn(x, g, i, none)),
    pick: (g: string, i: string) => onChange((x) => pickIn(x, g, i)),
    txt: (k: string) => s.txt[k] ?? '',
    set: (k: string, v: string) => onChange((x) => ({ ...x, txt: { ...x.txt, [k]: v } })),
  };
}
export type Api = ReturnType<typeof sheetApi>;

export function Box({ n, title, tone, wide, children }: { n: number; title: ReactNode; tone?: 'red'; wide?: boolean; children: ReactNode }) {
  return (
    <section className={`sh-box${tone ? ' sh-box--red' : ''}${wide ? ' sh-box--wide' : ''}`}>
      <h3 className="sh-box__h"><span className="sh-box__n">{n}</span>{title}</h3>
      <div className="sh-box__b">{children}</div>
    </section>
  );
}
export function Ck({ on, onToggle, children }: { on: boolean; onToggle: () => void; children: ReactNode }) {
  return <label className={`sh-ck${on ? ' is-on' : ''}`}><input type="checkbox" checked={on} onChange={onToggle} /><span>{children}</span></label>;
}
export function Checks({ a, g, items, none }: { a: Api; g: string; items: string[]; none?: string }) {
  return <>{items.map((i) => <Ck key={i} on={a.has(g, i)} onToggle={() => a.toggle(g, i, none)}>{i}</Ck>)}</>;
}
export function Pick({ a, g, items }: { a: Api; g: string; items: string[] }) {
  return <>{items.map((i) => <Ck key={i} on={a.has(g, i)} onToggle={() => a.pick(g, i)}>{i}</Ck>)}</>;
}
export function Row({ label, children }: { label: string; children: ReactNode }) {
  return <div className="sh-row"><b className="sh-row__l">{label}</b>{children}</div>;
}
export function Txt({ a, k, label, unit, num, stack, ...rest }: { a: Api; k: string; label?: string; unit?: string; num?: boolean; stack?: boolean; placeholder?: string; dir?: 'ltr' | 'auto'; inputMode?: 'tel' | 'decimal' }) {
  const input = (
    <input className={`sh-in${num ? ' sh-in--num' : ''}`} dir={num ? 'ltr' : rest.dir ?? 'auto'} inputMode={num ? 'decimal' : rest.inputMode}
      placeholder={rest.placeholder} aria-label={label ?? rest.placeholder} value={a.txt(k)} onChange={(e) => a.set(k, e.target.value)} />
  );
  if (!label) return input;
  return <label className={`sh-line${stack ? ' sh-line--stack' : ''}`}><span className="sh-line__l">{label}</span>{input}{unit && <span className="sh-unit">{unit}</span>}</label>;
}

// ---------- الشيت العام ----------
export function NursingSheet({ sheet, onChange, patient, date, visitNo, painScore, onPainScore, onFirstPain }: {
  sheet: ExamSheet; onChange: Change; patient?: Patient | null; date: string; visitNo: number;
  painScore: number | ''; onPainScore: (v: number | '') => void;
  /** أول مكان ألم يتعلّم على الجسم ← المنطقة والجهة بتوع الكشف */
  onFirstPain: (regionId: string, side: PinSide) => void;
}) {
  const a = sheetApi(sheet, onChange);
  const [view, setView] = useState<BodyView>('front');
  const [hovered, setHovered] = useState<string | null>(null);
  const bmi = bmiOf(sheet);
  const bmiCls = bmiClass(bmi);
  const female = a.has('n.gender', 'أنثى');
  const togglePain = (id: string, side: PinSide) => {
    const k = side ? `${id}:${side}` : id;
    if (!sheet.pain.length) onFirstPain(id, side);
    onChange((x) => ({ ...x, pain: x.pain.includes(k) ? x.pain.filter((p) => p !== k) : [...x.pain, k] }));
  };
  const setMed = (i: number, patch: Partial<CurrentMed>) => onChange((x) => ({ ...x, meds: x.meds.map((m, j) => (j === i ? { ...m, ...patch } : m)) }));
  const pickMed = (i: number, name: string) => {
    const p = medCatalog().find((x) => x.name === name);
    const cur = sheet.meds[i];
    setMed(i, p ? { name, dose: cur.dose || p.dose, freq: cur.freq || p.frequency } : { name });
  };

  return (
    <div className="sh" dir="rtl">
      <div className="sh-bar">
        <div className="sh-inline"><Pick a={a} g="n.visit" items={N_VISIT} /></div>
        <span>اسم المريض: <b>{patient?.fullName || '—'}</b></span>
        <span>رقم الملف: <b className="num">{fileNoText(patient?.fileNo) || '—'}</b></span>
        <span>رقم الزيارة: <b className="num">{visitNo}</b></span>
        <span>التاريخ: <b className="num">{fmtDate(date)}</b></span>
      </div>
      <div className="sh-grid sh-grid--2">
        <Box n={1} title="البيانات الأساسية">
          <Txt a={a} k="n.name" label="الاسم" />
          <Txt a={a} k="n.age" label="السن" unit="سنة" num />
          <Row label="النوع"><Pick a={a} g="n.gender" items={N_GENDER} /></Row>
          {female && <Row label="الحالة"><Pick a={a} g="n.miss" items={N_MISS} /></Row>}
          {female && <Row label="حمل أو رضاعة"><Pick a={a} g="n.preg" items={N_PREG} /></Row>}
          <Row label="متزوج"><Pick a={a} g="n.married" items={YES_NO} /></Row>
          <Txt a={a} k="n.son" label="اسم الابن الكبير" />
          <Txt a={a} k="n.address" label="العنوان" />
          <div className="sh-lbl">الوظيفة</div>
          <div className="sh-inline"><Checks a={a} g="n.job" items={N_JOB} /></div>
          <div className="sh-lbl">النشاط البدني</div>
          <div className="sh-inline"><Checks a={a} g="n.activity" items={N_ACTIVITY} /></div>
          <div className="sh-lbl">ملاحظات</div>
          <textarea className="sh-in sh-notes" dir="auto" rows={3} aria-label="ملاحظات" value={a.txt('n.notes')} onChange={(e) => a.set('n.notes', e.target.value)} />
        </Box>

        <Box n={2} title="العلامات الحيوية والقياسات">
          <div className="sh-line">
            <span className="sh-line__l">ضغط الدم</span>
            <Txt a={a} k="n.bp.sys" placeholder="الانقباضي" num /><span className="sh-unit">/</span><Txt a={a} k="n.bp.dia" placeholder="الانبساطي" num />
            <span className="sh-unit">mmHg</span>
          </div>
          <Txt a={a} k="n.pulse" label="النبض" unit="/ دقيقة" num />
          <Txt a={a} k="n.temp" label="درجة الحرارة" unit="°C" num />
          <Txt a={a} k="n.rr" label="معدل التنفس" unit="/ دقيقة" num />
          <Txt a={a} k="n.wt" label="الوزن" unit="كجم" num />
          <Txt a={a} k="n.ht" label="الطول" unit="سم" num />
          <div className="sh-line"><span className="sh-line__l">مؤشر كتلة الجسم (BMI)</span><output className={`sh-bmi num${bmiCls ? ` sh-bmi--${bmiCls.tone}` : ''}`}>{bmi || '—'}{bmiCls && <small className="sh-bmi__c">{bmiCls.label}</small>}</output></div>
          {bmiCls && (() => {
            const age = numOf(a.txt('n.age'));
            const child = age > 0 && age < 18;
            const pct = Math.min(100, Math.max(0, ((parseFloat(bmi) - 14) / (45 - 14)) * 100));
            return (
              <div className="sh-bmi-info">
                {child
                  ? <div className="sh-bmi-info__warn">⚠ المريض أقل من ١٨ سنة — التصنيف ده للبالغين؛ استخدم BMI-for-age percentiles حسب السن والنوع</div>
                  : <>
                      <div className="sh-bmi-scale" aria-hidden><i style={{ insetInlineStart: `${pct}%` }} /></div>
                      <div className="sh-bmi-info__t"><b>{bmiCls.ar}</b> · <span dir="ltr">{bmiCls.detail}</span></div>
                      {bmiCls.ortho && <div className="sh-bmi-info__o">🦴 {bmiCls.ortho}</div>}
                    </>}
              </div>
            );
          })()}
          <details className="sh-bmi-ref">
            <summary>جدول تصنيف BMI للبالغين (WHO)</summary>
            <table>
              <thead><tr><th>BMI (kg/m²)</th><th>التصنيف</th><th>للعيادة</th></tr></thead>
              <tbody>
                {BMI_BANDS.map((b, i) => {
                  const next = BMI_BANDS[i + 1]?.min;
                  const range = i === 0 ? 'أقل من 16' : next ? `${b.min} – ${(next - 0.1).toFixed(1)}` : `${b.min} أو أكثر`;
                  const cur = bmiCls && bmiCls.detail === b.detail;
                  return <tr key={b.detail} className={cur ? `is-cur sh-bmi--${b.tone}` : undefined}><td className="num" dir="ltr">{range}</td><td>{b.ar} <span dir="ltr" className="muted-sm">({b.detail.replace(/ \(.*\)$/, '')})</span></td><td dir="ltr">{b.label}</td></tr>;
                })}
              </tbody>
            </table>
            <div className="sh-bmi-ref__f">المعادلة: <span dir="ltr">BMI = الوزن (kg) ÷ الطول² (m)</span> — مثال: <span dir="ltr">90 ÷ 1.75² = 29.4</span> ← Overweight</div>
            <div className="sh-bmi-ref__f">الحدود دي للبالغين (١٨ سنة فأكثر)؛ الأطفال والمراهقين بـ BMI-for-age percentiles حسب السن والنوع. في مرضى العظام بيتقرا الرقم مع مخاطر خشونة الركبة ومضاعفات تغيير المفاصل (TKA/THA)، مش لوحده.</div>
          </details>
        </Box>

        <Box n={3} title="التاريخ المرضي المعروف">
          <div className="sh-cols"><Checks a={a} g="n.hx" items={N_HX} none={N_HX_NONE} /></div>
          <Row label="التدخين"><Pick a={a} g="n.smoke" items={YES_NO} /></Row>
          <Txt a={a} k="n.hx.other" label="أخرى" />
        </Box>

        <Box n={4} title="الأدوية الحالية والحساسية">
          <div className="sh-lbl">الأدوية الحالية</div>
          {sheet.meds.length > 0 && (
            <div className="sh-meds">
              <span>اسم الدواء</span><span>الجرعة</span><span>عدد المرات</span><span />
              {sheet.meds.map((m, i) => [
                <input key={`n${i}`} className="sh-in" dir="auto" aria-label="اسم الدواء" list="sh-meds" value={m.name} onChange={(e) => pickMed(i, e.target.value)} />,
                <input key={`d${i}`} className="sh-in" dir="auto" aria-label="الجرعة" value={m.dose} onChange={(e) => setMed(i, { dose: e.target.value })} />,
                <input key={`f${i}`} className="sh-in" dir="auto" aria-label="عدد المرات" value={m.freq} onChange={(e) => setMed(i, { freq: e.target.value })} />,
                <button key={`x${i}`} type="button" className="sh-x" aria-label="حذف الدواء" onClick={() => onChange((x) => ({ ...x, meds: x.meds.filter((_, j) => j !== i) }))}><Icon name="close" size={14} /></button>,
              ])}
            </div>
          )}
          {/* اقتراحات من قسم «الأدوية» */}
          <datalist id="sh-meds">{medCatalog().map((p) => <option key={p.name} value={p.name}>{p.group}</option>)}</datalist>
          <button type="button" className="sh-add" onClick={() => onChange((x) => ({ ...x, meds: [...x.meds, { name: '', dose: '', freq: '' }] }))}><Icon name="plus" size={14} /> إضافة دواء</button>
          <div className="sh-lbl">الحساسية</div>
          <Checks a={a} g="n.allergy" items={N_ALLERGY} none={N_ALLERGY_NONE} />
          <Txt a={a} k="n.allergy.other" label="مواد أخرى" />
          <Txt a={a} k="n.allergy.details" label="التفاصيل" />
        </Box>

        <Box n={5} wide title="سبب الزيارة الحالية وتفاصيل المشكلة">
          <div className="sh-visit">
            <div>
              <div className="sh-lbl">الشكوى</div>
              <Checks a={a} g="n.cc" items={N_CC} />
              <Txt a={a} k="n.cc.other" label="أخرى" />
              <div className="sh-lbl">شكوى المريض (كتابةً)</div>
              <textarea className="sh-in sh-in--area" dir="auto" rows={3} aria-label="شكوى المريض كتابةً" placeholder="اكتب شكوى المريض بكلامه…" value={a.txt('n.cc.text')} onChange={(e) => a.set('n.cc.text', e.target.value)} />
            </div>

            <div>
              <div className="sh-lbl">شدة الألم حاليًا (من 10) {painScore !== '' && <b className="cx-pain-val num">{painScore}/10</b>}</div>
              <div className="cx-pain" role="radiogroup" aria-label="شدة الألم">
                {Array.from({ length: 11 }, (_, n) => (
                  <button key={n} type="button" role="radio" aria-checked={painScore === n} className={`cx-pain__b cx-pain__b--${n <= 3 ? 'lo' : n <= 6 ? 'mid' : 'hi'} ${painScore === n ? 'is-on' : ''}`}
                    onClick={() => onPainScore(painScore === n ? '' : n)}>{n}</button>
                ))}
              </div>
              <div className="sh-scale"><span>لا يوجد ألم</span><span>ألم متوسط</span><span>ألم شديد</span></div>
              <div className="sh-lbl">منذ متى؟</div>
              <div className="sh-inline"><Pick a={a} g="n.since" items={N_SINCE} /></div>
              <div className="sh-lbl">النوبات</div>
              <div className="sh-inline"><Pick a={a} g="n.episode" items={N_EPISODE} /></div>
              {a.has('n.episode', 'على شكل نوبات') && <>
                <div className="sh-lbl">معدل تكرر النوبات</div>
                <div className="sh-inline"><Pick a={a} g="n.ep.freq" items={N_EP_FREQ} /></div>
                <Txt a={a} k="n.ep.count" label="عدد النوبات" unit="في الفترة دي" num />
                <Txt a={a} k="n.ep.dur" label="مدة النوبة" placeholder="مثلاً: ساعتين" />
              </>}
              <Txt a={a} k="n.onset" label="بداية المشكلة / كيفية حدوثها" stack />
              <Row label="هل توجد إصابة حديثة؟"><Pick a={a} g="n.injury" items={YES_NO} /></Row>
              {a.has('n.injury', 'نعم') && <Txt a={a} k="n.injury.what" label="إذا نعم، ما هي؟" stack />}
              <Txt a={a} k="n.done" label="ماذا تم عمله حتى الآن؟ (علاج / جبس / عملية / زيارات …)" stack />
            </div>
          </div>
        </Box>
      </div>
    </div>
  );
}

// ---------- شيت كشف الورك والركبة ----------
function RomTable({ a, joint, title, rows }: { a: Api; joint: string; title: string; rows: [string, string][] }) {
  return (
    <table className="sh-tbl">
      <thead><tr><th>{title}</th><th>Normal</th><th>Rt.</th><th>Lt.</th></tr></thead>
      <tbody>
        {rows.map(([m, normal]) => (
          <tr key={m}>
            <td>{m}</td><td className="num">{normal}</td>
            {['rt', 'lt'].map((sd) => (
              <td key={sd}><input className="sh-in" dir="ltr" inputMode="numeric" aria-label={`${title} ${m} ${sd}`} value={a.txt(`x.rom.${joint}.${m}.${sd}`)} onChange={(e) => a.set(`x.rom.${joint}.${m}.${sd}`, e.target.value)} /></td>
            ))}
          </tr>
        ))}
      </tbody>
    </table>
  );
}
export function SelCell({ a, k, label, options }: { a: Api; k: string; label: string; options: [string, string][] }) {
  return (
    <td>
      <select className="sh-sel" aria-label={label} value={a.txt(k)} onChange={(e) => a.set(k, e.target.value)}>
        <option value="">–</option>
        {options.map(([v, l]) => <option key={v} value={v}>{l}</option>)}
      </select>
    </td>
  );
}
export const MRC_OPTS: [string, string][] = [0, 1, 2, 3, 4, 5].map((n) => [String(n), `${n}/5`]);
export const REFLEX_OPTS: [string, string][] = X_REFLEX_V.map((v) => [v, v]);

export function DoctorSheet({ sheet, onChange, side, onSide, icd10, onIcd10, onOpenMap }: {
  sheet: ExamSheet; onChange: Change; side: Side; onSide: (s: Side) => void;
  icd10: string; onIcd10: (v: string) => void; onOpenMap: () => void;
}) {
  const a = sheetApi(sheet, onChange);
  return (
    <div className="sh" dir="ltr">
      <div className="sh-grid sh-grid--3">
        <Box n={1} title="Chief Complaint">
          <div className="sh-split">
            <div><Checks a={a} g="x.cc" items={X_CC} /><Txt a={a} k="x.cc.other" label="Other:" /></div>
            <div><div className="sh-lbl">Duration:</div><Pick a={a} g="x.dur" items={X_DUR} /></div>
          </div>
        </Box>

        <Box n={2} title="History of Present Illness">
          <Row label="Side:">{X_SIDE.map(([v, l]) => <Ck key={v} on={side === v} onToggle={() => onSide(side === v ? 'na' : v)}>{l}</Ck>)}</Row>
          <Row label="Onset:"><Pick a={a} g="x.onset" items={X_ONSET} /></Row>
          <Row label="Course:"><Pick a={a} g="x.course" items={X_COURSE} /></Row>
          <Txt a={a} k="x.aggr" label="Aggravating factors:" stack />
          <Txt a={a} k="x.reliev" label="Relieving factors:" stack />
          <div className="sh-lbl">Previous treatment:</div>
          <div className="sh-inline"><Checks a={a} g="x.prev" items={X_PREV} /></div>
          <Txt a={a} k="x.prev.other" label="Other:" />
        </Box>

        <Box n={3} tone="red" title={<><Icon name="alert" size={15} /> Red Flags</>}>
          <Checks a={a} g="x.rf" items={X_RF} />
          <Txt a={a} k="x.rf.other" label="Others:" />
        </Box>

        <Box n={4} title="Dermatomes (Sensation Map)">
          <table className="sh-tbl">
            <thead><tr><th>Root</th><th>Key area</th><th>Rt.</th><th>Lt.</th></tr></thead>
            <tbody>
              {X_DERM.map(([r, area, color]) => (
                <tr key={r}>
                  <td><span className="sh-sw" style={{ background: color }} />{r}</td>
                  <td>{area}</td>
                  {['Rt', 'Lt'].map((sd) => (
                    <td key={sd}><input type="checkbox" className="sh-tick" aria-label={`${r} ${sd} reduced sensation`} checked={a.has('x.derm', `${r} ${sd}`)} onChange={() => a.toggle('x.derm', `${r} ${sd}`)} /></td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
          <p className="sh-note">Tick the side with reduced / lost sensation.</p>
        </Box>

        <Box n={5} title="Palpation">
          <div className="sh-split">
            <div><div className="sh-lbl">Hip</div><Checks a={a} g="x.palp.hip" items={X_PALP_HIP} none="No tenderness" /><Txt a={a} k="x.palp.hip.other" label="Other:" /></div>
            <div><div className="sh-lbl">Knee</div><Checks a={a} g="x.palp.knee" items={X_PALP_KNEE} none="No tenderness" /><Txt a={a} k="x.palp.knee.other" label="Other:" /></div>
          </div>
        </Box>

        <Box n={6} title="Range of Motion">
          <RomTable a={a} joint="hip" title="Hip Motion" rows={X_ROM_HIP} />
          <RomTable a={a} joint="knee" title="Knee Motion" rows={X_ROM_KNEE} />
          <div className="sh-lbl">Special ROM</div>
          <Row label="Patellar mobility:"><Pick a={a} g="x.patmob" items={X_PATMOB} /></Row>
          <div className="sh-inline"><Checks a={a} g="x.sprom" items={X_SPROM} /></div>
          <Txt a={a} k="x.sprom.other" label="Other:" />
        </Box>

        <Box n={7} title="Neurological Examination">
          <table className="sh-tbl">
            <thead><tr><th>Motor Power (MRC)</th><th>Rt.</th><th>Lt.</th></tr></thead>
            <tbody>
              {X_MRC.map(([r, m]) => (
                <tr key={r}>
                  <td>{r} <small>({m})</small></td>
                  {['rt', 'lt'].map((sd) => <SelCell key={sd} a={a} k={`x.mrc.${r}.${sd}`} label={`${r} ${sd} power`} options={MRC_OPTS} />)}
                </tr>
              ))}
            </tbody>
          </table>
          <table className="sh-tbl">
            <thead><tr><th>Reflexes</th><th>Rt.</th><th>Lt.</th></tr></thead>
            <tbody>
              {X_REFLEX.map(([n, root]) => (
                <tr key={n}>
                  <td>{n} <small>({root})</small></td>
                  {['rt', 'lt'].map((sd) => <SelCell key={sd} a={a} k={`x.refl.${n}.${sd}`} label={`${n} reflex ${sd}`} options={REFLEX_OPTS} />)}
                </tr>
              ))}
            </tbody>
          </table>
        </Box>

        <Box n={8} title="Special Tests">
          <p className="sh-note">Tick the positive tests.</p>
          <div className="sh-split">
            <div><div className="sh-lbl">Hip</div><Checks a={a} g="x.st.hip" items={X_ST_HIP} /><Txt a={a} k="x.st.hip.other" label="Other:" /></div>
            <div><div className="sh-lbl">Knee</div><Checks a={a} g="x.st.knee" items={X_ST_KNEE} /><Txt a={a} k="x.st.knee.other" label="Other:" /></div>
          </div>
        </Box>

        <Box n={9} title="Imaging / Investigations">
          {X_IMG.map((m) => (
            <div className="sh-img" key={m}>
              <div className="sh-img__top">
                <Ck on={a.has('x.img', m)} onToggle={() => a.toggle('x.img', m)}>{m}:</Ck>
              </div>
              <Txt a={a} k={`x.img.${m}`} placeholder="Finding — اكتب النتيجة" />
            </div>
          ))}
          <Txt a={a} k="x.img.prev" label="Previous imaging:" stack />
          <Txt a={a} k="x.img.other" label="Others:" />
        </Box>

        <Box n={10} title="Diagnosis Sheet" wide>
          <DxSheet a={a} prefix="x" id="hipknee" />
          <div className="sh-dxmap">
            <button type="button" className="sh-add" dir="rtl" onClick={onOpenMap}><Icon name="body" size={15} /> اختيار من خريطة الجسم</button>
            <label className="sh-line"><span className="sh-line__l">ICD-10</span><input className="sh-in sh-in--num" dir="ltr" placeholder="M17.1" value={icd10} onChange={(e) => onIcd10(e.target.value.toUpperCase())} /></label>
          </div>
        </Box>

        <Box n={11} title="Plan">
          <Checks a={a} g="x.plan" items={X_PLAN} />
          <Txt a={a} k="x.plan.fu" label="Follow up after:" />
          <Txt a={a} k="x.plan.other" label="Others:" />
        </Box>

        <Box n={12} title="Notes">
          <textarea className="sh-in sh-notes" dir="auto" aria-label="Notes" value={a.txt('x.notes')} onChange={(e) => a.set('x.notes', e.target.value)} />
        </Box>
      </div>
    </div>
  );
}
