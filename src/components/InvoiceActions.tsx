// أزرار الفاتورة المشتركة (عرض / تحميل PDF / إرسال الفاتورة عبر WhatsApp) — نفس المكوّنات في صفحة المواعيد والفواتير والمدفوعات.
import { useRef, useState } from 'react';
import type { Invoice } from '../types';
import { db } from '../data/db';
import { Button, Modal } from './ui';
import { useCan } from './common';
import { useToast } from '../hooks/useToast';
import { prepareInvoiceFile, shareInvoiceFile, openChatWithFile, resolveWhatsappPhone, canShareFiles, WA_MSG, type Prepared, type ShareOutcome } from '../data/whatsappInvoice';
import { isMobile } from '../pwa/pwa';
import { PhoneInput } from './PhoneInput';
import { Icon } from '../utils/icons';

const waIcon = (
  <svg width="16" height="16" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true"><path d="M20.5 3.5A11.9 11.9 0 0 0 12 0C5.4 0 .1 5.3.1 11.9c0 2.1.6 4.2 1.6 6L0 24l6.3-1.6a11.9 11.9 0 0 0 5.7 1.5c6.6 0 11.9-5.3 11.9-11.9 0-3.2-1.2-6.2-3.4-8.5zM12 21.8c-1.8 0-3.6-.5-5.1-1.4l-.4-.2-3.7 1 1-3.6-.2-.4a9.9 9.9 0 0 1-1.5-5.3C2.1 6.4 6.6 2 12 2c2.6 0 5.1 1 7 2.9a9.8 9.8 0 0 1 2.9 7c0 5.4-4.5 9.9-9.9 9.9zm5.4-7.4c-.3-.1-1.8-.9-2-1-.3-.1-.5-.1-.7.1l-1 1.2c-.2.2-.4.2-.6.1-1.8-.9-2.9-1.6-4-3.6-.3-.5.3-.5.9-1.6.1-.2 0-.4 0-.5l-.9-2.2c-.2-.6-.5-.5-.7-.5h-.6c-.2 0-.5.1-.8.4-.3.3-1 1-1 2.5s1.1 2.9 1.2 3.1c.1.2 2.1 3.2 5.1 4.5 1.9.8 2.6.9 3.6.7.6-.1 1.8-.7 2-1.4.3-.7.3-1.3.2-1.4-.1-.1-.3-.2-.6-.3z" /></svg>
);

export const viewInvoicePdf = async (invoiceId: string) => {
  const { buildInvoicePdf } = await import('../pages/Invoices');
  const url = URL.createObjectURL(await buildInvoicePdf(invoiceId));
  window.open(url, '_blank', 'noopener');
  setTimeout(() => URL.revokeObjectURL(url), 60_000);
};
// طباعة نفس ملف الفاتورة PDF: iframe مخفي بيطبع الملف نفسه (مش صفحة النظام)
export const printInvoicePdf = async (invoiceId: string) => {
  const { buildInvoicePdf } = await import('../pages/Invoices');
  const url = URL.createObjectURL(await buildInvoicePdf(invoiceId));
  const f = document.createElement('iframe');
  f.style.cssText = 'position:fixed;right:0;bottom:0;width:0;height:0;border:0';
  f.src = url;
  f.onload = () => { try { f.contentWindow?.focus(); f.contentWindow?.print(); } catch { window.open(url, '_blank', 'noopener'); } setTimeout(() => { f.remove(); URL.revokeObjectURL(url); }, 60_000); };
  document.body.appendChild(f);
};
export const downloadPdf = async (invoiceId: string) => { const { downloadInvoicePdf } = await import('../pages/Invoices'); await downloadInvoicePdf(invoiceId); };

// إدخال رقم WhatsApp لمرة واحدة (مريض من غير رقم/رقم غير صالح) — مابيتحفظش في Contacts، والحفظ في ملف المريض اختياري وبصلاحياته
function PhoneEntryModal({ reason, onClose, onContinue, canSave }: { reason: 'missing' | 'invalid'; onClose: () => void; onContinue: (e164: string, saveToFile: boolean) => void; canSave: boolean }) {
  const [phone, setPhone] = useState('');
  const [save, setSave] = useState(false);
  const [showErr, setShowErr] = useState(false);
  return (
    <Modal title="إدخال رقم WhatsApp" onClose={onClose} footer={
      <><Button variant="outline" onClick={onClose}>إلغاء</Button><Button onClick={() => { if (!phone) { setShowErr(true); return; } onContinue(phone, save); }}>متابعة</Button></>
    }>
      <div className="alert alert-info" style={{ marginBottom: 14 }}><Icon name="phone" size={17} /><div>{reason === 'missing' ? WA_MSG.noPhone : WA_MSG.badPhone}</div></div>
      <PhoneInput id="wa-phone" label="رقم WhatsApp" value={phone} onChange={(v) => setPhone(v)} showError={showErr} />
      {canSave && <label style={{ display: 'flex', gap: 8, alignItems: 'center', marginTop: 10, fontSize: 13.5 }}><input type="checkbox" checked={save} onChange={(e) => setSave(e.target.checked)} /> حفظ الرقم في ملف المريض</label>}
    </Modal>
  );
}

// على الكمبيوتر نافذة المشاركة بتعرض جهات الاتصال المسجلة بس — فبنسيب الاختيار للموظف
function MethodModal({ p, onClose, onShare, onChat }: { p: Extract<Prepared, { ok: true }>; onClose: () => void; onShare: () => void; onChat: () => void }) {
  return (
    <Modal title="إرسال الفاتورة PDF" onClose={onClose} footer={<Button variant="outline" onClick={onClose}>إلغاء</Button>}>
      <p className="muted" style={{ marginTop: 0 }}>جهّزنا لك الفاتورة <strong dir="ltr">{p.file.name}</strong> للمريض {p.who}. اختر طريقة الإرسال:</p>
      <div className="choice-grid">
        <button type="button" className="choice" onClick={onShare}>
          <span className="choice__ic"><Icon name="share" size={18} /></span>
          <span style={{ flex: 1 }}><strong>مشاركة الملف</strong><span>يظهر الملف مرفقًا وجاهزًا: اختر واتساب ثم اختر المحادثة. (تظهر لك الأرقام المحفوظة عندك فقط)</span></span>
        </button>
        <button type="button" className="choice" onClick={onChat}>
          <span className="choice__ic">{waIcon}</span>
          <span style={{ flex: 1 }}><strong>افتح محادثة المريض</strong><span>تُفتح لك المحادثة برقمه حتى لو لم يكن محفوظًا عندك، ويُنزَّل الملف. أرفقه من 📎 ثم «مستند» وأرسل.</span></span>
        </button>
      </div>
    </Modal>
  );
}

// زر «إرسال الفاتورة PDF عبر WhatsApp» — بدون API: مفيش إرسال تلقائي ولا تأكيد وصول من واتساب.
//  موبايل/تابلت يدعم مشاركة الملفات → نافذة المشاركة الأصلية والـ PDF مرفق. كمبيوتر → اختيار (مشاركة / فتح محادثة الرقم + تنزيل). غير مدعوم → تنزيل + فتح المحادثة.
export function InvoiceWhatsappButton({ invoice, size, variant = 'success', compact }: { invoice: Invoice | undefined; size?: 'sm' | 'md'; variant?: 'success' | 'outline' | 'ghost'; compact?: boolean }) {
  const toast = useToast();
  const can = useCan();
  const [state, setState] = useState<'idle' | 'preparing' | 'ready'>('idle');
  const [ask, setAsk] = useState<'missing' | 'invalid' | null>(null);
  const [choice, setChoice] = useState<Extract<Prepared, { ok: true }> | null>(null);
  const ready = useRef<Extract<Prepared, { ok: true }> | null>(null);
  const lock = useRef(false);
  if (!can('invoices', 'view')) return null;
  const label = state === 'preparing' ? WA_MSG.preparing : state === 'ready' ? 'مشاركة الفاتورة' : 'إرسال الفاتورة PDF عبر WhatsApp';
  const outcome = (o: ShareOutcome, p: Extract<Prepared, { ok: true }>) => {
    setChoice(null);
    if (o === 'needs_click') { setState('ready'); toast.info('تم تجهيز الفاتورة PDF — اضغط «مشاركة الفاتورة».'); return; }
    setState('idle'); ready.current = null;
    if (o === 'shared') toast.success('تم تجهيز الفاتورة للمشاركة — تأكد من وصولها في محادثة ' + p.who + '.');
    else if (o === 'cancelled') toast.info('تم إلغاء مشاركة الفاتورة.');
    else if (o === 'fallback') toast.info(`تم تجهيز الفاتورة PDF (${p.file.name}) وفُتحت محادثة ${p.who} — أرفق الملف من 📎 (مستند) ثم اضغط إرسال.`);
    else toast.info(`تم تجهيز الفاتورة وتنزيلها (${p.file.name}) لكن المتصفح منع فتح واتساب — اسمح بالنوافذ المنبثقة، أو أرسلها يدويًا للمريض: ${p.who}.`);
  };
  const run = async (phoneOverride?: string) => {
    if (lock.current) return; // منع الضغط المتكرر أثناء التجهيز
    if (!invoice) { toast.error(WA_MSG.noInvoice); return; }
    if (state === 'ready' && ready.current) { outcome(await shareInvoiceFile(ready.current), ready.current); return; }
    if (!phoneOverride) {
      const r = resolveWhatsappPhone(invoice.id);
      if (r.status === 'no_invoice') { toast.error(WA_MSG.noInvoice); return; }
      if (r.status === 'missing' || r.status === 'invalid') { setAsk(r.status); return; } // لا فتح لواتساب برقم غير صالح — بنطلب رقم
    }
    lock.current = true; setState('preparing');
    // مفيش مشاركة ملفات → نافذة واتساب بتتفتح مع الضغطة نفسها (قبل تجهيز الـ PDF) عشان المتصفح مايحجبهاش
    const win = canShareFiles() ? null : window.open('about:blank', '_blank');
    try {
      const p = await prepareInvoiceFile(invoice.id, phoneOverride); // الـ PDF بيتولّد مرة واحدة
      if (!p.ok) { win?.close(); setState('idle'); toast.error(p.error); return; }
      ready.current = p;
      if (canShareFiles() && !isMobile) { setState('idle'); setChoice(p); return; } // كمبيوتر: الموظف يختار الطريقة
      outcome(await shareInvoiceFile(p, win), p);
    } catch { win?.close(); setState('idle'); toast.error('تعذر تجهيز الفاتورة. حاول مرة ثانية.'); }
    finally { lock.current = false; }
  };
  const patientId = invoice ? invoice.patientId : '';
  return (
    <>
      <Button variant={variant} size={size} onClick={() => run()} disabled={state === 'preparing'} loading={state === 'preparing'}
        title="يجهّز ملف الفاتورة PDF ويفتح واتساب/المشاركة على رقم المريض — بدون إرسال تلقائي" aria-label="إرسال الفاتورة PDF عبر WhatsApp">
        {state !== 'preparing' && waIcon}{compact ? <span className="hide-sm">{label}</span> : label}
      </Button>
      {ask && (
        <PhoneEntryModal reason={ask} canSave={can('patients', 'edit')} onClose={() => setAsk(null)}
          onContinue={(e164, save) => {
            setAsk(null);
            if (save && patientId) void db.updatePatient(patientId, { phone: e164 }).catch(() => toast.error('تعذّر حفظ الرقم في ملف المريض.'));
            void run(e164);
          }} />
      )}
      {choice && (
        <MethodModal p={choice} onClose={() => { setChoice(null); ready.current = null; }}
          onShare={async () => outcome(await shareInvoiceFile(choice), choice)}
          onChat={() => outcome(openChatWithFile(choice, null), choice)} />
      )}
    </>
  );
}

// عرض + تحميل (لصفحة المواعيد وغيرها)
export function InvoiceFileButtons({ invoice, size, print = true }: { invoice: Invoice | undefined; size?: 'sm' | 'md'; print?: boolean }) {
  const toast = useToast();
  if (!invoice) return null;
  const wrap = (fn: () => Promise<void>) => async () => { try { await fn(); } catch (e) { toast.error((e as Error).message || 'تعذّر إنشاء ملف PDF.'); } };
  return (
    <>
      <Button variant="outline" size={size} icon="eye" onClick={wrap(() => viewInvoicePdf(invoice.id))}>عرض الفاتورة</Button>
      <Button variant="outline" size={size} icon="download" onClick={wrap(() => downloadPdf(invoice.id))}>تحميل PDF</Button>
      {print && <Button variant="outline" size={size} icon="print" onClick={wrap(() => printInvoicePdf(invoice.id))}>طباعة الفاتورة</Button>}
    </>
  );
}
export const invoiceOfAppointment = (appointmentId: string) => db.invoices().find((i) => i.appointmentId === appointmentId);
