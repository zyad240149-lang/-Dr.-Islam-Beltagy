// شيت التشخيص (Diagnosis Sheet) جوّه كشف الطبيب — نفس ورق د. اسلام: أقسام مرقّمة بألوان، بنود فرعية تحت البند، «Others» لكل قسم،
// والتشخيص النهائي (الأساسي + 4 إضافي + ملاحظات). البنود والتخزين في dxCatalog.ts.
import { Fragment } from 'react';
import { Ck, Txt, type Api } from './ExamSheet';
import { DX_SHEETS, FDX, dxGroupKey, dxSub, type DxSheetId } from './dxCatalog';

export function DxSheet({ a, prefix, id }: { a: Api; prefix: string; id: DxSheetId }) {
  const parts = DX_SHEETS[id];
  return (
    <div className="dxs">
      {parts.map((part) => (
        <Fragment key={part.key}>
          {(parts.length > 1 || part.hero) && <div className="dxs__part">{part.hero && <img className="dxs__hero" src={part.hero} alt="" loading="lazy" />}{part.title}</div>}
          <div className="dxs__grid">
            {part.groups.map((gr, n) => {
              const g = dxGroupKey(prefix, part, n);
              return (
                <section key={gr.title} className={`dxg dxg--${(n % 7) + 1}`}>
                  <h4 className="dxg__h"><span className="dxg__n">{n + 1}</span>{gr.title}</h4>
                  <div className={`dxg__b${n < (part.pics ?? 0) ? ' has-pic' : ''}`}>
                    {n < (part.pics ?? 0) && <img className="dxg__pic" src={`/dx/${part.key}-${n + 1}.webp`} alt="" loading="lazy" />}
                    {gr.items.map((it) => typeof it === 'string'
                      ? <Ck key={it} on={a.has(g, it)} onToggle={() => a.toggle(g, it)}>{it}</Ck>
                      : (
                        <Fragment key={it[0]}>
                          <Ck on={a.has(g, it[0])} onToggle={() => a.toggle(g, it[0])}>{it[0]}</Ck>
                          <div className="dxg__sub">{it[1].map((s) => <Ck key={s} on={a.has(g, dxSub(it[0], s))} onToggle={() => a.toggle(g, dxSub(it[0], s))}>{s}</Ck>)}</div>
                        </Fragment>
                      ))}
                    <Txt a={a} k={`${g}.other`} label="Others (specify):" />
                  </div>
                </section>
              );
            })}
          </div>
        </Fragment>
      ))}
      <div className="dxs__final">
        <section className="dxg dxg--final">
          <h4 className="dxg__h">Final Diagnosis</h4>
          <div className="dxg__b">
            <Txt a={a} k={`${prefix}.fdx.primary`} label="1. Primary Diagnosis:" />
            <div className="sh-lbl">2. Additional Diagnosis (es):</div>
            <div className="dxs__add">{FDX.slice(1).map((n) => <Txt key={n} a={a} k={`${prefix}.fdx.${n}`} label={`${n}.`} />)}</div>
          </div>
        </section>
        <section className="dxg dxg--final">
          <h4 className="dxg__h">Notes</h4>
          <div className="dxg__b"><textarea className="sh-in sh-notes" dir="auto" aria-label="Notes" value={a.txt(`${prefix}.fdx.notes`)} onChange={(e) => a.set(`${prefix}.fdx.notes`, e.target.value)} /></div>
        </section>
      </div>
    </div>
  );
}
