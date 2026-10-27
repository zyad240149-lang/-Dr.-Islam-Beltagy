// حسابات بوابة العميل (جدول customers في قاعدة البيانات) — قراءة فقط من لوحة الإدارة.
// الربط بين ملف المريض وحساب البوابة بيتم على الخادم بمطابقة آخر 9 أرقام من الجوال.
import { supabase } from '../lib/supabase';
import type { Patient } from '../types';

export interface PortalAccount { id: string; name: string; phone: string; email: string | null; memberSince: string; patientId: string | null }

const normPhone = (phone: string) => phone.replace(/\D/g, '').slice(-9);
const toAccount = (row: any): PortalAccount => ({ id: row.id, name: row.name, phone: row.phone, email: row.email, memberSince: row.member_since, patientId: row.patient_id ?? null });

// undefined = تعذّر التحقق (خطأ اتصال أو لا توجد صلاحية)
export async function checkPortalAccount(patient: Patient): Promise<PortalAccount | null | undefined> {
  // الأول: الحساب المربوط بالملف نفسه؛ وإلا بمطابقة الجوال — بس لو الجوال كامل (جوال فاضي كان بيطابق أي حساب)
  const linked = await supabase.from('customers').select('*').eq('patient_id', patient.id).limit(1);
  if (linked.error) return undefined;
  if (linked.data?.[0]) return toAccount(linked.data[0]);
  const ph = normPhone(patient.phone ?? '');
  if (ph.length < 9) return null;
  const { data, error } = await supabase.from('customers').select('*').ilike('phone', `%${ph}`).is('patient_id', null).limit(1);
  if (error) return undefined;
  return data?.[0] ? toAccount(data[0]) : null;
}

// نسخة جماعية لقائمة المرضى — نداء واحد لكل الحسابات
export async function bulkPortalAccounts(patients: Patient[]): Promise<Map<string, PortalAccount> | undefined> {
  const { data, error } = await supabase.from('customers').select('*').limit(5000);
  if (error) return undefined;
  const byPhone = new Map<string, any>();
  const byPatient = new Map<string, any>();
  for (const row of data ?? []) { if (row.patient_id) byPatient.set(row.patient_id, row); else if (normPhone(row.phone ?? '').length === 9) byPhone.set(normPhone(row.phone), row); }
  const out = new Map<string, PortalAccount>();
  for (const p of patients) { const ph = normPhone(p.phone ?? ''); const row = byPatient.get(p.id) ?? (ph.length === 9 ? byPhone.get(ph) : undefined); if (row) out.set(p.id, toAccount(row)); }
  return out;
}
