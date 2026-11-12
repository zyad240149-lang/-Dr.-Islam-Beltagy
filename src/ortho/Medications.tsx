// «الأدوية»: قايمة أسامي الأدوية اللي الطبيب بيكتبها للمرضى (مش مخزون).
// تبويبين: «قدامي» (الأدوية اللي بتظهر في الروشتة، متقسمة مجموعات) و«بنك الأدوية» (كل الأدوية — تضيف فيه وتختار اللي يظهر).
// الدواء الأساسي اللي يتعدّل أو يتشال من قدام الطبيب بيتحفظ كسجل في ortho_medications (نفس الاسم: المحفوظ يكسب).
import { useState } from 'react';
import { Button, EmptyState, Modal } from '../components/ui';
import { MED_PRESETS, medCatalog, type MedPreset } from './clinicalLists';
import { ortho, useOrthoVersion, type MedItem } from './data';
import { Field, IconBtn, LoadState, PageHead, SearchBox, confirmDelete, useClinicalCan, useRun } from './kit';
import { useMedBank } from './medBank';
import { RxTemplatesView, emptyTemplate } from './RxTemplates';

type Draft = MedPreset & { id?: string };
type Row = Omit<MedItem, 'id'> & { id?: string };
const emptyMed = (): Draft => ({ name: '', group: '', dose: '', frequency: '', duration: '', notes: '', shown: true });
const keyOf = (name: string) => name.trim().toLowerCase();
const isShown = (m: MedPreset) => m.shown !== false;
const NEW_GROUP = '__new_group__';

function MedModal({ initial, groups, onClose }: { initial: Draft; groups: string[]; onClose: () => void }) {
  const { run, busy } = useRun();
  const [m, setM] = useState<Draft>(initial);
  const [newGroup, setNewGroup] = useState(false);
  const set = (k: 'name' | 'group' | 'dose' | 'frequency' | 'duration' | 'notes', v: string) => setM((x) => ({ ...x, [k]: v }));
  const dup = !m.id && ortho.list('medications').some((x) => keyOf(x.name) === keyOf(m.name));
  return (
    <Modal title={initial.id ? 'تعديل الدواء' : 'إضافة دواء للبنك'} onClose={onClose} footer={<>
      {dup && <span className="sh-need">الدواء ده موجود في البنك</span>}
      <Button variant="outline" onClick={onClose}>إلغاء</Button>
      <Button icon="check" loading={busy} disabled={!m.name.trim() || dup} onClick={() => run(() => ortho.save('medications', { ...m, name: m.name.trim(), shown: isShown(m) }), 'تم حفظ الدواء', onClose)}>حفظ</Button>
    </>}>
      <div className="grid-form grid-form--2">
        <Field label="اسم الدواء" className="span-2"><input className="input" dir="ltr" value={m.name} onChange={(e) => set('name', e.target.value)} placeholder="مثال: Diclofenac sodium 50mg" autoFocus /></Field>
        <Field label="المجموعة (اختياري)" className="span-2">
          <select className="input" value={newGroup ? NEW_GROUP : m.group} onChange={(e) => {
            const isNew = e.target.value === NEW_GROUP;
            setNewGroup(isNew); set('group', isNew ? '' : e.target.value);
          }}>
            <option value="">بدون مجموعة</option>
            {groups.map((g) => <option key={g} value={g}>{g}</option>)}
            <option value={NEW_GROUP}>+ مجموعة جديدة</option>
          </select>
          {newGroup && <input className="input" style={{ marginTop: 8 }} value={m.group} onChange={(e) => set('group', e.target.value)} placeholder="اكتب اسم المجموعة الجديدة" autoFocus />}
        </Field>
        <Field label="الجرعة (اختياري)"><input className="input" value={m.dose} onChange={(e) => set('dose', e.target.value)} placeholder="قرص" /></Field>
        <Field label="التكرار (اختياري)"><input className="input" value={m.frequency} onChange={(e) => set('frequency', e.target.value)} placeholder="مرتين يوميًا بعد الأكل" /></Field>
        <Field label="المدة (اختياري)"><input className="input" value={m.duration} onChange={(e) => set('duration', e.target.value)} placeholder="5 أيام" /></Field>
        <Field label="ملاحظة (اختياري)" className="span-2"><textarea className="input" rows={2} value={m.notes ?? ''} onChange={(e) => set('notes', e.target.value)} placeholder="مثال: ممنوع النوم بعدها نص ساعة — بتظهر في خانة الملاحظات في الروشتة" /></Field>
        <label className="span-2" style={{ display: 'inline-flex', gap: 8, alignItems: 'center', cursor: 'pointer' }}>
          <input type="checkbox" checked={isShown(m)} onChange={(e) => setM((x) => ({ ...x, shown: e.target.checked }))} /> يظهر قدامي في الروشتة
        </label>
      </div>
    </Modal>
  );
}

// مجموعة جديدة أو تعديل مجموعة: الاسم + الأدوية اللي فيها (أي دواء من البنك — اللي يتضاف بيظهر قدام الطبيب)
function GroupModal({ initialName, meds, toRow, onClose }: { initialName: string; meds: MedPreset[]; toRow: (m: MedPreset, patch?: Partial<MedPreset>) => Row; onClose: () => void }) {
  const { run, busy } = useRun();
  const [name, setName] = useState(initialName);
  const [q, setQ] = useState('');
  const bank = useMedBank(q, q.trim().length >= 2, 30);
  const [fromBank, setFromBank] = useState<Map<string, MedPreset>>(() => new Map()); // أدوية اتعلّمت من نتايج البحث في البنك
  const [picked, setPicked] = useState<Set<string>>(() => new Set(initialName ? meds.filter((m) => m.group === initialName).map((m) => keyOf(m.name)) : []));
  const localKeys = new Set(meds.map((m) => keyOf(m.name)));
  const toggle = (m: MedPreset) => {
    const k = keyOf(m.name);
    setPicked((s) => { const n = new Set(s); if (n.has(k)) n.delete(k); else n.add(k); return n; });
    if (!localKeys.has(k)) setFromBank((x) => new Map(x).set(k, m));
  };
  const term = q.trim().toLowerCase();
  const shown = [...meds.filter((m) => !term || m.name.toLowerCase().includes(term) || m.group.toLowerCase().includes(term)), ...bank.rows.filter((m) => !localKeys.has(keyOf(m.name)))];
  const target = name.trim();
  const save = () => run(async () => {
    for (const m of [...meds, ...[...fromBank.values()].filter((x) => picked.has(keyOf(x.name)))]) {
      const inGroup = picked.has(keyOf(m.name));
      if (inGroup && (m.group !== target || !isShown(m))) await ortho.save('medications', toRow(m, { group: target, shown: true }));
      else if (!inGroup && initialName && m.group === initialName) await ortho.save('medications', toRow(m, { group: '' }));
    }
  }, 'تم حفظ المجموعة', onClose);
  return (
    <Modal title={initialName ? 'تعديل المجموعة' : 'مجموعة جديدة'} onClose={onClose} footer={<>
      <span className="muted">مختار <span className="num">{picked.size}</span></span>
      <Button variant="outline" onClick={onClose}>إلغاء</Button>
      <Button icon="check" loading={busy} disabled={!target || !picked.size} onClick={save}>حفظ المجموعة</Button>
    </>}>
      <Field label="اسم المجموعة"><input className="input" value={name} onChange={(e) => setName(e.target.value)} placeholder="مثال: روشتة الخشونة" autoFocus /></Field>
      <div style={{ margin: '12px 0' }}><SearchBox value={q} onChange={setQ} placeholder="ابحث بالاسم التجاري أو المادة الفعالة" /></div>
      <div style={{ maxHeight: 320, overflowY: 'auto' }}>
        {shown.map((m) => {
          const k = keyOf(m.name);
          return (
            <label key={k} style={{ display: 'flex', gap: 8, alignItems: 'center', padding: '6px 2px', cursor: 'pointer' }}>
              <input type="checkbox" checked={picked.has(k)} onChange={() => toggle(m)} />
              <b dir="ltr">{m.name}</b>{m.group && <small className="muted">{m.group}</small>}
            </label>
          );
        })}
        {!shown.length && <p className="muted">{bank.loading ? 'بيدور في البنك…' : 'مفيش دواء بالاسم ده في البنك.'}</p>}
      </div>
    </Modal>
  );
}

export default function Medications() {
  useOrthoVersion();
  const perm = useClinicalCan('medications');
  const { run, busy } = useRun();
  const [view, setView] = useState<'shown' | 'bank' | 'templates'>('shown');
  const [tplEdit, setTplEdit] = useState<ReturnType<typeof emptyTemplate> | null>(null);
  const [q, setQ] = useState('');
  const [edit, setEdit] = useState<Draft | null>(null);
  const [groupEdit, setGroupEdit] = useState<string | null>(null); // '' = مجموعة جديدة
  const saved = ortho.list('medications');
  const savedBy = new Map(saved.map((m) => [keyOf(m.name), m] as const));
  const all = medCatalog();
  const groups = [...new Set(all.map((m) => m.group).filter(Boolean))];
  const shownCount = all.filter(isShown).length;
  const term = q.trim().toLowerCase();
  const list = all.filter((m) => (view === 'bank' || isShown(m)) && (!term || m.name.toLowerCase().includes(term) || m.group.includes(q.trim())));
  const byGroup = new Map<string, MedPreset[]>();
  for (const m of list) { const g = m.group || 'أخرى'; byGroup.set(g, [...(byGroup.get(g) ?? []), m]); }
  // أدوية اتكتبت في روشتات المرضى ومش في البنك — بعدد المرات
  const known = new Set(all.map((m) => keyOf(m.name)));
  const used = new Map<string, { m: MedPreset; n: number }>();
  for (const c of ortho.list('consultations')) for (const x of c.medications ?? []) {
    const name = x.name?.trim(); const k = name?.toLowerCase();
    if (!name || known.has(k)) continue;
    const cur = used.get(k);
    used.set(k, { m: cur?.m ?? { name, group: '', dose: x.dose ?? '', frequency: x.frequency ?? '', duration: x.duration ?? '', shown: true }, n: (cur?.n ?? 0) + 1 });
  }
  const extra = view === 'bank' ? [...used.values()].filter(({ m }) => !term || m.name.toLowerCase().includes(term)).sort((a, b) => b.n - a.n) : [];
  const isBase = (name: string) => MED_PRESETS.some((p) => p.name === name);
  const remove = (s: MedItem) => confirmDelete(`«${s.name}»`) && run(() => ortho.remove('medications', s.id), isBase(s.name) ? 'اتشال التعديل — رجع للقايمة الأساسية' : 'تم الحذف');
  const toRow = (m: Draft, patch: Partial<MedPreset> = {}): Row => {
    const id = m.id ?? savedBy.get(keyOf(m.name))?.id;
    return { ...(id ? { id } : {}), name: m.name, group: m.group, dose: m.dose, frequency: m.frequency, duration: m.duration, notes: m.notes ?? '', shown: isShown(m), ...patch } as Row;
  };
  const bank = useMedBank(view === 'bank' ? q : '');
  const bankHits = bank.rows.filter((m) => !known.has(keyOf(m.name)));
  const toggleShown = (m: Draft) => run(() => ortho.save('medications', toRow(m, { shown: !isShown(m) })), isShown(m) ? 'اتشال من قدامك — لسه موجود في البنك' : 'بقى ظاهر قدامك في الروشتة');

  return (
    <div className="page">
      <PageHead title="الأدوية" sub="ضيف أي دواء في البنك، واختار اللي يظهر قدامك في الروشتة، وقسّمهم مجموعات — أو اعمل روشتات جاهزة تنزّلها في التشخيص بضغطة">
        {perm.add && view === 'templates' && <Button icon="plus" onClick={() => setTplEdit(emptyTemplate())}>روشتة جاهزة جديدة</Button>}
        {perm.add && view !== 'templates' && <Button variant="outline" icon="plus" onClick={() => setGroupEdit('')}>مجموعة جديدة</Button>}
        {perm.add && view !== 'templates' && <Button icon="plus" onClick={() => setEdit(emptyMed())}>إضافة دواء للبنك</Button>}
      </PageHead>
      <div className="seg dx-views" role="tablist" aria-label="أقسام الأدوية">
        <button type="button" role="tab" aria-selected={view === 'shown'} className={`seg__btn ${view === 'shown' ? 'active' : ''}`} onClick={() => setView('shown')}>
          اللي بيظهر قدامي <span className="badge badge--brand num">{shownCount}</span>
        </button>
        <button type="button" role="tab" aria-selected={view === 'bank'} className={`seg__btn ${view === 'bank' ? 'active' : ''}`} onClick={() => setView('bank')}>
          بنك الأدوية <span className="badge badge--brand num">{Math.max(all.length, bank.total)}</span>
        </button>
        <button type="button" role="tab" aria-selected={view === 'templates'} className={`seg__btn ${view === 'templates' ? 'active' : ''}`} onClick={() => setView('templates')}>
          روشتات جاهزة <span className="badge badge--brand num">{ortho.list('rx_templates').length}</span>
        </button>
      </div>
      <section className="card">
        <div className="filter-bar"><div className="field"><SearchBox value={q} onChange={setQ} placeholder={view === 'templates' ? 'ابحث باسم الروشتة أو دواء فيها' : view === 'bank' ? 'ابحث بالاسم التجاري أو المادة الفعالة (مثال: diclofenac)' : 'ابحث باسم الدواء أو المجموعة'} /></div></div>
        <div className="card__body">
          {view === 'templates' ? <RxTemplatesView q={q} editing={tplEdit} setEditing={setTplEdit} /> : <LoadState kind="medications">
            {!list.length && !extra.length && !(view === 'bank' && (bankHits.length || bank.loading)) && <EmptyState icon="search" title={term ? 'مفيش أدوية بالاسم ده' : 'مفيش أدوية ظاهرة قدامك'} text={term ? undefined : 'افتح «بنك الأدوية» وعلّم على اللي عايزه يظهر.'} />}
            {[...byGroup].map(([g, meds]) => (
              <div key={g} style={{ marginBottom: 16 }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 8, marginBottom: 6 }}>
                  <h3 className="ortho-sub" style={{ margin: 0, fontWeight: 700 }}>{g} <span className="num">({meds.length})</span></h3>
                  {perm.edit && groups.includes(g) && <Button size="sm" variant="outline" icon="edit" onClick={() => setGroupEdit(g)}>تعديل المجموعة</Button>}
                </div>
                {meds.map((m) => {
                  const s = savedBy.get(keyOf(m.name));
                  return (
                    <div className="item-card ortho-row" key={m.name}>
                      <div>
                        <b dir="ltr">{m.name}</b>{isBase(m.name) && <span className="badge badge--muted" style={{ marginInlineStart: 8 }}>أساسي</span>}
                        <div className="ortho-sub">{[m.dose, m.frequency, m.duration].filter(Boolean).join(' — ') || '—'}</div>
                        {m.notes?.trim() && <div className="ortho-sub">ملاحظة: {m.notes.trim()}</div>}
                      </div>
                      <div style={{ display: 'flex', gap: 10, alignItems: 'center' }}>
                        <label style={{ display: 'inline-flex', gap: 6, alignItems: 'center', cursor: 'pointer', whiteSpace: 'nowrap' }}>
                          <input type="checkbox" checked={isShown(m)} disabled={busy || !(s ? perm.edit : perm.add)} onChange={() => toggleShown(m)} /> يظهر قدامي
                        </label>
                        {perm.edit && <IconBtn icon="edit" label="تعديل" onClick={() => setEdit(s ? { ...m, id: s.id } : { ...m })} />}
                        {perm.del && s && <IconBtn icon="trash" label="حذف" danger onClick={() => remove(s)} />}
                      </div>
                    </div>
                  );
                })}
              </div>
            ))}
            {view === 'bank' && (bankHits.length > 0 || bank.failed) && (
              <div style={{ marginTop: 20 }}>
                <h3 className="ortho-sub" style={{ margin: '0 0 6px', fontWeight: 700 }}>باقي البنك — ابحث بالاسم التجاري أو المادة الفعالة <span className="num">({bank.total})</span></h3>
                {bank.failed && <p className="muted">البحث في البنك محتاج اتصال بالإنترنت.</p>}
                {bankHits.map((m) => (
                  <div className="item-card ortho-row" key={m.id}>
                    <div><b dir="ltr">{m.name}</b><div className="ortho-sub" dir="ltr" style={{ textAlign: 'start' }}>{[m.scientificName, m.group].filter(Boolean).join(' · ') || '—'}</div></div>
                    <div style={{ display: 'flex', gap: 10, alignItems: 'center' }}>
                      <label style={{ display: 'inline-flex', gap: 6, alignItems: 'center', cursor: 'pointer', whiteSpace: 'nowrap' }}>
                        <input type="checkbox" checked={isShown(m)} disabled={busy || !perm.edit} onChange={() => toggleShown(m)} /> يظهر قدامي
                      </label>
                      {perm.edit && <IconBtn icon="edit" label="تعديل" onClick={() => setEdit({ ...m })} />}
                    </div>
                  </div>
                ))}
                {bank.hasMore && !bank.failed && <div style={{ textAlign: 'center', marginTop: 10 }}><Button variant="outline" loading={bank.loading} onClick={bank.more}>عرض المزيد</Button></div>}
              </div>
            )}
            {extra.length > 0 && (
              <div style={{ marginTop: 20 }}>
                <h3 className="ortho-sub" style={{ margin: '0 0 6px', fontWeight: 700 }}>اتكتبت للمرضى ومش في البنك <span className="num">({extra.length})</span></h3>
                {extra.map(({ m, n }) => (
                  <div className="item-card ortho-row" key={m.name}>
                    <div><b dir="ltr">{m.name}</b><div className="ortho-sub">اتكتب <span className="num">{n}</span> مرة{[m.dose, m.frequency, m.duration].some(Boolean) ? ` · ${[m.dose, m.frequency, m.duration].filter(Boolean).join(' — ')}` : ''}</div></div>
                    {perm.add && <Button size="sm" variant="outline" icon="plus" onClick={() => setEdit({ ...m })}>إضافة للبنك</Button>}
                  </div>
                ))}
              </div>
            )}
          </LoadState>}
        </div>
      </section>
      {edit && <MedModal initial={edit} groups={groups} onClose={() => setEdit(null)} />}
      {groupEdit !== null && <GroupModal initialName={groupEdit} meds={all} toRow={toRow} onClose={() => setGroupEdit(null)} />}
    </div>
  );
}
