// إعدادات الإشعارات التلقائية (من القاعدة: notification_kinds / notification_prefs — هجرة 187) + حالة الإرسال + إشعار تجريبي.
// الجدولة والإرسال كلهم على الخادم (pg_cron كل دقيقة + Edge Function "push") — الصفحة دي بتعرض وبتعدّل الإعدادات بس.
import { useEffect, useState } from 'react';
import { supabase } from '../lib/supabase';
import { Button, Skeleton, StatusBadge } from './ui';
import { useCan } from './common';
import { useToast } from '../hooks/useToast';
import { fmtDateTime } from '../utils/format';
import { PushStatusCard } from '../pwa/PushStatusCard';

interface Kind { kind: string; label: string; audience: 'customer' | 'staff'; enabled: boolean; pushTitle: string; pushBody: string; link: string | null }
interface Report {
  summary: Record<string, number>; delivered: number; opened: number; read: number;
  recent: { id: string; created_at: string; kind: string; label: string | null; title: string; push_status: string | null; push_attempts: number; push_error: string | null; delivered_at: string | null; opened_at: string | null; read: boolean; recipient: string | null }[];
  scheduled: { id: string; scheduled_at: string; appt_at: string; offset_minutes: number; status: string; cancel_reason: string | null; last_error: string | null; appointment_no: string | null; patient: string | null }[];
  cron: { job: string; schedule: string; active: boolean }[];
}

const HOUR_OPTIONS = [1, 2, 3, 4, 5, 6, 12, 24];
const PUSH_STATUS: Record<string, { label: string; tone: string }> = {
  pending: { label: 'بانتظار الإرسال', tone: 'info' }, sending: { label: 'جاري الإرسال', tone: 'info' }, sent: { label: 'اتبعت لخدمة الإشعارات', tone: 'ok' },
  no_device: { label: 'بدون جهاز مفعّل', tone: 'muted' }, failed: { label: 'فشل', tone: 'danger' }, none: { label: 'قبل تفعيل التتبّع', tone: 'muted' },
};
const SCHED_STATUS: Record<string, { label: string; tone: string }> = {
  pending: { label: 'مجدول', tone: 'info' }, sent: { label: 'اتبعت', tone: 'ok' }, cancelled: { label: 'اتلغى', tone: 'muted' },
  skipped: { label: 'اتخطّى', tone: 'muted' }, expired: { label: 'فات وقته', tone: 'warn' }, failed: { label: 'فشل', tone: 'danger' },
};
const hoursLabel = (h: number) => (h === 1 ? 'ساعة' : h === 2 ? 'ساعتين' : h <= 10 ? `${h} ساعات` : `${h} ساعة`);

export function AutoNotificationsSettings() {
  const can = useCan();
  const toast = useToast();
  const edit = can('settings', 'edit');
  const [kinds, setKinds] = useState<Kind[] | null>(null);
  const [offsets, setOffsets] = useState<number[]>([]);
  const [report, setReport] = useState<Report | null>(null);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');

  const load = async () => {
    const [s, r] = await Promise.all([supabase.rpc('notification_settings'), supabase.rpc('notification_delivery_report', { p_days: 7 })]);
    if (s.error) { setErr(s.error.message); return; }
    setKinds(s.data.kinds); setOffsets(s.data.prefs.reminderOffsets ?? []);
    if (!r.error) setReport(r.data);
  };
  useEffect(() => { void load(); }, []);

  const setKind = (k: string, p: Partial<Kind>) => setKinds((x) => (x ?? []).map((y) => (y.kind === k ? { ...y, ...p } : y)));
  const toggleHour = (h: number) => setOffsets((x) => (x.includes(h) ? x.filter((y) => y !== h) : [...x, h].sort((a, b) => b - a)));
  const save = async () => {
    setBusy(true);
    const { error } = await supabase.rpc('save_notification_settings', { p: { kinds, reminderOffsets: offsets } });
    setBusy(false);
    if (error) { toast.error(error.message); return; }
    toast.success('تم حفظ إعدادات الإشعارات — والتذكيرات الجاية اتعاد جدولتها.');
    void load();
  };

  if (err) return <div className="alert alert-warn">{err}</div>;
  if (!kinds) return <Skeleton h={240} />;
  const sum = report?.summary ?? {};
  return (
    <div style={{ display: 'grid', gap: 18, gridTemplateColumns: 'minmax(0, 1fr)' }}>
      <section>
        <h3 style={{ margin: '0 0 6px' }}>إشعارات الجوال التلقائية</h3>
        <p className="muted-sm" style={{ marginTop: 0 }}>بتتبعت من الخادم (مهمة مجدولة كل دقيقة) حتى لو التطبيق مقفول عند المريض أو الموظف — بشرط إنه فعّل الإشعارات على جهازه.
          النص اللي بيظهر على شاشة القفل مختصر ومن غير مبالغ أو تشخيص، والتفاصيل بتظهر جوه التطبيق بعد تسجيل الدخول.</p>
        {report && <div className="muted-sm">مهام الخادم: {report.cron.length ? report.cron.map((c) => `${c.job} (${c.active ? 'شغّالة' : 'متوقفة'})`).join('، ') : 'غير مجدولة!'}</div>}
      </section>

      <section className="card"><div className="card__body">
        <h4 style={{ marginTop: 0 }}>تذكيرات المواعيد</h4>
        <p className="muted-sm" style={{ marginTop: 0 }}>لكل حجز قادم (جديد/مؤكد/معاد جدولته): تذكير مستقل قبل الموعد بالوقت المختار. بتتعاد جدولتها لو الموعد اتغيّر، وبتتلغي لو اتلغى أو المريض حضر، وما بيتبعتش تذكير وقته فات.</p>
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8 }}>
          {HOUR_OPTIONS.map((h) => (
            <label key={h} className="pr-check" style={{ margin: 0 }}>
              <input type="checkbox" checked={offsets.includes(h)} disabled={!edit} onChange={() => toggleHour(h)} />
              <span>قبل {hoursLabel(h)}</span>
            </label>
          ))}
        </div>
        {offsets.length === 0 && <div className="muted-sm" style={{ marginTop: 6 }}>ما فيه تذكيرات مختارة — تذكيرات المواعيد متوقفة.</div>}
      </div></section>


      <section className="card"><div className="card__body">
        <h4 style={{ marginTop: 0 }}>أنواع الإشعارات</h4>
        <div className="table-wrap"><table className="table">
          <thead><tr><th>مفعّل</th><th>النوع</th><th>لمين</th><th>العنوان على شاشة القفل</th><th>النص على شاشة القفل</th></tr></thead>
          <tbody>{kinds.map((k) => (
            <tr key={k.kind}>
              <td><input type="checkbox" checked={k.enabled} disabled={!edit} aria-label={`تفعيل ${k.label}`} onChange={(e) => setKind(k.kind, { enabled: e.target.checked })} /></td>
              <td><strong>{k.label}</strong></td>
              <td>{k.audience === 'customer' ? 'المريض' : 'الموظف'}</td>
              <td style={{ minWidth: 180 }}><input className="input" value={k.pushTitle} disabled={!edit} maxLength={80} onChange={(e) => setKind(k.kind, { pushTitle: e.target.value })} /></td>
              <td style={{ minWidth: 260 }}><input className="input" value={k.pushBody} disabled={!edit} maxLength={200} onChange={(e) => setKind(k.kind, { pushBody: e.target.value })} /></td>
            </tr>
          ))}</tbody>
        </table></div>
        <p className="muted-sm">متغيرات: <code>{'{name}'}</code> الاسم الأول للمريض، <code>{'{hours}'}</code> الوقت المتبقي للموعد.</p>
        {edit && <Button icon="check" loading={busy} onClick={save}>حفظ إعدادات الإشعارات</Button>}
      </div></section>

      <section className="card"><div className="card__body">
        <h4 style={{ marginTop: 0 }}>إشعار تجريبي</h4>
        <p className="muted-sm" style={{ marginTop: 0 }}>بيتبعت لأجهزتك إنت (المفعّل عليها الإشعارات) عشان تتأكد إن الإشعار بيظهر فعلًا على الشاشة.</p>
        <PushStatusCard />
      </div></section>

      {report && (
        <section className="card"><div className="card__body">
          <div className="row-between" style={{ alignItems: 'center' }}><h4 style={{ margin: 0 }}>حالة الإرسال (آخر 7 أيام)</h4><Button size="sm" variant="outline" icon="refresh" onClick={() => void load()}>تحديث</Button></div>
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8, margin: '10px 0' }}>
            {Object.entries(sum).map(([s, c]) => <StatusBadge key={s} label={`${PUSH_STATUS[s]?.label ?? s}: ${c}`} tone={PUSH_STATUS[s]?.tone ?? 'muted'} />)}
            <StatusBadge label={`وصل للجهاز: ${report.delivered}`} tone="ok" />
            <StatusBadge label={`اتفتح: ${report.opened}`} tone="ok" />
            <StatusBadge label={`اتقرا في التطبيق: ${report.read}`} tone="ok" />
          </div>
          <p className="muted-sm">«اتبعت» = خدمة الإشعارات استلمته، مش دليل إن المستخدم شافه. «وصل للجهاز» = الجهاز نفسه أكد استلامه، و«اتفتح» = المستخدم ضغط عليه.</p>
          <div className="table-wrap" style={{ maxHeight: 360, overflow: 'auto' }}><table className="table">
            <thead><tr><th>الوقت</th><th>المستلم</th><th>النوع</th><th>الإرسال</th><th>المحاولات</th><th>وصل</th><th>اتفتح</th><th>السبب</th></tr></thead>
            <tbody>{report.recent.map((r) => (
              <tr key={r.id}>
                <td className="num">{fmtDateTime(new Date(r.created_at).getTime())}</td>
                <td data-no-i18n>{r.recipient ?? '—'}</td>
                <td>{r.label ?? r.kind}</td>
                <td><StatusBadge label={PUSH_STATUS[r.push_status ?? 'none']?.label ?? r.push_status ?? '—'} tone={PUSH_STATUS[r.push_status ?? 'none']?.tone ?? 'muted'} /></td>
                <td className="num">{r.push_attempts}</td>
                <td>{r.delivered_at ? '✓' : '—'}</td>
                <td>{r.opened_at ? '✓' : r.read ? 'مقروء' : '—'}</td>
                <td className="muted-sm">{r.push_error ?? ''}</td>
              </tr>
            ))}</tbody>
          </table></div>
          <h4>التذكيرات المجدولة (من أمس لبعد 3 أيام)</h4>
          {report.scheduled.length === 0 ? <div className="muted-sm">ما فيه تذكيرات في الفترة دي.</div> : (
            <div className="table-wrap" style={{ maxHeight: 300, overflow: 'auto' }}><table className="table">
              <thead><tr><th>وقت التذكير</th><th>الموعد</th><th>المريض</th><th>قبل</th><th>الحالة</th><th>ملاحظة</th></tr></thead>
              <tbody>{report.scheduled.map((s) => (
                <tr key={s.id}>
                  <td className="num">{fmtDateTime(new Date(s.scheduled_at).getTime())}</td>
                  <td className="num">{s.appointment_no ?? '—'} · {fmtDateTime(new Date(s.appt_at).getTime())}</td>
                  <td data-no-i18n>{s.patient ?? '—'}</td>
                  <td>{hoursLabel(Math.round(s.offset_minutes / 60))}</td>
                  <td><StatusBadge label={SCHED_STATUS[s.status]?.label ?? s.status} tone={SCHED_STATUS[s.status]?.tone ?? 'muted'} /></td>
                  <td className="muted-sm">{s.cancel_reason ?? s.last_error ?? ''}</td>
                </tr>
              ))}</tbody>
            </table></div>
          )}
        </div></section>
      )}
    </div>
  );
}
