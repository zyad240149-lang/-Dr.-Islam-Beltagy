import { useEffect, useState, type ReactNode, type ButtonHTMLAttributes, type InputHTMLAttributes, type ChangeEvent } from 'react';
import { Icon } from '../utils/icons';
import { toLatinDigits } from '../utils/format';

/* ---------- Button ---------- */
type Variant = 'primary' | 'ghost' | 'outline' | 'danger' | 'soft-danger' | 'success';
interface BtnProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: Variant;
  size?: 'sm' | 'md' | 'lg';
  block?: boolean;
  icon?: string;
  loading?: boolean;
}
export function Button({ variant = 'primary', size = 'md', block, icon, loading, children, className = '', disabled, ...rest }: BtnProps) {
  const v = variant === 'primary' ? '' : `btn--${variant}`;
  const s = size === 'md' ? '' : `btn--${size}`;
  return (
    <button className={`btn ${v} ${s} ${block ? 'btn--block' : ''} ${className}`} disabled={disabled || loading} {...rest}>
      {loading ? <Icon name="refresh" size={18} className="spin" /> : icon ? <Icon name={icon} size={18} /> : null}
      {children}
    </button>
  );
}

/* ---------- StatusBadge ---------- */
export function StatusBadge({ label, tone }: { label: string; tone: string }) {
  return <span className={`badge badge--${tone}`}>{label}</span>;
}

/* ---------- Input ---------- */
interface FieldProps extends InputHTMLAttributes<HTMLInputElement> {
  label?: string;
  icon?: string;
  error?: string;
  hint?: string;
}
export function Input({ label, icon, error, hint, id, className = '', ...rest }: FieldProps) {
  const fid = id || rest.name;
  const isNumber = rest.type === 'number';
  const { onChange, type, ...inputRest } = rest;
  const handleChange = isNumber && onChange
    ? (e: ChangeEvent<HTMLInputElement>) => {
        const latin = toLatinDigits(e.target.value);
        if (latin !== e.target.value) e.target.value = latin;
        onChange(e);
      }
    : onChange;
  return (
    <div className={`field ${error ? 'field--invalid' : ''}`}>
      {label && <label htmlFor={fid}>{label}</label>}
      <div className={`control ${icon ? 'has-icon' : ''}`}>
        {icon && <Icon name={icon} size={18} />}
        <input id={fid} className={`input ${className}`} aria-invalid={!!error}
          {...inputRest} type={isNumber ? 'text' : type} inputMode={isNumber ? 'decimal' : undefined} onChange={handleChange} />
      </div>
      {error ? <div className="field__err">{error}</div> : hint ? <div className="field__hint">{hint}</div> : null}
    </div>
  );
}

/* خانة الجوال الموحدة موجودة في components/PhoneInput.tsx (مبنية على utils/phoneUtils.ts) */

export function PasswordInput({ label, icon = 'lock', error, id, ...rest }: FieldProps) {
  const [show, setShow] = useState(true);
  const fid = id || rest.name;
  return (
    <div className={`field ${error ? 'field--invalid' : ''}`}>
      {label && <label htmlFor={fid}>{label}</label>}
      <div className="control has-icon">
        <Icon name={icon} size={18} />
        <input id={fid} className="input" type={show ? 'text' : 'password'} dir="ltr" aria-invalid={!!error} {...rest} />
        <button type="button" className="toggle-pass" onClick={() => setShow((s) => !s)} aria-label={show ? 'إخفاء كلمة المرور' : 'إظهار كلمة المرور'}>
          <Icon name={show ? 'eyeOff' : 'eye'} size={18} />
        </button>
      </div>
      {error && <div className="field__err">{error}</div>}
    </div>
  );
}

interface SelectProps extends React.SelectHTMLAttributes<HTMLSelectElement> {
  label?: string;
  error?: string;
  options: { value: string; label: string }[];
}
export function Select({ label, error, options, id, ...rest }: SelectProps) {
  const fid = id || rest.name;
  return (
    <div className={`field ${error ? 'field--invalid' : ''}`}>
      {label && <label htmlFor={fid}>{label}</label>}
      <select id={fid} className="input" {...rest}>
        {options.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
      </select>
      {error && <div className="field__err">{error}</div>}
    </div>
  );
}

/* ---------- EmptyState ---------- */
export function EmptyState({ icon = 'inbox', title, text, action }: { icon?: string; title: string; text?: string; action?: ReactNode }) {
  return (
    <div className="empty">
      <div className="empty__ic"><Icon name={icon} size={30} /></div>
      <h3>{title}</h3>
      {text && <p>{text}</p>}
      {action}
    </div>
  );
}

/* ---------- ErrorState ---------- */
export function ErrorState({ onRetry }: { onRetry?: () => void }) {
  return (
    <div className="error-box">
      <div className="empty__ic"><Icon name="alert" size={30} /></div>
      <h3>حدث خطأ</h3>
      <p className="muted">تعذّر تحميل البيانات. حاول مرة ثانية.</p>
      {onRetry && <Button variant="outline" icon="refresh" onClick={onRetry}>إعادة المحاولة</Button>}
    </div>
  );
}

/* ---------- Skeleton ---------- */
export function Skeleton({ h = 16, w = '100%', r = 8, style }: { h?: number; w?: number | string; r?: number; style?: React.CSSProperties }) {
  return <div className="skel" style={{ height: h, width: w, borderRadius: r, ...style }} />;
}

/* ---------- Modal ---------- */
export function Modal({ title, onClose, children, footer, wide, xl }: { title: string; onClose: () => void; children: ReactNode; footer?: ReactNode; wide?: boolean; xl?: boolean }) {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose(); };
    document.addEventListener('keydown', onKey);
    document.body.style.overflow = 'hidden';
    // الموبايل: لما الكيبورد يفتح، الخانة اللي بتكتب فيها تفضل ظاهرة
    const onFocus = (e: FocusEvent) => { const t = e.target as HTMLElement; if (window.innerWidth <= 640 && t.matches?.('input, textarea, select')) setTimeout(() => t.scrollIntoView({ block: 'center', behavior: 'smooth' }), 250); };
    document.addEventListener('focusin', onFocus);
    return () => { document.removeEventListener('keydown', onKey); document.removeEventListener('focusin', onFocus); document.body.style.overflow = ''; };
  }, [onClose]);
  return (
    <div className="overlay" onMouseDown={(e) => { if (e.target === e.currentTarget) onClose(); }}>
      <div className={`modal ${wide ? 'modal--wide' : ''} ${xl ? 'modal--xl' : ''}`} role="dialog" aria-modal="true" aria-label={title}>
        <div className="modal__head">
          <h2>{title}</h2>
          <button className="icon-btn" onClick={onClose} aria-label="إغلاق"><Icon name="close" size={18} /></button>
        </div>
        <div className="modal__body">{children}</div>
        {footer && <div className="modal__foot">{footer}</div>}
      </div>
    </div>
  );
}
