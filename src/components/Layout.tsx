import SecondSessionHost from './SecondSessionHost';
import IncompleteHost from './PatientCompleteness';
import { LangSwitch } from '../i18n/LangSwitch';
import { useEffect, useState, type ReactNode } from 'react';
import { NavLink, useLocation, useNavigate } from 'react-router-dom';
import { Icon } from '../utils/icons';
import { leaveMessage, useAuth } from '../services/auth';
import { db, type SearchHit } from '../data/db';
import { useDbVersion } from '../hooks/useDb';
import { can, ROLE_LABEL, type Area } from '../services/permissions';
import { initials } from '../utils/format';
import { useToast } from '../hooks/useToast';
import { prefetchRoute } from '../routeImports';
import { PwaControls, PwaUpdateBanner, RefreshButton } from '../pwa/PwaControls';
import { OfflineBadge } from './OfflineStatus';
import { offline } from '../offline';
import { isNetworkError } from '../offline/net';
import { DetailsProvider } from './DetailsHost';
import { ortho, useOrthoVersion } from '../ortho/data';

type NavItem = { to: string; label: string; icon: string; area: Area; anyOf?: Area[]; end?: boolean };
// القائمة مقسّمة لمجموعات بعناوين — كل مجموعة بتظهر بس لو فيها عنصر مسموح للمستخدم
const NAV_GROUPS: { title: string; items: NavItem[] }[] = [
  { title: 'الرئيسية', items: [
    { to: '/', label: 'الرئيسية', icon: 'grid', area: 'dashboard', end: true },
  ] },
  { title: 'المرضى والمواعيد', items: [
    { to: '/patients', label: 'المرضى', icon: 'users', area: 'patients' },
    { to: '/booking', label: 'حجز موعد', icon: 'calendarPlus', area: 'booking' },
    { to: '/appointments', label: 'المواعيد', icon: 'calendar', area: 'appointments' },
    { to: '/body-map', label: 'جسم الإنسان', icon: 'body', area: 'bodymap' },
    { to: '/services', label: 'الخدمات', icon: 'spark', area: 'services' },
  ] },
  { title: 'العظام والكسور', items: [
    { to: '/diagnosis', label: 'تشخيص المريض', icon: 'stethoscope', area: 'patients' },
    { to: '/surgeries', label: 'العمليات الجراحية', icon: 'scalpel', area: 'patients' },
  ] },
  { title: 'المالية', items: [
    { to: '/invoices', label: 'الفواتير والمدفوعات', icon: 'receipt', area: 'invoices' },
    { to: '/finance', label: 'الفواتير والمدفوعات (المدير)', icon: 'wallet', area: 'payroll' },
    // خانة واحدة — الأقسام التلاتة (الأخصائيين / الإداريين / التقارير) تبويبات جوه الصفحة، والخانة بتفضل منوّرة في أي واحد فيهم
    { to: '/payroll', label: 'الرواتب والتارجت', icon: 'target', area: 'payroll' },
    { to: '/discounts', label: 'أكواد الخصم', icon: 'receipt', area: 'discounts' },
    { to: '/loyalty', label: 'نقاط الولاء', icon: 'spark', area: 'loyalty' },
  ] },
  { title: 'الموظفون', items: [
    { to: '/employees', label: 'الموظفون', icon: 'user', area: 'employees' },
    { to: '/attendance', label: 'الحضور والانصراف', icon: 'checkCircle', area: 'attendance' },
    { to: '/requests', label: 'طلبات الموظفين', icon: 'inbox', area: 'requests' },
    { to: '/work-hours', label: 'مواعيد العمل', icon: 'clock', area: 'workhours' },
  ] },
  { title: 'التواصل', items: [
    { to: '/campaigns', label: 'إرسال إشعارات للمرضى', icon: 'bell', area: 'campaigns' },
    { to: '/support', label: 'الدعم الفني', icon: 'lock', area: 'support' },
  ] },
  { title: 'الإدارة', items: [
    { to: '/reports', label: 'التقارير', icon: 'trend', area: 'reports' },
    { to: '/marketing-report', label: 'تقرير التسويق', icon: 'trend', area: 'marketing' },
    { to: '/notifications', label: 'الإشعارات', icon: 'bell', area: 'notifications' },
    { to: '/roles', label: 'الأدوار والصلاحيات', icon: 'shield', area: 'roles' },
    { to: '/settings', label: 'الإعدادات', icon: 'settings', area: 'settings' },
  ] },
];
const NAV: NavItem[] = NAV_GROUPS.flatMap((g) => g.items);
// شريط التنقل السفلي على الموبايل: أهم 4 أقسام بالترتيب (حسب صلاحية المستخدم) + زرار «القائمة» لباقي الأقسام
const BOTTOM_PRIORITY = ['/', '/patients', '/appointments', '/booking', '/diagnosis', '/invoices'];

// البحث بيتخصّص حسب الصفحة: في الفواتير فواتير بس، في المواعيد مواعيد بس، في المرضى مرضى بس — وإلا فالكل. لو مفيش نتايج من النوع ده يرجع للكل
const PAGE_HIT: Record<string, string> = { '/invoices': 'invoice', '/appointments': 'appointment', '/patients': 'patient' };
function scopeHits(all: SearchHit[], pathname: string): SearchHit[] {
  const t = PAGE_HIT[pathname];
  if (!t) return all;
  const only = all.filter((h) => h.type === t);
  return only.length ? only : all;
}
const HIT_ICON: Record<string, string> = { patient: 'user', doctor: 'spark', appointment: 'calendar', invoice: 'receipt' };
const HIT_LABEL: Record<string, string> = { patient: 'مريض', doctor: 'طبيب', appointment: 'موعد', invoice: 'فاتورة' };

function Brand() {
  const center = db.center();
  return (
    <div className="brand">
      <span className="brand__mark brand__mark--logo"><img src={`${import.meta.env.BASE_URL}landing/logo.png`} alt="" /></span>
      <div style={{ minWidth: 0 }}><div className="brand__name">{center.name}</div><div className="brand__desc">جراحة العظام والكسور</div></div>
    </div>
  );
}

export default function Layout({ children }: { children: ReactNode }) {
  const { user, logout } = useAuth();
  const navigate = useNavigate();
  const { pathname } = useLocation();
  const toast = useToast();
  const [open, setOpen] = useState(false);
  const [q, setQ] = useState('');
  const [hits, setHits] = useState<SearchHit[] | null>(null);
  const [searchOpen, setSearchOpen] = useState(false);
  const [bellOpen, setBellOpen] = useState(false);
  useDbVersion();
  useOrthoVersion();
  useEffect(() => { ortho.preloadCounters(); }, []);
  useEffect(() => {
    const term = q.trim();
    if (term.length < 2 && !/^[0-9٠-٩]$/.test(term)) { setHits(null); return; }
    let live = true;
    const t = setTimeout(() => { db.globalSearch(term).then((r) => { if (live) setHits(scopeHits(r, pathname)); }).catch(() => { if (live) setHits([]); }); }, 250);
    return () => { live = false; clearTimeout(t); };
  }, [q, pathname]);
  useEffect(() => {
    const expired = (m: string) => m.includes('سجّل الدخول بحساب موظف') || m.includes('سجّل الدخول أولًا');
    const onErr = (e: PromiseRejectionEvent) => {
      e.preventDefault();
      const msg = e.reason instanceof Error ? e.reason.message : '';
      if (expired(msg)) return; // بيتعامل معاه حدث session-expired تحت
      toast.error(isNetworkError(msg) ? 'لا يوجد اتصال بالإنترنت — هذه العملية تحتاج اتصالًا بالخادم.' : (msg || 'حدث خطأ غير متوقع.'));
    };
    let handled = false;
    const onExpired = () => {
      if (handled) return;
      handled = true;
      logout({ keepOffline: true }); // العمليات المعلّقة تفضل محفوظة لنفس المستخدم لحد ما يرجع يسجّل دخول
      toast.error('انتهت الجلسة، سجّل الدخول من جديد.');
      navigate('/login');
    };
    window.addEventListener('unhandledrejection', onErr);
    window.addEventListener('session-expired', onExpired);
    return () => { window.removeEventListener('unhandledrejection', onErr); window.removeEventListener('session-expired', onExpired); };
  }, [toast, logout, navigate]);
  useEffect(() => {
    db.runAutomations();
    const t = setInterval(() => db.runAutomations(), 60000);
    return () => clearInterval(t);
  }, []);
  useEffect(() => {
    if (!user) return;
    const kick = () => { const msg = leaveMessage(user.id); if (msg) { logout(); toast.error(msg); navigate('/login'); } };
    kick();
    const g = setInterval(kick, 30000);
    return () => clearInterval(g);
  }, [user?.id]);
  db.setHiddenNotificationKinds(can(user?.role, 'inventory') ? [] : ['stock_low']);
  const unread = db.unreadCount();
  const pendingRequests = can(user?.role, 'requests', 'edit') ? db.pendingRequestsCount() : 0;
  const draftPlanInvoices = can(user?.role, 'invoices', 'edit') ? db.draftPlanInvoicesCount() : 0;
  const items = NAV.filter((n) => (n.anyOf ?? [n.area]).some((a) => can(user?.role, a)));
  const close = () => setOpen(false);
  const bottomItems = BOTTOM_PRIORITY.map((p) => items.find((n) => n.to === p)).filter((n): n is NavItem => !!n).slice(0, 4);

  const doLogout = async () => {
    // تغييرات سُجّلت بدون إنترنت ولسه ما وصلتش الخادم: نحاول نزامنها الأول، وإلا نحذّر قبل ما نمسحها مع الخروج
    if (offline.queue.pendingCount()) {
      await offline.syncNow(true);
      const left = offline.queue.pendingCount();
      if (left && !window.confirm(`فيه ${left} تغيير محفوظ على هذا الجهاز ولم يُرسل للخادم بعد. إذا سجّلت الخروج الآن سيُحذف نهائيًا. هل تريد الخروج؟`)) return;
    }
    logout(); toast.info('تم تسجيل الخروج'); navigate('/login');
  };
  const goHit = (h: SearchHit) => { setSearchOpen(false); setQ(''); setHits(null); navigate(h.link); };
  const onSearch = (e: React.FormEvent) => {
    e.preventDefault();
    if (hits && hits.length) goHit(hits[0]);
    else if (q.trim()) navigate('/patients?q=' + encodeURIComponent(q.trim()));
  };

  return (
    <div className="shell">
      <header className="topbar">
        <Brand />
        <span style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
          <OfflineBadge />
          <RefreshButton compact />
          <LangSwitch />
          <button className="icon-btn" onClick={() => setOpen(true)} aria-label="فتح القائمة"><Icon name="menu" size={20} /></button>
        </span>
      </header>

      <div className={`backdrop ${open ? 'show' : ''}`} onClick={close} />

      {bottomItems.length > 0 && (
        <nav className="bottom-nav no-print" aria-label="التنقل الأساسي">
          {bottomItems.map((n) => (
            <NavLink key={n.to} to={n.to} end={n.end} onMouseEnter={() => prefetchRoute(n.to)}>
              <Icon name={n.icon} size={21} /><span>{n.label}</span>
            </NavLink>
          ))}
          <button type="button" onClick={() => setOpen(true)} aria-label="كل الأقسام"><Icon name="menu" size={21} /><span>القائمة</span></button>
        </nav>
      )}

      <aside className={`sidebar ${open ? 'open' : ''}`}>
        <Brand />
        <nav className="nav" onClick={close}>
          {NAV_GROUPS.map((g) => {
            const allowed = g.items.filter((n) => items.includes(n));
            if (!allowed.length) return null;
            return (<div key={g.title} className="nav-group">
              <div className="nav-label">{g.title}</div>
              {allowed.map((n) => (
              <NavLink key={n.to} to={n.to} end={n.end} onMouseEnter={() => prefetchRoute(n.to)} onFocus={() => prefetchRoute(n.to)}>
                <Icon name={n.icon} size={20} />
                <span>{n.label}</span>
                {n.to === '/diagnosis' && ortho.pendingImaging() + ortho.castsDue() > 0 && <span className="count num" title="أشعة منتظرة / جبس مستحق الفك">{ortho.pendingImaging() + ortho.castsDue()}</span>}
                {n.to === '/fractures' && ortho.castsDue() > 0 && <span className="count num" title="جبس مستحق الفك">{ortho.castsDue()}</span>}
                {n.to === '/notifications' && unread > 0 && <span className="count num">{unread}</span>}
                {n.to === '/requests' && pendingRequests > 0 && <span className="count num">{pendingRequests}</span>}
                {n.to === '/invoices' && draftPlanInvoices > 0 && <span className="count num" title="فواتير خطط علاجية بانتظار المراجعة">{draftPlanInvoices}</span>}
              </NavLink>
              ))}
            </div>);
          })}
        </nav>
        <div className="sidebar__spacer" />
        <div className="user-box">
          <div className="user-box__row">
            <span className="avatar">{user ? initials(user.name) : ''}</span>
            <div style={{ minWidth: 0 }}>
              <div className="user-box__name">{user?.name}</div>
              <div className="user-box__meta">{user ? ROLE_LABEL[user.role] : ''}</div>
            </div>
          </div>
          <OfflineBadge block />
          <PwaControls />
          <NavLink to="/account" className="logout-btn" style={{ textDecoration: 'none', marginBottom: 6 }} onClick={close}><Icon name="settings" size={18} />حسابي</NavLink>
          <button className="logout-btn" onClick={doLogout}><Icon name="logout" size={18} />تسجيل الخروج</button>
        </div>
      </aside>

      <main className="main">
        <PwaUpdateBanner />
        <SecondSessionHost />
        <IncompleteHost />
        <div className="desktop-topbar no-print">
          {/* البحث الموحّد اللي كان هنا اتشال بطلب العيادة — البحث عن المريض جوّه كل صفحة (التشخيص/المرضى/المواعيد) */}
          <span style={{ flex: 1 }} />
          <span className="dt-tools">
            <RefreshButton />
            <LangSwitch />
          </span>
          <div style={{ position: 'relative' }}>
            <button type="button" className="icon-btn" aria-label="الإشعارات" style={{ position: 'relative' }} onClick={() => setBellOpen((o) => !o)}>
              <Icon name="bell" size={19} />
              {unread > 0 && <span className="dt-badge">{unread}</span>}
            </button>
            {bellOpen && (
              <>
                <div style={{ position: 'fixed', inset: 0, zIndex: 59 }} onClick={() => setBellOpen(false)} />
                <div className="card" style={{ position: 'absolute', top: 'calc(100% + 8px)', insetInlineEnd: 0, width: 340, maxWidth: '86vw', zIndex: 60, padding: 8 }}>
                  <div className="row-between" style={{ padding: '4px 6px 8px' }}>
                    <strong>الإشعارات {unread > 0 && <span className="num">({unread})</span>}</strong>
                    {unread > 0 && <button type="button" className="link-more" style={{ border: 0, background: 'none', cursor: 'pointer' }} onClick={() => db.markAllNotificationsRead()}>تحديد الكل كمقروء</button>}
                  </div>
                  <div style={{ maxHeight: 340, overflow: 'auto' }}>
                    {db.notifications().filter((n) => n.kind !== 'stock_low' || can(user?.role, 'inventory')).slice(0, 8).map((n) => (
                      <button key={n.id} type="button" className="choice" style={{ width: '100%', marginBottom: 4, opacity: n.read ? 0.65 : 1 }}
                        onClick={() => { db.markNotificationRead(n.id); setBellOpen(false); if (n.link) navigate(n.link); }}>
                        <span style={{ flex: 1, minWidth: 0, textAlign: 'start' }}><strong>{n.title}</strong><span>{n.body}</span></span>
                        {!n.read && <i style={{ width: 8, height: 8, borderRadius: 99, background: 'var(--brand)' }} />}
                      </button>
                    ))}
                    {db.notifications().length === 0 && <div className="muted" style={{ padding: 14 }}>ما فيه إشعارات</div>}
                  </div>
                  <NavLink to="/notifications" className="link-more" style={{ display: 'block', padding: '8px 6px 2px' }} onClick={() => setBellOpen(false)}>عرض كل الإشعارات</NavLink>
                </div>
              </>
            )}
          </div>
        </div>
        <DetailsProvider>{children}</DetailsProvider>
      </main>
    </div>
  );
}
