// إكمال حساب مريض دخل بجوجل: الاسم الثلاثي والموبايل والنوع إلزاميين، ومن غيرهم مفيش حساب ولا ملف مريض (الخادم بيتحقق تاني)
import { useState } from 'react';
import { useAuth, type PendingProfile } from '../services/auth';
import { api } from '../lib/api';
import { PhoneInput } from '../components/PhoneInput';
import { Button, Input, Select } from '../components/ui';
import { isArabicName, nameWords } from '../utils/patientGaps';
import { phoneErrorMessage, type PhoneErrorCode } from '../utils/phoneUtils';
import { AuthBrand } from './SignUp';

const normId = (s: string) => s.replace(/[٠-٩]/g, (d) => String('٠١٢٣٤٥٦٧٨٩'.indexOf(d))).replace(/[\s-]/g, '').toUpperCase();

export default function CompleteProfile({ pending }: { pending: PendingProfile }) {
  const { refreshSession, logout } = useAuth();
  const [name, setName] = useState(isArabicName(pending.googleName) && nameWords(pending.googleName) >= 3 ? pending.googleName : '');
  const [phone, setPhone] = useState('');
  const [phoneErr, setPhoneErr] = useState<PhoneErrorCode | null>('required');
  const [gender, setGender] = useState('');
  const [nationalId, setNationalId] = useState('');
  const [askId, setAskId] = useState(false);
  const [blocked, setBlocked] = useState(false);
  const [tried, setTried] = useState(false);
  const [err, setErr] = useState('');
  const [busy, setBusy] = useState(false);

  const clean = name.trim().replace(/\s+/g, ' ');
  const nameError = !clean ? 'اكتب اسمك الثلاثي.' : nameWords(clean) < 3 ? 'الاسم لازم يكون ثلاثي (الاسم واسم الأب واسم الجد).' : !isArabicName(clean) ? 'اكتب الاسم بحروف عربية.' : '';
  const genderError = gender ? '' : 'اختار النوع.';
  const nid = normId(nationalId);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setTried(true); setErr('');
    const first = nameError || (phoneErr && phoneErrorMessage(phoneErr)) || genderError || (askId && !nid ? 'اكتب الرقم القومي المسجّل في ملفك.' : '');
    if (first) { setErr(first); return; }
    setBusy(true);
    try {
      await api.post('google-complete', { name: clean, phone, gender, nationalId: askId ? nid : '' });
      await refreshSession();
    } catch (x) {
      const code = (x as { code?: string }).code;
      if (code === 'need_id' || code === 'id_mismatch') setAskId(true);
      if (code === 'contact_clinic' || code === 'locked') setBlocked(true);
      setErr((x as Error).message || 'تعذّر حفظ البيانات.');
    } finally { setBusy(false); }
  };

  return (
    <div className="app-login">
      <div className="al-main">
        <form className="card app-login__card" onSubmit={submit} noValidate>
          <div className="al-logo-sm"><AuthBrand /></div>
          <h1 className="app-login__title">أكمل بياناتك</h1>
          <p className="al-lead">خطوة أخيرة عشان حسابك{pending.email ? ` (${pending.email})` : ''} يتربط بملفك الطبي.</p>
          {err && <div className="alert alert-danger" style={{ marginBottom: 12 }} role="alert">{err}</div>}
          <Input id="cp-name" label="الاسم الثلاثي بالعربي" autoComplete="name" value={name} onChange={(e) => setName(e.target.value)} error={tried ? nameError : ''} placeholder="مثال: محمد أحمد علي" />
          <PhoneInput id="cp-phone" label="رقم الموبايل" value={phone} showError={tried} onChange={(v, x) => { setPhone(v); setPhoneErr(x); setAskId(false); setBlocked(false); }} />
          <Select id="cp-gender" label="النوع" value={gender} onChange={(e) => setGender(e.target.value)} error={tried ? genderError : ''}
            options={[{ value: '', label: 'اختار النوع' }, { value: 'male', label: 'ذكر' }, { value: 'female', label: 'أنثى' }]} />
          {askId && <Input id="cp-nid" label="الرقم القومي المسجّل في ملفك" dir="ltr" autoComplete="off" value={nationalId} onChange={(e) => setNationalId(e.target.value)} hint="لغير المصريين: رقم جواز السفر." />}
          <Button type="submit" block loading={busy} disabled={blocked}>حفظ ومتابعة</Button>
          <Button type="button" variant="outline" block style={{ marginTop: 8 }} onClick={() => logout()}>إلغاء وتسجيل الخروج</Button>
        </form>
      </div>
    </div>
  );
}
