// «تشخيص المريض»: اختار المريض ← زرار واحد «تشخيص» يفتح نموذج الكشف والتشخيص.
// من غير مريض مختار: تبويبين — «مرضى بانتظار التشخيص» (زيارات النهارده اللي اتعملها حضور ولسه تشخيصها ما اكتملش)
// و«المرضى اللي اتشخصوا» (شيت متابعة التمريض بقى تاب «متابعة المريض» جوّه نموذج التشخيص — بحث بالاسم أو جزء منه أو الموبايل أو رقم الملف). مريض مختار ← ملف تشخيصاته كله + تشخيص جديد.
import { useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { addDays, isIncomplete, isUnlinked, ortho, useOrthoVersion, type Consultation } from './data';
import { LoadState, PageHead, SearchBox, patientFile, patientName, useClinicalCan } from './kit';
import { ConsultModal, DraftCard, LinkBadge, clearConsultDraft, listConsultDrafts } from './Consultations';
import { DiagnosisTab } from './DiagnosisTab';
import { needsDiagnosis, newFilesToday, todaysVisits } from './visits';
import { Button, EmptyState, Modal } from '../components/ui';
import { db } from '../data/db';
import { useDbVersion } from '../hooks/useDb';
import { APPT_STATUS, fmtDate, fmtTime, todayYmd, whatsappNumber } from '../utils/format';
import { normalizeSearch, patientMatches } from '../utils/phoneUtils';
import { ExerciseSendModal, useCanSendExercises } from './ExerciseSend';
import { WhatsappLink } from '../components/WhatsappLink';
import { isTripleName } from './ExamSheet';
import { useOfflineState } from '../offline';

export default function Diagnosis() {
  useOrthoVersion();
  useDbVersion();
  const perm = useClinicalCan('diagnosis');
  const [params, setParams] = useSearchParams();
  const patientId = params.get('patient') ?? '';
  type View = 'waiting' | 'done';
  const view: View = params.get('tab') === 'done' ? 'done' : 'waiting';
  const [followOf, setFollowOf] = useState<Consultation | null>(null); // آخر تشخيص للمريض — بيتفتح على تاب «متابعة المريض»
  const [edit, setEdit] = useState<Consultation | 'new' | null>(null);
  const [resume, setResume] = useState(false);
  const [newVisit, setNewVisit] = useState<string | null>(null); // الزيارة اللي التشخيص الجديد بيتربط بيها (من قايمة الانتظار)
  const [fromQueue, setFromQueue] = useState(false); // اتفتح من «بانتظار التشخيص» ← بعد القفل يرجع للقايمة على المريض اللي بعده
  const [q, setQ] = useState('');
  // فلتر التاريخ في «اتشخصوا» (على تاريخ آخر تشخيص): الكل / النهارده / امبارح / آخر 3 أيام / آخر أسبوع / من يوم لـ يوم
  type Range = 'all' | 'today' | 'yesterday' | '3d' | 'week' | 'custom';
  const [range, setRange] = useState<Range>('all');
  const [from, setFrom] = useState('');
  const [to, setTo] = useState('');
  const [exSend, setExSend] = useState(false);
  const canExSend = useCanSendExercises();
  const [, setDraftsVersion] = useState(0);
  // «فتح ملف تشخيص جديد» بالاسم الثلاثي (المريض مش ظاهر في القايمة — غالبًا النت فاصل والاستقبال لسه ما رفعش ملفه)
  const [newFile, setNewFile] = useState<{ name: string; phone: string } | null>(null);
  const [pendingOpen, setPendingOpen] = useState<{ name: string; phone: string } | null>(null);
  const [unlinkedEdit, setUnlinkedEdit] = useState<Consultation | null>(null);
  const { online } = useOfflineState();
  const pick = (id: string) => setParams(id ? { patient: id } : view !== 'waiting' ? { tab: view } : {});
  const setView = (v: View) => setParams(v !== 'waiting' ? { tab: v } : {}, { replace: true });
  // تشخيصات بدأت ولسه ما اتحفظتش (على الجهاز ده) — بنعيد قرايتها كل ما النافذة تتقفل عشان القايمة تفضل مظبوطة
  const drafts = !edit ? listConsultDrafts() : [];
  const draft = patientId ? drafts.find((d) => d.patientId === patientId) ?? null : null;
  const consults = ortho.list('consultations');
  const openSaved = (c: Consultation, queue = false) => { setParams({ patient: c.patientId }, { replace: true }); setResume(false); setNewVisit(null); setFromQueue(queue); setEdit(c); };
  const resumeDraft = (id: string, queue = false) => { setParams({ patient: id }, { replace: true }); setResume(true); setNewVisit(null); setFromQueue(queue); setEdit('new'); };
  const startNew = (id: string, appointmentId: string | null) => { setParams({ patient: id }, { replace: true }); setResume(false); setNewVisit(appointmentId); setFromQueue(true); setEdit('new'); };
  // تشخيص مريض من القايمة/البحث: لو ليه تشخيص لم يكتمل بيتكمّل (مفيش حاجة تضيع)، وإلا تشخيص جديد — وبعد القفل يفضل على ملفه
  const startPicked = (id: string) => {
    setParams({ patient: id }, { replace: true }); setNewVisit(null); setFromQueue(false);
    setResume(drafts.some((d) => d.patientId === id)); setEdit('new');
  };
  const closeModal = () => { setEdit(null); setResume(false); setNewVisit(null); if (fromQueue) setParams({}, { replace: true }); setFromQueue(false); };
  const discardDraft = (id: string) => {
    if (!window.confirm(`حذف التشخيص اللي لم يكتمل لـ ${patientName(id)}؟ كل اللي اتكتب فيه هيتمسح.`)) return;
    clearConsultDraft(id);
    setDraftsVersion((v) => v + 1);
  };

  // ---------- مرضى النهارده: أي مريض حضر لأي خدمة بيفضل ظاهر لحد ما اليوم يخلص، حتى بعد التشخيص ----------
  const visits = todaysVisits();
  const doneToday = visits.filter((x) => x.state === 'done').length;
  const lastConsultOf = (id: string) => consults.filter((c) => c.patientId === id && !isUnlinked(c)).sort((a, b) => b.date.localeCompare(a.date))[0];
  // المتشخص ← «إضافة شيت»: تشخيص الزيارة نفسها، أو لو جاي متابعة/خدمة تانية ومن غير تشخيص النهارده ← آخر تشخيص ليه
  const sheetTarget = (x: (typeof visits)[number]) => (x.state === 'done' ? x.consult : x.state === 'waiting' && !needsDiagnosis(x.a) ? lastConsultOf(x.a.patientId) : undefined);
  const shownInQueue = new Set(visits.map((x) => x.a.patientId));
  const newFiles = newFilesToday().filter((p) => !shownInQueue.has(p.id));
  // اتشخصوا النهارده من غير حضور مسجل (ملف جديد مثلًا) — بيفضلوا في القايمة بعد التشخيص
  const dayConsults = [...consults.filter((c) => c.date === todayYmd() && !isUnlinked(c) && !shownInQueue.has(c.patientId)).sort((a, b) => Number(isIncomplete(a)) - Number(isIncomplete(b)))
    .reduce((m, c) => m.set(c.patientId, c), new Map<string, Consultation>()).values()];
  const waitingCount = visits.filter((x) => x.state !== 'done' && !sheetTarget(x)).length + newFiles.length;

  // ---------- المرضى اللي اتشخصوا: مريض واحد لكل صف، آخر تشخيص أولًا ----------
  const diagnosed = (() => {
    const by = new Map<string, { last: Consultation; count: number; incomplete: number }>();
    for (const c of consults) {
      if (isUnlinked(c)) continue;
      const cur = by.get(c.patientId);
      if (!cur) by.set(c.patientId, { last: c, count: 1, incomplete: isIncomplete(c) ? 1 : 0 });
      else { cur.count++; if (isIncomplete(c)) cur.incomplete++; if (c.date > cur.last.date) cur.last = c; }
    }
    return [...by.entries()].map(([id, x]) => ({ id, ...x, p: db.patient(id) })).sort((a, b) => b.last.date.localeCompare(a.last.date));
  })();
  const term = q.trim();
  const today = todayYmd();
  const [rFrom, rTo] = range === 'today' ? [today, today] : range === 'yesterday' ? [addDays(today, -1), addDays(today, -1)]
    : range === '3d' ? [addDays(today, -2), today] : range === 'week' ? [addDays(today, -6), today]
    : range === 'custom' ? [from <= to || !to ? from : to, from <= to || !from ? to : from] : ['', ''];
  const inRange = (d: string) => (!rFrom || d >= rFrom) && (!rTo || d <= rTo);
  const found = diagnosed.filter((x) => inRange(x.last.date) && (!term || patientMatches(x.p ?? { fullName: patientName(x.id) }, term))); // كلهم ظاهرين (البحث والتاريخ بيفلتروا)

  const selected = patientId ? db.patient(patientId) : undefined;
  // تشخيصات اتعملت بالاسم من غير ملف (غالبًا من غير نت): بتظهر عادي في «اتشخصوا» بالاسم المكتوب — الربط بملف الاستقبال
  // بيحصل تلقائي على الخادم، ومفيش أي رسالة «محتاج ربط» للدكتور (اللي فيه شك بيروح لقايمة مراجعة داخلية في الإعدادات)
  const unlinked = consults.filter(isUnlinked).sort((a, b) => b.date.localeCompare(a.date));
  const unlinkedFound = unlinked.filter((c) => inRange(c.date) && (!term || patientMatches({ fullName: c.pendingPatient?.name ?? '', phone: c.pendingPatient?.phone ?? '' } as never, term)));
  const [regQ, setRegQ] = useState(''); // بحث عن مريض متسجل بالفعل (اسم/موبايل/رقم ملف) — محتاج نت
  const regHits = newFile && online && regQ.trim().length >= 2 ? db.patients().filter((p) => patientMatches(p, regQ)).slice(0, 8) : [];
  const nameHits = newFile && newFile.name.trim().length >= 2 ? db.patients().filter((p) => patientMatches(p, newFile.name)).slice(0, 6) : [];

  return (
    <div className="page">
      <PageHead title="تشخيص المريض" sub="مرضى النهارده لأي خدمة — والبحث في كل المرضى اللي اتشخصوا.">
        {perm.add && !patientId && <Button icon="plus" onClick={() => setNewFile({ name: '', phone: '' })}>فتح ملف تشخيص جديد</Button>}
      </PageHead>

      {patientId && (
        <section className="card dx-patbar">
          <Button variant="outline" size="sm" icon="chevron" onClick={() => pick('')}>رجوع</Button>
          <div className="dx-patbar__who">
            <b>{selected?.fullName ?? patientName(patientId)}</b>
            <small>ملف <span className="num">{patientFile(patientId)}</span>{selected?.phone && <> · <bdi dir="ltr" className="num">{selected.phone}</bdi><WhatsappLink phone={selected.phone} patientId={patientId} /></>}</small>
          </div>
          <div className="dx-patbar__act">
            <Link to={`/patients/${patientId}`} className="btn btn--outline btn--sm">ملف المريض</Link>
            {canExSend && <Button size="sm" variant="outline" icon="share" onClick={() => setExSend(true)}>إرسال التمرينات عبر واتساب</Button>}
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
            مرضى النهارده {waitingCount > 0 && <span className="badge badge--warn num">{waitingCount}</span>}
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
              <h2>حضور النهارده والملفات الجديدة <span className="muted dx-date">{fmtDate(todayYmd())}</span></h2>
              {doneToday > 0 && <span className="badge badge--ok">اتشخص النهارده <span className="num">{doneToday}</span></span>}
            </div>
            <div className="card__body">
              <LoadState kind="consultations">
                {visits.length + newFiles.length + dayConsults.length === 0
                  ? <EmptyState icon="calendarPlus" title="ما فيه مرضى حضروا أو سجلوا النهارده" text="أول ما مريض يسجل أو الاستقبال يعمل له حضور لأي خدمة، هيظهر هنا لحد آخر اليوم." />
                  : (
                    <div className="dx-queue">
                      {visits.map((x) => {
                        const { a, consult, state } = x;
                        const target = sheetTarget(x);
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
                              : state === 'done' ? <span className="badge badge--ok">اتشخص</span>
                              : <span className={`badge badge--${APPT_STATUS[a.status].tone}`}>{APPT_STATUS[a.status].label}</span>}
                            <div className="dx-queue__act">
                              {p && whatsappNumber(p) && <WhatsappLink phone={whatsappNumber(p)} patientId={p.id} button />}
                              {state === 'incomplete' && consult ? perm.add && <Button size="sm" icon="refresh" onClick={() => (consult.patientId ? openSaved(consult, true) : setUnlinkedEdit(consult))}>استكمال</Button>
                                : local ? perm.add && <Button size="sm" icon="refresh" onClick={() => resumeDraft(a.patientId, true)}>استكمال</Button>
                                : target ? perm.edit && <Button size="sm" icon="plus" onClick={() => (target.patientId ? openSaved(target, true) : setUnlinkedEdit(target))}>إضافة شيت</Button>
                                : perm.add && <Button size="sm" icon="stethoscope" onClick={() => startNew(a.patientId, a.id)}>تشخيص</Button>}
                            </div>
                          </div>
                        );
                      })}
                      {newFiles.map((p) => {
                    const local = drafts.find((d) => d.patientId === p.id);
                    return (
                      <div className="dx-queue__row" key={p.id}>
                        <span className="dx-queue__time num">{fmtDate(todayYmd())}</span>
                        <div className="dx-queue__who">
                          <b>{p.fullName}</b>
                          <small>{p.phone && <><bdi dir="ltr" className="num">{p.phone}</bdi> · </>}ملف <span className="num">{p.fileNo}</span></small>
                        </div>
                        <span className="badge badge--warn">{local ? 'لم يكتمل' : 'ملف جديد'}</span>
                        <div className="dx-queue__act">
                          {whatsappNumber(p) && <WhatsappLink phone={whatsappNumber(p)} patientId={p.id} button />}
                          {!perm.add ? null
                            : local ? <Button size="sm" icon="refresh" onClick={() => resumeDraft(p.id, true)}>استكمال</Button>
                            : <Button size="sm" icon="stethoscope" onClick={() => startNew(p.id, null)}>تشخيص</Button>}
                        </div>
                      </div>
                    );
                  })}
                      {dayConsults.map((c) => {
                        const p = db.patient(c.patientId);
                        const local = drafts.find((d) => d.patientId === c.patientId);
                        return (
                          <div className="dx-queue__row" key={c.id}>
                            <span className="dx-queue__time num">{fmtDate(c.date)}</span>
                            <div className="dx-queue__who">
                              <b>{patientName(c.patientId)}</b>
                              <small>{p?.phone && <><bdi dir="ltr" className="num">{p.phone}</bdi> · </>}ملف <span className="num">{patientFile(c.patientId)}</span></small>
                            </div>
                            {isIncomplete(c) ? <span className="badge badge--warn">يحتاج استكمال</span> : <span className="badge badge--ok">اتشخص</span>}
                            <div className="dx-queue__act">
                              {p && whatsappNumber(p) && <WhatsappLink phone={whatsappNumber(p)} patientId={p.id} button />}
                              {local ? perm.add && <Button size="sm" icon="refresh" onClick={() => resumeDraft(c.patientId, true)}>استكمال</Button>
                                : perm.edit && <Button size="sm" icon={isIncomplete(c) ? 'refresh' : 'plus'} onClick={() => openSaved(c, true)}>{isIncomplete(c) ? 'استكمال' : 'إضافة شيت'}</Button>}
                            </div>
                          </div>
                        );
                      })}
                    </div>
                  )}
              </LoadState>
            </div>
          </section>
        </>
      )}

      {!patientId && view === 'done' && (
        <section className="card">
          <div className="filter-bar"><div className="field"><SearchBox value={q} onChange={setQ} placeholder="ابحث باسم المريض (أو جزء منه) أو رقم الموبايل أو رقم الملف" /></div></div>
          <div className="filter-bar" style={{ flexWrap: 'wrap', gap: 8, alignItems: 'center' }}>
            <div className="seg" role="group" aria-label="فلتر بتاريخ التشخيص" style={{ display: 'flex', flexWrap: 'wrap', flex: '1 1 100%' }}>
              {([['all', 'الكل'], ['today', 'النهارده'], ['yesterday', 'امبارح'], ['3d', 'آخر 3 أيام'], ['week', 'آخر أسبوع'], ['custom', 'من يوم لـ يوم']] as [Range, string][]).map(([k, label]) => (
                <button key={k} type="button" aria-pressed={range === k} className={`seg__btn ${range === k ? 'active' : ''}`} style={{ padding: '0 14px', flex: '1 0 auto' }} onClick={() => setRange(k)}>{label}</button>
              ))}
            </div>
            {range === 'custom' && (
              <span style={{ display: 'inline-flex', gap: 6, alignItems: 'center', flexWrap: 'wrap' }}>
                من <input type="date" className="input" style={{ width: 'auto' }} value={from} max={today} onChange={(e) => setFrom(e.target.value)} aria-label="من يوم" />
                لـ <input type="date" className="input" style={{ width: 'auto' }} value={to} max={today} onChange={(e) => setTo(e.target.value)} aria-label="لحد يوم" />
              </span>
            )}
            {range !== 'all' && <span className="muted"><span className="num">{found.length + unlinkedFound.length}</span> مريض</span>}
          </div>
          <div className="card__body">
            <LoadState kind="consultations">
              {diagnosed.length + unlinked.length === 0 ? <EmptyState icon="stethoscope" title="لا يوجد مرضى متشخّصون بعد" />
                : found.length + unlinkedFound.length === 0 ? <EmptyState icon="search" title={term ? 'مفيش مريض متشخّص بالاسم أو الرقم ده' : 'مفيش مرضى اتشخصوا في الفترة دي'} text={term ? 'جرّب جزء تاني من الاسم أو الرقم من غير مسافات.' : 'جرّب فترة تانية أو اختار «الكل».'} />
                : (
                  <div className="dx-queue">
                    {found.map((x) => (
                      <div className="dx-queue__row dx-pat" key={x.id} onClick={() => pick(x.id)}>
                        <span className="dx-queue__time num">{fmtDate(x.last.date)}</span>
                        <div className="dx-queue__who">
                          <b>{x.p?.fullName ?? patientName(x.id)}</b>
                          <small>
                            {x.p?.phone && <><bdi dir="ltr" className="num">{x.p.phone}</bdi> · </>}ملف <span className="num">{patientFile(x.id)}</span> · <span className="num">{x.count}</span> {x.count > 1 ? 'تشخيصات' : 'تشخيص'}
                            {' '}· آخر تشخيص: <bdi className="dx-as-written">{x.last.diagnosis || 'لسه ما اتحددش'}</bdi>
                          </small>
                        </div>
                        {x.incomplete > 0 ? <span className="badge badge--warn">فيه تشخيص يحتاج استكمال</span> : <span />}
                        <span className="dx-queue__act" onClick={(e) => e.stopPropagation()}>
                          {whatsappNumber(x.p) && <WhatsappLink phone={whatsappNumber(x.p)} patientId={x.id} button />}
                          {/* زرار واحد «إضافة شيت أو استكمال» (بدل «تشخيص جديد»): لو فيه تشخيص لم يكتمل على الجهاز بيكمّله،
                              وإلا بيفتح آخر تشخيص (حتى لو من البرنامج القديم) على كشف الطبيب ويتكمّل في نفس الكشف */}
                          {drafts.some((d) => d.patientId === x.id)
                            ? perm.add && <Button size="sm" icon="plus" onClick={() => startPicked(x.id)}>إضافة شيت أو استكمال</Button>
                            : perm.edit && <Button size="sm" icon="plus" onClick={() => openSaved(x.last, true)}>إضافة شيت أو استكمال</Button>}
                          {perm.add && <Button size="sm" variant="outline" icon="clipboard" onClick={() => setFollowOf(x.last)}>متابعة</Button>}
                          <Button size="sm" variant="outline" onClick={() => pick(x.id)}>فتح ملف التشخيص</Button>
                        </span>
                      </div>
                    ))}
                    {unlinkedFound.map((c) => (
                      <div className="dx-queue__row dx-pat" key={c.id} data-unlinked={c.id} onClick={() => perm.edit && setUnlinkedEdit(c)}>
                        <span className="dx-queue__time num">{fmtDate(c.date)}</span>
                        <div className="dx-queue__who">
                          <b>{c.pendingPatient?.name || '—'}</b>
                          <small>
                            {c.pendingPatient?.phone && <><bdi dir="ltr" className="num">{c.pendingPatient.phone}</bdi> · </>}
                            آخر تشخيص: <bdi className="dx-as-written">{c.diagnosis || 'لسه ما اتحددش'}</bdi>
                          </small>
                        </div>
                        {isIncomplete(c) ? <span className="badge badge--warn">فيه تشخيص يحتاج استكمال</span> : <LinkBadge c={c} />}
                        <span className="dx-queue__act" onClick={(e) => e.stopPropagation()}>
                          {whatsappNumber(c.pendingPatient) && <WhatsappLink phone={whatsappNumber(c.pendingPatient)} button />}
                          {perm.edit && <Button size="sm" variant="outline" icon="edit" onClick={() => setUnlinkedEdit(c)}>فتح التشخيص</Button>}
                        </span>
                      </div>
                    ))}
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
      {newFile && (
        <Modal title="فتح ملف تشخيص جديد" onClose={() => { setNewFile(null); setRegQ(''); }} footer={<>
          <Button variant="outline" onClick={() => { setNewFile(null); setRegQ(''); }}>إلغاء</Button>
          <Button icon="stethoscope" disabled={!isTripleName(newFile.name)} onClick={() => { setPendingOpen({ name: newFile.name.trim(), phone: newFile.phone.trim() }); setNewFile(null); }}>ابدأ التشخيص بالاسم ده</Button>
        </>}>
          {online && (
            <div className="field">
              <label>المريض متسجل؟ ابحث عنه</label>
              <input className="input" autoFocus value={regQ} placeholder="الاسم أو الموبايل أو رقم الملف" onChange={(e) => setRegQ(e.target.value)} />
              {regQ.trim().length >= 2 && (regHits.length > 0 ? (
                <div className="dx-hits" style={{ marginTop: 6 }}>
                  {regHits.map((p) => (
                    <button type="button" key={p.id} className="dx-hits__row" onClick={() => { setNewFile(null); setRegQ(''); startPicked(p.id); }}>
                      <b>{p.fullName}</b> <small>ملف <span className="num">{patientFile(p.id)}</span>{p.phone && <> · <bdi dir="ltr" className="num">{p.phone}</bdi></>}</small>
                    </button>
                  ))}
                </div>
              ) : <small className="muted">مفيش مريض متسجل بالبحث ده — اكتب اسمه تحت وافتح ملف جديد.</small>)}
            </div>
          )}
          <div className="field">
            <label>{online ? 'أو افتح ملف جديد — اسم المريض الثلاثي' : 'اسم المريض الثلاثي'}</label>
            <input className="input" autoFocus={!online} value={newFile.name} placeholder="مثال: محمد أحمد علي" onChange={(e) => setNewFile({ ...newFile, name: e.target.value })} />
            {newFile.name.trim() && !isTripleName(newFile.name) && <small className="muted">اكتب الاسم ثلاثي على الأقل.</small>}
          </div>
          <div className="field">
            <label>الموبايل (اختياري — بيأكد المطابقة)</label>
            <input className="input" dir="ltr" inputMode="tel" value={newFile.phone} onChange={(e) => setNewFile({ ...newFile, phone: e.target.value })} />
          </div>
          {nameHits.length > 0 && (
            <div className="dx-hits">
              <p className="muted" style={{ margin: '0 0 6px' }}>المريض ده موجود؟ اختاره بدل ما تفتح ملف جديد:</p>
              {nameHits.map((p) => (
                <button type="button" key={p.id} className="dx-hits__row" onClick={() => { setNewFile(null); startPicked(p.id); }}>
                  <b>{p.fullName}</b> <small>ملف <span className="num">{patientFile(p.id)}</span>{p.phone && <> · <bdi dir="ltr" className="num">{p.phone}</bdi></>}</small>
                </button>
              ))}
            </div>
          )}
          <p className="muted" style={{ marginBottom: 0 }}>
            {online ? 'لو المريض لسه ما اتسجلش في الاستقبال، التشخيص هيتحفظ ويتربط بملفه أول ما يتسجل.' : 'مفيش إنترنت دلوقتي — التشخيص هيتحفظ على الجهاز، ولما النت يرجع بيترفع ويتربط تلقائي بملف المريض اللي الاستقبال فتحه.'}
          </p>
        </Modal>
      )}
      {pendingOpen && <ConsultModal pending={pendingOpen} onClose={() => setPendingOpen(null)} />}
      {unlinkedEdit && <ConsultModal initial={unlinkedEdit} onClose={() => setUnlinkedEdit(null)} />}
      {followOf && <ConsultModal initial={followOf} openFollowUp onClose={() => setFollowOf(null)} />}
      {/* «تشخيص» بيفتح الشيت على طول: الشيت العام (وفيه خريطة الجسم لمكان الألم) ← كشف الطبيب ← الروشتة */}
      {edit && patientId && <ConsultModal patientId={patientId} appointmentId={edit === 'new' ? newVisit : undefined} initial={edit === 'new' ? undefined : edit} resume={edit === 'new' && resume} onClose={closeModal} />}
      {exSend && patientId && <ExerciseSendModal patientId={patientId} onClose={() => setExSend(false)} />}
    </div>
  );
}
