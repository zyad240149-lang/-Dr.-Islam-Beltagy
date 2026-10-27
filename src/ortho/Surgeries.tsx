import { useState } from 'react';
import { Link } from 'react-router-dom';
import { Button, EmptyState, Modal } from '../components/ui';
import { fmtDate, todayYmd } from '../utils/format';
import { ORTHO_PROCEDURES, REGIONS, SIDE, SURGERY_STATUS, addDays, daysBetween, ortho, useOrthoVersion, type Side, type Surgery, type SurgeryStatus } from './data';
import { Field, IconBtn, LoadState, PageHead, PatientSelect, PillTabs, Tone, confirmDelete, patientFile, patientName, useClinicalCan, useRun } from './kit';

export function SurgeryModal({ initial, patientId = '', onClose }: { initial?: Surgery; patientId?: string; onClose: () => void }) {
  const { run, busy } = useRun();
  const [s, setS] = useState<Omit<Surgery, 'id'> & { id?: string }>(initial ?? { patientId, procedure: '', region: REGIONS[0], side: 'right', hospital: '', date: addDays(todayYmd(), 7), implant: '', status: 'planned', notes: '' });
  const set = <K extends keyof Surgery>(k: K, v: Surgery[K]) => setS((x) => ({ ...x, [k]: v }));
  return (
    <Modal wide title={initial ? 'تعديل العملية' : 'عملية جديدة'} onClose={onClose} footer={<>
      <Button variant="outline" onClick={onClose}>إلغاء</Button>
      <Button icon="check" loading={busy} disabled={!s.patientId || !s.procedure.trim()} onClick={() => run(() => ortho.save('surgeries', s), 'تم حفظ العملية', onClose)}>حفظ</Button>
    </>}>
      <div className="grid-form grid-form--3">
        <Field label="المريض" className="span-2"><PatientSelect value={s.patientId} onChange={(v) => set('patientId', v)} /></Field>
        <Field label="اسم العملية" className="span-2">
          <input className="input" list="ortho-procedures" value={s.procedure} onChange={(e) => set('procedure', e.target.value)} placeholder="مثال: تغيير مفصل ركبة كامل" />
          <datalist id="ortho-procedures">{ORTHO_PROCEDURES.map((p) => <option key={p} value={p} />)}</datalist>
        </Field>
        <Field label="المنطقة">
          <select className="input" value={s.region} onChange={(e) => set('region', e.target.value)}>{[...new Set([...REGIONS, s.region])].map((r) => <option key={r}>{r}</option>)}</select>
        </Field>
        <Field label="الجهة">
          <select className="input" value={s.side} onChange={(e) => set('side', e.target.value as Side)}>{Object.entries(SIDE).map(([k, v]) => <option key={k} value={k}>{v}</option>)}</select>
        </Field>
        <Field label="الحالة">
          <select className="input" value={s.status} onChange={(e) => set('status', e.target.value as SurgeryStatus)}>{Object.entries(SURGERY_STATUS).map(([k, v]) => <option key={k} value={k}>{v.label}</option>)}</select>
        </Field>
        <Field label="المستشفى"><input className="input" value={s.hospital} onChange={(e) => set('hospital', e.target.value)} /></Field>
        <Field label="التاريخ"><input type="date" className="input" value={s.date} onChange={(e) => set('date', e.target.value)} /></Field>
        <Field label="المثبتات / المفصل"><input className="input" value={s.implant} onChange={(e) => set('implant', e.target.value)} placeholder="شرائح، مسامير، مفصل…" /></Field>
        <Field label="ملاحظات" className="span-2"><textarea className="input" rows={2} value={s.notes} onChange={(e) => set('notes', e.target.value)} /></Field>
      </div>
    </Modal>
  );
}

export function SurgeryCards({ items, onEdit }: { items: Surgery[]; onEdit: (s: Surgery) => void }) {
  const { run } = useRun();
  const perm = useClinicalCan();
  const t = todayYmd();
  if (!items.length) return <EmptyState icon="scalpel" title="لا توجد عمليات" />;
  return (
    <div className="case-grid">
      {items.map((s) => {
        const left = daysBetween(t, s.date);
        const tone = s.status === 'done' ? 'ok' : s.status === 'postponed' ? 'warn' : '';
        return (
          <div className={`card case-card ${tone ? `case-card--${tone}` : ''}`} key={s.id}>
            <div className="ortho-row" style={{ alignItems: 'flex-start' }}>
              <Link to={`/patients/${s.patientId}`} className="case-card__who"><strong>{patientName(s.patientId)}</strong><span>ملف {patientFile(s.patientId)}</span></Link>
              <Tone s={SURGERY_STATUS[s.status]} />
            </div>
            <h3 style={{ fontSize: 16.5 }}>{s.procedure}</h3>
            <dl className="facts">
              <div><dt>المنطقة</dt><dd>{s.region} — {SIDE[s.side]}</dd></div>
              <div><dt>المستشفى</dt><dd>{s.hospital || '—'}</dd></div>
              <div><dt>التاريخ</dt><dd>{fmtDate(s.date)}</dd></div>
              <div><dt>المثبتات</dt><dd>{s.implant || '—'}</dd></div>
            </dl>
            <div className="case-card__foot">
              {s.status === 'scheduled' && left >= 0 && <span className="badge badge--brand">{left === 0 ? 'اليوم' : `بعد ${left} يوم`}</span>}
              {s.status === 'done' && left < 0 && <span className="muted" style={{ fontSize: 14 }}>اليوم {-left} بعد العملية</span>}
              <div style={{ flex: 1 }} />
              {perm.edit && s.status !== 'done' && (
                <Button icon="check" onClick={() => run(() => ortho.save('surgeries', { ...s, status: 'done' }), 'تم إتمام العملية')}>إتمام العملية</Button>
              )}
              {perm.edit && <IconBtn icon="edit" label="تعديل" onClick={() => onEdit(s)} />}
              {perm.del && <IconBtn icon="trash" label="حذف" danger onClick={() => confirmDelete('هذه العملية') && run(() => ortho.remove('surgeries', s.id), 'تم الحذف')} />}
            </div>
          </div>
        );
      })}
    </div>
  );
}

export default function Surgeries() {
  useOrthoVersion();
  const perm = useClinicalCan();
  const [tab, setTab] = useState<SurgeryStatus | 'all'>('all');
  const [edit, setEdit] = useState<Surgery | 'new' | null>(null);
  const all = ortho.list('surgeries').sort((a, b) => a.date.localeCompare(b.date));
  const list = tab === 'all' ? all : all.filter((s) => s.status === tab);
  return (
    <div className="page">
      <PageHead title="العمليات الجراحية" sub="جدول العمليات والمستشفيات والمثبتات المستخدمة">
        {perm.add && <Button icon="plus" onClick={() => setEdit('new')}>عملية جديدة</Button>}
      </PageHead>
      <PillTabs value={tab} onChange={setTab} tabs={[{ id: 'all' as const, label: 'الكل', n: all.length }, ...(Object.keys(SURGERY_STATUS) as SurgeryStatus[]).map((x) => ({ id: x, label: SURGERY_STATUS[x].label, n: all.filter((s) => s.status === x).length }))]} />
      <LoadState kind="surgeries"><SurgeryCards items={list} onEdit={setEdit} /></LoadState>
      {edit && <SurgeryModal initial={edit === 'new' ? undefined : edit} onClose={() => setEdit(null)} />}
    </div>
  );
}
