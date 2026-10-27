// مؤشر الاتصال + لوحة المزامنة: بتوضّح إيه اللي اتحفظ على الجهاز بس (لسه ما وصلش الخادم)، وإيه اللي نجح/فشل، وبتسمح بإعادة المحاولة وحل التعارض.
import { useEffect, useState } from 'react';
import { Button, Input, Modal, StatusBadge } from './ui';
import { Icon } from '../utils/icons';
import { offline, useOfflineState, type OfflineOp } from '../offline';
import { useToast } from '../hooks/useToast';
import { useAuth } from '../services/auth';
import { db } from '../data/db';
import { useDownloadState } from '../data/download';
import type { SnapMeta } from '../offline/session';

const STATUS: Record<OfflineOp['status'], { label: string; tone: string }> = {
  pending: { label: 'بانتظار المزامنة', tone: 'warn' },
  syncing: { label: 'جاري الإرسال', tone: 'info' },
  failed: { label: 'فشلت — تحتاج مراجعة', tone: 'danger' },
  conflict: { label: 'تعارض — تحتاج قرارك', tone: 'danger' },
};
const FIELD_LABEL: Record<string, string> = { full_name: 'الاسم', phone: 'الجوال', national_id: 'الهوية', address: 'العنوان', notes: 'ملاحظات', diagnosis: 'التشخيص', main_complaint: 'الشكوى الرئيسية', medical_history: 'التاريخ المرضي', date: 'التاريخ', time: 'الوقت', status: 'الحالة', email: 'البريد', city: 'المدينة', birth_date: 'تاريخ الميلاد', complaint: 'الشكوى', plan: 'الخطة/التعليمات', medications: 'الروشتة', labs: 'التحاليل', imaging_requests: 'الأشعة المطلوبة', follow_up: 'ميعاد المتابعة', icd10: 'ICD-10', examination: 'الفحص', history: 'التاريخ المرضي', region: 'المنطقة', side: 'الجهة', finding: 'نتيجة الأشعة', procedure: 'العملية', hospital: 'المستشفى', removal_due: 'ميعاد فك الجبس' };
const label = (k: string) => FIELD_LABEL[k] ?? k;
const show = (v: unknown) => (v === null || v === undefined || v === '' ? '—' : typeof v === 'object' ? JSON.stringify(v) : String(v));

// حالة البيانات على الجهاز (من db.syncStatus) — بتتحدّث مع كل مزامنة
function useDataSync() {
  const [, set] = useState(0);
  useEffect(() => db.onSyncChange(() => set((n) => n + 1)), []);
  return db.syncStatus();
}
const fmtWhen = (ts: number) => new Date(ts).toLocaleString('ar-EG-u-nu-latn', { timeZone: 'Africa/Cairo', dateStyle: 'medium', timeStyle: 'short' });
const fmtBytes = (n: number) => (n > 1048576 ? `${(n / 1048576).toFixed(1)} ميجابايت` : `${Math.max(1, Math.round(n / 1024))} كيلوبايت`);

export function OfflineBadge({ block }: { block?: boolean }) {
  const st = useOfflineState();
  const dl = useDownloadState();
  const data = useDataSync();
  const { offlineSession } = useAuth();
  const [open, setOpen] = useState(false);
  const bad = st.attention > 0;
  const retrying = st.online && st.pending > 0 && !st.syncing && !!offline.queue.list().find((o) => o.status === 'pending' && o.lastError);
  const incomplete = data.tables.some((t) => t.info && !t.info.complete);
  const tone = !st.online ? 'warn' : bad || retrying ? 'danger' : st.pending || dl.active || incomplete ? 'info' : 'ok';
  const text = !st.online ? (st.pending ? 'غير متصل — محفوظ على الجهاز' : 'غير متصل')
    : st.syncing ? 'جاري المزامنة…'
    : dl.active ? `جاري تنزيل ${dl.label}…`
    : bad ? `${st.attention} تحتاج مراجعة`
    : retrying ? 'فشلت المزامنة — ستُعاد المحاولة'
    : st.pending ? `${st.pending} بانتظار المزامنة`
    : incomplete ? 'بيانات لم تكتمل على الجهاز' : 'متصل بالسيرفر';
  return (
    <>
      <button type="button" className={`offline-badge offline-badge--${tone} ${block ? 'offline-badge--block' : ''}`} onClick={() => setOpen(true)}
        title={!st.online ? 'أنت غير متصل بالإنترنت — التغييرات المدعومة تُحفظ على الجهاز وتُرسل عند عودة الاتصال.' : 'حالة المزامنة'} aria-live="polite">
        <span className="offline-badge__dot" aria-hidden />
        <span>{text}</span>
        {!st.online && st.pending > 0 && <span className="num offline-badge__n">{st.pending}</span>}
      </button>
      {open && <SyncPanel onClose={() => setOpen(false)} offlineSession={offlineSession} />}
    </>
  );
}

function SyncPanel({ onClose, offlineSession }: { onClose: () => void; offlineSession: boolean }) {
  const st = useOfflineState();
  const toast = useToast();
  const ops = offline.queue.list();
  const [retime, setRetime] = useState<{ op: OfflineOp; date: string; time: string } | null>(null);
  const syncNow = async () => {
    await offline.syncNow(true);
    const s = offline.lastSummary();
    if (s && s.done) toast.success(`تمت مزامنة ${s.done} عملية`);
  };
  return (
    <Modal title="حالة الاتصال والمزامنة" onClose={onClose} wide footer={<>
      <Button variant="outline" onClick={onClose}>إغلاق</Button>
      <Button icon="refresh" onClick={syncNow} loading={st.syncing} disabled={!st.online || !ops.length}>مزامنة الآن</Button>
    </>}>
      <div className={`alert ${st.online ? 'alert-info' : 'alert-warn'}`} style={{ marginBottom: 12 }}>
        <Icon name="alert" size={17} />
        <div>
          {st.online ? 'أنت متصل بالإنترنت.' : 'أنت غير متصل بالإنترنت.'}{' '}
          {offlineSession && 'التطبيق يعمل من نسخة محفوظة على الجهاز من آخر اتصال. '}
          {!st.online && 'يمكنك عرض المرضى والمواعيد، وإضافة/تعديل المرضى والتشخيص، وحجز المواعيد وتغييرها وإلغائها — وتُرسل للخادم تلقائيًا عند عودة الاتصال. باقي العمليات (الفواتير، تأكيد الحضور، إنهاء الجلسة…) تحتاج اتصالًا.'}
        </div>
      </div>
      {!st.persistent && <div className="alert alert-warn" style={{ marginBottom: 12 }}><Icon name="alert" size={17} /><div>التخزين المحلي غير متاح في هذا المتصفح (ربما وضع التصفح الخاص): التغييرات المعلّقة <strong>ستضيع إن أغلقت التطبيق</strong> قبل المزامنة.</div></div>}
      <DeviceData online={st.online} />
      <div className="section-title" style={{ margin: '16px 0 8px' }}>التغييرات اللي على الجهاز</div>
      {!ops.length ? <div className="muted" style={{ padding: 12 }}>لا توجد تغييرات معلّقة — كل شيء متزامن مع الخادم.{offline.lastSyncOkAt() ? <> آخر مزامنة ناجحة: <span data-no-i18n>{fmtWhen(offline.lastSyncOkAt())}</span>.</> : null}</div> : (
        <div style={{ display: 'grid', gap: 10 }}>
          {ops.map((op) => {
            const s = STATUS[op.status];
            return (
              <div key={op.id} className="card"><div className="card__body" style={{ display: 'grid', gap: 6 }}>
                <div className="row-between" style={{ gap: 8, flexWrap: 'wrap' }}>
                  <strong data-no-i18n>{op.label}</strong>
                  <StatusBadge label={s.label} tone={s.tone} />
                </div>
                <div className="muted" style={{ fontSize: 12.5 }}><span>سُجّل</span> <span data-no-i18n>{new Date(op.createdAt).toLocaleString('ar-SA-u-ca-gregory-nu-latn', { timeZone: 'Africa/Cairo', dateStyle: 'medium', timeStyle: 'short' })}</span>{op.attempts ? <span> · محاولات: <span className="num">{op.attempts}</span></span> : null}</div>
                {op.lastError && op.status !== 'conflict' && <div className="field__err" style={{ display: 'block' }}>{op.lastError}</div>}
                {op.conflict && (
                  <div className="alert alert-warn" style={{ margin: 0 }}><Icon name="alert" size={17} /><div>
                    <div>{op.conflict.message}</div>
                    {op.conflict.fields?.map((f) => (
                      <div key={f} className="muted" style={{ fontSize: 12.5 }}>{label(f)}: على الخادم <strong data-no-i18n>{show(op.conflict!.serverValues?.[f])}</strong> — عندك <strong data-no-i18n>{show((op.payload.row as Record<string, unknown> | undefined)?.[f] ?? (op.payload as Record<string, unknown>)[f])}</strong></div>
                    ))}
                  </div></div>
                )}
                <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
                  {op.status === 'failed' && <Button size="sm" variant="outline" icon="refresh" onClick={() => offline.queue.retry(op.id).then(() => offline.syncNow(true))}>إعادة المحاولة</Button>}
                  {op.conflict?.reason === 'slot_taken' && <Button size="sm" onClick={() => setRetime({ op, date: String(op.payload.date ?? (op.payload.p as { date?: string })?.date ?? ''), time: String(op.payload.time ?? (op.payload.p as { time?: string })?.time ?? '') })}>تغيير الموعد</Button>}
                  {op.conflict?.reason === 'server_changed' && <><Button size="sm" onClick={() => offline.queue.resolve(op.id, { type: 'keep-mine' }).then(() => offline.syncNow(true))}>استخدم تعديلي</Button><Button size="sm" variant="outline" onClick={() => offline.queue.resolve(op.id, { type: 'keep-server' })}>أبقِ نسخة الخادم</Button></>}
                  {op.conflict?.reason === 'duplicate_patient' && op.conflict.existingId && <Button size="sm" onClick={() => offline.queue.resolve(op.id, { type: 'use-existing' }).then(() => offline.syncNow(true))}>استخدم الملف الموجود</Button>}
                  {op.status !== 'syncing' && <Button size="sm" variant="ghost" onClick={() => { if (window.confirm('حذف هذا التغيير المحلي نهائيًا؟ لن يُرسل للخادم.')) void offline.queue.resolve(op.id, { type: 'discard' }); }}>حذف التغيير</Button>}
                </div>
              </div></div>
            );
          })}
        </div>
      )}
      {retime && (
        <div className="card" style={{ marginTop: 12 }}><div className="card__body" style={{ display: 'grid', gap: 8 }}>
          <strong>اختر موعدًا جديدًا</strong>
          <div className="grid-form grid-form--3">
            <Input id="rt-date" label="التاريخ" type="date" value={retime.date} onChange={(e) => setRetime({ ...retime, date: e.target.value })} />
            <Input id="rt-time" label="الوقت" type="time" value={retime.time} onChange={(e) => setRetime({ ...retime, time: e.target.value })} />
          </div>
          <div style={{ display: 'flex', gap: 8 }}>
            <Button size="sm" onClick={async () => { await offline.queue.resolve(retime.op.id, { type: 'retime', date: retime.date, time: retime.time }); setRetime(null); await offline.syncNow(true); }}>حفظ وإعادة المحاولة</Button>
            <Button size="sm" variant="ghost" onClick={() => setRetime(null)}>إلغاء</Button>
          </div>
        </div></div>
      )}
    </Modal>
  );
}

/** البيانات المنزّلة على الجهاز: لكل جدول العدد هنا وعلى الخادم — «مكتمل» بيتقال بس لما العددين يتساووا */
function DeviceData({ online }: { online: boolean }) {
  const data = useDataSync();
  const dl = useDownloadState();
  const toast = useToast();
  const [meta, setMeta] = useState<SnapMeta | undefined>();
  const [storage, setStorage] = useState<{ usage: number | null; quota: number | null; persisted: boolean | null } | null>(null);
  const [busy, setBusy] = useState(false);
  useEffect(() => { void offline.session.snapshotInfo().then(setMeta); void offline.storageInfo().then(setStorage); }, [data.lastPullAt, offline.lastSnapshotAt()]);
  const refresh = async () => {
    setBusy(true);
    try { await db.refresh(); await offline.saveSnapshotNow(); toast.success('تم تحديث البيانات على الجهاز من الخادم.'); }
    finally { setBusy(false); }
  };
  const tables = data.tables.filter((t) => t.info);
  return (
    <div className="card" style={{ marginTop: 4 }}><div className="card__body" style={{ display: 'grid', gap: 8 }}>
      <div className="row-between" style={{ gap: 8, flexWrap: 'wrap' }}>
        <strong>البيانات المحفوظة على الجهاز</strong>
        <Button size="sm" variant="outline" icon="refresh" onClick={refresh} loading={busy || dl.active} disabled={!online}>تحديث من الخادم</Button>
      </div>
      {dl.active && <div className="muted-sm">جاري تنزيل {dl.label}: <span className="num">{dl.loaded.toLocaleString('en')}</span>{dl.total != null && <> من <span className="num">{dl.total.toLocaleString('en')}</span></>}</div>}
      {!tables.length ? <div className="muted-sm">لم تُنزَّل البيانات على هذا الجهاز بعد — تحتاج اتصالًا بالإنترنت مرة واحدة.</div> : (
        <div className="table-wrap"><table className="table"><thead><tr><th>القسم</th><th>على الجهاز</th><th>على الخادم</th><th>الحالة</th></tr></thead>
          <tbody>{tables.map((t) => (
            <tr key={t.table}><td>{t.label}</td><td className="num">{t.info!.rows.toLocaleString('en')}</td><td className="num">{t.info!.serverCount == null ? '—' : t.info!.serverCount.toLocaleString('en')}</td>
              <td>{t.info!.complete ? <StatusBadge label="مكتمل" tone="ok" /> : <StatusBadge label="لم يكتمل" tone="warn" />}</td></tr>
          ))}</tbody></table></div>
      )}
      {tables.some((t) => !t.info!.complete) && <div className="field__err" style={{ display: 'block' }}>بعض البيانات لم تُنزَّل بالكامل بعد — بدون إنترنت هتلاقي المحفوظ بس. اضغط «تحديث من الخادم» وأنت متصل.</div>}
      <div className="muted-sm">
        {data.lastPullAt ? <>آخر تحديث من الخادم: <span data-no-i18n>{fmtWhen(data.lastPullAt)}</span> · </> : null}
        {meta ? <>آخر حفظ على الجهاز: <span data-no-i18n>{fmtWhen(meta.savedAt)}</span> · {meta.encrypted ? 'مشفّرة (AES-256)' : 'غير مشفّرة (المتصفح لا يدعم التشفير هنا)'}</> : 'لم تُحفظ نسخة على الجهاز بعد'}
        {storage?.usage != null && <> · المساحة المستخدمة: <span data-no-i18n>{fmtBytes(storage.usage)}</span></>}
        {storage?.persisted === false && <> · <span className="field__err">المتصفح ممكن يمسح البيانات لو المساحة قلّت — ثبّت التطبيق على الشاشة الرئيسية</span></>}
      </div>
      {offline.snapshotError() && <div className="field__err" style={{ display: 'block' }}>تعذّر حفظ آخر نسخة على الجهاز: {offline.snapshotError()} — النسخة السابقة لسه سليمة.</div>}
    </div></div>
  );
}

/** تنبيه فوق القوايم لما النتائج جاية من الجهاز مش من الخادم */
export function LocalDataNote() {
  const data = useDataSync();
  const p = data.tables.find((t) => t.table === 'patients')?.info;
  return (
    <div className={`alert ${p && !p.complete ? 'alert-warn' : 'alert-info'}`} style={{ marginBottom: 12 }}>
      <Icon name="alert" size={17} />
      <div>
        بدون اتصال بالخادم — النتائج من المرضى المحفوظين على هذا الجهاز{p ? <> (<span className="num">{p.rows.toLocaleString('en')}</span> ملف{p.serverCount != null && <> من <span className="num">{p.serverCount.toLocaleString('en')}</span></>})</> : null}.
        {p && !p.complete && ' بعض المرضى لم يتم تنزيلهم بعد على الجهاز.'}
        {!p && ' لم تُنزَّل بيانات المرضى على هذا الجهاز بعد.'}
        {p && <> آخر تحديث: <span data-no-i18n>{fmtWhen(p.at)}</span>.</>}
      </div>
    </div>
  );
}

/** شارة صغيرة بجانب اسم/موعد لسه ما اتزامنش */
export function PendingSyncTag() {
  return <span className="badge badge--warn" style={{ marginInlineStart: 6 }} title="اتحفظ على هذا الجهاز ولم يصل للخادم بعد">بانتظار المزامنة</span>;
}
