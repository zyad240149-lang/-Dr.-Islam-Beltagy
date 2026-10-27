// تبويبات العظام داخل ملف المريض
import { useState } from 'react';
import { Button } from '../components/ui';
import { ortho, useOrthoVersion, type Consultation, type Fracture, type Imaging, type Surgery } from './data';
import { LoadState, useClinicalCan } from './kit';
import { ConsultList, ConsultModal } from './Consultations';
import { ImagingModal, ImagingTable } from './Imaging';
import { FractureCards, FractureModal } from './Fractures';
import { SurgeryCards, SurgeryModal } from './Surgeries';

export type OrthoKind = 'consultations' | 'imaging' | 'fractures' | 'surgeries';
const ADD: Record<OrthoKind, string> = { consultations: 'كشف جديد', imaging: 'طلب أشعة', fractures: 'تسجيل كسر', surgeries: 'عملية جديدة' };

export function OrthoPatientTab({ kind, patientId }: { kind: OrthoKind; patientId: string }) {
  useOrthoVersion();
  const [edit, setEdit] = useState<object | 'new' | null>(null);
  const init = (edit === 'new' ? undefined : edit) as never;
  const close = () => setEdit(null);
  const perm = useClinicalCan();
  return (
    <div>
      <div style={{ display: 'flex', justifyContent: 'flex-end', marginBottom: 14 }}>
        {perm.add && <Button size="sm" icon="plus" onClick={() => setEdit('new')}>{ADD[kind]}</Button>}
      </div>
      <LoadState kind={kind}>
      {kind === 'consultations' && <ConsultList hidePatient items={ortho.list('consultations', patientId).sort((a, b) => b.date.localeCompare(a.date))} onEdit={(c: Consultation) => setEdit(c)} />}
      {kind === 'imaging' && <ImagingTable hidePatient items={ortho.list('imaging', patientId)} onEdit={(m: Imaging) => setEdit(m)} />}
      {kind === 'fractures' && <FractureCards items={ortho.list('fractures', patientId)} onEdit={(f: Fracture) => setEdit(f)} />}
      {kind === 'surgeries' && <SurgeryCards items={ortho.list('surgeries', patientId)} onEdit={(s: Surgery) => setEdit(s)} />}
      </LoadState>
      {edit && kind === 'consultations' && <ConsultModal patientId={patientId} initial={init} onClose={close} />}
      {edit && kind === 'imaging' && <ImagingModal patientId={patientId} initial={init} onClose={close} />}
      {edit && kind === 'fractures' && <FractureModal patientId={patientId} initial={init} onClose={close} />}
      {edit && kind === 'surgeries' && <SurgeryModal patientId={patientId} initial={init} onClose={close} />}
    </div>
  );
}
