import { useEffect, useMemo, useState } from 'react';
import { Button, EmptyState, ErrorState, Select, Skeleton, StatusBadge } from '../components/ui';
import { FilterBar } from '../components/common';
import { StatCard } from '../components/StatCard';
import { exportCsv, fmtDate, fmtDateTime, money } from '../utils/format';
import { payrollApi, currentPeriod, type AuditEntry, type Overview, type Payout, type PayrollRow } from '../data/payrollApi';
import {
  AuditList, PayrollHeader, periodLabel, targetState, PAY_STATUS, PAYOUT_KIND, PAYOUT_METHOD, PERIOD_STATUS, ROLE_NAME, TARGET_STATE,
} from '../components/PayrollKit';

type Row = PayrollRow & { period: string; periodStatus: Overview['status'] };
type Tab = 'summary' | 'payouts' | 'audit';

// «التقارير وسجل الرواتب» — ملخص المستحقات والصرف بفلاتر، وسجل الصرف، وسجل التعديلات. كل رقم إجمالي = مجموع صفوف الجدول المعروض.
export default function PayrollReports() {
  const cur = currentPeriod();
  const thisYear = Number(cur.slice(0, 4));
  const [year, setYear] = useState(String(thisYear));
  const [month, setMonth] = useState(cur.slice(5, 7));
  const [subject, setSubject] = useState('');
  const [role, setRole] = useState('');
  const [payState, setPayState] = useState('');
  const [tState, setTState] = useState('');
  const [tab, setTab] = useState<Tab>('summary');
  const [rows, setRows] = useState<Row[] | null>(null);
  const [logs, setLogs] = useState<{ payouts: Payout[]; audit: AuditEntry[] } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [nonce, setNonce] = useState(0);

  // الشهور المطلوبة (لحد الشهر الحالي بس)
  const periods = useMemo(() => (month ? [`${year}-${month}`] : Array.from({ length: 12 }, (_, i) => `${year}-${String(i + 1).padStart(2, '0')}`)).filter((p) => p <= cur), [year, month, cur]);

  useEffect(() => {
    let alive = true;
    setRows(null); setLogs(null); setError(null);
    if (!periods.length) { setRows([]); setLogs({ payouts: [], audit: [] }); return; }
    (async () => {
      const res = await Promise.all(periods.map((p) => payrollApi.overview(p)));
      const bad = res.find((r) => !r.ok);
      if (bad && !bad.ok) { if (alive) setError(bad.error); return; }
      const all: Row[] = res.flatMap((r) => (r.ok ? r.data.rows.map((x) => ({ ...x, period: r.data.period, periodStatus: r.data.status })) : []));
      const lg = await payrollApi.logs(periods[0], periods[periods.length - 1]);
      if (!alive) return;
      setRows(all);
      setLogs(lg.ok ? { payouts: lg.payouts, audit: lg.audit } : { payouts: [], audit: [] });
    })();
    return () => { alive = false; };
  }, [periods, nonce]);

  const subjects = useMemo(() => {
    const m = new Map<string, string>();
    for (const r of rows ?? []) m.set(`${r.type}:${r.id}`, r.name);
    return [...m.entries()].map(([value, label]) => ({ value, label }));
  }, [rows]);
  const due = (r: Row) => (r.due ? r.due.salaryDue + r.due.bonusDue : 0);
  const paid = (r: Row) => r.paidSalary + r.paidBonus;
  // صفوف من غير إعدادات ولا مستحق ولا أي نشاط في الشهر مالهاش لازمة في التقرير
  const filtered = (rows ?? []).filter((r) => (r.due || r.live.hasPlan || (r.type === 'therapist' && r.live.visits > 0)) &&
    (!subject || `${r.type}:${r.id}` === subject) && (!role || r.role === role) && (!payState || r.payStatus === payState) &&
    (!tState || (r.type === 'therapist' && targetState(r) === tState)));
  const ths = filtered.filter((r) => r.type === 'therapist'), emps = filtered.filter((r) => r.type === 'employee');
  const sum = (list: Row[], f: (r: Row) => number) => list.reduce((s, r) => s + f(r), 0);
  const withTarget = ths.filter((r) => targetState(r) !== 'none');
  const reached = withTarget.filter((r) => targetState(r) === 'reached').length;

  const exportRows = () => exportCsv(`payroll-${year}${month ? '-' + month : ''}`,
    ['الشهر', 'حالة الشهر', 'الاسم', 'الوظيفة', 'الراتب الأساسي (الإعدادات)', 'الراتب المعتمد', 'التارجت', 'الإيراد المؤهل', 'نسبة الإنجاز', 'المكافأة المتوقعة', 'المكافأة المعتمدة', 'المصروف', 'المتبقي', 'حالة الصرف', 'حالة التارجت'],
    filtered.map((r) => [r.period, PERIOD_STATUS[r.periodStatus].label, r.name, ROLE_NAME[r.role] ?? r.role, r.live.baseSalary, r.due?.salaryDue ?? '',
      r.type === 'therapist' ? (r.due ?? r.live).target : '', r.type === 'therapist' ? (r.due ?? r.live).qualifying : '', r.type === 'therapist' ? ((r.due ?? r.live).pct ?? '') : '',
      r.type === 'therapist' ? r.live.bonus : '', r.due?.bonusDue ?? '', paid(r), r.due ? Math.max(0, due(r) - paid(r)) : '', PAY_STATUS[r.payStatus].label,
      r.type === 'therapist' ? TARGET_STATE[targetState(r)].label : '']));

  return (
    <div className="page">
      <PayrollHeader title="الرواتب والتارجت" subtitle="ملخص الرواتب والمكافآت والصرف، وسجل الصرف والتعديلات — للمدير العام فقط." />
      <div className="card" style={{ marginBottom: 16 }}>
        <FilterBar>
          <Select id="rp-year" label="السنة" value={year} onChange={(e) => setYear(e.target.value)} options={[thisYear, thisYear - 1, thisYear - 2].map((y) => ({ value: String(y), label: String(y) }))} />
          <Select id="rp-month" label="الشهر" value={month} onChange={(e) => setMonth(e.target.value)}
            options={[{ value: '', label: 'كل الشهور' }, ...Array.from({ length: 12 }, (_, i) => String(i + 1).padStart(2, '0')).map((m) => ({ value: m, label: periodLabel(`${year}-${m}`) }))]} />
          <Select id="rp-subject" label="الأخصائي / الموظف" value={subject} onChange={(e) => setSubject(e.target.value)} options={[{ value: '', label: 'الكل' }, ...subjects]} />
          <Select id="rp-role" label="الوظيفة" value={role} onChange={(e) => setRole(e.target.value)} options={[{ value: '', label: 'الكل' }, ...Object.entries(ROLE_NAME).map(([value, label]) => ({ value, label }))]} />
          <Select id="rp-pay" label="حالة الصرف" value={payState} onChange={(e) => setPayState(e.target.value)}
            options={[{ value: '', label: 'الكل' }, ...(['not_approved', 'unpaid', 'partial', 'paid', 'nothing'] as const).map((x) => ({ value: x, label: PAY_STATUS[x].label }))]} />
          <Select id="rp-target" label="حالة التارجت" value={tState} onChange={(e) => setTState(e.target.value)}
            options={[{ value: '', label: 'الكل' }, ...Object.entries(TARGET_STATE).map(([value, x]) => ({ value, label: x.label }))]} />
        </FilterBar>
      </div>

      {error ? <div className="card"><div className="alert alert-danger" style={{ margin: 16 }}>{error}</div><ErrorState onRetry={() => setNonce((x) => x + 1)} /></div> : !rows ? <Skeleton h={320} /> : (
        <>
          <div className="kpi-grid" style={{ marginBottom: 16 }}>
            <StatCard icon="wallet" tone="brand" value={money(sum(ths, (r) => r.live.baseSalary))} label="الرواتب الأساسية للأخصائيين (الإعدادات)" />
            <StatCard icon="target" tone="info" value={money(sum(ths, (r) => r.live.bonus))} label="المكافآت المتوقعة" />
            <StatCard icon="checkCircle" tone="ok" value={money(sum(ths, (r) => r.due?.bonusDue ?? 0))} label="المكافآت المعتمدة" />
            <StatCard icon="user" tone="brand" value={money(sum(emps, (r) => r.live.baseSalary))} label="رواتب الموظفين الإداريين (الإعدادات)" />
            <StatCard icon="checkCircle" tone="info" value={money(sum(filtered, due))} label="إجمالي المستحقات المعتمدة" />
            <StatCard icon="wallet" tone="ok" value={money(sum(filtered, paid))} label="إجمالي المصروف" />
            <StatCard icon="clock" tone="warn" value={money(sum(filtered, (r) => (r.due ? Math.max(0, due(r) - paid(r)) : 0)))} label="المتبقي للصرف" />
            <StatCard icon="trend" tone="ok" value={`${reached} / ${withTarget.length}`} label={`حققوا التارجت · ${withTarget.length - reached} لم يحققوا بعد`} />
          </div>
          <p className="muted-sm" style={{ marginTop: -6 }}>المتوقع = حسب الإعدادات والأداء الحالي (غير مضمون). المعتمد = ما جُمّد عند اعتماد الشهر. المصروف = عمليات الصرف المسجّلة فقط. كل رقم مستقل عن الآخر، ولا تُجمع معًا.</p>

          <div className="card">
            <div className="tabs" style={{ overflowX: 'auto' }}>
              {([['summary', 'الملخص'], ['payouts', 'سجل الصرف'], ['audit', 'سجل التعديلات']] as const).map(([id, label]) =>
                <button key={id} className={`tab ${tab === id ? 'active' : ''}`} onClick={() => setTab(id)}>{label}</button>)}
              {tab === 'summary' && <span style={{ marginInlineStart: 'auto', padding: 6 }}><Button size="sm" variant="outline" icon="download" onClick={exportRows}>تصدير Excel (CSV)</Button></span>}
            </div>
            <div className="card__body">
              {tab === 'summary' && (filtered.length === 0 ? <EmptyState icon="receipt" title="ما فيه سجلات مطابقة" /> : (
                <div className="table-wrap"><table className="table">
                  <thead><tr><th>الشهر</th><th>الاسم</th><th>الوظيفة</th><th>الراتب</th><th>التارجت / المحقق</th><th>المكافأة المتوقعة</th><th>المكافأة المعتمدة</th><th>المصروف</th><th>المتبقي</th><th>حالة الصرف</th></tr></thead>
                  <tbody>{filtered.map((r) => {
                    const src = r.due ?? r.live; const ts = targetState(r);
                    return (
                      <tr key={`${r.period}-${r.type}-${r.id}`}>
                        <td style={{ whiteSpace: 'nowrap' }}>{periodLabel(r.period)}<div><StatusBadge label={PERIOD_STATUS[r.periodStatus].label} tone={PERIOD_STATUS[r.periodStatus].tone} /></div></td>
                        <td data-no-i18n><strong>{r.name}</strong></td><td>{ROLE_NAME[r.role] ?? r.role}</td>
                        <td className="num">{r.due ? <>{money(r.due.salaryDue)}<div className="muted-sm">معتمد</div></> : r.live.hasPlan ? <>{money(r.live.baseSalary)}<div className="muted-sm">حسب الإعدادات</div></> : '—'}</td>
                        <td>{r.type === 'therapist' ? <>{src.target > 0 ? <span className="num">{money(src.qualifying)} / {money(src.target)}</span> : <span className="num">{money(src.qualifying)}</span>}
                          <div><StatusBadge label={TARGET_STATE[ts].label} tone={TARGET_STATE[ts].tone} /></div></> : '—'}</td>
                        <td className="num">{r.type === 'therapist' ? money(r.live.bonus) : '—'}</td>
                        <td className="num">{r.due && r.type === 'therapist' ? money(r.due.bonusDue) : '—'}</td>
                        <td className="num">{money(paid(r))}</td>
                        <td className="num">{r.due ? money(Math.max(0, due(r) - paid(r))) : '—'}</td>
                        <td><StatusBadge label={PAY_STATUS[r.payStatus].label} tone={PAY_STATUS[r.payStatus].tone} /></td>
                      </tr>
                    );
                  })}</tbody>
                </table></div>
              ))}
              {tab === 'payouts' && (!logs ? <Skeleton h={200} /> : logs.payouts.length === 0 ? <EmptyState icon="wallet" title="ما فيه عمليات صرف" /> : (
                <div className="table-wrap"><table className="table">
                  <thead><tr><th>السند</th><th>المستفيد</th><th>الوظيفة</th><th>عن شهر</th><th>نوع المستحق</th><th>المبلغ</th><th>تاريخ الصرف</th><th>طريقة الدفع</th><th>المرجع / الملاحظات</th><th>سجّله</th><th>الحالة</th></tr></thead>
                  <tbody>{logs.payouts.filter((p) => !subject || subjects.find((s) => s.value === subject)?.label === p.subject).map((p) => (
                    <tr key={p.id} style={p.status === 'void' ? { opacity: 0.6 } : undefined}>
                      <td className="num" style={{ whiteSpace: 'nowrap' }}>{p.no}</td><td data-no-i18n>{p.subject}</td><td>{ROLE_NAME[p.role ?? ''] ?? p.role}</td><td style={{ whiteSpace: 'nowrap' }}>{periodLabel(p.period)}</td>
                      <td>{PAYOUT_KIND[p.kind]}</td><td className="num" style={{ fontWeight: 600, whiteSpace: 'nowrap' }}>{money(p.amount)}</td><td className="num date" style={{ whiteSpace: 'nowrap' }}>{fmtDate(p.paidOn)}</td>
                      <td>{PAYOUT_METHOD[p.method]}</td><td data-no-i18n>{[p.reference, p.note].filter(Boolean).join(' — ') || '—'}</td>
                      <td data-no-i18n>{p.createdBy ?? '—'}<div className="muted-sm num date">{fmtDateTime(Date.parse(p.createdAt))}</div></td>
                      <td>{p.status === 'paid' ? <StatusBadge label="مصروف" tone="ok" /> : <><StatusBadge label="ملغي" tone="muted" />{p.voidReason && <div className="muted-sm" data-no-i18n>{p.voidReason}</div>}</>}</td>
                    </tr>
                  ))}</tbody>
                </table></div>
              ))}
              {tab === 'audit' && (!logs ? <Skeleton h={200} /> : <AuditList entries={logs.audit} showSubject />)}
            </div>
          </div>
        </>
      )}
    </div>
  );
}
