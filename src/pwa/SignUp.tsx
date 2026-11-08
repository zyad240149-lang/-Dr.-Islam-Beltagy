// إنشاء حساب مريض جديد من موقع العيادة — الحساب بيتربط بملف المريض تلقائيًا
// لو العيادة فاتحة له ملف قبل كده بنفس الموبايل: لازم يكتب الرقم القومي (أو الجواز) المسجّل في الملف عشان يتربط بيه (هجرة 905)
import { useState } from 'react';
import { LangSwitch } from '../i18n/LangSwitch';
import { Link, useNavigate } from 'react-router-dom';
import { useAuth } from '../services/auth';
import { api } from '../lib/api';
import { supabase } from '../lib/supabase';
import { PhoneInput } from '../components/PhoneInput';
import { Button, Input, PasswordInput, Select } from '../components/ui';
import { NID_RE, PASSPORT_RE } from '../utils/format';
import { phoneErrorMessage, type PhoneErrorCode } from '../utils/phoneUtils';
import { Icon } from '../utils/icons';
import { DOCTOR } from '../landing/content';

/** زر الدخول بجوجل — بيظهر بس لما VITE_GOOGLE_AUTH=1 (بعد تفعيل المزود في Supabase) */
export function GoogleButton() {
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');
  if (import.meta.env.VITE_GOOGLE_AUTH !== '1') return null;
  const go = async () => {
    setBusy(true); setErr('');
    const { error } = await supabase.auth.signInWithOAuth({ provider: 'google', options: { redirectTo: window.location.origin + '/' } });
    if (error) { setBusy(false); setErr('تعذّر فتح تسجيل جوجل — حاول تاني.'); }
  };
  return (
    <div className="al-google">
      <div className="al-or">أو</div>
      {err && <div className="alert alert-danger" style={{ marginBottom: 8 }} role="alert">{err}</div>}
      <Button type="button" variant="outline" block loading={busy} onClick={go}>
        {!busy && (
          <svg className="al-g-mark" width="18" height="18" viewBox="0 0 48 48" aria-hidden="true">
            <path fill="#EA4335" d="M24 9.5c3.5 0 6.7 1.2 9.2 3.6l6.9-6.9C35.9 2.4 30.5 0 24 0 14.6 0 6.5 5.4 2.6 13.2l8 6.2C12.5 13.6 17.8 9.5 24 9.5z" />
            <path fill="#4285F4" d="M46.9 24.5c0-1.6-.1-3.1-.4-4.5H24v9h12.9c-.6 3-2.2 5.5-4.7 7.2l7.7 6c4.5-4.2 7-10.3 7-17.7z" />
            <path fill="#FBBC05" d="M10.6 28.6c-.5-1.4-.8-3-.8-4.6s.3-3.2.8-4.6l-8-6.2C.9 16.5 0 20.1 0 24s.9 7.5 2.6 10.8l8-6.2z" />
            <path fill="#34A853" d="M24 48c6.5 0 11.9-2.1 15.9-5.8l-7.7-6c-2.2 1.4-4.9 2.3-8.2 2.3-6.2 0-11.5-4.2-13.4-9.8l-8 6.2C6.5 42.6 14.6 48 24 48z" />
          </svg>
        )}
        المتابعة بحساب Google
      </Button>
    </div>
  );
}

export function AuthBrand() {
  return (
    <div style={{ textAlign: 'center', marginBottom: 6 }}>
      <img src={`${import.meta.env.BASE_URL}landing/logo.png`} alt="د. إسلام بلتاجي — استشاري جراحة العظام والكسور" style={{ width: 92, height: 92, objectFit: 'contain' }} />
    </div>
  );
}

// أرقام عربية ← إنجليزي، ومن غير مسافات/شُرَط (نفس norm_id على الخادم)
const normId = (s: string) => s.replace(/[٠-٩]/g, (d) => String('٠١٢٣٤٥٦٧٨٩'.indexOf(d))).replace(/[۰-۹]/g, (d) => String('۰۱۲۳۴۵۶۷۸۹'.indexOf(d))).replace(/[\s-]/g, '').toUpperCase();

type LinkCode = 'need_id' | 'id_mismatch' | 'contact_clinic' | 'locked';

export default function SignUp() {
  const { login } = useAuth();
  const navigate = useNavigate();
  const [name, setName] = useState('');
  const [phone, setPhone] = useState('');
  const [phoneErr, setPhoneErr] = useState<PhoneErrorCode | null>('required');
  const [gender, setGender] = useState('');
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
    name: clean.length < 2 ? 'اكتب اسمك.' : '',
    gender: '',
    password: password.length < 6 ? 'كلمة المرور 6 خانات على الأقل.' : '',
    confirm: confirm !== password ? 'كلمتا المرور غير متطابقتين.' : '',
    nationalId: !askId ? '' : !nid ? 'اكتب الرقم القومي المسجّل في ملفك.' : !NID_RE.test(nid) && !PASSPORT_RE.test(nid) ? 'الرقم القومي 14 رقم (أو رقم جواز السفر لغير المصريين).' : '',
  };

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setTried(true); setErr('');
    const first = errors.name || (phoneErr && phoneErrorMessage(phoneErr)) || errors.gender || errors.password || errors.confirm || errors.nationalId;
    if (first) { setErr(first); return; }
    setBusy(true);
    try {
      await api.post('register', { name: clean, phone, gender, password, confirm, nationalId: askId ? nid : '' });
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
    <div className="app-login app-login--split">
      <div className="al-main">
        <form className="card app-login__card" onSubmit={submit} noValidate>
          <div className="al-tools"><LangSwitch /></div>
          <div className="al-logo-sm"><AuthBrand /></div>
          <h1 className="app-login__title">إنشاء حساب جديد</h1>
          <p className="al-lead">احجز مواعيدك وتابع ملفك وفواتيرك من موبايلك</p>
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
        <div className="al-grid">
        <PhoneInput id="su-phone" label="رقم الموبايل" value={phone} showError={tried} onChange={onPhone} />
        <Select id="su-gender" label="النوع" value={gender} onChange={(e) => setGender(e.target.value)} error={tried ? errors.gender : ''}
          options={[{ value: '', label: 'اختار النوع' }, { value: 'male', label: 'ذكر' }, { value: 'female', label: 'أنثى' }]} />
        </div>
        {askId && (
          <Input id="su-nid" label="الرقم القومي المسجّل في ملفك" dir="ltr" inputMode="text" autoComplete="off" value={nationalId}
            onChange={(e) => setNationalId(e.target.value)} error={tried ? errors.nationalId : ''}
            hint="لغير المصريين: رقم جواز السفر. ده بيأكد إن الملف ملفك قبل ما نربطه بالحساب." />
        )}
        <div className="al-grid">
        <PasswordInput id="su-pass" label="كلمة المرور" autoComplete="new-password" value={password} onChange={(e) => setPassword(e.target.value)} error={tried ? errors.password : ''} />
        <PasswordInput id="su-confirm" label="تأكيد كلمة المرور" autoComplete="new-password" value={confirm} onChange={(e) => setConfirm(e.target.value)} error={tried ? errors.confirm : ''} />
        </div>
        <Button type="submit" block loading={busy} disabled={link === 'contact_clinic' || link === 'locked'}>إنشاء الحساب</Button>
        <GoogleButton />
        <p className="al-switch">عندك حساب بالفعل؟ <Link to="/login">سجّل الدخول</Link></p>
        </form>
        <a href="/" className="al-back">الرجوع لموقع العيادة</a>
      </div>
      <aside className="al-aside" aria-hidden="true">
        <div className="al-aside__brand">
          <img className="al-aside__logo" src={`${import.meta.env.BASE_URL}landing/logo.png`} alt="" />
          <div><strong>{DOCTOR.short}</strong><span>{DOCTOR.title}</span></div>
        </div>
        <div>
          <h2>احجز وتابع علاجك أونلاين</h2>
          <p>حساب واحد يخليك تحجز وتتابع من غير ما تتصل أو تستنى.</p>
          <ul className="al-aside__list">
            <li><Icon name="calendarPlus" size={18} />احجز موعدك في أي وقت من موبايلك</li>
            <li><Icon name="doc" size={18} />ملفك الطبي وتاريخ زياراتك في مكان واحد</li>
            <li><Icon name="bell" size={18} />تذكير بموعدك وإشعار فوري بأي تحديث</li>
            <li><Icon name="receipt" size={18} />فواتيرك ومدفوعاتك بوضوح</li>
          </ul>
        </div>
        <div className="al-aside__foot">{DOCTOR.address}</div>
      </aside>
    </div>
  );
}
