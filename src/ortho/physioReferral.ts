// ١٢/١١: «العلاج الطبيعي» — Physiotherapy Referral (ورقة العيادة A4 بنفس الترتيب والألوان): طباعة + صورة للموبايل + واتساب
// الاختيارات بتتحفظ في شيت الكشف (مفاتيح pr.*) — والورقة بتطبع كل البنود و☑ قدام المختار زي الورقة الأصلية.
import type { ExamSheet } from './data';
import { fileNoText } from '../utils/phoneUtils';
import { deliverRequestImage, renderLetterImage, type ReqImage, type ReqPatient } from './requestData';

export const PR_SIDES = ['Right', 'Left', 'Bilateral'];
export const PR_REGIONS = ['Shoulder', 'Elbow', 'Wrist/Hand', 'Neck', 'Back', 'Hip', 'Knee', 'Ankle/Foot'];
export const PR_TYPES = ['Conservative (Non-surgical)', 'Post-operative (After Surgery)'];
export const PR_PROGRAMS: { title: string; items: string[] }[] = [
  { title: 'Post-operative Rehabilitation', items: ['Early Mobilization', 'ROM Exercises', 'Muscle Activation', 'Strengthening', 'Gait / Functional Training'] },
  { title: 'Pain Management', items: ['TENS', 'IFC', 'Heat Therapy', 'Cold Therapy', 'Ultrasound Therapy'] },
  { title: 'Swelling Management', items: ['Cryotherapy (Cold)', 'Compression', 'Elevation', 'Muscle Pump Exercises'] },
  { title: 'ROM & Mobility', items: ['Passive ROM', 'Active-Assisted ROM', 'Active ROM', 'Joint Mobilization', 'Stretching (Flexibility)'] },
  { title: 'Strengthening', items: ['Isometric Exercises', 'Open Chain Exercises', 'Closed Chain Exercises', 'Resistance Exercises', 'Eccentric Training', 'NMES (Neuromuscular ES)'] },
  { title: 'Stabilization & Motor Control', items: ['Core Stabilization', 'Joint Stabilization', 'Spinal Stabilization', 'Scapular Stabilization', 'Neuromuscular Control', 'Postural Training'] },
  { title: 'Balance & Proprioception', items: ['Balance Training', 'Proprioceptive Training', 'Static Balance', 'Dynamic Balance', 'Vestibular Training'] },
  { title: 'Gait & Functional Rehabilitation', items: ['Gait Re-education', 'Weight-Bearing Training', 'Assistive Device Training', 'Stair Training', 'Functional Exercises (ADL)', 'Return to Activity / Sport'] },
  { title: 'Manual Therapy', items: ['Joint Mobilization', 'Soft Tissue Mobilization', 'Myofascial Release (MFR)', 'MET (Muscle Energy Technique)', 'Manual Stretching'] },
  { title: 'Advanced Modalities', items: ['Shockwave Therapy (ESWT)', 'Laser Therapy (LLLT)', 'Electrotherapy', 'Traction / Decompression'] },
  { title: 'Home Program & Education', items: ['Home Exercise Program (HEP)', 'Patient Education', 'Activity Modification', 'Ergonomic Advice', 'Self-Management'] },
  { title: 'Additional Treatments', items: ['Nerve Gliding Exercises', 'Tendon Gliding Exercises', 'Breathing Exercises', 'Scar Management', 'Postural Correction'] },
];
export const PR_GOALS = ['Pain Reduction', 'Reduce Swelling', 'Improve Stability', 'Return to ADL / Sport', 'Improve ROM', 'Increase Strength', 'Restore Function'];
export const PR_REEVAL = ['2 weeks', '4 weeks', '6 weeks'];

const esc = (v: unknown) => String(v ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]!));
const ageOf = (birth?: string | null) => {
  if (!birth) return '';
  const b = new Date(birth + 'T00:00:00'); if (isNaN(b.getTime())) return '';
  const n = new Date(); let y = n.getFullYear() - b.getFullYear();
  if (n.getMonth() < b.getMonth() || (n.getMonth() === b.getMonth() && n.getDate() < b.getDate())) y--;
  return y >= 0 ? String(y) : '';
};
export interface PrInfo { date: string; diagnosis: string; refNo: string }

// ١٢/١١: الورقة = صورة ورقة العيادة نفسها (public/rx/physio-form.jpg ‏1086×1448) بالصور والألوان — والعلامات ✓ والكتابة بتتحط فوق مربعاتها.
// أماكن المربعات متقاسة من الصورة نفسها (بالبكسل) وبتتحول نسبة مئوية فبتفضل مظبوطة في أي مقاس.
const IW = 1086, IH = 1448;
type Pt = [number, number, number?];
const CARD_BOXES: Pt[][] = [
  [[155, 588], [156, 606], [156, 624], [156, 642], [156, 659], [156, 677]],
  [[508, 588], [508, 606], [508, 624], [508, 641], [509, 658], [509, 675]],
  [[861, 590], [862, 609], [862, 629], [862, 648], [862, 668]],
  [[156, 749], [157, 766], [157, 783], [157, 801], [157, 819], [157, 839]],
  [[510, 745], [510, 761], [510, 776], [510, 792], [510, 807], [510, 823], [510, 841]],
  [[864, 745], [864, 761], [864, 776], [864, 792], [865, 807], [865, 823], [865, 841]],
  [[158, 914], [158, 931], [158, 948], [158, 965], [158, 982], [158, 999]],
  [[510, 912], [510, 927], [510, 941], [510, 956], [510, 970], [510, 985], [510, 1000]],
  [[864, 911], [864, 927], [864, 944], [864, 961], [864, 978], [865, 997]],
  [[154, 1074], [154, 1092], [155, 1110], [155, 1129], [155, 1148]],
  [[503, 1071], [503, 1087], [503, 1103], [503, 1119], [503, 1135], [503, 1151]],
  [[869, 1071], [870, 1086], [870, 1102], [870, 1118], [870, 1135], [870, 1151]],
];
const COL_END = [345, 698, 1058];
const GENDER: Record<string, Pt> = { Male: [202, 270, 15], Female: [279, 269, 15] };
const SIDE_BOX: Pt[] = [[39, 364, 16], [127, 364, 16], [64, 401, 17]];
const REGION_BOX: Pt[] = [[303, 409, 15], [401, 409, 15], [514, 409, 15], [595, 409, 15], [682, 409, 15], [764, 409, 15], [854, 409, 15], [959, 409, 14]];
const REGION_OTHER: Pt = [1058, 410, 12];
const TYPE_BOX: Pt[] = [[266, 456, 18], [640, 456, 18]];
const GOAL_BOX: Pt[] = [[54, 1232, 13], [54, 1251, 13], [54, 1271, 13], [54, 1290, 13], [245, 1231, 13], [245, 1250, 13], [245, 1270, 13]];
const GOAL_OTHER: Pt = [245, 1290, 14];
const REEVAL_BOX: Pt[] = [[715, 1333, 13], [806, 1333, 13], [892, 1333, 13]];
const REEVAL_OTHER: Pt = [976, 1332, 12];

const pc = (v: number, of: number) => `${((v / of) * 100).toFixed(3)}%`;
export const PR_CSS = `
  .rqp.prp { width: 210mm; height: 297mm; padding: 0; background: #fff; font-family: "Segoe UI", "Cairo", Tahoma, sans-serif; direction: ltr; }
  .prp .pr-pg { position: absolute; left: 0; right: 0; top: 50%; transform: translateY(-50%); aspect-ratio: ${IW} / ${IH}; }
  .prp .pr-pg > img { position: absolute; inset: 0; width: 100%; height: 100%; }
  .prp .pr-ck { position: absolute; display: grid; place-items: center; color: #d32f2f; font-weight: 900; line-height: 1; transform: translate(-12%, -30%); }
  .prp .pr-ck svg { width: 100%; height: 100%; }
  .prp .pr-tx { position: absolute; font-size: 10.5px; font-weight: 800; color: #0b2a6b; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; unicode-bidi: plaintext; line-height: 1.1; }
  .prp .pr-tx.bg { background: #fff; }
  .prp .pr-ml { white-space: pre-line; line-height: 1.75; font-size: 10.5px; }
`;
export const PR_CSS_FIT = '';
const tick = (pt: Pt) => {
  const sz = (pt[2] ?? 12) + 8;
  return `<span class="pr-ck" style="left:${pc(pt[0], IW)};top:${pc(pt[1], IH)};width:${pc(sz, IW)};height:${pc(sz, IH)}"><svg viewBox="0 0 24 24"><path d="M3 13l6 6L22 4" fill="none" stroke="#d32f2f" stroke-width="4" stroke-linecap="round" stroke-linejoin="round"/></svg></span>`;
};
const text = (x: number, y: number, w: number, v: string, cls = '') => (v ? `<span class="pr-tx ${cls}" style="left:${pc(x, IW)};top:${pc(y, IH)};width:${pc(w, IW)}">${esc(v)}</span>` : '');

export function prPageHtml(s: ExamSheet, info: PrInfo, p: ReqPatient | null | undefined): string {
  const on = (g: string, i: string) => s.on.includes(`${g}|${i}`);
  const t = (k: string) => (s.txt[k] ?? '').trim();
  const marks: string[] = [];
  const mark = (cond: boolean, pt: Pt) => { if (cond) marks.push(tick(pt)); };
  const gender = on('n.gender', 'ذكر') ? 'Male' : on('n.gender', 'أنثى') ? 'Female' : '';
  if (gender) mark(true, GENDER[gender]);
  PR_SIDES.forEach((x, i) => mark(on('pr.side', x), SIDE_BOX[i]));
  PR_REGIONS.forEach((x, i) => mark(on('pr.reg', x), REGION_BOX[i]));
  mark(!!t('pr.reg.other'), REGION_OTHER);
  PR_TYPES.forEach((x, i) => mark(on('pr.type', x), TYPE_BOX[i]));
  PR_PROGRAMS.forEach((b, ci) => {
    const boxes = CARD_BOXES[ci];
    b.items.forEach((x, i) => mark(on(`pr.p${ci + 1}`, x), boxes[i]));
    mark(!!t(`pr.p${ci + 1}.other`), boxes[boxes.length - 1]);
  });
  PR_GOALS.forEach((x, i) => mark(on('pr.goal', x), GOAL_BOX[i]));
  mark(!!t('pr.goal.other'), GOAL_OTHER);
  PR_REEVAL.forEach((x, i) => mark(on('pr.reeval', x), REEVAL_BOX[i]));
  mark(!!t('pr.reeval.other'), REEVAL_OTHER);
  const age = ageOf(p?.birthDate) || t('n.age');
  const otherTexts = PR_PROGRAMS.map((_, ci) => {
    const last = CARD_BOXES[ci][CARD_BOXES[ci].length - 1];
    const col = last[0] < 400 ? 0 : last[0] < 700 ? 1 : 2;
    return text(last[0] + 72, last[1] - 1, COL_END[col] - last[0] - 74, t(`pr.p${ci + 1}.other`), 'bg');
  }).join('');
  const base = typeof location !== 'undefined' ? location.origin : '';
  return `<div class="rqp prp"><div class="pr-pg">
<img src="${base}/rx/physio-form.jpg" alt="">
${text(152, 236, 196, p?.fullName ?? '', 'bg')}
${text(70, 268, 46, age, 'bg')}
${text(527, 236, 276, t('pr.dx') || info.diagnosis, 'bg')}
${text(557, 268, 246, t('pr.notes'), 'bg')}
${text(880, 236, 124, info.date.split('-').reverse().join(' / '), 'bg')}
${text(917, 268, 92, t('pr.ref') || info.refNo, 'bg')}
${text(1031, 409, 24, t('pr.reg.other'), 'bg')}
${otherTexts}
${text(322, 1288, 104, t('pr.goal.other'), 'bg')}
${t('pr.instr') ? `<span class="pr-tx pr-ml" style="left:${pc(515, IW)};top:${pc(1232, IH)};width:${pc(540, IW)};height:${pc(80, IH)};white-space:pre-line">${esc(t('pr.instr'))}</span>` : ''}
${text(160, 1332, 34, t('pr.freq'), 'bg')}
${text(456, 1332, 36, t('pr.dur'), 'bg')}
${text(1037, 1332, 34, t('pr.reeval.other'), 'bg')}
${marks.join('')}
</div></div>`;
}

const FONT = 'https://fonts.googleapis.com/css2?family=Cairo:wght@500;700;800&family=Great+Vibes&display=swap';
export function prHtml(s: ExamSheet, info: PrInfo, p: ReqPatient | null | undefined, reqCss: string): string {
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><title>Physiotherapy Referral — ${esc(p?.fullName)}</title>
<link rel="stylesheet" href="${FONT}"><style>@page { size: A4; margin: 0; } body { margin: 0; } ${reqCss} ${PR_CSS} ${PR_CSS_FIT}</style></head><body>${prPageHtml(s, info, p)}</body></html>`;
}

let cache: ReqImage | null = null;
let pending: Promise<ReqImage> | null = null;
let pendingKey = '';
export function preparePrImage(s: ExamSheet, info: PrInfo, p: ReqPatient | null | undefined): Promise<ReqImage> {
  const html = prPageHtml(s, info, p);
  if (cache?.key === html) return Promise.resolve(cache);
  if (pending && pendingKey === html) return pending;
  pendingKey = html;
  const name = `Physiotherapy-Referral-${(p?.fileNo || '').replace(/[^A-Za-z0-9-]/g, '') || 'patient'}-${info.date}-${Date.now().toString().slice(-5)}.png`;
  pending = renderLetterImage(html, name, PR_CSS + PR_CSS_FIT).then((img) => { cache = img; return img; }).finally(() => { pending = null; });
  return pending;
}
export const readyPrImage = (s: ExamSheet, info: PrInfo, p: ReqPatient | null | undefined) => (cache?.key === prPageHtml(s, info, p) ? cache : null);
export const deliverPrImage = deliverRequestImage;
