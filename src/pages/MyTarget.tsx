import { useCallback, useEffect, useState } from 'react';
import { EmptyState, ErrorState, Select, Skeleton, StatusBadge } from '../components/ui';
import { BarChart } from '../components/common';
import { StatCard } from '../components/StatCard';
import { fmtDate, fmtShortDate, money } from '../utils/format';
import { payrollApi, currentPeriod, shiftPeriod, type MyTarget as MT } from '../data/payrollApi';
import { motivation } from '../data/targetMessages';
import { BONUS_METHOD_LABEL, CONDITION_LABEL, PAYMENT_STATE, periodLabel, pct } from '../components/PayrollKit';

// «تارجتي هذا الشهر» — لوحة الأخصائي الشخصية: بياناته هو بس (الخادم بيحدد الأخصائي من حساب الدخول، مش من الواجهة).
export default function MyTarget() {
  const [period, setPeriod] = useState(currentPeriod());
  const [d, setD] = useState<MT | null>(null);
  const [error, setError] = useState<string | null>(null);
  const load = useCallback(async () => {
    setError(null);
    const r = await payrollApi.myTarget(period);
    if (!r.ok) { setError(r.error); return; }
    setD(r.data);
  }, [period]);
  useEffect(() => { setD(null); load(); }, [load]);
  // تحديث تلقائي كل دقيقتين وهو فاتح الصفحة (زيارة اتسجّلت / فاتورة اتدفعت)
  useEffect(() => { const t = setInterval(load, 120000); return () => clearInterval(t); }, [load]);

  const hasTarget = !!d && d.target > 0;
  const day = d ? Number(d.today.slice(8, 10)) : 1;
  const m = d ? motivation({ hasTarget, pct: d.pct, reached: d.reached, dayOfMonth: period === currentPeriod() ? day : 31 }) : null;
  const shown = Math.min(100, d?.pct ?? 0);
  let running = 0;
  const cumulative = (d?.daily ?? []).map((x) => { running += x.amount; return { label: fmtShortDate(x.date), value: Math.round(running) }; });
  const basisText = d?.basis === 'invoiced' ? 'فواتير مواعيدك المؤكدة' : 'المحصّل فعليًا من فواتير مواعيدك المؤكدة';

  return (
    <div className="page">
      <div className="page-head">
        <div><h1>تارجتي هالشهر</h1><p>تقدّمك نحو الهدف الشهري الذي حدده المدير — بياناتك أنت فقط.</p></div>
        <div style={{ minWidth: 190 }}><Select id="mt-period" label="الشهر" value={period} onChange={(e) => setPeriod(e.target.value)}
          options={[0, -1, -2, -3, -4, -5].map((i) => shiftPeriod(currentPeriod(), i)).map((p) => ({ value: p, label: periodLabel(p) }))} /></div>
      </div>

      {error && !d ? <div className="card"><div className="alert alert-danger" style={{ margin: 16 }}>{error}</div><ErrorState onRetry={load} /></div> : !d || !m ? <Skeleton h={340} /> : (
        <>
          <div className="card" style={{ marginBottom: 16 }}>
            <div className="card__body">
              <div className={`alert alert-${m.tone === 'warn' ? 'warn' : m.tone === 'ok' ? 'ok' : 'info'}`} style={{ fontSize: 17, fontWeight: 600, marginBottom: 14 }}>{m.text}</div>
              {hasTarget ? (
                <>
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', flexWrap: 'wrap', gap: 8 }}>
                    <div><span className="num" style={{ fontSize: 34, fontWeight: 800 }}>{pct(d.pct)}</span> <span className="muted">من التارجت</span></div>
                    <StatusBadge label={d.reached ? (d.pct != null && d.pct > 100 ? 'تجاوزت التارجت' : 'حققت التارجت') : 'للحين في الطريق'} tone={d.reached ? 'ok' : 'info'} />
                  </div>
                  <div className="progress" style={{ height: 16, margin: '10px 0 8px' }} role="progressbar" aria-valuenow={Math.round(shown)} aria-valuemin={0} aria-valuemax={100}>
                    <i style={{ width: `${shown}%`, background: d.reached ? 'var(--ok)' : undefined }} />
                  </div>
                  <div className="muted-sm">المحقق <span className="num">{money(d.qualifying)}</span> من <span className="num">{money(d.target)}</span> · المتبقي <span className="num">{money(d.remaining ?? 0)}</span></div>
                </>
              ) : <p className="muted" style={{ margin: 0 }}>عندما يحدد المدير تارجتك سيظهر هنا شريط التقدم والنسبة.</p>}
            </div>
          </div>

          <div className="kpi-grid" style={{ marginBottom: 16 }}>
            <StatCard icon="target" tone="brand" value={hasTarget ? money(d.target) : '—'} label="التارجت الشهري" />
            <StatCard icon="trend" tone="ok" value={money(d.qualifying)} label="الإيراد المؤهل المحقق" />
            <StatCard icon="clock" tone="warn" value={hasTarget ? money(d.remaining ?? 0) : '—'} label="المتبقي للوصول" />
            <StatCard icon="checkCircle" tone="info" value={d.qualifyingVisits} label="الزيارات المؤهلة" />
            <StatCard icon="calendar" tone="brand" value={d.daysLeft} label="الأيام المتبقية في الشهر" />
          </div>

          <div className="card" style={{ marginBottom: 16 }}>
            <div className="card__body">
              <h3 style={{ marginTop: 0 }}>المكافأة</h3>
              {d.bonusMethod === 'none' || !hasTarget ? <p className="muted" style={{ margin: 0 }}>ما فيه مكافأة تارجت محددة لهذا الشهر.</p> : (
                <>
                  <p className="muted-sm" style={{ marginTop: 0 }}>{BONUS_METHOD_LABEL[d.bonusMethod]}{d.bonusMethod === 'fixed' ? ` (${money(d.bonusFixed)})` : ` (${pct(d.bonusRate)})`} · {CONDITION_LABEL[d.bonusCondition]}</p>
                  <div className="kpi-grid" style={{ gridTemplateColumns: 'repeat(auto-fit, minmax(170px, 1fr))' }}>
                    <div className="card" style={{ padding: '12px 14px' }}><div className="muted-sm">المكافأة المتوقعة عند تحقيق التارجت</div>
                      <div className="num" style={{ fontSize: 20, fontWeight: 700 }}>{money(d.bonusAtTarget)}{d.bonusMethod === 'pct_revenue' ? '+' : ''}</div>
                      <div className="muted-sm">تقدير غير مضمون{d.bonusCondition === 'exceed' ? ' — بشرط تتجاوز التارجت' : ''}</div></div>
                    <div className="card" style={{ padding: '12px 14px' }}><div className="muted-sm">المستحقة وفق الشروط للحين</div>
                      <div className="num" style={{ fontSize: 20, fontWeight: 700 }}>{d.eligible ? money(d.bonus) : money(0)}</div>
                      <div className="muted-sm">{d.eligible ? 'استوفيت شرط الاستحقاق' : 'لم يتحقق الشرط بعد'}</div></div>
                    <div className="card" style={{ padding: '12px 14px' }}><div className="muted-sm">اعتمدها المدير</div>
                      <div className="num" style={{ fontSize: 20, fontWeight: 700 }}>{d.approvedBonus != null ? money(d.approvedBonus) : '—'}</div>
                      <div className="muted-sm">{d.approved ? 'الشهر معتمد' : 'بعد اعتماد الشهر'}</div></div>
                    <div className="card" style={{ padding: '12px 14px' }}><div className="muted-sm">صُرفت فعليًا</div>
                      <div className="num" style={{ fontSize: 20, fontWeight: 700 }}>{money(d.paidBonus)}</div>
                      <div className="muted-sm">حسب عمليات الصرف المسجّلة</div></div>
                  </div>
                </>
              )}
            </div>
          </div>

          <div className="card" style={{ marginBottom: 16 }}>
            <div className="card__body">
              <h3 style={{ marginTop: 0 }}>تقدمك خلال الشهر</h3>
              <p className="muted-sm" style={{ marginTop: 0 }}>الإيراد المؤهل التراكمي بالأيام ({basisText}، بعد الخصم ودون الضريبة).</p>
              {cumulative.length === 0 ? <EmptyState icon="trend" title="ما فيه زيارات مؤهلة في هالشهر بعد" /> : <BarChart data={cumulative} format={(n) => money(n)} />}
            </div>
          </div>

          <div className="card">
            <div className="card__body">
              <h3 style={{ marginTop: 0 }}>زياراتك المنفذة <span className="muted-sm num">({d.visits})</span></h3>
              {d.visitsList.length === 0 ? <EmptyState icon="calendar" title="ما فيه زيارات منفذة" /> : (
                <div className="table-wrap"><table className="table">
                  <thead><tr><th>التاريخ</th><th>رقم الملف</th><th>الخدمة</th><th>قيمة الزيارة</th><th>المحتسب في التارجت</th><th>حالة الدفع</th></tr></thead>
                  <tbody>{d.visitsList.map((v, i) => (
                    <tr key={i}>
                      <td className="num" style={{ whiteSpace: 'nowrap' }}>{fmtDate(v.date)}</td><td className="num" data-no-i18n>{String(v.fileNo ?? "").replace(/\D/g, "")}</td><td>{v.service}</td>
                      <td className="num">{money(v.valueNet)}</td><td className="num" style={{ fontWeight: 600 }}>{money(v.qualifying)}</td>
                      <td><StatusBadge label={PAYMENT_STATE[v.paymentStatus]?.label ?? v.paymentStatus} tone={PAYMENT_STATE[v.paymentStatus]?.tone ?? 'muted'} /></td>
                    </tr>
                  ))}</tbody>
                </table></div>
              )}
              {d.booked > 0 && <p className="muted-sm" style={{ marginBottom: 0 }}>{d.basis === 'invoiced' ? `عندك ${d.booked} حجز مؤكد في هالشهر — سيدخل التارجت بعد تنفيذ الزيارة.` : `عندك ${d.booked} حجز مؤكد في هالشهر — سيدخل التارجت بعد تنفيذ الزيارة وتحصيلها.`}</p>}
            </div>
          </div>
        </>
      )}
    </div>
  );
}
