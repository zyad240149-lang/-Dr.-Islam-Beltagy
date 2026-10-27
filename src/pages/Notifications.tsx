import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { db } from '../data/db';
import { useDbVersion, useLoading } from '../hooks/useDb';
import { Icon } from '../utils/icons';
import { Button, EmptyState, Skeleton } from '../components/ui';
import { IconAction, useCan } from '../components/common';
import { REFERRAL_SOURCE_LABEL, fmtDateTime, relTime } from '../utils/format';
import type { NotificationKind } from '../types';

type Group = 'accounts' | 'bookings' | 'changes' | 'reminders' | 'plans' | 'finance' | 'inventory' | 'staff' | 'system';

const KIND: Record<NotificationKind, { label: string; icon: string; group: Group }> = {
  patient_new: { label: 'حساب جديد', icon: 'user', group: 'accounts' },
  appointment_new: { label: 'حجز جديد', icon: 'calendarPlus', group: 'bookings' },
  appointment_cancelled: { label: 'إلغاء موعد', icon: 'close', group: 'changes' },
  appointment_rescheduled: { label: 'تغيير موعد', icon: 'calendar', group: 'changes' },
  no_show: { label: 'لم يحضر', icon: 'alert', group: 'changes' },
  appointment_soon: { label: 'موعد قريب', icon: 'clock', group: 'reminders' },
  visit_on_way: { label: 'موعد قريب', icon: 'clock', group: 'reminders' },
  package_low: { label: 'باقة قاربت على النفاد', icon: 'box', group: 'plans' },
  package_expiring: { label: 'باقة على وشك الانتهاء', icon: 'box', group: 'plans' },
  payment_due: { label: 'مالية', icon: 'receipt', group: 'finance' },
  invoice: { label: 'مالية', icon: 'receipt', group: 'finance' },
  stock_low: { label: 'مخزون منخفض', icon: 'box', group: 'inventory' },
  staff_request: { label: 'طلب موظف', icon: 'inbox', group: 'staff' },
  target_progress: { label: 'التارجت', icon: 'target', group: 'staff' },
  target_reached: { label: 'التارجت', icon: 'target', group: 'staff' },
  user: { label: 'النظام', icon: 'bell', group: 'system' },
};

const GROUPS: { value: Group; label: string; icon: string; tone: string }[] = [
  { value: 'accounts', label: 'حسابات جديدة', icon: 'user', tone: 'ok' },
  { value: 'bookings', label: 'حجوزات جديدة', icon: 'calendarPlus', tone: 'brand' },
  { value: 'changes', label: 'إلغاء وتغيير', icon: 'calendar', tone: 'danger' },
  { value: 'reminders', label: 'تذكيرات المواعيد', icon: 'clock', tone: 'info' },
  { value: 'plans', label: 'الباقات والخطط', icon: 'target', tone: 'brand' },
  { value: 'finance', label: 'المالية', icon: 'receipt', tone: 'warn' },
  { value: 'staff', label: 'طلبات الموظفين', icon: 'inbox', tone: 'info' },
  { value: 'inventory', label: 'المخزون', icon: 'box', tone: 'warn' },
  { value: 'system', label: 'النظام', icon: 'bell', tone: 'muted' },
];
const TONE = Object.fromEntries(GROUPS.map((g) => [g.value, g.tone])) as Record<Group, string>;

const SOURCE_COLOR: Record<string, string> = {
  instagram: '#d6336c', snapchat: '#e8b400', tiktok: '#111827', twitter: '#1f2937', facebook: '#1877f2',
  whatsapp: '#16a34a', google: '#ea4335', friend: '#7a5cd0', other: '#94a3b8',
};
const SOCIAL = new Set(['instagram', 'snapchat', 'tiktok', 'twitter', 'facebook', 'whatsapp']);
type Period = 'month' | 'quarter' | 'all';

function SourcesCard() {
  const [period, setPeriod] = useState<Period>('all');
  const now = Date.now();
  const from = period === 'month' ? new Date(new Date().getFullYear(), new Date().getMonth(), 1).getTime() : period === 'quarter' ? now - 90 * 86400000 : 0;
  // العدّ بيبدأ من «marketing_since» (إعادة تصفير من غير حذف مرضى)
  const since = db.center().marketingSince ? new Date(db.center().marketingSince + 'T00:00:00+03:00').getTime() : 0;
  const patients = db.patients().filter((p) => p.registeredAt >= Math.max(from, since));
  const counts = Object.keys(REFERRAL_SOURCE_LABEL).map((k) => ({ key: k, label: REFERRAL_SOURCE_LABEL[k], n: patients.filter((p) => p.referralSource === k).length }))
    .sort((a, b) => b.n - a.n);
  const total = patients.length;
  const max = Math.max(1, ...counts.map((c) => c.n));
  const social = counts.filter((c) => SOCIAL.has(c.key)).reduce((s, c) => s + c.n, 0);
  const top = counts.find((c) => SOCIAL.has(c.key) && c.n > 0);

  return (
    <section className="card nt-sources">
      <div className="card__head">
        <h2>من وين يأتي العملاء؟</h2>
      </div>
      <div className="card__body">
        <div className="seg seg--3" style={{ marginBottom: 14 }}>
          {([['month', 'هذا الشهر'], ['quarter', 'آخر 3 أشهر'], ['all', 'الكل']] as [Period, string][]).map(([v, l]) => (
            <button key={v} type="button" className={`seg__btn ${period === v ? 'active' : ''}`} onClick={() => setPeriod(v)}>{l}</button>
          ))}
        </div>
        <div className="nt-sources__sum">
          <div><span className="num">{total}</span><small>مريض جديد</small></div>
          <div><span className="num">{total ? Math.round((social / total) * 100) : 0}%</span><small>من التواصل الاجتماعي</small></div>
        </div>
        {top && (
          <div className="nt-top">
            <Icon name="trend" size={16} />
            <div>أكثر منصة جلبت عملاء: <strong>{top.label}</strong> (<span className="num">{top.n}</span>)</div>
          </div>
        )}
        {total === 0 ? <p className="muted" style={{ fontSize: 13 }}>ما فيه مرضى جدد في هذي الفترة.</p> : (
          <ul className="nt-bars">
            {counts.map((c) => (
              <li key={c.key} className={c.n === 0 ? 'is-zero' : ''}>
                <div className="nt-bars__label">
                  <span><i style={{ background: SOURCE_COLOR[c.key] }} />{c.label}</span>
                  <span className="num">{c.n} · {Math.round((c.n / total) * 100)}%</span>
                </div>
                <div className="nt-bars__track"><div style={{ width: `${(c.n / max) * 100}%`, background: SOURCE_COLOR[c.key] }} /></div>
              </li>
            ))}
          </ul>
        )}
      </div>
    </section>
  );
}

export default function Notifications() {
  useDbVersion();
  const loading = useLoading();
  const navigate = useNavigate();
  const can = useCan();
  const [group, setGroup] = useState<Group | ''>('');
  const [unreadOnly, setUnreadOnly] = useState(false);
  // إشعارات المخزون مابتظهرش لحد مالوش صلاحية «المخزون»
  // groupOf لازم تتعرّف قبل الاستخدام — غير كده الصفحة بتقع لأي دور مالوش صلاحية المخزون (الأخصائي/الاستقبال/السكرتارية)
  const groupOf = (k: NotificationKind) => (KIND[k] ?? KIND.user).group;
  const all = db.notifications().filter((n) => can('inventory') || groupOf(n.kind) !== 'inventory');
  const notifs = all.filter((n) => (!group || groupOf(n.kind) === group) && (!unreadOnly || !n.read));
  const unread = all.filter((n) => !n.read).length;
  const countFor = (g: Group) => all.filter((n) => groupOf(n.kind) === g && !n.read).length;
  const shownGroups = GROUPS.filter((g) => all.some((n) => groupOf(n.kind) === g.value) || g.value === 'accounts' || g.value === 'bookings');

  return (
    <div className="page">
      <div className="page-head">
        <div><h1>الإشعارات</h1><p>{unread > 0 ? `عندك ${unread} إشعار غير مقروء.` : 'كل الإشعارات مقروءة.'}</p></div>
        <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
          <Button variant="outline" icon="refresh" onClick={() => db.runAutomations()}>فحص التنبيهات</Button>
          {unread > 0 && <Button variant="outline" icon="check" onClick={() => db.markAllNotificationsRead()}>تحديد الكل كمقروء</Button>}
          {can('notifications', 'delete') && all.some((n) => n.read) && <Button variant="soft-danger" icon="trash" onClick={() => db.deleteReadNotifications()}>حذف المقروءة</Button>}
        </div>
      </div>

      <div className="nt-cats">
        <button type="button" className={`nt-cat ${!group ? 'active' : ''}`} onClick={() => setGroup('')}>
          <span className="nt-cat__ic nt-cat__ic--brand"><Icon name="bell" size={17} /></span>
          <span className="nt-cat__txt"><strong>الكل</strong><small><span className="num">{unread}</span> غير مقروء</small></span>
        </button>
        {shownGroups.map((g) => (
          <button key={g.value} type="button" className={`nt-cat ${group === g.value ? 'active' : ''}`} onClick={() => setGroup(g.value)}>
            <span className={`nt-cat__ic nt-cat__ic--${g.tone}`}><Icon name={g.icon} size={17} /></span>
            <span className="nt-cat__txt"><strong>{g.label}</strong><small><span className="num">{all.filter((n) => groupOf(n.kind) === g.value).length}</span> إشعار</small></span>
            {countFor(g.value) > 0 && <span className="count num">{countFor(g.value)}</span>}
          </button>
        ))}
      </div>

      <div className="nt-layout">
        <section className="card">
          <div className="card__head">
            <h2>{group ? GROUPS.find((g) => g.value === group)?.label : 'كل الإشعارات'}</h2>
            <label className="nt-toggle">
              <input type="checkbox" checked={unreadOnly} onChange={(e) => setUnreadOnly(e.target.checked)} /> غير المقروءة فقط
            </label>
          </div>
          <div className="card__body">
            {loading ? <Skeleton h={200} /> : notifs.length === 0 ? <EmptyState icon="bell" title="ما فيه إشعارات" /> : notifs.map((n) => {
              const k = KIND[n.kind] ?? KIND.user;
              const source = n.kind === 'patient_new' && n.refId ? REFERRAL_SOURCE_LABEL[n.refId] : undefined;
              return (
                <div key={n.id} className={`notif clickable ${n.read ? '' : 'is-unread'}`}
                  onClick={() => { db.markNotificationRead(n.id); if (n.link) navigate(n.link); }}>
                  <span className={`nt-ic nt-ic--${TONE[k.group]}`}><Icon name={k.icon} size={18} /></span>
                  <div className="notif__body">
                    <div className="notif__title">{!n.read && <span className="dot" />}{n.title} <span className="role-tag" style={{ marginInlineStart: 6 }}>{k.label}</span></div>
                    <div className="notif__text">{n.body}</div>
                    <div className="notif__time num" title={fmtDateTime(n.createdAt)}>
                      {relTime(n.createdAt)}{n.link ? ' · اضغط للفتح' : ''}
                      {source && <span className="nt-source" style={{ borderColor: SOURCE_COLOR[n.refId!], color: SOURCE_COLOR[n.refId!] }}>{source}</span>}
                    </div>
                  </div>
                  <div style={{ display: 'flex', gap: 6 }} onClick={(e) => e.stopPropagation()}>
                    {!n.read && <IconAction icon="check" label="تحديد كمقروء" onClick={() => db.markNotificationRead(n.id)} />}
                    {can('notifications', 'delete') && <IconAction icon="trash" label="حذف الإشعار" danger onClick={() => db.deleteNotification(n.id)} />}
                  </div>
                </div>
              );
            })}
          </div>
        </section>
        <SourcesCard />
      </div>
    </div>
  );
}
