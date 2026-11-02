// «تقييم التهاب المفاصل الروماتويدي (ACR/EULAR 2010)»: قسم اختياري في كشف الطبيب (تحت أي شيت). الدرجات بتتحسب تلقائي من 10،
// ويتحفظ مع الكشف في ملف المريض (sheet). مابيغيّرش التشخيص ولا الخطة — الطبيب هو اللي يعتمد التقييم.
import { Icon } from '../utils/icons';
import type { ExamSheet } from './data';
import { sheetApi, type Api } from './ExamSheet';
import { JOINT_ROWS, RA_APR, RA_DUR, RA_SERO, RA_SERO_SCORE, jointRow, raCalc } from './raScore';

function Opts({ a, g, items, score }: { a: Api; g: string; items: readonly string[]; score?: (i: string) => number }) {
  return (
    <div className="ra-opts">
      {items.map((i) => {
        const on = a.has(g, i);
        return (
          <button key={i} type="button" aria-pressed={on} className={`ra-opt${on ? ' is-on' : ''}`} onClick={() => a.pick(g, i)}>
            <span>{i}</span>{score && <b className="ra-sc">{score(i)}</b>}
          </button>
        );
      })}
    </div>
  );
}

function Domain({ n, title, max, score, children }: { n: number; title: string; max: number; score: number; children: React.ReactNode }) {
  return (
    <section className="ra-dom">
      <h4 className="ra-dom__h"><span>{n}. {title} <small>(0 – {max})</small></span><b className="ra-sc ra-sc--big">{score}</b></h4>
      <div className="ra-dom__b">{children}</div>
    </section>
  );
}

export function RaAssessment({ sheet, onChange }: { sheet: ExamSheet; onChange: (f: (s: ExamSheet) => ExamSheet) => void }) {
  const a = sheetApi(sheet, onChange);
  const r = raCalc(sheet);
  if (!r.enabled) {
    return (
      <div className="ra-add" dir="rtl">
        <button type="button" className="btn btn--outline btn--sm" onClick={() => a.toggle('ra', 'on')}><Icon name="plus" size={14} /> إضافة تقييم التهاب المفاصل الروماتويدي (ACR/EULAR 2010)</button>
        <span className="muted-sm">اختياري — مش بيظهر في كل كشف</span>
      </div>
    );
  }
  const remove = () => {
    if (r.total > 0 || sheet.txt['ra.note'] || sheet.txt['ra.large'] || sheet.txt['ra.small']) { if (!window.confirm('إلغاء التقييم هيمسح اللي اتكتب فيه. تكمل؟')) return; }
    onChange((x) => ({ ...x, on: x.on.filter((o) => o !== 'ra|on' && o !== 'ra|approved' && !o.startsWith('ra.')), txt: Object.fromEntries(Object.entries(x.txt).filter(([k]) => !k.startsWith('ra.'))) }));
  };
  const row = jointRow(r.large, r.small);
  return (
    <section className="ra">
      <header className="ra-head" dir="rtl">
        <h3>تقييم التهاب المفاصل الروماتويدي <span dir="ltr">(ACR/EULAR 2010)</span></h3>
        <button type="button" className="ra-head__x" onClick={remove}>إلغاء التقييم</button>
      </header>
      <div className="ra-body" dir="ltr">
        <p className="ra-purpose"><b>Purpose:</b> classification criteria for RA in patients with confirmed synovitis in ≥ 1 joint and no better alternative diagnosis. Use the highest score in each domain.</p>

        <Domain n={1} title="Joint Involvement" max={5} score={r.joints}>
          <div className="ra-joints">
            <label>Large joints involved <input className="sh-in sh-in--num" dir="ltr" inputMode="numeric" value={a.txt('ra.large')} onChange={(e) => a.set('ra.large', e.target.value.replace(/\D/g, ''))} /></label>
            <label>Small joints involved <input className="sh-in sh-in--num" dir="ltr" inputMode="numeric" value={a.txt('ra.small')} onChange={(e) => a.set('ra.small', e.target.value.replace(/\D/g, ''))} /></label>
          </div>
          <ul className="ra-rows">
            {JOINT_ROWS.map(([t, sc], i) => <li key={t} className={i === row ? 'is-on' : ''}><span>{t}</span><b className="ra-sc">{sc}</b></li>)}
          </ul>
        </Domain>

        <Domain n={2} title="Serology" max={3} score={r.sero}>
          <div className="sh-lbl">RF</div><Opts a={a} g="ra.rf" items={RA_SERO} score={(i) => RA_SERO_SCORE[i]} />
          <div className="sh-lbl">Anti-CCP</div><Opts a={a} g="ra.ccp" items={RA_SERO} score={(i) => RA_SERO_SCORE[i]} />
          <p className="ra-hint">Low positive: &gt; ULN to ≤ 3 × ULN · High positive: &gt; 3 × ULN</p>
        </Domain>

        <Domain n={3} title="Acute Phase Reactants" max={1} score={r.apr}>
          <div className="sh-lbl">ESR</div><Opts a={a} g="ra.esr" items={RA_APR} score={(i) => (i === 'Abnormal' ? 1 : 0)} />
          <div className="sh-lbl">CRP</div><Opts a={a} g="ra.crp" items={RA_APR} score={(i) => (i === 'Abnormal' ? 1 : 0)} />
        </Domain>

        <Domain n={4} title="Symptom Duration" max={1} score={r.dur}>
          <Opts a={a} g="ra.dur" items={RA_DUR} score={(i) => (i === '≥ 6 weeks' ? 1 : 0)} />
        </Domain>

        <div className={`ra-total${r.classified ? ' is-yes' : ''}`}>
          <div><span>Total Score (maximum = 10)</span><b>{r.total}<small>/10</small></b></div>
          <p dir="rtl">
            {r.classified ? <><Icon name="checkCircle" size={16} /> ≥ 6/10 — تنطبق معايير تصنيف الروماتويد.</> : <>أقل من 6/10 — لا تنطبق المعايير حاليًا (متابعة وإعادة تقييم).</>}
            {!r.complete && <span className="ra-warn"> التقييم لسه ناقص — كمّل كل البنود.</span>}
          </p>
        </div>

        <label className="ra-note"><span dir="rtl">ملاحظة الطبيب</span>
          <textarea className="sh-in sh-notes" dir="auto" rows={2} value={a.txt('ra.note')} onChange={(e) => a.set('ra.note', e.target.value)} />
        </label>
        <label className={`ra-ok${r.approved ? ' is-on' : ''}`} dir="rtl">
          <input type="checkbox" checked={r.approved} onChange={() => a.toggle('ra', 'approved')} />
          <span>اعتمدت التقييم — المعايير دي للتصنيف بس، والتشخيص النهائي والخطة العلاجية قراري أنا كطبيب (مفيش حاجة بتتغيّر تلقائي).</span>
        </label>
      </div>
    </section>
  );
}
