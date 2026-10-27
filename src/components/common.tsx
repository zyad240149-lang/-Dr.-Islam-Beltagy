import { useState, type ReactNode } from 'react';
import { Modal, Button } from './ui';
import { Icon } from '../utils/icons';
import { useAuth } from '../services/auth';
import { can, type Area, type Op } from '../services/permissions';

export function useCan() {
  const { user } = useAuth();
  return (area: Area, op: Op = 'view') => can(user?.role, area, op);
}

// نافذة تأكيد موحدة لكل عمليات الحذف والإجراءات غير القابلة للتراجع
export function ConfirmDialog({ title, message, confirmLabel = 'تأكيد الحذف', danger = true, onConfirm, onClose }: {
  title: string; message: ReactNode; confirmLabel?: string; danger?: boolean; onConfirm: () => Promise<void> | void; onClose: () => void;
}) {
  const [busy, setBusy] = useState(false);
  return (
    <Modal title={title} onClose={onClose} footer={
      <>
        <Button variant="outline" onClick={onClose} disabled={busy}>رجوع</Button>
        <Button variant={danger ? 'danger' : 'primary'} loading={busy} onClick={async () => { setBusy(true); await onConfirm(); setBusy(false); onClose(); }}>{confirmLabel}</Button>
      </>
    }>
      <div className={`alert ${danger ? 'alert-danger' : 'alert-info'}`}><Icon name="alert" size={17} /><div>{message}</div></div>
    </Modal>
  );
}

export function FilterBar({ children }: { children: ReactNode }) {
  return <div className="filter-bar">{children}</div>;
}

// رسم أعمدة بسيط بدون مكتبات
export function BarChart({ data, format = (n) => String(n), height = 160 }: { data: { label: string; value: number }[]; format?: (n: number) => string; height?: number }) {
  const max = Math.max(1, ...data.map((d) => d.value));
  return (
    <div className="bars" style={{ height: height + 44 }} role="img" aria-label={data.map((d) => `${d.label}: ${format(d.value)}`).join('، ')}>
      {data.map((d, i) => (
        <div className="bars__col" key={i}>
          <span className="bars__val num">{d.value ? format(d.value) : ''}</span>
          <div className="bars__track" style={{ height }}><i style={{ height: `${(d.value / max) * 100}%` }} /></div>
          <span className="bars__label">{d.label}</span>
        </div>
      ))}
    </div>
  );
}

export function RowActions({ children }: { children: ReactNode }) {
  return <div className="row-actions" onClick={(e) => e.stopPropagation()}>{children}</div>;
}

export function IconAction({ icon, label, onClick, danger }: { icon: string; label: string; onClick: () => void; danger?: boolean }) {
  return (
    <button type="button" className={`icon-btn icon-btn--sm ${danger ? 'icon-btn--danger' : ''}`} onClick={onClick} aria-label={label} title={label}>
      <Icon name={icon} size={16} />
    </button>
  );
}
