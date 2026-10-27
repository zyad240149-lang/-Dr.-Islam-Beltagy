// عناصر مشتركة لقسم «الرواتب والتارجت» (المدير العام): الشريط العلوي للشهر وحالته، التسميات، ونوافذ
// الإعدادات/الصرف/التعديل/التفاصيل. كل نافذة بتنادي الخادم وبتعرض رسالته — مفيش أي حساب مالي هنا.
import { useEffect, useMemo, useState, type ReactNode } from 'react';
import { NavLink } from 'react-router-dom';
import { Button, EmptyState, Input, Modal, Select, Skeleton, StatusBadge } from './ui';
import { IconAction, useCan } from './common';
import { useToast } from '../hooks/useToast';
import { money, fmtDate, fmtDateTime, todayYmd, toLatinDigits } from '../utils/format';
import { Icon } from '../utils/icons';
import { LANG } from '../i18n';
import {
  payrollApi, currentPeriod, effectivePeriods, previewBonus, recentPeriods,
  type BonusCondition, type BonusMethod, type PaySystem, type Overview, type PayoutKind, type PayoutMethod, type PayrollRow, type PayStatus,
  type PeriodStatus, type RevenueRef, type SubjectDetail, type SubjectType,
} from '../data/payrollApi';

// ---------- تسميات ----------
export const periodLabel = (p: string) => {
  const [y, m] = p.split('-').map(Number);
  return new Date(Date.UTC(y, m - 1, 15)).toLocaleDateString(LANG === 'en' ? 'en-GB' : 'ar-SA-u-ca-gregory-nu-latn', { month: 'long', year: 'numeric', timeZone: 'UTC' });
};
export const periodOptions = () => recentPeriods().map((p) => ({ value: p, label: periodLabel(p) }));
export const ROLE_NAME: Record<string, string> = { therapist: 'أخصائي علاج طبيعي', reception: 'استقبال', secretary: 'سكرتارية', accountant: 'محاسب' };
export const BONUS_METHOD_LABEL: Record<BonusMethod, string> = { none: 'بدون مكافأة', pct_target: 'نسبة من قيمة التارجت', pct_revenue: 'نسبة من الإيراد المؤهل', fixed: 'مكافأة ثابتة' };
export const SYSTEM_LABEL: Record<PaySystem, string> = { base_commission: 'راتب أساسي + عمولة', commission_only: 'عمولة فقط', base_only: 'راتب أساسي فقط' };
const SYSTEM_HINT: Record<PaySystem, string> = {
  base_commission: 'راتب ثابت + عمولة على الإيراد المؤهل. الإجمالي = الراتب الأساسي + العمولة المستحقة.',
  commission_only: 'بدون راتب أساسي: نسبة من قيمة زياراته المنفذة فقط، وإذا لم ينفذ زيارات تكون عمولته صفرًا.',
  base_only: 'راتب شهري ثابت دون عمولات.',
};
export const CONDITION_LABEL: Record<BonusCondition, string> = { reach: 'عند الوصول للتارجت', exceed: 'عند تجاوز التارجت', always: 'نسبة من الإيراد فقط' };
// شريط اعتماد الشهر اتشال بطلب المدير (2026-10-12) — المستحق بيتثبّت تلقائيًا عند الصرف
const SHOW_PERIOD_BAR = false as boolean;
export const PERIOD_STATUS: Record<PeriodStatus, { label: string; tone: string; hint: string }> = {
  open: { label: 'مفتوح — أرقام مباشرة', tone: 'info', hint: 'تتحدّث الأرقام تلقائيًا من الزيارات والفواتير. ما يمكن الصرف قبل اعتماد الشهر.' },
  approved: { label: 'معتمد', tone: 'ok', hint: 'جُمّدت المستحقات — أي زيارة أو تعديل بعد الاعتماد ما يغيّرها إلا «إعادة الاحتساب» بسبب.' },
  closed: { label: 'مُقفل', tone: 'muted', hint: 'الشهر مُقفل — أي تعديل في المستحقات لازم يكون بسبب، ويُسجَّل في سجل التعديلات.' },
};
export const PAY_STATUS: Record<PayStatus, { label: string; tone: string }> = {
  not_approved: { label: 'لم يُصرف', tone: 'warn' }, nothing: { label: 'ما فيه مستحق', tone: 'muted' },
  unpaid: { label: 'لم يُصرف', tone: 'warn' }, partial: { label: 'صُرف جزئيًا', tone: 'info' }, paid: { label: 'صُرف بالكامل', tone: 'ok' },
};
export const PAYOUT_METHOD: Record<PayoutMethod, string> = { transfer: 'تحويل بنكي', cash: 'نقدًا' };
export const PAYOUT_KIND: Record<PayoutKind, string> = { salary: 'راتب', bonus: 'مكافأة' };
export const SOURCE_LABEL: Record<string, string> = { visit: 'فاتورة الزيارة', plan: 'فاتورة الخطة كاملة (أول زيارة)', package: 'فاتورة الباقة كاملة (أول زيارة)', none: 'لا تضيف شي (الباقة انحسبت في أول زيارة، أو بدون فاتورة)' };
export const PAYMENT_STATE: Record<string, { label: string; tone: string }> = {
  paid: { label: 'مدفوعة', tone: 'ok' }, partial: { label: 'مدفوعة جزئيًا', tone: 'info' }, due: { label: 'غير مدفوعة', tone: 'warn' }, none: { label: 'بدون فاتورة', tone: 'muted' },
};
export const pct = (n: number | null) => (n == null ? '—' : `${Number(n.toFixed(2))}%`);
// أجزاء منفصلة (مش جملة واحدة) عشان كل جزء يتترجم لوحده في وضع English
export const bonusSummary = (m: BonusMethod, rate: number, fixed: number, cond: BonusCondition): ReactNode =>
  m === 'none' ? BONUS_METHOD_LABEL.none : <><span className="num">{m === 'fixed' ? money(fixed) : pct(rate)}</span> — <span>{BONUS_METHOD_LABEL[m]}</span> · <span>{CONDITION_LABEL[cond]}</span></>;
// حالة التارجت لصف أخصائي (المعتمد لو موجود، وإلا المباشر)
export const targetState = (r: PayrollRow) => {
  const target = r.due ? r.due.target : r.live.target;
  if (!target) return 'none' as const;
  return (r.due ? r.due.reached : r.live.reached) ? 'reached' as const : 'not_reached' as const;
};
export const TARGET_STATE: Record<'none' | 'reached' | 'not_reached', { label: string; tone: string }> = {
  none: { label: 'التارجت ما تم تحديده', tone: 'muted' }, reached: { label: 'حقق التارجت', tone: 'ok' }, not_reached: { label: 'لم يحقق بعد', tone: 'warn' },
};

// ---------- الشريط العلوي: الأقسام التلاتة + الشهر وحالته + الاعتماد والإغلاق ----------
export function PayrollHeader({ title, subtitle, period, onPeriod, overview, onChanged, children }: {
  title: string; subtitle: string; period?: string; onPeriod?: (p: string) => void; overview?: Overview | null; onChanged?: () => void; children?: ReactNode;
}) {
  const can = useCan();
  const [confirm, setConfirm] = useState<'approve' | 'close' | 'reopen' | null>(null);
  const st = overview ? PERIOD_STATUS[overview.status] : null;
  const notEnded = !!overview && overview.today <= overview.to;
  return (
    <>
      <div className="page-head">
        <div><h1>{title}</h1><p>{subtitle}</p></div>
        {period && onPeriod && <div style={{ minWidth: 200 }}><Select id="pr-period" label="الشهر" value={period} onChange={(e) => onPeriod(e.target.value)} options={periodOptions()} /></div>}
      </div>
      <div className="tabs" style={{ marginBottom: 14, overflowX: 'auto' }}>
        <NavLink end to="/payroll" className={({ isActive }) => `tab ${isActive ? 'active' : ''}`}>رواتب الأخصائيين والتارجت</NavLink>
        <NavLink to="/payroll/staff" className={({ isActive }) => `tab ${isActive ? 'active' : ''}`}>رواتب الموظفين الإداريين</NavLink>
        <NavLink to="/payroll/reports" className={({ isActive }) => `tab ${isActive ? 'active' : ''}`}>التقارير وسجل الرواتب</NavLink>
      </div>
      {overview && st && SHOW_PERIOD_BAR && (
        <div className="card" style={{ marginBottom: 16 }}>
          <div className="card__body" style={{ display: 'flex', flexWrap: 'wrap', gap: 12, alignItems: 'center', justifyContent: 'space-between' }}>
            <div style={{ display: 'flex', gap: 10, alignItems: 'center', flexWrap: 'wrap' }}>
              <strong>{periodLabel(overview.period)}</strong><StatusBadge label={st.label} tone={st.tone} />
              <span className="muted-sm" style={{ maxWidth: 560 }}>{st.hint}</span>
            </div>
            <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
              {overview.status !== 'closed' && can('payroll', 'create') && <Button icon="check" onClick={() => setConfirm('approve')}>{overview.status === 'approved' ? 'إضافة المستحقات الناقصة' : 'اعتماد الشهر'}</Button>}
              {overview.status === 'approved' && can('payroll', 'edit') && <Button variant="outline" icon="lock" onClick={() => setConfirm('close')}>إغلاق الشهر</Button>}
              {overview.status !== 'open' && can('payroll', 'edit') && <Button variant="outline" icon="refresh" onClick={() => setConfirm('reopen')}>إلغاء اعتماد الشهر</Button>}
            </div>
          </div>
        </div>
      )}
      {children}
      {confirm === 'reopen' && overview && (
        <ReasonModal title={`إلغاء اعتماد ${periodLabel(overview.period)}`} confirmLabel="إلغاء الاعتماد"
          message="سيعود الشهر «مفتوحًا» بأرقام مباشرة، وستُحذف المستحقات المجمّدة وتُحسب من جديد عند اعتماده. مسموح فقط إذا لم يُسجَّل أي صرف على الشهر."
          onClose={() => setConfirm(null)} successText="تم إلغاء اعتماد الشهر."
          onSubmit={async (reason) => { const r = await payrollApi.reopen(overview.period, reason); if (!r.ok) return r.error; setConfirm(null); onChanged?.(); return null; }} />
      )}
      {confirm && confirm !== 'reopen' && overview && (
        <ReasonModal
          title={confirm === 'approve' ? (overview.status === 'approved' ? 'إضافة المستحقات الناقصة' : `اعتماد ${periodLabel(overview.period)}`) : `إغلاق ${periodLabel(overview.period)}`}
          message={confirm === 'approve'
            ? (notEnded
              ? '⚠️ الشهر لم ينتهِ بعد — الزيارات التي ستُسجَّل بعد الاعتماد لن تدخل إلا بـ«إعادة الاحتساب». الاعتماد يُجمّد الراتب والتارجت والإيراد المؤهل والمكافأة لكل شخص له إعدادات، وبعدها تقدر تسجّل الصرف. والاعتماد ما يعني أن المبالغ صُرفت.'
              : 'الاعتماد يُجمّد الراتب والتارجت والإيراد المؤهل والمكافأة لكل شخص له إعدادات، وبعدها تقدر تسجّل الصرف. والاعتماد ما يعني أن المبالغ صُرفت.')
            : 'الإغلاق يُقفل الشهر: لا إعادة احتساب، وأي تعديل في المستحقات بعد ذلك لازم يكون بسبب ويُسجَّل. ولا يزال صرف المتبقي ممكنًا.'}
          label="ملاحظة (اختياري)" required={false} confirmLabel={confirm === 'approve' ? 'تأكيد الاعتماد' : 'تأكيد الإغلاق'} danger={false}
          onClose={() => setConfirm(null)}
          onSubmit={async (note) => {
            const r = confirm === 'approve' ? await payrollApi.approve(overview.period, note) : await payrollApi.close(overview.period, note);
            if (!r.ok) return r.error;
            setConfirm(null); onChanged?.(); return null;
          }}
          successText={confirm === 'approve' ? 'تم اعتماد الشهر.' : 'تم إغلاق الشهر.'} />
      )}
    </>
  );
}

// نافذة بسبب/ملاحظة عامة — onSubmit بيرجّع رسالة الخطأ أو null
export function ReasonModal({ title, message, label = 'السبب *', required = true, confirmLabel, danger = true, onClose, onSubmit, successText }: {
  title: string; message: string; label?: string; required?: boolean; confirmLabel: string; danger?: boolean;
  onClose: () => void; onSubmit: (reason: string) => Promise<string | null>; successText: string;
}) {
  const toast = useToast();
  const [reason, setReason] = useState('');
  const [busy, setBusy] = useState(false);
  const submit = async () => {
    if (required && !reason.trim()) { toast.error('اكتب السبب.'); return; }
    setBusy(true);
    const err = await onSubmit(reason.trim());
    setBusy(false);
    if (err) { toast.error(err); return; }
    toast.success(successText);
  };
  return (
    <Modal title={title} onClose={onClose}
      footer={<><Button variant="outline" onClick={onClose} disabled={busy}>رجوع</Button><Button variant={danger ? 'danger' : 'primary'} onClick={submit} loading={busy}>{confirmLabel}</Button></>}>
      <p style={{ marginTop: 0 }}>{message}</p>
      <Input id="pr-reason" label={label} value={reason} onChange={(e) => setReason(e.target.value)} />
    </Modal>
  );
}

// النسب الجاهزة في قائمة «النسبة» — وأي نسبة تانية بالظبط من «نسبة أخرى»
const RATE_PRESETS = [...Array.from({ length: 20 }, (_, i) => (i + 1) / 2), 11, 12, 13, 14, 15, 16, 17, 18, 19, 20, 25, 30];

// اختيار نسبة: قائمة نسب جاهزة، و«نسبة أخرى» بتفتح خانة لأي رقم بالظبط. hint = المبلغ الناتج
export function RateSelect({ id, label, value, onChange, hint }: { id: string; label: string; value: string; onChange: (v: string) => void; hint?: ReactNode }) {
  const [custom, setCustom] = useState(!!value && !RATE_PRESETS.includes(Number(value)));
  return (
    <>
      <div>
        <Select id={id} label={label} value={custom ? 'custom' : value}
          onChange={(e) => { const v = e.target.value; if (v === 'custom') setCustom(true); else { setCustom(false); onChange(v); } }}
          options={[{ value: '', label: 'اختر النسبة' }, ...RATE_PRESETS.map((p) => ({ value: String(p), label: `${p}%` })), { value: 'custom', label: 'نسبة أخرى (اكتبها)' }]} />
        {hint && <div className="muted-sm" style={{ marginTop: -6 }}>{hint}</div>}
      </div>
      {custom && <Input id={id + '-custom'} label="اكتب النسبة (%)" type="number" min={0} max={100} step="0.01" inputMode="decimal" value={value}
        onChange={(e) => onChange(e.target.value)} hint="أي نسبة من 0 لـ 100، مثال: 1.25" autoFocus />}
    </>
  );
}

// ---------- تحديد الراتب والتارجت والمكافأة (كل حفظ = نسخة جديدة بتاريخ سريان) ----------
const initials = (n: string) => n.trim().split(/\s+/).slice(0, 2).map((w) => w[0] ?? '').join('');
// خانة مبلغ: بتقبل أرقام عربي وفواصل الآلاف («10,000»)
const amount = (s: string) => Number(toLatinDigits(s).replace(/[,\s٬]/g, ''));
const bonusOf = (target: number, rate: number) => (target > 0 && rate > 0 ? Math.round(target * rate) / 100 : 0);
const RECALC_REASON = 'تحديث الراتب والعمولة';

// رأس النافذة: الشخص + إعداداته الحالية
// كام وصل في التارجت: المحقق من المطلوب + النسبة + المتبقي
function TargetProgress({ row }: { row: PayrollRow }) {
  const src = row.due ?? row.live;
  const target = src.target, qual = src.qualifying;
  const p = target > 0 ? Math.round((qual / target) * 1000) / 10 : null;
  return (
    <div className="pr-prog" style={{ marginBottom: 12 }}>
      <div className="pr-prog__top">
        <span><span>الإيراد المحقق</span> <b className="num">{money(qual)}</b></span>
      </div>
            <div className="muted-sm"><span className="num">{row.due ? row.due.visits : row.live.visits}</span> <span>زيارة منفذة</span></div>
    </div>
  );
}

function SubjectHead({ row }: { row: PayrollRow }) {
  const c = row.live;
  return (
    <div className="pr-subject">
      <span className="avatar" data-no-i18n>{initials(row.name)}</span>
      <div className="pr-subject__who"><strong data-no-i18n>{row.name}</strong><span className="muted-sm">{ROLE_NAME[row.role] ?? row.role}</span></div>
      <div className="pr-subject__cur">
        {!c.hasPlan ? <StatusBadge label="لم تُحدد بعد" tone="warn" /> : <>
          <span className="muted-sm">الحالي</span>
          <span className="pr-chip"><span>الراتب</span> <b className="num">{money(c.baseSalary)}</b></span>
          {row.type === 'therapist' && <>
                        <span className="pr-chip"><span>المحقق</span> <b className="num">{money(c.qualifying)}</b></span>
            <span className="pr-chip"><span>العمولة</span> <b className="num">{c.bonusMethod === 'none' ? '—' : c.bonusMethod === 'fixed' ? money(c.bonusFixed) : pct(c.bonusRate)}</b></span>
          </>}
          {c.effectiveFrom && <span className="muted-sm"><span>من</span> {periodLabel(c.effectiveFrom)}</span>}
        </>}
      </div>
    </div>
  );
}

function PlanSection({ n, title, text, children }: { n: number; title: string; text?: string; children: ReactNode }) {
  return (
    <section className="pr-sec">
      <div className="pr-sec__head"><span className="pr-sec__n num">{n}</span><div><h3>{title}</h3>{text && <p>{text}</p>}</div></div>
      {children}
    </section>
  );
}

// مرجع التارجت: الإيراد المؤهل في آخر 3 شهور ومتوسط قيمة الزيارة
function RevenueRefBox({ data, target, onUse }: { data: RevenueRef | null | undefined; target: number; onUse: (v: number) => void }) {
  if (data === undefined) return <Skeleton h={86} r={12} />;
  if (!data || data.avg == null) return <div className="pr-ref pr-ref--empty muted-sm">ما فيه زيارات منفذة في آخر 3 أشهر — ما فيه مرجع سابق للتارجت.</div>;
  return (
    <div className="pr-ref">
      <div className="pr-ref__head"><Icon name="trend" size={16} /><span>إيراده المؤهل في آخر 3 شهور</span></div>
      <div className="pr-ref__months">
        {data.months.map((m) => (
          <div key={m.period}><span className="muted-sm">{periodLabel(m.period)}</span><strong className="num">{money(m.qualifying)}</strong><span className="muted-sm"><span className="num">{m.visits}</span> <span>زيارة</span></span></div>
        ))}
      </div>
      <div className="pr-ref__foot">
        <span><span>المتوسط</span> <strong className="num">{money(data.avg)}</strong></span>
        {target > 0 && data.avg > 0 && <span><span>التارجت</span> <strong className="num">{pct(Math.round((target / data.avg) * 1000) / 10)}</strong> <span>من المتوسط</span></span>}
        {target > 0 && data.avgVisit ? <span>≈ <strong className="num">{Math.ceil(target / data.avgVisit)}</strong> <span>زيارة بمتوسط</span> <span className="num">{money(data.avgVisit)}</span> <span>للزيارة</span></span> : null}
        {data.avg > 0 && data.avg !== target && <Button size="sm" variant="ghost" icon="target" onClick={() => onUse(data.avg!)}>استخدم المتوسط كتارجت</Button>}
      </div>
    </div>
  );
}

export function PlanModal({ row, period, onClose, onSaved }: { row: PayrollRow; period: string; onClose: () => void; onSaved: () => void }) {
  const toast = useToast();
  const isTh = row.type === 'therapist';
  const cur = row.live;
  const legacy = cur.hasPlan && cur.bonusMethod === 'fixed';
  const effOpts = effectivePeriods();
  const [f, setF] = useState({
    eff: effOpts.includes(period) ? period : currentPeriod(),
    salary: cur.hasPlan ? String(cur.baseSalary) : '',
    target: '',
    bonusOn: cur.hasPlan ? cur.bonusMethod !== 'none' : true,
    rate: cur.hasPlan && cur.bonusRate > 0 && cur.bonusMethod !== 'fixed' ? String(cur.bonusRate) : '',
    cond: 'always' as BonusCondition,
    system: (isTh ? (cur.hasPlan ? cur.paySystem : 'base_commission') : 'base_only') as PaySystem,
    payDay: cur.payDay != null ? String(cur.payDay) : '',
    note: '',
  });
  const set = (p: Partial<typeof f>) => setF((x) => ({ ...x, ...p }));
  const [applyDue, setApplyDue] = useState(true);
  const [tried, setTried] = useState(false);
  const [busy, setBusy] = useState(false);
  const [ref, setRef] = useState<RevenueRef | null | undefined>(undefined);
  useEffect(() => {
    if (!isTh) return;
    let on = true;
    payrollApi.history(period).then((m) => { if (on) setRef(m.get(row.id) ?? null); });
    return () => { on = false; };
  }, [isTh, period, row.id]);

  const pickSystem = (system: PaySystem) => set(system === 'base_only' ? { system, bonusOn: false } : system === 'commission_only' ? { system, salary: '0', bonusOn: true, cond: 'always' } : { system, bonusOn: true });
  const sal = amount(f.salary), tgt = f.target.trim() ? amount(f.target) : 0, rate = f.rate.trim() ? amount(f.rate) : 0;
  const bonus = isTh && f.bonusOn && f.cond !== 'always' ? bonusOf(tgt, rate) : 0;
  const errs = {
    salary: !f.salary.trim() ? 'اكتب الراتب الأساسي (وإذا ما فيه راتب اكتب 0).' : !Number.isFinite(sal) || sal < 0 ? 'اكتب مبلغ صحيح.' : '',
    target: '',
    rate: isTh && f.bonusOn && f.system !== 'base_only' && !(rate > 0 && rate <= 100) ? 'اختر نسبة العمولة.' : '',
  };
  const method: BonusMethod = isTh && f.bonusOn ? 'pct_revenue' : 'none';
  const changed = !cur.hasPlan || f.eff !== cur.effectiveFrom || sal !== cur.baseSalary || f.system !== cur.paySystem || (f.payDay.trim() ? Number(f.payDay) : null) !== cur.payDay
    || (isTh && (tgt !== cur.target || method !== cur.bonusMethod || (f.bonusOn && (rate !== cur.bonusRate || f.cond !== cur.bonusCondition))));
  // المستحق المثبّت للشهر المعروض مابيتغيّرش لوحده — نعرض تطبيق التعديل عليه
  const dueApplies = !!row.dueId && f.eff <= period;

  const save = async () => {
    setTried(true);
    if (errs.salary || errs.target || errs.rate) { toast.error('راجع الخانات المعلّمة بالأحمر.'); return; }
    if (!changed) { toast.info('ما فيه أي تغيير عن الإعدادات الحالية.'); return; }
    setBusy(true);
    const r = await payrollApi.savePlan(isTh
      ? { type: 'therapist', id: row.id, effectiveFrom: f.eff, baseSalary: sal, target: tgt, bonusMethod: method, bonusRate: f.bonusOn ? rate : 0, bonusFixed: 0, bonusCondition: f.cond, paySystem: f.system, payDay: f.payDay.trim() ? Number(f.payDay) : null, note: f.note.trim() }
      : { type: 'employee', id: row.id, effectiveFrom: f.eff, baseSalary: sal, payDay: f.payDay.trim() ? Number(f.payDay) : null, note: f.note.trim() });
    if (!r.ok) { setBusy(false); toast.error(r.error); return; }
    if (dueApplies && applyDue) {
      const x = await payrollApi.recalc(row.dueId!, f.note.trim() || RECALC_REASON);
      if (!x.ok) { setBusy(false); toast.error(`حُفظت الإعدادات، لكن مستحق ${periodLabel(period)} لم يُحدَّث: ${x.error}`); onSaved(); return; }
    }
    setBusy(false);
    toast.success(isTh ? 'تم حفظ الراتب والعمولة.' : 'تم حفظ الراتب.');
    onSaved();
  };

  const salaryField = (
    <Input id="pp-sal" label="الراتب الأساسي الشهري (ج.م)" type="number" inputMode="decimal" placeholder="مثال: 8000" value={f.salary} autoFocus
      onChange={(e) => set({ salary: e.target.value })} error={tried ? errs.salary || undefined : undefined}
      hint={f.salary.trim() && Number.isFinite(sal) ? `= ${money(sal)}` : undefined} />
  );
  const effSection = (n: number) => (
    <PlanSection n={n} title="السريان" text="يُسجَّل كل حفظ كنسخة جديدة — الشهور التي قبل تاريخ السريان لا تتغيّر.">
      <div className="grid-form">
        <Select id="pp-eff" label="يبدأ من شهر" value={f.eff} onChange={(e) => set({ eff: e.target.value })} options={effOpts.map((p) => ({ value: p, label: periodLabel(p) }))} />
        <Select id="pp-payday" label="يوم صرف الراتب (من الشهر التالي)" value={f.payDay} onChange={(e) => set({ payDay: e.target.value })}
          options={[{ value: '', label: 'غير محدد' }, ...Array.from({ length: 31 }, (_, i) => ({ value: String(i + 1), label: `يوم ${i + 1}` }))]} />
        <Input id="pp-note" label="ملاحظة (اختياري)" placeholder="مثال: زيادة سنوية" value={f.note} onChange={(e) => set({ note: e.target.value })} />
      </div>
      {dueApplies && (
        <label className="pr-check">
          <input type="checkbox" checked={applyDue} onChange={(e) => setApplyDue(e.target.checked)} />
          <span><span>طبّق التعديل أيضًا على مستحق</span> <b>{periodLabel(period)}</b> <span>المثبّت</span>
            {row.paidSalary + row.paidBonus > 0 && <span className="muted-sm"> (<span>صُرف منه</span> <span className="num">{money(row.paidSalary + row.paidBonus)}</span>)</span>}</span>
        </label>
      )}
    </PlanSection>
  );

  return (
    <Modal xl={isTh} title={isTh ? 'تحديد الراتب والعمولة' : 'تحديد الراتب الشهري'} onClose={onClose}
      footer={<><Button variant="outline" onClick={onClose} disabled={busy}>إلغاء</Button><Button icon="check" onClick={save} loading={busy}>حفظ الإعدادات</Button></>}>
      <SubjectHead row={row} />
      {!isTh ? (
        <>
          <PlanSection n={1} title="الراتب الشهري الثابت" text="الاستقبال والسكرتارية والمحاسب: راتب ثابت فقط، دون عمولات.">{salaryField}</PlanSection>
          {effSection(2)}
        </>
      ) : (
        <div className="pr-plan">
          <div className="pr-plan__form">
            <PlanSection n={1} title="نظام الراتب" text="اختر طريقة احتساب راتب هذا الأخصائي.">
              <div className="seg" role="group" aria-label="نظام الراتب">
                {(Object.keys(SYSTEM_LABEL) as PaySystem[]).map((k) => (
                  <button key={k} type="button" className={`seg__btn ${f.system === k ? 'active' : ''}`} onClick={() => pickSystem(k)}>{SYSTEM_LABEL[k]}</button>
                ))}
              </div>
              <div className="field__hint">{SYSTEM_HINT[f.system]}</div>
            </PlanSection>
            {f.system !== 'commission_only' && <PlanSection n={2} title="الراتب الأساسي" text="مبلغ ثابت كل شهر.">{salaryField}</PlanSection>}
            {f.system !== 'base_only' && <PlanSection n={3} title="العمولة" text="نسبة من الإيراد المحقق (زيارات نفذها بنفسه) كل شهر.">
              {f.bonusOn && (
                <div className="pr-bonus">
                  <div className="grid-form">
                    <RateSelect id="pp-rate" label="نسبة العمولة" value={f.rate} onChange={(v) => set({ rate: v })}
                      hint={<span>من الإيراد المحقق</span>} />
                  </div>
                  {tried && errs.rate && <div className="field__err" style={{ marginTop: -8, marginBottom: 10 }}>{errs.rate}</div>}
                </div>
              )}
              {legacy && <div className="alert alert-info" style={{ marginTop: 12 }}>الإعدادات الحالية بطريقة مكافأة قديمة ({BONUS_METHOD_LABEL[cur.bonusMethod]}) — عند الحفظ ستتحول إلى نسبة من الإيراد المحقق.</div>}
            </PlanSection>}
            {effSection(f.system === 'base_only' ? 3 : 4)}
          </div>

          <aside className="pr-sum" aria-label="ملخص الإعدادات">
            <div className="pr-sum__title">ملخص الإعدادات</div>
            <dl className="pr-sum__list">
              <div><dt>الراتب الأساسي</dt><dd className="num">{f.salary.trim() && Number.isFinite(sal) ? money(sal) : '—'}</dd></div>
              <div><dt>العمولة</dt><dd className="num">{f.bonusOn && rate > 0 ? <>{pct(rate)} <small>من الإيراد</small></> : <span className="muted">بدون</span>}</dd></div>
            </dl>
            {f.bonusOn && rate > 0 ? <div className="pr-sum__case pr-sum__case--ok"><span>الدخل الشهري</span><strong className="num">{Number.isFinite(sal) ? money(sal) : '—'} + {pct(rate)} <span>من الإيراد المحقق</span></strong></div> : <div className="pr-sum__case"><span>الدخل الشهري</span><strong className="num">{Number.isFinite(sal) ? money(sal) : '—'}</strong></div>}
            <div className="pr-sum__eff"><Icon name="calendar" size={15} /><span>يبدأ من</span> <b>{periodLabel(f.eff)}</b></div>
          </aside>
        </div>
      )}
    </Modal>
  );
}

// ---------- إعداد جماعي: راتب وتارجت ومكافأة كل الأخصائيين (أو رواتب الإداريين) في شاشة واحدة ----------
type BulkVal = { salary: string; target: string; rate: string; cond: BonusCondition; payDay: string };
const bulkInit = (r: PayrollRow): BulkVal => ({
  salary: r.live.hasPlan ? String(r.live.baseSalary) : '',
  target: '',
  rate: r.live.hasPlan && r.live.bonusRate > 0 && r.live.bonusMethod !== 'none' && r.live.bonusMethod !== 'fixed' ? String(r.live.bonusRate) : '',
  cond: 'always',
  payDay: r.live.payDay != null ? String(r.live.payDay) : '',
});
const sameVal = (a: BulkVal, b: BulkVal) => a.salary.trim() === b.salary.trim() && a.target.trim() === b.target.trim() && a.rate.trim() === b.rate.trim() && a.cond === b.cond && a.payDay === b.payDay;

function BulkNum({ label, value, onChange, placeholder, note, invalid, off }: { label: string; value: string; onChange: (v: string) => void; placeholder?: string; note?: ReactNode; invalid?: boolean; off?: boolean }) {
  return (
    <label className="pr-bulk__cell">
      <span className="pr-bulk__lbl">{label}</span>
      <input className="input" inputMode="decimal" value={off ? '0' : value} placeholder={placeholder} aria-label={label} aria-invalid={invalid} disabled={off}
        style={off ? { textDecoration: 'line-through', opacity: 0.5 } : undefined}
        onChange={(e) => onChange(toLatinDigits(e.target.value))} />
      {note && <span className="pr-bulk__note">{note}</span>}
    </label>
  );
}

export function BulkPlanModal({ type, rows, period, onClose, onDone }: {
  type: SubjectType; rows: PayrollRow[]; period: string; onClose: () => void; onDone: (close: boolean) => void;
}) {
  const toast = useToast();
  const isTh = type === 'therapist';
  const effOpts = effectivePeriods();
  const [base, setBase] = useState<Record<string, BulkVal>>(() => Object.fromEntries(rows.map((r) => [r.id, bulkInit(r)])));
  const [vals, setVals] = useState<Record<string, BulkVal>>(base);
  const [eff, setEff] = useState(effOpts.includes(period) ? period : currentPeriod());
  const [note, setNote] = useState('');
  const [applyDue, setApplyDue] = useState(true);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState<string | null>(null);
  const [refs, setRefs] = useState<Map<string, RevenueRef> | null>(null);
  const [quick, setQuick] = useState({ salary: '', target: '', rate: '' });
  useEffect(() => { if (isTh) payrollApi.history(period).then(setRefs); }, [isTh, period]);

  const upd = (id: string, p: Partial<BulkVal>) => { setVals((v) => ({ ...v, [id]: { ...v[id], ...p } })); setErrors((e) => { const { [id]: _, ...rest } = e; return rest; }); };
  // صف بيتحفظ لو اتغيّر، أو لو مالوش إعدادات واتكتب راتبه
  const dirty = (r: PayrollRow) => !sameVal(vals[r.id], base[r.id]) && (r.live.hasPlan || vals[r.id].salary.trim() !== '');
  const toSave = rows.filter(dirty);
  const validate = (v: BulkVal) => {
    const only = isTh && v.cond === 'always' && v.rate.trim() !== '' && amount(v.rate) > 0;
    const s = only ? 0 : amount(v.salary), t = v.target.trim() ? amount(v.target) : 0, p = v.rate.trim() ? amount(v.rate) : 0;
    if (!only && !v.salary.trim()) return 'اكتب الراتب الأساسي (وإذا ما فيه راتب اكتب 0).';
    if (!Number.isFinite(s) || s < 0 || !Number.isFinite(t) || t < 0) return 'اكتب مبالغ صحيحة.';
    if (isTh && (!Number.isFinite(p) || p < 0 || p > 100)) return 'لازم تكون النسبة من 0 إلى 100.';
    return '';
  };
  const fill = (onlyEmpty: boolean) => {
    const q = { salary: quick.salary.trim(), target: quick.target.trim(), rate: quick.rate.trim() };
    if (!q.salary && !q.target && !q.rate) { toast.error('اكتب قيمة واحدة على الأقل في التعبئة السريعة.'); return; }
    setVals((v) => Object.fromEntries(rows.map((r) => {
      const cur = v[r.id];
      if (onlyEmpty && r.live.hasPlan) return [r.id, cur];
      return [r.id, { ...cur, ...(q.salary && { salary: q.salary }), ...(q.target && { target: q.target }), ...(q.rate && { rate: q.rate }) }];
    })));
  };
  const dueRows = toSave.filter((r) => r.dueId);

  const save = async () => {
    if (!toSave.length) { toast.info('ما فيه أي تغيير لحفظه.'); return; }
    const errs = Object.fromEntries(toSave.map((r) => [r.id, validate(vals[r.id])]).filter(([, e]) => e));
    setErrors(errs);
    if (Object.keys(errs).length) { toast.error('راجع الصفوف المعلّمة بالأحمر.'); return; }
    const failed: Record<string, string> = {};
    const nb = { ...base };
    let saved = 0;
    for (const [i, r] of toSave.entries()) {
      setBusy(`${i + 1} / ${toSave.length}`);
      const v = vals[r.id];
      const t = v.target.trim() ? amount(v.target) : 0, p = v.rate.trim() ? amount(v.rate) : 0;
      const only = v.cond === 'always' && p > 0;
      const res = await payrollApi.savePlan(isTh
        ? { type, id: r.id, effectiveFrom: eff, baseSalary: only ? 0 : amount(v.salary), ...(only && { paySystem: 'commission_only' as const }), target: t, bonusMethod: p > 0 ? 'pct_revenue' : 'none', bonusRate: p, bonusFixed: 0, bonusCondition: v.cond, payDay: v.payDay ? Number(v.payDay) : null, note: note.trim() }
        : { type, id: r.id, effectiveFrom: eff, baseSalary: amount(v.salary), payDay: v.payDay ? Number(v.payDay) : null, note: note.trim() });
      if (!res.ok) { failed[r.id] = res.error; continue; }
      saved++; nb[r.id] = v;
      if (applyDue && r.dueId && eff <= period) {
        const x = await payrollApi.recalc(r.dueId, note.trim() || RECALC_REASON);
        if (!x.ok) failed[r.id] = `حُفظت الإعدادات، لكن مستحق ${periodLabel(period)} لم يُحدَّث: ${x.error}`;
      }
    }
    setBusy(null); setBase(nb); setErrors(failed);
    const nFail = Object.keys(failed).length;
    if (nFail) { toast.error(`تم حفظ ${saved} — وفيه ${nFail} بحاجة إلى مراجعة (مُعلَّمة بالأحمر).`); onDone(false); return; }
    toast.success(`تم حفظ إعدادات ${saved} ${isTh ? 'أخصائي' : 'موظف'}.`);
    onDone(true);
  };

  return (
    <Modal xl title={isTh ? 'إعداد الرواتب والعمولات' : 'إعداد رواتب الموظفين الإداريين'} onClose={busy ? () => {} : onClose}
      footer={<>
        <Button variant="outline" onClick={onClose} disabled={!!busy}>إلغاء</Button>
        <Button icon="check" onClick={save} loading={!!busy} disabled={!toSave.length && !busy}>{busy ? `جاري الحفظ ${busy}` : toSave.length ? `حفظ التغييرات (${toSave.length})` : 'حفظ التغييرات'}</Button>
      </>}>
      <p className="muted" style={{ marginTop: 0 }}>{isTh
        ? 'حدد راتب ونسبة عمولة كل أخصائي في مكان واحد. تُحفظ الصفوف التي تغيّرت فقط، ويُسجَّل كل حفظ في سجل الإعدادات.'
        : 'حدد الراتب الشهري الثابت لكل موظف إداري. تُحفظ الصفوف التي تغيّرت فقط.'}</p>
      <div className="grid-form">
        <Select id="bp-eff" label="يبدأ من شهر (لكل الصفوف المعدّلة)" value={eff} onChange={(e) => setEff(e.target.value)} options={effOpts.map((p) => ({ value: p, label: periodLabel(p) }))} />
        <Input id="bp-note" label="ملاحظة (اختياري)" placeholder="مثال: إعدادات بداية السنة" value={note} onChange={(e) => setNote(e.target.value)} />
      </div>

      <details className="pr-quick">
        <summary><Icon name="copy" size={16} /> <span>تعبئة سريعة بقيم موحّدة</span></summary>
        <div className="pr-quick__body">
          <BulkNum label="الراتب الأساسي (ج.م)" value={quick.salary} onChange={(x) => setQuick({ ...quick, salary: x })} />
          {isTh && <>
            <BulkNum label="نسبة العمولة %" value={quick.rate} onChange={(x) => setQuick({ ...quick, rate: x })} />
          </>}
          <div className="pr-quick__btns">
            <Button size="sm" variant="outline" onClick={() => fill(true)}>من ليس لهم إعدادات فقط</Button>
            <Button size="sm" variant="outline" onClick={() => fill(false)}>كل الصفوف</Button>
          </div>
        </div>
      </details>

      <div className={`pr-bulk ${isTh ? '' : 'pr-bulk--staff'}`}>
        <div className="pr-bulk__head" aria-hidden>
          <span>{isTh ? 'الأخصائي' : 'الموظف'}</span><span>الراتب الأساسي (ج.م)</span>
          {isTh && <><span>الإيراد المحقق</span><span>نسبة العمولة %</span></>}
          <span>يوم الصرف</span>
        </div>
        {rows.map((r) => {
          const v = vals[r.id]; const d = dirty(r); const e = errors[r.id];
          const t = v.target.trim() ? amount(v.target) : 0, p = v.rate.trim() ? amount(v.rate) : 0;
          const ref = refs?.get(r.id);
          return (
            <div key={r.id} className={`pr-bulk__row ${d ? 'is-changed' : ''} ${e ? 'is-error' : ''}`}>
              <div className="pr-bulk__who">
                <span className="avatar" data-no-i18n>{initials(r.name)}</span>
                <div><strong data-no-i18n>{r.name}</strong>
                  <span className="muted-sm">{d ? 'معدّل — لم يُحفظ بعد' : r.live.hasPlan ? 'محدد' : 'لم يُحدد بعد'}{!isTh && <> · {ROLE_NAME[r.role] ?? r.role}</>}</span></div>
              </div>
              <BulkNum label="الراتب الأساسي (ج.م)" value={v.salary} placeholder="0" off={isTh && v.cond === 'always' && p > 0} onChange={(x) => upd(r.id, { salary: x })} />
              {isTh && <>
                <div className="pr-bulk__cell">
                  <span className="pr-bulk__lbl">الإيراد المحقق</span>
                  <strong className="num">{money(r.live.qualifying)}</strong>
                  <span className="pr-bulk__note">{!refs ? '…' : ref?.avg != null ? <><span>متوسط 3 شهور</span> <span className="num">{money(ref.avg)}</span></> : 'ما فيه زيارات سابقة'}</span>
                </div>
                <BulkNum label="نسبة العمولة %" value={v.rate} placeholder="بدون" onChange={(x) => upd(r.id, { rate: x })} />
              </>}
              <label className="pr-bulk__cell">
                <span className="pr-bulk__lbl">يوم الصرف</span>
                <select className="input" value={v.payDay} aria-label="يوم الصرف" onChange={(ev) => upd(r.id, { payDay: ev.target.value })}>
                  <option value="">غير محدد</option>
                  {Array.from({ length: 31 }, (_, i) => <option key={i + 1} value={String(i + 1)}>{`يوم ${i + 1}`}</option>)}
                </select>
              </label>
              {e && <div className="pr-bulk__err">{e}</div>}
            </div>
          );
        })}
      </div>

      {dueRows.length > 0 && eff <= period && (
        <label className="pr-check">
          <input type="checkbox" checked={applyDue} onChange={(e) => setApplyDue(e.target.checked)} />
          <span><span>طبّق التعديل أيضًا على مستحقات</span> <b>{periodLabel(period)}</b> <span>المثبّتة</span> (<span className="num">{dueRows.length}</span>)</span>
        </label>
      )}
    </Modal>
  );
}

// ---------- الصرف اليدوي: نموذج ← مراجعة وتأكيد ----------
export function PayModal({ row, period, defaultKind, onClose, onPaid }: { row: PayrollRow; period: string; defaultKind?: PayoutKind; onClose: () => void; onPaid: () => void }) {
  const toast = useToast();
  const clientKey = useMemo(() => crypto.randomUUID(), []);
  const remSalary = Math.max(0, (row.due?.salaryDue ?? 0) - row.paidSalary);
  const remBonus = Math.max(0, (row.due?.bonusDue ?? 0) - row.paidBonus);
  const [kind, setKind] = useState<PayoutKind>(defaultKind ?? (remSalary > 0 || remBonus <= 0 ? 'salary' : 'bonus'));
  const rem = kind === 'salary' ? remSalary : remBonus;
  const [amount, setAmount] = useState(String(rem));
  const [paidOn, setPaidOn] = useState(todayYmd());
  const [method, setMethod] = useState<PayoutMethod>('transfer');
  const [reference, setReference] = useState('');
  const [note, setNote] = useState('');
  const [review, setReview] = useState(false);
  const [busy, setBusy] = useState(false);
  useEffect(() => { if (kind === 'bonus' && row.type === 'therapist' && Number(rate) > 0) pickRate(rate); else setAmount(String(kind === 'salary' ? remSalary : remBonus)); }, [kind]);
  const amt = Number(amount);
  const snap = row.due ?? row.live;
  // النسبة من اللي وصله (الإيراد المحقق) افتراضيًا، ونسبة مكافأته المحددة في إعداداته تظهر وتتحسب تلقائيًا
  const [rate, setRate] = useState(snap.bonusMethod !== 'fixed' && snap.bonusMethod !== 'none' && snap.bonusRate > 0 ? String(snap.bonusRate) : '');
  // «كام في المية»: المبلغ = النسبة × (قيمة التارجت أو الإيراد المحقق)
  const pickRate = (v: string) => { setRate(v); const base = snap.qualifying; const n = Number(v); // الأساس واحد: اللي وصله (الإيراد المحقق)
   setAmount(n > 0 && base > 0 ? String(Math.round(base * n) / 100) : ''); };
  const openBonus = kind === 'bonus' && row.type === 'therapist'; // المكافأة مفتوحة: تتصرف حتى قبل التارجت
  const invalid = !Number.isFinite(amt) || amt <= 0 || (!openBonus && amt > rem + 0.001) || !paidOn || paidOn > todayYmd();

  const pay = async () => {
    setBusy(true);
    const r = await payrollApi.pay({ dueId: row.dueId!, kind, amount: amt, paidOn, method, reference, note, clientKey });
    setBusy(false);
    if (!r.ok) { toast.error(r.error); setReview(false); return; }
    toast.success(`تم تسجيل الصرف — سند ${r.no}، المتبقي ${money(r.remaining)}.`);
    onPaid();
  };

  return (
    <Modal title={review ? 'تأكيد الصرف' : 'تسجيل صرف'} onClose={onClose}
      footer={review
        ? <><Button variant="outline" onClick={() => setReview(false)} disabled={busy}>تعديل</Button><Button icon="wallet" onClick={pay} loading={busy}>تأكيد الصرف</Button></>
        : <><Button variant="outline" onClick={onClose}>إلغاء</Button><Button icon="check" onClick={() => { if (invalid) { toast.error(amt > rem && !openBonus ? `المبلغ أكبر من المتبقي (${money(rem)}).` : 'راجع المبلغ والتاريخ.'); return; } setReview(true); }}>مراجعة</Button></>}>
      <p style={{ marginTop: 0 }}><strong data-no-i18n>{row.name}</strong> · {periodLabel(period)}</p>
      {row.type === 'therapist' && kind !== 'bonus' && <TargetProgress row={row} />}
      <div className="muted-sm" style={{ marginBottom: 6 }}>اختر ما ستصرفه:</div>
      <div className="kpi-grid" style={{ gridTemplateColumns: 'repeat(auto-fit, minmax(150px, 1fr))', marginBottom: 12 }}>
        <button type="button" disabled={review || remSalary <= 0} onClick={() => setKind('salary')} className="card" style={{ padding: '12px 14px', textAlign: 'start', cursor: review || remSalary <= 0 ? 'default' : 'pointer', opacity: remSalary <= 0 ? 0.55 : 1, border: kind === 'salary' ? '2px solid var(--brand)' : undefined, background: kind === 'salary' ? 'var(--brand-soft, var(--surface))' : undefined }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', gap: 8 }}><strong>الراتب</strong>{kind === 'salary' && <span style={{ color: 'var(--brand)' }}>✓ مختار</span>}</div>
          <div className="num" style={{ fontSize: 20, fontWeight: 700 }}>{money((row.due?.salaryDue ?? 0))}</div>
          <div className="muted-sm">المصروف {money(row.paidSalary)} · المتبقي {money(remSalary)}</div>
        </button>
        {row.type === 'therapist' && (
        <button type="button" disabled={review} onClick={() => setKind('bonus')} className="card" style={{ padding: '12px 14px', textAlign: 'start', cursor: review ? 'default' : 'pointer', opacity: 1, border: kind === 'bonus' ? '2px solid var(--brand)' : undefined, background: kind === 'bonus' ? 'var(--brand-soft, var(--surface))' : undefined }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', gap: 8 }}><strong>مكافأة التارجت</strong>{kind === 'bonus' && <span style={{ color: 'var(--brand)' }}>✓ مختار</span>}</div>
          <div className="num" style={{ fontSize: 20, fontWeight: 700 }}>{money((row.due?.bonusDue ?? 0))}</div>
          <div className="muted-sm">المصروف {money(row.paidBonus)} · المتبقي {money(remBonus)}</div>
          {remBonus <= 0 && <div className="muted-sm">{(row.due?.bonusDue ?? 0) > 0 ? 'صُرفت بالكامل — تقدر تصرف مكافأة إضافية' : reachedTarget(row) ? 'تقدر تحدد نسبة المكافأة أو تصرف مبلغ مباشرة' : 'لم يتحقق التارجت — تقدر تصرف مكافأة مباشرة'}</div>}
        </button>
        )}
      </div>
      {openBonus && !review && (
        <div className="pr-bonus" style={{ marginBottom: 12 }}>
          <TargetProgress row={row} />
          <div className="grid-form">
            <RateSelect id="pr-rate" label="كام في المية؟" value={rate} onChange={(v) => pickRate(v)}
              hint={Number(rate) > 0 ? <><span className="num">{pct(Number(rate))}</span> <span>من</span> <b className="num">{money(snap.qualifying)}</b> <span>=</span> <b className="num">{money(Math.round(snap.qualifying * Number(rate)) / 100)}</b></> : <span>اختر نسبة، أو اكتب المبلغ مباشرة تحت.</span>} />
          </div>
        </div>
      )}
      {review ? (
        <div className="alert alert-warn">راجع قبل التأكيد — ستسجّل صرف <strong className="num">{money(amt)}</strong> (<strong>{kind === 'salary' ? 'راتب' : 'مكافأة التارجت'}</strong>) لـ<strong data-no-i18n> {row.name} </strong>
          عن {periodLabel(period)} بتاريخ <span className="num">{fmtDate(paidOn)}</span> — {PAYOUT_METHOD[method]}{reference ? ` · مرجع ${reference}` : ''}. هذا تسجيل لعملية تمت فعلًا، وليس تحويلًا تلقائيًا.</div>
      ) : (
        <>
          <div className="grid-form">
            <Input id="pr-amt" label={openBonus ? 'المبلغ (مكافأة مفتوحة)' : `المبلغ (المتبقي ${money(rem)})`} type="number" min={0} max={openBonus ? undefined : rem} step="0.01" inputMode="decimal" value={amount} onChange={(e) => setAmount(e.target.value)} />
            <Input id="pr-date" label="تاريخ الصرف" type="date" max={todayYmd()} value={paidOn} onChange={(e) => setPaidOn(e.target.value)} />
            <Select id="pr-pmethod" label="طريقة الدفع" value={method} onChange={(e) => setMethod(e.target.value as PayoutMethod)} options={(Object.keys(PAYOUT_METHOD) as PayoutMethod[]).map((m) => ({ value: m, label: PAYOUT_METHOD[m] }))} />
            <Input id="pr-ref" label="مرجع العملية (اختياري)" value={reference} onChange={(e) => setReference(e.target.value)} placeholder="مثال: رقم التحويل" />
          </div>
          <Input id="pr-pnote" label="ملاحظات (اختياري)" value={note} onChange={(e) => setNote(e.target.value)} />
        </>
      )}
    </Modal>
  );
}

export function MiniStat({ label, value, sub, tone }: { label: string; value: ReactNode; sub?: ReactNode; tone?: string }) {
  return (
    <div className="card" style={{ padding: '12px 14px' }}>
      <div className="muted-sm">{label}</div>
      <div className="num" style={{ fontSize: 20, fontWeight: 700, color: tone ? `var(--${tone})` : undefined }}>{value}</div>
      {sub && <div className="muted-sm">{sub}</div>}
    </div>
  );
}

// حقق التارجت في مستحق معتمد؟ (شرط تحديد النسبة بعد الوصول)
export const reachedTarget = (r: PayrollRow) => (r.due ? r.due.target > 0 && r.due.qualifying >= r.due.target : r.live.target > 0 && r.live.qualifying >= r.live.target);

// ---------- تحديد نسبة المكافأة بعد الوصول للتارجت ← حفظ أو حفظ وصرف ----------
export function BonusRateModal({ row, onClose, onDone }: { row: PayrollRow; onClose: () => void; onDone: (updated: PayrollRow, pay: boolean) => void }) {
  const toast = useToast();
  const due = row.due!;
  const method = 'pct_target' as 'pct_target' | 'pct_revenue'; // طريقة واحدة: نسبة من قيمة التارجت
  const [rate, setRate] = useState(due.bonusRate > 0 && (due.bonusMethod === 'pct_target' || due.bonusMethod === 'pct_revenue') ? String(due.bonusRate) : '');
  const [note, setNote] = useState('');
  const [busy, setBusy] = useState(false);
  const r = Number(rate || 0);
  const amount = previewBonus(method, r, 0, due.target, due.qualifying);
  const save = async (pay: boolean) => {
    if (!(r > 0 && r <= 100)) { toast.error('اختر النسبة أولًا.'); return; }
    if (amount < row.paidBonus) { toast.error('المكافأة الجديدة أقل مما صُرف فعليًا.'); return; }
    setBusy(true);
    const res = await payrollApi.setBonusRate(row.dueId!, method, r, note);
    setBusy(false);
    if (!res.ok) { toast.error(res.error); return; }
    toast.success(`تم تحديد المكافأة: ${money(res.bonusDue)}.`);
    onDone({ ...row, due: { ...due, bonusMethod: method, bonusRate: r, bonusFixed: 0, bonusDue: res.bonusDue } }, pay && res.bonusDue > row.paidBonus);
  };
  return (
    <Modal title="تحديد نسبة المكافأة" onClose={onClose}
      footer={<><Button variant="outline" onClick={onClose} disabled={busy}>إلغاء</Button>
        <Button variant="outline" icon="check" onClick={() => save(false)} loading={busy}>حفظ</Button>
        <Button icon="wallet" onClick={() => save(true)} loading={busy}>حفظ وصرف</Button></>}>
      <p style={{ marginTop: 0 }}><strong data-no-i18n>{row.name}</strong></p>
      <div className="kpi-grid" style={{ gridTemplateColumns: 'repeat(auto-fit, minmax(140px, 1fr))', marginBottom: 12 }}>
        <MiniStat label="التارجت" value={money(due.target)} />
        <MiniStat label="الإيراد المؤهل" value={money(due.qualifying)} sub={pct(due.pct)} tone="ok" />
        <MiniStat label="المكافأة الحالية" value={money(due.bonusDue)} sub={`المصروف ${money(row.paidBonus)}`} />
      </div>
      <div className="grid-form">
        <RateSelect id="br-rate" label="نسبة المكافأة" value={rate} onChange={setRate} />
      </div>
      <Input id="br-note" label="ملاحظة (اختياري)" value={note} onChange={(e) => setNote(e.target.value)} />
      <div className="alert alert-ok" style={{ fontSize: 16 }}>
        {r > 0 ? <>المكافأة = <strong className="num">{money(amount)}</strong> ({pct(r)} من {method === 'pct_target' ? `التارجت ${money(due.target)}` : `الإيراد المؤهل ${money(due.qualifying)}`})</> : 'اختر النسبة ليظهر المبلغ.'}
      </div>
      <div className="alert alert-info">يُحسب المبلغ على الخادم ويصبح المكافأة المعتمدة، ويُسجَّل التغيير في سجل التعديلات. «حفظ وصرف» يفتح الصرف مباشرة.</div>
    </Modal>
  );
}

// ---------- تعديل يدوي لمستحق معتمد (بسبب) ----------
export function AdjustModal({ row, onClose, onDone }: { row: PayrollRow; onClose: () => void; onDone: () => void }) {
  const toast = useToast();
  const [salary, setSalary] = useState(String(row.due?.salaryDue ?? 0));
  const [bonus, setBonus] = useState(String(row.due?.bonusDue ?? 0));
  const [reason, setReason] = useState('');
  const [busy, setBusy] = useState(false);
  const submit = async () => {
    if (!reason.trim()) { toast.error('اكتب سبب التعديل.'); return; }
    setBusy(true);
    const r = await payrollApi.adjust(row.dueId!, Number(salary || 0), Number(bonus || 0), reason.trim());
    setBusy(false);
    if (!r.ok) { toast.error(r.error); return; }
    toast.success('تم تعديل المستحق.');
    onDone();
  };
  return (
    <Modal title="تعديل مستحق معتمد" onClose={onClose}
      footer={<><Button variant="outline" onClick={onClose} disabled={busy}>رجوع</Button><Button icon="check" onClick={submit} loading={busy}>حفظ التعديل</Button></>}>
      <p style={{ marginTop: 0 }}><strong data-no-i18n>{row.name}</strong></p>
      <div className="grid-form">
        <Input id="pr-adj-sal" label={`الراتب المستحق (المصروف ${money(row.paidSalary)})`} type="number" min={row.paidSalary} step="0.01" value={salary} onChange={(e) => setSalary(e.target.value)} />
        {row.type === 'therapist' && <Input id="pr-adj-bon" label={`المكافأة المعتمدة (المصروف ${money(row.paidBonus)})`} type="number" min={row.paidBonus} step="0.01" value={bonus} onChange={(e) => setBonus(e.target.value)} />}
      </div>
      <Input id="pr-adj-reason" label="سبب التعديل *" value={reason} onChange={(e) => setReason(e.target.value)} />
      <div className="alert alert-info">يُسجَّل التعديل في سجل التعديلات مع السبب ومن أجراه والتاريخ، ولا يقل عن المصروف فعليًا.</div>
    </Modal>
  );
}

// ---------- تفاصيل شخص: الإيراد المحتسب + المستحقات والصرف + سجل الإعدادات + سجل التعديلات ----------
type DTab = 'visits' | 'dues' | 'plans' | 'audit';
export function SubjectDetailModal({ row, overview, onClose, onChanged }: { row: PayrollRow; overview: Overview; onClose: () => void; onChanged: () => void }) {
  const can = useCan();
  const isTh = row.type === 'therapist';
  const [tab, setTab] = useState<DTab>(isTh ? 'visits' : 'dues');
  const [d, setD] = useState<SubjectDetail | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [act, setAct] = useState<'pay' | 'adjust' | 'recalc' | 'rate' | { voidId: string; no: string } | null>(null);
  const [payRow, setPayRow] = useState<PayrollRow | null>(null);
  const load = async () => { setErr(null); const r = await payrollApi.detail(row.type, row.id, overview.period); if (r.ok) setD(r.data); else setErr(r.error); };
  useEffect(() => { load(); }, [row.id, overview.period, row.paidSalary, row.paidBonus, row.due?.salaryDue, row.due?.bonusDue, row.due?.qualifying]);
  const due = row.due;
  const basisNow = due ? due.basis : row.live.basis;
  const tabs: { id: DTab; label: string }[] = [
    ...(isTh ? [{ id: 'visits' as const, label: 'الإيراد المحتسب' }] : []),
    { id: 'dues', label: 'المستحقات والصرف' }, { id: 'plans', label: 'سجل الإعدادات' }, { id: 'audit', label: 'سجل التعديلات' },
  ];
  const visits = d?.visits ?? [];
  const sum = (f: (v: (typeof visits)[number]) => number) => visits.reduce((s, v) => s + f(v), 0);

  return (
    <Modal wide title="التفاصيل المالية" onClose={onClose}>
      <p style={{ marginTop: 0 }}><strong data-no-i18n>{row.name}</strong> · {ROLE_NAME[row.role] ?? row.role} · {periodLabel(overview.period)}</p>
      <div className="tabs" style={{ overflowX: 'auto', marginBottom: 12 }}>
        {tabs.map((t) => <button key={t.id} className={`tab ${tab === t.id ? 'active' : ''}`} onClick={() => setTab(t.id)}>{t.label}</button>)}
      </div>
      {err ? <div className="alert alert-danger">{err}</div> : !d ? <Skeleton h={200} /> : (
        <>
          {tab === 'visits' && (
            <>
              <div className="alert alert-info" style={{ marginBottom: 10 }}>
                {due ? 'زيارات متجمّدة وقت الاعتماد' : 'زيارات منفذة (حضر/مكتمل) بتاريخ الزيارة'} · القاعدة: {basisNow === 'collected' ? 'المحصّل فعليًا من قيمة الزيارة' : 'قيمة الزيارة كاملة (المستحق)'} · القيمة = صافي الفاتورة بعد الخصم ودون الضريبة، والخطة أو الباقة = فاتورتها كاملة في أول زيارة.
              </div>
              {visits.length === 0 ? <EmptyState icon="calendar" title="ما فيه زيارات منفذة في هالشهر" /> : (
                <div className="table-wrap"><table className="table">
                  <thead><tr><th>تاريخ الزيارة</th><th>رقم الملف</th><th>المريض</th><th>الخدمة</th><th>الفاتورة</th><th>قيمة الزيارة</th><th>المحصّل</th><th>المؤهل</th><th>حالة الدفع</th></tr></thead>
                  <tbody>{visits.map((v, i) => (
                    <tr key={(v.appointmentId ?? '') + i} style={v.countedElsewhere ? { opacity: 0.55 } : undefined}>
                      <td className="num" style={{ whiteSpace: 'nowrap' }}>{fmtDate(v.date)}</td><td className="num" data-no-i18n>{String(v.fileNo ?? "").replace(/\D/g, "")}</td><td data-no-i18n>{v.patient}</td><td>{v.service}</td>
                      <td><span className="num">{v.invoiceNo ?? '—'}</span><div className="muted-sm">{SOURCE_LABEL[v.source] ?? v.source}</div></td>
                      <td className="num" style={{ whiteSpace: 'nowrap' }}>{money(v.valueNet)}</td><td className="num" style={{ whiteSpace: 'nowrap' }}>{money(v.collected)}</td>
                      <td className="num" style={{ fontWeight: 600, whiteSpace: 'nowrap' }}>{money(v.qualifying)}{v.countedElsewhere && <div className="muted-sm">محتسبة في شهر معتمد</div>}</td>
                      <td><StatusBadge label={PAYMENT_STATE[v.paymentStatus]?.label ?? v.paymentStatus} tone={PAYMENT_STATE[v.paymentStatus]?.tone ?? 'muted'} /></td>
                    </tr>
                  ))}</tbody>
                  <tfoot><tr><th colSpan={5}>الإجمالي ({visits.length} زيارة)</th><th className="num">{money(sum((v) => v.valueNet))}</th><th className="num">{money(sum((v) => v.collected))}</th><th className="num">{money(sum((v) => v.qualifying))}</th><th /></tr></tfoot>
                </table></div>
              )}
            </>
          )}
          {tab === 'dues' && (
            <>
              {!due ? <div className="alert alert-info">الأرقام معروضة مباشرة — وتُثبَّت تلقائيًا فور تسجيل صرف أو تحديد المكافأة من الجدول.</div> : (
                <div className="kpi-grid" style={{ gridTemplateColumns: 'repeat(auto-fit, minmax(160px, 1fr))', marginBottom: 12 }}>
                  <MiniStat label="الراتب المستحق" value={money(due.salaryDue)} sub={`المصروف ${money(row.paidSalary)} · المتبقي ${money(Math.max(0, due.salaryDue - row.paidSalary))}`} />
                  {isTh && <MiniStat label="المكافأة المعتمدة" value={money(due.bonusDue)} sub={`المحسوبة آليًا ${money(due.computedBonus)} · المصروف ${money(row.paidBonus)}`} />}
                  <MiniStat label="إجمالي المستحقات" value={money(due.salaryDue + due.bonusDue)} sub={`المتبقي ${money(Math.max(0, due.salaryDue + due.bonusDue - row.paidSalary - row.paidBonus))}`} tone="brand" />
                </div>
              )}
              {due && (
                <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', marginBottom: 12 }}>
                  {can('payroll', 'create') && row.payStatus !== 'paid' && row.payStatus !== 'nothing' && <Button icon="wallet" onClick={() => setAct('pay')}>تسجيل صرف</Button>}
                  {isTh && reachedTarget(row) && can('payroll', 'edit') && <Button variant="outline" icon="target" onClick={() => setAct('rate')}>تحديد نسبة المكافأة</Button>}
                  {can('payroll', 'edit') && <Button variant="outline" icon="edit" onClick={() => setAct('adjust')}>تعديل المستحق</Button>}
                  {can('payroll', 'edit') && overview.status !== 'closed' && <Button variant="outline" icon="refresh" onClick={() => setAct('recalc')}>إعادة الاحتساب</Button>}
                </div>
              )}
              {d.payouts.length === 0 ? <EmptyState icon="wallet" title="ما فيه عمليات صرف" /> : (
                <div className="table-wrap"><table className="table">
                  <thead><tr><th>السند</th><th>عن شهر</th><th>النوع</th><th>المبلغ</th><th>تاريخ الصرف</th><th>الطريقة</th><th>المرجع / الملاحظات</th><th>سجّله</th><th>الحالة</th><th className="actions" /></tr></thead>
                  <tbody>{d.payouts.map((p) => (
                    <tr key={p.id} style={p.status === 'void' ? { opacity: 0.6 } : undefined}>
                      <td className="num" style={{ whiteSpace: 'nowrap' }}>{p.no}</td><td style={{ whiteSpace: 'nowrap' }}>{periodLabel(p.period)}</td><td>{PAYOUT_KIND[p.kind]}</td>
                      <td className="num" style={{ fontWeight: 600, whiteSpace: 'nowrap' }}>{money(p.amount)}</td><td className="num" style={{ whiteSpace: 'nowrap' }}>{fmtDate(p.paidOn)}</td><td>{PAYOUT_METHOD[p.method]}</td>
                      <td data-no-i18n>{[p.reference, p.note].filter(Boolean).join(' — ') || '—'}</td><td data-no-i18n>{p.createdBy ?? '—'}</td>
                      <td>{p.status === 'paid' ? <StatusBadge label="مصروف" tone="ok" /> : <><StatusBadge label="ملغي" tone="muted" />{p.voidReason && <div className="muted-sm" data-no-i18n>{p.voidReason}</div>}</>}</td>
                      <td className="actions">{p.status === 'paid' && can('payroll', 'delete') && <IconAction icon="close" label="إلغاء الصرف" danger onClick={() => setAct({ voidId: p.id, no: p.no })} />}</td>
                    </tr>
                  ))}</tbody>
                </table></div>
              )}
            </>
          )}
          {tab === 'plans' && (d.plans.length === 0 ? <EmptyState icon="settings" title="ما تم تحديد إعدادات بعد" /> : (
            <div className="table-wrap"><table className="table">
              <thead><tr><th>يبدأ من</th><th>الراتب</th>{isTh && <><th>التارجت</th><th>المكافأة</th></>}<th>ملاحظة</th><th>عدّله</th><th>وقت التعديل</th></tr></thead>
              <tbody>{d.plans.map((p) => (
                <tr key={p.id}>
                  <td style={{ whiteSpace: 'nowrap' }}>{periodLabel(p.effectiveFrom)}</td><td className="num">{money(p.baseSalary)}</td>
                  {isTh && <><td className="num">{p.target > 0 ? money(p.target) : '—'}</td><td>{bonusSummary(p.bonusMethod, p.bonusRate, p.bonusFixed, p.bonusCondition)}</td></>}
                  <td data-no-i18n>{p.note || '—'}</td><td data-no-i18n>{p.createdBy ?? '—'}</td><td className="num" style={{ whiteSpace: 'nowrap' }}>{fmtDateTime(Date.parse(p.createdAt))}</td>
                </tr>
              ))}</tbody>
            </table></div>
          ))}
          {tab === 'audit' && <AuditList entries={d.audit} />}
        </>
      )}
      {act === 'pay' && <PayModal row={row} period={overview.period} onClose={() => setAct(null)} onPaid={() => { setAct(null); onChanged(); }} />}
      {act === 'rate' && <BonusRateModal row={row} onClose={() => setAct(null)} onDone={(r, pay) => { setAct(null); onChanged(); if (pay) setPayRow(r); }} />}
      {payRow && <PayModal row={payRow} period={overview.period} defaultKind="bonus" onClose={() => setPayRow(null)} onPaid={() => { setPayRow(null); onChanged(); }} />}
      {act === 'adjust' && <AdjustModal row={row} onClose={() => setAct(null)} onDone={() => { setAct(null); onChanged(); }} />}
      {act === 'recalc' && <ReasonModal title="إعادة احتساب المستحق" confirmLabel="إعادة الاحتساب" danger={false}
        message="سيُحسب المستحق من جديد من الزيارات والفواتير الحالية والإعدادات السارية لهذا الشهر. هذا تصحيح صريح ومُسجَّل، ولا يقل عن المصروف فعليًا."
        onClose={() => setAct(null)} successText="تمت إعادة الاحتساب."
        onSubmit={async (reason) => { const r = await payrollApi.recalc(row.dueId!, reason); if (!r.ok) return r.error; setAct(null); onChanged(); return null; }} />}
      {act && typeof act === 'object' && <ReasonModal title={`إلغاء صرف ${act.no}`} confirmLabel="تأكيد الإلغاء"
        message="سيبقى السند في السجل بحالة «ملغي» ويعود المبلغ إلى المتبقي. وهذا ليس استردادًا تلقائيًا للمبلغ."
        onClose={() => setAct(null)} successText="تم إلغاء الصرف."
        onSubmit={async (reason) => { const r = await payrollApi.voidPayout(act.voidId, reason); if (!r.ok) return r.error; setAct(null); onChanged(); load(); return null; }} />}
    </Modal>
  );
}

export function AuditList({ entries, showSubject }: { entries: SubjectDetail['audit']; showSubject?: boolean }) {
  if (!entries.length) return <EmptyState icon="clock" title="ما فيه تعديلات مسجّلة" />;
  return (
    <div className="table-wrap"><table className="table">
      <thead><tr><th>الوقت</th><th>العملية</th>{showSubject && <th>الشخص</th>}<th>الشهر</th><th>بواسطة</th><th>السبب / الملاحظة</th><th>التفاصيل</th></tr></thead>
      <tbody>{entries.map((a, i) => (
        <tr key={i}>
          <td className="num" style={{ whiteSpace: 'nowrap' }}>{fmtDateTime(Date.parse(a.at))}</td><td>{a.action}</td>
          {showSubject && <td data-no-i18n>{a.subject ?? '—'}</td>}
          <td style={{ whiteSpace: 'nowrap' }}>{a.period ? periodLabel(a.period) : '—'}</td><td data-no-i18n>{a.actor || '—'}</td>
          <td data-no-i18n>{a.reason ?? '—'}</td><td className="muted-sm" data-no-i18n style={{ maxWidth: 320, overflowWrap: 'anywhere' }}>{auditDetails(a.details)}</td>
        </tr>
      ))}</tbody>
    </table></div>
  );
}
const auditDetails = (d: Record<string, unknown>) => {
  const fmt = (o: unknown) => (o && typeof o === 'object' ? Object.entries(o as Record<string, unknown>).map(([k, v]) => `${k}: ${v}`).join('، ') : String(o ?? ''));
  if (d.before !== undefined || d.after !== undefined) return `قبل: ${fmt(d.before) || '—'} ← بعد: ${fmt(d.after)}`;
  return fmt(d);
};
