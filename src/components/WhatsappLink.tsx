// زرار واتساب جنب رقم المريض — بيفتح المحادثة مباشرة (التطبيق أو WhatsApp Web)
import { useState } from 'react';
import { waPhone } from '../utils/format';
import { ExerciseSendModal, useCanSendExercises } from '../ortho/ExerciseSend';

export function WhatsappLink({ phone, patientId, label = false, button = false }: { phone: string; patientId?: string; label?: boolean; button?: boolean }) {
  const n = phone ? waPhone(phone) : '';
  const [menu, setMenu] = useState(false);
  const canEx = useCanSendExercises(); // من غير صلاحية التمرينات: الزرار بيفتح الشات على طول
  if (!n) return null;
  const cls = button ? 'btn btn--outline btn--sm wa-btn' : 'wa-link';
  // مريض معروف: ضغطة واتساب بتفتح خيارات (صور تمرينات / فيديوهات / ملفات PDF / رابط / فتح شات فاضي)؛ من غيره بيفتح الشات على طول
  const wrap = (children: React.ReactNode) => patientId && canEx
    ? <>
      <button type="button" className={cls} title="واتساب" aria-label="واتساب" onClick={(e) => { e.stopPropagation(); setMenu(true); }}>{children}</button>
      {menu && <span onClick={(e) => e.stopPropagation()}><ExerciseSendModal patientId={patientId} onClose={() => setMenu(false)} /></span>}
    </>
    : <a className={cls} href={`https://wa.me/${n}`} target="_blank" rel="noopener noreferrer" title="فتح محادثة واتساب" aria-label="فتح محادثة واتساب" onClick={(e) => e.stopPropagation()}>{children}</a>;
  return (
    wrap(<>
      <svg width="16" height="16" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true"><path d="M17.5 14.4c-.3-.1-1.7-.8-2-.9-.3-.1-.5-.1-.7.1-.2.3-.8.9-.9 1.1-.2.2-.3.2-.6.1-.3-.1-1.2-.5-2.3-1.4-.9-.8-1.4-1.7-1.6-2-.2-.3 0-.5.1-.6l.4-.5c.1-.2.2-.3.3-.5.1-.2 0-.4 0-.5l-.9-2.2c-.2-.6-.5-.5-.7-.5h-.6c-.2 0-.5.1-.8.4-.3.3-1 1-1 2.4s1 2.8 1.2 3c.1.2 2 3.1 4.9 4.3.7.3 1.2.5 1.7.6.7.2 1.3.2 1.8.1.6-.1 1.7-.7 1.9-1.4.2-.7.2-1.2.2-1.4-.1-.1-.3-.2-.6-.3zM12 2a10 10 0 0 0-8.6 15.1L2 22l5-1.3A10 10 0 1 0 12 2zm0 18.2c-1.6 0-3.1-.4-4.4-1.2l-.3-.2-3 .8.8-2.9-.2-.3A8.2 8.2 0 1 1 12 20.2z" /></svg>
      {(label || button) && <span>واتساب</span>}
    </>)
  );
}
