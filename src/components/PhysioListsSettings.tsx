// الإعدادات ← «قوائم العلاج الطبيعي»: إدارة أسماء العضلات والاختبارات الخاصة (Special Tests) من غير تعديل كود.
// مفيش حذف نهائي — التعطيل بيشيل الاسم من الاختيار، والتقييمات القديمة بتفضل محتفظة بالاسم.
import { useEffect, useState } from 'react';
import { Button, Input, Skeleton, StatusBadge } from './ui';
import { useToast } from '../hooks/useToast';
import { useCan } from './common';
import { physioLists, type ListItem } from '../data/physioObjective';

function ListEditor({ kind, title, items, reload }: { kind: 'muscle' | 'test'; title: string; items: ListItem[]; reload: () => void }) {
  const toast = useToast();
  const can = useCan();
  const edit = can('physio', 'edit');
  const [name, setName] = useState('');
  const [q, setQ] = useState('');
  const [busy, setBusy] = useState(false);
  const [editing, setEditing] = useState<{ id: string; name: string } | null>(null);
  const run = async (id: string | null, n: string, active = true, done?: string) => {
    setBusy(true);
    const r = await physioLists.save(kind, id, n, active);
    setBusy(false);
    if (!r.ok) { toast.error(r.error); return false; }
    if (done) toast.success(done);
    reload();
    return true;
  };
  const shown = items.filter((x) => x.name.toLowerCase().includes(q.trim().toLowerCase()));
  return (
    <div className="card" style={{ marginBottom: 16 }}>
      <div className="card__head"><h3>{title} <span className="muted num">({items.filter((x) => x.active).length})</span></h3></div>
      <div className="card__body">
        {edit && (
          <div style={{ display: 'flex', gap: 8, alignItems: 'end', marginBottom: 12, flexWrap: 'wrap' }}>
            <div style={{ flex: 1, minWidth: 200 }}><Input id={`pl-add-${kind}`} label="إضافة اسم جديد" dir="ltr" value={name} onChange={(e) => setName(e.target.value)} /></div>
            <Button icon="plus" loading={busy} disabled={name.trim().length < 2} onClick={async () => { if (await run(null, name, true, 'تمت الإضافة.')) setName(''); }}>إضافة</Button>
          </div>
        )}
        <Input id={`pl-q-${kind}`} label="بحث" dir="ltr" value={q} onChange={(e) => setQ(e.target.value)} />
        <div className="pl-list">
          {shown.map((x) => (
            <div key={x.id} className="pl-item">
              {editing?.id === x.id ? (
                <>
                  <input className="input" dir="ltr" value={editing.name} onChange={(e) => setEditing({ ...editing, name: e.target.value })} />
                  <Button size="sm" loading={busy} onClick={async () => { if (await run(x.id, editing.name, x.active, 'تم الحفظ.')) setEditing(null); }}>حفظ</Button>
                  <Button size="sm" variant="outline" onClick={() => setEditing(null)}>إلغاء</Button>
                </>
              ) : (
                <>
                  <span dir="ltr" style={{ flex: 1, opacity: x.active ? 1 : 0.55 }}>{x.name}</span>
                  {!x.active && <StatusBadge label="معطّل" tone="muted" />}
                  {edit && <Button size="sm" variant="ghost" onClick={() => setEditing({ id: x.id, name: x.name })}>تعديل</Button>}
                  {edit && <Button size="sm" variant="outline" loading={busy} onClick={() => run(x.id, x.name, !x.active, x.active ? 'تم التعطيل.' : 'تم التفعيل.')}>{x.active ? 'تعطيل' : 'تفعيل'}</Button>}
                </>
              )}
            </div>
          ))}
          {shown.length === 0 && <p className="muted">ما فيه نتائج.</p>}
        </div>
      </div>
    </div>
  );
}

export function PhysioListsSettings() {
  const [d, setD] = useState<{ muscles: ListItem[]; tests: ListItem[] } | null>(null);
  const [err, setErr] = useState('');
  const load = () => physioLists.load(true).then(setD).catch((e) => setErr((e as Error).message));
  useEffect(() => { load(); }, []);
  if (err) return <p className="muted">{err}</p>;
  if (!d) return <Skeleton h={200} />;
  return (
    <>
      <p className="muted" style={{ marginBottom: 12 }}>تظهر هذي القوائم في تقييم العلاج الطبيعي (Muscle Assessment و Special Tests). التعطيل يُزيلها من الاختيار دون التأثير على التقييمات القديمة.</p>
      <ListEditor kind="test" title="الاختبارات الخاصة (Special Tests)" items={d.tests} reload={load} />
      <ListEditor kind="muscle" title="العضلات (Muscles)" items={d.muscles} reload={load} />
    </>
  );
}
