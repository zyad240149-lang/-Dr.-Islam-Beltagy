// «Nociplastic Pain Checklist» في كشف الطبيب: 10 بنود — 3 أو أكتر = اشتباه ألم نوسيبلاستيك، 7 أو أكتر = الألم النوسيبلاستيك هو الغالب غالبًا.
// مفتوح على طول وفيه «إغلاق»؛ بيتحفظ مع الكشف (مفاتيح np|…) ومابيغيّرش التشخيص ولا الخطة — قرار الطبيب.
import { Icon } from '../utils/icons';
import type { ExamSheet } from './data';
import { sheetApi } from './ExamSheet';

export const NP_ITEMS = [
  'Chronic pain lasting > 3 months',
  'Pain disproportionate to imaging findings',
  'Widespread or shifting pain distribution',
  'Hypersensitivity to touch, pressure, or movement',
  'Poor or short-lived response to injections/procedures',
  'Prominent fatigue, non-restorative sleep, or brain fog',
  'Associated mood symptoms or stress sensitivity',
  'History of central sensitivity syndromes (e.g., Fibromyalgia, IBS)',
  'No clear dominant nociceptive pain generator',
  'No clear dominant neuropathic lesion explaining symptoms',
];
const count = (s: ExamSheet) => NP_ITEMS.filter((i) => s.on.includes(`np|${i}`)).length;
const verdict = (n: number) => (n >= 7 ? 'Nociplastic-dominant pain likely' : n >= 3 ? 'Suspect nociplastic pain' : 'Below threshold');

/** سطر الملخص في «الفحص» — بس لو اتعلّم بند */
export function nociSummary(s: ExamSheet): string {
  const n = count(s);
  if (!n || s.on.includes('np|closed')) return '';
  return `Nociplastic pain checklist: ${n}/10 — ${verdict(n)} (${NP_ITEMS.filter((i) => s.on.includes(`np|${i}`)).join('; ')})`;
}

export function NociChecklist({ sheet, onChange }: { sheet: ExamSheet; onChange: (f: (s: ExamSheet) => ExamSheet) => void }) {
  const a = sheetApi(sheet, onChange);
  if (a.has('np', 'closed')) {
    return (
      <div className="ra-add" dir="rtl">
        <button type="button" className="btn btn--outline btn--sm" onClick={() => a.toggle('np', 'closed')}><Icon name="plus" size={14} /> فتح Nociplastic Pain Checklist</button>
        <span className="muted-sm">مقفول — اللي اتعلّم فيه محفوظ</span>
      </div>
    );
  }
  const n = count(sheet);
  return (
    <section className="np">
      <header className="ra-head" dir="rtl">
        <h3>تقييم الألم النوسيبلاستيك <span dir="ltr">(Nociplastic Pain Checklist)</span></h3>
        <button type="button" className="ra-head__x" onClick={() => a.toggle('np', 'closed')}>إغلاق</button>
      </header>
      <div className="np-body" dir="ltr">
        <h4 className="np-title">NOCIPLASTIC PAIN <span>CHECKLIST</span></h4>
        <p className="np-lead">Consider nociplastic pain when <b>3 or more</b> of the following apply:</p>
        <div className="np-list">
          {NP_ITEMS.map((i) => {
            const on = a.has('np', i);
            return (
              <label key={i} className={`np-item${on ? ' is-on' : ''}`}>
                <input type="checkbox" checked={on} onChange={() => a.toggle('np', i)} />
                <span className="np-box">{on && <Icon name="check" size={14} />}</span><span>{i}</span>
              </label>
            );
          })}
        </div>
        <div className="np-result">
          <div className={n >= 3 && n < 7 ? 'is-on' : ''}><Icon name="checkCircle" size={16} /> <b>3 POSITIVE POINTS</b> → <span>SUSPECT NOCIPLASTIC PAIN</span></div>
          <div className={n >= 7 ? 'is-on' : ''}><Icon name="checkCircle" size={16} /> <b>7 POSITIVE POINTS</b> → <span>NOCIPLASTIC-DOMINANT PAIN LIKELY</span></div>
        </div>
        <div className="np-total"><span>Positive points</span><b>{n}<small>/10</small></b><em>{verdict(n)}</em></div>
        <p className="muted-sm" dir="rtl">أداة مساعدة بس — التشخيص النهائي والخطة قرار الطبيب، ومفيش حاجة بتتغيّر تلقائي.</p>
      </div>
    </section>
  );
}
