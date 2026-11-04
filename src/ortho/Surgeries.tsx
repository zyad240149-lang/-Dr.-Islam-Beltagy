import { useState } from 'react';
import { Link } from 'react-router-dom';
import { Button, EmptyState, Modal } from '../components/ui';
import { db } from '../data/db';
import { supabase } from '../lib/supabase';
import { PAYMENT_METHOD_OPTIONS, fmtDate, money, todayYmd } from '../utils/format';
import { ORTHO_PROCEDURES, REGIONS, SIDE, STAGE_STATUS, SURGERY_STATUS, addDays, daysBetween, ortho, useOrthoVersion, type Side, type StageStatus, type Surgery, type SurgeryStage, type SurgeryStatus } from './data';
import { Field, IconBtn, LoadState, PageHead, PatientSelect, PillTabs, Tone, confirmDelete, patientFile, patientName, useClinicalCan, useRun } from './kit';

const EDITABLE_STATUS = (Object.keys(SURGERY_STATUS) as SurgeryStatus[]).filter((k) => k !== 'done');
const stagesOf = (surgeryId: string) => ortho.list('surgery_stages').filter((x) => x.surgeryId === surgeryId).sort((a, b) => Number(a.position) - Number(b.position));
const paymentsOf = (surgeryId: string) => ortho.list('surgery_payment_stages').filter((x) => x.surgeryId === surgeryId).sort((a, b) => Number(a.position) - Number(b.position));
const amount = (v: string) => Number(v.replace(/[^\d.]/g, '')) || 0;

type StageDraft = { key: string; id?: string; name: string; details: string; status: StageStatus };
type PayDraft = { key: string; id?: string; name: string; amount: string; dueDate: string };
type DraftKind = 'surgery_stages' | 'surgery_payment_stages';

export function SurgeryModal({ initial, patientId = '', onClose }: { initial?: Surgery; patientId?: string; onClose: () => void }) {
  const { run, busy } = useRun();
  const [s, setS] = useState<Omit<Surgery, 'id'> & { id?: string }>(initial ?? { patientId, procedure: '', region: REGIONS[0], side: 'right', hospital: '', date: addDays(todayYmd(), 7), implant: '', status: 'planned', notes: '' });
  const set = <K extends keyof Surgery>(k: K, v: Surgery[K]) => setS((x) => ({ ...x, [k]: v }));
  const locked = s.status === 'done';
  const perm = useClinicalCan();
  const [totalPrice, setTotalPrice] = useState(String(initial?.totalPrice || initial?.price || ''));
  const [discount, setDiscount] = useState(String(initial?.discount || ''));
  const nTotal = amount(totalPrice), nDiscount = amount(discount), net = Math.max(nTotal - nDiscount, 0);
  const discountInvalid = nDiscount > nTotal;
  // المسودات بتحتفظ بالمعرّف بعد الحفظ، فإعادة المحاولة بعد خطأ مابتكررش صفوف
  const [stages, setStages] = useState<StageDraft[]>(() => (initial ? stagesOf(initial.id) : []).map((x) => ({ key: x.id, id: x.id, name: x.name, details: x.details, status: x.status })));
  const [pays, setPays] = useState<PayDraft[]>(() => (initial ? paymentsOf(initial.id) : []).map((x) => ({ key: x.id, id: x.id, name: x.name, amount: String(x.amount || ''), dueDate: x.dueDate || '' })));
  const [removed, setRemoved] = useState<{ kind: DraftKind; id: string }[]>([]);
  const canRemove = (id?: string) => !id || perm.del;
  const drop = (kind: DraftKind, id?: string) => { if (id) setRemoved((x) => [...x, { kind, id }]); };
  const total = pays.reduce((n, x) => n + amount(x.amount), 0);
  const draftsValid = stages.every((x) => x.name.trim()) && pays.every((x) => x.name.trim());
  const save = () => run(async () => {
    const surgeryId = await ortho.save('surgeries', locked ? s : { ...s, totalPrice: nTotal, discount: nDiscount, price: net });
    setS((x) => ({ ...x, id: surgeryId }));
    for (const r of removed) await ortho.remove(r.kind, r.id);
    setRemoved([]);
    const nextStages = [...stages];
    for (const [i, d] of nextStages.entries()) {
      const id = await ortho.save('surgery_stages', { id: d.id, surgeryId, position: i + 1, name: d.name.trim(), details: d.details.trim(), status: d.status });
      nextStages[i] = { ...d, id };
      setStages([...nextStages]);
    }
    const nextPays = [...pays];
    for (const [i, d] of nextPays.entries()) {
      const id = await ortho.save('surgery_payment_stages', { id: d.id, surgeryId, position: i + 1, name: d.name.trim(), amount: amount(d.amount), dueDate: d.dueDate });
      nextPays[i] = { ...d, id };
      setPays([...nextPays]);
    }
  }, 'تم حفظ العملية', onClose);
  const hospitals = [...new Set(ortho.list('surgeries').map((x) => x.hospital).filter(Boolean))];
  return (
    <Modal wide title={initial ? 'تعديل العملية' : 'عملية جديدة'} onClose={onClose} footer={<>
      <Button variant="outline" onClick={onClose}>إلغاء</Button>
      <Button icon="check" loading={busy} disabled={!s.patientId || !s.procedure.trim() || !s.hospital.trim() || !draftsValid || (!locked && discountInvalid)} onClick={save}>حفظ</Button>
    </>}>
      <div className="grid-form grid-form--3">
        <Field label="المريض" className="span-2"><PatientSelect value={s.patientId} onChange={(v) => set('patientId', v)} /></Field>
        <Field label="اسم العملية" className="span-2">
          <input className="input" list="ortho-procedures" value={s.procedure} onChange={(e) => set('procedure', e.target.value)} placeholder="مثال: تغيير مفصل ركبة كامل" />
          <datalist id="ortho-procedures">{ORTHO_PROCEDURES.map((p) => <option key={p} value={p} />)}</datalist>
        </Field>
        <Field label="مكان العملية (المستشفى)">
          <input className="input" list="ortho-hospitals" value={s.hospital} onChange={(e) => set('hospital', e.target.value)} placeholder="اكتب أو اختار المستشفى" />
          <datalist id="ortho-hospitals">{hospitals.map((h) => <option key={h} value={h} />)}</datalist>
        </Field>
        <Field label="التاريخ"><input type="date" className="input" value={s.date} onChange={(e) => set('date', e.target.value)} /></Field>
        <Field label="المنطقة">
          <select className="input" value={s.region} onChange={(e) => set('region', e.target.value)}>{[...new Set([...REGIONS, s.region])].map((r) => <option key={r}>{r}</option>)}</select>
        </Field>
        <Field label="الجهة">
          <select className="input" value={s.side} onChange={(e) => set('side', e.target.value as Side)}>{Object.entries(SIDE).map(([k, v]) => <option key={k} value={k}>{v}</option>)}</select>
        </Field>
        {!locked && (
          <Field label="الحالة">
            <select className="input" value={s.status} onChange={(e) => set('status', e.target.value as SurgeryStatus)}>{EDITABLE_STATUS.map((k) => <option key={k} value={k}>{SURGERY_STATUS[k].label}</option>)}</select>
          </Field>
        )}
        <Field label="المثبتات / المفصل"><input className="input" value={s.implant} onChange={(e) => set('implant', e.target.value)} placeholder="شرائح، مسامير، مفصل…" /></Field>
        {!locked && <>
          <Field label="إجمالي سعر العملية"><input className="input" inputMode="decimal" value={totalPrice} onChange={(e) => setTotalPrice(e.target.value)} /></Field>
          <Field label="مبلغ الخصم"><input className="input" inputMode="decimal" value={discount} onChange={(e) => setDiscount(e.target.value)} /></Field>
          <Field label="المستحق بعد الخصم"><div className={discountInvalid ? 'alert alert-danger' : 'input'}>{discountInvalid ? 'الخصم أكبر من الإجمالي' : <strong className="num">{money(net)}</strong>}</div></Field>
        </>}
        <Field label="ملاحظات" className="span-2"><textarea className="input" rows={2} value={s.notes} onChange={(e) => set('notes', e.target.value)} /></Field>
      </div>
      {!locked && <>
        <h4 style={{ margin: '16px 0 8px' }}>مراحل العملية</h4>
        {stages.map((d, i) => (
          <div className="ortho-row" key={d.key} style={{ gap: 8, marginBottom: 8, flexWrap: 'wrap' }}>
            <input className="input" style={{ flex: 1, minWidth: 140 }} aria-label="اسم المرحلة" placeholder="اسم المرحلة" value={d.name} onChange={(e) => setStages((l) => l.map((x, j) => (j === i ? { ...x, name: e.target.value } : x)))} />
            <input className="input" style={{ flex: 2, minWidth: 140 }} aria-label="تفاصيل المرحلة" placeholder="التفاصيل" value={d.details} onChange={(e) => setStages((l) => l.map((x, j) => (j === i ? { ...x, details: e.target.value } : x)))} />
            {canRemove(d.id) && <IconBtn icon="trash" label="حذف المرحلة" danger onClick={() => { drop('surgery_stages', d.id); setStages((l) => l.filter((_, j) => j !== i)); }} />}
          </div>
        ))}
        <Button variant="outline" size="sm" icon="plus" onClick={() => setStages((l) => [...l, { key: crypto.randomUUID(), name: '', details: '', status: 'pending' }])}>إضافة مرحلة</Button>

        <h4 style={{ margin: '16px 0 8px' }}>مراحل الدفع</h4>
        {pays.map((d, i) => (
          <div className="ortho-row" key={d.key} style={{ gap: 8, marginBottom: 8, flexWrap: 'wrap' }}>
            <input className="input" style={{ flex: 2, minWidth: 140 }} aria-label="اسم الدفعة" placeholder="مثال: مقدم" value={d.name} onChange={(e) => setPays((l) => l.map((x, j) => (j === i ? { ...x, name: e.target.value } : x)))} />
            <input className="input" style={{ flex: 1, minWidth: 100 }} inputMode="decimal" aria-label="مبلغ الدفعة" placeholder="المبلغ" value={d.amount} onChange={(e) => setPays((l) => l.map((x, j) => (j === i ? { ...x, amount: e.target.value } : x)))} />
            <input className="input" style={{ flex: 1, minWidth: 130 }} type="date" aria-label="تاريخ الدفعة" value={d.dueDate} onChange={(e) => setPays((l) => l.map((x, j) => (j === i ? { ...x, dueDate: e.target.value } : x)))} />
            {canRemove(d.id) && <IconBtn icon="trash" label="حذف الدفعة" danger onClick={() => { drop('surgery_payment_stages', d.id); setPays((l) => l.filter((_, j) => j !== i)); }} />}
          </div>
        ))}
        <div className="ortho-row" style={{ gap: 8, justifyContent: 'space-between' }}>
          <Button variant="outline" size="sm" icon="plus" onClick={() => setPays((l) => [...l, { key: crypto.randomUUID(), name: '', amount: '', dueDate: '' }])}>إضافة دفعة</Button>
          {pays.length > 0 && <span>إجمالي الدفعات: <strong className="num">{money(total)}</strong></span>}
        </div>
        {pays.length > 0 && nTotal > 0 && total !== net && <p className="alert alert-danger">إجمالي الدفعات مش مساوي للمستحق بعد الخصم ({money(net)}).</p>}
        <p className="muted-sm" style={{ marginBottom: 0 }}>دي خطة متوقعة؛ التحصيل بيتسجل في الحسابات عند إنهاء العملية.</p>
      </>}
    </Modal>
  );
}

/** مراحل العملية: الطبيب بيكتبها ويرتبها بنفسه، ومفيش مراحل جاهزة ولا حد لعددها */
function StagesModal({ surgery, onClose }: { surgery: Surgery; onClose: () => void }) {
  useOrthoVersion();
  const { run, busy } = useRun();
  const perm = useClinicalCan();
  const stages = stagesOf(surgery.id);
  const plan = paymentsOf(surgery.id);
  const [name, setName] = useState('');
  const [details, setDetails] = useState('');
  const [payName, setPayName] = useState('');
  const [payAmount, setPayAmount] = useState('');
  const [payDate, setPayDate] = useState('');
  const planTotal = plan.reduce((n, x) => n + (Number(x.amount) || 0), 0);
  const addPayment = () => run(async () => {
    await ortho.save('surgery_payment_stages', { surgeryId: surgery.id, position: (plan[plan.length - 1]?.position ?? 0) + 1, name: payName.trim(), amount: amount(payAmount), dueDate: payDate });
    setPayName(''); setPayAmount(''); setPayDate('');
  }, 'اتضافت الدفعة');
  const [finishing, setFinishing] = useState(false);
  const locked = surgery.status === 'done';
  const done = stages.filter((x) => x.status === 'done').length;
  const skipped = stages.filter((x) => x.status === 'skipped').length;
  const saveStage = (st: SurgeryStage, patch: Partial<SurgeryStage>) => run(() => ortho.save('surgery_stages', { ...st, ...patch }));
  const add = () => run(async () => {
    await ortho.save('surgery_stages', { surgeryId: surgery.id, position: (stages[stages.length - 1]?.position ?? 0) + 1, name: name.trim(), details: details.trim(), status: 'pending' });
    setName(''); setDetails('');
  }, 'اتضافت المرحلة');
  const move = (i: number, dir: -1 | 1) => run(async () => {
    const a = stages[i], b = stages[i + dir];
    await ortho.save('surgery_stages', { ...a, position: b.position });
    await ortho.save('surgery_stages', { ...b, position: a.position });
  });
  return (
    <Modal wide title={`مراحل العملية والدفع — ${surgery.procedure}`} onClose={onClose} footer={<>
      <Button variant="outline" onClick={onClose}>إغلاق</Button>
      {!locked && perm.edit && <Button icon="check" disabled={!stages.length || done + skipped < stages.length} onClick={() => setFinishing(true)}>إنهاء العملية</Button>}
    </>}>
      <p className="muted" style={{ marginTop: 0 }}>{patientName(surgery.patientId)} · {surgery.hospital || '—'} · اتنفذ {done} من {stages.length} مرحلة{skipped > 0 ? ` · اتخطّى ${skipped}` : ''}</p>
      <h4 style={{ margin: '12px 0 8px' }}>مراحل العملية</h4>
      {stages.length === 0 && <EmptyState icon="list" title="لسه مفيش مراحل" text="اكتب أول مرحلة تحت." />}
      {stages.map((st, i) => (
        <div className="card" key={st.id} style={{ padding: 12, marginBottom: 8 }}>
          <div className="ortho-row" style={{ gap: 8, flexWrap: 'wrap' }}>
            <strong style={{ flex: 1, minWidth: 160 }}><span className="num">{i + 1}.</span> {st.name}</strong>
            {locked || !perm.edit ? <Tone s={STAGE_STATUS[st.status]} /> : (
              <select className="input" style={{ width: 'auto' }} aria-label="حالة المرحلة" value={st.status} disabled={busy} onChange={(e) => saveStage(st, { status: e.target.value as StageStatus })}>
                {Object.entries(STAGE_STATUS).map(([k, v]) => <option key={k} value={k}>{v.label}</option>)}
              </select>
            )}
            {!locked && perm.edit && <>
              {st.status !== 'skipped' && st.status !== 'done' && <Button variant="outline" size="sm" disabled={busy} onClick={() => saveStage(st, { status: 'skipped' })}>تخطي</Button>}
              <Button variant="outline" size="sm" aria-label="لفوق" disabled={i === 0 || busy} onClick={() => move(i, -1)}>↑</Button>
              <Button variant="outline" size="sm" aria-label="لتحت" disabled={i === stages.length - 1 || busy} onClick={() => move(i, 1)}>↓</Button>
            </>}
            {!locked && perm.del && <IconBtn icon="trash" label="حذف المرحلة" danger onClick={() => confirmDelete('هذه المرحلة') && run(() => ortho.remove('surgery_stages', st.id), 'تم الحذف')} />}
          </div>
          {st.details && <p className="muted-sm" style={{ margin: '6px 0 0', whiteSpace: 'pre-wrap' }}>{st.details}</p>}
        </div>
      ))}
      {!locked && perm.add && (
        <div className="grid-form" style={{ marginTop: 12 }}>
          <Field label="اسم المرحلة"><input className="input" value={name} onChange={(e) => setName(e.target.value)} placeholder="اكتب اسم المرحلة" /></Field>
          <Field label="التفاصيل"><textarea className="input" rows={2} value={details} onChange={(e) => setDetails(e.target.value)} /></Field>
          <Button variant="outline" icon="plus" loading={busy} disabled={!name.trim()} onClick={add}>إضافة مرحلة</Button>
        </div>
      )}
      <h4 style={{ margin: '16px 0 8px' }}>مراحل الدفع</h4>
      {plan.length === 0 && <p className="muted-sm">لسه مفيش دفعات.</p>}
      {plan.map((p) => (
        <div className="card" key={p.id} style={{ padding: 12, marginBottom: 8 }}>
          <div className="ortho-row" style={{ gap: 8, flexWrap: 'wrap' }}>
            <strong style={{ flex: 1, minWidth: 140 }}>{p.name}</strong>
            <span className="num">{money(Number(p.amount) || 0)}</span>
            {p.dueDate && <span className="muted-sm">{fmtDate(p.dueDate)}</span>}
            {!locked && perm.del && <IconBtn icon="trash" label="حذف الدفعة" danger onClick={() => confirmDelete('هذه الدفعة') && run(() => ortho.remove('surgery_payment_stages', p.id), 'تم الحذف')} />}
          </div>
        </div>
      ))}
      {plan.length > 0 && <p>إجمالي الدفعات: <strong className="num">{money(planTotal)}</strong></p>}
      {!locked && perm.add && (
        <div className="grid-form" style={{ marginTop: 12 }}>
          <Field label="اسم الدفعة"><input className="input" value={payName} onChange={(e) => setPayName(e.target.value)} placeholder="مثال: مقدم" /></Field>
          <Field label="المبلغ"><input className="input" inputMode="decimal" value={payAmount} onChange={(e) => setPayAmount(e.target.value)} /></Field>
          <Field label="التاريخ"><input className="input" type="date" value={payDate} onChange={(e) => setPayDate(e.target.value)} /></Field>
          <Button variant="outline" icon="plus" loading={busy} disabled={!payName.trim()} onClick={addPayment}>إضافة دفعة</Button>
        </div>
      )}
      {locked && (
        <p style={{ marginBottom: 0 }}>المستحق: <strong className="num">{money(Number(surgery.price) || 0)}</strong> · المدفوع عند الإنهاء: <strong className="num">{money(Number(surgery.paidAtFinish) || 0)}</strong> · التكلفة: <strong className="num">{money(Number(surgery.cost) || 0)}</strong></p>
      )}
      {finishing && <FinishModal surgery={surgery} onClose={() => setFinishing(false)} onDone={onClose} />}
    </Modal>
  );
}

/** الإنهاء على الخادم في معاملة واحدة: الفاتورة والدفعة وخصم المستلزمات، والتكرار مابيسجلش إيراد تاني */
function FinishModal({ surgery, onClose, onDone }: { surgery: Surgery; onClose: () => void; onDone: () => void }) {
  const { run, busy } = useRun();
  const items = db.inventory().filter((x) => x.active);
  const [price, setPrice] = useState(String(surgery.price || paymentsOf(surgery.id).reduce((n, x) => n + (Number(x.amount) || 0), 0) || ''));
  const [cost, setCost] = useState(String(surgery.cost || ''));
  const [paid, setPaid] = useState('');
  const [method, setMethod] = useState(PAYMENT_METHOD_OPTIONS[0]?.value ?? 'cash');
  const [supplies, setSupplies] = useState<Record<string, string>>({});
  const nPrice = amount(price), nPaid = amount(paid);
  const invalid = nPaid > nPrice;
  const finish = () => run(async () => {
    const list = Object.entries(supplies).map(([itemId, qty]) => ({ itemId, qty: amount(qty) })).filter((x) => x.qty > 0);
    const { error } = await supabase.rpc('finish_surgery', { p: { id: surgery.id, price: nPrice, cost: amount(cost), paid: nPaid, method, supplies: list } });
    if (error) throw new Error(error.message);
    await ortho.reload('surgeries');
    void db.hydrate();
  }, 'اتسجلت العملية مكتملة واترحّل المبلغ للحسابات', () => { onClose(); onDone(); });
  return (
    <Modal title="إنهاء العملية" onClose={onClose} footer={<>
      <Button variant="outline" onClick={onClose}>رجوع</Button>
      <Button icon="check" loading={busy} disabled={invalid} onClick={finish}>تأكيد الإنهاء</Button>
    </>}>
      <div className="grid-form">
        <Field label="المبلغ المستحق على المريض"><input className="input" inputMode="decimal" value={price} onChange={(e) => setPrice(e.target.value)} /></Field>
        <Field label="المدفوع الآن"><input className="input" inputMode="decimal" value={paid} onChange={(e) => setPaid(e.target.value)} /></Field>
        {nPaid > 0 && <Field label="طريقة الدفع"><select className="input" value={method} onChange={(e) => setMethod(e.target.value)}>{PAYMENT_METHOD_OPTIONS.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}</select></Field>}
        <Field label="تكلفة العملية على العيادة"><input className="input" inputMode="decimal" value={cost} onChange={(e) => setCost(e.target.value)} /></Field>
      </div>
      <p className={invalid ? 'alert alert-danger' : 'muted-sm'}>المتبقي على المريض: <strong className="num">{money(Math.max(nPrice - nPaid, 0))}</strong>{invalid ? ' — المدفوع أكبر من المستحق' : ''}</p>
      {items.length > 0 && (
        <details>
          <summary style={{ cursor: 'pointer', fontWeight: 600 }}>المستلزمات المستخدمة (بتتخصم من المخزون)</summary>
          <div className="grid-form" style={{ marginTop: 8 }}>
            {items.map((it) => <Field key={it.id} label={`${it.name} (المتاح ${it.quantity} ${it.unit})`}><input className="input" inputMode="decimal" value={supplies[it.id] ?? ''} onChange={(e) => setSupplies((x) => ({ ...x, [it.id]: e.target.value }))} /></Field>)}
          </div>
        </details>
      )}
    </Modal>
  );
}

export function SurgeryCards({ items, onEdit }: { items: Surgery[]; onEdit: (s: Surgery) => void }) {
  useOrthoVersion();
  const { run } = useRun();
  const perm = useClinicalCan();
  const [stagesFor, setStagesFor] = useState<string | null>(null);
  const t = todayYmd();
  const open = items.find((x) => x.id === stagesFor);
  if (!items.length) return <EmptyState icon="scalpel" title="لا توجد عمليات" />;
  return (
    <div className="case-grid">
      {items.map((s) => {
        const left = daysBetween(t, s.date);
        const tone = s.status === 'done' ? 'ok' : s.status === 'postponed' ? 'warn' : '';
        const stages = stagesOf(s.id);
        return (
          <div className={`card case-card ${tone ? `case-card--${tone}` : ''}`} key={s.id}>
            <div className="ortho-row" style={{ alignItems: 'flex-start' }}>
              <Link to={`/patients/${s.patientId}`} className="case-card__who"><strong>{patientName(s.patientId)}</strong><span>ملف {patientFile(s.patientId)}</span></Link>
              <Tone s={SURGERY_STATUS[s.status]} />
            </div>
            <h3 style={{ fontSize: 16.5 }}>{s.procedure}</h3>
            <dl className="facts">
              <div><dt>المنطقة</dt><dd>{s.region} — {SIDE[s.side]}</dd></div>
              <div><dt>المستشفى</dt><dd>{s.hospital || '—'}</dd></div>
              <div><dt>التاريخ</dt><dd>{fmtDate(s.date)}</dd></div>
              <div><dt>المراحل</dt><dd className="num">{stages.filter((x) => x.status === 'done' || x.status === 'skipped').length} / {stages.length}</dd></div>
              {Number(s.discount) > 0 && <div><dt>السعر / الخصم</dt><dd className="num">{money(Number(s.totalPrice) || 0)} / {money(Number(s.discount) || 0)}</dd></div>}
              {Number(s.price) > 0 && <div><dt>المستحق</dt><dd className="num">{money(Number(s.price) || 0)}</dd></div>}
            </dl>
            <div className="case-card__foot">
              {s.status === 'scheduled' && left >= 0 && <span className="badge badge--brand">{left === 0 ? 'اليوم' : `بعد ${left} يوم`}</span>}
              {s.status === 'done' && left < 0 && <span className="muted" style={{ fontSize: 14 }}>اليوم {-left} بعد العملية</span>}
              <div style={{ flex: 1 }} />
              <Button variant={s.status === 'done' ? 'outline' : undefined} icon="list" onClick={() => setStagesFor(s.id)}>{s.status === 'done' ? 'التفاصيل' : 'المراحل والإنهاء'}</Button>
              {perm.edit && <IconBtn icon="edit" label="تعديل" onClick={() => onEdit(s)} />}
              {perm.del && <IconBtn icon="trash" label="حذف" danger onClick={() => confirmDelete('هذه العملية') && run(() => ortho.remove('surgeries', s.id), 'تم الحذف')} />}
            </div>
          </div>
        );
      })}
      {open && <StagesModal surgery={open} onClose={() => setStagesFor(null)} />}
    </div>
  );
}

export default function Surgeries() {
  useOrthoVersion();
  const perm = useClinicalCan();
  const [tab, setTab] = useState<SurgeryStatus | 'all'>('all');
  const [edit, setEdit] = useState<Surgery | 'new' | null>(null);
  const all = ortho.list('surgeries').sort((a, b) => a.date.localeCompare(b.date));
  const list = tab === 'all' ? all : all.filter((s) => s.status === tab);
  return (
    <div className="page">
      <PageHead title="العمليات الجراحية" sub="إنشاء العملية ومراحلها ومتابعة تقدمها حتى الإنهاء">
        {perm.add && <Button icon="plus" onClick={() => setEdit('new')}>عملية جديدة</Button>}
      </PageHead>
      <PillTabs value={tab} onChange={setTab} tabs={[{ id: 'all' as const, label: 'الكل', n: all.length }, ...(Object.keys(SURGERY_STATUS) as SurgeryStatus[]).map((x) => ({ id: x, label: SURGERY_STATUS[x].label, n: all.filter((s) => s.status === x).length }))]} />
      <LoadState kind="surgeries"><SurgeryCards items={list} onEdit={setEdit} /></LoadState>
      {edit && <SurgeryModal initial={edit === 'new' ? undefined : edit} onClose={() => setEdit(null)} />}
    </div>
  );
}
