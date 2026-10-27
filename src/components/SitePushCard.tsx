// إرسال إشعار (Web Push) لكل الأجهزة اللي ثبّتت تطبيق الموقع العام ووافقت على الإشعارات — حتى الزوار من غير حساب.
// الإرسال من Edge Function "push" (site_visitors=true) بمفتاح VAPID الخاص على السيرفر.
import { useEffect, useState } from 'react';
import { supabase } from '../lib/supabase';
import { Button, Input } from './ui';
import { useToast } from '../hooks/useToast';

export function SitePushCard() {
  const toast = useToast();
  const [count, setCount] = useState<number | null>(null);
  const [title, setTitle] = useState('');
  const [body, setBody] = useState('');
  const [busy, setBusy] = useState(false);
  useEffect(() => { void supabase.rpc('site_push_count').then(({ data }) => setCount(typeof data === 'number' ? data : 0)); }, []);

  const send = async () => {
    if (!title.trim()) { toast.error('اكتب عنوان الإشعار'); return; }
    setBusy(true);
    const { data, error } = await supabase.functions.invoke('push/send', { body: { site_visitors: true, title: title.trim(), body: body.trim(), url: '/' } });
    setBusy(false);
    if (error || data?.error) { toast.error(data?.error ?? 'تعذّر الإرسال'); return; }
    toast.success(`أُرسل إلى ${data.sent} جهاز${data.removed ? ` (وحُذف ${data.removed} اشتراك منتهٍ)` : ''}.`);
    setTitle(''); setBody('');
    if (data.removed) setCount((c) => Math.max(0, (c ?? 0) - data.removed));
  };

  return (
    <div className="card" style={{ padding: 16, marginBottom: 16 }}>
      <div className="row-between" style={{ marginBottom: 10 }}>
        <strong>إشعار على الجوال لكل من ثبّت تطبيق الموقع</strong>
        <span className="muted num">{count === null ? '…' : `${count} جهاز مشترك`}</span>
      </div>
      <p className="muted" style={{ marginTop: 0, fontSize: 13 }}>يصل كإشعار على شاشة الجهاز حتى لو كان التطبيق مغلقًا — لكل زائر ثبّت التطبيق من الموقع ووافق على الإشعارات.</p>
      <div className="grid-form">
        <Input id="sp-title" label="العنوان" value={title} maxLength={120} onChange={(e) => setTitle(e.target.value)} />
        <Input id="sp-body" label="النص" value={body} maxLength={400} onChange={(e) => setBody(e.target.value)} />
      </div>
      <div style={{ marginTop: 10 }}><Button onClick={send} loading={busy} disabled={!count}>إرسال الإشعار</Button></div>
    </div>
  );
}
