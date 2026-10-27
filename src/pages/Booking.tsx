import { useState } from 'react';
import BookingWizard from '../components/BookingWizard';
import { EmptyState, Button } from '../components/ui';

export default function Booking() {
  const [open, setOpen] = useState(true);
  return (
    <div className="page">
      <div className="page-head"><div><h1>حجز موعد جديد</h1><p>اختر المريض والخدمة والمعالج والوقت المناسب.</p></div></div>
      {open ? (
        <BookingWizard onClose={() => setOpen(false)} />
      ) : (
        <div className="card"><div className="card__body">
          <EmptyState icon="calendarPlus" title="ابدأ حجزًا جديدًا" action={<Button icon="calendarPlus" onClick={() => setOpen(true)}>حجز موعد</Button>} />
        </div></div>
      )}
    </div>
  );
}
