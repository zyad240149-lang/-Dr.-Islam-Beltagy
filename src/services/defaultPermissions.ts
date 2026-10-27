import type { Area, Op, PermissionMatrix, Role } from '../types';

// النظام المحاسبي: صلاحيات تفصيلية (view = مسموح) — لازم تطابق صفوف role_permissions في هجرة 191
export const ACC_AREAS: Area[] = ['accounting.access', 'accounting.expenses.create', 'accounting.expenses.approve', 'accounting.purchases.manage', 'accounting.payroll.view', 'accounting.payroll.manage', 'accounting.journals.create', 'accounting.journals.post', 'accounting.reports.view', 'accounting.settings.manage', 'accounting.periods.close'];
const ACC_MANAGER: Area[] = ['accounting.access', 'accounting.expenses.create', 'accounting.expenses.approve', 'accounting.purchases.manage', 'accounting.journals.create', 'accounting.journals.post', 'accounting.reports.view'];
const ACC_ACCOUNTANT: Area[] = ['accounting.access', 'accounting.expenses.create', 'accounting.purchases.manage', 'accounting.journals.create', 'accounting.journals.post', 'accounting.reports.view'];

export const AREAS: Area[] = [
  'dashboard', 'patients', 'booking', 'appointments', 'plans', 'sessions', 'services', 'therapists',
  'employees', 'invoices', 'payments', 'packages', 'inventory', 'reports', 'notifications', 'roles', 'settings', 'workhours', 'requests', 'support', 'discounts', 'campaigns', 'financial', 'attendance', 'loyalty', 'whatsapp', 'products', 'installments', 'physio', 'payroll', 'mytarget', 'pkg_checkin', 'bodymap', 'marketing', 'pt_f_gender', 'pt_f_source', 'pt_f_doctor', 'pt_f_status', 'pt_f_sort',
  'inv_approve', 'inv_price', 'inv_cancel', 'appt_confirm', 'appt_cancel',
  ...ACC_AREAS,
];
export const OPS: Op[] = ['view', 'create', 'edit', 'delete'];

const ALL: Op[] = ['view', 'create', 'edit', 'delete'];
const VIEW: Op[] = ['view'];
const full = (areas: Area[]) => Object.fromEntries(areas.map((a) => [a, ALL])) as Partial<Record<Area, Op[]>>;

export const ROLES: Role[] = ['system_admin', 'center_manager', 'secretary', 'reception', 'accountant', 'therapist'];

export function defaultPermissions(): PermissionMatrix {
  const m: PermissionMatrix = {
    system_admin: full(AREAS),
    center_manager: { ...full(AREAS.filter((a) => a !== 'employees' && a !== 'roles' && a !== 'payroll' && a !== 'mytarget' && !ACC_AREAS.includes(a))), employees: VIEW, ...Object.fromEntries(ACC_MANAGER.map((a) => [a, VIEW])) }, // الرواتب والتارجت للمدير العام بس
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
      sessions: ['view', 'create', 'edit'], physio: ['view', 'create', 'edit'], inventory: VIEW, notifications: ['view', 'edit'], workhours: VIEW, requests: ['view', 'create'], attendance: VIEW, mytarget: VIEW,
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
  // الصلاحيات التفصيلية: كل دور عنده الصلاحية العامة الأصلية ياخدها افتراضيًا (المدير بيحدد بعد كده من شاشة الأدوار)
  for (const r of ROLES) {
    if (r === 'system_admin') continue;
    for (const [a, base] of [['inv_approve', 'invoices'], ['inv_price', 'invoices'], ['inv_cancel', 'invoices'], ['appt_confirm', 'appointments'], ['appt_cancel', 'appointments']] as const)
      if (m[r][base]?.includes('edit')) m[r][a] = ['view'];
  }
  return m;
}
