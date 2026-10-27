import { useState } from 'react';
import { Link } from 'react-router-dom';
import { Button, EmptyState, Modal } from '../components/ui';
import { fmtDate, todayYmd } from '../utils/format';
import { FRACTURE_STATUS, SIDE, addDays, daysBetween, ortho, useOrthoVersion, type Fracture, type FractureStatus, type Side } from './data';
import { Field, IconBtn, LoadState, PageHead, PatientSelect, PillTabs, Tone, confirmDelete, patientFile, patientName, useClinicalCan, useRun } from './kit';

export function FractureModal({ initial, patientId = '', onClose }: { initial?: Fracture; patientId?: string; onClose: () => void }) {
  const { run, busy } = useRun();
  const t = todayYmd();
  const [f, setF] = useState<Omit<Fracture, 'id'> & { id?: string }>(initial ?? { patientId, bone: '', side: 'right', kind: '', injuryDate: t, castDate: t, removalDue: addDays(t, 42), status: 'casted' });
  const [weeks, setWeeks] = useState(initial ? Math.round(daysBetween(initial.castDate, initial.removalDue) / 7) : 6);
  const set = <K extends keyof Fracture>(k: K, v: Fracture[K]) => setF((x) => ({ ...x, [k]: v }));
  const setDuration = (w: number, from = f.castDate) => { setWeeks(w); setF((x) => ({ ...x, castDate: from, removalDue: addDays(from, w * 7) })); };
  return (
    <Modal wide title={initial ? 'تعديل حالة الكسر' : 'تسجيل كسر / جبس'} onClose={onClose} footer={<>
      <Button variant="outline" onClick={onClose}>إلغاء</Button>
      <Button icon="check" loading={busy} disabled={!f.patientId || !f.bone.trim()} onClick={() => run(() => ortho.save('fractures', f), 'تم الحفظ', onClose)}>حفظ</Button>
    </>}>
      <div className="grid-form grid-form--3">
        <Field label="المريض" className="span-2"><PatientSelect value={f.patientId} onChange={(v) => set('patientId', v)} /></Field>
        <Field label="العظمة المكسورة"><input className="input" value={f.bone} onChange={(e) => set('bone', e.target.value)} placeholder="مثال: الكعبرة" /></Field>
        <Field label="الجهة">
          <select className="input" value={f.side} onChange={(e) => set('side', e.target.value as Side)}>{Object.entries(SIDE).map(([k, v]) => <option key={k} value={k}>{v}</option>)}</select>
        </Field>
        <Field label="نوع الكسر"><input className="input" value={f.kind} onChange={(e) => set('kind', e.target.value)} placeholder="مستعرض، مفتت، كوليس…" /></Field>
        <Field label="تاريخ الإصابة"><input type="date" className="input" value={f.injuryDate} onChange={(e) => set('injuryDate', e.target.value)} /></Field>
        <Field label="تاريخ تركيب الجبس"><input type="date" className="input" value={f.castDate} onChange={(e) => setDuration(weeks, e.target.value)} /></Field>
        <Field label="مدة الجبس (أسابيع)"><input type="number" min={1} max={20} className="input" value={weeks} onChange={(e) => setDuration(Number(e.target.value) || 1)} /></Field>
        <Field label="موعد فك الجبس"><input type="date" className="input" value={f.removalDue} onChange={(e) => set('removalDue', e.target.value)} /></Field>
        <Field label="الحالة">
          <select className="input" value={f.status} onChange={(e) => set('status', e.target.value as FractureStatus)}>{Object.entries(FRACTURE_STATUS).map(([k, v]) => <option key={k} value={k}>{v.label}</option>)}</select>
        </Field>
      </div>
    </Modal>
  );
}

export function FractureCards({ items, onEdit }: { items: Fracture[]; onEdit: (f: Fracture) => void }) {
  const { run, busy } = useRun();
  const perm = useClinicalCan();
  const t = todayYmd();
  if (!items.length) return <EmptyState icon="bone" title="لا توجد حالات" />;
  return (
    <div className="case-grid">
      {items.map((f) => {
        const total = Math.max(1, daysBetween(f.castDate, f.removalDue));
        const passed = Math.min(total, Math.max(0, daysBetween(f.castDate, t)));
        const left = daysBetween(t, f.removalDue);
        const tone = f.status === 'healed' ? 'ok' : f.status === 'surgical' ? 'danger' : left <= 2 ? 'warn' : '';
        return (
          <div className={`card case-card ${tone ? `case-card--${tone}` : ''}`} key={f.id}>
            <div className="ortho-row" style={{ alignItems: 'flex-start' }}>
              <Link to={`/patients/${f.patientId}`} className="case-card__who"><strong>{patientName(f.patientId)}</strong><span>ملف {patientFile(f.patientId)}</span></Link>
              <Tone s={FRACTURE_STATUS[f.status]} />
            </div>
            <dl className="facts">
              <div><dt>العظمة</dt><dd>{f.bone} — {SIDE[f.side]}</dd></div>
              <div><dt>نوع الكسر</dt><dd>{f.kind || '—'}</dd></div>
              <div><dt>تركيب الجبس</dt><dd>{fmtDate(f.castDate)}</dd></div>
              <div><dt>موعد الفك</dt><dd>{fmtDate(f.removalDue)}</dd></div>
            </dl>
            {f.status !== 'healed' && (
              <div>
                <div className="ortho-row" style={{ fontSize: 14, marginBottom: 6 }}>
                  <span className="muted">مرّ {passed} من {total} يوم</span>
                  <strong style={{ color: left < 0 ? 'var(--danger)' : left <= 2 ? 'var(--warn)' : 'var(--brand-700)' }}>
                    {left < 0 ? `متأخر ${-left} يوم` : left === 0 ? 'الفك اليوم' : `باقي ${left} يوم`}
                  </strong>
                </div>
                <div className="progress"><i style={{ width: `${(passed / total) * 100}%` }} /></div>
              </div>
            )}
            <div className="case-card__foot">
              {f.status !== 'healed' && perm.edit && <Button size="sm" variant="outline" icon="check" loading={busy} onClick={() => run(() => ortho.save('fractures', { ...f, status: 'healed' }), 'تم تسجيل فك الجبس والتئام الكسر')}>تم فك الجبس</Button>}
              <div style={{ flex: 1 }} />
              {perm.edit && <IconBtn icon="edit" label="تعديل" onClick={() => onEdit(f)} />}
              {perm.del && <IconBtn icon="trash" label="حذف" danger onClick={() => confirmDelete('هذه الحالة') && run(() => ortho.remove('fractures', f.id), 'تم الحذف')} />}
            </div>
          </div>
        );
      })}
    </div>
  );
}

export default function Fractures() {
  useOrthoVersion();
  const perm = useClinicalCan();
  const [tab, setTab] = useState<'active' | 'due' | 'healed'>('active');
  const [edit, setEdit] = useState<Fracture | 'new' | null>(null);
  const t = todayYmd();
  const sorted = ortho.list('fractures').sort((a, b) => a.removalDue.localeCompare(b.removalDue));
  const groups = {
    active: sorted.filter((f) => f.status !== 'healed'),
    due: sorted.filter((f) => f.status !== 'healed' && daysBetween(t, f.removalDue) <= 7),
    healed: sorted.filter((f) => f.status === 'healed'),
  };
  return (
    <div className="page">
      <PageHead title="الكسور والجبس" sub="مواعيد فك الجبس ومراحل الالتئام">
        {perm.add && <Button icon="plus" onClick={() => setEdit('new')}>تسجيل كسر</Button>}
      </PageHead>
      <PillTabs value={tab} onChange={setTab} tabs={[
        { id: 'active', label: 'حالات نشطة', n: groups.active.length },
        { id: 'due', label: 'فك خلال أسبوع / متأخر', n: groups.due.length },
        { id: 'healed', label: 'التأمت', n: groups.healed.length },
      ]} />
      <LoadState kind="fractures"><FractureCards items={groups[tab]} onEdit={setEdit} /></LoadState>
      {edit && <FractureModal initial={edit === 'new' ? undefined : edit} onClose={() => setEdit(null)} />}
    </div>
  );
}
