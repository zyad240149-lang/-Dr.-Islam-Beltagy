// ٨/١١: «إضافة خدمة» على الموعد/المتابعة (جبس، أشعة، …) — كل خدمة سطر في نفس الفاتورة والسعر بيزيد. فاتورة واحدة للزيارة.
import { useEffect, useState } from 'react';
import { supabase } from '../lib/supabase';
import { db } from '../data/db';
import { useDbVersion } from '../hooks/useDb';
import { useToast } from '../hooks/useToast';
import { money } from '../utils/format';
import { Button } from './ui';
import { Icon } from '../utils/icons';
import { InvoiceWhatsappButton, printInvoicePdf, saveInvoiceToDevice } from './InvoiceActions';

type Item = { id: string; description: string; amount: number; service_id: string | null };

export default function ExtraServices({ appointmentId }: { appointmentId: string }) {
  const v = useDbVersion();
  const toast = useToast();
  const inv = db.invoices().find((i) => i.appointmentId === appointmentId && i.status !== 'cancelled');
  const [items, setItems] = useState<Item[] | null>(null);
  const [pick, setPick] = useState('');
  const [busy, setBusy] = useState(false);
  const [fileBusy, setFileBusy] = useState<'' | 'print' | 'save'>('');
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
