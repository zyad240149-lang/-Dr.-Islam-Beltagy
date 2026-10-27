// «إرسال واتساب يدوي» من «إشعارات المرضى»: فلترة المرضى (المستلمين/الجنس/الطبيب/مصدر المعرفة/بحث) ← تحديد المستهدفين
// ← الرسالة ← إرسال واحد واحد (واتساب مابيسمحش بإرسال جماعي من الويب: كل ضغطة بتفتح محادثة المريض والرسالة جاهزة).
// كل رسالة بتتسجّل في سجل واتساب (sendWhatsApp). الصلاحية: whatsapp/create.
import { useEffect, useMemo, useState } from 'react';
import { db } from '../data/db';
import { Button, Input, Select, StatusBadge } from './ui';
import { sendWhatsApp } from '../data/whatsappSend';
import { useToast } from '../hooks/useToast';
import { patientMatches } from '../utils/phoneUtils';
import { REFERRAL_SOURCE_LABEL } from '../utils/format';
import type { CampaignAudience, Patient } from '../types';

export function WhatsappBulkCard({ fetchAudience, audienceOptions, defaultText }: { fetchAudience: (a: CampaignAudience) => Promise<Patient[]>; audienceOptions: { value: string; label: string }[]; defaultText: string }) {
  const [audience, setAudience] = useState<CampaignAudience>('all');
  const [base, setBase] = useState<Patient[]>([]);
  useEffect(() => {
    let live = true;
    void fetchAudience(audience).then((r) => { if (live) setBase(r); });
    return () => { live = false; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [audience, db.appointments().length, db.patients().length]);
  const toast = useToast();
  const [gender, setGender] = useState('');
  const [doctor, setDoctor] = useState('');
  const [source, setSource] = useState('');
  const [q, setQ] = useState('');
  const [text, setText] = useState('');
  const [picked, setPicked] = useState<Set<string>>(new Set());
  const [sent, setSent] = useState<Set<string>>(new Set());

  const list = useMemo(() => base.filter((p) => !!p.phone
    && (!gender || p.gender === gender) && (!doctor || p.doctorId === doctor) && (!source || p.referralSource === source)
    && (!q.trim() || patientMatches(p, q))), [base, gender, doctor, source, q]);
  const targets = list.filter((p) => picked.has(p.id));
  const msg = (text.trim() || defaultText.trim());
  const personal = (p: Patient) => msg.replace(/\{الاسم\}/g, p.fullName.split(' ')[0]);

  const toggle = (id: string) => setPicked((s) => { const n = new Set(s); if (n.has(id)) n.delete(id); else n.add(id); return n; });
  const send = (p: Patient) => {
    if (!msg) { toast.error('اكتب نص الرسالة.'); return; }
    sendWhatsApp({ phone: p.phone, text: personal(p), patientId: p.id, type: 'campaign' });
    setSent((s) => new Set(s).add(p.id));
  };
  const next = targets.find((p) => !sent.has(p.id));

  return (
    <section className="card" style={{ marginBottom: 18 }}>
      <div className="card__head"><h2>إرسال واتساب يدوي</h2></div>
      <div className="card__body">
        <div className="grid-form grid-form--3">
          <Select id="wb-aud" label="المستلمون" value={audience} onChange={(e) => { setAudience(e.target.value as CampaignAudience); setPicked(new Set()); }} options={audienceOptions} />
          <Input id="wb-q" label="بحث" icon="search" placeholder="الاسم أو الجوال أو رقم الملف أو الهوية" value={q} onChange={(e) => setQ(e.target.value)} />
          <Select id="wb-g" label="الجنس" value={gender} onChange={(e) => setGender(e.target.value)} options={[{ value: '', label: 'الكل' }, { value: 'male', label: 'رجل' }, { value: 'female', label: 'امرأة' }]} />
          <Select id="wb-d" label="الطبيب" value={doctor} onChange={(e) => setDoctor(e.target.value)} options={[{ value: '', label: 'الكل' }, ...db.allTherapists().map((t) => ({ value: t.id, label: t.name }))]} />
          <Select id="wb-s" label="مصدر المعرفة" value={source} onChange={(e) => setSource(e.target.value)} options={[{ value: '', label: 'الكل' }, ...Object.entries(REFERRAL_SOURCE_LABEL).map(([value, label]) => ({ value, label }))]} />
        </div>
        <div className="field" style={{ marginTop: 10 }}>
          <label htmlFor="wb-text">نص رسالة واتساب {defaultText.trim() ? '(فارغ = نص الإشعار أعلاه)' : ''}</label>
          <textarea id="wb-text" className="input" rows={3} placeholder="مرحبًا {الاسم}، ..." value={text} onChange={(e) => setText(e.target.value)} />
          <span className="muted-sm">اكتب {'{الاسم}'} ليُستبدل باسم كل مريض.</span>
        </div>

        <div className="row-between" style={{ margin: '12px 0 6px', gap: 8, flexWrap: 'wrap' }}>
          <strong>المرضى ({list.length}) — المحددين <span className="num">{targets.length}</span> · أُرسل <span className="num">{targets.filter((p) => sent.has(p.id)).length}</span></strong>
          <span style={{ display: 'flex', gap: 6 }}>
            <Button size="sm" variant="outline" onClick={() => setPicked(new Set(list.map((p) => p.id)))}>تحديد الكل</Button>
            <Button size="sm" variant="ghost" onClick={() => setPicked(new Set())}>إلغاء التحديد</Button>
            <Button size="sm" variant="success" disabled={!next} onClick={() => next && send(next)}>{next ? `إرسال للتالي: ${next.fullName}` : 'تم إرسال المحددين'}</Button>
          </span>
        </div>
        <div className="table-wrap" style={{ maxHeight: 360, overflowY: 'auto' }}><table className="table">
          <thead><tr><th style={{ width: 36 }}></th><th>المريض</th><th>الجوال</th><th>الحالة</th><th></th></tr></thead>
          <tbody>{list.map((p) => (
            <tr key={p.id}>
              <td><input type="checkbox" aria-label={`تحديد ${p.fullName}`} checked={picked.has(p.id)} onChange={() => toggle(p.id)} /></td>
              <td><strong>{p.fullName}</strong> <span className="muted-sm num">{p.fileNo}</span></td>
              <td className="num" dir="ltr" style={{ textAlign: 'start' }}>{p.phone}</td>
              <td>{sent.has(p.id) ? <StatusBadge label="فُتحت المحادثة" tone="ok" /> : null}</td>
              <td><Button size="sm" variant="outline" onClick={() => send(p)}>واتساب</Button></td>
            </tr>
          ))}</tbody>
        </table></div>
        <p className="muted-sm" style={{ marginTop: 8 }}>واتساب ما يسمح بالإرسال الجماعي التلقائي من المتصفح — كل ضغطة تفتح محادثة المريض والرسالة جاهزة، ثم تضغط أنت إرسال في واتساب.</p>
      </div>
    </section>
  );
}
