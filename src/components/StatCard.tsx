import type { ReactNode } from 'react';
import { Icon } from '../utils/icons';

export function StatCard({ icon, tone, value, label, sub }: { icon: string; tone: string; value: string | number; label: string; sub?: ReactNode }) {
  return (
    <div className="card kpi">
      <div className="kpi__top"><span className={`kpi__ic kpi__ic--${tone}`}><Icon name={icon} size={19} /></span></div>
      <div><div className="kpi__value num">{value}</div><div className="kpi__label">{label}</div>{sub && <div className="kpi__sub">{sub}</div>}</div>
    </div>
  );
}
