// نوافذ التفاصيل المترابطة: المريض ← الزيارة ← الخطة العلاجية ← الخدمات ← الفاتورة ← الدفعات ← التقسيط.
// DetailsProvider في Layout، وأي صفحة تفتح أي تفصيلة بـ useDetails().openPlan(id) / openVisit(id).
// النافذة المفتوحة بتتبدّل (مش بتتراكب) عشان التنقل بين العناصر المرتبطة يبقى بسيط، وفيه زرار «رجوع».
import { SessionDiagnosesList } from './SessionDiagnosesList';
import { ActorBadges, ActorDetails } from './AppointmentActor';
import { createContext, useContext, useEffect, useRef, useState, type ReactNode } from 'react';
import { useNavigate } from 'react-router-dom';
import { db } from '../data/db';
import { useDbVersion } from '../hooks/useDb';
import { useInstallmentRequests } from './PackagePayment';
import { InstallmentStateBadge, InstallmentSummary } from './InstallmentSummary';
import { empName, requestFor } from '../data/installments';
import { Button, EmptyState, Modal, Skeleton, StatusBadge } from './ui';
import { useCan } from './common';
import { DiagnosisCode } from './DiagnosisPicker';
import { PhysioPlanDetails } from './PhysioTab';
import { PlanModal } from './PatientForms';
import PlanSessionBooking from './PlanSessionBooking';
import { Icon } from '../utils/icons';
import { useToast } from '../hooks/useToast';
import { APPT_STATUS, APPT_TYPE_LABEL, INVOICE_STATUS, PAYMENT_METHOD_LABEL, PLAN_STATUS, fmtDate, fmtDateTime, fmtTime, money } from '../utils/format';
import type { Invoice, PatientFile } from '../types';

type Target = { kind: 'plan'; id: string } | { kind: 'visit'; id: string };
const Ctx = createContext<{ openPlan: (id: string) => void; openVisit: (id: string) => void }>({ openPlan: () => {}, openVisit: () => {} });
export const useDetails = () => useContext(Ctx);

export function DetailsProvider({ children }: { children: ReactNode }) {
  const [stack, setStack] = useState<Target[]>([]);
  const push = (t: Target) => setStack((s) => [...s, t]);
  const top = stack[stack.length - 1];
  const back = stack.length > 1 ? () => setStack((s) => s.slice(0, -1)) : undefined;
  const close = () => setStack([]);
  return (
    <Ctx.Provider value={{ openPlan: (id) => push({ kind: 'plan', id }), openVisit: (id) => push({ kind: 'visit', id }) }}>
      {children}
      {top?.kind === 'plan' && <PlanDetailsModal key={'p' + top.id} planId={top.id} onClose={close} onBack={back} />}
      {top?.kind === 'visit' && <VisitDetailsModal key={'v' + top.id} apptId={top.id} onClose={close} onBack={back} />}
    </Ctx.Provider>
  );
}

// ---------- معاينة ملف (صورة/PDF داخل النظام) ----------
export function FilePreviewModal({ file, onClose }: { file: PatientFile; onClose: () => void }) {
  const [url, setUrl] = useState<string | null | undefined>(undefined);
  useEffect(() => { db.fileUrl(file.filePath).then(setUrl); }, [file.filePath]);
  const isImg = file.fileType.startsWith('image/');
  const isPdf = file.fileType === 'application/pdf';
  return (
    <Modal title={file.fileName} wide onClose={onClose} footer={<>{url && <Button variant="outline" icon="download" onClick={() => window.open(url, '_blank', 'noopener')}>فتح في نافذة جديدة</Button>}<Button onClick={onClose}>إغلاق</Button></>}>
      <p className="muted-sm" style={{ marginBottom: 10 }}>رفعه: {file.uploadedByName || '—'} — {fmtDateTime(file.createdAt)}{file.note ? ` — ${file.note}` : ''}</p>
      {url === undefined ? <Skeleton h={300} /> : url === null ? <EmptyState icon="alert" title="تعذّر فتح الملف" /> :
        isImg ? <img src={url} alt={file.fileName} style={{ maxWidth: '100%', maxHeight: '70vh', display: 'block', margin: '0 auto', borderRadius: 8 }} /> :
        isPdf ? <iframe src={url} title={file.fileName} style={{ width: '100%', height: '70vh', border: '1px solid var(--line)', borderRadius: 8 }} /> :
        <EmptyState icon="doc" title="ما فيه معاينة لهذا النوع" text="افتحه في نافذة جديدة لتحميله." />}
    </Modal>
  );
}

// ---------- ملفات/أشعة مرتبطة بخطة أو زيارة ----------
export function LinkedFiles({ patientId, planId, appointmentId, planIdForAppt }: { patientId: string; planId?: string; appointmentId?: string; planIdForAppt?: string | null }) {
  const can = useCan();
  const toast = useToast();
  const [files, setFiles] = useState<PatientFile[] | null>(null);
  const [preview, setPreview] = useState<PatientFile | null>(null);
  const [busy, setBusy] = useState(false);
  const input = useRef<HTMLInputElement>(null);
  const load = () => db.patientFiles(patientId).then((all) => setFiles(all.filter((f) =>
    planId ? f.planId === planId || (!!f.appointmentId && db.appointment(f.appointmentId)?.planId === planId) : f.appointmentId === appointmentId,
  ))).catch(() => setFiles([]));
  useEffect(() => { load(); }, [patientId, planId, appointmentId]);
  const upload = async (file?: File) => {
    if (!file) return;
    setBusy(true);
    const r = await db.uploadPatientFile(patientId, file, '', { planId: planId ?? planIdForAppt ?? null, appointmentId: appointmentId ?? null });
    setBusy(false);
    if (input.current) input.current.value = '';
    if (!r.ok) { toast.error(r.error); return; }
    toast.success('تم رفع الملف.'); load();
  };
  return (
    <div>
      <div className="row-between" style={{ marginBottom: 8 }}>
        <div className="section-title" style={{ margin: 0 }}>الأشعة والملفات</div>
        {can('patients', 'edit') && <>
          <input ref={input} type="file" hidden accept=".pdf,.png,.jpg,.jpeg,.webp" onChange={(e) => upload(e.target.files?.[0])} />
          <Button size="sm" variant="outline" icon="doc" loading={busy} onClick={() => input.current?.click()}>رفع أشعة / ملف</Button>
        </>}
      </div>
      {files === null ? <Skeleton h={50} /> : files.length === 0 ? <p className="muted" style={{ fontSize: 13 }}>ما فيه ملفات مرتبطة.</p> : (
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(150px, 1fr))', gap: 10 }}>
          {files.map((f) => <FileTile key={f.id} f={f} onOpen={() => setPreview(f)} />)}
        </div>
      )}
      {preview && <FilePreviewModal file={preview} onClose={() => setPreview(null)} />}
    </div>
  );
}
function FileTile({ f, onOpen }: { f: PatientFile; onOpen: () => void }) {
  const [thumb, setThumb] = useState<string | null>(null);
  useEffect(() => { if (f.fileType.startsWith('image/')) db.fileUrl(f.filePath).then(setThumb); }, [f.filePath]);
  return (
    <button type="button" className="item-card" onClick={onOpen} style={{ textAlign: 'start', cursor: 'pointer', margin: 0, padding: 8 }}>
      <div style={{ height: 90, borderRadius: 8, background: 'var(--bg-soft, #f2f4f8)', display: 'grid', placeItems: 'center', overflow: 'hidden', marginBottom: 6 }}>
        {thumb ? <img src={thumb} alt="" style={{ width: '100%', height: '100%', objectFit: 'cover' }} /> : <Icon name="doc" size={28} />}
      </div>
      <div style={{ fontSize: 12.5, fontWeight: 600, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{f.fileName}</div>
      <div className="muted-sm">{f.uploadedByName || '—'} · {fmtDateTime(f.createdAt)}</div>
    </button>
  );
}

// ---------- فواتير + دفعات + تقسيط (مشتركة بين الخطة والزيارة) ----------
function FinanceBlock({ invoices }: { invoices: Invoice[] }) {
  const navigate = useNavigate();
  const can = useCan();
  const { rows } = useInstallmentRequests();
  if (invoices.length === 0) return <p className="muted" style={{ fontSize: 13 }}>ما فيه فواتير مرتبطة.</p>;
  return (
    <>
      <div className="table-wrap" style={{ marginBottom: 10 }}><table className="table">
        <thead><tr><th>الفاتورة</th><th>الإجمالي</th><th>المدفوع</th><th>المتبقي</th><th>الحالة</th><th>التقسيط</th><th className="actions"></th></tr></thead>
        <tbody>{invoices.map((i) => {
          const st = INVOICE_STATUS[i.status];
          return (
            <tr key={i.id}>
              <td className="num">{i.no}<div className="muted-sm">{i.serviceName}</div></td>
              <td className="num">{money(i.total)}</td><td className="num">{money(i.paid)}</td><td className="num">{money(i.remaining)}</td>
              <td><StatusBadge label={st.label} tone={st.tone} /></td>
              <td>{rows ? <InstallmentStateBadge invoice={i} req={requestFor(rows, i.id)} /> : null}</td>
              <td className="actions">{can('invoices') && <Button size="sm" variant="outline" onClick={() => navigate(`/invoices?q=${i.no}`)}>فتح الفاتورة</Button>}</td>
            </tr>
          );
        })}</tbody>
      </table></div>
      {rows && invoices.map((i) => { const r = requestFor(rows, i.id); return r ? <InstallmentSummary key={i.id} invoice={i} req={r} /> : null; })}
      {invoices.some((i) => db.paymentsForInvoice(i.id).length > 0) && (
        <>
          <div className="section-title">الدفعات</div>
          {invoices.flatMap((i) => db.paymentsForInvoice(i.id).map((p) => (
            <div key={p.id} className="kv-row" style={p.voidedAt ? { opacity: 0.55 } : undefined}>
              <span>{fmtDateTime(p.date)} — {PAYMENT_METHOD_LABEL[p.method]} — {i.no}{p.installmentNo ? ` — الدفعة ${p.installmentNo === 1 ? 'الأولى' : 'الثانية'}` : ''} — {empName(p.createdBy)}{p.voidedAt ? ' — ملغاة' : ''}</span>
              <span className="num">{money(p.amount)}</span>
            </div>
          )))}
        </>
      )}
    </>
  );
}

// ---------- تفاصيل الخطة العلاجية ----------
function PlanDetailsModal({ planId, onClose, onBack }: { planId: string; onClose: () => void; onBack?: () => void }) {
  useDbVersion();
  const { openVisit } = useDetails();
  const navigate = useNavigate();
  const can = useCan();
  const [editingPlan, setEditingPlan] = useState(false);
  const plan = db.plan(planId);
  const { rows } = useInstallmentRequests();
  if (!plan) return <Modal title="الخطة العلاجية" onClose={onClose}><EmptyState icon="target" title="الخطة غير موجودة" /></Modal>;
  const patient = db.patient(plan.patientId);
  const th = plan.therapistId ? db.therapist(plan.therapistId) : undefined;
  const svc = db.service(plan.serviceId);
  const st = db.planStats(plan.id);
  const ps = PLAN_STATUS[plan.status];
  const invoices = db.invoicesForPatient(plan.patientId).filter((i) => i.planId === plan.id);
  const inv = invoices.find((i) => i.status !== 'cancelled') ?? invoices[0];
  const req = inv && rows ? requestFor(rows, inv.id) : undefined;
  const visits = db.appointmentsForPatient(plan.patientId).filter((a) => a.planId === plan.id);
  const price = inv?.price ?? plan.price;
  const payMode = !inv ? '—' : req?.status === 'approved' ? 'على دفعتين (بموافقة المدير)' : req?.status === 'pending' ? 'طلب دفعتين — بانتظار المدير' : inv.paid > 0 && inv.remaining > 0 ? 'دفعات جزئية' : 'دفع كامل';
  return (
    <Modal title={`الخطة العلاجية — ${plan.diagnosis || '—'}`} wide onClose={onClose} footer={<>{onBack && <Button variant="outline" onClick={onBack}>رجوع</Button>}{can('plans', 'edit') && <Button variant="outline" icon="edit" onClick={() => setEditingPlan(true)}>تعديل الخطة</Button>}<Button onClick={onClose}>إغلاق</Button></>}>
      {editingPlan && <PlanModal patientId={plan.patientId} plan={plan} onClose={() => setEditingPlan(false)} />}
      <div className="row-between" style={{ marginBottom: 12, flexWrap: 'wrap', gap: 8 }}>
        <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
          <StatusBadge label={ps.label} tone={ps.tone} />
          {inv && <StatusBadge label={INVOICE_STATUS[inv.status].label} tone={INVOICE_STATUS[inv.status].tone} />}
          {inv && rows && <InstallmentStateBadge invoice={inv} req={req} />}
        </div>
        {patient && <Button size="sm" variant="ghost" icon="user" onClick={() => { onClose(); navigate(`/patients/${patient.id}`); }}>ملف المريض</Button>}
      </div>
      <dl className="review-list" style={{ marginBottom: 14 }}>
        <div><dt>المريض</dt><dd>{patient?.fullName} · <span className="num">{patient?.fileNo}</span> · <span className="num">{patient?.phone}</span></dd></div>
        <div><dt>الطبيب</dt><dd>{th?.name ?? '—'}</dd></div>
        <div><dt>التخصص</dt><dd>{th?.title || '—'}</dd></div>
        <div><dt>التشخيص</dt><dd>{plan.diagnosis} <DiagnosisCode dref={plan.diagnosisRef} /></dd></div>
        <div><dt>المدة</dt><dd>{plan.startDate ? fmtDate(plan.startDate) : '—'} ← {plan.endDate ? fmtDate(plan.endDate) : '—'} · {plan.sessionsPerWeek} جلسات/أسبوع</dd></div>
        <div><dt>تاريخ الإنشاء</dt><dd>{plan.createdAt ? fmtDateTime(plan.createdAt) : '—'} — {empName(plan.createdBy)}</dd></div>
        <div><dt>آخر تعديل</dt><dd>{plan.updatedAt ? `${fmtDateTime(plan.updatedAt)} — ${empName(plan.updatedBy)}` : '—'}</dd></div>
      </dl>

      <div className="section-title">بيانات الحالة والتشخيص</div>
      <dl className="review-list" style={{ marginBottom: 14 }}>
        <div><dt>التشخيص</dt><dd dir="auto">{plan.diagnosis || '—'} <DiagnosisCode dref={plan.diagnosisRef} /></dd></div>
        {plan.patientAge != null && <div><dt>العمر</dt><dd className="num">{plan.patientAge} سنة</dd></div>}
        {plan.chiefComplaint && <div><dt>شكوى المريض</dt><dd style={{ whiteSpace: 'pre-wrap' }}>{plan.chiefComplaint}</dd></div>}
        {plan.painOnset && <div><dt>بداية ظهور الألم</dt><dd style={{ whiteSpace: 'pre-wrap' }}>{/^\d{4}-\d{2}-\d{2}$/.test(plan.painOnset) ? fmtDate(plan.painOnset) : plan.painOnset}</dd></div>}
        <div><dt>الهدف الرئيسي</dt><dd>{plan.mainGoal || '—'}</dd></div>
        {plan.shortTermGoals && <div><dt>أهداف قصيرة المدى</dt><dd style={{ whiteSpace: 'pre-wrap' }}>{plan.shortTermGoals}</dd></div>}
        {plan.longTermGoals && <div><dt>أهداف طويلة المدى</dt><dd style={{ whiteSpace: 'pre-wrap' }}>{plan.longTermGoals}</dd></div>}
        {plan.therapyType && <div><dt>نوع العلاج</dt><dd>{plan.therapyType}</dd></div>}
        {plan.therapistNotes && <div><dt>ملاحظات المعالج</dt><dd style={{ whiteSpace: 'pre-wrap' }}>{plan.therapistNotes}</dd></div>}
        {plan.notes && <div><dt>ملاحظات</dt><dd style={{ whiteSpace: 'pre-wrap' }}>{plan.notes}</dd></div>}
      </dl>

      <SessionDiagnosesList source="plan" id={plan.id} title={patient?.fullName ?? ''} overall={plan.diagnosis} />

      <div className="section-title">تقييم العلاج الطبيعي (Physiotherapy Evaluation)</div>
      <PhysioPlanDetails treatmentPlanId={plan.id} />

      <div className="section-title" style={{ marginTop: 14 }}>الخدمات والإجراءات</div>
      <div className="table-wrap" style={{ marginBottom: 10 }}><table className="table">
        <thead><tr><th>الخدمة</th><th>عدد الجلسات</th><th>سعر الجلسة (القائمة)</th><th>سعر الخطة</th></tr></thead>
        <tbody><tr>
          <td>{svc?.name ?? plan.serviceId ?? '—'}{plan.therapyType && <div className="muted-sm">{plan.therapyType}</div>}</td>
          <td className="num">{st.total}</td>
          <td className="num">{svc ? money(svc.price) : '—'}</td>
          <td className="num">{money(price)}</td>
        </tr></tbody>
      </table></div>
      {(plan.exercises || plan.devices) && <p className="muted-sm" style={{ marginBottom: 10 }}>{plan.exercises && <>التمارين: {plan.exercises}<br /></>}{plan.devices && <>الأجهزة: {plan.devices}</>}</p>}

      <dl className="review-list" style={{ marginBottom: 14 }}>
        <div><dt>إجمالي الخطة</dt><dd className="num">{money(price)}</dd></div>
        <div><dt>الخصم</dt><dd className="num">{money(inv?.discount ?? 0)}</dd></div>
        <div><dt>المبلغ النهائي</dt><dd className="num"><strong>{money(inv?.total ?? price)}</strong></dd></div>
        <div><dt>المدفوع</dt><dd className="num" style={{ color: 'var(--ok)' }}>{money(inv?.paid ?? 0)}</dd></div>
        <div><dt>المتبقي</dt><dd className="num" style={{ color: 'var(--warn)' }}>{money(inv?.remaining ?? 0)}</dd></div>
        <div><dt>نظام الدفع</dt><dd>{payMode}</dd></div>
        <div><dt>الجلسات</dt><dd>{st.completed} مكتملة من {st.total} — {st.remaining} متبقية</dd></div>
      </dl>

      <div className="section-title">الفواتير والدفعات والتقسيط</div>
      <FinanceBlock invoices={invoices} />

      <div className="section-title" style={{ marginTop: 14 }}>الزيارات</div>
      {visits.length === 0 ? <p className="muted" style={{ fontSize: 13 }}>ما فيه زيارات مرتبطة بالخطة.</p> : (
        <div className="table-wrap" style={{ marginBottom: 14 }}><table className="table">
          <thead><tr><th>التاريخ</th><th>الوقت</th><th>الطبيب</th><th>الحالة</th><th className="actions"></th></tr></thead>
          <tbody>{visits.map((a) => (
            <tr key={a.id}>
              <td>{fmtDate(a.date)}</td><td className="num">{fmtTime(a.time)}</td><td>{db.therapist(a.therapistId)?.name ?? '—'}</td>
              <td><StatusBadge label={APPT_STATUS[a.status].label} tone={APPT_STATUS[a.status].tone} /></td>
              <td className="actions"><Button size="sm" variant="outline">عرض التفاصيل</Button></td>
            </tr>
          ))}</tbody>
        </table></div>
      )}

      {/* تحديد موعد كل جلسة بسرعة (نفس حجز «مراجعة فاتورة الخطة») — مواعيد مقترحة وحجز حقيقي مربوط بالخطة */}
      {plan.status === 'active' && <PlanSessionBooking plan={plan} canBook={can('appointments', 'create') || can('booking', 'create')} />}
      <LinkedFiles patientId={plan.patientId} planId={plan.id} />
    </Modal>
  );
}

// ---------- تفاصيل الزيارة ----------
function VisitDetailsModal({ apptId, onClose, onBack }: { apptId: string; onClose: () => void; onBack?: () => void }) {
  useDbVersion();
  const can = useCan();
  const { openPlan } = useDetails();
  const a = db.appointment(apptId);
  if (!a) return <Modal title="الزيارة" onClose={onClose}><EmptyState icon="calendar" title="الزيارة غير موجودة" /></Modal>;
  const patient = db.patient(a.patientId);
  const th = db.therapist(a.therapistId);
  const svc = db.service(a.serviceId);
  const plan = a.planId ? db.plan(a.planId) : undefined;
  const session = db.sessionsForPatient(a.patientId).find((s) => s.appointmentId === a.id);
  const invoices = db.invoicesForPatient(a.patientId).filter((i) => i.appointmentId === a.id || (!!a.planId && i.planId === a.planId));
  const canMedical = can('sessions', 'view');
  const st = APPT_STATUS[a.status];
  return (
    <Modal title={`الزيارة ${a.no} — ${fmtDate(a.date)}`} wide onClose={onClose} footer={<>{onBack && <Button variant="outline" onClick={onBack}>رجوع</Button>}<Button onClick={onClose}>إغلاق</Button></>}>
      <div style={{ display: 'flex', gap: 6, marginBottom: 12, flexWrap: 'wrap' }}>
        <StatusBadge label={st.label} tone={st.tone} />
        {session && <StatusBadge label={session.status === 'completed' ? 'الجلسة مكتملة' : 'الجلسة قيد التنفيذ'} tone={session.status === 'completed' ? 'ok' : 'info'} />}
        <ActorBadges a={a} />
      </div>
      <dl className="review-list" style={{ marginBottom: 14 }}>
        <div><dt>المريض</dt><dd>{patient?.fullName} · <span className="num">{patient?.fileNo}</span></dd></div>
        <div><dt>التاريخ والوقت</dt><dd>{fmtDate(a.date)} — <span className="num">{fmtTime(a.time)}</span></dd></div>
        <div><dt>الطبيب</dt><dd>{th?.name ?? '—'}</dd></div>
        <div><dt>التخصص</dt><dd>{th?.title || '—'}</dd></div>
        <div><dt>سبب الزيارة</dt><dd>{APPT_TYPE_LABEL[a.type]}{a.notes ? ` — ${a.notes}` : ''}</dd></div>
        <div><dt>الخدمة المنفّذة</dt><dd>{svc?.name ?? '—'} · <span className="num">{money(a.price)}</span></dd></div>
        <div><dt>الخطة العلاجية</dt><dd>{plan ? <button type="button" className="link-btn" style={{ border: 0, background: 'none', color: 'var(--brand-700)', cursor: 'pointer', padding: 0, fontWeight: 600 }} onClick={() => openPlan(plan.id)}>{plan.diagnosis} ← عرض الخطة</button> : '—'}</dd></div>
        <ActorDetails a={a} />
        {a.status === 'cancelled' && a.cancelReason && <div><dt>سبب الإلغاء</dt><dd>{a.cancelReason}</dd></div>}
      </dl>

      <div className="section-title">الملاحظات الطبية والإجراءات</div>
      {!canMedical ? <p className="muted" style={{ fontSize: 13 }}><Icon name="lock" size={14} /> الملاحظات الطبية غير متاحة لصلاحيتك.</p> : !session ? <p className="muted" style={{ fontSize: 13 }}>لم تُسجّل جلسة لهذه الزيارة بعد.</p> : (
        <div className="item-card" style={{ marginBottom: 12 }}>
          {session.subject ? <div className="kv-row"><span>الموضوع</span><span>{session.subject}</span></div> : null}
          <div className="kv-row"><span>مقياس الألم</span><span className="num">{session.painScale ?? session.painLevel ?? '—'} / 10</span></div>
          <div className="kv-row"><span>العلاج المستخدم</span><span>{session.treatmentUsed || '—'}</span></div>
          <div className="kv-row"><span>استجابة المريض</span><span>{session.patientResponse || '—'}</span></div>
          <div className="kv-row"><span>الخطة القادمة</span><span>{session.nextPlan || '—'}</span></div>
        </div>
      )}

      <div className="section-title">الفاتورة والدفعات</div>
      <FinanceBlock invoices={invoices} />

      <div style={{ marginTop: 14 }}><LinkedFiles patientId={a.patientId} appointmentId={a.id} planIdForAppt={a.planId} /></div>
    </Modal>
  );
}

// زرار «عرض التفاصيل» صغير يستخدم في أي جدول
export function DetailsButton({ onClick }: { onClick: () => void }) {
  return <Button size="sm" variant="outline" icon="eye" onClick={(e) => { e.stopPropagation(); onClick(); }}>عرض التفاصيل</Button>;
}
