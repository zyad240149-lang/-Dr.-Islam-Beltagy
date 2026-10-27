// نافذة «إرسال طلب جلسة ثانية للمدير» — بتظهر من أي شاشة لما الخادم يرفض جلسة تانية لنفس المريض في نفس اليوم
// (المواعيد / الجلسات / «إكمال الجلسة التالية» في الخطة). الطلب بيروح للمدير في «حضور مرضى الباقات» + إشعار.
import { useEffect, useState } from 'react';
import { supabase } from '../lib/supabase';
import { db, type SecondSessionAsk } from '../data/db';
import { Button, Modal } from './ui';
import { useAuth } from '../services/auth';
import { useToast } from '../hooks/useToast';

export default function SecondSessionHost() {
  const toast = useToast();
  const { user } = useAuth();
  const [ask, setAsk] = useState<SecondSessionAsk | null>(null);
  const [doctorId, setDoctorId] = useState('');
  const [busy, setBusy] = useState(false);
  useEffect(() => {
    const on = (e: Event) => { const d = (e as CustomEvent<SecondSessionAsk>).detail; setAsk(d); setDoctorId(user?.therapistId || d.therapistId || ''); };
    window.addEventListener('second-session-ask', on);
    return () => window.removeEventListener('second-session-ask', on);
  }, [user?.therapistId]);
  if (!ask) return null;
  const send = async () => {
    if (!doctorId) { toast.error('اختر الدكتور.'); return; }
    setBusy(true);
    const { error } = await supabase.rpc('request_second_session', { p_source: ask.source, p_id: ask.id, p_therapist: doctorId, p_note: '' });
    setBusy(false);
    if (error) { toast.error(error.message.replace(/^.*?ERROR:\s*/, '')); return; }
    toast.success('تم إرسال طلب الجلسة الثانية للمدير — ستُسجَّل فور موافقته.');
    setAsk(null);
  };
  return (
    <Modal title="جلسة ثانية في نفس اليوم" onClose={() => !busy && setAsk(null)} footer={
      <><Button variant="outline" onClick={() => setAsk(null)} disabled={busy}>إلغاء</Button><Button icon="check" onClick={send} loading={busy}>إرسال طلب للمدير</Button></>
    }>
      <p style={{ marginTop: 0 }}>المريض <strong>{db.patient(ask.patientId)?.fullName ?? ''}</strong> أخذ جلسة اليوم بالفعل. الجلسة الثانية في اليوم نفسه تحتاج إلى موافقة المدير — أرسل له طلب، وستُسجَّل الجلسة فور موافقته.</p>
      {/* الدكتور = الدكتور اللي فاتح السيستم (ولو الحساب مش دكتور: دكتور الخطة/الموعد) — من غير اختيار */}
      <dl className="review-list"><div><dt>الدكتور</dt><dd><strong>{db.therapist(doctorId)?.name ?? '—'}</strong></dd></div></dl>
    </Modal>
  );
}
