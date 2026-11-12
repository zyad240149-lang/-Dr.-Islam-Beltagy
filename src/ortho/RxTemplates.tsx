// «روشتات جاهزة» (تبويب في قسم الأدوية): الطبيب بيسمّي روشتة (مثال: خشونة) ويختار أدويتها بجرعاتها —
// وفي التشخيص (روشتة الكشف) بتظهر كزراير: ضغطة واحدة بتنزّل كل أدويتها في الروشتة.
import { useState } from 'react';
import { Button, EmptyState, Modal } from '../components/ui';
import { MED_DOSES, MED_DURATIONS, MED_FREQS, MED_NOTES, medCatalog, type MedPreset } from './clinicalLists';
import { ortho, type Medication, type RxTemplate } from './data';
import { Field, IconBtn, LoadState, SearchBox, confirmDelete, useClinicalCan, useRun } from './kit';
import { useMedBank } from './medBank';

type Draft = Omit<RxTemplate, 'id'> & { id?: string };
const norm = (s: string) => s.trim().toLowerCase();
export const emptyTemplate = (): Draft => ({ name: '', items: [], notes: '' });

function TemplateModal({ initial, onClose }: { initial: Draft; onClose: () => void }) {
  const { run, busy } = useRun();
  const [t, setT] = useState<Draft>(initial);
  const [q, setQ] = useState('');
  const bank = useMedBank(q, q.trim().length >= 2, 20);
  const term = norm(q);
  const local = medCatalog().filter((m) => (term ? norm(m.name).includes(term) || norm(m.group).includes(term) : m.shown !== false));
  const localKeys = new Set(local.map((m) => norm(m.name)));
  const hits = [...local, ...bank.rows.filter((m) => !localKeys.has(norm(m.name)))].slice(0, term ? 60 : 200);
  const has = (name: string) => t.items.some((x) => norm(x.name) === norm(name));
  const add = (p: MedPreset) => setT((x) => (has(p.name) ? { ...x, items: x.items.filter((i) => norm(i.name) !== norm(p.name)) } : { ...x, items: [...x.items, { name: p.name, dose: p.dose, frequency: p.frequency, duration: p.duration, notes: p.notes ?? '' }] }));
  const setItem = (i: number, patch: Partial<Medication>) => setT((x) => ({ ...x, items: x.items.map((m, j) => (j === i ? { ...m, ...patch } : m)) }));
  const name = t.name.trim();
  const dup = ortho.list('rx_templates').some((x) => x.id !== t.id && norm(x.name) === norm(name));
  return (
    <Modal wide title={initial.id ? 'تعديل الروشتة الجاهزة' : 'روشتة جاهزة جديدة'} onClose={onClose} footer={<>
      {dup && <span className="sh-need">فيه روشتة بنفس الاسم</span>}
      <span className="muted">أدوية <span className="num">{t.items.length}</span></span>
      <Button variant="outline" onClick={onClose}>إلغاء</Button>
      <Button icon="check" loading={busy} disabled={!name || !t.items.length || dup} onClick={() => run(() => ortho.save('rx_templates', { ...t, name, items: t.items.filter((m) => m.name.trim()) }), 'تم حفظ الروشتة', onClose)}>حفظ</Button>
    </>}>
      <Field label="اسم الروشتة"><input className="input" value={t.name} onChange={(e) => setT((x) => ({ ...x, name: e.target.value }))} placeholder="مثال: خشونة الركبة" autoFocus /></Field>
      <div className="rxt-grid">
        <div>
          <b className="rxt-h">اختار الأدوية</b>
          <SearchBox value={q} onChange={setQ} placeholder="ابحث بالاسم التجاري أو المادة الفعالة" />
          <div className="rxt-list">
            {hits.map((m) => (
              <label key={norm(m.name)} className="rxt-pick">
                <input type="checkbox" checked={has(m.name)} onChange={() => add(m)} />
                <b dir="ltr">{m.name}</b>{m.group && <small className="muted">{m.group}</small>}
              </label>
            ))}
            {!hits.length && <p className="muted">{bank.loading ? 'بيدور في البنك…' : 'مفيش دواء بالاسم ده.'}</p>}
          </div>
        </div>
        <div>
          <b className="rxt-h">أدوية الروشتة وجرعاتها</b>
          {!t.items.length && <p className="muted">علّم على الأدوية من القايمة — هتنزل هنا وتقدر تكتب جرعة كل دواء.</p>}
          {t.items.map((m, i) => (
            <div key={i} className="rxt-item">
              <div className="rxt-item__top"><span className="num">{i + 1}.</span> <b dir="ltr">{m.name}</b>
                <IconBtn icon="trash" label="شيل الدواء" danger onClick={() => setT((x) => ({ ...x, items: x.items.filter((_, j) => j !== i) }))} />
              </div>
              <div className="rxt-item__f">
                <input className="input" list="rxt-doses" placeholder="الجرعة" value={m.dose} onChange={(e) => setItem(i, { dose: e.target.value })} />
                <input className="input" list="rxt-freqs" placeholder="عدد المرات" value={m.frequency} onChange={(e) => setItem(i, { frequency: e.target.value })} />
                <input className="input" list="rxt-durs" placeholder="المدة" value={m.duration} onChange={(e) => setItem(i, { duration: e.target.value })} />
                <input className="input" list="rxt-notes" placeholder="ملاحظة (بعد الأكل…)" value={m.notes ?? ''} onChange={(e) => setItem(i, { notes: e.target.value })} />
              </div>
            </div>
          ))}
        </div>
      </div>
      <datalist id="rxt-doses">{MED_DOSES.map((o) => <option key={o} value={o} />)}</datalist>
      <datalist id="rxt-freqs">{MED_FREQS.map((o) => <option key={o} value={o} />)}</datalist>
      <datalist id="rxt-durs">{MED_DURATIONS.map((o) => <option key={o} value={o} />)}</datalist>
      <datalist id="rxt-notes">{MED_NOTES.map((o) => <option key={o} value={o} />)}</datalist>
    </Modal>
  );
}

export function RxTemplatesView({ q, editing, setEditing }: { q: string; editing: Draft | null; setEditing: (d: Draft | null) => void }) {
  const perm = useClinicalCan('medications');
  const { run } = useRun();
  const term = norm(q);
  const list = ortho.list('rx_templates')
    .filter((t) => !term || norm(t.name).includes(term) || t.items.some((m) => norm(m.name).includes(term)))
    .sort((a, b) => a.name.localeCompare(b.name, 'ar'));
  return (
    <LoadState kind="rx_templates">
      {!list.length && <EmptyState icon="receipt" title={term ? 'مفيش روشتة بالاسم ده' : 'لسه مفيش روشتات جاهزة'} text={term ? undefined : 'اضغط «روشتة جاهزة جديدة»، سمّيها (مثلًا: خشونة) واختار أدويتها — هتظهر في التشخيص تنزّلها بضغطة.'} />}
      {list.map((t) => (
        <div className="item-card ortho-row" key={t.id}>
          <div>
            <b>{t.name}</b> <span className="badge badge--brand num">{t.items.length}</span>
            {t.items.map((m, i) => <div key={i} className="ortho-sub"><span dir="ltr">{m.name}</span>{[m.dose, m.frequency, m.duration, m.notes].some(Boolean) ? ` — ${[m.dose, m.frequency, m.duration, m.notes].filter(Boolean).join(' · ')}` : ''}</div>)}
          </div>
          <div style={{ display: 'flex', gap: 10, alignItems: 'center' }}>
            {perm.edit && <IconBtn icon="edit" label="تعديل" onClick={() => setEditing({ ...t })} />}
            {perm.del && <IconBtn icon="trash" label="حذف" danger onClick={() => confirmDelete(`روشتة «${t.name}»`) && run(() => ortho.remove('rx_templates', t.id), 'تم حذف الروشتة')} />}
          </div>
        </div>
      ))}
      {editing && <TemplateModal initial={editing} onClose={() => setEditing(null)} />}
    </LoadState>
  );
}

/** زرار «روشتات جاهزة» جنب «فتح الروشتة»: قايمة بالروشتات — اختيار واحدة بينزّل أدويتها (onPick) */
export function RxTemplatePicker({ onPick }: { onPick: (t: RxTemplate) => void }) {
  const [open, setOpen] = useState(false);
  const list = ortho.list('rx_templates').filter((t) => t.items.length).sort((a, b) => a.name.localeCompare(b.name, 'ar'));
  return (
    <div className="rxt-menu">
      <Button variant="outline" icon="list" aria-expanded={open} onClick={() => setOpen((x) => !x)}>روشتات جاهزة{list.length ? ` (${list.length})` : ''}</Button>
      {open && <>
        <div className="rxt-menu__bg" onClick={() => setOpen(false)} />
        <div className="rxt-menu__pop" role="menu">
          {list.map((t) => (
            <button key={t.id} type="button" role="menuitem" className="rxt-menu__it" onClick={() => { setOpen(false); onPick(t); }}>
              <b>{t.name}</b> <small className="num">({t.items.length} دواء)</small>
              <span dir="ltr">{t.items.map((m) => m.name).join(' • ')}</span>
            </button>
          ))}
          {!list.length && <p className="muted" style={{ padding: 10, margin: 0 }}>لسه مفيش روشتات جاهزة — اعملها من «الأدوية» ← «روشتات جاهزة».</p>}
        </div>
      </>}
    </div>
  );
}
