// ١١/١١: زرار «رجوع» ظاهر في أعلى كل صفحة — بيرجع للصفحة اللي قبلها في البرنامج.
// لو دي أول صفحة اتفتحت (مفيش قبلها) ← الرئيسية. ومش بيظهر في الرئيسية نفسها لو مفيش حاجة قبلها.
// (جوّه النوافذ: زرار «رجوع» في راس النافذة نفسها — ui.tsx Modal — بيرجع خطوة جوّاها الأول)
import { useLocation, useNavigate } from 'react-router-dom';
import { Icon } from '../utils/icons';

export function BackButton({ home = '/', compact }: { home?: string; compact?: boolean }) {
  const { pathname } = useLocation();
  const navigate = useNavigate();
  const idx = (window.history.state as { idx?: number } | null)?.idx ?? 0;
  if (idx === 0 && pathname === home) return null;
  const back = () => { if (idx > 0) navigate(-1); else navigate(home, { replace: true }); };
  return (
    <button type="button" className={compact ? 'icon-btn back-btn' : 'btn btn--outline btn--sm back-btn'} onClick={back} aria-label="رجوع" title="رجوع للي قبلها">
      <Icon name="chevron" size={18} />{!compact && <span>رجوع</span>}
    </button>
  );
}
