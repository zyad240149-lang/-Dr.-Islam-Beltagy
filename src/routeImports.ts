// مصدر واحد لدوال import() الخاصة بكل صفحة يُحمَّل كودها عند الطلب (code-splitting) —
// تُستخدم في App.tsx لتعريف React.lazy، وفي Layout.tsx لتحميل الكود مسبقًا (prefetch)
// عند تمرير الفأرة على رابط القائمة الجانبية، حتى يبدو التنقل فوريًا عند الضغط الفعلي.
export const ROUTE_IMPORTS: Record<string, () => Promise<unknown>> = {
  '/': () => import('./pages/Dashboard'),
  '/patients': () => import('./pages/Patients'),
  '/booking': () => import('./pages/Booking'),
  '/appointments': () => import('./pages/Appointments'),
  '/body-map': () => import('./pages/BodyMap'),
  '/services': () => import('./pages/Services'),
  '/employees': () => import('./pages/Staff'),
  '/attendance': () => import('./pages/Attendance'),
  '/requests': () => import('./pages/Requests'),
  '/work-hours': () => import('./pages/WorkHours'),
  '/invoices': () => import('./pages/Invoices'),
  '/finance': () => import('./pages/Finance'),
  '/payroll': () => import('./pages/Payroll'),
  '/payroll/staff': () => import('./pages/PayrollStaff'),
  '/payroll/reports': () => import('./pages/PayrollReports'),
  '/discounts': () => import('./pages/Discounts'),
  '/loyalty': () => import('./pages/Loyalty'),
  '/support': () => import('./pages/Support'),
  '/campaigns': () => import('./pages/Campaigns'),
  '/reports': () => import('./pages/Reports'),
  '/notifications': () => import('./pages/Notifications'),
  '/roles': () => import('./pages/Roles'),
  '/settings': () => import('./pages/Settings'),
};

// تحميل مسبق آمن: يتجاهل أخطاء الشبكة (فشل الـ prefetch ليس مشكلة — سيُعاد المحاولة عند التنقل الفعلي).
export function prefetchRoute(path: string) {
  const base = path.split('?')[0];
  ROUTE_IMPORTS[base]?.().catch(() => {});
}
