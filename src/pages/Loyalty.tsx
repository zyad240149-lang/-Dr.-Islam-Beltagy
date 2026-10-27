import { sendWhatsApp } from '../data/whatsappSend';
import { useEffect, useState } from 'react';
import { db } from '../data/db';
import { supabase } from '../lib/supabase';
import { Button, EmptyState, Input, Modal, Select, Skeleton, StatusBadge } from '../components/ui';
import { useCan } from '../components/common';
import { PhoneInput } from '../components/PhoneInput';
import { phoneErrorMessage, type PhoneErrorCode } from '../utils/phoneUtils';
import { StatCard } from '../components/StatCard';
import { Icon } from '../utils/icons';
import { useToast } from '../hooks/useToast';
import { fmtDateTime, money, waLink } from '../utils/format';
import type { LoyaltyCodeRow, LoyaltyCodeStatus, LoyaltyKind, LoyaltyLedgerRow, LoyaltySummary, Patient } from '../types';

// جدولا loyalty_ledger/loyalty_redemptions ليسا جزءًا من الكاش العام — نشترك مباشرة في تحديثاتهما اللحظية
// حتى تظهر عمليات موظف آخر (استبدال/إضافة نقاط) فورًا في هذه الصفحة بدل انتظار إعادة تحميل يدوية.
function useLoyaltyLive() {
  const [tick, setTick] = useState(0);
  useEffect(() => {
    const ch = supabase.channel(`loyalty-live-${crypto.randomUUID()}`);
    let t: ReturnType<typeof setTimeout> | null = null;
    const bump = () => { if (t) clearTimeout(t); t = setTimeout(() => setTick((n) => n + 1), 300); };
    ch.on('postgres_changes', { event: '*', schema: 'public', table: 'loyalty_ledger' }, bump);
    ch.on('postgres_changes', { event: '*', schema: 'public', table: 'loyalty_redemptions' }, bump);
    ch.on('postgres_changes', { event: '*', schema: 'public', table: 'discount_codes' }, bump);
    ch.subscribe();
    return () => { if (t) clearTimeout(t); supabase.removeChannel(ch); };
  }, []);
  return tick;
}

const KIND_LABEL: Record<LoyaltyKind, string> = {
  session: 'نقاط جلسة', plan_session: 'نقاط جلسة خطة', package: 'نقاط باقة', redeem: 'استبدال نقاط', adjust: 'تعديل إداري', reversal: 'إرجاع نقاط',
};
const CODE_STATUS: Record<LoyaltyCodeStatus, { label: string; tone: string }> = {
  unused: { label: 'غير مستخدم', tone: 'warn' }, used: { label: 'مستخدم', tone: 'ok' }, cancelled: { label: 'ملغي', tone: 'danger' }, expired: { label: 'منتهي', tone: 'muted' },
};

function ConfirmRedeemModal({ patient, summary, onClose, onDone }: { patient: Patient; summary: LoyaltySummary; onClose: () => void; onDone: (code: string, remaining: number) => void }) {
  const toast = useToast();
  const [busy, setBusy] = useState(false);
  const [beneficiaryType, setBeneficiaryType] = useState<'self' | 'other'>('self');
  const [benName, setBenName] = useState('');
  const [benPhone, setBenPhone] = useState('');
  const [benRelation, setBenRelation] = useState('');
  const [benPhoneErr, setBenPhoneErr] = useState<PhoneErrorCode | null>(null);
  const [tried, setTried] = useState(false);
  const [sessions, setSessions] = useState<1 | 2>(1);
  const cost = summary.redeemCost * sessions;

  const submit = async () => {
    setTried(true);
    if (beneficiaryType === 'other' && !benName.trim()) { toast.error('أدخل اسم المستفيد.'); return; }
    if (beneficiaryType === 'other' && benPhoneErr) { toast.error(phoneErrorMessage(benPhoneErr)!); return; }
    setBusy(true);
    if (summary.balance < cost) { toast.error(`الرصيد أقل من ${cost} نقطة.`); return; }
    const r = await db.redeemLoyaltyPoints(patient.id, beneficiaryType === 'other' ? { name: benName.trim(), phone: benPhone, relation: benRelation.trim() || undefined } : undefined, sessions);
    setBusy(false);
    if (!r.ok) { toast.error(r.error); return; }
    onDone(r.code, r.remaining);
  };

  return (
    <Modal title="استبدال نقاط بجلسة مجانية" onClose={onClose} footer={
      <><Button variant="outline" onClick={onClose} disabled={busy}>إلغاء</Button><Button icon="check" onClick={submit} loading={busy}>تأكيد الاستبدال</Button></>
    }>
      <div className="field">
        <label>المكافأة</label>
        <div className="seg">
          <button type="button" className={`seg__btn ${sessions === 1 ? 'active' : ''}`} onClick={() => setSessions(1)}>{summary.redeemCost} نقطة = جلسة</button>
          <button type="button" className={`seg__btn ${sessions === 2 ? 'active' : ''}`} disabled={summary.balance < summary.redeemCost * 2} onClick={() => setSessions(2)}>{summary.redeemCost * 2} نقطة = جلستين</button>
        </div>
      </div>
      <div className="alert alert-info">
        <Icon name="spark" size={17} />
        <div>سيتم خصم <strong className="num">{cost}</strong> نقطة من رصيد «{patient.fullName}» وإصدار كود جلسة مجانية.</div>
      </div>
      <p className="muted" style={{ fontSize: 13, marginBottom: 16 }}>الرصيد الحالي: <strong className="num">{summary.balance}</strong> نقطة — بعد الاستبدال: <strong className="num">{summary.balance - cost}</strong> نقطة.</p>

      <div className="field">
        <label>لمن الجلسة المجانية؟</label>
        <div className="seg">
          <button type="button" className={`seg__btn ${beneficiaryType === 'self' ? 'active' : ''}`} onClick={() => setBeneficiaryType('self')}>لنفسي</button>
          <button type="button" className={`seg__btn ${beneficiaryType === 'other' ? 'active' : ''}`} onClick={() => setBeneficiaryType('other')}>لشخص آخر</button>
        </div>
      </div>
      {beneficiaryType === 'other' && (
        <div className="grid-form grid-form--3">
          <Input id="rd-ben-name" label="اسم المستفيد *" value={benName} onChange={(e) => setBenName(e.target.value)} />
          <PhoneInput id="rd-ben-phone" label="رقم جوال المستفيد *" value={benPhone} showError={tried} onChange={(v, e) => { setBenPhone(v); setBenPhoneErr(e); }} />
          <Input id="rd-ben-rel" label="صلة القرابة (اختياري)" value={benRelation} onChange={(e) => setBenRelation(e.target.value)} />
        </div>
      )}
    </Modal>
  );
}

const waText = (name: string, code: string) =>
  `مرحبًا ${name}، تم استبدال نقاط الولاء الخاصة بك بجلسة علاج طبيعي مجانية 🎁
كود الجلسة: ${code}
قدّم الكود للاستقبال عند الدفع — يُستخدم مرة واحدة فقط.
عيادة د. إسلام بلتاجي لجراحة العظام والكسور`;

function SuccessModal({ patient, code, remaining, onClose }: { patient: Patient; code: string; remaining: number; onClose: () => void }) {
  const toast = useToast();
  const can = useCan();
  const copy = async () => { try { await navigator.clipboard.writeText(code); toast.success('تم نسخ الكود.'); } catch { toast.error('تعذّر النسخ.'); } };
  return (
    <Modal title="تم استبدال النقاط بنجاح" onClose={onClose} footer={<Button onClick={onClose}>تم</Button>}>
      <div className="success" style={{ textAlign: 'center' }}>
        <div className="mark"><Icon name="check" size={30} /></div>
        <dl className="dl" style={{ marginTop: 18, textAlign: 'start' }}>
          <div><dt>العميل</dt><dd>{patient.fullName}</dd></div>
          <div><dt>النقاط المتبقية</dt><dd className="num">{remaining}</dd></div>
        </dl>
        <div className="field" style={{ marginTop: 16 }}>
          <label>كود الجلسة المجانية</label>
          <div className="control has-icon">
            <Icon name="spark" size={18} />
            <input className="input" dir="ltr" readOnly value={code} style={{ fontWeight: 700, textAlign: 'center' }} />
          </div>
        </div>
        <div style={{ display: 'flex', gap: 8, justifyContent: 'center', flexWrap: 'wrap', marginTop: 8 }}>
          <Button variant="outline" icon="clipboard" onClick={copy}>نسخ الكود</Button>
          {patient.phone && can('whatsapp', 'create') && <Button icon="share" onClick={() => sendWhatsApp({ phone: patient.phone, text: waText(patient.fullName, code), patientId: patient.id, type: 'loyalty' })}>إرسال على واتساب</Button>}
        </div>
        <p className="muted" style={{ fontSize: 12.5, marginTop: 10 }}>الكود ظاهر أيضًا للمريض في حسابه (صفحة «نقاطي»).</p>
      </div>
    </Modal>
  );
}

function RedeemPanel() {
  const can = useCan();
  const live = useLoyaltyLive();
  const [q, setQ] = useState('');
  const [patientId, setPatientId] = useState('');
  const [summary, setSummary] = useState<LoyaltySummary | null>(null);
  const [confirming, setConfirming] = useState(false);
  const [success, setSuccess] = useState<{ code: string; remaining: number } | null>(null);

  const results = q.trim() ? db.searchPatients(q).slice(0, 8) : [];
  const patient = patientId ? db.patient(patientId) : undefined;

  useEffect(() => {
    if (!patientId) { setSummary(null); return; }
    let alive = true;
    db.patientLoyaltySummary(patientId).then((s) => { if (alive) setSummary(s); });
    return () => { alive = false; };
  }, [patientId, live]);

  const refreshSummary = () => { if (patientId) db.patientLoyaltySummary(patientId).then(setSummary); };

  return (
    <div className="form-section">
      <div className="form-section-title">ابحث عن المريض باسمه</div>
      {!patient ? (
        <>
          <Input id="ly-search" icon="search" placeholder="اكتب اسم المريض (أو رقم الجوال / رقم الملف)" autoFocus value={q} onChange={(e) => setQ(e.target.value)} />
          {results.length > 0 && (
            <div className="choice-grid" style={{ marginTop: 8 }}>
              {results.map((p) => (
                <button key={p.id} type="button" className="choice" onClick={() => { setPatientId(p.id); setQ(''); }}>
                  <span className="choice__ic"><Icon name="user" size={18} /></span>
                  <span><strong>{p.fullName}</strong><span> {p.fileNo} · <span className="num">{p.phone}</span></span></span>
                </button>
              ))}
            </div>
          )}
          {q.trim() && results.length === 0 && <p className="muted" style={{ marginTop: 8 }}>ما تم العثور على مريض بهذا الاسم.</p>}
        </>
      ) : (
        <>
          <div className="choice selected" style={{ marginBottom: 16 }}>
            <span className="choice__ic"><Icon name="user" size={18} /></span>
            <span style={{ flex: 1 }}><strong>{patient.fullName}</strong><span> {patient.fileNo} · <span className="num">{patient.phone}</span></span></span>
            <Button type="button" variant="ghost" size="sm" onClick={() => { setPatientId(''); setSummary(null); }}>تغيير</Button>
          </div>
          <dl className="review-list" style={{ marginBottom: 16 }}>
            <div><dt>رقم الملف</dt><dd>{patient.fileNo}</dd></div>
            <div><dt>الجوال</dt><dd className="num" dir="ltr">{patient.phone || '—'}</dd></div>
            {patient.diagnosis && <div><dt>التشخيص</dt><dd>{patient.diagnosis}</dd></div>}
          </dl>
          {!summary ? <Skeleton h={140} /> : (
            <div className="card">
              <div className="card__body" style={{ textAlign: 'center' }}>
                <div className="muted" style={{ fontSize: 13.5 }}>⭐ رصيد النقاط</div>
                <div style={{ fontSize: 34, fontWeight: 800, margin: '4px 0 6px' }} className="num">{summary.balance} <span style={{ fontSize: 15, fontWeight: 500 }}>نقطة</span></div>
                {summary.availableRewards > 0 ? (
                  <div className="muted" style={{ fontSize: 13.5, marginBottom: 14 }}>🎁 المكافآت المتاحة: <strong className="num">{summary.availableRewards}</strong> جلسة مجانية</div>
                ) : (
                  <div className="muted" style={{ fontSize: 13.5, marginBottom: 14 }}>يحتاج العميل <strong className="num">{summary.redeemCost - summary.balance}</strong> نقطة إضافية للوصول لأول مكافأة ({summary.redeemCost} نقطة).</div>
                )}
                {summary.availableRewards > 0 && can('loyalty', 'create') && <Button icon="spark" onClick={() => setConfirming(true)}>استبدال {summary.redeemCost} نقطة بجلسة مجانية</Button>}
                <dl className="review-list" style={{ marginTop: 20, textAlign: 'start' }}>
                  <div><dt>إجمالي المكتسب</dt><dd className="num">{summary.totalEarned}</dd></div>
                  <div><dt>إجمالي المستبدل</dt><dd className="num">{summary.totalRedeemed}</dd></div>
                  <div><dt>عدد مرات الاستبدال</dt><dd className="num">{summary.redemptionsCount}</dd></div>
                </dl>
              </div>
            </div>
          )}
        </>
      )}

      {confirming && patient && summary && (
        <ConfirmRedeemModal patient={patient} summary={summary} onClose={() => setConfirming(false)}
          onDone={(code, remaining) => { setConfirming(false); setSuccess({ code, remaining }); refreshSummary(); }} />
      )}
      {success && patient && <SuccessModal patient={patient} code={success.code} remaining={success.remaining} onClose={() => setSuccess(null)} />}
    </div>
  );
}

function LedgerTab() {
  const live = useLoyaltyLive();
  const [rows, setRows] = useState<LoyaltyLedgerRow[] | null>(null);
  const [error, setError] = useState('');
  useEffect(() => { db.loyaltyLedger().then((r) => { if (!r.ok) { setError(r.error); setRows([]); } else setRows(r.rows); }); }, [live]);
  if (rows === null) return <Skeleton h={200} />;
  if (error) return <div className="alert alert-danger"><Icon name="alert" size={17} /><div>{error}</div></div>;
  if (rows.length === 0) return <div className="card"><div className="card__body"><EmptyState icon="spark" title="ما فيه حركات نقاط بعد" /></div></div>;
  return (
    <div className="table-wrap"><table className="table">
      <thead><tr><th>العميل</th><th>نوع العملية</th><th>النقاط</th><th>الرصيد بعده</th><th>السبب</th><th>كود الخصم</th><th>الموظف</th><th>التاريخ</th></tr></thead>
      <tbody>
        {rows.map((r) => (
          <tr key={r.id}>
            <td><strong>{r.patientName}</strong></td>
            <td>{KIND_LABEL[r.kind]}</td>
            <td className="num" style={{ color: r.points > 0 ? 'var(--ok)' : 'var(--danger)', fontWeight: 700 }}>{r.points > 0 ? `+${r.points}` : r.points}</td>
            <td className="num">{r.balanceAfter}</td>
            <td>{r.reason}</td>
            <td dir="ltr">{r.discountCode ?? '—'}</td>
            <td>{r.employeeName ?? '—'}</td>
            <td>{fmtDateTime(new Date(r.createdAt).getTime())}</td>
          </tr>
        ))}
      </tbody>
    </table></div>
  );
}

function CancelCodeModal({ row, onClose }: { row: LoyaltyCodeRow; onClose: () => void }) {
  const toast = useToast();
  const [reason, setReason] = useState('');
  const [busy, setBusy] = useState(false);
  const submit = async () => {
    setBusy(true);
    const r = await db.cancelDiscountCode(row.id, reason);
    setBusy(false);
    if (!r.ok) { toast.error(r.error); return; }
    toast.success('تم إلغاء الكود وإرجاع النقاط لرصيد العميل.');
    onClose();
  };
  return (
    <Modal title={`إلغاء كود ${row.code}`} onClose={onClose} footer={<><Button variant="outline" onClick={onClose} disabled={busy}>رجوع</Button><Button variant="danger" onClick={submit} loading={busy}>تأكيد الإلغاء</Button></>}>
      <div className="alert alert-warn"><Icon name="alert" size={17} /><div>سيتم إلغاء الكود وإرجاع {row.pointsUsed} نقطة لرصيد «{row.patientName}» تلقائيًا.</div></div>
      <Input id="cc-reason" label="سبب الإلغاء (اختياري)" value={reason} onChange={(e) => setReason(e.target.value)} />
    </Modal>
  );
}

function CodesTab() {
  const can = useCan();
  const live = useLoyaltyLive();
  const [rows, setRows] = useState<LoyaltyCodeRow[] | null>(null);
  const [error, setError] = useState('');
  const [cancelling, setCancelling] = useState<LoyaltyCodeRow | null>(null);
  useEffect(() => { db.loyaltyCodes().then((r) => { if (!r.ok) { setError(r.error); setRows([]); } else setRows(r.rows); }); }, [live]);
  if (rows === null) return <Skeleton h={200} />;
  if (error) return <div className="alert alert-danger"><Icon name="alert" size={17} /><div>{error}</div></div>;
  if (rows.length === 0) return <div className="card"><div className="card__body"><EmptyState icon="spark" title="ما فيه عمليات استبدال بعد" /></div></div>;
  return (
    <>
      <div className="table-wrap"><table className="table">
        <thead><tr><th>الكود</th><th>اسم المريض</th><th>المستفيد</th><th>النقاط المستبدلة</th><th>قيمة المكافأة</th><th>تاريخ ووقت الاستبدال</th><th>الحالة</th><th>تاريخ الاستخدام</th><th>استُخدم بواسطة</th><th className="actions"></th></tr></thead>
        <tbody>
          {rows.map((r) => (
            <tr key={r.id}>
              <td dir="ltr"><strong>{r.code}</strong></td>
              <td>{r.patientName}</td>
              <td>{r.beneficiaryName ? <>{r.beneficiaryName}<div className="muted-sm num">{r.beneficiaryPhone}</div></> : <span className="muted">لنفسه</span>}</td>
              <td className="num">{r.pointsUsed}</td>
              <td className="num">{money(r.reward)}</td>
              <td>{fmtDateTime(new Date(r.createdAt).getTime())}</td>
              <td><StatusBadge label={CODE_STATUS[r.status].label} tone={CODE_STATUS[r.status].tone} />{r.cancelReason && <div className="muted-sm">{r.cancelReason}</div>}</td>
              <td>{r.usedAt ? fmtDateTime(new Date(r.usedAt).getTime()) : '—'}</td>
              <td>{r.usedByName ?? '—'}</td>
              <td className="actions">{r.status === 'unused' && can('whatsapp', 'create') && (r.beneficiaryPhone || db.patient(r.patientId)?.phone) && <Button size="sm" variant="outline" icon="share" onClick={() => sendWhatsApp({ phone: (r.beneficiaryPhone || db.patient(r.patientId)?.phone)!, text: waText(r.beneficiaryName || r.patientName, r.code), patientId: r.patientId, type: 'loyalty' })}>واتساب</Button>}{r.status === 'unused' && can('discounts', 'edit') && <Button size="sm" variant="soft-danger" onClick={() => setCancelling(r)}>إلغاء</Button>}</td>
            </tr>
          ))}
        </tbody>
      </table></div>
      {cancelling && <CancelCodeModal row={cancelling} onClose={() => setCancelling(null)} />}
    </>
  );
}

function LoyaltySettingsCard() {
  const can = useCan();
  const toast = useToast();
  const center = db.center() as any;
  const [f, setF] = useState({
    sessionPoints: center.loyaltySessionPoints ?? 2, packagePoints: center.loyaltyPackagePoints ?? 4, redeemCost: center.loyaltyRedeemCost ?? 30,
  });
  const [busy, setBusy] = useState(false);
  if (!can('settings', 'edit')) return null;
  const save = async () => {
    setBusy(true);
    const r = await db.updateLoyaltySettings(f.sessionPoints, f.packagePoints, f.redeemCost);
    setBusy(false);
    if (!r.ok) { toast.error(r.error); return; }
    toast.success('تم حفظ إعدادات نقاط الولاء.');
  };
  return (
    <div className="card" style={{ marginBottom: 18 }}>
      <div className="card__head"><h2>إعدادات نقاط الولاء</h2></div>
      <div className="card__body">
        <div className="grid-form grid-form--3">
          <Input id="ls-session" label="نقاط الكشف/الجلسة" type="number" min={0} value={f.sessionPoints} onChange={(e) => setF({ ...f, sessionPoints: Number(e.target.value) })} />
          <Input id="ls-package" label="نقاط شراء الباقة" type="number" min={0} value={f.packagePoints} onChange={(e) => setF({ ...f, packagePoints: Number(e.target.value) })} />
          <Input id="ls-cost" label="تكلفة المكافأة (نقطة = جلسة مجانية)" type="number" min={1} value={f.redeemCost} onChange={(e) => setF({ ...f, redeemCost: Number(e.target.value) })} />
        </div>
        <Button icon="check" onClick={save} loading={busy}>حفظ الإعدادات</Button>
      </div>
    </div>
  );
}

export default function Loyalty() {
  const can = useCan();
  const [tab, setTab] = useState<'redeem' | 'ledger' | 'codes' | 'settings'>('redeem');
  const canManage = can('loyalty', 'view');
  const center = db.center() as any;

  return (
    <div className="page">
      <div className="page-head">
        <div><h1>استبدال نقاط العملاء</h1><p>حوّل نقاط العميل إلى مكافآت وجلسات مجانية بسهولة.</p></div>
      </div>

      {canManage && (
        <div className="kpi-grid">
          <StatCard icon="spark" tone="info" value={center.loyaltyRedeemCost ?? 30} label="نقطة = جلسة مجانية" />
        </div>
      )}

      <div className="svc-tabs">
        <button type="button" className={`svc-tab ${tab === 'redeem' ? 'active' : ''}`} onClick={() => setTab('redeem')}>استبدال النقاط</button>
        <button type="button" className={`svc-tab ${tab === 'ledger' ? 'active' : ''}`} onClick={() => setTab('ledger')}>سجل النقاط</button>
        <button type="button" className={`svc-tab ${tab === 'codes' ? 'active' : ''}`} onClick={() => setTab('codes')}>سجل الاستبدالات</button>
        {can('settings', 'edit') && <button type="button" className={`svc-tab ${tab === 'settings' ? 'active' : ''}`} onClick={() => setTab('settings')}>الإعدادات</button>}
      </div>

      {tab === 'redeem' && <RedeemPanel />}
      {tab === 'ledger' && <LedgerTab />}
      {tab === 'codes' && <CodesTab />}
      {tab === 'settings' && <LoyaltySettingsCard />}
    </div>
  );
}
