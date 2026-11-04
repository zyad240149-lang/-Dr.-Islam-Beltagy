// «مواعيد شغلي»: كل موظف بيظبط أيامه وساعاته وفرع كل يوم لنفسه. الخادم بيعدّل صف صاحب الحساب بس (هجرة 945).
import { useState } from 'react';
import { Button } from '../components/ui';
import { WorkHoursEditor, byDayOrder, cleanHours, hoursError } from '../components/WorkHoursEditor';
import { db } from '../data/db';
import { useToast } from '../hooks/useToast';
import { useAuth } from '../services/auth';
import type { WorkHours } from '../types';

export default function MyWorkHours() {
  const { user } = useAuth();
  const toast = useToast();
  const [hours, setHours] = useState<WorkHours[]>(() => {
    const t = user?.therapistId ? db.therapist(user.therapistId) : undefined;
    const me = db.employees().find((e) => e.id === user?.id) ?? user;
    return [...(t?.workHours?.length ? t.workHours : me?.workHours ?? [])].sort(byDayOrder);
  });
  const [busy, setBusy] = useState(false);
  const save = async () => {
    const err = hoursError(hours);
    if (err) { toast.error(err); return; }
    setBusy(true);
    const r = await db.saveMyWorkHours(cleanHours(hours));
    setBusy(false);
    if (!r.ok) { toast.error(r.error); return; }
    toast.success('تم حفظ مواعيد شغلك.');
  };
  return (
    <div className="page">
      <div className="page-head"><div><h1>مواعيد شغلي</h1><p>اختار أيام شغلك، ومن كام لكام، والفرع في كل يوم.{user?.therapistId ? ' التعديل بيغيّر أوقات الحجز المتاحة عندك.' : ''}</p></div></div>
      <section className="card">
        <div className="card__body">
          <WorkHoursEditor id="my" hours={hours} onChange={setHours} />
          <div style={{ display: 'flex', justifyContent: 'flex-end', marginTop: 16 }}>
            <Button icon="check" loading={busy} onClick={() => void save()}>حفظ</Button>
          </div>
        </div>
      </section>
    </div>
  );
}
