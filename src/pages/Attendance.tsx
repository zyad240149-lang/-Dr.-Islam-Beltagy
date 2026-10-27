import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { db } from '../data/db';
import { Button, EmptyState, Input, Skeleton, StatusBadge } from '../components/ui';
import { useCan } from '../components/common';
import { StatCard } from '../components/StatCard';
import { Icon } from '../utils/icons';
import { useToast } from '../hooks/useToast';
import { useAuth } from '../services/auth';
import { ROLE_LABEL } from '../services/permissions';
import { fmtDate, todayYmd, addDaysYmd } from '../utils/format';
import type { AttendanceRow, AttendanceStatus } from '../types';

const STATUS: Record<AttendanceStatus, { label: string; tone: string }> = {
  compliant: { label: 'ملتزم', tone: 'ok' },
  non_compliant: { label: 'غير ملتزم', tone: 'danger' },
  absent: { label: 'غائب', tone: 'danger' },
  no_schedule: { label: 'بدون جدول', tone: 'info' },
};

function fmtClock(iso: string | null) {
  if (!iso) return '—';
  return new Date(iso).toLocaleTimeString('ar-SA-u-ca-gregory-nu-latn', { timeZone: 'Africa/Cairo', hour: 'numeric', minute: '2-digit' });
}

function MyClock() {
  const toast = useToast();
  const [row, setRow] = useState<{ id: string; date: string; checkIn: string | null; checkOut: string | null } | null>(null);
  const [busy, setBusy] = useState(false);
  const [loaded, setLoaded] = useState(false);

  useEffect(() => { db.myAttendanceToday().then((r) => { setRow(r); setLoaded(true); }); }, []);

  const doClockIn = async () => {
    setBusy(true);
    const r = await db.clockIn();
    setBusy(false);
    if (!r.ok) { toast.error(r.error); return; }
    setRow({ id: r.id, date: r.date, checkIn: r.checkIn, checkOut: r.checkOut });
    toast.success('تم تسجيل حضورك.');
  };
  const doClockOut = async () => {
    setBusy(true);
    const r = await db.clockOut();
    setBusy(false);
    if (!r.ok) { toast.error(r.error); return; }
    setRow({ id: r.id, date: r.date, checkIn: r.checkIn, checkOut: r.checkOut });
    toast.success('تم تسجيل انصرافك.');
  };

  return (
    <div className="card">
      <div className="card__body row-between" style={{ flexWrap: 'wrap', gap: 16 }}>
        <div>
          <div style={{ fontWeight: 700, marginBottom: 4 }}>تسجيل حضورك اليوم</div>
          {!loaded ? <Skeleton h={20} /> : (
            <div className="muted" style={{ fontSize: 13.5 }}>
              الحضور: <strong className="num">{fmtClock(row?.checkIn ?? null)}</strong> · الانصراف: <strong className="num">{fmtClock(row?.checkOut ?? null)}</strong>
            </div>
          )}
        </div>
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8 }}>
          <Button icon="checkCircle" onClick={doClockIn} loading={busy} disabled={!!row?.checkIn}>تسجيل حضور</Button>
          <Button variant="outline" icon="close" onClick={doClockOut} loading={busy} disabled={!row?.checkIn || !!row?.checkOut}>تسجيل انصراف</Button>
        </div>
      </div>
    </div>
  );
}

export default function Attendance() {
  const can = useCan();
  const { user } = useAuth();
  const canView = can('attendance', 'edit');
  const [from, setFrom] = useState(addDaysYmd(todayYmd(), -6));
  const [to, setTo] = useState(todayYmd());
  const [rows, setRows] = useState<AttendanceRow[] | null>(null);
  const [error, setError] = useState('');
  const [tab, setTab] = useState<'non_compliant' | 'compliant'>('non_compliant');

  useEffect(() => {
    if (!canView) return;
    let alive = true;
    db.attendanceReport(from, to).then((r) => {
      if (!alive) return;
      if (!r.ok) { setError(r.error); setRows([]); return; }
      setRows(r.rows);
    });
    return () => { alive = false; };
  }, [canView, from, to]);

  // «بدون جدول» = سجّل حضور في يوم مش ضمن جدوله — بيظهر مع الملتزمين عشان الحضور مايضيعش
  const compliant = (rows ?? []).filter((r) => r.status === 'compliant' || r.status === 'no_schedule');
  // صفوف «غائب» محسوبة تلقائيًا (ما فيه سجل حضور أصلًا) فمخفية من القائمة بطلب الإدارة — الظاهر فقط من سجّل حضوره متأخرًا
  const nonCompliant = (rows ?? []).filter((r) => r.status === 'non_compliant');
  const list = tab === 'compliant' ? compliant : nonCompliant;

  // التقرير أصلًا بيتجاهل أي يوم لموظف بدون مواعيد عمل محددة له (اليوم ده مش «مُطالَب» بالحضور) — لو محدّش
  // من الموظفين النشطين له جدول عمل أصلًا، التقرير هيفضل فاضي دايمًا حتى لو الكل بيسجّل حضور فعليًا، وده
  // بيبان للمستخدم كإن القسم «مش شغال». هنا بنكتشف الحالة دي ونوضّحها بدل ما نسيبه يشوف قايمة فاضية بس.
  const activeStaff = [...db.employees().filter((e) => e.active), ...db.allTherapists().filter((t) => t.active)];
  const noSchedulesConfigured = activeStaff.length > 0 && activeStaff.every((s) => !s.workHours || s.workHours.length === 0);

  return (
    <div className="page">
      <div className="page-head">
        <div><h1>الحضور والانصراف</h1><p>تسجيل حضورك اليوم{canView ? '، ومتابعة التزام الموظفين بمواعيد العمل.' : '.'}</p></div>
      </div>

      {user && <MyClock />}

      {canView && noSchedulesConfigured && (
        <div className="alert alert-warn" style={{ marginBottom: 18 }}>
          <Icon name="alert" size={17} />
          <div>
            ما فيه لأي موظف مواعيد عمل محددة بعد، لذا سيبقى التقرير هنا فارغًا دائمًا حتى لو كان الموظفون يسجّلون حضورهم فعليًا — يُحسب الالتزام بمقارنة وقت الحضور بمواعيد العمل. حدّد مواعيد العمل لكل موظف من{' '}
            {can('workhours') ? <Link to="/work-hours">صفحة مواعيد العمل</Link> : 'صفحة مواعيد العمل'} ليبدأ ظهور التقرير.
          </div>
        </div>
      )}

      {canView && (
        <>
          <div className="form-section">
            <div className="form-section-title">الفترة</div>
            <div className="grid-form grid-form--3">
              <Input id="att-from" label="من تاريخ" type="date" value={from} max={to} onChange={(e) => setFrom(e.target.value)} />
              <Input id="att-to" label="إلى تاريخ" type="date" value={to} min={from} max={todayYmd()} onChange={(e) => setTo(e.target.value)} />
            </div>
          </div>

          {rows === null ? <Skeleton h={90} /> : (
            <div className="kpi-grid">
              <StatCard icon="checkCircle" tone="ok" value={compliant.length} label="سجلات ملتزمة" />
              <StatCard icon="alert" tone="danger" value={nonCompliant.length} label="سجلات غير ملتزمة" />
            </div>
          )}

          <div className="svc-tabs">
            <button type="button" className={`svc-tab ${tab === 'non_compliant' ? 'active' : ''}`} onClick={() => setTab('non_compliant')}>
              غير ملتزمين <span className="num">{nonCompliant.length}</span>
            </button>
            <button type="button" className={`svc-tab ${tab === 'compliant' ? 'active' : ''}`} onClick={() => setTab('compliant')}>
              ملتزمون <span className="num">{compliant.length}</span>
            </button>
          </div>

          {error ? (
            <div className="alert alert-danger"><Icon name="alert" size={17} /><div>{error}</div></div>
          ) : rows !== null && list.length === 0 ? (
            <div className="card"><div className="card__body"><EmptyState icon="checkCircle" title={tab === 'compliant' ? 'ما فيه سجلات ملتزمة في هذي الفترة' : 'ما فيه موظفون غير ملتزمين في هذي الفترة'} /></div></div>
          ) : rows !== null && (
            <div className="table-wrap"><table className="table">
              <thead><tr><th>الموظف</th><th>الدور</th><th>التاريخ</th><th>الحضور</th><th>الانصراف</th><th>الحالة</th></tr></thead>
              <tbody>
                {list.map((r) => (
                  <tr key={`${r.employeeId}-${r.date}`}>
                    <td><strong>{r.employeeName}</strong></td>
                    <td>{ROLE_LABEL[r.role]}</td>
                    <td>{fmtDate(r.date)}</td>
                    <td className="num">{fmtClock(r.checkIn)}</td>
                    <td className="num">{fmtClock(r.checkOut)}</td>
                    <td><StatusBadge label={STATUS[r.status].label} tone={STATUS[r.status].tone} /></td>
                  </tr>
                ))}
              </tbody>
            </table></div>
          )}
        </>
      )}
    </div>
  );
}
