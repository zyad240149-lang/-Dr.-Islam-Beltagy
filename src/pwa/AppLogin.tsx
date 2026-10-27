// شاشة تسجيل الدخول — للموظفين والمرضى (نفس الشاشة؛ الخادم بيحدد نوع الحساب)
import { LangSwitch } from '../i18n/LangSwitch';
import { useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { useAuth } from '../services/auth';
import { PhoneInput } from '../components/PhoneInput';
import { Button, PasswordInput } from '../components/ui';
import { AuthBrand } from './SignUp';
import { phoneErrorMessage, type PhoneErrorCode } from '../utils/phoneUtils';
import { Icon } from '../utils/icons';
import { DOCTOR } from '../landing/content';

export default function AppLogin() {
  const { login } = useAuth();
  const navigate = useNavigate();
  const [phone, setPhone] = useState('');
  const [phoneErr, setPhoneErr] = useState<PhoneErrorCode | null>('required');
  const [password, setPassword] = useState('');
  const [tried, setTried] = useState(false);
  const [err, setErr] = useState('');
  const [busy, setBusy] = useState(false);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setTried(true); setErr('');
    if (phoneErr) { setErr(phoneErrorMessage(phoneErr)!); return; }
    if (!password) { setErr('أدخل كلمة المرور.'); return; }
    setBusy(true);
    const r = await login(phone, password);
    setBusy(false);
    if (!r.ok) { setErr(r.error ?? 'تعذّر تسجيل الدخول.'); return; }
    navigate(r.kind === 'patient' ? '/me' : '/', { replace: true });
  };

  return (
    <div className="app-login app-login--split">
      <div className="al-main">
        <form className="card app-login__card" onSubmit={submit} noValidate>
          <div className="al-tools"><LangSwitch /></div>
          <div className="al-logo-sm"><AuthBrand /></div>
          <h1 className="app-login__title">تسجيل الدخول</h1>
          <p className="al-lead">ادخل برقم الموبايل وكلمة المرور.</p>
          {err && <div className="alert alert-danger" style={{ marginBottom: 12 }}>{err}</div>}
          <PhoneInput id="al-phone" label="رقم الموبايل" value={phone} showError={tried} onChange={(v, e) => { setPhone(v); setPhoneErr(e); }} />
          <PasswordInput id="al-pass" label="كلمة المرور" autoComplete="current-password" value={password} onChange={(e) => setPassword(e.target.value)} />
          <Button type="submit" block loading={busy}>دخول</Button>
          <p style={{ textAlign: 'center', marginTop: 16, fontSize: 14.5 }}>مريض جديد؟ <Link to="/signup" style={{ fontWeight: 700, color: 'var(--brand)' }}>أنشئ حسابك</Link></p>
        </form>
        <a href="/" className="al-back">الرجوع لموقع العيادة</a>
      </div>
      <aside className="al-aside" aria-hidden="true">
        <div className="al-aside__brand">
          <img className="al-aside__logo" src={`${import.meta.env.BASE_URL}landing/logo.png`} alt="" />
          <div><strong>{DOCTOR.short}</strong><span>{DOCTOR.title}</span></div>
        </div>
        <div>
          <h2>نظام إدارة العيادة</h2>
          <p>المواعيد وملفات المرضى والأشعة والفواتير في مكان واحد.</p>
          <ul className="al-aside__list">
            <li><Icon name="calendar" size={18} />جدول المواعيد اليومي لكل طبيب</li>
            <li><Icon name="bone" size={18} />متابعة الكسور والجبس والعمليات</li>
            <li><Icon name="receipt" size={18} />الفواتير والمدفوعات والتقارير</li>
          </ul>
        </div>
        <div className="al-aside__foot">{DOCTOR.address}</div>
      </aside>
    </div>
  );
}
