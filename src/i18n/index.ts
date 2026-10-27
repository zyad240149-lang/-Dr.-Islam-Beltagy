// اللغة: عربي (الأصل) أو إنجليزي.
// - القاموس الكامل بيتحمّل بس في الإنجليزي (مايتقلش على مستخدمي العربي).
// - الترجمة الآلية شغالة في الاتجاهين: أي كلام مكتوب (اسم، ملاحظة، تشخيص...) بيظهر باللغة المختارة.
import { applyDocumentLang, getLang, setLang, startDomTranslation, type Dict, type Lang } from './engine';

export { getLang, setLang, type Lang };
export const LANG: Lang = getLang();
export const isEn = LANG === 'en';

export async function loadDict(): Promise<Dict> {
  const parts = import.meta.glob<{ default: Record<string, string> }>('./en/[0-9]*.json');
  const exact: Record<string, string> = {};
  for (const load of Object.values(parts)) Object.assign(exact, (await load()).default);
  const patterns = (await import('./en/patterns.json')).default as Record<string, string>;
  const keep = (await import('./en/keep.json')).default as string[];
  return { exact, patterns, keep };
}


// قبل رسم الواجهة: الاتجاه واللغة، وبعدين تشغيل الترجمة على الصفحة كلها
export async function initI18n() {
  applyDocumentLang(LANG);
  if (LANG !== 'en') return; // العربي: مفيش محرك ترجمة خالص (أخف على الموبايل)
  const dict: Dict = LANG === 'en'
    ? await loadDict()
    : { exact: {}, patterns: {}, keep: (await import('./en/keep.json')).default as string[] };
  const { db } = await import('../data/db');
  startDomTranslation(dict, {
    lang: LANG,
    // أسماء الأشخاص بتفضل زي ما اتسجّلت
    names: () => { const d = db.raw(); return [...d.patients.map((x) => x.fullName), ...d.therapists.map((x) => x.name), ...d.employees.map((x) => x.name)]; },
  });
}
