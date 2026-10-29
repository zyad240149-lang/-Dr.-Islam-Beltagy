// شيت متابعة التمريض + الروشتة والأشعة والتحاليل (نفس الشيت الورقي «يُملأ في كل زيارة متابعة»): الألم والالتزام والحركة والأعراض والعلاج الحالي،
// وقسم الجبس وقسم العمليات بيتفتحوا بس لو المريض عنده جبس/عملية. بيتحفظ في ortho_nursing ويتطبع A4 بنفس ترتيب الورقة.
import { useState, type ReactNode } from 'react';
import { Button, EmptyState, Modal } from '../components/ui';
import { db } from '../data/db';
import { DOCTOR } from '../landing/content';
import { fmtDate, todayYmd } from '../utils/format';
import { fileNoText } from '../utils/phoneUtils';
import { openPrintWindow, printHtml } from '../utils/printDoc';
import { ortho, type Nursing, type NursingSheet, type RxData } from './data';
import { RxEditor, cleanRx, hasRx, normRx, registerRxRequests } from './Rx';
import { printRx } from './printRx';
import { Field, IconBtn, confirmDelete, useClinicalCan, useRun } from './kit';

const OPT = {
  adherence: ['جيد', 'متوسط', 'ضعيف'],
  mobility: ['تحسنت', 'كما هي', 'أسوأ'],
  vsLast: ['أقل', 'كما هو', 'أكثر'],
  newSymptoms: ['لا', 'نعم'],
  treatment: ['مستمر', 'توقف', 'غير ملتزم'],
  castType: ['جبس كامل', 'جبس نصفي', 'جبيرة', 'أخرى'],
  limb: ['علوي أيمن', 'علوي أيسر', 'سفلي أيمن', 'سفلي أيسر'],
  castCond: ['جيد', 'متسخ', 'مرتخي', 'مشروخ', 'أخرى'],
  wound: ['جيد', 'يلتئم', 'إفرازات', 'احمرار', 'أخرى'],
  dressing: ['تم اليوم', 'غير مطلوب', 'تم توجيه المريض'],
  bandage: ['جافة', 'مبللة', 'تم تغييرها', 'لم يتم تغييرها'],
};

export const emptyNursing = (): NursingSheet => ({
  visitNo: '', pain: '', adherence: '', mobility: '', vsLast: '', newSymptoms: '', symptomsDetails: '', treatment: '', treatmentNotes: '', notes: '',
  cast: { on: false, type: '', typeOther: '', limb: '', applied: '', followUp: '', condition: '', conditionOther: '', notes: '' },
  surgery: { on: false, procedure: '', date: '', followUp: '', wound: '', woundOther: '', dressing: '', bandage: '', notes: '' },
});
// سجلات قديمة/ناقصة: أي بند مش موجود بياخد القيمة الفاضية
const norm = (s?: Partial<NursingSheet>): NursingSheet => { const e = emptyNursing(); return { ...e, ...s, cast: { ...e.cast, ...s?.cast }, surgery: { ...e.surgery, ...s?.surgery } }; };

function Pick({ options, value, onChange }: { options: string[]; value: string; onChange: (v: string) => void }) {
  return (
    <div className="cx-chips" role="radiogroup">
      {options.map((o) => <button key={o} type="button" role="radio" aria-checked={value === o} className={`cx-chip ${value === o ? 'is-on' : ''}`} onClick={() => onChange(value === o ? '' : o)}>{o}</button>)}
    </div>
  );
}
const Box = ({ title, children, on, onToggle }: { title: string; children: ReactNode; on?: boolean; onToggle?: (v: boolean) => void }) => (
  <fieldset className="card" style={{ padding: 14, margin: '0 0 12px', border: '1px solid var(--line, #e2e8f0)' }}>
    <legend style={{ fontWeight: 700, padding: '0 6px' }}>
      {onToggle ? <label style={{ display: 'inline-flex', gap: 8, alignItems: 'center', cursor: 'pointer' }}><input type="checkbox" checked={!!on} onChange={(e) => onToggle(e.target.checked)} />{title}</label> : title}
    </legend>
    {(!onToggle || on) && children}
  </fieldset>
);

export function NursingModal({ patientId, appointmentId = null, initial, onClose }: { patientId: string; appointmentId?: string | null; initial?: Nursing; onClose: () => void }) {
  const { run, busy } = useRun();
  const visitNo = appointmentId ? String(db.appointments().find((a) => a.id === appointmentId)?.no ?? '') : '';
  const [date, setDate] = useState(initial?.date ?? todayYmd());
  const [s, setS] = useState<NursingSheet>(() => initial ? norm(initial.sheet) : { ...emptyNursing(), visitNo });
  const set = <K extends keyof NursingSheet>(k: K, v: NursingSheet[K]) => setS((x) => ({ ...x, [k]: v }));
  const setCast = (k: keyof NursingSheet['cast'], v: string | boolean) => setS((x) => ({ ...x, cast: { ...x.cast, [k]: v } }));
  const setSurg = (k: keyof NursingSheet['surgery'], v: string | boolean) => setS((x) => ({ ...x, surgery: { ...x.surgery, [k]: v } }));
  const [rx, setRx] = useState<RxData>(() => normRx(initial?.sheet.rx));
  const [uploading, setUploading] = useState(false);
  const item = { id: initial?.id, patientId, appointmentId: initial ? initial.appointmentId ?? null : appointmentId, date, sheet: { ...s, rx: cleanRx(rx) } };
  const save = (print: 'sheet' | 'rx' | null) => {
    const win = print ? openPrintWindow() : undefined;
    run(async () => {
      await ortho.save('nursing', item);
      await registerRxRequests(patientId, date, item.sheet.rx, initial ? normRx(initial.sheet.rx) : undefined);
      if (initial) { // صور اتشالت من الشيت ← بتتمسح من التخزين
        const now = new Set(rx.attachments.map((a) => a.path));
        normRx(initial.sheet.rx).attachments.filter((a) => !now.has(a.path)).forEach((a) => void ortho.removeAttachment(a.path));
      }
    }, 'تم حفظ شيت المتابعة', () => {
      if (print === 'sheet') printNursing(item, win); else if (print === 'rx') printNursingRx(item, win);
      onClose();
    });
  };
  // إلغاء: الصور اللي اترفعت في الجلسة دي ومش هتتحفظ بتتمسح
  const cancel = () => {
    const keep = new Set(normRx(initial?.sheet.rx).attachments.map((a) => a.path));
    rx.attachments.filter((a) => !keep.has(a.path)).forEach((a) => void ortho.removeAttachment(a.path));
    onClose();
  };
  return (
    <Modal wide title={initial ? 'تعديل شيت متابعة التمريض' : 'شيت متابعة التمريض'} onClose={cancel} footer={<>
      <Button variant="outline" onClick={cancel}>إلغاء</Button>
      <Button variant="outline" icon="print" loading={busy} disabled={uploading} onClick={() => save('sheet')}>حفظ وطباعة الشيت</Button>
      <Button variant="outline" icon="print" loading={busy} disabled={uploading || !hasRx(cleanRx(rx))} onClick={() => save('rx')}>حفظ وطباعة الروشتة</Button>
      <Button icon="check" loading={busy} disabled={uploading} onClick={() => save(null)}>حفظ</Button>
    </>}>
      <div className="grid-form grid-form--3" style={{ marginBottom: 12 }}>
        <Field label="المريض"><input className="input" value={db.patient(patientId)?.fullName ?? ''} disabled /></Field>
        <Field label="التاريخ"><input type="date" className="input" value={date} onChange={(e) => setDate(e.target.value)} /></Field>
        <Field label="رقم الزيارة"><input className="input num" value={s.visitNo} onChange={(e) => set('visitNo', e.target.value)} /></Field>
      </div>

      <Box title="درجة الألم حاليًا (من 10)">
        <div className="cx-chips" role="radiogroup">
          {Array.from({ length: 11 }, (_, n) => <button key={n} type="button" role="radio" aria-checked={s.pain === n} className={`cx-chip num ${s.pain === n ? 'is-on' : ''}`} onClick={() => set('pain', s.pain === n ? '' : n)}>{n}</button>)}
        </div>
        <small className="muted">0 = لا يوجد ألم · 10 = أشد ألم</small>
      </Box>
      <div className="grid-form grid-form--3">
        <Field label="الالتزام بالعلاج"><Pick options={OPT.adherence} value={s.adherence} onChange={(v) => set('adherence', v)} /></Field>
        <Field label="الحركة / الوظيفة"><Pick options={OPT.mobility} value={s.mobility} onChange={(v) => set('mobility', v)} /></Field>
        <Field label="الألم مقارنة بآخر زيارة"><Pick options={OPT.vsLast} value={s.vsLast} onChange={(v) => set('vsLast', v)} /></Field>
      </div>
      <Box title="أعراض أو مشكلة جديدة؟">
        <Pick options={OPT.newSymptoms} value={s.newSymptoms} onChange={(v) => set('newSymptoms', v)} />
        {s.newSymptoms === 'نعم' && <textarea className="input" rows={2} style={{ marginTop: 8 }} placeholder="التفاصيل" value={s.symptomsDetails} onChange={(e) => set('symptomsDetails', e.target.value)} />}
      </Box>
      <div className="grid-form">
        <Box title="العلاج الحالي">
          <Pick options={OPT.treatment} value={s.treatment} onChange={(v) => set('treatment', v)} />
          <textarea className="input" rows={2} style={{ marginTop: 8 }} placeholder="ملاحظات" value={s.treatmentNotes} onChange={(e) => set('treatmentNotes', e.target.value)} />
        </Box>
        <Box title="ملاحظات التمريض"><textarea className="input" rows={4} value={s.notes} onChange={(e) => set('notes', e.target.value)} /></Box>
      </div>

      <Box title="حالات الجبس — المريض عنده جبس" on={s.cast.on} onToggle={(v) => setCast('on', v)}>
        <div className="grid-form">
          <Field label="نوع الجبس"><Pick options={OPT.castType} value={s.cast.type} onChange={(v) => setCast('type', v)} />{s.cast.type === 'أخرى' && <input className="input" style={{ marginTop: 6 }} value={s.cast.typeOther} onChange={(e) => setCast('typeOther', e.target.value)} />}</Field>
          <Field label="الطرف"><Pick options={OPT.limb} value={s.cast.limb} onChange={(v) => setCast('limb', v)} /></Field>
          <Field label="تاريخ التركيب"><input type="date" className="input" value={s.cast.applied} onChange={(e) => setCast('applied', e.target.value)} /></Field>
          <Field label="تاريخ المتابعة"><input type="date" className="input" value={s.cast.followUp} onChange={(e) => setCast('followUp', e.target.value)} /></Field>
          <Field label="حالة الجبس" className="span-2"><Pick options={OPT.castCond} value={s.cast.condition} onChange={(v) => setCast('condition', v)} />{s.cast.condition === 'أخرى' && <input className="input" style={{ marginTop: 6 }} value={s.cast.conditionOther} onChange={(e) => setCast('conditionOther', e.target.value)} />}</Field>
          <Field label="ملاحظات" className="span-2"><input className="input" value={s.cast.notes} onChange={(e) => setCast('notes', e.target.value)} /></Field>
        </div>
      </Box>
      <Box title="حالات العمليات — المريض عامل عملية" on={s.surgery.on} onToggle={(v) => setSurg('on', v)}>
        <div className="grid-form">
          <Field label="نوع العملية" className="span-2"><input className="input" value={s.surgery.procedure} onChange={(e) => setSurg('procedure', e.target.value)} /></Field>
          <Field label="تاريخ العملية"><input type="date" className="input" value={s.surgery.date} onChange={(e) => setSurg('date', e.target.value)} /></Field>
          <Field label="تاريخ المتابعة"><input type="date" className="input" value={s.surgery.followUp} onChange={(e) => setSurg('followUp', e.target.value)} /></Field>
          <Field label="حالة الجرح" className="span-2"><Pick options={OPT.wound} value={s.surgery.wound} onChange={(v) => setSurg('wound', v)} />{s.surgery.wound === 'أخرى' && <input className="input" style={{ marginTop: 6 }} value={s.surgery.woundOther} onChange={(e) => setSurg('woundOther', e.target.value)} />}</Field>
          <Field label="الغيار"><Pick options={OPT.dressing} value={s.surgery.dressing} onChange={(v) => setSurg('dressing', v)} /></Field>
          <Field label="الضمادات"><Pick options={OPT.bandage} value={s.surgery.bandage} onChange={(v) => setSurg('bandage', v)} /></Field>
          <Field label="ملاحظات" className="span-2"><input className="input" value={s.surgery.notes} onChange={(e) => setSurg('notes', e.target.value)} /></Field>
        </div>
      </Box>

      <Box title="الروشتة والأشعة والتحاليل">
        <RxEditor value={rx} onChange={setRx} patientId={patientId} region={ortho.list('consultations', patientId).sort((a, b) => b.date.localeCompare(a.date))[0]?.region} onUploading={setUploading} />
      </Box>
    </Modal>
  );
}

// الروشتة بتاخد التشخيص من آخر كشف للمريض
export function printNursingRx(n: Omit<Nursing, 'id'>, win?: Window | null) {
  const last = ortho.list('consultations', n.patientId).sort((a, b) => b.date.localeCompare(a.date))[0];
  const rx = normRx(n.sheet.rx);
  printRx({ diagnosis: last?.diagnosis ?? '', icd10: last?.icd10 ?? '', region: last?.region ?? '', side: last?.side ?? 'na',
    complaint: '', history: '', examination: '', painScore: '', followUp: '', ...rx, date: n.date } as Parameters<typeof printRx>[0], db.patient(n.patientId), win);
}

const summary = (s: NursingSheet) => [
  s.pain !== '' && `الألم ${s.pain}/10`, s.vsLast && `مقارنة بآخر زيارة: ${s.vsLast}`, s.mobility && `الحركة: ${s.mobility}`, s.adherence && `الالتزام: ${s.adherence}`,
  s.newSymptoms === 'نعم' && 'أعراض جديدة', s.cast.on && 'جبس', s.surgery.on && 'عملية', hasRx(normRx(s.rx)) && 'روشتة',
].filter(Boolean).join(' · ');

export function NursingList({ items, onEdit }: { items: Nursing[]; onEdit: (n: Nursing) => void }) {
  const { run } = useRun();
  const perm = useClinicalCan();
  if (!items.length) return <EmptyState icon="clipboard" title="لا توجد شيتات متابعة" text="شيت متابعة التمريض بيتملى في كل زيارة متابعة." />;
  return (
    <div className="dx-queue">
      {items.map((n) => { const s = norm(n.sheet); return (
        <div className="dx-queue__row" key={n.id}>
          <span className="dx-queue__time num">{fmtDate(n.date)}</span>
          <div className="dx-queue__who">
            <b>{s.visitNo ? <>زيارة <span className="num">{s.visitNo}</span></> : 'متابعة'}</b>
            <small>{summary(s) || '—'}</small>
            {s.notes && <small>{s.notes}</small>}
          </div>
          <span />
          <span className="dx-queue__act">
            <IconBtn icon="print" label="طباعة" onClick={() => printNursing(n)} />
            {hasRx(normRx(s.rx)) && <IconBtn icon="receipt" label="طباعة الروشتة" onClick={() => printNursingRx(n)} />}
            {perm.edit && <IconBtn icon="edit" label="تعديل" onClick={() => onEdit(n)} />}
            {perm.del && <IconBtn icon="trash" label="حذف" danger onClick={() => confirmDelete('شيت المتابعة ده') && run(() => ortho.remove('nursing', n.id), 'تم الحذف')} />}
          </span>
        </div>
      ); })}
    </div>
  );
}

// ---------- الطباعة: A4 بنفس ترتيب الشيت الورقي (المتعلّم ☑ والباقي ☐) ----------
const esc = (v: unknown) => String(v ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]!));
const box = (opts: string[], v: string, other = '') => opts.map((o) => `<span class="ck ${v === o ? 'on' : ''}">${v === o ? '☑' : '☐'} ${esc(o)}${o === 'أخرى' && v === o && other ? `: ${esc(other)}` : ''}</span>`).join('');
const d = (s: string) => (s ? esc(fmtDate(s)) : '<span class="ln"></span>');
const val = (s: string) => (s ? esc(s) : '<span class="ln"></span>');

export function nursingHtml(n: Omit<Nursing, 'id'>): string {
  const s = norm(n.sheet);
  const p = db.patient(n.patientId);
  const pain = Array.from({ length: 11 }, (_, i) => `<span class="pn ${s.pain === i ? 'on' : ''}">${i}</span>`).join('');
  return `<!doctype html><html lang="ar" dir="rtl"><head><meta charset="utf-8"><title>شيت متابعة التمريض — ${esc(p?.fullName)}</title>
<link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=IBM+Plex+Sans+Arabic:wght@400;600;700&display=swap">
<style>
  @page { size: A4; margin: 10mm; }
  * { box-sizing: border-box; }
  body { margin: 0; font-family: "IBM Plex Sans Arabic", Tahoma, sans-serif; color: #10182f; font-size: 12.5px; line-height: 1.55; }
  header { display: flex; justify-content: space-between; align-items: flex-end; border-bottom: 3px solid #1b4f8f; padding-bottom: 6px; }
  header h1 { margin: 0; font-size: 20px; color: #1b4f8f; } header .t { color: #475569; }
  .bar { background: #1b4f8f; color: #fff; border-radius: 8px; padding: 6px 12px; margin: 10px 0 6px; display: flex; justify-content: space-between; align-items: center; font-weight: 700; font-size: 15px; }
  .bar small { background: #6cc04a; color: #10182f; border-radius: 6px; padding: 1px 10px; font-size: 12px; }
  .sec { border: 1px solid #b9cbe4; border-radius: 8px; padding: 8px 10px; margin-bottom: 8px; }
  .row { display: grid; gap: 6px 14px; } .c2 { grid-template-columns: 1fr 1fr; } .c3 { grid-template-columns: repeat(3, 1fr); } .c4 { grid-template-columns: repeat(4, 1fr); }
  b.h { display: block; color: #1b4f8f; margin-bottom: 3px; }
  .ck { display: inline-block; margin-inline-end: 14px; white-space: nowrap; color: #475569; } .ck.on { color: #10182f; font-weight: 700; }
  .pn { display: inline-block; width: 22px; text-align: center; border: 1px solid #94a3b8; margin-inline-end: 2px; border-radius: 3px; }
  .pn.on { background: #1b4f8f; color: #fff; border-color: #1b4f8f; font-weight: 700; }
  .ln { display: inline-block; min-width: 110px; border-bottom: 1px dotted #64748b; height: 1em; }
  .txt { min-height: 38px; border-bottom: 1px dotted #64748b; white-space: pre-wrap; }
  footer { margin-top: 10px; border-top: 1px solid #cbd5e1; padding-top: 4px; font-size: 11px; color: #64748b; display: flex; justify-content: space-between; }
</style></head><body>
<header><div><h1>${esc(DOCTOR.name)}</h1><div class="t">${esc(DOCTOR.title)}</div></div><div class="t">حركة أفضل .. حياة أفضل</div></header>
<div class="bar">شيت متابعة التمريض <small>تمريض فقط</small></div>
<div class="sec row c2">
  <div>اسم المريض: <b>${val(p?.fullName ?? '')}</b></div><div>التاريخ: <b>${d(n.date)}</b></div>
  <div>رقم الملف: <b>${val(fileNoText(p?.fileNo))}</b></div><div>رقم الزيارة: <b>${val(s.visitNo)}</b></div>
</div>
<div class="sec row c4">
  <div><b class="h">الالتزام بالعلاج</b>${box(OPT.adherence, s.adherence)}</div>
  <div><b class="h">الحركة / الوظيفة</b>${box(OPT.mobility, s.mobility)}</div>
  <div><b class="h">مقارنة بآخر زيارة</b>${box(OPT.vsLast, s.vsLast)}</div>
  <div><b class="h">درجة الألم حاليًا (من 10)</b><div dir="ltr">${pain}</div></div>
</div>
<div class="sec"><b>أعراض أو مشكلة جديدة؟</b> ${box(OPT.newSymptoms, s.newSymptoms)} — التفاصيل: ${val(s.symptomsDetails)}</div>
<div class="row c2">
  <div class="sec"><b class="h">العلاج الحالي</b>${box(OPT.treatment, s.treatment)}<div class="txt">${esc(s.treatmentNotes)}</div></div>
  <div class="sec"><b class="h">ملاحظات التمريض</b><div class="txt">${esc(s.notes)}</div></div>
</div>
<div class="bar">شيت حالات الجبس <small>تمريض فقط</small></div>
<div class="sec">
  <div><b>نوع الجبس:</b> ${box(OPT.castType, s.cast.on ? s.cast.type : '', s.cast.typeOther)}</div>
  <div><b>الطرف:</b> ${box(OPT.limb, s.cast.on ? s.cast.limb : '')}</div>
  <div class="row c2"><div><b>تاريخ التركيب:</b> ${d(s.cast.on ? s.cast.applied : '')}</div><div><b>تاريخ المتابعة:</b> ${d(s.cast.on ? s.cast.followUp : '')}</div></div>
  <div><b>حالة الجبس:</b> ${box(OPT.castCond, s.cast.on ? s.cast.condition : '', s.cast.conditionOther)}</div>
  <div><b>ملاحظات:</b> ${val(s.cast.on ? s.cast.notes : '')}</div>
</div>
<div class="bar">شيت حالات العمليات <small>تمريض فقط</small></div>
<div class="sec">
  <div><b>نوع العملية:</b> ${val(s.surgery.on ? s.surgery.procedure : '')}</div>
  <div class="row c2"><div><b>تاريخ العملية:</b> ${d(s.surgery.on ? s.surgery.date : '')}</div><div><b>تاريخ المتابعة:</b> ${d(s.surgery.on ? s.surgery.followUp : '')}</div></div>
  <div><b>حالة الجرح:</b> ${box(OPT.wound, s.surgery.on ? s.surgery.wound : '', s.surgery.woundOther)}</div>
  <div><b>الغيار:</b> ${box(OPT.dressing, s.surgery.on ? s.surgery.dressing : '')}</div>
  <div><b>الضمادات:</b> ${box(OPT.bandage, s.surgery.on ? s.surgery.bandage : '')}</div>
  <div><b>ملاحظات:</b> ${val(s.surgery.on ? s.surgery.notes : '')}</div>
</div>
<footer><span>معًا .. لمريض أفضل</span><span>ثقة .. خبرة .. رعاية مستمرة</span></footer>
</body></html>`;
}

export function printNursing(n: Omit<Nursing, 'id'>, win?: Window | null) {
  void printHtml(nursingHtml(n), win === undefined ? openPrintWindow() : win);
}
