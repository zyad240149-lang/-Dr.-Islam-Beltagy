import type { AppointmentStatus, InvoiceStatus } from '../types';

import { LANG } from '../i18n';
import { parseStoredPhone } from './phoneUtils';

const LOCALE = LANG === 'en' ? 'en-GB-u-ca-gregory' : 'ar-SA-u-ca-gregory-nu-latn';
const ARABIC_DIGITS = '٠١٢٣٤٥٦٧٨٩';
const PERSIAN_DIGITS = '۰۱۲۳۴۵۶۷۸۹';
export const toLatinDigits = (s: string) => s.replace(/[٠-٩۰-۹]/g, (d) => {
  const i = ARABIC_DIGITS.indexOf(d);
  return String(i >= 0 ? i : PERSIAN_DIGITS.indexOf(d));
});
export const money = (n: number) => `${n.toLocaleString('en-US')} ج.م`;

// تحويل مبلغ لكتابة عربية (للفاتورة الضريبية المطبوعة) — يدعم لحد الملايين + الهللات
const ONES = ['', 'واحد', 'اثنان', 'ثلاثة', 'أربعة', 'خمسة', 'ستة', 'سبعة', 'ثمانية', 'تسعة'];
const TENS_ONES = ['عشرة', 'أحد عشر', 'اثنا عشر', 'ثلاثة عشر', 'أربعة عشر', 'خمسة عشر', 'ستة عشر', 'سبعة عشر', 'ثمانية عشر', 'تسعة عشر'];
const TENS = ['', '', 'عشرون', 'ثلاثون', 'أربعون', 'خمسون', 'ستون', 'سبعون', 'ثمانون', 'تسعون'];
const HUNDREDS = ['', 'مائة', 'مئتان', 'ثلاثمائة', 'أربعمائة', 'خمسمائة', 'ستمائة', 'سبعمائة', 'ثمانمائة', 'تسعمائة'];
function threeDigitsToArabic(n: number): string {
  const h = Math.floor(n / 100), t = Math.floor((n % 100) / 10), o = n % 10;
  const parts: string[] = [];
  if (h) parts.push(HUNDREDS[h]);
  if (t === 1) parts.push(TENS_ONES[o]);
  else { if (o) parts.push(ONES[o]); if (t >= 2) parts.push(TENS[t]); }
  return parts.join(' و');
}
function integerToArabic(n: number): string {
  if (n === 0) return 'صفر';
  const groups: [number, string, string][] = [[1_000_000, 'مليون', 'مليونان'], [1_000, 'ألف', 'ألفان'], [1, '', '']];
  let rem = n; const parts: string[] = [];
  for (const [size, singular, dual] of groups) {
    const count = Math.floor(rem / size);
    rem %= size;
    if (!count) continue;
    if (size === 1) { parts.push(threeDigitsToArabic(count)); continue; }
    if (count === 1) parts.push(singular);
    else if (count === 2) parts.push(dual);
    else if (count >= 3 && count <= 10) parts.push(`${threeDigitsToArabic(count)} ${singular === 'ألف' ? 'آلاف' : 'ملايين'}`);
    else parts.push(`${threeDigitsToArabic(count)} ${singular}`);
  }
  return parts.join(' و');
}
export function amountToArabicWords(n: number): string {
  const riyals = Math.floor(Math.max(0, n));
  const halalas = Math.round((Math.max(0, n) - riyals) * 100);
  let out = `${integerToArabic(riyals)} جنيه مصري`;
  if (halalas > 0) out += ` و${integerToArabic(halalas)} قرش`;
  return out + ' فقط لا غير';
}
export const fmtDate = (ymd: string) => {
  const [y, m, d] = ymd.split('-').map(Number);
  return new Date(y, m - 1, d).toLocaleDateString(LOCALE, { day: 'numeric', month: 'long', year: 'numeric' });
};
export const fmtShortDate = (ymd: string) => {
  const [y, m, d] = ymd.split('-').map(Number);
  return new Date(y, m - 1, d).toLocaleDateString(LOCALE, { day: 'numeric', month: 'short', weekday: 'short' });
};
export const fmtTime = (hhmm: string) => {
  const [h, m] = hhmm.split(':').map(Number);
  const period = LANG === 'en' ? (h < 12 ? 'AM' : 'PM') : h < 12 ? 'ص' : 'م';
  const h12 = h % 12 === 0 ? 12 : h % 12;
  return `${h12}:${String(m).padStart(2, '0')} ${period}`;
};
export const relTime = (ts: number) => {
  const mins = Math.round((Date.now() - ts) / 60000);
  if (mins < 1) return 'الآن';
  if (mins < 60) return `قبل ${mins} دقيقة`;
  const h = Math.round(mins / 60);
  if (h < 24) return `قبل ${h} ساعة`;
  const d = Math.round(h / 24);
  return `قبل ${d} يوم`;
};
// تواريخ محلية (لا UTC) — toISOString كان بيرجّع يوم قبل في توقيت الرياض (UTC+3)
export const ymdLocal = (d: Date) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
export const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
// الرقم القومي المصري (14 رقم، أوله 2 أو 3) — والأجنبي رقم جواز السفر
export const NID_RE = /^[23]\d{13}$/;
export const PASSPORT_RE = /^[A-Za-z0-9]{6,20}$/;

export const wordCount = (s: string) => s.trim().split(/\s+/).filter(Boolean).length;
// كل «دلوقتي» في السيستم بتوقيت السعودية (القاهرة UTC+3) مهما كان توقيت جهاز المستخدم:
// riyadhNow() = Date قيمه المحلية (getHours/getDate...) هي ساعة وتاريخ السعودية
export const riyadhNow = () => new Date(new Date().toLocaleString('en-US', { timeZone: 'Africa/Cairo' }));
export const riyadhNowHm = () => { const n = riyadhNow(); return `${String(n.getHours()).padStart(2, '0')}:${String(n.getMinutes()).padStart(2, '0')}`; };
export const todayYmd = () => ymdLocal(riyadhNow());
// نسخة بتوقيت الرياض من اليوم/التاريخ — تُستخدم في التقارير والداشبورد بدل توقيت جهاز المتصفح المحلي،
// حتى تطابق حسابات الخادم (riyadh_today() في قاعدة البيانات) ولا تختلف نتيجة تبويب عن تبويب لو جهاز الموظف مضبوط بتوقيت مختلف.
const RIYADH_FMT = new Intl.DateTimeFormat('en-CA', { timeZone: 'Africa/Cairo', year: 'numeric', month: '2-digit', day: '2-digit' });
export const riyadhYmd = (d: Date) => RIYADH_FMT.format(d);
export const riyadhTodayYmd = () => riyadhYmd(new Date());
export const addDaysYmd = (ymd: string, days: number) => {
  const d = new Date(ymd + 'T00:00:00');
  d.setDate(d.getDate() + days);
  return ymdLocal(d);
};
export const age = (birthDate: string): number | null => {
  if (!birthDate) return null;
  const b = new Date(birthDate);
  if (Number.isNaN(b.getTime())) return null;
  const diff = Date.now() - b.getTime();
  return Math.floor(diff / (365.25 * 86400000));
};
export const initials = (name: string) => name.replace(/^د\.\s*/, '').trim().split(/\s+/).slice(0, 2).map((w) => w[0]).join('');

export const APPT_STATUS: Record<AppointmentStatus, { label: string; tone: string }> = {
  new: { label: 'جديد', tone: 'info' },
  confirmed: { label: 'مؤكد', tone: 'brand' },
  on_way: { label: 'المعالج في الطريق', tone: 'info' },
  arrived: { label: 'حضر', tone: 'brand' },
  in_progress: { label: 'قيد الزيارة', tone: 'brand' },
  no_show: { label: 'لم يحضر', tone: 'warn' },
  completed: { label: 'مكتمل', tone: 'ok' },
  cancelled: { label: 'ملغي', tone: 'danger' },
  rescheduled: { label: 'معاد جدولته', tone: 'muted' },
};
export const INVOICE_STATUS: Record<InvoiceStatus, { label: string; tone: string }> = {
  draft: { label: 'بانتظار المراجعة', tone: 'info' },
  paid: { label: 'مدفوعة', tone: 'ok' },
  partial: { label: 'مدفوعة جزئيًا', tone: 'warn' },
  due: { label: 'مستحقة', tone: 'warn' },
  cancelled: { label: 'ملغاة', tone: 'muted' },
};
export const APPT_TYPE_LABEL: Record<string, string> = {
  initial: 'تقييم أولي', session: 'جلسة علاج', followup: 'جلسة متابعة', rehab: 'جلسة تأهيل', home: 'جلسة منزلية',
};
export const WEEKDAY_LABEL = ['الأحد', 'الاثنين', 'الثلاثاء', 'الأربعاء', 'الخميس', 'الجمعة', 'السبت'];

// وسائل الدفع — التسجيل يدوي (مفيش ربط مع بوابات دفع). نفس القائمة في القاعدة: is_payment_method() (هجرة 121).
// «online» قديمة: بتظهر في السجلات القديمة بس ومابتتعرضش في الاختيار.
export const PAYMENT_METHOD_LABEL: Record<string, string> = {
  cash: 'كاش', mada: 'فيزا / ميزة', card: 'بطاقة ائتمان', cash_atm: 'كاش + فيزا', apple_pay: 'Apple Pay', stc_pay: 'محفظة إلكترونية (فودافون كاش)', urpay: 'إنستاباي',
  transfer: 'تحويل بنكي', sadad: 'فوري', tabby: 'ڤاليو', tamara: 'سمبل', cheque: 'شيك', other: 'أخرى', online: 'دفع إلكتروني',
}
// طرق الدفع المعتمدة (2026-10-14 بطلب الإدارة): ATM / تحويل / كاش / Credit / كاش + ATM — الباقي اتلغى (الأسماء فاضلة للسجلات القديمة بس)
export const PAYMENT_METHOD_OPTIONS = ['cash', 'mada', 'stc_pay', 'urpay', 'transfer', 'card', 'cash_atm'].map((value) => ({ value, label: PAYMENT_METHOD_LABEL[value] }));
export const PLAN_STATUS: Record<string, { label: string; tone: string }> = {
  active: { label: 'نشطة', tone: 'brand' }, completed: { label: 'مكتملة', tone: 'ok' }, paused: { label: 'متوقفة', tone: 'muted' },
};
export const PACKAGE_STATUS: Record<string, { label: string; tone: string }> = {
  pending_payment: { label: 'بانتظار الدفع', tone: 'warn' }, active: { label: 'نشطة', tone: 'brand' }, completed: { label: 'مكتملة', tone: 'ok' }, expired: { label: 'منتهية', tone: 'muted' }, cancelled: { label: 'ملغاة', tone: 'danger' },
};
export const STOCK_MOVE_LABEL: Record<string, string> = { purchase: 'شراء (إضافة)', issue: 'صرف (خصم)', adjust_in: 'تسوية بالزيادة', adjust_out: 'تسوية بالنقص' };
export const fmtDateTime = (ts: number) => new Date(ts).toLocaleString(LOCALE, { timeZone: 'Africa/Cairo', day: 'numeric', month: 'short', year: 'numeric', hour: 'numeric', minute: '2-digit' });
export const tsToYmd = (ts: number) => riyadhYmd(new Date(ts));
export const tsToRiyadhYmd = (ts: number) => riyadhYmd(new Date(ts));

// تصدير CSV يفتحه Excel بالعربية (BOM + فاصلة)
export function exportCsv(filename: string, headers: string[], rows: (string | number)[][]) {
  const esc = (v: string | number) => `"${String(v ?? '').replace(/"/g, '""')}"`;
  const csv = '﻿' + [headers, ...rows].map((r) => r.map(esc).join(',')).join('\r\n');
  const url = URL.createObjectURL(new Blob([csv], { type: 'text/csv;charset=utf-8' }));
  const a = document.createElement('a');
  a.href = url; a.download = filename.endsWith('.csv') ? filename : `${filename}.csv`;
  document.body.appendChild(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

export const REFERRAL_SOURCE_LABEL: Record<string, string> = {
  instagram: 'انستغرام',
  facebook: 'فيسبوك',
  twitter: 'تويتر / X',
  snapchat: 'سناب شات',
  tiktok: 'تيك توك',
  whatsapp: 'واتساب',
  google: 'بحث جوجل',
  friend: 'توصية صديق أو قريب',
  ad: 'إعلان',
  website: 'موقع إلكتروني',
  other: 'أخرى',
};

/** رقم الجوال بصيغة دولية لرابط واتساب (أرقام بس، من غير +). بيفهم أي صيغة متسجلة:
 *  سعودي 05xxxxxxxx / 5xxxxxxxx / 966… ، مصري 01xxxxxxxxx / 1xxxxxxxxx / 20… ، +/00، أرقام عربية، مسافات.
 *  (قبل كده الرقم المصري 010… كان بيتحوّل غلط لـ 96610…) */
export const waPhone = (raw: string) => {
  const e164 = parseStoredPhone(raw).e164;
  if (e164) return e164.slice(1);
  const d = toLatinDigits(raw).replace(/\D/g, '');
  if (d.startsWith('00')) return d.slice(2);
  if (d.startsWith('966') || d.startsWith('20')) return d;
  if (/^01[0125]\d{8}$/.test(d)) return `20${d.slice(1)}`;
  if (d.startsWith('0')) return `966${d.slice(1)}`;
  return d.length === 9 ? `966${d}` : d;
};
export const waLink = (phone: string, text: string) => `https://wa.me/${waPhone(phone)}?text=${encodeURIComponent(text)}`;

export const sessionsLabel = (n: number) => n === 1 ? 'جلسة واحدة' : n === 2 ? 'جلستين' : n <= 10 ? `${n} جلسات` : `${n} جلسة`;

// خطة العلاج: إجمالي الجلسات = مدة الخطة بالأسابيع × الجلسات في الأسبوع — دايمًا، ونفس المعادلة في save_plan على الخادم.
export const PLAN_LIMITS = { maxPerWeek: 7, maxWeeks: 52, maxTotal: 200 };
export const planTotalSessions = (durationWeeks: number, sessionsPerWeek: number) => durationWeeks * sessionsPerWeek;
// لما يتحدد عدد جلسات جاهز (عرض 4 أو 6 جلسات أو المقترح من التقييم): نختار أقرب «جلسات/أسبوع» للمطلوب يقسم العدد بالظبط، فتطلع المدة صحيحة من غير كسور
export function planScheduleFor(total: number, preferredPerWeek: number) {
  const pref = Math.min(Math.max(1, Math.floor(preferredPerWeek) || 1), PLAN_LIMITS.maxPerWeek);
  let perWeek = 1;
  for (let x = pref; x >= 1; x--) if (total % x === 0) { perWeek = x; break; }
  return { sessionsPerWeek: perWeek, durationWeeks: total / perWeek, totalSessions: total };
}
export function planScheduleError(durationWeeks: number, sessionsPerWeek: number): string | null {
  if (!Number.isInteger(sessionsPerWeek) || sessionsPerWeek < 1 || sessionsPerWeek > PLAN_LIMITS.maxPerWeek) return `الجلسات في الأسبوع من 1 إلى ${PLAN_LIMITS.maxPerWeek}.`;
  if (!Number.isInteger(durationWeeks) || durationWeeks < 1 || durationWeeks > PLAN_LIMITS.maxWeeks) return `مدة الخطة من 1 إلى ${PLAN_LIMITS.maxWeeks} أسبوع.`;
  if (planTotalSessions(durationWeeks, sessionsPerWeek) > PLAN_LIMITS.maxTotal) return `إجمالي الجلسات ما يزيد عن ${PLAN_LIMITS.maxTotal}.`;
  return null;
}

const EN_ONES = ['', 'One', 'Two', 'Three', 'Four', 'Five', 'Six', 'Seven', 'Eight', 'Nine', 'Ten', 'Eleven', 'Twelve', 'Thirteen', 'Fourteen', 'Fifteen', 'Sixteen', 'Seventeen', 'Eighteen', 'Nineteen'];
const EN_TENS = ['', '', 'Twenty', 'Thirty', 'Forty', 'Fifty', 'Sixty', 'Seventy', 'Eighty', 'Ninety'];
function integerToEnglish(n: number): string {
  if (n === 0) return 'Zero';
  const under1000 = (x: number): string => {
    const parts: string[] = [];
    if (x >= 100) { parts.push(EN_ONES[Math.floor(x / 100)], 'Hundred'); x %= 100; }
    if (x >= 20) { parts.push(EN_TENS[Math.floor(x / 10)]); x %= 10; }
    if (x > 0) parts.push(EN_ONES[x]);
    return parts.join(' ');
  };
  const scales: [number, string][] = [[1_000_000_000, 'Billion'], [1_000_000, 'Million'], [1000, 'Thousand']];
  const out: string[] = [];
  for (const [v, name] of scales) { if (n >= v) { out.push(under1000(Math.floor(n / v)), name); n %= v; } }
  if (n > 0) out.push(under1000(n));
  return out.join(' ');
}
export function amountToEnglishWords(n: number): string {
  const riyals = Math.floor(Math.max(0, n));
  const halalas = Math.round((Math.max(0, n) - riyals) * 100);
  return `${integerToEnglish(riyals)} Egyptian Pound${halalas ? ` and ${integerToEnglish(halalas)} Piastres` : ''} Only`;
}
// 01/09/2026- 2:52:15 PM (بتوقيت الرياض)
export function fmtInvoiceStamp(ms: number): string {
  const p = new Intl.DateTimeFormat('en-GB', { timeZone: 'Africa/Cairo', day: '2-digit', month: '2-digit', year: 'numeric', hour: 'numeric', minute: '2-digit', second: '2-digit', hour12: true }).formatToParts(new Date(ms));
  const g = (t: string) => p.find((x) => x.type === t)?.value ?? '';
  return `${g('day')}/${g('month')}/${g('year')}- ${g('hour')}:${g('minute')}:${g('second')} ${g('dayPeriod').toUpperCase()}`;
}
