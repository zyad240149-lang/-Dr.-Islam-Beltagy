// نوافذ التفاصيل المترابطة (الزيارة / الخطة العلاجية): الـ context والزرار هنا بس — النوافذ نفسها في DetailsModals.tsx
// وبتتحمّل أول ما نافذة تتفتح (مش مع أول فتحة للبرنامج). الـ Service Worker بيخزّن كل الملفات، فبتفتح عادي من غير إنترنت.
import { createContext, lazy, Suspense, useContext, useState, type ReactNode } from 'react';
import { Button } from './ui';

const PlanDetailsModal = lazy(() => import('./DetailsModals').then((m) => ({ default: m.PlanDetailsModal })));
const VisitDetailsModal = lazy(() => import('./DetailsModals').then((m) => ({ default: m.VisitDetailsModal })));

type Target = { kind: 'plan'; id: string } | { kind: 'visit'; id: string };
const Ctx = createContext<{ openPlan: (id: string) => void; openVisit: (id: string) => void }>({ openPlan: () => {}, openVisit: () => {} });
export const useDetails = () => useContext(Ctx);

export function DetailsProvider({ children }: { children: ReactNode }) {
  const [stack, setStack] = useState<Target[]>([]);
  const push = (t: Target) => setStack((s) => [...s, t]);
  const top = stack[stack.length - 1];
  const back = stack.length > 1 ? () => setStack((s) => s.slice(0, -1)) : undefined;
  const close = () => setStack([]);
  return (
    <Ctx.Provider value={{ openPlan: (id) => push({ kind: 'plan', id }), openVisit: (id) => push({ kind: 'visit', id }) }}>
      {children}
      <Suspense fallback={null}>
        {top?.kind === 'plan' && <PlanDetailsModal key={'p' + top.id} planId={top.id} onClose={close} onBack={back} />}
        {top?.kind === 'visit' && <VisitDetailsModal key={'v' + top.id} apptId={top.id} onClose={close} onBack={back} />}
      </Suspense>
    </Ctx.Provider>
  );
}

// زرار «عرض التفاصيل» صغير يستخدم في أي جدول
export function DetailsButton({ onClick }: { onClick: () => void }) {
  return <Button size="sm" variant="outline" icon="eye" onClick={(e) => { e.stopPropagation(); onClick(); }}>عرض التفاصيل</Button>;
}
