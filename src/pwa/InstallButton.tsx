// زرار "تثبيت التطبيق" — بيظهر بس لو التطبيق مش متثبت، وبيتصرف حسب المنصة (نافذة رسمية / تعليمات آيفون / تعليمات ماك سفاري / تعليمات أندرويد يدوي)
import { useState } from 'react';
import { Icon } from '../utils/icons';
import { installMethod, isIOSSafari, promptInstall, usePwa } from './pwa';

export default function InstallButton({ className = 'lp-btn lp-btn--outline' }: { className?: string }) {
  const pwa = usePwa();
  const [tip, setTip] = useState<string | null>(null);
  const method = installMethod(pwa);

  if (method === 'none') return null;

  const click = async () => {
    if (method === 'native') { await promptInstall(); return; }
    if (method === 'ios') { setTip(isIOSSafari ? 'اضغط زر المشاركة (Share) تحت، واختر "إضافة إلى الشاشة الرئيسية"' : 'افتح الرابط في Safari، ثم زر المشاركة (Share) ← "إضافة إلى الشاشة الرئيسية"'); return; }
    if (method === 'mac-safari') { setTip('من قائمة الملف File ← "Add to Dock"'); return; }
    setTip('من قائمة المتصفح (⋮) اختر "تثبيت التطبيق" أو "إضافة إلى الشاشة الرئيسية"');
  };

  return (
    <span className="install-btn-wrap">
      <button type="button" className={className} onClick={click}>
        <Icon name="download" size={18} />تثبيت التطبيق
      </button>
      {tip && (
        <span className="install-btn-tip" role="status">
          {tip}
          <button type="button" aria-label="إغلاق" onClick={() => setTip(null)}><Icon name="close" size={14} /></button>
        </span>
      )}
    </span>
  );
}
