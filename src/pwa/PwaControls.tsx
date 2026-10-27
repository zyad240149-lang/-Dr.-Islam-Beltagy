// أزرار الـ PWA داخل النظام: "تثبيت التطبيق" / "التطبيق مثبت ✓" + تفعيل الإشعارات + شريط "تحديث متاح".
// كل المنطق في pwa.ts — هنا عرض فقط.
import { useEffect, useState } from 'react';
import { Icon } from '../utils/icons';
import { useNewVersion } from './version';
import { Modal, Button } from '../components/ui';
import { useToast } from '../hooks/useToast';
import { applyUpdate, currentPushSubscription, disablePush, enablePush, installMethod, isIOS, promptInstall, pushSupport, sendTestPush, usePwa } from './pwa';

function InstallHelp({ method, onClose }: { method: ReturnType<typeof installMethod>; onClose: () => void }) {
  return (
    <Modal title="تثبيت التطبيق" onClose={onClose} footer={<Button onClick={onClose}>تم</Button>}>
      {method === 'ios' && (
        <>
          <p style={{ marginBottom: 12 }}>لتثبيت التطبيق على {/iPad/.test(navigator.userAgent) || navigator.maxTouchPoints > 1 && /Macintosh/.test(navigator.userAgent) ? 'iPad' : 'iPhone'}:</p>
          <ol className="pwa-steps">
            <li>اضغط زر المشاركة <Icon name="share" size={17} /> في شريط Safari.</li>
            <li>اختر <strong>«إضافة إلى الشاشة الرئيسية»</strong>.</li>
            <li>اضغط <strong>«إضافة»</strong>.</li>
          </ol>
          <p className="muted" style={{ fontSize: 13, marginTop: 12 }}>بعدها افتح التطبيق من أيقونته على الشاشة الرئيسية — ومن داخله تقدر تفعّل الإشعارات (iOS 16.4 أو أحدث).</p>
        </>
      )}
      {method === 'mac-safari' && (
        <ol className="pwa-steps">
          <li>من قائمة <strong>File (ملف)</strong> في Safari اختر <strong>«Add to Dock» / «إضافة إلى Dock»</strong>.</li>
          <li>اضغط <strong>«إضافة»</strong> — يظهر التطبيق في Dock ومجلد التطبيقات ويفتح في نافذة مستقلة.</li>
        </ol>
      )}
      {method === 'manual' && (
        <ol className="pwa-steps">
          <li>افتح قائمة المتصفح <strong>⋮</strong>.</li>
          <li>اختر <strong>«تثبيت التطبيق»</strong> أو <strong>«إضافة إلى الشاشة الرئيسية»</strong>.</li>
          <li>أكّد التثبيت.</li>
        </ol>
      )}
    </Modal>
  );
}

// تحديث يدوي: نمسح كاش الـ Service Worker ونحمّل آخر نسخة من السيرفر
export async function hardRefresh() {
  try {
    const regs = (await navigator.serviceWorker?.getRegistrations?.()) ?? [];
    await Promise.all(regs.map((r) => r.update().catch(() => undefined)));
    if ('caches' in window) await Promise.all((await caches.keys()).map((k) => caches.delete(k)));
  } catch { /* نكمّل بإعادة التحميل */ }
  location.reload();
}

export function PwaControls() {
  const pwa = usePwa();
  const toast = useToast();
  const [help, setHelp] = useState(false);
  const [pushOn, setPushOn] = useState<boolean | null>(null);
  const [busy, setBusy] = useState(false);
  const [refreshing, setRefreshing] = useState(false);
  const method = installMethod(pwa);
  const push = pushSupport();

  const [ask, setAsk] = useState(false);
  useEffect(() => { currentPushSubscription().then((s) => setPushOn(!!s)).catch(() => setPushOn(false)); }, [pwa.swActive]);

  // أول فتح للتطبيق المثبت (ومنه iPhone — الإشعارات هناك بتشتغل بس من التطبيق المثبت): نعرض «فعّل الإشعارات» مرة واحدة
  useEffect(() => {
    if (!pwa.standalone || pushOn !== false || push !== 'supported' || Notification.permission !== 'default') return;
    try { if (localStorage.getItem('ortho_push_asked')) return; localStorage.setItem('ortho_push_asked', '1'); } catch { /* ignore */ }
    setAsk(true);
  }, [pwa.standalone, pushOn, push]);

  const install = async () => {
    if (method === 'native') {
      const r = await promptInstall();
      if (r === 'accepted') {
        toast.success('جارٍ تثبيت التطبيق…');
        // التثبيت + الإشعارات مع بعض: نطلب الإذن على طول، ولو المتصفح ماعرضش السؤال نعرض نافذتنا بزرار
        if (push === 'supported' && !pushOn && Notification.permission === 'default') {
          const ok = await turnOn();
          if (!ok && Notification.permission === 'default') setAsk(true);
        }
      }
    } else setHelp(true);
  };

  const turnOn = async (): Promise<boolean> => {
    const r = await enablePush();
    if (!r.ok) { if (Notification.permission !== 'default') toast.error(r.error); return false; }
    setPushOn(true);
    const t = await sendTestPush();
    toast.success(t.ok ? 'تم تفعيل الإشعارات — أرسلنا إشعارًا تجريبيًا.' : 'تم تفعيل الإشعارات.');
    return true;
  };

  const togglePush = async () => {
    setBusy(true);
    try {
      if (pushOn) { await disablePush(); setPushOn(false); toast.info('تم إيقاف الإشعارات على هذا الجهاز.'); return; }
      const r = await enablePush();
      if (!r.ok) { toast.error(r.error); return; }
      setPushOn(true);
      const t = await sendTestPush();
      toast.success(t.ok ? 'تم تفعيل الإشعارات — أرسلنا إشعارًا تجريبيًا.' : 'تم تفعيل الإشعارات.');
    } finally { setBusy(false); }
  };

  return (
    <>
      <button className="logout-btn" style={{ marginBottom: 6 }} onClick={() => { setRefreshing(true); void hardRefresh(); }} disabled={refreshing}>
        <Icon name="refresh" size={18} />{refreshing ? 'جارٍ التحديث…' : 'تحديث النظام'}
      </button>
      {method !== 'none' && (
        <button className="logout-btn" style={{ marginBottom: 6 }} onClick={install}><Icon name="download" size={18} />تثبيت التطبيق</button>
      )}
      {(pwa.standalone || pwa.installed) && (
        <div className="logout-btn pwa-installed" style={{ marginBottom: 6, cursor: 'default' }} aria-live="polite"><Icon name="check" size={18} />التطبيق مثبت ✓</div>
      )}
      {(push === 'supported' || (push === 'ios-needs-install' && isIOS)) && (
        <button className="logout-btn" style={{ marginBottom: 6 }} disabled={busy || pushOn === null} onClick={push === 'supported' ? togglePush : () => setHelp(true)}>
          <Icon name="bell" size={18} />{push === 'ios-needs-install' ? 'الإشعارات (ثبّت التطبيق أولًا)' : pushOn ? 'إيقاف الإشعارات' : 'تفعيل الإشعارات'}
        </button>
      )}
      {ask && (
        <Modal title="فعّل الإشعارات" onClose={() => setAsk(false)} footer={<><Button variant="outline" onClick={() => setAsk(false)}>لاحقًا</Button><Button icon="bell" loading={busy} onClick={async () => { setBusy(true); try { await turnOn(); } finally { setBusy(false); setAsk(false); } }}>تفعيل الإشعارات</Button></>}>
          <p>فعّل الإشعارات ليصلك تأكيد مواعيدك والتذكيرات والعروض على الجوال، حتى لو كان التطبيق مغلقًا.</p>
        </Modal>
      )}
      {help && <InstallHelp method={method === 'none' ? (isIOS ? 'ios' : 'manual') : method} onClose={() => setHelp(false)} />}
    </>
  );
}

export function PwaUpdateBanner() {
  const { updateReady } = usePwa();
  const newVersion = useNewVersion();
  const stale = updateReady || newVersion;
  // التحديث بيوصل لكل الأجهزة لوحده: أول ما يبان إن فيه نسخة جديدة، الصفحة بتتحدّث تلقائيًا في أقرب لحظة آمنة —
  // ما فيه نافذة مفتوحة ولا خانة بيتكتب فيها، والمستخدم ما لمس الكيبورد/الماوس آخر 20 ثانية (أو رجع للتبويب بعد ما كان مخفي).
  useEffect(() => {
    if (!stale) return;
    let last = Date.now();
    const touch = () => { last = Date.now(); };
    const busy = () => !!document.querySelector('.overlay') || (document.activeElement instanceof HTMLElement && /^(INPUT|TEXTAREA|SELECT)$/.test(document.activeElement.tagName));
    const go = () => { if (busy()) return; if (updateReady) applyUpdate(); else location.reload(); };
    const t = setInterval(() => { if (Date.now() - last > 20_000) go(); }, 5_000);
    const vis = () => { if (document.visibilityState === 'visible') go(); };
    const evs = ['keydown', 'pointerdown', 'input', 'wheel', 'touchstart'];
    evs.forEach((e) => document.addEventListener(e, touch, { passive: true }));
    document.addEventListener('visibilitychange', vis);
    return () => { clearInterval(t); evs.forEach((e) => document.removeEventListener(e, touch)); document.removeEventListener('visibilitychange', vis); };
  }, [stale, updateReady]);
  if (!stale) return null;
  return (
    <div className="alert alert-info pwa-update no-print" role="status">
      <Icon name="refresh" size={17} />
      <span style={{ flex: 1 }}>فيه تحديث جديد للنظام — بيتحدّث لوحده بعد ثواني (أو اضغط «تحديث» الحين).</span>
      <Button size="sm" icon="refresh" onClick={() => (updateReady ? applyUpdate() : location.reload())}>تحديث</Button>
    </div>
  );
}

// زر «تحديث» ظاهر دايمًا في الشريط العلوي (كمبيوتر وموبايل)
export function RefreshButton({ compact }: { compact?: boolean }) {
  const [busy, setBusy] = useState(false);
  return (
    <Button variant="outline" size="sm" icon="refresh" loading={busy} onClick={() => { setBusy(true); void hardRefresh(); }} aria-label="تحديث النظام" title="تحديث النظام" style={{ marginInlineEnd: 8 }}>
      {compact ? null : 'تحديث'}
    </Button>
  );
}
