// ===== أنواع البيانات — لوحة إدارة مركز العلاج الطبيعي =====
// كل Entity هنا يقابل جدولًا مستقبليًا بنفس الاسم والحقول تقريبًا.

export type Role = 'system_admin' | 'center_manager' | 'secretary' | 'therapist' | 'reception' | 'accountant';

export interface Employee {
  id: string;
  name: string;
  username: string;
  password: string; // نص صريح — نموذج أولي أمامي فقط
  role: Role;
  phone: string;
  active: boolean;
  createdAt: number;
  lastLogin: number | null;
  workHours?: WorkHours[];
  branchId?: string | null;
  therapistId?: string | null;
  jobTitle?: string;
  // صلاحيات إضافية للموظف نفسه فوق دوره (هجرة 118): واتساب / استبدال نقاط الولاء
  extraPerms?: Partial<Record<'whatsapp' | 'loyalty', Op[]>>;
  permOverride?: Partial<Record<Area, Op[]>> | null; // صلاحيات مخصّصة للموظف ده (بتحل محل دوره في الأقسام الموجودة فيها)
}

// تشخيص منظّم من مرجع الحالات المعتمد (PRD وحدة التشخيص)
export interface DiagnosisRef { conditionId: string; regionId: string; icd10: string; side: 'right' | 'left' | 'both' | null }

export type Gender = 'male' | 'female';

export type ReferralSource = 'instagram' | 'facebook' | 'twitter' | 'snapchat' | 'tiktok' | 'whatsapp' | 'google' | 'friend' | 'ad' | 'website' | 'other';

export interface Patient {
  id: string;
  isGuest?: boolean; // متصل حجز بالمكالمة — مخفي من «المرضى» لحد ما يتضاف يدويًا
  pendingSync?: boolean; // اتسجّل بدون إنترنت ولسه ما اتزامنش مع الخادم
  fileNo: string;
  fullName: string;
  phone: string;
  nationalId: string;
  birthDate: string;
  gender: Gender;
  address: string;
  referralSource: ReferralSource;
  emergencyContactName: string;
  emergencyContactPhone: string;
  notes: string;
  registeredAt: number;
  active: boolean;
  mainComplaint: string;
  diagnosis: string;
  medicalHistory: string;
  diagnosisRef?: DiagnosisRef | null;
  email?: string;
  city?: string;
  district?: string;
  street?: string;
  doctorId?: string | null;
  signupMethod?: 'google' | 'phone' | null;
  nationality?: 'saudi' | 'non_saudi';
  nationalityUnconfirmed?: boolean;
  genderUnknown?: boolean; // الجنس مش متسجّل (مرضى الملف القديم) — gender بيفضل 'male' كقيمة افتراضية للحسابات بس // جنسية اتحطت افتراضيًا وقت الاستيراد — لازم تتراجع
  firstName?: string; fatherName?: string; familyName?: string; // الاسم مقسّم — fullName = الأجزاء مع بعض // طريقة تسجيله في الموقع (null = اتضاف من الإدارة)
}

export type WorkDay = 'sun' | 'mon' | 'tue' | 'wed' | 'thu' | 'fri' | 'sat';
export interface WorkHours { day: WorkDay; from: string; to: string; breakFrom?: string; breakTo?: string }
export interface DaySchedule { day: WorkDay; open: boolean; from: string; to: string }
export interface Leave { from: string; to: string; reason: string }

export interface Therapist {
  id: string;
  name: string;
  title: string;
  phone: string;
  photo: string;
  serviceIds: string[];
  workHours: WorkHours[];
  onLeave: Leave[];
  active: boolean;
  branchId?: string | null;
  email?: string;
  bio?: string;
  photoUrl?: string;
  defaultDurationMin?: number;
}

export interface Service {
  id: string;
  name: string;
  category: string;
  description: string;
  price: number;
  durationMin: number;
  therapistIds: string[];
  active: boolean;
  /** يظهر في الموقع العام وبوابة المريض (false = للإدارة بس) */
  showOnSite: boolean;
  /** محذوفة (فيها سجلات قديمة) — مخفية من القوائم، والاسم يفضل ظاهر في المواعيد والفواتير القديمة */
  deleted?: boolean;
  branchId?: string | null;
}

export interface Room {
  id: string;
  name: string;
  no: string;
  type: string;
  status: 'available' | 'maintenance';
}

export type AppointmentType = 'initial' | 'session' | 'followup' | 'rehab' | 'home';
export type AppointmentStatus = 'new' | 'confirmed' | 'on_way' | 'arrived' | 'in_progress' | 'no_show' | 'completed' | 'cancelled' | 'rescheduled';
export type VisitLocation = 'center' | 'home';

export interface Appointment {
  id: string;
  no: string;
  patientId: string;
  type: AppointmentType;
  serviceId: string;
  therapistId: string;
  roomId: string; // فارغ للزيارات المنزلية
  location: VisitLocation;
  address: string; // عنوان الزيارة المنزلية
  date: string;
  time: string;
  durationMin: number;
  status: AppointmentStatus;
  price: number;
  packageId: string | null;
  planId: string | null;
  seriesId: string | null;
  cancelReason: string | null;
  createdAt: number;
  updatedAt: number;
  branchId?: string | null;
  notes?: string;
  source?: 'staff' | 'online'; // online = حجزه المريض بنفسه من الموقع/البوابة
  // مين حجز/لغى (بيتسجّل على الخادم بتريجر — هجرة 166). الاسم والوظيفة لقطة وقت العملية.
  createdByKind?: ActorKind | null;
  createdByName?: string | null;
  createdByRole?: string | null;
  pendingSync?: boolean; // اتسجّل/اتعدّل بدون إنترنت ولسه ما اتزامنش مع الخادم
  cancelledAt?: number | null;
  cancelledByKind?: ActorKind | null;
  cancelledByName?: string | null;
  cancelledByRole?: string | null;
}

export type ActorKind = 'staff' | 'patient' | 'system';

export type SessionStatus = 'scheduled' | 'in_progress' | 'completed' | 'cancelled';

export interface TreatmentSession {
  id: string;
  appointmentId: string;
  patientId: string;
  therapistId: string;
  planId: string | null;
  sessionNo: number;
  date: string;
  status: SessionStatus;
  painLevel: number | null;
  subject?: string;               // موضوع الجلسة
  painScale?: number | null;      // مقياس الألم 1–10
  therapistNotes: string;
  treatmentUsed: string;
  devicesUsed: string;
  exercises: string;
  patientResponse: string;
  nextPlan: string;
  startedAt: number | null;
  completedAt: number | null;
}

export interface InitialAssessment {
  id: string;
  patientId: string;
  date: number;
  mainComplaint: string;
  onsetDate: string;
  medicalHistory: string;
  priorInjuries: string;
  priorSurgeries: string;
  medications: string;
  allergies: string;
  medicalDiagnosis: string;
  diagnosisRef?: DiagnosisRef | null;
  painLevel: number;
  rom: string;
  muscleStrength: string;
  balance: string;
  gait: string;
  specialTests: string;
  therapistNotes: string;
  goals: string;
  plan: string;
  suggestedSessions: number;
}

export type PlanStatus = 'active' | 'completed' | 'paused';

export interface TreatmentPlan {
  id: string;
  patientId: string;
  serviceId: string;
  diagnosis: string;
  diagnosisRef?: DiagnosisRef | null;
  mainGoal: string;
  patientAge?: number | null; // عمر المريض وقت الخطة
  painOnset?: string; // بداية ظهور الألم — وصف نصي لإزاي بدأ الألم (الخطط القديمة ممكن يكون فيها تاريخ)
  chiefComplaint?: string; // شكوى المريض
  shortTermGoals: string;
  longTermGoals: string;
  sessionDates?: string[] | null; // مواعيد الجلسات المعدّلة يدويًا (null = محسوبة من تاريخ أول جلسة)
  totalSessions: number;
  sessionsPerWeek: number;
  durationWeeks: number;
  therapyType: string;
  exercises: string;
  devices: string;
  therapistNotes: string;
  notes: string;
  price: number;
  progressPct: number;
  startDate: string;
  endDate: string;
  status: PlanStatus;
  therapistId?: string | null;
  createdBy?: string | null;
  createdAt?: number | null;
  updatedAt?: number | null;
  updatedBy?: string | null;
}

export interface Package {
  id: string;
  patientId: string;
  name: string;
  serviceIds: string[];
  totalSessions: number;
  usedSessions: number;
  price: number;
  startDate: string;
  expiryDate: string;
  status: 'pending_payment' | 'active' | 'expired' | 'completed' | 'cancelled';
  kind?: PackageKind | null;
}
/** الباقات الثابتة اللي عليها Workflow الدفع الكامل / الدفع على دفعتين بموافقة المدير */
export type PackageKind = 'pkg4' | 'pkg6';

export interface PlanOffer { sessions: number; price: number }
export interface PlanService { id: string; name: string; active: boolean; offers: PlanOffer[]; createdAt: number }

export interface PackagePlan {
  id: string;
  name: string;
  serviceIds: string[];
  totalSessions: number;
  price: number;
  validDays: number;
  active: boolean;
  kind?: PackageKind | null;
}

export type PaymentMethod = 'cash' | 'mada' | 'card' | 'cash_atm' | 'apple_pay' | 'stc_pay' | 'urpay' | 'transfer' | 'sadad' | 'tabby' | 'tamara' | 'cheque' | 'other' | 'online';
export type InvoiceStatus = 'draft' | 'paid' | 'partial' | 'due' | 'cancelled';

export interface Invoice {
  id: string;
  issuedBy?: string | null;   // مين أتمّ/اعتمد الفاتورة (draft → due)
  issuedAt?: number | null;
  createdAt?: number;         // وقت الإنشاء الفعلي — الترتيب الافتراضي «الأحدث أولًا»
  no: string;
  patientId: string;
  appointmentId: string | null;
  packageId: string | null;
  serviceName: string;
  price: number;
  discount: number;
  total: number;
  paid: number;
  remaining: number;
  status: InvoiceStatus;
  date: string;
  planId?: string | null;
  createdBy?: string | null;
  note?: string;
  discountCode?: string | null;
  sentAt?: number | null;
  taxRate?: number;
  taxAmount?: number;
}

export type DiscountType = 'percent' | 'fixed';
export interface DiscountCode {
  id: string;
  code: string;
  type: DiscountType;
  value: number;
  validFrom: string;
  validTo: string;
  maxUses: number;
  usedCount: number;
  minAmount?: number;
  active: boolean;
  note: string;
  createdAt: number;
}

export type CampaignAudience = 'all' | 'with_account' | 'source' | 'patient' | 'new' | 'active_plan' | 'inactive' | 'has_sessions' | 'has_exam';
export interface Campaign {
  id: string;
  title: string;
  body: string;
  audience: CampaignAudience;
  source: ReferralSource | null;
  patientId: string | null;
  discountCodeId: string | null;
  recipients: number;
  delivered: number;
  createdAt: number;
  createdBy: string | null;
}

export interface Payment {
  id: string;
  invoiceId: string;
  patientId: string;
  amount: number;
  method: PaymentMethod;
  date: number;
  note: string;
  createdBy?: string | null;
  installmentNo?: 1 | 2 | null;   // دفعات باقات 4/6 جلسات بالتقسيط
  installmentApprovedBy?: string | null; // المدير اللي وافق على التقسيط
  voidedAt?: number | null;        // دفعة ملغاة (محفوظة في السجل، مش محسوبة)
  voidReason?: string | null;
}

export type NotificationKind =
  | 'appointment_soon' | 'appointment_new' | 'appointment_cancelled' | 'appointment_rescheduled'
  | 'package_low' | 'package_expiring' | 'payment_due' | 'no_show' | 'visit_on_way' | 'stock_low' | 'user'
  | 'patient_new' | 'staff_request' | 'invoice' | 'target_progress' | 'target_reached';

export interface AppNotification {
  id: string;
  kind: NotificationKind;
  title: string;
  body: string;
  refId?: string;
  link?: string; // مسار داخلي يُفتح عند الضغط
  createdAt: number;
  read: boolean;
}

export interface InventoryItem {
  id: string;
  sku: string;
  name: string;
  category: string;
  unit: string;
  quantity: number;
  minQuantity: number;
  costPrice: number;
  salePrice: number;
  supplier: string;
  active: boolean;
  updatedAt: number;
}

export type StockMovementType = 'purchase' | 'issue' | 'adjust_in' | 'adjust_out';

export interface StockMovement {
  id: string;
  itemId: string;
  type: StockMovementType;
  quantity: number; // دائمًا موجب — الاتجاه من النوع
  unitCost: number;
  reference: string; // رقم فاتورة شراء / اسم المريض / سبب
  employeeId: string | null;
  date: number;
  note: string;
}

export type StaffRequestType = 'leave' | 'permission' | 'other';
export type StaffRequestStatus = 'pending' | 'approved' | 'rejected';
export interface StaffRequest {
  id: string;
  employeeId: string;
  type: StaffRequestType; // إجازة (أيام) أو استئذان (ساعات في يوم واحد)
  reason: string;
  fromDate: string;
  toDate: string;
  fromTime: string;
  toTime: string;
  status: StaffRequestStatus;
  decisionNote: string;
  decidedBy: string | null;
  createdAt: number;
  decidedAt: number | null;
}

export interface ActivityLog {
  id: string;
  at: number;
  employeeId: string | null;
  patientId: string | null;
  action: string;
}

export interface CenterInfo {
  foreignTaxRate?: number; // ضريبة المرضى غير السعوديين %
  marketingSince?: string | null; // بداية عدّ كارت «من أين يأتي العملاء؟»
  name: string;
  branchName: string;
  city: string;
  district: string;
  phone: string;
  workHours: string;
  workStart: string;
  workEnd: string;
  weekSchedule: DaySchedule[];
  slotStepMin: number;
  packageLowThreshold: number;
  reminderHoursBefore: number;
  taxRate?: number;
  vatNumber?: string;
  crNumber?: string;
  buildingNo?: string;
  postalCode?: string;
  email?: string;
  street?: string;
  logoUrl?: string;
  currency?: string;
  defaultAppointmentMin?: number;
  cancelBeforeHours?: number;
  loyaltySessionPoints?: number;
  loyaltyPackagePoints?: number;
  loyaltyRedeemCost?: number;
}

export interface ServicePrice { id: string; serviceId: string; label: string; price: number; therapistId: string | null; active: boolean }
export interface PatientFile { id: string; patientId: string; planId?: string | null; appointmentId?: string | null; uploadedBy: string | null; uploadedByName: string; filePath: string; fileName: string; fileType: string; sizeBytes: number; note: string; createdAt: number }
export interface BodyRecord { id: string; patientId: string; appointmentId: string | null; sessionId: string | null; therapistId: string | null; regionId: string; conditionId: string | null; side: 'right' | 'left' | 'both' | null; problem: string; diagnosis: string; severity: number; notes: string; createdBy: string | null; createdAt: number }
export interface AuditLog { id: number; at: number; userId: string | null; employeeId: string | null; action: string; tableName: string; recordId: string | null; oldData: any; newData: any }

export interface Branch { id: string; name: string; city: string; district: string; address: string; phone: string; active: boolean }

export type AttendanceStatus = 'compliant' | 'non_compliant' | 'absent' | 'no_schedule';
export interface AttendanceRow { employeeId: string; employeeName: string; role: Role; date: string; checkIn: string | null; checkOut: string | null; status: AttendanceStatus }

export type LoyaltyKind = 'session' | 'plan_session' | 'package' | 'redeem' | 'adjust' | 'reversal';
export interface LoyaltyLedgerRow { id: string; patientId: string; patientName: string; kind: LoyaltyKind; points: number; reason: string; balanceAfter: number; employeeName: string | null; discountCode: string | null; createdAt: string }
export type LoyaltyCodeStatus = 'unused' | 'used' | 'cancelled' | 'expired';
export interface LoyaltyCodeRow {
  id: string; code: string; patientId: string; patientName: string; reward: number; createdAt: string; status: LoyaltyCodeStatus;
  usedAt: string | null; usedByName: string | null; pointsUsed: number; cancelReason: string | null;
  beneficiaryName: string | null; beneficiaryPhone: string | null; beneficiaryRelation: string | null;
}
export interface LoyaltySummary { balance: number; totalEarned: number; totalRedeemed: number; redemptionsCount: number; availableRewards: number; redeemCost: number }

export type TicketPriority = 'low' | 'medium' | 'high' | 'urgent';
export type TicketStatus = 'open' | 'in_progress' | 'resolved' | 'closed';
export interface SupportTicket { id: string; no: string; subject: string; description: string; category: string; priority: TicketPriority; status: TicketStatus; createdBy: string | null; assignedTo: string | null; createdAt: number; updatedAt: number }
export interface SupportReply { id: string; ticketId: string; employeeId: string | null; body: string; createdAt: number }

// صلاحيات دقيقة لكل دور × قسم × عملية
export type Area =
  | 'dashboard' | 'patients' | 'booking' | 'appointments' | 'plans' | 'sessions'
  | 'services' | 'therapists' | 'employees' | 'invoices' | 'payments' | 'packages'
  | 'inventory' | 'reports' | 'notifications' | 'roles' | 'settings' | 'workhours' | 'requests' | 'support' | 'discounts' | 'campaigns' | 'financial' | 'attendance' | 'loyalty' | 'whatsapp' | 'products' | 'installments' | 'physio' | 'payroll' | 'mytarget' | 'pkg_checkin' | 'bodymap' | 'marketing' | 'patient_import' | 'patient_export' | 'online_accounts'
  | 'pt_f_gender' | 'pt_f_source' | 'pt_f_doctor' | 'pt_f_status' | 'pt_f_sort'
  | 'inv_approve' | 'inv_price' | 'inv_cancel' | 'appt_confirm' | 'appt_cancel'
  | 'accounting.access' | 'accounting.expenses.create' | 'accounting.expenses.approve' | 'accounting.purchases.manage' | 'accounting.payroll.view' | 'accounting.payroll.manage' | 'accounting.journals.create' | 'accounting.journals.post' | 'accounting.reports.view' | 'accounting.settings.manage' | 'accounting.periods.close';
export type Op = 'view' | 'create' | 'edit' | 'delete';
export type PermissionMatrix = Record<Role, Partial<Record<Area, Op[]>>>;

export interface Database {
  version: number;
  center: CenterInfo;
  employees: Employee[];
  patients: Patient[];
  therapists: Therapist[];
  services: Service[];
  rooms: Room[];
  appointments: Appointment[];
  sessions: TreatmentSession[];
  assessments: InitialAssessment[];
  plans: TreatmentPlan[];
  packagePlans: PackagePlan[];
  planServices: PlanService[];
  packages: Package[];
  invoices: Invoice[];
  payments: Payment[];
  notifications: AppNotification[];
  inventory: InventoryItem[];
  stockMovements: StockMovement[];
  activity: ActivityLog[];
  staffRequests: StaffRequest[];
  discountCodes: DiscountCode[];
  campaigns: Campaign[];
  branches: Branch[];
  servicePrices: ServicePrice[];
  tickets: SupportTicket[];
  replies: SupportReply[];
  permissions: PermissionMatrix;
  counters: { patient: number; appointment: number; invoice: number; item: number };
}
