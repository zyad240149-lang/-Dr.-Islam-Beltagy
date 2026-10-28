// «المخزون»: أصناف العيادة (مستلزمات / جبس / أدوات) وكمياتها وحركاتها — فوق جداول inventory_items / stock_movements
// ودوال الخادم save_item / add_stock_movement / delete_item (الصلاحيات والتحقق من الكمية على الخادم: مفيش صرف أكتر من المتاح).
import { useState } from 'react';
import { db } from '../data/db';
import { useDbVersion, useLoading } from '../hooks/useDb';
import { Button, EmptyState, Input, Modal, Select, Skeleton, StatusBadge } from '../components/ui';
import { ConfirmDialog, FilterBar, IconAction, RowActions, useCan } from '../components/common';
import { useToast } from '../hooks/useToast';
import { fmtDateTime, money } from '../utils/format';
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
  const [moving, setMoving] = useState<InventoryItem | null>(null);
  const [history, setHistory] = useState<InventoryItem | null>(null);
  const [deleting, setDeleting] = useState<InventoryItem | null>(null);
  const all = db.inventory();
  const term = q.trim();
  const items = all
    .filter((it) => !term || it.name.includes(term) || it.category.includes(term) || it.sku.toLowerCase().includes(term.toLowerCase()) || it.supplier.includes(term))
    .filter((it) => !state || (state === 'low' ? low(it) : state === 'on' ? it.active : !it.active))
    .sort((a, b) => Number(low(b)) - Number(low(a)) || a.name.localeCompare(b.name, 'ar'));
  const lowCount = all.filter(low).length;
  const value = all.filter((it) => it.active).reduce((s, it) => s + it.quantity * it.costPrice, 0);

  return (
    <>
      <div className="page-head">
        <div><h1>المخزون</h1><p>{all.length} صنف{lowCount > 0 ? ` — ${lowCount} وصل للحد الأدنى` : ''} · قيمة المخزون بسعر التكلفة {money(value)}</p></div>
        {can('inventory', 'create') && <Button icon="plus" onClick={() => setEditing('new')}>إضافة صنف</Button>}
      </div>

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
                    <td>{it.supplier || '—'}</td>
                    <td>{!it.active ? <StatusBadge label="متوقف" tone="muted" /> : low(it) ? <StatusBadge label="وصل للحد الأدنى" tone="warn" /> : <StatusBadge label="متوفر" tone="ok" />}</td>
                    <td className="actions">
                      <RowActions>
                        {can('inventory', 'edit') && <Button size="sm" variant="outline" icon="refresh" onClick={() => setMoving(it)}>حركة (توريد / صرف)</Button>}
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
      {moving && <MoveModal item={moving} onClose={() => setMoving(null)} />}
      {history && <HistoryModal item={history} onClose={() => setHistory(null)} />}
      {deleting && (
        <ConfirmDialog title="حذف صنف" message={<>حذف «{deleting.name}» وسجل حركاته؟ لو الصنف مستخدم ومش عايز تمسح تاريخه، خليه «متوقف» بدل الحذف.</>}
          onClose={() => setDeleting(null)}
          onConfirm={async () => { try { await db.deleteItem(deleting.id); toast.success('تم حذف الصنف.'); setDeleting(null); } catch (e) { toast.error((e as Error).message); } }} />
      )}
    </>
  );
}

function ItemModal({ item, onClose }: { item: InventoryItem | null; onClose: () => void }) {
  const toast = useToast();
  const [f, setF] = useState(() => ({
    name: item?.name ?? '', category: item?.category ?? '', unit: item?.unit ?? 'قطعة', quantity: '0',
    minQuantity: String(item?.minQuantity ?? 0), costPrice: String(item?.costPrice ?? 0), salePrice: String(item?.salePrice ?? 0),
    supplier: item?.supplier ?? '', active: item?.active ?? true,
  }));
  const [busy, setBusy] = useState(false);
  const set = (k: keyof typeof f, v: string | boolean) => setF((x) => ({ ...x, [k]: v }));
  const num = (v: string) => Number(v.replace(/[^\d.]/g, '')) || 0;
  const save = async () => {
    if (!f.name.trim()) { toast.error('اسم الصنف مطلوب.'); return; }
    setBusy(true);
    const r = await db.saveItem({
      ...(item ? { id: item.id } : { quantity: num(f.quantity) }),
      name: f.name.trim(), category: f.category.trim(), unit: f.unit.trim() || 'قطعة',
      minQuantity: num(f.minQuantity), costPrice: num(f.costPrice), salePrice: num(f.salePrice), supplier: f.supplier.trim(), active: f.active,
    });
    setBusy(false);
    if (!r.ok) { toast.error(r.error); return; }
    toast.success(item ? 'تم حفظ الصنف.' : 'تم إضافة الصنف.');
    onClose();
  };
  return (
    <Modal title={item ? 'تعديل صنف' : 'إضافة صنف'} onClose={onClose}
      footer={<><Button variant="outline" onClick={onClose} disabled={busy}>إلغاء</Button><Button icon="check" onClick={() => void save()} loading={busy}>حفظ</Button></>}>
      <div className="grid-form">
        <Input id="it-name" label="اسم الصنف *" value={f.name} onChange={(e) => set('name', e.target.value)} />
        <Input id="it-cat" label="الفئة" placeholder="مستلزمات / جبس / أدوات" value={f.category} onChange={(e) => set('category', e.target.value)} />
        <Input id="it-unit" label="الوحدة" value={f.unit} onChange={(e) => set('unit', e.target.value)} />
        {!item && <Input id="it-qty" label="الكمية الحالية" inputMode="decimal" value={f.quantity} onChange={(e) => set('quantity', e.target.value)} />}
        <Input id="it-min" label="الحد الأدنى (تنبيه)" inputMode="decimal" value={f.minQuantity} onChange={(e) => set('minQuantity', e.target.value)} />
        <Input id="it-cost" label="سعر التكلفة" inputMode="decimal" value={f.costPrice} onChange={(e) => set('costPrice', e.target.value)} />
        <Input id="it-sale" label="سعر البيع (لو بيتباع)" inputMode="decimal" value={f.salePrice} onChange={(e) => set('salePrice', e.target.value)} />
        <Input id="it-sup" label="المورّد" value={f.supplier} onChange={(e) => set('supplier', e.target.value)} />
        <Select id="it-active" label="الحالة" value={f.active ? 'on' : 'off'} onChange={(e) => set('active', e.target.value === 'on')} options={[{ value: 'on', label: 'مفعّل' }, { value: 'off', label: 'متوقف' }]} />
      </div>
      {item && <p className="muted-sm" style={{ marginBottom: 0 }}>الكمية بتتغيّر من «حركة (توريد / صرف)» بس — عشان كل تغيير يتسجّل.</p>}
    </Modal>
  );
}

function MoveModal({ item, onClose }: { item: InventoryItem; onClose: () => void }) {
  const toast = useToast();
  const [type, setType] = useState<StockMovementType>('purchase');
  const [qty, setQty] = useState('');
  const [cost, setCost] = useState(String(item.costPrice || ''));
  const [reference, setReference] = useState('');
  const [note, setNote] = useState('');
  const [busy, setBusy] = useState(false);
  const n = Number(qty.replace(/[^\d.]/g, '')) || 0;
  const out = !IN_TYPES.includes(type);
  const after = item.quantity + (out ? -n : n);
  const save = async () => {
    if (n <= 0) { toast.error('اكتب كمية أكبر من صفر.'); return; }
    if (out && n > item.quantity) { toast.error(`المتاح ${item.quantity} ${item.unit} بس.`); return; }
    setBusy(true);
    const r = await db.addStockMovement({ itemId: item.id, type, quantity: n, unitCost: Number(cost) || 0, reference: reference.trim(), note: note.trim() });
    setBusy(false);
    if (!r.ok) { toast.error(r.error); return; }
    toast.success('تم تسجيل الحركة.');
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
      {n > 0 && <p className={after < 0 ? 'alert alert-danger' : 'muted-sm'} style={{ marginBottom: 0 }}>بعد الحركة: <strong className="num">{after}</strong> {item.unit}</p>}
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
            <thead><tr><th>التاريخ</th><th>النوع</th><th>الكمية</th><th>سعر الوحدة</th><th>المرجع</th><th>بواسطة</th><th>ملاحظة</th></tr></thead>
            <tbody>
              {moves.map((m) => (
                <tr key={m.id}>
                  <td className="num">{fmtDateTime(m.date)}</td>
                  <td>{MOVE_LABEL[m.type]}</td>
                  <td className="num" style={{ color: IN_TYPES.includes(m.type) ? 'var(--ok)' : 'var(--danger)' }}>{IN_TYPES.includes(m.type) ? '+' : '−'}{m.quantity} {item.unit}</td>
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
