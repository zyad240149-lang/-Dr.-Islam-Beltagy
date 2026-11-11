// ٨/١١: «إضافة خدمة» على الموعد/المتابعة (جبس، أشعة، …) — كل خدمة سطر في نفس الفاتورة والسعر بيزيد. فاتورة واحدة للزيارة.
import { useEffect, useState } from 'react';
import { supabase } from '../lib/supabase';
import { db } from '../data/db';
import { useDbVersion } from '../hooks/useDb';
import { useToast } from '../hooks/useToast';
import { money, PAYMENT_METHOD_LABEL, PAYMENT_METHOD_OPTIONS } from '../utils/format';
import { patientOldDue, payOldestFirst, sumRemaining } from '../data/patientDue';
import type { PaymentMethod } from '../types';
import { Button } from './ui';
import { Icon } from '../utils/icons';
import { useCan } from './common';
import { InvoiceWhatsappButton, printInvoicePdf, saveInvoiceToDevice } from './InvoiceActions';

type Item = { id: string; description: string; amount: number; service_id: string | null };

export default function ExtraServices({ appointmentId }: { appointmentId: string }) {
  const v = useDbVersion();
  const toast = useToast();
  const inv = db.invoices().find((i) => i.appointmentId === appointmentId && i.status !== 'cancelled');
  const [items, setItems] = useState<Item[] | null>(null);
  const [pick, setPick] = useState('');
  const can = useCan();
  const [disc, setDisc] = useState('');
  const [busy, setBusy] = useState(false);
  const [fileBusy, setFileBusy] = useState<'' | 'print' | 'save'>('');
  const [payAmt, setPayAmt] = useState('');
  const [payMethod, setPayMethod] = useState<PaymentMethod>('cash');
  const file = async (kind: 'print' | 'save') => {
    if (!inv) return;
    setFileBusy(kind);
    try {
      if (kind === 'print') await printInvoicePdf(inv.id);
      else { const r = await saveInvoiceToDevice(inv.id); if (r === 'downloaded') toast.success('اتنزّلت الفاتورة على الجهاز.'); }
    } catch (e) { toast.error((e as Error).message || 'تعذّر إنشاء ملف PDF.'); }
    finally { setFileBusy(''); }
  };
  const load = async () => {
    if (!inv) return;
    const { data } = await supabase.from('invoice_items').select('id, description, amount, service_id').eq('invoice_id', inv.id).order('id');
    setItems((data ?? []).map((x: any) => ({ ...x, amount: Number(x.amount) })));
  };
  useEffect(() => { void load(); }, [inv?.id, inv?.price, v]);
  if (!inv || inv.packageId) return null;

  const services = db.services();
  const call = async (job: () => Promise<{ ok: boolean; error?: string }>, ok: string) => {
    setBusy(true);
    const r = await job();
    if (!r.ok) toast.error(r.error ?? 'حصل خطأ'); else { toast.success(ok); setPick(''); await load(); }
    setBusy(false);
  };
  const list = items && items.length ? items : [{ id: '', description: inv.serviceName || 'الخدمة', amount: inv.price, service_id: null }];
  // ١١/١١: المستحق القديم على المريض (زيارات قبل كده) + «دفع كام» ← الباقي. الدفعة بتسدّد القديم الأول وبعدين الزيارة دي
  const oldDue = patientOldDue(inv.patientId, inv.id);
  const oldSum = sumRemaining(oldDue);
  const curDue = inv.status === 'due' || inv.status === 'partial' ? inv.remaining : 0;
  const allDue = Math.round((oldSum + curDue) * 100) / 100;
  const entered = Number(payAmt);
  const validAmt = payAmt !== '' && Number.isFinite(entered) && entered > 0 && entered <= allDue;
  const canPay = can('payments', 'create') && allDue > 0;
  const pay = () => {
    if (!validAmt) { toast.error(`المبلغ لازم يكون بين 1 و ${money(allDue)}.`); return; }
    setBusy(true);
    void payOldestFirst(inv.patientId, inv, entered, payMethod).then((r) => {
      const txt = r.done.map((d) => `${d.no}: ${money(d.amount)}`).join(' · ');
      if (!r.ok) toast.error(`${txt ? `اتسجّل ${txt} — ` : ''}${r.error ?? ''}`);
      else { toast.success(`اتسجّل ${money(entered)} (${PAYMENT_METHOD_LABEL[payMethod]}) — ${txt}`); setPayAmt(''); }
      setBusy(false);
    });
  };

  return (
    <div className="xsvc">
      <div className="xsvc__head"><Icon name="receipt" size={17} /><strong>خدمات الزيارة</strong><span className="muted-sm">فاتورة {inv.no}</span></div>
      {/* ١٠/١١: «إضافة خدمة» فوق وظاهرة على طول (طلب الدكتور) */}
      {inv.status !== 'cancelled' && (
        <div className="xsvc__add xsvc__add--top">
          <select className="input" value={pick} onChange={(e) => setPick(e.target.value)} aria-label="اختار خدمة">
            <option value="">+ إضافة خدمة (جبس، أشعة، …)</option>
            {services.map((s) => <option key={s.id} value={s.id}>{s.name} — {money(s.price)}</option>)}
          </select>
          <Button icon="plus" disabled={!pick} loading={busy} onClick={() => void call(() => db.addInvoiceService(inv.id, pick), 'اتضافت الخدمة والفاتورة اتحدثت')}>إضافة</Button>
        </div>
      )}
      <ul className="xsvc__list">
        {list.map((it, i) => (
          <li key={it.id || i}>
            <span>{it.description}</span>
            <b className="num">{money(it.amount)}</b>
            {it.id && list.length > 1 && i > 0 && <button type="button" className="icon-btn" aria-label={`حذف ${it.description}`} disabled={busy}
              onClick={() => window.confirm(`حذف «${it.description}» من الفاتورة؟`) && void call(() => db.removeInvoiceItem(it.id), 'اتشالت الخدمة')}><Icon name="trash" size={16} /></button>}
          </li>
        ))}
      </ul>
      {/* ١٠/١١: مبلغ خصم على فاتورة الزيارة — صلاحية «الفواتير: تعديل السعر والخصم» وقبل أي دفع */}
      {inv.status !== 'cancelled' && can('invoices', 'edit') && can('inv_price', 'view') && inv.paid <= 0 && (
        <div className="xsvc__add">
          <input className="input num" type="number" min={0} max={inv.price} inputMode="decimal" aria-label="مبلغ الخصم"
            placeholder={inv.discount > 0 ? `الخصم الحالي ${money(inv.discount)}` : 'مبلغ الخصم (ج.م)'} value={disc} onChange={(e) => setDisc(e.target.value)} />
          <Button variant="outline" icon="check" disabled={disc === ''} loading={busy} onClick={() => {
            const d = Number(disc);
            if (!Number.isFinite(d) || d < 0 || d > inv.price) { toast.error('الخصم لازم يكون بين 0 وإجمالي الخدمات.'); return; }
            void call(() => db.updatePlanInvoice(inv.id, { price: inv.price, discount: d, note: inv.note ?? '' }, false), d > 0 ? `اتطبّق خصم ${money(d)}` : 'اتلغى الخصم').then(() => setDisc(''));
          }}>تطبيق الخصم</Button>
        </div>
      )}
      {inv.discount > 0 && <div className="xsvc__total"><span className="muted-sm">الخصم</span><b className="num">− {money(inv.discount)}</b></div>}
      <div className="xsvc__total"><span>الإجمالي</span><b className="num">{money(inv.total)}</b>{inv.total > 0 && <span className="muted-sm">مدفوع {money(inv.paid)} · باقي {money(inv.remaining)}</span>}</div>
      {oldDue.length > 0 && (
        <div className="xsvc__old" data-testid="xsvc-old-due">
          <div><Icon name="alert" size={16} /> <b>على المريض مستحق من زيارات قبل كده: <span className="num">{money(oldSum)}</span></b></div>
          <ul>{oldDue.map((o) => <li key={o.id}><span className="num">{o.no}</span> · {o.serviceName} · <span className="num">{o.date}</span> — باقي <b className="num">{money(o.remaining)}</b></li>)}</ul>
          <div className="muted-sm">المطلوب دلوقتي: <b className="num">{money(allDue)}</b> (القديم {money(oldSum)} + الزيارة دي {money(curDue)}) — أي دفعة بتسدّد القديم الأول.</div>
        </div>
      )}
      {canPay && inv.status !== 'cancelled' && (
        <div className="xsvc__pay">
          <div className="xsvc__add">
            <input className="input num" type="number" min={0} max={allDue} inputMode="decimal" aria-label="دفع كام" data-testid="xsvc-pay-amount"
              placeholder={`دفع كام؟ (المطلوب ${money(allDue)})`} value={payAmt} onChange={(e) => setPayAmt(e.target.value)} />
            <select className="input" style={{ maxWidth: 150 }} value={payMethod} onChange={(e) => setPayMethod(e.target.value as PaymentMethod)} aria-label="طريقة الدفع">
              {PAYMENT_METHOD_OPTIONS.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
            </select>
            <Button icon="check" disabled={!validAmt} loading={busy} onClick={pay}>تسجيل الدفع</Button>
          </div>
          <div className="muted-sm" style={{ marginTop: 4 }}>
            {payAmt === '' ? <>اكتب المبلغ اللي المريض دفعه، والنظام يحسب الباقي.{' '}<button type="button" className="link-btn" onClick={() => setPayAmt(String(allDue))}>دفع الكل ({money(allDue)})</button></>
              : validAmt ? <>الباقي بعد الدفع: <b className="num">{money(Math.round((allDue - entered) * 100) / 100)}</b></>
              : <span style={{ color: 'var(--danger)' }}>المبلغ لازم يكون بين 1 و {money(allDue)}</span>}
          </div>
        </div>
      )}
      {/* ٩/١١: نفس شكل «طباعة وإرسال» في التشخيص */}
      <div className="out-actions xsvc__out">
        <button type="button" className="out-act" disabled={!!fileBusy} onClick={() => void file('print')}>
          <Icon name="print" size={22} /><b>{fileBusy === 'print' ? 'بيتجهّز…' : 'طباعة'}</b><small>على الطابعة على طول</small>
        </button>
        <button type="button" className="out-act" disabled={!!fileBusy} onClick={() => void file('save')}>
          <Icon name="download" size={22} /><b>{fileBusy === 'save' ? 'بيتجهّز…' : 'تنزيل على الجهاز'}</b><small>أندرويد / آيفون / كمبيوتر</small>
        </button>
      </div>
      <div className="xsvc__files"><InvoiceWhatsappButton invoice={inv} /></div>
    </div>
  );
}
