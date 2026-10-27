// بيانات أقسام العظام: الكشوفات، الأشعة، الكسور والجبس، العمليات — جداول ortho_* على Supabase (RLS: عرض المرضى للقراءة، صلاحية الجلسات للكتابة)
// الكاش هنا في الذاكرة بس؛ أول ما شاشة تطلب نوع بيتحمّل من القاعدة، وكل حفظ/حذف بيستنى رد الخادم قبل ما يتعرض.
import { useSyncExternalStore } from 'react';
import { supabase } from '../lib/supabase';

export type Side = 'right' | 'left' | 'both' | 'na';
export type ImagingKind = 'xray' | 'mri' | 'ct' | 'dexa' | 'us';
export type ImagingStatus = 'requested' | 'received' | 'reviewed';
export type SurgeryStatus = 'planned' | 'scheduled' | 'done' | 'postponed';
export type FractureStatus = 'casted' | 'healing' | 'healed' | 'surgical';

export interface Medication { name: string; dose: string; frequency: string; duration: string; notes: string }
export interface ImagingRequest { kind: ImagingKind; region: string; view: string }
export interface Attachment { path: string; name: string; type: string; size: number }
export interface Consultation {
  id: string; patientId: string; date: string; complaint: string; region: string; side: Side; examination: string; diagnosis: string; plan: string;
  history: string; painScore: number | ''; icd10: string; medications: Medication[]; labs: string[]; imagingRequests: ImagingRequest[]; attachments: Attachment[]; followUp: string;
}
export interface Imaging { id: string; patientId: string; kind: ImagingKind; region: string; requestedAt: string; status: ImagingStatus; finding: string }
export interface Surgery { id: string; patientId: string; procedure: string; region: string; side: Side; hospital: string; date: string; implant: string; status: SurgeryStatus; notes: string }
export interface Fracture { id: string; patientId: string; bone: string; side: Side; kind: string; injuryDate: string; castDate: string; removalDue: string; status: FractureStatus }

export const SIDE: Record<Side, string> = { right: 'يمين', left: 'شمال', both: 'الجانبين', na: '—' };
export const REGIONS = ['الركبة', 'الكتف', 'العمود الفقري القطني', 'الرقبة', 'الفخذ', 'الحوض', 'الساق', 'الكاحل', 'القدم', 'الرسغ', 'الكوع', 'الساعد', 'اليد'];
export const IMAGING_KIND: Record<ImagingKind, string> = { xray: 'أشعة عادية X-Ray', mri: 'رنين مغناطيسي MRI', ct: 'أشعة مقطعية CT', dexa: 'قياس كثافة العظام DEXA', us: 'سونار Ultrasound' };
export const IMAGING_STATUS: Record<ImagingStatus, { label: string; tone: string }> = { requested: { label: 'مطلوبة', tone: 'warn' }, received: { label: 'وصلت', tone: 'info' }, reviewed: { label: 'تمت القراءة', tone: 'ok' } };
export const SURGERY_STATUS: Record<SurgeryStatus, { label: string; tone: string }> = { planned: { label: 'مقترحة', tone: 'muted' }, scheduled: { label: 'محددة', tone: 'info' }, done: { label: 'تمت', tone: 'ok' }, postponed: { label: 'مؤجلة', tone: 'warn' } };
export const FRACTURE_STATUS: Record<FractureStatus, { label: string; tone: string }> = { casted: { label: 'في الجبس', tone: 'info' }, healing: { label: 'في مرحلة الالتئام', tone: 'brand' }, healed: { label: 'التأم', tone: 'ok' }, surgical: { label: 'تحتاج تدخل جراحي', tone: 'danger' } };

export const daysBetween = (a: string, b: string) => Math.round((new Date(b + 'T00:00:00').getTime() - new Date(a + 'T00:00:00').getTime()) / 86400000);
export const addDays = (s: string, n: number) => { const d = new Date(s + 'T00:00:00'); d.setDate(d.getDate() + n); return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`; };
const todayYmd = () => new Intl.DateTimeFormat('en-CA', { timeZone: 'Africa/Cairo' }).format(new Date());

// الأعمدة المسموح إرسالها لكل جدول (أي حاجة غيرها بتتجاهل — created_by والتواريخ بيحددها الخادم)
const COLUMNS: Record<Kind, string[]> = {
  consultations: ['patient_id', 'date', 'complaint', 'region', 'side', 'examination', 'diagnosis', 'plan', 'history', 'pain_score', 'icd10', 'medications', 'labs', 'imaging_requests', 'attachments', 'follow_up'],
  imaging: ['patient_id', 'kind', 'region', 'requested_at', 'status', 'finding'],
  surgeries: ['patient_id', 'procedure', 'region', 'side', 'hospital', 'date', 'implant', 'status', 'notes'],
  fractures: ['patient_id', 'bone', 'side', 'kind', 'injury_date', 'cast_date', 'removal_due', 'status'],
};
type Kind = 'consultations' | 'imaging' | 'surgeries' | 'fractures';
type Of<K extends Kind> = K extends 'consultations' ? Consultation : K extends 'imaging' ? Imaging : K extends 'surgeries' ? Surgery : Fracture;
type Row = Record<string, unknown>;

const camel = (k: string) => k.replace(/_([a-z])/g, (_, c: string) => c.toUpperCase());
const snake = (k: string) => k.replace(/[A-Z]/g, (m) => '_' + m.toLowerCase());
const fromRow = <T,>(r: Row) => Object.fromEntries(Object.entries(r).map(([k, v]) => [camel(k), v ?? ''])) as T;
const toRow = (kind: Kind, o: object) => Object.fromEntries(Object.entries(o).map(([k, v]) => [snake(k), v]).filter(([k]) => COLUMNS[kind].includes(k as string)));
const clean = (m: string) => m.replace(/^.*?ERROR:\s*/, '').replace(/new row violates row-level security policy.*/i, 'ليس لديك صلاحية لهذه العملية.');

const cache: Partial<Record<Kind, Row[]>> = {};
const loading = new Set<Kind>();
const errors: Partial<Record<Kind, string>> = {};
let version = 0;
const subs = new Set<() => void>();
const bump = () => { version++; subs.forEach((f) => f()); };
export function useOrthoVersion() {
  return useSyncExternalStore((cb) => { subs.add(cb); return () => { subs.delete(cb); }; }, () => version);
}
// تغيير المستخدم ← الكاش بيتمسح (الصلاحيات بتختلف من مستخدم للتاني)
supabase.auth.onAuthStateChange((event) => {
  if (event === 'SIGNED_OUT' || event === 'SIGNED_IN') { for (const k of Object.keys(cache) as Kind[]) delete cache[k]; bump(); }
});

async function load(kind: Kind) {
  if (loading.has(kind)) return;
  loading.add(kind);
  const { data, error } = await supabase.from('ortho_' + kind).select('*').order('created_at', { ascending: false }).limit(5000);
  loading.delete(kind);
  if (error) errors[kind] = clean(error.message); else { delete errors[kind]; cache[kind] = data ?? []; }
  bump();
}

export const ortho = {
  /** من الكاش؛ لو النوع لسه ما اتحمّلش بيبدأ تحميله والشاشة بتتحدث لما يوصل */
  list<K extends Kind>(kind: K, patientId?: string): Of<K>[] {
    if (!cache[kind]) { void load(kind); return []; }
    return cache[kind]!.filter((r) => !patientId || r.patient_id === patientId).map((r) => fromRow<Of<K>>(r));
  },
  isLoading: (kind: Kind) => !cache[kind] && !errors[kind],
  error: (kind: Kind) => errors[kind] ?? null,
  reload: (kind: Kind) => load(kind),
  async save<K extends Kind>(kind: K, item: Omit<Of<K>, 'id'> & { id?: string }): Promise<string> {
    const row: Record<string, unknown> = toRow(kind, item);
    const table = supabase.from('ortho_' + kind);
    const q = item.id ? table.update(row as never).eq('id', item.id) : table.insert(row as never);
    const { data, error } = await q.select().single();
    if (error) throw new Error(clean(error.message));
    // لو النوع لسه ما اتحمّلش ما نعلّمهوش «محمّل» بصف واحد — أول شاشة تطلبه هتحمّله كامل
    const list = cache[kind];
    if (list) {
      const i = list.findIndex((r) => r.id === data.id);
      if (i >= 0) list[i] = data; else list.unshift(data);
    }
    bump();
    return data.id as string;
  },
  async remove(kind: Kind, id: string) {
    const { data, error } = await supabase.from('ortho_' + kind).delete().eq('id', id).select('id');
    if (error) throw new Error(clean(error.message));
    if (!data?.length) throw new Error('ليس لديك صلاحية حذف هذا السجل.');
    cache[kind] = (cache[kind] ?? []).filter((r) => r.id !== id);
    bump();
  },
  // صور الأشعة/التقارير المرفقة بالكشف: بتترفع في ملفات المريض (نفس الـ bucket وصلاحياته) تحت مجلد xray
  async uploadAttachment(patientId: string, file: File): Promise<Attachment> {
    if (file.size > 10 * 1024 * 1024) throw new Error('حجم الملف أكبر من 10 ميجابايت.');
    if (!['image/png', 'image/jpeg', 'image/webp', 'application/pdf'].includes(file.type)) throw new Error('ارفع صورة (JPG/PNG/WEBP) أو PDF.');
    const ext = (file.name.split('.').pop() ?? 'bin').toLowerCase().replace(/[^a-z0-9]/g, '').slice(0, 8) || 'bin';
    const path = `${patientId}/xray/${crypto.randomUUID()}.${ext}`;
    const { error } = await supabase.storage.from('patient-files').upload(path, file, { contentType: file.type, upsert: false });
    if (error) throw new Error('تعذّر رفع الملف: ' + clean(error.message));
    return { path, name: file.name, type: file.type, size: file.size };
  },
  async attachmentUrl(path: string): Promise<string | null> {
    const { data } = await supabase.storage.from('patient-files').createSignedUrl(path, 600);
    return data?.signedUrl ?? null;
  },
  async removeAttachment(path: string) { await supabase.storage.from('patient-files').remove([path]); },
  pendingImaging: () => (cache.imaging ?? []).filter((r) => r.status !== 'reviewed').length,
  castsDue: () => { const t = todayYmd(); return (cache.fractures ?? []).filter((r) => r.status !== 'healed' && String(r.removal_due) <= t).length; },
  preloadCounters: () => { if (!cache.imaging) void load('imaging'); if (!cache.fractures) void load('fractures'); },
};
