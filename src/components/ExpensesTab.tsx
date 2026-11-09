// تبويب «المصروفات» في الفواتير والمدفوعات: تسجيل مصروفات العيادة (إيجار، كهرباء، مستلزمات…) بنفس اختيار الفترة، والصافي = المحصّل − المصروفات.
// القراءة بصلاحية financial/view، والحفظ والحذف عن طريق save_expense و delete_expense على الخادم.
import { useCallback, useEffect, useState } from 'react';
import { supabase } from '../lib/supabase';
import { fetchKeyset } from '../data/download';
import { db } from '../data/db';
import { useToast } from '../hooks/useToast';
import { Button, EmptyState, Input, Modal, Select, Skeleton } from './ui';
import { ConfirmDialog, FilterBar, IconAction, useCan } from './common';
import { StatCard } from './StatCard';
import { ALL_PERIOD, PeriodFilter, type Period } from './PeriodFilter';
import { PAYMENT_METHOD_LABEL, PAYMENT_METHOD_OPTIONS, exportCsv, fmtDate, money, todayYmd, tsToYmd } from '../utils/format';

interface Expense { id: string; category: string; amount: number; description: string; expense_date: string; payment_method: string }
interface Draft { id?: string; category: string; amount: string; description: string; date: string; method: string }

const DEFAULT_CATEGORIES = ['إيجار', 'كهرباء ومياه', 'إنترنت وتليفون', 'مستلزمات طبية', 'أدوات مكتبية', 'صيانة', 'نظافة', 'تسويق', 'انتقالات', 'نثريات'];
const NEW_CATEGORY = '__new_category__';
const methodLabel = (m: string) => PAYMENT_METHOD_LABEL[m] ?? m;

function ExpenseModal({ initial, categories, onClose, onSaved }: { initial: Draft; categories: string[]; onClose: () => void; onSaved: () => void }) {
  const toast = useToast();
  const [f, setF] = useState<Draft>(initial);
  const [newCat, setNewCat] = useState(false);
  const [busy, setBusy] = useState(false);
  const set = (k: keyof Draft, v: string) => setF((x) => ({ ...x, [k]: v }));
  const ok = !!f.category.trim() && Number(f.amount) > 0 && !!f.date;
  const save = async () => {
    setBusy(true);
    const { error } = await supabase.rpc('save_expense', { p: { ...(f.id ? { id: f.id } : {}), category: f.category.trim(), amount: Number(f.amount), description: f.description.trim(), expenseDate: f.date, paymentMethod: f.method } });
    setBusy(false);
    if (error) { toast.error(error.message); return; }
    toast.success('تم حفظ المصروف');
    onSaved();
  };
  const options = [{ value: '', label: 'اختار البند' }, ...[...new Set([...categories, f.category].filter(Boolean))].map((value) => ({ value, label: value })), { value: NEW_CATEGORY, label: '+ بند جديد' }];
  return (
    <Modal title={f.id ? 'تعديل مصروف' : 'إضافة مصروف'} onClose={onClose} footer={<>
      <Button variant="outline" onClick={onClose}>إلغاء</Button>
      <Button icon="check" loading={busy} disabled={!ok} onClick={save}>حفظ</Button>
    </>}>
      <div className="grid-form grid-form--2">
        <Select id="exp-cat" label="البند *" value={newCat ? NEW_CATEGORY : f.category} options={options} onChange={(e) => {
          const isNew = e.target.value === NEW_CATEGORY;
          setNewCat(isNew); set('category', isNew ? '' : e.target.value);
        }} />
        {newCat && <Input id="exp-new-cat" label="اسم البند الجديد *" value={f.category} autoFocus onChange={(e) => set('category', e.target.value)} />}
        <Input id="exp-amount" label="المبلغ *" type="number" min="0" step="0.01" value={f.amount} onChange={(e) => set('amount', e.target.value)} />
        <Input id="exp-date" label="التاريخ *" type="date" value={f.date} onChange={(e) => set('date', e.target.value)} />
        <Select id="exp-method" label="طريقة الدفع" value={f.method} options={PAYMENT_METHOD_OPTIONS} onChange={(e) => set('method', e.target.value)} />
        <Input id="exp-desc" label="ملاحظة" value={f.description} onChange={(e) => set('description', e.target.value)} />
      </div>
    </Modal>
  );
}

export default function ExpensesTab() {
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
  const shown = all.filter((x) => inPeriod(x.expense_date) && (!category || x.category === category) && (!term || x.category.toLowerCase().includes(term) || x.description.toLowerCase().includes(term)));
  const totalExpenses = shown.reduce((s, x) => s + x.amount, 0);
  const collected = db.payments().filter((p) => inPeriod(tsToYmd(p.date))).reduce((s, p) => s + p.amount, 0);
  const usedCategories = [...new Set(all.map((x) => x.category))];
  const categories = [...new Set([...DEFAULT_CATEGORIES, ...usedCategories])];
  const doExport = () => exportCsv('المصروفات', ['التاريخ', 'البند', 'المبلغ', 'طريقة الدفع', 'ملاحظة'], shown.map((x) => [x.expense_date, x.category, x.amount, methodLabel(x.payment_method), x.description]));
  const afterSave = () => { setEdit(null); void load(); };
  const remove = async (x: Expense) => {
    const { error } = await supabase.rpc('delete_expense', { p_id: x.id });
    if (error) { toast.error(error.message); return; }
    toast.success('تم حذف المصروف');
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
        <Input id="exp-q" label="بحث" icon="search" placeholder="البند أو الملاحظة" value={q} onChange={(e) => setQ(e.target.value)} />
        <Select id="exp-filter-cat" label="البند" value={category} onChange={(e) => setCategory(e.target.value)} options={[{ value: '', label: 'كل البنود' }, ...usedCategories.map((value) => ({ value, label: value }))]} />
        <div className="filter-bar__actions">
          <Button variant="outline" icon="doc" onClick={doExport}>تصدير Excel</Button>
          {can('financial', 'create') && <Button icon="plus" onClick={() => setEdit({ category: '', amount: '', description: '', date: todayYmd(), method: 'cash' })}>إضافة مصروف</Button>}
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
                  <td>{fmtDate(x.expense_date)}</td><td style={{ fontWeight: 600 }}>{x.category}</td><td>{x.description || '—'}</td><td>{methodLabel(x.payment_method)}</td><td className="num" style={{ fontWeight: 700 }}>{money(x.amount)}</td>
                  <td className="actions"><div style={{ display: 'flex', gap: 6, justifyContent: 'flex-end' }}>
                    {can('financial', 'edit') && <IconAction icon="edit" label="تعديل" onClick={() => setEdit({ id: x.id, category: x.category, amount: String(x.amount), description: x.description, date: x.expense_date, method: x.payment_method })} />}
                    {can('financial', 'delete') && <IconAction icon="trash" label="حذف" danger onClick={() => setDeleting(x)} />}
                  </div></td>
                </tr>
              ))}</tbody>
            </table></div>
          )}
      </div>
      {edit && <ExpenseModal initial={edit} categories={categories} onClose={() => setEdit(null)} onSaved={afterSave} />}
      {deleting && <ConfirmDialog title="حذف مصروف" message={`حذف مصروف «${deleting.category}» بمبلغ ${money(deleting.amount)}؟`} onConfirm={() => remove(deleting)} onClose={() => setDeleting(null)} />}
    </>
  );
}
