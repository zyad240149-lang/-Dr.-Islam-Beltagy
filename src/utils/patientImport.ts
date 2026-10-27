// استيراد المرضى من Excel — المنطق الصافي (بدون واجهة ولا شبكة): مطابقة الأعمدة، تنظيف القيم، التحقق، وتقرير الأخطاء.
// الخادم (patient_import_commit) بيعيد التحقق من كل صف؛ الفحص هنا عشان المدير يشوف الأخطاء ويصلّحها قبل الحفظ.
// مبادئ: مفيش قيم تخمينية — أي قيمة مش مفهومة = خطأ بيتصلّح يدويًا. الأرقام اللي بتبدأ بصفر بتفضل نص. التواريخ بتتقرا بدقة (UTC) ومفيش تفسير مبهم.
import { analyzePhone, toLatinDigits } from './phoneUtils';

export type Cell = string | number | boolean | Date | null | undefined;
export type ImportKey =
  | 'fileNo' | 'fullName' | 'firstName' | 'fatherName' | 'familyName' | 'nationality' | 'nationalId' | 'phone' | 'email' | 'gender' | 'birthDate'
  | 'city' | 'district' | 'street' | 'address' | 'referralSource' | 'doctor' | 'emergencyContactName' | 'emergencyContactPhone'
  | 'mainComplaint' | 'diagnosis' | 'medicalHistory' | 'notes' | 'active';

export interface FieldDef { key: ImportKey; label: string; hint: string; synonyms: string[] }

// كل الحقول الموجودة فعلًا في ملف المريض (لا حقول مخترعة — مفيش «رقم هاتف بديل» في النظام فبنستورد «جوال الطوارئ» بس)
export const FIELDS: FieldDef[] = [
  { key: 'fileNo', label: 'رقم الملف', hint: 'اختياري — إذا تُرك فارغًا يُولَّد تلقائيًا', synonyms: ['رقم الملف', 'رقم الملف الطبي', 'file no', 'file number', 'fileno', 'patient id', 'id', 'رقم المريض', 'الرقم التعريفي'] },
  { key: 'fullName', label: 'الاسم الكامل', hint: 'ثلاثي على الأقل (الاسم + الأب + العائلة)', synonyms: ['الاسم الكامل', 'اسم المريض', 'الاسم', 'اسم', 'المريض', 'full name', 'name', 'patient name', 'patient'] },
  { key: 'firstName', label: 'الاسم الأول', hint: 'بديل للاسم الكامل', synonyms: ['الاسم الأول', 'الاسم الاول', 'first name', 'firstname'] },
  { key: 'fatherName', label: 'اسم الأب', hint: 'بديل للاسم الكامل', synonyms: ['اسم الأب', 'اسم الاب', 'الأب', 'father name', 'fathername', 'middle name'] },
  { key: 'familyName', label: 'اسم العائلة', hint: 'بديل للاسم الكامل', synonyms: ['اسم العائلة', 'العائلة', 'الكنية', 'family name', 'last name', 'lastname', 'surname'] },
  { key: 'nationality', label: 'الجنسية', hint: 'مصري / أجنبي', synonyms: ['الجنسية', 'جنسية', 'nationality'] },
  { key: 'nationalId', label: 'الرقم القومي / جواز السفر', hint: 'مطلوب — المصري: الرقم القومي 14 رقم يبدأ بـ 2 أو 3، الأجنبي: رقم جواز السفر', synonyms: ['رقم الهوية', 'رقم الهوية / الإقامة', 'رقم الإقامة', 'رقم الاقامة', 'الهوية', 'رقم الأحوال', 'national id', 'nationalid', 'iqama', 'id number', 'هوية'] },
  { key: 'phone', label: 'رقم الجوال', hint: 'مطلوب — 01xxxxxxxxx أو +201xxxxxxxxx', synonyms: ['رقم الجوال', 'الجوال', 'جوال', 'رقم الهاتف', 'الهاتف', 'هاتف', 'موبايل', 'رقم الموبايل', 'phone', 'mobile', 'phone number', 'tel'] },
  { key: 'gender', label: 'النوع', hint: 'ذكر / أنثى', synonyms: ['النوع', 'الجنس', 'gender', 'sex'] },
  { key: 'birthDate', label: 'تاريخ الميلاد', hint: 'YYYY-MM-DD أو DD/MM/YYYY', synonyms: ['تاريخ الميلاد', 'الميلاد', 'تاريخ الولادة', 'birth date', 'birthdate', 'dob', 'date of birth'] },
  { key: 'email', label: 'البريد الإلكتروني', hint: '', synonyms: ['البريد الإلكتروني', 'البريد الالكتروني', 'البريد', 'الايميل', 'الإيميل', 'email', 'e-mail'] },
  { key: 'city', label: 'المدينة', hint: '', synonyms: ['المدينة', 'مدينة', 'city'] },
  { key: 'district', label: 'الحي', hint: '', synonyms: ['الحي', 'حي', 'district', 'neighborhood'] },
  { key: 'street', label: 'الشارع', hint: '', synonyms: ['الشارع', 'شارع', 'street'] },
  { key: 'address', label: 'العنوان', hint: '', synonyms: ['العنوان', 'عنوان', 'address'] },
  { key: 'referralSource', label: 'مصدر المعرفة', hint: 'انستغرام، فيسبوك، تويتر، سناب شات، تيك توك، واتساب، بحث جوجل، توصية صديق، إعلان، موقع إلكتروني، أخرى', synonyms: ['مصدر المعرفة', 'كيف عرفت عن المركز', 'المصدر', 'referral source', 'source'] },
  { key: 'doctor', label: 'الطبيب المسؤول', hint: 'اسم الطبيب كما هو في النظام', synonyms: ['الطبيب المسؤول', 'الطبيب', 'اسم الطبيب', 'الأخصائي', 'المعالج', 'doctor', 'therapist'] },
  { key: 'emergencyContactName', label: 'جهة الطوارئ', hint: 'اسم شخص للطوارئ', synonyms: ['جهة الطوارئ', 'اسم الطوارئ', 'شخص الطوارئ', 'اسم جهة الاتصال للطوارئ', 'emergency contact', 'emergency name'] },
  { key: 'emergencyContactPhone', label: 'جوال الطوارئ', hint: '', synonyms: ['جوال الطوارئ', 'رقم الطوارئ', 'هاتف الطوارئ', 'emergency phone', 'emergency contact phone'] },
  { key: 'mainComplaint', label: 'الشكوى الرئيسية', hint: '', synonyms: ['الشكوى الرئيسية', 'الشكوى', 'main complaint', 'complaint'] },
  { key: 'diagnosis', label: 'التشخيص', hint: '', synonyms: ['التشخيص', 'diagnosis'] },
  { key: 'medicalHistory', label: 'التاريخ المرضي', hint: '', synonyms: ['التاريخ المرضي', 'التاريخ الطبي', 'medical history', 'history'] },
  { key: 'notes', label: 'ملاحظات', hint: '', synonyms: ['ملاحظات', 'ملاحظة', 'notes', 'note', 'remarks'] },
  { key: 'active', label: 'الحالة', hint: 'نشط / معطّل — إذا كان فارغًا = نشط', synonyms: ['الحالة', 'حالة الملف', 'status', 'active'] },
];
export const FIELD_BY_KEY = Object.fromEntries(FIELDS.map((f) => [f.key, f])) as Record<ImportKey, FieldDef>;

export const MAX_FILE_BYTES = 8 * 1024 * 1024;
export const MAX_ROWS = 5000;

// ---------- تطبيع النصوص ----------
const AR_DIACRITICS = /[ً-ٰٟـ]/g;
export const normText = (s: unknown): string =>
  toLatinDigits(String(s ?? '')).replace(AR_DIACRITICS, '').replace(/[أإآٱ]/g, 'ا').replace(/ى/g, 'ي').replace(/ة/g, 'ه').replace(/[\s_\-\/\\()*:]+/g, ' ').trim().toLowerCase();

export function detectMapping(headers: string[]): { mapping: Partial<Record<ImportKey, number>>; duplicateHeaders: string[] } {
  const mapping: Partial<Record<ImportKey, number>> = {};
  const seen = new Map<string, number>(); const dups = new Set<string>();
  headers.forEach((h, i) => { const n = normText(h); if (!n) return; if (seen.has(n)) dups.add(String(h)); else seen.set(n, i); });
  const used = new Set<number>();
  for (const f of FIELDS) {
    for (const syn of f.synonyms) {
      const idx = seen.get(normText(syn));
      if (idx !== undefined && !used.has(idx)) { mapping[f.key] = idx; used.add(idx); break; }
    }
  }
  return { mapping, duplicateHeaders: [...dups] };
}

// ---------- تحويل الخلايا ----------
const pad = (n: number) => String(n).padStart(2, '0');
const ymdUtc = (d: Date) => `${d.getUTCFullYear()}-${pad(d.getUTCMonth() + 1)}-${pad(d.getUTCDate())}`;
function validYmd(y: number, m: number, d: number): string | null {
  if (y < 1900 || m < 1 || m > 12 || d < 1 || d > 31) return null;
  const dt = new Date(Date.UTC(y, m - 1, d));
  return dt.getUTCFullYear() === y && dt.getUTCMonth() === m - 1 && dt.getUTCDate() === d ? `${y}-${pad(m)}-${pad(d)}` : null;
}

// خلية → نص. التاريخ بيتحوّل YYYY-MM-DD (UTC عشان مايتأخرش يوم)، الأرقام بدون .0، والنص زي ما هو.
export function cellToText(c: Cell, kind: 'text' | 'date' = 'text'): string {
  if (c === null || c === undefined) return '';
  if (c instanceof Date) return Number.isNaN(c.getTime()) ? '' : ymdUtc(c);
  if (typeof c === 'number') {
    if (kind === 'date' && Number.isFinite(c) && c > 59 && c < 80000) { const ms = Math.round((c - 25569) * 86400000); return ymdUtc(new Date(ms)); } // رقم تسلسلي لتاريخ Excel
    return Number.isInteger(c) ? c.toFixed(0) : String(c);
  }
  if (typeof c === 'boolean') return c ? 'نعم' : 'لا';
  return String(c).replace(/ /g, ' ').trim();
}

export function parseBirthDate(raw: string): { ok: true; value: string } | { ok: false; reason: string } {
  const t = toLatinDigits(raw).trim();
  if (!t) return { ok: true, value: '' };
  let m = /^(\d{4})[-/.](\d{1,2})[-/.](\d{1,2})(?:[ T].*)?$/.exec(t);
  let ymd: string | null = null;
  if (m) ymd = validYmd(+m[1], +m[2], +m[3]);
  else if ((m = /^(\d{1,2})[-/.](\d{1,2})[-/.](\d{4})$/.exec(t))) ymd = validYmd(+m[3], +m[2], +m[1]); // اليوم/الشهر/السنة (الشائع عندنا)
  else if (/^\d{8}$/.test(t)) ymd = validYmd(+t.slice(0, 4), +t.slice(4, 6), +t.slice(6, 8));
  if (!ymd) return { ok: false, reason: 'تاريخ غير مفهوم أو غير موجود في التقويم' };
  const today = new Date(); const tStr = `${today.getFullYear()}-${pad(today.getMonth() + 1)}-${pad(today.getDate())}`;
  if (ymd > tStr) return { ok: false, reason: 'تاريخ الميلاد في المستقبل' };
  return { ok: true, value: ymd };
}

// القيمة المخزنة saudi = مصري، non_saudi = أجنبي
const NAT_SAUDI = new Set(['مصري', 'مصريه', 'مصرى', 'egyptian', 'egypt', 'eg', 'مصر']);
const NAT_NON = new Set(['غير مصري', 'غير مصريه', 'اجنبي', 'اجنبيه', 'أجنبي', 'أجنبية', 'وافد', 'foreign', 'foreigner', 'expat', 'non egyptian']);
const GEN_M = new Set(['ذكر', 'رجل', 'ولد', 'male', 'm', 'man']);
const GEN_F = new Set(['انثي', 'انثى', 'أنثى', 'امراه', 'امرأه', 'بنت', 'female', 'f', 'woman', 'انثي']);
const ACT_Y = new Set(['نشط', 'نشطه', 'فعال', 'فعّال', 'active', 'yes', 'نعم', 'true', '1']);
const ACT_N = new Set(['معطل', 'معطله', 'غير نشط', 'غير فعال', 'inactive', 'no', 'لا', 'false', '0', 'مغلق']);

const REFERRAL_ALIASES: Record<string, string> = {
  'instagram': 'instagram',
  'انستغرام': 'instagram',
  'انستجرام': 'instagram',
  'facebook': 'facebook',
  'فيسبوك': 'facebook',
  'فيس بوك': 'facebook',
  'twitter': 'twitter',
  'تويتر': 'twitter',
  'تويتر x': 'twitter',
  'x': 'twitter',
  'snapchat': 'snapchat',
  'سناب شات': 'snapchat',
  'سناب': 'snapchat',
  'tiktok': 'tiktok',
  'تيك توك': 'tiktok',
  'whatsapp': 'whatsapp',
  'واتساب': 'whatsapp',
  'واتس اب': 'whatsapp',
  'google': 'google',
  'بحث جوجل': 'google',
  'جوجل': 'google',
  'friend': 'friend',
  'توصيه صديق او قريب': 'friend',
  'توصيه صديق': 'friend',
  'صديق': 'friend',
  'ad': 'ad',
  'اعلان': 'ad',
  'website': 'website',
  'موقع الكتروني': 'website',
  'موقع': 'website',
  'other': 'other',
  'اخري': 'other',
  'اخرى': 'other',
};

export interface Therapist { id: string; name: string }
export interface ImportContext { therapists: Therapist[]; fixedNationality?: 'saudi' | 'non_saudi' | ''; requireNationalId?: boolean }
const docKey = (s: string) => normText(s).replace(/^(د|دكتور|دكتوره|dr|doctor)[ .]+/, '').replace(/\s+/g, ' ');

export interface RowIssue { field: ImportKey | 'row'; column: string; reason: string; fix: string }
export type Rec = Record<ImportKey, string>;
export const emptyRec = (): Rec => Object.fromEntries(FIELDS.map((f) => [f.key, ''])) as Rec;

export interface Payload {
  i: number; fileNo: string; firstName: string; fatherName: string; familyName: string; nationality: 'saudi' | 'non_saudi'; nationalId: string; phone: string; email: string;
  gender: 'male' | 'female' | ''; birthDate: string; city: string; district: string; street: string; address: string; referralSource: string; doctorId: string;
  emergencyContactName: string; emergencyContactPhone: string; mainComplaint: string; diagnosis: string; medicalHistory: string; notes: string; active: boolean; force?: boolean;
}

export const splitName = (full: string) => { const w = full.trim().split(/\s+/).filter(Boolean); return { firstName: w[0] ?? '', fatherName: w[1] ?? '', familyName: w.slice(2).join(' ') }; };
export const phoneKey = (p: string) => p.replace(/\D/g, '').slice(-9);

// الجوال: محلي بصفر أو من غير صفر، دولي بـ + أو 00، أو دولي من غير + (مثال 201222780163) — الصيغة الموحّدة E.164
export function normalizeImportPhone(raw: string): { ok: true; value: string } | { ok: false; reason: string; fix: string } {
  const text = toLatinDigits(raw).trim();
  if (!text) return { ok: false, reason: 'رقم الجوال فارغ', fix: 'اكتب رقم الجوال (مثال 05XXXXXXXX)' };
  let a = analyzePhone(text, 'EG');
  const digits = text.replace(/\D/g, '');
  if (!a.e164 && digits && !text.startsWith('+') && !digits.startsWith('0')) a = analyzePhone('+' + digits, 'EG');
  if (a.e164) return { ok: true, value: a.e164 };
  return { ok: false, reason: 'رقم الجوال غير صحيح أو غير مكتمل', fix: 'تأكد من الرقم (مصري: 11 رقم يبدأ بـ 01، أو رقم دولي بـ +)' };
}

// تحقق صف واحد من نص خام → payload أو أخطاء (بنفس قواعد نموذج «فتح ملف مريض» + قواعد الخادم)
export function validateRec(rec: Rec, ctx: ImportContext, rowNo: number): { payload: Payload | null; issues: RowIssue[]; notes: string[] } {
  const issues: RowIssue[] = []; const notes: string[] = [];
  const bad = (field: ImportKey, reason: string, fix: string) => issues.push({ field, column: FIELD_BY_KEY[field].label, reason, fix });
  const t = (k: ImportKey) => rec[k].trim();

  // الاسم: أجزاء منفصلة لو موجودة وإلا الاسم الكامل مقسّم
  let first = t('firstName'), father = t('fatherName'), family = t('familyName');
  if (!first && !father && !family && t('fullName')) ({ firstName: first, fatherName: father, familyName: family } = splitName(t('fullName')));
  if (!first && !father && !family) bad('fullName', 'الاسم فارغ', 'اكتب الاسم الثلاثي');
  else if (!first || !father || !family) bad(t('fullName') ? 'fullName' : (!first ? 'firstName' : !father ? 'fatherName' : 'familyName'), 'لازم يكون الاسم ثلاثيًا (الاسم + الأب + العائلة)', 'اكتب الاسم كاملًا بثلاث كلمات على الأقل');
  for (const [k, v] of [['firstName', first], ['fatherName', father], ['familyName', family]] as const) if (v.length > 100) bad(k, 'الاسم طويل جدًا', 'اختصر الاسم');

  // الهوية والجنسية
  const nid = toLatinDigits(t('nationalId')).replace(/\s/g, '');
  let nat: 'saudi' | 'non_saudi' | '' = '';
  const natRaw = normText(t('nationality'));
  if (natRaw) {
    if (NAT_SAUDI.has(natRaw)) nat = 'saudi'; else if (NAT_NON.has(natRaw)) nat = 'non_saudi';
    else bad('nationality', `قيمة الجنسية «${t('nationality')}» غير مفهومة`, 'اختر: مصري أو أجنبي');
  } else if (ctx.fixedNationality) nat = ctx.fixedNationality;
  else if (/^[23]\d{13}$/.test(nid)) { nat = 'saudi'; notes.push('حُدّدت الجنسية (مصري) من الرقم القومي'); }
  else bad('nationality', 'الجنسية مطلوبة', 'اختر: مصري أو أجنبي');
  if (!nid && ctx.requireNationalId !== false) bad('nationalId', 'الرقم القومي / جواز السفر مطلوب', 'اكتب الرقم القومي (14 رقم) للمصري أو رقم جواز السفر للأجنبي');
  if (nid) {
    if (nat === 'non_saudi') { if (!/^[A-Za-z0-9]{6,20}$/.test(nid)) bad('nationalId', 'رقم جواز السفر غير صحيح', 'من 6 إلى 20 حرف/رقم إنجليزي'); }
    else if (!/^[23]\d{13}$/.test(nid)) bad('nationalId', 'الرقم القومي لازم 14 رقم يبدأ بـ 2 أو 3', 'صحّح الرقم أو غيّر الجنسية لأجنبي');
  }

  // الجوال
  const ph = normalizeImportPhone(t('phone'));
  let phone = '';
  if (!ph.ok) bad('phone', ph.reason, ph.fix); else phone = ph.value;
  let ecPhone = '';
  if (t('emergencyContactPhone')) { const e = normalizeImportPhone(t('emergencyContactPhone')); if (!e.ok) bad('emergencyContactPhone', e.reason, e.fix); else ecPhone = e.value; }

  // النوع / الميلاد / البريد
  let gender: 'male' | 'female' | '' = '';
  if (t('gender')) { const g = normText(t('gender')); if (GEN_M.has(g)) gender = 'male'; else if (GEN_F.has(g)) gender = 'female'; else bad('gender', `قيمة النوع «${t('gender')}» غير مفهومة`, 'اختر: ذكر أو أنثى'); }
  let birth = '';
  if (t('birthDate')) { const b = parseBirthDate(t('birthDate')); if (!b.ok) bad('birthDate', b.reason, 'اكتب التاريخ بصيغة YYYY-MM-DD أو DD/MM/YYYY'); else birth = b.value; }
  const email = t('email');
  if (email && !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) bad('email', 'البريد الإلكتروني غير صحيح', 'صحّح البريد أو اتركه فارغًا');

  // مصدر المعرفة / الطبيب / الحالة
  let source = 'other';
  if (t('referralSource')) { const s = REFERRAL_ALIASES[normText(t('referralSource'))]; if (s) source = s; else bad('referralSource', `مصدر المعرفة «${t('referralSource')}» غير موجود في القائمة`, 'اختر مصدرًا من القائمة'); }
  let doctorId = '';
  if (t('doctor')) {
    const k = docKey(t('doctor')); const hit = ctx.therapists.filter((x) => docKey(x.name) === k);
    if (hit.length === 1) doctorId = hit[0].id;
    else bad('doctor', hit.length > 1 ? 'اسم الطبيب مطابق لأكثر من طبيب' : `الطبيب «${t('doctor')}» غير موجود في النظام`, 'اختر الطبيب من القائمة أو اتركه فارغًا');
  }
  let active = true;
  if (t('active')) { const a = normText(t('active')); if (ACT_Y.has(a)) active = true; else if (ACT_N.has(a)) active = false; else bad('active', `قيمة الحالة «${t('active')}» غير مفهومة`, 'اختر: نشط أو معطّل'); }
  if (t('fileNo') && t('fileNo').length > 40) bad('fileNo', 'رقم الملف طويل', 'اختصر رقم الملف');
  for (const k of ['notes', 'medicalHistory'] as const) if (t(k).length > 4000) bad(k, 'النص طويل جدًا (أكثر من 4000 حرف)', 'اختصر النص');
  for (const k of ['mainComplaint', 'diagnosis'] as const) if (t(k).length > 2000) bad(k, 'النص طويل جدًا (أكثر من 2000 حرف)', 'اختصر النص');

  if (issues.length || !nat) return { payload: null, issues, notes };
  return {
    payload: { i: rowNo, fileNo: t('fileNo'), firstName: first, fatherName: father, familyName: family, nationality: nat, nationalId: nid, phone, email, gender, birthDate: birth, city: t('city'), district: t('district'), street: t('street'), address: t('address'),
      referralSource: source, doctorId, emergencyContactName: t('emergencyContactName'), emergencyContactPhone: ecPhone, mainComplaint: t('mainComplaint'), diagnosis: t('diagnosis'), medicalHistory: t('medicalHistory'), notes: t('notes'), active },
    issues, notes,
  };
}

export interface ImportRow { i: number; rec: Rec; payload: Payload | null; issues: RowIssue[]; notes: string[]; fileDup?: string }

// يبني الصفوف من خلايا الورقة (أول صف = العناوين) حسب المطابقة. rowNo = رقم الصف الفعلي في Excel.
export function buildRows(cells: Cell[][], mapping: Partial<Record<ImportKey, number>>, ctx: ImportContext): ImportRow[] {
  const rows: ImportRow[] = [];
  for (let r = 1; r < cells.length; r++) {
    const line = cells[r] ?? [];
    if (line.every((c) => c === null || c === undefined || String(c).trim() === '')) continue; // صف فاضي
    const rec = emptyRec();
    for (const f of FIELDS) { const idx = mapping[f.key]; if (idx !== undefined && idx >= 0) rec[f.key] = cellToText(line[idx], f.key === 'birthDate' ? 'date' : 'text'); }
    const v = validateRec(rec, ctx, r + 1);
    rows.push({ i: r + 1, rec, payload: v.payload, issues: v.issues, notes: v.notes });
  }
  markFileDuplicates(rows);
  return rows;
}

// تكرار داخل الملف نفسه (رقم ملف / هوية / جوال): الصف التاني بيتعلّم — الأول هو اللي بيتحفظ
export function markFileDuplicates(rows: ImportRow[]) {
  const seen = { f: new Map<string, number>(), n: new Map<string, number>(), p: new Map<string, number>() };
  for (const r of rows) {
    r.fileDup = undefined;
    const p = r.payload; if (!p) continue;
    const checks: Array<[Map<string, number>, string, string]> = [[seen.f, p.fileNo, 'رقم الملف'], [seen.n, p.nationalId, 'رقم الهوية'], [seen.p, phoneKey(p.phone), 'رقم الجوال']];
    for (const [m, key, label] of checks) {
      if (!key) continue;
      const prev = m.get(key);
      if (prev !== undefined && !r.fileDup) r.fileDup = `${label} مكرر داخل الملف (نفس الصف ${prev})`;
      if (prev === undefined) m.set(key, r.i);
    }
  }
}

export interface ErrorReportLine { row: number | string; column: string; reason: string; fix: string }
// تقرير الأخطاء: رقم الصف + اسم العمود + السبب + طريقة التصحيح — من غير أي بيانات طبية أو شخصية
export function errorReport(rows: ImportRow[], server: Array<{ i: number; status: string; reason?: string }> = []): ErrorReportLine[] {
  const out: ErrorReportLine[] = [];
  for (const r of rows) {
    for (const x of r.issues) out.push({ row: r.i, column: x.column, reason: x.reason, fix: x.fix });
    if (r.fileDup) out.push({ row: r.i, column: 'تكرار', reason: r.fileDup, fix: 'احذف الصف المكرر أو صحّح بياناته' });
  }
  for (const s of server) if (s.status !== 'added') out.push({ row: s.i, column: 'الحفظ', reason: s.reason ?? (s.status === 'review' ? 'محتمل تكرار ولم يتم تأكيده' : 'ما تم الحفظ'), fix: s.status === 'duplicate' ? 'المريض موجود بالفعل — لا حاجة لإضافته' : s.status === 'review' ? 'راجع السجل وأعد الاستيراد مع اختيار «إضافة كمريض جديد» لو مختلف' : 'صحّح الصف وأعد استيراده' });
  return out.sort((a, b) => Number(a.row) - Number(b.row));
}

export const TEMPLATE_HEADERS = FIELDS.map((f) => f.label);
