import { useState } from 'react';
import { db } from '../data/db';
import type { Invoice, TreatmentSession } from '../types';
import { Modal, Button, Input } from './ui';
import { useToast } from '../hooks/useToast';
import { fmtDate, money } from '../utils/format';
import { Icon } from '../utils/icons';

export default function SessionModal({ session, onClose }: { session: TreatmentSession; onClose: () => void }) {
  const toast = useToast();
  const [busy, setBusy] = useState(false);
  const [completedInvoice, setCompletedInvoice] = useState<Invoice | null | undefined>(undefined);
  // الجلسات القديمة: لو مستوى الألم القديم بين 1 و10 بيتعرض كمقياس مبدئي، وإلا فاضي لحد ما الأخصائي يختار
  const legacyScale = session.painScale ?? (session.painLevel && session.painLevel >= 1 && session.painLevel <= 10 ? session.painLevel : null);
  const [f, setF] = useState<{ subject: string; painScale: number | null; treatmentUsed: string; patientResponse: string; nextPlan: string }>({
    subject: session.subject ?? '', painScale: legacyScale, treatmentUsed: session.treatmentUsed, patientResponse: session.patientResponse, nextPlan: session.nextPlan,
  });
  const patient = db.patient(session.patientId);
  const appt = db.appointment(session.appointmentId);
  const pkg = appt?.packageId ? db.raw().packages.find((p) => p.id === appt.packageId) : null;
  const plan = session.planId ? db.plan(session.planId) : undefined;
  const planIdx = db.planSessionIndex(session.id);
  const done = session.status === 'completed';

  // الأجهزة/التمارين/ملاحظات المعالج اتشالت من الواجهة (بياناتها القديمة محفوظة في القاعدة ومابتتلمسش)
  const payload = () => ({ subject: f.subject, ...(f.painScale != null ? { painScale: f.painScale } : {}), treatmentUsed: f.treatmentUsed, patientResponse: f.patientResponse, nextPlan: f.nextPlan });
  const save = async () => { setBusy(true); try { await db.updateSession(session.id, payload()); } finally { setBusy(false); } toast.success(done ? 'تم تعديل بيانات الجلسة.' : 'تم حفظ ملاحظات الجلسة.'); if (done) onClose(); };
  const complete = async () => {
    if (f.painScale == null) { toast.error('حدّد مقياس الألم (Pain Scale) من 1 إلى 10 قبل إنهاء الجلسة.'); return; }
    setBusy(true);
    try { await db.completeSession(session.id, payload()); } catch (e) { setBusy(false); toast.error((e as Error).message); return; }
    setBusy(false);
    toast.success('تم إنهاء الجلسة وتحديث الموعد' + (pkg ? ' والباقة' : '') + (plan ? ' وتقدم الخطة' : '') + ' — وصل إشعار للمريض على حسابه.');
    setCompletedInvoice(db.invoices().find((i) => i.appointmentId === session.appointmentId) ?? null);
  };

  if (completedInvoice !== undefined) {
    return (
      <Modal title="تم إنهاء الجلسة بنجاح" onClose={onClose} footer={<Button onClick={onClose}>تم</Button>}>
        <div className="success" style={{ textAlign: 'center' }}>
          <div className="mark"><Icon name="check" size={30} /></div>
          <p className="muted">{patient?.fullName} — الجلسة رقم {session.sessionNo}</p>
        </div>
        {completedInvoice ? (
          <dl className="review-list" style={{ marginTop: 16 }}>
            <div><dt>رقم الفاتورة</dt><dd className="num">{completedInvoice.no}</dd></div>
            <div><dt>الإجمالي</dt><dd className="num">{money(completedInvoice.total)}</dd></div>
            <div><dt>المتبقي</dt><dd className="num">{money(completedInvoice.remaining)}</dd></div>
          </dl>
        ) : <p className="muted" style={{ marginTop: 12 }}>ما فيه فاتورة مستقلة لهذه الجلسة (مشمولة في باقة أو خطة علاجية).</p>}
        {completedInvoice && <p className="muted-sm" style={{ marginTop: 12 }}>عرض الفاتورة أو تعديلها أو إرسالها أو طباعتها من قسم «الفواتير».</p>}
      </Modal>
    );
  }
  const set = (k: 'subject' | 'treatmentUsed' | 'patientResponse' | 'nextPlan', v: string) => setF((x) => ({ ...x, [k]: v }));
  const area = (k: 'treatmentUsed' | 'patientResponse' | 'nextPlan', label: string) => (
    <div className="field"><label htmlFor={`ss-${k}`}>{label}</label><textarea id={`ss-${k}`} className="input" rows={2} value={f[k]} onChange={(e) => set(k, e.target.value)} /></div>
  );

  return (
    <Modal title={`جلسة ${patient?.fullName ?? ''} — رقم ${session.sessionNo}`} onClose={onClose} wide footer={
      done
        ? <><Button variant="outline" onClick={onClose} disabled={busy}>إلغاء</Button><Button onClick={save} loading={busy}>حفظ التعديلات</Button></>
        : <><Button variant="outline" onClick={save} loading={busy}>حفظ كمسودة</Button><Button icon="check" onClick={complete} loading={busy}>إنهاء الجلسة</Button></>
    }>
      <dl className="dl" style={{ marginBottom: 16 }}>
        <div><dt>رقم الملف</dt><dd className="num">{patient?.fileNo}</dd></div>
        <div><dt>المعالج</dt><dd>{db.therapist(session.therapistId)?.name}</dd></div>
        <div><dt>التاريخ</dt><dd>{fmtDate(session.date)}</dd></div>
        <div><dt>التشخيص</dt><dd>{patient?.diagnosis || '—'}</dd></div>
        <div><dt>الخطة العلاجية</dt><dd>{plan ? `${plan.diagnosis}${planIdx ? ` — الجلسة ${planIdx.index} من ${planIdx.total}` : ''}` : 'غير مرتبطة بخطة'}</dd></div>
        <div><dt>الباقة</dt><dd>{pkg ? `${pkg.name} (متبقٍ ${pkg.totalSessions - pkg.usedSessions})` : 'بدون باقة'}</dd></div>
      </dl>
      <Input id="ss-subject" label="الموضوع (Subject)" maxLength={300} value={f.subject} onChange={(e) => set('subject', e.target.value)} />
      <div className="field">
        <label>مقياس الألم (Pain Scale) من 1 إلى 10 <span style={{ color: 'var(--danger)' }}>*</span></label>
        <div className="slots" role="radiogroup" aria-label="Pain Scale 1-10">
          {Array.from({ length: 10 }, (_, i) => i + 1).map((n) => (
            <button key={n} type="button" role="radio" aria-checked={f.painScale === n} className={`slot ${f.painScale === n ? 'selected' : ''}`} style={{ minWidth: 44 }}
              onClick={() => setF((x) => ({ ...x, painScale: n }))}>{n}</button>
          ))}
        </div>
      </div>
      {area('treatmentUsed', 'العلاج المستخدم')}
      {area('patientResponse', 'استجابة المريض')}
      {area('nextPlan', 'خطة الجلسة القادمة')}
    </Modal>
  );
}
