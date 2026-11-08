import { useEffect, useState } from 'react';
import type { Patient, PaymentMethod, ReferralSource } from '../types';
import { db, DOCTOR_DAY_LABEL } from '../data/db';
import { branchForDate } from './WorkHoursEditor';
import { useDbVersion } from '../hooks/useDb';
import { Modal, Button, Input, Select } from './ui';
import { PhoneInput } from './PhoneInput';
import { Icon } from '../utils/icons';
import { phoneMatches } from '../utils/phoneUtils';
import { money, fmtDate, APPT_STATUS, fmtTime, todayYmd, addDaysYmd, REFERRAL_SOURCE_LABEL, PAYMENT_METHOD_LABEL, PAYMENT_METHOD_OPTIONS } from '../utils/format';

const endTimeOf = (t: string, min: number) => { const [h, m] = t.split(':').map(Number); const v = h * 60 + m + min; return `${String(Math.floor(v / 60) % 24).padStart(2, '0')}:${String(v % 60).padStart(2, '0')}`; };
const fmtDayName = (ymd: string) => new Date(ymd + 'T00:00:00').toLocaleDateString(document.documentElement.lang === 'en' ? 'en-GB' : 'ar-SA-u-nu-latn', { weekday: 'long' });
import { useToast } from '../hooks/useToast';
import { InvoiceFileButtons, InvoiceWhatsappButton } from './InvoiceActions';
import { EditPatientModal } from './PatientForms';
import { useNavigate } from 'react-router-dom';

const STEPS = ['المريض', 'الخدمة', 'الدكتور', 'التاريخ والوقت']; // ٩/١١: «المراجعة» اتشالت — الحجز من آخر خطوة

export default function BookingWizard({ onClose, presetPatientId, presetServiceId, presetTherapistId, presetDate, presetTime }: { onClose: () => void; presetPatientId?: string; presetServiceId?: string; presetTherapistId?: string; presetDate?: string; presetTime?: string }) {
  useDbVersion(); // يعيد رسم الأوقات فورًا لما حجز/إلغاء يوصل من جهاز تاني
  const toast = useToast();
  const navigate = useNavigate();
  const [step, setStep] = useState(0);
  const [unlocked, setUnlocked] = useState(false);
  const lockedPreset = !!(presetTherapistId && presetDate && presetTime) && !unlocked;
  const [busy, setBusy] = useState(false);

  const [patientId, setPatientId] = useState(presetPatientId ?? '');
  const [mode, setMode] = useState<'search' | 'call'>('search'); // بحث عن مريض مسجّل | حجز عن طريق مكالمة (اسم + جوال)
  const [patientQuery, setPatientQuery] = useState('');
  const [np, setNp] = useState({ fullName: '', phone: '', gender: 'male' as 'male' | 'female', nationality: 'saudi' as 'saudi' | 'non_saudi', referralSource: 'instagram' as ReferralSource });

  const [serviceId, setServiceId] = useState(presetServiceId ?? '');
  // الدكتور إجباري: مفيش «أي دكتور» ولا قيمة افتراضية. بيتحدد مسبقًا بس لو جاي من «جدول المواعيد اليومي» (ضغطة صريحة على خانة طبيب)
  const [therapistId, setTherapistId] = useState(presetTherapistId ?? '');
  // من «جدول المواعيد اليومي»: الضغط على خانة متاحة بيفتح الحجز على نفس الطبيب واليوم والوقت (والحجز لسه بيتحقق من التوفر عادي)
  const [date, setDate] = useState(presetDate ?? '');
  const [time, setTime] = useState(presetTime ?? '');
  const [packageChoice, setPackageChoice] = useState<string>('auto');
  const [planChoice, setPlanChoice] = useState<string>('auto');
  const [priceId, setPriceId] = useState('');
  const [notes, setNotes] = useState('');
  const [payAmount, setPayAmount] = useState('');
  const [payMethod, setPayMethod] = useState<PaymentMethod>('cash');
  // «المريض موجود» (في العيادة دلوقتي): الموعد بيتحجز النهارده في الوقت اللي تختاره، وحضوره بيتأكد على طول بعد الحجز
  const [walkIn, setWalkIn] = useState(false);
  const [confirmed, setConfirmed] = useState(false); // ٨/١١: الحجز مؤكد ولا غير مؤكد
  const [completeData, setCompleteData] = useState(false);
  const [callFile, setCallFile] = useState<string | null>(null); // حجز مكالمة: رقم الملف اللي اتعمل للمتصل
  const [result, setResult] = useState<{ id: string; patientId: string; no: string; date: string; time: string; therapist: string } | null>(null);

  const center = db.center();
  // حجز بالتليفون: اسم + جوال. لو الجوال/الاسم لمريض مسجّل بيظهر للاختيار (من غير تكرار ملفات)
  const phoneOk = np.phone.replace(/\D/g, '').length >= 9;
  const existingByPhone = !patientId && phoneOk ? db.findByPhone(np.phone) : undefined;
  const queryResults = !patientId && patientQuery.trim() ? db.searchPatients(patientQuery).slice(0, 8) : [];
  const searchResults = patientId ? [] : (phoneOk ? db.patients().filter((x) => phoneMatches(x.phone, np.phone)) : np.fullName.trim().length >= 2 ? db.searchPatients(np.fullName) : []).slice(0, 5);
  const patient = patientId ? db.patient(patientId) : undefined;
  // لو الحجز من خانة دكتور معيّن: الخدمات اللي يقدّمها هالدكتور بس (تخصيص الخدمة لدكتور)
  // ٨/١١: الحجز بيعرض «كشف» و«متابعة» بس
  const services = db.services().filter((x) => (x.name.trim() === 'كشف' || /^متابع/.test(x.name.trim()))).filter((x) => !presetTherapistId || therapistId !== presetTherapistId || x.therapistIds.includes(presetTherapistId));
  const service = serviceId ? db.service(serviceId) : undefined;
  const duration = service?.durationMin ?? 15;
  const qualifiedTherapists = serviceId ? db.therapistsForService(serviceId) : [];

  // أوقات الدكتور المختار بس (ساعات المركز + إجازته + حجوزاته) — مفيش أوقات قبل اختيار الدكتور
  // الأوقات لازم تكون من آخر نسخة من الخادم: لو الكاش قديم (اتصال لحظي مقطوع) وقت «فاضي» ممكن يطلع محجوز عند التأكيد
  // (ومعاها جدول الدكتور + العطلات/الإجازات عشان أي تعديل في دوامه يبان فورًا)
  useEffect(() => { if (therapistId && date) void db.refresh('appointments', 'catalog', 'center'); }, [therapistId, date]);
  const docDay = therapistId && date ? db.doctorDay(therapistId, date) : null;
  const slots = serviceId && date && therapistId ? db.availableSlots(therapistId, date, duration, undefined, patientId || undefined) : [];
  const takenSet = new Set<string>();
  const ptBusySet = new Set<string>(); // المريض عنده موعد تاني في الوقت ده (مع أي دكتور) — الخادم بيرفضه
  if (serviceId && date && therapistId) {
    for (const s of db.takenSlots(therapistId, date, duration)) if (!slots.includes(s)) takenSet.add(s);
    if (patientId) for (const s of db.patientBusySlots(patientId, therapistId, date, duration)) if (!takenSet.has(s)) ptBusySet.add(s);
  }
  const allSlots = [...slots, ...takenSet, ...ptBusySet].sort(); // الأوقات اللي فاتت (بتوقيت القاهرة) مش بتظهر
  // حجز أسهل: أزرار لأقرب الأيام اللي فيها أوقات فاضية (خلال أسبوعين) بعدد الأوقات، وأول يوم بيتختار لوحده
  const quickDays = (() => {
    if (!serviceId || !therapistId) return [] as Array<{ date: string; free: number }>;
    const out: Array<{ date: string; free: number }> = [];
    for (let i = 0; i < 14 && out.length < 7; i++) {
      const d = addDaysYmd(todayYmd(), i);
      const free = db.availableSlots(therapistId, d, duration).length;
      if (free > 0) out.push({ date: d, free });
    }
    return out;
  })();
  useEffect(() => {
    if (step === 3 && walkIn && date !== todayYmd()) { setDate(todayYmd()); setTime(''); return; }
    if (step === 3 && !date && quickDays.length) setDate(quickDays[0].date);
  }, [step, date, walkIn, quickDays.length ? quickDays[0].date : '']);
  // وقت جاي من «جدول المواعيد اليومي»: لو بقى مش متاح للخدمة المختارة يتمسح (ويختار وقت تاني)
  // ⚠️ مش أثناء الحجز ولا بعده: الموعد اللي لسه اتسجّل بيشغل نفس الخانة، فكانت بتطلع «مش مناسبة» غلط بعد ما الحجز ينجح
  const presetSlotGone = !!(presetTime && time === presetTime && serviceId && date && therapistId && !busy && !result && !slots.includes(time));
  useEffect(() => {
    if (!presetSlotGone) return;
    // الخانة اللي ضغطت عليها ماعادتش تتسع للخدمة دي (أو اتحجزت) → نفتح اختيار الوقت بدل ما نوقفك
    setTime('');
    if (lockedPreset) { setUnlocked(true); setStep(3); toast.error('هذي الخانة غير مناسبة لمدة هذي الخدمة أو حُجزت — اختر وقت ثاني.'); }
  }, [presetSlotGone]);

  const extraPrices = serviceId ? db.servicePrices(serviceId).filter((p) => p.active && (!p.therapistId || p.therapistId === therapistId)) : [];
  const chosenPrice = extraPrices.find((p) => p.id === priceId);
  const shownPrice = chosenPrice?.price ?? (service?.price ?? 0);
  const eligiblePkgs = patientId && serviceId ? db.activePackagesForPatient(patientId).filter((p) => p.serviceIds.includes(serviceId)) : [];
  const packageId = packageChoice === 'auto' ? eligiblePkgs[0]?.id ?? null : packageChoice === 'none' ? null : packageChoice;
  const activePkg = eligiblePkgs.find((p) => p.id === packageId);
  const patientPlans = patientId ? db.plansForPatient(patientId).filter((p) => p.status === 'active') : [];
  // «تلقائي» = الخطة اللي خدمتها نفس خدمة الموعد بس — كشف أو متابعة لمريض عنده خطة علاج طبيعي مايتحسبش زيارة منها وليه فاتورته
  const planId = planChoice === 'auto' ? (patientPlans.find((p) => p.serviceId === serviceId)?.id ?? null) : planChoice === 'none' ? null : planChoice;
  const pricedPlan = !packageId && planId ? ((db.plan(planId)?.price ?? 0) > 0) : false;
  // فاتورة مستقلة تُنشأ فقط لو الموعد مش مغطّى بباقة أو خطة علاجية مدفوعة — عندها فقط يصح تسجيل دفعة فورية
  const willHaveInvoice = !packageId && !pricedPlan;
  const netPrice = Math.max(0, shownPrice);

  const canNext = [
    !!patientId || (mode === 'call' && np.fullName.trim().length >= 2 && phoneOk),
    !!serviceId,
    !!therapistId,
    !!date && !!time,
    true,
  ][step];
  const blockedMsg = [mode === 'call' ? 'أدخل اسم المريض ورقم جواله' : 'ابحث عن المريض واختره', 'اختر الخدمة أولًا', 'يرجى اختيار الدكتور أولًا', 'اختر التاريخ والوقت أولًا', ''][step];

  // حجز من خانة فاضية في جدول المواعيد: الدكتور والتاريخ والوقت محددين → بنتخطى خطوتي «الدكتور» و«التاريخ والوقت»
  const visible = lockedPreset ? [0, 1] : [0, 1, 2, 3];
  const lastStep = visible[visible.length - 1];
  const next = () => setStep((s) => visible.find((x) => x > s) ?? s);
  const back = () => setStep((s) => [...visible].reverse().find((x) => x < s) ?? s);

  const confirm = async () => {
    if (!therapistId) { toast.error('يرجى اختيار الدكتور أولًا'); setStep(2); return; }
    setBusy(true);
    // حجز المكالمة: الموعد بيتسجل باسم المتصل وجواله، وبعدها بيتحوّل لملف مريض عادي في «المرضى» برقم ملف (promoteGuest)
    let pid = patientId; let guest: { fullName: string; phone: string; nationality?: 'saudi' | 'non_saudi' } | undefined;
    if (!pid) {
      if (!np.fullName.trim() || !phoneOk || !serviceId) { setBusy(false); return; }
      const dup = db.findByPhone(np.phone);
      if (dup) pid = dup.id; else guest = { fullName: np.fullName.trim(), phone: np.phone, nationality: np.nationality };
    }
    if (!serviceId) { setBusy(false); return; }
    const common = { patientId: pid || undefined, guest, type: 'session' as const, serviceId, therapistId, packageId, planId, notes, priceId: priceId || null };
    const r = await db.createAppointment({ ...common, date, time });
    if (!r.ok) {
      setBusy(false); toast.error(r.error);
      // الوقت اتحجز للتو (أو الكاش كان قديم): حدّث الأوقات وارجع لاختيار الوقت بدل ما يكمّل على وقت محجوز
      if (/حجزه للتو|تم حجزه/.test(r.error)) { setTime(''); await db.refresh('appointments'); setStep(visible.includes(3) ? 3 : step); }
      return;
    }
    // أكواد الخصم اتشالت من النظام (هجرة 920) — الفاتورة بسعر الخدمة
    const inv = payAmount.trim() ? db.invoices().find((i) => i.appointmentId === r.appointment.id) : undefined;
    const amount = Number(payAmount);
    if (amount > 0 && inv) {
      const pr = await db.recordPayment(inv.id, amount, payMethod);
      if (!pr.ok) toast.error(`تم حجز الموعد، لكن تعذّر تسجيل الدفعة: ${pr.error}`);
      else toast.success('تم تسجيل الدفعة على فاتورة الموعد.');
    }
    // حجز مكالمة: المتصل بيتضاف في «المرضى» على طول برقم ملف — والاستكمال لما ييجي
    if (guest) {
      try { const p = await db.promoteGuest(r.appointment.patientId); setCallFile(p?.fileNo ?? ''); }
      catch (e) { setCallFile(''); toast.error(`تم الحجز، بس إضافته في «المرضى» ما اتعملتش: ${(e as Error).message}`); }
    }
    if (!walkIn && confirmed) {
      try { await db.setAppointmentStatus(r.appointment.id, 'confirmed'); }
      catch (e) { toast.error(`تم الحجز، بس التأكيد ما اتعملش: ${(e as Error).message}`); }
    }
    // المريض موجود: تأكيد الحضور على طول (نفس «تأكيد» في تفاصيل الموعد)
    if (walkIn) {
      try { await db.setAppointmentStatus(r.appointment.id, 'arrived', undefined, therapistId); toast.success('تم تأكيد حضور المريض'); }
      catch (e) { toast.error(`تم حجز الموعد، بس تأكيد الحضور ما اتعملش: ${(e as Error).message} — أكّده من تفاصيل الموعد.`); }
    }
    setBusy(false);
    toast.success('تم حجز الموعد بنجاح');
    setResult({ id: r.appointment.id, patientId: r.appointment.patientId, no: r.appointment.no, date: r.appointment.date, time: r.appointment.time, therapist: db.therapist(therapistId)?.name ?? '' });
  };

  if (result) {
    return (
      <Modal title="تم حجز الموعد" onClose={onClose} footer={
        <>
          <Button variant="outline" onClick={onClose}>إغلاق</Button>
          <Button icon="calendar" variant={walkIn && (callFile !== null || db.patient(result.patientId)?.isGuest) ? 'outline' : undefined} onClick={() => { onClose(); navigate('/appointments'); }}>عرض تفاصيل الموعد</Button>
        </>
      }>
        {completeData && db.patient(result.patientId) && <EditPatientModal patient={db.patient(result.patientId)!} onClose={() => setCompleteData(false)} />}
        <div className="success" style={{ textAlign: 'center' }}>
          <div className="mark"><Icon name="check" size={30} /></div>
          <h1 style={{ fontSize: 20 }}>✅ تم حجز الموعد بنجاح</h1>
          <dl className="dl" style={{ marginTop: 18, textAlign: 'start' }}>
            <div><dt>رقم الموعد</dt><dd className="num">{result.no}</dd></div>
            <div><dt>اسم المريض</dt><dd>{patient?.fullName ?? np.fullName}</dd></div>
            {(() => { const fn = db.patient(result.patientId)?.fileNo || callFile; return fn ? <div><dt>رقم الملف</dt><dd className="num">{fn}{callFile !== null && <span className="badge badge--warn" style={{ marginInlineStart: 8 }}>اتضاف في «المرضى» — استكمل بياناته لما ييجي</span>}</dd></div> : null; })()}
            <div><dt>التاريخ</dt><dd>{fmtDate(result.date)}</dd></div>
            <div><dt>الوقت</dt><dd>{fmtTime(result.time)}</dd></div>
            <div><dt>المعالج</dt><dd>{result.therapist}</dd></div>
          </dl>
          {(() => {
            // فاتورة الموعد (أو فاتورة الخطة/الباقة اللي الموعد تبعها) — عرض/تحميل/طباعة/واتساب على طول بعد الحجز
            const a = db.appointment(result.id);
            const inv = db.invoices().find((i) => i.status !== 'cancelled' && (i.appointmentId === result.id || (!!a?.planId && i.planId === a.planId) || (!!a?.packageId && i.packageId === a.packageId)));
            return inv ? (
              <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', justifyContent: 'center', marginTop: 16 }}>
                <InvoiceFileButtons invoice={inv} size="sm" /><InvoiceWhatsappButton invoice={inv} size="sm" variant="outline" />
              </div>
            ) : null;
          })()}
        </div>
      </Modal>
    );
  }

  const footer = (
    <>
      {step > 0 && <Button variant="outline" onClick={back} disabled={busy}>رجوع</Button>}
      <span style={{ flex: 1 }} />
      {step < lastStep
        ? <Button onClick={() => (canNext ? next() : toast.error(blockedMsg))} aria-disabled={!canNext} style={canNext ? undefined : { opacity: 0.55 }}>التالي</Button>
        : <Button icon="check" onClick={() => (canNext ? void confirm() : toast.error(blockedMsg))} loading={busy} aria-disabled={!canNext} style={canNext ? undefined : { opacity: 0.55 }}>{walkIn ? 'حجز وتأكيد الحضور' : 'حجز الموعد'}</Button>}
    </>
  );

  return (
    <Modal title="حجز موعد جديد" onClose={onClose} footer={footer} wide>
      <div className="steps">
        {STEPS.map((label, i) => (lockedPreset && (i === 2 || i === 3)) ? null : (
          <div key={label} style={{ display: 'contents' }}>
            <div className={`step-dot ${i === step ? 'active' : ''} ${i < step ? 'done' : ''}`}>
              <span className="step-dot__n">{i < step ? <Icon name="check" size={13} /> : visible.indexOf(i) + 1}</span>
              <span className="hide-sm">{label}</span>
            </div>
            {i < STEPS.length - 1 && <span className="step-sep" />}
          </div>
        ))}
      </div>

      {/* Step 0: بحث عن مريض مسجّل، أو حجز عن طريق مكالمة (اسم + جوال) */}
      {step === 0 && (
        <div>
          {patientId && patient ? (
            <div className="choice selected" style={{ marginBottom: 12 }}>
              <span className="choice__ic"><Icon name="user" size={18} /></span>
              <span style={{ flex: 1 }}><strong>{patient.fullName}</strong><span> {patient.fileNo} · <span className="num">{patient.phone}</span></span></span>
              {!presetPatientId && <button type="button" className="link-more" style={{ border: 0, background: 'none', cursor: 'pointer' }} onClick={() => { setPatientId(''); setPatientQuery(''); setWalkIn(false); setNp((x) => ({ ...x, fullName: '', phone: '' })); }}>تغيير</button>}
            </div>
          ) : null}
          {patientId && patient ? null : (
            <>
              {/* اختيارين: «بحث عن مريض» (مريض موجود) أو «حجز عن طريق مكالمة» (اسم + جوال) */}
              {/* ٨/١١: «مريض جديد» اتشال من الحجز — بحث عن مريض بس */}
              {mode === 'search' ? (
                <>
                  <Input label="ابحث عن المريض" icon="search" placeholder="الاسم / رقم الجوال / رقم الملف" value={patientQuery} onChange={(e) => setPatientQuery(e.target.value)} />
                  {queryResults.length > 0 && (
                    <div className="choice-grid">
                      {queryResults.map((x) => (
                        <button key={x.id} type="button" className="choice" onClick={() => { setPatientId(x.id); setPatientQuery(x.fullName); }}>
                          <span className="choice__ic"><Icon name="user" size={18} /></span>
                          <span><strong>{x.fullName}</strong><span> {x.fileNo} · <span className="num">{x.phone}</span></span></span>
                        </button>
                      ))}
                    </div>
                  )}
                  {patientQuery.trim() && queryResults.length === 0 && (
                    <p className="muted" style={{ marginBottom: 12 }}>مفيش مريض موجود بالبحث ده.</p>
                  )}
                </>
              ) : (
                <>
                  <div className="alert alert-info" style={{ marginBottom: 14 }}>
                    <Icon name="phone" size={17} /><div style={{ flex: 1 }}><strong>مريض جديد</strong> — اكتب اسمه ورقمه بس.</div>
                  </div>
                  <div className="grid-form">
                    <Input label="اسم المريض" placeholder="اسم المريض" value={np.fullName} onChange={(e) => setNp({ ...np, fullName: e.target.value })} />
                    <PhoneInput id="bw-np-phone" label="رقم الجوال" value={np.phone} onChange={(v) => setNp((x) => ({ ...x, phone: v }))} />
                  </div>
                  {!existingByPhone && (
                    <div className="grid-form" style={{ marginTop: 10 }}>
                      <Select label="الجنسية" value={np.nationality} onChange={(e) => setNp({ ...np, nationality: e.target.value as 'saudi' | 'non_saudi' })}
                        options={[{ value: 'saudi', label: 'مصري' }, { value: 'non_saudi', label: 'أجنبي' }]} />
                    </div>
                  )}
                  {existingByPhone && (
                    <div className="alert alert-info" style={{ margin: '10px 0' }}>
                      <Icon name="user" size={17} />
                      <div style={{ flex: 1 }}>هذا الرقم مسجّل للمريض <strong>{existingByPhone.fullName}</strong> {existingByPhone.isGuest ? '' : `(${existingByPhone.fileNo})`} — سيُستخدم سجله بدون إنشاء ملف جديد.</div>
                      <Button variant="outline" type="button" onClick={() => { setPatientId(existingByPhone.id); }}>استخدام السجل</Button>
                    </div>
                  )}
                  {!existingByPhone && phoneOk && np.fullName.trim() && (
                    <p className="muted-sm" style={{ marginTop: 8 }}>بيتضاف في «المرضى» برقم ملف باسمه ورقمه.</p>
                  )}
                </>
              )}
            </>
          )}
          {((patientId && patient) || (!patientId && mode === 'call' && np.fullName.trim().length >= 2 && phoneOk)) && (
            <div className="choice-grid" style={{ margin: '12px 0' }} role="radiogroup" aria-label="حالة الحجز">
              {/* ٩/١١: «حجز موعد / المريض موجود» بقوا «مؤكد / غير مؤكد» */}
              <button type="button" role="radio" aria-checked={confirmed} className={`choice ${confirmed ? 'selected' : ''}`} onClick={() => { setWalkIn(false); setConfirmed(true); next(); }}>
                <span className="choice__ic"><Icon name="checkCircle" size={18} /></span>
                <span><strong>مؤكد</strong><span> المريض أكّد إنه جاي</span></span>
              </button>
              <button type="button" role="radio" aria-checked={!confirmed} className={`choice ${!confirmed ? 'selected' : ''}`} onClick={() => { setWalkIn(false); setConfirmed(false); next(); }}>
                <span className="choice__ic"><Icon name="clock" size={18} /></span>
                <span><strong>غير مؤكد</strong><span> لسه محتاج تأكيد</span></span>
              </button>
            </div>
          )}
        </div>
      )}

      {/* Step 1: service */}
      {step === 1 && presetServiceId && service && (
        <div className="choice selected" style={{ pointerEvents: 'none' }}>
          <span className="choice__ic"><Icon name="spark" size={18} /></span>
          <span style={{ flex: 1, minWidth: 0 }}><strong>{service.name}</strong><span>محددة تلقائيًا من صفحة الخدمات</span></span>
          <span className="choice__price num">{money(service.price)}</span>
        </div>
      )}
      {step === 1 && !presetServiceId && (
        <div className="choice-grid">
          {services.map((s) => (
            <button key={s.id} type="button" className={`choice choice--big ${serviceId === s.id ? 'selected' : ''}`} aria-pressed={serviceId === s.id}
              onClick={() => { setServiceId(s.id); if (!(presetTime && time === presetTime)) setTime(''); }}>
              <span className="choice__ic"><Icon name={s.name.trim() === 'كشف' ? 'stethoscope' : 'calendar'} size={22} /></span>
              <span style={{ flex: 1, minWidth: 0 }}><strong>{s.name}</strong></span>
              <span className="choice__price num">{money(s.price)}</span>
              {serviceId === s.id && <Icon name="checkCircle" size={22} />}
            </button>
          ))}
        </div>
      )}

      {/* Step 2: اختيار الدكتور — إجباري، من غير «أي دكتور» ولا اختيار افتراضي */}
      {step === 2 && (
        <div>
          <div className="alert alert-info" style={{ marginBottom: 16 }}>
            <Icon name="pin" size={17} /><div>الفرع: <strong>{center.name} — {center.city}، {center.district}</strong></div>
          </div>
          <div className="field">
            <label>اختر الدكتور <span style={{ color: 'var(--danger)' }}>*</span></label>
            {qualifiedTherapists.length === 0 ? <p className="muted">ما فيه دكتور متاح لهذه الخدمة حاليًا.</p> : (
              <div className="choice-grid" role="radiogroup" aria-label="اختر الدكتور" aria-required="true">
                {qualifiedTherapists.map((t) => (
                  <button key={t.id} type="button" role="radio" aria-checked={therapistId === t.id} className={`choice ${therapistId === t.id ? 'selected' : ''}`}
                    onClick={() => { if (therapistId !== t.id) { setTherapistId(t.id); setTime(''); setPriceId(''); } }}>
                    <span className="choice__ic"><Icon name="user" size={18} /></span>
                    <span style={{ flex: 1, minWidth: 0 }}><strong>{t.name}</strong>{t.title && <span>{t.title}</span>}</span>
                    {therapistId === t.id && <Icon name="check" size={18} />}
                  </button>
                ))}
              </div>
            )}
            {!therapistId && <p className="muted" style={{ marginTop: 8 }}>يرجى اختيار الدكتور لعرض المواعيد المتاحة</p>}
          </div>
        </div>
      )}

      {/* Step 3: التاريخ + مواعيد الدكتور المختار فقط */}
      {step === 3 && (
        <div>
          {!therapistId ? <p className="muted">يرجى اختيار الدكتور لعرض المواعيد المتاحة</p> : (
            <>
              {quickDays.length > 0 && (
                <div className="field">
                  <label>أقرب الأيام المتاحة لـ {db.therapist(therapistId)?.name}</label>
                  <div className="day-chips">
                    {quickDays.map((q) => (
                      <button key={q.date} type="button" className={`day-chip ${date === q.date ? 'selected' : ''}`}
                        onClick={() => { setDate(q.date); setTime(''); }}>
                        <strong>{fmtDayName(q.date)}</strong>
                        <span>{fmtDate(q.date)}</span>
                      </button>
                    ))}
                  </div>
                </div>
              )}
              <Input label={quickDays.length ? 'أو اختر يوم ثاني' : 'التاريخ'} type="date" value={date} min={todayYmd()}
                onChange={(e) => { setDate(e.target.value); setTime(''); }} />
              <div className="field" style={{ marginBottom: 0 }}>
                <label>المواعيد المتاحة لـ {db.therapist(therapistId)?.name}{docDay?.status === 'ok' && <span className="muted-sm"> · دوامه <span className="num">{fmtTime(docDay.doctorFrom!)} – {fmtTime(docDay.doctorTo!)}</span></span>}</label>
                {!date ? <p className="muted">اختر التاريخ أولًا.</p> : allSlots.length ? (
                  <div className="slots">{allSlots.map((s) => takenSet.has(s) ? (
                    <button key={s} type="button" className="slot slot--taken" disabled title="محجوز">✕ {fmtTime(s)}</button>
                  ) : ptBusySet.has(s) ? (
                    <button key={s} type="button" className="slot slot--taken" disabled title="عند المريض موعد تاني في هالوقت">✕ {fmtTime(s)}</button>
                  ) : (
                    <button key={s} type="button" className={`slot ${time === s ? 'selected' : ''}`} onClick={() => setTime(s)}>{fmtTime(s)}</button>
                  ))}</div>
                ) : <p className="muted">{docDay && docDay.status !== 'ok' ? `${DOCTOR_DAY_LABEL[docDay.status]} — جرّب يوم ثاني أو دكتور ثاني.` : 'ما فيه مواعيد لهذا الدكتور في هاليوم ضمن دوامه — جرّب يوم ثاني.'}</p>}
                {date && therapistId && (() => {
                  const booked = db.appointmentsForDate(date).filter((x) => x.therapistId === therapistId && x.status !== 'cancelled').sort((x, y) => (x.time < y.time ? -1 : 1));
                  return (
                    <div className="item-card" style={{ marginTop: 12 }}>
                      <div className="section-title" style={{ marginTop: 0 }}>جدول اليوم — المواعيد المحجوزة</div>
                      {booked.length === 0 ? <p className="muted-sm" style={{ margin: 0 }}>ما فيه مواعيد محجوزة لهذا الدكتور في هاليوم — كل الأوقات متاحة.</p> : booked.map((x) => (
                        <div key={x.id} className="kv-row"><span className="num">{fmtTime(x.time)} – {fmtTime(endTimeOf(x.time, x.durationMin))}</span><span>{db.service(x.serviceId)?.name ?? '—'} · {APPT_STATUS[x.status]?.label ?? x.status}</span></div>
                      ))}
                    </div>
                  );
                })()}
                {ptBusySet.size > 0 && <p className="muted-sm" style={{ marginTop: 8 }}>الأوقات المعطّلة بعلامة ✕ تشمل أوقات عند {patient?.fullName ?? 'المريض'} فيها موعد تاني في نفس اليوم.</p>}
                {date && allSlots.length > 0 && slots.length === 0 && <p className="muted" style={{ marginTop: 8 }}>{takenSet.size === 0 ? 'انتهت مواعيد اليوم بتوقيت القاهرة — جرّب يوم ثاني.' : 'كل مواعيد هذا الدكتور محجوزة في هاليوم — جرّب يوم ثاني.'}</p>}
              </div>
            </>
          )}
        </div>
      )}

      {/* Step 4: review */}
      {step === lastStep && (
        <>
        {extraPrices.length > 0 && (
          <div style={{ marginTop: 14 }}><Select id="bk-price" label="السعر" value={priceId} onChange={(e) => setPriceId(e.target.value)}
            options={[{ value: '', label: `السعر العادي — ${money(service?.price ?? 0)}` }, ...extraPrices.map((p) => ({ value: p.id, label: `${p.label} — ${money(p.price)}` }))]} /></div>
        )}
        {willHaveInvoice && (
          <div className="grid-form grid-form--3" style={{ marginTop: 14 }}>
            <Input id="bk-pay" label="دفعة الحين (اختياري)" type="number" min={0} max={netPrice} value={payAmount} onChange={(e) => setPayAmount(e.target.value)}
              hint={netPrice > 0 ? `إجمالي الفاتورة بعد الخصم: ${money(netPrice)}` : undefined} />
            <Select id="bk-pay-method" label="طريقة الدفع" value={payMethod} onChange={(e) => setPayMethod(e.target.value as PaymentMethod)}
              options={PAYMENT_METHOD_OPTIONS} />
            {netPrice > 0 && <Button type="button" variant="ghost" size="sm" style={{ alignSelf: 'end' }} onClick={() => setPayAmount(String(netPrice))}>دفع المبلغ كامل ({money(netPrice)})</Button>}
          </div>
        )}
        <div className="field" style={{ marginTop: 14 }}><label htmlFor="bk-notes">ملاحظات</label><textarea id="bk-notes" className="input" rows={2} value={notes} onChange={(e) => setNotes(e.target.value)} /></div>
        </>
      )}
    </Modal>
  );
}
