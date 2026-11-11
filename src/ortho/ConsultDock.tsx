// ١١/١١: أكتر من كشف مفتوح في نفس الوقت — «فتح مريض تاني» بيركن الكشف الحالي تحت زي ما هو (مش بيتقفل ولا بيضيع اللي اتكتب)،
// وتفتح مريض تاني، وترجع لأي كشف من الشريط اللي تحت بضغطة. الكشوفات بتفضل مفتوحة حتى لو اتنقلت لصفحة تانية.
// نافذة الكشف نفسها بتتحمّل lazy عشان الملف ده في الـ Layout ومايتقّلش فتح البرنامج.
import { createContext, lazy, Suspense, useCallback, useContext, useEffect, useMemo, useRef, useState, type ComponentProps, type ReactNode } from 'react';
import { db } from '../data/db';
import { Icon } from '../utils/icons';
import type { ConsultModal as ConsultModalT } from './Consultations';

const ConsultModal = lazy(() => import('./Consultations').then((m) => ({ default: m.ConsultModal })));
type Spec = Omit<ComponentProps<typeof ConsultModalT>, 'minimized' | 'onMinimize'>;
type Entry = { key: string; spec: Spec };
type Ctx = { open: (key: string, spec: Spec) => void };
const DockCtx = createContext<Ctx | null>(null);

const MAX_OPEN = 6;
const labelOf = (s: Spec) => (s.patientId ? db.patient(s.patientId)?.fullName : s.initial?.patientId ? db.patient(s.initial.patientId)?.fullName : s.pending?.name) || 'كشف';

export function ConsultDockProvider({ children }: { children: ReactNode }) {
  const [list, setList] = useState<Entry[]>([]);
  const [active, setActive] = useState<string | null>(null);
  const open = useCallback((key: string, spec: Spec) => {
    setList((xs) => (xs.some((x) => x.key === key) ? xs : [...xs, { key, spec }].slice(-MAX_OPEN)));
    setActive(key);
  }, []);
  const close = (key: string) => {
    const e = list.find((x) => x.key === key);
    setList((xs) => xs.filter((x) => x.key !== key));
    setActive((a) => (a === key ? null : a));
    e?.spec.onClose();
  };
  // ركن الكشف: الصفحة اللي فتحته بترجع لحالتها (عشان تقدر تختار مريض تاني أو نفس المريض تاني) والكشف فاضل عايش في الشريط
  const park = (x: Entry) => { setActive(null); x.spec.onClose(); };
  const parked = list.filter((x) => x.key !== active);
  // الـ context لازم يفضل نفس الكائن — لو اتغيّر كل رندر، الصفحة اللي فتحت الكشف كانت بتفتحه تاني وترجّع التبديل (١٢/١١)
  const ctx = useMemo(() => ({ open }), [open]);
  // التبديل لكشف تاني: الكشف الحالي بيتركن والصفحة اللي فتحته بترجع لحالتها
  const switchTo = (from: Entry, key: string) => { from.spec.onClose(); setActive(key); };
  return (
    <DockCtx.Provider value={ctx}>
      {children}
      <Suspense fallback={null}>
        {list.map((x) => (
          <ConsultModal key={x.key} {...x.spec} minimized={x.key !== active} onMinimize={() => park(x)} onClose={() => close(x.key)}
            others={x.key === active ? list.filter((y) => y.key !== x.key).map((y) => ({ key: y.key, label: labelOf(y.spec), go: () => switchTo(x, y.key) })) : undefined} />
        ))}
      </Suspense>
      {parked.length > 0 && (
        <div className="cdock no-print" role="toolbar" aria-label="كشوفات مفتوحة">
          <span className="cdock__t"><Icon name="clipboard" size={15} /> كشوفات مفتوحة</span>
          {parked.map((x) => (
            <button key={x.key} type="button" className="cdock__b" onClick={() => setActive(x.key)} title="رجوع للكشف ده">
              <Icon name="user" size={14} />{labelOf(x.spec)}
            </button>
          ))}
        </div>
      )}
    </DockCtx.Provider>
  );
}

/** بديل `{cond && <ConsultModal …/>}`: لما when يبقى true الكشف بيتفتح في الشريط المشترك (وبيفضل عايش لو الصفحة اتقفلت) */
export function DockedConsult({ when, ...spec }: Spec & { when: boolean }) {
  const ctx = useContext(DockCtx);
  const key = `${spec.patientId || spec.initial?.patientId || spec.pending?.name || ''}|${spec.initial?.id ?? 'new'}`;
  const specRef = useRef(spec);
  specRef.current = spec;
  useEffect(() => { if (when && ctx) ctx.open(key, specRef.current); }, [when, key, ctx]);
  if (!ctx) return when ? <Suspense fallback={null}><ConsultModal {...spec} /></Suspense> : null;
  return null;
}
