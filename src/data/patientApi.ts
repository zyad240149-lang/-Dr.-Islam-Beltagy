// ===============================================================
// واجهة بيانات المريض — كل شيء عبر Supabase مع RLS (المريض يقرأ بياناته فقط) ودوال RPC للحجز.
// ===============================================================
import { supabase } from '../lib/supabase';
import { map } from './remote';
import type { AppNotification, Invoice, Payment, PatientFile, TreatmentPlan } from '../types';

const clean = (m: string) => m.replace(/^.*?ERROR:\s*/, '');
export class PatientApiError extends Error {}
async function call<T>(fn: string, args?: Record<string, unknown>): Promise<T> {
  const { data, error } = await supabase.rpc(fn, args);
  if (error) throw new PatientApiError(clean(error.message));
  return data as T;
}

export interface CatalogService { id: string; name: string; category: string; description: string; price: number; durationMin: number; prices: Array<{ id: string; label: string; price: number }>; doctorIds: string[] }
export interface CatalogDoctor { id: string; name: string; title: string; bio: string; photo: string; photoUrl: string; workHours: Array<{ day: string; from: string; to: string; breakFrom?: string; breakTo?: string }>; defaultDurationMin: number; serviceIds: string[] }
export interface Catalog {
  center: { name: string; phone: string; email: string; city: string; district: string; street: string; currency: string; slotStep: number; cancelBeforeHours: number; weekSchedule: Array<{ day: string; open: boolean; from: string; to: string }> };
  services: CatalogService[]; doctors: CatalogDoctor[];
}
export interface PatientAppointment { id: string; no: string; date: string; time: string; duration_min: number; status: string; notes: string; price: number; cancel_reason: string | null; service_id: string; therapist_id: string | null; service: string; doctor: string | null }
export interface PatientDashboard {
  next: { id: string; no: string; date: string; time: string; status: string; duration_min: number; service: string; doctor: string | null } | null;
  totalAppointments: number; completedAppointments: number; upcomingAppointments: number; activePlans: number; dueInvoices: number; dueAmount: number; unreadNotifications: number;
}
export type DoctorDayStatus = 'ok' | 'past' | 'closed' | 'holiday' | 'leave' | 'not_offered' | 'no_doctor' | 'off_day' | 'no_hours';
export interface DoctorDaySlots { status: DoctorDayStatus; slots: Array<{ time: string; available: boolean; past?: boolean }>; doctorFrom?: string; doctorTo?: string }
export const DOCTOR_DAY_MESSAGE: Record<DoctorDayStatus, string> = {
  ok: '', past: 'ما يمكن الحجز في تاريخ سابق.', closed: 'المركز مغلق في هاليوم — اختر يوم ثاني.', holiday: 'المركز مغلق في هاليوم — اختر يوم ثاني.',
  leave: 'الدكتور في إجازة في هاليوم — اختر يوم ثاني أو دكتور ثاني.', not_offered: 'هذا الدكتور ما يقدّم الخدمة المختارة.', no_doctor: 'يرجى اختيار الدكتور لعرض المواعيد المتاحة',
  off_day: 'الدكتور ما يعمل في هاليوم — اختر يوم ثاني أو دكتور ثاني.', no_hours: 'ما فيه مواعيد متاحة لهذا الدكتور حاليًا — اختر دكتور ثاني.',
};

export interface PatientProfile { customer: any; patient: any; doctor: string | null }

export const ymd = (d: Date) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;

// حساب الأوقات للمريض على الخادم بس (doctor_day_slots — هجرة 157: دوام الدكتور + العطلات + إجازته + حجوزاته)

export const patientApi = {
  catalog: () => call<Catalog>('public_catalog'),
  // أوقات دكتور محدد في يوم (من الخادم): ساعات المركز + العطلات + إجازته + حجوزاته هو بس. available=false ⇒ محجوز (✕)
  doctorSlots: (therapistId: string, serviceId: string, date: string) => call<DoctorDaySlots>('doctor_day_slots', { p_therapist: therapistId, p_service: serviceId, p_date: date }),
  busy: (therapistId: string, date: string) => call<Array<{ time: string; durationMin: number }>>('busy_slots', { p_therapist: therapistId, p_date: date }),
  me: () => call<PatientProfile>('patient_me'),
  dashboard: () => call<PatientDashboard>('patient_dashboard'),
  appointments: () => call<PatientAppointment[]>('patient_appointments'),
  book: (p: { therapistId: string; serviceId: string; date: string; time: string; notes?: string; priceId?: string }) => call<{ id: string; no: string; doctor: string }>('patient_book', { p }),
  cancel: (id: string, reason = '') => call<void>('patient_cancel', { p_id: id, p_reason: reason }),
  reschedule: (id: string, date: string, time: string) => call<void>('patient_reschedule', { p_id: id, p_date: date, p_time: time }),
  updateProfile: (p: Record<string, unknown>) => call<void>('patient_update_profile', { p }),

  async plans(): Promise<TreatmentPlan[]> {
    const { data, error } = await supabase.from('treatment_plans').select('*').order('created_at', { ascending: false });
    if (error) throw new PatientApiError(clean(error.message));
    return (data ?? []).map(map.plan);
  },
  async invoices(): Promise<{ invoices: Invoice[]; payments: Payment[] }> {
    const [i, p] = await Promise.all([supabase.from('invoices').select('*').neq('status', 'draft').order('created_at', { ascending: false }), supabase.from('payments').select('*').order('date', { ascending: false })]);
    if (i.error) throw new PatientApiError(clean(i.error.message));
    return { invoices: (i.data ?? []).map(map.invoice), payments: (p.data ?? []).map(map.payment) };
  },
  // باقات المريض + طلبات تقسيطها (RLS: المريض يشوف بتاعه بس)
  async packages(): Promise<{ packages: Array<{ id: string; name: string; kind: string | null; totalSessions: number; usedSessions: number; status: string; expiryDate: string | null }>; requests: Array<{ invoiceId: string; status: string }> }> {
    const [k, r] = await Promise.all([
      supabase.from('packages').select('id,name,kind,total_sessions,used_sessions,status,expiry_date').order('start_date', { ascending: false }),
      supabase.from('package_installment_requests').select('invoice_id,status,requested_at').order('requested_at', { ascending: false }),
    ]);
    if (k.error) throw new PatientApiError(clean(k.error.message));
    return {
      packages: (k.data ?? []).map((x: any) => ({ id: x.id, name: x.name, kind: x.kind, totalSessions: x.total_sessions, usedSessions: x.used_sessions, status: x.status, expiryDate: x.expiry_date })),
      requests: (r.data ?? []).map((x: any) => ({ invoiceId: x.invoice_id, status: x.status })),
    };
  },
  async notifications(): Promise<AppNotification[]> {
    const { data, error } = await supabase.from('notifications').select('*').eq('audience', 'customer').order('created_at', { ascending: false }).limit(200);
    if (error) throw new PatientApiError(clean(error.message));
    return (data ?? []).map(map.notification);
  },
  async markRead(id?: string) {
    let q = supabase.from('notifications').update({ read: true }).eq('audience', 'customer').eq('read', false);
    if (id) q = q.eq('id', id);
    await q;
  },
  async files(): Promise<PatientFile[]> {
    const { data, error } = await supabase.from('patient_files').select('*').order('created_at', { ascending: false });
    if (error) throw new PatientApiError(clean(error.message));
    return (data ?? []).map(map.file);
  },
  async upload(patientId: string, file: File, name: string): Promise<void> {
    const allowed = ['application/pdf', 'image/png', 'image/jpeg', 'image/webp', 'application/msword', 'application/vnd.openxmlformats-officedocument.wordprocessingml.document', 'text/plain'];
    if (file.size > 10 * 1024 * 1024) throw new PatientApiError('حجم الملف أكبر من 10 ميجابايت.');
    if (!allowed.includes(file.type)) throw new PatientApiError('نوع الملف غير مدعوم (PDF أو صورة أو مستند).');
    const { data: u } = await supabase.auth.getUser();
    if (!u.user) throw new PatientApiError('انتهت الجلسة — سجّل الدخول من جديد.');
    const ext = (file.name.split('.').pop() ?? 'bin').toLowerCase().replace(/[^a-z0-9]/g, '').slice(0, 8) || 'bin';
    const path = `${patientId}/${crypto.randomUUID()}.${ext}`;
    const up = await supabase.storage.from('patient-files').upload(path, file, { contentType: file.type });
    if (up.error) throw new PatientApiError('تعذّر رفع الملف: ' + up.error.message);
    const { error } = await supabase.from('patient_files').insert({ patient_id: patientId, uploaded_by: u.user.id, uploaded_by_name: name, file_path: path, file_name: file.name, file_type: file.type, size_bytes: file.size });
    if (error) { await supabase.storage.from('patient-files').remove([path]); throw new PatientApiError(clean(error.message)); }
  },
  async fileUrl(path: string) { return (await supabase.storage.from('patient-files').createSignedUrl(path, 300)).data?.signedUrl ?? null; },

  loyaltySummary: () => call<{ balance: number; totalEarned: number; totalRedeemed: number; redemptionsCount: number }>('my_loyalty_summary'),
  // المريض يستبدل نقاطه بنفسه (30 = جلسة، 60 = جلستين) — الهوية من الجلسة على الخادم
  async redeemLoyalty(sessions: 1 | 2): Promise<{ code: string; sessions: number; points: number; remaining: number }> {
    return call('patient_redeem_loyalty', { p_sessions: sessions, p_idempotency_key: crypto.randomUUID() });
  },
  async loyaltyCodes(): Promise<Array<{ code: string; createdAt: string; status: 'unused' | 'used' | 'cancelled' | 'expired'; usedAt: string | null; validTo: string; sessions: number; usesLeft: number }>> {
    const { data, error } = await supabase.rpc('my_loyalty_codes');
    if (error) throw new PatientApiError(clean(error.message));
    return (data ?? []).map((r: any) => ({ code: r.code, createdAt: r.created_at, status: r.status, usedAt: r.used_at, validTo: r.valid_to, sessions: r.sessions ?? 1, usesLeft: r.uses_left ?? (r.status === 'unused' ? 1 : 0) }));
  },
  async loyaltyHistory(): Promise<Array<{ id: string; kind: string; points: number; reason: string; balanceAfter: number; createdAt: string }>> {
    const { data, error } = await supabase.from('loyalty_ledger').select('id,kind,points,reason,balance_after,created_at').order('created_at', { ascending: false }).limit(100);
    if (error) throw new PatientApiError(clean(error.message));
    return (data ?? []).map((r: any) => ({ id: r.id, kind: r.kind, points: r.points, reason: r.reason, balanceAfter: r.balance_after, createdAt: r.created_at }));
  },
  async removeFile(f: PatientFile) {
    const { error } = await supabase.from('patient_files').delete().eq('id', f.id);
    if (error) throw new PatientApiError(clean(error.message));
    await supabase.storage.from('patient-files').remove([f.filePath]);
  },
};
