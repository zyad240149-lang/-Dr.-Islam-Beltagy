import { useState } from 'react';
import { Link } from 'react-router-dom';
import { Button, EmptyState, Modal } from '../components/ui';
import { fmtDate, todayYmd } from '../utils/format';
import { IMAGING_KIND, IMAGING_STATUS, ortho, useOrthoVersion, type Imaging, type ImagingKind, type ImagingStatus } from './data';
import { Field, IconBtn, LoadState, PageHead, PatientSelect, PillTabs, Tone, confirmDelete, patientName, useClinicalCan, useRun } from './kit';

export function ImagingModal({ initial, patientId = '', onClose }: { initial?: Imaging; patientId?: string; onClose: () => void }) {
  const { run, busy } = useRun();
  const [m, setM] = useState<Omit<Imaging, 'id'> & { id?: string }>(initial ?? { patientId, kind: 'xray', region: '', requestedAt: todayYmd(), status: 'requested', finding: '' });
  const set = <K extends keyof Imaging>(k: K, v: Imaging[K]) => setM((x) => ({ ...x, [k]: v }));
  return (
    <Modal title={initial ? 'تحديث الأشعة' : 'طلب أشعة / تحليل'} onClose={onClose} footer={<>
      <Button variant="outline" onClick={onClose}>إلغاء</Button>
      <Button icon="check" loading={busy} disabled={!m.patientId || !m.region.trim()} onClick={() => run(() => ortho.save('imaging', m), 'تم الحفظ', onClose)}>حفظ</Button>
    </>}>
      <div className="grid-form">
        <Field label="المريض" className="span-2"><PatientSelect value={m.patientId} onChange={(v) => set('patientId', v)} /></Field>
        <Field label="النوع">
          <select className="input" value={m.kind} onChange={(e) => set('kind', e.target.value as ImagingKind)}>{Object.entries(IMAGING_KIND).map(([k, v]) => <option key={k} value={k}>{v}</option>)}</select>
        </Field>
        <Field label="المنطقة"><input className="input" value={m.region} onChange={(e) => set('region', e.target.value)} placeholder="مثال: الركبة اليسرى" /></Field>
        <Field label="تاريخ الطلب"><input type="date" className="input" value={m.requestedAt} onChange={(e) => set('requestedAt', e.target.value)} /></Field>
        <Field label="الحالة">
          <select className="input" value={m.status} onChange={(e) => set('status', e.target.value as ImagingStatus)}>{Object.entries(IMAGING_STATUS).map(([k, v]) => <option key={k} value={k}>{v.label}</option>)}</select>
        </Field>
        <Field label="قراءة الطبيب" className="span-2"><textarea className="input" rows={3} value={m.finding} onChange={(e) => set('finding', e.target.value)} /></Field>
      </div>
    </Modal>
  );
}

export function ImagingTable({ items, onEdit, hidePatient }: { items: Imaging[]; onEdit: (m: Imaging) => void; hidePatient?: boolean }) {
  const { run } = useRun();
  const perm = useClinicalCan();
  if (!items.length) return <EmptyState icon="scan" title="لا توجد أشعة" />;
  return (
    <div className="table-wrap">
      <table className="table">
        <thead><tr>{!hidePatient && <th>المريض</th>}<th>النوع</th><th>المنطقة</th><th>تاريخ الطلب</th><th>الحالة</th><th>القراءة</th><th className="actions" /></tr></thead>
        <tbody>
          {items.map((m) => (
            <tr key={m.id}>
              {!hidePatient && <td><Link className="ortho-cell-strong" to={`/patients/${m.patientId}`}>{patientName(m.patientId)}</Link></td>}
              <td>{IMAGING_KIND[m.kind]}</td>
              <td>{m.region}</td>
              <td>{fmtDate(m.requestedAt)}</td>
              <td><Tone s={IMAGING_STATUS[m.status]} /></td>
              <td style={{ maxWidth: 260 }}>{m.finding || <span className="muted">—</span>}</td>
              <td className="actions"><div style={{ display: 'flex', gap: 6 }}>
                {perm.edit && <IconBtn icon="edit" label="تحديث" onClick={() => onEdit(m)} />}
                {perm.del && <IconBtn icon="trash" label="حذف" danger onClick={() => confirmDelete('هذا الطلب') && run(() => ortho.remove('imaging', m.id), 'تم الحذف')} />}
              </div></td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

export default function ImagingPage() {
  useOrthoVersion();
  const perm = useClinicalCan();
  const [tab, setTab] = useState<ImagingStatus | 'all'>('all');
  const [edit, setEdit] = useState<Imaging | 'new' | null>(null);
  const all = ortho.list('imaging').sort((a, b) => b.requestedAt.localeCompare(a.requestedAt));
  const list = tab === 'all' ? all : all.filter((m) => m.status === tab);
  return (
    <div className="page">
      <PageHead title="الأشعة والتحاليل" sub="طلبات الأشعة ومتابعة وصولها وقراءتها">
        {perm.add && <Button icon="plus" onClick={() => setEdit('new')}>طلب جديد</Button>}
      </PageHead>
      <PillTabs value={tab} onChange={setTab} tabs={[{ id: 'all' as const, label: 'الكل', n: all.length }, ...(Object.keys(IMAGING_STATUS) as ImagingStatus[]).map((s) => ({ id: s, label: IMAGING_STATUS[s].label, n: all.filter((m) => m.status === s).length }))]} />
      <LoadState kind="imaging"><section className="card"><ImagingTable items={list} onEdit={setEdit} /></section></LoadState>
      {edit && <ImagingModal initial={edit === 'new' ? undefined : edit} onClose={() => setEdit(null)} />}
    </div>
  );
}
