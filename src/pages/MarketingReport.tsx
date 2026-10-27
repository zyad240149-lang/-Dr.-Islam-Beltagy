// تقرير التسويق: المرضى الجدد حسب «عرف المركز منين؟» شهريًا — العدد + النوع (ذكر/أنثى) + تصنيف المصدر + مقارنة بالشهر السابق، مع تصدير Excel.
// الأرقام كلها من الخادم (RPC marketing_report) — مش محسوبة من الكاش. المرضى «الضيوف» (حجز مكالمة) مش داخلين فيها.
import { useEffect, useState } from 'react';
import { supabase } from '../lib/supabase';
import { Button, EmptyState, Input, Skeleton } from '../components/ui';
import { StatCard } from '../components/StatCard';
import { REFERRAL_SOURCE_LABEL, riyadhTodayYmd } from '../utils/format';
import { downloadXlsx } from '../utils/xlsx';
import { useToast } from '../hooks/useToast';

interface Report {
  month: string;
  bySource: Array<{ source: string; n: number }>;
  bySourceGender: Array<{ source: string; gender: string; n: number }>;
  previous: Array<{ source: string; n: number }>;
  trend: Array<{ month: string; source: string; n: number }>;
}

// تصنيف المصدر (النوع): بيجمّع المصادر المتشابهة
const SOURCE_TYPE: Record<string, string> = {
  instagram: 'تواصل اجتماعي', facebook: 'تواصل اجتماعي', twitter: 'تواصل اجتماعي', snapchat: 'تواصل اجتماعي', tiktok: 'تواصل اجتماعي', whatsapp: 'تواصل اجتماعي',
  google: 'محركات البحث', website: 'الموقع الإلكتروني', ad: 'إعلان', friend: 'توصية', other: 'أخرى',
};
const srcLabel = (s: string) => REFERRAL_SOURCE_LABEL[s as keyof typeof REFERRAL_SOURCE_LABEL] ?? s;
const srcType = (s: string) => SOURCE_TYPE[s] ?? 'أخرى';
const pct = (n: number, t: number) => (t > 0 ? Math.round((n / t) * 1000) / 10 : 0);

export default function MarketingReport() {
  const toast = useToast();
  const [month, setMonth] = useState(riyadhTodayYmd().slice(0, 7));
  const [data, setData] = useState<Report | null>(null);
  const [err, setErr] = useState('');
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    if (!/^\d{4}-\d{2}$/.test(month)) return;
    let on = true;
    setLoading(true); setErr('');
    supabase.rpc('marketing_report', { p_month: month }).then(({ data: d, error }) => {
      if (!on) return;
      setLoading(false);
      if (error) { setErr(error.message.replace(/^.*?ERROR:\s*/, '')); setData(null); } else setData(d as Report);
    });
    return () => { on = false; };
  }, [month]);

  const total = data?.bySource.reduce((n, x) => n + x.n, 0) ?? 0;
  const prevTotal = data?.previous.reduce((n, x) => n + x.n, 0) ?? 0;
  const prevOf = (s: string) => data?.previous.find((x) => x.source === s)?.n ?? 0;
  const gOf = (s: string, g: string) => data?.bySourceGender.find((x) => x.source === s && x.gender === g)?.n ?? 0;
  const top = data?.bySource[0];

  const exportExcel = () => {
    if (!data) return;
    const head = ['مصدر المعرفة', 'نوع المصدر', 'ذكر', 'أنثى', 'عدد المرضى', 'النسبة %', 'الشهر السابق', 'الفرق'];
    const rows: Array<Array<string | number>> = [
      ['تقرير التسويق — كيف عرف المريض عن المركز'], ['الشهر', data.month], [], head,
      ...data.bySource.map((x) => [srcLabel(x.source), srcType(x.source), gOf(x.source, 'male'), gOf(x.source, 'female'), x.n, pct(x.n, total), prevOf(x.source), x.n - prevOf(x.source)]),
      ['الإجمالي', '', data.bySourceGender.filter((x) => x.gender === 'male').reduce((n, x) => n + x.n, 0), data.bySourceGender.filter((x) => x.gender === 'female').reduce((n, x) => n + x.n, 0), total, total ? 100 : 0, prevTotal, total - prevTotal],
    ];
    const months = Array.from(new Set(data.trend.map((t) => t.month))).sort();
    const sources = Array.from(new Set(data.trend.map((t) => t.source))).sort();
    const matrix: Array<Array<string | number>> = [['الشهر', ...sources.map(srcLabel), 'الإجمالي'],
      ...months.map((m) => { const vals = sources.map((s) => data.trend.find((t) => t.month === m && t.source === s)?.n ?? 0); return [m, ...vals, vals.reduce((a, b) => a + b, 0)]; })];
    downloadXlsx(`تقرير-التسويق-${data.month}`, [
      { name: 'ملخص الشهر', rows, widths: [26, 20, 10, 10, 14, 12, 14, 10], headerRows: [3] },
      { name: 'آخر 12 شهر', rows: matrix, widths: [14, ...sources.map(() => 14), 12], headerRows: [0] },
    ]);
    toast.success('تم تجهيز ملف Excel.');
  };

  return (
    <div className="page">
      <div className="page-head">
        <div><h1>تقرير التسويق</h1><p>كيف عرف المرضى الجدد عن المركز — حسب المصدر والنوع، شهريًا.</p></div>
        <Button icon="download" onClick={exportExcel} disabled={!data || loading}>تصدير Excel</Button>
      </div>
      <div className="card" style={{ marginBottom: 16 }}><div className="card__body" style={{ maxWidth: 260 }}>
        <Input id="mk-month" label="الشهر" type="month" value={month} max={riyadhTodayYmd().slice(0, 7)} onChange={(e) => setMonth(e.target.value)} />
      </div></div>
      {loading && !data ? <Skeleton h={220} /> : err ? <EmptyState icon="alert" title="تعذّر تحميل التقرير" text={err} /> : data && (
        <>
          <div className="kpi-grid" style={{ marginBottom: 16 }}>
            <StatCard icon="users" tone="brand" value={total} label="مرضى جدد هالشهر" />
            <StatCard icon="trend" tone="info" value={prevTotal} label="الشهر السابق" />
            <StatCard icon="spark" tone="ok" value={top ? srcLabel(top.source) : '—'} label="أعلى مصدر" />
          </div>
          <div className="card"><div className="card__body">
            {data.bySource.length === 0 ? <EmptyState icon="inbox" title="ما فيه مرضى جدد في هالشهر" /> : (
              <div className="table-wrap"><table className="table">
                <thead><tr><th>مصدر المعرفة</th><th>نوع المصدر</th><th>ذكر</th><th>أنثى</th><th>عدد المرضى</th><th>النسبة</th><th>الشهر السابق</th><th>الفرق</th></tr></thead>
                <tbody>
                  {data.bySource.map((x) => (
                    <tr key={x.source}>
                      <td style={{ fontWeight: 600 }}>{srcLabel(x.source)}</td><td>{srcType(x.source)}</td>
                      <td className="num">{gOf(x.source, 'male')}</td><td className="num">{gOf(x.source, 'female')}</td>
                      <td className="num" style={{ fontWeight: 700 }}>{x.n}</td><td className="num">{pct(x.n, total)}%</td>
                      <td className="num">{prevOf(x.source)}</td>
                      <td className="num" style={{ color: x.n - prevOf(x.source) >= 0 ? 'var(--ok)' : 'var(--danger)' }}>{x.n - prevOf(x.source) > 0 ? '+' : ''}{x.n - prevOf(x.source)}</td>
                    </tr>
                  ))}
                  <tr style={{ fontWeight: 800, background: 'var(--bg-soft, #f6f8fa)' }}>
                    <td>الإجمالي</td><td />
                    <td className="num">{data.bySourceGender.filter((x) => x.gender === 'male').reduce((n, x) => n + x.n, 0)}</td>
                    <td className="num">{data.bySourceGender.filter((x) => x.gender === 'female').reduce((n, x) => n + x.n, 0)}</td>
                    <td className="num">{total}</td><td className="num">{total ? '100%' : '—'}</td><td className="num">{prevTotal}</td><td className="num">{total - prevTotal > 0 ? '+' : ''}{total - prevTotal}</td>
                  </tr>
                </tbody>
              </table></div>
            )}
          </div></div>
        </>
      )}
    </div>
  );
}
