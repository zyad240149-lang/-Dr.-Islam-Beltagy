// «تشخيص المريض»: اختار المريض ← زرار واحد «تشخيص» يفتح نموذج الكشف والتشخيص، وتحته التشخيصات السابقة
import { useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { ortho, useOrthoVersion, type Consultation } from './data';
import { LoadState, PageHead, PatientSelect, patientFile, useClinicalCan } from './kit';
import { ConsultList, ConsultModal, loadConsultDraft, pickedToConsult } from './Consultations';
import { DiagnosisPicker } from '../components/DiagnosisPicker';
import { Button } from '../components/ui';

export default function Diagnosis() {
  useOrthoVersion();
  const perm = useClinicalCan();
  const [params, setParams] = useSearchParams();
  const patientId = params.get('patient') ?? '';
  const [edit, setEdit] = useState<Consultation | 'new' | null>(null);
  const [mapOpen, setMapOpen] = useState(false);
  const [preset, setPreset] = useState<Partial<Consultation> | undefined>();
  const [resume, setResume] = useState(false);
  const pick = (id: string) => setParams(id ? { patient: id } : {}, { replace: true });
  // فيه تشخيص بدأه المستخدم لنفس المريض وخرج من غير ما يحفظه؟ (نعيد الفحص كل ما تتقفل النافذة عشان الزرار يظهر/يختفي صح)
  const draft = patientId && !edit ? loadConsultDraft(patientId) : null;

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
            setMapOpen(true);
          }}>{draft ? 'تشخيص جديد' : 'تشخيص'}</Button>}
        </div>
      </section>
      {patientId && (
        <section className="card">
          <div className="card__head"><h2>التشخيصات السابقة</h2></div>
          <div className="card__body">
            <LoadState kind="consultations">
              <ConsultList hidePatient items={ortho.list('consultations', patientId).sort((a, b) => b.date.localeCompare(a.date))} onEdit={(c) => setEdit(c)} />
            </LoadState>
          </div>
        </section>
      )}
      {edit && patientId && <ConsultModal patientId={patientId} initial={edit === 'new' ? undefined : edit} preset={edit === 'new' ? preset : undefined} resume={edit === 'new' && resume} onClose={() => { setEdit(null); setPreset(undefined); setResume(false); }} />}
      {/* خريطة الجسم (مرجع مركز التميز): اختيار المنطقة والحالة ← نموذج الكشف متعبّي بالتشخيص والكود والجهة */}
      {mapOpen && <DiagnosisPicker onClose={() => setMapOpen(false)} onPick={(text, ref) => { setPreset(pickedToConsult(text, ref)); setMapOpen(false); setEdit('new'); }} />}
    </div>
  );
}
