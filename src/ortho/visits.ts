// الزيارات (المواعيد) اللي اتعملها حضور النهارده + حالة تشخيص كل زيارة — قايمة «بانتظار التشخيص» مبنية على الحضور الفعلي
// (حضر / قيد الزيارة / مكتمل) وعلى تشخيص الزيارة نفسها، مش على وجود حجز. التشخيص بيتربط بالزيارة بـ appointment_id (هجرة 918).
import { db } from '../data/db';
import { isIncomplete, ortho, type Consultation } from './data';
import type { Appointment } from '../types';

export const ATTENDED = new Set(['arrived', 'in_progress', 'completed']);
export type VisitState = 'waiting' | 'incomplete' | 'done';
export interface VisitDx { a: Appointment; consult?: Consultation; state: VisitState }

/** تشخيص الزيارة: المربوط بيها — أو (كشوفات قبل الربط) كشف نفس اليوم لنفس المريض من غير زيارة */
export function consultForVisit(a: Appointment, consults: Consultation[]): Consultation | undefined {
  return consults.find((c) => c.appointmentId === a.id)
    ?? consults.find((c) => !c.appointmentId && c.patientId === a.patientId && c.date === a.date);
}

/** زيارات النهارده اللي اتعملها حضور — زيارة واحدة لكل مريض (أول زيارة لسه ما اتشخصتش، وإلا آخر زيارة اتشخصت) */
export function todaysVisits(): VisitDx[] {
  const consults = ortho.list('consultations');
  const byPatient = new Map<string, VisitDx>();
  const order: VisitState[] = ['incomplete', 'waiting', 'done'];
  for (const a of db.todayAppointments().filter((x) => ATTENDED.has(x.status)).sort((x, y) => x.time.localeCompare(y.time))) {
    const consult = consultForVisit(a, consults);
    const state: VisitState = !consult ? 'waiting' : isIncomplete(consult) ? 'incomplete' : 'done';
    const cur = byPatient.get(a.patientId);
    if (!cur || order.indexOf(state) < order.indexOf(cur.state)) byPatient.set(a.patientId, { a, consult, state });
  }
  return [...byPatient.values()];
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
