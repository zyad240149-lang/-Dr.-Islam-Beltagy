// PhoneInput — خانة الجوال الموحدة لكل النماذج (إضافة/تعديل مريض، الحجز السريع، الموظفين، المعالجين، الولاء…).
// كل منطق التحقق والتنسيق جاي من utils/phoneUtils.ts (libphonenumber-js) — الكومبوننت ده واجهة بس.
// القيمة اللي بتطلع للأب: E.164 لو الرقم صالح، أو '' لو فاضي/غير صالح + كود الخطأ عشان يمنع الحفظ.
import { useEffect, useMemo, useRef, useState, type ChangeEvent } from 'react';
import {
  DEFAULT_COUNTRY, analyzePhone, callingCode, countryOptions, examplePlaceholder, exceedsMaxLength, flagEmoji,
  formatAsYouType, parseStoredPhone, phoneErrorMessage, sanitizePhoneInput, searchCountries,
  type CountryCode, type PhoneErrorCode,
} from '../utils/phoneUtils';

export interface PhoneInputProps {
  id: string;
  label?: string;
  value: string;                                           // E.164 (أو رقم قديم محفوظ بأي صيغة — بيتقرا ويتعرض صح)
  onChange: (e164: string, error: PhoneErrorCode | null) => void;
  required?: boolean;                                      // الافتراضي: مطلوب
  showError?: boolean;                                     // بعد محاولة الحفظ: اعرض الخطأ حتى لو المستخدم ما لمسش الخانة
  error?: string;                                          // خطأ من برّه (مثلاً: الرقم مسجّل قبل كده)
  disabled?: boolean;
  defaultCountry?: CountryCode;
  hint?: string;
}

export function PhoneInput({ id, label, value, onChange, required = true, showError, error, disabled, defaultCountry = DEFAULT_COUNTRY, hint }: PhoneInputProps) {
  const initial = useMemo(() => parseStoredPhone(value, defaultCountry), []); // eslint-disable-line react-hooks/exhaustive-deps
  const [country, setCountry] = useState<CountryCode>(initial.country);
  const [text, setText] = useState<string>(initial.e164 ? sanitizePhoneInput(initial.national) : sanitizePhoneInput(value ?? ''));
  const [touched, setTouched] = useState(false);
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState('');
  const lastEmitted = useRef<string | null>(null);
  const boxRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const searchRef = useRef<HTMLInputElement>(null);

  const analysis = analyzePhone(text, country, { required });

  // إبلاغ الأب بالقيمة والخطأ كل ما يتغيروا (وأول مرة عشان يعرف لو الخانة المطلوبة فاضية)
  useEffect(() => {
    const out = analysis.e164 ?? '';
    lastEmitted.current = out;
    onChange(out, analysis.error);
  }, [analysis.e164, analysis.error]); // eslint-disable-line react-hooks/exhaustive-deps

  // لو الأب غيّر القيمة من برّه (مثلاً فتح نموذج لمريض تاني أو تفريغ النموذج) نعيد القراءة
  useEffect(() => {
    if (lastEmitted.current === null || value === lastEmitted.current) return;
    const p = parseStoredPhone(value, defaultCountry);
    setCountry(p.country);
    setText(p.e164 ? sanitizePhoneInput(p.national) : sanitizePhoneInput(value ?? ''));
    setTouched(false);
  }, [value]); // eslint-disable-line react-hooks/exhaustive-deps

  // لو الرقم مكتوب دولي (+كود) والكود لدولة تانية → نغيّر الدولة المختارة تلقائيًا
  useEffect(() => {
    if (analysis.detectedCountry && analysis.detectedCountry !== country) setCountry(analysis.detectedCountry);
  }, [analysis.detectedCountry]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    if (!open) return;
    setQuery('');
    setTimeout(() => searchRef.current?.focus(), 0);
    const close = (e: MouseEvent) => { if (!boxRef.current?.contains(e.target as Node)) setOpen(false); };
    document.addEventListener('mousedown', close);
    return () => document.removeEventListener('mousedown', close);
  }, [open]);

  function handleInput(e: ChangeEvent<HTMLInputElement>) {
    const raw = e.target.value;
    let next = sanitizePhoneInput(raw);
    const prevDisplay = formatAsYouType(text, country);
    // المستخدم مسح مسافة/قوس من التنسيق بس → نمسح الرقم اللي قبلها بدل ما يفضل "عالق"
    if (next === text && raw.length < prevDisplay.length) {
      const caret = e.target.selectionStart ?? raw.length;
      const digitsBefore = sanitizePhoneInput(raw.slice(0, caret)).replace(/\D/g, '').length;
      const plus = next.startsWith('+') ? '+' : '';
      const d = next.replace(/\D/g, '');
      next = plus + d.slice(0, Math.max(0, digitsBefore - 1)) + d.slice(digitsBefore);
    }
    // منع كتابة أرقام أكتر من الحد المسموح للدولة (حسب metadata)
    if (next.length > text.length && exceedsMaxLength(next, country)) return;
    setText(next);
  }

  function pickCountry(c: CountryCode) {
    setOpen(false);
    // لو الرقم كان مكتوب دولي، نحوله لرقم محلي عشان يتقاس على الدولة الجديدة (من غير تكرار الكود)
    if (text.startsWith('+')) {
      const p = parseStoredPhone(text, c);
      setText(p.e164 ? sanitizePhoneInput(p.national) : text.replace(/^\+\d{0,3}/, ''));
    }
    setCountry(c);
    setTouched(true);
    setTimeout(() => inputRef.current?.focus(), 0);
  }

  const list = open ? searchCountries(query) : [];
  const shownErr = error || (showError ? phoneErrorMessage(analysis.error) : null);
  const current = countryOptions().find((o) => o.code === country);

  return (
    <div className={`field ${shownErr ? 'field--invalid' : ''}`}>
      {label && <label htmlFor={id}>{label}</label>}
      <div className="control phone-control" ref={boxRef}>
        <button type="button" className="country-code" dir="ltr" disabled={disabled} aria-haspopup="listbox" aria-expanded={open}
          aria-label={`الدولة: ${current?.name ?? country} +${callingCode(country)}`} onClick={() => setOpen((o) => !o)}>
          <span className="country-code__flag">{flagEmoji(country)}</span> +{callingCode(country)}
        </button>
        <input ref={inputRef} id={id} className="input" dir="ltr" type="tel" inputMode="tel" autoComplete="tel"
          value={formatAsYouType(text, country)} placeholder={examplePlaceholder(country)} disabled={disabled}
          onChange={handleInput} aria-invalid={!!shownErr} />
        {open && (
          <div className="country-menu" role="listbox">
            <input ref={searchRef} className="input country-menu__search" placeholder="ابحث باسم الدولة أو الكود…" value={query}
              onChange={(e) => setQuery(e.target.value)} onKeyDown={(e) => {
                if (e.key === 'Escape') setOpen(false);
                if (e.key === 'Enter') { e.preventDefault(); if (list[0]) pickCountry(list[0].code); }
              }} />
            <div className="country-menu__list">
              {list.length === 0 && <div className="country-menu__empty">ما فيه نتائج</div>}
              {list.map((o) => (
                <button type="button" key={o.code} role="option" aria-selected={o.code === country}
                  className={`country-menu__item ${o.code === country ? 'is-active' : ''}`} onClick={() => pickCountry(o.code)}>
                  <span className="country-code__flag">{o.flag}</span>
                  <span className="country-menu__name">{o.name}</span>
                  <span className="country-menu__cc" dir="ltr">+{o.callingCode}</span>
                </button>
              ))}
            </div>
          </div>
        )}
      </div>
      {shownErr ? <div className="field__err">{shownErr}</div> : hint ? <div className="field__hint">{hint}</div> : null}
    </div>
  );
}
