// تشخيصات الجلسات مرتّبة في تفاصيل الخطة/الباقة: التشخيص العام (لو فيه) ثم تشخيص كل جلسة بالترتيب (من هجرة 189).
import { useEffect, useState } from 'react';
import { supabase } from '../lib/supabase';
import { Button, Skeleton } from './ui';
import { useCan } from './common';
import { SessionDiagnosisModal } from './SessionDiagnosisModal';
import { fmtDate } from '../utils/format';

interface Data { total: number; attended: number; items: { no: number; diagnosis: string; updatedAt: string; by: string | null }[] }

export function SessionDiagnosesList({ source, id, title, overall }: { source: 'plan' | 'package'; id: string; title: string; overall?: string }) {
  const can = useCan();
  const [data, setData] = useState<Data | null>(null);
  const [err, setErr] = useState('');
  const [edit, setEdit] = useState(false);
  const load = () => supabase.rpc('session_diagnoses_list', { p_source: source, p_id: id }).then(({ data: d, error }) => { if (error) setErr(error.message.replace(/^.*?ERROR:\s*/, '')); else setData(d as Data); });
  useEffect(() => { if (can('sessions', 'view')) void load(); }, [source, id]);
  if (!can('sessions', 'view')) return null;

  return (
    <div style={{ marginBottom: 14 }}>
      <div className="row-between" style={{ gap: 8, flexWrap: 'wrap', marginBottom: 6 }}>
        <div className="section-title" style={{ margin: 0 }}>التشخيص</div>
        {can('sessions', 'edit') && <Button size="sm" variant="outline" icon="stethoscope" onClick={() => setEdit(true)}>{data && data.items.length ? 'تعديل / إضافة تشخيص جلسة' : 'كتابة تشخيص جلسة'}</Button>}
      </div>
      {err ? <p className="muted-sm" style={{ color: 'var(--danger)' }}>{err}</p> : !data ? <Skeleton h={60} /> : (
        <div className="table-wrap"><table className="table">
          <thead><tr><th style={{ width: 120 }}>النوع</th><th>التشخيص</th><th style={{ width: 190 }}>كتبه</th></tr></thead>
          <tbody>
            <tr>
              <td><strong>التشخيص العام</strong></td>
              <td dir="auto" style={{ whiteSpace: 'pre-wrap' }}>{overall?.trim() ? overall : <span className="muted">لم يُكتب</span>}</td>
              <td className="muted-sm">—</td>
            </tr>
            {Array.from({ length: data.total }, (_, i) => i + 1).map((n) => {
              const x = data.items.find((y) => y.no === n);
              return (
                <tr key={n}>
                  <td><strong>الجلسة <span className="num">{n}</span></strong>{n <= data.attended && <div className="muted-sm">حضر ✓</div>}</td>
                  <td dir="auto" style={{ whiteSpace: 'pre-wrap' }}>{x ? x.diagnosis : <span className="muted">{n > Math.min(data.attended + 1, data.total) ? 'بعد تأكيد حضور الجلسة السابقة' : 'لم يُكتب'}</span>}</td>
                  <td className="muted-sm">{x ? <><span data-no-i18n>{x.by ?? '—'}</span> · <span className="num date">{fmtDate(x.updatedAt.slice(0, 10))}</span></> : '—'}</td>
                </tr>
              );
            })}
          </tbody>
        </table></div>
      )}
      {edit && <SessionDiagnosisModal source={source} id={id} title={title} onClose={() => { setEdit(false); void load(); }} />}
    </div>
  );
}
