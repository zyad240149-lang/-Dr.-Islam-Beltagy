import { IncompleteAlert } from '../components/PatientCompleteness';
import { PendingSyncTag } from '../components/OfflineStatus';
import { patientGaps } from '../utils/patientGaps';
import { sendWhatsApp } from '../data/whatsappSend';
import { useEffect, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { db } from '../data/db';
import { checkPortalAccount, type PortalAccount } from '../data/cloudSync';
import { useDbVersion } from '../hooks/useDb';
import { Button, EmptyState, StatusBadge } from '../components/ui';
import { ConfirmDialog, IconAction, RowActions, useCan } from '../components/common';
import { AssessmentModal, EditPatientModal, PlanModal, PlanScheduleList, SellPackageModal } from '../components/PatientForms';
import { DiagnosisCode } from '../components/DiagnosisPicker';
import { BodyRecordsTab, PatientFilesTab } from '../components/PatientExtras';
import { DetailsButton, useDetails } from '../components/DetailsHost';
import { ActorBadges } from '../components/AppointmentActor';
import { useInstallmentRequests } from '../components/PackagePayment';
import { InstallmentStateBadge, InstallmentSummary } from '../components/InstallmentSummary';
import { requestFor } from '../data/installments';
import SessionModal from '../components/SessionModal';
import BookingWizard from '../components/BookingWizard';
import { ExamsTab } from '../components/ExamsTab';
import PhysioTab from '../components/PhysioTab';
import { OrthoPatientTab } from '../ortho/PatientTabs';
import { DiagnosisTab } from '../ortho/DiagnosisTab';
import { Icon } from '../utils/icons';
import {
  APPT_STATUS, APPT_TYPE_LABEL, INVOICE_STATUS, PACKAGE_STATUS, PAYMENT_METHOD_LABEL, PLAN_STATUS, REFERRAL_SOURCE_LABEL,
  age, fmtDate, fmtDateTime, fmtTime, initials, money, tsToYmd, waLink,
} from '../utils/format';
import { useToast } from '../hooks/useToast';
import type { InitialAssessment, Package, TreatmentPlan, TreatmentSession } from '../types';

const TABS = ['بيانات المريض', 'المواعيد', 'الجلسات', 'التقييم', 'خطة العلاج', 'الباقات', 'الفواتير والمدفوعات', 'سجل المريض', 'الملفات والمرفقات', 'سجل الجسم', 'العلاج الطبيعي (Physiotherapy)', 'سجل الكشوفات', 'التشخيص', 'الأشعة والتحاليل', 'الكسور والجبس', 'العمليات الجراحية', 'متابعة التمريض'];
// ترتيب العرض (الأرقام فوق ثابتة عشان tab === n). عيادة عظام: «التشخيص» تبويب واحد بالشيت زي ما اتكتب (بدل «الكشوفات والتشخيص»
// و«سجل الكشوفات»)، والجلسات/التقييم/خطة العلاج/الباقات/العلاج الطبيعي مش معروضين — الكود موجود لو احتاجوهم تاني
const TAB_ORDER = [0, 12, 1, 6, 7];
// كل البيانات الطبية جوّه «التشخيص» (صف تحت التبويب) — التشخيصات أولًا. المواعيد والفواتير وسجل المريض تبويبات لوحدها فوق
const DX_SUB: [number, string][] = [[12, 'التشخيصات'], [13, 'الأشعة والتحاليل'], [14, 'الكسور والجبس'], [15, 'العمليات الجراحية'], [16, 'متابعة التمريض'], [8, 'الملفات والمرفقات'], [9, 'سجل الجسم']];
const IN_DX = new Set(DX_SUB.map(([i]) => i));
const PHYSIO_TAB = 10;

type Confirm = { title: string; message: string; label?: string; run: () => Promise<void> } | null;

export default function PatientProfile() {
  const { id = '' } = useParams();
  const navigate = useNavigate();
  const toast = useToast();
  const can = useCan();
  useDbVersion();
  const [tab, setTab] = useState(0);
  const [booking, setBooking] = useState(false);
  const [editing, setEditing] = useState(false);
  const [assessment, setAssessment] = useState<InitialAssessment | 'new' | null>(null);
  const [plan, setPlan] = useState<TreatmentPlan | 'new' | null>(null);
  const [selling, setSelling] = useState(false);
  const [session, setSession] = useState<TreatmentSession | null>(null);
  const [confirm, setConfirm] = useState<Confirm>(null);
  const [account, setAccount] = useState<PortalAccount | null | undefined | 'loading'>('loading');

  const patient = db.patient(id);
  const { openPlan, openVisit } = useDetails();
  const instReqs = useInstallmentRequests();

  useEffect(() => {
    if (!patient) return;
    let alive = true;
    setAccount('loading');
    checkPortalAccount(patient).then((r) => { if (alive) setAccount(r); });
    return () => { alive = false; };
  }, [patient?.id, patient?.phone]);
  if (!patient) {
    return <div className="page"><EmptyState icon="user" title="المريض غير موجود" text="تحقق من الرابط أو ارجع لقائمة المرضى." action={<Button onClick={() => navigate('/patients')}>العودة للمرضى</Button>} /></div>;
  }

  const appts = db.appointmentsForPatient(id);
  const sessions = db.sessionsForPatient(id);
  const assessments = db.assessmentsForPatient(id);
  const plans = db.plansForPatient(id);
  const packages = db.packagesForPatient(id);
  const invoices = db.invoicesForPatient(id);
  const payments = db.paymentsForPatient(id);
  const activity = db.activityForPatient(id);
  const activePlan = db.activePlan(id);
  const activeStats = activePlan ? db.planStats(activePlan.id) : null;
  const canEditPatient = can('patients', 'edit');
  const paidTotal = payments.reduce((s, p) => s + p.amount, 0);
  const dueTotal = invoices.filter((i) => i.status !== 'cancelled').reduce((s, i) => s + i.remaining, 0);

  const ask = (title: string, message: string, run: () => Promise<void>, label?: string) => setConfirm({ title, message, run, label });

  const sendPlanToPatient = async (p: TreatmentPlan) => {
    const st = db.planStats(p.id);
    if (patient.phone && can('whatsapp', 'create')) {
      const msg = `مرحبًا ${patient.fullName}، خطتك العلاجية (${p.diagnosis}) — ${st.total} جلسة، تبدأ ${fmtDate(p.startDate)}. تقدر تتابع تقدمك من حسابك في البوابة.`;
      sendWhatsApp({ phone: patient.phone, text: msg, patientId: patient.id, type: 'plan' });
    }
    const r = await db.sendCampaign({ title: 'خطة علاجية', body: `تفاصيل خطتك العلاجية: ${p.diagnosis} — ${st.total} جلسة`, audience: 'patient', patientId: patient.id });
    if (!r.ok) { toast.error(r.error); return; }
    if (r.recipients === 0) toast.error('تم فتح واتساب، لكن المريض ما عنده حساب في بوابة العملاء لإشعاره هناك.');
    else toast.success('تم إرسال الخطة للمريض — واتساب وإشعار على حسابه.');
  };

  return (
    <div className="page">
      <div className="crumbs"><button onClick={() => navigate('/patients')} style={{ border: 0, background: 'none', cursor: 'pointer', color: 'var(--muted)' }}>المرضى</button><Icon name="chevron" size={13} /><span>{patient.fullName}</span></div>

      <IncompleteAlert patientId={patient.id} showComplete style={{ marginBottom: 14 }} />
      <section className="card" style={{ marginBottom: 18 }}>
        <div className="card__body" style={{ display: 'flex', gap: 16, alignItems: 'center', flexWrap: 'wrap' }}>
          <span className="avatar avatar--lg">{initials(patient.fullName)}</span>
          <div style={{ flex: 1, minWidth: 220 }}>
            <h1 style={{ fontSize: 20 }}>{patient.fullName}{patient.pendingSync && <PendingSyncTag />}</h1>
            <p className="muted">ملف رقم <span className="num">{patient.fileNo}</span>
              <button type="button" className="btn btn--outline btn--sm" title="نسخ رقم الملف" aria-label="نسخ رقم الملف" style={{ marginInline: 8, display: 'inline-flex', alignItems: 'center', gap: 6, fontWeight: 600 }}
                onClick={() => { navigator.clipboard.writeText(patient.fileNo).then(() => toast.success('تم نسخ رقم الملف'), () => toast.error('تعذّر النسخ')); }}>
                <Icon name="copy" size={15} /> نسخ رقم الملف
              </button> · {patient.genderUnknown ? 'الجنس غير محدد' : patient.gender === 'male' ? 'رجل' : 'امرأة'}{age(patient.birthDate) !== null ? ` · ${age(patient.birthDate)} سنة` : ''} · جوال <span className="num" dir="ltr">{patient.phone}</span>{patient.phone && <button type="button" className="btn btn--outline btn--sm" style={{ marginInline: 8, display: 'inline-flex', alignItems: 'center', gap: 6, fontWeight: 600 }} onClick={() => navigator.clipboard.writeText(patient.phone).then(() => toast.success('تم نسخ رقم الجوال'), () => toast.error('تعذّر النسخ'))}><Icon name="copy" size={15} /> نسخ الجوال</button>}</p>
            {activePlan && activeStats && <p className="muted" style={{ fontSize: 13 }}>الخطة الحالية: {activePlan.diagnosis} — مكتملة {activeStats.completed} من {activeStats.total}، متبقية {activeStats.remaining}</p>}
            <div style={{ marginTop: 6 }}>
              {account === 'loading' ? null
                : account === undefined ? <span className="badge badge--muted" title="تعذّر التحقق — تأكد من الاتصال بالإنترنت أو سجّل الدخول بحساب مربوط بالسحابة"><Icon name="alert" size={13} /> تعذّر التحقق من الحساب</span>
                : account === null ? <span className="badge badge--muted"><Icon name="close" size={13} /> ما فيه حساب على بوابة العميل</span>
                : <span className="badge badge--ok" title={`عضو منذ ${fmtDate(account.memberSince.slice(0, 10))}`}><Icon name="checkCircle" size={13} /> عنده حساب على بوابة العميل{account.patientId === patient.id ? ' — مربوط بهذا الملف' : ''}</span>}
            </div>
          </div>
          {can('booking', 'create') || can('appointments', 'create') ? <Button icon="calendarPlus" onClick={() => setBooking(true)}>حجز موعد</Button> : null}
          {canEditPatient && <Button variant="outline" icon="edit" onClick={() => setEditing(true)}>تعديل البيانات</Button>}
          {can('patients', 'delete') && <Button variant="soft-danger" icon="trash" onClick={() => ask('حذف ملف المريض', `سيتم حذف ملف ${patient.fullName} نهائيًا. ما يمكن حذف مريض عنده زيارات أو مدفوعات — عطّل الملف بدل ذلك.`, async () => {
            const r = await db.deletePatient(id); if (r.ok) { toast.success('تم حذف ملف المريض.'); navigate('/patients'); } else toast.error(r.error);
          })}>حذف</Button>}
        </div>
      </section>

      <div className="card">
        <div className="tabs" style={{ overflowX: 'auto' }}>{TAB_ORDER.map((i) => <button key={TABS[i]} className={`tab ${(i === 12 ? IN_DX.has(tab) : tab === i) ? 'active' : ''}`} onClick={() => setTab(i)}>{TABS[i]}</button>)}</div>
        {IN_DX.has(tab) && (
          <div className="cx-chips dx-subnav" role="tablist" aria-label="أقسام التشخيص">
            {DX_SUB.map(([i, label]) => <button key={i} type="button" role="tab" aria-selected={tab === i} className={`cx-chip ${tab === i ? 'is-on' : ''}`} onClick={() => setTab(i)}>{label}</button>)}
          </div>
        )}
        <div className="card__body">
          {tab === 0 && (
            <dl className="dl">
              <div><dt>الاسم الكامل</dt><dd>{patient.fullName}</dd></div>
              <div><dt>رقم الجوال</dt><dd className="num">{patient.phone}</dd></div>
              <div><dt>الجنسية</dt><dd>{patient.nationality === 'non_saudi' ? 'أجنبي' : 'مصري'}</dd></div>
              {patient.nationalId && <div><dt>{patient.nationality === 'non_saudi' ? 'رقم جواز السفر' : 'الرقم القومي'}</dt><dd className="num">{patient.nationalId}</dd></div>}
              <div><dt>تاريخ الميلاد</dt><dd>{patient.birthDate ? fmtDate(patient.birthDate) : '—'}</dd></div>
              <div><dt>الجنس</dt><dd>{patient.genderUnknown ? 'الجنس غير محدد' : patient.gender === 'male' ? 'رجل' : 'امرأة'}</dd></div>
              <div><dt>كيف عرف عن المركز</dt><dd>{REFERRAL_SOURCE_LABEL[patient.referralSource] ?? '—'}</dd></div>
              <div><dt>طريقة التسجيل</dt><dd>{patient.signupMethod === 'google' ? <span className="badge badge--info">مسجّل بحساب Google</span> : patient.signupMethod === 'phone' ? 'رقم الجوال وكلمة المرور' : 'أُضيف من المركز'}</dd></div>
              <div><dt>البريد الإلكتروني</dt><dd>{patient.email || '—'}</dd></div>
              <div><dt>الطبيب المسؤول</dt><dd>{db.therapist(patient.doctorId ?? '')?.name ?? '—'}</dd></div>
              <div><dt>المدينة / الحي / الشارع</dt><dd>{[patient.city, patient.district, patient.street].filter(Boolean).join(' – ') || '—'}</dd></div>
              <div><dt>العنوان</dt><dd>{patient.address || '—'}</dd></div>
              <div><dt>جهة اتصال الطوارئ</dt><dd>{patient.emergencyContactName || '—'}</dd></div>
              <div><dt>جوال الطوارئ</dt><dd className="num">{patient.emergencyContactPhone || '—'}</dd></div>
              <div><dt>الشكوى الرئيسية</dt><dd>{patient.mainComplaint || '—'}</dd></div>
              <div><dt>التشخيص</dt><dd>{patient.diagnosis || '—'} <DiagnosisCode dref={patient.diagnosisRef} /></dd></div>
              <div><dt>تاريخ التسجيل</dt><dd>{fmtDate(tsToYmd(patient.registeredAt))}</dd></div>
              <div style={{ gridColumn: '1/-1' }}><dt>التاريخ المرضي</dt><dd>{patient.medicalHistory || '—'}</dd></div>
              <div style={{ gridColumn: '1/-1' }}><dt>ملاحظات</dt><dd>{patient.notes || '—'}</dd></div>
              <div><dt>إجمالي المدفوع</dt><dd className="num">{money(paidTotal)}</dd></div>
              <div><dt>المستحق عليه</dt><dd className="num">{money(dueTotal)}</dd></div>
            </dl>
          )}

          {tab === 8 && <PatientFilesTab patientId={id} />}
          {tab === 9 && <BodyRecordsTab patientId={id} />}
          {tab === 11 && <ExamsTab patientId={id} />}
          {tab === 12 && <DiagnosisTab patientId={id} />}
          {tab === 13 && <OrthoPatientTab kind="imaging" patientId={id} />}
          {tab === 14 && <OrthoPatientTab kind="fractures" patientId={id} />}
          {tab === 15 && <OrthoPatientTab kind="surgeries" patientId={id} />}
          {tab === 16 && <OrthoPatientTab kind="nursing" patientId={id} />}
          {tab === PHYSIO_TAB && can('physio', 'view') && <PhysioTab patientId={id} />}

          {tab === 1 && (
            appts.length === 0 ? <EmptyState icon="calendar" title="ما فيه مواعيد" text="لم يُحجز أي موعد لهذا المريض بعد." /> : (
              <div className="table-wrap"><table className="table">
                <thead><tr><th>رقم الموعد</th><th>التاريخ</th><th>الوقت</th><th>الخدمة</th><th>المعالج</th><th>الحالة</th><th>حجزه / ألغاه</th><th className="actions"></th></tr></thead>
                <tbody>{appts.map((a) => { const st = APPT_STATUS[a.status]; return (
                  <tr key={a.id}><td className="num">{a.no}</td><td>{fmtDate(a.date)}</td><td className="num">{fmtTime(a.time)}</td><td>{db.service(a.serviceId)?.name} <span className="muted" style={{ fontSize: 12 }}>({APPT_TYPE_LABEL[a.type]})</span></td><td>{db.therapist(a.therapistId)?.name}</td><td><StatusBadge label={st.label} tone={st.tone} /></td><td><ActorBadges a={a} /></td><td className="actions"><DetailsButton onClick={() => openVisit(a.id)} /></td></tr>
                );})}</tbody>
              </table></div>
            )
          )}

          {tab === 2 && (
            sessions.length === 0 ? <EmptyState icon="clipboard" title="ما فيه جلسات مسجّلة" /> : (
              sessions.map((s) => {
                const idx = db.planSessionIndex(s.id);
                return (
                  <div className="item-card" key={s.id}>
                    <div className="row-between" style={{ marginBottom: 8, gap: 8, flexWrap: 'wrap' }}>
                      <strong>الجلسة رقم {s.sessionNo}{idx ? ` — الجلسة ${idx.index} من ${idx.total} في الخطة` : ''} — {fmtDate(s.date)}</strong>
                      <div style={{ display: 'flex', gap: 6, alignItems: 'center' }}>
                        <StatusBadge label={s.status === 'completed' ? 'مكتملة' : 'قيد التنفيذ'} tone={s.status === 'completed' ? 'ok' : 'info'} />
                        
                        {can('sessions', 'edit') && <IconAction icon="edit" label="تعديل الجلسة" onClick={() => setSession(s)} />}
                        {can('sessions', 'delete') && <IconAction icon="trash" label="حذف الجلسة" danger onClick={() => ask('حذف الجلسة', `سيتم حذف الجلسة رقم ${s.sessionNo}. إن كانت مكتملة يعود الموعد إلى «حضر» وتُعاد الجلسة إلى رصيد الباقة.`, async () => { await db.deleteSession(s.id); toast.success('تم حذف الجلسة.'); })} />}
                      </div>
                    </div>
                    <div className="kv-row"><span>المعالج</span><span>{db.therapist(s.therapistId)?.name}</span></div>
                    {s.subject ? <div className="kv-row"><span>الموضوع</span><span>{s.subject}</span></div> : null}
                    <div className="kv-row"><span>مقياس الألم</span><span className="num">{s.painScale ?? s.painLevel ?? '—'} / 10</span></div>
                    <div className="kv-row"><span>العلاج المستخدم</span><span>{s.treatmentUsed || '—'}</span></div>
                    <div className="kv-row"><span>استجابة المريض</span><span>{s.patientResponse || '—'}</span></div>
                    <div className="kv-row"><span>الخطة القادمة</span><span>{s.nextPlan || '—'}</span></div>
                  </div>
                );
              })
            )
          )}

          {tab === 3 && (
            <>
              <div className="row-between" style={{ marginBottom: 14 }}>
                <span className="muted" style={{ fontSize: 13 }}>{assessments.length} تقييم مسجَّل</span>
                {canEditPatient && <Button size="sm" icon="stethoscope" onClick={() => setAssessment('new')}>إضافة تقييم أولي</Button>}
              </div>
              {assessments.length === 0 ? <EmptyState icon="stethoscope" title="ما فيه تقييم أولي" /> : assessments.map((a) => (
                <div key={a.id} className="item-card">
                  <div className="row-between" style={{ marginBottom: 8 }}>
                    <strong>{a.medicalDiagnosis} — {fmtDate(tsToYmd(a.date))}</strong>
                    {canEditPatient && <RowActions>
                      <IconAction icon="edit" label="تعديل التقييم" onClick={() => setAssessment(a)} />
                      <IconAction icon="trash" label="حذف التقييم" danger onClick={() => ask('حذف التقييم', 'سيتم حذف هذا التقييم الأولي نهائيًا.', async () => { await db.deleteAssessment(a.id); toast.success('تم حذف التقييم.'); })} />
                    </RowActions>}
                  </div>
                  <div className="kv-row"><span>الشكوى الرئيسية</span><span>{a.mainComplaint}</span></div>
                  <div className="kv-row"><span>مستوى الألم</span><span className="num">{a.painLevel}/10</span></div>
                  <div className="kv-row"><span>مدى الحركة (ROM)</span><span>{a.rom || '—'}</span></div>
                  <div className="kv-row"><span>القوة العضلية</span><span>{a.muscleStrength || '—'}</span></div>
                  <div className="kv-row"><span>التوازن / المشي</span><span>{a.balance || '—'} / {a.gait || '—'}</span></div>
                  <div className="kv-row"><span>الأدوية / الحساسية</span><span>{a.medications || '—'} / {a.allergies || '—'}</span></div>
                  <div className="kv-row"><span>الأهداف</span><span>{a.goals || '—'}</span></div>
                  <div className="kv-row"><span>خطة العلاج المقترحة</span><span>{a.plan || '—'}</span></div>
                  <div className="kv-row"><span>عدد الجلسات المقترح</span><span className="num">{a.suggestedSessions}</span></div>
                </div>
              ))}
            </>
          )}

          {tab === 4 && (
            <>
              <div className="row-between" style={{ marginBottom: 14 }}>
                <span className="muted" style={{ fontSize: 13 }}>{plans.length} خطة مسجَّلة</span>
                {can('plans', 'create') && <Button size="sm" icon="target" onClick={() => setPlan('new')}>إنشاء خطة علاج جديدة</Button>}
              </div>
              {plans.length === 0 ? <EmptyState icon="target" title="ما فيه خطة علاج" /> : plans.map((p) => {
                const st = db.planStats(p.id);
                const ps = PLAN_STATUS[p.status];
                return (
                  <div key={p.id} className="item-card">
                    <div className="row-between" style={{ marginBottom: 10, gap: 8, flexWrap: 'wrap' }}>
                      <strong style={{ cursor: 'pointer' }} onClick={() => openPlan(p.id)}>{p.diagnosis} <DiagnosisCode dref={p.diagnosisRef} /></strong>
                      <div style={{ display: 'flex', gap: 6, alignItems: 'center' }}>
                        <StatusBadge label={ps.label} tone={ps.tone} />
                        {(() => { const pi = invoices.find((x) => x.planId === p.id && x.status !== 'cancelled'); return pi && instReqs.rows ? <InstallmentStateBadge invoice={pi} req={requestFor(instReqs.rows, pi.id)} /> : null; })()}
                        <DetailsButton onClick={() => openPlan(p.id)} />
                        {can('plans', 'view') && <IconAction icon="phone" label="إرسال الخطة للمريض" onClick={() => sendPlanToPatient(p)} />}
                        {can('plans', 'edit') && <IconAction icon="edit" label="تعديل الخطة" onClick={() => setPlan(p)} />}
                        {can('plans', 'delete') && <IconAction icon="trash" label="حذف الخطة" danger onClick={() => ask('حذف الخطة العلاجية', `سيتم حذف خطة «${p.diagnosis}» وفك ارتباط مواعيدها وجلساتها بها (دون حذفها).`, async () => { await db.deletePlan(p.id); toast.success('تم حذف الخطة.'); })} />}
                      </div>
                    </div>
                    <div className="kv-row"><span>الخدمة</span><span>{db.service(p.serviceId)?.name ?? p.serviceId ?? '—'}</span></div>
                    <div className="kv-row"><span>الهدف الرئيسي</span><span>{p.mainGoal}</span></div>
                    {p.patientAge != null && <div className="kv-row"><span>العمر</span><span className="num">{p.patientAge} سنة</span></div>}
                    {p.painOnset && <div className="kv-row"><span>بداية ظهور الألم</span><span style={{ whiteSpace: 'pre-wrap' }}>{/^\d{4}-\d{2}-\d{2}$/.test(p.painOnset) ? fmtDate(p.painOnset) : p.painOnset}</span></div>}
                    {p.chiefComplaint && <div className="kv-row"><span>شكوى المريض</span><span>{p.chiefComplaint}</span></div>}
                    <div className="kv-row"><span>نوع العلاج</span><span>{p.therapyType || '—'}</span></div>
                    <div className="kv-row"><span>المدة</span><span>{fmtDate(p.startDate)} ← {p.endDate ? fmtDate(p.endDate) : '—'} ({p.durationWeeks} أسابيع، {p.sessionsPerWeek}/أسبوع)</span></div>
                    <div className="kv-row"><span>إجمالي الجلسات</span><span className="num">{st.total}</span></div>
                    <div className="kv-row"><span>المكتملة</span><span className="num">{st.completed}</span></div>
                    <div className="kv-row"><span>المتبقية</span><span className="num">{st.remaining}</span></div>
                    <div className="kv-row"><span>مجدولة قادمة</span><span className="num">{st.scheduled}</span></div>
                    {p.notes && <div className="kv-row"><span>ملاحظات</span><span>{p.notes}</span></div>}
                    <div style={{ marginTop: 14 }}>
                      <div className="row-between" style={{ marginBottom: 6 }}><span className="muted" style={{ fontSize: 13 }}>نسبة الإنجاز</span><strong className="num">{st.pct}%</strong></div>
                      <div className="progress"><i style={{ width: `${st.pct}%` }} /></div>
                    </div>
                    <div className="plan-sessions" aria-label="جلسات الخطة">
                      {Array.from({ length: st.total }, (_, i) => {
                        const s = st.sessions[i];
                        const up = !s ? st.upcoming[i - st.sessions.length] : undefined;
                        const cls = s?.status === 'completed' ? 'plan-dot--done' : s || up ? 'plan-dot--sched' : '';
                        const title = s ? `الجلسة ${i + 1} من ${st.total} — ${fmtDate(s.date)} — ${s.status === 'completed' ? 'مكتملة' : 'قيد التنفيذ'}` : up ? `الجلسة ${i + 1} من ${st.total} — مجدولة ${fmtDate(up.date)} ${fmtTime(up.time)}` : `الجلسة ${i + 1} من ${st.total} — غير مجدولة`;
                        return <span key={i} className={`plan-dot ${cls}`} title={title}>{i + 1}</span>;
                      })}
                    </div>
                    <p className="muted" style={{ fontSize: 12, marginTop: 6 }}>أخضر = مكتملة · أزرق = مجدولة/قيد التنفيذ · منقّط = غير مجدولة بعد</p>
                    <details style={{ marginTop: 8 }}>
                      <summary style={{ cursor: 'pointer', fontWeight: 600, fontSize: 13.5 }}>مواعيد الجلسات</summary>
                      <PlanScheduleList startDate={p.startDate} sessionsPerWeek={p.sessionsPerWeek} total={st.total} dates={p.sessionDates} actual={(i) => {
                        const s = st.sessions[i];
                        if (s) return { date: s.date, label: s.status === 'completed' ? 'مكتملة' : 'قيد التنفيذ' };
                        const up = st.upcoming[i - st.sessions.length];
                        return up ? { date: up.date, time: up.time, label: 'محجوزة' } : undefined;
                      }} />
                    </details>
                  </div>
                );
              })}
            </>
          )}

          {tab === 5 && (
            <>
              <div className="row-between" style={{ marginBottom: 14 }}>
                <span className="muted" style={{ fontSize: 13 }}>{packages.length} باقة</span>
                {can('packages', 'create') && <Button size="sm" icon="box" onClick={() => setSelling(true)}>بيع باقة</Button>}
              </div>
              {packages.length === 0 ? <EmptyState icon="box" title="ما فيه باقات" /> : packages.map((p: Package) => {
                const ps = PACKAGE_STATUS[p.status];
                return (
                  <div key={p.id} className="item-card">
                    <div className="row-between" style={{ marginBottom: 8 }}>
                      <strong>{p.name}</strong>
                      <div style={{ display: 'flex', gap: 6, alignItems: 'center' }}>
                        <StatusBadge label={ps.label} tone={ps.tone} />
                        {p.status === 'active' && can('packages', 'edit') && <Button size="sm" variant="soft-danger" onClick={() => ask('إلغاء الباقة', `سيتم إلغاء ${p.name}. المواعيد القادمة المرتبطة بها ستُصدر لها فواتير مستقلة، وفاتورة الباقة غير المدفوعة ستُلغى.`, async () => { const r = await db.cancelPackage(p.id); if (r.ok) toast.success('تم إلغاء الباقة.'); else toast.error(r.error); }, 'تأكيد الإلغاء')}>إلغاء الباقة</Button>}
                      </div>
                    </div>
                    <div className="kv-row"><span>إجمالي الجلسات</span><span className="num">{p.totalSessions}</span></div>
                    <div className="kv-row"><span>المستخدم</span><span className="num">{p.usedSessions}</span></div>
                    <div className="kv-row"><span>المتبقي</span><span className="num">{p.totalSessions - p.usedSessions}</span></div>
                    <div className="kv-row"><span>السعر</span><span className="num">{money(p.price)}</span></div>
                    <div className="kv-row"><span>الصلاحية</span><span>{fmtDate(p.startDate)} ← {fmtDate(p.expiryDate)}</span></div>
                    <div className="progress" style={{ marginTop: 10 }}><i style={{ width: `${(p.usedSessions / p.totalSessions) * 100}%` }} /></div>
                  </div>
                );
              })}
            </>
          )}

          {tab === 6 && (
            <>
              <div className="section-title">الفواتير</div>
              {invoices.length === 0 ? <p className="muted" style={{ marginBottom: 20 }}>ما فيه فواتير.</p> : (
                <div className="table-wrap" style={{ marginBottom: 20 }}><table className="table">
                  <thead><tr><th>رقم الفاتورة</th><th>التاريخ</th><th>الخدمة</th><th>الإجمالي</th><th>المدفوع</th><th>المتبقي</th><th>الحالة</th><th>التقسيط</th></tr></thead>
                  <tbody>{invoices.map((i) => { const st = INVOICE_STATUS[i.status]; return (
                    <tr key={i.id} style={{ cursor: can('invoices') ? 'pointer' : undefined }} onClick={() => can('invoices') && navigate(`/invoices?q=${i.no}`)}><td className="num">{i.no}</td><td>{fmtDate(i.date)}</td><td>{i.serviceName}</td><td className="num">{money(i.total)}</td><td className="num">{money(i.paid)}</td><td className="num">{money(i.remaining)}</td><td><StatusBadge label={st.label} tone={st.tone} /></td><td>{instReqs.rows ? <InstallmentStateBadge invoice={i} req={requestFor(instReqs.rows, i.id)} /> : null}</td></tr>
                  );})}</tbody>
                </table></div>
              )}
              {instReqs.rows && invoices.some((i) => requestFor(instReqs.rows!, i.id)) && (
                <>
                  <div className="section-title">الدفعات المقسطة</div>
                  {invoices.map((i) => { const r = requestFor(instReqs.rows!, i.id); return r ? <InstallmentSummary key={i.id} invoice={i} req={r} /> : null; })}
                </>
              )}
              <div className="section-title">سجل المدفوعات</div>
              {payments.length === 0 ? <p className="muted">ما فيه مدفوعات مسجّلة.</p> : (
                payments.map((p) => <div key={p.id} className="kv-row"><span>{fmtDateTime(p.date)} — {PAYMENT_METHOD_LABEL[p.method]} — {db.invoice(p.invoiceId)?.no}{p.note ? ` — ${p.note}` : ''}</span><span className="num">{money(p.amount)}</span></div>)
              )}
            </>
          )}

          {tab === 7 && (
            activity.length === 0 ? <EmptyState icon="doc" title="ما فيه عمليات مسجّلة بعد" text="كل عملية جديدة على ملف المريض ستظهر هنا مع وقتها ومنفّذها." /> : (
              <div className="timeline-log">
                {activity.map((l) => (
                  <div className="timeline-log__row" key={l.id}>
                    <time className="num date">{fmtDateTime(l.at)}</time>
                    <div style={{ flex: 1 }}>{l.action}<div className="muted" style={{ fontSize: 12 }}>{l.employeeId ? db.employeeById(l.employeeId)?.name ?? '—' : 'النظام'}</div></div>
                  </div>
                ))}
              </div>
            )
          )}
        </div>
      </div>

      {booking && <BookingWizard presetPatientId={patient.id} onClose={() => setBooking(false)} />}
      {editing && <EditPatientModal patient={patient} onClose={() => setEditing(false)} />}
      {assessment && <AssessmentModal patientId={patient.id} assessment={assessment === 'new' ? undefined : assessment} onClose={() => setAssessment(null)} />}
      {plan && <PlanModal patientId={patient.id} plan={plan === 'new' ? undefined : plan} onClose={() => setPlan(null)} />}
      {selling && <SellPackageModal patientId={patient.id} onClose={() => setSelling(false)} />}
      {session && <SessionModal session={session} onClose={() => setSession(null)} />}
      {confirm && <ConfirmDialog title={confirm.title} message={confirm.message} confirmLabel={confirm.label} onConfirm={confirm.run} onClose={() => setConfirm(null)} />}
    </div>
  );
}
