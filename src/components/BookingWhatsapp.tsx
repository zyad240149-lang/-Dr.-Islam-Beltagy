// أيقونة واتساب جنب بيانات حجز الكشف / حجز المتابعة ← قايمة: تذكير بالموعد · إرسال التمارين · إرسال الفاتورة.
// كله على رقم الموبايل المسجّل في ملف المريض (رقم الواتساب لو متحدد، وإلا الموبايل الأساسي). مفيش إرسال تلقائي:
// واتساب بيتفتح والرسالة جاهزة والموظف بيضغط «إرسال». كل اختيار بصلاحيته: «رسائل واتساب للمرضى» / «التمرينات العلاجية» / «الفواتير والمدفوعات».
import { useEffect, useRef, useState } from 'react';
import { db } from '../data/db';
import { sendWhatsApp } from '../data/whatsappSend';
import { useDbVersion } from '../hooks/useDb';
import { useToast } from '../hooks/useToast';
import { net } from '../offline/net';
import { ExerciseSendModal, useCanSendExercises } from '../ortho/ExerciseSend';
import { ortho, type FollowUp } from '../ortho/data';
import { fmtTime, waPhone, whatsappNumber } from '../utils/format';
import { Icon } from '../utils/icons';
import { useCan } from './common';
import { invoiceOfAppointment, useInvoiceWhatsapp } from './InvoiceActions';
import type { Appointment } from '../types';

const CENTER = 'عيادة د. إسلام بلتاجي لجراحة العظام والكسور';
const longDay = (ymd: string) => new Intl.DateTimeFormat('ar-EG', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' }).format(new Date(ymd + 'T00:00:00'));
const hhmm = (t?: string) => (t ? String(t).slice(0, 5) : '');

export const WA_BOOKING_MSG = {
  noPhone: 'مفيش رقم موبايل مسجّل في ملف المريض — ضيف الرقم من ملف المريض الأول.',
  badPhone: 'رقم الموبايل المسجّل في ملف المريض مش صحيح — راجعه من ملف المريض.',
  offline: 'واتساب محتاج اتصال بالإنترنت — جرّب لما النت يرجع.',
  blocked: 'المتصفح منع فتح واتساب — اسمح بالنوافذ المنبثقة للموقع ده وجرّب تاني.',
  noInvoice: 'مفيش فاتورة للحجز ده لسه.',
};

/** رقم المريض للواتساب: رقم الواتساب المتحدد في الملف ← الموبايل الأساسي. '' = مفيش، null = مش صحيح */
export function patientWaNumber(patientId: string): string | null {
  const p = db.patient(patientId);
  const raw = (p ? whatsappNumber(p) || p.phone || '' : '').trim();
  if (!raw) return '';
  const n = waPhone(raw);
  return n.length >= 10 && n.length <= 15 ? n : null;
}

/** نص التذكير: اسم المريض + اسم الدكتور + تاريخ ووقت الحجز */
export function bookingReminderText(x: { patientId: string; date: string; time?: string; doctorId?: string | null; kind: string }) {
  const p = db.patient(x.patientId);
  const doc = x.doctorId ? db.therapist(x.doctorId)?.name : '';
  return [
    `أهلاً ${p?.fullName ?? ''}،`,
    `تذكير بموعد ${x.kind}${doc ? ` مع ${doc}` : ''}`,
    `📅 ${longDay(x.date)}${x.time ? `\n⏰ الساعة ${fmtTime(hhmm(x.time))}` : ''}`,
    `${CENTER} — في انتظارك، ولو محتاج تغيّر الموعد كلّمنا.`,
  ].join('\n');
}

export function BookingWhatsapp({ patientId, appointmentId, followUp }: { patientId: string; appointmentId?: string | null; followUp?: FollowUp | null }) {
  useDbVersion();
  const can = useCan();
  const toast = useToast();
  const [open, setOpen] = useState(false);
  const [ex, setEx] = useState<{ sel?: string[] } | null>(null);
  const box = useRef<HTMLSpanElement>(null);
  const appt: Appointment | undefined = appointmentId ? db.appointment(appointmentId) : undefined;
  const live = appt && appt.status !== 'cancelled' ? appt : undefined;
  const invoice = live ? invoiceOfAppointment(live.id) : undefined;
  const inv = useInvoiceWhatsapp(invoice && invoice.status !== 'cancelled' ? invoice : undefined);
  const canRemind = can('whatsapp', 'create');
  const canEx = useCanSendExercises();
  const canInv = can('invoices', 'view');
  useEffect(() => {
    if (!open) return;
    const close = (e: MouseEvent) => { if (!box.current?.contains(e.target as Node)) setOpen(false); };
    const esc = (e: KeyboardEvent) => { if (e.key === 'Escape') setOpen(false); };
    document.addEventListener('mousedown', close); document.addEventListener('keydown', esc);
    return () => { document.removeEventListener('mousedown', close); document.removeEventListener('keydown', esc); };
  }, [open]);
  if (!patientId || !(canRemind || canEx || canInv)) return null;

  /** المشاكل اللي بتمنع واتساب قبل أي حاجة: رقم ناقص/غلط أو مفيش نت */
  const blocker = (): string | null => {
    const n = patientWaNumber(patientId);
    if (n === '') return WA_BOOKING_MSG.noPhone;
    if (n === null) return WA_BOOKING_MSG.badPhone;
    if (!net.isOnline()) return WA_BOOKING_MSG.offline;
    return null;
  };
  const guard = (f: () => void) => () => {
    setOpen(false);
    const why = blocker();
    if (why) { toast.error(why); return; }
    f();
  };

  const remind = guard(() => {
    const when = live ? { date: live.date, time: live.time, doctorId: live.therapistId, kind: live.type === 'followup' || followUp ? 'المتابعة' : 'الكشف' }
      : followUp ? { date: followUp.date, time: followUp.time, doctorId: followUp.doctorId, kind: 'المتابعة' } : null;
    if (!when) { toast.error('مفيش موعد للتذكير بيه.'); return; }
    const phone = patientWaNumber(patientId)!;
    const w = sendWhatsApp({ phone, text: bookingReminderText({ patientId, ...when }), patientId, type: 'reminder' });
    if (!w) toast.error(WA_BOOKING_MSG.blocked);
    else toast.success('اتفتح واتساب على رقم المريض والتذكير جاهز — اضغط «إرسال».');
  });
  const exercises = guard(() => {
    // التمارين المربوطة بتشخيص المريض: خطة التشخيص بتاع المتابعة دي ← خطة آخر تشخيص ← آخر خطة
    const plans = ortho.list('exercise_plans', patientId);
    const lastConsult = ortho.list('consultations', patientId).sort((a, b) => b.date.localeCompare(a.date))[0];
    const plan = plans.find((x) => followUp?.consultationId && x.consultationId === followUp.consultationId) ?? plans.find((x) => lastConsult && x.consultationId === lastConsult.id) ?? plans[0];
    setEx({ sel: plan?.exerciseIds });
  });
  const sendInvoice = guard(() => {
    if (!invoice || invoice.status === 'cancelled') { toast.error(WA_BOOKING_MSG.noInvoice); return; }
    void inv.send();
  });

  return (
    <span className="bk-wa" ref={box} onClick={(e) => e.stopPropagation()}>
      <button type="button" className="bk-wa__btn" aria-haspopup="menu" aria-expanded={open} aria-label="واتساب" title="واتساب: تذكير / تمارين / فاتورة" onClick={() => setOpen((x) => !x)}>
        <svg width="18" height="18" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true"><path d="M17.5 14.4c-.3-.1-1.7-.8-2-.9-.3-.1-.5-.1-.7.1-.2.3-.8.9-.9 1.1-.2.2-.3.2-.6.1-.3-.1-1.2-.5-2.3-1.4-.9-.8-1.4-1.7-1.6-2-.2-.3 0-.5.1-.6l.4-.5c.1-.2.2-.3.3-.5.1-.2 0-.4 0-.5l-.9-2.2c-.2-.6-.5-.5-.7-.5h-.6c-.2 0-.5.1-.8.4-.3.3-1 1-1 2.4s1 2.8 1.2 3c.1.2 2 3.1 4.9 4.3.7.3 1.2.5 1.7.6.7.2 1.3.2 1.8.1.6-.1 1.7-.7 1.9-1.4.2-.7.2-1.2.2-1.4-.1-.1-.3-.2-.6-.3zM12 2a10 10 0 0 0-8.6 15.1L2 22l5-1.3A10 10 0 1 0 12 2zm0 18.2c-1.6 0-3.1-.4-4.4-1.2l-.3-.2-3 .8.8-2.9-.2-.3A8.2 8.2 0 1 1 12 20.2z" /></svg>
      </button>
      {open && (
        <span className="bk-wa__menu" role="menu">
          {canRemind && <button type="button" role="menuitem" onClick={remind}><Icon name="calendar" size={15} /> تذكير بالموعد</button>}
          {canEx && <button type="button" role="menuitem" onClick={exercises}><Icon name="share" size={15} /> إرسال التمارين</button>}
          {canInv && <button type="button" role="menuitem" disabled={inv.state === 'preparing'} onClick={sendInvoice}><Icon name="receipt" size={15} /> إرسال الفاتورة{!invoice ? <small> — مفيش فاتورة</small> : null}</button>}
        </span>
      )}
      {ex && <ExerciseSendModal patientId={patientId} initialSel={ex.sel} onClose={() => setEx(null)} />}
      {inv.ui}
    </span>
  );
}
