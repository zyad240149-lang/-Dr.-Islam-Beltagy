// عناصر مشتركة لأقسام العظام — مبنية على مكوّنات النظام نفسها
import { useState, type ReactNode } from 'react';
import { ErrorState, Skeleton } from '../components/ui';
import { useCan } from '../components/common';
import { useToast } from '../hooks/useToast';
import { ortho, useOrthoVersion } from './data';
import { Icon } from '../utils/icons';
import { db } from '../data/db';
import { useDbVersion } from '../hooks/useDb';
import { fileNoText } from '../utils/phoneUtils';

export function PageHead({ title, sub, children }: { title: string; sub?: string; children?: ReactNode }) {
  return (
    <div className="page-head">
      <div><h1>{title}</h1>{sub && <p>{sub}</p>}</div>
      {children && <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap' }}>{children}</div>}
    </div>
  );
}

export function Field({ label, children, className = '' }: { label: string; children: ReactNode; className?: string }) {
  return <div className={`field ${className}`}><label>{label}</label>{children}</div>;
}

// اختيار مريض بالبحث: الاسم أو رقم الملف أو الموبايل بأي صيغة أو الرقم القومي (نفس patientMatches المستخدمة في باقي السيستم)
export function PatientSelect({ value, onChange }: { value: string; onChange: (id: string) => void }) {
  useDbVersion();
  const [q, setQ] = useState('');
  const [open, setOpen] = useState(false);
  const picked = value ? db.patient(value) : undefined;
  const results = open ? db.searchPatients(q).slice(0, 8) : [];
  return (
    <div className="pt-search">
      <div className="control has-icon">
        <Icon name="search" size={18} />
        <input className="input" placeholder="ابحث بالاسم أو رقم الملف أو الموبايل…" aria-label="بحث عن مريض"
          value={open ? q : picked ? `${picked.fullName} — ملف ${fileNoText(picked.fileNo)}` : q}
          onFocus={() => { setOpen(true); setQ(''); }} onBlur={() => setTimeout(() => setOpen(false), 150)}
          onChange={(e) => { setQ(e.target.value); setOpen(true); }}
          onKeyDown={(e) => { if (e.key === 'Enter' && results[0]) { e.preventDefault(); onChange(results[0].id); setOpen(false); (e.target as HTMLInputElement).blur(); } }} />
      </div>
      {open && (
        <div className="card pt-search__menu">
          {results.length ? results.map((p) => (
            <button key={p.id} type="button" className="gsearch__hit" onMouseDown={(e) => e.preventDefault()} onClick={() => { onChange(p.id); setOpen(false); }}>
              <Icon name="user" size={16} />
              <span className="gsearch__txt"><strong>{p.fullName}</strong><small className="num">ملف {fileNoText(p.fileNo)} · {p.phone}</small></span>
            </button>
          )) : <div className="gsearch__empty">لا يوجد مريض مطابق</div>}
        </div>
      )}
    </div>
  );
}

export function Tone({ s }: { s: { label: string; tone: string } }) {
  return <span className={`badge badge--${s.tone}`}>{s.label}</span>;
}

export function IconBtn({ icon, label, danger, onClick }: { icon: string; label: string; danger?: boolean; onClick: () => void }) {
  return <button type="button" className={`icon-btn icon-btn--sm ${danger ? 'icon-btn--danger' : ''}`} title={label} aria-label={label} onClick={onClick}><Icon name={icon} size={16} /></button>;
}

export function SearchBox({ value, onChange, placeholder }: { value: string; onChange: (v: string) => void; placeholder: string }) {
  return (
    <div className="control has-icon">
      <Icon name="search" size={18} />
      <input className="input" value={value} placeholder={placeholder} onChange={(e) => onChange(e.target.value)} />
    </div>
  );
}

export function PillTabs<T extends string>({ value, onChange, tabs }: { value: T; onChange: (v: T) => void; tabs: { id: T; label: string; n: number }[] }) {
  return (
    <div className="ortho-pills">
      {tabs.map((t) => <button key={t.id} className={`ortho-pill ${value === t.id ? 'active' : ''}`} onClick={() => onChange(t.id)}>{t.label} <span className="num">{t.n}</span></button>)}
    </div>
  );
}

export const confirmDelete = (what: string) => window.confirm(`هل تريد حذف ${what}؟`);
export const patientName = (id: string) => db.patient(id)?.fullName ?? '—';
export const patientFile = (id: string) => fileNoText(db.patient(id)?.fileNo);

/** تنفيذ عملية على الخادم: زر مشغول أثناء التنفيذ، ورسالة نجاح بعد الرد بس، ورسالة الخطأ الحقيقية لو فشلت */
export function useRun() {
  const toast = useToast();
  const [busy, setBusy] = useState(false);
  const run = async (fn: () => Promise<unknown>, ok?: string, after?: () => void) => {
    if (busy) return;
    setBusy(true);
    try { await fn(); if (ok) toast.success(ok); after?.(); }
    catch (e) { toast.error((e as Error).message || 'تعذّر تنفيذ العملية.'); }
    finally { setBusy(false); }
  };
  return { run, busy };
}

/** حالة التحميل/الخطأ لقائمة من قوائم العظام */
export function LoadState({ kind, children }: { kind: 'consultations' | 'imaging' | 'surgeries' | 'fractures'; children: ReactNode }) {
  useOrthoVersion();
  const err = ortho.error(kind);
  if (err) return <ErrorState onRetry={() => void ortho.reload(kind)} />;
  if (ortho.isLoading(kind)) return <div className="card" style={{ padding: 22 }}><Skeleton h={18} /><div style={{ height: 10 }} /><Skeleton h={18} w="70%" /></div>;
  return <>{children}</>;
}

/** الكتابة السريرية: صلاحية الجلسات (نفس سياسة RLS على الخادم) */
export function useClinicalCan() {
  const can = useCan();
  return { add: can('sessions', 'create'), edit: can('sessions', 'edit'), del: can('sessions', 'delete') };
}
