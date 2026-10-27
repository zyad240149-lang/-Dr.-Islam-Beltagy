// ملخص التقسيط لفاتورة واحدة: الإجمالي/المدفوع/المتبقي + كل دفعة بقيمتها وتاريخ استحقاقها وحالتها + حالة التقسيط نفسه.
// بيتعرض في: نافذة الفاتورة، مراجعة فاتورة الخطة، تفاصيل الخطة العلاجية، وتبويب الفواتير في ملف المريض.
import { db } from '../data/db';
import { empName, installmentRows, instStateOf, INST_ROW, INST_STATE, type InstallmentRequest } from '../data/installments';
import { StatusBadge } from './ui';
import { fmtDate, fmtDateTime, money } from '../utils/format';
import type { Invoice } from '../types';

export function InstallmentStateBadge({ invoice, req }: { invoice: Invoice; req?: InstallmentRequest }) {
  const s = instStateOf(invoice, req);
  if (s === 'none') return null;
  return <StatusBadge label={INST_STATE[s].label} tone={INST_STATE[s].tone} />;
}

export function InstallmentSummary({ invoice, req, compact }: { invoice: Invoice; req: InstallmentRequest; compact?: boolean }) {
  const rows = installmentRows(invoice, req);
  const current = rows.find((r) => r.state !== 'paid' && r.state !== 'cancelled');
  const plan = req.planId ? db.plan(req.planId) : undefined;
  return (
    <div className="item-card" style={{ marginBottom: 12 }}>
      <div className="row-between" style={{ marginBottom: 10, gap: 8, flexWrap: 'wrap' }}>
        <strong>التقسيط — {invoice.no}{plan ? ` · ${plan.diagnosis}` : ''}</strong>
        <InstallmentStateBadge invoice={invoice} req={req} />
      </div>
      <div className="kpi-mini" style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(120px, 1fr))', gap: 8, marginBottom: 10 }}>
        <div><div className="muted-sm">الإجمالي</div><strong className="num">{money(invoice.total)}</strong></div>
        <div><div className="muted-sm">المدفوع</div><strong className="num" style={{ color: 'var(--ok)' }}>{money(invoice.paid)}</strong></div>
        <div><div className="muted-sm">المتبقي</div><strong className="num" style={{ color: invoice.remaining > 0 ? 'var(--warn)' : undefined }}>{money(invoice.remaining)}</strong></div>
        <div><div className="muted-sm">عدد الدفعات</div><strong className="num">2</strong></div>
        <div><div className="muted-sm">الدفعة الحالية</div><strong>{current ? (current.no === 1 ? 'الأولى' : 'الثانية') : '—'}</strong></div>
      </div>
      <div className="table-wrap"><table className="table">
        <thead><tr><th>الدفعة</th><th>القيمة</th><th>تاريخ الاستحقاق</th><th>الحالة</th>{!compact && <th>تاريخ السداد</th>}</tr></thead>
        <tbody>{rows.map((r) => (
          <tr key={r.no}>
            <td>{r.no === 1 ? 'الدفعة الأولى' : 'الدفعة الثانية'}</td>
            <td className="num">{money(r.amount)}</td>
            <td className="num">{r.dueDate ? fmtDate(r.dueDate) : '—'}</td>
            <td><StatusBadge label={INST_ROW[r.state].label} tone={INST_ROW[r.state].tone} /></td>
            {!compact && <td>{r.paidAt ? fmtDateTime(r.paidAt) : '—'}</td>}
          </tr>
        ))}</tbody>
      </table></div>
      {!compact && (
        <div className="muted-sm" style={{ marginTop: 8, lineHeight: 1.9 }}>
          طلبه: {empName(req.requestedBy)} — {fmtDateTime(req.requestedAt)}{req.reason ? ` — السبب: ${req.reason}` : ''}
          {req.decidedAt && <><br />{req.status === 'approved' ? 'وافق' : 'رفض'}: {empName(req.decidedBy)} — {fmtDateTime(req.decidedAt)}{req.rejectReason ? ` — ${req.rejectReason}` : ''}</>}
          {invoice.issuedBy && <><br />أتمّ الفاتورة: {empName(invoice.issuedBy)}{invoice.issuedAt ? ` — ${fmtDateTime(invoice.issuedAt)}` : ''}</>}
        </div>
      )}
    </div>
  );
}
