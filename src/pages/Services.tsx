import { useState } from 'react';
import { db } from '../data/db';
import { useDbVersion, useLoading } from '../hooks/useDb';
import { Icon } from '../utils/icons';
import { Button, EmptyState, Input, Modal, Select, Skeleton, StatusBadge } from '../components/ui';
import { ConfirmDialog, FilterBar, IconAction, useCan } from '../components/common';
import BookingWizard from '../components/BookingWizard';
import { money, sessionsLabel } from '../utils/format';
import { useToast } from '../hooks/useToast';
import type { PlanService, Service } from '../types';

export default function Services() {
  const [tab, setTab] = useState<'catalog' | 'plans'>('catalog');
  return (
    <div className="page">
      <div className="tabs" style={{ marginBottom: 16 }}>
        <button className={`tab ${tab === 'catalog' ? 'active' : ''}`} onClick={() => setTab('catalog')}>الخدمات والأسعار</button>
        <button className={`tab ${tab === 'plans' ? 'active' : ''}`} onClick={() => setTab('plans')}>خدمات خطط العلاج</button>
      </div>
      {tab === 'catalog' ? <ServicesCatalog /> : <PlanServicesTab />}
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
              <p className="svc-card__desc" title={s.description}>{s.description || '—'}</p>
              <div className="svc-card__meta">
                <span><Icon name="clock" size={14} /> <span className="num">{durLabel(s.durationMin)}</span></span>
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
      {editing && <ServiceModal service={editing === 'new' ? undefined : editing} categories={categories} onClose={() => setEditing(null)} />}
      {deleting && <ConfirmDialog title="حذف الخدمة" onClose={() => setDeleting(null)}
        message={`سيتم حذف خدمة «${deleting.name}» الحين. المواعيد والفواتير القديمة تحتفظ باسمها.`}
        onConfirm={async () => { const r = await db.deleteService(deleting.id); if (r.ok) toast.success('تم حذف الخدمة.'); else toast.error(r.error); }} />}
    </>
  );
}

function PlanServicesTab() {
  useDbVersion();
  const toast = useToast();
  const can = useCan();
  const [editing, setEditing] = useState<PlanService | 'new' | null>(null);
  const [deleting, setDeleting] = useState<PlanService | null>(null);
  const list = db.allPlanServices();

  return (
    <>
      <div className="page-head">
        <div><h1>خدمات خطط العلاج</h1><p>قائمة منفصلة عن كتالوج الخدمات والأسعار الرسمي — لكل خدمة أسعار حسب عدد الجلسات (مثلًا 4 أو 6 جلسات) تظهر كاختيارات جاهزة عند إنشاء خطة علاجية.</p></div>
        {can('plans', 'create') && <Button icon="plus" onClick={() => setEditing('new')}>إضافة خدمة</Button>}
      </div>
      {list.length === 0 ? <EmptyState icon="spark" title="ما فيه خدمات خطط علاج بعد" text="أضف أول خدمة وأسعار جلساتها." /> : (
        <div className="card"><div className="card__body">
          <div className="table-wrap"><table className="table">
            <thead><tr><th>اسم الخدمة</th><th>الأسعار حسب عدد الجلسات</th><th>الحالة</th><th className="actions">الإجراءات</th></tr></thead>
            <tbody>{list.map((p) => (
              <tr key={p.id}>
                <td style={{ fontWeight: 600 }}>{p.name}</td>
                <td>{p.offers.length === 0 ? <span className="muted-sm">ما فيه أسعار</span> : (
                  <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
                    {p.offers.map((o) => (
                      <span key={o.sessions} style={{ padding: '3px 10px', borderRadius: 999, background: 'var(--surface-2, #eef0f6)', fontSize: 13 }}>
                        {sessionsLabel(o.sessions)} — <strong className="num">{money(o.price)}</strong>
                      </span>
                    ))}
                  </div>
                )}</td>
                <td><StatusBadge label={p.active ? 'مفعّلة' : 'موقوفة'} tone={p.active ? 'ok' : 'muted'} /></td>
                <td className="actions">
                  {can('plans', 'edit') && <IconAction icon="edit" label="تعديل" onClick={() => setEditing(p)} />}
                  {can('plans', 'delete') && <IconAction icon="trash" label="حذف" danger onClick={() => setDeleting(p)} />}
                </td>
              </tr>
            ))}</tbody>
          </table></div>
        </div></div>
      )}
      {editing && <PlanServiceModal service={editing === 'new' ? undefined : editing} onClose={() => setEditing(null)} />}
      {deleting && <ConfirmDialog title="حذف الخدمة" message={`سيتم حذف «${deleting.name}» وأسعارها نهائيًا. الخطط العلاجية الحالية التي تستخدمها لا تتأثر.`} onClose={() => setDeleting(null)}
        onConfirm={async () => { const r = await db.deletePlanService(deleting.id); if (r.ok) toast.success('تم حذف الخدمة.'); else toast.error(r.error); }} />}
    </>
  );
}

function PlanServiceModal({ service, onClose }: { service?: PlanService; onClose: () => void }) {
  const toast = useToast();
  const [name, setName] = useState(service?.name ?? '');
  const [active, setActive] = useState(service?.active ?? true);
  const [offers, setOffers] = useState<{ sessions: string; price: string }[]>(
    service?.offers.length ? service.offers.map((o) => ({ sessions: String(o.sessions), price: String(o.price) })) : [{ sessions: '4', price: '' }, { sessions: '6', price: '' }]);
  const [busy, setBusy] = useState(false);
  const setOffer = (i: number, k: 'sessions' | 'price', v: string) => setOffers((xs) => xs.map((x, j) => j === i ? { ...x, [k]: v } : x));
  const submit = async () => {
    if (!name.trim()) { toast.error('اسم الخدمة مطلوب.'); return; }
    const rows = offers.filter((o) => o.sessions.trim() || o.price.trim());
    for (const o of rows) {
      const n = Number(o.sessions);
      if (!Number.isInteger(n) || n < 1) { toast.error('عدد الجلسات لازم يكون رقم صحيح 1 أو أكثر.'); return; }
      if (o.price.trim() === '' || !(Number(o.price) >= 0)) { toast.error(`اكتب سعر ${sessionsLabel(n)}.`); return; }
    }
    if (new Set(rows.map((o) => Number(o.sessions))).size !== rows.length) { toast.error('ما يمكن تكرار نفس عدد الجلسات مرتين.'); return; }
    setBusy(true);
    const r = await db.savePlanService({ id: service?.id, name: name.trim(), active, offers: rows.map((o) => ({ sessions: Number(o.sessions), price: Number(o.price) })) });
    setBusy(false);
    if (!r.ok) { toast.error(r.error); return; }
    toast.success(service ? 'تم حفظ التعديلات.' : 'تمت إضافة الخدمة.'); onClose();
  };
  return (
    <Modal title={service ? 'تعديل خدمة خطة العلاج' : 'إضافة خدمة خطة علاج'} onClose={onClose} footer={<><Button variant="outline" onClick={onClose} disabled={busy}>إلغاء</Button><Button onClick={submit} loading={busy}>حفظ</Button></>}>
      <Input id="ps-name" label="اسم الخدمة *" placeholder="مثال: العلاج الطبيعي" value={name} onChange={(e) => setName(e.target.value)} />
      {service && <Select id="ps-active" label="الحالة" value={active ? 'on' : 'off'} onChange={(e) => setActive(e.target.value === 'on')} options={[{ value: 'on', label: 'مفعّلة' }, { value: 'off', label: 'موقوفة' }]} />}
      <div className="field" style={{ marginTop: 12 }}>
        <label>الأسعار حسب عدد الجلسات</label>
        {offers.map((o, i) => (
          <div key={i} style={{ display: 'grid', gridTemplateColumns: '1fr 1fr auto', gridTemplateRows: 'auto', gap: 8, alignItems: 'end', marginBottom: 8 }}>
            <Input id={`ps-s-${i}`} label="عدد الجلسات" type="number" min={1} value={o.sessions} onChange={(e) => setOffer(i, 'sessions', e.target.value)} />
            <Input id={`ps-p-${i}`} label="السعر الإجمالي (ج.م)" type="number" min={0} value={o.price} onChange={(e) => setOffer(i, 'price', e.target.value)} />
            <IconAction icon="trash" label="حذف السعر" danger onClick={() => setOffers((xs) => xs.filter((_, j) => j !== i))} />
          </div>
        ))}
        <Button variant="outline" icon="plus" onClick={() => setOffers((xs) => [...xs, { sessions: '', price: '' }])}>إضافة سعر</Button>
      </div>
    </Modal>
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

// مدة الجلسة: اختيارات جاهزة (بتحدد طول الموعد في الجدول وأوقات الحجز المتاحة في الإدارة والموقع وبوابة المريض)
const DURATIONS = [15, 20, 30, 45, 60, 75, 90, 120, 150, 180];
const durLabel = (m: number) => (m === 60 ? 'ساعة' : m === 120 ? 'ساعتين' : m === 90 ? 'ساعة ونص' : m === 180 ? '3 ساعات' : m > 60 && m % 60 === 0 ? `${m / 60} ساعات` : `${m} دقيقة`);

function ServiceModal({ service, categories, onClose }: { service?: Service; categories: string[]; onClose: () => void }) {
  const toast = useToast();
  const [busy, setBusy] = useState(false);
  const [customDur, setCustomDur] = useState(false);
  const [f, setF] = useState<Omit<Service, 'id'>>(service ?? { name: '', category: categories[0] ?? '', description: '', price: 0, durationMin: 45, therapistIds: [], active: true, showOnSite: true });
  const submit = async () => {
    if (!f.name.trim() || !f.category.trim()) { toast.error('اسم الخدمة والتصنيف مطلوبان.'); return; }
    if (!(f.durationMin >= 5 && f.durationMin <= 480)) { toast.error('مدة الجلسة لازم تكون بين 5 دقائق و8 ساعات.'); return; }
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
        <div>
          <Select id="svm-dur" label="مدة الجلسة" value={DURATIONS.includes(f.durationMin) && !customDur ? String(f.durationMin) : 'custom'}
            onChange={(e) => { if (e.target.value === 'custom') setCustomDur(true); else { setCustomDur(false); setF({ ...f, durationMin: Number(e.target.value) }); } }}
            options={[...DURATIONS.map((m) => ({ value: String(m), label: durLabel(m) })), { value: 'custom', label: 'مدة أخرى (اكتبها بالدقائق)' }]} />
          {(customDur || !DURATIONS.includes(f.durationMin)) && <Input id="svm-dur-c" label="المدة بالدقائق" type="number" min={5} max={480} step={5} value={f.durationMin} onChange={(e) => setF({ ...f, durationMin: Number(e.target.value) })} />}
        </div>
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
