import { patientMatches } from '../utils/phoneUtils';
import { useEffect, useMemo, useState } from 'react';
import { supabase } from '../lib/supabase';
import { db } from '../data/db';
import { useDbVersion, useLoading } from '../hooks/useDb';
import { Button, EmptyState, Input, Select, Skeleton } from '../components/ui';
import { useCan } from '../components/common';
import { StatCard } from '../components/StatCard';
import { useToast } from '../hooks/useToast';
import { Icon } from '../utils/icons';
import { REFERRAL_SOURCE_LABEL, fmtDate, fmtDateTime, fmtTime, money, riyadhTodayYmd, tsToYmd } from '../utils/format';
import { discountLabel } from './Discounts';
import { SitePushCard } from '../components/SitePushCard';
import { WhatsappBulkCard } from '../components/WhatsappBulkCard';
import type { CampaignAudience, Patient, ReferralSource } from '../types';

const AUDIENCE_LABEL: Record<CampaignAudience, string> = {
  all: 'كل المرضى', with_account: 'المرضى الذين عندهم حساب', source: 'حسب مصدر التعرف', patient: 'مريض محدد',
  new: 'مرضى جدد (آخر 30 يوم)', active_plan: 'مرضى عليهم جلسات (خطة علاج نشطة)', inactive: 'حضروا سابقًا ولم يعودوا (60 يومًا فأكثر)',
  has_sessions: 'مرضى عليهم جلسات قادمة', has_exam: 'مرضى عليهم كشف قادم',
};
const UPCOMING = new Set(['new', 'confirmed', 'on_way', 'arrived', 'in_progress', 'rescheduled']);
const isExam = (serviceId: string) => (db.service(serviceId)?.name ?? '').includes('كشف');
// المواعيد القادمة للمريض مقسّمة: جلسات / كشف — نفس قاعدة الخادم (send_campaign)
function upcomingOf(patientId: string) {
  const today = riyadhTodayYmd();
  const list = db.appointmentsForPatient(patientId).filter((a) => a.date >= today && UPCOMING.has(a.status));
  const sessions = list.filter((a) => !isExam(a.serviceId)), exams = list.filter((a) => isExam(a.serviceId));
  const next = [...list].sort((a, b) => (a.date + a.time < b.date + b.time ? -1 : 1))[0];
  const due = db.invoicesForPatient(patientId).filter((i) => i.status !== 'cancelled').reduce((s, i) => s + Math.max(0, i.remaining), 0);
  return { sessions, exams, next, due };
}
const DAY_MS = 86400000;

const TEMPLATES = [
  { label: 'عرض الكشف', title: 'عرض خاص على الكشف', body: 'خصم خاص على كشف العظام هذا الشهر — احجز موعدك الآن.' },
  { label: 'تذكير بالمتابعة', title: 'حان وقت جلستك القادمة', body: 'نتمنى أن تكون بخير. لا تنسَ متابعة خطتك العلاجية — احجز جلستك القادمة من البوابة.' },
  { label: 'خصم خاص', title: 'خصم خاص لك', body: 'استمتع بخصم خاص على جلستك القادمة في عيادة د. إسلام بلتاجي لجراحة العظام والكسور.' },
];

export default function Campaigns() {
  useDbVersion();
  const loading = useLoading();
  const can = useCan();
  const toast = useToast();
  const [title, setTitle] = useState('');
  const [body, setBody] = useState('');
  const [audience, setAudience] = useState<CampaignAudience>('all');
  const [source, setSource] = useState<ReferralSource>('instagram');
  const [patientQuery, setPatientQuery] = useState('');
  const [patientId, setPatientId] = useState('');
  const [codeId, setCodeId] = useState('');
  const [sending, setSending] = useState(false);

  const patients = db.patients().filter((p) => p.active);
  const codes = db.discountCodes().filter((c) => ['active', 'scheduled'].includes(db.discountStatus(c)));
  const code = codes.find((c) => c.id === codeId);
  const campaigns = db.campaigns();

  // «المستلمون» من الخادم (campaign_audience) — نفس القائمة اللي الإشعار بيتبعت لها فعلًا، ومستخدمة في «إرسال واتساب يدوي»
  const fetchAudience = async (aud: CampaignAudience, src?: string, pid?: string): Promise<Patient[]> => {
    const { data, error } = await supabase.rpc('campaign_audience', { p_audience: aud, p_source: src ?? null, p_patient: pid || null });
    if (error) { toast.error(error.message.replace(/^.*?ERROR:\s*/, '')); return []; }
    return ((data as string[]) ?? []).map((id) => db.patient(id)).filter((x): x is Patient => !!x);
  };
  const [recipients, setRecipients] = useState<Patient[]>([]);
  useEffect(() => {
    let live = true;
    void fetchAudience(audience, source, patientId).then((r) => { if (live) setRecipients(r); });
    return () => { live = false; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [audience, source, patientId, patients.length, db.appointments().length]);

  const fullBody = code ? `${body.trim()}\n\nكود الخصم: ${code.code} (خصم ${discountLabel(code)} — ساري حتى ${code.validTo})` : body.trim();
  const matches = patientQuery.trim() && !patientId ? db.searchPatients(patientQuery).slice(0, 5) : [];

  const send = async () => {
    if (!title.trim() || !body.trim()) { toast.error('اكتب عنوان ونص الإشعار.'); return; }
    if (recipients.length === 0) { toast.error('ما فيه مستلمون بهذا الاختيار.'); return; }
    setSending(true);
    const r = await db.sendCampaign({
      title: title.trim(), body: fullBody, audience, source: audience === 'source' ? source : null,
      patientId: audience === 'patient' ? patientId : null, discountCodeId: code?.id ?? null,
    });
    setSending(false);
    if (!r.ok) { toast.error(r.error); return; }
    toast.success(`تم الإرسال — وصل لـ ${r.delivered} حساب على بوابة العميل من أصل ${r.recipients} مريض.`);
    setTitle(''); setBody(''); setCodeId('');
  };

  const totalDelivered = campaigns.reduce((s, c) => s + c.delivered, 0);

  return (
    <div className="page">
      <div className="page-head">
        <div><h1>إشعارات المرضى</h1><p>أرسل عروض وتنبيهات للمرضى — تظهر في إشعارات حسابهم على بوابة العميل.</p></div>
      </div>

      {can('notifications', 'create') && <SitePushCard />}
      {can('whatsapp', 'create') && <WhatsappBulkCard fetchAudience={fetchAudience} audienceOptions={(Object.keys(AUDIENCE_LABEL) as CampaignAudience[]).filter((k) => k !== 'patient' && k !== 'source').map((k) => ({ value: k, label: AUDIENCE_LABEL[k] }))} defaultText={fullBody} />}

      {loading ? <Skeleton h={90} /> : (
        <div className="kpi-grid">
          <StatCard icon="bell" tone="brand" value={campaigns.length} label="إشعارات مُرسلة" />
          <StatCard icon="checkCircle" tone="ok" value={totalDelivered} label="وصلت لحسابات" />
          <StatCard icon="users" tone="info" value={patients.length} label="مرضى نشطون" />
          <StatCard icon="receipt" tone="warn" value={codes.length} label="أكواد خصم متاحة" />
        </div>
      )}

      <div className="cm-layout">
        <section className="card">
          <div className="card__head"><h2>إشعار جديد</h2></div>
          <div className="card__body">
            <div className="field">
              <label>قوالب جاهزة</label>
              <div className="dc-presets">
                {TEMPLATES.map((t) => (
                  <button key={t.label} type="button" className="svc-tab" onClick={() => { setTitle(t.title); setBody(t.body); }}>{t.label}</button>
                ))}
              </div>
            </div>

            <Input id="cm-title" label="العنوان *" value={title} onChange={(e) => setTitle(e.target.value)} placeholder="مثال: عروض اليوم الوطني" />
            <div className="field">
              <label htmlFor="cm-body">نص الإشعار *</label>
              <textarea id="cm-body" className="input" rows={4} value={body} onChange={(e) => setBody(e.target.value)} placeholder="اكتب تفاصيل العرض…" />
            </div>

            <div className="grid-form">
              <Select id="cm-aud" label="المستلمون" value={audience} onChange={(e) => { setAudience(e.target.value as CampaignAudience); setPatientId(''); }}
                options={(Object.keys(AUDIENCE_LABEL) as CampaignAudience[]).filter((a) => a !== 'with_account').map((a) => ({ value: a, label: AUDIENCE_LABEL[a] }))} />
              {audience === 'source' && (
                <Select id="cm-src" label="مصدر التعرف" value={source} onChange={(e) => setSource(e.target.value as ReferralSource)}
                  options={Object.entries(REFERRAL_SOURCE_LABEL).map(([value, label]) => ({ value, label }))} />
              )}
            </div>

            {audience === 'patient' && (
              <div className="field">
                <label>المريض</label>
                {patientId ? (
                  <div className="choice selected">
                    <span style={{ flex: 1 }}><strong>{db.patient(patientId)?.fullName}</strong><span className="num"> {db.patient(patientId)?.phone}</span></span>
                    <Button type="button" variant="ghost" size="sm" onClick={() => { setPatientId(''); setPatientQuery(''); }}>تغيير</Button>
                  </div>
                ) : (
                  <>
                    <Input id="cm-patient-q" icon="search" placeholder="اسم المريض أو الجوال أو رقم الملف أو الهوية" value={patientQuery} onChange={(e) => setPatientQuery(e.target.value)} />
                    {matches.length > 0 && (
                      <div className="choice-grid" style={{ marginTop: 8 }}>
                        {matches.map((p) => (
                          <button key={p.id} type="button" className="choice" onClick={() => setPatientId(p.id)}>
                            <span><strong>{p.fullName}</strong><span className="num"> {p.phone}</span></span>
                          </button>
                        ))}
                      </div>
                    )}
                  </>
                )}
              </div>
            )}

            {(audience === 'has_sessions' || audience === 'has_exam') && (
              <div className="field">
                <label>المرضى المختارين ({recipients.length})</label>
                {recipients.length === 0 ? <p className="muted">ما فيه مرضى عليهم {audience === 'has_exam' ? 'كشف قادم' : 'جلسات قادمة'}.</p> : (
                  <div className="table-wrap" style={{ maxHeight: 320, overflowY: 'auto' }}><table className="table">
                    <thead><tr><th>المريض</th><th>الجوال</th><th>جلسات قادمة</th><th>كشف قادم</th><th>أقرب موعد</th><th>المتبقي عليه</th></tr></thead>
                    <tbody>{recipients.map((p) => { const u = upcomingOf(p.id); return (
                      <tr key={p.id}>
                        <td style={{ fontWeight: 600, whiteSpace: 'nowrap' }}>{p.fullName}</td>
                        <td className="num" dir="ltr" style={{ textAlign: 'right', whiteSpace: 'nowrap' }}>{p.phone}</td>
                        <td className="num">{u.sessions.length || '—'}</td>
                        <td className="num">{u.exams.length || '—'}</td>
                        <td className="num" style={{ whiteSpace: 'nowrap' }}>{u.next ? `${fmtDate(u.next.date)} ${fmtTime(u.next.time)}` : '—'}</td>
                        <td className="num" style={{ whiteSpace: 'nowrap', fontWeight: 600 }}>{u.due > 0 ? money(u.due) : 'لا يوجد'}</td>
                      </tr>); })}</tbody>
                  </table></div>
                )}
                {recipients.length > 0 && <p className="muted-sm" style={{ marginTop: 6 }}>إجمالي المتبقي عليهم: <strong className="num">{money(recipients.reduce((s, p) => s + upcomingOf(p.id).due, 0))}</strong></p>}
              </div>
            )}

            <div className="cm-preview">
              <div className="cm-preview__label"><Icon name="eye" size={14} /> معاينة كما يراها المريض</div>
              <div className="cm-preview__card">
                <span className="nt-ic nt-ic--brand"><Icon name="bell" size={18} /></span>
                <div>
                  <strong>{title || 'عنوان الإشعار'}</strong>
                  <p>{fullBody || 'نص الإشعار سيظهر هنا…'}</p>
                </div>
              </div>
            </div>

            <div className="row-between" style={{ marginTop: 14, flexWrap: 'wrap' }}>
              <span className="muted" style={{ fontSize: 13 }}>سيُرسل إلى <strong className="num">{recipients.length}</strong> مريض</span>
              {can('campaigns', 'create') && <Button icon="bell" onClick={send} loading={sending}>إرسال الإشعار</Button>}
            </div>
          </div>
        </section>

        <section className="card">
          <div className="card__head"><h2>سجل الإشعارات المرسلة</h2></div>
          <div className="card__body">
            {campaigns.length === 0 ? <EmptyState icon="bell" title="لم تُرسل إشعارات بعد" /> : (
              <div className="cm-history">
                {campaigns.map((c) => {
                  const dc = c.discountCodeId ? db.discountCodes().find((x) => x.id === c.discountCodeId) : undefined;
                  return (
                    <article key={c.id} className="cm-item">
                      <div className="row-between">
                        <strong>{c.title}</strong>
                        <span className="muted num date" style={{ fontSize: 12 }}>{fmtDateTime(c.createdAt)}</span>
                      </div>
                      <p>{c.body}</p>
                      <div className="cm-item__meta">
                        <span className="svc-card__cat">{AUDIENCE_LABEL[c.audience]}{c.source ? ` · ${REFERRAL_SOURCE_LABEL[c.source]}` : ''}</span>
                        {dc && <span className="dx-code">{dc.code}</span>}
                        <span className="muted">وصل لـ <strong className="num">{c.delivered}</strong> حساب من <span className="num">{c.recipients}</span> مريض</span>
                      </div>
                    </article>
                  );
                })}
              </div>
            )}
            {campaigns.length > 0 && <p className="muted" style={{ fontSize: 12, marginTop: 10 }}>آخر إشعار: {fmtDate(tsToYmd(campaigns[0].createdAt))}</p>}
          </div>
        </section>
      </div>
    </div>
  );
}
