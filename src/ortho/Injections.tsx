// سجل الحقن (نفس الشيت الورقي «INJECTION RECORD — MSK Injection Documentation»): بيانات المريض، التشخيص، مكان الحقن والجهة،
// التركيب المستهدف، نوع المادة، التقنية، تفاصيل المادة المحقونة (جدول)، التقييم قبل الحقن والموافقة، التعقيم وملاحظات الإجراء،
// النتيجة والمتابعة، توقيع الطبيب، ملاحظات إضافية. بيتحفظ في ortho_injections (هجرة 923) ويتطبع A4 بنفس ترتيب الورقة.
import { useState, type ReactNode } from 'react';
import { Button, EmptyState, Modal } from '../components/ui';
import { db } from '../data/db';
import { DOCTOR } from '../landing/content';
import { fmtDate, todayYmd } from '../utils/format';
import { fileNoText } from '../utils/phoneUtils';
import { openPrintWindow, printHtml } from '../utils/printDoc';
import { ortho, type Injection, type InjectionSheet } from './data';
import { Icon } from '../utils/icons';
import { Field, IconBtn, confirmDelete, useClinicalCan, useRun } from './kit';

const L = {
  site: ['Shoulder', 'Elbow', 'Wrist / Hand', 'Hip', 'Knee', 'Ankle / Foot', 'Cervical Spine', 'Thoracic Spine', 'Lumbar Spine'],
  side: ['Right', 'Left', 'Bilateral'],
  target: ['Intra-articular', 'Tendon / Peritendinous', 'Bursa', 'Nerve / Perineural', 'Ligament', 'Facet Joint', 'SI Joint', 'Trigger Point'],
  type: ['Corticosteroid', 'Hyaluronic Acid', 'PRP (Platelet Rich Plasma)', 'Dextrose', 'Local Anesthetic'],
  technique: ['Ultrasound Guided', 'Landmark (Palpation)'],
  consent: ['Allergies checked', 'Anticoagulants / bleeding risk assessed', 'No local infection at injection site', 'Informed consent obtained'],
  yesNo: ['Yes', 'No'],
  none: ['None', 'Yes'],
};

export const emptyInjection = (): InjectionSheet => ({
  diagnosis: '', site: [], siteOther: '', side: '', target: [], targetOther: '', type: [], combination: '', typeOther: '',
  technique: '', approach: '', position: '', needle: '', syringe: '', materials: [{ drug: '', dose: '', batch: '', expiry: '' }],
  consent: [], consentNotes: '', aseptic: false, usConfirm: false, usFindings: '', procedureNotes: '', immediate: '',
  complications: '', complicationsText: '', instructions: '', plannedFollowUp: '', response: '', furtherPlan: '', signature: '', notes: '',
});
const norm = (s?: Partial<InjectionSheet>): InjectionSheet => { const e = emptyInjection(); return { ...e, ...s, materials: s?.materials?.length ? s.materials : e.materials }; };

function Multi({ options, value, onChange }: { options: string[]; value: string[]; onChange: (v: string[]) => void }) {
  return <div className="cx-chips" dir="ltr">{options.map((o) => <button key={o} type="button" aria-pressed={value.includes(o)} className={`cx-chip ${value.includes(o) ? 'is-on' : ''}`} onClick={() => onChange(value.includes(o) ? value.filter((x) => x !== o) : [...value, o])}>{o}</button>)}</div>;
}
function One({ options, value, onChange }: { options: string[]; value: string; onChange: (v: string) => void }) {
  return <div className="cx-chips" dir="ltr" role="radiogroup">{options.map((o) => <button key={o} type="button" role="radio" aria-checked={value === o} className={`cx-chip ${value === o ? 'is-on' : ''}`} onClick={() => onChange(value === o ? '' : o)}>{o}</button>)}</div>;
}
// كل قسم زي الورقة: شريط أزرق بأيقونة وعنوان وتحته المحتوى
const Box = ({ title, icon, children }: { title: string; icon: string; children: ReactNode }) => (
  <section className="inj-box" dir="ltr">
    <h3 className="inj-box__head"><Icon name={icon} size={18} />{title}</h3>
    <div className="inj-box__body">{children}</div>
  </section>
);
const T = ({ label, value, onChange, area }: { label: string; value: string; onChange: (v: string) => void; area?: boolean }) => (
  <Field label={label}>{area ? <textarea className="input" rows={2} dir="auto" value={value} onChange={(e) => onChange(e.target.value)} /> : <input className="input" dir="auto" value={value} onChange={(e) => onChange(e.target.value)} />}</Field>
);

export function InjectionModal({ patientId, appointmentId = null, initial, onClose }: { patientId: string; appointmentId?: string | null; initial?: Injection; onClose: () => void }) {
  const { run, busy } = useRun();
  const [date, setDate] = useState(initial?.date ?? todayYmd());
  const [s, setS] = useState<InjectionSheet>(() => {
    if (initial) return norm(initial.sheet);
    // التشخيص من آخر تشخيص للمريض (يتعدّل) + توقيع باسم الطبيب
    const last = ortho.list('consultations', patientId).sort((a, b) => b.date.localeCompare(a.date))[0];
    return { ...emptyInjection(), diagnosis: last?.diagnosis ?? '', signature: DOCTOR.name };
  });
  const set = <K extends keyof InjectionSheet>(k: K, v: InjectionSheet[K]) => setS((x) => ({ ...x, [k]: v }));
  const setMat = (i: number, k: keyof InjectionSheet['materials'][number], v: string) => setS((x) => ({ ...x, materials: x.materials.map((m, j) => (j === i ? { ...m, [k]: v } : m)) }));
  const item = { id: initial?.id, patientId, appointmentId: initial ? initial.appointmentId ?? null : appointmentId, date, sheet: { ...s, materials: s.materials.filter((m) => m.drug.trim() || m.dose.trim() || m.batch.trim() || m.expiry.trim()) } };
  const save = (print: boolean) => {
    const win = print ? openPrintWindow() : undefined;
    run(() => ortho.save('injections', item), 'تم حفظ سجل الحقن', () => { if (print) printInjection(item, win); onClose(); });
  };
  const p = db.patient(patientId);
  return (
    <Modal xl title={initial ? 'تعديل سجل الحقن' : 'سجل حقن جديد — INJECTION RECORD'} onClose={onClose} footer={<>
      <Button variant="outline" onClick={onClose}>إلغاء</Button>
      <Button variant="outline" icon="print" loading={busy} onClick={() => save(true)}>حفظ وطباعة</Button>
      <Button icon="check" loading={busy} onClick={() => save(false)}>حفظ</Button>
    </>}>
      <div className="inj-sheet" dir="ltr">
      <header className="inj-letter">
        <div dir="ltr"><small>Doctor</small><b>Islam Gomaa Beltagy</b><span>Consultant of Orthopedic Surgery</span></div>
        <img src={`${import.meta.env.BASE_URL}brand/logo.svg`} alt="" />
        <div dir="rtl"><small>دكتور</small><b>{DOCTOR.name}</b><span>{DOCTOR.title}</span></div>
      </header>
      <div className="inj-title" dir="ltr"><span className="inj-title__ic"><Icon name="target" size={26} /></span><b>INJECTION RECORD</b><small>MSK Injection Documentation</small></div>
      <Box title="Patient Information" icon="user">
        <div className="grid-form grid-form--3">
          <Field label="Name"><input className="input" value={`${p?.fullName ?? ''} — File ${fileNoText(p?.fileNo)}`} readOnly /></Field>
          <Field label="Date"><input type="date" className="input" value={date} onChange={(e) => setDate(e.target.value)} /></Field>
          <Field label="Phone"><input className="input" dir="ltr" value={p?.phone ?? ''} readOnly /></Field>
        </div>
      </Box>
      <Box title="Diagnosis" icon="clipboard">
        <input className="input" dir="auto" aria-label="Diagnosis" value={s.diagnosis} onChange={(e) => set('diagnosis', e.target.value)} />
      </Box>
      <div className="inj-grid inj-grid--3">
        <Box title="Injection Site / Region" icon="pin">
          <Multi options={L.site} value={s.site} onChange={(v) => set('site', v)} />
          <T label="Other" value={s.siteOther} onChange={(v) => set('siteOther', v)} />
          <div className="field"><label>Side</label><One options={L.side} value={s.side} onChange={(v) => set('side', v)} /></div>
        </Box>
        <Box title="Target Structure" icon="target">
          <Multi options={L.target} value={s.target} onChange={(v) => set('target', v)} />
          <T label="Other" value={s.targetOther} onChange={(v) => set('targetOther', v)} />
        </Box>
        <Box title="Injection Type / Injectate" icon="spark">
          <Multi options={L.type} value={s.type} onChange={(v) => set('type', v)} />
          <T label="Combination" value={s.combination} onChange={(v) => set('combination', v)} />
          <T label="Other" value={s.typeOther} onChange={(v) => set('typeOther', v)} />
        </Box>
      </div>
      <div className="inj-grid inj-grid--3">
        <Box title="Injection Technique" icon="scan">
          <One options={L.technique} value={s.technique} onChange={(v) => set('technique', v)} />
          <div className="grid-form">
            <T label="Approach" value={s.approach} onChange={(v) => set('approach', v)} />
            <T label="Patient Position" value={s.position} onChange={(v) => set('position', v)} />
            <T label="Needle Size" value={s.needle} onChange={(v) => set('needle', v)} />
            <T label="Syringe Size" value={s.syringe} onChange={(v) => set('syringe', v)} />
          </div>
        </Box>
      <Box title="Injected Material Details" icon="box">
        <div className="cx-rows">
          {s.materials.map((m, i) => (
            <div className="cx-row" key={i} style={{ gridTemplateColumns: 'minmax(0,1.6fr) minmax(0,1fr) minmax(0,1fr) minmax(0,1fr) auto' }}>
              <input className="input" placeholder="Material / Drug" value={m.drug} onChange={(e) => setMat(i, 'drug', e.target.value)} />
              <input className="input" placeholder="Dose / Volume" value={m.dose} onChange={(e) => setMat(i, 'dose', e.target.value)} />
              <input className="input" placeholder="Batch No." value={m.batch} onChange={(e) => setMat(i, 'batch', e.target.value)} />
              <input className="input" placeholder="Expiry Date" value={m.expiry} onChange={(e) => setMat(i, 'expiry', e.target.value)} />
              <IconBtn icon="trash" label="حذف" danger onClick={() => set('materials', s.materials.length > 1 ? s.materials.filter((_, j) => j !== i) : [{ drug: '', dose: '', batch: '', expiry: '' }])} />
            </div>
          ))}
        </div>
        <Button size="sm" variant="outline" icon="plus" onClick={() => set('materials', [...s.materials, { drug: '', dose: '', batch: '', expiry: '' }])}>Add row</Button>
      </Box>
        <Box title="Pre-injection Assessment / Consent" icon="doc">
          <Multi options={L.consent} value={s.consent} onChange={(v) => set('consent', v)} />
          <T label="Notes" value={s.consentNotes} onChange={(v) => set('consentNotes', v)} area />
        </Box>
      </div>
      <div className="inj-grid">
        <Box title="Aseptic & Procedure Notes" icon="settings">
          <label className="sh-ck" style={{ display: 'flex', gap: 6 }}><input type="checkbox" checked={s.aseptic} onChange={(e) => set('aseptic', e.target.checked)} /> Aseptic preparation done</label>
          <label className="sh-ck" style={{ display: 'flex', gap: 6 }}><input type="checkbox" checked={s.usConfirm} onChange={(e) => set('usConfirm', e.target.checked)} /> Ultrasound findings / target confirmation</label>
          <T label="Ultrasound findings" value={s.usFindings} onChange={(v) => set('usFindings', v)} />
          <T label="Procedure notes" value={s.procedureNotes} onChange={(v) => set('procedureNotes', v)} area />
          <T label="Immediate response" value={s.immediate} onChange={(v) => set('immediate', v)} />
        </Box>
        <Box title="Outcome & Follow-up" icon="trend">
          <div className="field"><label>Complications</label><One options={L.none} value={s.complications} onChange={(v) => set('complications', v)} /></div>
          {s.complications === 'Yes' && <T label="Complications details" value={s.complicationsText} onChange={(v) => set('complicationsText', v)} />}
          <div className="field"><label>Post-injection instructions given</label><One options={L.yesNo} value={s.instructions} onChange={(v) => set('instructions', v)} /></div>
          <T label="Planned follow-up" value={s.plannedFollowUp} onChange={(v) => set('plannedFollowUp', v)} />
          <T label="Response at follow-up" value={s.response} onChange={(v) => set('response', v)} />
          <T label="Further treatment plan" value={s.furtherPlan} onChange={(v) => set('furtherPlan', v)} />
        </Box>
        <Box title="Doctor's Signature / Additional Notes" icon="edit">
          <T label="Doctor's Signature" value={s.signature} onChange={(v) => set('signature', v)} />
          <T label="Additional Notes" value={s.notes} onChange={(v) => set('notes', v)} area />
        </Box>
      </div>
      </div>
    </Modal>
  );
}

const summary = (s: InjectionSheet) => [
  [...s.site, s.siteOther].filter(Boolean).join(', ') + (s.side ? ` (${s.side})` : ''),
  [...s.type, s.combination && `Combination: ${s.combination}`, s.typeOther].filter(Boolean).join(', '),
  s.technique,
].filter(Boolean).join(' · ');

export function InjectionList({ items, onEdit, showPatient }: { items: Injection[]; onEdit: (n: Injection) => void; showPatient?: boolean }) {
  const { run } = useRun();
  const perm = useClinicalCan();
  if (!items.length) return <EmptyState icon="target" title="لا توجد سجلات حقن" text="سجل الحقن بيتملى مع كل حقنة (مكانها ونوع المادة والتقنية والمتابعة)." />;
  return (
    <div className="dx-queue">
      {items.map((n) => { const s = norm(n.sheet); return (
        <div className="dx-queue__row" key={n.id}>
          <span className="dx-queue__time num">{fmtDate(n.date)}</span>
          <div className="dx-queue__who">
            {showPatient && <b>{db.patient(n.patientId)?.fullName ?? '—'} <span className="muted-sm">ملف {fileNoText(db.patient(n.patientId)?.fileNo)}</span></b>}
            <b dir="ltr" style={{ textAlign: 'start' }}>{summary(s) || 'حقنة'}</b>
            <small>{s.diagnosis || '—'}{s.complications === 'Yes' ? ' · مضاعفات' : ''}</small>
          </div>
          <span />
          <span className="dx-queue__act">
            <IconBtn icon="print" label="طباعة" onClick={() => printInjection(n)} />
            {perm.edit && <IconBtn icon="edit" label="تعديل" onClick={() => onEdit(n)} />}
            {perm.del && <IconBtn icon="trash" label="حذف" danger onClick={() => confirmDelete('سجل الحقن ده') && run(() => ortho.remove('injections', n.id), 'تم الحذف')} />}
          </span>
        </div>
      ); })}
    </div>
  );
}

// ---------- الطباعة: A4 بنفس ترتيب الشيت الورقي (المتعلّم ☑ والباقي ☐) ----------
const esc = (v: unknown) => String(v ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]!));
const cks = (opts: string[], on: string[] | string) => opts.map((o) => { const y = Array.isArray(on) ? on.includes(o) : on === o; return `<span class="ck ${y ? 'on' : ''}">${y ? '☑' : '☐'} ${esc(o)}</span>`; }).join('');
const ln = (s: string) => (s ? `<b>${esc(s)}</b>` : '<span class="ln"></span>');
function ageOf(b?: string | null) { if (!b) return ''; const d = new Date(b + 'T00:00:00'); if (isNaN(d.getTime())) return ''; const n = new Date(); let y = n.getFullYear() - d.getFullYear(); if (n < new Date(n.getFullYear(), d.getMonth(), d.getDate())) y--; return y >= 0 ? String(y) : ''; }

export function injectionHtml(n: Omit<Injection, 'id'>): string {
  const s = norm(n.sheet);
  const p = db.patient(n.patientId);
  const mats = (s.materials.length ? s.materials : [{ drug: '', dose: '', batch: '', expiry: '' }]);
  const rows = [...mats, ...Array.from({ length: Math.max(0, 3 - mats.length) }, () => ({ drug: '', dose: '', batch: '', expiry: '' }))];
  return `<!doctype html><html lang="en" dir="ltr"><head><meta charset="utf-8"><title>Injection Record — ${esc(p?.fullName)}</title>
<link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=IBM+Plex+Sans:wght@400;600;700&family=IBM+Plex+Sans+Arabic:wght@400;600;700&display=swap">
<style>
  @page { size: A4; margin: 9mm; }
  * { box-sizing: border-box; }
  body { margin: 0; font-family: "IBM Plex Sans", "IBM Plex Sans Arabic", Tahoma, sans-serif; color: #10182f; font-size: 11.5px; line-height: 1.5; }
  header { display: flex; justify-content: space-between; align-items: center; border-bottom: 3px solid #1b5fb4; padding-bottom: 6px; }
  header .ar { direction: rtl; text-align: right; font-family: "IBM Plex Sans Arabic", Tahoma, sans-serif; }
  header h1 { margin: 0; font-size: 18px; color: #d6202a; } header .dr { color: #1b5fb4; font-size: 13px; font-weight: 700; } header .t { color: #475569; font-size: 11px; }
  .bar { background: #1b5fb4; color: #fff; border-radius: 8px; padding: 6px 12px; margin: 8px 0 6px; display: flex; justify-content: space-between; align-items: center; font-weight: 700; font-size: 17px; }
  .bar small { font-size: 12px; font-weight: 600; opacity: .9; }
  body { -webkit-print-color-adjust: exact; print-color-adjust: exact; }
  .sec { background: #fff; border: 1px solid #9fbde6; border-radius: 8px; padding: 6px 9px; margin-bottom: 6px; break-inside: avoid; }
  .sec > b.h { display: block; color: #fff; background: #1b5fb4; margin: -6px -9px 5px; padding: 3px 9px; border-radius: 7px 7px 0 0; }
  .row { display: grid; gap: 6px; } .c2 { grid-template-columns: 1fr 1fr; } .c3 { grid-template-columns: repeat(3, 1fr); }
  .ck { display: inline-block; margin-inline-end: 12px; white-space: nowrap; color: #475569; } .ck.on { color: #10182f; font-weight: 700; }
  .ln { display: inline-block; min-width: 120px; border-bottom: 1px dotted #64748b; height: 1em; }
  .txt { min-height: 30px; border-bottom: 1px dotted #64748b; white-space: pre-wrap; }
  table { width: 100%; border-collapse: collapse; } th, td { border: 1px solid #9fbde6; padding: 3px 5px; height: 18px; } th { background: #eef4fb; color: #1b5fb4; }
  footer { margin-top: 8px; border-top: 1px solid #cbd5e1; padding-top: 4px; font-size: 10.5px; color: #64748b; display: flex; justify-content: space-between; }
</style></head><body>
<header><div><div class="dr">Doctor</div><h1> Islam Gomaa Beltagy</h1><div class="t">Consultant of Orthopedic Surgery</div></div><div class="ar"><div class="dr">دكتور</div><h1>${esc(DOCTOR.name)}</h1><div class="t">${esc(DOCTOR.title)}</div></div></header>
<div class="bar">INJECTION RECORD <small>MSK Injection Documentation</small></div>
<div class="sec"><b class="h">Patient Information</b><div class="row c3">
  <div>Name: ${ln(p?.fullName ?? '')}</div><div>Age: ${ln(ageOf(p?.birthDate))}</div><div>Gender: ${cks(['M', 'F'], p?.genderUnknown ? '' : p?.gender === 'male' ? 'M' : p?.gender === 'female' ? 'F' : '')}</div>
  <div>File No.: ${ln(fileNoText(p?.fileNo))}</div><div>Date: ${ln(fmtDate(n.date))}</div><div>Phone: ${ln(p?.phone ?? '')}</div>
  <div style="grid-column:1/-1">Address: ${ln(p?.address ?? '')}</div></div></div>
<div class="sec"><b class="h">Diagnosis</b><div class="txt">${esc(s.diagnosis)}</div></div>
<div class="row c3">
  <div class="sec"><b class="h">Injection Site / Region</b>${cks(L.site, s.site)}<div>Other: ${ln(s.siteOther)}</div><div>Side: ${cks(L.side, s.side)}</div></div>
  <div class="sec"><b class="h">Target Structure</b>${cks(L.target, s.target)}<div>Other: ${ln(s.targetOther)}</div></div>
  <div class="sec"><b class="h">Injection Type / Injectate</b>${cks(L.type, s.type)}<div>Combination: ${ln(s.combination)}</div><div>Other: ${ln(s.typeOther)}</div></div>
</div>
<div class="row c3">
  <div class="sec"><b class="h">Injection Technique</b>${cks(L.technique, s.technique)}<div>Approach: ${ln(s.approach)}</div><div>Patient Position: ${ln(s.position)}</div><div>Needle Size: ${ln(s.needle)}</div><div>Syringe Size: ${ln(s.syringe)}</div></div>
  <div class="sec"><b class="h">Injected Material Details</b><table><thead><tr><th>Material / Drug</th><th>Dose / Volume</th><th>Batch No.</th><th>Expiry Date</th></tr></thead><tbody>${rows.map((m) => `<tr><td>${esc(m.drug)}</td><td>${esc(m.dose)}</td><td>${esc(m.batch)}</td><td>${esc(m.expiry)}</td></tr>`).join('')}</tbody></table></div>
  <div class="sec"><b class="h">Pre-injection Assessment / Consent</b>${cks(L.consent, s.consent)}<div>Notes:</div><div class="txt">${esc(s.consentNotes)}</div></div>
</div>
<div class="row c2">
  <div class="sec"><b class="h">Aseptic &amp; Procedure Notes</b>${cks(['Aseptic preparation done'], s.aseptic ? 'Aseptic preparation done' : '')}<br>${cks(['Ultrasound findings / target confirmation'], s.usConfirm ? 'Ultrasound findings / target confirmation' : '')} ${ln(s.usFindings)}<div>Procedure notes:</div><div class="txt">${esc(s.procedureNotes)}</div><div>Immediate response: ${ln(s.immediate)}</div></div>
  <div class="sec"><b class="h">Outcome &amp; Follow-up</b><div>Complications: ${cks(L.none, s.complications)} ${s.complications === 'Yes' ? ln(s.complicationsText) : ''}</div><div>Post-injection instructions given: ${cks(L.yesNo, s.instructions)}</div><div>Planned follow-up: ${ln(s.plannedFollowUp)}</div><div>Response at follow-up: ${ln(s.response)}</div><div>Further treatment plan: ${ln(s.furtherPlan)}</div></div>
</div>
<div class="row c2">
  <div class="sec"><b class="h">Doctor's Signature</b>Doctor's Signature: ${ln(s.signature)}</div>
  <div class="sec"><b class="h">Additional Notes</b><div class="txt">${esc(s.notes)}</div></div>
</div>
<footer><span>Desouk - Kafr El-Sheikh Orthopedic Clinic</span><span>Thank you for your trust</span></footer>
</body></html>`;
}

export function printInjection(n: Omit<Injection, 'id'>, win?: Window | null) {
  void printHtml(injectionHtml(n), win === undefined ? openPrintWindow() : win);
}
