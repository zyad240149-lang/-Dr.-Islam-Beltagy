import type { Area as PermArea } from '../types';
import { patientMatches, patientRank, stripFileNoPrefix } from '../utils/phoneUtils';
import type {
  Database, Patient, Therapist, Service, Appointment, AppointmentStatus, AppointmentType, VisitLocation,
  TreatmentSession, InitialAssessment, TreatmentPlan, Package, PackagePlan, Invoice, Payment,
  PaymentMethod, Employee, CenterInfo, DaySchedule, PermissionMatrix, InventoryItem, StockMovement, StockMovementType,
  AppNotification, NotificationKind, StaffRequest, StaffRequestType, DiscountCode, Campaign, Branch,
  SupportTicket, SupportReply, TicketPriority, TicketStatus, PatientFile, BodyRecord, AuditLog, AttendanceRow,
  LoyaltyLedgerRow, LoyaltyCodeRow, LoyaltySummary, PlanOffer,
} from '../types';
import { defaultPermissions } from '../services/defaultPermissions';
import { supabase } from '../lib/supabase';
import { fetchAll, map, toCenter, toMatrix } from './remote';
import { applyConditionRows, type ConditionRow } from './bodyRegions';
import { phoneMatches, normalizeSearch } from '../utils/phoneUtils';
import { addDaysYmd, planTotalSessions, riyadhNow, todayYmd } from '../utils/format';
import { offline } from '../offline';
import { net, isNetworkError } from '../offline/net';
import { uuid } from '../offline/queue';

// ===============================================================
// طبقة البيانات — المصدر الوحيد للحقيقة هو قاعدة بيانات Supabase.
// الكاش هنا في الذاكرة فقط (مش localStorage) ويتحمّل بعد الدخول من الجداول (RLS بيطبّق الصلاحيات)،
// وكل عملية كتابة بتروح لدوال RPC على الخادم (فيها التحقق والصلاحيات وقواعد العمل) ثم بيتحدّث الكاش من القاعدة.
// ===============================================================

const DAY_MS = 86400000;
let cache: Database | null = null;
let actorId: string | null = null;
let ready = false;
let rtChannel: ReturnType<typeof supabase.channel> | null = null;
let rtTimer: ReturnType<typeof setTimeout> | null = null;
const rtPending = new Set<string>();
const listeners = new Set<() => void>();

type Result<T = object> = ({ ok: true } & T) | { ok: false; error: string };

export class DbError extends Error {}

const EMPTY_WEEK: DaySchedule[] = (['sun', 'mon', 'tue', 'wed', 'thu', 'fri', 'sat'] as const).map((day) => ({ day, open: day !== 'fri', from: '09:00', to: '21:00' }));

let guests: Patient[] = [];
function emptyDb(): Database {
  return {
    version: 3,
    center: { name: 'عيادة د. إسلام بلتاجي لجراحة العظام والكسور', branchName: '', city: '', district: '', phone: '', workHours: '', workStart: '09:00', workEnd: '21:00', weekSchedule: EMPTY_WEEK, slotStepMin: 30, packageLowThreshold: 2, reminderHoursBefore: 2 },
    employees: [], patients: [], therapists: [], services: [], rooms: [], appointments: [], sessions: [], assessments: [], plans: [], packagePlans: [], planServices: [],
    packages: [], invoices: [], payments: [], notifications: [], inventory: [], stockMovements: [], activity: [], staffRequests: [], discountCodes: [],
    campaigns: [], branches: [], servicePrices: [], tickets: [], replies: [], permissions: defaultPermissions(), counters: { patient: 0, appointment: 0, invoice: 0, item: 0 },
  };
}

function load(): Database { return (cache ??= emptyDb()); }
function commit() { listeners.forEach((l) => l()); offline.scheduleSnapshot(); }

// ---------- الأوفلاين: العمليات المعلّقة بتتعرض فوق بيانات الخادم ----------
// أي pull جديد بيستبدل الجداول بنسخة الخادم، فبنعيد تطبيق العمليات اللي لسه ما اتزامنتش عشان ما تختفيش من الشاشة.
const OFFLINE_MSG = 'لا يوجد اتصال بالإنترنت — هذه العملية تحتاج اتصالًا بالخادم.';
function applyOverlay(d: Database) {
  for (const op of offline.queue.list()) {
    const local = op.payload.local as any;
    switch (op.kind) {
      case 'patient.create':
        if (!d.patients.some((p) => p.id === op.entityId)) d.patients.push({ ...local, pendingSync: true });
        break;
      case 'patient.update': {
        const i = d.patients.findIndex((p) => p.id === op.entityId);
        if (i >= 0) d.patients[i] = { ...d.patients[i], ...local, pendingSync: true };
        break;
      }
      case 'appointment.create':
        if (!d.appointments.some((a) => a.id === op.entityId)) d.appointments.push({ ...local, pendingSync: true });
        break;
      case 'appointment.reschedule': {
        const i = d.appointments.findIndex((a) => a.id === op.entityId);
        if (i >= 0) d.appointments[i] = { ...d.appointments[i], ...local, pendingSync: true };
        break;
      }
      case 'appointment.cancel': {
        const i = d.appointments.findIndex((a) => a.id === op.entityId);
        if (i >= 0) d.appointments[i] = { ...d.appointments[i], status: 'cancelled', cancelReason: String(op.payload.reason ?? ''), pendingSync: true };
        break;
      }
      case 'assessment.save': {
        const i = d.assessments.findIndex((a) => a.id === op.entityId);
        if (i >= 0) d.assessments[i] = { ...d.assessments[i], ...local }; else d.assessments.push(local);
        break;
      }
    }
  }
}
const withDependency = (patientId: string | undefined) => (patientId && offline.queue.list().some((o) => o.kind === 'patient.create' && o.entityId === patientId) ? patientId : undefined);
const saveLocalFail = (e: unknown): never => { throw new DbError('تعذّر حفظ التغيير على الجهاز (التخزين ممتلئ أو ممنوع): ' + (e instanceof Error ? e.message : String(e))); };
function queuePatientCreate(id: string, input: Omit<Patient, 'id' | 'fileNo' | 'registeredAt' | 'active'>): Promise<Patient> {
  const dup = db.findByPhone(input.phone);
  if (dup && normalizeSearch(dup.fullName) === normalizeSearch(input.fullName)) throw new DbError(`هذا المريض مسجّل بالفعل (${dup.fullName})`);
  const local: Patient = { ...(input as Patient), id, fileNo: '', registeredAt: Date.now(), active: true, pendingSync: true };
  return offline.queue.enqueue({ id, kind: 'patient.create', userId: offline.userId!, entityId: id, label: `إضافة مريض: ${input.fullName}`, payload: { row: map.patientRow(input as Partial<Patient>), local } })
    .then(() => { load().patients.push(local); commit(); return local; }, saveLocalFail);
}
async function queueAppointmentCreate(input: Parameters<typeof db.createAppointment>[0]): Promise<Result<{ appointment: Appointment }>> {
  if (input.guest || !input.patientId) return { ok: false, error: 'حجز مكالمة لمريض جديد يحتاج اتصالًا — أضف المريض أولًا أو انتظر الاتصال.' };
  const d = load(); const svc = d.services.find((s) => s.id === input.serviceId); const th = d.therapists.find((t) => t.id === input.therapistId);
  if (!svc || !svc.active) return { ok: false, error: 'الخدمة غير موجودة أو موقوفة' };
  if (!th) return { ok: false, error: 'اختر الدكتور' };
  if (!th.serviceIds.includes(svc.id)) return { ok: false, error: 'الدكتور لا يقدّم هذه الخدمة' };
  const patient = db.patient(input.patientId); if (!patient) return { ok: false, error: 'اختر المريض' };
  const dur = input.durationMin ?? svc.durationMin;
  const bad = localSlotCheck(th.id, input.date, input.time, dur); if (bad) return { ok: false, error: bad };
  const id = uuid(); const now = Date.now();
  const local: Appointment = {
    id, no: '', patientId: patient.id, type: input.type, serviceId: svc.id, therapistId: th.id, roomId: '', location: input.location ?? 'center', address: input.address ?? '',
    date: input.date, time: input.time, durationMin: dur, status: 'new', price: svc.price, packageId: input.packageId ?? null, planId: input.planId ?? null, seriesId: input.seriesId ?? null,
    cancelReason: null, createdAt: now, updatedAt: now, branchId: input.branchId ?? null, notes: input.notes ?? '', source: 'staff', pendingSync: true,
  };
  try {
    await offline.queue.enqueue({
      id, kind: 'appointment.create', userId: offline.userId!, entityId: id, dependsOn: withDependency(patient.id), label: `موعد ${patient.fullName} — ${svc.name} (${input.date} ${input.time})`,
      payload: { p: { ...input, patientId: patient.id }, patientId: patient.id, local },
    });
  } catch (e) { return saveLocalFail(e); }
  d.appointments.push(local); commit();
  return { ok: true, appointment: local };
}
async function queueReschedule(id: string, date: string, time: string, therapistId?: string, address?: string): Promise<Result> {
  const a = load().appointments.find((x) => x.id === id); if (!a) return { ok: false, error: 'الموعد غير موجود' };
  const th = therapistId || a.therapistId;
  const bad = localSlotCheck(th, date, time, a.durationMin, id); if (bad) return { ok: false, error: bad };
  const create = offline.queue.list().find((o) => o.kind === 'appointment.create' && o.entityId === id);
  const local = { date, time, therapistId: th, ...(address !== undefined ? { address } : {}) };
  try {
    if (create) await offline.queue.editPayload(create.id, { p: { ...(create.payload.p as object), date, time, therapistId: th }, local: { ...(create.payload.local as object), ...local } });
    else await offline.queue.enqueue({ kind: 'appointment.reschedule', userId: offline.userId!, entityId: id, label: `تغيير موعد ${db.patient(a.patientId)?.fullName ?? ''} إلى ${date} ${time}`, payload: { date, time, therapistId: therapistId ?? null, address: address ?? null, local }, base: { date: a.date, time: a.time } });
  } catch (e) { return saveLocalFail(e); }
  Object.assign(a, local, { pendingSync: true }); commit();
  return { ok: true };
}
async function queueCancel(id: string, reason?: string): Promise<void> {
  const a = load().appointments.find((x) => x.id === id); if (!a) throw new DbError('الموعد غير موجود');
  const create = offline.queue.list().find((o) => o.kind === 'appointment.create' && o.entityId === id);
  if (create) { await offline.queue.resolve(create.id, { type: 'discard' }); load().appointments = load().appointments.filter((x) => x.id !== id); commit(); return; } // لسه ما اتبعتش للخادم — يتشال محليًا
  try { await offline.queue.enqueue({ kind: 'appointment.cancel', userId: offline.userId!, entityId: id, label: `إلغاء موعد ${db.patient(a.patientId)?.fullName ?? ''} (${a.date} ${a.time})`, payload: { reason: reason ?? 'إلغاء (مسجّل بدون اتصال)' } }); } catch (e) { saveLocalFail(e); }
  Object.assign(a, { status: 'cancelled', cancelReason: reason ?? 'إلغاء (مسجّل بدون اتصال)', pendingSync: true }); commit();
}
/** نفس تحقق الخادم الأساسي محليًا (الخادم بيعيده وقت المزامنة — ده بس عشان المستخدم ما يسجّل حاجة مستحيلة) */
function localSlotCheck(therapistId: string, date: string, time: string, durationMin: number, excludeId?: string): string | null {
  const issue = db.doctorTimeIssue(therapistId, date, time, durationMin);
  if (issue) return issue;
  if (!db.availableSlots(therapistId, date, durationMin, excludeId).includes(time)) return 'هذا الوقت محجوز أو فات — اختر وقتًا آخر.';
  return null;
}

// بتوقيت الرياض دايمًا (مش توقيت جهاز المتصفح) — يطابق riyadh_today() على الخادم، تفاديًا لاختلاف يوم قرب منتصف الليل لو جهاز الموظف على توقيت مختلف
const RIYADH_DAY_FMT = new Intl.DateTimeFormat('en-CA', { timeZone: 'Africa/Cairo', year: 'numeric', month: '2-digit', day: '2-digit' });
const today = () => RIYADH_DAY_FMT.format(new Date());
const nowHm = () => { const n = riyadhNow(); return String(n.getHours()).padStart(2, '0') + ':' + String(n.getMinutes()).padStart(2, '0'); };

function addMinutes(hhmm: string, min: number) {
  const [h, m] = hhmm.split(':').map(Number);
  const total = h * 60 + m + min;
  return `${String(Math.floor(total / 60) % 24).padStart(2, '0')}:${String(total % 60).padStart(2, '0')}`;
}
// بالدقايق (المقارنة بالنص كانت بتلف بعد 12 بالليل: 23:00 + 60د = «00:00» فالتعارض مايتشافش)
const hmMin = (t: string) => { const m = /^(\d{2}):(\d{2})$/.exec(t || ''); return m ? +m[1] * 60 + +m[2] : NaN; };
const minHm = (n: number) => `${String(Math.floor(n / 60)).padStart(2, '0')}:${String(n % 60).padStart(2, '0')}`;
function overlaps(aStart: string, aDur: number, bStart: string, bDur: number) {
  const a = hmMin(aStart), b = hmMin(bStart);
  return a < b + bDur && b < a + aDur;
}
// العطلات + إجازات/استئذانات الأطباء المعتمدة (RPC schedule_blocks) — نفس اللي check_slot على الخادم بيقراه
let blocks: { holidays: Array<{ date: string; branchId: string | null }>; requests: Array<{ therapistId: string; type: 'leave' | 'permission'; from: string; to: string; fromTime: string; toTime: string }> } = { holidays: [], requests: [] };
export type DoctorDayStatus = 'ok' | 'no_doctor' | 'closed' | 'holiday' | 'leave' | 'no_hours' | 'off_day';
export interface DoctorDayWindow { status: DoctorDayStatus; centerFrom?: string; centerTo?: string; doctorFrom?: string; doctorTo?: string; blocks?: Array<{ from: number; to: number }> }
export const DOCTOR_DAY_LABEL: Record<Exclude<DoctorDayStatus, 'ok'>, string> = {
  no_doctor: 'الدكتور غير موجود أو غير نشط', closed: 'المركز مغلق في هاليوم', holiday: 'المركز مغلق في هاليوم (عطلة)',
  leave: 'الدكتور في إجازة في هذا التاريخ', no_hours: 'ما تم تحديد مواعيد عمل لهذا الدكتور', off_day: 'الدكتور ما يعمل في هاليوم',
};
const dayKey = (ymd: string): 'sun' | 'mon' | 'tue' | 'wed' | 'thu' | 'fri' | 'sat' =>
  (['sun', 'mon', 'tue', 'wed', 'thu', 'fri', 'sat'] as const)[new Date(ymd + 'T00:00:00').getDay()];
const daySchedule = (ymd: string) => load().center.weekSchedule.find((d) => d.day === dayKey(ymd));
// نسخة طبق الأصل من doctor_day_window() على الخادم (هجرة 157) — أي تغيير هنا لازم يتغيّر هناك
function doctorDayWindow(therapistId: string, ymd: string): DoctorDayWindow {
  const t = load().therapists.find((x) => x.id === therapistId);
  if (!t || !t.active) return { status: 'no_doctor' };
  const cd = daySchedule(ymd);
  if (!cd || !cd.open) return { status: 'closed' };
  if (blocks.holidays.some((h) => h.date === ymd && (!h.branchId || h.branchId === t.branchId))) return { status: 'holiday' };
  if (t.onLeave.some((l) => ymd >= l.from && ymd <= l.to) || blocks.requests.some((r) => r.therapistId === therapistId && r.type === 'leave' && ymd >= r.from && ymd <= r.to)) return { status: 'leave' };
  if (!t.workHours?.length) return { status: 'no_hours' };
  const wh = t.workHours.find((w) => w.day === dayKey(ymd));
  if (!wh || !(hmMin(wh.from) < hmMin(wh.to))) return { status: 'off_day' };
  const bl: Array<{ from: number; to: number }> = [];
  if (wh.breakFrom && wh.breakTo && hmMin(wh.breakTo) > hmMin(wh.breakFrom)) bl.push({ from: hmMin(wh.breakFrom), to: hmMin(wh.breakTo) });
  for (const r of blocks.requests) if (r.therapistId === therapistId && r.type === 'permission' && ymd >= r.from && ymd <= r.to && hmMin(r.toTime) > hmMin(r.fromTime)) bl.push({ from: hmMin(r.fromTime), to: hmMin(r.toTime) });
  return { status: 'ok', centerFrom: cd.from, centerTo: cd.to, doctorFrom: wh.from, doctorTo: wh.to, blocks: bl };
}
// null = الوقت يصلح للدكتور ده؛ وإلا السبب (زي doctor_window_reason على الخادم)
function windowReason(w: DoctorDayWindow, t: number, dur: number): 'center' | 'doctor' | 'blocked' | null {
  if (w.status !== 'ok') return 'doctor';
  if (t < hmMin(w.centerFrom!) || t > hmMin(w.centerTo!)) return 'center';
  if (t < hmMin(w.doctorFrom!) || t + dur > hmMin(w.doctorTo!)) return 'doctor';
  if (w.blocks!.some((b) => t < b.to && b.from < t + dur)) return 'blocked';
  return null;
}
// كل بدايات الأوقات اللي جوّه دوام الدكتور في اليوم ده (قبل استبعاد المحجوز/اللي فات)
function doctorStarts(therapistId: string, ymd: string, dur: number): string[] {
  const w = doctorDayWindow(therapistId, ymd);
  if (w.status !== 'ok') return [];
  const step = Math.max(load().center.slotStepMin || 30, 5);
  const out: string[] = [];
  for (let t = hmMin(w.centerFrom!); t <= hmMin(w.centerTo!); t += step) if (!windowReason(w, t, dur)) out.push(minHm(t));
  return out;
}
// وقت النهارده اللي عدّى (بتوقيت السعودية) — بيظهر «فات» ومايتحجزش
const isPastSlot = (ymd: string, t: string) => { const n = riyadhNow(); const today = `${n.getFullYear()}-${String(n.getMonth() + 1).padStart(2, '0')}-${String(n.getDate()).padStart(2, '0')}`; return ymd < today || (ymd === today && t <= `${String(n.getHours()).padStart(2, '0')}:${String(n.getMinutes()).padStart(2, '0')}`); };
const ACTIVE_APPT: AppointmentStatus[] = ['new', 'confirmed', 'on_way', 'arrived', 'in_progress', 'rescheduled'];

// ---------- تحميل الجداول من القاعدة ----------
type Key = 'center' | 'servicePrices' | 'branches' | 'employees' | 'patients' | 'catalog' | 'appointments' | 'sessions' | 'assessments' | 'plans' | 'packages' | 'invoices'
  | 'conditions' | 'payments' | 'notifications' | 'inventory' | 'activity' | 'discounts' | 'campaigns' | 'requests' | 'support' | 'permissions' | 'planServices';

const loaders: Record<Key, (d: Database) => Promise<void>> = {
  center: async (d) => {
    const [{ data }, b] = await Promise.all([supabase.from('center_info').select('*').limit(1).maybeSingle(), supabase.rpc('schedule_blocks')]);
    if (data) d.center = toCenter(data);
    if (!b.error && b.data) blocks = { holidays: b.data.holidays ?? [], requests: b.data.requests ?? [] };
  },
  servicePrices: async (d) => { d.servicePrices = (await fetchAll('service_prices', { col: 'created_at' })).map(map.servicePrice); },
  branches: async (d) => { d.branches = (await fetchAll('branches', { col: 'created_at' })).map(map.branch); },
  // غير المدير بيقرا ملفه هو بس من جدول الموظفين، والباقي أسماء بس من staff_directory (من غير جوال ولا بيانات تانية)
  employees: async (d) => {
    const full = (await fetchAll('employees', { col: 'created_at' })).map(map.employee);
    const { data: dir } = await supabase.rpc('staff_directory');
    const known = new Set(full.map((e) => e.id));
    const rest = ((dir ?? []) as any[]).filter((r) => !known.has(r.id)).map((r) => map.employee({ ...r, username: '', phone: '', created_at: null }));
    d.employees = [...full, ...rest];
  },
  // المتصلين (is_guest) مخفيين من «المرضى» — محفوظين لوحدهم عشان المواعيد والفواتير تعرض أسماءهم
  patients: async (d) => { const all = (await fetchAll('patients', { col: 'registered_at', asc: false })).map(map.patient); d.patients = all.filter((p) => !p.isGuest); guests = all.filter((p) => p.isGuest); },
  catalog: async (d) => {
    const [th, sv, ts, pp] = await Promise.all([fetchAll('therapists', { col: 'created_at' }), fetchAll('services', { col: 'id' }), fetchAll('therapist_services'), fetchAll('package_plans')]);
    const byTh = new Map<string, string[]>(); const bySv = new Map<string, string[]>();
    for (const r of ts) { (byTh.get(r.therapist_id) ?? byTh.set(r.therapist_id, []).get(r.therapist_id)!).push(r.service_id); (bySv.get(r.service_id) ?? bySv.set(r.service_id, []).get(r.service_id)!).push(r.therapist_id); }
    d.therapists = th.map((r) => map.therapist(r, byTh.get(r.id) ?? []));
    d.services = sv.map((r) => map.service(r, bySv.get(r.id) ?? []));
    d.packagePlans = pp.map(map.packagePlan);
  },
  conditions: async () => { applyConditionRows(await fetchAll('conditions') as ConditionRow[]); },
  appointments: async (d) => { d.appointments = (await fetchAll('appointments', { col: 'date' })).map(map.appointment); },
  sessions: async (d) => { d.sessions = (await fetchAll('treatment_sessions', { col: 'date' })).map(map.session); },
  assessments: async (d) => { d.assessments = (await fetchAll('initial_assessments', { col: 'date' })).map(map.assessment); },
  plans: async (d) => { d.plans = (await fetchAll('treatment_plans', { col: 'created_at' })).map(map.plan); },
  packages: async (d) => { d.packages = (await fetchAll('packages')).map(map.package); },
  invoices: async (d) => { d.invoices = (await fetchAll('invoices', { col: 'created_at', asc: false })).map(map.invoice); },
  payments: async (d) => { d.payments = (await fetchAll('payments', { col: 'date' })).map(map.payment); },
  notifications: async (d) => {
    const { data } = await supabase.from('notifications').select('*').eq('audience', 'staff').order('created_at', { ascending: false }).limit(500);
    d.notifications = (data ?? []).map(map.notification);
  },
  inventory: async (d) => {
    const [it, mv] = await Promise.all([fetchAll('inventory_items', { col: 'name' }), fetchAll('stock_movements', { col: 'date' })]);
    d.inventory = it.map(map.item); d.stockMovements = mv.map(map.movement);
  },
  activity: async (d) => {
    const { data } = await supabase.from('activity_log').select('*').order('at', { ascending: false }).limit(1000);
    d.activity = (data ?? []).map(map.activity);
  },
  discounts: async (d) => { d.discountCodes = (await fetchAll('discount_codes', { col: 'created_at', asc: false })).map(map.discount); },
  planServices: async (d) => { d.planServices = (await fetchAll('plan_services', { col: 'created_at' })).map(map.planService); },
  campaigns: async (d) => { d.campaigns = (await fetchAll('campaigns', { col: 'created_at', asc: false })).map(map.campaign); },
  requests: async (d) => { d.staffRequests = (await fetchAll('staff_requests', { col: 'created_at', asc: false })).map(map.request); },
  support: async (d) => {
    const [t, r] = await Promise.all([fetchAll('support_tickets', { col: 'created_at', asc: false }), fetchAll('support_replies', { col: 'created_at' })]);
    d.tickets = t.map(map.ticket); d.replies = r.map(map.reply);
  },
  permissions: async (d) => {
    const rows = await fetchAll('role_permissions');
    if (rows.length) d.permissions = toMatrix(rows);
  },
};

let hiddenKinds = new Set<string>();
const ALL_KEYS = Object.keys(loaders) as Key[];
const CRITICAL_KEYS: Key[] = ['center', 'permissions', 'catalog', 'employees', 'patients', 'appointments', 'invoices', 'plans', 'packages', 'payments'];

async function pull(keys: (Key | string)[]) {
  const d = load();
  if (!net.isOnline()) return; // بدون اتصال: الكاش المحلي هو المرجع، وما نمسحش حاجة
  // الـ loaders بتكتب على d بعد ما التحميل يخلص بس، فأي فشل (شبكة أو جدول غير مسموح لهذا الدور) مابيلمسش النسخة القديمة
  await Promise.all(keys.map((k) => loaders[k as Key](d).catch(() => { /* ماشي */ })));
  applyOverlay(d);
  commit();
}

const cleanMsg = (m: string) => stripFileNoPrefix(m.replace(/^.*?ERROR:\s*/, ''));

// استدعاء دالة على الخادم: ترجع Result، وبعد النجاح بتحدّث الجداول المتأثرة
// «الجلسة التانية في نفس اليوم محتاجة موافقة المدير» من أي شاشة → الواجهة بتعرض «إرسال طلب للمدير» (SecondSessionHost في Layout)
export interface SecondSessionAsk { source: 'plan' | 'package'; id: string; patientId: string; therapistId: string | null }
function offerSecondSession(fn: string, args: Record<string, unknown>, message: string) {
  if (!/موافقة المدير|طلب جلسة ثانية/.test(message) || fn === 'request_second_session' || fn === 'decide_second_session' || fn === 'attendance_check_in') return;
  const d = load();
  let ask: SecondSessionAsk | null = null;
  const fromAppt = (id: unknown) => {
    const a = d.appointments.find((x) => x.id === id);
    if (a?.planId) return { source: 'plan' as const, id: a.planId, patientId: a.patientId, therapistId: a.therapistId || null };
    if (a?.packageId) return { source: 'package' as const, id: a.packageId, patientId: a.patientId, therapistId: a.therapistId || null };
    return null;
  };
  if (fn === 'complete_next_plan_session') {
    const pl = d.plans.find((x) => x.id === args.p_plan);
    if (pl) ask = { source: 'plan', id: pl.id, patientId: pl.patientId, therapistId: pl.therapistId ?? null };
  } else if (fn === 'set_appointment_status' || fn === 'start_session') ask = fromAppt(args.p_id ?? args.p_appointment);
  else if (fn === 'complete_session') { const ss = d.sessions.find((x) => x.id === args.p_id); if (ss?.appointmentId) ask = fromAppt(ss.appointmentId); else if (ss?.planId) ask = { source: 'plan', id: ss.planId, patientId: ss.patientId, therapistId: ss.therapistId || null }; }
  if (ask) setTimeout(() => window.dispatchEvent(new CustomEvent('second-session-ask', { detail: ask })), 0);
}
// الجلسة التانية في نفس اليوم = طلب للمدير لكل الأدوار (حتى المدير): فحص مسبق من الكاش قبل ما الخادم يسمح للمدير بتخطّيها
const SESSION_STATES = ['arrived', 'in_progress', 'completed'];
function secondSessionPrecheck(fn: string, args: Record<string, unknown>): boolean {
  const d = load(); const today = todayYmd();
  let ask: SecondSessionAsk | null = null; let exclude: string | null = null;
  const fromAppt = (id: unknown) => {
    const a = d.appointments.find((x) => x.id === id);
    if (!a || a.date !== today || SESSION_STATES.includes(a.status)) return null; // اتحسبت قبل كده
    exclude = a.id;
    if (a.planId) return { source: 'plan' as const, id: a.planId, patientId: a.patientId, therapistId: a.therapistId || null };
    if (a.packageId) return { source: 'package' as const, id: a.packageId, patientId: a.patientId, therapistId: a.therapistId || null };
    return null;
  };
  if (fn === 'complete_next_plan_session') {
    const pl = d.plans.find((x) => x.id === args.p_plan);
    if (pl) ask = { source: 'plan', id: pl.id, patientId: pl.patientId, therapistId: pl.therapistId ?? null };
  } else if (fn === 'set_appointment_status' && SESSION_STATES.includes(String(args.p_status))) ask = fromAppt(args.p_id);
  else if (fn === 'start_session') ask = fromAppt(args.p_appointment);
  if (!ask) return false;
  const pid = ask.patientId;
  const n = d.appointments.filter((a) => a.patientId === pid && a.date === today && a.id !== exclude && SESSION_STATES.includes(a.status) && (a.planId || a.packageId)).length
    + d.sessions.filter((s) => s.patientId === pid && s.date === today && !s.appointmentId && (s.status === 'in_progress' || s.status === 'completed')).length;
  if (n < 1) return false;
  const detail = ask;
  setTimeout(() => window.dispatchEvent(new CustomEvent('second-session-ask', { detail })), 0);
  return true;
}
async function rpc<T = any>(fn: string, args: Record<string, unknown>, refresh: Key[]): Promise<Result<{ data: T }>> {
  if (secondSessionPrecheck(fn, args)) return { ok: false, error: 'الجلسة الثانية في اليوم نفسه تحتاج إلى موافقة المدير — أرسل طلب من النافذة.' };
  if (!net.isOnline()) return { ok: false, error: OFFLINE_MSG };
  const { data, error } = await supabase.rpc(fn, args);
  if (error && isNetworkError(error)) return { ok: false, error: OFFLINE_MSG };
  if (error) { offerSecondSession(fn, args, error.message); return { ok: false, error: cleanMsg(error.message) }; }
  await pull(refresh);
  return { ok: true, data: data as T };
}
// نفس الاستدعاء لكن بيرمي خطأ (للعمليات اللي ما بترجعش Result) — الواجهة بتعرض الرسالة تلقائيًا
async function rpcOrThrow<T = any>(fn: string, args: Record<string, unknown>, refresh: Key[]): Promise<T> {
  const r = await rpc<T>(fn, args, refresh);
  if (!r.ok) throw new DbError(r.error);
  return r.data;
}
const fail = (error: string): { ok: false; error: string } => ({ ok: false, error });


// نفس normalize_discount_code على الخادم (هجرة 056): أرقام عربية/فارسي، علامات مخفية، مسافات، شرطة طويلة
export const normalizeCode = (s: string) => s
  .replace(/[٠-٩]/g, (d) => String(d.charCodeAt(0) - 0x660)).replace(/[۰-۹]/g, (d) => String(d.charCodeAt(0) - 0x6f0))
  .replace(/[–—−‐‑_]/g, '-').replace(/[\s​-‏‪-‮⁦-⁩﻿]+/g, '').toUpperCase();

// الفواتير: الأحدث أولًا بوقت الإنشاء الفعلي (مش رقم الفاتورة ولا اليوم بس)؛ لو الوقت ناقص يرجع للتاريخ ثم الرقم
export const newestInvoiceFirst = (a: Invoice, b: Invoice) =>
  (b.createdAt ?? 0) - (a.createdAt ?? 0) || (a.date < b.date ? 1 : a.date > b.date ? -1 : 0) || b.no.localeCompare(a.no, 'en', { numeric: true });

const installOfflineHooks = () => offline.setHooks({ exportSnapshot: () => db.exportSnapshot(), refreshAfterSync: () => pull(CRITICAL_KEYS.concat(['sessions', 'assessments'])) });

export const db = {
  subscribe(l: () => void): () => void { listeners.add(l); return () => { listeners.delete(l); }; },
  isReady: () => ready,
  // يحمّل كل البيانات من قاعدة البيانات بعد تسجيل الدخول
  // الأساسي بس هو اللي بيعطّل الدخول؛ الجداول الثانوية بتتحمّل في الخلفية وبتظهر أول ما توصل
  async hydrate() {
    installOfflineHooks();
    await pull(CRITICAL_KEYS);
    ready = true; commit(); db.startRealtime();
    void pull(ALL_KEYS.filter((k) => !CRITICAL_KEYS.includes(k))).then(() => offline.saveSnapshotNow());
  },
  // لقطة للتخزين المحلي (offline/session.ts) — بتتاخد من الكاش بعد ما الخادم طبّق صلاحيات الموظف (RLS)، فيها بس اللي يحق له يشوفه.
  // العمليات المعلّقة بتتحفظ في الطابور (مش جوّا اللقطة) وبتتعاد فوقها وقت الفتح.
  exportSnapshot(): Record<string, unknown> {
    const d = load();
    // اللي اتعمل أوفلاين ولسه ما اتبعتش (إنشاء) بيتشال من اللقطة — بيتعاد من الطابور. اللي موجود على الخادم وعليه تعديل معلّق بيفضل (بنسخته الحالية، والتعديل بيتعاد فوقه).
    const creating = new Set(offline.queue.list().filter((o) => o.kind.endsWith('.create')).map((o) => o.entityId));
    const strip = <T extends { id: string }>(xs: T[]) => xs.filter((x) => !creating.has(x.id));
    return {
      center: d.center, blocks, permissions: d.permissions, employees: d.employees, patients: strip(d.patients), guests,
      therapists: d.therapists, services: d.services, packagePlans: d.packagePlans, servicePrices: d.servicePrices, branches: d.branches,
      appointments: strip(d.appointments), sessions: d.sessions, assessments: d.assessments, plans: d.plans, packages: d.packages, planServices: d.planServices,
    };
  },
  /** فتح التطبيق بدون إنترنت من لقطة محفوظة (بعد ما offline/session.ts تحقق من المستخدم والمدة) */
  hydrateFromSnapshot(s: Record<string, any>) {
    const d = emptyDb();
    for (const k of ['center', 'permissions', 'employees', 'patients', 'therapists', 'services', 'packagePlans', 'servicePrices', 'branches', 'appointments', 'sessions', 'assessments', 'plans', 'packages', 'planServices'] as const) {
      if (s[k] !== undefined && s[k] !== null) (d as any)[k] = s[k];
    }
    installOfflineHooks();
    cache = d; guests = Array.isArray(s.guests) ? s.guests : [];
    if (s.blocks) blocks = s.blocks;
    applyOverlay(d);
    ready = true; commit();
  },
  clear() { db.stopRealtime(); cache = emptyDb(); ready = false; actorId = null; guests = []; commit(); },
  raw: () => load(),
  async refresh(...keys: Key[]) { await pull(keys.length ? keys : ALL_KEYS); },
  setActor(id: string | null) { actorId = id; },

  // ---------- center / settings ----------
  center: () => load().center,
  branches: () => load().branches,
  async updateCenter(patch: Partial<CenterInfo>): Promise<Result> {
    if (patch.workStart && patch.workEnd && patch.workStart >= patch.workEnd) return fail('وقت بداية الدوام لازم يكون قبل نهايته.');
    const row: Record<string, unknown> = {};
    const m: Record<string, string> = { email: 'email', street: 'street', logoUrl: 'logo_url', currency: 'currency', defaultAppointmentMin: 'default_appointment_min', cancelBeforeHours: 'cancel_before_hours', name: 'name', branchName: 'branch_name', city: 'city', district: 'district', phone: 'phone', workStart: 'work_start', workEnd: 'work_end', slotStepMin: 'slot_step_min', packageLowThreshold: 'package_low_threshold', reminderHoursBefore: 'reminder_hours_before', taxRate: 'tax_rate', foreignTaxRate: 'foreign_tax_rate', vatNumber: 'vat_number', crNumber: 'cr_number', buildingNo: 'building_no', postalCode: 'postal_code', workHours: 'work_hours' };
    for (const [k, col] of Object.entries(m)) if (k in patch) row[col] = (patch as any)[k];
    const { error } = await supabase.from('center_info').update(row).eq('id', 1);
    if (error) return fail(cleanMsg(error.message));
    await pull(['center']);
    return { ok: true };
  },
  async updateWeekSchedule(schedule: DaySchedule[]): Promise<Result> {
    const r = await rpc('update_week_schedule', { p_schedule: schedule }, ['center']);
    return r.ok ? { ok: true } : r;
  },
  // ---------- permissions ----------
  permissions: (): PermissionMatrix => {
    const m = load().permissions;
    const FALLBACK: [PermArea, PermArea][] = [['pkg_checkin', 'appointments'], ['bodymap', 'plans'], ['marketing', 'reports'], ['pt_f_gender', 'patients'], ['pt_f_source', 'patients'], ['pt_f_doctor', 'patients'], ['pt_f_status', 'patients'], ['pt_f_sort', 'patients']];
    const out = { ...m } as PermissionMatrix;
    for (const role of Object.keys(out) as (keyof PermissionMatrix)[]) {
      const row = { ...out[role] };
      for (const [a, parent] of FALLBACK) if (row[a] === undefined && row[parent]) row[a] = a === 'pkg_checkin' ? [...row[parent]!] : row[parent]!.filter((o) => o === 'view');
      out[role] = row;
    }
    return out;
  },
  async updatePermissions(matrix: PermissionMatrix) {
    await rpcOrThrow('save_permissions', { p_matrix: matrix }, ['permissions']);
  },
  // صلاحيات إضافية لموظف (واتساب / استبدال نقاط الولاء) — هجرة 118
  async updatePlanSessions(planId: string, total: number): Promise<Result> {
    return rpc('update_plan_sessions', { p_plan: planId, p_total: total }, ['plans', 'invoices', 'activity']);
  },
  // صلاحيات موظف محدد (null = يرجع لصلاحيات دوره)
  async setEmployeePermissions(employeeId: string, matrix: Partial<Record<string, string[]>> | null): Promise<Result> {
    return rpc('set_employee_permissions', { p_employee: employeeId, p_matrix: matrix }, ['employees', 'activity']);
  },
  async setEmployeeExtraPerms(employeeId: string, whatsapp: boolean, loyalty: boolean) {
    return rpc('set_employee_extra_perms', { p_employee: employeeId, p_whatsapp: whatsapp, p_loyalty: loyalty }, ['employees']);
  },
  async resetPermissions() { await rpcOrThrow('save_permissions', { p_matrix: defaultPermissions() }, ['permissions']); },

  // ---------- activity ----------
  activityForPatient: (patientId: string) => load().activity.filter((a) => a.patientId === patientId),
  activity: () => load().activity,

  // ---------- employees / auth ----------
  employees: () => load().employees,
  employeeById: (id: string) => load().employees.find((e) => e.id === id),
  setEmployees(list: Employee[]) { load().employees = list; commit(); },
  async updateEmployee(id: string, patch: Partial<Employee>) {
    const { api } = await import('../lib/api');
    try { await api.patch('staff', id, patch); } catch (e) { throw new DbError((e as Error).message); }
    await pull(['employees']);
  },

  // ---------- الحضور والانصراف ----------
  async clockIn(): Promise<Result<{ id: string; date: string; checkIn: string; checkOut: string | null }>> {
    const { data, error } = await supabase.rpc('clock_in');
    if (error) return fail(cleanMsg(error.message));
    return { ok: true, ...(data as any) };
  },
  async clockOut(): Promise<Result<{ id: string; date: string; checkIn: string; checkOut: string | null }>> {
    const { data, error } = await supabase.rpc('clock_out');
    if (error) return fail(cleanMsg(error.message));
    return { ok: true, ...(data as any) };
  },
  async myAttendanceToday(): Promise<{ id: string; date: string; checkIn: string | null; checkOut: string | null } | null> {
    const { data, error } = await supabase.rpc('my_attendance_today');
    if (error) throw new DbError(cleanMsg(error.message));
    return data as any;
  },
  async attendanceReport(from: string, to: string): Promise<Result<{ rows: AttendanceRow[] }>> {
    const { data, error } = await supabase.rpc('attendance_report', { p_from: from, p_to: to });
    if (error) return fail(cleanMsg(error.message));
    const rows: AttendanceRow[] = (data as any[]).map((r) => ({
      employeeId: r.employee_id, employeeName: r.employee_name, role: r.role, date: r.date,
      checkIn: r.check_in, checkOut: r.check_out, status: r.status,
    }));
    return { ok: true, rows };
  },

  // ---------- نقاط الولاء ----------
  async patientLoyaltySummary(patientId: string): Promise<LoyaltySummary> {
    const { data, error } = await supabase.rpc('patient_loyalty_summary', { p_patient: patientId });
    if (error) throw new DbError(cleanMsg(error.message));
    return { balance: data.balance, totalEarned: data.totalEarned, totalRedeemed: data.totalRedeemed, redemptionsCount: data.redemptionsCount, availableRewards: data.availableRewards, redeemCost: data.redeemCost };
  },
  async loyaltyLedger(patientId?: string): Promise<Result<{ rows: LoyaltyLedgerRow[] }>> {
    const { data, error } = await supabase.rpc('loyalty_ledger_list', { p_patient: patientId ?? null });
    if (error) return fail(cleanMsg(error.message));
    const rows: LoyaltyLedgerRow[] = (data as any[]).map((r) => ({
      id: r.id, patientId: r.patient_id, patientName: r.patient_name, kind: r.kind, points: r.points, reason: r.reason,
      balanceAfter: r.balance_after, employeeName: r.employee_name, discountCode: r.discount_code, createdAt: r.created_at,
    }));
    return { ok: true, rows };
  },
  async loyaltyCodes(): Promise<Result<{ rows: LoyaltyCodeRow[] }>> {
    const { data, error } = await supabase.rpc('loyalty_codes_list');
    if (error) return fail(cleanMsg(error.message));
    const rows: LoyaltyCodeRow[] = (data as any[]).map((r) => ({
      id: r.id, code: r.code, patientId: r.patient_id, patientName: r.patient_name, reward: Number(r.reward),
      createdAt: r.created_at, status: r.status, usedAt: r.used_at, usedByName: r.used_by_name,
      pointsUsed: r.points_used, cancelReason: r.cancel_reason,
      beneficiaryName: r.beneficiary_name, beneficiaryPhone: r.beneficiary_phone, beneficiaryRelation: r.beneficiary_relation,
    }));
    return { ok: true, rows };
  },
  async redeemLoyaltyPoints(patientId: string, beneficiary?: { name: string; phone: string; relation?: string }, sessions: 1 | 2 = 1): Promise<Result<{ code: string; remaining: number }>> {
    const idempotencyKey = crypto.randomUUID();
    const { data, error } = await supabase.rpc('redeem_loyalty_points', {
      p_patient: patientId, p_sessions: sessions, p_beneficiary_name: beneficiary?.name ?? null, p_beneficiary_phone: beneficiary?.phone ?? null,
      p_beneficiary_relation: beneficiary?.relation ?? null, p_idempotency_key: idempotencyKey,
    });
    if (error) return fail(cleanMsg(error.message));
    return { ok: true, code: data.code, remaining: data.remaining };
  },
  async cancelDiscountCode(id: string, reason: string): Promise<Result> {
    const r = await rpc('cancel_discount_code', { p_id: id, p_reason: reason }, ['discounts', 'activity']);
    return r.ok ? { ok: true } : r;
  },
  async updateLoyaltySettings(sessionPoints: number, packagePoints: number, redeemCost: number): Promise<Result> {
    const r = await rpc('update_loyalty_settings', { p_session_points: sessionPoints, p_package_points: packagePoints, p_redeem_cost: redeemCost }, ['center', 'activity']);
    return r.ok ? { ok: true } : r;
  },

  // ---------- staff requests (إجازة / استئذان) ----------
  staffRequests: () => load().staffRequests,
  pendingRequestsCount: () => load().staffRequests.filter((x) => x.status === 'pending').length,
  activeLeave(employeeId: string): StaffRequest | undefined {
    const d = today(); const t = nowHm();
    return load().staffRequests.find((x) => x.employeeId === employeeId && x.status === 'approved' && d >= x.fromDate && d <= x.toDate
      && (x.type === 'leave' || (x.type === 'permission' && t >= x.fromTime && t < x.toTime)));
  },
  // approveNow: المدير (صلاحية requests:edit) بيعمل الإجازة/الاستئذان معتمدة على طول بدل ما تستنى موافقة
  async createStaffRequest(input: { employeeId: string; type: StaffRequestType; reason: string; fromDate: string; toDate: string; fromTime: string; toTime: string }, approveNow = false): Promise<Result> {
    const r = await rpc<{ id: string }>('create_staff_request', { p: input }, approveNow ? [] : ['requests', 'notifications', 'activity']);
    if (!r.ok) return r;
    if (!approveNow) return { ok: true };
    const d = await rpc('decide_staff_request', { p_id: r.data.id, p: { approve: true } }, ['requests', 'notifications', 'activity']);
    return d.ok ? { ok: true } : fail(`سُجّل الطلب لكنه لم يُعتمد: ${d.error} — اعتمده من صفحة «طلبات الموظفين».`);
  },
  async decideStaffRequest(id: string, decision: { approve: boolean; fromDate?: string; toDate?: string; fromTime?: string; toTime?: string; note?: string }): Promise<Result> {
    const r = await rpc('decide_staff_request', { p_id: id, p: decision }, ['requests', 'activity']);
    return r.ok ? { ok: true } : r;
  },
  // إنهاء إجازة/استئذان معتمد وشغّال دلوقتي، عشان الموظف يرجع يشتغل فورًا قبل تاريخ النهاية الأصلي
  async endStaffLeave(id: string): Promise<Result> {
    const r = await rpc('end_staff_leave', { p_id: id }, ['requests', 'activity']);
    return r.ok ? { ok: true } : r;
  },

  // ---------- patients ----------
  patients: () => load().patients,
  patient: (id: string) => load().patients.find((p) => p.id === id) ?? guests.find((p) => p.id === id),
  // بحث بالجوال في كل السجلات (الحقيقيين + المتصلين) — لمنع التكرار في حجز المكالمة
  findByPhone: (phone: string) => load().patients.find((p) => phoneMatches(p.phone, phone)) ?? guests.find((p) => phoneMatches(p.phone, phone)),
  patientIdsForTherapist(therapistId: string): Set<string> {
    const data = load();
    return new Set([
      ...data.appointments.filter((a) => a.therapistId === therapistId).map((a) => a.patientId),
      ...data.sessions.filter((s) => s.therapistId === therapistId).map((s) => s.patientId),
    ]);
  },
  searchPatients(q: string): Patient[] {
    const s = q.trim().toLowerCase();
    if (!s) return load().patients;
    return load().patients.filter((p) => patientMatches(p, s)).sort((x, y) => patientRank(x, s) - patientRank(y, s));
  },
  async createPatient(input: Omit<Patient, 'id' | 'fileNo' | 'registeredAt' | 'active'>): Promise<Patient> {
    // لو فيه متصل بنفس الجوال (حجز مكالمة) نحوّله لمريض حقيقي بدل ما نكرر السجل
    const g = guests.find((x) => phoneMatches(x.phone, input.phone));
    if (g && !net.isOnline()) throw new DbError(OFFLINE_MSG); // تحويل متصل لمريض حقيقي يحتاج الخادم
    if (g) {
      const { data: up, error: ue } = await supabase.from('patients').update({ ...map.patientRow(input as Partial<Patient>), is_guest: false }).eq('id', g.id).select().single();
      if (ue) throw new DbError(cleanMsg(ue.message));
      guests = guests.filter((x) => x.id !== g.id);
      const pr = map.patient(up);
      load().patients.push(pr);
      commit();
      pull(['notifications', 'activity']);
      return pr;
    }
    // الـ id بيتولّد هنا ويتبعت مع الـ insert: لو الاتصال قطع بعد ما الخادم حفظ، إعادة الإرسال من الطابور ما بتكرّرش المريض
    const id = uuid();
    if (net.isOnline()) {
      const { data, error } = await supabase.from('patients').insert({ ...map.patientRow(input as Partial<Patient>), id, file_no: '' }).select().single();
      if (!error) {
        const p = map.patient(data);
        load().patients.push(p);
        commit();
        pull(['notifications', 'activity']);
        return p;
      }
      if (!isNetworkError(error)) throw new DbError(cleanMsg(error.message));
    }
    return queuePatientCreate(id, input); // بدون اتصال: يتحفظ محليًا ويتزامن لما الاتصال يرجع
  },
  async updatePatient(id: string, patch: Partial<Patient>) {
    // لو للمريض عمليات معلّقة نعدّل عن طريق الطابور عشان الترتيب يفضل سليم
    const pendingCreate = offline.queue.list().find((o) => o.kind === 'patient.create' && o.entityId === id);
    if (net.isOnline() && !offline.queue.hasPendingFor(id)) {
      const { data, error } = await supabase.from('patients').update(map.patientRow(patch)).eq('id', id).select().single();
      if (!error) {
        const i = load().patients.findIndex((x) => x.id === id);
        if (i >= 0) load().patients[i] = map.patient(data);
        commit();
        pull(['activity']);
        return;
      }
      if (!isNetworkError(error)) throw new DbError(cleanMsg(error.message));
    }
    const cur = load().patients.find((x) => x.id === id);
    if (!cur) throw new DbError('المريض غير موجود');
    const row = map.patientRow(patch);
    try {
      if (pendingCreate) {
        await offline.queue.editPayload(pendingCreate.id, { row: { ...(pendingCreate.payload.row as object), ...row }, local: { ...(pendingCreate.payload.local as object), ...patch } });
      } else {
        const base = map.patientRow(Object.fromEntries(Object.keys(patch).map((k) => [k, (cur as any)[k]])) as Partial<Patient>);
        await offline.queue.enqueue({ kind: 'patient.update', userId: offline.userId!, entityId: id, label: `تعديل بيانات المريض ${cur.fullName}`, payload: { row, local: patch }, base });
      }
    } catch (e) { saveLocalFail(e); }
    Object.assign(cur, patch, { pendingSync: true });
    commit();
  },
  async deletePatient(id: string): Promise<Result> {
    const r = await rpc('delete_patient', { p_id: id }, ['patients', 'appointments', 'sessions', 'assessments', 'plans', 'packages', 'invoices', 'activity']);
    return r.ok ? { ok: true } : r;
  },

  // ---------- therapists ----------
  therapists: () => load().therapists.filter((t) => t.active),
  allTherapists: () => load().therapists,
  therapist: (id: string) => load().therapists.find((t) => t.id === id),
  async createTherapist(input: Omit<Therapist, 'id' | 'active'>, account?: { password: string; role?: string }): Promise<Result<{ therapist: Therapist }>> {
    const r = await rpc<{ id: string }>('save_therapist', { p: input }, ['catalog', 'activity']);
    if (!r.ok) return r;
    const t = load().therapists.find((x) => x.id === r.data.id)!;
    if (account) {
      const { api } = await import('../lib/api');
      try {
        await api.post('staff', { name: t.name, password: account.password, role: account.role || 'therapist', phone: t.phone, therapistId: t.id });
        await pull(['employees']);
      } catch (e) { return fail('تم إنشاء المعالج لكن تعذّر إنشاء حساب الدخول: ' + (e as Error).message); }
    }
    return { ok: true, therapist: t };
  },
  async updateTherapist(id: string, patch: Partial<Omit<Therapist, 'id'>>) {
    const cur = load().therapists.find((x) => x.id === id);
    if (!cur) return;
    await rpcOrThrow('save_therapist', { p: { ...cur, ...patch, id } }, ['catalog', 'activity']);
  },
  async deleteTherapist(id: string): Promise<Result> {
    const r = await rpc('delete_therapist', { p_id: id }, ['catalog', 'activity']);
    return r.ok ? { ok: true } : r;
  },

  // ---------- services ----------
  services: () => load().services.filter((s) => s.active && !s.deleted),
  allServices: () => load().services.filter((s) => !s.deleted),
  service: (id: string) => load().services.find((s) => s.id === id),
  // كل معالج بيقدّم كل الخدمات (هجرة 037)
  // الأطباء اللي بيقدّموا الخدمة (الربط الفعلي therapist_services — الخادم بيفرضه كمان وقت الحجز)
  therapistsForService(serviceId: string) { return load().therapists.filter((t) => t.active && t.serviceIds.includes(serviceId)); },
  async saveService(input: Omit<Service, 'id'> & { id?: string }): Promise<Result> {
    const r = await rpc('save_service', { p: input }, ['catalog', 'activity']);
    return r.ok ? { ok: true } : r;
  },
  // تخصيص خدمة لأطباء معيّنين (كل الأطباء = كل المعالجين)
  async setServiceDoctors(serviceId: string, therapistIds: string[]): Promise<Result> {
    const r = await rpc('set_service_doctors', { p_service: serviceId, p_therapists: therapistIds }, ['catalog', 'activity']);
    return r.ok ? { ok: true } : r;
  },
  async deleteService(id: string): Promise<Result> {
    const r = await rpc('delete_service', { p_id: id }, ['catalog', 'activity']);
    return r.ok ? { ok: true } : r;
  },

  // ---------- rooms (اتشالت من النظام — يفضل الاسم للتوافق مع الواجهات) ----------
  rooms: () => [],

  // ---------- availability ----------
  // أوقات المركز نفسها (من غير أي علاقة بالمعالجين) — من الفتح لحد وقت الإغلاق، وأوقات النهارده اللي فاتت مش بتظهر
  centerSlots(date: string): string[] {
    const cd = daySchedule(date);
    if (!cd || !cd.open) return [];
    const step = load().center.slotStepMin || 30;
    const now = riyadhNow(); const nowHm = `${String(now.getHours()).padStart(2, '0')}:${String(now.getMinutes()).padStart(2, '0')}`;
    const isToday = date === `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`;
    const out: string[] = [];
    for (let cur = cd.from; cur <= cd.to; cur = addMinutes(cur, step)) if (!isToday || cur > nowHm) out.push(cur);
    return out;
  },
  // حالة يوم الدكتور (يشتغل/إجازة/مش من أيام عمله/...) — نفس منطق الخادم
  doctorDay: (therapistId: string, date: string) => doctorDayWindow(therapistId, date),
  // هل الوقت ده جوّه دوام الدكتور (من غير ما نبص على المحجوز)؛ بيرجّع سبب الرفض لو لأ
  doctorTimeIssue(therapistId: string, date: string, time: string, durationMin: number): string | null {
    const w = doctorDayWindow(therapistId, date);
    if (w.status !== 'ok') return DOCTOR_DAY_LABEL[w.status];
    const why = windowReason(w, hmMin(time), durationMin);
    if (why === 'center') return `الوقت خارج ساعات عمل المركز (${w.centerFrom} - ${w.centerTo})`;
    if (why === 'doctor') return `الوقت خارج مواعيد عمل الدكتور (${w.doctorFrom} - ${w.doctorTo})`;
    if (why === 'blocked') return 'الدكتور غير متاح في هالوقت (استراحة أو استئذان)';
    return null;
  },
  // الأوقات المتاحة للحجز: جوّه دوام الدكتور − المحجوز له هو بس − اللي فات (نفس check_slot / doctor_day_slots)
  availableSlots(therapistId: string, date: string, durationMin: number, excludeAppointmentId?: string): string[] {
    const busy = load().appointments.filter((a) => a.therapistId === therapistId && a.date === date && a.status !== 'cancelled' && a.id !== excludeAppointmentId);
    return doctorStarts(therapistId, date, durationMin).filter((cur) => !busy.some((a) => overlaps(cur, durationMin, a.time, a.durationMin)) && !isPastSlot(date, cur));
  },
  // الأوقات المحجوزة فعلًا جوّه دوام الدكتور — بتتعرض باهتة وعليها ✕ (الموعد الملغي مش بيحجز الوقت)
  takenSlots(therapistId: string, date: string, durationMin: number, excludeAppointmentId?: string): string[] {
    const busy = load().appointments.filter((a) => a.therapistId === therapistId && a.date === date && a.status !== 'cancelled' && a.id !== excludeAppointmentId);
    return doctorStarts(therapistId, date, durationMin).filter((cur) => busy.some((a) => overlaps(cur, durationMin, a.time, a.durationMin)));
  },
  // الأوقات اللي عدّت في اليوم (داخل ساعات المركز) — بتتعرض «فات» ومعطّلة
  pastSlots(date: string): string[] {
    const cd = daySchedule(date);
    if (!cd || !cd.open) return [];
    const step = load().center.slotStepMin || 30;
    const out: string[] = [];
    for (let cur = cd.from; cur <= cd.to; cur = addMinutes(cur, step)) if (isPastSlot(date, cur)) out.push(cur);
    return out;
  },
  availableRoom: () => undefined,

  // ---------- appointments ----------
  appointments: () => load().appointments,
  appointment: (id: string) => load().appointments.find((a) => a.id === id),
  appointmentsForPatient(patientId: string) {
    return load().appointments.filter((a) => a.patientId === patientId).sort((a, b) => (a.date + a.time < b.date + b.time ? 1 : -1));
  },
  appointmentsForDate(date: string) { return load().appointments.filter((a) => a.date === date).sort((a, b) => (a.time < b.time ? -1 : 1)); },
  appointmentsInRange(from: string, to: string) { return load().appointments.filter((a) => a.date >= from && a.date <= to); },
  todayAppointments() { return this.appointmentsForDate(today()); },

  async createAppointment(input: {
    patientId?: string; guest?: { fullName: string; phone: string; nationality?: 'saudi' | 'non_saudi' }; type: AppointmentType; serviceId: string; therapistId: string; date: string; time: string;
    location?: VisitLocation; address?: string; packageId?: string | null; planId?: string | null; seriesId?: string | null; branchId?: string | null;
    notes?: string; priceId?: string | null; durationMin?: number;
  }): Promise<Result<{ appointment: Appointment }>> {
    // بدون اتصال (أو لمريض لسه ما اتزامنش): يتسجّل في الطابور ويتحقق منه الخادم وقت المزامنة (التعارض بيتعرض صراحةً)
    if (!net.isOnline() || withDependency(input.patientId)) return queueAppointmentCreate(input);
    const r = await rpc<{ id: string }>('book_appointment', { p: input }, input.guest ? ['patients', 'appointments', 'invoices', 'notifications', 'activity'] : ['appointments', 'invoices', 'notifications', 'activity']);
    if (!r.ok && r.error === OFFLINE_MSG) return queueAppointmentCreate(input); // الاتصال قطع وإحنا بنرسل
    if (!r.ok) return r;
    return { ok: true, appointment: load().appointments.find((a) => a.id === r.data.id)! };
  },
  // حجز جلسة على خطة علاجية (إنشاء الخطة + مراجعة فاتورتها): الخادم بيقفل الخطة ويمنع الزيادة عن عدد جلساتها
  // وجلستين في نفس اليوم (هجرة 165)، وبعدها نفس book_appointment. لو الهجرة لسه ماتطبّقتش → book_appointment مباشرة.
  async bookPlanSession(input: { planId: string; therapistId: string; date: string; time: string }): Promise<Result> {
    const r = await rpc('book_plan_session', { p: input }, ['appointments', 'invoices', 'notifications', 'activity']);
    if (r.ok) return { ok: true };
    if (!/book_plan_session|schema cache|Could not find/i.test(r.error)) return r;
    const plan = load().plans.find((x) => x.id === input.planId);
    if (!plan) return fail('الخطة العلاجية غير موجودة');
    const res = await this.createAppointment({ patientId: plan.patientId, type: 'session', serviceId: plan.serviceId, ...input });
    return res.ok ? { ok: true } : res;
  },
  // therapistId: تعيين الطبيب مع تغيير الحالة (حجز المريض من الموبايل بييجي من غير طبيب)
  async setAppointmentStatus(id: string, status: AppointmentStatus, reason?: string, therapistId?: string) {
    // الإلغاء بس هو اللي مدعوم بدون اتصال؛ باقي الحالات (تأكيد/حضور/إنهاء) بتأثر على الفواتير والجلسات فتحتاج الخادم
    if (status === 'cancelled' && (!net.isOnline() || offline.queue.hasPendingFor(id))) return queueCancel(id, reason);
    await rpcOrThrow('set_appointment_status', { p_id: id, p_status: status, p_reason: reason ?? null, p_therapist: therapistId || null }, ['appointments', 'invoices', 'notifications', 'activity']);
  },
  async rescheduleAppointment(id: string, date: string, time: string, therapistId?: string, address?: string): Promise<Result> {
    if (!net.isOnline() || offline.queue.hasPendingFor(id)) return queueReschedule(id, date, time, therapistId, address);
    const r = await rpc('reschedule_appointment', { p_id: id, p_date: date, p_time: time, p_therapist: therapistId ?? null, p_address: address ?? null }, ['appointments', 'invoices', 'notifications', 'activity']);
    return r.ok ? { ok: true } : r;
  },
  // تعديل تفاصيل الموعد (الخدمة/نوع الزيارة/العنوان/الملاحظات) — منفصل عن إعادة الجدولة (تاريخ/وقت/معالج)
  async updateAppointmentDetails(id: string, input: { serviceId?: string; therapistId?: string; type?: string; location?: string; address?: string; notes?: string; date?: string; time?: string; price?: number }): Promise<Result> {
    const r = await rpc('update_appointment_details', { p_id: id, p: input }, ['appointments', 'invoices', 'activity']);
    return r.ok ? { ok: true } : r;
  },
  async deleteAppointment(id: string): Promise<Result> {
    const r = await rpc('delete_appointment', { p_id: id }, ['appointments', 'invoices', 'activity']);
    return r.ok ? { ok: true } : r;
  },

  // ---------- sessions ----------
  sessionsForPatient(patientId: string) { return load().sessions.filter((s) => s.patientId === patientId).sort((a, b) => b.sessionNo - a.sessionNo); },
  sessionByAppointment(appointmentId: string) { return load().sessions.find((s) => s.appointmentId === appointmentId); },
  session: (id: string) => load().sessions.find((s) => s.id === id),
  completedSessionCounts() {
    const counts: Record<string, number> = {};
    for (const s of load().sessions) if (s.status === 'completed') counts[s.patientId] = (counts[s.patientId] ?? 0) + 1;
    return counts;
  },
  async startSession(appointmentId: string): Promise<TreatmentSession> {
    const r = await rpcOrThrow<{ id: string }>('start_session', { p_appointment: appointmentId }, ['sessions', 'appointments', 'activity']);
    return load().sessions.find((s) => s.id === r.id)!;
  },
  async updateSession(id: string, patch: Partial<TreatmentSession>) {
    await rpcOrThrow('update_session', { p_id: id, p: patch }, ['sessions', 'activity']);
  },
  async completeSession(id: string, patch: Partial<TreatmentSession>) {
    await rpcOrThrow('complete_session', { p_id: id, p: patch }, ['sessions', 'appointments', 'packages', 'plans', 'notifications', 'activity']);
  },
  async completeNextPlanSession(planId: string): Promise<Result<{ index: number; total: number }>> {
    const r = await rpc<{ index: number; total: number }>('complete_next_plan_session', { p_plan: planId }, ['sessions', 'appointments', 'packages', 'plans', 'notifications', 'activity']);
    return r.ok ? { ok: true, index: r.data.index, total: r.data.total } : r;
  },
  async deleteSession(id: string) {
    await rpcOrThrow('delete_session', { p_id: id }, ['sessions', 'appointments', 'packages', 'plans', 'activity']);
  },

  // ---------- assessments ----------
  assessmentsForPatient(patientId: string) { return load().assessments.filter((a) => a.patientId === patientId).sort((a, b) => b.date - a.date); },
  async saveAssessment(input: Omit<InitialAssessment, 'id' | 'date'> & { id?: string }) {
    const row = map.assessmentRow(input);
    const id = input.id ?? uuid(); // الـ id بيتولّد هنا: إعادة الإرسال من الطابور ما بتكرّرش التقييم
    const viaQueue = !net.isOnline() || !!(input.id && offline.queue.hasPendingFor(input.id)) || !!withDependency(input.patientId);
    if (!viaQueue) {
      const { error } = input.id ? await supabase.from('initial_assessments').update(row).eq('id', input.id) : await supabase.from('initial_assessments').insert({ ...row, id, therapist_id: null });
      if (!error) {
        await supabase.from('patients').update({ main_complaint: input.mainComplaint, diagnosis: input.medicalDiagnosis }).eq('id', input.patientId);
        await pull(['assessments', 'patients', 'activity']);
        return;
      }
      if (!isNetworkError(error)) throw new DbError(cleanMsg(error.message));
    }
    // بدون اتصال: التقييم/التشخيص يتحفظ محليًا ويتزامن بعدين (بيحافظ على ربطه بالمريض)
    const existing = load().assessments.find((a) => a.id === id);
    const local = { ...(existing ?? {}), ...input, id, date: existing?.date ?? Date.now() } as InitialAssessment;
    const prior = offline.queue.list().find((o) => o.kind === 'assessment.save' && o.entityId === id);
    try {
      if (prior) await offline.queue.editPayload(prior.id, { row: { ...(prior.payload.row as object), ...row }, local });
      else {
        const base = existing ? Object.fromEntries(Object.keys(row).map((k) => [k, (map.assessmentRow(existing) as any)[k]])) : undefined;
        await offline.queue.enqueue({ kind: 'assessment.save', userId: offline.userId!, entityId: id, dependsOn: withDependency(input.patientId), label: `تقييم/تشخيص ${db.patient(input.patientId)?.fullName ?? ''}`, payload: { row, isNew: !existing, local }, base });
      }
    } catch (e) { saveLocalFail(e); }
    const list = load().assessments; const i = list.findIndex((a) => a.id === id);
    if (i >= 0) list[i] = local; else list.push(local);
    commit();
  },
  async deleteAssessment(id: string) {
    const { error } = await supabase.from('initial_assessments').delete().eq('id', id);
    if (error) throw new DbError(cleanMsg(error.message));
    await pull(['assessments', 'activity']);
  },

  // ---------- treatment plans ----------
  plansForPatient(patientId: string) { return load().plans.filter((p) => p.patientId === patientId); },
  plan: (id: string) => load().plans.find((p) => p.id === id),
  activePlan(patientId: string) { return load().plans.find((p) => p.patientId === patientId && p.status === 'active'); },
  planStats(planId: string) {
    const data = load();
    const plan = data.plans.find((p) => p.id === planId);
    const total = plan?.totalSessions ?? 0;
    const sessions = data.sessions.filter((s) => s.planId === planId).sort((a, b) => a.sessionNo - b.sessionNo);
    const completed = sessions.filter((s) => s.status === 'completed').length;
    const upcoming = data.appointments.filter((a) => a.planId === planId && a.date >= todayYmd() && ['new', 'confirmed', 'on_way', 'rescheduled'].includes(a.status))
      .sort((a, b) => (a.date + a.time < b.date + b.time ? -1 : 1));
    return { total, completed, remaining: Math.max(0, total - completed), scheduled: upcoming.length, sessions, upcoming, pct: total ? Math.min(100, Math.round((completed / total) * 100)) : 0 };
  },
  // موعد كل جلسة محسوب من تاريخ أول جلسة: جلسات الأسبوع موزّعة بالتساوي (جلستين = كل 3-4 أيام)،
  // واليوم المقفول في «مواعيد العمل» بيتأجّل لأول يوم مفتوح بعده
  planSessionDates(startDate: string, sessionsPerWeek: number, total: number): string[] {
    const week = load().center.weekSchedule;
    const configured = week.some((d) => d.open);
    const isOpen = (ymd: string) => !configured || !!daySchedule(ymd)?.open;
    const out: string[] = [];
    const per = Math.max(1, sessionsPerWeek);
    for (let i = 0; i < total; i++) {
      let d = addDaysYmd(startDate, Math.floor(i / per) * 7 + Math.floor(((i % per) * 7) / per));
      if (out.length && d <= out[out.length - 1]) d = addDaysYmd(out[out.length - 1], 1);
      for (let guard = 0; guard < 7 && !isOpen(d); guard++) d = addDaysYmd(d, 1);
      out.push(d);
    }
    return out;
  },
  planSessionIndex(sessionId: string): { index: number; total: number } | null {
    const s = load().sessions.find((x) => x.id === sessionId);
    if (!s?.planId) return null;
    const st = this.planStats(s.planId);
    return { index: st.sessions.findIndex((x) => x.id === sessionId) + 1, total: st.total };
  },
  async savePlan(input: Omit<TreatmentPlan, 'id' | 'progressPct' | 'endDate'> & { id?: string }) {
    // الإجمالي بيتحسب من المدة × المعدل (والخادم بيعيد حسابه ويتجاهل أي رقم تاني)
    await rpcOrThrow('save_plan', { p: { ...input, totalSessions: planTotalSessions(input.durationWeeks, input.sessionsPerWeek) } }, ['plans', 'invoices', 'appointments', 'notifications', 'activity']);
  },
  async deletePlan(id: string) {
    await rpcOrThrow('delete_plan', { p_id: id }, ['plans', 'invoices', 'appointments', 'sessions', 'activity']);
  },

  // ---------- خدمات خطط العلاج (قائمة منفصلة تمامًا عن كتالوج الخدمات الرسمي، لحقل "نوع العلاج" في نموذج الخطة) ----------
  planServices: () => load().planServices.filter((p) => p.active),
  allPlanServices: () => load().planServices,
  async savePlanService(input: { id?: string; name: string; active?: boolean; offers?: PlanOffer[] }): Promise<Result> {
    const r = await rpc('save_plan_service', { p: input }, ['planServices', 'activity']);
    return r.ok ? { ok: true } : r;
  },
  async deletePlanService(id: string): Promise<Result> {
    const r = await rpc('delete_plan_service', { p_id: id }, ['planServices', 'activity']);
    return r.ok ? { ok: true } : r;
  },

  // ---------- packages ----------
  packagePlans: () => load().packagePlans.filter((p) => p.active),
  allPackagePlans: () => load().packagePlans,
  async savePackagePlan(input: Omit<PackagePlan, 'id'> & { id?: string }): Promise<Result> {
    if (input.totalSessions < 1 || input.price < 0 || input.validDays < 1) return fail('تحقق من عدد الجلسات والسعر والصلاحية.');
    if (!input.serviceIds.length) return fail('اختر خدمة واحدة على الأقل تشملها الباقة.');
    if (input.kind && input.totalSessions !== (input.kind === 'pkg4' ? 4 : 6)) return fail('عدد جلسات الباقة الثابتة ما يتغير.');
    const row = { kind: input.kind ?? null, name: input.name, service_ids: input.serviceIds, total_sessions: input.totalSessions, price: input.price, valid_days: input.validDays, active: input.active };
    const { error } = input.id ? await supabase.from('package_plans').update(row).eq('id', input.id) : await supabase.from('package_plans').insert(row);
    if (error) return fail(cleanMsg(error.message));
    await pull(['catalog', 'activity']);
    return { ok: true };
  },
  async deletePackagePlan(id: string) {
    const { error } = await supabase.from('package_plans').delete().eq('id', id);
    if (error) throw new DbError(cleanMsg(error.message));
    await pull(['catalog', 'activity']);
  },
  packagesForPatient(patientId: string) { return load().packages.filter((p) => p.patientId === patientId); },
  activePackagesForPatient(patientId: string) { return load().packages.filter((p) => p.patientId === patientId && p.status === 'active' && p.usedSessions < p.totalSessions); },
  async sellPackage(patientId: string, planId: string): Promise<Package> {
    const r = await rpcOrThrow<{ id: string }>('sell_package', { p_patient: patientId, p_package_plan: planId }, ['packages', 'invoices', 'activity']);
    return load().packages.find((p) => p.id === r.id)!;
  },
  async cancelPackage(id: string): Promise<Result> {
    const r = await rpc('cancel_package', { p_id: id }, ['packages', 'invoices', 'appointments', 'activity']);
    return r.ok ? { ok: true } : r;
  },
  // الباقة المطابقة في كتالوج الباقات (لتجديد باقة منتهية بنفس المواصفات) — بالاسم أولًا، وإلا النوع، وإلا الجلسات والسعر
  packagePlanFor(pkg: Package): PackagePlan | undefined {
    const plans = load().packagePlans.filter((p) => p.active);
    return plans.find((p) => p.name === pkg.name)
      ?? (pkg.kind ? plans.find((p) => p.kind === pkg.kind) : undefined)
      ?? plans.find((p) => p.totalSessions === pkg.totalSessions && p.price === pkg.price);
  },
  async renewPackage(patientId: string, pkg: Package): Promise<Result<{ id: string }>> {
    const plan = db.packagePlanFor(pkg);
    if (!plan) return fail('ما قدرنا نلاقي نفس الباقة في كتالوج الباقات — افتح «بيع باقة» من ملف المريض واختَرها يدويًا.');
    const r = await rpc<{ id: string }>('sell_package', { p_patient: patientId, p_package_plan: plan.id }, ['packages', 'invoices', 'activity']);
    return r.ok ? { ok: true, id: r.data.id } : r;
  },
  // تسجيل حضور جلسة الموعد (لو على باقة أو خطة علاجية) وخصمها تلقائيًا — من تفاصيل الموعد مباشرة
  async attendanceCheckInForAppointment(appt: Appointment): Promise<Result<{ sessionNo: number; total: number; remaining: number }>> {
    const source = appt.planId ? 'plan' : appt.packageId ? 'package' : null;
    const refId = appt.planId || appt.packageId;
    if (!source || !refId) return fail('هذا الموعد مش مرتبط بباقة ولا خطة علاجية.');
    const r = await rpc<{ sessionNo: number; total: number; remaining: number }>('attendance_check_in',
      { p_source: source, p_id: refId, p_appointment: appt.id, p_therapist: null, p_second: false },
      ['appointments', 'packages', 'plans', 'sessions', 'activity']);
    return r.ok ? { ok: true, sessionNo: r.data.sessionNo, total: r.data.total, remaining: r.data.remaining } : r;
  },

  // ---------- أكواد الخصم ----------
  discountCodes: () => load().discountCodes,
  discountStatus(dc: DiscountCode): 'active' | 'scheduled' | 'expired' | 'used_up' | 'disabled' {
    const d = today();
    if (!dc.active) return 'disabled';
    if (dc.usedCount >= dc.maxUses) return 'used_up';
    if (d < dc.validFrom) return 'scheduled';
    if (d > dc.validTo) return 'expired';
    return 'active';
  },
  async saveDiscountCode(input: Omit<DiscountCode, 'id' | 'usedCount' | 'createdAt'> & { id?: string }): Promise<Result> {
    const r = await rpc('save_discount_code', { p: input }, ['discounts', 'activity']);
    return r.ok ? { ok: true } : r;
  },
  async deleteDiscountCode(id: string): Promise<Result> {
    const r = await rpc('delete_discount_code', { p_id: id }, ['discounts', 'activity']);
    return r.ok ? { ok: true } : r;
  },
  // معاينة سريعة على الكاش (التحقق النهائي بيتم على الخادم عند التطبيق)
  previewDiscountCode(codeInput: string, price: number): Result<{ dc: DiscountCode; amount: number }> {
    const code = normalizeCode(codeInput);
    const bare = (c: string) => c.replace(/[^A-Z0-9]/g, '');
    const all = load().discountCodes;
    const loose = all.filter((x) => bare(x.code.toUpperCase()) === bare(code));
    const dc = all.find((x) => x.code.toUpperCase() === code) ?? (loose.length === 1 ? loose[0] : undefined);
    if (!dc) return fail('كود الخصم غير صحيح.');
    const st = this.discountStatus(dc);
    if (st === 'disabled') return fail('كود الخصم موقوف.');
    if (st === 'used_up') return fail('تم استهلاك كل مرات استخدام الكود.');
    if (st === 'scheduled') return fail(`الكود يبدأ من ${dc.validFrom}.`);
    if (st === 'expired') return fail(`انتهت صلاحية الكود في ${dc.validTo}.`);
    if (dc.minAmount && price < dc.minAmount) return fail(`الكود يتطلب حدًّا أدنى للطلب ${dc.minAmount} ج.م.`);
    const amount = Math.min(price, dc.type === 'percent' ? Math.round((price * dc.value) / 100) : dc.value);
    return { ok: true, dc, amount };
  },
  async applyDiscountCode(invoiceId: string, codeInput: string): Promise<Result<{ amount: number }>> {
    const r = await rpc<{ amount: number }>('apply_discount_code', { p_invoice: invoiceId, p_code: codeInput }, ['invoices', 'discounts', 'activity']);
    return r.ok ? { ok: true, amount: r.data.amount } : r;
  },

  // ---------- إشعارات المرضى (حملات) ----------
  campaigns: () => load().campaigns,
  async sendCampaign(input: { title: string; body: string; audience: string; source?: string | null; patientId?: string | null; discountCodeId?: string | null }): Promise<Result<{ recipients: number; delivered: number }>> {
    const r = await rpc<{ recipients: number; delivered: number }>('send_campaign', { p: input }, ['campaigns', 'activity']);
    return r.ok ? { ok: true, recipients: r.data.recipients, delivered: r.data.delivered } : r;
  },

  // ---------- diagnosis conditions ----------
  async saveCondition(input: { id?: string; regionId: string; name: string; en: string; icd10: string; tests: string; desc: string; services?: string[] }): Promise<Result<{ id: string }>> {
    const r = await rpc<{ id: string }>('save_condition', { p: input }, ['conditions', 'activity']);
    return r.ok ? { ok: true, id: r.data.id } : r;
  },
  async hideCondition(id: string): Promise<Result> {
    const r = await rpc('hide_condition', { p_id: id }, ['conditions', 'activity']);
    return r.ok ? { ok: true } : r;
  },

  // ---------- invoices / payments ----------
  invoices: () => load().invoices.slice().sort(newestInvoiceFirst),
  invoicesForPatient(patientId: string) { return load().invoices.filter((i) => i.patientId === patientId).sort(newestInvoiceFirst); },
  invoice: (id: string) => load().invoices.find((i) => i.id === id),
  // الدفعات الملغاة (void) بتفضل في السجل بس مابتتحسبش في أي إجمالي — تظهر بس جوه الفاتورة
  payments: () => load().payments.filter((p) => !p.voidedAt).sort((a, b) => b.date - a.date),
  paymentsForPatient(patientId: string) { return load().payments.filter((p) => p.patientId === patientId && !p.voidedAt).sort((a, b) => b.date - a.date); },
  paymentsForInvoice(invoiceId: string) { return load().payments.filter((p) => p.invoiceId === invoiceId); },
  draftPlanInvoicesCount: () => load().invoices.filter((i) => i.status === 'draft').length,
  async createInvoice(input: { patientId: string; items: Array<{ description: string; qty: number; unitPrice: number; serviceId?: string }>; discount?: number; note?: string; date?: string }): Promise<Result<{ id: string }>> {
    const r = await rpc<{ id: string }>('create_invoice', { p: input }, ['invoices', 'notifications', 'activity']);
    return r.ok ? { ok: true, id: r.data.id } : r;
  },
  async updatePlanInvoice(id: string, patch: { price: number; discount: number; note: string }, issue: boolean): Promise<Result> {
    const r = await rpc('update_plan_invoice', { p_invoice: id, p_price: patch.price, p_discount: patch.discount, p_note: patch.note, p_issue: issue }, ['invoices', 'plans', 'activity']);
    return r.ok ? { ok: true } : r;
  },
  async recordPayment(invoiceId: string, amount: number, method: PaymentMethod, note = ''): Promise<Result> {
    const r = await rpc('record_payment', { p_invoice: invoiceId, p_amount: amount, p_method: method, p_note: note }, ['invoices', 'payments', 'activity']);
    return r.ok ? { ok: true } : r;
  },
  async updatePayment(id: string, patch: { amount: number; method: PaymentMethod; note: string }): Promise<Result> {
    const r = await rpc('update_payment', { p_id: id, p_amount: patch.amount, p_method: patch.method, p_note: patch.note }, ['invoices', 'payments', 'activity']);
    return r.ok ? { ok: true } : r;
  },
  async deletePayment(id: string) { await rpcOrThrow('delete_payment', { p_id: id }, ['invoices', 'payments', 'activity']); },
  // سجل نشاط «تم فتح مشاركة الفاتورة» فقط — مايوسمش الفاتورة مُرسلة لأن واتساب مابيأكدش الإرسال من غير API
  async logInvoiceShare(invoiceId: string, method: 'share' | 'fallback'): Promise<void> {
    await supabase.rpc('log_invoice_share', { p_invoice: invoiceId, p_method: method });
  },
  async markInvoiceSent(invoiceId: string): Promise<Result> {
    const r = await rpc('mark_invoice_sent', { p_invoice: invoiceId }, ['invoices', 'activity']);
    return r.ok ? { ok: true } : r;
  },
  async setInvoiceName(invoiceId: string, name: string): Promise<Result> {
    const r = await rpc('set_invoice_name', { p_invoice: invoiceId, p_name: name }, ['invoices', 'activity']);
    return r.ok ? { ok: true } : r;
  },
  async cancelInvoice(invoiceId: string): Promise<Result> {
    const r = await rpc('cancel_invoice', { p_invoice: invoiceId }, ['invoices', 'activity']);
    return r.ok ? { ok: true } : r;
  },

  async deleteInvoice(invoiceId: string): Promise<Result> {
    const r = await rpc('delete_invoice', { p_invoice: invoiceId }, ['invoices', 'discounts', 'activity']);
    return r.ok ? { ok: true } : r;
  },

  // ---------- notifications ----------
  // أنواع إشعارات مخفية عن المستخدم الحالي حسب صلاحياته (مثلاً «مخزون منخفض» لمن مالوش صلاحية المخزون)
  setHiddenNotificationKinds(kinds: string[]) { hiddenKinds = new Set(kinds); },
  notifications: () => load().notifications.filter((n) => !hiddenKinds.has(n.kind)).sort((a, b) => b.createdAt - a.createdAt),
  unreadCount: () => load().notifications.filter((n) => !n.read && !hiddenKinds.has(n.kind)).length,
  markNotificationRead(id: string) {
    const n = load().notifications.find((x) => x.id === id);
    if (n && !n.read) { n.read = true; commit(); supabase.from('notifications').update({ read: true }).eq('id', id).then(() => {}); }
  },
  markAllNotificationsRead() {
    const unread = load().notifications.filter((n) => !n.read);
    if (!unread.length) return;
    unread.forEach((n) => { n.read = true; }); commit();
    supabase.from('notifications').update({ read: true }).eq('audience', 'staff').eq('read', false).then(() => {});
  },
  deleteNotification(id: string) {
    const d = load(); d.notifications = d.notifications.filter((n) => n.id !== id); commit();
    supabase.from('notifications').delete().eq('id', id).then(() => {});
  },
  deleteReadNotifications() {
    const d = load(); d.notifications = d.notifications.filter((n) => !n.read); commit();
    supabase.from('notifications').delete().eq('audience', 'staff').eq('read', true).then(() => {});
  },
  // تنبيهات آلية على الخادم (بدون تكرار) — تُستدعى عند فتح النظام ودوريًا
  runAutomations() {
    supabase.rpc('run_automations').then(({ data }) => { if (data) pull(['notifications', 'packages']); });
  },

  // ---------- inventory ----------
  inventory: () => load().inventory,
  stockMovements: () => load().stockMovements.slice().sort((a, b) => b.date - a.date),
  async saveItem(input: Omit<InventoryItem, 'id' | 'sku' | 'updatedAt' | 'quantity'> & { id?: string; quantity?: number }): Promise<Result> {
    const r = await rpc('save_item', { p: input }, ['inventory', 'activity']);
    return r.ok ? { ok: true } : r;
  },
  async deleteItem(id: string) { await rpcOrThrow('delete_item', { p_id: id }, ['inventory', 'activity']); },
  async addStockMovement(input: { itemId: string; type: StockMovementType; quantity: number; unitCost: number; reference: string; note: string }): Promise<Result> {
    const r = await rpc('add_stock_movement', { p: input }, ['inventory', 'notifications', 'activity']);
    if (r.ok) db.runAutomations();
    return r.ok ? { ok: true } : r;
  },

  // ---------- أسعار الخدمة المتعددة ----------
  servicePrices: (serviceId?: string) => load().servicePrices.filter((p) => !serviceId || p.serviceId === serviceId),
  async saveServicePrice(input: { id?: string; serviceId: string; label: string; price: number; therapistId: string | null; active: boolean }): Promise<Result> {
    if (!input.label.trim()) return fail('اكتب اسم السعر (مثال: سعر عرض).');
    if (!(input.price >= 0)) return fail('السعر لازم يكون رقم موجب.');
    const row = { service_id: input.serviceId, label: input.label.trim(), price: input.price, therapist_id: input.therapistId || null, active: input.active };
    const { error } = input.id ? await supabase.from('service_prices').update(row).eq('id', input.id) : await supabase.from('service_prices').insert(row);
    if (error) return fail(cleanMsg(error.message));
    await pull(['servicePrices']);
    return { ok: true };
  },
  async deleteServicePrice(id: string): Promise<Result> {
    const { error } = await supabase.from('service_prices').delete().eq('id', id);
    if (error) return fail(cleanMsg(error.message));
    await pull(['servicePrices']);
    return { ok: true };
  },

  // ---------- المرضى: بحث/فلترة/فرز/ترقيم على الخادم ----------
  async queryPatients(o: { q?: string; gender?: string; source?: string; active?: string; doctorId?: string; sort?: string; gaps?: string; page?: number; pageSize?: number }): Promise<Result<{ total: number; rows: PatientRow[] }>> {
    const pageSize = o.pageSize ?? 20;
    const { data, error } = await supabase.rpc('list_patients', {
      p_q: o.q ?? '', p_gender: o.gender ?? '', p_source: o.source ?? '', p_active: o.active ?? '', p_doctor: o.doctorId || null,
      p_sort: o.sort ?? 'registered_desc', p_limit: pageSize, p_offset: ((o.page ?? 1) - 1) * pageSize, p_gaps: o.gaps ?? '',
    });
    if (error) return fail(cleanMsg(error.message));
    const rows: PatientRow[] = (data.rows as any[]).map((r) => ({ ...map.patient(r), doctorName: r.doctor_name ?? '', lastVisit: r.last_visit ?? null, nextVisit: r.next_visit ?? null, balance: Number(r.balance ?? 0), hasAccount: !!r.has_account }));
    return { ok: true, total: data.total as number, rows };
  },

  // ---------- بحث شامل (مرضى / أطباء / مواعيد) ----------
  async globalSearch(q: string): Promise<SearchHit[]> {
    const { data, error } = await supabase.rpc('global_search', { p_q: q });
    if (error) throw new DbError(cleanMsg(error.message));
    // فواتير المريض اللي رقم ملفه/اسمه/جواله بيطابق البحث (أو رقم الفاتورة نفسه) — بتظهر في نفس القائمة
    const s = q.trim().toLowerCase();
    const invHits: SearchHit[] = this.invoices()
      .filter((i) => i.status !== 'cancelled' && (i.no.toLowerCase().includes(s) || patientMatches(this.patient(i.patientId), s)))
      .sort((a, b) => (a.date < b.date ? 1 : -1)).slice(0, 6)
      .map((i) => ({ type: 'invoice' as const, id: i.id, title: `${i.no} — ${this.patient(i.patientId)?.fullName ?? ''}`,
        sub: ` ${this.patient(i.patientId)?.fileNo ?? ''} · ${i.serviceName} · ${i.total} ج.م`, link: '/invoices?q=' + encodeURIComponent(i.no) }));
    return [...(data as SearchHit[]).map((h) => ({ ...h, title: stripFileNoPrefix(h.title ?? ''), sub: stripFileNoPrefix(h.sub ?? '') })), ...invHits];
  },

  // ---------- ملفات المريض (Supabase Storage) ----------
  async patientFiles(patientId: string): Promise<PatientFile[]> {
    const { data, error } = await supabase.from('patient_files').select('*').eq('patient_id', patientId).order('created_at', { ascending: false });
    if (error) throw new DbError(cleanMsg(error.message));
    return (data ?? []).map(map.file);
  },
  // ملف الفاتورة PDF لإرساله واتساب: بيترفع في ملفات المريض ويرجع رابط تحميل صالح 30 يوم (null لو فشل)
  async uploadInvoicePdf(patientId: string, file: File): Promise<string | null> {
    const path = `${patientId}/invoices/${crypto.randomUUID()}.pdf`;
    const up = await supabase.storage.from('patient-files').upload(path, file, { contentType: 'application/pdf', upsert: false });
    if (up.error) return null;
    const { data } = await supabase.storage.from('patient-files').createSignedUrl(path, 60 * 60 * 24 * 30);
    return data?.signedUrl ?? null;
  },
  async uploadPatientFile(patientId: string, file: File, note = '', link: { planId?: string | null; appointmentId?: string | null } = {}): Promise<Result> {
    if (file.size > 10 * 1024 * 1024) return fail('حجم الملف أكبر من 10 ميجابايت.');
    if (file.size === 0) return fail('الملف فارغ.');
    const allowed = ['application/pdf', 'image/png', 'image/jpeg', 'image/webp', 'application/msword', 'application/vnd.openxmlformats-officedocument.wordprocessingml.document', 'text/plain'];
    if (!allowed.includes(file.type)) return fail('نوع الملف غير مدعوم (PDF أو صورة أو مستند Word أو نص).');
    const { data: u } = await supabase.auth.getUser();
    if (!u.user) return fail('انتهت الجلسة — سجّل الدخول من جديد.');
    const ext = (file.name.split('.').pop() ?? 'bin').toLowerCase().replace(/[^a-z0-9]/g, '').slice(0, 8) || 'bin';
    const path = `${patientId}/${crypto.randomUUID()}.${ext}`;
    const up = await supabase.storage.from('patient-files').upload(path, file, { contentType: file.type, upsert: false });
    if (up.error) return fail('تعذّر رفع الملف: ' + up.error.message);
    const emp = load().employees.find((e) => e.id === actorId);
    const { error } = await supabase.from('patient_files').insert({ patient_id: patientId, uploaded_by: u.user.id, uploaded_by_name: emp?.name ?? load().patients.find((p) => p.id === patientId)?.fullName ?? '', file_path: path, file_name: file.name, file_type: file.type, size_bytes: file.size, note: note.trim(), plan_id: link.planId ?? null, appointment_id: link.appointmentId ?? null });
    if (error) { await supabase.storage.from('patient-files').remove([path]); return fail(cleanMsg(error.message)); }
    return { ok: true };
  },
  async fileUrl(path: string): Promise<string | null> {
    const { data } = await supabase.storage.from('patient-files').createSignedUrl(path, 300);
    return data?.signedUrl ?? null;
  },
  async deletePatientFile(f: PatientFile): Promise<Result> {
    const { error } = await supabase.from('patient_files').delete().eq('id', f.id);
    if (error) return fail(cleanMsg(error.message));
    await supabase.storage.from('patient-files').remove([f.filePath]);
    return { ok: true };
  },

  // ---------- سجل الجسم (منطقة/مشكلة/تشخيص/درجة) ----------
  async bodyRecords(patientId?: string): Promise<BodyRecord[]> {
    let q = supabase.from('body_records').select('*').order('created_at', { ascending: false }).limit(500);
    if (patientId) q = q.eq('patient_id', patientId);
    const { data, error } = await q;
    if (error) throw new DbError(cleanMsg(error.message));
    return (data ?? []).map(map.bodyRecord);
  },
  async saveBodyRecord(input: Omit<BodyRecord, 'id' | 'createdAt' | 'createdBy' | 'therapistId'> & { id?: string }): Promise<Result> {
    if (!input.patientId) return fail('اختر المريض.');
    if (!input.regionId) return fail('اختر المنطقة المتأثرة.');
    if (!(input.severity >= 1 && input.severity <= 5)) return fail('درجة الحالة من 1 إلى 5.');
    const emp = load().employees.find((e) => e.id === actorId);
    const row = { patient_id: input.patientId, appointment_id: input.appointmentId || null, session_id: input.sessionId || null, region_id: input.regionId, condition_id: input.conditionId || null, side: input.side || null, problem: input.problem.trim(), diagnosis: input.diagnosis.trim(), severity: input.severity, notes: input.notes.trim() };
    const { error } = input.id
      ? await supabase.from('body_records').update(row).eq('id', input.id)
      : await supabase.from('body_records').insert({ ...row, therapist_id: emp?.therapistId ?? null, created_by: actorId });
    if (error) return fail(cleanMsg(error.message));
    return { ok: true };
  },
  async deleteBodyRecord(id: string): Promise<Result> {
    const { error } = await supabase.from('body_records').delete().eq('id', id);
    return error ? fail(cleanMsg(error.message)) : { ok: true };
  },

  // ---------- سجل العمليات (Audit) — للمدير فقط ----------
  async auditLogs(o: { page?: number; pageSize?: number; table?: string; action?: string; from?: string; to?: string }): Promise<Result<{ total: number; rows: AuditLog[] }>> {
    const size = o.pageSize ?? 25; const from = ((o.page ?? 1) - 1) * size;
    let q = supabase.from('audit_logs').select('*', { count: 'exact' }).order('at', { ascending: false }).range(from, from + size - 1);
    if (o.table) q = q.eq('table_name', o.table);
    if (o.action) q = q.eq('action', o.action);
    if (o.from) q = q.gte('at', o.from + 'T00:00:00+03:00');
    if (o.to) q = q.lte('at', o.to + 'T23:59:59+03:00');
    const { data, error, count } = await q;
    if (error) return fail(cleanMsg(error.message));
    return { ok: true, total: count ?? 0, rows: (data ?? []).map(map.audit) };
  },

  // ---------- حسابي ----------
  async updateMyProfile(p: { name?: string; phone?: string }): Promise<Result> {
    const r = await rpc('update_my_profile', { p }, ['employees']);
    return r.ok ? { ok: true } : r;
  },
  async changePassword(next: string): Promise<Result> {
    if (next.length < 6) return fail('كلمة المرور الجديدة 6 خانات على الأقل.');
    const { data: u } = await supabase.auth.getUser();
    if (!u.user?.email) return fail('انتهت الجلسة — سجّل الدخول من جديد.');
    const { error } = await supabase.auth.updateUser({ password: next });
    return error ? fail(error.message) : { ok: true };
  },
  recordLogin() { supabase.rpc('audit_login').then(() => {}); },

  // ---------- Realtime: أي تغيير في الجداول الأساسية يحدّث الشاشات فورًا ----------
  startRealtime() {
    db.stopRealtime();
    const routes: Record<string, Key[]> = {
      appointments: ['appointments', 'notifications', 'invoices'], notifications: ['notifications'], invoices: ['invoices'], payments: ['payments', 'invoices'],
      patients: ['patients'], treatment_sessions: ['sessions', 'appointments'], treatment_plans: ['plans'], support_tickets: ['support'], support_replies: ['support'], staff_requests: ['requests', 'center'],
      packages: ['packages'], discount_codes: ['discounts'], campaigns: ['campaigns'], employees: ['employees', 'catalog'], plan_services: ['planServices'],
      therapists: ['catalog'], center_info: ['center'], holidays: ['center'],
    };
    const ch = supabase.channel('clinic-live');
    for (const [table, keys] of Object.entries(routes)) {
      ch.on('postgres_changes', { event: '*', schema: 'public', table }, () => {
        keys.forEach((k) => rtPending.add(k));
        if (rtTimer) clearTimeout(rtTimer);
        rtTimer = setTimeout(() => { const ks = [...rtPending]; rtPending.clear(); pull(ks); }, 350);
      });
    }
    ch.subscribe();
    rtChannel = ch;
  },
  stopRealtime() { if (rtChannel) { supabase.removeChannel(rtChannel); rtChannel = null; } if (rtTimer) clearTimeout(rtTimer); rtPending.clear(); },

  // مؤشرات لوحة المعلومات — محسوبة على الخادم من الجداول مباشرة (تاريخ اليوم بتوقيت الرياض)
  async dashboardStats(): Promise<DashboardStats | null> {
    const { data, error } = await supabase.rpc('dashboard_stats');
    return error ? null : (data as DashboardStats);
  },

  // ملخص التقارير على الخادم: الإيراد = مدفوعات الفترة الفعلية، مع فلتر المعالج والفرع وتجميع يومي/أسبوعي/شهري
  async reportSummary(from: string, to: string, opts: { therapistId?: string; branchId?: string; serviceId?: string; group?: 'day' | 'week' | 'month' } = {}): Promise<ReportSummary | null> {
    const { data, error } = await supabase.rpc('report_summary', { p_from: from, p_to: to, p_branch: opts.branchId || null, p_therapist: opts.therapistId || null, p_group: opts.group ?? 'day', p_service: opts.serviceId || null });
    return error ? null : (data as ReportSummary);
  },

  // ---------- الدعم الفني (تذاكر) ----------
  tickets: () => load().tickets,
  repliesFor: (ticketId: string) => load().replies.filter((r) => r.ticketId === ticketId),
  async createTicket(input: { subject: string; description: string; category: string; priority: TicketPriority }): Promise<Result> {
    if (!input.subject.trim()) return fail('اكتب عنوان المشكلة.');
    const { error } = await supabase.from('support_tickets').insert({ subject: input.subject.trim(), description: input.description.trim(), category: input.category, priority: input.priority, no: '' });
    if (error) return fail(cleanMsg(error.message));
    await pull(['support']);
    return { ok: true };
  },
  async replyTicket(ticketId: string, body: string): Promise<Result> {
    if (!body.trim()) return fail('اكتب الرد.');
    const { error } = await supabase.from('support_replies').insert({ ticket_id: ticketId, body: body.trim(), employee_id: actorId });
    if (error) return fail(cleanMsg(error.message));
    await pull(['support']);
    return { ok: true };
  },
  async setTicketStatus(ticketId: string, status: TicketStatus): Promise<Result> {
    const { error } = await supabase.from('support_tickets').update({ status, updated_at: new Date().toISOString() }).eq('id', ticketId);
    if (error) return fail(cleanMsg(error.message));
    await pull(['support']);
    return { ok: true };
  },
};

export type PatientRow = Patient & { doctorName: string; lastVisit: string | null; nextVisit: string | null; balance: number; hasAccount: boolean };
export interface SearchHit { type: 'patient' | 'doctor' | 'appointment' | 'invoice'; id: string; title: string; sub: string; link: string }
export interface DashboardStats {
  todayAppointments: number; completedToday: number; totalPatients: number; newPatientsMonth: number; monthRevenue: number | null;
  outstanding: number | null; draftPlanInvoices: number; unreadNotifications: number; pendingRequests: number; openTickets: number;
}
export interface ReportSummary {
  financial: boolean; revenue: number | null; paymentsCount: number | null; paymentsByMethod: Record<string, number> | null; invoiced: number | null; discounts: number | null; tax: number | null; outstanding: number | null;
  patientsBySource: Array<{ source: string; n: number }>; patientsByDoctor: Array<{ id: string; name: string; patients: number; visits: number }>;
  therapists: Array<{ id: string; name: string; appointments: number; completed: number; no_show: number; cancelled: number; patients: number; revenue: number | null }>;
  services: Array<{ id: string; name: string; count: number; completed: number; revenue: number | null }>;
  newPatients: number; totalPatients: number; appointments: number; appointmentsByStatus: Record<string, number>;
  series: Array<{ period: string; appointments: number; revenue: number | null }>;
}
export { DAY_MS };
export type { Campaign, SupportTicket, SupportReply, AppNotification, NotificationKind, Invoice, Payment };
