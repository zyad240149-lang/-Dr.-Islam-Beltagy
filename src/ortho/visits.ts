// الزيارات (المواعيد) اللي اتعملها حضور النهارده + حالة تشخيص كل زيارة — قايمة «بانتظار التشخيص» مبنية على الحضور الفعلي
// (حضر / قيد الزيارة / مكتمل) وعلى تشخيص الزيارة نفسها، مش على وجود حجز. التشخيص بيتربط بالزيارة بـ appointment_id (هجرة 918).
import { db } from '../data/db';
import { isIncomplete, ortho, type Consultation } from './data';
import type { Appointment, Patient } from '../types';
import { todayYmd } from '../utils/format';
import { namesTypoClose, phoneMatches } from '../utils/phoneUtils';

// تاريخ لحظة معيّنة بتوقيت العيادة — نفس توقيت todayYmd
const ymdInClinicTz = (ms: number) => new Date(ms).toLocaleDateString('en-CA', { timeZone: 'Africa/Cairo' });

export const ATTENDED = new Set(['arrived', 'in_progress', 'completed']);
export type VisitState = 'waiting' | 'incomplete' | 'done';
export interface VisitDx { a: Appointment; consult?: Consultation; state: VisitState }

/** تشخيص اتعمل بالاسم من غير ملف (غالبًا والنت فاصل) لنفس مريض الزيارة: نفس اليوم، واسم قريب والموبايل مايختلفش، أو اسم مختلف بنفس الموبايل */
function unlinkedMatchesVisit(c: Consultation, a: Appointment): boolean {
  if (c.patientId || c.date !== a.date || !c.pendingPatient?.name) return false;
  const p = db.patient(a.patientId);
  if (!p) return false;
  const phone = c.pendingPatient.phone?.trim();
  // الاسم قريب (غلطة كتابة صغيرة) ← يكمل طالما الموبايل مش مختلف؛ الاسم مختلف ← الموبايل لازم يطابق
  if (namesTypoClose(c.pendingPatient.name, p.fullName)) return !phone || !p.phone || phoneMatches(p.phone, phone);
  return !!phone && !!p.phone && phone.replace(/\D/g, '').length >= 9 && phoneMatches(p.phone, phone);
}

/** الزيارة تستنى تشخيص: حضور كشف أو استشارة بس — زيارات المتابعة والخدمات التانية مالهاش مكان في القايمة */
export function needsDiagnosis(a: Appointment): boolean {
  if (a.type === 'followup') return false;
  const name = db.service(a.serviceId)?.name;
  return !name || /كشف|استشار/.test(name);
}

/** تشخيص الزيارة: المربوط بيها — أو (كشوفات قبل الربط) كشف نفس اليوم لنفس المريض من غير زيارة، أو بنفس الاسم من غير ملف */
export function consultForVisit(a: Appointment, consults: Consultation[]): Consultation | undefined {
  return consults.find((c) => c.appointmentId === a.id)
    ?? consults.find((c) => !c.appointmentId && c.patientId === a.patientId && c.date === a.date)
    ?? consults.find((c) => unlinkedMatchesVisit(c, a));
}

/** زيارات النهارده اللي اتعملها حضور كشف أو استشارة — زيارة واحدة لكل مريض (أول زيارة لسه ما اتشخصتش، وإلا آخر زيارة اتشخصت) */
export function todaysVisits(): VisitDx[] {
  const consults = ortho.list('consultations');
  const byPatient = new Map<string, VisitDx>();
  const order: VisitState[] = ['incomplete', 'waiting', 'done'];
  for (const a of db.todayAppointments().filter((x) => ATTENDED.has(x.status) && needsDiagnosis(x)).sort((x, y) => x.time.localeCompare(y.time))) {
    const consult = consultForVisit(a, consults);
    const state: VisitState = !consult ? 'waiting' : isIncomplete(consult) ? 'incomplete' : 'done';
    const cur = byPatient.get(a.patientId);
    if (!cur || order.indexOf(state) < order.indexOf(cur.state)) byPatient.set(a.patientId, { a, consult, state });
  }
  return [...byPatient.values()];
}

/** ملفات اتفتحت النهارده ولسه أصحابها ما اتشخصوش — بتظهر في «بانتظار التشخيص» حتى لو الاستقبال ما عملش حضور (الأحدث أولًا) */
export function newFilesToday(): Patient[] {
  const consults = ortho.list('consultations');
  const t = todayYmd();
  return db.patients()
    .filter((p) => p.registeredAt && ymdInClinicTz(p.registeredAt) === t && !consults.some((c) => c.patientId === p.id))
    .sort((a, b) => b.registeredAt - a.registeredAt);
}

/** زيارة النهارده المفتوحة للمريض (اتعمله حضور ولسه مالهاش تشخيص) — التشخيص الجديد بيتربط بيها */
export function openVisitFor(patientId: string): Appointment | undefined {
  if (!patientId) return undefined;
  const consults = ortho.list('consultations', patientId);
  return db.todayAppointments()
    .filter((a) => a.patientId === patientId && ATTENDED.has(a.status) && !consultForVisit(a, consults))
    .sort((x, y) => x.time.localeCompare(y.time))[0];
}

export const visitLabel = (a: Appointment) => `زيارة ${a.no}`;

/** «متابعة المرضى»: زيارات النهارده اللي اتعملها حضور لمرضى ليهم تشخيص قبل كده (أو اتشخصوا في نفس الزيارة) — زيارة واحدة لكل مريض */
export function todaysFollowUps(): Appointment[] {
  const consults = ortho.list('consultations');
  const seen = new Set<string>();
  return db.todayAppointments().filter((a) => ATTENDED.has(a.status)).sort((x, y) => x.time.localeCompare(y.time)).filter((a) => {
    if (seen.has(a.patientId) || !consults.some((c) => c.patientId === a.patientId && (c.date < a.date || consultForVisit(a, [c])))) return false;
    seen.add(a.patientId); return true;
  });
}
