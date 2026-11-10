import type { Area, Op, Role } from '../types';
import { db } from '../data/db';
import { opsOf } from './defaultPermissions';

export type { Area, Op };

// صلاحيات إضافية للموظف المسجّل دخوله (فوق دوره) — بتتظبط بعد الدخول من /api/me
let myExtra: Partial<Record<Area, Op[]>> = {};
export function setMyExtraPerms(x: Partial<Record<Area, Op[]>> | undefined) { myExtra = x ?? {}; }
// صلاحيات مخصّصة للموظف المسجّل (من «الأدوار والصلاحيات» ← موظف محدد)
let myOverride: Partial<Record<Area, Op[]>> | null = null;
export function setMyPermOverride(x: Partial<Record<Area, Op[]>> | null | undefined) { myOverride = x ?? null; }

export function can(role: Role | undefined, area: Area, op: Op = 'view'): boolean {
  if (!role) return false;
  if (myExtra[area]?.includes(op)) return true;
  if (role === 'system_admin' && area === 'employees') return true; // لا يُقفل مدير النظام خارج إدارة الموظفين
  if (role === 'system_admin' && (area === 'roles' || area === 'employees')) return true; // لا يُقفل مدير النظام خارج إدارة الصلاحيات
  const roleM = db.permissions()[role];
  // صلاحيات الموظف المخصّصة بتحل محل الدور في الأقسام الموجودة فيها — والأقسام الجديدة بتتحسب من الاتنين مع بعض
  const m = role !== 'system_admin' && myOverride ? { ...roleM, ...myOverride } : roleM;
  return opsOf(m, area).includes(op);
}

export const ROLE_LABEL: Record<Role, string> = {
  system_admin: 'المدير العام',
  center_manager: 'مدير المركز',
  secretary: 'سكرتير المدير',
  reception: 'استقبال',
  accountant: 'محاسب',
  therapist: 'دكتور',
};

// اسم كل صلاحية = اسم القسم في القائمة الجانبية بالظبط. الصلاحيات اللي بتتحكم في زرار أو فلتر جوّه قسم بتبدأ باسم القسم «القسم: …»
export const AREA_LABEL: Record<Area, string> = {
  dashboard: 'الرئيسية',
  follow_ups: 'حجز كشف ومتابعة',
  patients: 'المرضى',
  online_accounts: 'المرضى: الحسابات الأونلاين وحجوزات المكالمات',
  patient_import: 'المرضى: استيراد من Excel',
  patient_export: 'المرضى: تصدير Excel',
  pt_f_gender: 'المرضى: فلتر «الجنس»', pt_f_source: 'المرضى: فلتر «مصدر المعرفة»', pt_f_doctor: 'المرضى: فلتر «الطبيب»', pt_f_status: 'المرضى: فلتر «الحالة»', pt_f_sort: 'المرضى: «الترتيب»',
  booking: 'حجز موعد', appointments: 'المواعيد',
  appt_confirm: 'المواعيد: تأكيد حضور الموعد', appt_cancel: 'المواعيد: إلغاء الموعد',
  services: 'الخدمات',
  diagnosis: 'تشخيص المريض',
  imaging: 'الأشعة والتحاليل',
  injections: 'الحقن',
  fractures: 'الكسور والجبس',
  surgeries: 'العمليات الجراحية',
  nursing: 'متابعة التمريض',
  medications: 'الأدوية',
  exercises: 'التمرينات العلاجية',
  invoices: 'الفواتير والمدفوعات',
  payments: 'المدفوعات (تسجيل الدفعات وتعديلها وحذفها)',
  inv_approve: 'الفواتير: اعتماد الفاتورة', inv_price: 'الفواتير: تعديل السعر والخصم', inv_cancel: 'الفواتير: إلغاء الفاتورة',
  expenses: 'المصروفات',
  financial: 'الأرقام المالية (الإيرادات والإجماليات)',
  payroll: 'الرواتب والفواتير والمدفوعات (المدير)',
  employees: 'الموظفون', therapists: 'الأطباء', attendance: 'الحضور والانصراف', requests: 'طلبات الموظفين', workhours: 'مواعيد العمل',
  inventory: 'المخزون', inv_overdraw: 'المخزون: صرف كمية أكبر من المتاح',
  campaigns: 'إرسال إشعارات للمرضى', whatsapp: 'رسائل واتساب للمرضى', support: 'الدعم الفني',
  reports: 'التقارير', marketing: 'تقرير التسويق', notifications: 'الإشعارات', roles: 'الأدوار والصلاحيات', settings: 'الإعدادات',
  // من نظام العلاج الطبيعي القديم أو اتشالت من البرنامج — مابتظهرش في شاشة الأدوار
  plans: 'خطط العلاج', sessions: 'الزيارات (النظام القديم)', packages: 'الباقات', pkg_checkin: 'حضور مرضى الباقات', physio: 'ملف العلاج الطبيعي',
  installments: 'طلبات تقسيط الباقات', discounts: 'أكواد الخصم', loyalty: 'نقاط الولاء', products: 'بيع المنتجات', bodymap: 'جسم الإنسان',
  'accounting.access': 'النظام المحاسبي: الدخول',
  'accounting.expenses.create': 'المحاسبة: تسجيل المصروفات',
  'accounting.expenses.approve': 'المحاسبة: اعتماد/إلغاء المصروفات',
  'accounting.purchases.manage': 'المحاسبة: المشتريات والموردون والمخزون',
  'accounting.payroll.view': 'المحاسبة: عرض الرواتب والسلف',
  'accounting.payroll.manage': 'المحاسبة: إدارة السلف والخصومات',
  'accounting.journals.create': 'المحاسبة: إنشاء القيود والخزائن والأصول',
  'accounting.journals.post': 'المحاسبة: ترحيل وعكس القيود',
  'accounting.reports.view': 'المحاسبة: التقارير المالية',
  'accounting.settings.manage': 'المحاسبة: إعدادات الحسابات',
  'accounting.periods.close': 'المحاسبة: إقفال الفترات',
};

export const OP_LABEL: Record<Op, string> = { view: 'اطلاع', create: 'إضافة', edit: 'تعديل', delete: 'حذف' };
export const OP_DESC: Record<Op, string> = {
  view: 'فتح الشاشة وعرض السجلات.', create: 'إنشاء سجل جديد في هذا القسم.', edit: 'تحرير سجل قائم.', delete: 'حذف سجل نهائيًا (إجراء ما يُسترجع).',
};

export const ROLE_ICON: Record<Role, string> = {
  system_admin: 'shield', center_manager: 'users', secretary: 'clipboard', reception: 'phone', accountant: 'wallet', therapist: 'stethoscope',
};
export const ROLE_DESC: Record<Role, string> = {
  system_admin: 'يملك كل الصلاحيات دائمًا في كل الأقسام، ويتحكم في الأدوار والصلاحيات. ما يمكن تقييده.',
  center_manager: 'يدير المركز بالكامل: المرضى والمواعيد والموظفين والفواتير والتقارير. ما يتحكم في الأدوار والصلاحيات.',
  secretary: 'يدير الحجز والمرضى والمواعيد، ويطّلع على التقارير والإشعارات.',
  reception: 'يدير استقبال المرضى والحجز والمواعيد والفواتير الأساسية.',
  accountant: 'يدير الفواتير والمدفوعات والمخزون والبيانات المالية والتقارير.',
  therapist: 'الدكتور: يرى مرضاه ومواعيده الخاصة فقط، ويكتب التشخيص والعمليات والأدوية والتمرينات.',
};

// المعالج يرى مرضاه ومواعيده فقط
export const isScopedToOwnPatients = (role: Role | undefined) => role === 'therapist';
