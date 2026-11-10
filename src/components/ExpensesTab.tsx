// تبويب «المصروفات» في الفواتير والمدفوعات: تسجيل مصروفات العيادة (إيجار، كهرباء، مستلزمات…) بنفس اختيار الفترة، والصافي = المحصّل − المصروفات.
// القراءة بصلاحية financial/view، والحفظ والحذف عن طريق save_expense و delete_expense على الخادم.
// «مستلزمات طبية» (هجرة 964): اختيار منتج من المخزون + الكمية + سعر الوحدة ← الإجمالي محسوب، والحفظ = save_supply_expense:
// المصروف + زيادة الكمية في المخزون + حركة توريد مربوطة بالمصروف في عملية واحدة على الخادم، بمفتاح عملية يمنع التسجيل مرتين.
// تعديل المصروف المربوط = حركة تسوية بالفرق، وحذفه = الكمية بترجع من المخزون (ولو اتصرف منها الحذف بيترفض).
import { useCallback, useEffect, useState } from 'react';
import { supabase } from '../lib/supabase';
import { fetchKeyset } from '../data/download';
import { db } from '../data/db';
import { net } from '../offline/net';
import { useDbVersion } from '../hooks/useDb';
import { useToast } from '../hooks/useToast';
import { Button, EmptyState, Input, Modal, Select, Skeleton } from './ui';
import { ConfirmDialog, FilterBar, IconAction, useCan } from './common';
import { StatCard } from './StatCard';
import { ALL_PERIOD, PeriodFilter, type Period } from './PeriodFilter';
import { PAYMENT_METHOD_LABEL, PAYMENT_METHOD_OPTIONS, exportCsv, fmtDate, money, todayYmd, tsToYmd } from '../utils/format';

interface Expense { id: string; category: string; amount: number; description: string; expense_date: string; payment_method: string; inventory_item_id?: string | null; quantity?: number | null; unit_price?: number | null }
interface Draft { id?: string; category: string; amount: string; description: string; date: string; method: string; itemId?: string; quantity?: string; unitPrice?: string; linked?: boolean }

export const SUPPLY_CATEGORY = 'مستلزمات طبية';
const DEFAULT_CATEGORIES = ['إيجار', 'كهرباء ومياه', 'إنترنت وتليفون', SUPPLY_CATEGORY, 'أدوات مكتبية', 'صيانة', 'نظافة', 'تسويق', 'انتقالات', 'نثريات'];
const NEW_CATEGORY = '__new_category__';
const OFFLINE = 'تسجيل المصروفات محتاج اتصال بالإنترنت — جرّب لما النت يرجع.';
const methodLabel = (m: string) => PAYMENT_METHOD_LABEL[m] ?? m;
const toNum = (v?: string) => Number(String(v ?? '').replace(/[٠-٩]/g, (d) => String(d.charCodeAt(0) - 0x660)).replace(/[^\d.]/g, '')) || 0;

function ExpenseModal({ initial, categories, onClose, onSaved }: { initial: Draft; categories: string[]; onClose: () => void; onSaved: () => void }) {
  useDbVersion();
  const toast = useToast();
  const can = useCan();
  const [f, setF] = useState<Draft>(initial);
  const [newCat, setNewCat] = useState(false);
  const [busy, setBusy] = useState(false);
  // مفتاح العملية ثابت طول ما النافذة مفتوحة: ضغطتين أو إعادة المحاولة بعد قطع النت مابيسجّلوش مرتين
  const [key] = useState(() => crypto.randomUUID());
  const set = (k: keyof Draft, v: string | boolean) => setF((x) => ({ ...x, [k]: v }));
  // ربط المخزون: «مستلزمات طبية» + صلاحية «المخزون: تعديل» (والمصروف المربوط قبل كده بيفضل مربوط)
  const canStock = can('inventory', 'edit');
  const wasLinked = !!initial.id && !!initial.itemId;
  const supply = f.category === SUPPLY_CATEGORY && (wasLinked || (canStock && f.linked !== false));
  const items = db.inventory().filter((it) => it.active || it.id === f.itemId).sort((a, b) => a.name.localeCompare(b.name, 'ar'));
  const item = items.find((it) => it.id === f.itemId);
  const qty = toNum(f.quantity), price = toNum(f.unitPrice);
  const total = Math.round(qty * price * 100) / 100;
  const ok = !!f.category.trim() && !!f.date && (supply ? !!item && qty > 0 && total > 0 : toNum(f.amount) > 0);
  const after = item ? item.quantity + (wasLinked && initial.itemId === item.id ? qty - toNum(initial.quantity) : qty) : 0;

  const save = async () => {
    if (!net.isOnline()) { toast.error(OFFLINE); return; }
    if (wasLinked && !canStock) { toast.error('تعديل مصروف المستلزمات محتاج صلاحية «المخزون: تعديل».'); return; }
    setBusy(true);
    try {
      if (supply) {
        const r = await db.saveSupplyExpense({ ...(f.id ? { id: f.id } : {}), key, itemId: f.itemId!, quantity: qty, unitPrice: price, purchaseDate: f.date, description: f.description.trim(), paymentMethod: f.method });
        if (!r.ok) { toast.error(r.error); return; }
        const d = r.data;
        toast.success(d.duplicate ? 'المصروف ده اتسجّل قبل كده — ما اتكررش.' : `اتسجّل المصروف (${money(d.amount)}) واتحدّث المخزون — رصيد «${d.item}» دلوقتي ${d.balance} ${d.unit}`);
        if (d.low) toast.error(`تنبيه: رصيد «${d.item}» (${d.balance} ${d.unit}) عند الحد الأدنى أو أقل (${d.minQuantity}).`);
      } else {
        const { error } = await supabase.rpc('save_expense', { p: { ...(f.id ? { id: f.id } : { key }), category: f.category.trim(), amount: toNum(f.amount), description: f.description.trim(), expenseDate: f.date, paymentMethod: f.method } });
        if (error) { toast.error(/fetch|network/i.test(error.message) ? 'الاتصال قطع — دوس «حفظ» تاني (مش هيتسجّل مرتين).' : error.message); return; }
        toast.success('تم حفظ المصروف');
      }
      onSaved();
    } finally { setBusy(false); }
  };
  const options = [{ value: '', label: 'اختار البند' }, ...[...new Set([...categories, f.category].filter(Boolean))].map((value) => ({ value, label: value })), { value: NEW_CATEGORY, label: '+ بند جديد' }];
  return (
    <Modal title={f.id ? 'تعديل مصروف' : 'إضافة مصروف'} onClose={onClose} footer={<>
      <Button variant="outline" onClick={onClose}>إلغاء</Button>
      <Button icon="check" loading={busy} disabled={!ok} onClick={save}>حفظ</Button>
    </>}>
      <div className="grid-form grid-form--2">
        <Select id="exp-cat" label="البند *" value={newCat ? NEW_CATEGORY : f.category} disabled={wasLinked} options={options} onChange={(e) => {
          const isNew = e.target.value === NEW_CATEGORY;
          setNewCat(isNew); set('category', isNew ? '' : e.target.value);
        }} />
        {newCat && <Input id="exp-new-cat" label="اسم البند الجديد *" value={f.category} autoFocus onChange={(e) => set('category', e.target.value)} />}
        {f.category === SUPPLY_CATEGORY && !wasLinked && canStock && (
          <label className="exp-link"><input type="checkbox" checked={f.linked !== false} onChange={(e) => set('linked', e.target.checked)} /> إضافة الكمية للمخزون</label>
        )}
        {f.category === SUPPLY_CATEGORY && !canStock && !wasLinked && <p className="muted-sm exp-link">ربط المصروف بالمخزون محتاج صلاحية «المخزون: تعديل» — هيتسجّل مصروف عادي بس.</p>}
        {supply ? <>
          <Select id="exp-item" label="المنتج من المخزون *" value={f.itemId ?? ''} onChange={(e) => {
            const it = items.find((x) => x.id === e.target.value);
            setF((x) => ({ ...x, itemId: e.target.value, unitPrice: x.unitPrice || (it?.costPrice ? String(it.costPrice) : '') }));
          }} options={[{ value: '', label: items.length ? 'اختار المنتج' : 'مفيش أصناف في المخزون — ضيفها من «المخزون»' }, ...items.map((it) => ({ value: it.id, label: `${it.name} — المتاح ${it.quantity} ${it.unit}` }))]} />
          <Input id="exp-qty" label={`الكمية${item ? ` (${item.unit})` : ''} *`} inputMode="decimal" value={f.quantity ?? ''} onChange={(e) => set('quantity', e.target.value)} />
          <Input id="exp-unit-price" label="سعر الوحدة *" inputMode="decimal" value={f.unitPrice ?? ''} onChange={(e) => set('unitPrice', e.target.value)} />
          <Input id="exp-total" label="الإجمالي (محسوب)" value={total ? money(total) : '—'} readOnly />
          <Input id="exp-date" label="تاريخ الشراء *" type="date" value={f.date} onChange={(e) => set('date', e.target.value)} />
        </> : <>
          <Input id="exp-amount" label="المبلغ *" type="number" min="0" step="0.01" value={f.amount} onChange={(e) => set('amount', e.target.value)} />
          <Input id="exp-date" label="التاريخ *" type="date" value={f.date} onChange={(e) => set('date', e.target.value)} />
        </>}
        <Select id="exp-method" label="طريقة الدفع" value={f.method} options={PAYMENT_METHOD_OPTIONS} onChange={(e) => set('method', e.target.value)} />
        <Input id="exp-desc" label="ملاحظة" value={f.description} onChange={(e) => set('description', e.target.value)} />
      </div>
      {supply && item && qty > 0 && (
        <p className={after <= item.minQuantity ? 'alert alert-warn' : 'muted-sm'} style={{ marginBottom: 0 }} data-testid="exp-stock-after">
          رصيد «{item.name}» بعد الحفظ: <b className="num">{after}</b> {item.unit}{wasLinked ? ' — التعديل بيعمل حركة تسوية بالفرق' : ''}{after <= item.minQuantity ? ` (الحد الأدنى ${item.minQuantity})` : ''}
        </p>
      )}
      {!net.isOnline() && <p className="alert alert-danger" style={{ marginBottom: 0 }}>{OFFLINE}</p>}
    </Modal>
  );
}

export default function ExpensesTab() {
  useDbVersion();
  const can = useCan();
  const toast = useToast();
  const [rows, setRows] = useState<Expense[] | null>(null);
  const [failed, setFailed] = useState(false);
  const [period, setPeriod] = useState<Period>(ALL_PERIOD);
  const [q, setQ] = useState('');
  const [category, setCategory] = useState('');
  const [edit, setEdit] = useState<Draft | null>(null);
  const [deleting, setDeleting] = useState<Expense | null>(null);
  const load = useCallback(async () => {
    try {
      const data = await fetchKeyset('expenses') as Expense[];
      setRows(data.map((x) => ({ ...x, amount: Number(x.amount) })).sort((a, b) => b.expense_date.localeCompare(a.expense_date)));
      setFailed(false);
    } catch { setFailed(true); }
  }, []);
  useEffect(() => { void load(); }, [load]);

  const { from, to } = period;
  const inPeriod = (day: string) => (!from || day >= from) && (!to || day <= to);
  const all = rows ?? [];
  const term = q.trim().toLowerCase();
  const itemName = (id?: string | null) => (id ? db.inventory().find((it) => it.id === id)?.name ?? '' : '');
  const shown = all.filter((x) => inPeriod(x.expense_date) && (!category || x.category === category) && (!term || x.category.toLowerCase().includes(term) || x.description.toLowerCase().includes(term) || itemName(x.inventory_item_id).toLowerCase().includes(term)));
  const totalExpenses = shown.reduce((s, x) => s + x.amount, 0);
  const collected = db.payments().filter((p) => inPeriod(tsToYmd(p.date))).reduce((s, p) => s + p.amount, 0);
  const usedCategories = [...new Set(all.map((x) => x.category))];
  const categories = [...new Set([...DEFAULT_CATEGORIES, ...usedCategories])];
  const doExport = () => exportCsv('المصروفات', ['التاريخ', 'البند', 'المنتج', 'الكمية', 'سعر الوحدة', 'المبلغ', 'طريقة الدفع', 'ملاحظة'], shown.map((x) => [x.expense_date, x.category, itemName(x.inventory_item_id), x.quantity ?? '', x.unit_price ?? '', x.amount, methodLabel(x.payment_method), x.description]));
  const afterSave = () => { setEdit(null); void load(); };
  const remove = async (x: Expense) => {
    if (!net.isOnline()) { toast.error('حذف المصروفات محتاج اتصال بالإنترنت.'); return; }
    const { error } = await supabase.rpc('delete_expense', { p_id: x.id });
    if (error) { toast.error(error.message); return; }
    if (x.inventory_item_id) await db.refresh('inventory');
    toast.success(x.inventory_item_id ? 'تم حذف المصروف ورجعت الكمية من المخزون' : 'تم حذف المصروف');
    setDeleting(null);
    void load();
  };

  return (
    <>
      <PeriodFilter id="exp" value={period} onChange={setPeriod} />
      <div className="kpi-grid" style={{ padding: '18px 22px 0' }}>
        <StatCard icon="trendDown" tone="danger" value={money(totalExpenses)} label="إجمالي المصروفات" />
        <StatCard icon="wallet" tone="ok" value={money(collected)} label="المحصّل من المرضى" />
        <StatCard icon="receipt" tone={collected - totalExpenses < 0 ? 'warn' : 'brand'} value={money(collected - totalExpenses)} label="الصافي" />
        <StatCard icon="doc" tone="info" value={shown.length} label="عدد المصروفات" />
      </div>
      <FilterBar>
        <Input id="exp-q" label="بحث" icon="search" placeholder="البند أو الملاحظة أو المنتج" value={q} onChange={(e) => setQ(e.target.value)} />
        <Select id="exp-filter-cat" label="البند" value={category} onChange={(e) => setCategory(e.target.value)} options={[{ value: '', label: 'كل البنود' }, ...usedCategories.map((value) => ({ value, label: value }))]} />
        <div className="filter-bar__actions">
          <Button variant="outline" icon="doc" onClick={doExport}>تصدير Excel</Button>
          {can('expenses', 'create') && <Button icon="plus" onClick={() => setEdit({ category: '', amount: '', description: '', date: todayYmd(), method: 'cash' })}>إضافة مصروف</Button>}
        </div>
      </FilterBar>
      <div className="card__body">
        {failed ? <EmptyState icon="alert" title="تعذّر تحميل المصروفات" text="تحقق من الاتصال بالإنترنت وجرّب تاني." />
          : !rows ? <Skeleton h={70} />
          : shown.length === 0 ? <EmptyState icon="wallet" title="ما فيه مصروفات في الفترة دي" />
          : (
            <div className="table-wrap"><table className="table">
              <thead><tr><th>التاريخ</th><th>البند</th><th>ملاحظة</th><th>طريقة الدفع</th><th>المبلغ</th><th className="actions"></th></tr></thead>
              <tbody>{shown.map((x) => (
                <tr key={x.id}>
                  <td>{fmtDate(x.expense_date)}</td>
                  <td style={{ fontWeight: 600 }}>{x.category}
                    {x.inventory_item_id && <div className="muted-sm" data-testid="exp-stock-link"><span className="badge badge--info">مخزون</span> {itemName(x.inventory_item_id) || 'صنف'} × <span className="num">{Number(x.quantity)}</span> بـ <span className="num">{money(Number(x.unit_price))}</span></div>}
                  </td>
                  <td>{x.description || '—'}</td><td>{methodLabel(x.payment_method)}</td><td className="num" style={{ fontWeight: 700 }}>{money(x.amount)}</td>
                  <td className="actions"><div style={{ display: 'flex', gap: 6, justifyContent: 'flex-end' }}>
                    {can('expenses', 'edit') && <IconAction icon="edit" label="تعديل" onClick={() => setEdit({ id: x.id, category: x.category, amount: String(x.amount), description: x.description, date: x.expense_date, method: x.payment_method,
                      ...(x.inventory_item_id ? { itemId: x.inventory_item_id, quantity: String(x.quantity ?? ''), unitPrice: String(x.unit_price ?? ''), linked: true } : {}) })} />}
                    {can('expenses', 'delete') && <IconAction icon="trash" label="حذف" danger onClick={() => setDeleting(x)} />}
                  </div></td>
                </tr>
              ))}</tbody>
            </table></div>
          )}
      </div>
      {edit && <ExpenseModal initial={edit} categories={categories} onClose={() => setEdit(null)} onSaved={afterSave} />}
      {deleting && <ConfirmDialog title="حذف مصروف" message={`حذف مصروف «${deleting.category}» بمبلغ ${money(deleting.amount)}؟${deleting.inventory_item_id ? ` الكمية (${Number(deleting.quantity)}) هتترجع من المخزون.` : ''}`} onConfirm={() => remove(deleting)} onClose={() => setDeleting(null)} />}
    </>
  );
}
