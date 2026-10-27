import { useEffect, useRef, useState, type ReactNode } from 'react';
import { Link } from 'react-router-dom';
import { Button, EmptyState, Modal } from '../components/ui';
import { DiagnosisPicker } from '../components/DiagnosisPicker';
import { Icon } from '../utils/icons';
import { findCondition } from '../data/bodyRegions';
import type { DiagnosisRef } from '../types';
import { fmtDate, todayYmd } from '../utils/format';
import { useToast } from '../hooks/useToast';
import { IMAGING_KIND, REGIONS, SIDE, ortho, useOrthoVersion, type Attachment, type Consultation, type ImagingKind, type ImagingRequest, type Medication, type Side } from './data';
import { LAB_GROUPS, MED_PRESETS, XRAY_VIEWS } from './clinicalLists';
import { printRx } from './printRx';
import { Field, IconBtn, LoadState, PageHead, PatientSelect, SearchBox, confirmDelete, patientName, useClinicalCan, useRun } from './kit';

type Draft = Omit<Consultation, 'id'> & { id?: string };

const emptyConsult = (patientId: string): Draft => ({
  patientId, date: todayYmd(), complaint: '', history: '', painScore: '', region: REGIONS[0], side: 'right', examination: '',
  diagnosis: '', icd10: '', plan: '', medications: [], labs: [], imagingRequests: [], attachments: [], followUp: '',
});
const emptyMed = (): Medication => ({ name: '', dose: '', frequency: '', duration: '', notes: '' });

// مسودة كشف لم يُحفظ بعد (استكمال التشخيص لو المستخدم خرج قبل ما يحفظ) — مخزنة محليًا لكل مريض
const DRAFT_PREFIX = 'dx_draft_';
const draftKey = (patientId: string) => DRAFT_PREFIX + patientId;
export function loadConsultDraft(patientId: string): Draft | null {
  if (!patientId) return null;
  try {
    const raw = localStorage.getItem(draftKey(patientId));
    return raw ? { ...emptyConsult(patientId), ...JSON.parse(raw) } : null;
  } catch { return null; }
}
function saveConsultDraft(patientId: string, data: Draft) {
  try { localStorage.setItem(draftKey(patientId), JSON.stringify(data)); } catch { /* تخزين محلي غير متاح */ }
}
export function clearConsultDraft(patientId: string) {
  try { localStorage.removeItem(draftKey(patientId)); } catch { /* تخزين محلي غير متاح */ }
}
function draftHasContent(c: Draft) {
  return !!(c.complaint.trim() || c.history.trim() || c.examination.trim() || c.diagnosis.trim() || c.plan.trim()
    || c.medications.length || c.labs.length || c.imagingRequests.length || c.attachments.length);
}

const EXAM_FINDINGS = ['Tenderness', 'Swelling', 'Limited ROM', 'Deformity', 'Crepitus', 'Muscle spasm', 'Effusion', 'Instability', 'Neurovascular intact', 'Distal pulses +ve', 'SLR +ve', 'McMurray +ve', 'Lachman +ve'];
const reqKey = (r: ImagingRequest) => `${r.kind}|${r.region.trim()}|${r.view.trim()}`;

function Section({ icon, title, children, aside }: { icon: string; title: string; children: ReactNode; aside?: ReactNode }) {
  return (
    <section className="cx-sec">
      <div className="cx-sec__head"><Icon name={icon} size={17} /><h3>{title}</h3>{aside && <div className="cx-sec__aside">{aside}</div>}</div>
      {children}
    </section>
  );
}

export function ConsultModal({ initial, preset, resume, patientId = '', onClose }: { initial?: Consultation; preset?: Partial<Consultation>; resume?: boolean; patientId?: string; onClose: () => void }) {
  const { run, busy } = useRun();
  const toast = useToast();
  const [c, setC] = useState<Draft>(() => {
    if (initial) return { ...emptyConsult(initial.patientId), ...initial };
    return (resume && loadConsultDraft(patientId)) || { ...emptyConsult(patientId), ...preset };
  });
  const [mapOpen, setMapOpen] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [labQ, setLabQ] = useState('');
  const fileRef = useRef<HTMLInputElement>(null);
  const set = <K extends keyof Draft>(k: K, v: Draft[K]) => setC((x) => ({ ...x, [k]: v }));
  const ok = c.patientId && c.complaint.trim() && c.diagnosis.trim();

  // كشف جديد (مش تعديل كشف محفوظ): نحفظ مسودة محليًا أول بأول عشان لو المستخدم خرج من غير ما يحفظ، يقدر يستكمل بعدين
  useEffect(() => {
    if (initial || !c.patientId) return;
    if (draftHasContent(c)) saveConsultDraft(c.patientId, c); else clearConsultDraft(c.patientId);
  }, [initial, c]);

  const setMed = (i: number, patch: Partial<Medication>) => set('medications', c.medications.map((m, j) => (j === i ? { ...m, ...patch } : m)));
  const pickMedName = (i: number, name: string) => {
    const p = MED_PRESETS.find((x) => x.name === name);
    const cur = c.medications[i];
    setMed(i, p ? { name, dose: cur.dose || p.dose, frequency: cur.frequency || p.frequency, duration: cur.duration || p.duration } : { name });
  };
  const toggleLab = (name: string) => set('labs', c.labs.includes(name) ? c.labs.filter((l) => l !== name) : [...c.labs, name]);
  const addCustomLab = () => { const v = labQ.trim(); if (v && !c.labs.includes(v)) set('labs', [...c.labs, v]); setLabQ(''); };
  const setReq = (i: number, patch: Partial<ImagingRequest>) => set('imagingRequests', c.imagingRequests.map((r, j) => (j === i ? { ...r, ...patch } : r)));
  const addExam = (t: string) => set('examination', c.examination.trim() ? `${c.examination.trimEnd()}, ${t}` : t);

  async function upload(files: FileList | null) {
    if (!files?.length || !c.patientId) return;
    setUploading(true);
    try {
      const added: Attachment[] = [];
      for (const f of Array.from(files)) added.push(await ortho.uploadAttachment(c.patientId, f));
      setC((x) => ({ ...x, attachments: [...x.attachments, ...added] }));
      toast.success(added.length > 1 ? `تم رفع ${added.length} ملفات` : 'تم رفع الأشعة');
    } catch (e) { toast.error((e as Error).message); }
    finally { setUploading(false); if (fileRef.current) fileRef.current.value = ''; }
  }

  // إلغاء تعديل كشف محفوظ: الملفات اللي اترفعت في الجلسة دي ومش هتتحفظ بتتمسح (الكشف الجديد بيفضل محتفظ بيها في المسودة)
  function cancel() {
    if (initial) {
      const keep = new Set(initial.attachments.map((a) => a.path));
      c.attachments.filter((a) => !keep.has(a.path)).forEach((a) => void ortho.removeAttachment(a.path));
    }
    onClose();
  }

  function save(thenPrint: boolean) {
    const meds = c.medications.filter((m) => m.name.trim());
    const reqs = c.imagingRequests.filter((r) => r.region.trim());
    const payload = { ...c, medications: meds, imagingRequests: reqs, painScore: c.painScore === '' ? null : c.painScore, followUp: c.followUp || null } as unknown as Draft;
    run(async () => {
      await ortho.save('consultations', payload);
      // طلبات الأشعة الجديدة بتتسجل في «الأشعة والتحاليل» كـ «مطلوبة» عشان تتابع وصولها وقراءتها
      const before = new Set((initial?.imagingRequests ?? []).map(reqKey));
      for (const r of reqs.filter((x) => !before.has(reqKey(x)))) {
        await ortho.save('imaging', { patientId: c.patientId, kind: r.kind, region: r.view ? `${r.region} — ${r.view}` : r.region, requestedAt: c.date, status: 'requested', finding: '' });
      }
      if (initial) {
        const now = new Set(c.attachments.map((a) => a.path));
        initial.attachments.filter((a) => !now.has(a.path)).forEach((a) => void ortho.removeAttachment(a.path));
      }
    }, 'تم حفظ الكشف', () => {
      if (!initial) clearConsultDraft(c.patientId);
      if (thenPrint) printRx({ ...c, medications: meds, imagingRequests: reqs });
      onClose();
    });
  }

  return (
    <Modal xl title={initial ? 'تعديل الكشف' : 'كشف جديد'} onClose={cancel} footer={<>
      <Button variant="outline" onClick={cancel}>إلغاء</Button>
      <Button variant="outline" icon="print" loading={busy} disabled={!ok || uploading} onClick={() => save(true)}>حفظ وطباعة الروشتة</Button>
      <Button icon="check" loading={busy} disabled={!ok || uploading} onClick={() => save(false)}>حفظ الكشف</Button>
    </>}>
      <div className="cx">
        <div className="grid-form grid-form--3">
          <Field label="المريض"><PatientSelect value={c.patientId} onChange={(v) => set('patientId', v)} /></Field>
          <Field label="تاريخ الكشف"><input type="date" className="input" value={c.date} onChange={(e) => set('date', e.target.value)} /></Field>
          <Field label="ميعاد المتابعة"><input type="date" className="input" value={c.followUp} min={c.date} onChange={(e) => set('followUp', e.target.value)} /></Field>
        </div>

        <Section icon="clipboard" title="الشكوى والتاريخ المرضي">
          <div className="grid-form">
            <Field label="الشكوى الرئيسية *" className="span-2"><textarea className="input" rows={2} placeholder="مثال: ألم في الركبة اليمين من 3 أسابيع يزيد مع طلوع السلم" value={c.complaint} onChange={(e) => set('complaint', e.target.value)} /></Field>
            <Field label="التاريخ المرضي وآلية الإصابة" className="span-2"><textarea className="input" rows={2} placeholder="آلية الإصابة، أمراض مزمنة (سكر/ضغط)، عمليات سابقة، حساسية من أدوية" value={c.history} onChange={(e) => set('history', e.target.value)} /></Field>
          </div>
          <div className="field">
            <label>درجة الألم (VAS) {c.painScore !== '' && <b className="cx-pain-val">{c.painScore}/10</b>}</label>
            <div className="cx-pain" role="radiogroup" aria-label="درجة الألم">
              {Array.from({ length: 11 }, (_, n) => (
                <button key={n} type="button" role="radio" aria-checked={c.painScore === n} className={`cx-pain__b cx-pain__b--${n <= 3 ? 'lo' : n <= 6 ? 'mid' : 'hi'} ${c.painScore === n ? 'is-on' : ''}`}
                  onClick={() => set('painScore', c.painScore === n ? '' : n)}>{n}</button>
              ))}
            </div>
          </div>
        </Section>

        <Section icon="stethoscope" title="الفحص الإكلينيكي">
          <div className="grid-form">
            <Field label="المنطقة المصابة">
              <select className="input" value={c.region} onChange={(e) => set('region', e.target.value)}>{(REGIONS.includes(c.region) ? REGIONS : [c.region, ...REGIONS]).map((r) => <option key={r}>{r}</option>)}</select>
            </Field>
            <Field label="الجهة">
              <select className="input" value={c.side} onChange={(e) => set('side', e.target.value as Side)}>{Object.entries(SIDE).map(([k, v]) => <option key={k} value={k}>{v}</option>)}</select>
            </Field>
            <Field label="نتيجة الفحص" className="span-2">
              <textarea className="input" rows={2} dir="auto" value={c.examination} onChange={(e) => set('examination', e.target.value)} />
              <div className="cx-chips">{EXAM_FINDINGS.map((t) => <button key={t} type="button" className="cx-chip" dir="ltr" onClick={() => addExam(t)}>+ {t}</button>)}</div>
            </Field>
          </div>
        </Section>

        <Section icon="scan" title="الأشعة" aside={<>
          <Button size="sm" variant="outline" icon="plus" onClick={() => set('imagingRequests', [...c.imagingRequests, { kind: 'xray', region: c.region, view: 'AP & Lateral' }])}>طلب أشعة</Button>
          <Button size="sm" variant="outline" icon="camera" loading={uploading} disabled={!c.patientId} onClick={() => fileRef.current?.click()}>رفع صورة أشعة</Button>
          <input ref={fileRef} type="file" hidden multiple accept="image/png,image/jpeg,image/webp,application/pdf" onChange={(e) => void upload(e.target.files)} />
        </>}>
          {c.imagingRequests.length > 0 && (
            <div className="cx-rows">
              {c.imagingRequests.map((r, i) => (
                <div className="cx-row cx-row--img" key={i}>
                  <select className="input" aria-label="نوع الأشعة" value={r.kind} onChange={(e) => setReq(i, { kind: e.target.value as ImagingKind })}>{Object.entries(IMAGING_KIND).map(([k, v]) => <option key={k} value={k}>{v}</option>)}</select>
                  <input className="input" aria-label="المنطقة" placeholder="المنطقة" value={r.region} onChange={(e) => setReq(i, { region: e.target.value })} />
                  <input className="input" aria-label="الوضع" placeholder="الوضع (View)" dir="ltr" list="cx-views" value={r.view} onChange={(e) => setReq(i, { view: e.target.value })} />
                  <IconBtn icon="trash" label="حذف الطلب" danger onClick={() => set('imagingRequests', c.imagingRequests.filter((_, j) => j !== i))} />
                </div>
              ))}
              <datalist id="cx-views">{XRAY_VIEWS.map((v) => <option key={v} value={v} />)}</datalist>
            </div>
          )}
          {c.attachments.length > 0
            ? <AttachmentThumbs items={c.attachments} onRemove={(path) => set('attachments', c.attachments.filter((a) => a.path !== path))} />
            : c.imagingRequests.length === 0 && <p className="cx-empty">اطلب أشعة للمريض أو ارفع صورة الأشعة اللي معاه (صورة أو PDF، لحد 10 ميجا).</p>}
        </Section>

        <Section icon="target" title="التشخيص">
          <div className="grid-form">
            <Field label="التشخيص *" className="span-2 dx-field">
              <input className="input" dir="auto" value={c.diagnosis} onChange={(e) => set('diagnosis', e.target.value)} />
              <button type="button" className="dx-open" onClick={() => setMapOpen(true)}><Icon name="body" size={15} /> اختيار من خريطة الجسم</button>
            </Field>
            <Field label="كود ICD-10"><input className="input" dir="ltr" placeholder="M17.1" value={c.icd10} onChange={(e) => set('icd10', e.target.value.toUpperCase())} /></Field>
          </div>
        </Section>

        <Section icon="receipt" title="العلاج — الروشتة" aside={<Button size="sm" variant="outline" icon="plus" onClick={() => set('medications', [...c.medications, emptyMed()])}>إضافة دواء</Button>}>
          {c.medications.length === 0
            ? <p className="cx-empty">مفيش أدوية لسه — اضغط «إضافة دواء» واكتب اسم الدواء (فيه اقتراحات بالجرعات المعتادة).</p>
            : (
              <div className="cx-rows">
                {c.medications.map((m, i) => (
                  <div className="cx-row cx-row--med" key={i}>
                    <span className="cx-row__n">{i + 1}</span>
                    <input className="input" dir="ltr" aria-label="اسم الدواء" placeholder="اسم الدواء" list="cx-meds" value={m.name} onChange={(e) => pickMedName(i, e.target.value)} />
                    <input className="input" aria-label="الجرعة" placeholder="الجرعة" value={m.dose} onChange={(e) => setMed(i, { dose: e.target.value })} />
                    <input className="input" aria-label="عدد المرات" placeholder="عدد المرات" value={m.frequency} onChange={(e) => setMed(i, { frequency: e.target.value })} />
                    <input className="input" aria-label="المدة" placeholder="المدة" value={m.duration} onChange={(e) => setMed(i, { duration: e.target.value })} />
                    <input className="input" aria-label="ملاحظة" placeholder="ملاحظة" value={m.notes} onChange={(e) => setMed(i, { notes: e.target.value })} />
                    <IconBtn icon="trash" label="حذف الدواء" danger onClick={() => set('medications', c.medications.filter((_, j) => j !== i))} />
                  </div>
                ))}
              </div>
            )}
          <datalist id="cx-meds">{MED_PRESETS.map((p) => <option key={p.name} value={p.name}>{p.group}</option>)}</datalist>
        </Section>

        <Section icon="list" title={`التحاليل${c.labs.length ? ` (${c.labs.length})` : ''}`}>
          {LAB_GROUPS.map((g) => (
            <div className="cx-labgrp" key={g.group}>
              <span className="cx-labgrp__t">{g.group}</span>
              <div className="cx-chips">{g.items.map((l) => <button key={l} type="button" dir="ltr" aria-pressed={c.labs.includes(l)} className={`cx-chip ${c.labs.includes(l) ? 'is-on' : ''}`} onClick={() => toggleLab(l)}>{l}</button>)}</div>
            </div>
          ))}
          <div className="cx-labadd">
            <input className="input" dir="auto" placeholder="تحليل تاني…" value={labQ} onChange={(e) => setLabQ(e.target.value)} onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); addCustomLab(); } }} />
            <Button size="sm" variant="outline" icon="plus" disabled={!labQ.trim()} onClick={addCustomLab}>إضافة</Button>
          </div>
          {c.labs.filter((l) => !LAB_GROUPS.some((g) => g.items.includes(l))).length > 0 && (
            <div className="cx-chips">{c.labs.filter((l) => !LAB_GROUPS.some((g) => g.items.includes(l))).map((l) => <button key={l} type="button" className="cx-chip is-on" onClick={() => toggleLab(l)}>{l} ✕</button>)}</div>
          )}
        </Section>

        <Section icon="doc" title="التعليمات وملاحظات الطبيب">
          <textarea className="input" rows={3} placeholder="مثال: راحة وتجنب طلوع السلم، كمادات تلج 15 دقيقة 3 مرات يوميًا، جلسات علاج طبيعي، رباط ضاغط…" value={c.plan} onChange={(e) => set('plan', e.target.value)} />
        </Section>
      </div>
      {mapOpen && <DiagnosisPicker onClose={() => setMapOpen(false)} onPick={(text, ref) => { setC((x) => ({ ...x, ...pickedToConsult(text, ref) })); setMapOpen(false); }} />}
    </Modal>
  );
}

// صور الأشعة المرفقة: روابط موقّعة مؤقتة (الـ bucket خاص)
function AttachmentThumbs({ items, onRemove }: { items: Attachment[]; onRemove?: (path: string) => void }) {
  const [urls, setUrls] = useState<Record<string, string | null>>({});
  const key = items.map((a) => a.path).join('|');
  useEffect(() => {
    let alive = true;
    Promise.all(items.map(async (a) => [a.path, await ortho.attachmentUrl(a.path)] as const)).then((pairs) => { if (alive) setUrls(Object.fromEntries(pairs)); });
    return () => { alive = false; };
  }, [key]); // eslint-disable-line react-hooks/exhaustive-deps
  return (
    <div className="cx-thumbs">
      {items.map((a) => {
        const url = urls[a.path];
        const img = a.type.startsWith('image/');
        return (
          <div className="cx-thumb" key={a.path}>
            <a href={url ?? undefined} target="_blank" rel="noreferrer" aria-disabled={!url} title={a.name}>
              {img && url ? <img src={url} alt={a.name} loading="lazy" /> : <span className="cx-thumb__doc"><Icon name="doc" size={26} />{url === null ? 'غير متاح' : 'PDF'}</span>}
            </a>
            <span className="cx-thumb__name">{a.name}</span>
            {onRemove && <button type="button" className="cx-thumb__x" aria-label={`حذف ${a.name}`} onClick={() => onRemove(a.path)}><Icon name="close" size={14} /></button>}
          </div>
        );
      })}
    </div>
  );
}

// نتيجة خريطة الجسم (مرجع مركز التميز) ← حقول الكشف: التشخيص + كود ICD-10 + المنطقة + الجهة
export function pickedToConsult(text: string, ref: DiagnosisRef): Partial<Consultation> {
  const f = findCondition(ref.conditionId);
  const ar = f ? ' — ' + f.condition.name.replace(/\s*\(تأهيل\)/, '') : '';
  return { diagnosis: `${text}${ar}`, icd10: ref.icd10 ?? '', ...(f ? { region: f.region.name } : {}), side: (ref.side ?? 'na') as Side };
}

export function ConsultList({ items, onEdit, hidePatient }: { items: Consultation[]; onEdit: (c: Consultation) => void; hidePatient?: boolean }) {
  const { run } = useRun();
  const perm = useClinicalCan();
  if (!items.length) return <EmptyState icon="stethoscope" title="لا توجد كشوفات" />;
  return (
    <>
      {items.map((c) => {
        const meds = c.medications ?? [], labs = c.labs ?? [], reqs = c.imagingRequests ?? [], atts = c.attachments ?? [];
        return (
          <div className="item-card cx-card" key={c.id}>
            <div className="ortho-row">
              <div>
                {!hidePatient && <Link to={`/patients/${c.patientId}`} className="ortho-cell-strong">{patientName(c.patientId)}</Link>}
                <div className="ortho-sub">{fmtDate(c.date)} · {c.region} — {SIDE[c.side]}{c.painScore !== '' && c.painScore != null ? ` · الألم ${c.painScore}/10` : ''}</div>
              </div>
              <div style={{ display: 'flex', gap: 6 }}>
                <IconBtn icon="print" label="طباعة الروشتة" onClick={() => printRx(c)} />
                {perm.edit && <IconBtn icon="edit" label="تعديل" onClick={() => onEdit(c)} />}
                {perm.del && <IconBtn icon="trash" label="حذف" danger onClick={() => confirmDelete('هذا الكشف') && run(async () => { await ortho.remove('consultations', c.id); atts.forEach((a) => void ortho.removeAttachment(a.path)); }, 'تم الحذف')} />}
              </div>
            </div>
            <div className="cx-dx">
              <span className="cx-dx__l">التشخيص</span>
              <b>{c.diagnosis}</b>{c.icd10 && <span className="badge badge--brand" dir="ltr">{c.icd10}</span>}
            </div>
            <dl className="dl" style={{ marginTop: 6 }}>
              <div><dt>الشكوى</dt><dd>{c.complaint}</dd></div>
              {c.history && <div><dt>التاريخ المرضي</dt><dd>{c.history}</dd></div>}
              <div><dt>الفحص</dt><dd dir="auto">{c.examination || '—'}</dd></div>
              {meds.length > 0 && <div><dt>الأدوية</dt><dd><ol className="cx-medlist">{meds.map((m, i) => <li key={i}><b dir="ltr">{m.name}</b> <span className="muted">{[m.dose, m.frequency, m.duration].filter(Boolean).join(' — ')}</span></li>)}</ol></dd></div>}
              {labs.length > 0 && <div><dt>التحاليل</dt><dd dir="ltr" style={{ textAlign: 'start' }}>{labs.join(' • ')}</dd></div>}
              {reqs.length > 0 && <div><dt>أشعة مطلوبة</dt><dd>{reqs.map((r) => `${IMAGING_KIND[r.kind]} — ${r.region}${r.view ? ` (${r.view})` : ''}`).join('، ')}</dd></div>}
              {c.plan && <div><dt>التعليمات</dt><dd style={{ whiteSpace: 'pre-line' }}>{c.plan}</dd></div>}
              {c.followUp && <div><dt>المتابعة</dt><dd>{fmtDate(c.followUp)}</dd></div>}
            </dl>
            {atts.length > 0 && <AttachmentThumbs items={atts} />}
          </div>
        );
      })}
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
    .filter((c) => !term || c.diagnosis.includes(term) || c.region.includes(term) || c.icd10?.toUpperCase().includes(term.toUpperCase()) || patientName(c.patientId).includes(term));
  return (
    <div className="page">
      <PageHead title="الكشوفات والتشخيص" sub="سجل الكشوفات الإكلينيكية والتشخيصات">
        {perm.add && <Button icon="plus" onClick={() => setEdit('new')}>كشف جديد</Button>}
      </PageHead>
      <section className="card">
        <div className="filter-bar"><div className="field"><SearchBox value={q} onChange={setQ} placeholder="ابحث بالمريض أو التشخيص أو المنطقة أو كود ICD-10" /></div></div>
        <div className="card__body"><LoadState kind="consultations"><ConsultList items={list} onEdit={setEdit} /></LoadState></div>
      </section>
      {edit && <ConsultModal initial={edit === 'new' ? undefined : edit} onClose={() => setEdit(null)} />}
    </div>
  );
}
