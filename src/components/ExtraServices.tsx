// ٨/١١: «إضافة خدمة» على الموعد/المتابعة (جبس، أشعة، …) — كل خدمة سطر في نفس الفاتورة والسعر بيزيد. فاتورة واحدة للزيارة.
import { useEffect, useState } from 'react';
import { supabase } from '../lib/supabase';
import { db } from '../data/db';
import { useDbVersion } from '../hooks/useDb';
import { useToast } from '../hooks/useToast';
import { money } from '../utils/format';
import { Button } from './ui';
import { Icon } from '../utils/icons';
import { InvoiceFileButtons, InvoiceWhatsappButton } from './InvoiceActions';

type Item = { id: string; description: string; amount: number; service_id: string | null };

export default function ExtraServices({ appointmentId }: { appointmentId: string }) {
  const v = useDbVersion();
  const toast = useToast();
  const inv = db.invoices().find((i) => i.appointmentId === appointmentId && i.status !== 'cancelled');
  const [items, setItems] = useState<Item[] | null>(null);
  const [pick, setPick] = useState('');
  const [busy, setBusy] = useState(false);
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

  return (
    <div className="xsvc">
      <div className="xsvc__head"><Icon name="receipt" size={17} /><strong>خدمات الزيارة</strong><span className="muted-sm">فاتورة {inv.no}</span></div>
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
      <div className="xsvc__total"><span>الإجمالي</span><b className="num">{money(inv.total)}</b>{inv.paid > 0 && <span className="muted-sm">مدفوع {money(inv.paid)} · باقي {money(inv.remaining)}</span>}</div>
      <div className="xsvc__files"><InvoiceFileButtons invoice={inv} size="sm" /><InvoiceWhatsappButton invoice={inv} size="sm" variant="outline" /></div>
      {inv.status !== 'cancelled' && (
        <div className="xsvc__add">
          <select className="input" value={pick} onChange={(e) => setPick(e.target.value)} aria-label="اختار خدمة">
            <option value="">+ إضافة خدمة (جبس، أشعة، …)</option>
            {services.map((s) => <option key={s.id} value={s.id}>{s.name} — {money(s.price)}</option>)}
          </select>
          <Button icon="plus" disabled={!pick} loading={busy} onClick={() => void call(() => db.addInvoiceService(inv.id, pick), 'اتضافت الخدمة والفاتورة اتحدثت')}>إضافة</Button>
        </div>
      )}
    </div>
  );
}
