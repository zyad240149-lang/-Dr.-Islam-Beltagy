import { useCallback, useEffect, useState } from 'react';
import { useToast } from '../hooks/useToast';
import { Button, EmptyState, ErrorState, Input, Select, Skeleton, StatusBadge } from '../components/ui';
import { FilterBar, IconAction, RowActions, useCan } from '../components/common';
import { StatCard } from '../components/StatCard';
import { Icon } from '../utils/icons';
import { money } from '../utils/format';
import { payrollApi, currentPeriod, type Overview, type PayrollRow, type RevenueBasis } from '../data/payrollApi';
import {
  PayrollHeader, PlanModal, BulkPlanModal, PayModal, SubjectDetailModal, ReasonModal, BonusRateModal, pct, reachedTarget, targetState,
  CONDITION_LABEL, SYSTEM_LABEL, PAY_STATUS, TARGET_STATE,
} from '../components/PayrollKit';

const BASIS_LABEL: Record<RevenueBasis, string> = {
  collected: 'المحصّل فعليًا من فواتير المواعيد المؤكدة باسمه',
  invoiced: 'فواتير المواعيد المؤكدة باسم الأخصائي (كاملة)',
};

// مستحق الشهر: المثبّت لو موجود، وإلا الأرقام المباشرة حسب الإعدادات
const owedOf = (r: PayrollRow) => (r.due ? r.due.salaryDue + r.due.bonusDue : r.live.hasPlan ? r.live.baseSalary + r.live.bonus : 0);

// «رواتب الأخصائيين والتارجت» — للمدير العام بس (الخادم بيرفض أي حد تاني).
export default function Payroll() {
  const can = useCan();
  const [period, setPeriod] = useState(currentPeriod());
  const [data, setData] = useState<Overview | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [q, setQ] = useState('');
  const [tState, setTState] = useState('');
  const [editing, setEditing] = useState<PayrollRow | null>(null);
  const [bulk, setBulk] = useState<PayrollRow[] | null>(null);
  const [paying, setPaying] = useState<PayrollRow | null>(null);
  const [payKind, setPayKind] = useState<'salary' | 'bonus' | undefined>(undefined);
  const [rating, setRating] = useState<PayrollRow | null>(null);
  const [detail, setDetail] = useState<PayrollRow | null>(null);
  const [basisTo, setBasisTo] = useState<RevenueBasis | null>(null);

  // من غير toast في الـ deps: كائن الـ toast بيتغيّر مع كل رسالة، فكان هيعيد التحميل في حلقة
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
  const canEdit = can('payroll', 'edit');

  const all = (data?.rows ?? []).filter((r) => r.type === 'therapist');
  const rows = all.filter((r) => (!q.trim() || r.name.includes(q.trim())) && (!tState || targetState(r) === tState));
  const sum = (f: (r: PayrollRow) => number) => all.reduce((s, r) => s + f(r), 0);
  const withTarget = all.filter((r) => targetState(r) !== 'none');
  const setupNeeded = all.filter((r) => r.active && !r.live.hasPlan && !r.due);
  const teamTarget = sum((r) => (r.due ?? r.live).target);
  const teamQual = withTarget.reduce((s, r) => s + (r.due ?? r.live).qualifying, 0);
  const owed = sum(owedOf), paid = sum((r) => r.paidSalary + r.paidBonus);
  // ترتيب ثابت: اللي محتاجين إعداد الأول، وبعدين الأعلى إنجازًا
  const sorted = [...rows].sort((a, b) => Number(a.live.hasPlan || !!a.due) - Number(b.live.hasPlan || !!b.due) || ((b.due ?? b.live).pct ?? -1) - ((a.due ?? a.live).pct ?? -1));
  const bulkRows = all.filter((r) => r.active || r.live.hasPlan);

  return (
    <div className="page">
      <PayrollHeader title="الرواتب والتارجت" subtitle="راتب وتارجت ومكافأة كل أخصائي، والإيراد المؤهل الذي حققه، والصرف — للمدير العام فقط."
        period={period} onPeriod={setPeriod} overview={data} onChanged={load} />

      {error && !data ? <div className="card"><div className="alert alert-danger" style={{ margin: 16 }}>{error}</div><ErrorState onRetry={load} /></div> : !data ? <Skeleton h={320} /> : (
        <>
          <div className="kpi-grid pr-kpis">
            <StatCard icon="wallet" tone="brand" value={money(sum((r) => (r.due ? r.due.salaryDue : r.live.baseSalary)))} label="الرواتب الأساسية" />
            <StatCard icon="target" tone="info" value={teamTarget > 0 ? money(teamTarget) : '—'} label="إجمالي التارجت"
              sub={teamTarget > 0 ? <><span>المحقق</span> <span className="num">{money(teamQual)}</span> · <span className="num">{pct(Math.round((teamQual / teamTarget) * 1000) / 10)}</span></> : undefined} />
            <StatCard icon="spark" tone="ok" value={money(sum((r) => (r.due ? r.due.bonusDue : r.live.bonus)))} label="المكافآت المستحقة" />
            <StatCard icon="checkCircle" tone="ok" value={`${withTarget.filter((r) => targetState(r) === 'reached').length} / ${withTarget.length}`} label="حققوا التارجت" />
            <StatCard icon="alert" tone="warn" value={String(all.filter((r) => r.overdue).length)} label="رواتب متأخرة" />
            <StatCard icon="clock" tone="warn" value={money(Math.max(0, owed - paid))} label="المتبقي للصرف"
              sub={<><span>المصروف</span> <span className="num">{money(paid)}</span> <span>من</span> <span className="num">{money(owed)}</span></>} />
          </div>

          {setupNeeded.length > 0 && canEdit && (
            <div className="pr-setup-banner">
              <span className="pr-setup-banner__ic"><Icon name="settings" size={20} /></span>
              <div className="pr-setup-banner__txt">
                <strong><span className="num">{setupNeeded.length}</span> <span>{setupNeeded.length === 1 ? 'أخصائي لم يُحدَّد له راتب وتارجت بعد' : 'أخصائيين لم يُحدَّد لهم راتب وتارجت بعد'}</span></strong>
                <span className="muted-sm" data-no-i18n>{setupNeeded.map((r) => r.name).join('، ')}</span>
              </div>
              <Button icon="edit" onClick={() => setBulk(bulkRows)}>تحديد الرواتب والتارجت</Button>
            </div>
          )}

          <div className="card">
            <FilterBar>
              <Input id="pr-q" label="بحث" icon="search" placeholder="اسم الأخصائي" value={q} onChange={(e) => setQ(e.target.value)} />
              <Select id="pr-tstate" label="حالة التارجت" value={tState} onChange={(e) => setTState(e.target.value)}
                options={[{ value: '', label: 'الكل' }, ...Object.entries(TARGET_STATE).map(([value, x]) => ({ value, label: x.label }))]} />
              {canEdit && all.length > 0 && <div className="pr-toolbar-btn"><Button variant="outline" icon="settings" onClick={() => setBulk(bulkRows)}>إعداد الرواتب والتارجت للكل</Button></div>}
            </FilterBar>
            <div className="card__body">
              {sorted.length === 0 ? <EmptyState icon="user" title="ما فيه أخصائيون" text="أضف الأخصائيين من قسم «الموظفون» أولًا." /> : (
                <div className="table-wrap"><table className="table pr-table">
                  <thead><tr><th>الأخصائي</th><th>الراتب الأساسي</th><th>التارجت الشهري</th><th>الإنجاز</th><th>المكافأة</th><th>الصرف</th><th className="actions" /></tr></thead>
                  <tbody>{sorted.map((r) => {
                    const src = r.due ?? r.live;
                    const target = src.target, qual = src.qualifying, p = src.pct;
                    const ts = targetState(r);
                    const visits = r.due ? r.due.visits : r.live.visits;
                    const bonusAtTarget = src.bonusMethod === 'fixed' ? src.bonusFixed : src.bonusMethod === 'none' ? 0 : Math.round(target * src.bonusRate) / 100;
                    const set = r.live.hasPlan || !!r.due;
                    return (
                      <tr key={r.id} className={set ? '' : 'pr-row--unset'}>
                        <td style={{ minWidth: 170 }}>
                          <div className="pr-who">
                            <span className="avatar" data-no-i18n>{r.name.trim().split(/\s+/).slice(0, 2).map((w) => w[0]).join('')}</span>
                            <div><strong data-no-i18n>{r.name}</strong>
                              <div className="muted-sm">{r.account ? <>حساب: <span data-no-i18n>{r.account}</span></> : 'بدون حساب دخول'}{!r.active && <> · <span>غير نشط</span></>}</div></div>
                          </div>
                        </td>
                        {!set ? (
                          <td colSpan={4}>
                            <div className="pr-unset">
                              <div>
                                <strong>ما تم تحديد الراتب والتارجت</strong>
                                <div className="muted-sm">
                                  <span>الإيراد المؤهل للحين</span> <b className="num">{money(qual)}</b> · <span className="num">{visits}</span> <span>زيارة منفذة</span>
                                  {r.live.booked > 0 && <> · <span className="num">{r.live.booked}</span> <span>حجز مؤكد لم يُنفَّذ بعد</span></>}
                                </div>
                              </div>
                              {canEdit && <Button size="sm" icon="edit" onClick={() => setEditing(r)}>تحديد الراتب والتارجت</Button>}
                            </div>
                          </td>
                        ) : (
                          <>
                            <td className="num"><b>{money(r.due ? r.due.salaryDue : r.live.baseSalary)}</b><div className="muted-sm">{SYSTEM_LABEL[r.live.paySystem]}</div>{r.due && <div className="muted-sm">مثبّت للشهر</div>}</td>
                            <td className="num">{target > 0 ? <b>{money(target)}</b> : <span className="muted">ما تم تحديده</span>}</td>
                            <td style={{ minWidth: 210 }}>
                              <div className="pr-prog">
                                <div className="pr-prog__top"><b className="num">{money(qual)}</b>{target > 0 && <span className={`num pr-prog__pct ${ts === 'reached' ? 'is-ok' : ''}`}>{pct(p)}</span>}</div>
                                {target > 0 && <div className="progress"><i style={{ width: `${Math.min(100, p ?? 0)}%`, background: ts === 'reached' ? 'var(--ok)' : undefined }} /></div>}
                                <div className="muted-sm">
                                  {target > 0 && ts !== 'reached' && <><span>المتبقي</span> <span className="num">{money(Math.max(0, target - qual))}</span> · </>}
                                  <span className="num">{visits}</span> <span>زيارة منفذة</span>
                                  {!r.due && r.live.booked > 0 && <> · <span className="num">{r.live.booked}</span> <span>حجز مؤكد لم يُنفَّذ بعد</span></>}
                                </div>
                                {target > 0 && <StatusBadge label={TARGET_STATE[ts].label} tone={TARGET_STATE[ts].tone} />}
                              </div>
                            </td>
                            <td style={{ minWidth: 160 }}>
                              {src.bonusMethod === 'none' || (target <= 0 && src.bonusCondition !== 'always') ? <span className="muted">بدون مكافأة</span> : src.bonusCondition === 'always' ? <>
                                <div className="num"><b>{money(r.due ? r.due.bonusDue : r.live.bonus)}</b></div>
                                <div className="muted-sm"><span className="num">{pct(src.bonusRate)}</span> <span>من الإيراد المحقق</span></div>
                              </> : <>
                                <div className="num"><b>{money(bonusAtTarget)}</b></div>
                                <div className="muted-sm">{src.bonusMethod === 'fixed' ? 'مكافأة ثابتة' : <><span className="num">{pct(src.bonusRate)}</span> <span>من التارجت</span></>} · {CONDITION_LABEL[src.bonusCondition]}</div>
                                {r.due && r.due.bonusDue > 0 ? <div className="pr-bonus-state is-ok"><span>المعتمدة</span> <b className="num">{money(r.due.bonusDue)}</b></div>
                                  : r.live.eligible ? <div className="pr-bonus-state is-ok">استحقها</div>
                                  : <div className="pr-bonus-state">لم يستحقها بعد</div>}
                              </>}
                            </td>
                          </>
                        )}
                        <td style={{ minWidth: 150 }}>
                          {!set ? <span className="muted">—</span> : <>
                            <StatusBadge label={PAY_STATUS[r.payStatus].label} tone={PAY_STATUS[r.payStatus].tone} />
                            {r.overdue && <StatusBadge label="متأخر" tone="danger" />}
                            {r.payDate && <div className="muted-sm"><span>موعد الصرف</span> <span className="num">{r.payDate}</span></div>}
                            <div className="muted-sm" style={{ marginTop: 4 }}><span>المصروف</span> <span className="num">{money(r.paidSalary + r.paidBonus)}</span> <span>من</span> <span className="num">{money(owedOf(r))}</span></div>
                          </>}
                        </td>
                        <td className="actions"><RowActions>
                          {set && canEdit && <IconAction icon="edit" label="تعديل الراتب والتارجت" onClick={() => setEditing(r)} />}
                          <IconAction icon="eye" label="التفاصيل" onClick={() => setDetail(r)} />
                          {reachedTarget(r) && canEdit && <Button size="sm" variant="outline" icon="target" onClick={() => prep(r, setRating)}>نسبة المكافأة</Button>}
                          {canPay(r) && can('payroll', 'create') && <Button size="sm" icon="wallet" onClick={() => prep(r, setPaying)}>تسجيل صرف</Button>}
                        </RowActions></td>
                      </tr>
                    );
                  })}</tbody>
                </table></div>
              )}
            </div>
          </div>

          <div className="card pr-basis">
            <div className="card__body">
              <div className="pr-basis__row">
                <div className="pr-basis__txt">
                  <span className="muted-sm">قاعدة احتساب الإيراد المؤهل</span>
                  <strong>{BASIS_LABEL[data.basis]}</strong>
                </div>
                {canEdit && <div className="pr-basis__sel">
                  <Select id="pr-basis" aria-label="تغيير القاعدة" value={data.basis} onChange={(e) => setBasisTo(e.target.value as RevenueBasis)}
                    options={(Object.keys(BASIS_LABEL) as RevenueBasis[]).map((b) => ({ value: b, label: BASIS_LABEL[b] }))} />
                </div>}
              </div>
              <details style={{ marginTop: 8 }}><summary className="muted-sm" style={{ cursor: 'pointer' }}>كيف يُحسب؟</summary>
                <ul className="muted-sm" style={{ margin: '6px 0 0', paddingInlineStart: 18, lineHeight: 1.9 }}>
                  <li>الزيارة المنفذة = موعد حالته «حضر» أو «مكتمل» في الشهر (بتاريخ الزيارة). الحجز المؤكد والملغي و«لم يحضر» غير محسوبة.</li>
                  <li>تُنسب الزيارة إلى دكتور الموعد، وتُحسب مرة واحدة فقط.</li>
                  <li>قيمة الزيارة = صافي فاتورتها بعد الخصم ودون الضريبة. الفاتورة الملغاة = صفر، والدفعة الملغاة (استرداد) تُقلّل المحصّل.</li>
                  <li>الخطة العلاجية أو الباقة (فاتورتها واحدة) تدخل التارجت بكامل صافي سعرها أول ما تتأكد أول زيارة منها، باسم دكتور هالزيارة وفي شهرها. الزيارات اللاحقة من نفس الباقة ما تضيف شي.</li>
                  <li>المكافأة = نسبة من قيمة التارجت، تُستحق عند الوصول للتارجت (أو تجاوزه حسب الشرط).</li>
                </ul>
              </details>
            </div>
          </div>
        </>
      )}

      {editing && <PlanModal row={editing} period={period} onClose={() => setEditing(null)} onSaved={() => { setEditing(null); load(); }} />}
      {bulk && <BulkPlanModal type="therapist" rows={bulk} period={period} onClose={() => setBulk(null)} onDone={(close) => { if (close) setBulk(null); load(); }} />}
      {paying && <PayModal row={paying} period={period} defaultKind={payKind} onClose={() => { setPaying(null); setPayKind(undefined); }} onPaid={() => { setPaying(null); setPayKind(undefined); load(); }} />}
      {rating && <BonusRateModal row={rating} onClose={() => setRating(null)} onDone={(u, pay) => { setRating(null); load(); if (pay) { setPayKind('bonus'); setPaying(u); } }} />}
      {detail && data && <SubjectDetailModal row={detail} overview={data} onClose={() => setDetail(null)} onChanged={load} />}
      {basisTo && data && basisTo !== data.basis && <ReasonModal title="تغيير قاعدة احتساب الإيراد المؤهل" confirmLabel="تأكيد التغيير" danger={false} required={false} label="ملاحظة (اختياري)"
        message={`القاعدة الجديدة: ${BASIS_LABEL[basisTo]}. يؤثر التغيير على الأرقام المباشرة للشهور المفتوحة فقط، أما الشهور المعتمدة فثابتة.`}
        onClose={() => setBasisTo(null)} successText="تم تغيير القاعدة."
        onSubmit={async () => { const r = await payrollApi.setBasis(basisTo); if (!r.ok) return r.error; setBasisTo(null); load(); return null; }} />}
    </div>
  );
}
