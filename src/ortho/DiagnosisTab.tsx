// تبويب «التشخيص» في ملف المريض (ونفسه «ملف تشخيصات المريض» في صفحة التشخيص — embedded): كل تشخيص بتاريخه ورقم الزيارة
// والطبيب اللي سجّله والتشخيص، وتحته الشيت باللي اتحدد واتكتب بس (+ الروشتة والتحاليل والأشعة) والمرفقات.
// كل تشخيص سجل مستقل — التشخيص الجديد بيتضاف وما بيلمسش القديم.
import { useEffect, useRef, useState } from 'react';
import { Button, EmptyState } from '../components/ui';
import { db } from '../data/db';
import { fmtDate } from '../utils/format';
import { isIncomplete, ortho, useOrthoVersion, type Consultation } from './data';
import { IconBtn, LoadState, confirmDelete, useClinicalCan, useRun } from './kit';
import { AttachmentThumbs, ConsultModal, DraftCard, listConsultDrafts, clearConsultDraft } from './Consultations';
import { empName } from '../data/installments';
import { fmtTime } from '../utils/format';
import { DiagnosisOutput } from './DiagnosisOutput';
import { diagnosisHtml, hasRx, type DxPart } from './printDiagnosis';

// صفحات الشيت جوّه iframe (ستايلها منفصل عن البرنامج) بتتصغّر على عرض المكان المتاح
const PAGE_W = 1150;
function SheetPreview({ c, visitNo }: { c: Consultation; visitNo: number }) {
  const box = useRef<HTMLDivElement>(null);
  const frame = useRef<HTMLIFrameElement>(null);
  const [scale, setScale] = useState(1);
  const [height, setHeight] = useState(600);
  const parts: DxPart[] = hasRx(c) ? ['nurse', 'doctor', 'rx'] : ['nurse', 'doctor'];
  const html = diagnosisHtml(c, db.patient(c.patientId), visitNo, parts, true); // اللي اتحدد بس
  useEffect(() => {
    const el = box.current;
    if (!el) return;
    const ro = new ResizeObserver(() => setScale(Math.min(1, el.clientWidth / PAGE_W)));
    ro.observe(el);
    return () => ro.disconnect();
  }, []);
  const measure = () => {
    const doc = frame.current?.contentDocument;
    if (doc) setHeight(doc.documentElement.scrollHeight);
  };
  return (
    <div className="dxh-sheet" ref={box} style={{ height: height * scale }}>
      <iframe ref={frame} title={`شيت التشخيص ${fmtDate(c.date)}`} srcDoc={html} scrolling="no"
        style={{ width: PAGE_W, height, transform: `scale(${scale})` }}
        onLoad={() => { measure(); void frame.current?.contentDocument?.fonts?.ready.then(measure); }} />
    </div>
  );
}

// embedded = جوّه صفحة التشخيص: زرار «تشخيص» والمسودة فوق في الصفحة نفسها، والتشخيصات كلها مفتوحة بالتفصيل
export function DiagnosisTab({ patientId, embedded }: { patientId: string; embedded?: boolean }) {
  useOrthoVersion();
  const perm = useClinicalCan();
  const { run } = useRun();
  const [edit, setEdit] = useState<Consultation | 'new' | null>(null);
  const [resume, setResume] = useState(false);
  const [out, setOut] = useState<{ c: Consultation; visitNo: number } | null>(null);
  const [shown, setShown] = useState<Record<string, boolean>>({});
  const [, setDraftsVersion] = useState(0);
  const items = ortho.list('consultations', patientId).sort((a, b) => b.date.localeCompare(a.date));
  const visitNo = (c: Consultation) => items.length - items.indexOf(c); // الأقدم = زيارة 1
  const draft = !edit && !embedded ? listConsultDrafts().find((d) => d.patientId === patientId) : undefined;

  return (
    <div>
      {!embedded && <div style={{ display: 'flex', justifyContent: 'flex-end', marginBottom: 14 }}>
        {perm.add && <Button size="sm" icon="stethoscope" onClick={() => {
          if (draft && !window.confirm('فيه تشخيص لم يكتمل للمريض ده — بدء تشخيص جديد هيستبدله. تكمل؟')) return;
          setResume(false); setEdit('new');
        }}>تشخيص جديد</Button>}
      </div>}
      {perm.add && draft && (
        <div style={{ marginBottom: 12 }}>
          <DraftCard d={draft} onResume={() => { setResume(true); setEdit('new'); }} onDiscard={() => {
            if (!window.confirm('حذف التشخيص اللي لم يكتمل؟ كل اللي اتكتب فيه هيتمسح.')) return;
            clearConsultDraft(patientId); setDraftsVersion((v) => v + 1);
          }} />
        </div>
      )}
      <LoadState kind="consultations">
        {items.length === 0 ? (!draft && <EmptyState icon="stethoscope" title="لسه مفيش تشخيص للمريض ده" text={embedded ? 'اضغط «تشخيص» فوق عشان تبدأ أول تشخيص.' : undefined} />) : items.map((c, i) => {
          const open = shown[c.id] ?? (embedded || i === 0);
          const n = visitNo(c);
          const visit = c.appointmentId ? db.appointment(c.appointmentId) : undefined;
          const by = c.createdBy ? empName(c.createdBy) : '';
          return (
            <div className="item-card dxh" key={c.id}>
              <div className="ortho-row">
                <div>
                  <div className="dxh__when"><b>{fmtDate(c.date)}</b> <span className="badge badge--brand">زيارة رقم <span className="num">{n}</span></span>
                    {isIncomplete(c) ? <span className="badge badge--warn">يحتاج استكمال</span> : i === 0 && <span className="badge badge--ok">آخر تشخيص</span>}</div>
                  <div className="ortho-sub">
                    {by && by !== '—' ? <>سجّله: <b>{by}</b></> : 'سجّله: —'}
                    {visit && <> · زيارة <span className="num">{visit.no}</span> (<span className="num">{fmtTime(visit.time)}</span>)</>}
                  </div>
                  <div className="cx-dx"><span className="cx-dx__l">التشخيص</span>{c.diagnosis ? <b dir="auto">{c.diagnosis}</b> : <span className="muted">لسه ما اتحددش</span>}{c.icd10 && <span className="badge badge--brand" dir="ltr">{c.icd10}</span>}</div>
                </div>
                <div style={{ display: 'flex', gap: 6, alignItems: 'center' }}>
                  {isIncomplete(c) && perm.edit && <Button size="sm" icon="refresh" onClick={() => setEdit(c)}>استكمال</Button>}
                  <Button size="sm" variant="outline" icon="print" onClick={() => setOut({ c, visitNo: n })}>طباعة وإرسال</Button>
                  {perm.edit && <IconBtn icon="edit" label="تعديل" onClick={() => setEdit(c)} />}
                  {perm.del && <IconBtn icon="trash" label="حذف" danger onClick={() => confirmDelete('هذا التشخيص') && run(async () => { await ortho.remove('consultations', c.id); (c.attachments ?? []).forEach((a) => void ortho.removeAttachment(a.path)); }, 'تم الحذف')} />}
                </div>
              </div>
              <button type="button" className="dxh__toggle" aria-expanded={open} onClick={() => setShown((x) => ({ ...x, [c.id]: !open }))}>
                {open ? 'إخفاء الشيت' : 'عرض الشيت زي ما اتكتب'}
              </button>
              {open && <SheetPreview c={c} visitNo={n} />}
              {open && (c.attachments ?? []).length > 0 && <AttachmentThumbs items={c.attachments} />}
            </div>
          );
        })}
      </LoadState>
      {edit && <ConsultModal patientId={patientId} initial={edit === 'new' ? undefined : edit} resume={edit === 'new' && resume} onClose={() => { setEdit(null); setResume(false); }} />}
      {out && <DiagnosisOutput c={out.c} initial={['nurse', 'doctor', 'rx']} patient={db.patient(patientId)} visitNo={out.visitNo} onClose={() => setOut(null)} />}
    </div>
  );
}
