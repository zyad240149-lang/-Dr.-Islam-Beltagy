// «تشخيص المريض»: اختار المريض ← زرار واحد «تشخيص» يفتح نموذج الكشف والتشخيص.
// من غير مريض مختار: تبويبين — «مرضى بانتظار التشخيص» (زيارات النهارده اللي اتعملها حضور ولسه تشخيصها ما اكتملش)
// و«متابعة المرضى» (حضور النهارده لمرضى اتشخصوا قبل كده + بحث في كل المرضى اللي اتشخصوا ← شيت متابعة التمريض) و«المرضى اللي اتشخصوا» (بحث بالاسم أو جزء منه أو الموبايل أو رقم الملف). مريض مختار ← ملف تشخيصاته كله + تشخيص جديد.
import { useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { isIncomplete, ortho, useOrthoVersion, type Consultation, type Injection, type Nursing } from './data';
import { InjectionList, InjectionModal } from './Injections';
import { LoadState, PageHead, PatientSelect, SearchBox, patientFile, patientName, useClinicalCan } from './kit';
import { ConsultModal, DraftCard, clearConsultDraft, listConsultDrafts } from './Consultations';
import { DiagnosisTab } from './DiagnosisTab';
import { todaysFollowUps, todaysVisits } from './visits';
import { NursingModal, printNursing } from './Nursing';
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
  // «سجل الحقن»: تبويب واحد جنب «متابعة المرضى» — لكل المرضى، ببحث وزرار سجل جديد
  type View = 'waiting' | 'follow' | 'inj' | 'done';
  const VIEWS: View[] = ['waiting', 'follow', 'inj', 'done'];
  const view: View = VIEWS.includes(params.get('tab') as View) ? params.get('tab') as View : 'waiting';
  const [rq, setRq] = useState(''); // بحث في الأشعة / التحاليل / الحقن
  const [newRec, setNewRec] = useState<{ patientId: string; open: boolean } | null>(null);
  const [editInj, setEditInj] = useState<Injection | null>(null);
  const [sheet, setSheet] = useState<{ patientId: string; appointmentId: string | null; initial?: Nursing } | null>(null);
  const [edit, setEdit] = useState<Consultation | 'new' | null>(null);
  const [resume, setResume] = useState(false);
  const [newVisit, setNewVisit] = useState<string | null>(null); // الزيارة اللي التشخيص الجديد بيتربط بيها (من قايمة الانتظار)
  const [fromQueue, setFromQueue] = useState(false); // اتفتح من «بانتظار التشخيص» ← بعد القفل يرجع للقايمة على المريض اللي بعده
  const [q, setQ] = useState('');
  const [picker, setPicker] = useState<string | null>(null); // نافذة «تشخيص مريض» (مريض مش في قايمة الانتظار) — القيمة = المريض المختار
  const [, setDraftsVersion] = useState(0);
  const pick = (id: string) => setParams(id ? { patient: id } : view !== 'waiting' ? { tab: view } : {}, { replace: true });
  const setView = (v: View) => setParams(v !== 'waiting' ? { tab: v } : {}, { replace: true });
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
  // ---------- متابعة المرضى: حضور النهارده لمرضى اتشخصوا + الشيت العام بتاع الزيارة ----------
  const followUps = todaysFollowUps();
  const nursing = ortho.list('nursing');
  const sheetOf = (appointmentId: string) => nursing.find((n) => n.appointmentId === appointmentId);
  const followLeft = followUps.filter((a) => !sheetOf(a.id)).length;
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
  // «متابعة المرضى»: كل المرضى اللي اتشخصوا متاحين لشيت المتابعة (مش بس اللي اتعملهم حضور النهارده) — بحث مستقل عن تبويب «اتشخصوا»
  const [fq, setFq] = useState('');
  const fterm = fq.trim();
  const followFound = fterm ? diagnosed.filter((x) => patientMatches(x.p ?? { fullName: patientName(x.id) }, fterm)) : diagnosed;
  const sheetsOf = (id: string) => nursing.filter((n) => n.patientId === id).sort((a, b) => b.date.localeCompare(a.date));
  const lastSheet = (id: string) => sheetsOf(id)[0];
  // اتشخصوا ولسه ما اتعملهمش ولا متابعة ← «محتاجين متابعة»؛ اللي ليهم متابعة (واحدة أو أكتر) ← «مرضى المتابعة» (آخر متابعة أولًا)
  const needFollow = followFound.filter((x) => !lastSheet(x.id));
  const followed = followFound.filter((x) => lastSheet(x.id)).sort((a, b) => lastSheet(b.id)!.date.localeCompare(lastSheet(a.id)!.date));
  const followTodayShown = fterm ? followUps.filter((a) => patientMatches(db.patient(a.patientId) ?? { fullName: patientName(a.patientId) }, fterm)) : followUps;
  const LIMIT = 50;
  // لو المريض اتعمله حضور النهارده الشيت بيتربط بزيارته، وإلا شيت متابعة من غير زيارة (رقم الزيارة يتكتب يدوي)
  const openSheet = (id: string) => setSheet({ patientId: id, appointmentId: followUps.find((a) => a.patientId === id)?.id ?? null });

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
        <div className="seg seg--3 dx-views" role="tablist" aria-label="أقسام التشخيص">
          <button type="button" role="tab" aria-selected={view === 'waiting'} className={`seg__btn ${view === 'waiting' ? 'active' : ''}`} onClick={() => setView('waiting')}>
            مرضى بانتظار التشخيص {pending.length > 0 && <span className="badge badge--warn num">{pending.length}</span>}
          </button>
          <button type="button" role="tab" aria-selected={view === 'follow'} className={`seg__btn ${view === 'follow' ? 'active' : ''}`} onClick={() => setView('follow')}>
            متابعة المرضى {followLeft > 0 && <span className="badge badge--warn num">{followLeft}</span>}
          </button>
          <button type="button" role="tab" aria-selected={view === 'inj'} className={`seg__btn ${view === 'inj' ? 'active' : ''}`} onClick={() => setView('inj')}>سجل الحقن</button>
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

      {!patientId && view === 'follow' && (<>
        <section className="card" style={{ marginBottom: 16 }}>
          <div className="filter-bar"><div className="field"><SearchBox value={fq} onChange={setFq} placeholder="ابحث في مرضى المتابعة: الاسم (أو جزء منه) أو رقم الموبايل أو رقم الملف" /></div></div>
        </section>

        {followTodayShown.length > 0 && (
          <section className="card" style={{ marginBottom: 16 }}>
            <div className="card__head"><h2>متابعة النهارده <span className="muted dx-date">{fmtDate(todayYmd())}</span></h2></div>
            <div className="card__body">
              <div className="dx-queue">
                {followTodayShown.map((a) => {
                  const p = db.patient(a.patientId);
                  const done = sheetOf(a.id);
                  return (
                    <div className="dx-queue__row" key={a.id}>
                      <span className="dx-queue__time num">{fmtTime(a.time)}</span>
                      <div className="dx-queue__who">
                        <b>{patientName(a.patientId)}</b>
                        <small>{p?.phone && <><bdi dir="ltr" className="num">{p.phone}</bdi> · </>}ملف <span className="num">{patientFile(a.patientId)}</span> · زيارة <span className="num">{a.no}</span></small>
                      </div>
                      {done ? <span className="badge badge--ok">اتعملت متابعة الزيارة</span> : <span className="badge badge--warn">مستني المتابعة</span>}
                      <div className="dx-queue__act">
                        {done && <Button size="sm" variant="outline" icon="print" onClick={() => printNursing(done)}>طباعة</Button>}
                        {done ? perm.edit && <Button size="sm" variant="outline" icon="edit" onClick={() => setSheet({ patientId: a.patientId, appointmentId: a.id, initial: done })}>تعديل</Button>
                          : perm.add && <Button size="sm" icon="clipboard" onClick={() => setSheet({ patientId: a.patientId, appointmentId: a.id })}>متابعة</Button>}
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>
          </section>
        )}

        <section className="card" style={{ marginBottom: 16 }}>
          <div className="card__head"><h2>محتاجين متابعة {needFollow.length > 0 && <span className="badge badge--warn num">{needFollow.length}</span>}</h2></div>
          <div className="card__body">
            <LoadState kind="nursing">
              {needFollow.length === 0
                ? <EmptyState icon="checkCircle" title={fterm ? 'مفيش مريض محتاج متابعة بالاسم أو الرقم ده' : 'كل المرضى اللي اتشخصوا اتعملهم متابعة ✓'} />
                : (
                  <div className="dx-queue">
                    {needFollow.slice(0, fterm ? undefined : LIMIT).map((x) => (
                      <div className="dx-queue__row" key={x.id}>
                        <span className="dx-queue__time num">{fmtDate(x.last.date)}</span>
                        <div className="dx-queue__who">
                          <b>{x.p?.fullName ?? patientName(x.id)}</b>
                          <small>{x.p?.phone && <><bdi dir="ltr" className="num">{x.p.phone}</bdi> · </>}ملف <span className="num">{patientFile(x.id)}</span> · آخر تشخيص: <bdi>{x.last.diagnosis || 'لسه ما اتحددش'}</bdi></small>
                        </div>
                        <span className="badge badge--warn">ما اتعملوش متابعة</span>
                        <div className="dx-queue__act">
                          {perm.add && <Button size="sm" icon="clipboard" onClick={() => openSheet(x.id)}>متابعة</Button>}
                          <Button size="sm" variant="outline" onClick={() => pick(x.id)}>ملف التشخيص</Button>
                        </div>
                      </div>
                    ))}
                    {!fterm && needFollow.length > LIMIT && <p className="muted" style={{ margin: 0 }}>ظاهر أحدث {LIMIT} — اكتب في البحث فوق عشان توصل لأي مريض تاني.</p>}
                  </div>
                )}
            </LoadState>
          </div>
        </section>

        <section className="card">
          <div className="card__head"><h2>مرضى المتابعة {followed.length > 0 && <span className="badge badge--brand num">{followed.length}</span>}</h2></div>
          <div className="card__body">
            <LoadState kind="nursing">
              {followed.length === 0
                ? <EmptyState icon="clipboard" title={fterm ? 'مفيش مريض متابعة بالاسم أو الرقم ده' : 'لسه مفيش مرضى اتعملهم متابعة'} text={fterm ? undefined : 'أول ما تعمل متابعة لمريض هيظهر هنا، وتقدر تعمله متابعة تانية وتالتة.'} />
                : (
                  <div className="dx-queue">
                    {followed.slice(0, fterm ? undefined : LIMIT).map((x) => {
                      const all = sheetsOf(x.id);
                      return (
                        <div className="dx-queue__row" key={x.id}>
                          <span className="dx-queue__time num">{fmtDate(all[0].date)}</span>
                          <div className="dx-queue__who">
                            <b>{x.p?.fullName ?? patientName(x.id)}</b>
                            <small>{x.p?.phone && <><bdi dir="ltr" className="num">{x.p.phone}</bdi> · </>}ملف <span className="num">{patientFile(x.id)}</span> · آخر تشخيص: <bdi>{x.last.diagnosis || 'لسه ما اتحددش'}</bdi></small>
                          </div>
                          <span className="badge badge--ok"><span className="num">{all.length}</span> {all.length > 1 ? 'متابعات' : 'متابعة'} — آخرها {fmtDate(all[0].date)}</span>
                          <div className="dx-queue__act">
                            <Button size="sm" variant="outline" icon="print" onClick={() => printNursing(all[0])}>طباعة آخر متابعة</Button>
                            {perm.add && <Button size="sm" icon="clipboard" onClick={() => openSheet(x.id)}>متابعة جديدة</Button>}
                            <Button size="sm" variant="outline" onClick={() => pick(x.id)}>الملف</Button>
                          </div>
                        </div>
                      );
                    })}
                    {!fterm && followed.length > LIMIT && <p className="muted" style={{ margin: 0 }}>ظاهر آخر {LIMIT} — اكتب في البحث فوق عشان توصل لأي مريض تاني.</p>}
                  </div>
                )}
            </LoadState>
          </div>
        </section>
      </>)}

      {!patientId && view === 'inj' && (() => {
        const t = rq.trim();
        const injs = ortho.list('injections').filter((n) => !t || patientMatches(db.patient(n.patientId) ?? { fullName: patientName(n.patientId) }, t)).sort((a, b) => b.date.localeCompare(a.date));
        return (
          <section className="card">
            <div className="card__head">
              <h2>سجل الحقن</h2>
              {perm.add && <Button size="sm" icon="plus" onClick={() => setNewRec({ patientId: '', open: false })}>سجل حقن جديد</Button>}
            </div>
            <div className="filter-bar"><div className="field"><SearchBox value={rq} onChange={setRq} placeholder="ابحث باسم المريض (أو جزء منه) أو رقم الموبايل أو رقم الملف" /></div></div>
            <div className="card__body">
              <LoadState kind="injections"><InjectionList items={injs} showPatient onEdit={(n) => setEditInj(n)} /></LoadState>
            </div>
          </section>
        );
      })()}

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
                      <div className="dx-queue__row dx-pat" key={x.id} onClick={() => pick(x.id)}>
                        <span className="dx-queue__time num">{fmtDate(x.last.date)}</span>
                        <div className="dx-queue__who">
                          <b>{x.p?.fullName ?? patientName(x.id)}</b>
                          <small>
                            {x.p?.phone && <><bdi dir="ltr" className="num">{x.p.phone}</bdi> · </>}ملف <span className="num">{patientFile(x.id)}</span> · <span className="num">{x.count}</span> {x.count > 1 ? 'تشخيصات' : 'تشخيص'}
                            {' '}· آخر تشخيص: <bdi>{x.last.diagnosis || 'لسه ما اتحددش'}</bdi>
                          </small>
                        </div>
                        {x.incomplete > 0 ? <span className="badge badge--warn">فيه تشخيص يحتاج استكمال</span> : <span />}
                        <span className="dx-queue__act" onClick={(e) => e.stopPropagation()}>
                          {perm.add && <Button size="sm" icon="stethoscope" onClick={() => startPicked(x.id)}>{drafts.some((d) => d.patientId === x.id) ? 'استكمال التشخيص' : 'تشخيص جديد'}</Button>}
                          {perm.add && <Button size="sm" variant="outline" icon="clipboard" onClick={() => openSheet(x.id)}>متابعة</Button>}
                          <Button size="sm" variant="outline" onClick={() => pick(x.id)}>فتح ملف التشخيص</Button>
                        </span>
                      </div>
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
      {newRec && !newRec.open && (
        <Modal title="سجل حقن جديد" onClose={() => setNewRec(null)} footer={<>
          <Button variant="outline" onClick={() => setNewRec(null)}>إلغاء</Button>
          <Button icon="check" disabled={!newRec.patientId} onClick={() => setNewRec({ ...newRec, open: true })}>متابعة</Button>
        </>}>
          <div className="field" style={{ marginBottom: 0 }}><label>المريض</label><PatientSelect value={newRec.patientId} onChange={(v) => setNewRec({ ...newRec, patientId: v })} /></div>
        </Modal>
      )}
      {newRec?.open && <InjectionModal patientId={newRec.patientId} onClose={() => setNewRec(null)} />}
      {editInj && <InjectionModal patientId={editInj.patientId} initial={editInj} onClose={() => setEditInj(null)} />}
      {sheet && <NursingModal patientId={sheet.patientId} appointmentId={sheet.appointmentId} initial={sheet.initial} onClose={() => setSheet(null)} />}
      {/* «تشخيص» بيفتح الشيت على طول: الشيت العام (وفيه خريطة الجسم لمكان الألم) ← كشف الطبيب ← الروشتة */}
      {edit && patientId && <ConsultModal patientId={patientId} appointmentId={edit === 'new' ? newVisit : undefined} initial={edit === 'new' ? undefined : edit} resume={edit === 'new' && resume} onClose={closeModal} />}
    </div>
  );
}
