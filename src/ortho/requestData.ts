// طلب أشعة (Radiology Request) وطلب تحاليل (Laboratory Request) — ورق الدكتور (٨/١١)
// الاختيارات بتتحفظ في شيت الكشف (rr.* للأشعة، lr للتحاليل) وبتتحوّل لطلبات الكشف (imagingRequests / labs) عند الحفظ،
// والمطبوع/الصورة فيه أسماء المطلوب بالإنجليزي بس.
import { DOCTOR, PLACES } from '../landing/content';
import { fileNoText } from '../utils/phoneUtils';
import { fmtDate } from '../utils/format';
import type { ExamSheet, ImagingKind, ImagingRequest } from './data';
import { RAD_DETAIL_REGIONS, RAD_FORMS, RAD_GROUP_PREFIXES, radDetailCount, radDetailRequests, radPicked } from './radDetail';

/** عدد اللي اتعلّم في طلب الأشعة كله (الأنواع السريعة + ورق X-Ray / MRI / CT) */
export const radCount = (s: ExamSheet) => radTypes(s).length + radDetailCount(s);

export const RAD_TYPES: [label: string, kind: ImagingKind][] = [
  ['X-Ray (Plain)', 'xray'], ['MRI', 'mri'], ['CT Scan', 'ct'], ['CT Angiography', 'ct'],
  ['Ultrasound (US)', 'us'], ['Doppler US', 'us'], ['Bone Scan', 'xray'], ['DEXA Scan (BMD)', 'dexa'],
];
export const RAD_SIDES = ['Right', 'Left', 'Bilateral'];
export const RAD_REGIONS = ['Cervical Spine', 'Thoracic Spine', 'Lumbar Spine', 'Pelvis / Hip', 'Knee', 'Shoulder', 'Elbow', 'Wrist / Hand', 'Ankle / Foot'];

export const LAB_REQ_GROUPS: { en: string; ar: string; items: string[]; special?: boolean; top?: boolean }[] = [
  // الأكثر طلبًا (ورقة الدكتور ٨/١١) — أول مجموعة؛ التحليل اللي اسمه متكرر في مجموعة تانية بيتعلّم في الاتنين ويتطبع مرة واحدة
  { en: 'Most Requested', ar: 'الأكثر طلبًا', top: true, items: ['HbA1c', 'Complete Blood Count (CBC)', 'ESR', 'C-Reactive Protein (CRP)', 'Procalcitonin', 'Rheumatoid Factor (RF)', 'Anti-CCP', 'ANA', 'HLA-B27', 'Albumin', 'Serum Calcium', 'Serum Phosphate', 'Vitamin D (25-OH)', 'Parathyroid Hormone (PTH)', 'TSH', 'Free T3 (T3)', 'Free T4 (T4)', 'Urine Analysis', 'Serum Uric Acid'] },
  { en: 'Complete Blood Count (CBC)', ar: 'صورة دم كاملة', items: ['CBC', 'Hb', 'Hct', 'RBCs', 'WBCs', 'Platelets', 'MCV / MCH / MCHC', 'RDW'] },
  { en: 'Inflammatory Markers', ar: 'مؤشرات الالتهاب', items: ['ESR', 'CRP', 'Procalcitonin'] },
  { en: 'Liver Function', ar: 'وظائف الكبد', items: ['ALT (SGPT)', 'AST (SGOT)', 'ALP', 'GGT', 'Bilirubin (T/D)', 'Albumin', 'Total Protein'] },
  { en: 'Renal Function', ar: 'وظائف الكلى', items: ['Urea', 'Creatinine', 'eGFR', 'BUN'] },
  { en: 'Glucose', ar: 'السكر', items: ['FBS', 'PPBS', 'HbA1c', 'Random Glucose'] },
  { en: 'Lipid Profile', ar: 'دهون الدم', items: ['Total Cholesterol', 'LDL', 'HDL', 'Triglycerides', 'VLDL', 'Non-HDL'] },
  { en: 'Electrolytes & Minerals', ar: 'أملاح ومعادن', items: ['Na+', 'K+', 'Ca2+', 'Mg2+', 'Phosphate (PO4)', 'Cl-', 'HCO3- (Bicarbonate)'] },
  { en: 'Vitamins', ar: 'فيتامينات', items: ['Vitamin D (25-OH)', 'Vitamin B12', 'Folic Acid', 'Vitamin B6', 'Vitamin C', 'Vitamin A', 'Vitamin E', 'Vitamin K'] },
  { en: 'Hormones', ar: 'هرمونات', items: ['TSH', 'Free T4', 'Free T3', 'PTH', 'Cortisol (AM)', 'Testosterone', 'Prolactin'] },
  { en: 'Coagulation Profile', ar: 'تجلط الدم', items: ['PT (INR)', 'aPTT', 'TT', 'Fibrinogen', 'D-Dimer'] },
  { en: 'Bone & Mineral Metabolism', ar: 'الأملاح والعظام', items: ['Serum Calcium', 'Phosphorus', 'Alkaline Phosphatase (ALP)', '25-OH Vitamin D', 'PTH (Bone)', 'Osteocalcin', 'β-CTx (Bone Resorption)'] },
  { en: 'Autoimmune / Rheumatology', ar: 'مناعة وأمراض روماتيزمية', items: ['RF', 'Anti-CCP', 'ANA', 'Anti-dsDNA', 'HLA-B27', 'Anti-ENA'] },
  { en: 'Infectious Diseases (Pre-operative)', ar: 'أمراض معدية', items: ['HBsAg', 'Anti-HCV', 'HIV (1&2)', 'VDRL / RPR', 'Hepatitis C Ab'] },
  { en: 'Urine Analysis', ar: 'تحليل البول', items: ['Urine Routine', 'Urine Culture', 'Urine ACR (Albumin/Creatinine)'] },
  { en: 'Stool Analysis', ar: 'تحليل البراز', items: ['Stool Routine', 'Stool Culture & Sensitivity'] },
  { en: 'Pre-operative Panel', ar: 'فحوصات قبل العملية', items: ['Pre-op CBC', 'Pre-op ESR / CRP', 'Pre-op PT / INR', 'Pre-op aPTT', 'LFT', 'RFT', 'FBS / HbA1c', 'HBsAg / Anti-HCV / HIV', 'Blood Group & Rh', 'Cross Matching'] },
  { en: 'Osteoporosis & Bone Turnover', ar: 'هشاشة واعتلالات العظام', special: true, items: ['Ionized Calcium', 'Bone-specific ALP', 'P1NP (Bone Formation)', '1,25-(OH)2 Vitamin D', '24-hour Urine Calcium', 'Urine NTX', 'Urine Deoxypyridinoline', 'SPEP (Serum Protein Electrophoresis)', 'Immunoglobulins IgA, IgM'] },
  { en: 'Muscle Profile', ar: 'العضلات', special: true, items: ['CK / CPK', 'LDH', 'Aldolase', 'Myoglobin', 'Anti-Jo-1', 'Myositis Panel'] },
  { en: 'Anemia & Iron Profile', ar: 'الأنيميا والحديد', special: true, items: ['Ferritin', 'Serum Iron', 'TIBC', 'Transferrin Saturation', 'Reticulocyte Count', 'Peripheral Blood Film'] },
  { en: 'Gout Profile', ar: 'النقرس', special: true, items: ['Uric Acid'] },
  { en: 'Advanced Autoimmune', ar: 'مناعة متقدمة', special: true, items: ['C3', 'C4', 'Anti-SSA (Ro)', 'Anti-SSB (La)', 'ANCA', 'Anti-Scl-70', 'Anti-Cardiolipin', 'Lupus Anticoagulant', 'Anti-β2 Glycoprotein I'] },
];
export const LAB_REQ_ALL = new Set(LAB_REQ_GROUPS.flatMap((g) => g.items));
export const RAD_VIEWS = new Set(RAD_TYPES.map(([l]) => l));
export const LAB_OTHERS = ['lr.o1', 'lr.o2', 'lr.o3'];

const on = (s: ExamSheet, g: string, i: string) => s.on.includes(`${g}|${i}`);
const tx = (s: ExamSheet, k: string) => (s.txt[k] ?? '').trim();
export const radTypes = (s: ExamSheet) => RAD_TYPES.filter(([l]) => on(s, 'rr.type', l));
export const radRegions = (s: ExamSheet) => [...RAD_REGIONS.filter((r) => on(s, 'rr.reg', r)), tx(s, 'rr.reg.other')].filter(Boolean);
export const radSide = (s: ExamSheet) => RAD_SIDES.find((x) => on(s, 'rr.side', x)) ?? '';
export const labPicked = (s: ExamSheet) => [...new Set(LAB_REQ_GROUPS.flatMap((g) => g.items.filter((i) => on(s, 'lr', i))))];
export const labOthers = (s: ExamSheet) => LAB_OTHERS.map((k) => tx(s, k)).filter(Boolean);

/** طلبات الأشعة للكشف: طلب لكل نوع، والمنطقة = المناطق + الجانب */
export function radRequests(s: ExamSheet): ImagingRequest[] {
  const region = [radRegions(s).join(', '), radSide(s)].filter(Boolean).join(' — ') || 'Not specified';
  return radTypes(s).map(([view, kind]) => ({ kind, region, view }));
}
/** طلبات الأشعة والتحاليل من الورقتين جوّه طلبات الكشف (اللي اتكتب من الروشتة بإيده بيفضل زي ما هو) */
export function applyRequestForms<T extends { imagingRequests: ImagingRequest[]; labs: string[] }>(x: T, s: ExamSheet, prevOthers: string[] = []): T {
  const drop = new Set(prevOthers);
  return {
    ...x,
    imagingRequests: [...x.imagingRequests.filter((r) => !RAD_VIEWS.has(r.view) && !(['xray', 'mri', 'ct', 'dexa'].includes(r.kind) && (RAD_DETAIL_REGIONS.has(r.region) || RAD_GROUP_PREFIXES.some((x) => r.region.startsWith(x))))), ...radRequests(s), ...radDetailRequests(s)],
    labs: [...new Set([...x.labs.filter((l) => !LAB_REQ_ALL.has(l) && !drop.has(l)), ...labPicked(s), ...labOthers(s)])],
  };
}

/** نص رسالة واتساب للمريض: المطلوب بالإنجليزي */
export function requestText(kind: 'rad' | 'lab', s: ExamSheet, p: { fullName?: string } | null | undefined, date: string): string {
  const head = [`د. إسلام جمعة بلتاجي — Dr. Islam Gomaa Beltagy`, kind === 'rad' ? 'طلب أشعة — Radiology Request' : 'طلب تحاليل — Laboratory Request',
    p?.fullName ? `Patient: ${p.fullName}` : '', `Date: ${date.split('-').reverse().join('/')}`].filter(Boolean);
  const body: string[] = [];
  if (kind === 'rad') {
    body.push(`Requested: ${radTypes(s).map(([l]) => l).join(', ')}`);
    if (radSide(s)) body.push(`Side: ${radSide(s)}`);
    if (radRegions(s).length) body.push(`Region: ${radRegions(s).join(', ')}`);
    if (tx(s, 'rr.ind')) body.push(`Clinical Indication: ${tx(s, 'rr.ind')}`);
  } else {
    const seen = new Set<string>();
    for (const g of LAB_REQ_GROUPS) { const xs = g.items.filter((i) => on(s, 'lr', i) && !seen.has(i) && !!seen.add(i)); if (xs.length) body.push(`• ${g.en}: ${xs.join(', ')}`); }
    if (labOthers(s).length) body.push(`• Others: ${labOthers(s).join(', ')}`);
    if (tx(s, 'lr.notes')) body.push(`Clinical Notes: ${tx(s, 'lr.notes')}`);
  }
  return [...head, '', ...body].join('\n');
}

// ---------- الطباعة والصورة ----------
const esc = (v: unknown) => String(v ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]!));
export interface ReqPatient { fullName: string; fileNo?: string | null; birthDate?: string | null }
const ageOf = (birth?: string | null) => {
  if (!birth) return '';
  const b = new Date(birth + 'T00:00:00'); if (isNaN(b.getTime())) return '';
  const n = new Date(); let y = n.getFullYear() - b.getFullYear();
  if (n.getMonth() < b.getMonth() || (n.getMonth() === b.getMonth() && n.getDate() < b.getDate())) y--;
  return y >= 0 ? String(y) : '';
};

export const REQ_CSS = `
  .rqp { width: 148mm; min-height: 200mm; padding: 9mm 9mm 7mm; background: #fff; color: #10182f; font-family: "IBM Plex Sans Arabic", "Segoe UI", Tahoma, sans-serif;
    font-size: 12.5px; line-height: 1.5; display: flex; flex-direction: column; box-sizing: border-box; -webkit-print-color-adjust: exact; print-color-adjust: exact; }
  .rqp * { box-sizing: border-box; }
  .rqp { direction: ltr; }
  .rqp .hd { display: grid; grid-template-columns: 1fr auto 1fr; align-items: center; gap: 8px; padding-bottom: 6px; border-bottom: 3px solid #1b4f9c; }
  .rqp .hd .en { direction: ltr; text-align: left; } .rqp .hd .ar { direction: rtl; text-align: right; }
  .rqp .hd b { display: block; font-size: 15px; color: #10325f; } .rqp .hd span { font-size: 11px; color: #1b4f9c; }
  .rqp .hd img { width: 46px; height: 46px; }
  .rqp .ttl { margin: 10px auto 8px; padding: 6px 20px; border-radius: 999px; background: linear-gradient(135deg, #10325f, #1b4f9c); color: #fff; font-weight: 700; font-size: 16px; text-align: center; }
  .rqp .pt { display: grid; grid-template-columns: 1.7fr .7fr 1fr 1fr; gap: 4px 10px; padding: 6px 10px; border: 1px solid #c9d6ea; border-radius: 10px; font-size: 12px; direction: ltr; }
  .rqp .pt span { color: #64748b; } .rqp .pt b { color: #10325f; unicode-bidi: isolate; }
  .rqp .sec { margin-top: 9px; border: 1px solid #c9d6ea; border-radius: 10px; overflow: hidden; direction: ltr; }
  .rqp .sec h3 { margin: 0; padding: 4px 10px; background: #eaf1fb; color: #10325f; font-size: 12.5px; }
  .rqp .sec .bd { padding: 6px 10px; }
  .rqp .chips { display: flex; flex-wrap: wrap; gap: 4px 6px; }
  .rqp .chips span { padding: 2px 9px; border-radius: 999px; border: 1px solid #1b4f9c; color: #10325f; font-weight: 600; font-size: 12px; background: #fff; }
  .rqp .grp { margin-bottom: 5px; } .rqp .grp b { display: block; font-size: 11.5px; color: #1b4f9c; margin-bottom: 2px; }
  .rqp .txt { white-space: pre-line; direction: auto; unicode-bidi: plaintext; min-height: 18px; }
  .rqp .grow { flex: 1; }
  .rqp .sign { display: flex; justify-content: flex-end; margin-top: 16px; direction: ltr; }
  .rqp .sign div { min-width: 45%; text-align: center; border-top: 1px solid #94a3b8; padding-top: 3px; font-size: 11.5px; color: #475569; }
  .rqp footer { margin-top: 10px; padding-top: 5px; border-top: 3px solid #6cb33f; display: grid; grid-template-columns: 1fr 1fr; gap: 4px 10px; font-size: 9.5px; color: #475569; direction: rtl; }
  .rqp footer b { color: #10325f; }
`;

export function requestPageHtml(kind: 'rad' | 'lab', s: ExamSheet, p: ReqPatient | null | undefined, date: string): string {
  const logo = `${location.origin}/brand/logo.svg`;
  const chips = (xs: string[]) => `<div class="chips">${xs.map((x) => `<span>${esc(x)}</span>`).join('')}</div>`;
  const sec = (title: string, body: string) => (body ? `<div class="sec"><h3>${esc(title)}</h3><div class="bd">${body}</div></div>` : '');
  let body = '';
  if (kind === 'rad') {
    body = sec('Requested Investigation', radTypes(s).length ? chips(radTypes(s).map(([l]) => l)) : '')
      + sec('Side', radSide(s) ? chips([radSide(s)]) : '')
      + sec('Body Region', radRegions(s).length ? chips(radRegions(s)) : '')
      // ورق X-Ray / MRI / CT التفصيلي: المطلوب بس
      + RAD_FORMS.map((f) => {
        const p = radPicked(s, f);
        if (!p.count && !p.extras.length && !p.notes) return '';
        const rows = p.rows.map(([r, o]) => `<div class="grp"><b>${esc(r)}</b>${chips(o)}</div>`).join('');
        const items = p.groups.map((x) => `<div class="grp"><b>${esc(x.g.en)}</b>${chips([...x.items, ...(x.other ? [`Other: ${x.other}`] : [])])}</div>`).join('');
        const other = p.other ? `<div class="grp"><b>Other Region</b>${chips([p.other])}</div>` : '';
        const ex = p.extras.map(([l, v]) => `<div class="grp"><b>${esc(l)}</b>${chips(v)}</div>`).join('');
        const notes = p.notes ? `<div class="grp"><b>Clinical Notes</b><div class="txt">${esc(p.notes)}</div></div>` : '';
        return sec(f.en, rows + items + other + ex + notes);
      }).join('')
      + sec('Clinical Indication / Suspected Condition', tx(s, 'rr.ind') ? `<div class="txt">${esc(tx(s, 'rr.ind'))}</div>` : '');
  } else {
    const seen = new Set<string>();
    const groups = LAB_REQ_GROUPS.map((g) => ({ g, xs: g.items.filter((i) => on(s, 'lr', i) && !seen.has(i) && !!seen.add(i)) })).filter((x) => x.xs.length);
    const others = labOthers(s);
    body = sec('Requested Tests', groups.map(({ g, xs }) => `<div class="grp"><b>${esc(g.en)}</b>${chips(xs)}</div>`).join('') + (others.length ? `<div class="grp"><b>Others</b>${chips(others)}</div>` : ''))
      + sec('Clinical Notes', tx(s, 'lr.notes') ? `<div class="txt">${esc(tx(s, 'lr.notes'))}</div>` : '');
  }
  const title = kind === 'rad' ? 'Radiology Request &nbsp;|&nbsp; طلب أشعة' : 'Laboratory Request &nbsp;|&nbsp; طلب تحاليل';
  return `<div class="rqp">
<div class="hd"><div class="en"><b>Dr. Islam Gomaa Beltagy</b><span>Consultant of Orthopedic &amp; Trauma Surgery</span></div><img src="${logo}" alt="" crossorigin="anonymous"><div class="ar"><b>${esc(DOCTOR.name)}</b><span>${esc(DOCTOR.title)}</span></div></div>
<div class="ttl">${title}</div>
<div class="pt"><div><span>Name:</span> <b>${esc(p?.fullName || '—')}</b></div><div><span>Age:</span> <b>${esc(ageOf(p?.birthDate) || '—')}</b></div><div><span>File No:</span> <b>${esc(fileNoText(p?.fileNo) || '—')}</b></div><div><span>Date:</span> <b>${esc(date.split('-').reverse().join('/'))}</b></div></div>
${body}
<div class="grow"></div>
<div class="sign"><div>Doctor's Signature</div></div>
<footer>${PLACES.map((pl) => `<div><b>${esc(pl.name)}</b> — ${esc(pl.address)}<br>☎ <bdi>${pl.phones.map(esc).join(' • ')}</bdi></div>`).join('')}</footer>
</div>`;
}

const FONT_HREF = 'https://fonts.googleapis.com/css2?family=IBM+Plex+Sans+Arabic:wght@400;600;700&display=swap';
export function requestHtml(kind: 'rad' | 'lab', s: ExamSheet, p: ReqPatient | null | undefined, date: string): string {
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><title>${kind === 'rad' ? 'Radiology Request' : 'Laboratory Request'} — ${esc(p?.fullName)}</title>
<link rel="stylesheet" href="${FONT_HREF}"><style>@page { size: A5; margin: 0; } body { margin: 0; } ${REQ_CSS}</style></head><body>${requestPageHtml(kind, s, p, date)}</body></html>`;
}

/** نافذة الصورة على الآيباد/الموبايل: «حفظ في الصور» (قايمة المشاركة ← حفظ الصورة) أو ضغطة مطوّلة على الصورة */
// الصورة data: (مش blob:) — الضغطة المطوّلة «حفظ في الصور» بتشتغل عليها في سفاري وكروم الموبايل
function showImageSheet(dataUrl: string, file: File) {
  const url = dataUrl;
  const ov = document.createElement('div');
  ov.style.cssText = 'position:fixed;inset:0;z-index:9999;background:rgba(15,23,42,.88);display:flex;flex-direction:column;align-items:center;gap:12px;padding:16px;overflow:auto;direction:rtl;font-family:"IBM Plex Sans Arabic",Tahoma,sans-serif';
  const close = () => { ov.remove(); };
  const btn = (text: string, primary: boolean) => {
    const b = document.createElement('button');
    b.type = 'button'; b.textContent = text;
    b.style.cssText = `font:inherit;font-weight:700;font-size:16px;padding:10px 18px;border-radius:10px;border:0;cursor:pointer;${primary ? 'background:#16a34a;color:#fff' : 'background:#fff;color:#10182f'}`;
    return b;
  };
  const bar = document.createElement('div'); bar.style.cssText = 'display:flex;gap:8px;flex-wrap:wrap;justify-content:center';
  const nav = navigator as Navigator & { canShare?: (d: { files: File[] }) => boolean };
  const share = !!nav.canShare?.({ files: [file] });
  // أندرويد: قايمة المشاركة مافيهاش «حفظ في المعرض» — التنزيل بيحط الصورة في «التنزيلات» وبتظهر في معرض الصور على طول
  const android = /Android/i.test(navigator.userAgent);
  if (android) {
    const dl = btn('حفظ في معرض الصور', true);
    dl.onclick = () => { const a = document.createElement('a'); a.href = url; a.download = file.name; document.body.appendChild(a); a.click(); a.remove(); dl.textContent = '✓ اتحفظت — افتح معرض الصور'; };
    bar.appendChild(dl);
    if (share) { const sh = btn('مشاركة / واتساب', false); sh.onclick = () => { navigator.share({ files: [file] }).catch(() => undefined); }; bar.appendChild(sh); }
  } else if (share) {
    const save = btn('حفظ في الصور', true);
    save.onclick = () => { navigator.share({ files: [file] }).catch(() => undefined); };
    bar.appendChild(save);
  }
  const x = btn('إغلاق', false); x.onclick = close; bar.appendChild(x);
  const hint = document.createElement('div');
  hint.style.cssText = 'color:#e2e8f0;font-size:14px;text-align:center';
  hint.textContent = android ? 'اضغط «حفظ في معرض الصور» — الصورة بتتحفظ في «التنزيلات» وبتظهر في المعرض. أو اضغط مطوّلًا على الصورة واختار «تنزيل الصورة»'
    : share ? 'اضغط «حفظ في الصور» واختار «حفظ الصورة» — أو اضغط مطوّلًا على الصورة واختار «إضافة إلى الصور»' : 'اضغط مطوّلًا على الصورة واختار «حفظ الصورة» / «إضافة إلى الصور»';
  const img = document.createElement('img');
  img.src = url; img.alt = file.name;
  img.style.cssText = 'max-width:100%;height:auto;border-radius:8px;background:#fff;-webkit-touch-callout:default';
  ov.append(bar, hint, img);
  document.body.appendChild(ov);
}

// ---------- صورة الطلب ----------
// الصورة بتتجهز مقدمًا في الخلفية أول ما الاختيارات تتغيّر (prepareRequestImage)، فالضغطة على «حفظ كصورة» بتحفظ في نفس اللحظة —
// المتصفحات (أندرويد وآيفون) بتسمح بالتنزيل/المشاركة بس جوّه الضغطة نفسها، ولو استنينا تجهيز الصورة بعد الضغطة كانت بتترفض.
export interface ReqImage { key: string; blob: Blob; dataUrl: string; file: File }
const imgCache = new Map<'rad' | 'lab', ReqImage>();
const pending = new Map<string, Promise<ReqImage>>();

async function renderImage(kind: 'rad' | 'lab', html: string, p: ReqPatient | null | undefined, date: string): Promise<ReqImage> {
  const host = document.createElement('div');
  host.style.cssText = 'position:fixed;left:-10000px;top:0;z-index:-1;background:#fff';
  host.innerHTML = `<style>${REQ_CSS}</style>${html}`;
  document.body.appendChild(host);
  try {
    await Promise.race([document.fonts?.ready, new Promise((r) => setTimeout(r, 2000))]).catch(() => undefined);
    await Promise.all(Array.from(host.querySelectorAll('img')).map((img) => (img.complete ? null : new Promise((r) => { img.onload = r; img.onerror = r; }))));
    const { default: html2canvas } = await import('html2canvas');
    const canvas = await html2canvas(host.querySelector('.rqp') as HTMLElement, { scale: 2, useCORS: true, backgroundColor: '#ffffff' });
    const blob = await new Promise<Blob | null>((r) => canvas.toBlob(r, 'image/png'));
    if (!blob) throw new Error('تعذّر تجهيز الصورة');
    // اسم الملف بحروف إنجليزي بس (بعض تطبيقات المعرض بتتلخبط في الأسماء العربي)
    const name = `${kind === 'rad' ? 'Radiology-Request' : 'Laboratory-Request'}-${(p?.fileNo || '').replace(/[^A-Za-z0-9-]/g, '') || 'patient'}-${date}-${Date.now().toString().slice(-5)}.png`;
    return { key: html, blob, dataUrl: canvas.toDataURL('image/png'), file: new File([blob], name, { type: 'image/png', lastModified: Date.now() }) };
  } finally { host.remove(); }
}

/** تجهيز صورة الطلب مقدمًا (بتتنادي من الشاشة بعد ما الاختيارات تهدى) */
export function prepareRequestImage(kind: 'rad' | 'lab', s: ExamSheet, p: ReqPatient | null | undefined, date: string): Promise<ReqImage> {
  const html = requestPageHtml(kind, s, p, date);
  const hit = imgCache.get(kind);
  if (hit && hit.key === html) return Promise.resolve(hit);
  const k = kind + html;
  if (!pending.has(k)) {
    pending.set(k, renderImage(kind, html, p, date).then((img) => { imgCache.set(kind, img); return img; }).finally(() => pending.delete(k)));
  }
  return pending.get(k)!;
}
/** الصورة الجاهزة لو مطابقة للاختيارات الحالية */
export function readyRequestImage(kind: 'rad' | 'lab', s: ExamSheet, p: ReqPatient | null | undefined, date: string): ReqImage | null {
  const hit = imgCache.get(kind);
  return hit && hit.key === requestPageHtml(kind, s, p, date) ? hit : null;
}

const isIOS = () => !/Android/i.test(navigator.userAgent) && (/iPhone|iPad|iPod/i.test(navigator.userAgent) || (navigator.maxTouchPoints > 1 && /Mac/i.test(navigator.userAgent)));
/** تسليم الصورة — لازم تتنادي جوّه الضغطة نفسها:
 *  أندرويد/كمبيوتر ← تنزيل على طول (أندرويد: ألبوم «Download» في معرض الصور)
 *  آيفون/آيباد ← قايمة المشاركة على طول ← «حفظ الصورة» (أبل مابتسمحش بالحفظ في الصور من غيرها)؛ ولو المشاركة مش متاحة نافذة الصورة */
export function deliverRequestImage(img: ReqImage): 'saved' | 'share' | 'sheet' {
  if (isIOS()) {
    const nav = navigator as Navigator & { canShare?: (d: { files: File[] }) => boolean };
    if (nav.canShare?.({ files: [img.file] })) {
      navigator.share({ files: [img.file] }).catch((e: Error) => { if (e.name !== 'AbortError') showImageSheet(img.dataUrl, img.file); });
      return 'share';
    }
    showImageSheet(img.dataUrl, img.file);
    return 'sheet';
  }
  const a = document.createElement('a'); a.href = img.dataUrl; a.download = img.file.name; a.rel = 'noopener';
  document.body.appendChild(a); a.click(); a.remove();
  return 'saved';
}
