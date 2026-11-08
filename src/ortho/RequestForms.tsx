// شاشة «طلب أشعة» و«طلب تحاليل» في تاب «الأشعة والتحاليل» بالكشف — اختيار + حفظ + طباعة + حفظ كصورة
import { useEffect, type ReactNode } from 'react';
import { Button } from '../components/ui';
import { Icon } from '../utils/icons';
import type { ExamSheet } from './data';
import { Checks, Pick, Txt, sheetApi } from './ExamSheet';
import { LAB_OTHERS, LAB_REQ_GROUPS, RAD_REGIONS, RAD_SIDES, RAD_TYPES, labOthers, labPicked, radTypes } from './requestData';

type Act = (kind: 'rad' | 'lab') => void;

function Card({ icon, title, en, children, actions }: { icon: string; title: string; en: string; children: ReactNode; actions: ReactNode }) {
  return (
    <section className="rq-card">
      <header className="rq-card__h"><Icon name={icon} size={18} /><b>{title}</b><span dir="ltr">{en}</span></header>
      <div className="rq-card__b">{children}</div>
      <div className="rq-card__f">{actions}</div>
    </section>
  );
}

export function RequestForms({ sheet, onChange, busy, disabled, onSave, onPrint, onImage, onWhatsapp, prepare }: {
  sheet: ExamSheet; onChange: (f: (s: ExamSheet) => ExamSheet) => void; busy: boolean; disabled: boolean;
  onSave: () => void; onPrint: Act; onImage: Act; onWhatsapp: Act; prepare: Act;
}) {
  const a = sheetApi(sheet, onChange);
  const radN = radTypes(sheet).length, labN = labPicked(sheet).length + labOthers(sheet).length;
  // صورة كل طلب بتتجهز في الخلفية بعد ما الاختيارات تهدى ثانية — عشان «حفظ كصورة» يحفظ في نفس الضغطة
  useEffect(() => {
    if (disabled) return;
    const t = window.setTimeout(() => { if (radN) prepare('rad'); if (labN) prepare('lab'); }, 1000);
    return () => window.clearTimeout(t);
  }, [sheet, disabled]);
  const acts = (kind: 'rad' | 'lab', n: number) => (
    <>
      <Button size="sm" variant="outline" icon="check" loading={busy} disabled={disabled || !n} onClick={onSave}>حفظ</Button>
      <Button size="sm" icon="print" loading={busy} disabled={disabled || !n} onClick={() => onPrint(kind)}>طباعة</Button>
      <Button size="sm" variant="outline" icon="download" loading={busy} disabled={disabled || !n} onClick={() => onImage(kind)}>حفظ كصورة على الجهاز</Button>
      <Button size="sm" variant="outline" icon="share" loading={busy} disabled={disabled || !n} onClick={() => onWhatsapp(kind)}>فتح واتساب المريض</Button>
      {!n && <span className="muted-sm">اختار المطلوب الأول</span>}
    </>
  );
  return (
    <div className="rq-forms">
      <Card icon="scan" title={`طلب أشعة${radN ? ` (${radN})` : ''}`} en="Radiology Request" actions={acts('rad', radN)}>
        <div className="sh-lbl">نوع الأشعة المطلوبة — Requested Investigation</div>
        <div className="rq-grid" dir="ltr"><Checks a={a} g="rr.type" items={RAD_TYPES.map(([l]) => l)} /></div>
        <div className="sh-lbl">الجانب — Side</div>
        <div className="sh-inline" dir="ltr"><Pick a={a} g="rr.side" items={RAD_SIDES} /></div>
        <div className="sh-lbl">المنطقة المطلوبة — Body Region</div>
        <div className="rq-grid" dir="ltr"><Checks a={a} g="rr.reg" items={RAD_REGIONS} /></div>
        <Txt a={a} k="rr.reg.other" label="Other region" dir="ltr" />
        <div className="sh-lbl">السبب الطبي / الاشتباه الإكلينيكي — Clinical Indication</div>
        <textarea className="sh-in sh-notes" dir="auto" rows={2} aria-label="Clinical Indication" value={a.txt('rr.ind')} onChange={(e) => a.set('rr.ind', e.target.value)} />
      </Card>

      <Card icon="list" title={`طلب تحاليل${labN ? ` (${labN})` : ''}`} en="Laboratory Request" actions={acts('lab', labN)}>
        <div className="rq-labs">
          {LAB_REQ_GROUPS.map((g) => (
            <div key={g.en} className={`rq-grp${g.special ? ' rq-grp--sp' : ''}`}>
              <div className="rq-grp__t"><b dir="ltr">{g.en}</b><span>{g.ar}</span></div>
              <div dir="ltr"><Checks a={a} g="lr" items={g.items} /></div>
            </div>
          ))}
          <div className="rq-grp">
            <div className="rq-grp__t"><b dir="ltr">Others</b><span>أخرى</span></div>
            {LAB_OTHERS.map((k) => <Txt key={k} a={a} k={k} placeholder="Test name" dir="ltr" />)}
          </div>
        </div>
        <div className="sh-lbl">ملاحظات طبية — Clinical Notes</div>
        <textarea className="sh-in sh-notes" dir="auto" rows={2} aria-label="Clinical Notes" value={a.txt('lr.notes')} onChange={(e) => a.set('lr.notes', e.target.value)} />
      </Card>
    </div>
  );
}
