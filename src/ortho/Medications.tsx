// «الأدوية»: قايمة أسامي الأدوية اللي الطبيب بيكتبها للمرضى (مش مخزون) — بتظهر اقتراحات في الروشتة بالجرعة والتكرار والمدة.
// فيها القايمة الأساسية + اللي اتضاف هنا، وتحت: أدوية اتكتبت في روشتات المرضى ولسه مش في القايمة (تتضاف بضغطة).
import { useState } from 'react';
import { Button, EmptyState, Modal } from '../components/ui';
import { MED_PRESETS, medCatalog, type MedPreset } from './clinicalLists';
import { ortho, useOrthoVersion, type MedItem } from './data';
import { Field, IconBtn, LoadState, PageHead, SearchBox, confirmDelete, useClinicalCan, useRun } from './kit';

type Draft = MedPreset & { id?: string };
const emptyMed = (): Draft => ({ name: '', group: '', dose: '', frequency: '', duration: '' });

function MedModal({ initial, groups, onClose }: { initial: Draft; groups: string[]; onClose: () => void }) {
  const { run, busy } = useRun();
  const [m, setM] = useState<Draft>(initial);
  const set = (k: keyof MedPreset, v: string) => setM((x) => ({ ...x, [k]: v }));
  const dup = !m.id && ortho.list('medications').some((x) => x.name.trim().toLowerCase() === m.name.trim().toLowerCase());
  return (
    <Modal title={initial.id ? 'تعديل الدواء' : 'إضافة دواء'} onClose={onClose} footer={<>
      {dup && <span className="sh-need">الدواء ده موجود في القايمة</span>}
      <Button variant="outline" onClick={onClose}>إلغاء</Button>
      <Button icon="check" loading={busy} disabled={!m.name.trim() || dup} onClick={() => run(() => ortho.save('medications', { ...m, name: m.name.trim() }), 'تم حفظ الدواء', onClose)}>حفظ</Button>
    </>}>
      <div className="grid-form grid-form--2">
        <Field label="اسم الدواء" className="span-2"><input className="input" dir="ltr" value={m.name} onChange={(e) => set('name', e.target.value)} placeholder="مثال: Diclofenac sodium 50mg" autoFocus /></Field>
        <Field label="المجموعة" className="span-2">
          <input className="input" list="med-groups" value={m.group} onChange={(e) => set('group', e.target.value)} placeholder="مثال: مسكنات ومضادات التهاب" />
          <datalist id="med-groups">{groups.map((g) => <option key={g} value={g} />)}</datalist>
        </Field>
        <Field label="الجرعة"><input className="input" value={m.dose} onChange={(e) => set('dose', e.target.value)} placeholder="قرص" /></Field>
        <Field label="التكرار"><input className="input" value={m.frequency} onChange={(e) => set('frequency', e.target.value)} placeholder="مرتين يوميًا بعد الأكل" /></Field>
        <Field label="المدة"><input className="input" value={m.duration} onChange={(e) => set('duration', e.target.value)} placeholder="5 أيام" /></Field>
      </div>
    </Modal>
  );
}

export default function Medications() {
  useOrthoVersion();
  const perm = useClinicalCan();
  const { run } = useRun();
  const [q, setQ] = useState('');
  const [edit, setEdit] = useState<Draft | null>(null);
  const saved = ortho.list('medications');
  const savedBy = new Map(saved.map((m) => [m.name.trim().toLowerCase(), m] as const));
  const all = medCatalog();
  const groups = [...new Set(all.map((m) => m.group).filter(Boolean))];
  const term = q.trim().toLowerCase();
  const list = all.filter((m) => !term || m.name.toLowerCase().includes(term) || m.group.includes(q.trim()));
  const byGroup = new Map<string, MedPreset[]>();
  for (const m of list) { const g = m.group || 'أخرى'; byGroup.set(g, [...(byGroup.get(g) ?? []), m]); }
  // أدوية اتكتبت في روشتات المرضى ومش في القايمة — بعدد المرات
  const known = new Set(all.map((m) => m.name.trim().toLowerCase()));
  const used = new Map<string, { m: MedPreset; n: number }>();
  for (const c of ortho.list('consultations')) for (const x of c.medications ?? []) {
    const name = x.name?.trim(); const k = name?.toLowerCase();
    if (!name || known.has(k)) continue;
    const cur = used.get(k);
    used.set(k, { m: cur?.m ?? { name, group: '', dose: x.dose ?? '', frequency: x.frequency ?? '', duration: x.duration ?? '' }, n: (cur?.n ?? 0) + 1 });
  }
  const extra = [...used.values()].filter(({ m }) => !term || m.name.toLowerCase().includes(term)).sort((a, b) => b.n - a.n);
  const isBase = (name: string) => MED_PRESETS.some((p) => p.name === name);
  const remove = (s: MedItem) => confirmDelete(`«${s.name}»`) && run(() => ortho.remove('medications', s.id), isBase(s.name) ? 'اتشال التعديل — رجع للقايمة الأساسية' : 'تم الحذف');

  return (
    <div className="page">
      <PageHead title="الأدوية" sub="أسامي الأدوية اللي بتتكتب للمرضى — بتظهر اقتراحات في الروشتة بالجرعة والتكرار والمدة">
        {perm.add && <Button icon="plus" onClick={() => setEdit(emptyMed())}>إضافة دواء</Button>}
      </PageHead>
      <section className="card">
        <div className="filter-bar"><div className="field"><SearchBox value={q} onChange={setQ} placeholder="ابحث باسم الدواء أو المجموعة" /></div></div>
        <div className="card__body">
          <LoadState kind="medications">
            {!list.length && !extra.length && <EmptyState icon="search" title="مفيش أدوية بالاسم ده" />}
            {[...byGroup].map(([g, meds]) => (
              <div key={g} style={{ marginBottom: 16 }}>
                <h3 className="ortho-sub" style={{ margin: '0 0 6px', fontWeight: 700 }}>{g} <span className="num">({meds.length})</span></h3>
                {meds.map((m) => {
                  const s = savedBy.get(m.name.trim().toLowerCase());
                  return (
                    <div className="item-card ortho-row" key={m.name}>
                      <div>
                        <b dir="ltr">{m.name}</b>{!s && <span className="badge badge--muted" style={{ marginInlineStart: 8 }}>أساسي</span>}
                        <div className="ortho-sub">{[m.dose, m.frequency, m.duration].filter(Boolean).join(' — ') || '—'}</div>
                      </div>
                      <div style={{ display: 'flex', gap: 6 }}>
                        {perm.edit && <IconBtn icon="edit" label="تعديل" onClick={() => setEdit(s ? { ...m, id: s.id } : { ...m })} />}
                        {perm.del && s && <IconBtn icon="trash" label="حذف" danger onClick={() => remove(s)} />}
                      </div>
                    </div>
                  );
                })}
              </div>
            ))}
            {extra.length > 0 && (
              <div style={{ marginTop: 20 }}>
                <h3 className="ortho-sub" style={{ margin: '0 0 6px', fontWeight: 700 }}>اتكتبت للمرضى ومش في القايمة <span className="num">({extra.length})</span></h3>
                {extra.map(({ m, n }) => (
                  <div className="item-card ortho-row" key={m.name}>
                    <div><b dir="ltr">{m.name}</b><div className="ortho-sub">اتكتب <span className="num">{n}</span> مرة{[m.dose, m.frequency, m.duration].some(Boolean) ? ` · ${[m.dose, m.frequency, m.duration].filter(Boolean).join(' — ')}` : ''}</div></div>
                    {perm.add && <Button size="sm" variant="outline" icon="plus" onClick={() => setEdit({ ...m })}>إضافة للقايمة</Button>}
                  </div>
                ))}
              </div>
            )}
          </LoadState>
        </div>
      </section>
      {edit && <MedModal initial={edit} groups={groups} onClose={() => setEdit(null)} />}
    </div>
  );
}
