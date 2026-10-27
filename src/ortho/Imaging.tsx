import { useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import { Button, EmptyState, Modal } from '../components/ui';
import { useToast } from '../hooks/useToast';
import { fmtDate, todayYmd } from '../utils/format';
import { AttachmentThumbs } from './Consultations';
import { IMAGING_KIND, IMAGING_STATUS, ortho, useOrthoVersion, type Attachment, type Imaging, type ImagingKind, type ImagingStatus } from './data';
import { Field, IconBtn, LoadState, PageHead, PatientSelect, PillTabs, Tone, confirmDelete, patientName, useClinicalCan, useRun } from './kit';

export function ImagingModal({ initial, patientId = '', onClose }: { initial?: Imaging; patientId?: string; onClose: () => void }) {
  const { run, busy } = useRun();
  const toast = useToast();
  const [m, setM] = useState<Omit<Imaging, 'id'> & { id?: string }>(initial ?? { patientId, kind: 'xray', region: '', requestedAt: todayYmd(), status: 'requested', finding: '', attachments: [] });
  const [uploading, setUploading] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);
  const set = <K extends keyof Imaging>(k: K, v: Imaging[K]) => setM((x) => ({ ...x, [k]: v }));

  async function upload(files: FileList | null) {
    if (!files?.length || !m.patientId) return;
    setUploading(true);
    try {
      const added: Attachment[] = [];
      for (const f of Array.from(files)) added.push(await ortho.uploadAttachment(m.patientId, f));
      setM((x) => ({ ...x, attachments: [...x.attachments, ...added], status: x.status === 'requested' ? 'received' : x.status }));
      toast.success(added.length > 1 ? `تم رفع ${added.length} ملفات` : 'تم رفع النتيجة');
    } catch (e) { toast.error((e as Error).message); }
    finally { setUploading(false); if (fileRef.current) fileRef.current.value = ''; }
  }

  return (
    <Modal title={initial ? 'تحديث الأشعة / التحليل' : 'طلب أشعة / تحليل'} onClose={onClose} footer={<>
      <Button variant="outline" onClick={onClose}>إلغاء</Button>
      <Button icon="check" loading={busy} disabled={!m.patientId || !m.region.trim()} onClick={() => run(() => ortho.save('imaging', m), 'تم الحفظ', onClose)}>حفظ</Button>
    </>}>
      <div className="grid-form">
        <Field label="المريض" className="span-2"><PatientSelect value={m.patientId} onChange={(v) => set('patientId', v)} /></Field>
        <Field label="النوع">
          <select className="input" value={m.kind} onChange={(e) => set('kind', e.target.value as ImagingKind)}>{Object.entries(IMAGING_KIND).map(([k, v]) => <option key={k} value={k}>{v}</option>)}</select>
        </Field>
        <Field label={m.kind === 'lab' ? 'اسم التحليل' : 'المنطقة'}><input className="input" value={m.region} onChange={(e) => set('region', e.target.value)} placeholder={m.kind === 'lab' ? 'مثال: CBC' : 'مثال: الركبة اليسرى'} /></Field>
        <Field label="تاريخ الطلب"><input type="date" className="input" value={m.requestedAt} onChange={(e) => set('requestedAt', e.target.value)} /></Field>
        <Field label="الحالة">
          <select className="input" value={m.status} onChange={(e) => set('status', e.target.value as ImagingStatus)}>{Object.entries(IMAGING_STATUS).map(([k, v]) => <option key={k} value={k}>{v.label}</option>)}</select>
        </Field>
        <Field label="قراءة الطبيب" className="span-2"><textarea className="input" rows={3} value={m.finding} onChange={(e) => set('finding', e.target.value)} /></Field>
        <Field label={m.kind === 'lab' ? 'نتيجة التحليل' : 'صورة النتيجة'} className="span-2">
          <Button size="sm" variant="outline" icon="upload" loading={uploading} disabled={!m.patientId} onClick={() => fileRef.current?.click()}>{m.kind === 'lab' ? 'رفع تحاليل' : 'رفع صورة النتيجة'}</Button>
          <input ref={fileRef} type="file" hidden multiple accept="image/png,image/jpeg,image/webp,application/pdf" onChange={(e) => void upload(e.target.files)} />
          {m.attachments.length > 0 && <AttachmentThumbs items={m.attachments} onRemove={(path) => set('attachments', m.attachments.filter((a) => a.path !== path))} />}
        </Field>
      </div>
    </Modal>
  );
}

export function ImagingTable({ items, onEdit, hidePatient }: { items: Imaging[]; onEdit: (m: Imaging) => void; hidePatient?: boolean }) {
  const { run } = useRun();
  const perm = useClinicalCan();
  if (!items.length) return <EmptyState icon="scan" title="لا توجد أشعة أو تحاليل" />;
  return (
    <div className="table-wrap">
      <table className="table">
        <thead><tr>{!hidePatient && <th>المريض</th>}<th>النوع</th><th>المنطقة / التحليل</th><th>تاريخ الطلب</th><th>الحالة</th><th>القراءة</th><th>الملفات</th><th className="actions" /></tr></thead>
        <tbody>
          {items.map((m) => (
            <tr key={m.id}>
              {!hidePatient && <td><Link className="ortho-cell-strong" to={`/patients/${m.patientId}`}>{patientName(m.patientId)}</Link></td>}
              <td>{IMAGING_KIND[m.kind]}</td>
              <td>{m.region}</td>
              <td>{fmtDate(m.requestedAt)}</td>
              <td><Tone s={IMAGING_STATUS[m.status]} /></td>
              <td style={{ maxWidth: 260 }}>{m.finding || <span className="muted">—</span>}</td>
              <td>{m.attachments?.length ? <span className="badge badge--brand">{m.attachments.length} ملف</span> : <span className="muted">—</span>}</td>
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
  const labsRequested = all.filter((m) => m.kind === 'lab' && m.status === 'requested');
  const list = tab === 'all' ? all : all.filter((m) => m.status === tab);
  return (
    <div className="page">
      <PageHead title="الأشعة والتحاليل" sub="طلبات الأشعة والتحاليل ومتابعة وصولها وقراءتها">
        {perm.add && <Button icon="plus" onClick={() => setEdit('new')}>طلب جديد</Button>}
      </PageHead>
      {labsRequested.length > 0 && (
        <section className="card">
          <div className="card__head"><h3>تحاليل مطلوبة ({labsRequested.length})</h3></div>
          <div className="card__body"><ImagingTable items={labsRequested} onEdit={setEdit} /></div>
        </section>
      )}
      <PillTabs value={tab} onChange={setTab} tabs={[{ id: 'all' as const, label: 'الكل', n: all.length }, ...(Object.keys(IMAGING_STATUS) as ImagingStatus[]).map((s) => ({ id: s, label: IMAGING_STATUS[s].label, n: all.filter((m) => m.status === s).length }))]} />
      <LoadState kind="imaging"><section className="card"><ImagingTable items={list} onEdit={setEdit} /></section></LoadState>
      {edit && <ImagingModal initial={edit === 'new' ? undefined : edit} onClose={() => setEdit(null)} />}
    </div>
  );
}
