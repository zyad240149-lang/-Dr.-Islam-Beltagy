import { LangSwitch } from '../i18n/LangSwitch';
import { createContext, useContext, useEffect, useState, type ReactNode } from 'react';
import { NavLink, useNavigate } from 'react-router-dom';
import { Icon } from '../utils/icons';
import { useAuth } from '../services/auth';
import { supabase } from '../lib/supabase';
import { useToast } from '../hooks/useToast';
import { initials } from '../utils/format';
import { patientApi } from '../data/patientApi';
import { PwaControls, PwaUpdateBanner } from '../pwa/PwaControls';

const NAV = [
  { to: '/me', label: 'الرئيسية', icon: 'grid', end: true },
  { to: '/me/book', label: 'حجز موعد', icon: 'calendarPlus' },
  { to: '/me/appointments', label: 'مواعيدي', icon: 'calendar' },
  { to: '/me/file', label: 'ملفي', icon: 'clipboard' },
  { to: '/me/exams', label: 'سجل الكشوفات', icon: 'stethoscope' },
  { to: '/me/records', label: 'سجلي الطبي', icon: 'doc' },
  { to: '/me/plans', label: 'خطط العلاج', icon: 'target' },
  { to: '/me/points', label: 'نقاطي', icon: 'spark' },
  { to: '/me/invoices', label: 'الفواتير', icon: 'receipt' },
  { to: '/me/notifications', label: 'الإشعارات', icon: 'bell' },
  { to: '/me/account', label: 'حسابي', icon: 'settings' },
];

// رقم يزيد عند أي تغيير لحظي (Realtime) — الصفحات تعيد تحميل بياناتها عند تغيّره
const LiveContext = createContext(0);
export const useLive = () => useContext(LiveContext);

export default function PatientLayout({ children }: { children: ReactNode }) {
  const { patient, logout } = useAuth();
  const navigate = useNavigate();
  const toast = useToast();
  const [open, setOpen] = useState(false);
  const [live, setLive] = useState(0);
  const [unread, setUnread] = useState(0);
  const [center, setCenter] = useState({ name: 'عيادة د. إسلام بلتاجي لجراحة العظام والكسور', place: '' });

  useEffect(() => {
    patientApi.catalog().then((c) => setCenter({ name: c.center.name, place: `${c.center.city} – ${c.center.district}` })).catch(() => {});
  }, []);
  useEffect(() => { patientApi.dashboard().then((d) => setUnread(d.unreadNotifications)).catch(() => {}); }, [live]);
  useEffect(() => {
    const ch = supabase.channel('patient-live');
    let t: ReturnType<typeof setTimeout> | null = null;
    for (const table of ['appointments', 'notifications', 'invoices', 'payments', 'treatment_plans', 'treatment_sessions']) {
      ch.on('postgres_changes', { event: '*', schema: 'public', table }, () => { if (t) clearTimeout(t); t = setTimeout(() => setLive((n) => n + 1), 300); });
    }
    ch.subscribe();
    return () => { if (t) clearTimeout(t); supabase.removeChannel(ch); };
  }, []);
  useEffect(() => {
    const onErr = (e: PromiseRejectionEvent) => { e.preventDefault(); toast.error(e.reason instanceof Error ? e.reason.message : 'حدث خطأ غير متوقع.'); };
    window.addEventListener('unhandledrejection', onErr);
    return () => window.removeEventListener('unhandledrejection', onErr);
  }, [toast]);

  const close = () => setOpen(false);
  const brand = (
    <div className="brand brand--logo">
      <div className="brand__mark"><Icon name="bone" size={22} /></div>
      <div className="brand__desc">{center.place}</div>
    </div>
  );

  return (
    <LiveContext.Provider value={live}>
      <div className="shell">
        <header className="topbar">
          {brand}
          <span style={{ display: 'flex', gap: 8 }}><LangSwitch />
          <NavLink to="/me/notifications" className="icon-btn" aria-label="الإشعارات" style={{ position: 'relative' }}><Icon name="bell" size={19} />{unread > 0 && <span className="dt-badge">{unread}</span>}</NavLink>
          <button className="icon-btn" onClick={() => setOpen(true)} aria-label="فتح القائمة"><Icon name="menu" size={20} /></button></span>
        </header>
        <div className={`backdrop ${open ? 'show' : ''}`} onClick={close} />
        <aside className={`sidebar ${open ? 'open' : ''}`}>
          {brand}
          <div className="nav-label">حسابي</div>
          <nav className="nav" onClick={close}>
            {NAV.map((n) => (
              <NavLink key={n.to} to={n.to} end={n.end}>
                <Icon name={n.icon} size={20} /><span>{n.label}</span>
                {n.to === '/me/notifications' && unread > 0 && <span className="count num">{unread}</span>}
              </NavLink>
            ))}
          </nav>
          <div className="sidebar__spacer" />
          <div className="user-box">
            <div className="user-box__row">
              <span className="avatar">{patient ? initials(patient.name) : ''}</span>
              <div style={{ minWidth: 0 }}><div className="user-box__name">{patient?.name}</div><div className="user-box__meta">مريض</div></div>
            </div>
            <PwaControls />
            <button className="logout-btn" onClick={() => { logout(); toast.info('تم تسجيل الخروج'); navigate('/login'); }}><Icon name="logout" size={18} />تسجيل الخروج</button>
          </div>
        </aside>
        <main className="main">
          <PwaUpdateBanner />
          <div className="desktop-topbar desktop-topbar--patient no-print">
            <span style={{ flex: 1 }} />
            <LangSwitch style={{ marginInlineEnd: 8 }} />
            <NavLink to="/me/notifications" className="icon-btn" aria-label="الإشعارات" style={{ position: 'relative' }}>
              <Icon name="bell" size={19} />{unread > 0 && <span className="dt-badge">{unread}</span>}
            </NavLink>
          </div>
          {children}
        </main>
      </div>
    </LiveContext.Provider>
  );
}
