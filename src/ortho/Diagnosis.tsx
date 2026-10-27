// «تشخيص المريض»: اختار المريض ← زرار واحد «تشخيص» يفتح نموذج الكشف والتشخيص، وتحته التشخيصات السابقة
import { useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { ortho, useOrthoVersion, type Consultation } from './data';
import { LoadState, PageHead, PatientSelect, patientFile, patientName, useClinicalCan } from './kit';
import { ConsultList, ConsultModal, DraftCard, clearConsultDraft, listConsultDrafts } from './Consultations';
import { EmptyState } from '../components/ui';
import { Button } from '../components/ui';
import { db } from '../data/db';
import { useDbVersion } from '../hooks/useDb';
import { APPT_STATUS, fmtTime, todayYmd } from '../utils/format';
import type { Appointment } from '../types';

export default function Diagnosis() {
  useOrthoVersion();
  useDbVersion();
  const perm = useClinicalCan();
  const [params, setParams] = useSearchParams();
  const patientId = params.get('patient') ?? '';
  const [edit, setEdit] = useState<Consultation | 'new' | null>(null);
  const [resume, setResume] = useState(false);
  const [, setDraftsVersion] = useState(0);
  const pick = (id: string) => setParams(id ? { patient: id } : {}, { replace: true });
  // تشخيصات بدأت ولسه ما اتحفظتش (على الجهاز ده) — بنعيد قرايتها كل ما النافذة تتقفل عشان القايمة تفضل مظبوطة
  const drafts = !edit ? listConsultDrafts() : [];
  const draft = patientId ? drafts.find((d) => d.patientId === patientId) ?? null : null;
  const resumeDraft = (id: string) => { pick(id); setResume(true); setEdit('new'); };
  const discardDraft = (id: string) => {
    if (!window.confirm(`حذف التشخيص اللي لم يكتمل لـ ${patientName(id)}؟ كل اللي اتكتب فيه هيتمسح.`)) return;
    clearConsultDraft(id);
    setDraftsVersion((v) => v + 1);
  };
  // آخر تشخيص لكل مريض (مش كل الكشوفات — عشان المريض الواحد يظهر مرة واحدة)، الأحدث أولًا
  const recentDiagnosed = (() => {
    const seen = new Set<string>();
    const out: Consultation[] = [];
    for (const c of ortho.list('consultations').sort((a, b) => b.date.localeCompare(a.date))) {
      if (seen.has(c.patientId)) continue;
      seen.add(c.patientId);
      out.push(c);
      if (out.length >= 30) break;
    }
    return out;
  })();
  // مرضى اتعمللهم حضور النهارده (لأي خدمة، حتى لو الزيارة خلصت) — واحد لكل مريض: اللي لسه ما اتشخصش أولًا، وبعدين بالميعاد
  const today = todayYmd();
  const diagnosedToday = new Set(ortho.list('consultations').filter((c) => c.date === today).map((c) => c.patientId));
  const presentToday = (() => {
    const seen = new Set<string>();
    const out: Appointment[] = [];
    for (const a of db.todayAppointments().filter((x) => x.status === 'arrived' || x.status === 'in_progress' || x.status === 'completed').sort((x, y) => x.time.localeCompare(y.time))) {
      if (seen.has(a.patientId)) continue;
      seen.add(a.patientId);
      out.push(a);
    }
    return out.sort((x, y) => Number(diagnosedToday.has(x.patientId)) - Number(diagnosedToday.has(y.patientId)));
  })();
  const waiting = presentToday.filter((a) => !diagnosedToday.has(a.patientId)).length;
  const startNew = (id: string) => { pick(id); setResume(false); setEdit('new'); };

  return (
    <div className="page">
      <PageHead title="تشخيص المريض" sub="اختار المريض واضغط «تشخيص»." />
      <section className="card" style={{ marginBottom: 16 }}>
        <div className="card__body" style={{ display: 'flex', gap: 12, alignItems: 'flex-end', flexWrap: 'wrap' }}>
          <div className="field" style={{ flex: '1 1 320px', marginBottom: 0 }}>
            <label>المريض</label>
            <PatientSelect value={patientId} onChange={pick} />
          </div>
          {patientId && <span className="badge badge--brand">ملف {patientFile(patientId)}</span>}
          {perm.add && draft && <Button icon="refresh" variant="outline" onClick={() => resumeDraft(patientId)}>استكمال التشخيص</Button>}
          {perm.add && <Button icon="stethoscope" disabled={!patientId} onClick={() => {
            if (draft && !window.confirm('فيه تشخيص لم يكتمل للمريض ده — بدء تشخيص جديد هيستبدله. تكمل؟')) return;
            setResume(false); setEdit('new');
          }}>{draft ? 'تشخيص جديد' : 'تشخيص'}</Button>}
        </div>
      </section>
      {!patientId && perm.add && drafts.length > 0 && (
        <section className="card" style={{ marginBottom: 16 }}>
          <div className="card__head"><h2>تشخيصات لم تكتمل ({drafts.length})</h2></div>
          <div className="card__body">
            {drafts.map((d) => <DraftCard key={d.patientId} d={d} showPatient onResume={() => resumeDraft(d.patientId)} onDiscard={() => discardDraft(d.patientId)} />)}
          </div>
        </section>
      )}
      {!patientId && (
        <section className="card" style={{ marginBottom: 16 }}>
          <div className="card__head">
            <h2>مرضى اتعملهم حضور — للتشخيص</h2>
            {presentToday.length > 0 && <span className={`badge ${waiting ? 'badge--warn' : 'badge--ok'}`}>{waiting ? <><span className="num">{waiting}</span> مستني التشخيص</> : 'كلهم اتشخصوا ✓'}</span>}
          </div>
          <div className="card__body">
            {presentToday.length === 0
              ? <EmptyState icon="calendarPlus" title="ما فيه مرضى اتعملهم حضور النهارده" text="أول ما الاستقبال يعمل حضور لمريض، هيظهر هنا عشان يتشخّص." />
              : (
                <div className="dx-queue">
                  {presentToday.map((a) => {
                    const done = diagnosedToday.has(a.patientId);
                    const started = drafts.some((d) => d.patientId === a.patientId);
                    return (
                      <div className={`dx-queue__row${done ? ' is-done' : ''}`} key={a.patientId}>
                        <span className="dx-queue__time num">{fmtTime(a.time)}</span>
                        <div className="dx-queue__who">
                          <b>{patientName(a.patientId)}</b>
                          <small>ملف <span className="num">{patientFile(a.patientId)}</span> · {db.service(a.serviceId)?.name ?? '—'}</small>
                        </div>
                        {done ? <span className="badge badge--ok">اتشخص ✓</span>
                          : started ? <span className="badge badge--warn">لم يكتمل</span>
                          : <span className={`badge badge--${APPT_STATUS[a.status].tone}`}>{APPT_STATUS[a.status].label}</span>}
                        <div className="dx-queue__act">
                          {done ? <Button size="sm" variant="outline" onClick={() => pick(a.patientId)}>عرض التشخيص</Button>
                            : !perm.add ? null
                            : started ? <Button size="sm" icon="refresh" onClick={() => resumeDraft(a.patientId)}>استكمال</Button>
                            : <Button size="sm" icon="stethoscope" onClick={() => startNew(a.patientId)}>تشخيص</Button>}
                        </div>
                      </div>
                    );
                  })}
                </div>
              )}
          </div>
        </section>
      )}
      {patientId ? (
        <section className="card">
          <div className="card__head"><h2>التشخيصات السابقة</h2></div>
          <div className="card__body">
            {perm.add && draft && <DraftCard d={draft} onResume={() => resumeDraft(patientId)} onDiscard={() => discardDraft(patientId)} />}
            <LoadState kind="consultations">
              {(() => {
                const items = ortho.list('consultations', patientId).sort((a, b) => b.date.localeCompare(a.date));
                // التشخيص اللي لم يكتمل ظاهر فوق — من غير «لا توجد كشوفات» تحته
                return items.length || !(perm.add && draft) ? <div style={draft && perm.add ? { marginTop: 12 } : undefined}><ConsultList hidePatient items={items} onEdit={(c) => setEdit(c)} /></div> : null;
              })()}
            </LoadState>
          </div>
        </section>
      ) : (
        <section className="card">
          <div className="card__head"><h2>المرضى اللي اتشخصوا</h2></div>
          <div className="card__body">
            <LoadState kind="consultations">
              {recentDiagnosed.length === 0
                ? <EmptyState icon="stethoscope" title="لا يوجد مرضى متشخّصون بعد" />
                : <ConsultList items={recentDiagnosed} onEdit={(c) => { pick(c.patientId); setEdit(c); }} />}
            </LoadState>
          </div>
        </section>
      )}
      {/* «تشخيص» بيفتح الشيت على طول: شيت التمريض (وفيه خريطة الجسم لمكان الألم) ← كشف الطبيب ← الروشتة */}
      {edit && patientId && <ConsultModal patientId={patientId} initial={edit === 'new' ? undefined : edit} resume={edit === 'new' && resume} onClose={() => { setEdit(null); setResume(false); }} />}
    </div>
  );
}
