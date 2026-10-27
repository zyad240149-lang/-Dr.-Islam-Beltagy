// تشخيص كل جلسة — خانة واحدة تتكتب يدويًا. الجلسة الأولى في أي وقت، والجلسة اللي بعدها بعد تأكيد حضور اللي قبلها
// (الخادم بيفرض القاعدة: session_diagnosis_save — هجرة 189). تشتغل على الخطة العلاجية أو الباقة بنفس الشكل.
import { useEffect, useState } from 'react';
import { supabase } from '../lib/supabase';
import { Button, Modal, Skeleton } from './ui';
import { useToast } from '../hooks/useToast';
import { fmtDate } from '../utils/format';

type Source = 'plan' | 'package';
interface Item { no: number; diagnosis: string; updatedAt: string; by: string | null }
interface Data { total: number; attended: number; items: Item[] }
const clean = (m: string) => m.replace(/^.*?ERROR:\s*/, '').replace(/\s*\(SQLSTATE.*$/, '');

export function SessionDiagnosisModal({ source, id, title, onClose }: { source: Source; id: string; title: string; onClose: () => void }) {
  const toast = useToast();
  const [data, setData] = useState<Data | null>(null);
  const [err, setErr] = useState('');
  const [no, setNo] = useState(1);
  const [text, setText] = useState('');
  const [busy, setBusy] = useState(false);

  const load = async (pick?: number) => {
    const { data: d, error } = await supabase.rpc('session_diagnoses_list', { p_source: source, p_id: id });
    if (error) { setErr(clean(error.message)); return; }
    const dd = d as Data;
    setData(dd);
    const open = Math.min(dd.attended + 1, dd.total);       // آخر جلسة متاحة للكتابة
    const target = pick ?? open;
    setNo(target);
    setText(dd.items.find((x) => x.no === target)?.diagnosis ?? '');
  };
  useEffect(() => { void load(); }, [source, id]);

  const open = data ? Math.min(data.attended + 1, data.total) : 1;
  const choose = (n: number) => { setNo(n); setText(data?.items.find((x) => x.no === n)?.diagnosis ?? ''); };
  const save = async () => {
    if (!text.trim()) { toast.error('اكتب التشخيص.'); return; }
    setBusy(true);
    const { error } = await supabase.rpc('session_diagnosis_save', { p_source: source, p_id: id, p_session_no: no, p_text: text });
    setBusy(false);
    if (error) { toast.error(clean(error.message)); return; }
    toast.success(`تم حفظ تشخيص الجلسة ${no}.`);
    void load(no);
  };

  return (
    <Modal title={`تشخيص الجلسات — ${title}`} onClose={onClose}
      footer={<><Button variant="outline" onClick={onClose}>إغلاق</Button><Button icon="check" loading={busy} onClick={save} disabled={!data}>حفظ تشخيص الجلسة {no}</Button></>}>
      {err ? <p style={{ color: 'var(--danger)' }}>{err}</p> : !data ? <Skeleton h={160} /> : (
        <>
          <p className="muted-sm" style={{ marginTop: 0 }}>
            اكتب تشخيص كل جلسة بنفسك. الجلسة الأولى تقدر تكتب لها من الحين، وتشخيص الجلسة اللي بعدها يفتح بعد تأكيد حضور اللي قبلها.
            {' '}<span>الحضور المؤكَّد:</span> <b className="num">{data.attended}</b> <span>من</span> <b className="num">{data.total}</b>.
          </p>
          <div className="seg" role="group" aria-label="رقم الجلسة" style={{ flexWrap: 'wrap', marginBottom: 12 }}>
            {Array.from({ length: data.total }, (_, i) => i + 1).map((n) => {
              const locked = n > open;
              const has = data.items.some((x) => x.no === n);
              return (
                <button key={n} type="button" disabled={locked} className={`seg__btn ${no === n ? 'active' : ''}`} onClick={() => choose(n)}
                  title={locked ? `بعد تأكيد حضور الجلسة ${n - 1}` : undefined}>
                  <span>جلسة</span> <span className="num">{n}</span>{has ? ' ✓' : ''}
                </button>
              );
            })}
          </div>
          <div className="field">
            <label htmlFor="sd-text">تشخيص الجلسة {no}</label>
            <textarea id="sd-text" className="input" rows={5} maxLength={1000} value={text} onChange={(e) => setText(e.target.value)} placeholder="اكتب التشخيص هنا" autoFocus />
            <div className="field__hint">
              {data.items.find((x) => x.no === no)
                ? <>آخر تعديل: {data.items.find((x) => x.no === no)!.by ?? '—'} · <span className="num">{fmtDate(data.items.find((x) => x.no === no)!.updatedAt.slice(0, 10))}</span></>
                : 'ما اتكتب تشخيص لهذي الجلسة بعد.'}
            </div>
          </div>
        </>
      )}
    </Modal>
  );
}
