import type { Area, Op, PermissionMatrix, Role } from '../types';

// النظام المحاسبي: صلاحيات تفصيلية (view = مسموح) — لازم تطابق صفوف role_permissions في هجرة 191
export const ACC_AREAS: Area[] = ['accounting.access', 'accounting.expenses.create', 'accounting.expenses.approve', 'accounting.purchases.manage', 'accounting.payroll.view', 'accounting.payroll.manage', 'accounting.journals.create', 'accounting.journals.post', 'accounting.reports.view', 'accounting.settings.manage', 'accounting.periods.close'];
const ACC_MANAGER: Area[] = ['accounting.access', 'accounting.expenses.create', 'accounting.expenses.approve', 'accounting.purchases.manage', 'accounting.journals.create', 'accounting.journals.post', 'accounting.reports.view'];
const ACC_ACCOUNTANT: Area[] = ['accounting.access', 'accounting.expenses.create', 'accounting.purchases.manage', 'accounting.journals.create', 'accounting.journals.post', 'accounting.reports.view'];

// أقسام العظام والمصروفات: كل قسم ليه صلاحية لوحده (قبل كده كانوا كلهم تحت «المرضى» للعرض و«الزيارات» للإضافة والتعديل والحذف)
export const CLINICAL_AREAS: Area[] = ['diagnosis', 'imaging', 'injections', 'fractures', 'surgeries', 'nursing', 'medications', 'exercises'];
export const SECTION_AREAS: Area[] = ['follow_ups', ...CLINICAL_AREAS, 'expenses'];

export const AREAS: Area[] = [
  'dashboard', 'patients', 'online_accounts', 'patient_import', 'patient_export', 'booking', 'appointments', 'plans', 'sessions', 'services', 'therapists',
  ...SECTION_AREAS,
  'employees', 'invoices', 'payments', 'packages', 'inventory', 'reports', 'notifications', 'roles', 'settings', 'workhours', 'requests', 'support', 'discounts', 'campaigns', 'financial', 'attendance', 'loyalty', 'whatsapp', 'products', 'installments', 'physio', 'payroll','pkg_checkin', 'bodymap', 'marketing', 'pt_f_gender', 'pt_f_source', 'pt_f_doctor', 'pt_f_status', 'pt_f_sort',
  'inv_approve', 'inv_price', 'inv_cancel', 'inv_overdraw', 'appt_confirm', 'appt_cancel',
  ...ACC_AREAS,
];
export const OPS: Op[] = ['view', 'create', 'edit', 'delete'];

// الأقسام الجديدة: لو الدور (أو الموظف) ما اتحفظلوش قيمة ليها لسه، بتتحسب من الصلاحيات اللي كانت بتتحكم فيها قبل كده —
// عشان أي دور كان بيفتح القسم يفضل يفتحه بعد التحديث. أول ما المدير يحفظ شاشة الأدوار القيمة بتتسجّل صريحة.
// لكل عملية: الأقسام القديمة اللي لو أي واحد منها فيه نفس العملية تبقى مسموحة (نفس منطق هجرة 963 على الخادم)
type Legacy = Record<Op, Area[]>;
const CLINICAL_LEGACY: Legacy = { view: ['patients'], create: ['sessions'], edit: ['sessions'], delete: ['sessions'] };
export const LEGACY_AREAS: Partial<Record<Area, Legacy>> = {
  ...Object.fromEntries(CLINICAL_AREAS.map((a) => [a, CLINICAL_LEGACY])),
  follow_ups: { view: ['patients'], create: ['sessions', 'appointments'], edit: ['sessions', 'appointments'], delete: ['sessions'] },
  expenses: { view: ['financial'], create: ['financial'], edit: ['financial'], delete: ['financial'] },
};

/** عمليات قسم معيّن من مصفوفة دور/موظف — وللأقسام الجديدة اللي مالهاش قيمة محفوظة: من الأقسام القديمة */
export function opsOf(m: Partial<Record<Area, Op[]>> | undefined, area: Area): Op[] {
  if (!m) return [];
  if (area in m) return m[area] ?? [];
  const l = LEGACY_AREAS[area];
  return l ? OPS.filter((o) => l[o].some((src) => m[src]?.includes(o))) : [];
}
/** نفس المصفوفة + قيم الأقسام الجديدة المحسوبة (لشاشة الأدوار: الخانات تبان زي ما الصلاحية شغالة فعلًا) */
export function withLegacy(m: Partial<Record<Area, Op[]>>): Partial<Record<Area, Op[]>> {
  const out = { ...m };
  for (const a of Object.keys(LEGACY_AREAS) as Area[]) if (!(a in out)) out[a] = opsOf(m, a);
  return out;
}
export function withLegacyMatrix(m: PermissionMatrix): PermissionMatrix {
  return Object.fromEntries(Object.entries(m).map(([r, x]) => [r, withLegacy(x ?? {})])) as PermissionMatrix;
}

const ALL: Op[] = ['view', 'create', 'edit', 'delete'];
const VIEW: Op[] = ['view'];
const full = (areas: Area[]) => Object.fromEntries(areas.map((a) => [a, ALL])) as Partial<Record<Area, Op[]>>;

export const ROLES: Role[] = ['system_admin', 'center_manager', 'secretary', 'reception', 'accountant', 'therapist'];

export function defaultPermissions(): PermissionMatrix {
  const m: PermissionMatrix = {
    system_admin: full(AREAS),
    center_manager: { ...full(AREAS.filter((a) => a !== 'employees' && a !== 'roles' && a !== 'payroll' && !ACC_AREAS.includes(a))), employees: VIEW, ...Object.fromEntries(ACC_MANAGER.map((a) => [a, VIEW])) }, // الرواتب والتارجت للمدير العام بس
    secretary: {}, // بيتحسب تحت = استقبال + محاسب
    reception: {
      dashboard: VIEW, whatsapp: ['view', 'create'], patients: ['view', 'create', 'edit'], booking: ['view', 'create'], appointments: ['view', 'create', 'edit'],
      plans: ['view', 'create'], services: VIEW, invoices: ['view', 'create', 'edit'], payments: ['view', 'create', 'edit', 'delete'], notifications: ['view', 'edit'], workhours: VIEW, requests: ['view', 'create'], support: ['view', 'edit'], discounts: VIEW, attendance: VIEW, loyalty: ['view', 'create'], products: ['view', 'create'], physio: ['view', 'create', 'edit'], sessions: VIEW, therapists: VIEW, employees: VIEW, packages: VIEW, inventory: VIEW, reports: VIEW, settings: VIEW, campaigns: VIEW, installments: ['view', 'create'], // اطلاع على كل شيء ماعدا financial (الإيرادات)
    },
    accountant: {
      dashboard: VIEW, patients: VIEW, plans: ['view', 'create', 'edit'], invoices: ['view', 'create', 'edit'], payments: ['view', 'create', 'edit', 'delete'],
      packages: ['view', 'create', 'edit'], inventory: ['view', 'create', 'edit'], reports: VIEW, notifications: ['view', 'edit'], requests: ['view', 'create'], discounts: ['view', 'create', 'edit'], attendance: VIEW, loyalty: ['view', 'create'], products: ['view', 'create', 'edit'], installments: ['view', 'create'], physio: ['view', 'create', 'edit'],
    },
    therapist: {
      dashboard: VIEW, patients: ['view', 'edit'], appointments: ['view', 'edit'], plans: ['view', 'create', 'edit'],
      sessions: ['view', 'create', 'edit'], physio: ['view', 'create', 'edit'], inventory: VIEW, notifications: ['view', 'edit'], workhours: VIEW, requests: ['view', 'create'], attendance: VIEW,
    },
  };
  // سكرتير المدير = اتحاد صلاحيات الاستقبال والمحاسب (قسم roles للمدير العام بس)
  const sec: PermissionMatrix['secretary'] = {};
  for (const r of ['reception', 'accountant'] as const)
    for (const [a, ops] of Object.entries(m[r]) as [Area, Op[]][]) {
      if (a === 'roles' || a === 'financial' || a.startsWith('accounting.')) continue; // الإجماليات المالية والمحاسبة للمدير بس
      sec[a] = Array.from(new Set([...(sec[a] ?? []), ...ops]));
    }
  m.secretary = sec;
  for (const a of ACC_ACCOUNTANT) m.accountant[a] = VIEW;
  // الدكتور: كل أقسام العظام كاملة ما عدا الحذف — ومواعيد المتابعة إضافة وتعديل
  for (const a of CLINICAL_AREAS) m.therapist[a] = ['view', 'create', 'edit'];
  m.therapist.follow_ups = ['view', 'create', 'edit'];
  // الصلاحيات التفصيلية: كل دور عنده الصلاحية العامة الأصلية ياخدها افتراضيًا (المدير بيحدد بعد كده من شاشة الأدوار)
  for (const r of ROLES) {
    if (r === 'system_admin') continue;
    for (const [a, base] of [['inv_approve', 'invoices'], ['inv_price', 'invoices'], ['inv_cancel', 'invoices'], ['appt_confirm', 'appointments'], ['appt_cancel', 'appointments']] as const)
      if (m[r][base]?.includes('edit')) m[r][a] = ['view'];
  }
  // باقي الأقسام الجديدة (للاستقبال والمحاسب والسكرتير) بنفس اللي كانوا بيقدروا عليه قبل الفصل
  for (const r of ROLES) if (r !== 'system_admin') m[r] = withLegacy(m[r]);
  return m;
}
