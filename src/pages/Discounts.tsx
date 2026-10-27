import { useState } from 'react';
import { db } from '../data/db';
import { useDbVersion, useLoading } from '../hooks/useDb';
import { Button, EmptyState, Input, Modal, Select, Skeleton, StatusBadge } from '../components/ui';
import { ConfirmDialog, IconAction, useCan } from '../components/common';
import { StatCard } from '../components/StatCard';
import { useToast } from '../hooks/useToast';
import { fmtDate, money, todayYmd, ymdLocal } from '../utils/format';
import type { DiscountCode, DiscountType } from '../types';

const STATUS: Record<ReturnType<typeof db.discountStatus>, { label: string; tone: string }> = {
  active: { label: 'ساري', tone: 'ok' },
  scheduled: { label: 'لم يبدأ بعد', tone: 'info' },
  expired: { label: 'منتهي', tone: 'muted' },
  used_up: { label: 'استُهلك', tone: 'warn' },
  disabled: { label: 'موقوف', tone: 'danger' },
};

const addDays = (ymd: string, n: number) => {
  const d = new Date(ymd + 'T00:00:00');
  d.setDate(d.getDate() + n);
  return ymdLocal(d);
};

// كود الشركات: بدون مدة ولا عدد مرات — بقيم حدّية بعيدة بدل تغيير القاعدة
export const NO_EXPIRY = '2099-12-31';
export const NO_LIMIT = 999999999;
export const isCompanyCode = (dc: Pick<DiscountCode, 'validTo' | 'maxUses'>) => dc.validTo === NO_EXPIRY && dc.maxUses === NO_LIMIT;

export const discountLabel = (dc: Pick<DiscountCode, 'type' | 'value'>) => (dc.type === 'percent' ? `${dc.value}%` : money(dc.value));

function CompanyModal({ code, onClose }: { code?: DiscountCode; onClose: () => void }) {
  const toast = useToast();
  const [busy, setBusy] = useState(false);
  const [f, setF] = useState({
    code: code?.code ?? '', type: code?.type ?? ('percent' as DiscountType), value: code?.value ?? 10,
    minAmount: code?.minAmount ?? 0, active: code?.active ?? true,
  });
  const set = <K extends keyof typeof f>(k: K, v: (typeof f)[K]) => setF((x) => ({ ...x, [k]: v }));
  const submit = async () => {
    setBusy(true);
    const r = await db.saveDiscountCode({
      ...f, id: code?.id, validFrom: code?.validFrom ?? todayYmd(), validTo: NO_EXPIRY, maxUses: NO_LIMIT, note: 'كود شركة',
    });
    setBusy(false);
    if (!r.ok) { toast.error(r.error); return; }
    toast.success(code ? 'تم تعديل كود الشركة.' : 'تم إنشاء كود الشركة.');
    onClose();
  };
  return (
    <Modal title={code ? `تعديل كود الشركة ${code.code}` : 'إنشاء كود خصم شركات'} onClose={onClose}
      footer={<><Button variant="outline" onClick={onClose} disabled={busy}>إلغاء</Button><Button icon="check" onClick={submit} loading={busy}>حفظ</Button></>}>
      <Input id="dc-company" label="اسم الشركة (يكون هو الكود) *" dir="ltr" placeholder="ARAMCO" value={f.code}
        onChange={(e) => set('code', e.target.value.toUpperCase().replace(/[^A-Z0-9_-]/g, ''))} />
      <p className="muted" style={{ fontSize: 12.5, marginTop: -4 }}>من 3 إلى 20 حرف إنجليزي أو رقم، بدون مسافات.</p>
      <div className="field">
        <label>نوع الخصم</label>
        <div className="seg">
          <button type="button" className={`seg__btn ${f.type === 'percent' ? 'active' : ''}`} onClick={() => set('type', 'percent')}>نسبة مئوية %</button>
          <button type="button" className={`seg__btn ${f.type === 'fixed' ? 'active' : ''}`} onClick={() => set('type', 'fixed')}>مبلغ ثابت (ج.م)</button>
        </div>
      </div>
      <div className="grid-form">
        <Input id="dc-cvalue" label={f.type === 'percent' ? 'نسبة الخصم (%)' : 'مبلغ الخصم (ج.م)'} type="number" min={1} max={f.type === 'percent' ? 100 : undefined}
          value={f.value} onChange={(e) => set('value', Number(e.target.value))} />
        <Input id="dc-cmin" label="الحد الأدنى للطلب (ج.م)" type="number" min={0} value={f.minAmount} onChange={(e) => set('minAmount', Number(e.target.value))} />
      </div>
      {code && (
        <Select id="dc-cactive" label="الحالة" value={f.active ? 'on' : 'off'} onChange={(e) => set('active', e.target.value === 'on')}
          options={[{ value: 'on', label: 'مفعّل' }, { value: 'off', label: 'موقوف' }]} />
      )}
      <div className="review-total" style={{ marginTop: 6 }}>
        <div>
          <div style={{ fontWeight: 700 }} dir="ltr">{f.code || '—'}</div>
          <div className="muted" style={{ fontSize: 12.5 }}>خصم {discountLabel(f)} · بدون مدة · بدون حد للاستخدام</div>
        </div>
        <strong className="num" style={{ fontSize: 22, color: 'var(--brand-700)' }}>{discountLabel(f)}</strong>
      </div>
    </Modal>
  );
}

function CodeModal({ code, onClose }: { code?: DiscountCode; onClose: () => void }) {
  const toast = useToast();
  const [busy, setBusy] = useState(false);
  const [f, setF] = useState({
    code: code?.code ?? '', type: code?.type ?? ('percent' as DiscountType), value: code?.value ?? 10,
    validFrom: code?.validFrom ?? todayYmd(), validTo: code?.validTo ?? addDays(todayYmd(), 30),
    minAmount: code?.minAmount ?? 0, maxUses: code?.maxUses ?? 50, active: code?.active ?? true, note: code?.note ?? '',
  });
  const set = <K extends keyof typeof f>(k: K, v: (typeof f)[K]) => setF((x) => ({ ...x, [k]: v }));
  const generate = () => {
    const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
    const buf = new Uint32Array(6);
    crypto.getRandomValues(buf);
    set('code', 'TAM' + Array.from(buf, (n) => chars[n % chars.length]).join(''));
  };
  const days = f.validFrom && f.validTo && f.validFrom <= f.validTo
    ? Math.round((Date.parse(f.validTo) - Date.parse(f.validFrom)) / 86400000) + 1 : 0;

  const submit = async () => {
    setBusy(true);
    const r = await db.saveDiscountCode({ ...f, id: code?.id });
    setBusy(false);
    if (!r.ok) { toast.error(r.error); return; }
    toast.success(code ? 'تم تعديل كود الخصم.' : 'تم إنشاء كود الخصم.');
    onClose();
  };

  return (
    <Modal title={code ? `تعديل الكود ${code.code}` : 'إنشاء كود خصم'} onClose={onClose}
      footer={<><Button variant="outline" onClick={onClose} disabled={busy}>إلغاء</Button><Button icon="check" onClick={submit} loading={busy}>حفظ</Button></>}>
      <div className="dc-code-row">
        <Input id="dc-code" label="الكود *" dir="ltr" placeholder="NATIONAL96" value={f.code}
          onChange={(e) => set('code', e.target.value.toUpperCase().replace(/\s+/g, ''))} />
        <Button variant="outline" icon="refresh" type="button" onClick={generate}>توليد</Button>
      </div>

      <div className="field">
        <label>نوع الخصم</label>
        <div className="seg">
          <button type="button" className={`seg__btn ${f.type === 'percent' ? 'active' : ''}`} onClick={() => set('type', 'percent')}>نسبة مئوية %</button>
          <button type="button" className={`seg__btn ${f.type === 'fixed' ? 'active' : ''}`} onClick={() => set('type', 'fixed')}>مبلغ ثابت (ج.م)</button>
        </div>
      </div>

      <div className="grid-form">
        <Input id="dc-value" label={f.type === 'percent' ? 'نسبة الخصم (%)' : 'مبلغ الخصم (ج.م)'} type="number" min={1} max={f.type === 'percent' ? 100 : undefined}
          value={f.value} onChange={(e) => set('value', Number(e.target.value))} />
        <Input id="dc-uses" label="عدد مرات الاستخدام" type="number" min={1} value={f.maxUses} onChange={(e) => set('maxUses', Number(e.target.value))} />
        <Input id="dc-min" label="الحد الأدنى للطلب (ج.م)" type="number" min={0} value={f.minAmount} onChange={(e) => set('minAmount', Number(e.target.value))} />
      </div>

      <div className="field">
        <label>مدة الاستخدام</label>
        <div className="dc-presets">
          {[7, 14, 30, 90].map((n) => (
            <button key={n} type="button" className={`svc-tab ${days === n ? 'active' : ''}`}
              onClick={() => setF((x) => ({ ...x, validTo: addDays(x.validFrom, n - 1) }))}>{n} يوم</button>
          ))}
        </div>
      </div>
      <div className="grid-form">
        <Input id="dc-from" label="من تاريخ" type="date" value={f.validFrom} onChange={(e) => set('validFrom', e.target.value)} />
        <Input id="dc-to" label="إلى تاريخ" type="date" min={f.validFrom} value={f.validTo} onChange={(e) => set('validTo', e.target.value)} />
      </div>

      <Input id="dc-note" label="ملاحظة (اختياري)" placeholder="مثال: عروض اليوم الوطني" value={f.note} onChange={(e) => set('note', e.target.value)} />
      {code && (
        <Select id="dc-active" label="الحالة" value={f.active ? 'on' : 'off'} onChange={(e) => set('active', e.target.value === 'on')}
          options={[{ value: 'on', label: 'مفعّل' }, { value: 'off', label: 'موقوف' }]} />
      )}

      <div className="review-total" style={{ marginTop: 6 }}>
        <div>
          <div style={{ fontWeight: 700 }} dir="ltr">{f.code || '—'}</div>
          <div className="muted" style={{ fontSize: 12.5 }}>
            خصم {discountLabel(f)} · {days > 0 ? `${days} يوم` : 'تاريخ غير صحيح'} · حتى {f.maxUses || 0} استخدام
          </div>
        </div>
        <strong className="num" style={{ fontSize: 22, color: 'var(--brand-700)' }}>{discountLabel(f)}</strong>
      </div>
    </Modal>
  );
}

export default function Discounts() {
  useDbVersion();
  const loading = useLoading();
  const can = useCan();
  const toast = useToast();
  const [editing, setEditing] = useState<DiscountCode | 'new' | 'company' | null>(null);
  const [deleting, setDeleting] = useState<DiscountCode | null>(null);
  const codes = db.discountCodes();
  const count = (s: ReturnType<typeof db.discountStatus>) => codes.filter((c) => db.discountStatus(c) === s).length;
  const totalUses = codes.reduce((s, c) => s + c.usedCount, 0);

  const copy = async (text: string) => {
    try { await navigator.clipboard.writeText(text); toast.success('تم نسخ الكود.'); } catch { toast.error('تعذّر النسخ.'); }
  };

  return (
    <div className="page">
      <div className="page-head">
        <div><h1>أكواد الخصم</h1><p>أنشئ أكواد خصم بمدة صلاحية وعدد مرات استخدام محدد، وطبّقها على الفواتير.</p></div>
        <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
          <Button icon="receipt" onClick={() => setEditing('new')}>إنشاء كود خصم</Button>
          <Button variant="outline" icon="receipt" onClick={() => setEditing('company')}>إنشاء كود خصم شركات</Button>
        </div>
      </div>

      {loading ? <Skeleton h={90} /> : (
        <div className="kpi-grid">
          <StatCard icon="checkCircle" tone="ok" value={count('active')} label="أكواد سارية" />
          <StatCard icon="clock" tone="info" value={count('scheduled')} label="لم تبدأ بعد" />
          <StatCard icon="alert" tone="warn" value={count('expired') + count('used_up')} label="منتهية أو مستهلكة" />
          <StatCard icon="trend" tone="brand" value={totalUses} label="إجمالي مرات الاستخدام" />
        </div>
      )}

      {codes.length === 0 ? (
        <div className="card"><div className="card__body">
          <EmptyState icon="receipt" title="ما فيه أكواد خصم بعد" text="أنشئ كودًا وحدد مدته وعدد مرات استخدامه."
            action={<Button icon="receipt" onClick={() => setEditing('new')}>إنشاء كود خصم</Button>} />
        </div></div>
      ) : (
        <div className="dc-grid">
          {codes.map((c) => {
            const st = STATUS[db.discountStatus(c)];
            const company = isCompanyCode(c);
            const pct = company ? 0 : Math.min(100, Math.round((c.usedCount / c.maxUses) * 100));
            return (
              <article key={c.id} className="card dc-card">
                <div className="dc-card__head">
                  <button type="button" className="dc-card__code" dir="ltr" onClick={() => copy(c.code)} title="نسخ الكود">{c.code}</button>
                  <StatusBadge label={st.label} tone={st.tone} />
                </div>
                <div className="dc-card__value num">{discountLabel(c)}<span> خصم</span></div>
                {c.note && <p className="muted" style={{ fontSize: 13 }}>{c.note}</p>}
                {!!c.minAmount && <p className="muted" style={{ fontSize: 12.5 }}>الحد الأدنى للطلب: <span className="num">{money(c.minAmount)}</span></p>}
                <div>
                  <div className="row-between" style={{ fontSize: 12.5, marginBottom: 5 }}>
                    <span className="muted">الاستخدام</span>
                    <strong className="num">{company ? `${c.usedCount} / بدون حد` : `${c.usedCount} / ${c.maxUses}`}</strong>
                  </div>
                  <div className="progress"><i style={{ width: `${pct}%` }} /></div>
                </div>
                <dl className="plan-card__facts">
                  <div><dt>من</dt><dd>{fmtDate(c.validFrom)}</dd></div>
                  <div><dt>إلى</dt><dd>{company ? 'بدون مدة' : fmtDate(c.validTo)}</dd></div>
                </dl>
                <footer className="plan-card__foot">
                  <Button size="sm" variant="outline" icon="doc" onClick={() => copy(c.code)}>نسخ</Button>
                  <span style={{ flex: 1 }} />
                  {can('discounts', 'edit') && <IconAction icon="edit" label="تعديل" onClick={() => setEditing(c)} />}
                  {can('discounts', 'delete') && <IconAction icon="trash" label="حذف" danger onClick={() => setDeleting(c)} />}
                </footer>
              </article>
            );
          })}
        </div>
      )}

      {editing === 'company' && <CompanyModal onClose={() => setEditing(null)} />}
      {editing && editing !== 'company' && (editing !== 'new' && isCompanyCode(editing)
        ? <CompanyModal code={editing} onClose={() => setEditing(null)} />
        : <CodeModal code={editing === 'new' ? undefined : editing} onClose={() => setEditing(null)} />)}
      {deleting && <ConfirmDialog title="حذف كود الخصم" onClose={() => setDeleting(null)}
        message={`سيتم حذف الكود ${deleting.code} نهائيًا.`}
        onConfirm={async () => { const r = await db.deleteDiscountCode(deleting.id); if (r.ok) toast.success('تم حذف الكود.'); else toast.error(r.error); }} />}
    </div>
  );
}
