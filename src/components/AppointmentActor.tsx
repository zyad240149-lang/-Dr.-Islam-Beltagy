// مين حجز الموعد ومين لغاه — البيانات بتتسجّل على الخادم (تريجر هجرة 166)، هنا عرض بس.
import type { Appointment } from '../types';
import { fmtDateTime } from '../utils/format';

const ROLE_SHORT: Record<string, string> = {
  system_admin: 'المدير العام', center_manager: 'مدير المركز', secretary: 'سكرتارية',
  reception: 'استقبال', accountant: 'محاسب', therapist: 'دكتور',
};
const roleShort = (r?: string | null) => (r ? ROLE_SHORT[r] ?? r : '');

export const isOnline = (a: Appointment) => a.createdByKind === 'patient' || (!a.createdByKind && a.source === 'online');

/** الاسم + الوظيفة (الاسم مابيتترجمش) */
export function Who({ name, role }: { name?: string | null; role?: string | null }) {
  return <>{name ? <span data-no-i18n>{name}</span> : <span>موظف</span>}{role && <> — <span>{roleShort(role)}</span></>}</>;
}

export function bookedTitle(a: Appointment) {
  const at = a.createdAt ? fmtDateTime(a.createdAt) : '';
  if (isOnline(a)) return `حجزه المريض بنفسه أونلاين${at ? ' — ' + at : ''}`;
  if (a.createdByKind === 'staff') return `حجزه ${a.createdByName ?? 'موظف'}${a.createdByRole ? ' (' + roleShort(a.createdByRole) + ')' : ''}${at ? ' — ' + at : ''}`;
  return at;
}

function cancelTitle(a: Appointment) {
  const parts = [a.cancelledAt ? fmtDateTime(a.cancelledAt) : '', a.cancelReason ? 'السبب: ' + a.cancelReason : ''].filter(Boolean);
  return parts.join(' — ');
}

/** شارة الحجز: «حجز أونلاين من الموقع» أو «حجزه: سارة — استقبال» */
export function BookedBadge({ a, className = 'actor-badge' }: { a: Appointment; className?: string }) {
  if (isOnline(a)) return <b className={`${className} actor-badge--web`} title={bookedTitle(a)}>حجز أونلاين من الموقع</b>;
  if (a.createdByKind === 'staff') return <b className={`${className} actor-badge--staff`} title={bookedTitle(a)}><span>حجزه:</span> <Who name={a.createdByName} role={a.createdByRole} /></b>;
  if (a.createdByKind === 'system') return <b className={`${className} actor-badge--sys`} title={bookedTitle(a)}>حجز آلي</b>;
  return null;
}

/** شارة الإلغاء: «ألغاه المريض» أو «ألغاه: أحمد — استقبال» (للموعد الملغي بس) */
export function CancelledBadge({ a, className = 'actor-badge' }: { a: Appointment; className?: string }) {
  if (a.status !== 'cancelled') return null;
  const t = cancelTitle(a);
  if (a.cancelledByKind === 'patient') return <b className={`${className} actor-badge--cancel`} title={t}>ألغاه المريض</b>;
  if (a.cancelledByKind === 'staff') return <b className={`${className} actor-badge--cancel`} title={t}><span>ألغاه:</span> <Who name={a.cancelledByName} role={a.cancelledByRole} /></b>;
  if (a.cancelledByKind === 'system') return <b className={`${className} actor-badge--cancel`} title={t}>ألغاه النظام</b>;
  return <b className={`${className} actor-badge--cancel`} title={t}>ملغي — من ألغاه غير معروف</b>;
}

/** الشارتين مع بعض (للصفوف والكروت) */
export function ActorBadges({ a, className }: { a: Appointment; className?: string }) {
  return <span className="actor-badges"><BookedBadge a={a} className={className} /><CancelledBadge a={a} className={className} /></span>;
}

/** سطور تفاصيل الموعد: مين حجز وإمتى، ومين لغى وإمتى وليه */
export function ActorDetails({ a }: { a: Appointment }) {
  const online = isOnline(a);
  return (
    <>
      <div><dt>حجزه</dt><dd>{online ? 'المريض (حجز أونلاين من الموقع)' : a.createdByKind === 'staff' ? <Who name={a.createdByName} role={a.createdByRole} /> : a.createdByKind === 'system' ? 'النظام (حجز آلي)' : 'غير معروف'}</dd></div>
      <div><dt>وقت الحجز</dt><dd className="num">{a.createdAt ? fmtDateTime(a.createdAt) : '—'}</dd></div>
      {a.status === 'cancelled' && <>
        <div><dt>ألغاه</dt><dd>{a.cancelledByKind === 'patient' ? 'المريض' : a.cancelledByKind === 'staff' ? <Who name={a.cancelledByName} role={a.cancelledByRole} /> : a.cancelledByKind === 'system' ? 'النظام' : 'غير معروف'}</dd></div>
        <div><dt>وقت الإلغاء</dt><dd className="num">{a.cancelledAt ? fmtDateTime(a.cancelledAt) : '—'}</dd></div>
      </>}
    </>
  );
}
