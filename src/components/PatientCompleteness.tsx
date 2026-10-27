// حالة اكتمال بيانات المريض — نفس العرض في المرضى والمواعيد والفواتير و«حسابات المرضى الأونلاين».
// المنع الفعلي على الخادم (هجرة 159): تأكيد الموعد واعتماد الفاتورة بيترفضوا لو الملف ناقص، ورفض الخادم بيفتح IncompleteHost من أي شاشة.
import { useEffect, useState } from 'react';
import { createPortal } from 'react-dom';
import { useNavigate } from 'react-router-dom';
import { db } from '../data/db';
import { useDbVersion } from '../hooks/useDb';
import { useCan } from './common';
import { INCOMPLETE_MESSAGE, patientGaps } from '../utils/patientGaps';
import type { Patient } from '../types';
import { Button, Modal } from './ui';
import { EditPatientModal } from './PatientForms';

type GapInput = Parameters<typeof patientGaps>[0];

// شارة صغيرة جنب اسم المريض في القوائم ونتايج البحث
export function CompletenessBadge({ patient, full = false }: { patient?: GapInput | null; full?: boolean }) {
  if (!patient) return null;
  const g = patientGaps(patient);
  if (!g.length) return <span className="ok-badge" title="بيانات المريض مكتملة">✓ مكتمل</span>;
  return <span className="gap-badge" title={INCOMPLETE_MESSAGE}>غير مكتمل{full ? `: ${g.join('، ')}` : ''}</span>;
}

// زرار «استكمال البيانات» — بيفتح نافذة تعديل ملف المريض نفسه (من غير ملف جديد). بيظهر بس لصلاحية تعديل المرضى
export function CompleteDataButton({ patientId, size = 'sm', onDone }: { patientId: string; size?: 'sm' | 'md'; onDone?: () => void }) {
  const can = useCan();
  // نسخة الملف وقت الفتح (عشان تحديث الكاش اللحظي مايقفلش النافذة)، والنافذة على مستوى الصفحة (portal) —
  // جوه جدول أو نافذة تانية كانت بتتقص وتوصّل الضغط للصف اللي تحتها
  const [open, setOpen] = useState<Patient | null>(null);
  const p = db.patient(patientId);
  if (!p || !can('patients', 'edit')) return null;
  return (
    <>
      <Button type="button" size={size} icon="edit" onClick={(e) => { e.stopPropagation(); setOpen(p); }}>استكمال البيانات</Button>
      {open && createPortal(<div onClick={(e) => e.stopPropagation()}><EditPatientModal patient={open} onClose={() => { setOpen(null); onDone?.(); }} /></div>, document.body)}
    </>
  );
}

// التنبيه الكامل (الرسالة الحرفية + الناقص + الزرار) — في تفاصيل الموعد والفاتورة وملف المريض ونافذة التأكيد
export function IncompleteAlert({ patientId, showComplete = false, style }: { patientId?: string | null; showComplete?: boolean; style?: React.CSSProperties }) {
  useDbVersion();
  const p = patientId ? db.patient(patientId) : undefined;
  if (!p) return null;
  const g = patientGaps(p);
  if (!g.length) return showComplete ? <div className="alert alert-ok" style={{ marginBottom: 12, ...style }}><div>✓ بيانات المريض مكتملة.</div></div> : null;
  return (
    <div className="alert alert-warn" role="alert" style={{ marginBottom: 12, ...style }}>
      <div style={{ flex: 1 }}>
        <strong>{INCOMPLETE_MESSAGE}</strong>
        <div className="muted-sm" style={{ marginTop: 4 }}>الناقص: {g.join('، ')}</div>
      </div>
      <CompleteDataButton patientId={p.id} />
    </div>
  );
}

// نافذة عامة: أي رفض من الخادم بسبب ملف ناقص (تأكيد/حضور/زيارة مباشرة/اعتماد فاتورة) بيفتحها من أي شاشة
export default function IncompleteHost() {
  const navigate = useNavigate();
  const can = useCan();
  const [ask, setAsk] = useState<{ patientId: string; missing: string } | null>(null);
  const [editing, setEditing] = useState<Patient | null>(null);
  useEffect(() => {
    const on = (e: Event) => setAsk((e as CustomEvent<{ patientId: string; missing: string }>).detail);
    window.addEventListener('patient-incomplete', on);
    return () => window.removeEventListener('patient-incomplete', on);
  }, []);
  if (editing) return createPortal(<EditPatientModal patient={editing} onClose={() => { setEditing(null); setAsk(null); }} />, document.body);
  if (!ask) return null;
  const p = db.patient(ask.patientId);
  return (
    <Modal title="بيانات المريض غير مكتملة" onClose={() => setAsk(null)} footer={
      <>
        <Button variant="outline" onClick={() => setAsk(null)}>إغلاق</Button>
        {p && <Button variant="outline" icon="user" onClick={() => { setAsk(null); navigate(`/patients/${p.id}`); }}>فتح ملف المريض</Button>}
        {p && can('patients', 'edit') && <Button icon="edit" onClick={() => setEditing(p)}>استكمال البيانات</Button>}
      </>
    }>
      <p style={{ marginTop: 0 }}><strong>{INCOMPLETE_MESSAGE}</strong></p>
      {p && <p className="muted" style={{ marginBottom: 6 }}>{p.fullName}{p.fileNo ? ` · ملف ${p.fileNo}` : ''}</p>}
      <p className="muted-sm" style={{ margin: 0 }}>{p ? `الناقص: ${patientGaps(p).join('، ')}` : ask.missing}</p>
    </Modal>
  );
}
