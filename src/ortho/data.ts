// بيانات أقسام العظام: الكشوفات، الأشعة، الكسور والجبس، العمليات — جداول ortho_* على Supabase (RLS: عرض المرضى للقراءة، صلاحية الجلسات للكتابة)
// الكاش هنا في الذاكرة بس؛ أول ما شاشة تطلب نوع بيتحمّل من القاعدة، وكل حفظ/حذف بيستنى رد الخادم قبل ما يتعرض.
import { useSyncExternalStore } from 'react';
import { supabase } from '../lib/supabase';
import { offline } from '../offline';
import { isNetworkError, net } from '../offline/net';
import { uuid } from '../offline/queue';
import { fetchKeyset } from '../data/download';

export type Side = 'right' | 'left' | 'both' | 'na';
export type ImagingKind = 'xray' | 'mri' | 'ct' | 'dexa' | 'us' | 'lab';
export type ImagingStatus = 'requested' | 'received' | 'reviewed';
export type SurgeryStatus = 'planned' | 'scheduled' | 'done' | 'postponed';
export type FractureStatus = 'casted' | 'healing' | 'healed' | 'surgical';

export interface Medication { name: string; dose: string; frequency: string; duration: string; notes: string }
export interface ImagingRequest { kind: ImagingKind; region: string; view: string }
export interface Attachment { path: string; name: string; type: string; size: number }
export interface Consultation {
  id: string; patientId: string; date: string; complaint: string; region: string; side: Side; examination: string; diagnosis: string; plan: string;
  history: string; painScore: number | ''; icd10: string; medications: Medication[]; labs: string[]; imagingRequests: ImagingRequest[]; attachments: Attachment[]; followUp: string;
  sheet?: ExamSheet; // شيت الكشف الرقمي (التمريض + الورك والركبة) — الكشوفات القديمة من غيره
  complete?: boolean; // false = اتحفظ ناقص «يحتاج استكمال» (هجرة 917)؛ مش موجود = كشف قديم مكتمل
  appointmentId?: string | null; // الزيارة (الموعد اللي اتعمله حضور) — زيارة واحدة = تشخيص واحد (هجرة 918)
  createdBy?: string | null; // الطبيب اللي سجّل التشخيص (بيتحدد على الخادم)
}
// اختيارات الشيت: on = خانات متعلّمة («المجموعة|البند»)، txt = خانات كتابة، meds = الأدوية الحالية، pain = أماكن الألم على خريطة الجسم («knee:right»)
export interface CurrentMed { name: string; dose: string; freq: string }
export interface ExamSheet { on: string[]; txt: Record<string, string>; meds: CurrentMed[]; pain: string[] }
export interface Imaging { id: string; patientId: string; kind: ImagingKind; region: string; requestedAt: string; status: ImagingStatus; finding: string; attachments: Attachment[] }
export interface Surgery { id: string; patientId: string; procedure: string; region: string; side: Side; hospital: string; date: string; implant: string; status: SurgeryStatus; notes: string }
// شيت متابعة التمريض (هجرة 919): خانات الاختيار قيم نصية ('' = متعلّمش)، والجبس والعملية بيتملوا بس لو المريض عنده جبس/عملية
export interface NursingSheet {
  visitNo: string; pain: number | ''; adherence: string; mobility: string; vsLast: string;
  newSymptoms: string; symptomsDetails: string; treatment: string; treatmentNotes: string; notes: string;
  cast: { on: boolean; type: string; typeOther: string; limb: string; applied: string; followUp: string; condition: string; conditionOther: string; notes: string };
  surgery: { on: boolean; procedure: string; date: string; followUp: string; wound: string; woundOther: string; dressing: string; bandage: string; notes: string };
}
export interface Nursing { id: string; patientId: string; appointmentId?: string | null; date: string; sheet: NursingSheet; createdBy?: string | null }
// سجل الحقن (هجرة 923) — نفس الشيت الورقي INJECTION RECORD؛ الاختيارات المتعددة قوايم والفردية نص ('' = متعلّمش)
export interface InjectionSheet {
  diagnosis: string; site: string[]; siteOther: string; side: string; target: string[]; targetOther: string; type: string[]; combination: string; typeOther: string;
  technique: string; approach: string; position: string; needle: string; syringe: string; materials: { drug: string; dose: string; batch: string; expiry: string }[];
  consent: string[]; consentNotes: string; aseptic: boolean; usConfirm: boolean; usFindings: string; procedureNotes: string; immediate: string;
  complications: string; complicationsText: string; instructions: string; plannedFollowUp: string; response: string; furtherPlan: string; signature: string; notes: string;
}
export interface Injection { id: string; patientId: string; appointmentId?: string | null; date: string; sheet: InjectionSheet; createdBy?: string | null }
export interface Fracture { id: string; patientId: string; bone: string; side: Side; kind: string; injuryDate: string; castDate: string; removalDue: string; status: FractureStatus }

export const SIDE: Record<Side, string> = { right: 'يمين', left: 'شمال', both: 'الجانبين', na: '—' };
export const REGIONS = ['الركبة', 'الكتف', 'العمود الفقري القطني', 'الرقبة', 'الفخذ', 'الحوض', 'الساق', 'الكاحل', 'القدم', 'الرسغ', 'الكوع', 'الساعد', 'اليد'];
// أسماء عمليات شائعة في جراحة العظام — تقترح نفسها أثناء الكتابة في "اسم العملية" (datalist)، والحقل يفضل نص حر
export const ORTHO_PROCEDURES = [
  'تغيير مفصل الركبة الكامل', 'تغيير مفصل الركبة الجزئي', 'تغيير مفصل الورك الكامل', 'تغيير مفصل الكتف',
  'تثبيت كسر بالصفائح والمسامير', 'تثبيت كسر بمسمار نخاعي', 'تثبيت خارجي للكسر', 'إزالة مثبتات معدنية',
  'منظار الركبة — إصلاح الغضروف الهلالي', 'منظار الركبة — إعادة بناء الرباط الصليبي الأمامي', 'منظار الكتف — إصلاح الكفة المدورة', 'منظار الكاحل',
  'خزع عظمي تصحيحي (Osteotomy)', 'تصحيح تشوه قدم', 'جراحة النفق الرسغي', 'إصلاح وتر أكيليس',
  'دمج فقري قطني', 'دمج فقري عنقي', 'استئصال غضروف بين الفقرات',
  'بتر طرف', 'خزع وتنظيف عظمي (Debridement)', 'خزع حر لعلاج هشاشة العظام (Vertebroplasty)',
];
export const IMAGING_KIND: Record<ImagingKind, string> = { xray: 'أشعة عادية X-Ray', mri: 'رنين مغناطيسي MRI', ct: 'أشعة مقطعية CT', dexa: 'قياس كثافة العظام DEXA', us: 'سونار Ultrasound', lab: 'تحليل معملي' };
export const IMAGING_STATUS: Record<ImagingStatus, { label: string; tone: string }> = { requested: { label: 'مطلوبة', tone: 'warn' }, received: { label: 'وصلت', tone: 'info' }, reviewed: { label: 'تمت القراءة', tone: 'ok' } };
export const SURGERY_STATUS: Record<SurgeryStatus, { label: string; tone: string }> = { planned: { label: 'مقترحة', tone: 'muted' }, scheduled: { label: 'محددة', tone: 'info' }, done: { label: 'تمت', tone: 'ok' }, postponed: { label: 'مؤجلة', tone: 'warn' } };
export const FRACTURE_STATUS: Record<FractureStatus, { label: string; tone: string }> = { casted: { label: 'في الجبس', tone: 'info' }, healing: { label: 'في مرحلة الالتئام', tone: 'brand' }, healed: { label: 'التأم', tone: 'ok' }, surgical: { label: 'تحتاج تدخل جراحي', tone: 'danger' } };

export const daysBetween = (a: string, b: string) => Math.round((new Date(b + 'T00:00:00').getTime() - new Date(a + 'T00:00:00').getTime()) / 86400000);
export const addDays = (s: string, n: number) => { const d = new Date(s + 'T00:00:00'); d.setDate(d.getDate() + n); return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`; };
const todayYmd = () => new Intl.DateTimeFormat('en-CA', { timeZone: 'Africa/Cairo' }).format(new Date());

// الأعمدة المسموح إرسالها لكل جدول (أي حاجة غيرها بتتجاهل — created_by والتواريخ بيحددها الخادم)
const COLUMNS: Record<Kind, string[]> = {
  consultations: ['patient_id', 'date', 'complaint', 'region', 'side', 'examination', 'diagnosis', 'plan', 'history', 'pain_score', 'icd10', 'medications', 'labs', 'imaging_requests', 'attachments', 'follow_up', 'sheet', 'complete', 'appointment_id'],
  imaging: ['patient_id', 'kind', 'region', 'requested_at', 'status', 'finding', 'attachments'],
  surgeries: ['patient_id', 'procedure', 'region', 'side', 'hospital', 'date', 'implant', 'status', 'notes'],
  fractures: ['patient_id', 'bone', 'side', 'kind', 'injury_date', 'cast_date', 'removal_due', 'status'],
  nursing: ['patient_id', 'appointment_id', 'date', 'sheet'],
  injections: ['patient_id', 'appointment_id', 'date', 'sheet'],
};
export type Kind = 'consultations' | 'imaging' | 'surgeries' | 'fractures' | 'nursing' | 'injections';
type Of<K extends Kind> = K extends 'consultations' ? Consultation : K extends 'imaging' ? Imaging : K extends 'surgeries' ? Surgery : K extends 'nursing' ? Nursing : K extends 'injections' ? Injection : Fracture;
type Row = Record<string, unknown>;

const camel = (k: string) => k.replace(/_([a-z])/g, (_, c: string) => c.toUpperCase());
const snake = (k: string) => k.replace(/[A-Z]/g, (m) => '_' + m.toLowerCase());
const fromRow = <T,>(r: Row) => Object.fromEntries(Object.entries(r).map(([k, v]) => [camel(k), v ?? ''])) as T;
const toRow = (kind: Kind, o: object) => Object.fromEntries(Object.entries(o).map(([k, v]) => [snake(k), v]).filter(([k]) => COLUMNS[kind].includes(k as string)));
const clean = (m: string) => m.replace(/^.*?ERROR:\s*/, '').replace(/new row violates row-level security policy.*/i, 'ليس لديك صلاحية لهذه العملية.')
  .replace(/.*ortho_consultations_appointment_uq.*/i, 'الزيارة دي ليها تشخيص متسجّل بالفعل — افتحه من «مرضى بانتظار التشخيص» وكمّله.');

const cache: Partial<Record<Kind, Row[]>> = {};          // المعروض = نسخة الخادم + التعديلات المعلّقة
const server: Partial<Record<Kind, Row[]>> = {};         // نسخة الخادم بس (اللي بتتحفظ على الجهاز)
const loading = new Set<Kind>();
const errors: Partial<Record<Kind, string>> = {};
let version = 0;
const subs = new Set<() => void>();
const bump = () => { version++; subs.forEach((f) => f()); };
// الاتصال رجع: رسالة «محتاج اتصال» بتتشال والشاشة بتحمّل من الخادم
net.subscribe(() => { if (net.isOnline() && Object.keys(errors).length) { for (const k of Object.keys(errors) as Kind[]) delete errors[k]; bump(); } });
/** الكشف اتحفظ ناقص ومحتاج استكمال */
export const isIncomplete = (c: { complete?: boolean }) => c.complete === false;
export function useOrthoVersion() {
  return useSyncExternalStore((cb) => { subs.add(cb); return () => { subs.delete(cb); }; }, () => version);
}
// تغيير المستخدم ← الكاش بيتمسح (الصلاحيات بتختلف من مستخدم للتاني)
supabase.auth.onAuthStateChange((event) => {
  if (event === 'SIGNED_OUT' || event === 'SIGNED_IN') { for (const k of Object.keys(cache) as Kind[]) delete cache[k]; bump(); }
});

// تعديلات اتعملت بدون إنترنت ولسه ما اتبعتتش: بتتعرض فوق نسخة الخادم (زي applyOverlay في db.ts)
function overlay(kind: Kind, rows: Row[]): Row[] {
  const out = rows.slice();
  for (const op of offline.queue.list()) {
    if (op.kind !== 'ortho.save' || op.payload.table !== 'ortho_' + kind) continue;
    const local = { ...(op.payload.local as Row), pendingSync: true };
    const i = out.findIndex((r) => r.id === op.entityId);
    if (i >= 0) out[i] = { ...out[i], ...local }; else out.unshift(local);
  }
  return out;
}
const byCreatedDesc = (a: Row, b: Row) => String(b.created_at ?? '').localeCompare(String(a.created_at ?? ''));

async function load(kind: Kind) {
  if (loading.has(kind)) return;
  // بدون إنترنت: النسخة المحفوظة على الجهاز هي المرجع (لو مفيش نسخة بنعرض «محتاج اتصال» بدل قائمة فاضية كأن مفيش بيانات)
  if (!net.isOnline()) { if (!cache[kind]) errors[kind] = 'البيانات دي لسه ما اتنزّلتش على الجهاز — محتاجة اتصال بالإنترنت مرة.'; bump(); return; }
  loading.add(kind);
  try {
    // كل الصفوف بالترقيم بالمؤشر (كان فيه حد 5000 صف بيقص الباقي من غير ما يبان)
    const rows = await fetchKeyset('ortho_' + kind);
    server[kind] = rows.sort(byCreatedDesc);
    cache[kind] = overlay(kind, server[kind]!);
    delete errors[kind];
  } catch (e) {
    if (!cache[kind]) errors[kind] = clean(e instanceof Error ? e.message : String(e));
  } finally { loading.delete(kind); }
  bump();
}

/** نسخة أقسام العظام للحفظ على الجهاز (نسخة الخادم بس — المعلّق في الطابور) */
export function exportOrthoCache(): Partial<Record<Kind, Row[]>> {
  const out: Partial<Record<Kind, Row[]>> = {};
  for (const k of Object.keys(server) as Kind[]) out[k] = server[k];
  return out;
}
/** فتح من النسخة المحفوظة (null = مسح عند الخروج) */
export function hydrateOrthoCache(x: Partial<Record<Kind, Row[]>> | null) {
  for (const k of Object.keys(cache) as Kind[]) { delete cache[k]; delete server[k]; delete errors[k]; }
  if (x) for (const k of Object.keys(x) as Kind[]) if (Array.isArray(x[k])) { server[k] = x[k]!; cache[k] = overlay(k, x[k]!); }
  bump();
}
const KIND_LABEL: Record<Kind, string> = { consultations: 'كشف', imaging: 'أشعة', surgeries: 'عملية', fractures: 'كسر/جبس', nursing: 'متابعة تمريض', injections: 'حقن' };
/**
 * حفظ على الجهاز ← طابور المزامنة. إنشاء: بمعرّف ثابت من الجهاز (إعادة الإرسال مابتكررش). تعديل: بنحفظ قيم الخادم وقت التعديل (base)
 * ولو حد غيّر نفس الحقول على الخادم قبل المزامنة ← «تعارض» يتعرض للطبيب يقرر (مفيش كتابة فوق تشخيص بصمت).
 * تعديل تاني على نفس السجل قبل المزامنة بيتدمج في نفس العملية.
 */
async function saveOffline(kind: Kind, id: string | undefined, row: Record<string, unknown>, newId?: string): Promise<string> {
  if (!offline.userId) throw new Error('سجّل الدخول الأول.');
  const table = 'ortho_' + kind;
  const eid = id ?? newId ?? uuid();
  const prev = server[kind]?.find((r) => r.id === eid);
  const pending = offline.queue.list().find((o) => o.kind === 'ortho.save' && o.entityId === eid && (o.status === 'pending' || o.status === 'failed'));
  const local = { ...(prev ?? {}), ...((pending?.payload.local as Row) ?? {}), ...row, id: eid, created_at: prev?.created_at ?? (pending?.payload.local as Row | undefined)?.created_at ?? new Date().toISOString() };
  try {
    if (pending) await offline.queue.editPayload(pending.id, { row: { ...(pending.payload.row as Row), ...row }, local });
    else await offline.queue.enqueue({
      kind: 'ortho.save', userId: offline.userId, entityId: eid, label: `${KIND_LABEL[kind]} — حفظ بدون اتصال`,
      payload: { table, row, isNew: !prev, local },
      base: prev ? Object.fromEntries(Object.keys(row).map((k) => [k, prev[k] ?? null])) : undefined,
    });
  } catch (e) { throw new Error('تعذّر الحفظ على الجهاز (التخزين ممتلئ أو ممنوع): ' + (e instanceof Error ? e.message : String(e))); }
  cache[kind] = overlay(kind, server[kind] ?? []);
  bump();
  return eid;
}

/** تنزيل كل أقسام العظام للجهاز بعد الدخول (عشان التاريخ المرضي والتشخيص والروشتات تفتح بدون إنترنت حتى لو الشاشة ما اتفتحتش قبل كده) */
export function loadAllOrtho(): Promise<void[]> { return Promise.all((Object.keys(COLUMNS) as Kind[]).map((k) => load(k))); }
/** بعد مزامنة ناجحة: إعادة تحميل الأنواع اللي اتحمّلت قبل كده */
export function reloadLoadedOrtho() { for (const k of Object.keys(server) as Kind[]) void load(k); }

export const ortho = {
  /** من الكاش؛ لو النوع لسه ما اتحمّلش بيبدأ تحميله والشاشة بتتحدث لما يوصل */
  list<K extends Kind>(kind: K, patientId?: string): Of<K>[] {
    // ماتحمّلش من الخادم لسه (أو اتعرض من الجهاز بس): أول ما يبقى فيه اتصال بيتحمّل
    if (!server[kind] && !errors[kind] && net.isOnline()) void load(kind);
    if (!cache[kind]) { if (!net.isOnline()) void load(kind); return []; }
    return cache[kind]!.filter((r) => !patientId || r.patient_id === patientId).map((r) => fromRow<Of<K>>(r));
  },
  isLoading: (kind: Kind) => !cache[kind] && !errors[kind],
  error: (kind: Kind) => errors[kind] ?? null,
  reload: (kind: Kind) => load(kind),
  async save<K extends Kind>(kind: K, item: Omit<Of<K>, 'id'> & { id?: string }): Promise<string> {
    const row: Record<string, unknown> = toRow(kind, item);
    // بدون إنترنت (أو السجل نفسه لسه مستني مزامنة): بيتحفظ على الجهاز ويتبعت لوحده لما الاتصال يرجع
    if (!net.isOnline() || (item.id && offline.queue.hasPendingFor(item.id))) return saveOffline(kind, item.id, row);
    const table = supabase.from('ortho_' + kind);
    // السجل الجديد بمعرّف من الجهاز: لو الاتصال قطع بعد ما الخادم حفظ، إعادة الإرسال مابتكررش السجل
    const id = item.id ?? uuid();
    const q = item.id ? table.update(row as never).eq('id', item.id) : table.insert({ ...row, id } as never);
    const { data, error } = await q.select().single();
    if (error) {
      if (isNetworkError(error)) return saveOffline(kind, item.id, row, item.id ? undefined : id);
      throw new Error(clean(error.message));
    }
    // لو النوع لسه ما اتحمّلش ما نعلّمهوش «محمّل» بصف واحد — أول شاشة تطلبه هتحمّله كامل
    for (const list of [server[kind], cache[kind]]) {
      if (!list) continue;
      const i = list.findIndex((r) => r.id === data.id);
      if (i >= 0) list[i] = data; else list.unshift(data);
    }
    bump();
    offline.scheduleSnapshot();
    return data.id as string;
  },
  async remove(kind: Kind, id: string) {
    if (!net.isOnline()) throw new Error('حذف السجلات الطبية محتاج اتصال بالإنترنت — جرّب لما الاتصال يرجع.');
    if (offline.queue.hasPendingFor(id)) throw new Error('السجل ده لسه مستني مزامنة — احذفه بعد ما يتبعت للخادم.');
    const { data, error } = await supabase.from('ortho_' + kind).delete().eq('id', id).select('id');
    if (error) throw new Error(clean(error.message));
    if (!data?.length) throw new Error('ليس لديك صلاحية حذف هذا السجل.');
    cache[kind] = (cache[kind] ?? []).filter((r) => r.id !== id);
    if (server[kind]) server[kind] = server[kind]!.filter((r) => r.id !== id);
    bump();
    offline.scheduleSnapshot();
  },
  // صور الأشعة/التقارير المرفقة بالكشف: بتترفع في ملفات المريض (نفس الـ bucket وصلاحياته) تحت مجلد xray
  async uploadAttachment(patientId: string, file: File): Promise<Attachment> {
    if (!net.isOnline()) throw new Error('رفع صور الأشعة محتاج اتصال بالإنترنت — احفظ الكشف دلوقتي وارفع الصور لما الاتصال يرجع.');
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
