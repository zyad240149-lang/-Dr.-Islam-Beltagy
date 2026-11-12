// شاشة طلبات الأشعة والتحاليل في تاب «الأشعة والتحاليل» بالكشف (وفي «متابعة المريض») — اختيار + حفظ + طباعة + حفظ كصورة + واتساب
// ١٢/١١: CT / MRI / X-Ray / Laboratory بنفس شكل ورق العيادة: كل قسم مقفول ويتفتح بضغطة، وجنب كل بند صورته مقصوصة من نفس صورة الورقة
import { useContext, useEffect, useState, type ReactNode } from 'react';
import { groupOtherKey, radPicked } from './radDetail';
import { Button } from '../components/ui';
import { Icon } from '../utils/icons';
import { useToast } from '../hooks/useToast';
import type { ExamSheet } from './data';
import { BoxOpenDefault, Checks, Ck, Pick, Txt, sheetApi, type Api } from './ExamSheet';
import { LAB_OTHERS, RAD_REGIONS, RAD_SIDES, RAD_TYPES, radTypes } from './requestData';
import { EXTRA_CROP, IW, IH, LAB_SHEET_GROUPS, LAB_SPECIAL_CROP, OTHER_RAD_FORMS as OTHER_FORMS, SECTION_CROP, SHEET_IMG, SHEET_NAME, TITLE_CROP, labOn, labToggle, otherRadCount, radForm, reqPages, sheetCount, type RadSheetId, type ReqKind, type SheetId } from './requestSheets';
import { LAB_BOXES, RAD_BOXES, type Box4 } from './requestSheetBoxes';

type Act = (kind: ReqKind) => void;

/** جزء من صورة الورقة (قص بالـ CSS) — بعرض w أو بارتفاع h */
function Crop({ id, box: [x0, y0, x1, y1], w, h }: { id: SheetId; box: Box4; w?: number; h?: number }) {
  const k = w ? w / (x1 - x0) : (h ?? 40) / (y1 - y0);
  return <span className="rs-crop" aria-hidden style={{ backgroundImage: `url(${SHEET_IMG[id]})`, width: Math.round((x1 - x0) * k), height: Math.round((y1 - y0) * k), backgroundSize: `${IW * k}px ${IH * k}px`, backgroundPosition: `-${x0 * k}px -${y0 * k}px` }} />;
}
const Count = ({ n }: { n: number }) => (n > 0 ? <span className="rs-n num">{n} ✓</span> : null);

/** قسم مقفول بيتفتح ويتقفل بضغطة */
function Sec({ head, n, cls = '', children }: { head: ReactNode; n: number; cls?: string; children: ReactNode }) {
  return (
    <details className={`rs-sec ${cls}`}>
      <summary>{head}<Count n={n} /><Icon name="chevron" size={14} /></summary>
      <div className="rs-sec__b">{children}</div>
    </details>
  );
}

/** النموذج كله: عنوانه = عنوان الورقة نفسها، مقفول ويتفتح */
function SheetCard({ id, n, children }: { id: SheetId; n: number; children: ReactNode }) {
  return (
    <details className="rs-card">
      <summary aria-label={`${SHEET_NAME[id].en} — ${SHEET_NAME[id].ar}`}><Crop id={id} box={TITLE_CROP[id]} h={46} /><Count n={n} /><Icon name="chevron" size={16} /></summary>
      <div className="rs-card__b" dir="ltr">{children}</div>
    </details>
  );
}

// طلب أشعة / طلب تحاليل: مفتوح ويتقفل بزرار في العنوان (الأزرار — حفظ / طباعة / صورة / واتساب — ظاهرة دايمًا)
function Card({ icon, title, en, children, actions }: { icon: string; title: string; en: string; children: ReactNode; actions: ReactNode }) {
  const [open, setOpen] = useState(useContext(BoxOpenDefault));
  return (
    <section className="rq-card">
      <header className="rq-card__h"><Icon name={icon} size={18} /><b>{title}</b><span dir="ltr">{en}</span>
        <button type="button" className="sh-box__t" aria-expanded={open} onClick={() => setOpen(!open)}>{open ? 'إغلاق' : 'فتح'}</button>
      </header>
      {open && <div className="rq-card__b rs-cards">{children}</div>}
      <div className="rq-card__f">{actions}</div>
    </section>
  );
}

function RadSheet({ id, a, sheet }: { id: RadSheetId; a: Api; sheet: ExamSheet }) {
  const f = radForm(id), bx = RAD_BOXES[id];
  let ri = 0;
  return (
    <SheetCard id={id} n={sheetCount(id, sheet)}>
      <div className="rs-secs">
        {f.groups.map((g, gi) => {
          const start = ri; ri += g.rows?.length ?? 0;
          const n = (g.rows ?? []).filter(([r, o]) => a.has(`${id}.rows`, r) || o.some((x) => a.has(`${id}.r.${r}`, x))).length
            + (g.items ?? []).filter((i) => a.has(`${id}.sp`, i)).length + (g.items && f.other && a.txt(`${id}.other`).trim() ? 1 : 0);
          return (
            <Sec key={g.en} n={n} head={<span title={`${g.en} — ${g.ar}`}><Crop id={id} box={SECTION_CROP[id][gi]} h={40} /></span>}>
              {g.rows?.map(([r, opts], i) => (
                <div key={r} className="rs-row">
                  {bx.crops[start + i] && <Crop id={id} box={bx.crops[start + i]!} w={62} />}
                  <b className="rs-row__n">{r}</b>
                  <div className="rs-row__o"><Checks a={a} g={`${id}.r.${r}`} items={opts} /></div>
                </div>
              ))}
              {g.items?.map((it, i) => (
                <div key={it} className="rs-row rs-row--sp">
                  {bx.spCrops[i] ? <Crop id={id} box={bx.spCrops[i]!} w={62} /> : null}
                  <div className="rs-row__o"><Ck on={a.has(`${id}.sp`, it)} onToggle={() => a.toggle(`${id}.sp`, it)}>{it}</Ck></div>
                </div>
              ))}
              {g.items && f.other && <Txt a={a} k={`${id}.other`} label="Other Region" dir="ltr" />}
            </Sec>
          );
        })}
      </div>
      <div className="rs-bottom">
        <Crop id={id} box={EXTRA_CROP[id]} h={64} />
        {f.extras.map((x, i) => (
          <div key={x.label} className="rs-ex"><div className="sh-lbl">{x.label}</div>{x.one ? <Pick a={a} g={`${id}.x${i}`} items={x.items} /> : <Checks a={a} g={`${id}.x${i}`} items={x.items} />}</div>
        ))}
      </div>
      <div className="sh-lbl">Clinical Notes — ملاحظات طبية</div>
      <textarea className="sh-in sh-notes" dir="auto" rows={2} aria-label="Clinical Notes" value={a.txt(`${id}.notes`)} onChange={(e) => a.set(`${id}.notes`, e.target.value)} />
    </SheetCard>
  );
}

function LabSheet({ a, sheet, onChange }: { a: Api; sheet: ExamSheet; onChange: (f: (s: ExamSheet) => ExamSheet) => void }) {
  const group = (gi: number) => {
    const g = LAB_SHEET_GROUPS[gi];
    return (
      <Sec key={g.en} cls={g.special ? 'rs-sec--sp' : ''} n={g.items.filter((i) => labOn(sheet, i)).length}
        head={<><Crop id="lab" box={LAB_BOXES.icons[gi]} h={30} /><span className="rs-sec__t"><b>{g.en}</b><small dir="rtl">{g.ar}</small></span></>}>
        <div className="rs-list">{g.items.map((i) => <Ck key={i} on={labOn(sheet, i)} onToggle={() => onChange((x) => labToggle(x, i))}>{i}</Ck>)}</div>
      </Sec>
    );
  };
  const normal = LAB_SHEET_GROUPS.map((g, i) => (g.special ? -1 : i)).filter((i) => i >= 0);
  const special = LAB_SHEET_GROUPS.map((g, i) => (g.special ? i : -1)).filter((i) => i >= 0);
  return (
    <SheetCard id="lab" n={sheetCount('lab', sheet)}>
      <div className="rs-labs">
        {normal.map(group)}
        <Sec n={LAB_OTHERS.filter((k) => a.txt(k).trim()).length} head={<><Crop id="lab" box={LAB_BOXES.othersIcon} h={30} /><span className="rs-sec__t"><b>Others</b><small dir="rtl">أخرى</small></span></>}>
          {LAB_OTHERS.map((k) => <Txt key={k} a={a} k={k} placeholder="Test name" dir="ltr" />)}
        </Sec>
      </div>
      <div className="rs-labsp">
        <Crop id="lab" box={LAB_SPECIAL_CROP} h={78} />
        <div className="rs-labs">{special.map(group)}</div>
      </div>
      <div className="sh-lbl">Clinical Notes — ملاحظات طبية</div>
      <textarea className="sh-in sh-notes" dir="auto" rows={2} aria-label="Clinical Notes" value={a.txt('lr.notes')} onChange={(e) => a.set('lr.notes', e.target.value)} />
    </SheetCard>
  );
}

/** مربع مقفول افتراضيًا بزرار «فتح» / «إغلاق» — اللي اتعلّم جوّاه بيفضل محفوظ وعدده ظاهر في العنوان */
function Fold({ title, en, count, children }: { title: string; en: string; count: number; children: ReactNode }) {
  const [open, setOpen] = useState(false);
  return (
    <div className={`rq-det${open ? ' is-open' : ''}`}>
      <div className="rq-det__h">
        <b>{title}</b> <span dir="ltr">{en}</span>{count > 0 && <span className="badge badge--info num">{count} مختار</span>}
        <Button size="sm" variant={open ? 'outline' : undefined} icon={open ? 'close' : 'plus'} onClick={() => setOpen(!open)} style={{ marginInlineStart: 'auto' }}>{open ? 'إغلاق' : 'فتح'}</Button>
      </div>
      {open && children}
    </div>
  );
}

export function RequestForms({ sheet, onChange, busy, disabled, onSave, onPrint, onImage, onWhatsapp, prepare }: {
  sheet: ExamSheet; onChange: (f: (s: ExamSheet) => ExamSheet) => void; busy: boolean; disabled: boolean;
  onSave: () => void; onPrint: Act; onImage: Act; onWhatsapp: Act; prepare: Act;
}) {
  const toast = useToast();
  const a = sheetApi(sheet, onChange);
  const otherN = otherRadCount(sheet);
  const radN = sheetCount('ct', sheet) + sheetCount('mr', sheet) + sheetCount('xr', sheet) + otherN, labN = sheetCount('lab', sheet);
  const filled = (kind: ReqKind) => reqPages(kind, sheet, null, '').length > 0;
  // صورة كل طلب بتتجهز في الخلفية بعد ما الاختيارات تهدى ثانية — عشان «حفظ كصورة» يحفظ في نفس الضغطة
  useEffect(() => {
    if (disabled) return;
    const t = window.setTimeout(() => { if (filled('rad')) prepare('rad'); if (filled('lab')) prepare('lab'); }, 1000);
    return () => window.clearTimeout(t);
  }, [sheet, disabled]); // eslint-disable-line react-hooks/exhaustive-deps
  const need = (kind: ReqKind, go: Act) => () => {
    if (!filled(kind)) { toast.error(kind === 'rad' ? 'علّم الأشعة المطلوبة الأول.' : 'علّم التحاليل المطلوبة الأول.'); return; }
    go(kind);
  };
  const acts = (kind: ReqKind) => (
    <>
      <Button size="sm" variant="outline" icon="check" loading={busy} disabled={disabled} onClick={onSave}>حفظ</Button>
      <Button size="sm" icon="print" loading={busy} disabled={disabled} onClick={need(kind, onPrint)}>طباعة</Button>
      <Button size="sm" variant="outline" icon="download" loading={busy} disabled={disabled} onClick={need(kind, onImage)}>حفظ كصورة على الجهاز</Button>
      <Button size="sm" variant="outline" icon="share" loading={busy} disabled={disabled} onClick={() => onWhatsapp(kind)}>فتح واتساب المريض</Button>
    </>
  );
  return (
    <div className="rq-forms">
      {/* طلب أشعة: نماذج CT / MRI / X-Ray — الطباعة والصورة فيهم كل نموذج متعلّم فيه حاجة (كل نموذج صفحة) */}
      <Card icon="scan" title={`طلب أشعة${radN ? ` (${radN})` : ''}`} en="Radiology Request" actions={acts('rad')}>
      {(['ct', 'mr', 'xr'] as const).map((id) => <RadSheet key={id} id={id} a={a} sheet={sheet} />)}

      {/* أشعة تانية مش في الورق (سونار / ديكسا / مسح ذري…) — بتتطبع على ورقة العيادة العادية */}
      <details className="rs-card rs-card--other">
        <summary><Icon name="scan" size={18} /><b>طلبات أشعة أخرى</b><span dir="ltr">Ultrasound · DEXA · Bone Scan…</span><Count n={otherN} /><Icon name="chevron" size={16} /></summary>
        <div className="rs-card__b">
          <Fold title="طلب سريع (النوع والجانب والمنطقة)" en="Quick Request" count={radTypes(sheet).length}>
            <div className="rq-det__q">
              <div className="sh-lbl">نوع الأشعة المطلوبة — Requested Investigation</div>
              <div className="rq-grid" dir="ltr"><Checks a={a} g="rr.type" items={RAD_TYPES.map(([l]) => l)} /></div>
              <div className="sh-lbl">الجانب — Side</div>
              <div className="sh-inline" dir="ltr"><Pick a={a} g="rr.side" items={RAD_SIDES} /></div>
              <div className="sh-lbl">المنطقة المطلوبة — Body Region</div>
              <div className="rq-grid" dir="ltr"><Checks a={a} g="rr.reg" items={RAD_REGIONS} /></div>
              <Txt a={a} k="rr.reg.other" label="Other region" dir="ltr" />
            </div>
          </Fold>
          {OTHER_FORMS.map((f) => (
            <Fold key={f.id} title={f.ar} en={f.en} count={radPicked(sheet, f).count}>
              <div className="rq-det__b">
                <div className="rq-grp rq-grp--top">
                  <div className="rq-grp__t"><b dir="ltr">Additional Details</b><span>تفاصيل إضافية</span></div>
                  <div dir="ltr" className="rq-ex">
                    {f.extras.map((x, i) => (
                      <div key={x.label}><div className="sh-lbl">{x.label}</div>{x.one ? <Pick a={a} g={`${f.id}.x${i}`} items={x.items} /> : <Checks a={a} g={`${f.id}.x${i}`} items={x.items} />}</div>
                    ))}
                  </div>
                </div>
                {f.groups.map((g) => (
                  <div key={g.en} className="rq-grp">
                    <div className="rq-grp__t"><b dir="ltr">{g.en}</b><span>{g.ar}</span></div>
                    <div dir="ltr">
                      {g.items && <div className="rq-col"><Checks a={a} g={`${f.id}.sp`} items={g.items} /></div>}
                      {g.items && g.other && <Txt a={a} k={groupOtherKey(f, g)} label="Other" dir="ltr" />}
                    </div>
                  </div>
                ))}
                <div className="sh-lbl">ملاحظات طبية — Clinical Notes</div>
                <textarea className="sh-in sh-notes" dir="auto" rows={2} aria-label="Clinical Notes" value={a.txt(`${f.id}.notes`)} onChange={(e) => a.set(`${f.id}.notes`, e.target.value)} />
              </div>
            </Fold>
          ))}
          <div className="sh-lbl">السبب الطبي / الاشتباه الإكلينيكي — Clinical Indication</div>
          <textarea className="sh-in sh-notes" dir="auto" rows={2} aria-label="Clinical Indication" value={a.txt('rr.ind')} onChange={(e) => a.set('rr.ind', e.target.value)} />
        </div>
      </details>
      </Card>

      <Card icon="list" title={`طلب تحاليل${labN ? ` (${labN})` : ''}`} en="Laboratory Request" actions={acts('lab')}>
        <LabSheet a={a} sheet={sheet} onChange={onChange} />
      </Card>
    </div>
  );
}
