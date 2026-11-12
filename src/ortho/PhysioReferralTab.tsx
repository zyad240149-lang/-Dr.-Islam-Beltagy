// ١٢/١١: تاب «العلاج الطبيعي» في الكشف — Physiotherapy Referral: الاختيارات (pr.*) + طباعة / تحميل صورة / واتساب
import { useEffect } from 'react';
import { Icon } from '../utils/icons';
import { useToast } from '../hooks/useToast';
import { openPrintWindow, printHtml } from '../utils/printDoc';
import type { ExamSheet } from './data';
import { Checks, Pick, Txt, sheetApi } from './ExamSheet';
import { REQ_CSS, type ReqPatient } from './requestData';
import { PR_GOALS, PR_PROGRAMS, PR_REEVAL, PR_REGIONS, PR_SIDES, PR_TYPES, deliverPrImage, preparePrImage, prHtml, readyPrImage, type PrInfo } from './physioReferral';

export function PhysioReferralTab({ sheet, onChange, info, patient, waPhone }: {
  sheet: ExamSheet; onChange: (f: (s: ExamSheet) => ExamSheet) => void; info: PrInfo; patient: () => ReqPatient | null | undefined; waPhone: string;
}) {
  const toast = useToast();
  const a = sheetApi(sheet, onChange);
  const key = JSON.stringify([sheet.on.filter((o) => o.startsWith('pr.') || o.startsWith('n.gender')), Object.entries(sheet.txt).filter(([k]) => k.startsWith('pr.')), info]);
  // الصورة بتتجهز مقدمًا عشان الحفظ يحصل في نفس الضغطة على الموبايل
  useEffect(() => { const t = setTimeout(() => { void preparePrImage(sheet, info, patient()).catch(() => undefined); }, 700); return () => clearTimeout(t); }, [key]); // eslint-disable-line react-hooks/exhaustive-deps
  const other = (k: string) => <Txt a={a} k={k} label="Other" dir="ltr" />;
  return (
    <section className="plan-part pr-form" dir="ltr">
      <h3 className="plan-part__h" dir="rtl">Physiotherapy Referral — تحويل علاج طبيعي</h3>
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
      <div className="sh-inline"><Checks a={a} g="pr.reg" items={PR_REGIONS} /></div>
      {other("pr.reg.other")}
      <div className="pr-f-progs">
        {PR_PROGRAMS.map((b, i) => (
          <div key={b.title} className="pr-f-box">
            <div className="pr-f-h"><em>{i + 1}</em>{b.title}</div>
            <Checks a={a} g={`pr.p${i + 1}`} items={b.items} />
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
