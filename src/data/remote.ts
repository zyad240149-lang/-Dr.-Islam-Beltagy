// ===============================================================
// الطبقة الوحيدة اللي بتكلّم Supabase: تحميل الجداول + تحويل الصفوف لأنواع الواجهة.
// كل القراءة بتمر من RLS (الصلاحيات ونطاق المعالج يتطبقوا في قاعدة البيانات نفسها).
// ===============================================================
import { supabase } from '../lib/supabase';
import type {
  Appointment, ActivityLog, AppNotification, Campaign, CenterInfo, DiagnosisRef, DiscountCode, Employee, InitialAssessment, InventoryItem,
  Invoice, Package, PackagePlan, PlanService, Patient, Payment, PermissionMatrix, Service, StaffRequest, StockMovement, SupportReply, SupportTicket,
  Therapist, TreatmentPlan, TreatmentSession, Branch, Area, Op, ServicePrice, PatientFile, BodyRecord, AuditLog,
} from '../types';
import { findCondition } from './bodyRegions';
import { stripFileNoPrefix } from '../utils/phoneUtils';

const ts = (v: string | null | undefined) => (v ? Date.parse(v) : 0);
const num = (v: unknown) => (v === null || v === undefined ? 0 : Number(v));

function ref(id: string | null, side: DiagnosisRef['side']): DiagnosisRef | null {
  const f = id ? findCondition(id) : undefined;
  return f ? { conditionId: f.condition.id, regionId: f.region.id, icd10: f.condition.icd10, side: side ?? null } : null;
}

export const map = {
  employee: (r: any): Employee => ({
    id: r.id, name: r.name, username: r.username, password: '', role: r.role, phone: r.phone ?? '', active: r.active,
    createdAt: ts(r.created_at), lastLogin: r.last_login ? ts(r.last_login) : null, branchId: r.branch_id ?? null, therapistId: r.therapist_id ?? null, jobTitle: r.job_title ?? '', workHours: r.work_hours ?? [], extraPerms: r.extra_perms ?? {}, permOverride: r.perm_override ?? null,
  }),
  patient: (r: any): Patient => ({
    isGuest: !!r.is_guest, id: r.id, fileNo: String(r.file_no ?? '').replace(/\D/g, '') || r.file_no, fullName: r.full_name, phone: r.phone, nationalId: r.national_id ?? '', birthDate: r.birth_date ?? '',
    gender: r.gender ?? 'male', genderUnknown: !r.gender, address: r.address ?? '', referralSource: r.referral_source ?? 'other', notes: r.notes ?? '',
    emergencyContactName: r.emergency_contact_name ?? '', emergencyContactPhone: r.emergency_contact_phone ?? '', registeredAt: ts(r.registered_at),
    active: r.active, mainComplaint: r.main_complaint ?? '', diagnosis: r.diagnosis ?? '', medicalHistory: r.medical_history ?? '',
    diagnosisRef: ref(r.diagnosis_condition_id, r.diagnosis_side),
    email: r.email ?? '', city: r.city ?? '', district: r.district ?? '', street: r.street ?? '', doctorId: r.doctor_id ?? null, signupMethod: r.signup_method ?? null, nationality: r.nationality ?? 'saudi', nationalityUnconfirmed: !!r.nationality_unconfirmed || !r.nationality, firstName: r.first_name ?? '', fatherName: r.father_name ?? '', familyName: r.family_name ?? '',
  }),
  patientRow: (p: Partial<Patient>) => {
    const o: Record<string, unknown> = {};
    const m: Record<string, string> = {
      fullName: 'full_name', phone: 'phone', nationalId: 'national_id', gender: 'gender', address: 'address', referralSource: 'referral_source',
      notes: 'notes', emergencyContactName: 'emergency_contact_name', emergencyContactPhone: 'emergency_contact_phone', active: 'active',
      mainComplaint: 'main_complaint', diagnosis: 'diagnosis', medicalHistory: 'medical_history', email: 'email', city: 'city', district: 'district', street: 'street',
      nationality: 'nationality', firstName: 'first_name', fatherName: 'father_name', familyName: 'family_name', nationalityUnconfirmed: 'nationality_unconfirmed',
    };
    for (const [k, col] of Object.entries(m)) if (k in p) o[col] = (p as any)[k];
    if ('birthDate' in p) o.birth_date = p.birthDate || null;
    if ('doctorId' in p) o.doctor_id = p.doctorId || null;
    if ('diagnosisRef' in p) { o.diagnosis_condition_id = p.diagnosisRef?.conditionId ?? null; o.diagnosis_side = p.diagnosisRef?.side ?? null; }
    return o;
  },
  therapist: (r: any, svc: string[]): Therapist => ({
    id: r.id, name: r.name, title: r.title ?? '', phone: r.phone ?? '', photo: r.photo ?? '', serviceIds: svc, workHours: r.work_hours ?? [],
    onLeave: r.on_leave ?? [], active: r.active, branchId: r.branch_id ?? null,
    email: r.email ?? '', bio: r.bio ?? '', photoUrl: r.photo_url ?? '', defaultDurationMin: r.default_duration_min ?? 30,
  }),
  service: (r: any, th: string[]): Service => ({
    id: r.id, name: r.name, category: r.category ?? '', description: r.description ?? '', price: num(r.price), durationMin: r.duration_min,
    therapistIds: th, active: r.active, showOnSite: r.show_on_site !== false, deleted: r.deleted === true, branchId: r.branch_id ?? null,
  }),
  appointment: (r: any): Appointment => ({
    id: r.id, no: r.no, patientId: r.patient_id, type: r.type, serviceId: r.service_id, therapistId: r.therapist_id ?? '', roomId: '',
    location: r.location, address: r.address ?? '', date: r.date, time: r.time, durationMin: r.duration_min, status: r.status, price: num(r.price),
    packageId: r.package_id ?? null, planId: r.plan_id ?? null, seriesId: r.series_id ?? null, cancelReason: r.cancel_reason ?? null,
    createdAt: ts(r.created_at), updatedAt: ts(r.updated_at), branchId: r.branch_id ?? null, notes: r.notes ?? '', source: r.source === 'online' ? 'online' : 'staff',
    createdByKind: r.created_by_kind ?? null, createdByName: r.created_by_name ?? null, createdByRole: r.created_by_role ?? null,
    cancelledAt: r.cancelled_at ? ts(r.cancelled_at) : null, cancelledByKind: r.cancelled_by_kind ?? null, cancelledByName: r.cancelled_by_name ?? null, cancelledByRole: r.cancelled_by_role ?? null,
  }),
  session: (r: any): TreatmentSession => ({
    id: r.id, appointmentId: r.appointment_id ?? '', patientId: r.patient_id, therapistId: r.therapist_id ?? '', planId: r.plan_id ?? null,
    sessionNo: r.session_no, date: r.date, status: r.status, painLevel: r.pain_level, subject: r.subject ?? '', painScale: r.pain_scale ?? null, therapistNotes: r.therapist_notes ?? '',
    treatmentUsed: r.treatment_used ?? '', devicesUsed: r.devices_used ?? '', exercises: r.exercises ?? '', patientResponse: r.patient_response ?? '',
    nextPlan: r.next_plan ?? '', startedAt: r.started_at ? ts(r.started_at) : null, completedAt: r.completed_at ? ts(r.completed_at) : null,
  }),
  assessment: (r: any): InitialAssessment => ({
    id: r.id, patientId: r.patient_id, date: ts(r.date), mainComplaint: r.main_complaint ?? '', onsetDate: r.onset_date ?? '',
    medicalHistory: r.medical_history ?? '', priorInjuries: r.prior_injuries ?? '', priorSurgeries: r.prior_surgeries ?? '',
    medications: r.medications ?? '', allergies: r.allergies ?? '', medicalDiagnosis: r.medical_diagnosis ?? '',
    diagnosisRef: ref(r.diagnosis_condition_id, r.diagnosis_side), painLevel: r.pain_level ?? 0, rom: r.rom ?? '',
    muscleStrength: r.muscle_strength ?? '', balance: r.balance ?? '', gait: r.gait ?? '', specialTests: r.special_tests ?? '',
    therapistNotes: r.therapist_notes ?? '', goals: r.goals ?? '', plan: r.plan ?? '', suggestedSessions: r.suggested_sessions ?? 0,
  }),
  assessmentRow: (a: Partial<InitialAssessment>) => ({
    patient_id: a.patientId, main_complaint: a.mainComplaint, onset_date: a.onsetDate, medical_history: a.medicalHistory, prior_injuries: a.priorInjuries,
    prior_surgeries: a.priorSurgeries, medications: a.medications, allergies: a.allergies, medical_diagnosis: a.medicalDiagnosis,
    diagnosis_condition_id: a.diagnosisRef?.conditionId ?? null, diagnosis_side: a.diagnosisRef?.side ?? null, pain_level: a.painLevel, rom: a.rom,
    muscle_strength: a.muscleStrength, balance: a.balance, gait: a.gait, special_tests: a.specialTests, therapist_notes: a.therapistNotes,
    goals: a.goals, plan: a.plan, suggested_sessions: a.suggestedSessions,
  }),
  plan: (r: any): TreatmentPlan => ({
    id: r.id, patientId: r.patient_id, serviceId: r.service_id ?? '', diagnosis: r.diagnosis ?? '', diagnosisRef: ref(r.diagnosis_condition_id, r.diagnosis_side),
    mainGoal: r.main_goal ?? '', shortTermGoals: r.short_term_goals ?? '', longTermGoals: r.long_term_goals ?? '', totalSessions: r.total_sessions,
    sessionsPerWeek: r.sessions_per_week, durationWeeks: r.duration_weeks, therapyType: r.therapy_type ?? '', exercises: r.exercises ?? '',
    devices: r.devices ?? '', therapistNotes: r.therapist_notes ?? '', notes: r.notes ?? '', price: num(r.price), progressPct: r.progress_pct,
    startDate: r.start_date, endDate: r.end_date ?? '', status: r.status, therapistId: r.therapist_id ?? null,
    createdBy: r.created_by ?? null, createdAt: r.created_at ? ts(r.created_at) : null, updatedAt: r.updated_at ? ts(r.updated_at) : null, updatedBy: r.updated_by ?? null,
    sessionDates: Array.isArray(r.session_dates) ? r.session_dates : null,
    patientAge: r.patient_age ?? null, painOnset: r.pain_onset ?? '', chiefComplaint: r.chief_complaint ?? '',
  }),
  package: (r: any): Package => ({
    id: r.id, patientId: r.patient_id, name: r.name, serviceIds: r.service_ids ?? [], totalSessions: r.total_sessions, usedSessions: r.used_sessions,
    price: num(r.price), startDate: r.start_date, expiryDate: r.expiry_date ?? '', status: r.status, kind: r.kind ?? null,
  }),
  packagePlan: (r: any): PackagePlan => ({
    id: r.id, name: r.name, serviceIds: r.service_ids ?? [], totalSessions: r.total_sessions, price: num(r.price), validDays: r.valid_days, active: r.active, kind: r.kind ?? null,
  }),
  planService: (r: any): PlanService => ({ id: r.id, name: r.name, active: r.active, offers: (r.offers ?? []).map((o: any) => ({ sessions: Number(o.sessions), price: Number(o.price) })), createdAt: ts(r.created_at) }),
  invoice: (r: any): Invoice => ({
    id: r.id, no: r.no, patientId: r.patient_id, appointmentId: r.appointment_id ?? null, packageId: r.package_id ?? null, serviceName: r.service_name ?? '',
    price: num(r.price), discount: num(r.discount), total: num(r.total), paid: num(r.paid), remaining: num(r.remaining), status: r.status, date: r.date,
    planId: r.plan_id ?? null, createdBy: r.created_by ?? null, note: r.note ?? '', discountCode: r.discount_code ?? null, sentAt: r.sent_at ? ts(r.sent_at) : null,
    taxRate: num(r.tax_rate), taxAmount: num(r.tax_amount),
    issuedBy: r.issued_by ?? null, issuedAt: r.issued_at ? ts(r.issued_at) : null, createdAt: r.created_at ? ts(r.created_at) : 0,
  }),
  payment: (r: any): Payment => ({
    id: r.id, invoiceId: r.invoice_id, patientId: r.patient_id, amount: num(r.amount), method: r.method, date: ts(r.date), note: r.note ?? '',
    createdBy: r.created_by ?? null, installmentNo: r.installment_no ?? null, installmentApprovedBy: r.installment_approved_by ?? null, voidedAt: r.voided_at ? ts(r.voided_at) : null, voidReason: r.void_reason ?? null,
  }),
  notification: (r: any): AppNotification => ({
    id: r.id, kind: r.kind, title: stripFileNoPrefix(r.title ?? ''), body: stripFileNoPrefix(r.body ?? ''), refId: r.ref_id ?? undefined, link: r.link ?? undefined, createdAt: ts(r.created_at), read: r.read,
  }),
  item: (r: any): InventoryItem => ({
    id: r.id, sku: r.sku, name: r.name, category: r.category ?? '', unit: r.unit, quantity: num(r.quantity), minQuantity: num(r.min_quantity),
    costPrice: num(r.cost_price), salePrice: num(r.sale_price), supplier: r.supplier ?? '', active: r.active, updatedAt: ts(r.updated_at),
  }),
  movement: (r: any): StockMovement => ({
    id: r.id, itemId: r.item_id, type: r.type, quantity: num(r.quantity), unitCost: num(r.unit_cost), reference: r.reference ?? '',
    employeeId: r.employee_id ?? null, date: ts(r.date), note: r.note ?? '',
  }),
  activity: (r: any): ActivityLog => ({ id: r.id, at: ts(r.at), employeeId: r.employee_id ?? null, patientId: r.patient_id ?? null, action: r.action }),
  discount: (r: any): DiscountCode => ({
    id: r.id, code: r.code, type: r.type, value: num(r.value), validFrom: r.valid_from, validTo: r.valid_to, maxUses: r.max_uses, usedCount: r.used_count, minAmount: num(r.min_amount),
    active: r.active, note: r.note ?? '', createdAt: ts(r.created_at),
  }),
  campaign: (r: any): Campaign => ({
    id: r.id, title: r.title, body: r.body, audience: r.audience, source: r.source ?? null, patientId: r.patient_id ?? null,
    discountCodeId: r.discount_code_id ?? null, recipients: r.recipients, delivered: r.delivered, createdAt: ts(r.created_at), createdBy: r.created_by ?? null,
  }),
  request: (r: any): StaffRequest => ({
    id: r.id, employeeId: r.employee_id, type: r.type, reason: r.reason, fromDate: r.from_date, toDate: r.to_date, fromTime: r.from_time ?? '',
    toTime: r.to_time ?? '', status: r.status, decisionNote: r.decision_note ?? '', decidedBy: r.decided_by ?? null, createdAt: ts(r.created_at),
    decidedAt: r.decided_at ? ts(r.decided_at) : null,
  }),
  ticket: (r: any): SupportTicket => ({
    id: r.id, no: r.no, subject: r.subject, description: r.description ?? '', category: r.category, priority: r.priority, status: r.status,
    createdBy: r.created_by ?? null, assignedTo: r.assigned_to ?? null, createdAt: ts(r.created_at), updatedAt: ts(r.updated_at),
  }),
  reply: (r: any): SupportReply => ({ id: r.id, ticketId: r.ticket_id, employeeId: r.employee_id ?? null, body: r.body, createdAt: ts(r.created_at) }),
  servicePrice: (r: any): ServicePrice => ({ id: r.id, serviceId: r.service_id, label: r.label, price: num(r.price), therapistId: r.therapist_id ?? null, active: r.active }),
  file: (r: any): PatientFile => ({ id: r.id, patientId: r.patient_id, planId: r.plan_id ?? null, appointmentId: r.appointment_id ?? null, uploadedBy: r.uploaded_by ?? null, uploadedByName: r.uploaded_by_name ?? '', filePath: r.file_path, fileName: r.file_name, fileType: r.file_type ?? '', sizeBytes: Number(r.size_bytes ?? 0), note: r.note ?? '', createdAt: ts(r.created_at) }),
  bodyRecord: (r: any): BodyRecord => ({ id: r.id, patientId: r.patient_id, appointmentId: r.appointment_id ?? null, sessionId: r.session_id ?? null, therapistId: r.therapist_id ?? null, regionId: r.region_id, conditionId: r.condition_id ?? null, side: r.side ?? null, problem: r.problem ?? '', diagnosis: r.diagnosis ?? '', severity: r.severity ?? 1, notes: r.notes ?? '', createdBy: r.created_by ?? null, createdAt: ts(r.created_at) }),
  audit: (r: any): AuditLog => ({ id: r.id, at: ts(r.at), userId: r.user_id ?? null, employeeId: r.employee_id ?? null, action: r.action, tableName: r.table_name, recordId: r.record_id ?? null, oldData: r.old_data ?? null, newData: r.new_data ?? null }),
  branch: (r: any): Branch => ({ id: r.id, name: r.name, city: r.city ?? '', district: r.district ?? '', address: r.address ?? '', phone: r.phone ?? '', active: r.active }),
};

// تحميل كل صفوف جدول (Supabase يحدّ الطلب الواحد بـ 1000 صف)
export async function fetchAll(table: string, order?: { col: string; asc?: boolean }, max = 20000): Promise<any[]> {
  const page = async (from: number, count = false) => {
    let q = supabase.from(table).select('*', count ? { count: 'exact' } : undefined).range(from, from + 999);
    if (order) q = q.order(order.col, { ascending: order.asc ?? true });
    const { data, error, count: total } = await q;
    if (error) throw new Error(error.message);
    return { data: data ?? [], total: total ?? null };
  };
  // الصفحة الأولى بتجيب العدد الكلي، وباقي الصفحات بتتحمّل بالتوازي بدل واحدة ورا التانية
  const first = await page(0, true);
  if (first.data.length < 1000) return first.data;
  const total = Math.min(first.total ?? max, max);
  const starts: number[] = [];
  for (let f = 1000; f < total; f += 1000) starts.push(f);
  const rest = await Promise.all(starts.map((f) => page(f)));
  return [first.data, ...rest.map((r) => r.data)].flat();
}

export function toMatrix(rows: Array<{ role: string; area: string; ops: string[] }>): PermissionMatrix {
  const m: any = { system_admin: {}, center_manager: {}, secretary: {}, therapist: {}, reception: {}, accountant: {} };
  for (const r of rows) (m[r.role] ??= {})[r.area as Area] = r.ops as Op[];
  return m as PermissionMatrix;
}

export function toCenter(c: any): CenterInfo {
  return {
    name: c.name, branchName: c.branch_name, city: c.city, district: c.district, phone: c.phone, workHours: c.work_hours ?? '',
    workStart: c.work_start, workEnd: c.work_end, weekSchedule: c.week_schedule ?? [], slotStepMin: c.slot_step_min,
    packageLowThreshold: c.package_low_threshold, reminderHoursBefore: c.reminder_hours_before, taxRate: num(c.tax_rate), foreignTaxRate: num(c.foreign_tax_rate ?? 15), marketingSince: c.marketing_since ?? null, vatNumber: c.vat_number ?? '',
    crNumber: c.cr_number ?? '', buildingNo: c.building_no ?? '', postalCode: c.postal_code ?? '',
    email: c.email ?? '', street: c.street ?? '', logoUrl: c.logo_url ?? '', currency: c.currency ?? 'SAR', defaultAppointmentMin: c.default_appointment_min ?? 30, cancelBeforeHours: c.cancel_before_hours ?? 24,
    loyaltySessionPoints: c.loyalty_session_points ?? 2, loyaltyPackagePoints: c.loyalty_package_points ?? 4, loyaltyRedeemCost: c.loyalty_redeem_cost ?? 30,
  };
}
