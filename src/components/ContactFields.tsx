// أرقام التواصل الإضافية (هجرة 929): رقم إضافي اختياري + تحديد الرقم اللي عليه واتساب.
// الواتساب مش شرط للتسجيل: الافتراضي إن الرقم الأساسي عليه واتساب (نفس السلوك القديم)، ولو لأ يا إما الإضافي يا إما «إضافة رقم واتساب» تالت.
import { useRef, useState } from 'react';
import { PhoneInput } from './PhoneInput';
import { Button, Modal } from './ui';
import { useToast } from '../hooks/useToast';
import { db } from '../data/db';
import { phoneErrorMessage, type PhoneErrorCode } from '../utils/phoneUtils';
import { whatsappNumber } from '../utils/format';
import type { Patient, WhatsappMode } from '../types';

export interface ContactValue { phone2: string; whatsappMode: WhatsappMode; whatsappPhone: string }
export type ContactErrors = { phone2: PhoneErrorCode | null; whatsappPhone: PhoneErrorCode | null };

export const contactOf = (p?: Partial<Patient> | null): ContactValue => ({
  phone2: p?.phone2 ?? '', whatsappMode: p?.whatsappMode ?? 'phone', whatsappPhone: p?.whatsappPhone ?? '',
});

/** قبل الحفظ: اختيار بيشاور على رقم فاضي = مفيش واتساب، والرقم التالت بيتمسح لو مش مستخدم */
export function normalizeContact(v: ContactValue): ContactValue {
  let mode = v.whatsappMode;
  if (mode === 'phone2' && !v.phone2) mode = 'none';
  if (mode === 'other' && !v.whatsappPhone) mode = 'none';
  return { phone2: v.phone2, whatsappMode: mode, whatsappPhone: mode === 'other' ? v.whatsappPhone : '' };
}
export function contactError(e: ContactErrors): string | null {
  if (e.phone2) return 'الرقم الإضافي: ' + phoneErrorMessage(e.phone2);
  if (e.whatsappPhone) return 'رقم الواتساب: ' + phoneErrorMessage(e.whatsappPhone);
  return null;
}

export const WHATSAPP_SOURCE: Record<WhatsappMode, string> = { phone: 'الرقم الأساسي', phone2: 'الرقم الإضافي', other: 'رقم واتساب مستقل', none: 'لا يوجد واتساب' };

export function ContactFields({ idp, value, onChange, onErrors, showError }: {
  idp: string; value: ContactValue; onChange: (v: ContactValue) => void; onErrors: (e: ContactErrors) => void; showError?: boolean;
}) {
  // آخر أخطاء في ref (مش state): خانة الجوال بتبلّغ وقت الرسم، وتحديث الأب من جوّه setState تاني كان بيطلّع تحذير React
  const errs = useRef<ContactErrors>({ phone2: null, whatsappPhone: null });
  const setErr = (k: keyof ContactErrors, e: PhoneErrorCode | null) => {
    if (errs.current[k] === e) return;
    errs.current = { ...errs.current, [k]: e };
    onErrors(errs.current);
  };
  const set = (patch: Partial<ContactValue>) => onChange({ ...value, ...patch });
  const primaryWa = value.whatsappMode === 'phone';
  return (
    <>
      <PhoneInput id={`${idp}-phone2`} label="رقم هاتف إضافي (اختياري)" required={false} value={value.phone2} showError={showError}
        onChange={(v, e) => { if (v !== value.phone2) set({ phone2: v }); setErr('phone2', e); }} />
      <div className="field wa-field" style={{ gridColumn: '1 / -1' }}>
        <label>رقم الواتساب</label>
        <label className="wa-field__check">
          <input type="checkbox" checked={primaryWa} onChange={(e) => set({ whatsappMode: e.target.checked ? 'phone' : value.phone2 ? 'phone2' : 'none' })} />
          الرقم الأساسي عليه واتساب
        </label>
        {!primaryWa && (
          <div className="wa-field__alt">
            {value.phone2 && (
              <label className="wa-field__check">
                <input type="radio" name={`${idp}-wa`} checked={value.whatsappMode === 'phone2'} onChange={() => set({ whatsappMode: 'phone2' })} />
                الرقم الإضافي عليه واتساب
              </label>
            )}
            {value.whatsappMode === 'other' ? (
              <div className="wa-field__other">
                <PhoneInput id={`${idp}-wa-phone`} label="رقم الواتساب" required={false} value={value.whatsappPhone} showError={showError}
                  onChange={(v, e) => { if (v !== value.whatsappPhone) set({ whatsappPhone: v }); setErr('whatsappPhone', e); }} />
                <Button size="sm" variant="soft-danger" icon="trash" type="button" onClick={() => { setErr('whatsappPhone', null); set({ whatsappMode: 'none', whatsappPhone: '' }); }}>حذف رقم الواتساب</Button>
              </div>
            ) : (
              <Button size="sm" variant="outline" icon="plus" type="button" onClick={() => set({ whatsappMode: 'other' })}>إضافة رقم واتساب</Button>
            )}
            {value.whatsappMode === 'none' && <span className="muted-sm">مفيش رقم واتساب للمريض — ده مش شرط للتسجيل.</span>}
          </div>
        )}
      </div>
    </>
  );
}

/** نافذة صغيرة من ملف المريض: تعديل الرقم الإضافي والواتساب بس (من غير ما تفتح كل البيانات) */
export function WhatsappModal({ patient, onClose }: { patient: Patient; onClose: () => void }) {
  const toast = useToast();
  const [v, setV] = useState(() => contactOf(patient));
  const [errs, setErrs] = useState<ContactErrors>({ phone2: null, whatsappPhone: null });
  const [tried, setTried] = useState(false);
  const [busy, setBusy] = useState(false);
  const save = async () => {
    setTried(true);
    const e = contactError(errs);
    if (e) { toast.error(e); return; }
    setBusy(true);
    try { await db.updatePatient(patient.id, normalizeContact(v)); toast.success('تم حفظ أرقام التواصل.'); onClose(); }
    catch (x) { toast.error((x as Error).message); } finally { setBusy(false); }
  };
  return (
    <Modal title="رقم الواتساب والرقم الإضافي" onClose={onClose} footer={<><Button variant="outline" onClick={onClose}>إلغاء</Button><Button icon="check" loading={busy} onClick={save}>حفظ</Button></>}>
      <p className="muted-sm" style={{ marginTop: 0 }}>الرقم الأساسي: <bdi dir="ltr" className="num">{patient.phone || '—'}</bdi></p>
      <div className="grid-form"><ContactFields idp="wam" value={v} onChange={setV} onErrors={setErrs} showError={tried} /></div>
    </Modal>
  );
}

/** سطر «الواتساب» في ملف المريض: الرقم المستخدم ومصدره */
export function whatsappLabel(p: Patient): { number: string; source: string } {
  const mode = p.whatsappMode ?? 'phone';
  const number = whatsappNumber(p);
  return { number, source: number ? WHATSAPP_SOURCE[mode] : WHATSAPP_SOURCE.none };
}
