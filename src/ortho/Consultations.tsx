import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { Button, EmptyState, Modal } from '../components/ui';
import { DiagnosisPicker } from '../components/DiagnosisPicker';
import { Icon } from '../utils/icons';
import { findCondition } from '../data/bodyRegions';
import type { DiagnosisRef } from '../types';
import { fmtDate, todayYmd } from '../utils/format';
import { REGIONS, SIDE, ortho, useOrthoVersion, type Consultation, type Side } from './data';
import { Field, IconBtn, LoadState, PageHead, PatientSelect, SearchBox, confirmDelete, patientName, useClinicalCan, useRun } from './kit';

// مسودة كشف لم يُحفظ بعد (استكمال التشخيص لو المستخدم خرج قبل ما يحفظ) — مخزنة محليًا لكل مريض
const DRAFT_PREFIX = 'dx_draft_';
const draftKey = (patientId: string) => DRAFT_PREFIX + patientId;
export function loadConsultDraft(patientId: string): (Omit<Consultation, 'id'> & { id?: string }) | null {
  if (!patientId) return null;
  try { const raw = localStorage.getItem(draftKey(patientId)); return raw ? JSON.parse(raw) : null; } catch { return null; }
}
function saveConsultDraft(patientId: string, data: Omit<Consultation, 'id'> & { id?: string }) {
  try { localStorage.setItem(draftKey(patientId), JSON.stringify(data)); } catch { /* تخزين محلي غير متاح */ }
}
export function clearConsultDraft(patientId: string) {
  try { localStorage.removeItem(draftKey(patientId)); } catch { /* تخزين محلي غير متاح */ }
}
function draftHasContent(c: Omit<Consultation, 'id'> & { id?: string }) {
  return !!(c.complaint.trim() || c.examination.trim() || c.diagnosis.trim() || c.plan.trim());
}

export function ConsultModal({ initial, preset, patientId = '', onClose }: { initial?: Consultation; preset?: Partial<Consultation>; patientId?: string; onClose: () => void }) {
  const { run, busy } = useRun();
  const draft = !initial ? loadConsultDraft(patientId) : null;
  const [c, setC] = useState<Omit<Consultation, 'id'> & { id?: string }>(initial ?? draft ?? { patientId, date: todayYmd(), complaint: '', region: REGIONS[0], side: 'right', examination: '', diagnosis: '', plan: '', ...preset });
  const [mapOpen, setMapOpen] = useState(false);
  const set = <K extends keyof Consultation>(k: K, v: Consultation[K]) => setC((x) => ({ ...x, [k]: v }));
  const ok = c.patientId && c.complaint.trim() && c.diagnosis.trim();

  // كشف جديد (مش تعديل كشف محفوظ): نحفظ مسودة محليًا أول بأول عشان لو المستخدم خرج من غير ما يحفظ، يقدر يستكمل بعدين
  useEffect(() => {
    if (initial || !c.patientId) return;
    if (draftHasContent(c)) saveConsultDraft(c.patientId, c); else clearConsultDraft(c.patientId);
  }, [initial, c]);

  return (
    <Modal wide title={initial ? 'تعديل الكشف' : 'كشف جديد'} onClose={onClose} footer={<>
      <Button variant="outline" onClick={onClose}>إلغاء</Button>
      <Button icon="check" loading={busy} disabled={!ok} onClick={() => run(() => ortho.save('consultations', c), 'تم حفظ الكشف', () => { if (!initial) clearConsultDraft(c.patientId); onClose(); })}>حفظ الكشف</Button>
    </>}>
      <div className="grid-form grid-form--3">
        <Field label="المريض" className="span-2"><PatientSelect value={c.patientId} onChange={(v) => set('patientId', v)} /></Field>
        <Field label="التاريخ"><input type="date" className="input" value={c.date} onChange={(e) => set('date', e.target.value)} /></Field>
        <Field label="المنطقة المصابة">
          <select className="input" value={c.region} onChange={(e) => set('region', e.target.value)}>{(REGIONS.includes(c.region) ? REGIONS : [c.region, ...REGIONS]).map((r) => <option key={r}>{r}</option>)}</select>
        </Field>
        <Field label="الجهة">
          <select className="input" value={c.side} onChange={(e) => set('side', e.target.value as Side)}>{Object.entries(SIDE).map(([k, v]) => <option key={k} value={k}>{v}</option>)}</select>
        </Field>
        <Field label="الشكوى الرئيسية" className="span-2"><textarea className="input" rows={2} value={c.complaint} onChange={(e) => set('complaint', e.target.value)} /></Field>
        <Field label="الفحص الإكلينيكي" className="span-2"><textarea className="input" rows={2} value={c.examination} onChange={(e) => set('examination', e.target.value)} /></Field>
        <Field label="التشخيص" className="span-2 dx-field">
          <input className="input" value={c.diagnosis} onChange={(e) => set('diagnosis', e.target.value)} />
          <button type="button" className="dx-open" onClick={() => setMapOpen(true)}><Icon name="body" size={15} /> اختيار من خريطة الجسم</button>
        </Field>
        <Field label="ملاحظات الطبيب" className="span-2"><textarea className="input" rows={2} value={c.plan} onChange={(e) => set('plan', e.target.value)} /></Field>
      </div>
      {mapOpen && <DiagnosisPicker onClose={() => setMapOpen(false)} onPick={(text, ref) => { setC((x) => ({ ...x, ...pickedToConsult(text, ref) })); setMapOpen(false); }} />}
      <div>
      </div>
    </Modal>
  );
}

// نتيجة خريطة الجسم (مرجع مركز التميز) ← حقول الكشف: التشخيص + كود ICD-10 + المنطقة + الجهة
export function pickedToConsult(text: string, ref: DiagnosisRef): Partial<Consultation> {
  const f = findCondition(ref.conditionId);
  const ar = f ? ' — ' + f.condition.name.replace(/\s*\(تأهيل\)/, '') : '';
  return { diagnosis: `${text} (${ref.icd10})${ar}`, ...(f ? { region: f.region.name } : {}), side: (ref.side ?? 'na') as Side };
}

export function ConsultList({ items, onEdit, hidePatient }: { items: Consultation[]; onEdit: (c: Consultation) => void; hidePatient?: boolean }) {
  const { run } = useRun();
  const perm = useClinicalCan();
  if (!items.length) return <EmptyState icon="stethoscope" title="لا توجد كشوفات" />;
  return (
    <>
      {items.map((c) => (
        <div className="item-card" key={c.id}>
          <div className="ortho-row">
            <div>
              {!hidePatient && <Link to={`/patients/${c.patientId}`} className="ortho-cell-strong">{patientName(c.patientId)}</Link>}
              <div className="ortho-sub">{fmtDate(c.date)} · {c.region} — {SIDE[c.side]}</div>
            </div>
            <div style={{ display: 'flex', gap: 6 }}>
              {perm.edit && <IconBtn icon="edit" label="تعديل" onClick={() => onEdit(c)} />}
              {perm.del && <IconBtn icon="trash" label="حذف" danger onClick={() => confirmDelete('هذا الكشف') && run(() => ortho.remove('consultations', c.id), 'تم الحذف')} />}
            </div>
          </div>
          <dl className="dl" style={{ marginTop: 6 }}>
            <div><dt>الشكوى</dt><dd>{c.complaint}</dd></div>
            <div><dt>التشخيص</dt><dd style={{ color: 'var(--brand-700)' }}>{c.diagnosis}</dd></div>
            <div><dt>الفحص</dt><dd>{c.examination || '—'}</dd></div>
            <div><dt>ملاحظات الطبيب</dt><dd>{c.plan || '—'}</dd></div>
          </dl>
        </div>
      ))}
    </>
  );
}

export default function Consultations() {
  useOrthoVersion();
  const perm = useClinicalCan();
  const [q, setQ] = useState('');
  const [edit, setEdit] = useState<Consultation | 'new' | null>(null);
  const term = q.trim();
  const list = ortho.list('consultations').sort((a, b) => b.date.localeCompare(a.date))
    .filter((c) => !term || c.diagnosis.includes(term) || c.region.includes(term) || patientName(c.patientId).includes(term));
  return (
    <div className="page">
      <PageHead title="الكشوفات والتشخيص" sub="سجل الكشوفات الإكلينيكية والتشخيصات">
        {perm.add && <Button icon="plus" onClick={() => setEdit('new')}>كشف جديد</Button>}
      </PageHead>
      <section className="card">
        <div className="filter-bar"><div className="field"><SearchBox value={q} onChange={setQ} placeholder="ابحث بالمريض أو التشخيص أو المنطقة" /></div></div>
        <div className="card__body"><LoadState kind="consultations"><ConsultList items={list} onEdit={setEdit} /></LoadState></div>
      </section>
      {edit && <ConsultModal initial={edit === 'new' ? undefined : edit} onClose={() => setEdit(null)} />}
    </div>
  );
}
