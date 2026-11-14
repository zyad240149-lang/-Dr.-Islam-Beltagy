// الروشتة والأشعة والتحاليل والتعليمات — بتتملى في شيت المتابعة (Nursing.tsx). الكشوفات القديمة لسه شايلة الروشتة بتاعتها في حقولها.
import { useRef, useState, type ReactNode } from 'react';
import { Button } from '../components/ui';
import { Icon } from '../utils/icons';
import { useToast } from '../hooks/useToast';
import { IMAGING_KIND, IMAGING_STATUS, ortho, type Attachment, type ImagingKind, type ImagingRequest, type Medication, type RxData, type RxTemplate } from './data';
import { LAB_GROUPS, MED_DOSES, MED_DURATIONS, MED_FREQS, MED_NOTES, XRAY_VIEWS, medCatalog, type MedPreset } from './clinicalLists';
import { useMedBank } from './medBank';
import { useRxInteractions } from './interactions';
import { AttachmentThumbs } from './Consultations';
import { IconBtn, Tone, useClinicalCan } from './kit';
import { MedDoctorInfo } from './medInfo';
import { sortGroups, useGroupOrder } from './groupOrder';

export const emptyRx = (): RxData => ({ medications: [], labs: [], imagingRequests: [], attachments: [], plan: '' });
export const normRx = (r?: Partial<RxData>): RxData => ({ ...emptyRx(), ...r });
export const hasRx = (r: RxData) => !!(r.medications.length || r.labs.length || r.imagingRequests.length || r.attachments.length || r.plan.trim());
const emptyMed = (): Medication => ({ name: '', dose: '', frequency: '', duration: '', notes: '' });
const reqKey = (r: ImagingRequest) => `${r.kind}|${r.region.trim()}|${r.view.trim()}`;

/** قبل الحفظ: الأدوية والطلبات الفاضية بتتشال */
export const cleanRx = (r: RxData): RxData => ({ ...r, medications: r.medications.filter((m) => m.name.trim()), imagingRequests: r.imagingRequests.filter((x) => x.region.trim()) });

/** طلبات الأشعة والتحاليل الجديدة بتتسجل «مطلوبة» في «الأشعة والتحاليل» عشان تتابع وصولها وقراءتها */
export async function registerRxRequests(patientId: string, date: string, rx: RxData, before?: RxData) {
  const oldReqs = new Set((before?.imagingRequests ?? []).map(reqKey));
  for (const r of rx.imagingRequests.filter((x) => !oldReqs.has(reqKey(x)))) {
    await ortho.save('imaging', { patientId, kind: r.kind, region: r.view ? `${r.region} — ${r.view}` : r.region, requestedAt: date, status: 'requested', finding: '', attachments: [] });
  }
  const oldLabs = new Set(before?.labs ?? []);
  for (const l of rx.labs.filter((x) => !oldLabs.has(x))) {
    await ortho.save('imaging', { patientId, kind: 'lab', region: l, requestedAt: date, status: 'requested', finding: '', attachments: [] });
  }
}

function Section({ icon, title, children, aside }: { icon: string; title: string; children: ReactNode; aside?: ReactNode }) {
  return (
    <section className="cx-sec">
      <div className="cx-sec__head"><Icon name={icon} size={17} /><h3>{title}</h3>{aside && <div className="cx-sec__aside">{aside}</div>}</div>
      {children}
    </section>
  );
}

// اختيارات خانات الدواء في الروشتة — و«أخرى…» بتفتح كتابة حرة، والقيمة المحفوظة بأي صيغة بتفضل ظاهرة
const OTHER_CHOICE = '__other__';
function MedChoice({ label, value, options, onChange }: { label: string; value: string; options: string[]; onChange: (v: string) => void }) {
  const [typing, setTyping] = useState(false);
  if (typing) return <input className="input" aria-label={label} placeholder={`اكتب ${label}`} autoFocus value={value} onChange={(e) => onChange(e.target.value)} onBlur={() => setTyping(false)} />;
  return (
    <select className="input" aria-label={label} value={value} onChange={(e) => { if (e.target.value === OTHER_CHOICE) { onChange(''); setTyping(true); } else onChange(e.target.value); }}>
      <option value="">{label}</option>
      {value && !options.includes(value) && <option value={value}>{value}</option>}
      {options.map((o) => <option key={o} value={o}>{o}</option>)}
      <option value={OTHER_CHOICE}>أخرى…</option>
    </select>
  );
}

/** rxOnly: جوّه الكشف — الروشتة بس (الأدوية والتعليمات)؛ الأشعة والتحاليل في تابها */
/** requestsOnly: الأشعة/السونار والتحاليل المطلوبة بس (تاب «الأشعة والتحاليل» في الكشف) */
export function RxEditor({ value: c, onChange, patientId, region = '', onUploading, rxOnly, requestsOnly }: { value: RxData; onChange: (f: (r: RxData) => RxData) => void; patientId: string; region?: string; onUploading?: (v: boolean) => void; rxOnly?: boolean; requestsOnly?: boolean }) {
  const toast = useToast();
  const [uploading, setUp] = useState(false);
  const [labQ, setLabQ] = useState('');
  const fileRef = useRef<HTMLInputElement>(null);
  const labFileRef = useRef<HTMLInputElement>(null);
  const setUploading = (v: boolean) => { setUp(v); onUploading?.(v); };
  const outstandingLabs = patientId ? ortho.list('imaging', patientId).filter((m) => m.kind === 'lab' && m.status !== 'reviewed') : [];
  const set = <K extends keyof RxData>(k: K, v: RxData[K]) => onChange((x) => ({ ...x, [k]: v }));
  const setMed = (i: number, patch: Partial<Medication>) => set('medications', c.medications.map((m, j) => (j === i ? { ...m, ...patch } : m)));
  const pickMedName = (i: number, name: string) => {
    const p = medCatalog().find((x) => x.name === name);
    const cur = c.medications[i];
    if (p && c.medications.some((m, j) => j !== i && m.name.trim().toLowerCase() === name.trim().toLowerCase())) toast.error(`«${name}» متكتب قبل كده في الروشتة — اتأكد إنك مش كاتبه مرتين.`);
    setMed(i, p ? { name, dose: cur.dose || p.dose, frequency: cur.frequency || p.frequency, duration: cur.duration || p.duration, notes: cur.notes || p.notes || '' } : { name });
  };
  const [medQ, setMedQ] = useState('');
  // ١٢/١١: اختيار الدواء على مربعين — الأول الأدوية، والتاني جرعات الدواء المختار، و«إضافة للروشتة» بتنزّله تحت
  const [sel, setSel] = useState<MedPreset | null>(null);
  const [openGroups, setOpenGroups] = useState<string[]>([]);
  // ١٢/١١: اختيارات بيضيفها الطبيب بنفسه لكل صف (جرعة/عدد مرات/مدة/ملاحظة) — محفوظة على الجهاز
  type OptKey = 'dose' | 'frequency' | 'duration' | 'notes';
  const [customOpts, setCustomOpts] = useState<Partial<Record<OptKey, string[]>>>(() => { try { return JSON.parse(localStorage.getItem('rx-custom-opts') || '{}'); } catch { return {}; } });
  const saveCustom = (k: OptKey, xs: string[]) => setCustomOpts((o) => { const n = { ...o, [k]: xs }; try { localStorage.setItem('rx-custom-opts', JSON.stringify(n)); } catch { /* المتصفح مانع التخزين — الاختيار شغال في الجلسة دي بس */ } return n; });
  const [adding, setAdding] = useState<OptKey | null>(null);
  const [newOpt, setNewOpt] = useState('');
  const [draft, setDraft] = useState<Pick<Medication, 'dose' | 'frequency' | 'duration' | 'notes'>>({ dose: '', frequency: '', duration: '', notes: '' });
  const choose = (p: MedPreset) => {
    const cur = c.medications.find((m) => m.name.trim().toLowerCase() === p.name.trim().toLowerCase());
    setSel(p);
    setDraft(cur ? { dose: cur.dose, frequency: cur.frequency, duration: cur.duration, notes: cur.notes ?? '' } : { dose: p.dose, frequency: p.frequency, duration: p.duration, notes: p.notes ?? '' });
  };
  const addSel = () => {
    if (!sel) return;
    const k = sel.name.trim().toLowerCase();
    const exists = c.medications.some((m) => m.name.trim().toLowerCase() === k);
    set('medications', exists
      ? c.medications.map((m) => (m.name.trim().toLowerCase() === k ? { ...m, ...draft } : m))
      : [...c.medications.filter((m) => m.name.trim()), { ...emptyMed(), name: sel.name, ...draft }]);
    if (exists) toast.info(`«${sel.name}» موجود في الروشتة — اتحدّثت جرعته.`);
    setSel(null);
  };
  const norm = (s: string) => s.trim().toLowerCase();
  // ١١/١١: نفس الدواء متكتب مرتين ← تنبيه + الصفوف المتكررة بتتعلّم بالأحمر
  const dupNames = (() => { const seen = new Map<string, number>(); for (const m of c.medications) { const k = norm(m.name); if (k) seen.set(k, (seen.get(k) ?? 0) + 1); } return new Set([...seen].filter(([, n]) => n > 1).map(([k]) => k)); })();
  const interactions = useRxInteractions(c.medications);
  const canSeeMedInfo = useClinicalCan('medications').view; // معلومات الطبيب الداخلية حسب صلاحية قسم «الأدوية»
  const hasMed = (name: string) => c.medications.some((m) => norm(m.name) === norm(name));
  const toggleMed = (p: MedPreset) => set('medications', hasMed(p.name)
    ? c.medications.filter((m) => norm(m.name) !== norm(p.name))
    : [...c.medications.filter((m) => m.name.trim()), { ...emptyMed(), name: p.name, dose: p.dose, frequency: p.frequency, duration: p.duration, notes: p.notes ?? '' }]);
  // روشتات جاهزة (قسم الأدوية): ضغطة بتنزّل كل أدويتها؛ لو كلها في الروشتة الضغطة بتشيلها
  const templates = ortho.list('rx_templates').filter((t) => t.items.length).sort((a, b) => a.name.localeCompare(b.name, 'ar'));
  const tplOn = (t: RxTemplate) => t.items.every((m) => hasMed(m.name));
  const applyTpl = (t: RxTemplate) => {
    if (tplOn(t)) { const ks = new Set(t.items.map((m) => norm(m.name))); set('medications', c.medications.filter((m) => !ks.has(norm(m.name)))); return; }
    const add = t.items.filter((m) => m.name.trim() && !hasMed(m.name)).map((m) => ({ ...emptyMed(), ...m, notes: m.notes ?? '' }));
    set('medications', [...c.medications.filter((m) => m.name.trim()), ...add]);
    toast.success(`نزلت روشتة «${t.name}» — ${add.length} دواء`);
  };
  const groupOrder = useGroupOrder();
  const medGroups = new Map<string, MedPreset[]>();
  for (const p of medCatalog()) {
    // من غير بحث: اللي الطبيب اختاره يظهر قدامه بس — البحث بيدور في البنك كله
    if (!medQ.trim() && p.shown === false) continue;
    if (medQ.trim() && !norm(p.name).includes(norm(medQ)) && !p.group.includes(medQ.trim())) continue;
    const g = p.group || 'أخرى'; medGroups.set(g, [...(medGroups.get(g) ?? []), p]);
  }
  // البحث بيكمّل من البنك الكامل على الخادم
  const bankHits = useMedBank(medQ, medQ.trim().length >= 2, 30).rows;
  const listed = new Set([...medGroups.values()].flat().map((p) => norm(p.name)));
  for (const p of bankHits) {
    if (listed.has(norm(p.name))) continue;
    const g = p.group || 'أخرى'; medGroups.set(g, [...(medGroups.get(g) ?? []), p]);
  }
  const toggleLab = (name: string) => set('labs', c.labs.includes(name) ? c.labs.filter((l) => l !== name) : [...c.labs, name]);
  const addCustomLab = () => { const v = labQ.trim(); if (v && !c.labs.includes(v)) set('labs', [...c.labs, v]); setLabQ(''); };
  const setReq = (i: number, patch: Partial<ImagingRequest>) => set('imagingRequests', c.imagingRequests.map((r, j) => (j === i ? { ...r, ...patch } : r)));

  async function upload(files: FileList | null) {
    if (!files?.length || !patientId) return;
    setUploading(true);
    try {
      const added: Attachment[] = [];
      for (const f of Array.from(files)) added.push(await ortho.uploadAttachment(patientId, f));
      onChange((x) => ({ ...x, attachments: [...x.attachments, ...added] }));
      toast.success(added.length > 1 ? `تم رفع ${added.length} ملفات` : 'تم رفع الأشعة');
    } catch (e) { toast.error((e as Error).message); }
    finally { setUploading(false); if (fileRef.current) fileRef.current.value = ''; if (labFileRef.current) labFileRef.current.value = ''; }
  }

  const customLabs = c.labs.filter((l) => !LAB_GROUPS.some((g) => g.items.includes(l)));
  const imagingSec = (
    <Section key="img" icon="scan" title={rxOnly ? 'أشعة / سونار مطلوبة' : 'الأشعة'} aside={<>
      <Button size="sm" variant="outline" icon="plus" onClick={() => set('imagingRequests', [...c.imagingRequests, { kind: 'xray', region, view: 'AP & Lateral' }])}>{rxOnly ? 'طلب أشعة / سونار' : 'طلب أشعة'}</Button>
      {!rxOnly && <Button size="sm" variant="outline" icon="camera" loading={uploading} disabled={!patientId} onClick={() => fileRef.current?.click()}>رفع صورة أشعة</Button>}
      {!rxOnly && <input ref={fileRef} type="file" hidden multiple accept="image/png,image/jpeg,image/webp,application/pdf" onChange={(e) => void upload(e.target.files)} />}
    </>}>
      {c.imagingRequests.length > 0 && (
        <div className="cx-rows">
          {c.imagingRequests.map((r, i) => (
            <div className="cx-row cx-row--img" key={i}>
              <select className="input" aria-label="نوع الأشعة" value={r.kind} onChange={(e) => setReq(i, { kind: e.target.value as ImagingKind })}>{Object.entries(IMAGING_KIND).map(([k, v]) => <option key={k} value={k}>{v}</option>)}</select>
              <input className="input" aria-label="المنطقة" placeholder="المنطقة" value={r.region} onChange={(e) => setReq(i, { region: e.target.value })} />
              <input className="input" aria-label="الوضع" placeholder="الوضع (View)" dir="ltr" list="cx-views" value={r.view} onChange={(e) => setReq(i, { view: e.target.value })} />
              <IconBtn icon="trash" label="حذف الطلب" danger onClick={() => set('imagingRequests', c.imagingRequests.filter((_, j) => j !== i))} />
            </div>
          ))}
          <datalist id="cx-views">{XRAY_VIEWS.map((v) => <option key={v} value={v} />)}</datalist>
        </div>
      )}
      {rxOnly
        ? c.imagingRequests.length === 0 && <p className="cx-empty">لو المريض محتاج أشعة أو سونار، اضغط «طلب أشعة / سونار» — بتتكتب في الروشتة.</p>
        : c.attachments.length > 0
          ? <AttachmentThumbs items={c.attachments} onRemove={(path) => set('attachments', c.attachments.filter((a) => a.path !== path))} />
          : c.imagingRequests.length === 0 && <p className="cx-empty">اطلب أشعة للمريض أو ارفع صورة الأشعة اللي معاه (صورة أو PDF، لحد 10 ميجا).</p>}
    </Section>
  );
  const medsSec = (
    <Section key="meds" icon="receipt" title={rxOnly ? 'الأدوية' : 'العلاج — الروشتة'} aside={<Button size="sm" variant="outline" icon="plus" onClick={() => set('medications', [...c.medications, emptyMed()])}>إضافة دواء</Button>}>
      {/* ١٢/١١: مربعين — (1) الأدوية (2) جرعات الدواء المختار ← «إضافة للروشتة» بتنزّله في القايمة تحت */}
      {templates.length > 0 && (
        <div className="cx-tpl">
          <span className="cx-tpl__t">روشتات جاهزة</span>
          {templates.map((t) => { const on = tplOn(t); return (
            <button key={t.id} type="button" className={`cx-chip${on ? ' is-on' : ''}`} aria-pressed={on} title={t.items.map((m) => m.name).join(' + ')} onClick={() => applyTpl(t)}>
              {on && <Icon name="check" size={13} />} {t.name} <small className="num">({t.items.length})</small>
            </button>
          ); })}
        </div>
      )}
      <div className="cx-pick">
        <div className="cx-pick__p">
          <div className="cx-pick__h"><span className="cx-pick__n">1</span> اختار الدواء</div>
          <input className="input cx-medq" dir="auto" placeholder="ابحث بالاسم التجاري أو المادة الفعالة…" value={medQ} onChange={(e) => setMedQ(e.target.value)} />
          <div className="cx-pick__list">
            {/* ١٢/١١: كل مجموعة مقفولة — بتفتحها وتقفلها بضغطة على اسمها، والبحث بيفتح النتايج على طول */}
            {sortGroups([...medGroups], groupOrder).map(([g, meds]) => { const open = !!medQ.trim() || openGroups.includes(g); const n = meds.filter((p) => hasMed(p.name)).length; return (
              <div key={g} className={`cx-pick__grp${open ? ' is-open' : ''}`} style={{ ['--gc' as string]: `hsl(${[...g].reduce((h, ch) => (h * 31 + ch.charCodeAt(0)) % 360, 7)} 62% 45%)` }}>
                <button type="button" className="cx-pick__g" aria-expanded={open} onClick={() => setOpenGroups((x) => (x.includes(g) ? x.filter((y) => y !== g) : [...x, g]))}>
                  <Icon name="chevron" size={13} /><span>{g}</span><small>{meds.length}</small>{n > 0 && <b className="cx-pick__cnt">{n} ✓</b>}
                </button>
                {open && meds.map((p) => { const on = hasMed(p.name); const act = sel?.name === p.name; return (
                  <button key={p.name} type="button" dir="ltr" className={`cx-pick__m${act ? ' is-act' : ''}${on ? ' is-on' : ''}`} onClick={() => choose(p)}>
                    <span>{p.name}</span>{on && <Icon name="check" size={13} />}
                  </button>
                ); })}
              </div>
            ); })}
            {medQ.trim() && !medGroups.size && <p className="cx-empty">مفيش دواء بالاسم ده — اضغط «إضافة دواء» واكتبه.</p>}
          </div>
        </div>
        <div className="cx-pick__p">
          <div className="cx-pick__h"><span className="cx-pick__n">2</span> الجرعة</div>
          {!sel ? <p className="cx-empty">اختار دواء من المربع الأول — جرعاته هتظهر هنا.</p> : (
            <div className="cx-pick__dose">
              <div className="cx-pick__sel" dir="ltr">{sel.name}</div>
              {([['الجرعة', 'dose', MED_DOSES], ['عدد المرات', 'frequency', MED_FREQS], ['المدة', 'duration', MED_DURATIONS], ['ملاحظة', 'notes', MED_NOTES]] as const).map(([label, k, opts]) => {
                const v = draft[k] ?? '';
                const mine = customOpts[k] ?? [];
                const base = [...opts, ...mine.filter((o) => !(opts as readonly string[]).includes(o))];
                const list = v && !base.includes(v) ? [v, ...base] : base;
                return (
                  <div key={k} className="cx-pick__row">
                    <b>{label}</b>
                    <div className="cx-pick__chips">
                      {list.map((o) => (
                        <span key={o} className="cx-chip-wrap">
                          <button type="button" className={`cx-chip cx-chip--sm${v === o ? ' is-on' : ''}`} onClick={() => setDraft((d) => ({ ...d, [k]: d[k] === o ? '' : o }))}>{o}</button>
                          {mine.includes(o) && <button type="button" className="cx-chip-x" aria-label={`حذف ${o}`} title="حذف من الاختيارات" onClick={() => saveCustom(k, mine.filter((x) => x !== o))}>×</button>}
                        </span>
                      ))}
                      {/* ١٢/١١: «+» تضيف اختيار جديد للصف ده — بيتحفظ ويفضل ظاهر بعد كده */}
                      {adding === k
                        ? <input className="input cx-chip-add" autoFocus placeholder={`${label} جديد…`} value={newOpt} onChange={(e) => setNewOpt(e.target.value)}
                            onBlur={() => { setAdding(null); setNewOpt(''); }}
                            onKeyDown={(e) => { if (e.key === 'Escape') { setAdding(null); setNewOpt(''); } if (e.key === 'Enter') { e.preventDefault(); const t = newOpt.trim(); if (t) { if (!base.includes(t)) saveCustom(k, [...mine, t]); setDraft((d) => ({ ...d, [k]: t })); } setAdding(null); setNewOpt(''); } }} />
                        : <button type="button" className="cx-chip cx-chip--sm cx-chip--plus" title={`إضافة ${label} جديد`} onClick={() => { setAdding(k); setNewOpt(''); }}>+ إضافة</button>}
                    </div>
                  </div>
                );
              })}
              {/* ١٢/١١: ملاحظة الدواء كتابة حرة (أو من الاختيارات اللي فوق) */}
              <div className="cx-pick__row">
                <b>اكتب ملاحظة</b>
                <input className="input cx-pick__note" dir="auto" placeholder="ملاحظة للدواء ده — مثلًا: بعد الفطار مع كوب مية" value={draft.notes ?? ''} onChange={(e) => setDraft((d) => ({ ...d, notes: e.target.value }))} onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); addSel(); } }} />
              </div>
              <div className="cx-pick__go">
                <Button icon={hasMed(sel.name) ? 'check' : 'plus'} onClick={addSel}>{hasMed(sel.name) ? 'تحديث الجرعة' : 'إضافة للروشتة'}</Button>
                {hasMed(sel.name) && <Button variant="outline" icon="trash" onClick={() => { toggleMed(sel); setSel(null); }}>شيله من الروشتة</Button>}
                <Button variant="ghost" onClick={() => setSel(null)}>إلغاء</Button>
              </div>
            </div>
          )}
        </div>
      </div>
      {c.medications.length === 0
        ? <p className="cx-empty">الأدوية اللي بتضيفها بتنزل هنا — أو اضغط «إضافة دواء» واكتب اسم دواء تاني.</p>
        : (
          <div className="cx-rows">
            {interactions.map((x, k) => (
              <div key={`ix${k}`} className="cx-dup" role="alert" style={x.level === 'warn' ? { background: 'hsl(40 95% 50% / .12)', borderColor: 'hsl(40 90% 45%)', color: 'hsl(35 80% 28%)' } : undefined}>
                <Icon name="alert" size={16} /> <span>{x.level === 'danger' ? 'تداخل خطير' : 'تنبيه'}: <b dir="ltr">{x.a}</b> + <b dir="ltr">{x.b}</b> — {x.msg}</span>
              </div>
            ))}
            {dupNames.size > 0 && <div className="cx-dup" role="alert"><Icon name="alert" size={16} /> فيه دواء متكتب مرتين: <b dir="ltr">{[...dupNames].join('، ')}</b> — امسح التكرار.</div>}
            {c.medications.map((m, i) => (
              <div className="cx-med" key={i}>
              <div className={`cx-row cx-row--med${dupNames.has(norm(m.name)) ? ' is-dup' : ''}`}>
                <span className="cx-row__n">{i + 1}</span>
                <input className="input" dir="ltr" aria-label="اسم الدواء" placeholder="اسم الدواء" list="cx-meds" value={m.name} onChange={(e) => pickMedName(i, e.target.value)} />
                <MedChoice label="الجرعة" value={m.dose} options={MED_DOSES} onChange={(v) => setMed(i, { dose: v })} />
                <MedChoice label="عدد المرات" value={m.frequency} options={MED_FREQS} onChange={(v) => setMed(i, { frequency: v })} />
                <MedChoice label="المدة" value={m.duration} options={MED_DURATIONS} onChange={(v) => setMed(i, { duration: v })} />
                {/* ملاحظة الدواء ده بس (بعد الأكل، قبل النوم…) — كتابة حرة مع اقتراحات، منفصلة عن ملاحظات الروشتة العامة تحت */}
                <input className="input cx-row__note" dir="auto" aria-label={`ملاحظة الدواء ${i + 1}`} placeholder="ملاحظة الدواء (بعد الأكل…)" list="cx-med-notes" value={m.notes ?? ''} onChange={(e) => setMed(i, { notes: e.target.value })} />
                <IconBtn icon="trash" label="حذف الدواء" danger onClick={() => set('medications', c.medications.filter((_, j) => j !== i))} />
              </div>
              {canSeeMedInfo && <MedDoctorInfo name={m.name} interactions={interactions} onPickAlt={(alt) => pickMedName(i, alt)} />}
              </div>
            ))}
          </div>
        )}
      <datalist id="cx-med-notes">{MED_NOTES.map((n) => <option key={n} value={n} />)}</datalist>
      <datalist id="cx-meds">{medCatalog().map((p) => <option key={p.name} value={p.name}>{p.group}</option>)}</datalist>
    </Section>
  );
  const labsSec = (
    <Section key="labs" icon="list" title={`${rxOnly ? 'تحاليل مطلوبة' : 'التحاليل'}${c.labs.length ? ` (${c.labs.length})` : ''}`} aside={rxOnly ? undefined : <>
      <Button size="sm" variant="outline" icon="upload" loading={uploading} disabled={!patientId} onClick={() => labFileRef.current?.click()}>رفع تحاليل</Button>
      <input ref={labFileRef} type="file" hidden multiple accept="image/png,image/jpeg,image/webp,application/pdf" onChange={(e) => void upload(e.target.files)} />
    </>}>
      {outstandingLabs.length > 0 && (
        <div className="cx-labgrp">
          <span className="cx-labgrp__t">تحاليل مطلوبة سابقًا لسه مستنية نتيجة</span>
          <div className="cx-chips">{outstandingLabs.map((m) => <span key={m.id} className="cx-chip" dir="ltr">{m.region} <Tone s={IMAGING_STATUS[m.status]} /></span>)}</div>
        </div>
      )}
      {LAB_GROUPS.map((g) => (
        <div className="cx-labgrp" key={g.group}>
          <span className="cx-labgrp__t">{g.group}</span>
          <div className="cx-chips">{g.items.map((l) => <button key={l} type="button" dir="ltr" aria-pressed={c.labs.includes(l)} className={`cx-chip ${c.labs.includes(l) ? 'is-on' : ''}`} onClick={() => toggleLab(l)}>{l}</button>)}</div>
        </div>
      ))}
      <div className="cx-labadd">
        <input className="input" dir="auto" placeholder="تحليل تاني…" value={labQ} onChange={(e) => setLabQ(e.target.value)} onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); addCustomLab(); } }} />
        <Button size="sm" variant="outline" icon="plus" disabled={!labQ.trim()} onClick={addCustomLab}>إضافة</Button>
      </div>
      {customLabs.length > 0 && <div className="cx-chips">{customLabs.map((l) => <button key={l} type="button" className="cx-chip is-on" onClick={() => toggleLab(l)}>{l} ✕</button>)}</div>}
    </Section>
  );
  const notesSec = (
    <Section key="notes" icon="doc" title="ملاحظات الروشتة العامة والتعليمات">
      <textarea className="input cx-rxnotes" rows={2} placeholder="مثال: راحة وتجنب طلوع السلم، كمادات تلج 15 دقيقة 3 مرات يوميًا، زيارات علاج طبيعي، رباط ضاغط…" value={c.plan} onChange={(e) => set('plan', e.target.value)} />
    </Section>
  );
  // الروشتة في الكشف: الأدوية الأول، وبعدها المطلوب من أشعة/سونار وتحاليل
  if (requestsOnly) return <div className="cx">{[imagingSec, labsSec]}</div>;
  return <div className="cx">{/* الأشعة والتحاليل بتتطلب من تاب «الأشعة والتحاليل» (٩/١١) */}{rxOnly ? [medsSec, notesSec] :[imagingSec, medsSec, labsSec, notesSec]}</div>;
}
