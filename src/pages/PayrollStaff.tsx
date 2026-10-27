import { useCallback, useEffect, useState } from 'react';
import { useToast } from '../hooks/useToast';
import { Button, EmptyState, ErrorState, Input, Select, Skeleton, StatusBadge } from '../components/ui';
import { FilterBar, IconAction, RowActions, useCan } from '../components/common';
import { StatCard } from '../components/StatCard';
import { fmtDate, money } from '../utils/format';
import { payrollApi, currentPeriod, type Overview, type PayrollRow } from '../data/payrollApi';
import { PayrollHeader, PlanModal, BulkPlanModal, PayModal, SubjectDetailModal, periodLabel, PAY_STATUS, ROLE_NAME } from '../components/PayrollKit';

// «رواتب الموظفين الإداريين» — الاستقبال والسكرتارية والمحاسب: راتب شهري ثابت بس (من غير تارجت ولا مكافآت).
export default function PayrollStaff() {
  const can = useCan();
  const [period, setPeriod] = useState(currentPeriod());
  const [data, setData] = useState<Overview | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [q, setQ] = useState('');
  const [role, setRole] = useState('');
  const [state, setState] = useState('');
  const [editing, setEditing] = useState<PayrollRow | null>(null);
  const [bulk, setBulk] = useState<PayrollRow[] | null>(null);
  const [paying, setPaying] = useState<PayrollRow | null>(null);
  const [detail, setDetail] = useState<PayrollRow | null>(null);

  const load = useCallback(async () => {
    setError(null);
    const r = await payrollApi.overview(period);
    if (!r.ok) { setError(r.error); return; }
    setData(r.data);
    setDetail((d) => (d ? r.data.rows.find((x) => x.type === d.type && x.id === d.id) ?? null : d));
  }, [period]);
  useEffect(() => { setData(null); load(); }, [load]);
  const toast = useToast();
  // مفيش اعتماد شهر: المستحق بيتثبّت لحظة فتح الصرف/المكافأة
  const prep = async (r: PayrollRow, open: (u: PayrollRow) => void) => {
    const x = await payrollApi.ensureRow(period, r);
    if (!x.ok) { toast.error(x.error); return; }
    load(); open(x.row);
  };
  const canPay = (r: PayrollRow) => (r.due ? r.payStatus === 'unpaid' || r.payStatus === 'partial' : r.live.hasPlan && r.live.baseSalary + r.live.bonus > 0);

  const all = (data?.rows ?? []).filter((r) => r.type === 'employee');
  const rows = all.filter((r) => (!q.trim() || r.name.includes(q.trim())) && (!role || r.role === role) && (!state || r.payStatus === state));
  const dueOf = (r: PayrollRow) => r.due?.salaryDue ?? 0;
  const sum = (f: (r: PayrollRow) => number) => all.reduce((s, r) => s + f(r), 0);

  return (
    <div className="page">
      <PayrollHeader title="الرواتب والتارجت" subtitle="رواتب ثابتة شهرية للاستقبال والسكرتارية والمحاسب — دون تارجت أو عمولات."
        period={period} onPeriod={setPeriod} overview={data} onChanged={load} />

      {error && !data ? <div className="card"><div className="alert alert-danger" style={{ margin: 16 }}>{error}</div><ErrorState onRetry={load} /></div> : !data ? <Skeleton h={320} /> : (
        <>
          <div className="kpi-grid" style={{ marginBottom: 16 }}>
            <StatCard icon="wallet" tone="brand" value={money(sum((r) => r.live.baseSalary))} label="الرواتب حسب الإعدادات" />
            <StatCard icon="checkCircle" tone="info" value={money(sum(dueOf))} label="الرواتب المعتمدة للشهر" />
            <StatCard icon="checkCircle" tone="ok" value={money(sum((r) => r.paidSalary))} label="المصروف" />
            <StatCard icon="clock" tone="warn" value={money(sum((r) => Math.max(0, dueOf(r) - r.paidSalary)))} label="المتبقي للصرف" />
          </div>
          <div className="card">
            <FilterBar>
              <Input id="ps-q" label="بحث" icon="search" placeholder="اسم الموظف" value={q} onChange={(e) => setQ(e.target.value)} />
              <Select id="ps-role" label="الوظيفة" value={role} onChange={(e) => setRole(e.target.value)}
                options={[{ value: '', label: 'الكل' }, ...['reception', 'secretary', 'accountant'].map((x) => ({ value: x, label: ROLE_NAME[x] }))]} />
              <Select id="ps-state" label="حالة الصرف" value={state} onChange={(e) => setState(e.target.value)}
                options={[{ value: '', label: 'الكل' }, ...(['not_approved', 'unpaid', 'partial', 'paid'] as const).map((x) => ({ value: x, label: PAY_STATUS[x].label }))]} />
              {can('payroll', 'edit') && all.length > 0 && <div className="pr-toolbar-btn"><Button variant="outline" icon="settings" onClick={() => setBulk(all.filter((r) => r.active || r.live.hasPlan))}>تحديد الرواتب للكل</Button></div>}
            </FilterBar>
            <div className="card__body">
              {rows.length === 0 ? <EmptyState icon="user" title="ما فيه موظفون إداريون" text="الرواتب الثابتة للاستقبال والسكرتارية والمحاسب — حساباتهم من قسم «الموظفون»." /> : (
                <div className="table-wrap"><table className="table pr-table">
                  <thead><tr><th>الموظف</th><th>الوظيفة</th><th>الراتب الشهري</th><th>الشهر المستحق عنه</th><th>المصروف</th><th>المتبقي</th><th>حالة الصرف</th><th>آخر صرف</th><th className="actions" /></tr></thead>
                  <tbody>{rows.map((r) => (
                    <tr key={r.id}>
                      <td><strong data-no-i18n>{r.name}</strong>{!r.active && <div className="muted-sm">غير نشط</div>}</td>
                      <td>{ROLE_NAME[r.role] ?? r.role}</td>
                      <td className="num">{r.due ? <>{money(r.due.salaryDue)}<div className="muted-sm">معتمد</div></>
                        : r.live.hasPlan ? <>{money(r.live.baseSalary)}<div className="muted-sm">حسب الإعدادات</div></>
                        : <div className="pr-unset pr-unset--sm"><span className="muted">لم يُحدد</span>{can('payroll', 'edit') && <Button size="sm" icon="edit" onClick={() => setEditing(r)}>تحديد الراتب</Button>}</div>}</td>
                      <td style={{ whiteSpace: 'nowrap' }}>{periodLabel(period)}</td>
                      <td className="num">{money(r.paidSalary)}</td>
                      <td className="num">{r.due ? money(Math.max(0, r.due.salaryDue - r.paidSalary)) : '—'}</td>
                      <td><StatusBadge label={PAY_STATUS[r.payStatus].label} tone={PAY_STATUS[r.payStatus].tone} /></td>
                      <td className="num" style={{ whiteSpace: 'nowrap' }}>{r.lastPaidOn ? fmtDate(r.lastPaidOn) : '—'}</td>
                      <td className="actions"><RowActions>
                        {r.live.hasPlan && can('payroll', 'edit') && <IconAction icon="edit" label="تعديل الراتب" onClick={() => setEditing(r)} />}
                        <IconAction icon="eye" label="التفاصيل" onClick={() => setDetail(r)} />
                        {canPay(r) && can('payroll', 'create') && <Button size="sm" icon="wallet" onClick={() => prep(r, setPaying)}>تسجيل صرف</Button>}
                      </RowActions></td>
                    </tr>
                  ))}</tbody>
                </table></div>
              )}
            </div>
          </div>
        </>
      )}

      {editing && <PlanModal row={editing} period={period} onClose={() => setEditing(null)} onSaved={() => { setEditing(null); load(); }} />}
      {bulk && <BulkPlanModal type="employee" rows={bulk} period={period} onClose={() => setBulk(null)} onDone={(close) => { if (close) setBulk(null); load(); }} />}
      {paying && <PayModal row={paying} period={period} onClose={() => setPaying(null)} onPaid={() => { setPaying(null); load(); }} />}
      {detail && data && <SubjectDetailModal row={detail} overview={data} onClose={() => setDetail(null)} onChanged={load} />}
    </div>
  );
}
