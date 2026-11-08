import { useEffect, useRef, useState, type ReactNode } from 'react';
import { net } from '../offline/net';
import { Link } from 'react-router-dom';
import { Button, EmptyState, Modal } from '../components/ui';
import { DiagnosisPicker } from '../components/DiagnosisPicker';
import { regionById } from '../components/BodyFigure';
import { Icon } from '../utils/icons';
import { findCondition } from '../data/bodyRegions';
import type { DiagnosisRef } from '../types';
import { fmtDate, fmtDateTime, fmtTime, todayYmd, waPhone, whatsappNumber } from '../utils/format';
import { openVisitFor } from './visits';
import { SHEET_ORDER, SHEET_TAB, TREATMENT, activeSheets, regionSheet, removeSheet, sheetFilled, type SheetId } from './regionSheets';
import { US_SHEETS, usFilled, usImage } from './ultrasoundSheets';
import { VoiceDictation } from '../components/VoiceDictation';
import { RegionSheetForm, SheetSwitch } from './RegionSheet';
import { useToast } from '../hooks/useToast';
import { IMAGING_KIND, IMAGING_STATUS, REGIONS, SIDE, isIncomplete, isUnlinked, ortho, useOrthoVersion, type Attachment, type Consultation, type Injection, type ImagingKind, type ImagingRequest, type Medication, type Side } from './data';
import { printRx } from './printRx';
import { openPrintWindow, printHtml } from '../utils/printDoc';
import { RequestForms } from './RequestForms';
import { applyRequestForms, deliverRequestImage, labOthers, prepareRequestImage, readyRequestImage, requestHtml } from './requestData';
import { DiagnosisOutput } from './DiagnosisOutput';
import { InjectionList, InjectionModal } from './Injections';
import { PatientMedicalFiles } from './PatientMedicalFiles';
import { RxEditor } from './Rx';
import type { RxData } from './data';
import { FollowUpStep, FollowUpsOfConsult, savePendingFollowUps, useFuCan, type FuDraft } from './FollowUps';
import type { DxPart } from './printDiagnosis';
import { db } from '../data/db';
import { Field, IconBtn, LoadState, PageHead, PatientSelect, SearchBox, Tone, confirmDelete, patientFile, patientName, useClinicalCan, useRun } from './kit';
import { DoctorSheet, NursingSheet, doctorStarted, emptySheet, nurseStarted, normSheet, isTripleName, pendingFromSheet, traumaShown, resetPatientBasics, sheetHasContent, sheetPatientPatch, sheetSummary, withPatientBasics } from './ExamSheet';

// pendingFollowUps: مواعيد متابعة اتحددت في الكشف ولسه ما اتحفظتش (بتتحفظ بعد حفظ التشخيص — مش عمود في الجدول)
type Draft = Omit<Consultation, 'id'> & { id?: string; pendingFollowUps?: FuDraft[] };

const emptyConsult = (patientId: string): Draft => ({
  patientId, date: todayYmd(), complaint: '', history: '', painScore: '', region: REGIONS[0], side: 'na', examination: '',
  diagnosis: '', icd10: '', plan: '', medications: [], labs: [], imagingRequests: [], attachments: [], followUp: '', sheet: emptySheet(), visitReason: '',
});
// كشف قديم (قبل الشيت) بيتفتح للتعديل: نصوصه بتتحط في خانات «Other» في الشيت عشان الملخص اللي بيتحفظ يفضل هو هو
function withSheet(c: Draft): Draft {
  const sheet = normSheet(c.sheet);
  if (sheetHasContent(sheet) || !(c.complaint || c.history || c.examination || c.diagnosis)) return { ...c, sheet };
  const txt: Record<string, string> = { 'x.cc.other': c.complaint, 'n.onset': c.history, 'x.notes': c.examination, 'x.dx.other': c.diagnosis };
  return { ...c, sheet: { ...sheet, txt } };
}

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
  return !!(sheetHasContent(normSheet(c.sheet)) || c.painScore !== '' || c.plan.trim() || c.visitReason?.trim()
    || c.medications.length || c.labs.length || c.imagingRequests.length || c.attachments.length || c.pendingFollowUps?.length);
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

// الكشف = الشيتين بالترتيب (التمريض قبل دخول المريض ← كشف الطبيب) وبعدهم الحقن — الروشتة والأشعة والتحاليل اتنقلت لشيت المتابعة
// «كشف الطبيب» بيتسمى بالمنطقة: شيت الطبيب بيتحدد من مكان الألم في الشيت العام (regionSheets)
const TABS = [['nurse', 'الشيت العام'], ['doctor', 'كشف الطبيب'], ['fu', 'متابعة الجبس والعمليات'], ['files', 'الأشعة والتحاليل'], ['inj', 'الحقن'], ['plan', 'الخطة العلاجية']] as const;
type Tab = typeof TABS[number][0];
// متابعة الجبس وما بعد العمليات: قسم لوحده (طلب ٨/١١) — باقي الشيتات في «كشف الطبيب»
const FU_SHEETS: SheetId[] = ['cast', 'postop'];

// appointmentId = الزيارة اللي التشخيص الجديد بيتربط بيها (من «بانتظار التشخيص»)؛ من غيرها بيتربط بزيارة النهارده المفتوحة للمريض لو فيه
// pending = «فتح ملف تشخيص جديد» بالاسم الثلاثي (المريض مش ظاهر في القايمة — غالبًا من غير إنترنت): التشخيص بيتحفظ من غير ملف،
// والخادم بيربطه بملف الاستقبال بعد المزامنة (هجرة 924)
// تطبيع الاسم العربي للمقارنة (همزات/تاء مربوطة/ياء/تشكيل/مسافات)
const normName = (n: string) => n.replace(/[ً-ْـ]/g, '').replace(/[أإآ]/g, 'ا').replace(/ة/g, 'ه').replace(/ى/g, 'ي').trim().replace(/\s+/g, ' ');
const phoneKey = (p?: string) => (p ?? '').replace(/[٠-٩]/g, (d) => String('٠١٢٣٤٥٦٧٨٩'.indexOf(d))).replace(/\D/g, '').slice(-10);
function matchPatient(name: string, phone?: string) {
  const all = [...db.patients(), ...db.guests()];
  const n = normName(name);
  if (isTripleName(n)) {
    const byName = all.filter((p) => normName(p.fullName ?? '') === n);
    if (byName.length === 1) return byName[0];
    if (byName.length > 1) { const ph = phoneKey(phone); const both = ph.length >= 9 ? byName.filter((p) => phoneKey(p.phone) === ph) : []; return both.length === 1 ? both[0] : undefined; }
  }
  const ph = phoneKey(phone);
  if (ph.length >= 9) { const byPhone = all.filter((p) => phoneKey(p.phone) === ph); if (byPhone.length === 1) return byPhone[0]; }
  return undefined;
}

export function ConsultModal({ initial, resume, patientId = '', appointmentId, pending, onClose }: { initial?: Consultation; resume?: boolean; patientId?: string; appointmentId?: string | null; pending?: { name: string; phone?: string }; onClose: () => void }) {
  const { run, busy } = useRun();
  const toast = useToast();
  const fuPerm = useFuCan();
  const [c, setC] = useState<Draft>(() => {
    const basics = (d: Draft) => ({ ...d, sheet: withPatientBasics(normSheet(d.sheet), d.patientId ? db.patient(d.patientId) : null) });
    // الزيارة: تاريخ الكشف = تاريخ الزيارة
    const withVisit = (d: Draft, id?: string | null) => { const a = id ? db.appointment(id) : openVisitFor(d.patientId); return a ? { ...d, appointmentId: a.id, date: a.date } : { ...d, appointmentId: d.appointmentId ?? null }; };
    if (initial) return basics(withSheet({ ...emptyConsult(initial.patientId), ...initial, pendingFollowUps: (initial.pendingPatient?.followUps ?? []) as FuDraft[] }));
    if (pending && !patientId) {
      const txt: Record<string, string> = { 'n.name': pending.name.trim().replace(/\s+/g, ' '), ...(pending.phone?.trim() ? { 'n.phone': pending.phone.trim() } : {}) };
      return { ...emptyConsult(''), sheet: { ...emptySheet(), txt, on: ['n.visit|زيارة جديدة'] } };
    }
    const draft = resume && loadConsultDraft(patientId);
    if (draft) return basics(withSheet(withVisit(draft, draft.appointmentId ?? appointmentId)));
    // زيارة جديدة ولا متابعة: من الكشوفات السابقة للمريض
    const fresh = emptyConsult(patientId);
    const visit = patientId && ortho.list('consultations', patientId).length ? 'متابعة' : 'زيارة جديدة';
    return basics(withVisit({ ...fresh, sheet: { ...emptySheet(), on: [`n.visit|${visit}`] } }, appointmentId));
  });
  const visitAppt = c.appointmentId ? db.appointment(c.appointmentId) : undefined;
  const savingRef = useRef(false); // ضغطتين ورا بعض على «حفظ» ما يعملوش تشخيصين
  const [tab, setTab] = useState<Tab>(() => (initial || doctorStarted(normSheet(c.sheet)) ? 'doctor' : 'nurse'));
  // خانة 1 وقت الفتح — اللي يتعدّل بعدها بس يروح لملف المريض (لو المريض اتغيّر، الخانات اتملت من ملفه هو فبنقارن بالملف بس)
  const [opened] = useState(() => ({ patientId: c.patientId, sheet: normSheet(c.sheet) }));
  const [mapOpen, setMapOpen] = useState(false);
  const [out, setOut] = useState<DxPart[] | null>(null); // نافذة «طباعة وإرسال» بالأجزاء المختارة مبدئيًا
  const bodyRef = useRef<HTMLDivElement>(null);
  const set = <K extends keyof Draft>(k: K, v: Draft[K]) => setC((x) => ({ ...x, [k]: v }));
  const sheet = normSheet(c.sheet);
  const changeSheet = (f: (s: typeof sheet) => typeof sheet) => setC((x) => ({ ...x, sheet: f(normSheet(x.sheet)) }));
  const sum = sheetSummary(sheet, c.side);
  // شيتات الطبيب: من مكان الألم في الشيت العام + اللي اتكتب فيه + اللي الطبيب ضافه
  const active = activeSheets(sheet);
  const usActive = US_SHEETS.filter((d) => sheet.on.includes(`us|${d.prefix}`) || usFilled(sheet, d));
  // صور سونار قديمة كانت بتترفع كمرفقات للكشف (علامة 'us') — بتفضل ظاهرة؛ الرفع الجديد بيروح لملف المريض (قسم أشعة السونار)
  const usImgs = c.attachments.filter((a) => a.tag === 'us');
  const dropSheet = (id: SheetId) => {
    if (sheetFilled(sheet, id) && !window.confirm(`إلغاء منطقة «${SHEET_TAB[id]}»؟ اللي اتكتب في شيتها هيتمسح، ومكان الألم ده هيتشال.`)) return;
    changeSheet((x) => removeSheet(x, id));
  };
  // اختيار منطقة = شيتها يتفتح؛ منطقتين أو أكتر ← الشيتات تتفتح مع بعض تحت بعض. الضغط على منطقة مفتوحة بينزل لشيتها
  const pickSheet = (id: SheetId) => {
    if (active.includes(id)) { bodyRef.current?.querySelector(`[data-sheet="${id}"]`)?.scrollIntoView({ behavior: 'smooth', block: 'start' }); return; }
    changeSheet((x) => ({ ...x, on: [...x.on, `sheets|${id}`] }));
  };
  const [mapKey, setMapKey] = useState('x.dx.other'); // خريطة الجسم بتكتب في «Others» بتاع الشيت اللي اتفتحت منه
  const openMap = (key: string) => { setMapKey(key); setMapOpen(true); };
  // كل حاجة اختيارية: الحفظ محتاج المريض بس. لو فيه حاجة ناقصة بنسأل: «استكمال بعدين» (يتحفظ «يحتاج استكمال») ولا «التشخيص اكتمل»
  // من غير ملف: الاسم الثلاثي في خانة 1 هو اللي بيتطابق بيه — لازم يكون مكتوب
  const unlinked = !c.patientId && (!!pending || !!initial);
  // الخادم بيربط التشخيص بملف الاستقبال تلقائي (أول ما يوصل أو أول ما الملف يتفتح) — الشاشة المفتوحة بتاخد الربط على طول
  useOrthoVersion();
  const linkedOnServer = initial?.id && !c.patientId ? ortho.list('consultations').find((x) => x.id === initial.id)?.patientId : undefined;
  useEffect(() => {
    if (linkedOnServer) setC((x) => (x.patientId ? x : { ...x, patientId: linkedOnServer }));
  }, [linkedOnServer]);
  useEffect(() => {
    // فتح تشخيص غير مربوط: نجيب آخر نسخة من الخادم (يمكن اترتبط من جهاز تاني أو بعد المزامنة)، وبعدها كل ١٥ ثانية لحد ما يترتبط
    if (!initial?.id || c.patientId || !net.isOnline()) return;
    void ortho.reload('consultations');
    const t = window.setInterval(() => { if (net.isOnline()) void ortho.reload('consultations'); }, 15000);
    return () => window.clearInterval(t);
  }, [initial?.id, c.patientId]);
  const pendingInfo = pendingFromSheet(sheet);
  // ربط فوري على الجهاز: لو فيه ملف مريض واحد بس بنفس الاسم الثلاثي (أو نفس الموبايل) بيتربط على طول — من غير ما نستنى الخادم
  const autoMatch = unlinked && !c.patientId ? matchPatient(pendingInfo.name, pendingInfo.phone) : undefined;
  useEffect(() => {
    if (!autoMatch) return;
    setC((x) => (x.patientId ? x : { ...x, patientId: autoMatch.id, appointmentId: x.appointmentId ?? openVisitFor(autoMatch.id)?.id ?? null }));
    toast.success(`اتربط الكشف بملف المريض ${autoMatch.fullName}`);
  }, [autoMatch?.id]);
  const ok = !!c.patientId || (unlinked && isTripleName(pendingInfo.name));
  const pseudo = unlinked ? ({ fullName: pendingInfo.name, phone: pendingInfo.phone ?? '', fileNo: '' } as unknown as NonNullable<ReturnType<typeof db.patient>>) : null;
  const patientOf = () => (c.patientId ? db.patient(c.patientId) : pseudo);
  // تشخيص فاضي: مفيش أي بيانات طبية (اسم المريض وبياناته الأساسية مابيتحسبوش) — مايتحفظش «مكتمل»
  const nothingEntered = !(sum.complaint || sum.diagnosis || sum.examination || sum.history || sum.plan || initial?.complaint?.trim() || initial?.diagnosis?.trim() || initial?.examination?.trim() || initial?.history?.trim()
    || c.plan.trim() || c.medications.some((m) => m.name.trim()) || c.labs.length || c.imagingRequests.some((x) => x.region.trim()) || c.attachments.length);
  const missing = [
    !nurseStarted(sheet) && c.painScore === '' && 'الشيت العام',
    !doctorStarted(sheet) && 'كشف الطبيب',
    !sum.complaint && 'الشكوى',
    !sum.diagnosis && 'التشخيص',
  ].filter(Boolean) as string[];
  const [ask, setAsk] = useState<{ thenPrint: boolean } | null>(null);
  const patientConsults = c.patientId ? ortho.list('consultations', c.patientId).sort((a, b) => a.date.localeCompare(b.date)) : [];
  const visitNo = initial ? Math.max(1, patientConsults.findIndex((x) => x.id === initial.id) + 1) : patientConsults.length + 1;
  const [inj, setInj] = useState<Injection | 'new' | null>(null);
  // شيت واحد (منطقة أو متابعة جبس/عمليات) جوّه تابه
  const renderSheet = (id: SheetId, _i: number, list: SheetId[]) => (
              <section key={id} className="sh-stack" data-sheet={id}>
                {list.length > 1 && <h3 className="sh-stack__h">{SHEET_TAB[id]}<button type="button" className="sh-stack__x" onClick={() => dropSheet(id)}>إلغاء المنطقة</button></h3>}
                {id === 'hipknee'
                  ? <DoctorSheet sheet={sheet} onChange={changeSheet} side={c.side} onSide={(v) => set('side', v)}
                    icd10={c.icd10} onIcd10={(v) => set('icd10', v)} onOpenMap={() => openMap('x.dx.other')} />
                  : <RegionSheetForm def={regionSheet(id)!} sheet={sheet} onChange={changeSheet} side={c.side} onSide={(v) => set('side', v)}
                    icd10={c.icd10} onIcd10={(v) => set('icd10', v)} onOpenMap={() => openMap(`${regionSheet(id)!.prefix}.dx.other`)} />}
              </section>
  );
  const examActive = active.filter((id) => !FU_SHEETS.includes(id));
  const fuActive = active.filter((id) => FU_SHEETS.includes(id));
  const goTab = (t: Tab) => { setTab(t); bodyRef.current?.closest('.modal__body')?.scrollTo({ top: 0 }); };

  // كشف جديد (مش تعديل كشف محفوظ): نحفظ مسودة محليًا أول بأول عشان لو المستخدم خرج من غير ما يحفظ، يقدر يستكمل بعدين
  useEffect(() => {
    if (initial || !c.patientId) return;
    if (draftHasContent(c)) saveConsultDraft(c.patientId, c); else clearConsultDraft(c.patientId);
  }, [initial, c]);

  // إلغاء تعديل كشف محفوظ: الملفات اللي اترفعت في الزيارة دي ومش هتتحفظ بتتمسح (الكشف الجديد بيفضل محتفظ بيها في المسودة)
  function cancel() {
    if (initial) {
      const keep = new Set(initial.attachments.map((a) => a.path));
      c.attachments.filter((a) => !keep.has(a.path)).forEach((a) => void ortho.removeAttachment(a.path));
    }
    onClose();
  }

  // طلبات الأشعة/التحاليل اللي اتسجلت «مطلوبة» قبل كده (من الكشف المفتوح أو من «حفظ الروشتة») — عشان ماتتسجلش مرتين
  const registered = useRef({ reqs: new Set((initial?.imagingRequests ?? []).map(reqKey)), labs: new Set(initial?.labs ?? []) });
  async function registerRequests(patientId: string, date: string, reqs: ImagingRequest[], labs: string[]) {
    for (const r of reqs.filter((x) => !registered.current.reqs.has(reqKey(x)))) {
      await ortho.save('imaging', { patientId, kind: r.kind, region: r.view ? `${r.region} — ${r.view}` : r.region, requestedAt: date, status: 'requested', finding: '', attachments: [] });
      registered.current.reqs.add(reqKey(r));
    }
    for (const l of labs.filter((x) => !registered.current.labs.has(x))) {
      await ortho.save('imaging', { patientId, kind: 'lab', region: l, requestedAt: date, status: 'requested', finding: '', attachments: [] });
      registered.current.labs.add(l);
    }
  }
  const [rxOpen, setRxOpen] = useState(false);
  const [rxSaving, setRxSaving] = useState(false);
  /** «حفظ الروشتة»: بيحفظ الكشف بالروشتة (الأدوية + الأشعة/السونار + التحاليل المطلوبة) في ملف المريض من غير ما يقفل الكشف.
   *  أول حفظ لكشف جديد بيدّيله رقمه، فـ«حفظ الكشف» بعد كده بيعدّل نفس السجل (مفيش كشف مكرر) */
  // ورقتي طلب الأشعة والتحاليل ← طلبات الكشف (imagingRequests / labs) وبعدها حفظ زي الروشتة
  const reqOthers = useRef(labOthers(normSheet(c.sheet)));
  async function saveReq(): Promise<boolean> {
    const next = applyRequestForms(c, sheet, reqOthers.current);
    reqOthers.current = labOthers(sheet);
    return saveRx({ medications: c.medications, labs: next.labs, imagingRequests: next.imagingRequests, plan: c.plan });
  }
  async function saveRx(rx: Pick<Draft, 'medications' | 'labs' | 'imagingRequests' | 'plan'>): Promise<boolean> {
    if (!ok) { toast.error(unlinked ? 'اكتب اسم المريض الثلاثي في خانة 1 الأول.' : 'اختار المريض الأول.'); return false; }
    if (savingRef.current) return false;
    savingRef.current = true; setRxSaving(true);
    try {
      const meds = rx.medications.filter((m) => m.name.trim());
      const reqs = rx.imagingRequests.filter((r) => r.region.trim());
      const text = { complaint: sum.complaint || (initial?.complaint ?? ''), history: sum.history || (initial?.history ?? ''), examination: sum.examination || (initial?.examination ?? ''), diagnosis: sum.diagnosis || (initial?.diagnosis ?? '') };
      const sheetOut = { ...sheet, meds: sheet.meds.filter((m) => m.name.trim()) };
      const payload = { ...c, ...rx, ...text, sheet: sheetOut, medications: meds, imagingRequests: reqs, complete: c.id ? (c.complete ?? false) : false,
        painScore: c.painScore === '' ? null : c.painScore, followUp: c.followUp || null,
        ...(c.patientId ? {} : { pendingPatient: { ...pendingFromSheet(sheetOut), followUps: c.pendingFollowUps ?? [] } }), pendingFollowUps: undefined } as unknown as Draft;
      const id = await ortho.save('consultations', payload);
      setC((x) => ({ ...x, ...rx, medications: meds, imagingRequests: reqs, id, complete: payload.complete }));
      if (c.patientId) await registerRequests(c.patientId, c.date, reqs, rx.labs);
      toast.success(c.patientId ? 'اتحفظت الروشتة في ملف المريض' : 'اتحفظت الروشتة — هتتربط بملف المريض تلقائي');
      return true;
    } catch (e) { toast.error((e as Error).message); return false; }
    finally { savingRef.current = false; setRxSaving(false); }
  }

  function save(thenPrint: boolean, complete?: boolean) {
    if (savingRef.current) return;
    if (complete === undefined && missing.length) { setAsk({ thenPrint }); return; }
    if (complete === true && nothingEntered) { toast.error('التشخيص فاضي — اكتب بياناته الأول.'); return; }
    const done = complete ?? true;
    const meds = c.medications.filter((m) => m.name.trim());
    const reqs = c.imagingRequests.filter((r) => r.region.trim());
    // الملخص النصي من الشيت ← حقول الكشف (القوايم والروشتة وسجل المريض)
    // كشف قديم اتفتح للتعديل: اللي الشيت مابيطلعوش يفضل زي ما هو (مايتمسحش النص القديم)
    const text = { complaint: sum.complaint || (initial?.complaint ?? ''), history: sum.history || (initial?.history ?? ''), examination: sum.examination || (initial?.examination ?? ''), diagnosis: sum.diagnosis || (initial?.diagnosis ?? '') };
    const sheetOut = { ...sheet, meds: sheet.meds.filter((m) => m.name.trim()) };
    const payload = { ...c, ...text, sheet: sheetOut, complete: done, medications: meds, imagingRequests: reqs, painScore: c.painScore === '' ? null : c.painScore, followUp: c.followUp || null,
      ...(c.patientId ? {} : { pendingPatient: { ...pendingFromSheet(sheetOut), followUps: c.pendingFollowUps ?? [] } }) } as unknown as Draft;
    // تابة الطباعة بتتفتح دلوقتي (وقت الضغطة) وإلا المتصفح يحجبها بعد انتظار الحفظ — ولو الحفظ فشل بتتقفل
    const printWin = thenPrint ? openPrintWindow() : null;
    let printed = false;
    savingRef.current = true;
    const pendingFus = c.pendingFollowUps ?? [];
    void run(async () => {
      const consultId = await ortho.save('consultations', { ...payload, pendingFollowUps: undefined } as Draft);
      // مواعيد المتابعة اللي اتحددت في الكشف ← مربوطة بالتشخيص ده
      if (c.patientId) {
        const problems = await savePendingFollowUps(c.patientId, consultId, pendingFus, fuPerm.book);
        if (problems.length) toast.error(`التشخيص اتحفظ، بس الحجز ما اتعملش — ${problems.join(' · ')}`);
      }
      // من غير ملف مريض: طلبات الأشعة والتحاليل بيسجلها الخادم في ملف المريض لما التشخيص يتربط
      if (!c.patientId) return;
      // طلبات الأشعة والتحاليل الجديدة بتتسجل «مطلوبة» في «الأشعة والتحاليل» عشان تتابع وصولها ونتيجتها (مرة واحدة بس)
      await registerRequests(c.patientId, c.date, reqs, c.labs);
      if (initial) {
        const now = new Set(c.attachments.map((a) => a.path));
        initial.attachments.filter((a) => !now.has(a.path)).forEach((a) => void ortho.removeAttachment(a.path));
      }
    }, !c.patientId ? 'اتحفظ التشخيص — هيتربط بملف المريض تلقائي بعد المزامنة' : done ? 'تم حفظ الكشف — التشخيص اكتمل' : 'اتحفظ — التشخيص محتاج استكمال', () => {
      if (!initial) clearConsultDraft(c.patientId);
      // تعديلات خانة 1 (الاسم/السن/النوع/الهاتف/العنوان) ← ملف المريض — بعد ما الكشف اتحفظ، عشان فشلها مايكرّرش الكشف
      const p = db.patient(c.patientId);
      if (p) {
        const { patch, badPhone } = sheetPatientPatch(sheetOut, p, c.patientId === opened.patientId ? opened.sheet : undefined);
        if (badPhone) toast.error('رقم الهاتف في الشيت مش صحيح — ما اتحفظش في ملف المريض.');
        if (Object.keys(patch).length) void db.updatePatient(p.id, patch).catch((e) => toast.error(`الكشف اتحفظ، بس بيانات المريض ما اتحدّثتش: ${(e as Error).message}`));
      }
      if (thenPrint) { printed = true; printRx({ ...c, ...text, medications: meds, imagingRequests: reqs }, patientOf(), printWin); }
      onClose();
    }).then(() => { savingRef.current = false; if (!printed) printWin?.close(); });
  }

  return (
    <Modal xl title={initial ? 'تعديل الكشف' : 'كشف جديد'} onClose={cancel} footer={<>
      <VoiceDictation />
      {(c.patientId || unlinked) && missing.length > 0 && <span className="sh-need">لسه ناقص: {missing.join('، ')}</span>}
      {unlinked && !ok && <span className="sh-need">اكتب اسم المريض الثلاثي في خانة 1</span>}
      <Button variant="outline" onClick={cancel}>إلغاء</Button>
      <Button variant="outline" icon="print" disabled={!c.patientId && !unlinked} onClick={() => setOut(['nurse', 'doctor'])}>طباعة وإرسال</Button>
      <Button icon="check" loading={busy} disabled={!ok} onClick={() => save(false)}>حفظ الكشف</Button>
    </>}>
      <div className="cx" ref={bodyRef}>
        <div className="grid-form grid-form--4">
          {(
            <Field label={unlinked ? 'المريض (لو ظهر في القايمة اختاره)' : 'المريض'}><PatientSelect value={c.patientId} onChange={(v) => setC((x) => {
              const a = initial ? undefined : openVisitFor(v); // مريض تاني ← زيارته هو
              return { ...x, patientId: v, appointmentId: initial ? x.appointmentId : a?.id ?? null, ...(a ? { date: a.date } : {}), sheet: v || !pending ? resetPatientBasics(normSheet(x.sheet), v ? db.patient(v) : null) : x.sheet };
            })} /></Field>
          )}
          <Field label="تاريخ الكشف"><input type="date" className="input" value={c.date} onChange={(e) => set('date', e.target.value)} /></Field>
          <Field label="المنطقة المصابة">
            <select className="input" value={c.region} onChange={(e) => set('region', e.target.value)}>{(REGIONS.includes(c.region) ? REGIONS : [c.region, ...REGIONS]).map((r) => <option key={r}>{r}</option>)}</select>
          </Field>
          <Field label="ميعاد المتابعة"><input type="date" className="input" value={c.followUp} min={c.date} onChange={(e) => set('followUp', e.target.value)} /></Field>
        </div>

        {unlinked && !c.patientId && (
          <div className="sh-visitlink dx-unlinked">
            <Icon name="user" size={15} />
            <span>ملف تشخيص جديد باسم <b>{pendingInfo.name || '—'}</b> — من غير ملف مريض. بعد المزامنة بيتربط تلقائي بملف الاستقبال لو الاسم الثلاثي أو الموبايل مطابقين — أو اختار المريض من خانة «المريض» فوق ويتربط على طول.</span>
          </div>
        )}
        {visitAppt && (
          <div className="sh-visitlink">
            <Icon name="calendar" size={15} />
            التشخيص مربوط بزيارة <b className="num">{visitAppt.no}</b> — {fmtDate(visitAppt.date)} <span className="num">{fmtTime(visitAppt.time)}</span>
            {db.therapist(visitAppt.therapistId)?.name ? <> — {db.therapist(visitAppt.therapistId)?.name}</> : null}
          </div>
        )}
        {initial && isLegacy(initial) && (initial.diagnosis || initial.examination || initial.complaint || initial.history) && (
          <details className="cx-legacy-box" open>
            <summary>بيانات الكشف القديم (مكتوبة قبل الشيت الرقمي)</summary>
            <LegacyText c={initial} />
          </details>
        )}
        <div className="field cx-reason">
          <label htmlFor="cx-visit-reason">شكوى المريض / سبب الزيارة</label>
          <textarea id="cx-visit-reason" className="input" rows={2} dir="auto" value={c.visitReason ?? ''} onChange={(e) => set('visitReason', e.target.value)}
            placeholder="اكتب شكوى المريض بكلامه — مثلاً: ألم في الركبة اليمين من أسبوعين، تورم بعد المشي…" />
        </div>

        <div className="seg seg--4 sh-tabs" role="tablist" aria-label="أجزاء الكشف">
          {TABS.map(([k, l], i) => (
            <button key={k} type="button" role="tab" aria-selected={tab === k} className={`seg__btn ${tab === k ? 'active' : ''}`} onClick={() => goTab(k)}>
              <span className="sh-tabs__n num">{i + 1}</span>{k === 'doctor' && active.length ? `${l} — ${active.map((id) => SHEET_TAB[id]).join(' + ')}` : l}
            </button>
          ))}
        </div>

        {tab === 'nurse' && <>
          <NursingSheet sheet={sheet} onChange={changeSheet} patient={c.patientId ? db.patient(c.patientId) : null} date={c.date} visitNo={visitNo}
            painScore={c.painScore} onPainScore={(v) => set('painScore', v)}
            onFirstPain={(id, side) => setC((x) => ({ ...x, region: regionById(id)?.name ?? x.region, ...(side ? { side } : {}) }))} />
          {/* ٦) شيت التروما جوّه الشيت العام — بيظهر لما «هل توجد إصابة حديثة؟» = نعم */}
          {traumaShown(sheet) && (
            <section className="sh-stack sh-trauma" dir="ltr">
              <h3 className="sh-stack__h" dir="rtl">تقييم إصابات العظام والكسور (Trauma)</h3>
              <RegionSheetForm def={regionSheet('trauma')!} sheet={sheet} onChange={changeSheet} side={c.side} onSide={(v) => set('side', v)}
                icd10={c.icd10} onIcd10={(v) => set('icd10', v)} onOpenMap={() => openMap('tr.dx.other')} />
            </section>
          )}
          <div className="sh-next">
            <Button variant="outline" icon="print" disabled={!c.patientId && !unlinked} onClick={() => setOut(['nurse'])}>طباعة / إرسال الشيت العام</Button>
            <Button icon="chevronLeft" onClick={() => goTab('doctor')}>التالي: كشف الطبيب</Button>
          </div>
        </>}

        {tab === 'doctor' && <>
          {/* ملفات المريض اللي مش أشعة ولا تحاليل */}
          <PatientMedicalFiles patientId={c.patientId} excludeConsultId={initial?.id} categories={['other']} title="ملفات أخرى للمريض" hideEmpty />
          <>
            <SheetSwitch active={active} onPick={pickSheet} onRemove={dropSheet} ids={SHEET_ORDER.filter((id) => !FU_SHEETS.includes(id))} />
            {!examActive.length && <p className="sh-pickfirst">اختار المنطقة اللي هتكشف عليها من فوق (أو حدد مكان الألم في الشيت العام) — شيتها هيتفتح هنا. لو اخترت منطقتين، الشيتين بيتفتحوا مع بعض.</p>}
            {examActive.map(renderSheet)}
            {/* اختياري: تقييم الروماتويد ACR/EULAR 2010 — مش جزء إجباري من الكشف */}
          </>
          <div className="sh-next">
            <Button variant="outline" icon="chevron" onClick={() => goTab('nurse')}>رجوع: الشيت العام</Button>
            <Button variant="outline" icon="print" disabled={!c.patientId && !unlinked} onClick={() => setOut(['doctor'])}>طباعة / إرسال كشف الطبيب</Button>
            <Button icon="chevronLeft" onClick={() => goTab('fu')}>التالي: متابعة الجبس والعمليات</Button>
          </div>
        </>}

        {tab === 'fu' && <>
          <SheetSwitch active={active} onPick={pickSheet} onRemove={dropSheet} ids={FU_SHEETS} label="المتابعة:" />
          {!fuActive.length && <p className="sh-pickfirst">لو المريض جاي متابعة جبس أو متابعة بعد عملية، اختار الشيت من فوق. لو مش محتاج، كمّل للي بعده.</p>}
          {fuActive.map(renderSheet)}
          <div className="sh-next">
            <Button variant="outline" icon="chevron" onClick={() => goTab('doctor')}>رجوع: كشف الطبيب</Button>
            <Button icon="chevronLeft" onClick={() => goTab('files')}>التالي: الأشعة والتحاليل</Button>
          </div>
        </>}

        {/* الخطة العلاجية: ١) أشعة السونار  ٢) التحاليل  ٣) الأدوية والروشتة — وبعدها الخطة والتعليمات وموعد المتابعة.
            الأشعة/السونار والتحاليل بتتقري من ملف المريض (patient_files): اللي السكرتيرة ترفعه من «المرضى» أو الطبيب يرفعه هنا
            بيتسجل مرة واحدة في ملف المريض ويظهر في قسمه — مفيش نسخ جوّه الكشف ولا تكرار */}
        {tab === 'plan' && <>
          <section className="plan-part">
            <h3 className="plan-part__h"><span className="plan-part__n num">1</span>الأدوية والروشتة</h3>
            {(() => {
              const meds = c.medications.filter((m) => m.name.trim()), reqs = c.imagingRequests.filter((r) => r.region.trim());
              return meds.length || reqs.length || c.labs.length ? (
                <dl className="dl rx-sum">
                  {meds.length > 0 && <div><dt>الأدوية</dt><dd dir="ltr" style={{ textAlign: 'start' }}>{meds.map((m) => [m.name, m.dose, m.frequency, m.duration].filter(Boolean).join(' ')).join(' • ')}</dd></div>}
                  {reqs.length > 0 && <div><dt>أشعة / سونار مطلوبة</dt><dd>{reqs.map((r) => `${IMAGING_KIND[r.kind]} — ${r.region}${r.view ? ` (${r.view})` : ''}`).join('، ')}</dd></div>}
                  {c.labs.length > 0 && <div><dt>تحاليل مطلوبة</dt><dd dir="ltr" style={{ textAlign: 'start' }}>{c.labs.join(' • ')}</dd></div>}
                </dl>
              ) : <p className="cx-empty">لسه مفيش روشتة — اضغط «فتح الروشتة» واكتب الأدوية والأشعة/السونار والتحاليل المطلوبة في صفحة واحدة.</p>;
            })()}
            <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', marginTop: 10 }}>
              <Button icon="receipt" onClick={() => setRxOpen(true)}>فتح الروشتة</Button>
              <Button variant="outline" icon="print" disabled={!c.patientId && !unlinked} onClick={() => printRx(c, patientOf())}>طباعة الروشتة</Button>
            </div>
          </section>

          <div dir="rtl" className="sh-treat"><RegionSheetForm def={TREATMENT} sheet={sheet} onChange={changeSheet} side={c.side} onSide={(v) => set('side', v)}
            icd10={c.icd10} onIcd10={(v) => set('icd10', v)} onOpenMap={() => openMap('tp.tx.other')}
            lastBoxExtra={
              /* مواعيد المتابعة جوّه مربع الخطة العلاجية (٨/١١): أكتر من موعد للمريض، مربوطة بالتشخيص ده (بتتحفظ مع حفظ الكشف) */
              <div className="sh-treat-fu">
                <div className="sh-lbl"><Icon name="calendar" size={15} /> تحديد موعد متابعة</div>
                <FollowUpStep patientId={c.patientId} patientLabel={pendingInfo.name} consultationId={initial?.id} pending={c.pendingFollowUps ?? []} onPending={(p) => set('pendingFollowUps', p)}
                  doctorHint={visitAppt?.therapistId} />
              </div>} /></div>
          <div className="sh-next">
            <Button variant="outline" icon="chevron" onClick={() => goTab('inj')}>رجوع: الحقن</Button>
            <Button icon="check" loading={busy} disabled={!ok} onClick={() => save(false)}>حفظ الكشف</Button>
          </div>
        </>}

        {/* الأشعة والتحاليل: قسم لوحده قبل الحقن (طلب الدكتور ٨/١١) */}
        {tab === 'files' && <>
          {/* طلب أشعة وطلب تحاليل (ورق الدكتور): اختيار + حفظ + طباعة + حفظ كصورة — أسماء المطلوب بالإنجليزي */}
          <section className="plan-part">
            <h3 className="plan-part__h"><span className="plan-part__n num">1</span>الأشعة والتحاليل المطلوبة</h3>
            <RequestForms sheet={sheet} onChange={changeSheet} busy={rxSaving} disabled={!c.patientId && !unlinked}
              onSave={() => void saveReq()}
              onPrint={async (kind) => {
                const win = openPrintWindow();
                if (await saveReq()) void printHtml(requestHtml(kind, sheet, patientOf(), c.date), win); else win?.close();
              }}
              onWhatsapp={async (kind) => {
                // التابة بتتفتح وقت الضغطة (وإلا المتصفح يحجبها)، وبعد الحفظ بتروح لمحادثة المريض
                const win = window.open('', '_blank');
                if (!(await saveReq())) { win?.close(); return; }
                const pt = c.patientId ? db.patient(c.patientId) : null;
                // محادثة فاضية مع المريض — الطبيب بيرفع صورة الطلب ويبعتها بنفسه (٨/١١)
                void kind;
                const url = `https://wa.me/${waPhone(pt ? whatsappNumber(pt) : (pendingInfo.phone ?? ''))}`;
                if (win && !win.closed) win.location.href = url; else window.location.href = url;
              }}
              prepare={(kind) => { void prepareRequestImage(kind, sheet, patientOf(), c.date).catch(() => undefined); }}
              onImage={async (kind) => {
                // الصورة جاهزة مقدمًا ← بتتحفظ في نفس الضغطة؛ مش جاهزة لسه ← بنجهزها (والحفظ ممكن يطلب ضغطة كمان)
                const say = (r: string) => {
                  if (r === 'saved') toast.success(/Android/i.test(navigator.userAgent) ? 'اتحفظت الصورة في معرض الصور — ألبوم «Download» (التنزيلات)' : 'اتحفظت الصورة على الجهاز');
                };
                const ready = readyRequestImage(kind, sheet, patientOf(), c.date);
                if (ready) { say(deliverRequestImage(ready)); void saveReq(); return; }
                if (!(await saveReq())) return;
                try { const img = await prepareRequestImage(kind, sheet, patientOf(), c.date); say(deliverRequestImage(img)); }
                catch (e) { toast.error((e as Error).message); }
              }} />
          </section>

          <section className="plan-part">
            <h3 className="plan-part__h"><span className="plan-part__n num">2</span>الأشعة / السونار</h3>
            <PatientMedicalFiles patientId={c.patientId} excludeConsultId={initial?.id} categories={['xray']} title="صور الأشعة / السونار" icon="camera" uploadCategory="xray" />
            {usImgs.length > 0 && (
              <Section icon="camera" title="صور سونار مرفقة بالكشف ده (قديمة)">
                <AttachmentThumbs items={usImgs} onRemove={(path) => set('attachments', c.attachments.filter((a) => a.path !== path))} />
              </Section>
            )}
            <div className="sh-lbl" style={{ marginTop: 10 }}>تقرير السونار (MSK Ultrasound Report)</div>
            <div className="us-pick">
              {US_SHEETS.map((d) => {
                const on = usActive.includes(d);
                return <Button key={d.prefix} size="sm" variant={on ? undefined : 'outline'} icon={on ? 'check' : 'plus'} onClick={() => {
                  if (!on) { changeSheet((x) => ({ ...x, on: [...x.on, `us|${d.prefix}`] })); return; }
                  if (usFilled(sheet, d) && !window.confirm(`إلغاء تقرير سونار «${d.tab}»؟ اللي اتكتب فيه هيتمسح.`)) return;
                  const p = d.prefix + '.';
                  changeSheet((x) => ({ ...x, on: x.on.filter((o) => o !== `us|${d.prefix}` && !o.startsWith(p)), txt: Object.fromEntries(Object.entries(x.txt).filter(([k]) => !k.startsWith(p))) }));
                }}>سونار {d.tab}</Button>;
              })}
            </div>
            {!usActive.length && <p className="sh-pickfirst">اختار المنطقة اللي اتعمل عليها السونار — التقرير بتاعها هيتفتح هنا. ممكن تختار أكتر من منطقة.</p>}
            {usActive.map((d) => (
              <section key={d.prefix} className="sh-stack">
                <h3 className="sh-stack__h" dir="ltr">{d.title.replace('&amp;', '&')}</h3>
                {usImage(d) && <img className="us-img" src={usImage(d)} alt={`${d.tab} — رسومات التشريح`} loading="lazy" />}
                <RegionSheetForm def={d} sheet={sheet} onChange={changeSheet} side={c.side} onSide={(v) => set('side', v)}
                  icd10={c.icd10} onIcd10={(v) => set('icd10', v)} onOpenMap={() => openMap(`${d.prefix}.path.other`)} />
              </section>
            ))}
          </section>

          <section className="plan-part">
            <h3 className="plan-part__h"><span className="plan-part__n num">3</span>التحاليل</h3>
            {(() => {
              const waiting = c.patientId ? ortho.list('imaging', c.patientId).filter((m) => m.kind === 'lab' && m.status !== 'reviewed') : [];
              return waiting.length > 0 && (
                <div className="cx-labgrp" style={{ marginBottom: 8 }}>
                  <span className="cx-labgrp__t">تحاليل مطلوبة — ارفع نتيجتها هنا لما توصل</span>
                  <div className="cx-chips">{waiting.map((m) => <span key={m.id} className="cx-chip" dir="ltr">{m.region} <Tone s={IMAGING_STATUS[m.status]} /></span>)}</div>
                </div>
              );
            })()}
            <PatientMedicalFiles patientId={c.patientId} excludeConsultId={initial?.id} categories={['lab']} title="ملفات ونتائج التحاليل" icon="doc" uploadCategory="lab" />
          </section>

          <div className="sh-next">
            <Button variant="outline" icon="chevron" onClick={() => goTab('fu')}>رجوع: متابعة الجبس والعمليات</Button>
            <Button icon="chevronLeft" onClick={() => goTab('inj')}>التالي: الحقن</Button>
          </div>
        </>}

        {/* الحقن جوّه التشخيص: سجلات الحقن بتاعة المريض + سجل جديد (شيت INJECTION RECORD) */}
        {tab === 'inj' && <>
          <Section icon="target" title="سجل الحقن">
            {c.patientId ? <>
              <InjectionList items={ortho.list('injections', c.patientId).sort((a, b) => b.date.localeCompare(a.date))} onEdit={(n) => setInj(n)} />
              <Button icon="plus" onClick={() => setInj('new')} style={{ marginTop: 10 }}>سجل حقن جديد</Button>
            </> : <p className="muted">{unlinked ? 'سجل الحقن بيتفتح بعد ما التشخيص يتربط بملف المريض.' : 'اختار المريض الأول.'}</p>}
          </Section>
          <div className="sh-next">
            <Button variant="outline" icon="chevron" onClick={() => goTab('files')}>رجوع: الأشعة والتحاليل</Button>
            <Button icon="chevronLeft" onClick={() => goTab('plan')}>التالي: الخطة العلاجية</Button>
          </div>
        </>}
        {rxOpen && <RxPage patientId={c.patientId} region={c.region} busy={rxSaving}
          initial={{ medications: c.medications, labs: c.labs, imagingRequests: c.imagingRequests, attachments: c.attachments, plan: c.plan }}
          onClose={() => setRxOpen(false)}
          onSave={(rx) => saveRx(rx)}
          onPrint={async (rx) => {
            // التابة بتتفتح وقت الضغطة (وإلا المتصفح يحجبها)، والروشتة بتتطبع لوحدها بعد الحفظ
            const win = openPrintWindow();
            if (await saveRx(rx)) { setRxOpen(false); printRx({ ...c, ...rx }, patientOf(), win); } else win?.close();
          }} />}
        {inj && <InjectionModal patientId={c.patientId} appointmentId={c.appointmentId ?? null} initial={inj === 'new' ? undefined : inj} onClose={() => setInj(null)} />}
      </div>
      {out && <DiagnosisOutput initial={out} patient={patientOf()} visitNo={visitNo} onClose={() => setOut(null)}
        c={{ ...c, ...sum, plan: c.plan, sheet, medications: c.medications.filter((m) => m.name.trim()), imagingRequests: c.imagingRequests.filter((r) => r.region.trim()) }} />}
      {ask && (
        <Modal title="فيه حاجات لسه ناقصة" onClose={() => setAsk(null)} footer={<>
          <Button variant="outline" onClick={() => setAsk(null)}>رجوع للكشف</Button>
          <Button variant="outline" icon="refresh" onClick={() => { const t = ask.thenPrint; setAsk(null); save(t, false); }}>حفظ — استكمال بعدين</Button>
          <Button icon="check" disabled={nothingEntered} title={nothingEntered ? 'التشخيص فاضي — اكتب بياناته الأول' : ''} onClick={() => { const t = ask.thenPrint; setAsk(null); save(t, true); }}>التشخيص اكتمل</Button>
        </>}>
          <p style={{ marginTop: 0 }}>لسه ما اتملاش: <b>{missing.join('، ')}</b>.</p>
          <p className="muted" style={{ marginBottom: 0 }}>«حفظ — استكمال بعدين» بيحفظه ويفضل ظاهر بزرار «استكمال» لحد ما يخلص. {nothingEntered ? 'التشخيص فاضي، فمايتحفظش كتشخيص مكتمل.' : '«التشخيص اكتمل» بيحفظه تشخيص نهائي كده.'}</p>
        </Modal>
      )}
      {/* خريطة الجسم من خانة التشخيص (10): الحالة بتتضاف في «Others» + الكود والمنطقة والجهة */}
      {mapOpen && <DiagnosisPicker onClose={() => setMapOpen(false)} onPick={(text, ref) => {
        const p = pickedToConsult(text, ref);
        setC((x) => {
          const s = normSheet(x.sheet);
          const cur = (s.txt[mapKey] ?? '').trim();
          const icd = [x.icd10.trim(), p.icd10 ?? ''].filter((v, i, all) => v && all.indexOf(v) === i).join(', ');
          return { ...x, icd10: cur ? icd : p.icd10 ?? '', region: p.region ?? x.region, side: ref.side ?? x.side,
            sheet: { ...s, txt: { ...s.txt, [mapKey]: cur ? `${cur} · ${p.diagnosis}` : p.diagnosis ?? '' } } };
        });
        setMapOpen(false);
      }} />}
    </Modal>
  );
}

// صور الأشعة المرفقة: روابط موقّعة مؤقتة (الـ bucket خاص)
/** «فتح الروشتة»: صفحة واحدة للروشتة كلها — الأدوية، والأشعة/السونار المطلوبة، والتحاليل المطلوبة — وجواها «حفظ الروشتة» و«طباعة الروشتة» */
function RxPage({ patientId, region, initial, busy, onClose, onSave, onPrint }: {
  patientId: string; region: string; initial: RxData; busy: boolean; onClose: () => void;
  onSave: (rx: Pick<RxData, 'medications' | 'labs' | 'imagingRequests' | 'plan'>) => Promise<boolean>; onPrint: (rx: Pick<RxData, 'medications' | 'labs' | 'imagingRequests' | 'plan'>) => void;
}) {
  const [rx, setRx] = useState<RxData>(initial);
  const pick = () => ({ medications: rx.medications, labs: rx.labs, imagingRequests: rx.imagingRequests, plan: rx.plan });
  return (
    <Modal xl title="الروشتة — الأدوية والأشعة والتحاليل المطلوبة" onClose={onClose} footer={<>
      <Button variant="outline" onClick={onClose} disabled={busy}>إغلاق</Button>
      <Button variant="outline" icon="print" loading={busy} onClick={() => onPrint(pick())}>طباعة الروشتة</Button>
      <Button icon="check" loading={busy} onClick={async () => { if (await onSave(pick())) onClose(); }}>حفظ الروشتة</Button>
    </>}>
      <RxEditor rxOnly patientId={patientId} region={region} value={rx} onChange={(f) => setRx((x) => f(x))} />
    </Modal>
  );
}

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

// تشخيص لسه ما خلصش — يا إما مسودة على الجهاز (لسه ما اتحفظتش) يا إما اتحفظ «يحتاج استكمال» (ليه id):
// بيظهر بالأجزاء اللي اتملت، وزرار يكمّله من مكان ما وقف
export function DraftCard({ d, onResume, onDiscard }: { d: Draft & { savedAt?: number }; onResume: () => void; onDiscard?: () => void }) {
  const s = normSheet(d.sheet);
  const sum = sheetSummary(s);
  const steps: [string, boolean][] = [
    ['الشيت العام', nurseStarted(s) || d.painScore !== ''],
    ['كشف الطبيب', doctorStarted(s)],
    ['الروشتة والأشعة والتحاليل', !!(d.medications.length || d.labs.length || d.imagingRequests.length || d.attachments.length || d.plan.trim())],
  ];
  return (
    <div className="item-card cx-card cx-draft">
      <div className="ortho-row">
        <div>
          <Link to={`/patients/${d.patientId}`} className="ortho-cell-strong">{patientName(d.patientId)}</Link>
          <span className="badge badge--brand" style={{ marginInlineStart: 8 }}>ملف <span className="num">{patientFile(d.patientId)}</span></span>
          <div className="ortho-sub"><span className="badge badge--warn">{d.id ? 'يحتاج استكمال' : 'لم يكتمل'}</span> {fmtDate(d.date)}{d.savedAt ? ` · آخر تعديل ${fmtDateTime(d.savedAt)}` : ''}</div>
        </div>
        <div style={{ display: 'flex', gap: 6, alignItems: 'center' }}>
          <Button size="sm" icon="refresh" onClick={onResume}>استكمال التشخيص</Button>
          {onDiscard && <IconBtn icon="trash" label="حذف التشخيص اللي لم يكتمل" danger onClick={onDiscard} />}
        </div>
      </div>
      <div className="cx-draft__steps">
        {steps.map(([label, done], i) => <span key={label} className={`cx-draft__step ${done ? 'is-done' : ''}`}><b className="num">{i + 1}</b>{label} {done ? '✓' : '— لسه'}</span>)}
      </div>
      {(sum.complaint || sum.diagnosis || d.visitReason) && (
        <dl className="dl" style={{ marginTop: 6 }}>
          {d.visitReason && <div><dt>سبب الزيارة</dt><dd dir="auto">{d.visitReason}</dd></div>}
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

/** كشف قديم من غير شيت رقمي (كشوفات قبل الشيت + المستورد من البرنامج القديم): النص المكتوب نفسه */
export const isLegacy = (c: { sheet?: unknown }) => !sheetHasContent(normSheet(c.sheet));
export function LegacyText({ c }: { c: Pick<Consultation, 'complaint' | 'history' | 'examination' | 'diagnosis' | 'plan' | 'medications'> }) {
  const meds = (c.medications ?? []).filter((m) => m.name);
  const rows: [string, string][] = [['الشكوى', c.complaint], ['التاريخ المرضي', c.history], ['الفحص', c.examination], ['التشخيص', c.diagnosis], ['التعليمات', c.plan]];
  return (
    <dl className="dl cx-legacy">
      {rows.filter(([, v]) => v?.trim()).map(([k, v]) => <div key={k}><dt>{k}</dt><dd dir="auto" style={{ whiteSpace: 'pre-line' }}>{v}</dd></div>)}
      {meds.length > 0 && <div><dt>الأدوية</dt><dd><ol className="cx-medlist">{meds.map((m, i) => <li key={i}><b dir="ltr">{m.name}</b> <span className="muted">{[m.dose, m.frequency, m.duration].filter(Boolean).join(' — ')}</span></li>)}</ol></dd></div>}
    </dl>
  );
}

/** حالة تشخيص من غير ملف مريض (هجرة 924) */
export function LinkBadge({ c }: { c: Consultation & { pendingSync?: boolean } }) {
  if (!isUnlinked(c)) return null;
  const [label, tone] = c.pendingSync ? ['محفوظ على الجهاز — هيترفع لما النت يرجع', 'muted']
    : c.linkStatus === 'review' ? ['يحتاج مراجعة وربط بملف المريض', 'danger'] : ['بانتظار ملف المريض من الاستقبال', 'warn'];
  return <span className={`badge badge--${tone}`} title={c.linkNote || ''}>{label}</span>;
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
                {!hidePatient && (isUnlinked(c)
                  ? <><span className="ortho-cell-strong">{c.pendingPatient?.name || '—'}</span> <LinkBadge c={c} /></>
                  : <Link to={`/patients/${c.patientId}`} className="ortho-cell-strong">{patientName(c.patientId)}</Link>)}
                <div className="ortho-sub">{isIncomplete(c) && <span className="badge badge--warn" style={{ marginInlineEnd: 6 }}>يحتاج استكمال</span>}{fmtDate(c.date)} · {c.region} — {SIDE[c.side]}{c.painScore !== '' && c.painScore != null ? ` · الألم ${c.painScore}/10` : ''}</div>
              </div>
              <div style={{ display: 'flex', gap: 6, alignItems: 'center' }}>
                {isIncomplete(c) && perm.edit && <Button size="sm" icon="refresh" onClick={() => onEdit(c)}>استكمال</Button>}
                <Button size="sm" variant="outline" icon="print" onClick={() => setOut(c)}>طباعة وإرسال</Button>
                {perm.edit && <IconBtn icon="edit" label="تعديل" onClick={() => onEdit(c)} />}
                {perm.del && <IconBtn icon="trash" label="حذف" danger onClick={() => confirmDelete('هذا الكشف') && run(async () => { await ortho.remove('consultations', c.id); atts.forEach((a) => void ortho.removeAttachment(a.path)); }, 'تم الحذف')} />}
              </div>
            </div>
            <div className="cx-dx">
              <span className="cx-dx__l">التشخيص</span>
              {c.diagnosis ? <b>{c.diagnosis}</b> : <span className="muted">لسه ما اتحددش</span>}{c.icd10 && <span className="badge badge--brand" dir="ltr">{c.icd10}</span>}
            </div>
            <dl className="dl" style={{ marginTop: 6 }}>
              {c.visitReason && <div><dt>شكوى المريض / سبب الزيارة</dt><dd dir="auto" style={{ whiteSpace: 'pre-line' }}>{c.visitReason}</dd></div>}
              <div><dt>الشكوى</dt><dd>{c.complaint || '—'}</dd></div>
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
            {c.patientId && <FollowUpsOfConsult consultationId={c.id} patientId={c.patientId} />}
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
    .filter((c) => !term || c.diagnosis.includes(term) || c.region.includes(term) || c.icd10?.toUpperCase().includes(term.toUpperCase()) || (isUnlinked(c) ? c.pendingPatient?.name ?? '' : patientName(c.patientId)).includes(term));
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
