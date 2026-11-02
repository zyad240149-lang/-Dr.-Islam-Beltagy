// «التمرينات العلاجية»: مكتبة تمرينات (اسم + مجموعة + وصف مختصر + صور/فيديوهات) — بتتختار لكل مريض من صفحة التشخيص وبتتبعت له واتساب.
import { useRef, useState } from 'react';
import { Button, EmptyState, Modal } from '../components/ui';
import { useToast } from '../hooks/useToast';
import { ortho, useOrthoVersion, type Exercise, type ExerciseMedia } from './data';
import { Field, IconBtn, LoadState, PageHead, SearchBox, confirmDelete, useClinicalCan, useRun } from './kit';

type Draft = Omit<Exercise, 'id'> & { id?: string };
const emptyEx = (): Draft => ({ name: '', group: '', description: '', media: [] });
const isVideo = (m: ExerciseMedia) => m.type.startsWith('video/');
const isPdf = (m: ExerciseMedia) => m.type === 'application/pdf';

export function MediaThumb({ m, size = 56 }: { m: ExerciseMedia; size?: number }) {
  if (isPdf(m)) return <a className="ex-thumb ex-thumb--pdf" style={{ width: size, height: size }} href={m.url} target="_blank" rel="noopener noreferrer" title={m.name} onClick={(e) => e.stopPropagation()}>PDF</a>;
  return isVideo(m)
    ? <video className="ex-thumb" style={{ width: size, height: size }} src={m.url + '#t=0.1'} preload="metadata" muted playsInline />
    : <img className="ex-thumb" style={{ width: size, height: size }} src={m.url} alt={m.name} loading="lazy" />;
}

function ExerciseModal({ initial, groups, onClose }: { initial: Draft; groups: string[]; onClose: () => void }) {
  const { run, busy } = useRun();
  const toast = useToast();
  const [e, setE] = useState<Draft>(initial);
  const [up, setUp] = useState(false);
  const added = useRef<ExerciseMedia[]>([]); // اتضافت في الجلسة دي — لو ألغى المستخدم بتتشال من التخزين
  const fileRef = useRef<HTMLInputElement>(null);
  const onFiles = async (files: FileList | null) => {
    if (!files?.length) return;
    setUp(true);
    for (const f of Array.from(files)) {
      try { const m = await ortho.uploadExerciseMedia(f); added.current.push(m); setE((x) => ({ ...x, media: [...x.media, m] })); }
      catch (err) { toast.error((err as Error).message); }
    }
    setUp(false);
    if (fileRef.current) fileRef.current.value = '';
  };
  const removeMedia = (m: ExerciseMedia) => setE((x) => ({ ...x, media: x.media.filter((y) => y.path !== m.path) }));
  const cancel = () => { for (const m of added.current) void ortho.removeExerciseMedia(m.path); onClose(); };
  const save = () => run(async () => {
    await ortho.save('exercises', { ...e, name: e.name.trim() } as never);
    // ملفات اتشالت من التمرين وهو بيتعدّل
    for (const m of initial.media) if (!e.media.some((y) => y.path === m.path)) void ortho.removeExerciseMedia(m.path);
  }, 'تم حفظ التمرين', onClose);
  return (
    <Modal title={initial.id ? 'تعديل التمرين' : 'إضافة تمرين'} onClose={cancel} footer={<>
      <Button variant="outline" onClick={cancel}>إلغاء</Button>
      <Button icon="check" loading={busy} disabled={!e.name.trim() || up} onClick={save}>حفظ</Button>
    </>}>
      <div className="grid-form grid-form--2">
        <Field label="اسم التمرين" className="span-2"><input className="input" value={e.name} onChange={(x) => setE({ ...e, name: x.target.value })} placeholder="مثال: تقوية الفخذ الأمامي (Quadriceps)" autoFocus /></Field>
        <Field label="المجموعة" className="span-2">
          <input className="input" list="ex-groups" value={e.group} onChange={(x) => setE({ ...e, group: x.target.value })} placeholder="مثال: الركبة" />
          <datalist id="ex-groups">{groups.map((g) => <option key={g} value={g} />)}</datalist>
        </Field>
        <Field label="وصف مختصر" className="span-2"><textarea className="input" rows={3} value={e.description} onChange={(x) => setE({ ...e, description: x.target.value })} placeholder="طريقة التمرين وعدد التكرارات…" /></Field>
        <Field label="صور وفيديوهات وملفات PDF" className="span-2">
          <input ref={fileRef} type="file" accept="image/*,video/*,application/pdf" multiple hidden onChange={(x) => void onFiles(x.target.files)} />
          <div className="ex-media">
            {e.media.map((m) => (
              <div className="ex-media__i" key={m.path}>
                <MediaThumb m={m} size={72} />
                <button type="button" className="ex-media__x" aria-label="شيل الملف" onClick={() => removeMedia(m)}>×</button>
              </div>
            ))}
            <Button variant="outline" size="sm" icon="upload" loading={up} onClick={() => fileRef.current?.click()}>رفع صور / فيديوهات / PDF</Button>
          </div>
        </Field>
      </div>
    </Modal>
  );
}

export default function Exercises() {
  useOrthoVersion();
  const perm = useClinicalCan();
  const { run } = useRun();
  const [q, setQ] = useState('');
  const [edit, setEdit] = useState<Draft | null>(null);
  const all = ortho.list('exercises');
  const groups = [...new Set(all.map((x) => x.group).filter(Boolean))];
  const term = q.trim().toLowerCase();
  const list = all.filter((x) => !term || x.name.toLowerCase().includes(term) || x.group.includes(q.trim()) || x.description.includes(q.trim()));
  const byGroup = new Map<string, Exercise[]>();
  for (const x of list) { const g = x.group || 'أخرى'; byGroup.set(g, [...(byGroup.get(g) ?? []), x]); }
  const remove = (x: Exercise) => confirmDelete(`«${x.name}»`) && run(async () => { await ortho.remove('exercises', x.id); for (const m of x.media) void ortho.removeExerciseMedia(m.path); }, 'تم الحذف');
  return (
    <div className="page">
      <PageHead title="التمرينات العلاجية" sub="مكتبة التمرينات — اختار منها لكل مريض من صفحة «تشخيص المريض» وابعتها له على واتساب">
        {perm.add && <Button icon="plus" onClick={() => setEdit(emptyEx())}>إضافة تمرين</Button>}
      </PageHead>
      <section className="card">
        <div className="filter-bar"><div className="field"><SearchBox value={q} onChange={setQ} placeholder="ابحث باسم التمرين أو المجموعة" /></div></div>
        <div className="card__body">
          <LoadState kind="exercises">
            {!all.length && <EmptyState icon="bone" title="مفيش تمرينات لسه" text="اضغط «إضافة تمرين» وارفع صور أو فيديوهات التمرين." />}
            {all.length > 0 && !list.length && <EmptyState icon="search" title="مفيش تمرين بالاسم ده" />}
            {[...byGroup].map(([g, items]) => (
              <div key={g} style={{ marginBottom: 16 }}>
                <h3 className="ortho-sub" style={{ margin: '0 0 6px', fontWeight: 700 }}>{g} <span className="num">({items.length})</span></h3>
                {items.map((x) => (
                  <div className="item-card ortho-row ex-row" key={x.id}>
                    <div className="ex-row__media">{x.media.length ? x.media.slice(0, 3).map((m) => <MediaThumb key={m.path} m={m} />) : <span className="ex-thumb ex-thumb--none" />}</div>
                    <div className="ex-row__txt">
                      <b>{x.name}</b>
                      {x.description && <div className="ortho-sub">{x.description}</div>}
                      <div className="ortho-sub">{x.media.filter((m) => !isVideo(m) && !isPdf(m)).length} صورة · {x.media.filter(isVideo).length} فيديو · {x.media.filter(isPdf).length} PDF</div>
                    </div>
                    <div style={{ display: 'flex', gap: 6 }}>
                      {perm.edit && <IconBtn icon="edit" label="تعديل" onClick={() => setEdit({ ...x })} />}
                      {perm.del && <IconBtn icon="trash" label="حذف" danger onClick={() => remove(x)} />}
                    </div>
                  </div>
                ))}
              </div>
            ))}
          </LoadState>
        </div>
      </section>
      {edit && <ExerciseModal initial={edit} groups={groups} onClose={() => setEdit(null)} />}
    </div>
  );
}
