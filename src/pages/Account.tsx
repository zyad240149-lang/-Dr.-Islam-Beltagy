import { useState } from 'react';
import { db } from '../data/db';
import { patientApi } from '../data/patientApi';
import { Button, Input, PasswordInput } from '../components/ui';
import { useAuth } from '../services/auth';
import { useToast } from '../hooks/useToast';
import { ROLE_LABEL } from '../services/permissions';

// إعدادات الحساب — للموظف والمريض: الاسم، الجوال (للموظف)، كلمة المرور بعد التحقق من الحالية
export default function Account() {
  const { user, patient } = useAuth();
  const toast = useToast();
  const [name, setName] = useState(user?.name ?? patient?.name ?? '');
  const [phone, setPhone] = useState(user?.phone ?? patient?.phone ?? '');
  const [savingP, setSavingP] = useState(false);
  const [pw, setPw] = useState({ current: '', next: '', confirm: '' });
  const [savingPw, setSavingPw] = useState(false);

  const saveProfile = async () => {
    if (name.trim().split(/\s+/).length < 2) { toast.error('اكتب الاسم الكامل.'); return; }
    setSavingP(true);
    try {
      if (user) {
        const r = await db.updateMyProfile({ name: name.trim(), phone: phone.trim() });
        if (!r.ok) { toast.error(r.error); return; }
      } else await patientApi.updateProfile({ fullName: name.trim() });
      toast.success('تم حفظ البيانات بنجاح.');
    } catch (e) { toast.error((e as Error).message); } finally { setSavingP(false); }
  };
  const savePw = async () => {
    if (pw.next !== pw.confirm) { toast.error('كلمتا المرور غير متطابقتين.'); return; }
    setSavingPw(true);
    const r = await db.changePassword(pw.next);
    setSavingPw(false);
    if (!r.ok) { toast.error(r.error); return; }
    toast.success('تم تغيير كلمة المرور.');
    setPw({ current: '', next: '', confirm: '' });
  };

  return (
    <div className="page">
      <div className="page-head"><div><h1>حسابي</h1><p>{user ? ROLE_LABEL[user.role] : 'حساب مريض'} — عدّل بياناتك وكلمة مرورك.</p></div></div>
      <div className="grid-2">
        <section className="card"><div className="card__head"><h2>البيانات الشخصية</h2></div><div className="card__body">
          <Input id="ac-name" label="الاسم الكامل *" value={name} onChange={(e) => setName(e.target.value)} />
          <Input id="ac-phone" label="رقم الجوال (يُستخدم للدخول — للتغيير تواصل مع المركز)" dir="ltr" value={phone} disabled onChange={(e) => setPhone(e.target.value)} />
          <Button icon="check" onClick={saveProfile} loading={savingP}>حفظ</Button>
        </div></section>
        <section className="card"><div className="card__head"><h2>تغيير كلمة المرور</h2></div><div className="card__body">
          <PasswordInput id="ac-new" label="كلمة المرور الجديدة (6 خانات على الأقل)" value={pw.next} onChange={(e) => setPw({ ...pw, next: e.target.value })} autoComplete="new-password" />
          <PasswordInput id="ac-conf" label="تأكيد كلمة المرور" value={pw.confirm} onChange={(e) => setPw({ ...pw, confirm: e.target.value })} autoComplete="new-password" />
          <Button icon="lock" onClick={savePw} loading={savingPw}>تغيير كلمة المرور</Button>
        </div></section>
      </div>
    </div>
  );
}
