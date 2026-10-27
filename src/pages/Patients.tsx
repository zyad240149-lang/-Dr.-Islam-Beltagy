import { CompletenessBadge } from '../components/PatientCompleteness';
import { LocalDataNote, PendingSyncTag } from '../components/OfflineStatus';
import { useEffect, useState, type ReactNode } from 'react';
import OnlineAccounts from './OnlineAccounts';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { db, type PatientRow } from '../data/db';
import { useDbVersion } from '../hooks/useDb';
import { Icon } from '../utils/icons';
import { Button, EmptyState, ErrorState, Input, Select, Skeleton, StatusBadge } from '../components/ui';
import { ConfirmDialog, FilterBar, IconAction, RowActions, useCan } from '../components/common';
import { fmtDate, REFERRAL_SOURCE_LABEL, exportCsv, money, tsToYmd } from '../utils/format';
import { useToast } from '../hooks/useToast';
import { useAuth } from '../services/auth';
import { exportPatientsWorkbook } from '../utils/patientsWorkbook';
import ImportPatientsModal from '../components/ImportPatientsModal';
import { EditPatientModal, NewPatientModal, PlanModal } from '../components/PatientForms';
import BookingWizard from '../components/BookingWizard';
import { patientGaps } from '../utils/patientGaps';

const PAGE_SIZE = 15;
const SORTS = [
  { value: 'registered_desc', label: 'الأحدث تسجيلًا' }, { value: 'registered_asc', label: 'الأقدم تسجيلًا' }, { value: 'name_asc', label: 'الاسم (أ-ي)' },
  { value: 'name_desc', label: 'الاسم (ي-أ)' }, { value: 'last_visit_desc', label: 'آخر زيارة' }, { value: 'file_asc', label: 'رقم الملف (الأصغر للأكبر)' }, { value: 'file_desc', label: 'رقم الملف (الأكبر للأصغر)' },
];

// «المرضى» قسم واحد بتبويبين: كل المرضى + «حسابات المرضى الأونلاين» (?tab=online) — التبويب التاني لصلاحية online_accounts بس
export default function Patients() {
  const can = useCan();
  const [params, setParams] = useSearchParams();
  const showOnline = can('online_accounts');
  const tab = params.get('tab') === 'online' && showOnline ? 'online' : 'all';
  const go = (t: 'all' | 'online') => setParams(t === 'online' ? { tab: 'online' } : {}, { replace: true });
  const tabs = showOnline ? (
    <div className="tabs" style={{ marginBottom: 14 }}>
      <button type="button" className={`tab ${tab === 'all' ? 'active' : ''}`} onClick={() => go('all')}>كل المرضى</button>
      <button type="button" className={`tab ${tab === 'online' ? 'active' : ''}`} onClick={() => go('online')}>حسابات المرضى الأونلاين</button>
    </div>
  ) : null;
  return tab === 'online' ? <OnlineAccounts tabs={tabs} /> : <PatientsList tabs={tabs} />;
}

function PatientsList({ tabs }: { tabs: ReactNode }) {
  const version = useDbVersion();
  const navigate = useNavigate();
  const toast = useToast();
  const can = useCan();
  const { user } = useAuth();
  const [importing, setImporting] = useState(false);
  const [params] = useSearchParams();
  const [q, setQ] = useState(params.get('q') ?? '');
  const [dq, setDq] = useState(q);
  const [gender, setGender] = useState('');
  const [source, setSource] = useState('');
  const [active, setActive] = useState('');
  const [doctor, setDoctor] = useState('');
  const [sort, setSort] = useState('registered_desc');
  const [gaps, setGaps] = useState('');
  const [page, setPage] = useState(1);
  const [rows, setRows] = useState<PatientRow[]>([]);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [local, setLocal] = useState(false); // النتائج من المرضى المحفوظين على الجهاز (بدون إنترنت)
  const [tick, setTick] = useState(0);
  // ?new=1 (من زرار «إضافة مريض جديد» في الحجز) ← نافذة إضافة المريض بتفتح على طول
  const [adding, setAdding] = useState(params.get('new') === '1');
  const [editing, setEditing] = useState<PatientRow | null>(null);
  const [booking, setBooking] = useState<PatientRow | null>(null);
  const [planning, setPlanning] = useState<PatientRow | null>(null);
  const [deleting, setDeleting] = useState<PatientRow | null>(null);
  const [minSessions, setMinSessions] = useState('3');

  // بحث مؤجَّل نصف ثانية بعد التوقف عن الكتابة
  useEffect(() => { const t = setTimeout(() => { setDq(q); setPage(1); }, 400); return () => clearTimeout(t); }, [q]);

  // كل الفلاتر والفرز والترقيم تُنفَّذ في قاعدة البيانات
  useEffect(() => {
    let live = true;
    setLoading(true); setError('');
    db.queryPatients({ q: dq, gender, source, active, doctorId: doctor, sort, gaps, page, pageSize: PAGE_SIZE }).then((r) => {
      if (!live) return;
      if (r.ok) { setRows(r.rows); setTotal(r.total); setLocal(!!r.local); } else setError(r.error);
      setLoading(false);
    });
    return () => { live = false; };
  }, [dq, gender, source, active, doctor, sort, gaps, page, tick, version]);

  const pages = Math.max(1, Math.ceil(total / PAGE_SIZE));
  const reload = () => setTick((t) => t + 1);
  const setF = <T,>(fn: (v: T) => void) => (v: T) => { fn(v); setPage(1); };

  const sessionCounts = db.completedSessionCounts();
  const minN = Math.max(0, parseInt(minSessions, 10) || 0);
  const frequent = db.patients().map((p) => ({ p, count: sessionCounts[p.id] ?? 0 })).filter((x) => x.count >= minN).sort((a, b) => b.count - a.count);

  const toggleActive = async (p: PatientRow) => {
    try { await db.updatePatient(p.id, { active: !p.active }); toast.success(p.active ? 'تم تعطيل ملف المريض.' : 'تم تفعيل ملف المريض.'); reload(); } catch (e) { toast.error((e as Error).message); }
  };

  return (
    <div className="page">
      <div className="page-head">
        <div><h1>المرضى</h1><p>سجل جميع مرضى المركز.{(user?.role === 'system_admin' || user?.role === 'center_manager') && <> — <span className="num">{total}</span> مريض</>}</p></div>
        <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
          {can('patient_import', 'create') && <Button variant="outline" icon="plus" onClick={() => setImporting(true)}>استيراد المرضى من Excel</Button>}
          {can('patient_export', 'view') && <Button variant="outline" icon="doc" onClick={() => { try { exportPatientsWorkbook(); } catch (e) { toast.error((e as Error).message); } }}>تصدير ملف المرضى (Excel)</Button>}
          {can('patients', 'create') && <Button icon="user" onClick={() => setAdding(true)}>فتح ملف مريض جديد</Button>}
        </div>
      </div>
      {local && <LocalDataNote />}
      {tabs}

      <div className="card">
        <FilterBar>
          <Input id="pt-q" label="بحث" icon="search" placeholder="الاسم أو الجوال أو رقم الملف أو الهوية" value={q} onChange={(e) => setQ(e.target.value)} />
          {can('pt_f_gender') && <Select id="pt-g" label="الجنس" value={gender} onChange={(e) => setF(setGender)(e.target.value)} options={[{ value: '', label: 'الكل' }, { value: 'male', label: 'رجل' }, { value: 'female', label: 'امرأة' }]} />}
          {can('pt_f_source') && <Select id="pt-s" label="مصدر المعرفة" value={source} onChange={(e) => setF(setSource)(e.target.value)} options={[{ value: '', label: 'الكل' }, ...Object.entries(REFERRAL_SOURCE_LABEL).map(([value, label]) => ({ value, label }))]} />}
          {can('pt_f_doctor') && <Select id="pt-d" label="الطبيب" value={doctor} onChange={(e) => setF(setDoctor)(e.target.value)} options={[{ value: '', label: 'الكل' }, ...db.allTherapists().map((t) => ({ value: t.id, label: t.name }))]} />}
          {can('pt_f_status') && <Select id="pt-a" label="الحالة" value={active} onChange={(e) => setF(setActive)(e.target.value)} options={[{ value: '', label: 'الكل' }, { value: 'on', label: 'نشط' }, { value: 'off', label: 'معطّل' }]} />}
          {can('pt_f_sort') && <Select id="pt-o" label="الترتيب" value={sort} onChange={(e) => setF(setSort)(e.target.value)} options={SORTS} />}
          <Select id="pt-gaps" label="بيانات ناقصة" value={gaps} onChange={(e) => setF(setGaps)(e.target.value)} options={[{ value: '', label: 'الكل' }, { value: 'any', label: 'أي نقص في البيانات' }, { value: 'id', label: 'بدون رقم هوية' }, { value: 'phone', label: 'بدون رقم جوال' }, { value: 'name', label: 'اسم غير ثلاثي' }, { value: 'nationality', label: 'جنسية غير مؤكدة' }, { value: 'gender', label: 'الجنس غير محدد' }]} />
        </FilterBar>
        <div className="card__body">
          {error ? <ErrorState onRetry={reload} /> : loading && rows.length === 0 ? <Skeleton h={220} /> : rows.length === 0 ? (
            <EmptyState icon="users" title="ما فيه مرضى" text={dq || gender || source || active || doctor || gaps ? 'ما تم العثور على نتائج مطابقة.' : 'أضف أول مريض من زر «إضافة مريض».'} />
          ) : (
            <>
              <div className="table-wrap" style={{ opacity: loading ? 0.6 : 1 }}>
                <table className="table">
                  <thead><tr><th>رقم الملف</th><th>اسم المريض</th><th>رقم الجوال</th><th>الطبيب</th><th>آخر زيارة</th><th>الحالة</th><th>تاريخ التسجيل</th><th className="actions">الإجراءات</th></tr></thead>
                  <tbody>
                    {rows.map((p) => (
                      <tr key={p.id} style={{ cursor: 'pointer' }} onClick={() => navigate(`/patients/${p.id}`)}>
                        <td className="num">{p.fileNo}</td>
                        <td style={{ fontWeight: 600 }}>{p.fullName}{p.pendingSync && <PendingSyncTag />}<div><CompletenessBadge patient={p} full /></div>{p.balance > 0 && can('invoices', 'view') && <div className="muted-sm">مستحق: <span className="num">{money(p.balance)}</span></div>}</td>
                        <td className="num">{p.phone}</td>
                        <td>{p.doctorName || '—'}</td>
                        <td>{p.lastVisit ? fmtDate(p.lastVisit) : '—'}</td>
                        <td><StatusBadge label={p.active ? 'نشط' : 'معطّل'} tone={p.active ? 'ok' : 'muted'} /></td>
                        <td>{fmtDate(tsToYmd(p.registeredAt))}</td>
                        <td className="actions" onClick={(e) => e.stopPropagation()}>
                          <RowActions>
                            <IconAction icon="eye" label="عرض الملف" onClick={() => navigate(`/patients/${p.id}`)} />
                            {can('patients', 'edit') && <IconAction icon="edit" label="تعديل" onClick={() => setEditing(p)} />}
                            {(can('booking', 'create') || can('appointments', 'create')) && p.active && <IconAction icon="calendarPlus" label="إضافة موعد" onClick={() => setBooking(p)} />}
                            {can('plans', 'create') && <IconAction icon="target" label="خطة العلاج" onClick={() => setPlanning(p)} />}
                            {can('patients', 'edit') && <IconAction icon="lock" label={p.active ? 'تعطيل' : 'تفعيل'} onClick={() => toggleActive(p)} />}
                            {can('patients', 'delete') && <IconAction icon="trash" label="حذف المريض" danger onClick={() => setDeleting(p)} />}
                          </RowActions>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              <div className="row-between" style={{ marginTop: 12, flexWrap: 'wrap', gap: 8 }}>
                <span className="muted">عرض <span className="num">{(page - 1) * PAGE_SIZE + 1}</span>–<span className="num">{Math.min(page * PAGE_SIZE, total)}</span> من <span className="num">{total}</span></span>
                <span style={{ display: 'flex', gap: 6, alignItems: 'center' }}>
                  <Button size="sm" variant="outline" disabled={page <= 1} onClick={() => setPage(page - 1)}>السابق</Button>
                  <span className="num muted">{page} / {pages}</span>
                  <Button size="sm" variant="outline" disabled={page >= pages} onClick={() => setPage(page + 1)}>التالي</Button>
                </span>
              </div>
            </>
          )}
        </div>
      </div>

      <div className="card" style={{ marginTop: 16 }}>
        <div className="card__head" style={{ flexWrap: 'wrap' }}>
          <div style={{ flex: 1, minWidth: 200 }}><h3 style={{ margin: 0 }}>المرضى حسب عدد الجلسات</h3><p className="muted" style={{ margin: '4px 0 0', fontSize: 13 }}>المرضى الذين أتمّوا عدد الجلسات المحدد أو أكثر.</p></div>
          <div style={{ width: 170 }}><Input label="عدد الجلسات (على الأقل)" type="number" min={0} value={minSessions} onChange={(e) => setMinSessions(e.target.value)} /></div>
        </div>
        <div className="card__body">
          {frequent.length === 0 ? <EmptyState icon="users" title="ما فيه مرضى مطابقون" text="ما فيه مريض وصل لعدد الجلسات المحدد بعد." /> : (
            <div className="table-wrap"><table className="table">
              <thead><tr><th>الاسم</th><th>رقم الملف</th><th>عدد الجلسات المكتملة</th><th className="actions"></th></tr></thead>
              <tbody>{frequent.slice(0, 50).map(({ p, count }) => (
                <tr key={p.id} style={{ cursor: 'pointer' }} onClick={() => navigate(`/patients/${p.id}`)}><td style={{ fontWeight: 600 }}>{p.fullName}</td><td className="num">{p.fileNo}</td><td className="num">{count}</td><td className="actions"><Icon name="chevronLeft" size={16} /></td></tr>
              ))}</tbody>
            </table></div>
          )}
        </div>
      </div>

      {adding && <NewPatientModal onClose={() => setAdding(false)} onCreated={(id) => navigate(`/patients/${id}`)} />}
      {editing && <EditPatientModal patient={db.patient(editing.id) ?? editing} onClose={() => { setEditing(null); reload(); }} />}
      {booking && <BookingWizard presetPatientId={booking.id} onClose={() => { setBooking(null); reload(); }} />}
      {planning && <PlanModal patientId={planning.id} onClose={() => { setPlanning(null); reload(); }} />}
      {deleting && (
        <ConfirmDialog title="حذف ملف المريض" onClose={() => setDeleting(null)}
          message={<>سيتم حذف ملف <b>{deleting.fullName}</b> ({deleting.fileNo}) نهائيًا. ما يمكن حذف مريض عنده زيارات أو مدفوعات — استخدم «تعطيل» بدل الحذف للاحتفاظ بالسجلات.</>}
          onConfirm={async () => { const r = await db.deletePatient(deleting.id); if (r.ok) { toast.success('تم حذف ملف المريض.'); reload(); } else toast.error(r.error); }} />
      )}
      {importing && <ImportPatientsModal onClose={() => setImporting(false)} onDone={reload} />}
    </div>
  );
}
