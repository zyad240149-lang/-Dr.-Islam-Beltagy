import { useState } from 'react';
import { db } from '../data/db';
import { api } from '../lib/api';
import { supabase } from '../lib/supabase';
import { Button, Input, PasswordInput } from '../components/ui';
import { useCan } from '../components/common';
import { useToast } from '../hooks/useToast';
import { Icon } from '../utils/icons';
import { fmtDate } from '../utils/format';
import { Tickets } from '../components/Tickets';

type Account = { id: string; name: string; phone: string; email: string | null; memberSince: string };

const randomPassword = () => {
  const chars = 'ABCDEFGHJKMNPQRSTUVWXYZabcdefghjkmnpqrstuvwxyz23456789';
  const buf = new Uint32Array(8);
  crypto.getRandomValues(buf);
  return Array.from(buf, (n) => chars[n % chars.length]).join('');
};

export default function Support() {
  const toast = useToast();
  const can = useCan();
  const [phone, setPhone] = useState('');
  const [searching, setSearching] = useState(false);
  const [account, setAccount] = useState<Account | null>(null);
  const [notFound, setNotFound] = useState('');
  const [password, setPassword] = useState('');
  const [confirm, setConfirm] = useState('');
  const [saving, setSaving] = useState(false);
  const [done, setDone] = useState<{ name: string; password: string } | null>(null);

  const suggestions = phone.trim().length >= 2 && !account ? db.searchPatients(phone).slice(0, 5) : [];

  const ensureCloud = async () => {
    const { data } = await supabase.auth.getSession();
    if (!data.session) { toast.error('الدعم الفني يحتاج تسجيل الدخول بحساب موظف مربوط بالسحابة.'); return false; }
    return true;
  };

  const lookup = async (value = phone) => {
    setAccount(null); setNotFound(''); setDone(null); setPassword(''); setConfirm('');
    if (value.replace(/\D/g, '').length < 7) { toast.error('أدخل رقم جوال صحيح.'); return; }
    if (!(await ensureCloud())) return;
    setSearching(true);
    try { setAccount(await api.post('support/lookup', { phone: value })); }
    catch (e) { setNotFound((e as Error).message); }
    finally { setSearching(false); }
  };

  const reset = async () => {
    if (!account) return;
    if (password.length < 6) { toast.error('كلمة المرور لازم ما تقل عن 6 خانات.'); return; }
    if (password !== confirm) { toast.error('كلمتا المرور غير متطابقتين.'); return; }
    setSaving(true);
    try {
      await api.post('support/reset-password', { id: account.id, password });
      setDone({ name: account.name, password });
      toast.success('تم تغيير كلمة مرور المريض.');
    } catch (e) { toast.error((e as Error).message); }
    finally { setSaving(false); }
  };

  const generate = () => { const p = randomPassword(); setPassword(p); setConfirm(p); };
  const copy = async (text: string) => { try { await navigator.clipboard.writeText(text); toast.success('تم النسخ.'); } catch { toast.error('تعذّر النسخ.'); } };

  return (
    <div className="page">
      <div className="page-head">
        <div><h1>الدعم الفني</h1><p>مساعدة المرضى في حساباتهم على المنصة — إعادة تعيين كلمة المرور عند النسيان.</p></div>
      </div>

      <div className="sp-grid">
        <section className="card">
          <div className="card__head"><h2>إعادة تعيين كلمة مرور مريض</h2></div>
          <div className="card__body">
            <ol className="sp-steps">
              <li className={account || done ? 'done' : 'active'}><span>1</span>البحث عن الحساب</li>
              <li className={done ? 'done' : account ? 'active' : ''}><span>2</span>كلمة المرور الجديدة</li>
              <li className={done ? 'active' : ''}><span>3</span>إبلاغ المريض</li>
            </ol>

            <form className="sp-search" onSubmit={(e) => { e.preventDefault(); lookup(); }}>
              <Input id="sp-phone" label="رقم جوال المريض أو اسمه" icon="phone" dir="auto" placeholder="أي رقم موبايل — مصري أو دولي" value={phone}
                onChange={(e) => { setPhone(e.target.value); setAccount(null); setNotFound(''); setDone(null); }} />
              <Button type="submit" icon="search" loading={searching}>بحث</Button>
            </form>
            {suggestions.length > 0 && (
              <div className="choice-grid" style={{ marginBottom: 14 }}>
                {suggestions.map((p) => (
                  <button key={p.id} type="button" className="choice" onClick={() => { setPhone(p.phone); lookup(p.phone); }}>
                    <span className="choice__ic"><Icon name="user" size={16} /></span>
                    <span><strong>{p.fullName}</strong><span> {p.fileNo} · <span className="num">{p.phone}</span></span></span>
                  </button>
                ))}
              </div>
            )}

            {notFound && (
              <div className="alert alert-warn"><Icon name="alert" size={17} /><div>{notFound}. تأكد من الرقم، أو اطلب من المريض إنشاء حساب على المنصة.</div></div>
            )}

            {account && !done && (
              <div className="sp-account">
                <div className="sp-account__head">
                  <span className="avatar">{account.name.slice(0, 2)}</span>
                  <div>
                    <strong>{account.name}</strong>
                    <span className="muted"><span className="num">{account.phone}</span>{account.email ? ` · ${account.email}` : ''} · عضو منذ {fmtDate(account.memberSince.slice(0, 10))}</span>
                  </div>
                  <span className="badge badge--ok" style={{ marginInlineStart: 'auto' }}>حساب نشط</span>
                </div>
                {can('support', 'edit') ? (
                  <>
                    <div className="grid-form">
                      <PasswordInput id="sp-pass" label="كلمة المرور الجديدة" value={password} onChange={(e) => setPassword(e.target.value)} autoComplete="new-password" />
                      <PasswordInput id="sp-confirm" label="تأكيد كلمة المرور" value={confirm} onChange={(e) => setConfirm(e.target.value)} autoComplete="new-password" />
                    </div>
                    <div className="sp-actions">
                      <Button variant="ghost" icon="refresh" type="button" onClick={generate}>توليد كلمة مرور آمنة</Button>
                      <Button icon="lock" onClick={reset} loading={saving}>تغيير كلمة المرور</Button>
                    </div>
                  </>
                ) : <p className="muted">لا تملك صلاحية تغيير كلمات المرور.</p>}
              </div>
            )}

            {done && (
              <div className="sp-done">
                <div className="mark"><Icon name="check" size={26} /></div>
                <h3>تم تغيير كلمة مرور {done.name}</h3>
                <p className="muted">أبلغ المريض بكلمة المرور الجديدة وانصحه بتغييرها بعد الدخول.</p>
                <div className="sp-done__pass">
                  <code className="num">{done.password}</code>
                  <Button size="sm" variant="outline" icon="doc" onClick={() => copy(done.password)}>نسخ</Button>
                </div>
                <Button variant="outline" onClick={() => { setDone(null); setAccount(null); setPhone(''); }}>مساعدة مريض آخر</Button>
              </div>
            )}
          </div>
        </section>

        <aside className="card">
          <div className="card__head"><h2>إرشادات الأمان</h2></div>
          <div className="card__body">
            <ul className="sp-tips">
              <li><Icon name="shield" size={16} />تحقّق من هوية المريض (الاسم الثلاثي والرقم القومي/جواز السفر) قبل تغيير كلمة المرور.</li>
              <li><Icon name="phone" size={16} />أرسل كلمة المرور الجديدة على رقم الجوال المسجّل فقط.</li>
              <li><Icon name="lock" size={16} />لا تطلب من المريض كلمة مروره القديمة ولا تحتفظ بالجديدة.</li>
              <li><Icon name="clipboard" size={16} />كل عملية تغيير تُسجَّل باسمك في سجل العمليات.</li>
            </ul>
          </div>
        </aside>
      </div>
      <Tickets />
    </div>
  );
}
