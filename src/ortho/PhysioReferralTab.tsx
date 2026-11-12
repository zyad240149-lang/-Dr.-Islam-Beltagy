// ١٢/١١: تاب «العلاج الطبيعي» في الكشف — Physiotherapy Referral: الاختيارات (pr.*) + طباعة / تحميل صورة / واتساب
import { useContext, useEffect, useState } from 'react';
import { Icon } from '../utils/icons';
import { useToast } from '../hooks/useToast';
import { openPrintWindow, printHtml } from '../utils/printDoc';
import type { ExamSheet } from './data';
import { BoxOpenDefault, Checks, Pick, Txt, sheetApi } from './ExamSheet';
import { REQ_CSS, type ReqPatient } from './requestData';
import { PR_GOALS, PR_PROGRAMS, PR_REEVAL, PR_REGIONS, PR_SIDES, PR_TYPES, deliverPrImage, preparePrImage, prHtml, readyPrImage, type PrInfo } from './physioReferral';

// صور من ورقة العيادة (public/rx/physio-form.jpg ‏1086×1448) — قص بالـ CSS من نفس الصورة
const IW = 1086, IH = 1448;
type Box4 = [number, number, number, number];
const CARD_CROPS: Box4[] = [
  [25, 590, 135, 690], [377, 590, 497, 690], [727, 590, 852, 690],
  [25, 745, 135, 855], [377, 745, 497, 855], [730, 745, 855, 852],
  [25, 910, 135, 1012], [377, 910, 497, 1012], [730, 910, 855, 1012],
  [25, 1068, 135, 1165], [380, 1068, 492, 1165], [730, 1068, 855, 1165],
];
const REGION_CROPS: Box4[] = [[243, 347, 312, 402], [343, 347, 413, 402], [448, 347, 518, 402], [550, 347, 613, 402], [635, 347, 702, 402], [720, 347, 785, 402], [808, 347, 870, 402], [895, 347, 965, 402]];
function Crop({ box: [x0, y0, x1, y1], w }: { box: Box4; w: number }) {
  const k = w / (x1 - x0);
  return <span className="pr-crop" aria-hidden style={{ width: w, height: Math.round((y1 - y0) * k), backgroundSize: `${IW * k}px ${IH * k}px`, backgroundPosition: `-${x0 * k}px -${y0 * k}px` }} />;
}

export function PhysioReferralTab({ sheet, onChange, info, patient, waPhone }: {
  sheet: ExamSheet; onChange: (f: (s: ExamSheet) => ExamSheet) => void; info: PrInfo; patient: () => ReqPatient | null | undefined; waPhone: string;
}) {
  const toast = useToast();
  const a = sheetApi(sheet, onChange);
  const key = JSON.stringify([sheet.on.filter((o) => o.startsWith('pr.') || o.startsWith('n.gender')), Object.entries(sheet.txt).filter(([k]) => k.startsWith('pr.')), info]);
  // الصورة بتتجهز مقدمًا عشان الحفظ يحصل في نفس الضغطة على الموبايل
  useEffect(() => { const t = setTimeout(() => { void preparePrImage(sheet, info, patient()).catch(() => undefined); }, 700); return () => clearTimeout(t); }, [key]); // eslint-disable-line react-hooks/exhaustive-deps
  const other = (k: string) => <Txt a={a} k={k} label="Other" dir="ltr" />;
  const [open, setOpen] = useState(useContext(BoxOpenDefault)); // ١٣/١١: الشيت بيبدأ مقفول جوّه الكشف — أزرار الطباعة/الواتساب ظاهرة على طول
  return (
    <section className="plan-part pr-form" dir="ltr">
      <h3 className="plan-part__h fold-h" dir="rtl" onClick={() => setOpen(!open)}>Physiotherapy Referral — تحويل علاج طبيعي
        <button type="button" className="fold-t fold-t--light" aria-expanded={open} onClick={(e) => { e.stopPropagation(); setOpen(!open); }}>{open ? 'إغلاق' : 'فتح'}</button>
      </h3>
      {open && <>
      <div className="pr-f-grid">
        <Txt a={a} k="pr.dx" label="Diagnosis" placeholder={info.diagnosis} stack dir="ltr" />
        <Txt a={a} k="pr.notes" label="Clinical Notes" stack dir="ltr" />
        <Txt a={a} k="pr.ref" label="Ref. No." placeholder={info.refNo} stack dir="ltr" />
      </div>
      <div className="pr-f-grid">
        <div><div className="sh-lbl">Affected Side</div><div className="sh-inline"><Pick a={a} g="pr.side" items={PR_SIDES} /></div></div>
        <div><div className="sh-lbl">Treatment Type</div><div className="sh-inline"><Pick a={a} g="pr.type" items={PR_TYPES} /></div></div>
      </div>
      <div className="sh-lbl">Region (Affected Area)</div>
      {/* ١٢/١١: صور المناطق من ورقة العيادة نفسها — دوسة على الصورة بتعلّم المنطقة */}
      <div className="pr-f-regs">
        {PR_REGIONS.map((r, i) => { const on = a.has('pr.reg', r); return (
          <button key={r} type="button" className={`pr-f-reg${on ? ' is-on' : ''}`} aria-pressed={on} onClick={() => a.toggle('pr.reg', r)}>
            <Crop box={REGION_CROPS[i]} w={58} /><span>{on ? '☑' : '☐'} {r}</span>
          </button>
        ); })}
      </div>
      {other("pr.reg.other")}
      <div className="pr-f-progs">
        {PR_PROGRAMS.map((b, i) => (
          <div key={b.title} className="pr-f-box">
            <div className="pr-f-h"><em>{i + 1}</em>{b.title}</div>
            <div className="pr-f-body"><Crop box={CARD_CROPS[i]} w={86} /><div className="pr-f-list"><Checks a={a} g={`pr.p${i + 1}`} items={b.items} /></div></div>
            {other(`pr.p${i + 1}.other`)}
          </div>
        ))}
      </div>
      <div className="pr-f-grid">
        <div className="pr-f-box"><div className="pr-f-h">Program Goals</div><div className="sh-cols"><Checks a={a} g="pr.goal" items={PR_GOALS} /></div>{other("pr.goal.other")}</div>
        <div className="pr-f-box"><div className="pr-f-h">Special Instructions</div>
          <textarea className="sh-in sh-notes" dir="auto" rows={4} aria-label="Special Instructions" value={a.txt('pr.instr')} onChange={(e) => a.set('pr.instr', e.target.value)} /></div>
      </div>
      <div className="pr-f-grid">
        <Txt a={a} k="pr.freq" label="Frequency (sessions / week)" num />
        <Txt a={a} k="pr.dur" label="Duration (weeks)" num />
        <div><div className="sh-lbl">Re-evaluation</div><div className="sh-inline"><Pick a={a} g="pr.reeval" items={PR_REEVAL} /></div>{other("pr.reeval.other")}</div>
      </div>
      </>}
      <div className="out-actions" dir="rtl">
        <button type="button" className="out-act" onClick={() => void printHtml(prHtml(sheet, info, patient(), REQ_CSS), openPrintWindow())}>
          <Icon name="print" size={22} /><b>طباعة</b><small>A4 على الطابعة</small>
        </button>
        <button type="button" className="out-act" onClick={async () => {
          const say = (r: string) => { if (r === 'saved') toast.success(/Android/i.test(navigator.userAgent) ? 'اتحفظت الصورة في معرض الصور — ألبوم «Download»' : 'اتحفظت صورة التحويل على الجهاز'); };
          const ready = readyPrImage(sheet, info, patient());
          if (ready) { say(deliverPrImage(ready)); return; }
          try { say(deliverPrImage(await preparePrImage(sheet, info, patient()))); } catch (e) { toast.error((e as Error).message); }
        }}>
          <Icon name="download" size={22} /><b>تحميل على الموبايل</b><small>صورة في معرض الصور</small>
        </button>
        <button type="button" className="out-act out-act--wa" onClick={() => {
          if (!waPhone) { toast.error('مفيش رقم موبايل للمريض.'); return; }
          window.open(`https://wa.me/${waPhone}`, '_blank', 'noopener');
        }}>
          <Icon name="share" size={22} /><b>إرسال واتساب</b><small>يفتح محادثة المريض وتبعت الصورة</small>
        </button>
      </div>
    </section>
  );
}
