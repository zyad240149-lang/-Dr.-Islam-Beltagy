import { useEffect, useRef, useState, type ReactNode } from 'react';
import { Link } from 'react-router-dom';
import { Button, EmptyState, Modal } from '../components/ui';
import { DiagnosisPicker } from '../components/DiagnosisPicker';
import { regionById } from '../components/BodyFigure';
import { Icon } from '../utils/icons';
import { findCondition } from '../data/bodyRegions';
import type { DiagnosisRef } from '../types';
import { fmtDate, fmtDateTime, todayYmd } from '../utils/format';
import { useToast } from '../hooks/useToast';
import { IMAGING_KIND, IMAGING_STATUS, REGIONS, SIDE, ortho, useOrthoVersion, type Attachment, type Consultation, type ImagingKind, type ImagingRequest, type Medication, type Side } from './data';
import { LAB_GROUPS, MED_PRESETS, XRAY_VIEWS } from './clinicalLists';
import { printRx } from './printRx';
import { openPrintWindow } from '../utils/printDoc';
import { DiagnosisOutput } from './DiagnosisOutput';
import type { DxPart } from './printDiagnosis';
import { db } from '../data/db';
import { Field, IconBtn, LoadState, PageHead, PatientSelect, SearchBox, Tone, confirmDelete, patientFile, patientName, useClinicalCan, useRun } from './kit';
import { DoctorSheet, NursingSheet, doctorStarted, emptySheet, nurseStarted, normSheet, resetPatientBasics, sheetHasContent, sheetPatientPatch, sheetSummary, withPatientBasics } from './ExamSheet';

type Draft = Omit<Consultation, 'id'> & { id?: string };

const emptyConsult = (patientId: string): Draft => ({
  patientId, date: todayYmd(), complaint: '', history: '', painScore: '', region: REGIONS[0], side: 'na', examination: '',
  diagnosis: '', icd10: '', plan: '', medications: [], labs: [], imagingRequests: [], attachments: [], followUp: '', sheet: emptySheet(),
});
// كشف قديم (قبل الشيت) بيتفتح للتعديل: نصوصه بتتحط في خانات «Other» في الشيت عشان الملخص اللي بيتحفظ يفضل هو هو
function withSheet(c: Draft): Draft {
  const sheet = normSheet(c.sheet);
  if (sheetHasContent(sheet) || !(c.complaint || c.history || c.examination || c.diagnosis)) return { ...c, sheet };
  const txt: Record<string, string> = { 'x.cc.other': c.complaint, 'n.onset': c.history, 'x.notes': c.examination, 'x.dx.other': c.diagnosis };
  return { ...c, sheet: { ...sheet, txt } };
}
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
  try { localStorage.setItem(draftKey(patientId), JSON.stringify({ ...data, savedAt: Date.now() })); } catch { /* تخزين محلي غير متاح */ }
}
export type ConsultDraft = Draft & { savedAt: number };
/** كل الكشوفات اللي اتبدأت على الجهاز ده ولسه ما اتحفظتش — آخر تعديل أولًا */
export function listConsultDrafts(): ConsultDraft[] {
  const out: ConsultDraft[] = [];
  try {
    for (let i = 0; i < localStorage.length; i++) {
      const k = localStorage.key(i);
      if (!k?.startsWith(DRAFT_PREFIX)) continue;
      const d = loadConsultDraft(k.slice(DRAFT_PREFIX.length));
      if (d && draftHasContent(d)) out.push({ ...d, savedAt: Number((d as Partial<ConsultDraft>).savedAt) || 0 });
    }
  } catch { /* تخزين محلي غير متاح */ }
  return out.sort((a, b) => b.savedAt - a.savedAt);
}
export function clearConsultDraft(patientId: string) {
  try { localStorage.removeItem(draftKey(patientId)); } catch { /* تخزين محلي غير متاح */ }
}
function draftHasContent(c: Draft) {
  return !!(sheetHasContent(normSheet(c.sheet)) || c.painScore !== '' || c.plan.trim()
    || c.medications.length || c.labs.length || c.imagingRequests.length || c.attachments.length);
}

const reqKey = (r: ImagingRequest) => `${r.kind}|${r.region.trim()}|${r.view.trim()}`;

function Section({ icon, title, children, aside }: { icon: string; title: string; children: ReactNode; aside?: ReactNode }) {
  return (
    <section className="cx-sec">
      <div className="cx-sec__head"><Icon name={icon} size={17} /><h3>{title}</h3>{aside && <div className="cx-sec__aside">{aside}</div>}</div>
      {children}
    </section>
  );
}

// الكشف = الشيتين بالترتيب (التمريض قبل دخول المريض ← كشف الطبيب) وبعدهم الروشتة والأشعة والتحاليل
const TABS = [['nurse', 'شيت التمريض'], ['doctor', 'كشف الطبيب — الورك والركبة'], ['rx', 'الروشتة والأشعة والتحاليل']] as const;
type Tab = typeof TABS[number][0];

export function ConsultModal({ initial, resume, patientId = '', onClose }: { initial?: Consultation; resume?: boolean; patientId?: string; onClose: () => void }) {
  const { run, busy } = useRun();
  const toast = useToast();
  const [c, setC] = useState<Draft>(() => {
    const basics = (d: Draft) => ({ ...d, sheet: withPatientBasics(normSheet(d.sheet), d.patientId ? db.patient(d.patientId) : null) });
    if (initial) return basics(withSheet({ ...emptyConsult(initial.patientId), ...initial }));
    const draft = resume && loadConsultDraft(patientId);
    if (draft) return basics(withSheet(draft));
    // زيارة جديدة ولا متابعة: من الكشوفات السابقة للمريض
    const fresh = emptyConsult(patientId);
    const visit = patientId && ortho.list('consultations', patientId).length ? 'متابعة' : 'زيارة جديدة';
    return basics({ ...fresh, sheet: { ...emptySheet(), on: [`n.visit|${visit}`] } });
  });
  const [tab, setTab] = useState<Tab>(() => (initial || doctorStarted(normSheet(c.sheet)) ? 'doctor' : 'nurse'));
  // خانة 1 وقت الفتح — اللي يتعدّل بعدها بس يروح لملف المريض (لو المريض اتغيّر، الخانات اتملت من ملفه هو فبنقارن بالملف بس)
  const [opened] = useState(() => ({ patientId: c.patientId, sheet: normSheet(c.sheet) }));
  const [mapOpen, setMapOpen] = useState(false);
  const [out, setOut] = useState<DxPart[] | null>(null); // نافذة «طباعة وإرسال» بالأجزاء المختارة مبدئيًا
  const [uploading, setUploading] = useState(false);
  const [labQ, setLabQ] = useState('');
  const fileRef = useRef<HTMLInputElement>(null);
  const labFileRef = useRef<HTMLInputElement>(null);
  const bodyRef = useRef<HTMLDivElement>(null);
  const outstandingLabs = c.patientId ? ortho.list('imaging', c.patientId).filter((m) => m.kind === 'lab' && m.status !== 'reviewed') : [];
  const set = <K extends keyof Draft>(k: K, v: Draft[K]) => setC((x) => ({ ...x, [k]: v }));
  const sheet = normSheet(c.sheet);
  const changeSheet = (f: (s: typeof sheet) => typeof sheet) => setC((x) => ({ ...x, sheet: f(normSheet(x.sheet)) }));
  const sum = sheetSummary(sheet);
  const ok = c.patientId && sum.complaint && sum.diagnosis;
  const need = !c.patientId ? 'اختار المريض' : !sum.complaint ? 'حدد الشكوى (خانة 5 في شيت التمريض أو خانة 1 في كشف الطبيب)' : !sum.diagnosis ? 'حدد التشخيص (خانة 10 في كشف الطبيب)' : '';
  const patientConsults = c.patientId ? ortho.list('consultations', c.patientId).sort((a, b) => a.date.localeCompare(b.date)) : [];
  const visitNo = initial ? Math.max(1, patientConsults.findIndex((x) => x.id === initial.id) + 1) : patientConsults.length + 1;
  const goTab = (t: Tab) => { setTab(t); bodyRef.current?.closest('.modal__body')?.scrollTo({ top: 0 }); };

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
    // الملخص النصي من الشيت ← حقول الكشف (القوايم والروشتة وسجل المريض)
    const text = { complaint: sum.complaint, history: sum.history, examination: sum.examination, diagnosis: sum.diagnosis };
    const sheetOut = { ...sheet, meds: sheet.meds.filter((m) => m.name.trim()) };
    const payload = { ...c, ...text, sheet: sheetOut, medications: meds, imagingRequests: reqs, painScore: c.painScore === '' ? null : c.painScore, followUp: c.followUp || null } as unknown as Draft;
    // تابة الطباعة بتتفتح دلوقتي (وقت الضغطة) وإلا المتصفح يحجبها بعد انتظار الحفظ — ولو الحفظ فشل بتتقفل
    const printWin = thenPrint ? openPrintWindow() : null;
    let printed = false;
    void run(async () => {
      await ortho.save('consultations', payload);
      // طلبات الأشعة الجديدة بتتسجل في «الأشعة والتحاليل» كـ «مطلوبة» عشان تتابع وصولها وقراءتها
      const before = new Set((initial?.imagingRequests ?? []).map(reqKey));
      for (const r of reqs.filter((x) => !before.has(reqKey(x)))) {
        await ortho.save('imaging', { patientId: c.patientId, kind: r.kind, region: r.view ? `${r.region} — ${r.view}` : r.region, requestedAt: c.date, status: 'requested', finding: '', attachments: [] });
      }
      // التحاليل الجديدة كمان بتتسجل «مطلوبة» في نفس المكان (قسم «تحاليل مطلوبة») عشان ترفع نتيجتها لما توصل
      const beforeLabs = new Set(initial?.labs ?? []);
      for (const l of c.labs.filter((x) => !beforeLabs.has(x))) {
        await ortho.save('imaging', { patientId: c.patientId, kind: 'lab', region: l, requestedAt: c.date, status: 'requested', finding: '', attachments: [] });
      }
      if (initial) {
        const now = new Set(c.attachments.map((a) => a.path));
        initial.attachments.filter((a) => !now.has(a.path)).forEach((a) => void ortho.removeAttachment(a.path));
      }
    }, 'تم حفظ الكشف', () => {
      if (!initial) clearConsultDraft(c.patientId);
      // تعديلات خانة 1 (الاسم/السن/النوع/الهاتف/العنوان) ← ملف المريض — بعد ما الكشف اتحفظ، عشان فشلها مايكرّرش الكشف
      const p = db.patient(c.patientId);
      if (p) {
        const { patch, badPhone } = sheetPatientPatch(sheetOut, p, c.patientId === opened.patientId ? opened.sheet : undefined);
        if (badPhone) toast.error('رقم الهاتف في الشيت مش صحيح — ما اتحفظش في ملف المريض.');
        if (Object.keys(patch).length) void db.updatePatient(p.id, patch).catch((e) => toast.error(`الكشف اتحفظ، بس بيانات المريض ما اتحدّثتش: ${(e as Error).message}`));
      }
      if (thenPrint) { printed = true; printRx({ ...c, ...text, medications: meds, imagingRequests: reqs }, db.patient(c.patientId), printWin); }
      onClose();
    }).then(() => { if (!printed) printWin?.close(); });
  }

  return (
    <Modal xl title={initial ? 'تعديل الكشف' : 'كشف جديد'} onClose={cancel} footer={<>
      {need && <span className="sh-need">{need}</span>}
      <Button variant="outline" onClick={cancel}>إلغاء</Button>
      <Button variant="outline" icon="print" disabled={!c.patientId} onClick={() => setOut(['nurse', 'doctor', 'rx'])}>طباعة وإرسال</Button>
      <Button variant="outline" icon="print" loading={busy} disabled={!ok || uploading} onClick={() => save(true)}>حفظ وطباعة الروشتة</Button>
      <Button icon="check" loading={busy} disabled={!ok || uploading} onClick={() => save(false)}>حفظ الكشف</Button>
    </>}>
      <div className="cx" ref={bodyRef}>
        <div className="grid-form grid-form--4">
          <Field label="المريض"><PatientSelect value={c.patientId} onChange={(v) => setC((x) => ({ ...x, patientId: v, sheet: resetPatientBasics(normSheet(x.sheet), v ? db.patient(v) : null) }))} /></Field>
          <Field label="تاريخ الكشف"><input type="date" className="input" value={c.date} onChange={(e) => set('date', e.target.value)} /></Field>
          <Field label="المنطقة المصابة">
            <select className="input" value={c.region} onChange={(e) => set('region', e.target.value)}>{(REGIONS.includes(c.region) ? REGIONS : [c.region, ...REGIONS]).map((r) => <option key={r}>{r}</option>)}</select>
          </Field>
          <Field label="ميعاد المتابعة"><input type="date" className="input" value={c.followUp} min={c.date} onChange={(e) => set('followUp', e.target.value)} /></Field>
        </div>

        <div className="seg seg--3 sh-tabs" role="tablist" aria-label="أجزاء الكشف">
          {TABS.map(([k, l], i) => (
            <button key={k} type="button" role="tab" aria-selected={tab === k} className={`seg__btn ${tab === k ? 'active' : ''}`} onClick={() => goTab(k)}>
              <span className="sh-tabs__n num">{i + 1}</span>{l}
            </button>
          ))}
        </div>

        {tab === 'nurse' && <>
          <NursingSheet sheet={sheet} onChange={changeSheet} patient={c.patientId ? db.patient(c.patientId) : null} date={c.date} visitNo={visitNo}
            painScore={c.painScore} onPainScore={(v) => set('painScore', v)}
            onFirstPain={(id, side) => setC((x) => ({ ...x, region: regionById(id)?.name ?? x.region, ...(side ? { side } : {}) }))} />
          <div className="sh-next">
            <Button variant="outline" icon="print" disabled={!c.patientId} onClick={() => setOut(['nurse'])}>طباعة / إرسال شيت التمريض</Button>
            <Button icon="chevronLeft" onClick={() => goTab('doctor')}>التالي: كشف الطبيب</Button>
          </div>
        </>}

        {tab === 'doctor' && <>
          <DoctorSheet sheet={sheet} onChange={changeSheet} side={c.side} onSide={(v) => set('side', v)}
            icd10={c.icd10} onIcd10={(v) => set('icd10', v)} onOpenMap={() => setMapOpen(true)} />
          <div className="sh-next">
            <Button variant="outline" icon="print" disabled={!c.patientId} onClick={() => setOut(['doctor'])}>طباعة / إرسال كشف الطبيب</Button>
            <Button icon="chevronLeft" onClick={() => goTab('rx')}>التالي: الروشتة والأشعة والتحاليل</Button>
          </div>
        </>}

        {tab === 'rx' && <>
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

        <Section icon="list" title={`التحاليل${c.labs.length ? ` (${c.labs.length})` : ''}`} aside={<>
          <Button size="sm" variant="outline" icon="upload" loading={uploading} disabled={!c.patientId} onClick={() => labFileRef.current?.click()}>رفع تحاليل</Button>
          <input ref={labFileRef} type="file" hidden multiple accept="image/png,image/jpeg,image/webp,application/pdf" onChange={(e) => void upload(e.target.files)} />
        </>}>
          {outstandingLabs.length > 0 && (
            <div className="cx-labgrp">
              <span className="cx-labgrp__t">تحاليل مطلوبة سابقًا لسه مستنية نتيجة</span>
              <div className="cx-chips">{outstandingLabs.map((m) => <span key={m.id} className="cx-chip" dir="ltr">{m.region} <Tone s={IMAGING_STATUS[m.status]} /></span>)}</div>
            </div>
          )}
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
        <div className="sh-next"><Button variant="outline" icon="print" disabled={!c.patientId} onClick={() => setOut(['rx'])}>طباعة / إرسال الروشتة</Button></div>
        </>}
      </div>
      {out && <DiagnosisOutput initial={out} patient={db.patient(c.patientId)} visitNo={visitNo} onClose={() => setOut(null)}
        c={{ ...c, ...sum, plan: c.plan, sheet, medications: c.medications.filter((m) => m.name.trim()), imagingRequests: c.imagingRequests.filter((r) => r.region.trim()) }} />}
      {/* خريطة الجسم من خانة التشخيص (10): الحالة بتتضاف في «Others» + الكود والمنطقة والجهة */}
      {mapOpen && <DiagnosisPicker onClose={() => setMapOpen(false)} onPick={(text, ref) => {
        const p = pickedToConsult(text, ref);
        setC((x) => {
          const s = normSheet(x.sheet);
          const cur = (s.txt['x.dx.other'] ?? '').trim();
          const icd = [x.icd10.trim(), p.icd10 ?? ''].filter((v, i, all) => v && all.indexOf(v) === i).join(', ');
          return { ...x, icd10: cur ? icd : p.icd10 ?? '', region: p.region ?? x.region, side: ref.side ?? x.side,
            sheet: { ...s, txt: { ...s.txt, 'x.dx.other': cur ? `${cur} · ${p.diagnosis}` : p.diagnosis ?? '' } } };
        });
        setMapOpen(false);
      }} />}
    </Modal>
  );
}

// صور الأشعة المرفقة: روابط موقّعة مؤقتة (الـ bucket خاص)
export function AttachmentThumbs({ items, onRemove }: { items: Attachment[]; onRemove?: (path: string) => void }) {
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

// كشف بدأ ولسه ما اتحفظش: بيظهر في «تشخيص المريض» بالأجزاء اللي اتملت، وزرار يكمّله من مكان ما وقف
export function DraftCard({ d, onResume, onDiscard }: { d: ConsultDraft; onResume: () => void; onDiscard: () => void }) {
  const s = normSheet(d.sheet);
  const sum = sheetSummary(s);
  const steps: [string, boolean][] = [
    ['شيت التمريض', nurseStarted(s) || d.painScore !== ''],
    ['كشف الطبيب', doctorStarted(s)],
    ['الروشتة والأشعة والتحاليل', !!(d.medications.length || d.labs.length || d.imagingRequests.length || d.attachments.length || d.plan.trim())],
  ];
  return (
    <div className="item-card cx-card cx-draft">
      <div className="ortho-row">
        <div>
          <Link to={`/patients/${d.patientId}`} className="ortho-cell-strong">{patientName(d.patientId)}</Link>
          <span className="badge badge--brand" style={{ marginInlineStart: 8 }}>ملف <span className="num">{patientFile(d.patientId)}</span></span>
          <div className="ortho-sub"><span className="badge badge--warn">لم يكتمل</span> {fmtDate(d.date)}{d.savedAt ? ` · آخر تعديل ${fmtDateTime(d.savedAt)}` : ''}</div>
        </div>
        <div style={{ display: 'flex', gap: 6, alignItems: 'center' }}>
          <Button size="sm" icon="refresh" onClick={onResume}>استكمال التشخيص</Button>
          <IconBtn icon="trash" label="حذف التشخيص اللي لم يكتمل" danger onClick={onDiscard} />
        </div>
      </div>
      <div className="cx-draft__steps">
        {steps.map(([label, done], i) => <span key={label} className={`cx-draft__step ${done ? 'is-done' : ''}`}><b className="num">{i + 1}</b>{label} {done ? '✓' : '— لسه'}</span>)}
      </div>
      {(sum.complaint || sum.diagnosis) && (
        <dl className="dl" style={{ marginTop: 6 }}>
          {sum.complaint && <div><dt>الشكوى</dt><dd dir="auto">{sum.complaint}</dd></div>}
          {sum.diagnosis && <div><dt>التشخيص</dt><dd dir="auto">{sum.diagnosis}</dd></div>}
        </dl>
      )}
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
  const [out, setOut] = useState<Consultation | null>(null);
  if (!items.length) return <EmptyState icon="stethoscope" title="لا توجد كشوفات" />;
  return (
    <>
      {items.map((c) => {
        const meds = c.medications ?? [], labs = c.labs ?? [], reqs = c.imagingRequests ?? [], atts = c.attachments ?? [];
        const sheetPlan = sheetSummary(normSheet(c.sheet)).plan;
        return (
          <div className="item-card cx-card" key={c.id}>
            <div className="ortho-row">
              <div>
                {!hidePatient && <Link to={`/patients/${c.patientId}`} className="ortho-cell-strong">{patientName(c.patientId)}</Link>}
                <div className="ortho-sub">{fmtDate(c.date)} · {c.region} — {SIDE[c.side]}{c.painScore !== '' && c.painScore != null ? ` · الألم ${c.painScore}/10` : ''}</div>
              </div>
              <div style={{ display: 'flex', gap: 6, alignItems: 'center' }}>
                <Button size="sm" variant="outline" icon="print" onClick={() => setOut(c)}>طباعة وإرسال</Button>
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
              {c.history && <div><dt>التاريخ المرضي</dt><dd style={{ whiteSpace: 'pre-line' }}>{c.history}</dd></div>}
              <div><dt>الفحص</dt><dd dir="auto" style={{ whiteSpace: 'pre-line' }}>{c.examination || '—'}</dd></div>
              {sheetPlan && <div><dt>الخطة</dt><dd dir="ltr" style={{ textAlign: 'start' }}>{sheetPlan}</dd></div>}
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
      {out && (() => {
        const visits = ortho.list('consultations', out.patientId).sort((a, b) => a.date.localeCompare(b.date));
        return <DiagnosisOutput c={out} initial={['nurse', 'doctor', 'rx']} patient={db.patient(out.patientId)} visitNo={visits.findIndex((x) => x.id === out.id) + 1 || undefined} onClose={() => setOut(null)} />;
      })()}
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
