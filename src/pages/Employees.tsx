import { NewRequestModal } from './Requests';
import { useState } from 'react';
import { db } from '../data/db';
import { useDbVersion, useLoading } from '../hooks/useDb';
import { Button, EmptyState, Input, Modal, PasswordInput, Select, Skeleton, StatusBadge } from '../components/ui';
import { PhoneInput } from '../components/PhoneInput';
import { phoneErrorMessage, type PhoneErrorCode, phoneMatches } from '../utils/phoneUtils';
import { ConfirmDialog, FilterBar, IconAction, RowActions, useCan } from '../components/common';
import { ROLE_LABEL } from '../services/permissions';
import { ROLES } from '../services/defaultPermissions';
import type { Employee, Role, WorkHours } from '../types';
import { useToast } from '../hooks/useToast';
import { useAuth } from '../services/auth';
import { fmtDateTime } from '../utils/format';
import { WorkHoursEditor, byDayOrder, cleanHours, defaultHours, hoursError } from '../components/WorkHoursEditor';
import { api } from '../lib/api';
import { mapEmployee } from '../services/auth';

// كل عمليات حسابات الموظفين تتم على السحابة (Supabase Auth) ثم تُحدَّث القائمة المحلية
export async function staffCall(run: () => Promise<unknown>): Promise<{ ok: true } | { ok: false; error: string }> {
  try {
    await run();
    const list: any[] = await api.get('staff');
    db.setEmployees(list.map(mapEmployee));
    return { ok: true };
  } catch (e) { return { ok: false, error: e instanceof Error ? e.message : 'تعذّر الاتصال بالخادم.' }; }
}

export default function Employees({ embedded = false }: { embedded?: boolean }) {
  useDbVersion();
  const loading = useLoading();
  const { user } = useAuth();
  const toast = useToast();
  const can = useCan();
  const [editing, setEditing] = useState<Employee | 'new' | null>(null);
  const [deleting, setDeleting] = useState<Employee | null>(null);
  const [extra, setExtra] = useState<Employee | null>(null);
  const [requesting, setRequesting] = useState<string | null>(null);
  const [q, setQ] = useState('');
  const [role, setRole] = useState('');
  const [state, setState] = useState('');
  // المدير العام ومدير المركز بس يشوفوا كل الموظفين — باقي الأدوار (استقبال، سكرتير، محاسب، معالج) تشوف نفسها بس
  const canViewAll = can('employees', 'view') && (user?.role === 'system_admin' || user?.role === 'center_manager');
  const employees = (canViewAll ? db.employees() : db.employees().filter((e) => e.id === user?.id)).filter((e) =>
    (!q.trim() || e.name.includes(q.trim()) || phoneMatches(e.phone, q.trim())) &&
    (!role || e.role === role) && (!state || (state === 'on' ? e.active : !e.active)));

  return (
    <div className={embedded ? undefined : "page"}>
      <div className="page-head">
        {embedded ? <p className="muted">{canViewAll ? 'حسابات الدخول وأدوارها. تُضبط صلاحيات كل دور من «الأدوار والصلاحيات».' : 'بيانات حسابك.'}</p> : <div><h1>{canViewAll ? 'الموظفون والمستخدمون' : 'حسابي'}</h1><p>{canViewAll ? 'حسابات الدخول وأدوارها. تُضبط صلاحيات كل دور من «الأدوار والصلاحيات».' : 'بيانات حسابك.'}</p></div>}
        {can('employees', 'create') && <Button icon="user" onClick={() => setEditing('new')}>إضافة مستخدم</Button>}
      </div>
      <div className="card">
        {canViewAll && (
        <FilterBar>
          <Input id="em-q" label="بحث" icon="search" placeholder="الاسم أو رقم الجوال" value={q} onChange={(e) => setQ(e.target.value)} />
          <Select id="em-role" label="الدور" value={role} onChange={(e) => setRole(e.target.value)} options={[{ value: '', label: 'كل الأدوار' }, ...ROLES.map((r) => ({ value: r, label: ROLE_LABEL[r] }))]} />
          <Select id="em-state" label="الحالة" value={state} onChange={(e) => setState(e.target.value)} options={[{ value: '', label: 'الكل' }, { value: 'on', label: 'نشط' }, { value: 'off', label: 'معطّل' }]} />
        </FilterBar>
        )}
        <div className="card__body">
          {loading ? <Skeleton h={220} /> : employees.length === 0 ? <EmptyState icon="user" title="ما فيه موظفون" text="أضف حسابات الموظفين من زر «إضافة مستخدم» — يمكن لكل حساب تسجيل الدخول برقم الجوال وكلمة المرور." /> : (
            <div className="table-wrap"><table className="table">
              <thead><tr><th>الاسم</th><th>رقم الجوال (للدخول)</th><th>الدور</th><th>تاريخ الإنشاء</th><th>آخر دخول</th><th>الحالة</th><th className="actions">الإجراءات</th></tr></thead>
              <tbody>{employees.map((e) => (
                <tr key={e.id}>
                  <td style={{ fontWeight: 600 }}>{e.name}</td><td className="num">{e.phone || '—'}</td>
                  <td><span className="role-tag">{ROLE_LABEL[e.role]}</span></td><td className="num date">{fmtDateTime(e.createdAt)}</td>
                  <td className="num">{e.lastLogin ? fmtDateTime(e.lastLogin) : '—'}</td>
                  <td>{db.activeLeave(e.id) ? <StatusBadge label={db.activeLeave(e.id)!.type === 'leave' ? 'في إجازة' : 'مستأذن'} tone="info" /> : <StatusBadge label={e.active ? 'نشط' : 'معطّل'} tone={e.active ? 'ok' : 'muted'} />}</td>
                  <td className="actions">
                    <RowActions>
                      {can('employees', 'edit') && <IconAction icon="edit" label="تعديل" onClick={() => setEditing(e)} />}
                      {can('roles', 'edit') && e.role !== 'system_admin' && <IconAction icon="shield" label="صلاحيات إضافية (واتساب)" onClick={() => setExtra(e)} />}
                      {can('requests', 'create') && <Button size="sm" variant="outline" icon="calendarPlus" onClick={() => setRequesting(e.id)}>استئذان / إجازة</Button>}
                      {can('requests', 'edit') && db.activeLeave(e.id) && (
                        <Button size="sm" variant="outline" onClick={async () => { const r = await db.endStaffLeave(db.activeLeave(e.id)!.id); if (r.ok) toast.success('تم إنهاء الإجازة/الاستئذان — يمكن للموظف دخول النظام الحين.'); else toast.error(r.error); }}>إنهاء الإجازة</Button>
                      )}
                      {e.id !== user?.id && can('employees', 'edit') && (
                        <Button size="sm" variant="outline" onClick={async () => { const r = await staffCall(() => api.patch('staff', e.id, { active: !e.active })); if (r.ok) toast.success(e.active ? 'تم تعطيل الحساب' : 'تم تفعيل الحساب'); else toast.error(r.error); }}>{e.active ? 'تعطيل' : 'تفعيل'}</Button>
                      )}
                      {e.id !== user?.id && can('employees', 'delete') && <IconAction icon="trash" label="حذف" danger onClick={() => setDeleting(e)} />}
                    </RowActions>
                  </td>
                </tr>
              ))}</tbody>
            </table></div>
          )}
        </div>
      </div>
      {extra && <ExtraPermsModal employee={extra} onClose={() => setExtra(null)} />}
      {editing && <EmployeeModal employee={editing === 'new' ? undefined : editing} self={editing !== 'new' && editing.id === user?.id} onClose={() => setEditing(null)} />}
      {requesting && <NewRequestModal employeeId={requesting} onClose={() => setRequesting(null)} />}
      {deleting && <ConfirmDialog title="حذف حساب المستخدم" onClose={() => setDeleting(null)}
        message={`سيتم حذف حساب ${deleting.name} (${deleting.phone}) نهائيًا ولن يتمكن من الدخول. سجلات عملياته السابقة تبقى.`}
        onConfirm={async () => { const r = await staffCall(() => api.del('staff', deleting.id)); if (r.ok) toast.success('تم حذف الحساب.'); else toast.error(r.error); }} />}
    </div>
  );
}

export function EmployeeModal({ employee, self, onClose }: { employee?: Employee; self: boolean; onClose: () => void }) {
  const canHours = useCan()('workhours');
  const toast = useToast();
  const [f, setF] = useState({ name: employee?.name ?? '', password: '', role: employee?.role ?? ('reception' as Role), phone: employee?.phone ?? '', jobTitle: employee?.jobTitle ?? '' });
  const [busy, setBusy] = useState(false);
  const [phoneErr, setPhoneErr] = useState<PhoneErrorCode | null>(null);
  const [tried, setTried] = useState(false);
  // ساعات الدوام: للمعالج المربوط بالحساب من ملف المعالج (اللي الحجز بيقرا منه)، ولباقي الموظفين من حسابهم
  const linkedTherapist = employee?.therapistId ? db.therapist(employee.therapistId) : undefined;
  const [hours, setHours] = useState<WorkHours[]>(() => {
    const src = linkedTherapist?.workHours?.length ? linkedTherapist.workHours : employee?.workHours?.length ? employee.workHours : employee ? [] : defaultHours();
    return [...src].sort(byDayOrder);
  });
  const submit = async () => {
    setTried(true);
    if (!employee && phoneErr) { toast.error(phoneErrorMessage(phoneErr)!); return; }
    if (!f.name.trim() || (!employee && !f.phone) || (!employee && !f.password)) { toast.error('أكمل البيانات المطلوبة.'); return; }
    if (f.password && f.password.length < 6) { toast.error('كلمة المرور لازم ما تقل عن 6 أحرف.'); return; }
    const hErr = hoursError(hours); if (hErr) { toast.error(hErr); return; }
    setBusy(true);
    const base = { name: f.name.trim(), role: f.role, phone: employee ? employee.phone : f.phone, jobTitle: f.jobTitle.trim(), workHours: cleanHours(hours) };
    if (linkedTherapist) {
      // نفس الساعات على ملف المعالج — عشان الحجز وجدول اليوم يتغيروا فورًا
      try { await db.updateTherapist(linkedTherapist.id, { workHours: cleanHours(hours) }); } catch (e) { setBusy(false); toast.error((e as Error).message || 'تعذّر حفظ ساعات المعالج.'); return; }
    }
    const r = await staffCall(() => employee
      ? api.patch('staff', employee.id, f.password ? { ...base, password: f.password } : base)
      : api.post('staff', { ...base, password: f.password }));
    setBusy(false);
    if (!r.ok) { toast.error(r.error); return; }
    toast.success(employee ? 'تم حفظ بيانات المستخدم.' : 'تم إنشاء حساب المستخدم.');
    onClose();
  };
  return (
    <Modal title={employee ? 'تعديل المستخدم' : 'إضافة مستخدم'} onClose={onClose} footer={<><Button variant="outline" onClick={onClose} disabled={busy}>إلغاء</Button><Button onClick={submit} loading={busy}>حفظ</Button></>}>
      <Input id="emm-name" label="الاسم الكامل *" value={f.name} onChange={(e) => setF({ ...f, name: e.target.value })} />
      <PhoneInput id="emm-phone" label="رقم الجوال * (يدخل به الموظف للنظام)" disabled={!!employee} value={f.phone} showError={tried} onChange={(v, e) => { setF((x) => ({ ...x, phone: v })); setPhoneErr(e); }} />
      <PasswordInput id="emm-pass" label={employee ? 'كلمة مرور جديدة (اتركها فارغة للإبقاء)' : 'كلمة المرور *'} value={f.password} onChange={(e) => setF({ ...f, password: e.target.value })} />
      <Select id="emm-role" label="الدور" value={f.role} disabled={self} onChange={(e) => setF({ ...f, role: e.target.value as Role })} options={ROLES.map((r) => ({ value: r, label: ROLE_LABEL[r] }))} />
      {self && <p className="muted" style={{ fontSize: 12.5, marginTop: -8 }}>ما تقدر تغيّر دورك بنفسك.</p>}
      {canHours && <div className="form-section" style={{ marginTop: 12 }}>
        <div className="form-section-title">أيام وساعات العمل</div>
        <WorkHoursEditor id="emm" hours={hours} onChange={setHours} />
        {linkedTherapist && <p className="muted-sm" style={{ marginTop: 6 }}>هذي هي ساعات المعالج نفسها في الحجز وجدول المواعيد — أي تعديل هنا يُطبَّق هناك.</p>}
      </div>}
    </Modal>
  );
}

// تفعيل/تعطيل صلاحيتين لموظف بعينه فوق صلاحيات دوره — من غير ما ياخد صلاحيات المدير
function ExtraPermsModal({ employee, onClose }: { employee: Employee; onClose: () => void }) {
  const toast = useToast();
  const [wa, setWa] = useState(!!employee.extraPerms?.whatsapp?.includes('create'));
  const [lo, setLo] = useState(!!employee.extraPerms?.loyalty?.includes('create'));
  const [busy, setBusy] = useState(false);
  const save = async () => {
    setBusy(true);
    const r = await db.setEmployeeExtraPerms(employee.id, wa, lo);
    setBusy(false);
    if (!r.ok) { toast.error(r.error); return; }
    toast.success('تم حفظ الصلاحيات — تُفعَّل للموظف من أول تسجيل دخول/تحديث للصفحة.');
    onClose();
  };
  const row = (checked: boolean, set: (v: boolean) => void, title: string, desc: string) => (
    <label className="card" style={{ display: 'flex', gap: 12, alignItems: 'flex-start', padding: '12px 14px', marginBottom: 10, cursor: 'pointer' }}>
      <input type="checkbox" checked={checked} onChange={(e) => set(e.target.checked)} style={{ marginTop: 4, width: 18, height: 18 }} />
      <span><strong>{title}</strong><span className="muted-sm" style={{ display: 'block' }}>{desc}</span></span>
    </label>
  );
  return (
    <Modal title="صلاحيات إضافية" onClose={onClose}
      footer={<><Button variant="outline" onClick={onClose} disabled={busy}>إلغاء</Button><Button icon="check" onClick={save} loading={busy}>حفظ</Button></>}>
      <p style={{ marginTop: 0 }}><strong data-no-i18n>{employee.name}</strong> · {ROLE_LABEL[employee.role]}</p>
      <p className="muted-sm">إضافة إلى صلاحيات الدور — لا تحذف شي من صلاحياته الحالية.</p>
      {row(wa, setWa, 'إرسال رسائل واتساب للعملاء', 'تذكير المواعيد، الخطط، أكواد المكافآت والعروض — وتُسجَّل كل رسالة باسمه.')}
      {false && row(lo, setLo, 'استبدال نقاط الولاء', 'البحث عن العميل بالاسم أو الجوال، عرض رصيده، واستبدال النقاط بجلسة مجانية له أو لشخص يختاره.')}
    </Modal>
  );
}
