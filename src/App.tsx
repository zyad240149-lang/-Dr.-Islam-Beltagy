import { lazy, Suspense } from 'react';
import { Navigate, Route, Routes, useLocation } from 'react-router-dom';
import { useAuth } from './services/auth';
import { can, type Area } from './services/permissions';
import Layout from './components/Layout';
import { Icon } from './utils/icons';
import { EmptyState } from './components/ui';
import { ErrorBoundary } from './components/ErrorBoundary';
import PatientLayout from './components/PatientLayout';
const AppLogin = lazy(() => import('./pwa/AppLogin'));
import { PatientDashboard, PatientBook, PatientAppointments, PatientFilePage, PatientExams, PatientPlans, PatientPoints, PatientInvoices, PatientNotifications } from './pages/patient/PatientPages';

// كل صفحة تُحمَّل بكودها الخاص عند أول زيارة لها فقط (code-splitting) — يقلل حجم الحزمة الأولى ويسرّع التنقل بدل تحميل كل الصفحات دفعة واحدة.
// نفس مسارات import() مكرَّرة (بنيّة) في routeImports.ts لتحميلها مسبقًا (prefetch) عند تمرير الفأرة
// على رابط القائمة — لا مشكلة في التكرار: Vite يبني نفس الملف/الـ chunk مهما تعدّدت أماكن استدعاء import().
const Dashboard = lazy(() => import('./pages/Dashboard'));
const Booking = lazy(() => import('./pages/Booking'));
const Patients = lazy(() => import('./pages/Patients'));
const PatientProfile = lazy(() => import('./pages/PatientProfile'));
const Appointments = lazy(() => import('./pages/Appointments'));
const Sessions = lazy(() => import('./pages/Sessions'));
const Services = lazy(() => import('./pages/Services'));
const Staff = lazy(() => import('./pages/Staff'));
const BodyMap = lazy(() => import('./pages/BodyMap'));
const Requests = lazy(() => import('./pages/Requests'));
const Support = lazy(() => import('./pages/Support'));
const Discounts = lazy(() => import('./pages/Discounts'));
const Campaigns = lazy(() => import('./pages/Campaigns'));
const WorkHours = lazy(() => import('./pages/WorkHours'));
const Invoices = lazy(() => import('./pages/Invoices'));
const Reports = lazy(() => import('./pages/Reports'));
const Notifications = lazy(() => import('./pages/Notifications'));
const Roles = lazy(() => import('./pages/Roles'));
const Settings = lazy(() => import('./pages/Settings'));
const Attendance = lazy(() => import('./pages/Attendance'));
const Loyalty = lazy(() => import('./pages/Loyalty'));
const ProductSales = lazy(() => import('./pages/ProductSales'));
const Installments = lazy(() => import('./pages/Installments'));
const MarketingReport = lazy(() => import('./pages/MarketingReport'));
const Payroll = lazy(() => import('./pages/Payroll'));
const PayrollStaff = lazy(() => import('./pages/PayrollStaff'));
const PayrollReports = lazy(() => import('./pages/PayrollReports'));
const MyTarget = lazy(() => import('./pages/MyTarget'));
const Finance = lazy(() => import('./pages/Finance'));
const Account = lazy(() => import('./pages/Account'));
const Consultations = lazy(() => import('./ortho/Consultations'));
const Imaging = lazy(() => import('./ortho/Imaging'));
const Fractures = lazy(() => import('./ortho/Fractures'));
const Surgeries = lazy(() => import('./ortho/Surgeries'));
const Diagnosis = lazy(() => import('./ortho/Diagnosis'));
const Landing = lazy(() => import('./landing/Landing'));
const SignUp = lazy(() => import('./pwa/SignUp'));

// شاشة الدخول داخل النظام نفسه
function GoToSiteLogin() {
  return <Suspense fallback={<FullLoader />}><AppLogin /></Suspense>;
}

function FullLoader() {
  return <div style={{ minHeight: '100vh', display: 'grid', placeItems: 'center' }}><Icon name="refresh" size={34} className="spin" /></div>;
}

// أثناء تحميل كود صفحة لم تُزَر بعد في هذه الجلسة (code-splitting) — داخل منطقة المحتوى فقط،
// حتى تبقى الشريحة الجانبية والهيدر ظاهرين دون أي "فلاش" لشاشة فارغة يُشعر بالبطء عند التنقل.
function PageLoader() {
  return <div className="page" style={{ minHeight: 320, display: 'grid', placeItems: 'center' }}><Icon name="refresh" size={28} className="spin" /></div>;
}

// الصفحة الرئيسية: الزائر يشوف صفحة الهبوط، والموظف المسجّل يشوف لوحة التحكم
function HomeGate() {
  const { user, patient, loading } = useAuth();
  if (loading) return <FullLoader />;
  if (!user && !patient) return <Suspense fallback={<FullLoader />}><Landing /></Suspense>;
  return <Protected area="dashboard"><Dashboard /></Protected>;
}

function Protected({ area, anyOf, children }: { area: Area; anyOf?: Area[]; children: JSX.Element }) {
  const { user, patient, loading } = useAuth();
  const location = useLocation();
  if (loading) return <FullLoader />;
  if (!user && patient) return <Navigate to="/me" replace />;
  if (!user) return <Navigate to="/login" replace state={{ from: location.pathname }} />;
  if (!(anyOf ?? [area]).some((a) => can(user.role, a))) {
    return <Layout><div className="page"><EmptyState icon="alert" title="ما فيه صلاحية" text="لا تملك صلاحية الوصول إلى هذا القسم." /></div></Layout>;
  }
  return <Layout><ErrorBoundary key={location.pathname} label={location.pathname}><Suspense fallback={<PageLoader />}>{children}</Suspense></ErrorBoundary></Layout>;
}

const ROUTES: { path: string; area: Area; anyOf?: Area[]; el: JSX.Element }[] = [
  { path: '/', area: 'dashboard', el: <Dashboard /> },
  { path: '/patients', area: 'patients', el: <Patients /> },
  { path: '/patients/:id', area: 'patients', el: <PatientProfile /> },
  { path: '/booking', area: 'booking', el: <Booking /> },
  { path: '/appointments', area: 'appointments', el: <Appointments /> },
  { path: '/body-map', area: 'bodymap', el: <BodyMap /> },
  { path: '/sessions', area: 'sessions', el: <Sessions /> },
  { path: '/services', area: 'services', el: <Services /> },
  { path: '/diagnosis', area: 'patients', el: <Diagnosis /> },
  { path: '/consultations', area: 'patients', el: <Consultations /> },
  { path: '/imaging', area: 'patients', el: <Imaging /> },
  { path: '/fractures', area: 'patients', el: <Fractures /> },
  { path: '/surgeries', area: 'patients', el: <Surgeries /> },
  { path: '/employees', area: 'employees', el: <Staff /> },
  { path: '/work-hours', area: 'workhours', el: <WorkHours /> },
  { path: '/requests', area: 'requests', el: <Requests /> },
  { path: '/attendance', area: 'attendance', el: <Attendance /> },
  { path: '/loyalty', area: 'loyalty', el: <Loyalty /> },
  { path: '/support', area: 'support', el: <Support /> },
  { path: '/discounts', area: 'discounts', el: <Discounts /> },
  { path: '/campaigns', area: 'campaigns', el: <Campaigns /> },
  { path: '/therapists', area: 'therapists', el: <Navigate to="/employees" replace /> },
  { path: '/invoices', area: 'invoices', el: <Invoices /> },
  { path: '/finance', area: 'payroll', el: <Finance /> },
  { path: '/payroll', area: 'payroll', el: <Payroll /> },
  { path: '/payroll/staff', area: 'payroll', el: <PayrollStaff /> },
  { path: '/payroll/reports', area: 'payroll', el: <PayrollReports /> },
  { path: '/my-target', area: 'mytarget', el: <MyTarget /> },
  { path: '/payments', area: 'invoices', el: <Navigate to="/invoices" replace /> },
  { path: '/product-sales', area: 'products', el: <ProductSales /> },
  { path: '/installments', area: 'installments', el: <Installments /> },
  { path: '/reports', area: 'reports', el: <Reports /> },
  { path: '/marketing-report', area: 'marketing', el: <MarketingReport /> },
  { path: '/online-accounts', area: 'online_accounts', el: <Navigate to="/patients?tab=online" replace /> },
  { path: '/notifications', area: 'notifications', el: <Notifications /> },
  { path: '/roles', area: 'roles', el: <Roles /> },
  { path: '/settings', area: 'settings', el: <Settings /> },
];

const hasPendingBook = () => { try { return !!sessionStorage.getItem('ortho_pending_book'); } catch { return false; } };

const PATIENT_ROUTES: { path: string; el: JSX.Element }[] = [
  { path: '/me', el: <PatientDashboard /> },
  { path: '/me/book', el: <PatientBook /> },
  { path: '/me/appointments', el: <PatientAppointments /> },
  { path: '/me/file', el: <PatientFilePage /> },
  { path: '/me/exams', el: <PatientExams /> },
  { path: '/me/plans', el: <PatientPlans /> },
  { path: '/me/points', el: <PatientPoints /> },
  { path: '/me/invoices', el: <PatientInvoices /> },
  { path: '/me/notifications', el: <PatientNotifications /> },
  { path: '/me/account', el: <Account /> },
];

// صفحات المريض: لا يدخلها إلا حساب مريض — الموظف يُعاد لواجهة الإدارة
function PatientProtected({ children }: { children: JSX.Element }) {
  const { user, patient, loading } = useAuth();
  const location = useLocation();
  if (loading) return <FullLoader />;
  if (user) return <Navigate to="/" replace />;
  if (!patient) return <Navigate to="/login" replace />;
  return <PatientLayout><ErrorBoundary key={location.pathname} label={location.pathname}><Suspense fallback={<PageLoader />}>{children}</Suspense></ErrorBoundary></PatientLayout>;
}

export default function App() {
  const { user, patient, loading } = useAuth();
  return (
    <Routes>
      <Route path="/login" element={loading ? <FullLoader /> : user ? <Navigate to="/" replace /> : patient ? <Navigate to={hasPendingBook() ? '/me/book' : '/me'} replace /> : <GoToSiteLogin />} />
      {PATIENT_ROUTES.map((r) => <Route key={r.path} path={r.path} element={<PatientProtected>{r.el}</PatientProtected>} />)}
      <Route path="/account" element={<Protected area="dashboard"><Account /></Protected>} />
      <Route path="/" element={<HomeGate />} />
      <Route path="/signup" element={loading ? <FullLoader /> : user ? <Navigate to="/" replace /> : patient ? <Navigate to="/me" replace /> : <Suspense fallback={<FullLoader />}><SignUp /></Suspense>} />
      <Route path="/site" element={<Suspense fallback={<FullLoader />}><Landing /></Suspense>} />
      {ROUTES.filter((r) => r.path !== '/').map((r) => <Route key={r.path} path={r.path} element={<Protected area={r.area} anyOf={r.anyOf}>{r.el}</Protected>} />)}
      <Route path="*" element={<Navigate to="/" replace />} />
    </Routes>
  );
}
