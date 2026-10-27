// محرك الترجمة (عربي ↔ إنجليزي) — نفس الملف منسوخ في portal/src/i18n و js/i18n.js للموقع العام (admin/scripts/i18n-sync.cjs).
// الفكرة: الكود كله مكتوب عربي زي ما هو، وبنراقب الصفحة (MutationObserver) ونبدّل النصوص وقت العرض:
//   - الإنجليزي: أي نص عربي ← القاموس الثابت (واجهة السيستم)، واللي مش فيه (أسماء، ملاحظات، تشخيص، إشعارات...) ← ترجمة آلية.
//   - العربي: أي نص إنجليزي كتبه حد (اسم، ملاحظة...) ← ترجمة آلية للعربي.
// الترجمة الآلية من Edge Function "translate" (Claude + كاش مشترك في قاعدة البيانات) + كاش على الجهاز.
// خانات الإدخال مابتتلمسش — المستخدم بيعدّل النص الأصلي زي ما كتبه.

export type Lang = 'ar' | 'en';
export interface Dict { exact: Record<string, string>; patterns: Record<string, string>; keep?: string[] }
export type RemoteFetch = (texts: string[], target: Lang) => Promise<Record<string, string>>;

const KEY = 'ortho.lang';
const AR = /[؀-ۿ]/;
const ATTRS = ['placeholder', 'title', 'aria-label', 'alt'];
const SKIP = new Set(['SCRIPT', 'STYLE', 'TEXTAREA', 'CODE', 'PRE']);

export function getLang(): Lang {
  try { return localStorage.getItem(KEY) === 'en' ? 'en' : 'ar'; } catch { return 'ar'; }
}
export function setLang(l: Lang) {
  try { localStorage.setItem(KEY, l); } catch { /* ignore */ }
  location.reload(); // التواريخ والأرقام بتتحسب وقت الرسم، فإعادة التحميل أضمن
}

const esc = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
const norm = (s: string) => s.replace(/\s+/g, ' ').trim();

export function createTranslator(dict: Dict) {
  const exact = new Map(Object.entries(dict.exact));
  // «{0} جلسات» ← /^(.+?) جلسات$/ ؛ الأطول الأول عشان الأدق يكسب
  const patterns = Object.entries(dict.patterns)
    .sort((a, b) => b[0].length - a[0].length)
    .map(([ar, en]) => {
      const parts = ar.split(/\{(\d+)\}/);
      let src = '^';
      for (let i = 0; i < parts.length; i++) src += i % 2 ? '([\\s\\S]+?)' : esc(parts[i]);
      // قالب «وحدات» (حروفه الثابتة ≤ 2 حرف زي «{0}د» أو «{0}س {1}د») مايتطبّقش غير على أرقام — وإلا بيبوّظ الأسماء اللي بتنتهي بـ د/س/م
      const unitOnly = parts.filter((_, i) => i % 2 === 0).join('').replace(/\s/g, '').length <= 2;
      return { re: new RegExp(src + '$'), en, unitOnly };
    });
  const cache = new Map<string, string | null>();

  function tr(s: string): string | null {
    const n = norm(s);
    if (!n || !AR.test(n)) return null;
    if (cache.has(n)) return cache.get(n)!;
    let out: string | null = exact.get(n) ?? null;
    if (out == null) {
      for (const p of patterns) {
        const m = n.match(p.re);
        if (m && p.unitOnly && m.slice(1).some((v) => !/^\s*\d+\s*$/.test(v))) continue;
        if (m) { out = p.en.replace(/\{(\d+)\}/g, (_, i) => { const v = m[+i + 1] ?? ''; return tr(v) ?? v; }); break; }
      }
    }
    // رسائل مركّبة من السيرفر («اسم — خدمة — تاريخ»، «أ · ب»): نترجم كل جزء معروف لوحده
    // بنجرّب الفواصل الكبيرة (— · ← |) الأول، وبعدين «: » — عشان نص زي «ملف (بيانات: كذا) — اطلاع» مايتقطّعش عند «: » اللي جوّه القوس
    for (const sep of [/(\s[—·←|]\s)/, /(:\s)/]) {
      if (out != null || !sep.test(n)) continue;
      const parts = n.split(sep);
      let hit = false;
      const joined = parts.map((x, i) => { if (i % 2) return x; const t = tr(x); if (t != null) hit = true; return t ?? x; }).join('');
      if (hit && !parts.some((x, i) => i % 2 === 0 && AR.test(x) && tr(x) == null)) out = joined;
    }
    // فاصل متروك في آخر النص («علاج طبيعي ·») — نترجم الأصل ونسيب الفاصل
    if (out == null) {
      const tail = n.match(/^(.*\S)\s([·—|:،])$/);
      if (tail) { const t = tr(tail[1]); if (t != null) out = `${t} ${tail[2]}`; }
    }
    cache.set(n, out);
    return out;
  }
  // بيحافظ على المسافات اللي قبل وبعد النص
  const wrap = (s: string, t: string) => s.match(/^\s*/)![0] + t + s.match(/\s*$/)![0];
  const translate = (s: string) => { const t = tr(s); return t == null ? s : wrap(s, t); };
  return { translate, tr, wrap };
}

// نص إنجليزي «مكتوب» يستاهل يتترجم للعربي (مش كود ولا رقم ولا إيميل ولا لينك)
function isLatinText(n: string) {
  if (AR.test(n) || !/[A-Za-z]{2,}/.test(n)) return false;
  if (/^[\w.+-]+@[\w-]+\.[\w.]+$/.test(n) || /^(https?:|www\.)/i.test(n)) return false;
  if (/^[A-Z0-9][A-Z0-9\-_/.#:+ ]*$/.test(n)) return false; // أكواد: MV-2694، INV-1042، ICD-10، SAR، PDF
  return true;
}

// كاش الترجمة الآلية على الجهاز
function memo(lang: Lang) {
  const key = 'ortho.tr.' + lang;
  let data: Record<string, string> = {};
  try { data = JSON.parse(localStorage.getItem(key) || '{}'); } catch { /* ignore */ }
  let t: ReturnType<typeof setTimeout> | undefined;
  return {
    get: (s: string) => data[s],
    set(entries: Record<string, string>) {
      Object.assign(data, entries);
      clearTimeout(t);
      t = setTimeout(() => {
        const keys = Object.keys(data);
        if (keys.length > 4000) for (const k of keys.slice(0, keys.length - 4000)) delete data[k];
        try { localStorage.setItem(key, JSON.stringify(data)); } catch { /* ignore */ }
      }, 500);
    },
  };
}

// تشغيل على الصفحة كلها
// names: أسماء الأشخاص المسجّلة (مرضى، أطباء، موظفين) — بتفضل زي ما اتسجّلت ومابتتترجمش، حتى لو جوّه جملة
export function startDomTranslation(dict: Dict | null, opts: { lang: Lang; remote?: RemoteFetch; root?: Node; names?: () => Iterable<string> }) {
  const { lang, remote } = opts;
  let nameSet = new Set<string>();
  let nameList: string[] = [];
  const refreshNames = () => {
    if (!opts.names) return;
    const next = new Set([...opts.names()].map(norm).filter((x) => x.length >= 3));
    if (next.size !== nameSet.size) { nameSet = next; nameList = [...next].sort((a, b) => b.length - a.length); }
  };
  // الأسماء بتتحط مكانها علامات ⟦0⟧ قبل الإرسال للترجمة وترجع بعدها
  const mask = (k: string) => {
    const tokens: string[] = [];
    let m = k;
    for (const name of nameList) if (m.includes(name)) { m = m.split(name).join(`⟦${tokens.length}⟧`); tokens.push(name); }
    return { masked: m, unmask: (s: string) => s.replace(/⟦(\d+)⟧/g, (_, i) => tokens[+i] ?? '') };
  };
  const root = opts.root ?? document.body;
  const local = createTranslator(dict ?? { exact: {}, patterns: {} });
  const keep = new Set((dict?.keep ?? []).map(norm));
  const store = memo(lang);
  const mine = new WeakMap<object, string>(); // آخر قيمة كتبناها بنفسنا (عشان مانترجمش ترجمتنا تاني)

  // هل النص محتاج ترجمة للغة الحالية؟
  const wants = (n: string) => !nameSet.has(n) && (lang === 'en' ? AR.test(n) : isLatinText(n) && !keep.has(n));
  // ترجمة فورية (القاموس أو الكاش)؛ null = محتاج ترجمة آلية
  const instant = (v: string): string | null => {
    const n = norm(v);
    if (lang === 'en') { const t = local.tr(v); if (t != null) return local.wrap(v, t); }
    const r = store.get(n);
    return r != null ? local.wrap(v, r) : null;
  };

  // طابور الترجمة الآلية: بنجمّع النصوص الناقصة ونبعتها دفعة واحدة
  type Target = { node: Text } | { el: Element; attr: string };
  const waiting = new Map<string, Set<Target>>();
  const inflight = new Set<string>();
  const failed = new Set<string>();
  let timer: ReturnType<typeof setTimeout> | undefined;
  const enqueue = (n: string, tgt: Target) => {
    if (!remote || failed.has(n)) return;
    (waiting.get(n) ?? waiting.set(n, new Set()).get(n)!).add(tgt);
    clearTimeout(timer);
    timer = setTimeout(flush, 250);
  };
  const apply = (tgt: Target, src: string, out: string) => {
    if ('node' in tgt) {
      const v = tgt.node.nodeValue ?? '';
      if (norm(v) !== src) return; // النص اتغيّر من ساعتها
      const w = local.wrap(v, out); mine.set(tgt.node, w); tgt.node.nodeValue = w;
    } else {
      const v = tgt.el.getAttribute(tgt.attr) ?? '';
      if (norm(v) === src) tgt.el.setAttribute(tgt.attr, out);
    }
  };
  async function flush() {
    const batch = [...waiting.keys()].filter((k) => !inflight.has(k)).slice(0, 60);
    if (!batch.length || !remote) return;
    batch.forEach((k) => inflight.add(k));
    refreshNames();
    const masks = new Map(batch.map((k) => [k, mask(k)]));
    const send = [...new Set([...masks.values()].map((x) => x.masked).filter((x) => (lang === 'en' ? AR : /[A-Za-z]{2,}/).test(x.replace(/⟦\d+⟧/g, ''))))];
    let raw: Record<string, string> = {};
    try { if (send.length) raw = await remote(send, lang); } catch { /* الشبكة — نسيب النص الأصلي */ }
    const res: Record<string, string> = {};
    for (const [k, { masked, unmask }] of masks) {
      if (!send.includes(masked)) res[k] = k; // كله أسماء — يفضل زي ما هو
      else if (raw[masked] != null) res[k] = unmask(raw[masked]);
    }
    store.set(res);
    for (const k of batch) {
      inflight.delete(k);
      const tgts = waiting.get(k); waiting.delete(k);
      const out = res[k];
      if (out == null) { failed.add(k); continue; }
      tgts?.forEach((t) => apply(t, k, out));
    }
    if (waiting.size) { clearTimeout(timer); timer = setTimeout(flush, 50); }
  }

  const doText = (t: Text) => {
    const v = t.nodeValue ?? '';
    if (mine.get(t) === v) return;
    const n = norm(v);
    if (!n || !wants(n)) return;
    const p = t.parentElement;
    if (!p || SKIP.has(p.tagName) || p.closest('[data-no-i18n],[contenteditable="true"]')) return;
    const out = instant(v);
    if (out != null) { if (out !== v) { mine.set(t, out); t.nodeValue = out; } }
    else enqueue(n, { node: t });
  };
  const doEl = (el: Element) => {
    if (el.tagName === 'SCRIPT' || el.tagName === 'STYLE') return;
    if (el.closest('[data-no-i18n]')) return;
    for (const a of ATTRS) {
      const v = el.getAttribute(a);
      if (!v) continue;
      const n = norm(v);
      if (!wants(n)) continue;
      const out = instant(v);
      if (out != null) { if (out !== v) el.setAttribute(a, out); } else enqueue(n, { el, attr: a });
    }
    // أزرار <input type=button/submit> بس — قيم الخانات العادية بيانات المستخدم
    if (el instanceof HTMLInputElement && (el.type === 'button' || el.type === 'submit') && wants(norm(el.value))) {
      const out = instant(el.value); if (out != null) el.value = out;
    }
  };
  const walk = (n: Node) => {
    if (n.nodeType === 3) { doText(n as Text); return; }
    if (n.nodeType !== 1) return;
    const el = n as Element;
    doEl(el);
    if (SKIP.has(el.tagName)) return;
    const it = document.createTreeWalker(el, NodeFilter.SHOW_TEXT | NodeFilter.SHOW_ELEMENT);
    for (let c = it.nextNode(); c; c = it.nextNode()) c.nodeType === 3 ? doText(c as Text) : doEl(c as Element);
  };

  refreshNames();
  walk(root);
  const doTitle = () => { if (lang === 'en' && AR.test(document.title)) document.title = local.translate(document.title); };
  doTitle();
  // الأسماء بتوصل بعد الدخول (بعد أول رسم) — فبنجدّد القائمة مع كل دفعة تغييرات (مرة كل 400ms) عشان الاسم مايتترجمش
  let lastNames = 0;
  new MutationObserver((muts) => {
    if (Date.now() - lastNames > 400) { lastNames = Date.now(); refreshNames(); }
    for (const m of muts) {
      if (m.type === 'characterData') doText(m.target as Text);
      else if (m.type === 'attributes') doEl(m.target as Element);
      else m.addedNodes.forEach(walk);
    }
  }).observe(root, { subtree: true, childList: true, characterData: true, attributes: true, attributeFilter: ATTRS });
  new MutationObserver(doTitle).observe(document.querySelector('title') ?? document.head, { childList: true, characterData: true, subtree: true });
  return local.translate;
}

// اتجاه الصفحة ولغتها — قبل أول رسم
export function applyDocumentLang(l: Lang) {
  document.documentElement.lang = l;
  document.documentElement.dir = l === 'en' ? 'ltr' : 'rtl';
}

// عميل Edge Function "translate" — token: جلسة المستخدم لو موجودة (الترجمة الجديدة للمسجّلين بس، والزائر بياخد من الكاش)
export function remoteTranslator(functionsUrl: string, anonKey: string, getToken: () => Promise<string | null>): RemoteFetch {
  return async (texts, target) => {
    const token = (await getToken()) ?? anonKey;
    const r = await fetch(functionsUrl.replace(/\/$/, '') + '/translate', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', apikey: anonKey, Authorization: 'Bearer ' + token },
      body: JSON.stringify({ target, texts }),
    });
    if (!r.ok) return {};
    const j = await r.json();
    return j.translations ?? {};
  };
}
