// «تقييم التهاب المفاصل الروماتويدي (ACR/EULAR 2010)» في كشف الطبيب — نفس شكل وألوان جدول المعايير الأصلي:
// يمين: الغرض + الإجمالي + التفسير + ملاحظات مهمة، شمال: جدول Domain / Criteria / Score (ضغطة على الصف = اختياره).
// مفتوح على طول وفيه «إغلاق». بيتحفظ مع الكشف في ملف المريض ومابيغيّرش التشخيص ولا الخطة — الطبيب هو اللي يعتمد التقييم.
import { useState } from 'react';
import { Icon } from '../utils/icons';
import type { ExamSheet } from './data';
import { sheetApi } from './ExamSheet';
import { RA_DOMAINS, aprRow, jointRow, raCalc, seroRow } from './raScore';

const SERO = ['Negative', 'Low positive', 'High positive'];
const IMG = `${import.meta.env.BASE_URL}ra/acr-eular-2010.jpg`;

export function RaAssessment({ sheet, onChange }: { sheet: ExamSheet; onChange: (f: (s: ExamSheet) => ExamSheet) => void }) {
  const a = sheetApi(sheet, onChange);
  const r = raCalc(sheet);
  const [rf, setRf] = useState(-1), [ccp, setCcp] = useState(-1);
  const [esr, setEsr] = useState<boolean | null>(null), [crp, setCrp] = useState<boolean | null>(null);
  if (!r.enabled) {
    return (
      <div className="ra-add" dir="rtl">
        <button type="button" className="btn btn--outline btn--sm" onClick={() => a.toggle('ra', 'closed')}><Icon name="plus" size={14} /> فتح تقييم التهاب المفاصل الروماتويدي (ACR/EULAR 2010)</button>
        <span className="muted-sm">مقفول — اللي اتكتب فيه محفوظ</span>
      </div>
    );
  }
  // اختيار صف واحد في المجال (نفس الصف تاني = إلغاء)
  const pickRow = (g: string, i: number, toggle = true) => {
    const d = RA_DOMAINS.find((x) => x.g === g)!;
    const k = `${g}|${d.rows[i][0]}`;
    onChange((x) => { const rest = x.on.filter((o) => !o.startsWith(g + '|')); return { ...x, on: toggle && x.on.includes(k) ? rest : [...rest, k] }; });
  };
  const setCount = (k: 'ra.large' | 'ra.small', v: string) => {
    const clean = v.replace(/\D/g, '').slice(0, 2);
    const L = parseInt(k === 'ra.large' ? clean : a.txt('ra.large'), 10) || 0, S = parseInt(k === 'ra.small' ? clean : a.txt('ra.small'), 10) || 0;
    a.set(k, clean);
    const row = jointRow(L, S);
    if (row >= 0) pickRow('ra.j', row, false);
  };
  const setSero = (which: 'rf' | 'ccp', v: number) => {
    const nrf = which === 'rf' ? v : rf, nccp = which === 'ccp' ? v : ccp;
    if (which === 'rf') setRf(v); else setCcp(v);
    if (nrf >= 0 || nccp >= 0) pickRow('ra.s', seroRow(Math.max(nrf, 0), Math.max(nccp, 0)), false);
  };
  const setApr = (which: 'esr' | 'crp', abn: boolean) => {
    const ne = which === 'esr' ? abn : esr, nc = which === 'crp' ? abn : crp;
    if (which === 'esr') setEsr(abn); else setCrp(abn);
    pickRow('ra.a', aprRow(!!ne, !!nc), false);
  };

  return (
    <section className="ra">
      <header className="ra-head" dir="rtl">
        <h3>تقييم التهاب المفاصل الروماتويدي <span dir="ltr">(ACR/EULAR 2010)</span></h3>
        <button type="button" className="ra-head__x" onClick={() => a.toggle('ra', 'closed')}>إغلاق</button>
      </header>
      <div className="ra-banner" dir="ltr">
        <span className="ra-banner__ic"><Icon name="bone" size={28} /></span>
        <div><b>2010 ACR/EULAR Classification Criteria</b><span>for Rheumatoid Arthritis (RA)</span></div>
        <span className="ra-banner__ic"><Icon name="clipboard" size={28} /></span>
      </div>

      <div className="ra-grid" dir="ltr">
        <aside className="ra-side">
          <div className="ra-card"><h4><span className="ra-card__ic"><Icon name="target" size={16} /></span>Purpose</h4>
            <p>Classification criteria for RA in patients with confirmed synovitis in ≥ 1 joint and no better alternative diagnosis.</p></div>
          <div className="ra-card ra-card--total"><h4><span className="ra-card__ic"><Icon name="grid" size={16} /></span>Total Score (0 – 10)</h4>
            <div className="ra-score"><b>{r.total}</b>/10</div></div>
          <div className="ra-card"><h4><span className="ra-card__ic"><Icon name="trend" size={16} /></span>Interpretation</h4>
            <p className={`ra-int${r.complete && r.classified ? ' is-on' : ''}`}><Icon name="checkCircle" size={18} /> <b>≥ 6 / 10:</b> Classifies as Rheumatoid Arthritis.</p>
            <p className={`ra-int ra-int--no${r.complete && !r.classified ? ' is-on' : ''}`}><span className="ra-minus">−</span> <b>&lt; 6 / 10:</b> Does not meet criteria yet (follow-up and reassessment).</p>
            {!r.complete && <p className="ra-warn" dir="rtl">اختار صف في كل مجال من الأربعة عشان النتيجة تكتمل.</p>}</div>
          <div className="ra-card"><h4><span className="ra-card__ic">i</span>Key Notes</h4>
            <ul className="ra-notes">
              <li>Apply in patients with clinical synovitis (≥ 1 joint).</li><li>Use the highest score in each domain.</li>
              <li>Criteria classify RA (not a standalone diagnosis).</li><li>EARLY application helps early treatment and better outcomes.</li>
            </ul></div>
        </aside>

        <div className="ra-table">
          <div className="ra-thead"><span>Domain</span><span>Criteria</span><span>Score</span></div>
          {RA_DOMAINS.map((d, di) => {
            const chosen = d.rows.findIndex(([c]) => a.has(d.g, c));
            return (
              <div className="ra-dom" key={d.g}>
                <div className="ra-dom__name"><span className="ra-dom__ic"><Icon name={d.icon} size={26} /></span><b>{di + 1}. {d.title}</b><small>(0 – {d.max})</small></div>
                <div className="ra-dom__rows">
                  {d.rows.map(([c, sc], i) => (
                    <button key={c} type="button" aria-pressed={chosen === i} className={`ra-row${chosen === i ? ' is-on' : ''}`} onClick={() => pickRow(d.g, i)}>
                      <span className="ra-row__c">{chosen === i && <Icon name="check" size={14} />} {c}</span><span className="ra-row__s">{sc}</span>
                    </button>
                  ))}
                  {d.g === 'ra.j' && (
                    <div className="ra-help">
                      <label>Large joints <input className="sh-in sh-in--num" inputMode="numeric" value={a.txt('ra.large')} onChange={(e) => setCount('ra.large', e.target.value)} /></label>
                      <label>Small joints <input className="sh-in sh-in--num" inputMode="numeric" value={a.txt('ra.small')} onChange={(e) => setCount('ra.small', e.target.value)} /></label>
                      <small dir="rtl">اكتب العدد والصف بيتختار تلقائي</small>
                    </div>
                  )}
                  {d.g === 'ra.s' && (
                    <div className="ra-help">
                      {(['rf', 'ccp'] as const).map((w) => (
                        <span key={w} className="ra-help__g"><b>{w === 'rf' ? 'RF' : 'Anti-CCP'}</b>
                          {SERO.map((l, i) => <button key={l} type="button" className={`ra-chip${(w === 'rf' ? rf : ccp) === i ? ' is-on' : ''}`} onClick={() => setSero(w, i)}>{l}</button>)}</span>
                      ))}
                    </div>
                  )}
                  {d.g === 'ra.a' && (
                    <div className="ra-help">
                      {(['esr', 'crp'] as const).map((w) => (
                        <span key={w} className="ra-help__g"><b>{w.toUpperCase()}</b>
                          {[false, true].map((abn) => <button key={String(abn)} type="button" className={`ra-chip${(w === 'esr' ? esr : crp) === abn ? ' is-on' : ''}`} onClick={() => setApr(w, abn)}>{abn ? 'Abnormal' : 'Normal'}</button>)}</span>
                      ))}
                    </div>
                  )}
                </div>
                <div className="ra-dom__score">{r.scores[di] ?? '—'}</div>
              </div>
            );
          })}
          <div className={`ra-total${r.complete && r.classified ? ' is-yes' : ''}`}><span>Total Score (maximum = 10)</span><b>{r.total}<small>/10</small></b></div>
        </div>
      </div>

      <div className="ra-foot" dir="rtl">
        <details className="ra-ref"><summary>عرض جدول المعايير (الصورة)</summary><img src={IMG} alt="2010 ACR/EULAR Classification Criteria for RA" loading="lazy" /></details>
        <label className="ra-note"><span>ملاحظة الطبيب</span>
          <textarea className="sh-in sh-notes" dir="auto" rows={2} value={a.txt('ra.note')} onChange={(e) => a.set('ra.note', e.target.value)} /></label>
        <label className={`ra-ok${r.approved ? ' is-on' : ''}`}>
          <input type="checkbox" checked={r.approved} onChange={() => a.toggle('ra', 'approved')} />
          <span>اعتمدت التقييم — المعايير دي للتصنيف بس، والتشخيص النهائي والخطة العلاجية قرار الطبيب (مفيش حاجة بتتغيّر تلقائي).</span>
        </label>
      </div>
    </section>
  );
}
