import { FilePreviewModal, useDetails } from './DetailsHost';
import { useEffect, useRef, useState } from 'react';
import { db } from '../data/db';
import { BODY_REGIONS, SIDE_LABEL, findCondition } from '../data/bodyRegions';
import { Button, EmptyState, Input, Modal, Select, Skeleton } from './ui';
import { ConfirmDialog, IconAction, RowActions, useCan } from './common';
import { useToast } from '../hooks/useToast';
import { fmtDate, fmtDateTime, tsToYmd } from '../utils/format';
import type { BodyRecord, PatientFile } from '../types';

const SEVERITY = ['1 — خفيفة', '2 — بسيطة', '3 — متوسطة', '4 — شديدة', '5 — شديدة جدًا'];
const SEV_TONE = ['ok', 'ok', 'warn', 'danger', 'danger'];

// ============ نافذة تسجيل حالة على الجسم ============
export function BodyRecordModal({ patientId, record, presetRegion, presetCondition, onClose, onSaved }: {
  patientId?: string; record?: BodyRecord; presetRegion?: string; presetCondition?: string; onClose: () => void; onSaved?: () => void;
}) {
  const toast = useToast();
  const [busy, setBusy] = useState(false);
  const [pid, setPid] = useState(record?.patientId ?? patientId ?? '');
  const [pq, setPq] = useState('');
  const [f, setF] = useState({
    regionId: record?.regionId ?? presetRegion ?? '', conditionId: record?.conditionId ?? presetCondition ?? '', side: (record?.side ?? '') as string,
    severity: record?.severity ?? 2, problem: record?.problem ?? '', diagnosis: record?.diagnosis ?? '', notes: record?.notes ?? '', appointmentId: record?.appointmentId ?? '',
  });
  const set = <K extends keyof typeof f>(k: K, v: (typeof f)[K]) => setF((x) => ({ ...x, [k]: v }));
  const region = BODY_REGIONS.find((r) => r.id === f.regionId);
  const matches = !pid && pq.trim() ? db.searchPatients(pq).slice(0, 5) : [];
  const appts = pid ? db.appointmentsForPatient(pid).slice(0, 15) : [];

  const submit = async () => {
    setBusy(true);
    const found = f.conditionId ? findCondition(f.conditionId) : undefined;
    const r = await db.saveBodyRecord({
      id: record?.id, patientId: pid, regionId: f.regionId, conditionId: f.conditionId || null, side: (f.side || null) as BodyRecord['side'], severity: f.severity,
      problem: f.problem || (found?.condition.name ?? ''), diagnosis: f.diagnosis || (found?.condition.en ?? ''), notes: f.notes, appointmentId: f.appointmentId || null, sessionId: record?.sessionId ?? null,
    });
    setBusy(false);
    if (!r.ok) { toast.error(r.error); return; }
    toast.success('تم حفظ البيانات بنجاح.');
    onSaved?.(); onClose();
  };

  return (
    <Modal title={record ? 'تعديل سجل الجسم' : 'تسجيل حالة على الجسم'} wide onClose={onClose} footer={<><Button variant="outline" onClick={onClose} disabled={busy}>إلغاء</Button><Button icon="check" onClick={submit} loading={busy}>حفظ</Button></>}>
      <div className="field">
        <label>المريض *</label>
        {pid ? (
          <div className="choice selected"><span style={{ flex: 1 }}><strong>{db.patient(pid)?.fullName}</strong> <span className="num muted">{db.patient(pid)?.fileNo}</span></span>
            {!patientId && !record && <button type="button" className="link-more" style={{ border: 0, background: 'none', cursor: 'pointer' }} onClick={() => { setPid(''); setPq(''); }}>تغيير</button>}</div>
        ) : (
          <>
            <input className="input" placeholder="ابحث بالاسم أو الجوال أو رقم الملف" value={pq} onChange={(e) => setPq(e.target.value)} />
            {matches.length > 0 && <div className="choice-grid" style={{ marginTop: 8 }}>{matches.map((p) => <button key={p.id} type="button" className="choice" onClick={() => setPid(p.id)}><span><strong>{p.fullName}</strong><span className="num"> {p.fileNo}</span></span></button>)}</div>}
          </>
        )}
      </div>
      <div className="grid-form">
        <Select id="br-region" label="المنطقة المتأثرة *" value={f.regionId} onChange={(e) => setF((x) => ({ ...x, regionId: e.target.value, conditionId: '', side: '' }))} options={[{ value: '', label: 'اختر المنطقة' }, ...BODY_REGIONS.map((r) => ({ value: r.id, label: r.name }))]} />
        <Select id="br-cond" label="الحالة (من المرجع المعتمد)" value={f.conditionId} disabled={!region} onChange={(e) => set('conditionId', e.target.value)} options={[{ value: '', label: 'غير محددة' }, ...(region?.conditions ?? []).map((c) => ({ value: c.id, label: `${c.name} — ${c.en}` }))]} />
        {region?.sided && <Select id="br-side" label="الجهة" value={f.side} onChange={(e) => set('side', e.target.value)} options={[{ value: '', label: 'غير محددة' }, ...Object.entries(SIDE_LABEL).map(([value, label]) => ({ value, label }))]} />}
        <Select id="br-sev" label="درجة الحالة *" value={String(f.severity)} onChange={(e) => set('severity', Number(e.target.value))} options={SEVERITY.map((label, i) => ({ value: String(i + 1), label }))} />
        <Input id="br-problem" label="المشكلة" placeholder="مثال: ألم عند رفع الذراع" value={f.problem} onChange={(e) => set('problem', e.target.value)} />
        <Input id="br-dx" label="التشخيص" dir="ltr" value={f.diagnosis} onChange={(e) => set('diagnosis', e.target.value)} />
        <Select id="br-appt" label="ربط بزيارة (اختياري)" value={f.appointmentId} disabled={!pid} onChange={(e) => set('appointmentId', e.target.value)}
          options={[{ value: '', label: 'بدون' }, ...appts.map((a) => ({ value: a.id, label: `${a.no} — ${fmtDate(a.date)}` }))]} />
      </div>
      <div className="field"><label htmlFor="br-notes">ملاحظات</label><textarea id="br-notes" className="input" rows={3} value={f.notes} onChange={(e) => set('notes', e.target.value)} /></div>
    </Modal>
  );
}

// ============ تبويب سجل الجسم في ملف المريض ============
export function BodyRecordsTab({ patientId }: { patientId: string }) {
  const can = useCan();
  const toast = useToast();
  const [rows, setRows] = useState<BodyRecord[] | null>(null);
  const [err, setErr] = useState('');
  const [modal, setModal] = useState<BodyRecord | 'new' | null>(null);
  const [del, setDel] = useState<BodyRecord | null>(null);
  const load = () => db.bodyRecords(patientId).then((r) => { setRows(r); setErr(''); }).catch((e) => setErr(e.message));
  useEffect(() => { load(); }, [patientId]);

  return (
    <div>
      {can('plans', 'create') && <div style={{ marginBottom: 12 }}><Button size="sm" icon="body" onClick={() => setModal('new')}>تسجيل حالة على الجسم</Button></div>}
      {err ? <EmptyState icon="alert" title="حدث خطأ، حاول مرة ثانية" text={err} /> : rows === null ? <Skeleton h={90} /> : rows.length === 0 ? <EmptyState icon="body" title="ما فيه سجلات جسم" text="سجّل المنطقة المتأثرة والتشخيص ودرجة الحالة لكل زيارة." /> : (
        <div className="table-wrap"><table className="table">
          <thead><tr><th>التاريخ</th><th>المنطقة</th><th>المشكلة / التشخيص</th><th>الدرجة</th><th>الطبيب</th><th className="actions"></th></tr></thead>
          <tbody>{rows.map((r) => (
            <tr key={r.id}><td>{fmtDate(tsToYmd(r.createdAt))}</td>
              <td>{BODY_REGIONS.find((x) => x.id === r.regionId)?.name ?? r.regionId}{r.side ? ` — ${SIDE_LABEL[r.side]}` : ''}</td>
              <td>{r.problem}<div className="muted-sm" dir="ltr">{r.diagnosis}</div>{r.notes && <div className="muted-sm">{r.notes}</div>}</td>
              <td><span className={`badge badge--${SEV_TONE[r.severity - 1]}`}>{SEVERITY[r.severity - 1]}</span></td>
              <td>{db.therapist(r.therapistId ?? '')?.name ?? '—'}</td>
              <td className="actions"><RowActions>
                {can('plans', 'edit') && <IconAction icon="edit" label="تعديل" onClick={() => setModal(r)} />}
                {can('plans', 'delete') && <IconAction icon="trash" label="حذف" danger onClick={() => setDel(r)} />}
              </RowActions></td></tr>
          ))}</tbody>
        </table></div>
      )}
      {modal && <BodyRecordModal patientId={patientId} record={modal === 'new' ? undefined : modal} onClose={() => setModal(null)} onSaved={load} />}
      {del && <ConfirmDialog title="حذف السجل" message="سيتم حذف سجل الجسم هذا نهائيًا." onClose={() => setDel(null)} onConfirm={async () => { const r = await db.deleteBodyRecord(del.id); if (r.ok) { toast.success('تم الحذف.'); load(); } else toast.error(r.error); }} />}
    </div>
  );
}

// ============ تبويب الملفات والمرفقات ============
const fmtSize = (n: number) => (n > 1048576 ? (n / 1048576).toFixed(1) + ' م.ب' : Math.max(1, Math.round(n / 1024)) + ' ك.ب');

export function PatientFilesTab({ patientId }: { patientId: string }) {
  const can = useCan();
  const toast = useToast();
  const [files, setFiles] = useState<PatientFile[] | null>(null);
  const [err, setErr] = useState('');
  const [uploading, setUploading] = useState(false);
  const [note, setNote] = useState('');
  const [del, setDel] = useState<PatientFile | null>(null);
  const input = useRef<HTMLInputElement>(null);
  const camera = useRef<HTMLInputElement>(null);
  const load = () => db.patientFiles(patientId).then((r) => { setFiles(r); setErr(''); }).catch((e) => setErr(e.message));
  useEffect(() => { load(); }, [patientId]);

  const upload = async (file: File | undefined) => {
    if (!file) return;
    setUploading(true);
    const r = await db.uploadPatientFile(patientId, file, note);
    setUploading(false);
    if (input.current) input.current.value = '';
    if (camera.current) camera.current.value = '';
    if (!r.ok) { toast.error(r.error); return; }
    toast.success('تم رفع الملف بنجاح.'); setNote(''); load();
  };
  const [preview, setPreview] = useState<PatientFile | null>(null);
  const { openPlan, openVisit } = useDetails();
  const open = (f: PatientFile) => setPreview(f);

  return (
    <div>
      {can('patients', 'edit') && (
        <div className="grid-form" style={{ alignItems: 'end', marginBottom: 14 }}>
          <Input id="pf-note" label="ملاحظة على الملف (اختياري)" value={note} onChange={(e) => setNote(e.target.value)} />
          <div className="field" style={{ display: 'flex', flexDirection: 'row', gap: 8 }}>
            <input ref={input} type="file" hidden accept=".pdf,.png,.jpg,.jpeg,.webp,.doc,.docx,.txt" onChange={(e) => upload(e.target.files?.[0])} />
            <input ref={camera} type="file" hidden accept="image/*" capture="environment" onChange={(e) => upload(e.target.files?.[0])} />
            <Button icon="doc" loading={uploading} onClick={() => input.current?.click()}>رفع ملف محفوظ</Button>
            <Button variant="outline" icon="camera" loading={uploading} onClick={() => camera.current?.click()}>التقاط صورة الحين</Button>
          </div>
        </div>
      )}
      {err ? <EmptyState icon="alert" title="حدث خطأ، حاول مرة ثانية" text={err} /> : files === null ? <Skeleton h={90} /> : files.length === 0 ? <EmptyState icon="doc" title="ما فيه ملفات" text="ارفع التقارير والصور والمستندات الخاصة بالمريض." /> : (
        <div className="table-wrap"><table className="table">
          <thead><tr><th>الملف</th><th>الحجم</th><th>رفعه</th><th>التاريخ</th><th className="actions"></th></tr></thead>
          <tbody>{files.map((f) => (
            <tr key={f.id}><td style={{ fontWeight: 600 }}>{f.fileName}{f.note && <div className="muted-sm">{f.note}</div>}{f.planId && db.plan(f.planId) && <button type="button" className="muted-sm" style={{ border: 0, background: 'none', color: 'var(--brand-700)', cursor: 'pointer', padding: 0, display: 'block' }} onClick={() => openPlan(f.planId!)}>الخطة: {db.plan(f.planId)?.diagnosis}</button>}</td><td className="num">{fmtSize(f.sizeBytes)}</td><td>{f.uploadedByName || '—'}</td><td className="num">{fmtDateTime(f.createdAt)}</td>
              <td className="actions"><RowActions><Button size="sm" variant="outline" onClick={() => open(f)}>عرض</Button>{can('patients', 'edit') && <IconAction icon="trash" label="حذف الملف" danger onClick={() => setDel(f)} />}</RowActions></td></tr>
          ))}</tbody>
        </table></div>
      )}
      {preview && <FilePreviewModal file={preview} onClose={() => setPreview(null)} />}
      {del && <ConfirmDialog title="حذف الملف" message={`سيتم حذف «${del.fileName}» نهائيًا.`} onClose={() => setDel(null)} onConfirm={async () => { const r = await db.deletePatientFile(del); if (r.ok) { toast.success('تم حذف الملف.'); load(); } else toast.error(r.error); }} />}
    </div>
  );
}
