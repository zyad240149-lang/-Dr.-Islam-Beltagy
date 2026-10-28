// «تشخيص المريض»: اختار المريض ← زرار واحد «تشخيص» يفتح نموذج الكشف والتشخيص.
// من غير مريض مختار: تبويبين — «مرضى بانتظار التشخيص» (زيارات النهارده اللي اتعملها حضور ولسه تشخيصها ما اكتملش)
// و«المرضى اللي اتشخصوا» (بحث بالاسم أو جزء منه أو الموبايل أو رقم الملف). مريض مختار ← ملف تشخيصاته كله + تشخيص جديد.
import { useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { isIncomplete, ortho, useOrthoVersion, type Consultation } from './data';
import { LoadState, PageHead, PatientSelect, SearchBox, patientFile, patientName, useClinicalCan } from './kit';
import { ConsultModal, DraftCard, clearConsultDraft, listConsultDrafts } from './Consultations';
import { DiagnosisTab } from './DiagnosisTab';
import { todaysVisits } from './visits';
import { Button, EmptyState, Modal } from '../components/ui';
import { db } from '../data/db';
import { useDbVersion } from '../hooks/useDb';
import { APPT_STATUS, fmtDate, fmtTime, todayYmd } from '../utils/format';
import { patientMatches } from '../utils/phoneUtils';

export default function Diagnosis() {
  useOrthoVersion();
  useDbVersion();
  const perm = useClinicalCan();
  const [params, setParams] = useSearchParams();
  const patientId = params.get('patient') ?? '';
  const view = params.get('tab') === 'done' ? 'done' : 'waiting';
  const [edit, setEdit] = useState<Consultation | 'new' | null>(null);
  const [resume, setResume] = useState(false);
  const [newVisit, setNewVisit] = useState<string | null>(null); // الزيارة اللي التشخيص الجديد بيتربط بيها (من قايمة الانتظار)
  const [fromQueue, setFromQueue] = useState(false); // اتفتح من «بانتظار التشخيص» ← بعد القفل يرجع للقايمة على المريض اللي بعده
  const [q, setQ] = useState('');
  const [picker, setPicker] = useState<string | null>(null); // نافذة «تشخيص مريض» (مريض مش في قايمة الانتظار) — القيمة = المريض المختار
  const [, setDraftsVersion] = useState(0);
  const pick = (id: string) => setParams(id ? { patient: id } : view === 'done' ? { tab: 'done' } : {}, { replace: true });
  const setView = (v: 'waiting' | 'done') => setParams(v === 'done' ? { tab: 'done' } : {}, { replace: true });
  // تشخيصات بدأت ولسه ما اتحفظتش (على الجهاز ده) — بنعيد قرايتها كل ما النافذة تتقفل عشان القايمة تفضل مظبوطة
  const drafts = !edit ? listConsultDrafts() : [];
  const draft = patientId ? drafts.find((d) => d.patientId === patientId) ?? null : null;
  const consults = ortho.list('consultations');
  // تشخيصات اتحفظت ناقصة («يحتاج استكمال») — من أي جهاز، الأحدث أولًا
  const incomplete = consults.filter(isIncomplete).sort((a, b) => b.date.localeCompare(a.date));
  const openSaved = (c: Consultation, queue = false) => { setParams({ patient: c.patientId }, { replace: true }); setResume(false); setNewVisit(null); setFromQueue(queue); setEdit(c); };
  const resumeDraft = (id: string, queue = false) => { setParams({ patient: id }, { replace: true }); setResume(true); setNewVisit(null); setFromQueue(queue); setEdit('new'); };
  const startNew = (id: string, appointmentId: string | null) => { setParams({ patient: id }, { replace: true }); setResume(false); setNewVisit(appointmentId); setFromQueue(true); setEdit('new'); };
  // من «تشخيص مريض»: لو ليه تشخيص لم يكتمل بيتكمّل (مفيش حاجة تضيع)، وإلا تشخيص جديد — وبعد القفل يفضل على ملفه
  const startPicked = (id: string) => {
    setPicker(null);
    setParams({ patient: id }, { replace: true }); setNewVisit(null); setFromQueue(false);
    setResume(drafts.some((d) => d.patientId === id)); setEdit('new');
  };
  const closeModal = () => { setEdit(null); setResume(false); setNewVisit(null); if (fromQueue) setParams({}, { replace: true }); setFromQueue(false); };
  const discardDraft = (id: string) => {
    if (!window.confirm(`حذف التشخيص اللي لم يكتمل لـ ${patientName(id)}؟ كل اللي اتكتب فيه هيتمسح.`)) return;
    clearConsultDraft(id);
    setDraftsVersion((v) => v + 1);
  };

  // ---------- بانتظار التشخيص: حضور النهارده + حالة تشخيص الزيارة ----------
  const visits = todaysVisits();
  const pending = visits.filter((x) => x.state !== 'done');
  const doneToday = visits.length - pending.length;
  const shownInQueue = new Set(pending.map((x) => x.a.patientId));
  const otherDrafts = drafts.filter((d) => !shownInQueue.has(d.patientId));
  const otherIncomplete = incomplete.filter((c) => !pending.some((x) => x.consult?.id === c.id));

  // ---------- المرضى اللي اتشخصوا: مريض واحد لكل صف، آخر تشخيص أولًا ----------
  const diagnosed = (() => {
    const by = new Map<string, { last: Consultation; count: number; incomplete: number }>();
    for (const c of consults) {
      const cur = by.get(c.patientId);
      if (!cur) by.set(c.patientId, { last: c, count: 1, incomplete: isIncomplete(c) ? 1 : 0 });
      else { cur.count++; if (isIncomplete(c)) cur.incomplete++; if (c.date > cur.last.date) cur.last = c; }
    }
    return [...by.entries()].map(([id, x]) => ({ id, ...x, p: db.patient(id) })).sort((a, b) => b.last.date.localeCompare(a.last.date));
  })();
  const term = q.trim();
  const found = term ? diagnosed.filter((x) => patientMatches(x.p ?? { fullName: patientName(x.id) }, term)) : diagnosed.slice(0, 50);

  const selected = patientId ? db.patient(patientId) : undefined;

  return (
    <div className="page">
      <PageHead title="تشخيص المريض" sub="المرضى اللي حضروا ومستنيين التشخيص — والبحث في كل المرضى اللي اتشخصوا.">
        {perm.add && !patientId && <Button icon="stethoscope" onClick={() => setPicker('')}>تشخيص مريض</Button>}
      </PageHead>

      {patientId && (
        <section className="card dx-patbar">
          <Button variant="outline" size="sm" icon="chevron" onClick={() => pick('')}>رجوع</Button>
          <div className="dx-patbar__who">
            <b>{selected?.fullName ?? patientName(patientId)}</b>
            <small>ملف <span className="num">{patientFile(patientId)}</span>{selected?.phone && <> · <bdi dir="ltr" className="num">{selected.phone}</bdi></>}</small>
          </div>
          <div className="dx-patbar__act">
            <Link to={`/patients/${patientId}`} className="btn btn--outline btn--sm">ملف المريض</Link>
            {perm.add && draft && <Button size="sm" icon="refresh" variant="outline" onClick={() => resumeDraft(patientId)}>استكمال التشخيص</Button>}
            {perm.add && <Button size="sm" icon="stethoscope" onClick={() => {
              if (draft && !window.confirm('فيه تشخيص لم يكتمل للمريض ده — بدء تشخيص جديد هيستبدله. تكمل؟')) return;
              setResume(false); setNewVisit(null); setFromQueue(false); setEdit('new');
            }}>{draft ? 'تشخيص جديد' : 'تشخيص'}</Button>}
          </div>
        </section>
      )}

      {!patientId && (
        <div className="seg dx-views" role="tablist" aria-label="أقسام التشخيص">
          <button type="button" role="tab" aria-selected={view === 'waiting'} className={`seg__btn ${view === 'waiting' ? 'active' : ''}`} onClick={() => setView('waiting')}>
            مرضى بانتظار التشخيص {pending.length > 0 && <span className="badge badge--warn num">{pending.length}</span>}
          </button>
          <button type="button" role="tab" aria-selected={view === 'done'} className={`seg__btn ${view === 'done' ? 'active' : ''}`} onClick={() => setView('done')}>
            المرضى اللي اتشخصوا {diagnosed.length > 0 && <span className="badge badge--brand num">{diagnosed.length}</span>}
          </button>
        </div>
      )}

      {!patientId && view === 'waiting' && (
        <>
          <section className="card" style={{ marginBottom: 16 }}>
            <div className="card__head">
              <h2>حضور النهارده <span className="muted dx-date">{fmtDate(todayYmd())}</span></h2>
              {doneToday > 0 && <span className="badge badge--ok">اتشخص النهارده <span className="num">{doneToday}</span></span>}
            </div>
            <div className="card__body">
              <LoadState kind="consultations">
                {pending.length === 0
                  ? (visits.length === 0
                    ? <EmptyState icon="calendarPlus" title="ما فيه مرضى اتعملهم حضور النهارده" text="أول ما الاستقبال يعمل حضور لمريض، هيظهر هنا عشان يتشخّص." />
                    : <EmptyState icon="checkCircle" title="كل المرضى اللي حضروا النهارده اتشخصوا ✓" text="تشخيصاتهم في «المرضى اللي اتشخصوا»." />)
                  : (
                    <div className="dx-queue">
                      {pending.map(({ a, consult, state }) => {
                        const p = db.patient(a.patientId);
                        const local = drafts.find((d) => d.patientId === a.patientId && (!d.appointmentId || d.appointmentId === a.id));
                        const doctor = db.therapist(a.therapistId)?.name;
                        return (
                          <div className="dx-queue__row" key={a.id}>
                            <span className="dx-queue__time num">{fmtTime(a.time)}</span>
                            <div className="dx-queue__who">
                              <b>{patientName(a.patientId)}</b>
                              <small>
                                {p?.phone && <><bdi dir="ltr" className="num">{p.phone}</bdi> · </>}ملف <span className="num">{patientFile(a.patientId)}</span>
                                {' '}· زيارة <span className="num">{a.no}</span> · {db.service(a.serviceId)?.name ?? '—'}{doctor ? ` · ${doctor}` : ''}
                              </small>
                            </div>
                            {state === 'incomplete' ? <span className="badge badge--warn">يحتاج استكمال</span>
                              : local ? <span className="badge badge--warn">لم يكتمل</span>
                              : <span className={`badge badge--${APPT_STATUS[a.status].tone}`}>{APPT_STATUS[a.status].label}</span>}
                            <div className="dx-queue__act">
                              {!perm.add ? null
                                : state === 'incomplete' && consult ? <Button size="sm" icon="refresh" onClick={() => openSaved(consult, true)}>استكمال</Button>
                                : local ? <Button size="sm" icon="refresh" onClick={() => resumeDraft(a.patientId, true)}>استكمال</Button>
                                : <Button size="sm" icon="stethoscope" onClick={() => startNew(a.patientId, a.id)}>تشخيص</Button>}
                            </div>
                          </div>
                        );
                      })}
                    </div>
                  )}
              </LoadState>
            </div>
          </section>
          {perm.add && otherDrafts.length + otherIncomplete.length > 0 && (
            <section className="card" style={{ marginBottom: 16 }}>
              <div className="card__head"><h2>تشخيصات لم تكتمل ({otherDrafts.length + otherIncomplete.length})</h2></div>
              <div className="card__body">
                {otherDrafts.map((d) => <DraftCard key={d.patientId} d={d} onResume={() => resumeDraft(d.patientId, true)} onDiscard={() => discardDraft(d.patientId)} />)}
                {otherIncomplete.map((c) => <DraftCard key={c.id} d={c} onResume={() => openSaved(c, true)} />)}
              </div>
            </section>
          )}
        </>
      )}

      {!patientId && view === 'done' && (
        <section className="card">
          <div className="filter-bar"><div className="field"><SearchBox value={q} onChange={setQ} placeholder="ابحث باسم المريض (أو جزء منه) أو رقم الموبايل أو رقم الملف" /></div></div>
          <div className="card__body">
            <LoadState kind="consultations">
              {diagnosed.length === 0 ? <EmptyState icon="stethoscope" title="لا يوجد مرضى متشخّصون بعد" />
                : found.length === 0 ? <EmptyState icon="search" title="مفيش مريض متشخّص بالاسم أو الرقم ده" text="جرّب جزء تاني من الاسم أو الرقم من غير مسافات." />
                : (
                  <div className="dx-queue">
                    {found.map((x) => (
                      <button type="button" className="dx-queue__row dx-pat" key={x.id} onClick={() => pick(x.id)}>
                        <span className="dx-queue__time num">{fmtDate(x.last.date)}</span>
                        <div className="dx-queue__who">
                          <b>{x.p?.fullName ?? patientName(x.id)}</b>
                          <small>
                            {x.p?.phone && <><bdi dir="ltr" className="num">{x.p.phone}</bdi> · </>}ملف <span className="num">{patientFile(x.id)}</span> · <span className="num">{x.count}</span> {x.count > 1 ? 'تشخيصات' : 'تشخيص'}
                            {' '}· آخر تشخيص: <bdi>{x.last.diagnosis || 'لسه ما اتحددش'}</bdi>
                          </small>
                        </div>
                        {x.incomplete > 0 ? <span className="badge badge--warn">فيه تشخيص يحتاج استكمال</span> : <span />}
                        <span className="dx-queue__act"><span className="btn btn--outline btn--sm">فتح ملف التشخيص</span></span>
                      </button>
                    ))}
                    {!term && diagnosed.length > found.length && <p className="muted" style={{ margin: 0 }}>ظاهر آخر {found.length} مريض — اكتب في البحث عشان توصل لأي مريض تاني.</p>}
                  </div>
                )}
            </LoadState>
          </div>
        </section>
      )}

      {patientId && (
        <section className="card">
          <div className="card__head"><h2>ملف تشخيصات المريض</h2></div>
          <div className="card__body">
            {perm.add && draft && <div style={{ marginBottom: 12 }}><DraftCard d={draft} onResume={() => resumeDraft(patientId)} onDiscard={() => discardDraft(patientId)} /></div>}
            <DiagnosisTab patientId={patientId} embedded />
          </div>
        </section>
      )}
      {picker !== null && (
        <Modal title="تشخيص مريض" onClose={() => setPicker(null)} footer={<>
          <Button variant="outline" onClick={() => setPicker(null)}>إلغاء</Button>
          <Button icon="stethoscope" disabled={!picker} onClick={() => picker && startPicked(picker)}>ابدأ التشخيص</Button>
        </>}>
          <div className="field" style={{ marginBottom: 0 }}>
            <label>المريض</label>
            <PatientSelect value={picker} onChange={setPicker} />
          </div>
          <p className="muted" style={{ marginBottom: 0 }}>للمريض اللي مش في قايمة الانتظار (ما اتعملوش حضور). لو اتعمله حضور النهارده، التشخيص بيتربط بزيارته لوحده.</p>
        </Modal>
      )}
      {/* «تشخيص» بيفتح الشيت على طول: شيت التمريض (وفيه خريطة الجسم لمكان الألم) ← كشف الطبيب ← الروشتة */}
      {edit && patientId && <ConsultModal patientId={patientId} appointmentId={edit === 'new' ? newVisit : undefined} initial={edit === 'new' ? undefined : edit} resume={edit === 'new' && resume} onClose={closeModal} />}
    </div>
  );
}
