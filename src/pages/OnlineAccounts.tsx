// «حسابات المرضى الأونلاين»: كل الحسابات اللي المرضى عملوها بنفسهم (الموقع/تطبيق المرضى/جوجل) — حجزوا أو لأ.
// البيانات من الخادم مباشرة (RPC online_accounts — هجرة 159) مربوطة بملف المريض الموجود؛ الاستكمال بيعدّل نفس الملف (من غير ملف جديد).
// وحدة «المرضى» زي ما هي.
import { useEffect, useState, type ReactNode } from 'react';
import { useNavigate } from 'react-router-dom';
import { supabase } from '../lib/supabase';
import { EmptyState, ErrorState, Input, Skeleton, StatusBadge } from '../components/ui';
import { CompleteDataButton } from '../components/PatientCompleteness';
import { INCOMPLETE_MESSAGE } from '../utils/patientGaps';
import { fmtDate } from '../utils/format';
import { useDbVersion } from '../hooks/useDb';
import { db } from '../data/db';
import { normalizeSearch, phoneMatches } from '../utils/phoneUtils';

interface Account {
  customerId: string; patientId: string | null; name: string; phone: string; fileNo: string | null;
  idType: string | null; nationalId: string | null; memberSince: string; email: string | null; signupMethod: 'google' | 'phone';
  missing: string[]; bookings: number; onlineBookings: number; nextDate: string | null; lastDate: string | null;
}

const bookingState = (a: Account): { label: string; tone: string } =>
  a.nextDate ? { label: `حجز قادم ${fmtDate(a.nextDate)}`, tone: 'info' }
    : a.bookings > 0 ? { label: `حجز سابق${a.lastDate ? ` (${fmtDate(a.lastDate)})` : ''}`, tone: 'ok' }
      : { label: 'لم يحجز بعد', tone: 'muted' };

export default function OnlineAccounts({ tabs }: { tabs?: ReactNode }) {
  const navigate = useNavigate();
  const v = useDbVersion(); // بعد «استكمال البيانات» الكاش بيتحدّث ← نعيد التحميل عشان الحالة تتغيّر
  const [q, setQ] = useState('');
  const [rows, setRows] = useState<Account[] | null>(null);
  const [err, setErr] = useState('');
  const [tick, setTick] = useState(0);

  useEffect(() => {
    let on = true;
    const t = setTimeout(() => {
      supabase.rpc('online_accounts', { p_q: q.trim() }).then(({ data, error }) => {
        if (!on) return;
        if (error) { setErr(error.message.replace(/^.*?ERROR:\s*/, '')); setRows([]); } else { setErr(''); setRows(((data ?? []) as Account[]).filter((a) => a.missing.length > 0)); } // المكتمل بيختفي من هنا — القائمة للحسابات اللي لسه تحتاج استكمال بس
      });
    }, q ? 300 : 0);
    return () => { on = false; clearTimeout(t); };
  }, [q, tick, v]);

  // حجوزات بالمكالمة: المتصل اتسجّل باسمه وجواله بس — لما ييجي تستكمل بياناته من هنا (وبيتحوّل لملف عادي في «المرضى»)
  const today = new Date().toISOString().slice(0, 10);
  const callRows = db.guests()
    .filter((g) => !q.trim() || normalizeSearch(g.fullName).includes(normalizeSearch(q)) || phoneMatches(g.phone, q))
    .map((g) => {
      const appts = db.appointmentsForPatient(g.id).filter((a) => a.status !== 'cancelled');
      const next = appts.filter((a) => a.date >= today).sort((a, b) => (a.date + a.time).localeCompare(b.date + b.time))[0];
      return { g, next, last: appts[0] };
    })
    .sort((a, b) => (a.next?.date ?? '9999').localeCompare(b.next?.date ?? '9999'));

  return (
    <div className="page">
      <div className="page-head">
        <div><h1>حجز مكالمات وحسابات أونلاين</h1><p>الحسابات اللي المرضى عملوها من الموقع أو التطبيق، والحجوزات اللي اتعملت عن طريق مكالمة — وبياناتهم لسه محتاجة استكمال. بيختفوا من هنا بعد الاكتمال.</p></div>
      </div>
      {tabs}
      <div className="card" style={{ marginBottom: 16 }}><div className="card__body">
        <Input id="oa-q" label="بحث" placeholder="الاسم أو رقم الجوال أو رقم الملف أو الرقم القومي" value={q} onChange={(e) => setQ(e.target.value)} />
        {rows && <p className="muted-sm" style={{ margin: 0 }}><span className="num">{rows.length}</span> حساب بيانات غير مكتملة</p>}
      </div></div>
      {callRows.length > 0 && (
        <div className="card" style={{ marginBottom: 16 }}>
          <div className="card__body" style={{ paddingBottom: 0 }}><h3 style={{ margin: 0 }}>حجز عن طريق مكالمة — محتاج استكمال بيانات <span className="badge badge--warn num">{callRows.length}</span></h3>
            <p className="muted-sm" style={{ margin: '4px 0 0' }}>اتسجّلوا باسمهم وجوالهم بس وقت المكالمة. لما المريض ييجي اضغط «استكمال البيانات» — بيتحوّل لملف عادي في «المرضى» ويختفي من هنا.</p></div>
          <div className="table-wrap"><table className="table">
            <thead><tr><th>المريض</th><th>الجوال</th><th>الحجز</th><th></th></tr></thead>
            <tbody>{callRows.map(({ g, next, last }) => (
              <tr key={g.id}>
                <td style={{ fontWeight: 600, minWidth: 160 }}>{g.fullName}<div className="muted-sm" style={{ fontWeight: 400 }}>حجز عن طريق مكالمة</div></td>
                <td className="num" style={{ whiteSpace: 'nowrap' }}><span dir="ltr">{g.phone || '—'}</span></td>
                <td>{next ? <StatusBadge label={`حجز قادم ${fmtDate(next.date)}`} tone="info" /> : last ? <StatusBadge label={`حجز سابق (${fmtDate(last.date)})`} tone="ok" /> : <StatusBadge label="مفيش حجز" tone="muted" />}</td>
                <td><CompleteDataButton patientId={g.id} onDone={() => setTick((x) => x + 1)} /></td>
              </tr>
            ))}</tbody>
          </table></div>
        </div>
      )}
      {err ? <ErrorState onRetry={() => setTick((x) => x + 1)} /> : rows === null ? <Skeleton h={220} /> : rows.length === 0 ? (
        <EmptyState icon="user" title={q ? 'ما فيه نتائج مطابقة' : 'ما فيه حسابات تحتاج استكمال'} text={q ? 'جرّب الاسم أو الجوال أو رقم الملف أو الهوية.' : 'تظهر الحسابات هنا فور تسجيل المريض من الموقع أو التطبيق، وتختفي بعد اكتمال بياناته.'} />
      ) : (
        <div className="card"><div className="table-wrap"><table className="table">
          <thead><tr><th>المريض</th><th>الجوال</th><th>رقم الملف</th><th>الرقم القومي / الجواز</th><th>اكتمال البيانات</th><th>الحجز</th><th></th></tr></thead>
          <tbody>{rows.map((a) => {
            const bs = bookingState(a);
            return (
              <tr key={a.customerId} style={{ cursor: a.patientId ? 'pointer' : undefined }} onClick={() => a.patientId && navigate(`/patients/${a.patientId}`)}>
                <td style={{ fontWeight: 600, minWidth: 160 }}>{a.name}<div className="muted-sm" style={{ fontWeight: 400 }}>{a.signupMethod === 'google' ? 'تسجيل بجوجل' : 'تسجيل بالجوال'} · {fmtDate(a.memberSince.slice(0, 10))}</div></td>
                <td className="num" style={{ whiteSpace: 'nowrap' }}><span dir="ltr">{a.phone || '—'}</span></td>
                <td className="num">{a.fileNo || '—'}</td>
                <td>{a.nationalId ? <><span className="num" style={{ whiteSpace: 'nowrap' }}>{a.nationalId}</span><div className="muted-sm">{a.idType ?? ''}</div></> : <span className="muted">{a.idType ? `${a.idType} — غير مسجّل` : 'غير مسجّل'}</span>}</td>
                <td>{a.missing.length === 0 ? <span className="ok-badge">✓ مكتمل</span>
                  : <span className="gap-badge" title={INCOMPLETE_MESSAGE}>غير مكتمل: {a.missing.join('، ')}</span>}</td>
                <td><StatusBadge label={bs.label} tone={bs.tone} />{a.onlineBookings > 0 && <div className="muted-sm"><span className="num">{a.onlineBookings}</span> حجز أونلاين</div>}</td>
                <td onClick={(e) => e.stopPropagation()}>{a.missing.length > 0 && a.patientId && <CompleteDataButton patientId={a.patientId} onDone={() => setTick((x) => x + 1)} />}</td>
              </tr>
            );
          })}</tbody>
        </table></div></div>
      )}
    </div>
  );
}
