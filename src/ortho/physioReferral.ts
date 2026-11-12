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

export const PR_CSS_FIT = `
  .prp { font-size: 9px; line-height: 1.25; }
  .prp .pr-in { gap: 1.6mm; padding-top: 3mm; }
  .prp .pr-hd img { width: 20mm; height: 20mm; }
  .prp .pr-hd .l small { font-size: 15px; } .prp .pr-hd .l b { font-size: 26px; } .prp .pr-hd .r b { font-size: 19px; } .prp .pr-hd span { font-size: 11.5px; }
  .prp .pr-ban { padding: 1.3mm 6mm; } .prp .pr-ban b { font-size: 17px; } .prp .pr-ban span { font-size: 12.5px; }
  .prp .pr-card { padding: 1.1mm 2.6mm; }
  .prp .pr-box ul { padding: 1mm 2.4mm; gap: .25mm; }
  .prp .pr-box h4 { font-size: 10.6px; padding: .8mm 2.4mm; }
  .prp .pr-green { font-size: 13px; padding: 1mm 5mm; }
  .prp .pr-txt { min-height: 10mm; }
  .prp .pr-foot { padding: 2mm 4mm; font-size: 11px; }
`;
export const PR_CSS = `
  .rqp.prp { width: 210mm; height: 297mm; padding: 0; font-family: "Segoe UI", "Cairo", Tahoma, sans-serif; color: #0d2a6b; font-size: 9.6px; line-height: 1.32; direction: ltr; background: #fff; }
  .prp .pr-in { position: absolute; inset: 0; display: flex; flex-direction: column; gap: 2.2mm; padding: 4mm 5mm 0; }
  .prp .pr-hd { display: grid; grid-template-columns: 1fr auto 1fr; align-items: center; gap: 4mm; border-top: 3px solid #6cb33f; border-radius: 16px 16px 0 0; padding-top: 1mm; }
  .prp .pr-hd .l { text-align: center; } .prp .pr-hd .l small { display: block; font-family: Georgia, serif; font-size: 17px; font-weight: 700; color: #0d2a6b; }
  .prp .pr-hd .l b { display: block; font-family: "Great Vibes", "Brush Script MT", cursive; font-weight: 400; color: #d32f2f; font-size: 30px; line-height: 1; }
  .prp .pr-hd span { font-size: 12.5px; font-weight: 700; color: #1b4f9c; }
  .prp .pr-hd img { width: 26mm; height: 26mm; object-fit: contain; border-inline: 1.5px solid #1b4f9c; padding: 0 4mm; }
  .prp .pr-hd .r { text-align: center; } .prp .pr-hd .r b { display: block; font-size: 21px; font-weight: 800; color: #d32f2f; } .prp .pr-hd .r b i { font-style: normal; color: #1b4f9c; }
  .prp .pr-ban { display: flex; align-items: center; gap: 4mm; background: linear-gradient(90deg, #0d2a6b, #1b4f9c); color: #fff; border-radius: 999px; padding: 2mm 6mm; border-bottom: 3px solid #6cb33f; }
  .prp .pr-ban b { font-size: 20px; } .prp .pr-ban i { font-style: normal; color: #6cb33f; font-size: 22px; font-weight: 800; } .prp .pr-ban span { font-size: 14px; font-weight: 700; margin-left: auto; }
  .prp .pr-row { display: grid; gap: 2mm; }
  .prp .pr-card { border: 1.2px solid #b9cce6; border-radius: 10px; padding: 1.6mm 3mm; background: #f7faff; }
  .prp .pr-k { font-weight: 800; color: #0d2a6b; } .prp .pr-v { font-weight: 700; color: #10182f; border-bottom: 1px dotted #7b8fb3; padding: 0 3px; unicode-bidi: plaintext; }
  .prp .pr-line { display: flex; gap: 4px; align-items: baseline; margin: 1px 0; flex-wrap: wrap; }
  .prp .ck { display: inline-flex; align-items: center; gap: 3px; margin-inline-end: 7px; white-space: nowrap; }
  .prp .ck::before { content: ''; width: 9px; height: 9px; border: 1.3px solid #0d2a6b; border-radius: 2px; display: inline-block; flex: none; }
  .prp .ck.on { font-weight: 800; color: #0b5d1e; } .prp .ck.on::before { background: #1b4f9c; border-color: #1b4f9c; box-shadow: inset 0 0 0 1.5px #fff; }
  .prp .pr-sec { display: flex; align-items: center; gap: 3mm; }
  .prp .pr-pill { background: #1b4f9c; color: #fff; font-weight: 800; border-radius: 999px; padding: 1mm 5mm; font-size: 12px; white-space: nowrap; }
  .prp .pr-green { background: linear-gradient(90deg, #4e9a2a, #6cb33f); color: #fff; font-weight: 800; font-size: 15px; border-radius: 10px 30px 30px 10px; padding: 1.4mm 5mm; align-self: flex-start; }
  .prp .pr-green small { font-weight: 600; font-size: 11px; }
  .prp .pr-grid { display: grid; grid-template-columns: repeat(3, 1fr); gap: 2mm; }
  .prp .pr-box { border: 1.2px solid #b9cce6; border-radius: 10px; overflow: hidden; background: #f7faff; }
  .prp .pr-box h4 { margin: 0; display: flex; align-items: center; gap: 2mm; background: linear-gradient(90deg, #0d2a6b, #1b4f9c); color: #fff; font-size: 11.2px; padding: 1mm 2.5mm; border-radius: 0 0 14px 0; }
  .prp .pr-box h4 em { font-style: normal; width: 17px; height: 17px; border-radius: 50%; background: #6cb33f; display: grid; place-items: center; font-size: 11px; flex: none; }
  .prp .pr-box ul { list-style: none; margin: 0; padding: 1.4mm 2.5mm; display: grid; gap: .6mm; }
  .prp .pr-box li .ck { white-space: normal; }
  .prp .pr-other { color: #475569; }
  .prp .pr-foot { margin: auto -5mm 0; display: flex; align-items: center; justify-content: space-around; gap: 3mm; background: linear-gradient(90deg, #0d2a6b, #1b4f9c); color: #fff; padding: 2.4mm 4mm; font-size: 12px; font-weight: 700; }
  .prp .pr-foot span { display: inline-flex; align-items: center; gap: 4px; } .prp .pr-foot small { display: block; font-size: 10px; font-weight: 600; opacity: .9; }
  .prp .pr-txt { min-height: 16mm; white-space: pre-line; unicode-bidi: plaintext; font-weight: 600; color: #10182f; }
`;

export function prPageHtml(s: ExamSheet, info: PrInfo, p: ReqPatient | null | undefined): string {
  const on = (g: string, i: string) => s.on.includes(`${g}|${i}`);
  const t = (k: string) => (s.txt[k] ?? '').trim();
  const ck = (g: string, i: string) => `<span class="ck${on(g, i) ? ' on' : ''}">${esc(i)}</span>`;
  const other = (k: string) => `<span class="ck${t(k) ? ' on' : ''} pr-other">Other: ${t(k) ? esc(t(k)) : '……………'}</span>`;
  const gender = on('n.gender', 'ذكر') ? 'Male' : on('n.gender', 'أنثى') ? 'Female' : '';
  const age = ageOf(p?.birthDate) || t('n.age');
  const v = (x: string, w = '') => `<span class="pr-v"${w ? ` style="min-width:${w}"` : ''}>${esc(x) || '&nbsp;'}</span>`;
  const box = (i: number) => {
    const b = PR_PROGRAMS[i];
    return `<div class="pr-box"><h4><em>${i + 1}</em>${esc(b.title)}</h4><ul>${b.items.map((x) => `<li>${ck(`pr.p${i + 1}`, x)}</li>`).join('')}<li>${other(`pr.p${i + 1}.other`)}</li></ul></div>`;
  };
  const base = typeof location !== 'undefined' ? location.origin : '';
  return `<div class="rqp prp"><div class="pr-in">
<div class="pr-hd">
  <div class="l"><small>Doctor</small><b>Islam Gomaa Beltage</b><span>Consultant of Orthopedic Surgery</span></div>
  <img src="${base}/icons/app-512.png" alt="">
  <div class="r"><b><i>Dr.</i> Islam Gomaa Beltage</b><span>Consultant of Orthopedic Surgery</span></div>
</div>
<div class="pr-ban"><b>Physiotherapy Referral</b><i>/</i><span>Rehabilitation &amp; Physiotherapy Program</span></div>
<div class="pr-row" style="grid-template-columns: 1.15fr 1.35fr .8fr">
  <div class="pr-card"><div class="pr-line"><span class="pr-k">Patient Name :</span>${v(p?.fullName ?? '', '40mm')}</div>
    <div class="pr-line"><span class="pr-k">Age :</span>${v(age, '10mm')}<span class="pr-k" style="margin-left:6px">Gender :</span><span class="ck${gender === 'Male' ? ' on' : ''}">Male</span><span class="ck${gender === 'Female' ? ' on' : ''}">Female</span></div>
    <div class="pr-line"><span class="pr-k">File No :</span>${v(fileNoText(p?.fileNo) || '', '16mm')}</div></div>
  <div class="pr-card"><div class="pr-line"><span class="pr-k">Diagnosis :</span>${v(t('pr.dx') || info.diagnosis, '50mm')}</div>
    <div class="pr-line"><span class="pr-k">Clinical Notes :</span>${v(t('pr.notes'), '42mm')}</div></div>
  <div class="pr-card"><div class="pr-line"><span class="pr-k">Date :</span>${v(info.date.split('-').reverse().join(' / '))}</div>
    <div class="pr-line"><span class="pr-k">Ref. No. :</span>${v(t('pr.ref') || info.refNo, '16mm')}</div></div>
</div>
<div class="pr-row" style="grid-template-columns: .55fr 2.45fr">
  <div class="pr-card"><div class="pr-pill" style="display:inline-block;margin-bottom:1mm">Affected Side:</div><div class="pr-line">${PR_SIDES.map((x) => ck('pr.side', x)).join('')}</div></div>
  <div class="pr-card"><div class="pr-green" style="display:inline-block;margin:-1.6mm 0 1.2mm -3mm;border-radius:10px 0 30px 0;font-size:12.5px">Region (Affected Area)</div>
    <div class="pr-line">${PR_REGIONS.map((x) => ck('pr.reg', x)).join('')}${other('pr.reg.other')}</div></div>
</div>
<div class="pr-card pr-sec"><span class="pr-pill">Treatment Type:</span>${PR_TYPES.map((x) => ck('pr.type', x)).join('<span style="color:#7b8fb3">|</span>')}</div>
<div class="pr-green">☑ Rehabilitation Program <small>(Please select)</small></div>
<div class="pr-grid">${PR_PROGRAMS.map((_, i) => box(i)).join('')}</div>
<div class="pr-row" style="grid-template-columns: 1fr 1fr">
  <div class="pr-box"><h4><em>◎</em>Program Goals:</h4><ul style="grid-template-columns:1fr 1fr">${PR_GOALS.map((x) => `<li>${ck('pr.goal', x)}</li>`).join('')}<li>${other('pr.goal.other')}</li></ul></div>
  <div class="pr-box"><h4><em>✎</em>Special Instructions:</h4><div class="pr-txt" style="padding:1.4mm 2.5mm">${esc(t('pr.instr'))}</div></div>
</div>
<div class="pr-row" style="grid-template-columns: 1fr 1fr 1.7fr">
  <div class="pr-card pr-line"><span class="pr-k">Frequency :</span>${v(t('pr.freq'), '10mm')}<span>sessions / week</span></div>
  <div class="pr-card pr-line"><span class="pr-k">Duration :</span>${v(t('pr.dur'), '10mm')}<span>weeks</span></div>
  <div class="pr-card pr-line"><span class="pr-k">Re-evaluation :</span>${PR_REEVAL.map((x) => ck('pr.reeval', x)).join('')}${other('pr.reeval.other')}</div>
</div>
<div class="pr-foot"><span>☎ 0472557970</span><span>✆ 01070072413</span><span>📍 Desouk – El-Samadoni Mosque St.</span><span>Dr. Islam Gomaa Beltage<small>Consultant of Orthopedic Surgery</small></span></div>
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
