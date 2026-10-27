import { useState } from 'react';
import { db } from '../data/db';
import { useDbVersion, useLoading } from '../hooks/useDb';
import { Button, EmptyState, Input, Modal, PasswordInput, Select, Skeleton, StatusBadge } from '../components/ui';
import { PhoneInput } from '../components/PhoneInput';
import { phoneErrorMessage, type PhoneErrorCode } from '../utils/phoneUtils';
import { ConfirmDialog, IconAction, useCan } from '../components/common';
import { APPT_STATUS, EMAIL_RE, WEEKDAY_LABEL, fmtDate, fmtTime, initials, todayYmd } from '../utils/format';
import { useToast } from '../hooks/useToast';
import type { Leave, Role, Therapist, WorkDay, WorkHours } from '../types';
import { ROLE_LABEL } from '../services/permissions';
import { ROLES } from '../services/defaultPermissions';
import { api } from '../lib/api';
import { staffCall } from './Employees';
import { WorkHoursEditor, cleanHours, defaultHours, hoursError } from '../components/WorkHoursEditor';

const DAYS: WorkDay[] = ['sun', 'mon', 'tue', 'wed', 'thu', 'fri', 'sat']; // بترتيب getDay — لقراءة WEEKDAY_LABEL
// ترتيب العرض: السبت أول الأسبوع
const DAY_ORDER: WorkDay[] = ['sat', 'sun', 'mon', 'tue', 'wed', 'thu', 'fri'];
const byDayOrder = (a: { day: WorkDay }, b: { day: WorkDay }) => DAY_ORDER.indexOf(a.day) - DAY_ORDER.indexOf(b.day);
const dayLabel = (d: WorkDay) => WEEKDAY_LABEL[DAYS.indexOf(d)];

export default function Therapists({ embedded = false }: { embedded?: boolean }) {
  useDbVersion();
  const loading = useLoading();
  const toast = useToast();
  const can = useCan();
  const [editing, setEditing] = useState<Therapist | 'new' | null>(null);
  const [schedule, setSchedule] = useState<Therapist | null>(null);
  const [deleting, setDeleting] = useState<Therapist | null>(null);
  const therapists = db.allTherapists();
  const t0 = todayYmd();

  return (
    <div className={embedded ? undefined : "page"}>
      <div className="page-head">
        {embedded ? <p className="muted">مقدمو الخدمة: التخصص، الخدمات، ساعات العمل، الإجازات، والأداء.</p> : <div><h1>الأطباء والمعالجون</h1><p>مقدمو الخدمة: التخصص، الخدمات، ساعات العمل، الإجازات، والأداء.</p></div>}
        {can('therapists', 'create') && <Button icon="stethoscope" onClick={() => setEditing('new')}>إضافة معالج</Button>}
      </div>
      {loading ? <div className="stats-grid">{Array.from({ length: 4 }).map((_, i) => <div key={i} className="card"><div className="card__body"><Skeleton h={120} /></div></div>)}</div>
        : therapists.length === 0 ? <EmptyState icon="stethoscope" title="ما فيه معالجون" /> : (
        <div className="stats-grid">
          {therapists.map((t) => {
            const appts = db.appointments().filter((a) => a.therapistId === t.id);
            const completed = appts.filter((a) => a.status === 'completed').length;
            const upcoming = appts.filter((a) => a.date >= t0 && ['new', 'confirmed', 'on_way', 'rescheduled'].includes(a.status)).length;
            const plans = new Set(db.raw().sessions.filter((s) => s.therapistId === t.id && s.planId).map((s) => s.planId)).size;
            const onLeave = t.onLeave.find((l) => t0 >= l.from && t0 <= l.to);
            const hasAccount = !!db.employeeById(t.id);
            return (
              <div className="card" key={t.id} style={{ opacity: t.active ? 1 : 0.7 }}>
                <div className="card__body">
                  <div style={{ display: 'flex', gap: 12, alignItems: 'center', marginBottom: 12 }}>
                    <span className="avatar avatar--lg">{initials(t.name)}</span>
                    <div style={{ flex: 1, minWidth: 0 }}><h3 style={{ fontSize: 16 }}>{t.name}</h3><p className="muted" style={{ fontSize: 13 }}>{t.title}</p></div>
                    {can('therapists', 'edit') && <IconAction icon="edit" label="تعديل" onClick={() => setEditing(t)} />}
                    {can('therapists', 'delete') && <IconAction icon="trash" label="حذف" danger onClick={() => setDeleting(t)} />}
                  </div>
                  <div className="kv-row"><span>الجوال</span><span className="num">{t.phone}</span></div>
                  <div className="kv-row"><span>أيام وساعات العمل</span><span>{[...t.workHours].sort(byDayOrder).map((w) => `${dayLabel(w.day)} ${w.from}–${w.to}`).join('، ') || '—'}</span></div>
                  <div className="kv-row"><span>الخدمات</span><span>كل الخدمات</span></div>
                  <div className="kv-row"><span>الجلسات المكتملة</span><span className="num">{completed}</span></div>
                  <div className="kv-row"><span>مواعيد قادمة</span><span className="num">{upcoming}</span></div>
                  <div className="kv-row"><span>خطط علاجية يتابعها</span><span className="num">{plans}</span></div>
                  <div className="kv-row"><span>حساب دخول</span><span>{hasAccount ? db.employeeById(t.id)?.username : 'لا يوجد'}</span></div>
                  {t.onLeave.length > 0 && <div className="kv-row"><span>الإجازات</span><span>{t.onLeave.map((l) => `${l.reason} (${l.from} ← ${l.to})`).join('، ')}</span></div>}
                  <div style={{ marginTop: 10, display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
                    <StatusBadge label={!t.active ? 'غير متاح' : onLeave ? 'في إجازة اليوم' : 'متاح'} tone={!t.active ? 'muted' : onLeave ? 'warn' : 'ok'} />
                    <span style={{ flex: 1 }} />
                    <Button size="sm" variant="outline" icon="calendar" onClick={() => setSchedule(t)}>جدول المواعيد</Button>
                    {can('therapists', 'edit') && <Button size="sm" variant="ghost" onClick={() => db.updateTherapist(t.id, { active: !t.active }).then(() => toast.success(t.active ? 'تم إيقاف المعالج عن الحجز.' : 'تم تفعيل المعالج.'))}>{t.active ? 'إيقاف' : 'تفعيل'}</Button>}
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      )}
      {editing && <TherapistModal therapist={editing === 'new' ? undefined : editing} onClose={() => setEditing(null)} />}
      {schedule && <ScheduleModal therapist={schedule} onClose={() => setSchedule(null)} />}
      {deleting && <ConfirmDialog title="حذف المعالج" onClose={() => setDeleting(null)}
        message={`سيتم حذف ${deleting.name} من قائمة المعالجين وخدماتها. السجلات السابقة تبقى. إن كانت له مواعيد قادمة سيُرفض الحذف.`}
        onConfirm={async () => { const r = await db.deleteTherapist(deleting.id); if (r.ok) toast.success('تم حذف المعالج.'); else toast.error(r.error); }} />}
    </div>
  );
}

export function ScheduleModal({ therapist, onClose }: { therapist: Therapist; onClose: () => void }) {
  const t0 = todayYmd();
  const list = db.appointments().filter((a) => a.therapistId === therapist.id && a.date >= t0).sort((a, b) => (a.date + a.time < b.date + b.time ? -1 : 1));
  return (
    <Modal title={`جدول مواعيد ${therapist.name}`} wide onClose={onClose}>
      {list.length === 0 ? <EmptyState icon="calendar" title="ما فيه مواعيد قادمة" /> : (
        <div className="table-wrap"><table className="table">
          <thead><tr><th>التاريخ</th><th>الوقت</th><th>المريض</th><th>الخدمة</th><th>الحالة</th></tr></thead>
          <tbody>{list.map((a) => { const st = APPT_STATUS[a.status]; return (
            <tr key={a.id}><td>{fmtDate(a.date)}</td><td className="num">{fmtTime(a.time)}</td><td>{db.patient(a.patientId)?.fullName}</td><td>{db.service(a.serviceId)?.name}</td><td><StatusBadge label={st.label} tone={st.tone} /></td></tr>
          ); })}</tbody>
        </table></div>
      )}
    </Modal>
  );
}

export function TherapistModal({ therapist, onClose }: { therapist?: Therapist; onClose: () => void }) {
  const canHours = useCan()('workhours');
  const toast = useToast();
  const [busy, setBusy] = useState(false);
  const [role, setRole] = useState<Role>('therapist');
  const isTherapist = !!therapist || role === 'therapist'; // في التعديل يفضل معالجًا دايمًا؛ في الإضافة يتقرر بالمنصب المختار
  const [f, setF] = useState({ name: therapist?.name ?? '', title: therapist?.title ?? '', phone: therapist?.phone ?? '', email: therapist?.email ?? '', bio: therapist?.bio ?? '', photoUrl: therapist?.photoUrl ?? '', defaultDurationMin: therapist?.defaultDurationMin ?? 30, serviceIds: therapist?.serviceIds ?? [] as string[] });
  const [hours, setHours] = useState<WorkHours[]>(() => [...(therapist?.workHours?.length ? therapist.workHours : defaultHours())].sort(byDayOrder));
  const [leaves, setLeaves] = useState<Leave[]>(therapist?.onLeave ?? []);
  const [account, setAccount] = useState({ password: '' });
  const [phoneErr, setPhoneErr] = useState<PhoneErrorCode | null>(null);
  const [tried, setTried] = useState(false);
  const phoneRequired = !isTherapist || !!account.password; // الجوال = اسم الدخول، فبيبقى مطلوب لو هيتعمل حساب


  const submit = async () => {
    setTried(true);
    if (f.name.trim().length < 3) { toast.error('الاسم مطلوب.'); return; }
    if (phoneErr) { toast.error(phoneErrorMessage(phoneErr)!); return; }
    if (f.email && !EMAIL_RE.test(f.email.trim())) { toast.error('البريد الإلكتروني غير صحيح.'); return; }

    // منصب غير "معالج": حساب دخول مباشر بدون ملف سريري (لا تخصص، لا جدول عمل، لا خدمات)
    if (!therapist && !isTherapist) {
      if (!f.phone.trim() || !account.password) { toast.error('رقم الجوال وكلمة المرور مطلوبان لإنشاء حساب الدخول.'); return; }
      if (account.password.length < 6) { toast.error('كلمة المرور لازم ما تقل عن 6 خانات.'); return; }
      const hErr = hoursError(hours); if (hErr) { toast.error(hErr); return; }
      setBusy(true);
      const r = await staffCall(() => api.post('staff', { name: f.name.trim(), phone: f.phone, password: account.password, role, jobTitle: f.title.trim(), workHours: cleanHours(hours) }));
      setBusy(false);
      if (!r.ok) { toast.error(r.error); return; }
      toast.success('تمت إضافة الموظف.');
      onClose();
      return;
    }

    if (!f.title.trim()) { toast.error('التخصص مطلوب.'); return; }
    const hErr = hoursError(hours); if (hErr) { toast.error(hErr); return; }
    if (leaves.some((l) => !l.from || !l.to || l.from > l.to)) { toast.error('تحقق من تواريخ الإجازات.'); return; }
    if (account.password && !f.phone.trim()) { toast.error('أدخل رقم جوال المعالج — يُستخدم لتسجيل الدخول.'); return; }
    setBusy(true);
    const payload = { name: f.name.trim(), title: f.title.trim(), phone: f.phone, photo: initials(f.name), email: f.email.trim(), bio: f.bio.trim(), photoUrl: f.photoUrl.trim(), defaultDurationMin: f.defaultDurationMin, serviceIds: db.allServices().map((s) => s.id), workHours: cleanHours(hours), onLeave: leaves };
    if (therapist) {
      try { await db.updateTherapist(therapist.id, payload); } catch (e) { setBusy(false); toast.error((e as Error).message || 'تعذّر الحفظ.'); return; }
      // حساب الدخول المربوط بالمعالج: نفس الساعات (للحضور والانصراف)
      const emp = db.employees().find((x) => x.therapistId === therapist.id);
      if (emp) await staffCall(() => api.patch('staff', emp.id, { workHours: cleanHours(hours) }));
      setBusy(false); toast.success('تم حفظ بيانات المعالج.'); onClose(); return;
    }
    const r = await db.createTherapist(payload, account.password ? { ...account, role } : undefined);
    setBusy(false);
    if (!r.ok) { toast.error(r.error); return; }
    toast.success('تمت إضافة المعالج.');
    onClose();
  };

  return (
    <Modal title={therapist ? 'تعديل بيانات المعالج' : 'إضافة معالج'} wide onClose={onClose} footer={<><Button variant="outline" onClick={onClose} disabled={busy}>إلغاء</Button><Button onClick={submit} loading={busy}>حفظ</Button></>}>
      <div className="form-section">
        <div className="form-section-title">البيانات الأساسية</div>
        {!therapist && (
          <div className="grid-form" style={{ marginBottom: 4 }}>
            <Select id="th-role" label="المنصب *" value={role} onChange={(e) => setRole(e.target.value as Role)} options={ROLES.map((r) => ({ value: r, label: ROLE_LABEL[r] }))} />
          </div>
        )}
        <div className="grid-form grid-form--3">
          <Input id="th-name" label="الاسم *" value={f.name} onChange={(e) => setF({ ...f, name: e.target.value })} />
          {isTherapist ? (
            <Input id="th-title" label="التخصص *" value={f.title} onChange={(e) => setF({ ...f, title: e.target.value })} />
          ) : (
            <Input id="th-title" label="المسمى الوظيفي (اختياري)" value={f.title} onChange={(e) => setF({ ...f, title: e.target.value })} />
          )}
          <PhoneInput id="th-phone" label={phoneRequired ? 'الجوال * (يدخل به للنظام)' : 'الجوال'} required={phoneRequired} value={f.phone} showError={tried} onChange={(v, e) => { setF((x) => ({ ...x, phone: v })); setPhoneErr(e); }} />
          {isTherapist && <Input id="th-email" label="البريد الإلكتروني" dir="ltr" value={f.email} onChange={(e) => setF({ ...f, email: e.target.value })} />}
        </div>
        {isTherapist && <div className="field"><label htmlFor="th-bio">نبذة عن الطبيب</label><textarea id="th-bio" className="input" rows={2} value={f.bio} onChange={(e) => setF({ ...f, bio: e.target.value })} /></div>}
      </div>

      {canHours && <div className="form-section">
        <div className="form-section-title">أيام وساعات العمل</div>
        <WorkHoursEditor id="th" hours={hours} onChange={setHours} />
      </div>}

      {isTherapist && (
      <div className="form-section">
        <div className="row-between" style={{ marginBottom: 12 }}><span className="form-section-title" style={{ marginBottom: 0 }}>الإجازات</span><Button size="sm" variant="outline" onClick={() => setLeaves([...leaves, { from: todayYmd(), to: todayYmd(), reason: 'إجازة' }])}>إضافة إجازة</Button></div>
        {leaves.map((l, i) => (
          <div key={i} className="grid-form" style={{ gridTemplateColumns: '1fr 1fr 1.4fr auto', alignItems: 'end' }}>
            <Input id={`lv-from-${i}`} label="من" type="date" value={l.from} onChange={(e) => setLeaves(leaves.map((x, j) => (j === i ? { ...x, from: e.target.value } : x)))} />
            <Input id={`lv-to-${i}`} label="إلى" type="date" value={l.to} onChange={(e) => setLeaves(leaves.map((x, j) => (j === i ? { ...x, to: e.target.value } : x)))} />
            <Input id={`lv-reason-${i}`} label="السبب" value={l.reason} onChange={(e) => setLeaves(leaves.map((x, j) => (j === i ? { ...x, reason: e.target.value } : x)))} />
            <div className="field"><IconAction icon="trash" label="حذف الإجازة" danger onClick={() => setLeaves(leaves.filter((_, j) => j !== i))} /></div>
          </div>
        ))}
      </div>
      )}

      {!therapist && (
        <div className="form-section">
          <div className="form-section-title">{isTherapist ? 'حساب الدخول (اختياري)' : 'حساب الدخول *'}</div>
          <p className="muted" style={{ fontSize: 13.5, marginTop: -4, marginBottom: 10 }}>
            {isTherapist ? 'إذا تبي يتمكن المعالج من دخول النظام، أدخل كلمة مرور — سيكون الدخول برقم جواله المكتوب أعلاه.' : 'مطلوب لهذا المنصب — سيكون الدخول برقم الجوال المكتوب أعلاه.'}
          </p>
          <div className="grid-form">
            <PasswordInput id="th-pass" label="كلمة المرور *" value={account.password} onChange={(e) => setAccount({ ...account, password: e.target.value })} />
          </div>
        </div>
      )}
    </Modal>
  );
}
