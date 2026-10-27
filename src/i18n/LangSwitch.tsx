import { LANG, setLang } from '.';

// زرار تبديل اللغة — بيعرض اسم اللغة التانية بلغتها (data-no-i18n عشان مايتترجمش)
export function LangSwitch({ className = 'icon-btn', style }: { className?: string; style?: React.CSSProperties }) {
  const next = LANG === 'en' ? 'ar' : 'en';
  return (
    <button type="button" className={className} data-no-i18n onClick={() => setLang(next)}
      title={next === 'en' ? 'English' : 'العربية'} aria-label={next === 'en' ? 'Switch to English' : 'التحويل للعربية'}
      style={{ width: 'auto', paddingInline: 12, fontWeight: 700, fontSize: 13.5, ...style }}>
      {next === 'en' ? 'EN' : 'ع'}
    </button>
  );
}
