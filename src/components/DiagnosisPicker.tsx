import { useMemo, useState } from 'react';
import { BODY_REGIONS, SIDE_EN, SIDE_LABEL, findCondition, type BodyRegion, type Condition } from '../data/bodyRegions';
import { BodyFigure, regionById, type BodyView } from './BodyFigure';
import { Button, EmptyState, Input, Modal } from './ui';
import { Icon } from '../utils/icons';
import type { DiagnosisRef } from '../types';

export const DIAGNOSIS_LIST_ID = 'dx-conditions';
type Side = 'right' | 'left' | 'both';

export const diagnosisText = (c: Condition, side: Side | null) => (side ? `${c.en} — ${SIDE_EN[side]}` : c.en);

// قائمة اقتراحات للكتابة الحرة في حقول التشخيص
export function DiagnosisDatalist() {
  return (
    <datalist id={DIAGNOSIS_LIST_ID}>
      {BODY_REGIONS.flatMap((r) => r.conditions.map((c) => <option key={c.id} value={c.en}>{`${r.en} — ${c.name} · ${c.icd10}`}</option>))}
    </datalist>
  );
}

// شارة الكود بجانب التشخيص (FR-9)
export function DiagnosisCode({ dref }: { dref?: DiagnosisRef | null }) {
  if (!dref) return null;
  const found = findCondition(dref.conditionId);
  return <span className="dx-code num" title={found ? `${found.region.name} · ${found.condition.en}` : undefined}>{dref.icd10}</span>;
}

// حقل تشخيص كامل: نص + رابط الخريطة + شارة الكود. التعديل اليدوي يفك الربط بالمرجع (FR-7)
export function DiagnosisField({ id, label, value, dref, onChange }: {
  id: string; label: string; value: string; dref?: DiagnosisRef | null;
  onChange: (text: string, dref: DiagnosisRef | null) => void;
}) {
  const [open, setOpen] = useState(false);
  const [typed, setTyped] = useState(false);
  return (
    <div className="dx-field">
      <Input id={id} label={label} list={DIAGNOSIS_LIST_ID} dir="ltr" className="dx-input" value={value}
        onFocus={() => { if (!typed) setOpen(true); }}
        onChange={(e) => {
          const text = e.target.value;
          const exact = BODY_REGIONS.flatMap((r) => r.conditions.map((c) => ({ r, c }))).find(({ c }) => c.en === text);
          onChange(text, exact && !exact.r.sided ? { conditionId: exact.c.id, regionId: exact.r.id, icd10: exact.c.icd10, side: null } : null);
        }} />
      <button type="button" className="dx-open" onClick={() => setOpen(true)}><Icon name="body" size={15} /> اختيار من خريطة الجسم</button>
      {dref && <div className="dx-linked"><DiagnosisCode dref={dref} /> مرتبط بالمرجع{dref.side ? ` · ${SIDE_EN[dref.side]}` : ''}</div>}
      <DiagnosisDatalist />
      {open && (
        <DiagnosisPicker
          onPick={(text, ref) => { onChange(text, ref); setOpen(false); }}
          onClose={() => { setOpen(false); setTyped(true); }}
        />
      )}
    </div>
  );
}

export function DiagnosisPicker({ onPick, onClose }: { onPick: (text: string, ref: DiagnosisRef) => void; onClose: () => void }) {
  const [view, setView] = useState<BodyView>('front');
  const [selected, setSelected] = useState<string | null>(null);
  const [hovered, setHovered] = useState<string | null>(null);
  const [q, setQ] = useState('');
  const [pending, setPending] = useState<{ region: BodyRegion; c: Condition } | null>(null);
  const search = q.trim().toLowerCase();

  const results = useMemo(() => !search ? [] : BODY_REGIONS.flatMap((r) =>
    r.conditions.filter((c) => c.name.includes(q.trim()) || c.en.toLowerCase().includes(search) || c.icd10.toLowerCase().includes(search)).map((c) => ({ region: r, c }))),
  [q, search]);
  const highlighted = useMemo(() => new Set(results.map((x) => x.region.id)), [results]);
  const region = selected ? regionById(selected) : undefined;
  const list = search ? results : (region?.conditions ?? []).map((c) => ({ region: region!, c }));

  const finish = (r: BodyRegion, c: Condition, side: Side | null) =>
    onPick(diagnosisText(c, side), { conditionId: c.id, regionId: r.id, icd10: c.icd10, side });
  const choose = (r: BodyRegion, c: Condition) => (r.sided ? setPending({ region: r, c }) : finish(r, c, null));

  return (
    <Modal title="اختيار التشخيص من خريطة الجسم" wide onClose={onClose} footer={<Button variant="outline" onClick={onClose}>إغلاق</Button>}>
      <div className="dx-layout">
        <div className="dx-body">
          <div className="seg" style={{ marginBottom: 8 }}>
            <button type="button" className={`seg__btn ${view === 'front' ? 'active' : ''}`} onClick={() => setView('front')}>أمامي</button>
            <button type="button" className={`seg__btn ${view === 'back' ? 'active' : ''}`} onClick={() => setView('back')}>خلفي</button>
          </div>
          <BodyFigure key={view} view={view} compact selected={pending?.region.id ?? selected} hovered={hovered} highlighted={highlighted}
            onSelect={(id) => { setSelected(id); setQ(''); setPending(null); }} onHover={setHovered} />
          <div className="dx-hint">{hovered ? regionById(hovered)?.name : region ? region.name : 'اضغط على منطقة الألم'}</div>
        </div>

        <div className="dx-list">
          {pending ? (
            <div className="dx-side">
              <button type="button" className="bm-region-link" onClick={() => setPending(null)}><Icon name="chevron" size={13} /> رجوع للحالات</button>
              <div className="dx-side__cond">
                <strong dir="ltr">{pending.c.en} <span className="dx-code">{pending.c.icd10}</span></strong>
                <small>{pending.c.name.replace(/\s*\(تأهيل\)/, '')}</small>
              </div>
              <div className="section-title" style={{ fontSize: 14, margin: '14px 0 8px' }}>الجهة المصابة</div>
              <div className="dx-side__btns">
                {(['right', 'left', 'both'] as Side[]).map((s) => (
                  <button key={s} type="button" className="dx-side__btn" onClick={() => finish(pending.region, pending.c, s)}>{SIDE_EN[s]}<small>{SIDE_LABEL[s]}</small></button>
                ))}
              </div>
            </div>
          ) : (
            <>
              <Input id="dx-q" icon="search" placeholder="Search: Knee OA, ACL, M17…" value={q} onChange={(e) => setQ(e.target.value)} />
              {!search && !region ? <EmptyState icon="body" title="اختر منطقة من الجسم" text="أو ابحث باسم الحالة بالعربي أو الإنجليزي أو كود ICD-10." />
                : list.length === 0 ? <EmptyState icon="search" title="ما فيه حالات مطابقة" /> : (
                  <div className="dx-options">
                    {!search && region && <div className="bm-list__title">{region.name} · <span className="num">{region.conditions.length}</span> حالات</div>}
                    {list.map(({ region: r, c }) => (
                      <button key={c.id} type="button" className="dx-option" onClick={() => choose(r, c)}>
                        <span>
                          <strong dir="ltr">{c.en} <span className="dx-code num">{c.icd10}</span></strong>
                          <small>{c.name.replace(/\s*\(تأهيل\)/, '')}{search ? ` · ${r.name}` : ''}</small>
                          <em>الاختبارات: <bdi>{c.tests}</bdi></em>
                        </span>
                        <Icon name={r.sided ? 'chevronLeft' : 'check'} size={16} />
                      </button>
                    ))}
                  </div>
                )}
            </>
          )}
        </div>
      </div>
    </Modal>
  );
}
