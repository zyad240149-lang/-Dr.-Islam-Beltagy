// ١١/١١: «الشيت العام» الجديد — نفس خانات «إنشاء خطة علاج جديدة» بس مربعات بتتعلّم زي الشيت العام القديم.
// الاختيارات بتتحفظ في consultation.sheet تحت مفاتيح pg.* (الشيت القديم n.* متركن تحته ومحفوظ زي ما هو).
import { useState } from 'react';
import { db } from '../data/db';
import { BodyFigure, regionById, type PinSide } from '../components/BodyFigure';
import { diagnosisText } from '../components/DiagnosisPicker';
import { GOALS } from '../data/physioApi';
import { AGGRAVATING, CHARACTER, HISTORY, LOCATION, ONSET, PATTERN, RADIATION, RELIEVING, DURATION_UNITS } from '../data/physioSubjective';
import { GAIT, JOINTS, OBSERVATION, PALPATION, REFLEXES, REFLEX_RESULT, ROM_STATUS, SENS_DEEP, SENS_SUP, TEST_RESULT, GRADES, type Opt } from '../data/physioObjective';
import type { ExamSheet } from './data';
import { Box, Checks, HistoryMedsBox, Pick, Row, SHEET_LISTS, Txt, VisitReasonBox, sheetApi, type Api } from './ExamSheet';

// نفس اختيارات خطة العلاج (PatientForms → PlanModal)
export const PLAN_ONSET = ['مفاجئ (Sudden)', 'تدريجي (Gradual)', 'بعد إصابة/حادثة (Traumatic)', 'بعد سقوط (Fall)', 'بعد رفع شيء ثقيل (Lifting)', 'بعد عملية (Post-operative)', 'بعد مجهود رياضي (Sports)',
  'دون سبب واضح (Insidious)', 'متكرر (Recurrent)', 'نوبة لحالة مزمنة (Flare-up)', 'غير معروف (Unknown)'];
export const PLAN_COMPLAINT = ['ألم (Pain)', 'تيبّس (Stiffness)', 'ضعف عضلي (Weakness)', 'تنميل/وخز (Numbness / Tingling)', 'تورّم (Swelling)', 'محدودية الحركة (Limited Movement)',
  'صعوبة في المشي (Difficulty Walking)', 'مشاكل توازن (Balance Problems)', 'شد عضلي (Muscle Spasm)', 'صداع (Headache)', 'مشكلة في القوام (Posture Problem)',
  'إصابة رياضية (Sports Injury)', 'تأهيل بعد عملية (Post-operative Rehabilitation)', 'تأهيل عصبي (Neurological Rehabilitation)'];
export const PLAN_GOALS = ['تقليل الألم (Decrease Pain)', 'تحسين مدى الحركة (Improve ROM)', 'تقوية العضلات (Improve Strength)', 'تحسين التوازن (Improve Balance)', 'تقليل التورّم/الالتهاب (Decrease Swelling)',
  'تحسين المشي (Improve Gait)', 'تصحيح القوام (Correct Posture)', 'تقليل الشد العضلي (Decrease Spasm)', 'العودة للأنشطة اليومية (Return to Daily Activities)', 'العودة للرياضة (Return to Sport)',
  'التأهيل بعد العملية (Post-operative Rehabilitation)', 'تحسين جودة الحياة (Improve Quality of Life)'];
const AGE_BANDS = ['طفل (أقل من 12)', 'مراهق (12–17)', 'شاب (18–39)', 'متوسط العمر (40–59)', 'كبير السن (60+)'];
const VISITS = Array.from({ length: 12 }, (_, i) => `${i + 1} ${i === 0 ? 'زيارة' : i === 1 ? 'زيارتين' : i < 10 ? 'زيارات' : 'زيارة'}`);
const therapyTypes = () => { const xs = db.planServices().map((p) => p.name).filter(Boolean); return xs.length ? xs : ['علاج طبيعي', 'جلسات تأهيل', 'حقن', 'متابعة']; };

// ١١/١١: كل خانات «تقييم علاج طبيعي كامل» (Subjective / Objective / Assessment / Goals) كمربعات بتتعلّم
const L_ = (xs: Opt[]) => xs.filter((x) => x.value !== 'other').map((x) => x.label);
type EG = { g: string; label?: string; items: string[]; one?: boolean; other?: boolean };
type ET = { k: string; label: string; stack?: boolean; num?: boolean; date?: boolean };
type EB = { id: string; title: string; part: string; wide?: boolean; red?: boolean; off?: boolean; f: (EG | ET)[] };
const SIDES = ['Right', 'Left', 'Bilateral'];
export const EVAL_BOXES: EB[] = [
  { id: 'loc', off: true, part: 'Subjective', title: 'مكان الألم (Location of Pain)', f: [{ g: 'pg.loc', items: L_(LOCATION), other: true }] },
  { id: 'ons', off: true, part: 'Subjective', title: 'بداية الألم (Onset)', f: [{ g: 'pg.ons', items: L_(ONSET), other: true }] },
  { id: 'dur', off: true, part: 'Subjective', title: 'المدة (Duration)', f: [{ k: 'pg.dur.n', label: 'المدة', num: true }, { g: 'pg.dur.u', label: 'الوحدة', items: L_(DURATION_UNITS), one: true }] },
  { id: 'rad', part: 'Subjective', title: 'Radiation / Spread', f: [{ g: 'pg.rad', items: L_(RADIATION), other: true }] },
  { id: 'pat', part: 'Subjective', title: 'Pain Pattern / Timing', f: [{ g: 'pg.pat', items: L_(PATTERN), other: true }] },
  { id: 'chr', part: 'Subjective', title: 'طبيعة الألم/الأعراض (Character of Pain/Symptoms)', wide: true, f: [{ g: 'pg.chr', items: L_(CHARACTER), other: true }] },
  { id: 'agg', part: 'Subjective', title: 'عوامل تزيد الألم (Aggravating Factors)', wide: true, f: [{ g: 'pg.agg', items: L_(AGGRAVATING), other: true }] },
  { id: 'rel', part: 'Subjective', title: 'عوامل تخفف الألم (Relieving Factors)', f: [{ g: 'pg.rel', items: L_(RELIEVING), other: true }] },
  { id: 'hx', part: 'Subjective', title: 'التاريخ الطبي/الجراحي (Medical/Surgical History)', f: [{ g: 'pg.hx', items: L_(HISTORY), other: true }, { k: 'pg.hx.surgery', label: 'تفاصيل العملية (Surgery Details)' }, { k: 'pg.hx.injury', label: 'تفاصيل الإصابة (Injury Details)' }] },
  { id: 'meds', off: true, part: 'Subjective', title: 'الأدوية (Medications)', f: [{ k: 'pg.meds', label: 'الدواء — الجرعة — التكرار', stack: true }] },
  { id: 'obs', part: 'Objective', title: 'الملاحظة (Observation)', wide: true, f: [{ g: 'pg.obs', items: L_(OBSERVATION), other: true }] },
  { id: 'palp', part: 'Objective', title: 'الجس (Palpation)', wide: true, f: [{ g: 'pg.palp', items: L_(PALPATION), other: true }, { k: 'pg.palp.notes', label: 'ملاحظات / المكان', stack: true }] },
  { id: 'mmt', part: 'Objective', title: 'قوة العضلات (Muscle Strength — MMT)', f: [{ k: 'pg.mmt.muscle', label: 'العضلة', stack: true }, { g: 'pg.mmt.side', label: 'الجهة', items: SIDES, one: true }, { g: 'pg.mmt.grade', label: 'الدرجة', items: L_(GRADES), one: true }, { k: 'pg.mmt.notes', label: 'عضلات تانية', stack: true }] },
  { id: 'rom', part: 'Objective', title: 'مدى الحركة (ROM)', f: [{ g: 'pg.rom.joint', label: 'المفصل', items: L_(JOINTS), other: true }, { g: 'pg.rom.side', label: 'الجهة', items: [...SIDES, 'N/A', 'Midline'], one: true }, { g: 'pg.rom.status', label: 'الحالة', items: L_(ROM_STATUS) }, { k: 'pg.rom.notes', label: 'الحركة والدرجات (Active / Passive)', stack: true }] },
  { id: 'sens', off: true, part: 'Objective', title: 'الإحساس (Sensation)', f: [{ g: 'pg.sens.sup', label: 'السطحي (Superficial)', items: L_(SENS_SUP), other: true }, { g: 'pg.sens.deep', label: 'العميق (Deep)', items: L_(SENS_DEEP), other: true }, { k: 'pg.sens.area', label: 'المنطقة' }] },
  { id: 'st', off: true, part: 'Objective', title: 'الاختبارات الخاصة (Special Tests)', f: [{ k: 'pg.st.test', label: 'اسم الاختبار', stack: true }, { g: 'pg.st.side', label: 'الجهة', items: [...SIDES, 'N/A'], one: true }, { g: 'pg.st.res', label: 'النتيجة', items: L_(TEST_RESULT), one: true }, { k: 'pg.st.notes', label: 'اختبارات تانية / ملاحظات', stack: true }] },
  { id: 'refl', off: true, part: 'Objective', title: 'الانعكاسات (Reflexes)', f: [...L_(REFLEXES).map((r) => ({ g: `pg.refl.${r}`, label: r, items: L_(REFLEX_RESULT), one: true })), { k: 'pg.refl.notes', label: 'ملاحظات', stack: true }] },
  { id: 'gait', part: 'Objective', title: 'المشي (Gait)', wide: true, f: [{ g: 'pg.gait', items: L_(GAIT), other: true }, { k: 'pg.gait.device', label: 'الجهاز المساعد' }, { k: 'pg.gait.notes', label: 'ملاحظات', stack: true }] },
  { id: 'rf', part: 'Assessment', red: true, title: '⚠ علامات الخطر (Red Flags)', f: [{ g: 'pg.rf', items: ['لا (No)', 'نعم (Yes)'], one: true }, { k: 'pg.rf.notes', label: 'ملاحظات العلامات الخطيرة — اكتب ما هي', stack: true }] },
  { id: 'reeval', off: true, part: 'Assessment', title: 'موعد إعادة التقييم (Re-evaluation)', f: [{ k: 'pg.reeval', label: 'التاريخ', date: true }] },
  { id: 'sg', off: true, part: 'Goals', title: 'أهداف قصيرة المدى (Short Term Goals)', f: [{ g: 'pg.sg', items: [...GOALS], other: true }] },
  { id: 'lg', off: true, part: 'Goals', title: 'أهداف طويلة المدى (Long Term Goals)', f: [{ g: 'pg.lg', items: [...GOALS], other: true }] },
];
const groupText = (s: ExamSheet, f: EG) => join([...on(s, f.g, f.items), f.other ? t(s, f.g + '.other') : '']);
const evalText = (s: ExamSheet, b: EB) => b.f.map((f) => {
  if ('g' in f) { const v = groupText(s, f); return v && (f.label ? `${f.label}: ${v}` : v); }
  return t(s, f.k) && `${f.label}: ${t(s, f.k)}`;
}).filter(Boolean).join(' — ');

const join = (xs: (string | false | undefined)[], sep = '، ') => xs.filter(Boolean).join(sep);
const on = (s: ExamSheet, g: string, items: string[]) => items.filter((i) => s.on.includes(`${g}|${i}`));
const t = (s: ExamSheet, k: string) => (s.txt[k] ?? '').trim();

/** ملخص الشيت الجديد — بيدخل في «التاريخ المرضي» والشكوى بتاعة الكشف */
export function planSheetSummary(s: ExamSheet) {
  const complaint = join([...on(s, 'pg.cc', PLAN_COMPLAINT), t(s, 'pg.cc.other')]);
  const lines = [
    on(s, 'pg.ageband', AGE_BANDS)[0] && `فئة العمر: ${on(s, 'pg.ageband', AGE_BANDS)[0]}`,
    join([...on(s, 'pg.onset', PLAN_ONSET), t(s, 'pg.onset.other')]) && `بداية ظهور الألم: ${join([...on(s, 'pg.onset', PLAN_ONSET), t(s, 'pg.onset.other')])}`,
    complaint && `شكوى المريض: ${complaint}`,
    t(s, 'pg.dx') && `التشخيص: ${t(s, 'pg.dx')}`,
    join([...on(s, 'pg.goal', PLAN_GOALS), t(s, 'pg.goal.other')]) && `الهدف الرئيسي: ${join([...on(s, 'pg.goal', PLAN_GOALS), t(s, 'pg.goal.other')])}`,
    join([...on(s, 'pg.type', therapyTypes()), t(s, 'pg.type.other')]) && `نوع العلاج: ${join([...on(s, 'pg.type', therapyTypes()), t(s, 'pg.type.other')])}`,
    join([...on(s, 'pg.visits', VISITS), t(s, 'pg.visits.other') && `${t(s, 'pg.visits.other')} زيارة`]) && `عدد الزيارات: ${join([...on(s, 'pg.visits', VISITS), t(s, 'pg.visits.other') && `${t(s, 'pg.visits.other')} زيارة`])}`,
    t(s, 'pg.notes') && `ملاحظات: ${t(s, 'pg.notes')}`,
  ];
  const ev = (part: string) => EVAL_BOXES.filter((b) => b.part === part).map((b) => { const x = evalText(s, b); return x && `${b.title}: ${x}`; });
  return { complaint, history: join([...lines, ...ev('Subjective'), ...ev('Assessment'), ...ev('Goals')], '\n'), examination: join(ev('Objective'), '\n') };
}
export const planSheetStarted = (s: ExamSheet) => s.on.some((o) => o.startsWith('pg.')) || Object.entries(s.txt).some(([k, v]) => k.startsWith('pg.') && v.trim());

const Other = ({ a, k, label = 'أخرى (Other)' }: { a: Api; k: string; label?: string }) => <Txt a={a} k={k} label={label} />;

/** جسم الإنسان + تشخيصات المنطقة المختارة (مربع التشخيص في الشيت العام الجديد) */
function DxBody({ value, onAdd }: { value: string; onAdd: (text: string) => void }) {
  const [region, setRegion] = useState<string | null>(null);
  const [side, setSide] = useState<PinSide>(null);
  const [hovered, setHovered] = useState<string | null>(null);
  const r = region ? regionById(region) : undefined;
  const picked = new Set(value.split(' · ').map((x) => x.trim()).filter(Boolean));
  const sideOf = (s: PinSide) => (s === 'right' ? 'right' : s === 'left' ? 'left' : null);
  return (
    <div className="pg-dxb">
      <div className="pg-dxb__fig">
        <BodyFigure compact selected={region} hovered={hovered} onHover={setHovered} onSelect={(id, s) => { setRegion(id); setSide(s); }} />
        <div className="pg-dxb__hint">{hovered ? regionById(hovered)?.name : r ? r.name : 'دوس على مكان الألم'}</div>
      </div>
      <div className="pg-dxb__list">
        {!r ? <p className="cx-empty">اختار المنطقة من الجسم — تشخيصاتها هتظهر هنا.</p> : (<>
          <div className="pg-dxb__t">{r.name}{r.sided && (
            <span className="pg-dxb__side">{(['right', 'left', 'both'] as const).map((x) => <button key={x} type="button" className={`cx-chip cx-chip--sm${(x === 'both' ? side === null : side === x) ? ' is-on' : ''}`} onClick={() => setSide(x === 'both' ? null : x)}>{x === 'right' ? 'يمين' : x === 'left' ? 'شمال' : 'الجهتين'}</button>)}</span>
          )}</div>
          <div className="pg-dxb__chips">
            {r.conditions.map((c) => {
              const t = diagnosisText(c, r.sided ? (sideOf(side) ?? 'both') : null);
              return <button key={c.id} type="button" dir="ltr" className={`cx-chip cx-chip--sm${picked.has(t) ? ' is-on' : ''}`} title={c.name} onClick={() => onAdd(t)}>{c.en}</button>;
            })}
          </div>
        </>)}
      </div>
    </div>
  );
}

export function PlanGeneralSheet({ sheet, onChange, age, onOpenMap, painScore, onPainScore }: {
  sheet: ExamSheet; onChange: (f: (s: ExamSheet) => ExamSheet) => void;
  /** عمر المريض من ملفه (لو خانة العمر فاضية بيظهر كاقتراح) */
  age?: number | null;
  onOpenMap?: () => void;
  painScore?: number | ''; onPainScore?: (v: number | '') => void;
}) {
  const a = sheetApi(sheet, onChange);
  const L = SHEET_LISTS;
  const female = a.has('n.gender', 'أنثى');
  const evalBox = (b: EB, n: number) => (
    <Box key={b.id} n={n} title={b.title} wide={b.wide} tone={b.red ? 'red' : undefined}>
      {b.f.map((f) => ('g' in f ? (
        <div key={f.g}>
          {f.label && <div className="sh-lbl">{f.label}</div>}
          <div className="sh-cols">{f.one ? <Pick a={a} g={f.g} items={f.items} /> : <Checks a={a} g={f.g} items={f.items} />}</div>
          {f.other && <Other a={a} k={f.g + '.other'} />}
        </div>
      ) : f.date ? (
        <label key={f.k} className="sh-line"><span className="sh-line__l">{f.label}</span><input type="date" className="sh-in" value={a.txt(f.k)} onChange={(e) => a.set(f.k, e.target.value)} /></label>
      ) : <Txt key={f.k} a={a} k={f.k} label={f.label} stack={f.stack} num={f.num} />))}
    </Box>
  );
  return (
    <div className="sh-grid sh-grid--2" data-testid="plan-general-sheet">
      {/* ١١/١١: «البيانات الأساسية» — نفس خانات الشيت القديم (مفاتيح n.*) فبتتملى من ملف المريض وبتتحدّث فيه */}
      <Box n={1} title="البيانات الأساسية">
        <Txt a={a} k="n.name" label="الاسم" />
        <Txt a={a} k="n.age" label="السن" unit="سنة" num placeholder={age != null ? String(age) : ''} />
        <div className="sh-lbl">فئة العمر</div>
        <div className="sh-cols"><Pick a={a} g="pg.ageband" items={AGE_BANDS} /></div>
        <Row label="النوع"><Pick a={a} g="n.gender" items={L.N_GENDER} /></Row>
        {female && <Row label="الحالة"><Pick a={a} g="n.miss" items={L.N_MISS} /></Row>}
        {female && <Row label="حمل أو رضاعة"><Pick a={a} g="n.preg" items={L.N_PREG} /></Row>}
        <Row label="متزوج"><Pick a={a} g="n.married" items={L.YES_NO} /></Row>
        <Txt a={a} k="n.son" label="اسم الابن الكبير" />
        <Txt a={a} k="n.address" label="العنوان" />
        <div className="sh-lbl">الوظيفة</div>
        <div className="sh-inline"><Checks a={a} g="n.job" items={L.N_JOB} /></div>
        <div className="sh-lbl">النشاط البدني</div>
        <div className="sh-inline"><Checks a={a} g="n.activity" items={L.N_ACTIVITY} /></div>
        <div className="sh-lbl">ملاحظات</div>
        <textarea className="sh-in sh-notes" dir="auto" rows={3} aria-label="ملاحظات" value={a.txt('n.notes')} onChange={(e) => a.set('n.notes', e.target.value)} />
      </Box>
      {/* ١١/١١: «مكان الألم» بقى رقم 2 والباقي بنفس ترتيبه بعده */}
      {/* ١٢/١١: «مكان الألم» اتشال ومكانه «التاريخ المرضي المعروف والأدوية والحساسية» (مربع 3 في الشيت القديم — نفس البيانات) */}
      <HistoryMedsBox n={2} sheet={sheet} onChange={onChange} />
      <Box n={3} title="بداية ظهور الألم">
        <div className="sh-cols"><Pick a={a} g="pg.onset" items={PLAN_ONSET} /></div>
        <Other a={a} k="pg.onset.other" />
      </Box>
      <Box n={4} title="شكوى المريض">
        <div className="sh-cols"><Checks a={a} g="pg.cc" items={PLAN_COMPLAINT} /></div>
        <Other a={a} k="pg.cc.other" />
      </Box>
      <Box n={5} title="التشخيص">
        <Txt a={a} k="pg.dx" label="التشخيص" stack />
        {/* ١٢/١١: جسم الإنسان جوّه مربع التشخيص — دوس على المنطقة (الجهة من مكان الضغطة) وبعدين اختار التشخيص فيتضاف */}
        <DxBody value={a.txt('pg.dx')} onAdd={(t) => { const cur = a.txt('pg.dx').trim(); if (cur.split(' · ').includes(t)) return; a.set('pg.dx', cur ? `${cur} · ${t}` : t); }} />
        {onOpenMap && <button type="button" className="link-more" style={{ background: 'none', border: 0, padding: 0, cursor: 'pointer', marginTop: 6 }} onClick={onOpenMap}>البحث في كل التشخيصات</button>}
      </Box>
      {/* ١١/١١: «الهدف الرئيسي» و«نوع العلاج» و«عدد الزيارات» و«ملاحظات» اتشالوا (طلب العيادة) — اللي اتسجّل فيهم قبل كده لسه في الملخص */}
      {/* ١١/١١: «مقياس الألم» ومربع «مكان الألم وبدايته…» اتشالوا، ومكانهم «سبب الزيارة الحالية وتفاصيل المشكلة» (مربع 4 في الشيت القديم — نفس البيانات n.*، وفيه شدة الألم) */}
      {onPainScore && <VisitReasonBox n={6} sheet={sheet} onChange={onChange} painScore={painScore ?? ''} onPainScore={onPainScore} />}
      {/* «المدة» و«الأدوية» و«الاختبارات الخاصة» و«الإحساس» و«الانعكاسات» و«إعادة التقييم» و«الأهداف» اتشالوا من الشاشة (off) — القديم المتسجّل لسه في الملخص */}
      {EVAL_BOXES.filter((x) => !x.off && x.id !== 'loc').map((x, i) => evalBox(x, 7 + i))}
    </div>
  );
}
