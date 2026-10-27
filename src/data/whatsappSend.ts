import { supabase } from '../lib/supabase';
import { waLink } from '../utils/format';

// إرسال رسالة واتساب لعميل من السيستم (صلاحية «whatsapp/create»): بيفتح محادثة العميل بالرسالة جاهزة
// والموظف بيضغط إرسال في واتساب، وبتتسجّل في سجل الرسائل على الخادم (اللي بيتحقق من الصلاحية ونطاق المريض).
// الفتح لازم يحصل في نفس الضغطة (قبل أي await) وإلا المتصفح بيمنع النافذة.
export function sendWhatsApp(input: { phone: string; text: string; patientId?: string | null; type?: string }) {
  window.open(waLink(input.phone, input.text), '_blank', 'noopener');
  supabase.rpc('log_whatsapp_message', { p: { patientId: input.patientId ?? null, phone: input.phone, messageContent: input.text, messageType: input.type ?? 'general' } })
    .then(({ error }) => { if (error) console.warn('whatsapp log:', error.message); });
}
