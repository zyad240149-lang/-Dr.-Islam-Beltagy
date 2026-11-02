// الإملاء الصوتي: الكلام بيتحوّل لكتابة في الخانة اللي مفتوحة (آخر خانة نصية اتضغط عليها جوّه النافذة).
// بيشتغل بتعرّف الكلام في المتصفح (Chrome / Edge) وبيحتاج إنترنت وإذن الميكروفون. مفيش حاجة بتتحفظ أو بتتبعت — النص بيتكتب في الخانة بس.
import { useEffect, useRef, useState } from 'react';
import { Icon } from '../utils/icons';
import { useToast } from '../hooks/useToast';

type Rec = { lang: string; continuous: boolean; interimResults: boolean; start: () => void; stop: () => void; onresult: ((e: any) => void) | null; onend: (() => void) | null; onerror: ((e: any) => void) | null }; // eslint-disable-line @typescript-eslint/no-explicit-any
const SR = (): (new () => Rec) | null => { const w = window as unknown as { SpeechRecognition?: new () => Rec; webkitSpeechRecognition?: new () => Rec }; return w.SpeechRecognition ?? w.webkitSpeechRecognition ?? null; };
const TEXT_TYPES = new Set(['', 'text', 'search', 'tel', 'number']);
const isField = (t: EventTarget | null): t is HTMLInputElement | HTMLTextAreaElement =>
  t instanceof HTMLTextAreaElement || (t instanceof HTMLInputElement && TEXT_TYPES.has(t.type) && !t.readOnly && !t.disabled);

function append(el: HTMLInputElement | HTMLTextAreaElement, text: string) {
  const proto = el instanceof HTMLTextAreaElement ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype;
  const set = Object.getOwnPropertyDescriptor(proto, 'value')?.set;
  if (!set) return;
  const cur = el.value;
  set.call(el, cur + (cur && !/\s$/.test(cur) ? ' ' : '') + text.trim());
  el.dispatchEvent(new Event('input', { bubbles: true })); // React بيلقط التغيير من الحدث ده
}

export function VoiceDictation() {
  const toast = useToast();
  const [on, setOn] = useState(false);
  const [lang, setLang] = useState<'ar-EG' | 'en-US'>('ar-EG');
  const field = useRef<HTMLInputElement | HTMLTextAreaElement | null>(null);
  const rec = useRef<Rec | null>(null);
  const active = useRef(false);
  const timer = useRef<number | undefined>(undefined);
  const startedAt = useRef(0);
  const quick = useRef(0); // كام مرة المتصفح قفل بسرعة ورا بعض (غالبًا مشكلة ميكروفون/لغة) — بنوقف بدل ما نلف في حلقة

  useEffect(() => {
    const onFocus = (e: FocusEvent) => { if (isField(e.target) && e.target.closest('.modal')) field.current = e.target; };
    document.addEventListener('focusin', onFocus);
    return () => { document.removeEventListener('focusin', onFocus); active.current = false; window.clearTimeout(timer.current); rec.current?.stop(); };
  }, []);

  function stop() { active.current = false; window.clearTimeout(timer.current); setOn(false); try { rec.current?.stop(); } catch { /* مقفول بالفعل */ } }
  function start(l = lang) {
    const Ctor = SR();
    if (!Ctor) { toast.error('المتصفح ده مش بيدعم الإملاء الصوتي — استخدم Chrome أو Edge.'); return; }
    if (!field.current || !document.contains(field.current)) { toast.info('اضغط على الخانة اللي عاوز تكتب فيها الأول، وبعدين شغّل الميكروفون.'); return; }
    const r = new Ctor();
    r.lang = l; r.continuous = true; r.interimResults = false; // من غير نتايج مؤقتة: أخف على الشاشة
    r.onresult = (e) => {
      let fin = '';
      for (let i = e.resultIndex; i < e.results.length; i++) if (e.results[i].isFinal) fin += e.results[i][0].transcript as string;
      if (fin && field.current && document.contains(field.current)) append(field.current, fin);
    };
    r.onerror = (e) => {
      if (e.error === 'not-allowed' || e.error === 'service-not-allowed') { toast.error('اسمح للمتصفح باستخدام الميكروفون.'); stop(); }
      else if (e.error === 'network') { toast.error('الإملاء الصوتي محتاج اتصال بالإنترنت.'); stop(); }
      else if (e.error === 'audio-capture') { toast.error('مفيش ميكروفون شغال على الجهاز ده.'); stop(); }
      else if (e.error === 'language-not-supported') { toast.error('اللغة دي مش مدعومة في المتصفح ده — جرّب English.'); stop(); }
    };
    r.onend = () => {
      if (!active.current) { setOn(false); return; }
      // المتصفح بيقفل بعد فترة صمت — بنكمّل بعد لحظة، ولو قفل بسرعة 3 مرات ورا بعض بنوقف
      quick.current = Date.now() - startedAt.current < 1500 ? quick.current + 1 : 0;
      if (quick.current >= 3) { toast.error('الإملاء الصوتي وقف — اتأكد من الميكروفون وجرّب تاني.'); stop(); return; }
      timer.current = window.setTimeout(() => { if (!active.current) return; try { startedAt.current = Date.now(); r.start(); } catch { stop(); } }, 400);
    };
    rec.current?.stop();
    rec.current = r; active.current = true; quick.current = 0; startedAt.current = Date.now();
    try { r.start(); setOn(true); } catch { stop(); }
  }
  const switchLang = () => { const l = lang === 'ar-EG' ? 'en-US' : 'ar-EG'; setLang(l); if (on) { stop(); setTimeout(() => start(l), 250); } };
  // الضغط على الأزرار ما يسحبش التركيز من الخانة المفتوحة
  const keep = (e: React.MouseEvent) => e.preventDefault();

  return (
    <span className="vd">
      <button type="button" className={`btn btn--sm ${on ? 'vd-on' : 'btn--outline'}`} onMouseDown={keep} onClick={() => (on ? stop() : start())} aria-pressed={on} title="إملاء صوتي: الكلام بيتكتب في الخانة المفتوحة">
        <Icon name="mic" size={15} /> {on ? 'إيقاف الإملاء' : 'إملاء صوتي'}
      </button>
      <button type="button" className="btn btn--outline btn--sm" onMouseDown={keep} onClick={switchLang} title="لغة الإملاء">{lang === 'ar-EG' ? 'عربي' : 'English'}</button>
      {on && <span className="vd-live" aria-live="polite">بسمعك… اتكلم</span>}
    </span>
  );
}
