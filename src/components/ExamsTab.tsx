// «سجل الكشوفات» في ملف المريض: كل زيارات الكشف (الخدمات اللي اسمها فيه «كشف») من الأحدث للأقدم،
// ومع كل كشف اللي اتسجّل فيه: الطبيب والحالة والفاتورة، وتقييم العلاج الطبيعي/التقييم الأولي بنفس اليوم، وملاحظات الجلسة.
import { useEffect, useState } from 'react';
import { db } from '../data/db';
import { physioApi, type PhysioEvaluation } from '../data/physioApi';
import { Button, EmptyState, StatusBadge } from './ui';
import { useCan } from './common';
import { useDetails } from './DetailsHost';
import { APPT_STATUS, INVOICE_STATUS, fmtDate, fmtTime, money, tsToYmd } from '../utils/format';
import { Icon } from '../utils/icons';

export const isExamService = (name?: string | null) => !!name && name.includes('كشف');

export function ExamsTab({ patientId }: { patientId: string }) {
  const can = useCan();
  const { openVisit, openPlan } = useDetails();
  const [evals, setEvals] = useState<PhysioEvaluation[]>([]);
  useEffect(() => {
    if (!can('physio', 'view')) return;
    let on = true;
    physioApi.forPatient(patientId).then((r) => { if (on && r.ok) setEvals(r.data.evaluations); });
    return () => { on = false; };
  }, [patientId]);

  const exams = db.appointmentsForPatient(patientId)
    .filter((a) => isExamService(db.service(a.serviceId)?.name))
    .sort((a, b) => (a.date + a.time < b.date + b.time ? 1 : -1));
  const done = exams.filter((a) => ['arrived', 'in_progress', 'completed'].includes(a.status));
  const upcoming = exams.filter((a) => ['new', 'confirmed', 'rescheduled'].includes(a.status)).sort((a, b) => (a.date + a.time > b.date + b.time ? 1 : -1))[0];
  const assessments = db.assessmentsForPatient(patientId);
  const sessions = db.sessionsForPatient(patientId);
  const invoices = db.invoicesForPatient(patientId);
  const plans = db.plansForPatient(patientId);
  const canMedical = can('sessions', 'view');

  return (
    <>
      <div className="row-between" style={{ marginBottom: 14, gap: 8, flexWrap: 'wrap' }}>
        <span className="muted" style={{ fontSize: 13 }}>
          <span className="num">{exams.length}</span> <span>كشف مسجّل</span> · <span className="num">{done.length}</span> <span>تم</span>
          {done[0] && <> · <span>آخر كشف</span> <span className="num date">{fmtDate(done[0].date)}</span></>}
          {upcoming && <> · <span>الكشف الجاي</span> <span className="num date">{fmtDate(upcoming.date)} {fmtTime(upcoming.time)}</span></>}
        </span>
      </div>

      {exams.length === 0 ? <EmptyState icon="stethoscope" title="ما فيه كشوفات" text="لم يُحجز أي كشف لهذا المريض بعد." /> : exams.map((a) => {
        const st = APPT_STATUS[a.status];
        const svc = db.service(a.serviceId);
        const th = db.therapist(a.therapistId);
        const inv = invoices.find((i) => i.appointmentId === a.id && i.status !== 'cancelled');
        const ev = evals.find((e) => e.evalDate === a.date);
        const ass = assessments.find((x) => tsToYmd(x.date) === a.date);
        const ses = sessions.find((s) => s.appointmentId === a.id);
        // الخطة اللي بدأت بعد الكشف ده (وقبل الكشف اللي بعده)
        const next = exams.filter((x) => x.date + x.time > a.date + a.time).sort((x, y) => (x.date + x.time > y.date + y.time ? 1 : -1))[0];
        const plan = plans.filter((p) => p.startDate >= a.date && (!next || p.startDate < next.date)).sort((x, y) => (x.startDate > y.startDate ? 1 : -1))[0];
        return (
          <div className="item-card" key={a.id}>
            <div className="row-between" style={{ marginBottom: 8, gap: 8, flexWrap: 'wrap' }}>
              <strong>{svc?.name ?? 'كشف'} — <span className="num date">{fmtDate(a.date)} · {fmtTime(a.time)}</span></strong>
              <div style={{ display: 'flex', gap: 6, alignItems: 'center', flexWrap: 'wrap' }}>
                <StatusBadge label={st.label} tone={st.tone} />
                {inv && <StatusBadge label={INVOICE_STATUS[inv.status].label} tone={INVOICE_STATUS[inv.status].tone} />}
                <Button size="sm" variant="outline" icon="eye" onClick={() => openVisit(a.id)}>تفاصيل الزيارة</Button>
              </div>
            </div>
            <div className="kv-row"><span>رقم الموعد</span><span className="num">{a.no}</span></div>
            <div className="kv-row"><span>الطبيب</span><span>{th?.name ?? '—'}</span></div>
            <div className="kv-row"><span>الفاتورة</span><span>{inv ? <><span className="num">{inv.no}</span> · <span className="num">{money(inv.total)}</span>{inv.remaining > 0 ? <> · <span>متبقي</span> <span className="num">{money(inv.remaining)}</span></> : null}</> : '—'}</span></div>
            {a.status === 'cancelled' && a.cancelReason && <div className="kv-row"><span>سبب الإلغاء</span><span>{a.cancelReason}</span></div>}
            {canMedical && (ev || ass || ses) && <>
              {(ev?.chiefComplaint || ass?.mainComplaint) && <div className="kv-row"><span>الشكوى</span><span>{ev?.chiefComplaint || ass?.mainComplaint}</span></div>}
              {(ev?.diagnosis || ass?.medicalDiagnosis) && <div className="kv-row"><span>التشخيص</span><span>{ev?.diagnosis || ass?.medicalDiagnosis}</span></div>}
              {(ev || ass) && <div className="kv-row"><span>مستوى الألم</span><span className="num">{ev ? ev.painVas : ass?.painLevel} / 10</span></div>}
              {ses?.subject && <div className="kv-row"><span>ملاحظات الجلسة</span><span>{ses.subject}</span></div>}
            </>}
            {plan && <div className="kv-row"><span>الخطة بعد الكشف</span><span>
              <button type="button" className="link-btn" style={{ border: 0, background: 'none', color: 'var(--brand-700)', cursor: 'pointer', padding: 0 }} onClick={() => openPlan(plan.id)}>
                {plan.diagnosis || 'خطة علاجية'} — <span className="num date">{fmtDate(plan.startDate)}</span>
              </button></span></div>}
            {canMedical && !ev && !ass && !ses && ['arrived', 'in_progress', 'completed'].includes(a.status) && (
              <p className="muted-sm" style={{ margin: '6px 0 0' }}><Icon name="alert" size={13} /> ما اتسجّلش تقييم لهذا الكشف — سجّله من تبويب «التقييم» أو «العلاج الطبيعي».</p>
            )}
          </div>
        );
      })}

    </>
  );
}
