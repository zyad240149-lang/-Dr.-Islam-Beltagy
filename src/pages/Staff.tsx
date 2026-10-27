import { useState } from 'react';
import { db } from '../data/db';
import { useDbVersion, useLoading } from '../hooks/useDb';
import { Button, EmptyState, Input, Select, Skeleton, StatusBadge } from '../components/ui';
import { ConfirmDialog, FilterBar, IconAction, RowActions, useCan } from '../components/common';
import { ROLE_LABEL } from '../services/permissions';
import { ROLES } from '../services/defaultPermissions';
import type { Employee, Therapist } from '../types';
import { useToast } from '../hooks/useToast';
import { useAuth } from '../services/auth';
import { fmtDateTime, todayYmd } from '../utils/format';
import { api } from '../lib/api';
import { EmployeeModal, staffCall } from './Employees';
import { ScheduleModal, TherapistModal } from './Therapists';
import { NewRequestModal } from './Requests';
import { phoneMatches } from '../utils/phoneUtils';

// صفٌّ واحد يمثّل إما حساب موظف (مع ملفه السريري كمعالج إن وُجد) أو معالجًا بلا حساب دخول
type Row = { id: string; name: string; phone: string; positionLabel: string; active: boolean; onLeave: boolean; createdAt: number | null; lastLogin: number | null; employee?: Employee; therapist?: Therapist };

export default function Staff({ embedded = false }: { embedded?: boolean }) {
  useDbVersion();
  const loading = useLoading();
  const { user } = useAuth();
  const toast = useToast();
  const can = useCan();
  const [editingEmployee, setEditingEmployee] = useState<Employee | 'new' | null>(null);
  const [editingTherapist, setEditingTherapist] = useState<Therapist | 'new' | null>(null);
  const [scheduling, setScheduling] = useState<Therapist | null>(null);
  const [deletingEmployee, setDeletingEmployee] = useState<Employee | null>(null);
  const [deletingTherapist, setDeletingTherapist] = useState<Therapist | null>(null);
  const [requesting, setRequesting] = useState<string | null>(null);
  const [q, setQ] = useState('');
  const [role, setRole] = useState('');
  const [state, setState] = useState('');

  // المدير العام ومدير المركز بس يشوفوا كل الحسابات — باقي الموظفين يشوفوا حسابهم هم بس
  const canViewAll = (can('employees', 'view') || can('therapists', 'view')) && (user?.role === 'system_admin' || user?.role === 'center_manager');
  const employees = db.employees();
  const therapists = db.allTherapists();
  const t0 = todayYmd();
  const linkedTherapistIds = new Set(employees.filter((e) => e.therapistId).map((e) => e.therapistId));

  const rows: Row[] = [
    ...employees.map((e): Row => {
      const linked = e.therapistId ? therapists.find((t) => t.id === e.therapistId) : undefined;
      const onLeave = linked?.onLeave.some((l) => t0 >= l.from && t0 <= l.to) ?? false;
      return { id: `e:${e.id}`, name: e.name, phone: e.phone, positionLabel: ROLE_LABEL[e.role], active: e.active, onLeave, createdAt: e.createdAt, lastLogin: e.lastLogin, employee: e, therapist: linked };
    }),
    ...therapists.filter((t) => !linkedTherapistIds.has(t.id)).map((t): Row => ({
      id: `t:${t.id}`, name: t.name, phone: t.phone, positionLabel: t.title || ROLE_LABEL.therapist, active: t.active,
      onLeave: t.onLeave.some((l) => t0 >= l.from && t0 <= l.to), createdAt: null, lastLogin: null, therapist: t,
    })),
  ];

  const scoped = !canViewAll ? rows.filter((r) => r.employee?.id === user?.id) : rows;
  const filtered = scoped.filter((r) =>
    (!q.trim() || r.name.includes(q.trim()) || phoneMatches(r.phone, q.trim())) &&
    (!role || (role === 'therapist' ? !!r.therapist : r.employee?.role === role)) &&
    (!state || (state === 'on' ? r.active : !r.active)));

  const toggleTherapistActive = async (t: Therapist) => {
    try { await db.updateTherapist(t.id, { active: !t.active }); toast.success(t.active ? 'تم إيقاف المعالج عن الحجز.' : 'تم تفعيل المعالج.'); } catch (e) { toast.error((e as Error).message); }
  };
  const toggleEmployeeActive = async (e: Employee) => {
    const r = await staffCall(() => api.patch('staff', e.id, { active: !e.active }));
    if (r.ok) toast.success(e.active ? 'تم تعطيل الحساب' : 'تم تفعيل الحساب'); else toast.error(r.error);
  };

  return (
    <div className={embedded ? undefined : 'page'}>
      <div className="page-head">
        {embedded ? <p className="muted">حسابات الموظفين، والأطباء والمعالجون في مكان واحد.</p> : <div><h1>الموظفون</h1><p>حسابات الموظفين، والأطباء والمعالجون في مكان واحد.</p></div>}
        <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
          {(can('therapists', 'create') || can('employees', 'create')) && <Button icon="stethoscope" onClick={() => setEditingTherapist('new')}>إضافة معالج</Button>}
        </div>
      </div>
      <div className="card">
        {canViewAll && (
          <FilterBar>
            <Input id="stf-q" label="بحث" icon="search" placeholder="الاسم أو رقم الجوال" value={q} onChange={(e) => setQ(e.target.value)} />
            <Select id="stf-role" label="المنصب" value={role} onChange={(e) => setRole(e.target.value)}
              options={[{ value: '', label: 'كل المناصب' }, ...ROLES.map((r) => ({ value: r, label: ROLE_LABEL[r] }))]} />
            <Select id="stf-state" label="الحالة" value={state} onChange={(e) => setState(e.target.value)} options={[{ value: '', label: 'الكل' }, { value: 'on', label: 'نشط' }, { value: 'off', label: 'معطّل' }]} />
          </FilterBar>
        )}
        <div className="card__body">
          {loading ? <Skeleton h={220} /> : filtered.length === 0 ? (
            <EmptyState icon="user" title="ما فيه موظفون" text="أضف حسابات الموظفين أو المعالجين من الأزرار أعلاه." />
          ) : (
            <div className="table-wrap"><table className="table">
              <thead><tr><th>الاسم</th><th>المنصب</th><th>رقم الجوال</th><th>تاريخ الإنشاء</th><th>آخر دخول</th><th>الحالة</th><th className="actions">الإجراءات</th></tr></thead>
              <tbody>{filtered.map((r) => (
                <tr key={r.id}>
                  <td style={{ fontWeight: 600, whiteSpace: 'nowrap' }}>{r.name}</td>
                  <td><span className="role-tag">{r.positionLabel}</span>{!r.employee && <div className="muted-sm" style={{ whiteSpace: 'nowrap', marginTop: 4 }}>بدون حساب دخول</div>}</td>
                  <td className="num" dir="ltr" style={{ whiteSpace: 'nowrap', textAlign: 'right' }}>{r.phone || '—'}</td>
                  <td className="num" style={{ whiteSpace: 'nowrap' }}>{r.createdAt ? fmtDateTime(r.createdAt) : '—'}</td>
                  <td className="num" style={{ whiteSpace: 'nowrap' }}>{r.lastLogin ? fmtDateTime(r.lastLogin) : '—'}</td>
                  <td>{r.onLeave ? <StatusBadge label="في إجازة" tone="info" /> : <StatusBadge label={r.active ? 'نشط' : 'معطّل'} tone={r.active ? 'ok' : 'muted'} />}</td>
                  <td className="actions">
                    <RowActions>
                      {r.employee && can('employees', 'edit') && <IconAction icon="edit" label="تعديل الحساب" onClick={() => setEditingEmployee(r.employee!)} />}
                      {r.therapist && can('therapists', 'edit') && <IconAction icon="stethoscope" label="الملف السريري" onClick={() => setEditingTherapist(r.therapist!)} />}
                      {r.therapist && <IconAction icon="calendar" label="جدول المواعيد" onClick={() => setScheduling(r.therapist!)} />}
                      {r.employee && can('requests', 'create') && <Button size="sm" variant="outline" icon="calendarPlus" onClick={() => setRequesting(r.employee!.id)}>استئذان / إجازة</Button>}
                      {r.employee && can('requests', 'edit') && db.activeLeave(r.employee.id) && (
                        <Button size="sm" variant="outline" onClick={async () => { const r2 = await db.endStaffLeave(db.activeLeave(r.employee!.id)!.id); if (r2.ok) toast.success('تم إنهاء الإجازة/الاستئذان — يمكن للموظف دخول النظام الحين.'); else toast.error(r2.error); }}>إنهاء الإجازة</Button>
                      )}
                      {r.employee && r.employee.id !== user?.id && can('employees', 'edit') && (
                        <Button size="sm" variant="outline" onClick={() => toggleEmployeeActive(r.employee!)}>{r.employee.active ? 'تعطيل' : 'تفعيل'}</Button>
                      )}
                      {!r.employee && r.therapist && can('therapists', 'edit') && (
                        <Button size="sm" variant="outline" onClick={() => toggleTherapistActive(r.therapist!)}>{r.therapist.active ? 'إيقاف' : 'تفعيل'}</Button>
                      )}
                      {r.employee && r.employee.id !== user?.id && can('employees', 'delete') && <IconAction icon="trash" label="حذف الحساب" danger onClick={() => setDeletingEmployee(r.employee!)} />}
                      {!r.employee && r.therapist && can('therapists', 'delete') && <IconAction icon="trash" label="حذف المعالج" danger onClick={() => setDeletingTherapist(r.therapist!)} />}
                    </RowActions>
                  </td>
                </tr>
              ))}</tbody>
            </table></div>
          )}
        </div>
      </div>

      {editingEmployee && <EmployeeModal employee={editingEmployee === 'new' ? undefined : editingEmployee} self={editingEmployee !== 'new' && editingEmployee.id === user?.id} onClose={() => setEditingEmployee(null)} />}
      {editingTherapist && <TherapistModal therapist={editingTherapist === 'new' ? undefined : editingTherapist} onClose={() => setEditingTherapist(null)} />}
      {scheduling && <ScheduleModal therapist={scheduling} onClose={() => setScheduling(null)} />}
      {requesting && <NewRequestModal employeeId={requesting} onClose={() => setRequesting(null)} />}
      {deletingEmployee && (
        <ConfirmDialog title="حذف حساب المستخدم" onClose={() => setDeletingEmployee(null)}
          message={`سيتم حذف حساب ${deletingEmployee.name} (${deletingEmployee.phone}) نهائيًا ولن يتمكن من الدخول. سجلات عملياته السابقة تبقى.`}
          onConfirm={async () => { const r = await staffCall(() => api.del('staff', deletingEmployee.id)); if (r.ok) toast.success('تم حذف الحساب.'); else toast.error(r.error); }} />
      )}
      {deletingTherapist && (
        <ConfirmDialog title="حذف المعالج" onClose={() => setDeletingTherapist(null)}
          message={`سيتم حذف ${deletingTherapist.name} من قائمة المعالجين وخدماتها. السجلات السابقة تبقى. إن كانت له مواعيد قادمة سيُرفض الحذف.`}
          onConfirm={async () => { const r = await db.deleteTherapist(deletingTherapist.id); if (r.ok) toast.success('تم حذف المعالج.'); else toast.error(r.error); }} />
      )}
    </div>
  );
}
