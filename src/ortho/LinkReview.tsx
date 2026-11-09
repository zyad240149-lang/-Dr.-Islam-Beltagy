// قايمة مراجعة داخلية (الإعدادات — للإدارة بس): تشخيصات اتعملت بالاسم من غير ملف مريض والخادم مش متأكد يربطها بأنهي ملف
// (أكتر من ملف بنفس الاسم، أو الموبايل على ملف باسم مختلف). مابتظهرش للدكتور في شاشة التشخيص — الربط الأكيد بيحصل تلقائي،
// واللي فيه شك بيستنى هنا لحد ما حد من الإدارة يختار الملف الصح (مفيش ربط بملف غلط).
import { useState } from 'react';
import { ortho, useOrthoVersion, isUnlinked, type Consultation } from './data';
import { PatientSelect, useRun } from './kit';
import { Button, EmptyState } from '../components/ui';
import { fmtDate } from '../utils/format';
import { useOfflineState } from '../offline';

function Row({ c }: { c: Consultation }) {
  const { run, busy } = useRun();
  const [pid, setPid] = useState('');
  const pp = c.pendingPatient;
  return (
    <div className="dx-queue__row" data-review={c.id}>
      <span className="dx-queue__time num">{fmtDate(c.date)}</span>
      <div className="dx-queue__who">
        <b>{pp?.name || '—'}</b>
        <small>
          {pp?.phone && <><bdi dir="ltr" className="num">{pp.phone}</bdi> · </>}{pp?.age && <>السن <span className="num">{pp.age}</span> · </>}
          {c.diagnosis || 'التشخيص لسه ما اتحددش'}{c.linkNote ? ` — ${c.linkNote}` : ''}
        </small>
      </div>
      <div style={{ minWidth: 260 }}><PatientSelect value={pid} onChange={setPid} /></div>
      <Button size="sm" disabled={!pid} loading={busy} onClick={() => run(() => ortho.link(c.id, pid), 'اتربط التشخيص بملف المريض')}>ربط</Button>
    </div>
  );
}

export function LinkReview() {
  useOrthoVersion();
  const { online } = useOfflineState();
  // «مراجعة» = الخادم شاف أكتر من احتمال. «بانتظار ملف» أقدم من ٣ أيام = غالبًا الاستقبال ما فتحش ملف — برضه يتراجع
  const old = new Date(Date.now() - 3 * 86400000).toISOString().slice(0, 10);
  const items = ortho.list('consultations')
    .filter((c) => isUnlinked(c) && !(c as Consultation & { pendingSync?: boolean }).pendingSync && (c.linkStatus === 'review' || (c.linkStatus === 'waiting' && c.date < old)))
    .sort((a, b) => b.date.localeCompare(a.date));
  return (
    <div>
      <p className="muted" style={{ marginTop: 0 }}>
        تشخيصات اتعملت بالاسم من غير ملف، والنظام مش متأكد من ملف المريض الصح (ملفات بنفس الاسم أو الموبايل على ملف تاني).
        القايمة دي داخلية ومابتظهرش للدكتور — اختار الملف الصح واضغط «ربط». الربط الأكيد بيحصل تلقائي من غير ما يظهر هنا.
      </p>
      {!online && <div className="alert alert-info" style={{ marginBottom: 12 }}>الربط محتاج اتصال بالإنترنت.</div>}
      {items.length === 0 ? <EmptyState icon="checkCircle" title="مفيش تشخيصات محتاجة مراجعة" />
        : <div className="dx-queue">{items.map((c) => <Row key={c.id} c={c} />)}</div>}
    </div>
  );
}
