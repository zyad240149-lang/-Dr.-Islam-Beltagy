// ١١/١١: «احجز أونلاين» من الصفحة الرئيسية من غير حساب — الاسم + الموبايل + كشف/متابعة + اليوم والوقت.
// الأوقات من الخادم (doctor_day_slots) والحجز نفسه guest_book (هجرة 970) — نفس قواعد حجز البوابة.
import { useEffect, useMemo, useState } from 'react';
import { supabase } from '../lib/supabase';
import { DOCTOR_DAY_MESSAGE, ymd, type DoctorDaySlots } from '../data/patientApi';

type GCatalog = { services: Array<{ id: string; name: string; price: number; durationMin: number; doctorIds: string[] }>; doctors: Array<{ id: string; name: string; serviceIds: string[] }> };
const rpc = async <T,>(fn: string, args?: Record<string, unknown>): Promise<T> => { const { data, error } = await supabase.rpc(fn, args); if (error) throw error; return data as T; };
import { Icon } from '../utils/icons';

const DAYS_AHEAD = 14;
const dayLabel = (d: Date, i: number) => (i === 0 ? 'النهارده' : i === 1 ? 'بكرة' : new Intl.DateTimeFormat('ar-EG', { weekday: 'long' }).format(d));
const dayNum = (d: Date) => new Intl.DateTimeFormat('ar-EG', { day: 'numeric', month: 'short' }).format(d);
const hm12 = (t: string) => { const [h, m] = t.split(':').map(Number); return `${((h + 11) % 12) + 1}:${String(m).padStart(2, '0')} ${h < 12 ? 'ص' : 'م'}`; };

export default function GuestBook({ onClose }: { onClose: () => void }) {
  const [cat, setCat] = useState<GCatalog | null>(null);
  const [err, setErr] = useState('');
  const [name, setName] = useState('');
  const [phone, setPhone] = useState('');
  const [svcId, setSvcId] = useState('');
  const [date, setDate] = useState('');
  const [time, setTime] = useState('');
  const [slots, setSlots] = useState<DoctorDaySlots | null>(null);
  const [loadingSlots, setLoadingSlots] = useState(false);
  const [busy, setBusy] = useState(false);
  const [done, setDone] = useState<{ no: string; date: string; time: string; service: string } | null>(null);

  useEffect(() => { rpc<GCatalog>('guest_booking_catalog').then(setCat).catch(() => setErr('مش قادرين نوصل للعيادة دلوقتي — جرّب تاني أو اتصل بينا.')); }, []);
  useEffect(() => { const k = (e: KeyboardEvent) => e.key === 'Escape' && onClose(); window.addEventListener('keydown', k); return () => window.removeEventListener('keydown', k); }, [onClose]);

  // كشف ومتابعة بس
  const services = useMemo(() => cat?.services ?? [], [cat]);
  useEffect(() => { if (!svcId && services.length) setSvcId(services[0].id); }, [services, svcId]);
  const svc = services.find((s) => s.id === svcId);
  const doctor = cat?.doctors.find((d) => svc && (d.serviceIds.includes(svc.id) || svc.doctorIds.includes(d.id))) ?? cat?.doctors[0];
  const days = useMemo(() => Array.from({ length: DAYS_AHEAD }, (_, i) => { const d = new Date(); d.setDate(d.getDate() + i); return d; }), []);
  useEffect(() => { if (!date) setDate(ymd(days[0])); }, [days, date]);

  useEffect(() => {
    setTime(''); setSlots(null);
    if (!doctor || !svcId || !date) return;
    let live = true;
    setLoadingSlots(true);
    rpc<DoctorDaySlots>('guest_day_slots', { p_therapist: doctor.id, p_service: svcId, p_date: date }).then((r) => { if (live) setSlots(r); }).catch(() => { if (live) setSlots({ status: 'no_hours', slots: [] }); }).finally(() => live && setLoadingSlots(false));
    return () => { live = false; };
  }, [doctor?.id, svcId, date]);

  const free = (slots?.slots ?? []).filter((s) => s.available && !s.past);
  const digits = phone.replace(/\D/g, '');
  const ok = name.trim().length >= 2 && digits.length >= 10 && !!svcId && !!date && !!time && !!doctor;

  const submit = async () => {
    if (!ok || !doctor) return;
    setBusy(true); setErr('');
    const { data, error } = await supabase.rpc('guest_book', { p: { fullName: name.trim(), phone: phone.trim(), serviceId: svcId, therapistId: doctor.id, date, time } });
    setBusy(false);
    if (error) { setErr(error.message || 'الحجز ماتمّش — جرّب تاني أو اتصل بينا.'); return; }
    setDone(data as { no: string; date: string; time: string; service: string });
  };

  return (
    <div className="gb-overlay" onMouseDown={(e) => { if (e.target === e.currentTarget) onClose(); }}>
      <div className="gb" role="dialog" aria-modal="true" aria-label="احجز أونلاين" dir="rtl">
        <div className="gb__head">
          <h2><Icon name="calendar" size={20} /> احجز أونلاين</h2>
          <button type="button" className="gb__x" onClick={onClose} aria-label="إغلاق"><Icon name="close" size={18} /></button>
        </div>
        {done ? (
          <div className="gb__done">
            <div className="gb__ok"><Icon name="checkCircle" size={44} /></div>
            <h3>تم استلام حجزك</h3>
            <p>{done.service} — يوم <b>{new Intl.DateTimeFormat('ar-EG', { weekday: 'long', day: 'numeric', month: 'long' }).format(new Date(done.date + 'T00:00:00'))}</b> الساعة <b>{hm12(done.time)}</b></p>
            <p className="gb__muted">رقم الحجز <b className="num">{done.no}</b> — العيادة هتتواصل معاك على رقمك لتأكيد الموعد.</p>
            <button type="button" className="lp-btn" onClick={onClose}>تمام</button>
          </div>
        ) : (
          <div className="gb__body">
            {!cat && !err && <p className="gb__muted">جاري التحميل…</p>}
            {cat && (<>
              <label className="gb__f"><span>الاسم</span><input value={name} onChange={(e) => setName(e.target.value)} placeholder="اسمك" autoComplete="name" /></label>
              <label className="gb__f"><span>رقم الموبايل</span><input value={phone} onChange={(e) => setPhone(e.target.value)} placeholder="01xxxxxxxxx" inputMode="tel" dir="ltr" autoComplete="tel" /></label>
              <div className="gb__f"><span>الخدمة</span>
                <div className="gb__chips">{services.map((s) => <button key={s.id} type="button" className={`gb__chip ${s.id === svcId ? 'is-on' : ''}`} onClick={() => setSvcId(s.id)}>{s.name}</button>)}</div>
                {!services.length && <p className="gb__muted">الحجز الأونلاين مش متاح دلوقتي — اتصل بينا.</p>}
              </div>
              <div className="gb__f"><span>اليوم</span>
                <div className="gb__days">{days.map((d, i) => { const v = ymd(d); return <button key={v} type="button" className={`gb__day ${v === date ? 'is-on' : ''}`} onClick={() => setDate(v)}><b>{dayLabel(d, i)}</b><small>{dayNum(d)}</small></button>; })}</div>
              </div>
              <div className="gb__f"><span>الوقت</span>
                {loadingSlots ? <p className="gb__muted">بنشوف المواعيد الفاضية…</p>
                  : slots && slots.status !== 'ok' ? <p className="gb__muted">{DOCTOR_DAY_MESSAGE[slots.status] || 'مفيش مواعيد في اليوم ده.'}</p>
                  : !free.length ? <p className="gb__muted">مفيش مواعيد فاضية في اليوم ده — اختار يوم تاني.</p>
                  : <div className="gb__chips">{free.map((s) => <button key={s.time} type="button" className={`gb__chip gb__chip--t ${s.time === time ? 'is-on' : ''}`} onClick={() => setTime(s.time)}>{hm12(s.time)}</button>)}</div>}
              </div>
            </>)}
            {err && <p className="gb__err" role="alert">{err}</p>}
            <button type="button" className="lp-btn gb__go" disabled={!ok || busy} onClick={() => void submit()}>{busy ? 'جاري الحجز…' : 'تأكيد الحجز'}</button>
            <p className="gb__muted">مش محتاج تعمل حساب — العيادة هتكلمك تأكد الموعد.</p>
          </div>
        )}
      </div>
    </div>
  );
}
