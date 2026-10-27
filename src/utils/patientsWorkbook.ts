// ملف Excel كامل للمرضى (للمدير فقط): كل مريض بكل تفاصيله في ورقة، وكل نوع بيانات (خطط، مواعيد، فواتير، مدفوعات) في ورقة
// مستقلة، وأول عمودين في كل ورقة هما «رقم الملف» و«اسم المريض» عشان تفلتر/تدوّر على أي مريض بسهولة.
import { db } from '../data/db';
import { downloadXlsx, type Cell, type Sheet } from './xlsx';
import { APPT_STATUS, INVOICE_STATUS, PAYMENT_METHOD_LABEL, PLAN_STATUS, REFERRAL_SOURCE_LABEL, tsToYmd, todayYmd } from './format';

const ageOf = (birth: string): number | '' => {
  if (!birth) return '';
  const b = new Date(birth + 'T00:00:00'), t = new Date(todayYmd() + 'T00:00:00');
  if (Number.isNaN(b.getTime())) return '';
  let a = t.getFullYear() - b.getFullYear();
  if (t.getMonth() < b.getMonth() || (t.getMonth() === b.getMonth() && t.getDate() < b.getDate())) a--;
  return a >= 0 ? a : '';
};
const num = (n: number | undefined | null): number => Math.round((n ?? 0) * 100) / 100;

export function exportPatientsWorkbook() {
  const d = db.raw();
  const patients = [...d.patients].sort((a, b) => a.fileNo.localeCompare(b.fileNo, 'en', { numeric: true }));
  const P = new Map(d.patients.map((p) => [p.id, p]));
  const svc = (id?: string | null) => d.services.find((s) => s.id === id)?.name ?? (id || '');
  const doc = (id?: string | null) => d.therapists.find((t) => t.id === id)?.name ?? '';
  const who = (pid: string): [string, string] => [P.get(pid)?.fileNo ?? '', P.get(pid)?.fullName ?? 'مريض محذوف'];
  const staff = (id?: string | null) => d.employees.find((e) => e.id === id)?.name ?? '';

  const sessionsDone = new Map<string, number>(), lastVisit = new Map<string, string>();
  for (const s of d.sessions) if (s.status === 'completed') {
    sessionsDone.set(s.patientId, (sessionsDone.get(s.patientId) ?? 0) + 1);
    if (!lastVisit.get(s.patientId) || s.date > lastVisit.get(s.patientId)!) lastVisit.set(s.patientId, s.date);
  }
  const apptCount = new Map<string, number>();
  for (const a of d.appointments) if (a.status !== 'cancelled') apptCount.set(a.patientId, (apptCount.get(a.patientId) ?? 0) + 1);
  const money3 = new Map<string, { total: number; paid: number; remaining: number }>();
  for (const i of d.invoices) if (i.status !== 'cancelled' && i.status !== 'draft') {
    const m = money3.get(i.patientId) ?? { total: 0, paid: 0, remaining: 0 };
    m.total += i.total; m.paid += i.paid; m.remaining += i.remaining; money3.set(i.patientId, m);
  }

  const sheet = (name: string, head: string[], rows: Cell[][], widths: number[]): Sheet => ({ name, rows: [head, ...rows], widths, freezeHeader: true });

  const patientsSheet = sheet('المرضى',
    ['رقم الملف', 'اسم المريض', 'الجنسية', 'الرقم القومي / جواز السفر', 'الجنس', 'تاريخ الميلاد', 'العمر', 'رقم الجوال', 'البريد الإلكتروني', 'المدينة', 'الحي', 'الشارع / العنوان',
      'مصدر المعرفة', 'طريقة التسجيل', 'الطبيب المسؤول', 'الحالة', 'تاريخ التسجيل', 'الشكوى الرئيسية', 'التشخيص', 'ICD-10', 'التاريخ المرضي', 'جهة الطوارئ', 'جوال الطوارئ', 'ملاحظات',
      'عدد المواعيد', 'الجلسات المكتملة', 'آخر زيارة', 'إجمالي الفواتير', 'المدفوع', 'المتبقي'],
    patients.map((p) => {
      const m = money3.get(p.id);
      return [p.fileNo, p.fullName, p.nationality === 'saudi' ? 'مصري' : p.nationality === 'non_saudi' ? 'أجنبي' : '', p.nationalId, p.gender === 'male' ? 'ذكر' : p.gender === 'female' ? 'أنثى' : '',
        p.birthDate, ageOf(p.birthDate), p.phone, p.email ?? '', p.city ?? '', p.district ?? '', [p.street, p.address].filter(Boolean).join(' — '),
        REFERRAL_SOURCE_LABEL[p.referralSource] ?? '', p.signupMethod === 'google' ? 'جوجل' : p.signupMethod === 'phone' ? 'الموقع (جوال)' : 'من الإدارة', doc(p.doctorId), p.active ? 'نشط' : 'معطّل',
        tsToYmd(p.registeredAt), p.mainComplaint, p.diagnosis, p.diagnosisRef?.icd10 ?? '', p.medicalHistory, p.emergencyContactName, p.emergencyContactPhone, p.notes,
        apptCount.get(p.id) ?? 0, sessionsDone.get(p.id) ?? 0, lastVisit.get(p.id) ?? '', num(m?.total), num(m?.paid), num(m?.remaining)];
    }),
    [10, 24, 11, 16, 8, 12, 7, 15, 24, 12, 14, 28, 14, 14, 18, 8, 12, 28, 28, 10, 30, 18, 15, 28, 9, 11, 12, 12, 11, 11]);

  const plansSheet = sheet('الخطط العلاجية',
    ['رقم الملف', 'اسم المريض', 'التشخيص', 'الخدمة', 'الطبيب', 'تاريخ البداية', 'تاريخ النهاية', 'إجمالي الجلسات', 'المكتملة', 'المتبقية', 'جلسات/أسبوع', 'السعر', 'الحالة', 'الهدف الرئيسي'],
    [...d.plans].sort((a, b) => ((b.startDate ?? '') > (a.startDate ?? '') ? 1 : -1)).map((p) => {
      const done = d.sessions.filter((s) => s.planId === p.id && s.status === 'completed').length;
      return [...who(p.patientId), p.diagnosis, svc(p.serviceId), doc(p.therapistId), p.startDate, p.endDate, p.totalSessions, done, Math.max(0, p.totalSessions - done), p.sessionsPerWeek, num(p.price), PLAN_STATUS[p.status]?.label ?? p.status, p.mainGoal];
    }),
    [10, 24, 28, 22, 18, 12, 12, 10, 10, 10, 10, 10, 10, 30]);

  const apptSheet = sheet('المواعيد',
    ['رقم الملف', 'اسم المريض', 'رقم الموعد', 'التاريخ', 'الوقت', 'الخدمة', 'الطبيب', 'الحالة', 'السعر', 'ضمن خطة / باقة', 'سبب الإلغاء'],
    [...d.appointments].sort((a, b) => (a.date + a.time < b.date + b.time ? 1 : -1)).map((a) => [...who(a.patientId), a.no, a.date, a.time, svc(a.serviceId), doc(a.therapistId), APPT_STATUS[a.status]?.label ?? a.status, num(a.price), a.planId ? 'خطة علاجية' : a.packageId ? 'باقة' : '', a.cancelReason ?? '']),
    [10, 24, 12, 12, 8, 22, 18, 12, 10, 14, 24]);

  const invSheet = sheet('الفواتير',
    ['رقم الملف', 'اسم المريض', 'رقم الفاتورة', 'التاريخ', 'الخدمة', 'السعر', 'الخصم', 'الضريبة', 'الإجمالي', 'المدفوع', 'المتبقي', 'الحالة'],
    [...d.invoices].sort((a, b) => (a.date < b.date ? 1 : -1)).map((i) => [...who(i.patientId), i.no, i.date, i.serviceName, num(i.price), num(i.discount), num(i.taxAmount), num(i.total), num(i.paid), num(i.remaining), INVOICE_STATUS[i.status]?.label ?? i.status]),
    [10, 24, 14, 12, 28, 10, 10, 10, 11, 11, 11, 12]);

  const invNo = new Map(d.invoices.map((i) => [i.id, i.no]));
  const paySheet = sheet('المدفوعات',
    ['رقم الملف', 'اسم المريض', 'رقم الفاتورة', 'التاريخ', 'المبلغ', 'طريقة الدفع', 'المحاسب', 'الحالة', 'ملاحظات'],
    [...d.payments].sort((a, b) => b.date - a.date).map((p) => [...who(p.patientId), invNo.get(p.invoiceId) ?? '', tsToYmd(p.date), num(p.amount), PAYMENT_METHOD_LABEL[p.method] ?? p.method, staff(p.createdBy), p.voidedAt ? 'ملغاة' : 'سارية', p.note]),
    [10, 24, 14, 12, 11, 14, 18, 9, 28]);

  downloadXlsx(`ملف المرضى الكامل - ${todayYmd()}`, [patientsSheet, plansSheet, apptSheet, invSheet, paySheet]);
}
