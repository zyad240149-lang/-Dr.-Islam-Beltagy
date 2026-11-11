// «المخزون»: أصناف العيادة (مستلزمات / جبس / أدوات) وكمياتها وحركاتها — فوق جداول inventory_items / stock_movements
// ودوال الخادم save_item / add_stock_movement / delete_item (الصلاحيات والتحقق من الكمية على الخادم: مفيش صرف أكتر من المتاح).
import { useState } from 'react';
import { db } from '../data/db';
import { useDbVersion, useLoading } from '../hooks/useDb';
import { Button, EmptyState, Input, Modal, Select, Skeleton, StatusBadge } from '../components/ui';
import { ConfirmDialog, FilterBar, IconAction, RowActions, useCan } from '../components/common';
import { useToast } from '../hooks/useToast';
import { PhoneInput } from '../components/PhoneInput';
import { fmtDateTime, money, todayYmd, waPhone } from '../utils/format';
import type { InventoryItem, StockMovementType } from '../types';

const MOVE_LABEL: Record<StockMovementType, string> = { purchase: 'شراء / توريد', issue: 'صرف', adjust_in: 'تسوية بالزيادة', adjust_out: 'تسوية بالنقص' };
const IN_TYPES: StockMovementType[] = ['purchase', 'adjust_in'];
const low = (it: InventoryItem) => it.active && it.quantity <= it.minQuantity;

export default function Inventory() {
  useDbVersion();
  const loading = useLoading();
  const toast = useToast();
  const can = useCan();
  const [q, setQ] = useState('');
  const [state, setState] = useState('');
  const [editing, setEditing] = useState<InventoryItem | 'new' | null>(null);
  const [moving, setMoving] = useState<{ item: InventoryItem; type: StockMovementType } | null>(null);
  const [history, setHistory] = useState<InventoryItem | null>(null);
  const [deleting, setDeleting] = useState<InventoryItem | null>(null);
  const [reporting, setReporting] = useState(false);
  const all = db.inventory();
  const term = q.trim();
  const items = all
    .filter((it) => !term || it.name.includes(term) || it.category.includes(term) || it.sku.toLowerCase().includes(term.toLowerCase()) || it.supplier.includes(term))
    .filter((it) => !state || (state === 'low' ? low(it) : state === 'on' ? it.active : !it.active))
    .sort((a, b) => Number(low(b)) - Number(low(a)) || a.name.localeCompare(b.name, 'ar'));
  const lowCount = all.filter(low).length;
  const value = all.filter((it) => it.active).reduce((s, it) => s + it.quantity * it.costPrice, 0);

  return (
    <div className="page">
      <div className="page-head">
        <div><h1>المخزون</h1><p>{all.length} صنف{lowCount > 0 ? ` — ${lowCount} وصل للحد الأدنى` : ''} · قيمة المخزون بسعر التكلفة {money(value)}</p></div>
        <div className="row-actions">
          <Button variant="outline" icon="list" onClick={() => setReporting(true)}>تقرير المخزون</Button>
          {can('inventory', 'create') && <Button icon="plus" onClick={() => setEditing('new')}>إضافة صنف</Button>}
        </div>
      </div>

      {/* تنبيه الحد الأدنى (964): الأصناف اللي رصيدها وصل للحد الأدنى أو أقل */}
      {lowCount > 0 && (
        <div className="alert alert-warn inv-low" role="alert" data-testid="inv-low">
          <strong>تنبيه: {lowCount} صنف رصيده عند الحد الأدنى أو أقل —</strong>
          {all.filter(low).map((it) => <span key={it.id}>{it.name} (<span className="num">{it.quantity}</span> {it.unit} من <span className="num">{it.minQuantity}</span>)</span>)}
          <span className="muted-sm">الشراء من «الفواتير والمدفوعات ← المصروفات ← مستلزمات طبية» بيسجّل المصروف ويزوّد الكمية مع بعض.</span>
        </div>
      )}

      <div className="card" style={{ marginBottom: 14 }}>
        <FilterBar>
          <Input id="inv-q" label="بحث" icon="search" placeholder="اسم الصنف أو الفئة أو الكود أو المورّد" value={q} onChange={(e) => setQ(e.target.value)} />
          <Select id="inv-state" label="الحالة" value={state} onChange={(e) => setState(e.target.value)}
            options={[{ value: '', label: 'الكل' }, { value: 'low', label: 'وصل للحد الأدنى' }, { value: 'on', label: 'مفعّل' }, { value: 'off', label: 'متوقف' }]} />
        </FilterBar>
      </div>

      <div className="card">
        {loading ? <div className="card__body"><Skeleton h={160} /></div> : items.length === 0 ? (
          <div className="card__body"><EmptyState icon="box" title={all.length ? 'مفيش صنف مطابق' : 'لسه مفيش أصناف في المخزون'} text={all.length ? undefined : 'ضيف أول صنف (جبس، شاش، رباط ضاغط…) وكميته الحالية.'} /></div>
        ) : (
          <div className="table-wrap">
            <table className="table">
              <thead><tr><th>الصنف</th><th>الفئة</th><th>الكمية</th><th>الحد الأدنى</th><th>سعر التكلفة</th><th>المورّد</th><th>الحالة</th><th></th></tr></thead>
              <tbody>
                {items.map((it) => (
                  <tr key={it.id}>
                    <td><strong>{it.name}</strong><div className="muted-sm num" dir="ltr" style={{ textAlign: 'start' }}>{it.sku}</div></td>
                    <td>{it.category || '—'}</td>
                    <td className="num"><strong>{it.quantity}</strong> {it.unit}</td>
                    <td className="num">{it.minQuantity}</td>
                    <td className="num">{money(it.costPrice)}</td>
                    <td>
                      {it.supplier || (it.supplierPhone || it.supplierUrl ? '' : '—')}
                      {it.supplierPhone && <div className="muted-sm"><a href={`tel:${it.supplierPhone}`} dir="ltr" className="num">{it.supplierPhone}</a> · <a href={`https://wa.me/${waPhone(it.supplierPhone)}`} target="_blank" rel="noopener noreferrer">واتساب</a></div>}
                      {/^https?:\/\//i.test(it.supplierUrl) && <div className="muted-sm"><a href={it.supplierUrl} target="_blank" rel="noopener noreferrer">فتح اللينك</a></div>}
                    </td>
                    <td>{!it.active ? <StatusBadge label="متوقف" tone="muted" /> : low(it) ? <StatusBadge label="وصل للحد الأدنى" tone="warn" /> : <StatusBadge label="متوفر" tone="ok" />}</td>
                    <td className="actions">
                      <RowActions>
                        {can('inventory', 'edit') && <Button size="sm" variant="outline" icon="refresh" onClick={() => setMoving({ item: it, type: 'purchase' })}>حركة (توريد / صرف)</Button>}
                        {can('inventory', 'edit') && <Button size="sm" variant="outline" icon="box" onClick={() => setMoving({ item: it, type: 'issue' })}>صرف / استخدام</Button>}
                        <IconAction icon="list" label="سجل الحركات" onClick={() => setHistory(it)} />
                        {can('inventory', 'edit') && <IconAction icon="edit" label="تعديل" onClick={() => setEditing(it)} />}
                        {can('inventory', 'delete') && <IconAction icon="trash" label="حذف" danger onClick={() => setDeleting(it)} />}
                      </RowActions>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {editing && <ItemModal item={editing === 'new' ? null : editing} onClose={() => setEditing(null)} />}
      {moving && <MoveModal item={moving.item} initialType={moving.type} onClose={() => setMoving(null)} />}
      {history && <HistoryModal item={history} onClose={() => setHistory(null)} />}
      {reporting && <ReportModal onClose={() => setReporting(false)} />}
      {deleting && (
        <ConfirmDialog title="حذف صنف" message={<>حذف «{deleting.name}»؟ الصنف اللي ليه حركات صرف أو توريد مش هيتمسح عشان السجل يفضل، وخليه «متوقف» بدل الحذف.</>}
          onClose={() => setDeleting(null)}
          onConfirm={async () => { try { await db.deleteItem(deleting.id); toast.success('تم حذف الصنف.'); setDeleting(null); } catch (e) { toast.error((e as Error).message); } }} />
      )}
    </div>
  );
}

function ItemModal({ item, onClose }: { item: InventoryItem | null; onClose: () => void }) {
  const toast = useToast();
  const [f, setF] = useState(() => ({
    sku: item?.sku ?? '', name: item?.name ?? '', category: item?.category ?? '', unit: item?.unit ?? 'قطعة', quantity: '0',
    minQuantity: String(item?.minQuantity ?? 0), costPrice: String(item?.costPrice ?? 0), salePrice: String(item?.salePrice ?? 0),
    supplier: item?.supplier ?? '', supplierPhone: item?.supplierPhone ?? '', supplierUrl: item?.supplierUrl ?? '', active: item?.active ?? true,
  }));
  const [busy, setBusy] = useState(false);
  const [phoneErr, setPhoneErr] = useState(false);
  const [tried, setTried] = useState(false);
  const url = (() => { const u = f.supplierUrl.trim(); return !u || /^https?:\/\//i.test(u) ? u : `https://${u}`; })();
  const urlOk = !url || URL.canParse(url);
  const set = (k: keyof typeof f, v: string | boolean) => setF((x) => ({ ...x, [k]: v }));
  const num = (v: string) => Number(v.replace(/[^\d.]/g, '')) || 0;
  const save = async () => {
    setTried(true);
    if (!f.name.trim()) { toast.error('اسم الصنف مطلوب.'); return; }
    if (phoneErr) { toast.error('رقم المورّد مش صحيح.'); return; }
    if (!urlOk) { toast.error('لينك المورّد مش صحيح.'); return; }
    setBusy(true);
    const r = await db.saveItem({
      ...(item ? { id: item.id } : { quantity: num(f.quantity) }),
      sku: f.sku.trim(), name: f.name.trim(), category: f.category.trim(), unit: f.unit.trim() || 'قطعة',
      minQuantity: num(f.minQuantity), costPrice: num(f.costPrice), salePrice: num(f.salePrice), supplier: f.supplier.trim(), supplierPhone: f.supplierPhone, supplierUrl: url, active: f.active,
    });
    setBusy(false);
    if (!r.ok) { toast.error(r.error); return; }
    toast.success(item ? 'تم حفظ الصنف.' : 'تم إضافة الصنف.');
    onClose();
  };
  return (
    <Modal wide title={item ? 'تعديل صنف' : 'إضافة صنف'} onClose={onClose}
      footer={<><Button variant="outline" onClick={onClose} disabled={busy}>إلغاء</Button><Button icon="check" onClick={() => void save()} loading={busy}>حفظ</Button></>}>
      <section className="form-section" style={{ borderBottom: 0, paddingBottom: 0 }}>
        <h4 className="form-section-title">بيانات الصنف</h4>
        <div className="grid-form">
          <Input id="it-name" label="اسم الصنف *" value={f.name} onChange={(e) => set('name', e.target.value)} />
          <Input id="it-sku" label="كود الصنف" dir="ltr" placeholder="يتولد تلقائي لو فاضي" value={f.sku} onChange={(e) => set('sku', e.target.value)} />
          <Input id="it-cat" label="الفئة" placeholder="مستلزمات / جبس / أدوات" value={f.category} onChange={(e) => set('category', e.target.value)} />
          <Select id="it-active" label="الحالة" value={f.active ? 'on' : 'off'} onChange={(e) => set('active', e.target.value === 'on')} options={[{ value: 'on', label: 'مفعّل' }, { value: 'off', label: 'متوقف' }]} />
        </div>
      </section>
      <section className="form-section" style={{ borderBottom: 0, paddingBottom: 0 }}>
        <h4 className="form-section-title">الكمية</h4>
        <div className="grid-form">
          <Input id="it-unit" label="الوحدة" value={f.unit} onChange={(e) => set('unit', e.target.value)} />
          {!item && <Input id="it-qty" label="الكمية الحالية" inputMode="decimal" value={f.quantity} onChange={(e) => set('quantity', e.target.value)} />}
          <Input id="it-min" label="الحد الأدنى (تنبيه)" inputMode="decimal" value={f.minQuantity} onChange={(e) => set('minQuantity', e.target.value)} />
        </div>
      </section>
      {/* ١١/١١: قسم «الأسعار» اتشال — السعر بيتكتب لما الشراء يتسجل من «المصروفات ← مستلزمات طبية» (القيم القديمة بتفضل زي ما هي) */}
      <section className="form-section" style={{ borderBottom: 0, paddingBottom: 0 }}>
        <h4 className="form-section-title">المورّد</h4>
        <div className="grid-form">
          <Input id="it-sup" label="اسم المورّد" value={f.supplier} onChange={(e) => set('supplier', e.target.value)} />
          <PhoneInput id="it-sup-phone" label="رقم المورّد" required={false} showError={tried} value={f.supplierPhone} onChange={(v, err) => { setPhoneErr(!!err); if (v !== f.supplierPhone) set('supplierPhone', v); }} />
          <Input id="it-sup-url" label="لينك المورّد" dir="ltr" placeholder="https://example.com" value={f.supplierUrl} onChange={(e) => set('supplierUrl', e.target.value)} error={tried && !urlOk ? 'اللينك مش صحيح.' : undefined} />
        </div>
      </section>
      {item && <p className="muted-sm" style={{ marginBottom: 0 }}>الكمية بتتغيّر من «حركة (توريد / صرف)» بس — عشان كل تغيير يتسجّل.</p>}
    </Modal>
  );
}

function MoveModal({ item, initialType = 'purchase', onClose }: { item: InventoryItem; initialType?: StockMovementType; onClose: () => void }) {
  const toast = useToast();
  const [type, setType] = useState<StockMovementType>(initialType);
  const [qty, setQty] = useState('');
  const [cost, setCost] = useState(String(item.costPrice || ''));
  const [reference, setReference] = useState('');
  const [note, setNote] = useState('');
  const [busy, setBusy] = useState(false);
  const [overdraw, setOverdraw] = useState(false);
  const [moveKey] = useState(() => crypto.randomUUID()); // الضغط مرتين على «تسجيل» مابيخصمش مرتين
  const canOverdraw = useCan()('inv_overdraw', 'view');
  const n = Number(qty.replace(/[^\d.]/g, '')) || 0;
  const out = !IN_TYPES.includes(type);
  const after = item.quantity + (out ? -n : n);
  const save = async () => {
    if (n <= 0) { toast.error('اكتب كمية أكبر من صفر.'); return; }
    if (out && n > item.quantity && !overdraw) { toast.error(`المتاح ${item.quantity} ${item.unit} بس.`); return; }
    if (out && !reference.trim() && !note.trim()) { toast.error('اكتب سبب الصرف.'); return; }
    setBusy(true);
    const r = await db.addStockMovement({ itemId: item.id, type, quantity: n, unitCost: Number(cost) || 0, reference: reference.trim(), note: note.trim(), overdraw: out && n > item.quantity && overdraw, key: moveKey });
    setBusy(false);
    if (!r.ok) { toast.error(r.error); return; }
    toast.success(`تم تسجيل الحركة — الرصيد دلوقتي ${r.balance} ${item.unit}`);
    // الصرف نزّل الرصيد للحد الأدنى أو أقل ← تنبيه (والخادم بيبعت إشعار للموظفين)
    if (out && r.low) toast.error(`تنبيه: رصيد «${item.name}» (${r.balance} ${item.unit}) وصل للحد الأدنى (${item.minQuantity}) — اطلب كمية جديدة.`);
    onClose();
  };
  return (
    <Modal title={`حركة مخزون — ${item.name}`} onClose={onClose}
      footer={<><Button variant="outline" onClick={onClose} disabled={busy}>إلغاء</Button><Button icon="check" onClick={() => void save()} loading={busy} disabled={n <= 0}>تسجيل</Button></>}>
      <p style={{ marginTop: 0 }}>المتاح الآن: <strong className="num">{item.quantity}</strong> {item.unit}</p>
      <div className="grid-form">
        <Select id="mv-type" label="نوع الحركة" value={type} onChange={(e) => setType(e.target.value as StockMovementType)} options={(Object.keys(MOVE_LABEL) as StockMovementType[]).map((k) => ({ value: k, label: MOVE_LABEL[k] }))} />
        <Input id="mv-qty" label={`الكمية (${item.unit})`} inputMode="decimal" value={qty} onChange={(e) => setQty(e.target.value)} />
        {type === 'purchase' && <Input id="mv-cost" label="سعر الوحدة (شراء)" inputMode="decimal" value={cost} onChange={(e) => setCost(e.target.value)} />}
        <Input id="mv-ref" label={out ? 'صرف لمين / السبب' : 'رقم فاتورة الشراء / المورّد'} value={reference} onChange={(e) => setReference(e.target.value)} />
        <Input id="mv-note" label="ملاحظة" value={note} onChange={(e) => setNote(e.target.value)} />
      </div>
      {out && n > item.quantity && canOverdraw && (
        <label style={{ display: 'flex', gap: 8, alignItems: 'center', marginTop: 8 }}><input type="checkbox" checked={overdraw} onChange={(e) => setOverdraw(e.target.checked)} />صرف أكبر من المتاح (الرصيد هيبقى بالسالب)</label>
      )}
      {n > 0 && <p className={after < 0 ? 'alert alert-danger' : out && after <= item.minQuantity ? 'alert alert-warn' : 'muted-sm'} style={{ marginBottom: 0 }}>بعد الحركة: <strong className="num">{after}</strong> {item.unit}{out && after <= item.minQuantity && after >= 0 ? ` — أقل من أو عند الحد الأدنى (${item.minQuantity})` : ''}</p>}
      {type === 'purchase' && <p className="muted-sm" style={{ marginBottom: 0 }}>شراء مدفوع من العيادة؟ سجّله من «المصروفات ← مستلزمات طبية» عشان المصروف والكمية يتسجلوا مع بعض.</p>}
    </Modal>
  );
}

function ReportModal({ onClose }: { onClose: () => void }) {
  const toast = useToast();
  const [from, setFrom] = useState(() => todayYmd().slice(0, 8) + '01');
  const [to, setTo] = useState(todayYmd);
  const [busy, setBusy] = useState(false);
  const [data, setData] = useState<Awaited<ReturnType<typeof db.inventoryReport>> | null>(null);
  const load = async () => {
    setBusy(true);
    try { setData(await db.inventoryReport(from, to)); } catch (e) { toast.error((e as Error).message); } finally { setBusy(false); }
  };
  return (
    <Modal wide title="تقرير المخزون" onClose={onClose} footer={<Button variant="outline" onClick={onClose}>إغلاق</Button>}>
      <FilterBar>
        <Input id="rp-from" label="من" type="date" value={from} onChange={(e) => setFrom(e.target.value)} />
        <Input id="rp-to" label="إلى" type="date" value={to} onChange={(e) => setTo(e.target.value)} />
        <Button loading={busy} onClick={() => void load()}>عرض</Button>
      </FilterBar>
      {data && (
        <>
          <p>قيمة الأصناف المفعّلة في آخر الفترة: <strong className="num">{money(data.totalValue)}</strong></p>
          <div className="table-wrap"><table className="table">
            <thead><tr><th>الكود</th><th>الصنف</th><th>أول الفترة</th><th>وارد</th><th>منصرف</th><th>آخر الفترة</th><th>القيمة</th></tr></thead>
            <tbody>{data.rows.map((r) => <tr key={r.id}><td className="num" dir="ltr">{r.sku}</td><td>{r.name}{r.low && <> <StatusBadge label="وصل للحد الأدنى" tone="warn" /></>}</td><td className="num">{r.opening}</td><td className="num">{r.in}</td><td className="num">{r.out}</td><td className="num">{r.closing} {r.unit}</td><td className="num">{money(r.value)}</td></tr>)}</tbody>
          </table></div>
        </>
      )}
    </Modal>
  );
}

function HistoryModal({ item, onClose }: { item: InventoryItem; onClose: () => void }) {
  useDbVersion();
  const moves = db.stockMovements().filter((m) => m.itemId === item.id);
  return (
    <Modal wide title={`سجل حركات — ${item.name}`} onClose={onClose} footer={<Button variant="outline" onClick={onClose}>إغلاق</Button>}>
      {moves.length === 0 ? <EmptyState icon="list" title="مفيش حركات للصنف ده" /> : (
        <div className="table-wrap">
          <table className="table">
            <thead><tr><th>التاريخ</th><th>النوع</th><th>الكمية</th><th>الرصيد بعدها</th><th>سعر الوحدة</th><th>المرجع</th><th>بواسطة</th><th>ملاحظة</th></tr></thead>
            <tbody>
              {moves.map((m) => (
                <tr key={m.id}>
                  <td className="num">{fmtDateTime(m.date)}</td>
                  <td>{MOVE_LABEL[m.type]}{m.expenseId && <> <span className="badge badge--info" title="حركة مربوطة بمصروف «مستلزمات طبية»">من مصروف</span></>}</td>
                  <td className="num" style={{ color: IN_TYPES.includes(m.type) ? 'var(--ok)' : 'var(--danger)' }}>{IN_TYPES.includes(m.type) ? '+' : '−'}{m.quantity} {item.unit}</td>
                  <td className="num">{m.balanceAfter ?? '—'}</td>
                  <td className="num">{m.unitCost ? money(m.unitCost) : '—'}</td>
                  <td>{m.reference || '—'}</td>
                  <td>{m.employeeId ? db.employees().find((e) => e.id === m.employeeId)?.name ?? '—' : '—'}</td>
                  <td>{m.note || '—'}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </Modal>
  );
}
