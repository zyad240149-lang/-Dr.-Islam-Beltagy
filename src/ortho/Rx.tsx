// الروشتة والأشعة والتحاليل والتعليمات — بتتملى في شيت المتابعة (Nursing.tsx). الكشوفات القديمة لسه شايلة الروشتة بتاعتها في حقولها.
import { useRef, useState, type ReactNode } from 'react';
import { Button } from '../components/ui';
import { Icon } from '../utils/icons';
import { useToast } from '../hooks/useToast';
import { IMAGING_KIND, IMAGING_STATUS, ortho, type Attachment, type ImagingKind, type ImagingRequest, type Medication, type RxData } from './data';
import { LAB_GROUPS, MED_PRESETS, XRAY_VIEWS } from './clinicalLists';
import { AttachmentThumbs } from './Consultations';
import { IconBtn, Tone } from './kit';

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

export function RxEditor({ value: c, onChange, patientId, region = '', onUploading }: { value: RxData; onChange: (f: (r: RxData) => RxData) => void; patientId: string; region?: string; onUploading?: (v: boolean) => void }) {
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
    const p = MED_PRESETS.find((x) => x.name === name);
    const cur = c.medications[i];
    setMed(i, p ? { name, dose: cur.dose || p.dose, frequency: cur.frequency || p.frequency, duration: cur.duration || p.duration } : { name });
  };
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
  return <div className="cx">
    <Section icon="scan" title="الأشعة" aside={<>
      <Button size="sm" variant="outline" icon="plus" onClick={() => set('imagingRequests', [...c.imagingRequests, { kind: 'xray', region, view: 'AP & Lateral' }])}>طلب أشعة</Button>
      <Button size="sm" variant="outline" icon="camera" loading={uploading} disabled={!patientId} onClick={() => fileRef.current?.click()}>رفع صورة أشعة</Button>
      <input ref={fileRef} type="file" hidden multiple accept="image/png,image/jpeg,image/webp,application/pdf" onChange={(e) => void upload(e.target.files)} />
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
      {c.attachments.length > 0
        ? <AttachmentThumbs items={c.attachments} onRemove={(path) => set('attachments', c.attachments.filter((a) => a.path !== path))} />
        : c.imagingRequests.length === 0 && <p className="cx-empty">اطلب أشعة للمريض أو ارفع صورة الأشعة اللي معاه (صورة أو PDF، لحد 10 ميجا).</p>}
    </Section>

    <Section icon="receipt" title="العلاج — الروشتة" aside={<Button size="sm" variant="outline" icon="plus" onClick={() => set('medications', [...c.medications, emptyMed()])}>إضافة دواء</Button>}>
      {c.medications.length === 0
        ? <p className="cx-empty">مفيش أدوية لسه — اضغط «إضافة دواء» واكتب اسم الدواء (فيه اقتراحات بالجرعات المعتادة).</p>
        : (
          <div className="cx-rows">
            {c.medications.map((m, i) => (
              <div className="cx-row cx-row--med" key={i}>
                <span className="cx-row__n">{i + 1}</span>
                <input className="input" dir="ltr" aria-label="اسم الدواء" placeholder="اسم الدواء" list="cx-meds" value={m.name} onChange={(e) => pickMedName(i, e.target.value)} />
                <input className="input" aria-label="الجرعة" placeholder="الجرعة" value={m.dose} onChange={(e) => setMed(i, { dose: e.target.value })} />
                <input className="input" aria-label="عدد المرات" placeholder="عدد المرات" value={m.frequency} onChange={(e) => setMed(i, { frequency: e.target.value })} />
                <input className="input" aria-label="المدة" placeholder="المدة" value={m.duration} onChange={(e) => setMed(i, { duration: e.target.value })} />
                <input className="input" aria-label="ملاحظة" placeholder="ملاحظة" value={m.notes} onChange={(e) => setMed(i, { notes: e.target.value })} />
                <IconBtn icon="trash" label="حذف الدواء" danger onClick={() => set('medications', c.medications.filter((_, j) => j !== i))} />
              </div>
            ))}
          </div>
        )}
      <datalist id="cx-meds">{MED_PRESETS.map((p) => <option key={p.name} value={p.name}>{p.group}</option>)}</datalist>
    </Section>

    <Section icon="list" title={`التحاليل${c.labs.length ? ` (${c.labs.length})` : ''}`} aside={<>
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

    <Section icon="doc" title="التعليمات وملاحظات الطبيب">
      <textarea className="input" rows={3} placeholder="مثال: راحة وتجنب طلوع السلم، كمادات تلج 15 دقيقة 3 مرات يوميًا، جلسات علاج طبيعي، رباط ضاغط…" value={c.plan} onChange={(e) => set('plan', e.target.value)} />
    </Section>
  </div>;
}
