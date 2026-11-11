// ١١/١١: «الشيت العام» الجديد — نفس خانات «إنشاء خطة علاج جديدة» بس مربعات بتتعلّم زي الشيت العام القديم.
// الاختيارات بتتحفظ في consultation.sheet تحت مفاتيح pg.* (الشيت القديم n.* متركن تحته ومحفوظ زي ما هو).
import { db } from '../data/db';
import type { ExamSheet } from './data';
import { Box, Checks, Pick, Row, Txt, sheetApi, type Api } from './ExamSheet';

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

const join = (xs: (string | false | undefined)[], sep = '، ') => xs.filter(Boolean).join(sep);
const on = (s: ExamSheet, g: string, items: string[]) => items.filter((i) => s.on.includes(`${g}|${i}`));
const t = (s: ExamSheet, k: string) => (s.txt[k] ?? '').trim();

/** ملخص الشيت الجديد — بيدخل في «التاريخ المرضي» والشكوى بتاعة الكشف */
export function planSheetSummary(s: ExamSheet) {
  const complaint = join([...on(s, 'pg.cc', PLAN_COMPLAINT), t(s, 'pg.cc.other')]);
  const lines = [
    join([t(s, 'pg.age') && `${t(s, 'pg.age')} سنة`, ...on(s, 'pg.ageband', AGE_BANDS)], ' — ') && `العمر: ${join([t(s, 'pg.age') && `${t(s, 'pg.age')} سنة`, ...on(s, 'pg.ageband', AGE_BANDS)], ' — ')}`,
    join([...on(s, 'pg.onset', PLAN_ONSET), t(s, 'pg.onset.other')]) && `بداية ظهور الألم: ${join([...on(s, 'pg.onset', PLAN_ONSET), t(s, 'pg.onset.other')])}`,
    complaint && `شكوى المريض: ${complaint}`,
    t(s, 'pg.dx') && `التشخيص: ${t(s, 'pg.dx')}`,
    join([...on(s, 'pg.goal', PLAN_GOALS), t(s, 'pg.goal.other')]) && `الهدف الرئيسي: ${join([...on(s, 'pg.goal', PLAN_GOALS), t(s, 'pg.goal.other')])}`,
    join([...on(s, 'pg.type', therapyTypes()), t(s, 'pg.type.other')]) && `نوع العلاج: ${join([...on(s, 'pg.type', therapyTypes()), t(s, 'pg.type.other')])}`,
    join([...on(s, 'pg.visits', VISITS), t(s, 'pg.visits.other') && `${t(s, 'pg.visits.other')} زيارة`]) && `عدد الزيارات: ${join([...on(s, 'pg.visits', VISITS), t(s, 'pg.visits.other') && `${t(s, 'pg.visits.other')} زيارة`])}`,
    t(s, 'pg.notes') && `ملاحظات: ${t(s, 'pg.notes')}`,
  ];
  return { complaint, history: join(lines, '\n') };
}
export const planSheetStarted = (s: ExamSheet) => s.on.some((o) => o.startsWith('pg.')) || Object.entries(s.txt).some(([k, v]) => k.startsWith('pg.') && v.trim());

const Other = ({ a, k, label = 'أخرى (Other)' }: { a: Api; k: string; label?: string }) => <Txt a={a} k={k} label={label} />;

export function PlanGeneralSheet({ sheet, onChange, age, onOpenMap }: {
  sheet: ExamSheet; onChange: (f: (s: ExamSheet) => ExamSheet) => void;
  /** عمر المريض من ملفه (لو خانة العمر فاضية بيظهر كاقتراح) */
  age?: number | null;
  onOpenMap?: () => void;
}) {
  const a = sheetApi(sheet, onChange);
  return (
    <div className="sh-grid sh-grid--2" data-testid="plan-general-sheet">
      <Box n={1} title="بيانات الحالة — العمر">
        <Txt a={a} k="pg.age" label="العمر (سنة)" num inputMode="decimal" placeholder={age != null ? String(age) : ''} />
        <div className="sh-cols"><Pick a={a} g="pg.ageband" items={AGE_BANDS} /></div>
      </Box>
      <Box n={2} title="بداية ظهور الألم">
        <div className="sh-cols"><Pick a={a} g="pg.onset" items={PLAN_ONSET} /></div>
        <Other a={a} k="pg.onset.other" />
      </Box>
      <Box n={3} title="شكوى المريض">
        <div className="sh-cols"><Checks a={a} g="pg.cc" items={PLAN_COMPLAINT} /></div>
        <Other a={a} k="pg.cc.other" />
      </Box>
      <Box n={4} title="التشخيص">
        <Txt a={a} k="pg.dx" label="التشخيص" stack />
        {onOpenMap && <button type="button" className="link-more" style={{ background: 'none', border: 0, padding: 0, cursor: 'pointer', marginTop: 6 }} onClick={onOpenMap}>اختيار من خريطة الجسم</button>}
      </Box>
      <Box n={5} title="الهدف الرئيسي">
        <div className="sh-cols"><Checks a={a} g="pg.goal" items={PLAN_GOALS} /></div>
        <Other a={a} k="pg.goal.other" />
      </Box>
      <Box n={6} title="نوع العلاج">
        <div className="sh-cols"><Checks a={a} g="pg.type" items={therapyTypes()} /></div>
        <Other a={a} k="pg.type.other" />
      </Box>
      <Box n={7} title="عدد الزيارات">
        <Row label="عدد الزيارات"><Pick a={a} g="pg.visits" items={VISITS} /></Row>
        <Txt a={a} k="pg.visits.other" label="عدد آخر" num inputMode="decimal" />
      </Box>
      <Box n={8} title="ملاحظات" wide>
        <Txt a={a} k="pg.notes" label="ملاحظات" stack />
      </Box>
    </div>
  );
}
