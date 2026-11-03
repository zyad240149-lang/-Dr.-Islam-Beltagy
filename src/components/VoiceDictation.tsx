// الإملاء الصوتي: الكلام بيتحوّل لكتابة في الخانة اللي مفتوحة (آخر خانة نصية اتضغط عليها جوّه النافذة).
// بيشتغل بتعرّف الكلام في المتصفح (Chrome / Edge / Safari) وبيحتاج إنترنت وإذن الميكروفون. مفيش حاجة بتتحفظ أو بتتبعت — النص بيتكتب في الخانة بس.
// النص بيظهر أول بأول وانت بتتكلم (نتايج مؤقتة) وبيتثبت لما الجملة تخلص؛ الكلام الجديد بيتضاف بعد اللي مكتوب — عمره ما بيمسح المحتوى القديم.
// الكتابة المؤقتة بتتجمع في إطار رسم واحد (requestAnimationFrame) عشان الصفحة ماتتقلش وانت بتتكلم.
import { useEffect, useRef, useState } from 'react';
import { Icon } from '../utils/icons';
import { useToast } from '../hooks/useToast';
import { Button, Modal } from './ui';

type Rec = { lang: string; continuous: boolean; interimResults: boolean; maxAlternatives: number; start: () => void; stop: () => void; abort: () => void; onresult: ((e: any) => void) | null; onend: (() => void) | null; onerror: ((e: any) => void) | null }; // eslint-disable-line @typescript-eslint/no-explicit-any
const SR = (): (new () => Rec) | null => { const w = window as unknown as { SpeechRecognition?: new () => Rec; webkitSpeechRecognition?: new () => Rec }; return w.SpeechRecognition ?? w.webkitSpeechRecognition ?? null; };
const TEXT_TYPES = new Set(['', 'text', 'search', 'tel', 'number']);
type El = HTMLInputElement | HTMLTextAreaElement;
const isField = (t: EventTarget | null): t is El =>
  t instanceof HTMLTextAreaElement || (t instanceof HTMLInputElement && TEXT_TYPES.has(t.type) && !t.readOnly && !t.disabled);

// علامات الترقيم بالكلام: «فاصلة» ← ، / «نقطة» ← . / «علامة استفهام» ← ؟ / «سطر جديد» ← سطر
const PUNCT_AR: [RegExp, string][] = [
  [/\s*(?:علامة|علامه)\s+(?:استفهام)\s*/g, '؟ '], [/\s*(?:علامة|علامه)\s+(?:تعجب)\s*/g, '! '],
  [/\s*(?:سطر جديد|فقرة جديدة|فقره جديده)\s*/g, '\n'],
  [/\s*(?:فاصلة|فاصله|فصلة|فصله)\s*/g, '، '], [/\s*(?:نقطتين|نقطتان)\s*/g, ': '], [/\s*(?:نقطة|نقطه)\s*/g, '. '],
];
const PUNCT_EN: [RegExp, string][] = [
  [/\s*\bquestion mark\b\s*/gi, '? '], [/\s*\bexclamation (?:mark|point)\b\s*/gi, '! '], [/\s*\bnew line\b\s*/gi, '\n'],
  [/\s*\bcomma\b\s*/gi, ', '], [/\s*\bcolon\b\s*/gi, ': '], [/\s*\b(?:full stop|period)\b\s*/gi, '. '],
];
function punctuate(text: string, lang: string) {
  let t = text;
  for (const [re, rep] of lang.startsWith('ar') ? PUNCT_AR : PUNCT_EN) t = t.replace(re, rep);
  return t.replace(/[ \t]+\n/g, '\n').replace(/ {2,}/g, ' ');
}
const join = (a: string, b: string) => { const x = b.replace(/^ +/, ''); return !x ? a : a + (a && !/\s$/.test(a) && !/^[،,.؟?!:\n]/.test(x) ? ' ' : '') + x; };

function writeValue(el: El, value: string) {
  const proto = el instanceof HTMLTextAreaElement ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype;
  const set = Object.getOwnPropertyDescriptor(proto, 'value')?.set;
  if (!set) return;
  set.call(el, value);
  el.dispatchEvent(new Event('input', { bubbles: true })); // React بيلقط التغيير من الحدث ده
  if (el instanceof HTMLTextAreaElement) el.scrollTop = el.scrollHeight;
}

// ---------- إذن الميكروفون ----------
type MicState = 'granted' | 'denied' | 'prompt' | 'unknown';
async function micPermission(): Promise<MicState> {
  try {
    const st = await navigator.permissions?.query({ name: 'microphone' as PermissionName });
    return (st?.state as MicState) ?? 'unknown';
  } catch { return 'unknown'; } // Safari/Firefox القديمة مابتدعمش السؤال عن الميكروفون
}
/** بيطلب الإذن من المتصفح (بيظهر سؤال «السماح بالميكروفون» لو لسه ما اتسألش) */
async function requestMic(): Promise<boolean> {
  try {
    const s = await navigator.mediaDevices.getUserMedia({ audio: true });
    s.getTracks().forEach((t) => t.stop());
    return true;
  } catch { return false; }
}
function platform() {
  const ua = navigator.userAgent;
  if (/iPhone|iPad|iPod/.test(ua) || (/Macintosh/.test(ua) && navigator.maxTouchPoints > 1)) return 'ios';
  if (/Android/.test(ua)) return 'android';
  if (/Edg\//.test(ua)) return 'edge';
  if (/Chrome\//.test(ua)) return 'chrome';
  if (/Safari\//.test(ua)) return 'safari';
  return 'other';
}
const STEPS: Record<string, string[]> = {
  chrome: ['اضغط على أيقونة القفل 🔒 (أو أيقونة الإعدادات) جنب عنوان الموقع فوق.', 'اختار «الميكروفون» ← «السماح».', 'لو مش ظاهر: افتح إعدادات Chrome ← الخصوصية والأمان ← إعدادات الموقع ← الميكروفون، وشيل الموقع ده من «غير مسموح».', 'ارجع هنا واضغط «جرّب تاني».'],
  edge: ['اضغط على أيقونة القفل 🔒 جنب عنوان الموقع فوق.', 'اختار «أذونات هذا الموقع» ← الميكروفون ← «السماح».', 'أو من الإعدادات ← ملفات تعريف الارتباط وأذونات الموقع ← الميكروفون.', 'ارجع هنا واضغط «جرّب تاني».'],
  android: ['اضغط على أيقونة القفل 🔒 جنب العنوان ← الأذونات ← الميكروفون ← سماح.', 'لو المتصفح نفسه ممنوع من الميكروفون: إعدادات الموبايل ← التطبيقات ← Chrome ← الأذونات ← الميكروفون ← السماح.', 'ارجع هنا واضغط «جرّب تاني».'],
  ios: ['افتح «الإعدادات» في الآيفون ← Safari (أو Chrome) ← الميكروفون ← اختار «السماح» أو «اسأل».', 'في Safari: اضغط «aA» جنب العنوان ← إعدادات موقع الويب ← الميكروفون ← سماح.', 'ارجع هنا واضغط «جرّب تاني».'],
  safari: ['من قايمة Safari ← الإعدادات ← مواقع الويب ← الميكروفون.', 'اختار «السماح» للموقع ده.', 'ارجع هنا واضغط «جرّب تاني».'],
  other: ['افتح إعدادات الموقع في المتصفح (أيقونة القفل جنب العنوان) واسمح بالميكروفون.', 'الإملاء الصوتي بيشتغل أحسن على Chrome أو Edge.', 'ارجع هنا واضغط «جرّب تاني».'],
};

function MicHelp({ onRetry, onClose }: { onRetry: () => void; onClose: () => void }) {
  const p = platform();
  const [busy, setBusy] = useState(false);
  return (
    <Modal title="محتاجين إذن الميكروفون" onClose={onClose} footer={<>
      <Button variant="outline" onClick={onClose}>إغلاق</Button>
      <Button icon="mic" loading={busy} onClick={async () => { setBusy(true); const ok = await requestMic(); setBusy(false); if (ok) onRetry(); }}>جرّب تاني</Button>
    </>}>
      <div className="vd-help">
        <p style={{ marginTop: 0 }}><b>الميكروفون مقفول للموقع ده</b> — عشان كده الإملاء الصوتي مش شغال. فعّله بالخطوات دي:</p>
        <ol>{STEPS[p].map((s) => <li key={s}>{s}</li>)}</ol>
        {!window.isSecureContext && <p className="alert alert-warn">الموقع لازم يتفتح بـ https عشان المتصفح يسمح بالميكروفون.</p>}
        <p className="muted-sm" style={{ marginBottom: 0 }}>أول ما تسمح بالميكروفون، النافذة دي بتتقفل لوحدها والإملاء بيبدأ.</p>
      </div>
    </Modal>
  );
}

export function VoiceDictation() {
  const toast = useToast();
  const [on, setOn] = useState(false);
  const [help, setHelp] = useState(false);
  const [live, setLive] = useState(''); // آخر كلام مؤقت (للعرض تحت الزرار)
  const [lang, setLang] = useState<'ar-EG' | 'en-US'>('ar-EG');
  const field = useRef<El | null>(null);
  const rec = useRef<Rec | null>(null);
  const active = useRef(false);
  const timer = useRef<number | undefined>(undefined);
  const frame = useRef(0);
  const startedAt = useRef(0);
  const quick = useRef(0); // كام مرة المتصفح قفل بسرعة ورا بعض (غالبًا مشكلة ميكروفون/لغة) — بنوقف بدل ما نلف في حلقة
  // النص الثابت في الخانة (من غير الكلام المؤقت) وآخر قيمة كتبناها — لو المستخدم كتب بإيده بنبدأ من كلامه هو
  const committed = useRef<string | null>(null);
  const written = useRef<string | null>(null);

  useEffect(() => {
    const onFocus = (e: FocusEvent) => {
      if (!isField(e.target) || !e.target.closest('.modal')) return;
      if (e.target !== field.current) { flushInterim(); committed.current = null; }
      field.current = e.target;
    };
    document.addEventListener('focusin', onFocus);
    return () => { document.removeEventListener('focusin', onFocus); active.current = false; window.clearTimeout(timer.current); cancelAnimationFrame(frame.current); try { rec.current?.abort(); } catch { /* مقفول */ } };
  }, []);

  // الكلام المؤقت اللي لسه ما اتثبتش بيتشال من الخانة (اللي اتثبت بيفضل)
  function flushInterim() {
    const el = field.current;
    if (el && committed.current !== null && written.current === el.value && el.value !== committed.current && document.contains(el)) writeValue(el, committed.current);
    setLive('');
  }
  function stop() {
    active.current = false; window.clearTimeout(timer.current); cancelAnimationFrame(frame.current);
    setOn(false);
    try { rec.current?.stop(); } catch { /* مقفول بالفعل */ }
  }

  async function start(l = lang) {
    const Ctor = SR();
    if (!Ctor) { toast.error('المتصفح ده مش بيدعم الإملاء الصوتي — استخدم Chrome أو Edge (أو Safari على الآيفون).'); return; }
    if (!field.current || !document.contains(field.current)) { toast.info('اضغط على الخانة اللي عاوز تكتب فيها الأول، وبعدين شغّل الميكروفون.'); return; }
    // الإذن مقفول من قبل كده: المتصفح مش هيسأل تاني — نوضّح للمستخدم يفعّله إزاي
    const perm = await micPermission();
    if (perm === 'denied') { openHelp(); return; }
    const r = new Ctor();
    r.lang = l; r.continuous = true; r.interimResults = true; r.maxAlternatives = 1;
    r.onresult = (e) => {
      const el = field.current;
      if (!el || !document.contains(el)) return;
      if (committed.current === null || written.current !== el.value) committed.current = el.value; // المستخدم كتب/مسح بإيده
      let fin = '', interim = '';
      for (let i = e.resultIndex; i < e.results.length; i++) {
        const t = e.results[i][0].transcript as string;
        if (e.results[i].isFinal) fin += t; else interim += t;
      }
      if (fin) committed.current = join(committed.current, punctuate(fin, l).trim() + ' ').replace(/ $/, '');
      const shown = interim ? join(committed.current, punctuate(interim, l)) : committed.current;
      cancelAnimationFrame(frame.current);
      frame.current = requestAnimationFrame(() => { if (field.current === el) { written.current = shown; writeValue(el, shown); } });
      setLive(interim);
    };
    r.onerror = (e) => {
      if (e.error === 'not-allowed' || e.error === 'service-not-allowed') { stop(); openHelp(); }
      else if (e.error === 'network') { toast.error('الإملاء الصوتي محتاج اتصال بالإنترنت.'); stop(); }
      else if (e.error === 'audio-capture') { toast.error('مفيش ميكروفون شغال على الجهاز ده — اتأكد إنه متوصل ومش مستخدم في برنامج تاني.'); stop(); }
      else if (e.error === 'language-not-supported') { toast.error('اللغة دي مش مدعومة في المتصفح ده — جرّب English.'); stop(); }
    };
    r.onend = () => {
      flushInterim();
      if (!active.current) { setOn(false); return; }
      // المتصفح بيقفل بعد فترة صمت — بنكمّل على طول، ولو قفل بسرعة 3 مرات ورا بعض بنوقف
      quick.current = Date.now() - startedAt.current < 1500 ? quick.current + 1 : 0;
      if (quick.current >= 3) { toast.error('الإملاء الصوتي وقف — اتأكد من الميكروفون وجرّب تاني.'); stop(); return; }
      timer.current = window.setTimeout(() => { if (!active.current) return; try { startedAt.current = Date.now(); r.start(); } catch { stop(); } }, 120);
    };
    try { rec.current?.abort(); } catch { /* مفيش */ }
    rec.current = r; active.current = true; quick.current = 0; startedAt.current = Date.now(); committed.current = null;
    try { r.start(); setOn(true); } catch { stop(); }
  }
  function openHelp() {
    setHelp(true);
    // أول ما الإذن يتفعّل (من إعدادات المتصفح) النافذة بتتقفل والإملاء بيبدأ لوحده
    void navigator.permissions?.query({ name: 'microphone' as PermissionName }).then((st) => {
      st.onchange = () => { if (st.state === 'granted') { st.onchange = null; setHelp(false); void start(); } };
    }).catch(() => undefined);
  }
  const switchLang = () => { const l = lang === 'ar-EG' ? 'en-US' : 'ar-EG'; setLang(l); if (on) { stop(); setTimeout(() => void start(l), 200); } };
  // الضغط على الأزرار ما يسحبش التركيز من الخانة المفتوحة
  const keep = (e: React.MouseEvent) => e.preventDefault();

  return (
    <span className="vd">
      <button type="button" className={`btn btn--sm ${on ? 'vd-on' : 'btn--outline'}`} onMouseDown={keep} onClick={() => (on ? stop() : void start())} aria-pressed={on} title="إملاء صوتي: الكلام بيتكتب في الخانة المفتوحة. قول «فاصلة» أو «نقطة» أو «علامة استفهام» أو «سطر جديد» للترقيم">
        <Icon name="mic" size={15} /> {on ? 'إيقاف الإملاء' : 'إملاء صوتي'}
      </button>
      <button type="button" className="btn btn--outline btn--sm" onMouseDown={keep} onClick={switchLang} title="لغة الإملاء">{lang === 'ar-EG' ? 'عربي' : 'English'}</button>
      {on && <span className="vd-live" aria-live="polite">{live ? <bdi dir="auto">{live}</bdi> : 'بسمعك… اتكلم'}</span>}
      {help && <MicHelp onClose={() => setHelp(false)} onRetry={() => { setHelp(false); void start(); }} />}
    </span>
  );
}
