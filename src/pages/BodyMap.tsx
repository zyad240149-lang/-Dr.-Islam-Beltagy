import { useMemo, useState } from 'react';
import { BODY_REGIONS, type Condition } from '../data/bodyRegions';
import { Button, EmptyState, Input, Modal } from '../components/ui';
import { ConfirmDialog, IconAction, useCan } from '../components/common';
import { useDbVersion } from '../hooks/useDb';
import { useToast } from '../hooks/useToast';
import { PlanModal } from '../components/PatientForms';
import { BodyRecordModal } from '../components/PatientExtras';
import { Icon } from '../utils/icons';
import { db } from '../data/db';
import { BodyFigure as Figure, regionById } from '../components/BodyFigure';

function ConditionCard({ c, onPlan, onRecord, onEdit, onDelete, stats }: { c: Condition; onPlan?: () => void; onRecord?: () => void; onEdit?: () => void; onDelete?: () => void; stats?: { active: number; total: number } }) {
  return (
    <article className="bm-cond">
      <div className="bm-cond__head">
        <div>
          <h4 dir="ltr" className="bm-cond__title">{c.en} <span className="dx-code num">{c.icd10}</span></h4>
          <span className="bm-cond__ar">{c.name}</span>
        </div>
        <div style={{ display: 'flex', gap: 6 }}>
          {onRecord && <Button size="sm" variant="outline" icon="body" onClick={onRecord}>تسجيل لمريض</Button>}
          {onPlan && <Button size="sm" variant="outline" icon="target" onClick={onPlan}>خطة علاج</Button>}
          {onEdit && <IconAction icon="edit" label="تعديل الحالة" onClick={onEdit} />}
          {onDelete && <IconAction icon="trash" label="حذف الحالة" danger onClick={onDelete} />}
        </div>
      </div>
      <p>{c.desc}</p>
      <div className="bm-cond__tests"><strong>اختبارات التشخيص:</strong> <bdi>{c.tests}</bdi></div>
      {stats && stats.total > 0 && <div className="bm-cond__stats"><span className="num">{stats.active}</span> خطة نشطة · <span className="num">{stats.total}</span> إجمالي</div>}
    </article>
  );
}

export default function BodyMap() {
  useDbVersion();
  const can = useCan();
  const toast = useToast();
  const [editing, setEditing] = useState<{ c?: Condition; regionId: string } | null>(null);
  const [deleting, setDeleting] = useState<Condition | null>(null);
  const [selected, setSelected] = useState<string | null>('lumbar');
  const [hovered, setHovered] = useState<string | null>(null);
  const [q, setQ] = useState('');
  const [planFor, setPlanFor] = useState<Condition | null>(null);
  const [recFor, setRecFor] = useState<{ region: string; cond: string } | null>(null);

  const search = q.trim().toLowerCase();
  const results = useMemo(() => !search ? [] : BODY_REGIONS.flatMap((r) =>
    r.conditions.filter((c) => c.name.includes(q.trim()) || c.en.toLowerCase().includes(search) || c.icd10.toLowerCase().includes(search) || r.name.includes(q.trim()) || r.en.toLowerCase().includes(search)).map((c) => ({ region: r, c }))),
  [q, search]);
  const highlighted = useMemo(() => new Set(results.map((x) => x.region.id)), [results]);

  const region = selected ? regionById(selected) : undefined;
  const preview = hovered ? regionById(hovered) : undefined;
  const planAction = (c: Condition) => (can('plans', 'create') ? () => setPlanFor(c) : undefined);
  const recAction = (c: Condition, regionId: string) => (can('plans', 'create') ? () => setRecFor({ region: regionId, cond: c.id }) : undefined);
  const editAction = (c: Condition, regionId: string) => (can('plans', 'edit') ? () => setEditing({ c, regionId }) : undefined);
  const deleteAction = (c: Condition) => (can('plans', 'delete') ? () => setDeleting(c) : undefined);
  const select = (id: string) => { setSelected(id); setQ(''); };
  const total = BODY_REGIONS.reduce((s, r) => s + r.conditions.length, 0);
  const plans = db.raw().plans.filter((p) => p.diagnosisRef);
  const condStats = (id: string) => ({ active: plans.filter((p) => p.diagnosisRef!.conditionId === id && p.status === 'active').length, total: plans.filter((p) => p.diagnosisRef!.conditionId === id).length });
  const regionTotal = (id: string) => plans.filter((p) => p.diagnosisRef!.regionId === id).length;

  return (
    <div className="page">
      <div className="page-head">
        <div><h1>جسم الإنسان</h1><p>مرجع التشخيص المعتمد: اختر منطقة من الجسم لعرض حالاتها، أو ابدأ خطة علاج بالتشخيص مباشرة.</p></div>
      </div>

      <div className="bm-layout">
        <section className="card bm-body">
          <div className="card__head">
            <h2>خريطة الجسم</h2>
            <span className="muted bm-hint">{preview ? <><strong>{preview.name}</strong> · <span className="num">{preview.conditions.length}</span> حالات</> : <><span className="num">{BODY_REGIONS.length}</span> مناطق · <span className="num">{total}</span> حالة</>}</span>
          </div>
          <div className="card__body bm-figures">
            <Figure view="front" selected={selected} hovered={hovered} highlighted={highlighted} onSelect={select} onHover={setHovered} />
            <Figure view="back" selected={selected} hovered={hovered} highlighted={highlighted} onSelect={select} onHover={setHovered} />
          </div>
          <div className="bm-chips">
            {BODY_REGIONS.map((r) => (
              <button key={r.id} type="button" className={`bm-chip ${selected === r.id && !search ? 'active' : ''} ${highlighted.has(r.id) ? 'match' : ''}`}
                onClick={() => select(r.id)} onMouseEnter={() => setHovered(r.id)} onMouseLeave={() => setHovered(null)}>
                {r.name} <span className="num">{r.conditions.length}</span>
              </button>
            ))}
          </div>
        </section>

        <section className="card bm-panel">
          <div className="card__body" style={{ paddingBottom: 0 }}>
            <Input id="bm-q" icon="search" label="ابحث عن حالة" placeholder="Frozen shoulder, ACL, Tennis elbow…" value={q} onChange={(e) => setQ(e.target.value)} />
          </div>

          <div className="card__body bm-list" key={search ? 'search' : selected ?? 'none'}>
            {search ? (
              results.length === 0 ? <EmptyState icon="search" title="ما فيه حالات مطابقة" /> : (
                <>
                  <div className="bm-list__title"><span className="num">{results.length}</span> نتيجة في <span className="num">{highlighted.size}</span> منطقة</div>
                  {results.map(({ region: r, c }) => (
                    <div key={r.id + c.en}>
                      <button type="button" className="bm-region-link" onClick={() => select(r.id)}><Icon name="pin" size={13} /> {r.name}</button>
                      <ConditionCard c={c} onPlan={planAction(c)} onRecord={recAction(c, r.id)} onEdit={editAction(c, r.id)} onDelete={deleteAction(c)} stats={condStats(c.id)} />
                    </div>
                  ))}
                </>
              )
            ) : region ? (
              <>
                <div className="bm-region-head">
                  <span className="kpi__ic kpi__ic--brand"><Icon name="pin" size={18} /></span>
                  <div>
                    <h3>{region.name} <span className="bm-cond__en" dir="ltr" style={{ display: 'inline' }}>{region.en}</span></h3>
                    <span className="muted"><span className="num">{region.conditions.length}</span> حالات معتمدة · <span className="num">{regionTotal(region.id)}</span> خطة علاج مسجّلة</span>
                  </div>
                  {can('plans', 'create') && <Button size="sm" icon="edit" style={{ marginInlineStart: 'auto' }} onClick={() => setEditing({ regionId: region.id })}>إضافة حالة</Button>}
                </div>
                {region.conditions.map((c) => <ConditionCard key={c.id} c={c} onPlan={planAction(c)} onRecord={recAction(c, region.id)} onEdit={editAction(c, region.id)} onDelete={deleteAction(c)} stats={condStats(c.id)} />)}
              </>
            ) : <EmptyState icon="body" title="اختر منطقة من الجسم" />}
          </div>
        </section>
      </div>

      {editing && <ConditionModal cond={editing.c} regionId={editing.regionId} onClose={() => setEditing(null)} />}
      {deleting && <ConfirmDialog title="حذف الحالة" message={`سيتم حذف «${deleting.name}» من القائمة. الخطط والسجلات القديمة المرتبطة بها تبقى كما هي.`} onClose={() => setDeleting(null)} onConfirm={async () => { const r = await db.hideCondition(deleting.id); if (r.ok) toast.success('تم حذف الحالة.'); else toast.error(r.error); }} />}
      {recFor && <BodyRecordModal presetRegion={recFor.region} presetCondition={recFor.cond} onClose={() => setRecFor(null)} />}
      {planFor && <PlanModal presetDiagnosis={planFor.en} onClose={() => setPlanFor(null)} />}
    </div>
  );
}

function ConditionModal({ cond, regionId, onClose }: { cond?: Condition; regionId: string; onClose: () => void }) {
  const toast = useToast();
  const [f, setF] = useState({ en: cond?.en ?? '', desc: cond?.desc ?? '' });
  const [busy, setBusy] = useState(false);
  const submit = async () => {
    setBusy(true);
    const autoIcd = f.en.toUpperCase().replace(/[^A-Z0-9]/g, '').slice(0, 8) || 'GEN';
    const r = await db.saveCondition({ id: cond?.id, regionId, en: f.en, desc: f.desc, icd10: cond?.icd10 || autoIcd, tests: cond?.tests ?? '', name: cond?.name || f.en, services: cond?.services });
    setBusy(false);
    if (!r.ok) { toast.error(r.error); return; }
    toast.success(cond ? 'تم تعديل الحالة.' : 'تمت إضافة الحالة.');
    onClose();
  };
  return (
    <Modal title={cond ? 'تعديل الحالة' : 'إضافة حالة'} onClose={onClose} footer={<><Button variant="outline" onClick={onClose} disabled={busy}>إلغاء</Button><Button onClick={submit} loading={busy}>حفظ</Button></>}>
      <Input id="cd-en" label="اسم الحالة *" dir="ltr" value={f.en} onChange={(e) => setF({ ...f, en: e.target.value })} />
      <div className="field"><label htmlFor="cd-desc">الوصف (اختياري)</label><textarea id="cd-desc" className="input" rows={3} value={f.desc} onChange={(e) => setF({ ...f, desc: e.target.value })} /></div>
    </Modal>
  );
}
