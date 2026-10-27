import { PACKAGE_KIND_LABEL, PACKAGE_KIND_SESSIONS } from '../data/installments';
import { useState } from 'react';
import { db } from '../data/db';
import { useDbVersion } from '../hooks/useDb';
import { Button, EmptyState, Input, Modal, Select, StatusBadge } from '../components/ui';
import { ConfirmDialog, IconAction, RowActions, useCan } from '../components/common';
import { money } from '../utils/format';
import { useToast } from '../hooks/useToast';
import type { CenterInfo, PackageKind, PackagePlan } from '../types';
import { PhysioListsSettings } from '../components/PhysioListsSettings';
import { AutoNotificationsSettings } from '../components/AutoNotificationsSettings';

const TABS = ['بيانات المنشأة', 'المواعيد', 'الإشعارات', 'كتالوج الباقات', 'النظام', 'قوائم العلاج الطبيعي'];

export default function Settings() {
  useDbVersion();
  const toast = useToast();
  const can = useCan();
  const edit = can('settings', 'edit');
  const [tab, setTab] = useState(0);
  const [f, setF] = useState<CenterInfo>({ ...db.center() });
  const [busy, setBusy] = useState(false);
  const [plan, setPlan] = useState<PackagePlan | 'new' | null>(null);
  const [delPlan, setDelPlan] = useState<PackagePlan | null>(null);
  const set = <K extends keyof CenterInfo>(k: K, v: CenterInfo[K]) => setF((x) => ({ ...x, [k]: v }));
  const save = async (fields: (keyof CenterInfo)[]) => {
    setBusy(true);
    const patch = Object.fromEntries(fields.map((k) => [k, f[k]])) as Partial<CenterInfo>;
    const r = await db.updateCenter(patch);
    setBusy(false);
    if (r.ok) toast.success('تم حفظ الإعدادات.'); else toast.error(r.error);
  };
  const saveBtn = (fields: (keyof CenterInfo)[]) => edit && <Button onClick={() => save(fields)} loading={busy}>حفظ</Button>;

  return (
    <div className="page">
      <div className="page-head"><div><h1>الإعدادات</h1><p>إعدادات المنشأة والمواعيد والتنبيهات والباقات.</p></div></div>
      <div className="card" style={{ maxWidth: 900 }}>
        <div className="tabs" style={{ overflowX: 'auto' }}>{TABS.map((t, i) => <button key={t} className={`tab ${tab === i ? 'active' : ''}`} onClick={() => setTab(i)}>{t}</button>)}</div>
        <div className="card__body">
          {!edit && <div className="alert alert-info" style={{ marginBottom: 14 }}>عندك صلاحية عرض الإعدادات فقط.</div>}
          {tab === 0 && (
            <>
              <div className="grid-form">
                <Input id="st-name" label="اسم المنشأة" value={f.name} disabled={!edit} onChange={(e) => set('name', e.target.value)} />
                <Input id="st-branch" label="اسم الفرع" value={f.branchName} disabled={!edit} onChange={(e) => set('branchName', e.target.value)} />
                <Input id="st-city" label="المدينة" value={f.city} disabled={!edit} onChange={(e) => set('city', e.target.value)} />
                <Input id="st-district" label="الحي" value={f.district} disabled={!edit} onChange={(e) => set('district', e.target.value)} />
                <Input id="st-phone" label="الجوال" dir="ltr" value={f.phone} disabled={!edit} onChange={(e) => set('phone', e.target.value)} />
                <Input id="st-street" label="الشارع" value={f.street ?? ''} disabled={!edit} onChange={(e) => set('street', e.target.value)} />
                <Input id="st-email" label="البريد الإلكتروني" dir="ltr" value={f.email ?? ''} disabled={!edit} onChange={(e) => set('email', e.target.value)} />
                <Input id="st-logo" label="رابط الشعار" dir="ltr" value={f.logoUrl ?? ''} disabled={!edit} onChange={(e) => set('logoUrl', e.target.value)} />
                <Select id="st-cur" label="العملة" value={f.currency ?? 'EGP'} disabled={!edit} onChange={(e) => set('currency', e.target.value)} options={[{ value: 'EGP', label: 'جنيه مصري (EGP)' }, { value: 'USD', label: 'دولار (USD)' }]} />
                <Input id="st-hours" label="نص ساعات العمل (يظهر للمعلومة)" value={f.workHours} disabled={!edit} onChange={(e) => set('workHours', e.target.value)} />
              </div>
              <p className="muted" style={{ fontSize: 12.5 }}>المنشأة تعمل بفرع واحد. تظهر هذي البيانات في القائمة الجانبية ورأس الفواتير المطبوعة.</p>
              {saveBtn(['name', 'branchName', 'city', 'district', 'phone', 'workHours', 'street', 'email', 'logoUrl', 'currency'])}
            </>
          )}
          {tab === 1 && (
            <>
              <div className="grid-form grid-form--3">
                <Select id="st-step" label="فاصل الأوقات المتاحة" value={String(f.slotStepMin)} disabled={!edit} onChange={(e) => set('slotStepMin', Number(e.target.value))} options={[15, 20, 30, 45, 60].map((n) => ({ value: String(n), label: `${n} دقيقة` }))} />
                <Input id="st-dur" label="مدة الموعد الافتراضية (دقيقة)" type="number" min={5} max={240} step={5} value={f.defaultAppointmentMin ?? 30} disabled={!edit} onChange={(e) => set('defaultAppointmentMin', Number(e.target.value))} />
                <Input id="st-cancel" label="سياسة الإلغاء/التعديل: قبل الموعد بـ (ساعات)" type="number" min={0} max={720} value={f.cancelBeforeHours ?? 24} disabled={!edit} onChange={(e) => set('cancelBeforeHours', Number(e.target.value))} />
              </div>
              <p className="muted" style={{ fontSize: 12.5 }}>أيام وساعات عمل المركز ومواعيد كل موظف تُضبط من قسم «مواعيد العمل».</p>
              {saveBtn(['slotStepMin', 'defaultAppointmentMin', 'cancelBeforeHours'])}
            </>
          )}
          {tab === 2 && (
            <>
              <div className="grid-form">
                <Input id="st-remind" label="تنبيه الموعد القريب قبل (ساعات)" type="number" min={1} max={168} value={f.reminderHoursBefore} disabled={!edit} onChange={(e) => set('reminderHoursBefore', Number(e.target.value))} />
                <Input id="st-low" label="تنبيه نفاد الباقة عند بقاء (جلسات)" type="number" min={0} max={10} value={f.packageLowThreshold} disabled={!edit} onChange={(e) => set('packageLowThreshold', Number(e.target.value))} />
              </div>
              <p className="muted" style={{ fontSize: 12.5 }}>تُفحص التنبيهات الآلية (موعد قريب، باقة قاربت على الانتهاء، مبالغ متأخرة، مخزون منخفض) عند فتح النظام وكل دقيقة.</p>
              {saveBtn(['reminderHoursBefore', 'packageLowThreshold'])}
              <hr style={{ margin: '22px 0' }} />
              <AutoNotificationsSettings />
            </>
          )}
          {tab === 3 && (
            <>
              <div className="row-between" style={{ marginBottom: 12 }}>
                <span className="muted" style={{ fontSize: 13 }}>الباقات المتاحة للبيع من ملف المريض.</span>
                {can('packages', 'create') && <Button size="sm" icon="box" onClick={() => setPlan('new')}>إضافة باقة</Button>}
              </div>
              {db.allPackagePlans().length === 0 ? <EmptyState icon="box" title="ما فيه باقات في الكتالوج" /> : (
                <div className="table-wrap"><table className="table">
                  <thead><tr><th>الباقة</th><th>الجلسات</th><th>السعر</th><th>الصلاحية</th><th>الخدمات</th><th>الحالة</th><th className="actions"></th></tr></thead>
                  <tbody>{db.allPackagePlans().map((p) => (
                    <tr key={p.id}>
                      <td style={{ fontWeight: 600 }}>{p.name}{p.kind && <div className="muted-sm">{PACKAGE_KIND_LABEL[p.kind]} — يقبل الدفع على دفعتين بموافقة المدير</div>}</td><td className="num">{p.totalSessions}</td><td className="num">{money(p.price)}</td><td className="num">{p.validDays} يوم</td>
                      <td>{p.serviceIds.map((id) => db.service(id)?.name).filter(Boolean).join('، ')}</td>
                      <td><StatusBadge label={p.active ? 'مفعّلة' : 'موقوفة'} tone={p.active ? 'ok' : 'muted'} /></td>
                      <td className="actions"><RowActions>
                        {can('packages', 'edit') && <IconAction icon="edit" label="تعديل" onClick={() => setPlan(p)} />}
                        {can('packages', 'delete') && <IconAction icon="trash" label="حذف" danger onClick={() => setDelPlan(p)} />}
                      </RowActions></td>
                    </tr>
                  ))}</tbody>
                </table></div>
              )}
            </>
          )}
          {tab === 5 && <PhysioListsSettings />}
          {tab === 4 && (
            <>
              <dl className="dl" style={{ marginBottom: 16 }}>
                <div><dt>المرضى</dt><dd className="num">{db.patients().length}</dd></div>
                <div><dt>المواعيد</dt><dd className="num">{db.appointments().length}</dd></div>
                <div><dt>الفواتير</dt><dd className="num">{db.invoices().length}</dd></div>
                {/* السجل المحمّل = آخر 1000 عملية بس (db.ts) — العدد الفعلي ممكن يكون أكتر */}
                <div><dt>عمليات مسجلة</dt><dd className="num">{db.activity().length >= 1000 ? '1000+' : db.activity().length}</dd></div>
              </dl>
            </>
          )}
        </div>
      </div>
      {plan && <PackagePlanModal plan={plan === 'new' ? undefined : plan} onClose={() => setPlan(null)} />}
      {delPlan && <ConfirmDialog title="حذف الباقة من الكتالوج" onClose={() => setDelPlan(null)} message={`سيتم حذف «${delPlan.name}» من الكتالوج. الباقات المباعة سابقًا لا تتأثر.`}
        onConfirm={async () => { await db.deletePackagePlan(delPlan.id); toast.success('تم حذف الباقة من الكتالوج.'); }} />}
</div>
  );
}

function PackagePlanModal({ plan, onClose }: { plan?: PackagePlan; onClose: () => void }) {
  const toast = useToast();
  const [busy, setBusy] = useState(false);
  const [f, setF] = useState<Omit<PackagePlan, 'id'>>(plan ?? { name: '', serviceIds: [], totalSessions: 5, price: 0, validDays: 60, active: true });
  const services = db.allServices();
  const unit = f.serviceIds.length ? Math.max(...f.serviceIds.map((id) => db.service(id)?.price ?? 0)) : 0;
  const submit = async () => {
    if (!f.name.trim()) { toast.error('اسم الباقة مطلوب.'); return; }
    setBusy(true);
    const r = await db.savePackagePlan({ ...f, name: f.name.trim(), id: plan?.id });
    setBusy(false);
    if (!r.ok) { toast.error(r.error); return; }
    toast.success('تم حفظ الباقة.');
    onClose();
  };
  return (
    <Modal title={plan ? 'تعديل الباقة' : 'إضافة باقة'} wide onClose={onClose} footer={<><Button variant="outline" onClick={onClose} disabled={busy}>إلغاء</Button><Button onClick={submit} loading={busy}>حفظ</Button></>}>
      <div className="grid-form">
        <Input id="pp-name" label="اسم الباقة *" value={f.name} onChange={(e) => setF({ ...f, name: e.target.value })} />
        <Select id="pp-kind" label="نوع الباقة" value={f.kind ?? ''} disabled={!!plan}
          onChange={(e) => { const k = (e.target.value || null) as PackageKind | null; setF({ ...f, kind: k, totalSessions: k ? PACKAGE_KIND_SESSIONS[k] : f.totalSessions }); }}
          options={[{ value: '', label: 'باقة عادية' }, { value: 'pkg4', label: 'باقة 4 جلسات (دفع كامل / دفعتين بموافقة المدير)' }, { value: 'pkg6', label: 'باقة 6 جلسات (دفع كامل / دفعتين بموافقة المدير)' }]} />
        <Input id="pp-sessions" label="عدد الجلسات" type="number" min={1} value={f.totalSessions} disabled={!!f.kind} hint={f.kind ? 'ثابت لهذا النوع من الباقات' : undefined} onChange={(e) => setF({ ...f, totalSessions: Number(e.target.value) })} />
        <Input id="pp-price" label="سعر الباقة (ج.م)" type="number" min={0} value={f.price} onChange={(e) => setF({ ...f, price: Number(e.target.value) })} hint={unit ? `قيمة الجلسات منفردة: ${money(unit * f.totalSessions)}` : undefined} />
        <Input id="pp-days" label="الصلاحية (يوم)" type="number" min={1} value={f.validDays} onChange={(e) => setF({ ...f, validDays: Number(e.target.value) })} />
        <Select id="pp-active" label="الحالة" value={f.active ? 'on' : 'off'} onChange={(e) => setF({ ...f, active: e.target.value === 'on' })} options={[{ value: 'on', label: 'مفعّلة للبيع' }, { value: 'off', label: 'موقوفة' }]} />
      </div>
      <div className="field">
        <label>الخدمات المشمولة *</label>
        <div className="check-grid">{services.map((s) => {
          const on = f.serviceIds.includes(s.id);
          return <label key={s.id} className={`check-pill ${on ? 'on' : ''}`}><input type="checkbox" checked={on} onChange={() => setF({ ...f, serviceIds: on ? f.serviceIds.filter((x) => x !== s.id) : [...f.serviceIds, s.id] })} />{s.name}</label>;
        })}</div>
      </div>
    </Modal>
  );
}
