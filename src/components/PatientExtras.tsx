import { useDetails } from './DetailsHost';
import { FilePreviewModal } from './DetailsModals';
import { useEffect, useRef, useState } from 'react';
import { db } from '../data/db';
import { BODY_REGIONS, SIDE_LABEL, findCondition, mapRegions } from '../data/bodyRegions';
import { Button, EmptyState, Input, Modal, Select, Skeleton } from './ui';
import { ConfirmDialog, IconAction, RowActions, useCan } from './common';
import { useToast } from '../hooks/useToast';
import { usePatientFiles } from '../ortho/files';
import { fmtDate, fmtDateTime, todayYmd, tsToYmd } from '../utils/format';
import type { BodyRecord, PatientFile, PatientFileCategory } from '../types';

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
        <Select id="br-region" label="المنطقة المتأثرة *" value={f.regionId} onChange={(e) => setF((x) => ({ ...x, regionId: e.target.value, conditionId: '', side: '' }))} options={[{ value: '', label: 'اختر المنطقة' }, ...mapRegions().map((r) => ({ value: r.id, label: r.name }))]} />
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

export const FILE_CATEGORY: Record<PatientFileCategory, string> = { xray: 'أشعة / سونار', lab: 'تحاليل', other: 'ملف آخر' };
const CAT_TONE: Record<PatientFileCategory, string> = { xray: 'brand', lab: 'info', other: 'muted' };
export const fileTitle = (f: PatientFile) => f.title || f.fileName;

// رفع الأشعة والتحاليل من الاستقبال (أو أي حد عنده صلاحية تعديل المريض): الملف بيتحفظ في Supabase Storage (bucket خاص patient-files)
// ومربوط بمعرّف المريض — وبيظهر للطبيب في كل تشخيص جديد للمريض ده (PatientMedicalFiles) من غير ما يترفع تاني
/** مربع «رفع أشعة أو تحاليل» — في تبويب الملفات وفوق تفاصيل الزيارة (appointmentId = الملف بيتربط بالزيارة كمان) */
export function FileUploadBox({ patientId, appointmentId }: { patientId: string; appointmentId?: string | null }) {
  const can = useCan();
  const toast = useToast();
  const [uploading, setUploading] = useState(false);
  const [meta, setMeta] = useState({ category: 'xray' as PatientFileCategory, title: '', fileDate: todayYmd(), note: '' });
  const input = useRef<HTMLInputElement>(null);
  const camera = useRef<HTMLInputElement>(null);
  const upload = async (list: FileList | null) => {
    const all = Array.from(list ?? []);
    if (!all.length) return;
    setUploading(true);
    let ok = 0, queued = 0; const failed: string[] = [];
    for (const [i, file] of all.entries()) {
      // أكتر من ملف بنفس الاسم: رقم بعد الاسم عشان يتفرقوا
      const title = meta.title.trim() ? (all.length > 1 ? `${meta.title.trim()} (${i + 1})` : meta.title.trim()) : '';
      const r = await db.uploadPatientFile(patientId, file, meta.note, { appointmentId: appointmentId ?? null }, { category: meta.category, title, fileDate: meta.fileDate });
      if (r.ok) { ok++; if (r.queued) queued++; } else failed.push(`${file.name}: ${r.error}`);
    }
    setUploading(false);
    if (input.current) input.current.value = '';
    if (camera.current) camera.current.value = '';
    if (failed.length) toast.error(failed.join(' — '));
    if (queued) toast.info(`مفيش إنترنت — ${queued > 1 ? `${queued} ملفات اتحفظوا` : 'الملف اتحفظ'} على الجهاز وهيترفع لوحده لما الاتصال يرجع.`);
    if (ok - queued > 0) toast.success(ok - queued > 1 ? `تم رفع ${ok - queued} ملفات.` : 'تم رفع الملف بنجاح.');
    if (ok) setMeta((m) => ({ ...m, title: '', note: '' }));
  };
  if (!can('patients', 'edit')) return null;
  return (
    <div className="pf-upload">
          <div className="pf-upload__title">رفع أشعة أو تحاليل</div>
          <div className="seg" style={{ maxWidth: 420, marginBottom: 10 }} role="radiogroup" aria-label="نوع الملف">
            {(Object.keys(FILE_CATEGORY) as PatientFileCategory[]).map((c) => (
              <button key={c} type="button" role="radio" aria-checked={meta.category === c} className={`seg__btn ${meta.category === c ? 'active' : ''}`} onClick={() => setMeta((m) => ({ ...m, category: c }))}>{FILE_CATEGORY[c]}</button>
            ))}
          </div>
          <div className="grid-form" style={{ alignItems: 'end' }}>
            <Input id="pf-title" label="اسم / وصف الملف" placeholder={meta.category === 'lab' ? 'مثلاً: صورة دم كاملة' : meta.category === 'xray' ? 'مثلاً: سونار على الكتف الشمال أو أشعة على الركبة اليمين' : ''} value={meta.title} onChange={(e) => setMeta((m) => ({ ...m, title: e.target.value }))} />
            <Input id="pf-date" label="تاريخ الأشعة / التحليل" type="date" max={todayYmd()} value={meta.fileDate} onChange={(e) => setMeta((m) => ({ ...m, fileDate: e.target.value }))} />
            <Input id="pf-note" label="ملاحظات (اختياري)" value={meta.note} onChange={(e) => setMeta((m) => ({ ...m, note: e.target.value }))} />
          </div>
          <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', marginTop: 10 }}>
            <input ref={input} type="file" hidden multiple accept=".pdf,.png,.jpg,.jpeg,.webp,.doc,.docx,.txt" onChange={(e) => void upload(e.target.files)} />
            <input ref={camera} type="file" hidden accept="image/*" capture="environment" onChange={(e) => void upload(e.target.files)} />
            <Button icon="upload" loading={uploading} onClick={() => input.current?.click()}>رفع ملفات (صور أو PDF)</Button>
            <Button variant="outline" icon="camera" loading={uploading} onClick={() => camera.current?.click()}>تصوير بالكاميرا</Button>
            <span className="muted-sm" style={{ alignSelf: 'center' }}>صور JPG/PNG/WEBP أو PDF — لحد 10 ميجا للملف. من غير إنترنت الملف بيتحفظ على الجهاز ويترفع لوحده بعدين.</span>
          </div>
        </div>
  );
}

export function PatientFilesTab({ patientId }: { patientId: string }) {
  const can = useCan();
  const toast = useToast();
  // من نسخة الجهاز + الطابور: بتفتح من غير إنترنت، وبتتحدّث لوحدها لما حد تاني يرفع ملف (Realtime)
  const live = usePatientFiles(patientId);
  const files: PatientFile[] | null = live.loading ? null : live.files;
  const err = live.error ?? '';
  const [show, setShow] = useState<PatientFileCategory | ''>('');
  const [del, setDel] = useState<PatientFile | null>(null);
  const [preview, setPreview] = useState<PatientFile | null>(null);
  const { openPlan } = useDetails();
  const shown = (files ?? []).filter((f) => !show || f.category === show);
  const count = (c: PatientFileCategory) => (files ?? []).filter((f) => f.category === c).length;

  return (
    <div>
      <FileUploadBox patientId={patientId} />
      {files && files.length > 0 && (
        <div className="cx-chips" style={{ margin: '4px 0 12px' }}>
          <button type="button" className={`cx-chip ${!show ? 'is-on' : ''}`} onClick={() => setShow('')}>الكل <span className="num">{files.length}</span></button>
          {(Object.keys(FILE_CATEGORY) as PatientFileCategory[]).map((c) => count(c) > 0 && (
            <button key={c} type="button" className={`cx-chip ${show === c ? 'is-on' : ''}`} onClick={() => setShow(c)}>{FILE_CATEGORY[c]} <span className="num">{count(c)}</span></button>
          ))}
        </div>
      )}
      {err ? <EmptyState icon="alert" title="حدث خطأ، حاول مرة ثانية" text={err} /> : files === null ? <Skeleton h={90} /> : files.length === 0 ? <EmptyState icon="doc" title="ما فيه ملفات" text="ارفع صور الأشعة ونتايج التحاليل الخاصة بالمريض — هتظهر للطبيب في التشخيص." /> : (
        <div className="table-wrap"><table className="table">
          <thead><tr><th>الملف</th><th>النوع</th><th>تاريخ الملف</th><th>رفعه</th><th>تاريخ الرفع</th><th className="actions"></th></tr></thead>
          <tbody>{shown.map((f) => (
            <tr key={f.id}><td style={{ fontWeight: 600 }}>{fileTitle(f)}{f.pendingSync && <span className={`badge badge--${f.syncError ? 'danger' : 'warn'}`} style={{ marginInlineStart: 6 }} title={f.syncError || ''}>{f.syncError ? 'فشل الرفع' : 'بانتظار الرفع'}</span>}{f.title && <div className="muted-sm">{f.fileName} · {fmtSize(f.sizeBytes)}</div>}{f.note && <div className="muted-sm">{f.note}</div>}{f.planId && db.plan(f.planId) && <button type="button" className="muted-sm" style={{ border: 0, background: 'none', color: 'var(--brand-700)', cursor: 'pointer', padding: 0, display: 'block' }} onClick={() => openPlan(f.planId!)}>الخطة: {db.plan(f.planId)?.diagnosis}</button>}</td>
              <td><span className={`badge badge--${CAT_TONE[f.category]}`}>{FILE_CATEGORY[f.category]}</span></td>
              <td className="num date">{f.fileDate ? fmtDate(f.fileDate) : '—'}</td><td>{f.uploadedByName || '—'}</td><td className="num date">{fmtDateTime(f.createdAt)}</td>
              <td className="actions"><RowActions><Button size="sm" variant="outline" onClick={() => setPreview(f)}>عرض</Button><IconAction icon="download" label="تنزيل الملف" onClick={() => void downloadFile(f)} />{can('patients', 'edit') && <IconAction icon="trash" label="حذف الملف" danger onClick={() => setDel(f)} />}</RowActions></td></tr>
          ))}</tbody>
        </table></div>
      )}
      {preview && <FilePreviewModal file={preview} onClose={() => setPreview(null)} />}
      {del && <ConfirmDialog title="حذف الملف" message={`سيتم حذف «${fileTitle(del)}» نهائيًا — وهيختفي من التشخيص كمان.`} onClose={() => setDel(null)} onConfirm={async () => { const r = await db.deletePatientFile(del); if (r.ok) toast.success('تم حذف الملف.'); else toast.error(r.error); }} />}
    </div>
  );
}

/** تنزيل الملف باسمه الأصلي (رابط موقّع مؤقت — الـ bucket خاص) */
export async function downloadFile(f: PatientFile) {
  if (f.localUrl) { const a = document.createElement('a'); a.href = f.localUrl; a.download = f.fileName; a.click(); return; }
  const url = await db.fileUrl(f.filePath, f.fileName);
  if (url) window.open(url, '_blank', 'noopener');
}
