// «الرواتب» — رواتب ثابتة بس (من غير تارجت ولا نسب): لكل موظف راتب شهري ويوم صرف، ولكل شهر سجل واحد مستحق ← مدفوع بتاريخ الدفع.
// البيانات والصلاحيات على الخادم (salaryApi / هجرة 922). التقرير بيتطبع بتخطيط طباعة مخصّص (مش لقطة من الشاشة).
import { useCallback, useEffect, useState } from 'react';
import { db } from '../data/db';
import { useAuth } from '../services/auth';
import { useDbVersion } from '../hooks/useDb';
import { useToast } from '../hooks/useToast';
import { Button, EmptyState, ErrorState, Input, Modal, Select, Skeleton, StatusBadge } from '../components/ui';
import { FilterBar, IconAction, RowActions, useCan } from '../components/common';
import { ROLE_LABEL } from '../services/permissions';
import { fmtDate, money, todayYmd } from '../utils/format';
import { openPrintWindow, printHtml } from '../utils/printDoc';
import { SALARY_METHOD, dueDateOf, salaryApi, type SalaryMethod, type SalaryPayment, type SalarySetting } from '../data/salaryApi';
import type { Employee } from '../types';

const thisMonth = () => todayYmd().slice(0, 7);
const monthLabel = (p: string) => new Date(`${p}-01T12:00:00`).toLocaleDateString('ar-EG', { month: 'long', year: 'numeric' });
const esc = (s: unknown) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]!));

export default function Payroll() {
  useDbVersion();
  const toast = useToast();
  const can = useCan();
  const { user } = useAuth();
  const canEdit = can('payroll', 'edit');
  const [period, setPeriod] = useState(thisMonth());
  const [empFilter, setEmpFilter] = useState('');
  const [status, setStatus] = useState('');
  const [data, setData] = useState<{ settings: SalarySetting[]; payments: SalaryPayment[] } | null>(null);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const [setFor, setSetFor] = useState<Employee | null>(null);
  const [payFor, setPayFor] = useState<SalaryPayment | null>(null);
  const [editFor, setEditFor] = useState<SalaryPayment | null>(null);
  const [historyFor, setHistoryFor] = useState<Employee | null>(null);

  const reload = useCallback(async () => {
    const r = await salaryApi.load();
    if (r.ok) { setData(r.data); setError(''); } else setError(r.error);
  }, []);
  useEffect(() => { void reload(); }, [reload]);

  const isSelf = (e: Employee) => e.id === user?.id;
  const employees = db.employees().filter((e) => e.active || data?.payments.some((p) => p.employeeId === e.id && p.period === period));
  const settingOf = (id: string) => data?.settings.find((s) => s.employeeId === id);
  const paymentOf = (id: string) => data?.payments.find((p) => p.employeeId === id && p.period === period);
  const rows = employees
    .filter((e) => !empFilter || e.id === empFilter)
    .map((e) => ({ e, s: settingOf(e.id), p: paymentOf(e.id) }))
    .filter(({ p }) => !status || (status === 'none' ? !p : p?.status === status));
  const monthPays = (data?.payments ?? []).filter((p) => p.period === period);
  const totalDue = monthPays.filter((p) => p.status === 'due').reduce((s, p) => s + p.amount, 0);
  const totalPaid = monthPays.filter((p) => p.status === 'paid').reduce((s, p) => s + p.amount, 0);
  const missing = employees.filter((e) => { const s = settingOf(e.id); return s?.active && s.monthlySalary > 0 && !paymentOf(e.id) && !isSelf(e); });

  const run = async (fn: () => Promise<{ ok: boolean; error?: string }>, ok: string) => {
    setBusy(true);
    const r = await fn();
    setBusy(false);
    if (!r.ok) { toast.error((r as { error: string }).error); return false; }
    toast.success(ok); await reload(); return true;
  };
  const createFor = (e: Employee) => {
    const s = settingOf(e.id)!;
    return run(() => salaryApi.create({ employeeId: e.id, employeeName: e.name, period, amount: s.monthlySalary, dueDate: dueDateOf(period, s.payDay) }), `اتسجّل راتب ${monthLabel(period)} لـ ${e.name} (مستحق).`);
  };
  const createAll = async () => {
    setBusy(true);
    let n = 0; const errs: string[] = [];
    for (const e of missing) {
      const s = settingOf(e.id)!;
      const r = await salaryApi.create({ employeeId: e.id, employeeName: e.name, period, amount: s.monthlySalary, dueDate: dueDateOf(period, s.payDay) });
      if (r.ok) n++; else errs.push(`${e.name}: ${r.error}`);
    }
    setBusy(false);
    if (n) toast.success(`اتسجّل راتب ${monthLabel(period)} لـ ${n} موظف.`);
    if (errs.length) toast.error(errs.join(' — '));
    await reload();
  };
  const unpay = (p: SalaryPayment) => { if (window.confirm(`إلغاء صرف راتب ${p.employeeName} لشهر ${monthLabel(p.period)}؟ هيرجع «مستحق».`)) void run(() => salaryApi.update(p.id, { status: 'due', paidOn: null }), 'رجع الراتب «مستحق».'); };
  const remove = (p: SalaryPayment) => { if (window.confirm(`مسح راتب ${p.employeeName} لشهر ${monthLabel(p.period)} (مستحق — لسه ما اتصرفش)؟`)) void run(() => salaryApi.remove(p.id), 'اتمسح سجل الراتب.'); };

  const print = () => {
    const win = openPrintWindow();
    const body = rows.map(({ e, s, p }) => `<tr><td>${esc(e.name)}</td><td>${esc(ROLE_LABEL[e.role] ?? e.role)}</td><td class="n">${s ? esc(money(s.monthlySalary)) : '—'}</td><td class="n">${p ? esc(money(p.amount)) : '—'}</td><td>${p ? esc(fmtDate(p.dueDate)) : '—'}</td><td>${!p ? 'لم يُسجّل' : p.status === 'paid' ? 'مدفوع' : 'مستحق'}</td><td>${p?.paidOn ? esc(fmtDate(p.paidOn)) : '—'}</td><td>${p?.status === 'paid' ? esc(SALARY_METHOD[p.method]) : '—'}</td></tr>`).join('');
    const filt = [empFilter && `الموظف: ${db.employees().find((e) => e.id === empFilter)?.name ?? ''}`, status && `الحالة: ${({ due: 'مستحق', paid: 'مدفوع', none: 'لم يُسجّل' } as Record<string, string>)[status]}`].filter(Boolean).join(' — ');
    void printHtml(`<!doctype html><html lang="ar" dir="rtl"><head><meta charset="utf-8"><title>تقرير الرواتب — ${esc(monthLabel(period))}</title>
<link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=IBM+Plex+Sans+Arabic:wght@400;600;700&display=swap">
<style>@page{size:A4;margin:12mm}*{box-sizing:border-box}body{font-family:"IBM Plex Sans Arabic",Tahoma,sans-serif;color:#10182f;margin:0;font-size:12px}
h1{font-size:18px;margin:0 0 4px;color:#1b2a54}.meta{color:#475569;margin-bottom:10px}table{width:100%;border-collapse:collapse}th,td{border:1px solid #cbd5e1;padding:5px 6px;text-align:start}
th{background:#eef1f9;color:#1b2a54}thead{display:table-header-group}tr{break-inside:avoid}.n{direction:ltr;text-align:left;white-space:nowrap}.tot{margin-top:10px;display:flex;gap:24px;font-weight:700}</style></head><body>
<h1>تقرير الرواتب — ${esc(monthLabel(period))}</h1>
<div class="meta">اتطبع: ${esc(new Date().toLocaleString('ar-EG'))}${filt ? ` · ${esc(filt)}` : ''}</div>
<table><thead><tr><th>الموظف</th><th>الوظيفة</th><th>الراتب الثابت</th><th>راتب الشهر</th><th>الاستحقاق</th><th>الحالة</th><th>تاريخ الدفع</th><th>طريقة الدفع</th></tr></thead><tbody>${body || '<tr><td colspan="8">مفيش بيانات</td></tr>'}</tbody></table>
<div class="tot"><span>المدفوع: ${esc(money(totalPaid))}</span><span>المستحق (لسه): ${esc(money(totalDue))}</span><span>الإجمالي: ${esc(money(totalPaid + totalDue))}</span></div>
</body></html>`, win);
  };

  return (
    <>
      <div className="page-head">
        <div><h1>الرواتب</h1><p>راتب شهري ثابت لكل موظف — تسجيله كمستحق ثم صرفه بتاريخ الدفع. مفيش تارجت ولا نسب.</p></div>
        <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
          <Button variant="outline" icon="print" onClick={print} disabled={!data}>طباعة التقرير</Button>
          {canEdit && missing.length > 0 && <Button icon="plus" loading={busy} onClick={() => void createAll()}>تسجيل رواتب {monthLabel(period)} ({missing.length})</Button>}
        </div>
      </div>

      <div className="card" style={{ marginBottom: 14 }}>
        <FilterBar>
          <Input id="pr-month" label="شهر الاستحقاق" type="month" value={period} onChange={(e) => e.target.value && setPeriod(e.target.value)} />
          <Select id="pr-emp" label="الموظف" value={empFilter} onChange={(e) => setEmpFilter(e.target.value)} options={[{ value: '', label: 'كل الموظفين' }, ...employees.map((e) => ({ value: e.id, label: e.name }))]} />
          <Select id="pr-status" label="الحالة" value={status} onChange={(e) => setStatus(e.target.value)} options={[{ value: '', label: 'الكل' }, { value: 'due', label: 'مستحق' }, { value: 'paid', label: 'مدفوع' }, { value: 'none', label: 'لم يُسجّل' }]} />
        </FilterBar>
      </div>

      {data && (
        <div className="stat-row" style={{ display: 'flex', gap: 12, flexWrap: 'wrap', marginBottom: 14 }}>
          <div className="card" style={{ padding: '12px 16px' }}><div className="muted-sm">المدفوع في {monthLabel(period)}</div><strong className="num">{money(totalPaid)}</strong></div>
          <div className="card" style={{ padding: '12px 16px' }}><div className="muted-sm">مستحق لسه</div><strong className="num">{money(totalDue)}</strong></div>
          <div className="card" style={{ padding: '12px 16px' }}><div className="muted-sm">لسه ما اتسجّلش للشهر</div><strong className="num">{missing.length}</strong></div>
        </div>
      )}

      <div className="card">
        {error ? <div className="card__body"><p className="alert alert-danger">{error}</p><ErrorState onRetry={() => void reload()} /></div>
          : !data ? <div className="card__body"><Skeleton h={160} /></div>
          : rows.length === 0 ? <div className="card__body"><EmptyState icon="wallet" title="مفيش موظفين مطابقين" /></div>
          : (
            <div className="table-wrap">
              <table className="table">
                <thead><tr><th>الموظف</th><th>الراتب الثابت</th><th>راتب الشهر</th><th>الاستحقاق</th><th>الحالة</th><th>تاريخ الدفع</th><th></th></tr></thead>
                <tbody>
                  {rows.map(({ e, s, p }) => {
                    const self = isSelf(e);
                    return (
                      <tr key={e.id}>
                        <td><strong>{e.name}</strong><div className="muted-sm">{ROLE_LABEL[e.role] ?? e.role}</div></td>
                        <td className="num">{s ? <>{money(s.monthlySalary)}<div className="muted-sm">يوم الصرف {s.payDay}{!s.active ? ' · متوقف' : ''}</div></> : <span className="muted">لم يُحدد</span>}</td>
                        <td className="num">{p ? money(p.amount) : '—'}</td>
                        <td className="num">{p ? fmtDate(p.dueDate) : s ? <span className="muted">{fmtDate(dueDateOf(period, s.payDay))}</span> : '—'}</td>
                        <td>{!p ? <StatusBadge label="لم يُسجّل" tone="muted" /> : p.status === 'paid' ? <StatusBadge label="مدفوع" tone="ok" /> : <StatusBadge label="مستحق" tone="warn" />}</td>
                        <td className="num">{p?.paidOn ? <>{fmtDate(p.paidOn)}<div className="muted-sm">{SALARY_METHOD[p.method]}</div></> : '—'}</td>
                        <td className="actions">
                          <RowActions>
                            {canEdit && !self && !p && s && s.monthlySalary > 0 && <Button size="sm" variant="outline" icon="plus" disabled={busy} onClick={() => void createFor(e)}>تسجيل راتب الشهر</Button>}
                            {canEdit && !self && p?.status === 'due' && <Button size="sm" icon="check" onClick={() => setPayFor(p)}>تسجيل الصرف</Button>}
                            {canEdit && !self && p?.status === 'paid' && <Button size="sm" variant="outline" onClick={() => unpay(p)}>إلغاء الصرف</Button>}
                            {canEdit && !self && p && <IconAction icon="edit" label="تعديل راتب الشهر" onClick={() => setEditFor(p)} />}
                            {canEdit && !self && p?.status === 'due' && <IconAction icon="trash" label="مسح راتب الشهر" danger onClick={() => remove(p)} />}
                            {canEdit && !self && <IconAction icon="wallet" label="الراتب الثابت ويوم الصرف" onClick={() => setSetFor(e)} />}
                            <IconAction icon="list" label="سجل الرواتب" onClick={() => setHistoryFor(e)} />
                            {self && <span className="muted-sm">مالكش تعدّل راتبك</span>}
                          </RowActions>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}
      </div>

      {setFor && <SettingModal e={setFor} s={settingOf(setFor.id)} onClose={() => setSetFor(null)} onSaved={reload} />}
      {payFor && <PayModal p={payFor} onClose={() => setPayFor(null)} onSaved={reload} />}
      {editFor && <EditModal p={editFor} onClose={() => setEditFor(null)} onSaved={reload} />}
      {historyFor && <HistoryModal e={historyFor} payments={(data?.payments ?? []).filter((p) => p.employeeId === historyFor.id)} onClose={() => setHistoryFor(null)} />}
    </>
  );
}

function SettingModal({ e, s, onClose, onSaved }: { e: Employee; s?: SalarySetting; onClose: () => void; onSaved: () => Promise<void> }) {
  const toast = useToast();
  const [salary, setSalary] = useState(String(s?.monthlySalary ?? ''));
  const [day, setDay] = useState(String(s?.payDay ?? 1));
  const [active, setActive] = useState(s?.active ?? true);
  const [busy, setBusy] = useState(false);
  const save = async () => {
    const amount = Number(salary); const d = Number(day);
    if (!(amount >= 0) || salary.trim() === '') { toast.error('اكتب الراتب الشهري.'); return; }
    if (!(d >= 1 && d <= 31)) { toast.error('يوم الصرف من 1 لـ 31.'); return; }
    setBusy(true);
    const r = await salaryApi.saveSetting({ employeeId: e.id, monthlySalary: amount, payDay: d, active, note: s?.note ?? '' });
    setBusy(false);
    if (!r.ok) { toast.error(r.error); return; }
    toast.success('تم حفظ الراتب الثابت.'); await onSaved(); onClose();
  };
  return (
    <Modal title={`الراتب الثابت — ${e.name}`} onClose={onClose} footer={<><Button variant="outline" onClick={onClose} disabled={busy}>إلغاء</Button><Button icon="check" loading={busy} onClick={() => void save()}>حفظ</Button></>}>
      <div className="grid-form">
        <Input id="ss-salary" label="الراتب الشهري (ج.م)" inputMode="decimal" value={salary} onChange={(ev) => setSalary(ev.target.value.replace(/[^\d.]/g, ''))} />
        <Input id="ss-day" label="يوم الصرف في الشهر" inputMode="numeric" value={day} onChange={(ev) => setDay(ev.target.value.replace(/\D/g, ''))} />
        <Select id="ss-active" label="الحالة" value={active ? 'on' : 'off'} onChange={(ev) => setActive(ev.target.value === 'on')} options={[{ value: 'on', label: 'بيتصرف له راتب' }, { value: 'off', label: 'متوقف' }]} />
      </div>
      <p className="muted-sm" style={{ marginBottom: 0 }}>تعديل الراتب الثابت ما بيغيّرش رواتب الشهور اللي اتسجّلت قبل كده.</p>
    </Modal>
  );
}

function PayModal({ p, onClose, onSaved }: { p: SalaryPayment; onClose: () => void; onSaved: () => Promise<void> }) {
  const toast = useToast();
  const [paidOn, setPaidOn] = useState(todayYmd());
  const [method, setMethod] = useState<SalaryMethod>('cash');
  const [note, setNote] = useState(p.note);
  const [busy, setBusy] = useState(false);
  const save = async () => {
    if (!paidOn) { toast.error('تاريخ الدفع مطلوب.'); return; }
    setBusy(true);
    const r = await salaryApi.update(p.id, { status: 'paid', paidOn, method, note });
    setBusy(false);
    if (!r.ok) { toast.error(r.error); return; }
    toast.success(`اتسجّل صرف راتب ${p.employeeName}.`); await onSaved(); onClose();
  };
  return (
    <Modal title={`صرف راتب ${p.employeeName} — ${monthLabel(p.period)}`} onClose={onClose} footer={<><Button variant="outline" onClick={onClose} disabled={busy}>إلغاء</Button><Button icon="check" loading={busy} onClick={() => void save()}>تسجيل الصرف</Button></>}>
      <p style={{ marginTop: 0 }}>المبلغ: <strong className="num">{money(p.amount)}</strong></p>
      <div className="grid-form">
        <Input id="py-date" label="تاريخ الدفع الفعلي" type="date" value={paidOn} onChange={(ev) => setPaidOn(ev.target.value)} />
        <Select id="py-method" label="طريقة الدفع" value={method} onChange={(ev) => setMethod(ev.target.value as SalaryMethod)} options={(Object.keys(SALARY_METHOD) as SalaryMethod[]).map((k) => ({ value: k, label: SALARY_METHOD[k] }))} />
        <Input id="py-note" label="ملاحظة" value={note} onChange={(ev) => setNote(ev.target.value)} />
      </div>
    </Modal>
  );
}

function EditModal({ p, onClose, onSaved }: { p: SalaryPayment; onClose: () => void; onSaved: () => Promise<void> }) {
  const toast = useToast();
  const [amount, setAmount] = useState(String(p.amount));
  const [dueDate, setDueDate] = useState(p.dueDate);
  const [note, setNote] = useState(p.note);
  const [busy, setBusy] = useState(false);
  const save = async () => {
    const a = Number(amount);
    if (!(a >= 0) || amount.trim() === '') { toast.error('اكتب المبلغ.'); return; }
    setBusy(true);
    const r = await salaryApi.update(p.id, { amount: a, dueDate, note });
    setBusy(false);
    if (!r.ok) { toast.error(r.error); return; }
    toast.success('تم تعديل راتب الشهر.'); await onSaved(); onClose();
  };
  return (
    <Modal title={`تعديل راتب ${p.employeeName} — ${monthLabel(p.period)}`} onClose={onClose} footer={<><Button variant="outline" onClick={onClose} disabled={busy}>إلغاء</Button><Button icon="check" loading={busy} onClick={() => void save()}>حفظ</Button></>}>
      <div className="grid-form">
        <Input id="pe-amount" label="المبلغ (ج.م)" inputMode="decimal" value={amount} onChange={(ev) => setAmount(ev.target.value.replace(/[^\d.]/g, ''))} />
        <Input id="pe-due" label="تاريخ الاستحقاق" type="date" value={dueDate} onChange={(ev) => setDueDate(ev.target.value)} />
        <Input id="pe-note" label="ملاحظة" value={note} onChange={(ev) => setNote(ev.target.value)} />
      </div>
    </Modal>
  );
}

function HistoryModal({ e, payments, onClose }: { e: Employee; payments: SalaryPayment[]; onClose: () => void }) {
  return (
    <Modal wide title={`سجل رواتب ${e.name}`} onClose={onClose} footer={<Button variant="outline" onClick={onClose}>إغلاق</Button>}>
      {payments.length === 0 ? <EmptyState icon="wallet" title="لسه مفيش رواتب متسجّلة للموظف ده" /> : (
        <div className="table-wrap">
          <table className="table">
            <thead><tr><th>الشهر</th><th>المبلغ</th><th>الاستحقاق</th><th>الحالة</th><th>تاريخ الدفع</th><th>ملاحظة</th></tr></thead>
            <tbody>
              {payments.map((p) => (
                <tr key={p.id}>
                  <td>{monthLabel(p.period)}</td><td className="num">{money(p.amount)}</td><td className="num">{fmtDate(p.dueDate)}</td>
                  <td>{p.status === 'paid' ? <StatusBadge label="مدفوع" tone="ok" /> : <StatusBadge label="مستحق" tone="warn" />}</td>
                  <td className="num">{p.paidOn ? `${fmtDate(p.paidOn)} · ${SALARY_METHOD[p.method]}` : '—'}</td><td>{p.note || '—'}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </Modal>
  );
}
