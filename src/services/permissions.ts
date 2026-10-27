import type { Area, Op, Role } from '../types';
import { db } from '../data/db';

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
  if (role !== 'system_admin' && myOverride && area in myOverride) return myOverride[area]?.includes(op) ?? false;
  return db.permissions()[role]?.[area]?.includes(op) ?? false;
}

export const ROLE_LABEL: Record<Role, string> = {
  system_admin: 'المدير العام',
  center_manager: 'مدير المركز',
  secretary: 'سكرتير المدير',
  reception: 'استقبال',
  accountant: 'محاسب',
  therapist: 'أخصائي علاج طبيعي',
};

export const AREA_LABEL: Record<Area, string> = {
  dashboard: 'لوحة التحكم', patients: 'المرضى', booking: 'حجز موعد', appointments: 'المواعيد', plans: 'خطط العلاج',
  sessions: 'الجلسات', services: 'الخدمات', therapists: 'المعالجون', employees: 'الموظفون',
  invoices: 'الفواتير والمدفوعات', payments: 'عمليات الدفع (تعديل/حذف دفعة)', packages: 'الباقات', inventory: 'المخزون', reports: 'التقارير',
  notifications: 'الإشعارات', roles: 'الأدوار والصلاحيات', settings: 'الإعدادات', workhours: 'مواعيد العمل', requests: 'طلبات الموظفين', support: 'الدعم الفني', discounts: 'أكواد الخصم', campaigns: 'إشعارات المرضى', financial: 'البيانات المالية (الإيرادات والتقارير المالية)', attendance: 'الحضور والانصراف', loyalty: 'نقاط الولاء', products: 'بيع المنتجات', installments: 'طلبات تقسيط الباقات (الموافقة = تعديل)', inv_approve: 'زر: اعتماد الفاتورة (اطلاع = مسموح)', inv_price: 'زر: تعديل سعر/خصم الفاتورة (اطلاع = مسموح)', inv_cancel: 'زر: إلغاء الفاتورة (اطلاع = مسموح)', appt_confirm: 'زر: تأكيد حضور الموعد (اطلاع = مسموح)', appt_cancel: 'زر: إلغاء الموعد (اطلاع = مسموح)',
  payroll: 'الرواتب والتارجت والفواتير الشاملة (للمدير العام فقط)',
  mytarget: 'تارجتي هالشهر (لوحة الأخصائي الشخصية)',
  whatsapp: 'إرسال رسائل واتساب للعملاء',
  pkg_checkin: 'حضور مرضى الباقات', bodymap: 'جسم الإنسان', marketing: 'تقرير التسويق', online_accounts: 'حسابات المرضى الأونلاين',
  pt_f_gender: 'صفحة المرضى: فلتر «الجنس» (اطلاع = يظهر)', pt_f_source: 'صفحة المرضى: فلتر «مصدر المعرفة» (اطلاع = يظهر)', pt_f_doctor: 'صفحة المرضى: فلتر «الطبيب» (اطلاع = يظهر)', pt_f_status: 'صفحة المرضى: فلتر «الحالة» نشط/معطّل (اطلاع = يظهر)', pt_f_sort: 'صفحة المرضى: «الترتيب» (اطلاع = يظهر)',
  patient_import: 'استيراد المرضى من Excel (إضافة = تنفيذ الاستيراد)',
  patient_export: 'تصدير ملف المرضى (Excel) (اطلاع = يظهر الزر ويُصدّر)',
  physio: 'ملف العلاج الطبيعي (بيانات طبية: التقييم والخطة والأهداف وملاحظات التقدّم)',
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
  secretary: 'يدير الحجز والمرضى والمواعيد والخطط العلاجية، ويطّلع على التقارير والإشعارات.',
  reception: 'يدير استقبال المرضى والحجز والمواعيد والفواتير الأساسية.',
  accountant: 'يدير الفواتير والمدفوعات والباقات والمخزون والبيانات المالية والتقارير.',
  therapist: 'يرى مرضاه ومواعيده وجلساته وخططه العلاجية الخاصة فقط.',
};

// المعالج يرى مرضاه ومواعيده فقط
export const isScopedToOwnPatients = (role: Role | undefined) => role === 'therapist';
