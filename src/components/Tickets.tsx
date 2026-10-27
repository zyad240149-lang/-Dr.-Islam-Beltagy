import { useState } from 'react';
import { db } from '../data/db';
import { useDbVersion } from '../hooks/useDb';
import { useAuth } from '../services/auth';
import { useCan } from './common';
import { Button, EmptyState, Input, Select, StatusBadge } from './ui';
import { useToast } from '../hooks/useToast';
import { fmtDateTime } from '../utils/format';
import type { SupportTicket, TicketPriority, TicketStatus } from '../types';

const PRIORITY: Record<TicketPriority, { label: string; tone: string }> = {
  low: { label: 'منخفضة', tone: 'muted' }, medium: { label: 'متوسطة', tone: 'info' }, high: { label: 'عالية', tone: 'warn' }, urgent: { label: 'عاجلة', tone: 'danger' },
};
const STATUS: Record<TicketStatus, { label: string; tone: string }> = {
  open: { label: 'مفتوحة', tone: 'warn' }, in_progress: { label: 'قيد المعالجة', tone: 'info' }, resolved: { label: 'تم الحل', tone: 'ok' }, closed: { label: 'مغلقة', tone: 'muted' },
};
const CATEGORY: Record<string, string> = { general: 'عام', system: 'مشكلة في النظام', account: 'حساب / صلاحيات', billing: 'فواتير ومدفوعات', request: 'طلب تطوير' };

export function Tickets() {
  useDbVersion();
  const { user } = useAuth();
  const can = useCan();
  const toast = useToast();
  const [f, setF] = useState({ subject: '', description: '', category: 'general', priority: 'medium' as TicketPriority });
  const [busy, setBusy] = useState(false);
  const [filter, setFilter] = useState<TicketStatus | ''>('');
  const [openId, setOpenId] = useState<string | null>(null);
  const [reply, setReply] = useState('');
  const tickets = db.tickets().filter((t) => !filter || t.status === filter);
  const manage = can('support', 'edit');

  const create = async () => {
    setBusy(true);
    const r = await db.createTicket(f);
    setBusy(false);
    if (!r.ok) { toast.error(r.error); return; }
    toast.success('تم إنشاء التذكرة.');
    setF({ subject: '', description: '', category: 'general', priority: 'medium' });
  };
  const send = async (t: SupportTicket) => {
    const r = await db.replyTicket(t.id, reply);
    if (!r.ok) { toast.error(r.error); return; }
    setReply('');
  };
  const setStatus = async (t: SupportTicket, s: TicketStatus) => {
    const r = await db.setTicketStatus(t.id, s);
    if (!r.ok) toast.error(r.error);
  };
  const who = (id: string | null) => db.employeeById(id ?? '')?.name ?? 'موظف';

  return (
    <div className="sp-grid" style={{ marginTop: 16 }}>
      <section className="card">
        <div className="card__head"><h2>تذاكر الدعم الفني</h2>
          <Select id="tk-filter" label="" value={filter} onChange={(e) => setFilter(e.target.value as TicketStatus | '')}
            options={[{ value: '', label: 'كل الحالات' }, ...Object.entries(STATUS).map(([value, s]) => ({ value, label: s.label }))]} />
        </div>
        <div className="card__body">
          {tickets.length === 0 ? <EmptyState icon="clipboard" title="ما فيه تذاكر" text="أنشئ تذكرة جديدة من النموذج." /> : (
            <div className="cm-history">
              {tickets.map((t) => (
                <article key={t.id} className="cm-item">
                  <button type="button" className="btn-plain" onClick={() => setOpenId(openId === t.id ? null : t.id)}>
                    <div className="row-between">
                      <strong>{t.no} — {t.subject}</strong>
                      <span style={{ display: 'flex', gap: 6 }}><StatusBadge label={PRIORITY[t.priority].label} tone={PRIORITY[t.priority].tone} /><StatusBadge label={STATUS[t.status].label} tone={STATUS[t.status].tone} /></span>
                    </div>
                    <div className="muted" style={{ fontSize: 12, marginTop: 4 }}>{CATEGORY[t.category] ?? t.category} · {who(t.createdBy)} · {fmtDateTime(t.createdAt)}</div>
                  </button>
                  {openId === t.id && (
                    <div style={{ marginTop: 10 }}>
                      {t.description && <p>{t.description}</p>}
                      {db.repliesFor(t.id).map((r) => (
                        <div key={r.id} className="cm-preview__card" style={{ marginTop: 8 }}>
                          <div><strong>{who(r.employeeId)}</strong> <span className="muted num" style={{ fontSize: 12 }}>{fmtDateTime(r.createdAt)}</span><p>{r.body}</p></div>
                        </div>
                      ))}
                      {t.status !== 'closed' && (
                        <div style={{ marginTop: 10 }}>
                          <textarea className="input" rows={2} placeholder="اكتب ردًا…" value={reply} onChange={(e) => setReply(e.target.value)} />
                          <div className="row-between" style={{ marginTop: 8, flexWrap: 'wrap', gap: 8 }}>
                            <Button size="sm" icon="check" onClick={() => send(t)}>إرسال الرد</Button>
                            {(manage || t.createdBy === user?.id) && (
                              <span style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
                                {manage && t.status !== 'in_progress' && <Button size="sm" variant="outline" onClick={() => setStatus(t, 'in_progress')}>قيد المعالجة</Button>}
                                {manage && t.status !== 'resolved' && <Button size="sm" variant="outline" onClick={() => setStatus(t, 'resolved')}>تم الحل</Button>}
                                <Button size="sm" variant="ghost" onClick={() => setStatus(t, 'closed')}>إغلاق</Button>
                              </span>
                            )}
                          </div>
                        </div>
                      )}
                    </div>
                  )}
                </article>
              ))}
            </div>
          )}
        </div>
      </section>

      <aside className="card">
        <div className="card__head"><h2>تذكرة جديدة</h2></div>
        <div className="card__body">
          <Input id="tk-subject" label="عنوان المشكلة *" value={f.subject} onChange={(e) => setF({ ...f, subject: e.target.value })} />
          <div className="field">
            <label htmlFor="tk-desc">وصف المشكلة</label>
            <textarea id="tk-desc" className="input" rows={4} value={f.description} onChange={(e) => setF({ ...f, description: e.target.value })} />
          </div>
          <div className="grid-form">
            <Select id="tk-cat" label="النوع" value={f.category} onChange={(e) => setF({ ...f, category: e.target.value })} options={Object.entries(CATEGORY).map(([value, label]) => ({ value, label }))} />
            <Select id="tk-pri" label="الأولوية" value={f.priority} onChange={(e) => setF({ ...f, priority: e.target.value as TicketPriority })} options={Object.entries(PRIORITY).map(([value, p]) => ({ value, label: p.label }))} />
          </div>
          <Button icon="check" onClick={create} loading={busy}>إنشاء التذكرة</Button>
        </div>
      </aside>
    </div>
  );
}
