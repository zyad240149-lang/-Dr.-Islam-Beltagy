import type { Patient } from '../types';

// البيانات الناقصة في ملف المريض — نسخة طبق الأصل من patient_missing_fields() على الخادم (هجرة 159)؛ أي تغيير هنا لازم يتعمل هناك.
// بتتحسب من البيانات الحالية فبتختفي أول ما الموظف يكمّلها. الخادم هو اللي بيمنع تأكيد الموعد/اعتماد الفاتورة لو فيه نقص.
// الاسم بالعربي: حروف عربية (ء–ي + تشكيل + ـ + حروف فارسية شائعة) ومسافات بس — نفس is_arabic_name() على الخادم (هجرة 162)
export const ARABIC_NAME_RE = /^[\u0621-\u063A\u0640-\u0652\u0670\u067E\u0686\u0698\u06A9\u06AF\u06CC ]+$/;
export const isArabicName = (s: string) => ARABIC_NAME_RE.test((s ?? '').trim().replace(/\s+/g, ' ')) && (s ?? '').trim() !== '';
export const nameWords = (s: string) => (s ?? '').trim().split(/\s+/).filter(Boolean).length;
export const ARABIC_NAME_ERROR = 'اكتب اسمك الثلاثي بالعربي (الاسم واسم الأب واسم الجد) — بحروف عربية فقط';
export const INCOMPLETE_MESSAGE = 'بيانات المريض غير مكتملة. يجب استكمال البيانات المطلوبة قبل تأكيد الموعد أو اعتماد الفاتورة';

export function patientGaps(p: Pick<Patient, 'fullName' | 'phone' | 'nationalId' | 'nationalityUnconfirmed' | 'genderUnknown'> & { nationality?: Patient['nationality'] }): string[] {
  const g: string[] = [];
  if (nameWords(p.fullName ?? '') < 3 || !isArabicName(p.fullName ?? '')) g.push('الاسم الثلاثي بالعربي');
  if ((p.phone ?? '').replace(/\D/g, '').length < 9) g.push('رقم الجوال');
  if (p.nationalityUnconfirmed) g.push('الجنسية (مصري / أجنبي)');
  const id = (p.nationalId ?? '').trim();
  const foreign = p.nationality === 'non_saudi'; // القيمة المخزنة non_saudi = أجنبي، saudi = مصري
  if (foreign ? !/^[A-Za-z0-9]{6,20}$/.test(id) : !/^[23]\d{13}$/.test(id)) g.push(foreign ? 'رقم جواز السفر' : 'الرقم القومي');
  if (p.genderUnknown) g.push('الجنس');
  return g;
}

export const isPatientComplete = (p: Parameters<typeof patientGaps>[0]) => patientGaps(p).length === 0;
