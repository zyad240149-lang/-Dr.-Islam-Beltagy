// ======================================================================
// phoneUtils — المصدر الوحيد لكل منطق أرقام الجوال في المشروع كله.
// مبني على libphonenumber-js (metadata "max") — مفيش أي Regex يدوي لدولة معينة:
// طول وصيغة الرقم لكل دولة جايين من metadata المكتبة نفسها، فبيشتغل مع كل الدول المدعومة.
//
// نفس الملف ده بيُستخدم في 3 أماكن (مصدر واحد، مفيش تكرار):
//   1) لوحة الإدارة وبوابة المريض (React) — import مباشر.
//   2) الموقع العام (login.html / signup.html) — بيتبني نسخة IIFE منه: npm run build:phone → js/vendor/phone-core.js
//   3) السيرفر (Edge Function "api") — سكربت النشر بيرفعه جنب الدالة ويحوّل import المكتبة لـ npm:
//
// قاعدة التخزين: أي رقم بيتحفظ في قاعدة البيانات بصيغة E.164 فقط (مثال: +201012345678 / +966551234567).
// ======================================================================
import {
  AsYouType as CoreAsYouType, Metadata, getCountries as coreGetCountries, getCountryCallingCode as coreCallingCode,
  getExampleNumber as coreGetExample, parsePhoneNumberFromString as coreParse, validatePhoneNumberLength as coreValidateLength,
  type CountryCode, type MetadataJson, type PhoneNumber,
} from 'libphonenumber-js/core';
import metadataJson from 'libphonenumber-js/max/metadata';
import examples from 'libphonenumber-js/mobile/examples';

// نسخة واحدة من الـ metadata الكاملة ("max") بتتمرر لكل دوال المكتبة
const md = metadataJson as unknown as MetadataJson;
const parsePhoneNumberFromString = (text: string, country?: CountryCode): PhoneNumber | undefined => coreParse(text, country as CountryCode, md);
const validatePhoneNumberLength = (text: string, country?: CountryCode) => (country ? coreValidateLength(text, country, md) : coreValidateLength(text, md));
const getExampleNumber = (country: CountryCode) => coreGetExample(country, examples, md);
const getCountries = () => coreGetCountries(md);
const getCountryCallingCode = (country: CountryCode) => coreCallingCode(country, md);
const newAsYouType = (country?: CountryCode) => new CoreAsYouType(country, md);

// أطوال الرقم المحلي (National Significant Number) المسموحة لأرقام الجوال في دولة معينة — من metadata المكتبة
const mobileLengthCache = new Map<string, number[]>();
function mobileLengths(country: CountryCode): number[] {
  const hit = mobileLengthCache.get(country);
  if (hit) return hit;
  const m = new Metadata(md);
  m.selectNumberingPlan(country);
  // type() موجودة في المكتبة وقت التشغيل لكن مش معرّفة في ملفات الأنواع بتاعتها
  const plan = m.numberingPlan as unknown as { possibleLengths(): number[]; type(t: string): { possibleLengths(): number[] } | undefined };
  const mob = plan.type('MOBILE')?.possibleLengths() ?? [];
  const lens = (mob.length ? mob : plan.possibleLengths()).slice().sort((a: number, b: number) => a - b);
  mobileLengthCache.set(country, lens);
  return lens;
}
// مقارنة طول الرقم المحلي بأطوال الجوال المسموحة للدولة: 'too_short' | 'too_long' | null
function mobileLengthIssue(text: string, country: CountryCode): 'too_short' | 'too_long' | null {
  const general = text.startsWith('+') ? validatePhoneNumberLength(text) : validatePhoneNumberLength(text, country);
  if (general === 'TOO_LONG') return 'too_long';
  if (general === 'TOO_SHORT' || general === 'NOT_A_NUMBER') return 'too_short';
  const p = text.startsWith('+') ? parsePhoneNumberFromString(text) : parsePhoneNumberFromString(text, country);
  if (!p) return null;
  const lens = mobileLengths(((p.country as CountryCode) ?? country));
  if (!lens.length) return null;
  const n = p.nationalNumber.length;
  if (n < lens[0]) return 'too_short';
  if (n > lens[lens.length - 1]) return 'too_long';
  return null;
}

export type { CountryCode };
export type PhoneErrorCode = 'required' | 'too_short' | 'too_long' | 'invalid' | 'country_mismatch';

// الدولة الافتراضية للنظام (المركز في السعودية)
export const DEFAULT_COUNTRY: CountryCode = 'EG';

export const PHONE_ERROR_AR: Record<PhoneErrorCode, string> = {
  required: 'رقم الجوال مطلوب',
  too_short: 'رقم الجوال غير مكتمل',
  too_long: 'رقم الجوال طويل',
  invalid: 'رقم الجوال غير صحيح',
  country_mismatch: 'رقم الجوال ما يتوافق مع الدولة المختارة',
};

export interface PhoneAnalysis {
  e164: string | null;              // الصيغة الدولية الموحدة لو الرقم صالح
  error: PhoneErrorCode | null;
  country: CountryCode;              // الدولة الفعلية للرقم (بتتغير لو المستخدم كتب رقم دولي بكود دولة تانية)
  detectedCountry?: CountryCode;     // لو الرقم مكتوب بـ + وكوده لدولة تانية
}

// ---------- أدوات عامة ----------
const ARABIC_DIGITS = '٠١٢٣٤٥٦٧٨٩', PERSIAN_DIGITS = '۰۱۲۳۴۵۶۷۸۹';
export function toLatinDigits(s: string): string {
  return String(s ?? '').replace(/[٠-٩۰-۹]/g, (c) => String(ARABIC_DIGITS.indexOf(c) >= 0 ? ARABIC_DIGITS.indexOf(c) : PERSIAN_DIGITS.indexOf(c)));
}

// ينضّف المدخل: أرقام فقط + علامة "+" في الأول لو موجودة (00 في الأول = +). أي حروف أو رموز أو مسافات بتتشال.
export function sanitizePhoneInput(raw: string): string {
  let s = toLatinDigits(String(raw ?? '')).trim();
  const plus = s.startsWith('+');
  let digits = s.replace(/\D/g, '');
  if (!plus && digits.startsWith('00')) return '+' + digits.slice(2);
  return (plus ? '+' : '') + digits;
}

export function isCountryCode(c: string | undefined | null): c is CountryCode {
  return !!c && (getCountries() as string[]).includes(c);
}

// ---------- التحقق الأساسي ----------
// بيحلل الرقم حسب الدولة المختارة ويرجع E.164 أو كود خطأ واضح.
// - الرقم المحلي بالصفر (010… / 05…) أو من غيره (10… / 5…) الاتنين مقبولين.
// - الرقم الدولي بـ + أو 00 مقبول، ولو كوده لدولة تانية غير المختارة بيرجع detectedCountry (أو خطأ عدم توافق لو strict).
// - لو المستخدم كتب كود الدولة من غير + (مثلاً 2010… واختار مصر) بيتفهم صح ومش بيتكرر الكود.
export function analyzePhone(raw: string, country: CountryCode = DEFAULT_COUNTRY, opts: { required?: boolean; strictCountry?: boolean } = {}): PhoneAnalysis {
  const required = opts.required ?? true;
  const text = sanitizePhoneInput(raw);
  const digits = text.replace(/\D/g, '');
  if (!digits) return { e164: null, error: required ? 'required' : null, country };

  const international = text.startsWith('+');
  const parsed = international ? parsePhoneNumberFromString(text) : parsePhoneNumberFromString(digits, country);

  if (international) {
    const detected = parsed?.country as CountryCode | undefined;
    if (!parsed) return { e164: null, error: 'invalid', country };
    const lenErr = mobileLengthIssue(text, country);
    if (lenErr) return { e164: null, error: lenErr, country: detected ?? country, detectedCountry: detected };
    if (detected && detected !== country && opts.strictCountry) return { e164: null, error: 'country_mismatch', country, detectedCountry: detected };
    if (!parsed.isValid()) return { e164: null, error: 'invalid', country: detected ?? country, detectedCountry: detected };
    return { e164: parsed.number, error: null, country: (detected ?? country), detectedCountry: detected };
  }

  if (parsed && parsed.isValid()) {
    // الرقم صالح بس لدولة تانية غير المختارة (حالة نادرة لما الكود بيتقرا تلقائيًا)
    if (parsed.country && parsed.country !== country && opts.strictCountry) return { e164: null, error: 'country_mismatch', country, detectedCountry: parsed.country };
    return { e164: parsed.number, error: null, country: (parsed.country as CountryCode) ?? country };
  }
  // الرقم مش صالح: نحدد السبب بمقارنة الطول بأطوال الجوال المسموحة للدولة (من metadata) بدل رسالة عامة
  const lenErr = mobileLengthIssue(digits, country);
  return { e164: null, error: lenErr ?? 'invalid', country };
}

// اختصار: E.164 أو null
export function normalizePhone(raw: string, country: CountryCode = DEFAULT_COUNTRY): string | null {
  return analyzePhone(raw, country).e164;
}

export function phoneErrorMessage(code: PhoneErrorCode | null | undefined): string | null {
  return code ? PHONE_ERROR_AR[code] : null;
}

// هل الإضافة دي هتخلي الرقم أطول من المسموح للدولة؟ (بنستخدمها لمنع الكتابة الزايدة وقت الإدخال)
export function exceedsMaxLength(raw: string, country: CountryCode): boolean {
  const text = sanitizePhoneInput(raw);
  if (!text.replace(/\D/g, '')) return false;
  if (mobileLengthIssue(text, country) !== 'too_long') return false;
  // لو الرقم الحالي صالح فعلًا (مثلاً رقم أرضي) ما نمنعش الكتابة
  return !analyzePhone(text, country).e164;
}

// تنسيق أثناء الكتابة (مسافات حسب صيغة الدولة) — للعرض فقط، القيمة المحفوظة دايمًا E.164
export function formatAsYouType(raw: string, country: CountryCode): string {
  const text = sanitizePhoneInput(raw);
  if (!text) return '';
  return text.startsWith('+') ? newAsYouType().input(text) : newAsYouType(country).input(text);
}

// رقم مثال بصيغة الدولة المحلية (placeholder) — من metadata المكتبة
export function examplePlaceholder(country: CountryCode): string {
  // من غير الصفر الأولاني — الرقم بيتكتب بعد كود الدولة (+966 5X XXX XXXX)
  try { return (getExampleNumber(country)?.formatNational() ?? '').replace(/^0+/, ''); } catch { return ''; }
}

export function callingCode(country: CountryCode): string {
  return getCountryCallingCode(country);
}

// ---------- قائمة الدول (كل الدول المدعومة في المكتبة) ----------
export interface CountryOption { code: CountryCode; name: string; callingCode: string; flag: string }
const PRIORITY: CountryCode[] = ['EG', 'SA', 'AE', 'KW', 'QA', 'BH', 'OM', 'JO', 'YE', 'SD', 'IQ', 'SY', 'LB', 'PS', 'MA', 'DZ', 'TN', 'LY'];
export function flagEmoji(code: string): string {
  return code.toUpperCase().replace(/./g, (c) => String.fromCodePoint(127397 + c.charCodeAt(0)));
}
let cachedOptions: CountryOption[] | null = null;
export function countryOptions(): CountryOption[] {
  if (cachedOptions) return cachedOptions;
  let names: { of(code: string): string | undefined } | null = null;
  try { names = new Intl.DisplayNames(['ar'], { type: 'region' }); } catch { names = null; }
  const all = getCountries().map((code) => ({ code, name: names?.of(code) ?? code, callingCode: getCountryCallingCode(code), flag: flagEmoji(code) }));
  const pri = PRIORITY.map((c) => all.find((x) => x.code === c)).filter(Boolean) as CountryOption[];
  const rest = all.filter((x) => !PRIORITY.includes(x.code)).sort((a, b) => a.name.localeCompare(b.name, 'ar'));
  cachedOptions = [...pri, ...rest];
  return cachedOptions;
}
export function searchCountries(q: string): CountryOption[] {
  const s = toLatinDigits(q).trim().toLowerCase().replace(/^\+/, '');
  if (!s) return countryOptions();
  return countryOptions().filter((c) => c.name.toLowerCase().includes(s) || c.code.toLowerCase().includes(s) || c.callingCode.startsWith(s));
}

// ---------- التوافق مع البيانات القديمة ----------
// بيقرأ رقم محفوظ (E.164 أو صيغة قديمة زي 0551234567 / 201222780161 / 01222780163) ويرجع الدولة والرقم المحلي لعرضه في الخانة
export function parseStoredPhone(value: string | null | undefined, fallback: CountryCode = DEFAULT_COUNTRY): { country: CountryCode; national: string; e164: string | null } {
  const text = sanitizePhoneInput(value ?? '');
  if (!text) return { country: fallback, national: '', e164: null };
  const tries: Array<() => ReturnType<typeof parsePhoneNumberFromString>> = text.startsWith('+')
    ? [() => parsePhoneNumberFromString(text)]
    : [() => parsePhoneNumberFromString(text, fallback), () => parsePhoneNumberFromString('+' + text), ...PRIORITY.map((c) => () => parsePhoneNumberFromString(text, c))];
  for (const t of tries) {
    const p = t();
    if (p && p.isValid() && p.country) return { country: p.country as CountryCode, national: p.formatNational(), e164: p.number };
  }
  return { country: fallback, national: text, e164: null };
}

// كل الصيغ اللي ممكن رقم معين يكون اتسجّل بيها زمان (قبل التوحيد على E.164) — عشان الدخول والبحث ما يتكسروش مع البيانات القديمة.
// مثال +966551234567 → ['+966551234567','966551234567','0551234567','551234567']
export function phoneLookupCandidates(e164: string): string[] {
  const p = parsePhoneNumberFromString(e164);
  if (!p) return [e164];
  const digits = p.number.replace(/\D/g, '');
  const nsn = p.nationalNumber;
  return Array.from(new Set([p.number, digits, '0' + nsn, nsn]));
}

// بحث بالجوال بيشتغل مع أي صيغة: "0551234567" / "551234567" / "+966551234567" / "966551234567" / "00966…"
// بيلاقي الرقم سواء متسجّل دولي (E.164) أو محلي قديم (05…) — بآخر 9 أرقام لو المدخل طويل. نفس قاعدة phone_digits_match على الخادم (هجرة 166)
export function phoneMatches(stored: string | null | undefined, query: string): boolean {
  const sd = toLatinDigits(stored ?? '').replace(/\D/g, '');
  const qd = toLatinDigits(query).replace(/\D/g, '').replace(/^0+/, '');
  if (qd.length < 3 || !sd) return false;
  return sd.includes(qd) || (qd.length >= 9 && sd.includes(qd.slice(-9)));
}

// الأرقام بس (بدون +) — بتُستخدم كجزء من بريد الدخول الداخلي
export function e164Digits(e164: string): string { return e164.replace(/\D/g, ''); }

// ---------- البحث الموحّد عن المريض (نفس قواعد patient_q_match على الخادم — هجرة 166) ----------
// تطبيع النص العربي: أ/إ/آ/ٱ = ا، ة = ه، ى = ي، من غير تشكيل ولا تطويل، والأرقام العربية = لاتيني
export function normalizeSearch(text: string | null | undefined): string {
  return toLatinDigits(String(text ?? '')).toLowerCase()
    .replace(/[\u064B-\u0652\u0670\u0640]/g, '')
    .replace(/[أإآٱ]/g, 'ا').replace(/ة/g, 'ه').replace(/ى/g, 'ي')
    .replace(/\s+/g, ' ').trim();
}

// نص بيطابق البحث لو كل كلمة في البحث موجودة فيه (بأي ترتيب، وأي جزء من الكلمة) — «محمد العتيبي» بيلاقي «محمد بن سعد العتيبي»
export function textMatches(text: string | null | undefined, query: string): boolean {
  const q = normalizeSearch(query);
  if (!q) return true;
  const t = normalizeSearch(text);
  // «عبدالله» = «عبد الله»: المقارنة كمان من غير مسافات
  return q.split(' ').every((w) => t.includes(w)) || t.replace(/ /g, '').includes(q.replace(/ /g, ''));
}

// رقم الملف للعرض: أرقام بس من غير «TM-» (القاعدة لسه فيها البادئة — الترقيم والاستيراد والاختبارات معتمدين عليها)
export function fileNoText(v: string | null | undefined): string {
  const s = String(v ?? '').trim();
  return /^tm[-\s]*\d+$/i.test(s) ? s.replace(/\D/g, '') : s;
}
// أي نص جاي من الخادم فيه رقم ملف (إشعار/رسالة خطأ) — «زياد — TM-1025» ← «زياد — 1025»
export function stripFileNoPrefix(text: string): string {
  return text.replace(/\bTM-(?=\d)/g, '');
}

// بحث موحّد عن مريض في كل الأقسام: الاسم (أي جزء، من غير فرق أ/ا/إ أو ة/ه أو ى/ي)، رقم الملف (15754 أو TM-15754)،
// رقم الهوية/الإقامة، والجوال بأي صيغة (05… / 5… / 966… / +966… / أرقام عربية)
export function patientMatches(p: { fullName?: string | null; fileNo?: string | null; phone?: string | null; nationalId?: string | null } | null | undefined, query: string): boolean {
  const q = normalizeSearch(query);
  if (!q) return true;
  if (!p) return false;
  if (textMatches(p.fullName, q)) return true;
  const fileQ = q.replace(/^tm[-\s]*/, '');
  const fileDigits = toLatinDigits(p.fileNo ?? '').replace(/\D/g, '');
  if (/^\d+$/.test(fileQ) && fileDigits.includes(fileQ)) return true;
  if (normalizeSearch(p.fileNo).includes(q)) return true;
  // أرقام بس (مع مسافات/شرط/+/أقواس): هوية/إقامة أو جوال
  if (/^[+\d\s()-]+$/.test(q)) {
    const qd = q.replace(/\D/g, '');
    if (qd.length >= 3 && toLatinDigits(p.nationalId ?? '').replace(/\D/g, '').includes(qd)) return true;
    if (phoneMatches(p.phone, q)) return true;
  }
  return false;
}

// ترتيب نتايج بحث المريض حسب الصلة (نفس patient_q_rank/patient_name_rank على الخادم — هجرة 181):
// 0 = تطابق كامل لرقم الملف/الهوية/الجوال، 1 = الاسم مطابق، 2 = الاسم يبدأ بالبحث، 3 = غير كذا
export function patientRank(p: { fullName?: string | null; fileNo?: string | null; phone?: string | null; nationalId?: string | null }, query: string): number {
  const q = normalizeSearch(query);
  if (!q) return 3;
  const digits = q.replace(/\D/g, '');
  const fileQ = q.replace(/^tm[-\s]*/, '');
  if (/^\d+$/.test(fileQ) && toLatinDigits(p.fileNo ?? '').replace(/\D/g, '') === fileQ) return 0;
  if (digits && /^[+\d\s()-]+$/.test(q)) {
    if (toLatinDigits(p.nationalId ?? '').replace(/\D/g, '') === digits) return 0;
    const d9 = digits.replace(/^0+/, '');
    if (d9.length >= 9 && toLatinDigits(p.phone ?? '').replace(/\D/g, '').endsWith(d9.slice(-9))) return 0;
  }
  const n = normalizeSearch(p.fullName);
  if (n === q) return 1;
  if (n.startsWith(q)) return 2;
  return 3;
}
