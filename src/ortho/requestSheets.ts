// ١٢/١١: طلبات الأشعة والتحاليل على ورق العيادة نفسه — CT / MRI / X-Ray / Laboratory (public/rx/*-form.jpg ‏1536×1024)
// الورقة المطبوعة/الصورة = صورة النموذج نفسها، وعلامات ✓ حمرا والكتابة بتتحط فوق مربعاتها (نفس طريقة physioReferral.ts).
// المفاتيح في شيت الكشف زي ما هي (radDetail.ts: «xr.* / mr.* / ct.*»، والتحاليل: «lr|<التحليل>» و«lr.o1..3» و«lr.notes»)
// فاللي اتعلّم قبل كده بيظهر متعلّم، والطلبات بتتسجل في ملف المريض من applyRequestForms زي الأول.
import type { ExamSheet } from './data';
import { fileNoText } from '../utils/phoneUtils';
import { RAD_FORMS, type RadForm } from './radDetail';
import { LAB_OTHERS, LAB_REQ_GROUPS, REQ_CSS, deliverRequestImage, renderLetterImage, requestPageHtml, type ReqImage, type ReqPatient } from './requestData';
import { LAB_BOXES, RAD_BOXES, type Box4, type Pt } from './requestSheetBoxes';

export type RadSheetId = 'ct' | 'mr' | 'xr';
export type SheetId = RadSheetId | 'lab';
/** 'rad' = طلبات الأشعة التانية (سونار / ديكسا / مسح ذري…) على ورقة العيادة العادية */
export type ReqKind = SheetId | 'rad';

export const IW = 1536, IH = 1024;
export const SHEET_IMG: Record<SheetId, string> = { ct: '/rx/ct-form.jpg', mr: '/rx/mri-form.jpg', xr: '/rx/xray-form.jpg', lab: '/rx/lab-form.jpg' };
export const SHEET_NAME: Record<SheetId, { en: string; ar: string; file: string }> = {
  ct: { en: 'CT Scan Request', ar: 'طلب أشعة مقطعية', file: 'CT-Request' },
  mr: { en: 'MRI Request', ar: 'طلب رنين مغناطيسي', file: 'MRI-Request' },
  xr: { en: 'X-Ray Request', ar: 'طلب أشعة سينية', file: 'XRay-Request' },
  lab: { en: 'Laboratory Request', ar: 'طلب تحاليل', file: 'Laboratory-Request' },
};
export const radForm = (id: RadSheetId) => RAD_FORMS.find((f) => f.id === id) as RadForm;

// ---------- أجزاء الصورة اللي بتتقص للشاشة ----------
export const TITLE_CROP: Record<SheetId, Box4> = { ct: [298, 104, 1236, 182], mr: [303, 104, 1236, 182], xr: [343, 104, 1200, 174], lab: [360, 96, 1172, 166] };
export const SECTION_CROP: Record<RadSheetId, Box4[]> = {
  ct: [[10, 188, 383, 266], [392, 188, 743, 266], [754, 188, 1133, 266], [1142, 188, 1531, 266]],
  mr: [[10, 200, 391, 279], [402, 200, 766, 279], [776, 200, 1160, 279], [1170, 200, 1530, 279]],
  xr: [[10, 186, 386, 263], [395, 186, 743, 263], [755, 186, 1136, 263], [1148, 186, 1529, 263]],
};
export const EXTRA_CROP: Record<RadSheetId, Box4> = { ct: [16, 838, 238, 948], mr: [12, 856, 224, 964], xr: [24, 885, 238, 976] };
export const LAB_SPECIAL_CROP: Box4 = [20, 718, 230, 878];

// ---------- التحاليل: المجموعات بنفس ترتيب الورقة ----------
export const LAB_SHEET_GROUPS = LAB_REQ_GROUPS.filter((g) => !g.legacy);
// «الأكثر طلبًا» (قبل ١٢/١١) مش في الورقة — اللي اتعلّم منها بيظهر على بنده في الورقة
export const LAB_ALIAS: Record<string, string> = {
  'Complete Blood Count (CBC)': 'CBC', 'C-Reactive Protein (CRP)': 'CRP', 'Rheumatoid Factor (RF)': 'RF', 'Serum Phosphate': 'Phosphorus',
  'Parathyroid Hormone (PTH)': 'PTH', 'Free T3 (T3)': 'Free T3', 'Free T4 (T4)': 'Free T4', 'Urine Analysis': 'Urine Routine', 'Serum Uric Acid': 'Uric Acid',
};
const aliasesOf = (item: string) => Object.keys(LAB_ALIAS).filter((k) => LAB_ALIAS[k] === item);
export const labOn = (s: ExamSheet, item: string) => s.on.includes(`lr|${item}`) || aliasesOf(item).some((k) => s.on.includes(`lr|${k}`));
export const labToggle = (s: ExamSheet, item: string): ExamSheet => {
  if (labOn(s, item)) { const drop = new Set([item, ...aliasesOf(item)].map((x) => `lr|${x}`)); return { ...s, on: s.on.filter((o) => !drop.has(o)) }; }
  return { ...s, on: [...s.on, `lr|${item}`] };
};
// مربعات كل مجموعة بنفس ترتيب بنودها — «الأملاح والعظام»: 4 بنود في العمود اليمين و3 مربعات بس، فـ Osteocalcin علامته بعد اسمه
const LAB_PTS: Pt[][] = LAB_BOXES.groups.map((g, i) => (LAB_SHEET_GROUPS[i]?.en === 'Bone & Mineral Metabolism' ? [...g.slice(0, 5), [724, 546, 14] as Pt, ...g.slice(5)] : g));

const has = (s: ExamSheet, g: string, i: string) => s.on.includes(`${g}|${i}`);
const tx = (s: ExamSheet, k: string) => (s.txt[k] ?? '').trim();

/** عدد اللي اتعلّم في نموذج */
export function sheetCount(id: SheetId, s: ExamSheet): number {
  if (id === 'lab') return LAB_SHEET_GROUPS.reduce((n, g) => n + g.items.filter((i) => labOn(s, i)).length, 0) + LAB_OTHERS.filter((k) => tx(s, k)).length;
  const f = radForm(id);
  const rows = f.groups.flatMap((g) => g.rows ?? []).filter(([r, o]) => has(s, `${id}.rows`, r) || o.some((x) => has(s, `${id}.r.${r}`, x))).length;
  const sp = f.groups.flatMap((g) => g.items ?? []).filter((i) => has(s, `${id}.sp`, i)).length;
  return rows + sp + (f.other && tx(s, `${id}.other`) ? 1 : 0);
}

// ---------- الورقة المطبوعة ----------
const esc = (v: unknown) => String(v ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]!));
const ageOf = (birth?: string | null) => {
  if (!birth) return '';
  const b = new Date(birth + 'T00:00:00'); if (isNaN(b.getTime())) return '';
  const n = new Date(); let y = n.getFullYear() - b.getFullYear();
  if (n.getMonth() < b.getMonth() || (n.getMonth() === b.getMonth() && n.getDate() < b.getDate())) y--;
  return y >= 0 ? String(y) : '';
};
const K = 1122.5 / IW; // بكسل الصورة ← بكسل الصفحة (A4 بالعرض 297mm)
const pc = (v: number, of: number) => `${((v / of) * 100).toFixed(3)}%`;
const px = (v: number) => `${(v * K).toFixed(2)}px`;

export const RS_CSS = `
  .rqp.rfp { width: 297mm; height: 210mm; padding: 0; background: #fff; font-family: "Segoe UI", "Cairo", Tahoma, sans-serif; direction: ltr; }
  .rfp .rf-pg { position: absolute; left: 0; right: 0; top: 50%; transform: translateY(-50%); aspect-ratio: ${IW} / ${IH}; }
  .rfp .rf-pg > img { position: absolute; inset: 0; width: 100%; height: 100%; }
  .rfp .rf-ck { position: absolute; display: block; }
  .rfp .rf-ck svg { width: 100%; height: 100%; display: block; }
  .rfp .rf-tx { position: absolute; font-weight: 800; color: #0b2a6b; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; unicode-bidi: plaintext; line-height: 1.15; }
  .rfp .rf-tx.bg { background: #fff; }
  .rfp .rf-ml { white-space: pre-wrap; text-overflow: clip; }
`;
const tick = ([cx, cy, s]: Pt) => {
  const sz = s * 1.55;
  return `<span class="rf-ck" style="left:${pc(cx - sz * 0.42, IW)};top:${pc(cy - sz * 0.68, IH)};width:${pc(sz, IW)};height:${pc(sz, IH)}"><svg viewBox="0 0 24 24"><path d="M3 13l6 6L22 4" fill="none" stroke="#d32f2f" stroke-width="3.6" stroke-linecap="round" stroke-linejoin="round"/></svg></span>`;
};
const text = (x: number, y: number, w: number, h: number, v: string, size = 15, cls = '') =>
  (v ? `<span class="rf-tx ${cls}" style="left:${pc(x, IW)};top:${pc(y, IH)};width:${pc(w, IW)};height:${pc(h, IH)};font-size:${px(size)}">${esc(v)}</span>` : '');

// البيانات فوق الخط الأخضر جنب عنوان الورقة: الاسم شمال، والتاريخ والملف يمين
const HEAD: Record<SheetId, { l: Box4; r: Box4 }> = {
  ct: { l: [18, 129, 292, 158], r: [1240, 129, 1520, 158] },
  mr: { l: [18, 129, 298, 158], r: [1238, 129, 1520, 158] },
  xr: { l: [18, 125, 338, 154], r: [1206, 125, 1520, 154] },
  lab: { l: [18, 115, 352, 144], r: [1182, 115, 1520, 144] },
};
// سطور «ملاحظات طبية» (y لكل خط منقّط) و«Other Region»
const NOTES: Record<SheetId, { x0: number; x1: number; ys: number[] }> = {
  ct: { x0: 1056, x1: 1508, ys: [863, 891, 919, 947, 974] },
  mr: { x0: 1052, x1: 1503, ys: [883, 912, 942, 972] },
  xr: { x0: 1066, x1: 1505, ys: [905, 932, 959] },
  lab: { x0: 262, x1: 1500, ys: [930, 954, 979] },
};
const OTHER_LINE: Partial<Record<SheetId, [number, number, number]>> = { ct: [1322, 731, 1510], mr: [1353, 732, 1510] };
const LAB_OTHER_LINES = [644, 666, 687];

const onLine = (x0: number, y: number, x1: number, v: string, size = 15) => text(x0, y - size * 1.25, x1 - x0, size * 1.3, v, size);
function notesBlock(id: SheetId, v: string) {
  if (!v) return '';
  const n = NOTES[id], gap = n.ys[1] - n.ys[0], size = Math.min(16, gap * 0.62);
  return `<span class="rf-tx rf-ml" style="left:${pc(n.x0 + 4, IW)};top:${pc(n.ys[0] - gap * 0.86, IH)};width:${pc(n.x1 - n.x0 - 8, IW)};height:${pc(gap * n.ys.length, IH)};font-size:${px(size)};line-height:${px(gap)}">${esc(v)}</span>`;
}

export function sheetPageHtml(id: SheetId, s: ExamSheet, p: ReqPatient | null | undefined, date: string): string {
  const marks: string[] = [];
  const mark = (cond: boolean, pt: Pt | undefined) => { if (cond && pt) marks.push(tick(pt)); };
  let texts = '';
  if (id === 'lab') {
    LAB_SHEET_GROUPS.forEach((g, gi) => g.items.forEach((it, i) => mark(labOn(s, it), LAB_PTS[gi]?.[i])));
    LAB_OTHERS.forEach((k, i) => { const v = tx(s, k); mark(!!v, LAB_BOXES.others[i]); texts += onLine(1309, LAB_OTHER_LINES[i], 1500, v, 14); });
    texts += notesBlock('lab', tx(s, 'lr.notes'));
  } else {
    const f = radForm(id), bx = RAD_BOXES[id];
    f.groups.flatMap((g) => g.rows ?? []).forEach(([r, opts], ri) => opts.forEach((o, oi) => mark(has(s, `${id}.r.${r}`, o) || (oi === 0 && opts.length === 1 && has(s, `${id}.rows`, r)), bx.rows[ri]?.[oi])));
    const sp = f.groups.flatMap((g) => g.items ?? []);
    sp.forEach((it, i) => mark(has(s, `${id}.sp`, it), bx.sp[i]));
    if (f.other) {
      const v = tx(s, `${id}.other`); mark(!!v, bx.sp[sp.length]);
      const l = OTHER_LINE[id]; if (l) texts += onLine(l[0], l[1], l[2], v, 14);
    }
    f.extras.forEach((x, xi) => x.items.forEach((it, i) => mark(has(s, `${id}.x${xi}`, it), bx.ex[xi]?.[i])));
    texts += notesBlock(id, tx(s, `${id}.notes`));
  }
  const h = HEAD[id], age = ageOf(p?.birthDate), file = fileNoText(p?.fileNo) || '';
  const left = p?.fullName ?? '';
  const right = [age && `Age ${age}`, file && `File ${file}`, `Date ${date.split('-').reverse().join('/')}`].filter(Boolean).join('  ·  ');
  const base = typeof location !== 'undefined' ? location.origin : '';
  return `<div class="rqp rfp"><div class="rf-pg">
<img src="${base}${SHEET_IMG[id]}" alt="">
${text(h.l[0], h.l[1], h.l[2] - h.l[0], h.l[3] - h.l[1], left, 17, 'bg')}
<span class="rf-tx bg" style="left:${pc(h.r[0], IW)};top:${pc(h.r[1], IH)};width:${pc(h.r[2] - h.r[0], IW)};height:${pc(h.r[3] - h.r[1], IH)};font-size:${px(16)};text-align:right">${esc(right)}</span>
${texts}
${marks.join('')}
</div></div>`;
}

const FONT = 'https://fonts.googleapis.com/css2?family=Cairo:wght@500;700;800&display=swap';
/** صفحة الطباعة لأي طلب (نماذج الورق A4 بالعرض — والأشعة التانية على ورقة العيادة A5) */
export function reqKindHtml(kind: ReqKind, s: ExamSheet, p: ReqPatient | null | undefined, date: string): string {
  const title = kind === 'rad' ? 'Radiology Request' : SHEET_NAME[kind].en;
  const page = kind === 'rad' ? '@page { size: A5; margin: 0; }' : '@page { size: A4 landscape; margin: 0; }';
  const body = kind === 'rad' ? requestPageHtml('rad', s, p, date) : sheetPageHtml(kind, s, p, date);
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><title>${title} — ${esc(p?.fullName)}</title>
<link rel="stylesheet" href="${FONT}"><style>${page} body { margin: 0; } ${REQ_CSS} ${RS_CSS}</style></head><body>${body}</body></html>`;
}

// ---------- الصورة (بتتجهز مقدمًا عشان الحفظ يحصل في نفس الضغطة على الموبايل) ----------
const cache = new Map<ReqKind, ReqImage>();
const pending = new Map<string, Promise<ReqImage>>();
const pageOf = (kind: ReqKind, s: ExamSheet, p: ReqPatient | null | undefined, date: string) => (kind === 'rad' ? requestPageHtml('rad', s, p, date) : sheetPageHtml(kind, s, p, date));
export function prepareReqImage(kind: ReqKind, s: ExamSheet, p: ReqPatient | null | undefined, date: string): Promise<ReqImage> {
  const html = pageOf(kind, s, p, date);
  const hit = cache.get(kind);
  if (hit && hit.key === html) return Promise.resolve(hit);
  const k = kind + html;
  if (!pending.has(k)) {
    const name = `${kind === 'rad' ? 'Radiology-Request' : SHEET_NAME[kind].file}-${(p?.fileNo || '').replace(/[^A-Za-z0-9-]/g, '') || 'patient'}-${date}-${Date.now().toString().slice(-5)}.png`;
    pending.set(k, renderLetterImage(html, name, RS_CSS).then((img) => { cache.set(kind, img); return img; }).finally(() => pending.delete(k)));
  }
  return pending.get(k)!;
}
export function readyReqImage(kind: ReqKind, s: ExamSheet, p: ReqPatient | null | undefined, date: string): ReqImage | null {
  const hit = cache.get(kind);
  return hit && hit.key === pageOf(kind, s, p, date) ? hit : null;
}
export const deliverReqImage = deliverRequestImage;
