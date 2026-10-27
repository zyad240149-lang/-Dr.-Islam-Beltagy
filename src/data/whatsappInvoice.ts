// مصدر واحد لإرسال الفاتورة عبر واتساب (المواعيد + الفواتير والمدفوعات + نافذة إنهاء الجلسة) — من غير API.
// «إرسال الفاتورة PDF»: A) شاشة المشاركة الأصلية والـ PDF مرفق → B/C) تنزيل الملف + فتح محادثة المريض برقمه → D) رسالة للمستخدم.
// مفيش API: مفيش تأكيد إرسال من واتساب، فمابنسجّلش «مُرسلة» — بنسجّل «تم فتح مشاركة الفاتورة» بس.
import { db } from './db';
import { parseStoredPhone } from '../utils/phoneUtils';
import { waPhone } from '../utils/format';

export const WA_MSG = {
  noInvoice: 'ما فيه فاتورة لإرسالها.',
  badPhone: 'رقم WhatsApp غير صالح، يرجى مراجعة رقم المريض.',
  noPhone: 'ما فيه رقم WhatsApp محفوظ لهذا المريض.',
  preparing: 'جاري تجهيز ملف الفاتورة...',
};

export type Prepared = { ok: true; file: File; who: string; phone: string; invoiceId: string; invoiceNo: string } | { ok: false; error: string };

// رقم المريض المحفوظ → E.164 بنفس نظام الأرقام الحالي (السعودية +966 افتراضيًا: 05xxxxxxxx → 9665xxxxxxxx، ومن غير تكرار الكود)
export type PhoneState = { status: 'ok'; e164: string; patientId: string; raw: string } | { status: 'missing'; patientId: string } | { status: 'invalid'; patientId: string; raw: string } | { status: 'no_invoice' };
export function resolveWhatsappPhone(invoiceId: string | undefined | null): PhoneState {
  const invoice = invoiceId ? db.invoice(invoiceId) : undefined;
  if (!invoice) return { status: 'no_invoice' };
  const raw = (db.patient(invoice.patientId)?.phone ?? '').trim();
  if (!raw) return { status: 'missing', patientId: invoice.patientId };
  const e164 = parseStoredPhone(raw).e164;
  return e164 ? { status: 'ok', e164, patientId: invoice.patientId, raw } : { status: 'invalid', patientId: invoice.patientId, raw };
}

// تجهيز الملف بعد التحقق من الفاتورة والرقم (phoneOverride = رقم أدخله الموظف لمرة واحدة — مابيتحفظش في Contacts)
const inflight = new Map<string, Promise<Prepared>>();
export function prepareInvoiceFile(invoiceId: string | undefined | null, phoneOverride?: string): Promise<Prepared> {
  if (!invoiceId) return Promise.resolve({ ok: false, error: WA_MSG.noInvoice });
  const key = invoiceId + '|' + (phoneOverride ?? '');
  const running = inflight.get(key);
  if (running) return running;
  const p = prepare(invoiceId, phoneOverride).finally(() => inflight.delete(key));
  inflight.set(key, p);
  return p;
}

async function prepare(invoiceId: string, phoneOverride?: string): Promise<Prepared> {
  const invoice = db.invoice(invoiceId);
  if (!invoice) return { ok: false, error: WA_MSG.noInvoice };
  if (invoice.status === 'cancelled') return { ok: false, error: 'الفاتورة ملغاة — ما يمكن إرسالها.' };
  if (invoice.status === 'draft') return { ok: false, error: 'الفاتورة للحين مسودة — اعتمدها أولًا.' };
  const patient = db.patient(invoice.patientId);
  const rawPhone = (phoneOverride ?? patient?.phone ?? '').trim();
  if (!rawPhone) return { ok: false, error: WA_MSG.noPhone };
  const phone = parseStoredPhone(rawPhone).e164;
  if (!phone) return { ok: false, error: WA_MSG.badPhone };
  try {
    const { buildInvoicePdf } = await import('../pages/Invoices'); // نفس مولّد «تحميل PDF» — import كسول لتفادي الدوران
    const blob = await buildInvoicePdf(invoiceId);
    // التحقق إن الملف PDF سليم قبل أي مشاركة (مش HTML ولا ملف فاضي) وحجمه معقول
    const head = new TextDecoder().decode(new Uint8Array(await blob.slice(0, 5).arrayBuffer()));
    if (head !== '%PDF-' || blob.size < 1000 || blob.size > 15 * 1024 * 1024) return { ok: false, error: 'تعذّر إنشاء ملف PDF سليم للفاتورة. حاول مرة ثانية.' };
    return { ok: true, file: new File([blob], `Invoice-${invoice.no}.pdf`, { type: 'application/pdf' }), who: `${patient?.fullName ?? ''} (${phone})`, phone, invoiceId, invoiceNo: invoice.no };
  } catch (e) { return { ok: false, error: (e as Error).message || 'تعذّر إنشاء ملف PDF.' }; }
}

export type ShareOutcome = 'shared' | 'cancelled' | 'needs_click' | 'fallback' | 'fallback_blocked';

// نص المشاركة: عام ومختصر — من غير أي بيانات طبية أو تفاصيل خدمة
const SHARE_TEXT = 'السلام عليكم، مرفق لكم فاتورة الخدمة الخاصة بكم.';

// هل الجهاز/المتصفح بيدعم مشاركة ملفات PDF (Web Share Level 2)؟ — اكتشاف حقيقي، مش افتراض
export function canShareFiles(): boolean {
  try { return !!navigator.share && !!navigator.canShare && navigator.canShare({ files: [new File([new Uint8Array(1)], 'x.pdf', { type: 'application/pdf' })] }); } catch { return false; }
}

// المرحلة B/C: مفيش مشاركة ملفات → نزّل الملف وافتح محادثة المريض برقمه (wa.me بيفتح التطبيق/WhatsApp Web) والموظف يرفقه.
// win = نافذة اتفتحت وقت الضغطة (قبل تجهيز الـ PDF) عشان المتصفح مايحجبهاش.
export function openChatWithFile(p: Extract<Prepared, { ok: true }>, win: Window | null): ShareOutcome {
  const a = document.createElement('a');
  a.href = URL.createObjectURL(p.file); a.download = p.file.name;
  document.body.appendChild(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(a.href), 60_000);
  void db.logInvoiceShare(p.invoiceId, 'fallback');
  const url = `https://wa.me/${waPhone(p.phone)}`;
  if (win && !win.closed) { win.location.href = url; return 'fallback'; }
  return window.open(url, '_blank') ? 'fallback' : 'fallback_blocked';
}

// المرحلة A: شاشة المشاركة الأصلية والـ PDF مرفق. لازم تتنادى من ضغطة المستخدم (needs_click = المتصفح طلب ضغطة تانية، الملف جاهز).
// resolve بتاعة share() معناها إن المستخدم أكمل شاشة المشاركة — مش تأكيد إن واتساب أرسل، فمابنوسمش الفاتورة «مُرسلة».
export async function shareInvoiceFile(p: Extract<Prepared, { ok: true }>, win: Window | null = null): Promise<ShareOutcome> {
  if (canShareFiles() && navigator.canShare({ files: [p.file] })) {
    try {
      await navigator.share({ files: [p.file], title: `فاتورة ${p.invoiceNo}`, text: SHARE_TEXT });
      win?.close();
      void db.logInvoiceShare(p.invoiceId, 'share');
      return 'shared';
    } catch (e) {
      const name = (e as DOMException).name;
      if (name === 'AbortError') { win?.close(); return 'cancelled'; } // المستخدم قفل المشاركة — مش فشل
      if (name === 'NotAllowedError') { win?.close(); return 'needs_click'; }
      // أي خطأ تاني: نكمل على البديل بدل ما نوقف المستخدم
    }
  }
  return openChatWithFile(p, win);
}
