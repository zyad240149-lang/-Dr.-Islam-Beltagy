import { useState } from 'react';
import { db } from '../data/db';
import { useDbVersion, useLoading } from '../hooks/useDb';
import { Icon } from '../utils/icons';
import { Button, EmptyState, Input, Modal, Select, Skeleton, StatusBadge } from '../components/ui';
import { ConfirmDialog, FilterBar, IconAction, useCan } from '../components/common';
import BookingWizard from '../components/BookingWizard';
import { money } from '../utils/format';
import { useToast } from '../hooks/useToast';
import type { Service } from '../types';

export default function Services() {
  return (
    <div className="page">
      <ServicesCatalog />
    </div>
  );
}

function ServicesCatalog() {
  useDbVersion();
  const loading = useLoading();
  const toast = useToast();
  const can = useCan();
  const [bookServiceId, setBookServiceId] = useState<string | null>(null);
  const [assigning, setAssigning] = useState<Service | null>(null);
  const [editing, setEditing] = useState<Service | 'new' | null>(null);
  const [deleting, setDeleting] = useState<Service | null>(null);
  const [q, setQ] = useState('');
  const [cat, setCat] = useState('');
  const [state, setState] = useState('');
  const all = db.allServices();
  const categories = [...new Set(all.map((s) => s.category))];
  const services = all.filter((s) => (!q.trim() || s.name.includes(q.trim()) || s.description.includes(q.trim())) && (!cat || s.category === cat) && (!state || (state === 'on' ? s.active : !s.active)));
  const canBook = can('booking', 'create') || can('appointments', 'create');

  return (
    <>
      <div className="page-head">
        <div><h1>الخدمات والأسعار</h1><p>كل الأسعار بالجنيه المصري. {all.length} خدمة ({all.filter((s) => s.active).length} مفعّلة).</p></div>
        {can('services', 'create') && <Button icon="spark" onClick={() => setEditing('new')}>إضافة خدمة</Button>}
      </div>

      <div className="card" style={{ marginBottom: 14 }}>
        <FilterBar>
          <Input id="sv-q" label="بحث" icon="search" placeholder="اسم الخدمة أو وصفها" value={q} onChange={(e) => setQ(e.target.value)} />
          <Select id="sv-state" label="الحالة" value={state} onChange={(e) => setState(e.target.value)} options={[{ value: '', label: 'الكل' }, { value: 'on', label: 'مفعّلة' }, { value: 'off', label: 'موقوفة' }]} />
        </FilterBar>
      </div>

      <div className="svc-tabs">
        <button type="button" className={`svc-tab ${!cat ? 'active' : ''}`} onClick={() => setCat('')}>
          الكل <span className="num">{all.length}</span>
        </button>
        {categories.map((c) => (
          <button key={c} type="button" className={`svc-tab ${cat === c ? 'active' : ''}`} onClick={() => setCat(c)}>
            {c} <span className="num">{all.filter((s) => s.category === c).length}</span>
          </button>
        ))}
      </div>

      {loading ? (
        <div className="svc-grid">{Array.from({ length: 6 }).map((_, i) => <div key={i} className="card"><div className="card__body"><Skeleton h={150} /></div></div>)}</div>
      ) : services.length === 0 ? <EmptyState icon="spark" title="ما فيه خدمات مطابقة" /> : (
        <div className="svc-grid">
          {services.map((s) => (
            <article className={`card svc-card ${s.active ? '' : 'svc-card--off'}`} key={s.id}>
              <div className="svc-card__top">
                <span className="svc-card__cat">{s.category}</span>
                <span style={{ display: 'inline-flex', gap: 6 }}>{s.active && !s.showOnSite && <StatusBadge label="إدارة فقط" tone="info" />}<StatusBadge label={s.active ? 'مفعّلة' : 'موقوفة'} tone={s.active ? 'ok' : 'muted'} /></span>
              </div>
              <h3 className="svc-card__name">{s.name}</h3>
              {s.description && <p className="svc-card__desc" title={s.description}>{s.description}</p>}
              <div className="svc-card__meta">
                <span title={doctorsText(s)}><Icon name="stethoscope" size={14} /> {doctorsText(s)}</span>
              </div>
              <div className="svc-card__foot">
                <strong className="svc-card__price num">{money(s.price)}</strong>
                <div className="svc-card__actions">
                  {can('services', 'edit') && <IconAction icon="stethoscope" label="تخصيص لدكتور" onClick={() => setAssigning(s)} />}
                  {can('services', 'edit') && <IconAction icon="edit" label="تعديل الخدمة" onClick={() => setEditing(s)} />}
                  {can('services', 'delete') && <IconAction icon="trash" label="حذف الخدمة" danger onClick={() => setDeleting(s)} />}
                  {canBook && s.active && <Button size="sm" icon="calendarPlus" onClick={() => setBookServiceId(s.id)}>حجز</Button>}
                </div>
              </div>
            </article>
          ))}
        </div>
      )}

      {assigning && <ServiceDoctorsModal service={assigning} onClose={() => setAssigning(null)} />}
      {bookServiceId && <BookingWizard presetServiceId={bookServiceId} onClose={() => setBookServiceId(null)} />}
      {editing && <ServiceModal service={editing === 'new' ? undefined : editing} categories={categories} defaultCategory={cat} onClose={() => setEditing(null)} />}
      {deleting && <ConfirmDialog title="حذف الخدمة" onClose={() => setDeleting(null)}
        message={`سيتم حذف خدمة «${deleting.name}» الحين. المواعيد والفواتير القديمة تحتفظ باسمها.`}
        onConfirm={async () => { const r = await db.deleteService(deleting.id); if (r.ok) toast.success('تم حذف الخدمة.'); else toast.error(r.error); }} />}
    </>
  );
}

// أسعار متعددة للخدمة: عادي / عرض / حسب الطبيب — تظهر في الحجز ويُحسب منها سعر الموعد والفاتورة
function PricesEditor({ serviceId, basePrice }: { serviceId: string; basePrice: number }) {
  useDbVersion();
  const toast = useToast();
  const can = useCan();
  const [f, setF] = useState({ label: '', price: '', therapistId: '' });
  const list = db.servicePrices(serviceId);
  const canEdit = can('services', 'edit');
  const add = async () => {
    const r = await db.saveServicePrice({ serviceId, label: f.label, price: Number(f.price), therapistId: f.therapistId || null, active: true });
    if (!r.ok) { toast.error(r.error); return; }
    toast.success('تمت إضافة السعر.'); setF({ label: '', price: '', therapistId: '' });
  };
  return (
    <div className="field">
      <label>الأسعار المتعددة (السعر الأساسي {money(basePrice)})</label>
      {list.length === 0 && <p className="muted-sm">ما فيه أسعار إضافية.</p>}
      {list.map((p) => (
        <div key={p.id} className="row-between" style={{ padding: '6px 0', borderBottom: '1px solid var(--line)' }}>
          <span>{p.label} — <strong className="num">{money(p.price)}</strong> <span className="muted-sm">{p.therapistId ? `(${db.therapist(p.therapistId)?.name ?? 'طبيب'})` : '(لكل الأطباء)'}</span>{!p.active && <span className="badge badge--muted" style={{ marginInlineStart: 6 }}>موقوف</span>}</span>
          {canEdit && <span style={{ display: 'flex', gap: 4 }}>
            <Button size="sm" variant="ghost" onClick={async () => { const r = await db.saveServicePrice({ ...p, active: !p.active }); if (!r.ok) toast.error(r.error); }}>{p.active ? 'إيقاف' : 'تفعيل'}</Button>
            <IconAction icon="trash" label="حذف السعر" danger onClick={async () => { const r = await db.deleteServicePrice(p.id); if (!r.ok) toast.error(r.error); }} />
          </span>}
        </div>
      ))}
      {canEdit && (
        <div className="grid-form grid-form--3" style={{ alignItems: 'end', marginTop: 8 }}>
          <Input id="sp-label" label="الاسم" placeholder="سعر عرض" value={f.label} onChange={(e) => setF({ ...f, label: e.target.value })} />
          <Input id="sp-price" label="السعر (ج.م)" type="number" min={0} value={f.price} onChange={(e) => setF({ ...f, price: e.target.value })} />
          <Select id="sp-th" label="الطبيب" value={f.therapistId} onChange={(e) => setF({ ...f, therapistId: e.target.value })} options={[{ value: '', label: 'لكل الأطباء' }, ...db.allTherapists().map((t) => ({ value: t.id, label: t.name }))]} />
        </div>
      )}
      {canEdit && <Button size="sm" variant="outline" icon="spark" onClick={add} disabled={!f.label.trim() || f.price === ''}>إضافة السعر</Button>}
    </div>
  );
}

// أسماء الأطباء اللي بيقدّموا الخدمة: «كل الأطباء» لو كلهم، وإلا أسماؤهم
function doctorsText(s: Service): string {
  const active = db.therapists().filter((t) => t.active);
  const mine = active.filter((t) => t.serviceIds.includes(s.id));
  if (!active.length || mine.length >= active.length) return 'كل الأطباء';
  if (!mine.length) return 'بدون دكتور';
  return mine.map((t) => t.name).join('، ');
}

function ServiceDoctorsModal({ service, onClose }: { service: Service; onClose: () => void }) {
  const toast = useToast();
  const doctors = db.therapists().filter((t) => t.active);
  const [sel, setSel] = useState<Set<string>>(() => new Set(doctors.filter((t) => t.serviceIds.includes(service.id)).map((t) => t.id)));
  const [busy, setBusy] = useState(false);
  const all = doctors.length > 0 && sel.size === doctors.length;
  const toggle = (id: string) => setSel((x) => { const n = new Set(x); if (n.has(id)) n.delete(id); else n.add(id); return n; });
  const save = async () => {
    if (!sel.size) { toast.error('اختر دكتور واحد على الأقل.'); return; }
    setBusy(true);
    const r = await db.setServiceDoctors(service.id, [...sel]);
    setBusy(false);
    if (!r.ok) { toast.error(r.error); return; }
    toast.success(all ? 'الخدمة متاحة لكل الأطباء.' : 'تم تخصيص الخدمة للأطباء المختارين.');
    onClose();
  };
  return (
    <Modal title={`تخصيص «${service.name}» لدكتور`} onClose={onClose}
      footer={<><Button variant="outline" onClick={onClose} disabled={busy}>إلغاء</Button><Button icon="check" onClick={save} loading={busy}>حفظ</Button></>}>
      <p className="muted-sm" style={{ marginTop: 0 }}>اختر الأطباء اللي يقدّمون هذي الخدمة. الحجز (من الإدارة والموقع وبوابة المريض) يعرض هالأطباء بس لهذي الخدمة. المواعيد الحالية ما تتأثر.</p>
      <label className="pr-check" style={{ marginBottom: 8 }}>
        <input type="checkbox" checked={all} onChange={() => setSel(all ? new Set() : new Set(doctors.map((t) => t.id)))} />
        <span><strong>كل الأطباء</strong></span>
      </label>
      <div style={{ display: 'grid', gap: 6 }}>
        {doctors.map((t) => (
          <label key={t.id} className="pr-check">
            <input type="checkbox" checked={sel.has(t.id)} onChange={() => toggle(t.id)} />
            <span><strong data-no-i18n>{t.name}</strong>{t.title ? <span className="muted-sm"> · {t.title}</span> : null}</span>
          </label>
        ))}
      </div>
    </Modal>
  );
}


// خدمة جديدة: التصنيف = التبويب المختار برّه (لو «الكل» ← أول تصنيف)
function ServiceModal({ service, categories, defaultCategory, onClose }: { service?: Service; categories: string[]; defaultCategory?: string; onClose: () => void }) {
  const toast = useToast();
  const [busy, setBusy] = useState(false);
  const [f, setF] = useState<Omit<Service, 'id'>>(service ?? { name: '', category: defaultCategory || categories[0] || '', description: '', price: 0, durationMin: 15, therapistIds: [], active: true, showOnSite: false /* خدمة جديدة: إدارة فقط لحد ما تتفعّل للحجز الإلكتروني */ });
  const submit = async () => {
    if (!f.name.trim() || !f.category.trim()) { toast.error('اسم الخدمة والتصنيف مطلوبان.'); return; }
    setBusy(true);
    const { therapistIds: _keep, ...rest } = f; // ربط الأطباء بيتغيّر من زرار «تخصيص لدكتور» بس — ما نبعتوش هنا عشان ما يتمسحش
    const r = await db.saveService({ ...rest, name: f.name.trim(), category: f.category.trim(), id: service?.id } as Parameters<typeof db.saveService>[0]);
    setBusy(false);
    if (!r.ok) { toast.error(r.error); return; }
    toast.success(service ? 'تم حفظ تعديلات الخدمة.' : 'تمت إضافة الخدمة.');
    onClose();
  };
  return (
    <Modal title={service ? 'تعديل الخدمة' : 'إضافة خدمة'} wide onClose={onClose} footer={<><Button variant="outline" onClick={onClose} disabled={busy}>إلغاء</Button><Button onClick={submit} loading={busy}>حفظ</Button></>}>
      <div className="grid-form">
        <Input id="svm-name" label="اسم الخدمة *" value={f.name} onChange={(e) => setF({ ...f, name: e.target.value })} />
        <Input id="svm-cat" label="التصنيف *" list="svm-cats" value={f.category} onChange={(e) => setF({ ...f, category: e.target.value })} />
        <datalist id="svm-cats">{categories.map((c) => <option key={c} value={c} />)}</datalist>
        <Input id="svm-price" label="السعر (ج.م)" type="number" min={0} value={f.price} onChange={(e) => setF({ ...f, price: Number(e.target.value) })} />
        <Select id="svm-active" label="الحالة" value={f.active ? 'on' : 'off'} onChange={(e) => setF({ ...f, active: e.target.value === 'on' })} options={[{ value: 'on', label: 'مفعّلة — تظهر في الحجز' }, { value: 'off', label: 'موقوفة — لا تظهر في الحجز' }]} />
        <Select id="svm-site" label="الظهور في الموقع" value={f.showOnSite ? 'on' : 'off'} onChange={(e) => setF({ ...f, showOnSite: e.target.value === 'on' })} options={[{ value: 'on', label: 'تظهر في الموقع وبوابة المريض وفي الإدارة' }, { value: 'off', label: 'في الإدارة فقط' }]} />
      </div>
      <div className="field"><label htmlFor="svm-desc">الوصف</label><textarea id="svm-desc" className="input" rows={2} value={f.description} onChange={(e) => setF({ ...f, description: e.target.value })} /></div>
      <p className="muted-sm">لتخصيص الخدمة لدكتور معيّن استخدم زر «تخصيص لدكتور» في كرت الخدمة.</p>
      {service ? <PricesEditor serviceId={service.id} basePrice={f.price} /> : <p className="muted-sm">بعد حفظ الخدمة تقدر تضيف أسعار متعددة (سعر عرض، سعر خاص بطبيب…).</p>}
      {service && service.price !== f.price && <div className="alert alert-warn">تغيير السعر يطبَّق على الحجوزات الجديدة فقط؛ المواعيد والفواتير السابقة تحتفظ بسعرها.</div>}
    </Modal>
  );
}
