// حالة إشعارات الموبايل على الجهاز الحالي — بتعرض الحقيقة بس: مفعّلة فعلًا (إذن + اشتراك محفوظ) / محظورة / محتاجة تثبيت / غير مدعومة.
import { useEffect, useState } from 'react';
import { Button } from '../components/ui';
import { useToast } from '../hooks/useToast';
import { Icon } from '../utils/icons';
import { currentPushSubscription, enablePush, isIOS, pushSupport, sendTestPush } from './pwa';

type State = 'loading' | 'on' | 'off' | 'denied' | 'ios-needs-install' | 'unsupported' | 'not-configured';

export function PushStatusCard() {
  const toast = useToast();
  const [st, setSt] = useState<State>('loading');
  const [busy, setBusy] = useState(false);
  const check = async () => {
    const sup = pushSupport();
    if (sup !== 'supported') { setSt(sup); return; }
    if (Notification.permission === 'denied') { setSt('denied'); return; }
    const sub = await currentPushSubscription().catch(() => null);
    setSt(sub && Notification.permission === 'granted' ? 'on' : 'off');
  };
  useEffect(() => { void check(); }, []);

  const enable = async () => {
    setBusy(true);
    const r = await enablePush();
    setBusy(false);
    if (!r.ok) { toast.error(r.error); await check(); return; }
    await check();
    const t = await sendTestPush();
    toast.success(t.ok && (t.sent ?? 0) > 0 ? 'تم تفعيل الإشعارات — أرسلنا إشعارًا تجريبيًا لهذا الجهاز.' : 'تم تفعيل الإشعارات.');
  };
  const test = async () => {
    setBusy(true);
    const t = await sendTestPush();
    setBusy(false);
    if (!t.ok) toast.error(t.error ?? 'تعذّر الإرسال');
    else if ((t.sent ?? 0) === 0) toast.error('ما وصل لأي جهاز — فعّل الإشعارات من جديد.');
    else toast.success('أرسلنا إشعارًا تجريبيًا — المفروض يظهر على الشاشة خلال ثوانٍ.');
  };

  if (st === 'loading') return null;
  const box = (tone: 'ok' | 'warn' | 'info', icon: string, title: string, text: string, action?: React.ReactNode) => (
    <div className={`alert alert-${tone}`} style={{ alignItems: 'center', marginBottom: 14 }} role="status">
      <Icon name={icon as never} size={18} />
      <div style={{ flex: 1 }}><strong>{title}</strong><div className="muted-sm">{text}</div></div>
      {action}
    </div>
  );
  if (st === 'on') return box('ok', 'bell', 'إشعارات الجوال مفعّلة على هذا الجهاز', 'توصلك تذكيرات المواعيد والفواتير والخطة العلاجية حتى لو التطبيق مقفول.',
    <Button size="sm" variant="outline" loading={busy} onClick={test}>إشعار تجريبي</Button>);
  if (st === 'off') return box('info', 'bell', 'إشعارات الجوال غير مفعّلة على هذا الجهاز', 'فعّلها عشان يوصلك تذكير قبل موعدك وإشعار بالفواتير والخطة العلاجية.',
    <Button size="sm" icon="bell" loading={busy} onClick={enable}>تفعيل الإشعارات</Button>);
  if (st === 'denied') return box('warn', 'alert', 'الإشعارات محظورة على هذا الجهاز', 'رفضت الإذن قبل كذا، فما راح يوصلك أي إشعار على الشاشة. فعّلها من إعدادات المتصفح أو الجوال لهذا الموقع، وبعدها ارجع هنا. الإشعارات تظل تظهر في هذي الصفحة.');
  if (st === 'ios-needs-install') return box('info', 'download', 'على iPhone: ثبّت التطبيق أولًا', 'من Safari اضغط «مشاركة» ← «إضافة إلى الشاشة الرئيسية»، وافتح التطبيق من الشاشة الرئيسية ثم فعّل الإشعارات.');
  if (st === 'not-configured') return box('warn', 'alert', 'إشعارات الجوال غير مهيّأة على الخادم بعد', 'الإشعارات تظهر هنا داخل التطبيق فقط.');
  return box('warn', 'alert', 'هذا المتصفح ما يدعم إشعارات الجوال', isIOS ? 'حدّث iOS إلى 16.4 أو أحدث وثبّت التطبيق.' : 'جرّب Chrome أو Edge أو Safari حديث. الإشعارات تظهر هنا داخل التطبيق.');
}
