// لوحة الدفع الخاصة بباقات 4/6 جلسات داخل نافذة الفاتورة — بتحل محل «تسجيل دفعة» العادي لهذه الفواتير بس.
// المبالغ هنا للعرض فقط: الخادم هو اللي بيفرض (دفع كامل / 50% بالظبط بعد الموافقة / المتبقي بالظبط).
import { useEffect, useState } from 'react';
import { db } from '../data/db';
import { installmentsApi, empName, payStateOf, requestFor, PACKAGE_KIND_LABEL, PAY_STATE, type InstallmentRequest } from '../data/installments';
import { Button, Input, Modal, Select, StatusBadge } from './ui';
import { InstallmentSummary } from './InstallmentSummary';
import { useCan } from './common';
import { Icon } from '../utils/icons';
import { useToast } from '../hooks/useToast';
import { PAYMENT_METHOD_LABEL, PAYMENT_METHOD_OPTIONS, fmtDateTime, money } from '../utils/format';
import type { Invoice, Package, PaymentMethod } from '../types';

export function useInstallmentRequests() {
  const [rows, setRows] = useState<InstallmentRequest[] | null>(null);
  const [error, setError] = useState('');
  const reload = async () => { const r = await installmentsApi.list(); if (r.ok) { setRows(r.rows); setError(''); } else { setError(r.error); setRows([]); } };
  useEffect(() => { reload(); return installmentsApi.subscribe(reload); }, []);
  return { rows, error, reload };
}

export function PackagePaymentPanel({ invoice, pkg }: { invoice: Invoice; pkg?: Package }) {
  const can = useCan();
  const toast = useToast();
  const { rows, reload } = useInstallmentRequests();
  const [method, setMethod] = useState<PaymentMethod>('cash');
  const [note, setNote] = useState('');
  const [busy, setBusy] = useState(false);
  const [asking, setAsking] = useState(false);
  const [reason, setReason] = useState('');
  const [voiding, setVoiding] = useState<string | null>(null);
  const [voidReason, setVoidReason] = useState('');

  const req = rows ? requestFor(rows, invoice.id) : undefined;
  const state = payStateOf(invoice, req);
  const payments = db.paymentsForInvoice(invoice.id);
  const live = payments.filter((p) => !p.voidedAt);
  const canPay = can('payments', 'create');
  const canRequest = can('installments', 'create');
  const canVoid = can('installments', 'edit');
  const approved = req?.status === 'approved';
  const nextAmount = approved ? (live.length === 0 ? req!.firstAmount : invoice.remaining) : invoice.remaining;
  const nextLabel = approved ? (live.length === 0 ? 'تسجيل الدفعة الأولى (50%)' : 'تسجيل الدفعة الثانية (المتبقي)') : 'تسجيل الدفع الكامل';

  const pay = async () => {
    setBusy(true);
    const r = await db.recordPayment(invoice.id, nextAmount, method, note);
    setBusy(false);
    if (!r.ok) { toast.error(r.error); return; }
    await db.refresh('packages');
    const inv = db.invoice(invoice.id);
    toast.success(inv && inv.remaining <= 0 ? (pkg ? `تم السداد بالكامل — تم تفعيل ${pkg.name} (${pkg.totalSessions} جلسات).` : 'تم السداد بالكامل.') : 'تم تسجيل الدفعة الأولى — الحالة: مدفوع جزئيًا.');
    setNote('');
  };
  const sendRequest = async () => {
    setBusy(true);
    const r = await installmentsApi.request(invoice.id, reason.trim());
    setBusy(false);
    if (!r.ok) { toast.error(r.error); return; }
    toast.success('تم إرسال طلب الدفع على دفعتين للمدير.');
    setAsking(false); setReason(''); reload();
  };
  const doVoid = async () => {
    if (!voiding) return;
    if (!voidReason.trim()) { toast.error('اكتب سبب إلغاء الدفعة.'); return; }
    setBusy(true);
    const r = await installmentsApi.voidPayment(voiding, voidReason.trim());
    setBusy(false);
    if (!r.ok) { toast.error(r.error); return; }
    toast.success('تم إلغاء الدفعة مع الاحتفاظ بسجلها.');
    setVoiding(null); setVoidReason('');
  };

  const half = Math.round((invoice.total / 2) * 100) / 100;

  return (
    <div className="form-section no-print">
      <div className="form-section-title" style={{ display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap' }}>
        <span>الدفع — {pkg?.kind ? PACKAGE_KIND_LABEL[pkg.kind] : pkg?.name ?? invoice.serviceName}</span>
        <StatusBadge label={PAY_STATE[state].label} tone={PAY_STATE[state].tone} />
      </div>

      <dl className="review-list" style={{ marginBottom: 14 }}>
        {pkg && <div><dt>عدد الجلسات</dt><dd className="num">{pkg.totalSessions}</dd></div>}
        <div><dt>{pkg ? 'إجمالي قيمة الباقة' : 'إجمالي الفاتورة'}</dt><dd className="num">{money(invoice.total)}</dd></div>
        <div><dt>المدفوع</dt><dd className="num">{money(invoice.paid)}</dd></div>
        <div><dt>المتبقي</dt><dd className="num"><strong>{money(invoice.remaining)}</strong></dd></div>
        {pkg && <div><dt>حالة الباقة</dt><dd>{pkg.status === 'pending_payment' ? 'غير مفعّلة — تتفعّل بعد السداد الكامل' : pkg.status === 'active' ? `مفعّلة — ${pkg.usedSessions}/${pkg.totalSessions} مستخدمة، ${pkg.totalSessions - pkg.usedSessions} متبقية` : pkg.status}</dd></div>}
      </dl>

      {req && (
        <div className={`alert ${req.status === 'approved' ? 'alert-ok' : req.status === 'rejected' ? 'alert-danger' : 'alert-warn'}`} style={{ marginBottom: 14 }}>
          <Icon name={req.status === 'rejected' ? 'alert' : 'shield'} size={17} />
          <div>
            {req.status === 'pending' && <>طلب الدفع على دفعتين <strong>بانتظار موافقة المدير</strong> — أُرسل بواسطة {empName(req.requestedBy)} في {fmtDateTime(req.requestedAt)}. ما يمكن تسجيل أي دفعة حتى يتم القرار.</>}
            {req.status === 'approved' && <>تمت الموافقة على الدفع على دفعتين بواسطة: <strong>{empName(req.decidedBy)}</strong> ({req.decidedAt ? fmtDateTime(req.decidedAt) : ''}) — الدفعة الأولى <strong className="num">{money(req.firstAmount)}</strong> والثانية <strong className="num">{money(req.secondAmount)}</strong>.</>}
            {req.status === 'rejected' && <>تم رفض التقسيط بواسطة {empName(req.decidedBy)}{req.rejectReason ? <> — السبب: «{req.rejectReason}»</> : ''}. الدفع الكامل فقط.</>}
          </div>
        </div>
      )}

      {req && req.status === 'approved' && <InstallmentSummary invoice={invoice} req={req} compact />}
      {live.length > 0 || payments.length > 0 ? (
        <div className="table-wrap" style={{ marginBottom: 14 }}><table className="table">
          <thead><tr><th>الدفعة</th><th>المبلغ</th><th>الطريقة</th><th>المحاسب</th><th>التاريخ والوقت</th><th>الحالة</th><th className="actions"></th></tr></thead>
          <tbody>{payments.slice().sort((a, b) => a.date - b.date).map((p) => (
            <tr key={p.id} style={p.voidedAt ? { opacity: 0.6 } : undefined}>
              <td>{p.installmentNo === 1 ? 'الدفعة الأولى' : p.installmentNo === 2 ? 'الدفعة الثانية' : 'دفع كامل'}</td>
              <td className="num">{money(p.amount)}</td>
              <td>{PAYMENT_METHOD_LABEL[p.method]}</td>
              <td>{empName(p.createdBy)}</td>
              <td>{fmtDateTime(p.date)}</td>
              <td>{p.voidedAt ? <><StatusBadge label="ملغاة" tone="danger" />{p.voidReason && <div className="muted-sm">{p.voidReason}</div>}</> : <StatusBadge label="مسجّلة" tone="ok" />}</td>
              <td className="actions">{!p.voidedAt && canVoid && (!pkg || pkg.usedSessions === 0) && <Button size="sm" variant="soft-danger" onClick={() => setVoiding(p.id)}>إلغاء الدفعة</Button>}</td>
            </tr>
          ))}</tbody>
        </table></div>
      ) : null}

      {invoice.status !== 'cancelled' && invoice.remaining > 0 && canPay && state !== 'awaiting_approval' && (
        <>
          <div className="grid-form grid-form--3" style={{ alignItems: 'end' }}>
            <Input id="pk-amount" label="المبلغ (يحدده النظام)" value={money(nextAmount)} disabled readOnly />
            <Select id="pk-method" label="طريقة الدفع" value={method} onChange={(e) => setMethod(e.target.value as PaymentMethod)} options={PAYMENT_METHOD_OPTIONS} />
            <Input id="pk-note" label="ملاحظة" value={note} onChange={(e) => setNote(e.target.value)} />
          </div>
          <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
            <Button icon="checkCircle" onClick={pay} loading={busy}>{nextLabel} — {money(nextAmount)}</Button>
            {!req && live.length === 0 && canRequest && <Button variant="outline" icon="shield" onClick={() => setAsking(true)} disabled={busy}>طلب الدفع على دفعتين</Button>}
          </div>
        </>
      )}
      {state === 'awaiting_payment' && !canRequest && canPay && <p className="muted" style={{ fontSize: 12.5, marginTop: 8 }}>الدفع على دفعتين يحتاج طلب من المحاسب وموافقة المدير.</p>}

      {asking && (
        <Modal title="طلب الدفع على دفعتين" onClose={() => setAsking(false)} footer={<><Button variant="outline" onClick={() => setAsking(false)} disabled={busy}>إلغاء</Button><Button icon="shield" onClick={sendRequest} loading={busy}>إرسال الطلب للمدير</Button></>}>
          <div className="alert alert-info"><Icon name="shield" size={17} /><div>سيُرسل الطلب للمدير للموافقة. ما يمكن تسجيل أي دفعة على هالفاتورة حتى يتم القرار.</div></div>
          <dl className="review-list" style={{ margin: '12px 0' }}>
            <div><dt>المريض</dt><dd>{db.patient(invoice.patientId)?.fullName} ({db.patient(invoice.patientId)?.fileNo})</dd></div>
            <div><dt>{pkg ? 'الباقة' : 'الخدمة'}</dt><dd>{pkg ? `${pkg.name} — ${pkg.totalSessions} جلسات` : invoice.serviceName}</dd></div>
            <div><dt>الإجمالي</dt><dd className="num">{money(invoice.total)}</dd></div>
            <div><dt>الدفعة الأولى (50%)</dt><dd className="num">{money(half)}</dd></div>
            <div><dt>الدفعة الثانية (50%)</dt><dd className="num">{money(Math.round((invoice.total - half) * 100) / 100)}</dd></div>
          </dl>
          <div className="field">
            <label htmlFor="pk-reason">سبب طلب التقسيط (اختياري)</label>
            <textarea id="pk-reason" className="input" rows={2} value={reason} onChange={(e) => setReason(e.target.value)} />
          </div>
        </Modal>
      )}
      {voiding && (
        <Modal title="إلغاء دفعة" onClose={() => setVoiding(null)} footer={<><Button variant="outline" onClick={() => setVoiding(null)} disabled={busy}>رجوع</Button><Button variant="danger" onClick={doVoid} loading={busy}>تأكيد الإلغاء</Button></>}>
          <div className="alert alert-warn"><Icon name="alert" size={17} /><div>الدفعة لن تُحذف — ستبقى في السجل بحالة «ملغاة» ولن تُحسب ضمن المدفوع. وإذا كانت الباقة مفعّلة فستعود إلى «بانتظار الدفع».</div></div>
          <Input id="pk-void" label="سبب الإلغاء *" value={voidReason} onChange={(e) => setVoidReason(e.target.value)} />
        </Modal>
      )}
    </div>
  );
}
