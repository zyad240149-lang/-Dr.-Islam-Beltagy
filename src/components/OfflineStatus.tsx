// مؤشر الاتصال + لوحة المزامنة: بتوضّح إيه اللي اتحفظ على الجهاز بس (لسه ما وصلش الخادم)، وإيه اللي نجح/فشل، وبتسمح بإعادة المحاولة وحل التعارض.
import { useState } from 'react';
import { Button, Input, Modal, StatusBadge } from './ui';
import { Icon } from '../utils/icons';
import { offline, useOfflineState, type OfflineOp } from '../offline';
import { useToast } from '../hooks/useToast';
import { useAuth } from '../services/auth';

const STATUS: Record<OfflineOp['status'], { label: string; tone: string }> = {
  pending: { label: 'بانتظار المزامنة', tone: 'warn' },
  syncing: { label: 'جاري الإرسال', tone: 'info' },
  failed: { label: 'فشلت — تحتاج مراجعة', tone: 'danger' },
  conflict: { label: 'تعارض — تحتاج قرارك', tone: 'danger' },
};
const FIELD_LABEL: Record<string, string> = { full_name: 'الاسم', phone: 'الجوال', national_id: 'الهوية', address: 'العنوان', notes: 'ملاحظات', diagnosis: 'التشخيص', main_complaint: 'الشكوى الرئيسية', medical_history: 'التاريخ المرضي', date: 'التاريخ', time: 'الوقت', status: 'الحالة', email: 'البريد', city: 'المدينة', birth_date: 'تاريخ الميلاد' };
const label = (k: string) => FIELD_LABEL[k] ?? k;
const show = (v: unknown) => (v === null || v === undefined || v === '' ? '—' : typeof v === 'object' ? JSON.stringify(v) : String(v));

export function OfflineBadge({ block }: { block?: boolean }) {
  const st = useOfflineState();
  const { offlineSession } = useAuth();
  const [open, setOpen] = useState(false);
  const bad = st.attention > 0;
  const tone = !st.online ? 'warn' : bad ? 'danger' : st.pending ? 'info' : 'ok';
  const text = !st.online ? 'غير متصل' : st.syncing ? 'جاري المزامنة…' : bad ? `${st.attention} تحتاج مراجعة` : st.pending ? `${st.pending} بانتظار المزامنة` : 'متصل';
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
      {!ops.length ? <div className="muted" style={{ padding: 12 }}>لا توجد تغييرات معلّقة — كل شيء متزامن مع الخادم.</div> : (
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

/** شارة صغيرة بجانب اسم/موعد لسه ما اتزامنش */
export function PendingSyncTag() {
  return <span className="badge badge--warn" style={{ marginInlineStart: 6 }} title="اتحفظ على هذا الجهاز ولم يصل للخادم بعد">بانتظار المزامنة</span>;
}
