// «خطة علاجية سريعة» — من غير تشخيص: المريض ← الدكتور ← عدد الجلسات. وخلاص.
// بتعمل الخطة (save_plan) بسعر محسوب تلقائي (الدكتور: 0 والاستقبال يحدده من «فواتير الخطط العلاجية»).
// مواعيد الجلسات اتشالت من هنا بطلب المستخدم — بتتحجز بعدين من تفاصيل الخطة أو «مراجعة فاتورة الخطة» (PlanSessionBooking).
import { useState } from 'react';
import { db } from '../data/db';
import { Button, Input, Modal, Select } from './ui';
import { useToast } from '../hooks/useToast';
import { useAuth } from '../services/auth';
import { autoPlanPriceInfo } from './PatientForms';
import { todayYmd } from '../utils/format';

export default function QuickPlanModal({ onClose }: { onClose: () => void }) {
  const toast = useToast();
  const { user } = useAuth();
  const [q, setQ] = useState('');
  const [patientId, setPatientId] = useState('');
  const [doctorId, setDoctorId] = useState(user?.therapistId ?? '');
  const [count, setCount] = useState(6);
  const [other, setOther] = useState(false);
  const [busy, setBusy] = useState(false);
  const services = db.allServices().filter((s) => s.active);
  const service = services.find((s) => s.id === 'sv_pt') ?? services.find((s) => s.name.includes('العلاج الطبيعي')) ?? services[0];
  const patient = patientId ? db.patient(patientId) : undefined;
  const results = !patientId && q.trim() ? db.searchPatients(q).slice(0, 6) : [];

  const save = async () => {
    if (!patient) { toast.error('اختر المريض.'); return; }
    if (!doctorId) { toast.error('اختر الدكتور.'); return; }
    if (!service) { toast.error('ما فيه خدمة فعّالة.'); return; }
    if (!(Number.isInteger(count) && count >= 1 && count <= 52)) { toast.error('عدد الجلسات من 1 إلى 52.'); return; }
    setBusy(true);
    const price = autoPlanPriceInfo({ therapyType: '', serviceId: service.id, totalSessions: count }).price;
    try {
      await db.savePlan({
        patientId: patient.id, serviceId: service.id, diagnosis: '', mainGoal: '', shortTermGoals: '', longTermGoals: '', therapyType: '', exercises: '', devices: '',
        therapistNotes: '', notes: '', price, totalSessions: count, durationWeeks: count, sessionsPerWeek: 1, startDate: todayYmd(), status: 'active', therapistId: doctorId,
      } as Parameters<typeof db.savePlan>[0]);
    } catch (e) { setBusy(false); toast.error((e as Error).message || 'تعذّر إنشاء الخطة.'); return; }
    setBusy(false);
    toast.success(`تم إنشاء الخطة (${count} جلسة).`);
    onClose();
  };

  return (
    <Modal title="خطة علاجية سريعة (بدون تشخيص)" onClose={() => !busy && onClose()} footer={
      <><Button variant="outline" onClick={onClose} disabled={busy}>إلغاء</Button><Button icon="check" onClick={save} loading={busy}>إنشاء الخطة</Button></>
    }>
      <div className="grid-form">
        {patient ? (
          <div className="field"><label>المريض</label>
            <div className="row-between" style={{ gap: 8 }}><strong>{patient.fullName} <span className="muted-sm num">{patient.fileNo}</span></strong>
              <Button size="sm" variant="ghost" onClick={() => { setPatientId(''); setQ(''); }}>تغيير</Button></div></div>
        ) : (
          <div className="field">
            <Input id="qp-q" label="المريض *" icon="search" placeholder="الاسم أو الجوال أو رقم الملف أو الهوية" value={q} onChange={(e) => setQ(e.target.value)} />
            {results.map((p) => <button key={p.id} type="button" className="choice" style={{ width: '100%', marginTop: 4 }} onClick={() => setPatientId(p.id)}><span><strong>{p.fullName}</strong> <span className="num">{p.fileNo} · {p.phone}</span></span></button>)}
            {q.trim() && results.length === 0 && <p className="muted-sm">ما فيه نتائج مطابقة.</p>}
          </div>
        )}
        <Select id="qp-doc" label="الدكتور *" value={doctorId} onChange={(e) => setDoctorId(e.target.value)}
          options={[{ value: '', label: 'اختر الدكتور' }, ...db.therapists().map((t) => ({ value: t.id, label: t.name }))]} />
        <Select id="qp-count" label="عدد الجلسات *" value={other ? 'other' : String(count)}
          onChange={(e) => { if (e.target.value === 'other') setOther(true); else { setOther(false); setCount(Number(e.target.value)); } }}
          options={[...Array.from({ length: 12 }, (_, i) => ({ value: String(i + 1), label: `${i + 1} ${i + 1 === 1 ? 'جلسة' : i + 1 === 2 ? 'جلستين' : i + 1 <= 10 ? 'جلسات' : 'جلسة'}` })), { value: 'other', label: 'عدد آخر (اكتب العدد)' }]} />
        {other && <Input id="qp-count-o" label="اكتب عدد الجلسات" type="number" min={1} max={52} value={count} onChange={(e) => setCount(Number(e.target.value))} />}
      </div>
    </Modal>
  );
}
