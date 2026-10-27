// «تشخيص المريض»: اختار المريض ← زرار واحد «تشخيص» يفتح نموذج الكشف والتشخيص، وتحته التشخيصات السابقة
import { useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { ortho, useOrthoVersion, type Consultation } from './data';
import { LoadState, PageHead, PatientSelect, patientFile, patientName, useClinicalCan } from './kit';
import { ConsultList, ConsultModal, loadConsultDraft } from './Consultations';
import { EmptyState } from '../components/ui';
import { Button } from '../components/ui';
import { db } from '../data/db';
import { useDbVersion } from '../hooks/useDb';
import { fmtTime } from '../utils/format';
import type { Appointment } from '../types';

export default function Diagnosis() {
  useOrthoVersion();
  useDbVersion();
  const perm = useClinicalCan();
  const [params, setParams] = useSearchParams();
  const patientId = params.get('patient') ?? '';
  const [edit, setEdit] = useState<Consultation | 'new' | null>(null);
  const [resume, setResume] = useState(false);
  const pick = (id: string) => setParams(id ? { patient: id } : {}, { replace: true });
  // فيه تشخيص بدأه المستخدم لنفس المريض وخرج من غير ما يحفظه؟ (نعيد الفحص كل ما تتقفل النافذة عشان الزرار يظهر/يختفي صح)
  const draft = patientId && !edit ? loadConsultDraft(patientId) : null;
  // آخر تشخيص لكل مريض (مش كل الكشوفات — عشان المريض الواحد يظهر مرة واحدة)، الأحدث أولًا
  const recentDiagnosed = (() => {
    const seen = new Set<string>();
    const out: Consultation[] = [];
    for (const c of ortho.list('consultations').sort((a, b) => b.date.localeCompare(a.date))) {
      if (seen.has(c.patientId)) continue;
      seen.add(c.patientId);
      out.push(c);
      if (out.length >= 30) break;
    }
    return out;
  })();
  // مرضى حاضرين النهارده (اتعمللهم حضور لأي خدمة) — واحد لكل مريض، أقرب ميعاد أولًا
  const presentToday = (() => {
    const seen = new Set<string>();
    const out: Appointment[] = [];
    for (const a of db.todayAppointments().filter((x) => x.status === 'arrived' || x.status === 'in_progress').sort((x, y) => x.time.localeCompare(y.time))) {
      if (seen.has(a.patientId)) continue;
      seen.add(a.patientId);
      out.push(a);
    }
    return out;
  })();

  return (
    <div className="page">
      <PageHead title="تشخيص المريض" sub="اختار المريض واضغط «تشخيص»." />
      <section className="card" style={{ marginBottom: 16 }}>
        <div className="card__body" style={{ display: 'flex', gap: 12, alignItems: 'flex-end', flexWrap: 'wrap' }}>
          <div className="field" style={{ flex: '1 1 320px', marginBottom: 0 }}>
            <label>المريض</label>
            <PatientSelect value={patientId} onChange={pick} />
          </div>
          {patientId && <span className="badge badge--brand">ملف {patientFile(patientId)}</span>}
          {perm.add && draft && <Button icon="refresh" variant="outline" onClick={() => { setResume(true); setEdit('new'); }}>استكمال التشخيص</Button>}
          {perm.add && <Button icon="stethoscope" disabled={!patientId} onClick={() => {
            if (draft && !window.confirm('فيه تشخيص لم يكتمل للمريض ده — بدء تشخيص جديد هيستبدله. تكمل؟')) return;
            setResume(false); setEdit('new');
          }}>{draft ? 'تشخيص جديد' : 'تشخيص'}</Button>}
        </div>
      </section>
      {!patientId && presentToday.length > 0 && (
        <section className="card" style={{ marginBottom: 16 }}>
          <div className="card__head"><h2>مرضى حاضرين النهارده ({presentToday.length})</h2></div>
          <div className="card__body">
            <div className="cx-chips">
              {presentToday.map((a) => (
                <button key={a.patientId} type="button" className="cx-chip" onClick={() => pick(a.patientId)}>
                  {patientName(a.patientId)} — {db.service(a.serviceId)?.name} <span className="num" style={{ opacity: .7 }}>{fmtTime(a.time)}</span>
                </button>
              ))}
            </div>
          </div>
        </section>
      )}
      {patientId ? (
        <section className="card">
          <div className="card__head"><h2>التشخيصات السابقة</h2></div>
          <div className="card__body">
            <LoadState kind="consultations">
              <ConsultList hidePatient items={ortho.list('consultations', patientId).sort((a, b) => b.date.localeCompare(a.date))} onEdit={(c) => setEdit(c)} />
            </LoadState>
          </div>
        </section>
      ) : (
        <section className="card">
          <div className="card__head"><h2>المرضى اللي اتشخصوا</h2></div>
          <div className="card__body">
            <LoadState kind="consultations">
              {recentDiagnosed.length === 0
                ? <EmptyState icon="stethoscope" title="لا يوجد مرضى متشخّصون بعد" />
                : <ConsultList items={recentDiagnosed} onEdit={(c) => { pick(c.patientId); setEdit(c); }} />}
            </LoadState>
          </div>
        </section>
      )}
      {/* «تشخيص» بيفتح الشيت على طول: شيت التمريض (وفيه خريطة الجسم لمكان الألم) ← كشف الطبيب ← الروشتة */}
      {edit && patientId && <ConsultModal patientId={patientId} initial={edit === 'new' ? undefined : edit} resume={edit === 'new' && resume} onClose={() => { setEdit(null); setResume(false); }} />}
    </div>
  );
}
