// إنشاء حساب مريض جديد من موقع العيادة — الحساب بيتربط بملف المريض تلقائيًا
// لو العيادة فاتحة له ملف قبل كده بنفس الموبايل: لازم يكتب الرقم القومي (أو الجواز) المسجّل في الملف عشان يتربط بيه (هجرة 905)
import { useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { useAuth } from '../services/auth';
import { api } from '../lib/api';
import { PhoneInput } from '../components/PhoneInput';
import { Button, Input, PasswordInput } from '../components/ui';
import { isArabicName, nameWords } from '../utils/patientGaps';
import { NID_RE, PASSPORT_RE } from '../utils/format';
import { phoneErrorMessage, type PhoneErrorCode } from '../utils/phoneUtils';
import { DOCTOR } from '../landing/content';

export function AuthBrand() {
  return (
    <div style={{ textAlign: 'center', marginBottom: 6 }}>
      <img src={`${import.meta.env.BASE_URL}landing/logo.png`} alt="د. إسلام بلتاجي — استشاري جراحة العظام والكسور" style={{ width: 92, height: 92, objectFit: 'contain' }} />
    </div>
  );
}

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
// أرقام عربية ← إنجليزي، ومن غير مسافات/شُرَط (نفس norm_id على الخادم)
const normId = (s: string) => s.replace(/[٠-٩]/g, (d) => String('٠١٢٣٤٥٦٧٨٩'.indexOf(d))).replace(/[۰-۹]/g, (d) => String('۰۱۲۳۴۵۶۷۸۹'.indexOf(d))).replace(/[\s-]/g, '').toUpperCase();

type LinkCode = 'need_id' | 'id_mismatch' | 'contact_clinic' | 'locked';

export default function SignUp() {
  const { login } = useAuth();
  const navigate = useNavigate();
  const [name, setName] = useState('');
  const [phone, setPhone] = useState('');
  const [phoneErr, setPhoneErr] = useState<PhoneErrorCode | null>('required');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [confirm, setConfirm] = useState('');
  const [nationalId, setNationalId] = useState('');
  const [link, setLink] = useState<LinkCode | null>(null);
  const [tried, setTried] = useState(false);
  const [err, setErr] = useState('');
  const [busy, setBusy] = useState(false);

  const askId = link === 'need_id' || link === 'id_mismatch';
  const clean = name.trim().replace(/\s+/g, ' ');
  const nid = normId(nationalId);
  const errors = {
    name: !clean ? 'اكتب اسمك الثلاثي.' : nameWords(clean) < 3 ? 'الاسم لازم يكون ثلاثي (الاسم واسم الأب واسم الجد).' : !isArabicName(clean) ? 'اكتب الاسم بحروف عربية.' : '',
    email: email.trim() && !EMAIL_RE.test(email.trim()) ? 'البريد الإلكتروني غير صحيح.' : '',
    password: password.length < 6 ? 'كلمة المرور 6 خانات على الأقل.' : '',
    confirm: confirm !== password ? 'كلمتا المرور غير متطابقتين.' : '',
    nationalId: !askId ? '' : !nid ? 'اكتب الرقم القومي المسجّل في ملفك.' : !NID_RE.test(nid) && !PASSPORT_RE.test(nid) ? 'الرقم القومي 14 رقم (أو رقم جواز السفر لغير المصريين).' : '',
  };

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setTried(true); setErr('');
    const first = errors.name || (phoneErr && phoneErrorMessage(phoneErr)) || errors.email || errors.password || errors.confirm || errors.nationalId;
    if (first) { setErr(first); return; }
    setBusy(true);
    try {
      await api.post('register', { name: clean, phone, email: email.trim(), password, confirm, nationalId: askId ? nid : '' });
    } catch (x) {
      setBusy(false);
      const code = (x as { code?: string }).code;
      if (code === 'need_id' || code === 'id_mismatch' || code === 'contact_clinic' || code === 'locked') {
        setLink(code);
        if (code === 'need_id' || code === 'id_mismatch') setTimeout(() => document.getElementById('su-nid')?.focus(), 0);
      }
      setErr((x as Error).message || 'تعذّر إنشاء الحساب.');
      return;
    }
    // الحساب اتعمل — دخول تلقائي
    const r = await login(phone, password);
    setBusy(false);
    if (!r.ok) { navigate('/login', { replace: true }); return; }
    navigate(r.kind === 'patient' ? '/me' : '/', { replace: true });
  };

  // تغيير الموبايل بيلغي طلب الرقم القومي (ممكن الرقم الجديد مالوش ملف)
  const onPhone = (v: string, x: PhoneErrorCode | null) => {
    setPhone(v); setPhoneErr(x);
    if (link) { setLink(null); setNationalId(''); setErr(''); }
  };

  return (
    <div className="app-login">
      <form className="card app-login__card" onSubmit={submit} noValidate>
        <AuthBrand />
        <h1 className="app-login__title">إنشاء حساب جديد</h1>
        <p className="muted" style={{ textAlign: 'center', fontSize: 14, margin: '-10px 0 16px' }}>احجز مواعيدك وتابع ملفك وفواتيرك من موبايلك</p>
        {err && (
          <div className="alert alert-danger" style={{ marginBottom: 12 }} role="alert">
            <div>
              {err}
              {(link === 'contact_clinic' || link === 'locked') && (
                <div style={{ marginTop: 8, display: 'flex', flexWrap: 'wrap', gap: '4px 14px' }}>
                  {DOCTOR.phones.map((p) => <a key={p.number} href={`tel:${p.intl}`} dir="ltr" style={{ fontWeight: 700 }}>{p.number}</a>)}
                </div>
              )}
            </div>
          </div>
        )}
        <Input id="su-name" label="الاسم الثلاثي بالعربي" autoComplete="name" value={name} onChange={(e) => setName(e.target.value)} error={tried ? errors.name : ''} placeholder="مثال: محمد أحمد علي" />
        <PhoneInput id="su-phone" label="رقم الموبايل" value={phone} showError={tried} onChange={onPhone} />
        {askId && (
          <Input id="su-nid" label="الرقم القومي المسجّل في ملفك" dir="ltr" inputMode="text" autoComplete="off" value={nationalId}
            onChange={(e) => setNationalId(e.target.value)} error={tried ? errors.nationalId : ''}
            hint="لغير المصريين: رقم جواز السفر. ده بيأكد إن الملف ملفك قبل ما نربطه بالحساب." />
        )}
        <Input id="su-email" label="البريد الإلكتروني (اختياري)" type="email" dir="ltr" autoComplete="email" value={email} onChange={(e) => setEmail(e.target.value)} error={tried ? errors.email : ''} />
        <PasswordInput id="su-pass" label="كلمة المرور" autoComplete="new-password" value={password} onChange={(e) => setPassword(e.target.value)} error={tried ? errors.password : ''} />
        <PasswordInput id="su-confirm" label="تأكيد كلمة المرور" autoComplete="new-password" value={confirm} onChange={(e) => setConfirm(e.target.value)} error={tried ? errors.confirm : ''} />
        <Button type="submit" block loading={busy} disabled={link === 'contact_clinic' || link === 'locked'}>إنشاء الحساب</Button>
        <p style={{ textAlign: 'center', marginTop: 14, fontSize: 14.5 }}>عندك حساب بالفعل؟ <Link to="/login" style={{ fontWeight: 700, color: 'var(--brand-700)' }}>سجّل الدخول</Link></p>
      </form>
      <a href="/" className="muted" style={{ display: 'block', textAlign: 'center', marginTop: 14, fontSize: 14 }}>الرجوع لموقع العيادة</a>
    </div>
  );
}
