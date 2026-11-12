// طباعة روشتة الكشف (أدوية + تحاليل + أشعة مطلوبة + تعليمات) — في تابة لوحدها (utils/printDoc)
// بيانات المريض بتتبعت من الشاشة (الإدارة من كاش db، وبوابة المريض من سجله) عشان الملف ده مايسحبش كاش الإدارة كله.
import { fileNoText } from '../utils/phoneUtils';
import { IMAGING_KIND, type Consultation } from './data';
import { openPrintWindow, printHtml } from '../utils/printDoc';
import { renderLetterImage, type ReqImage } from './requestData';

const esc = (s: unknown) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]!));

function ageOf(birth: string) {
  if (!birth) return '';
  const b = new Date(birth + 'T00:00:00');
  if (isNaN(b.getTime())) return '';
  const n = new Date();
  let y = n.getFullYear() - b.getFullYear();
  if (n.getMonth() < b.getMonth() || (n.getMonth() === b.getMonth() && n.getDate() < b.getDate())) y--;
  return y >= 0 ? String(y) : '';
}

export interface RxPatient { fullName: string; fileNo?: string | null; birthDate?: string | null }

// ١٢/١١: الروشتة = صورة ورقة العيادة نفسها (public/rx/letterhead.jpg) بكل تفاصيلها وألوانها، والبيانات بتتكتب فوقها في أماكنها:
// الإسم والتاريخ على الشريط، والأدوية/الأشعة/التحاليل/التعليمات تحت Rx، وموعد الاستشارة على سطر «الاستشارة» تحت.
// الأماكن بالنسبة المئوية من مقاس الصورة (1054×1492) عشان تفضل مظبوطة في أي مقاس.
export const RX_FONT_HREF = 'https://fonts.googleapis.com/css2?family=Cairo:wght@500;600;700;800&display=swap';
const FONT_HREF = RX_FONT_HREF;

const INK = '#0d2a6b';
// ستايل الروشتة متقيّد بـ .rxp عشان تتحط في نفس ملف طباعة التشخيص (printDiagnosis) من غير ما تلخبط ستايل الشيتات.
export const RX_CSS = `
  .rxp { position: relative; width: 100%; aspect-ratio: 1054 / 1492; font-family: "Cairo", "Segoe UI", Tahoma, sans-serif; color: #10182f; font-size: 11.5px; line-height: 1.45;
    -webkit-print-color-adjust: exact; print-color-adjust: exact; overflow: hidden; background: #fff; }
  .rxp > img.bg { position: absolute; inset: 0; width: 100%; height: 100%; object-fit: fill; z-index: 0; }
  .rxp .f { position: absolute; z-index: 1; }
  .rxp .ltr { direction: ltr; text-align: left; unicode-bidi: isolate; }
  .rxp .nm { top: 14.9%; right: 13.8%; width: 50%; height: 3.4%; display: flex; align-items: center; gap: 8px; font-size: 14px; font-weight: 800; color: ${INK}; white-space: nowrap; overflow: hidden; }
  .rxp .nm small { font-size: 10.5px; font-weight: 600; color: #475569; }
  .rxp .dt { top: 15.6%; left: 6.2%; width: 18%; height: 3.4%; display: flex; align-items: center; justify-content: center; direction: ltr; font-size: 13px; font-weight: 800; color: ${INK};
    background: #fff; border-radius: 6px; }
  .rxp .bd { top: 29.5%; right: 4.5%; left: 4.5%; bottom: 20.5%; overflow: hidden; display: flex; flex-direction: column; gap: 5px; }
  .rxp .ttl { text-align: center; font-size: 14px; font-weight: 800; color: ${INK}; }
  .rxp table.meds { direction: ltr; width: 100%; border-collapse: collapse; table-layout: fixed; }
  .rxp table.meds th { font-size: 10.5px; font-weight: 700; color: ${INK}; padding: 1px 3px 4px; text-align: center; border-bottom: 1px solid #bbdefb; }
  .rxp table.meds td { padding: 4px 3px; vertical-align: top; text-align: center; font-size: 11.5px; font-weight: 600; unicode-bidi: plaintext; overflow-wrap: anywhere; border-bottom: 1px dashed #e3eaf3; }
  .rxp table.meds .n { width: 18px; text-align: left; font-weight: 800; color: #d32f2f; }
  .rxp table.meds .nm2 { width: 36%; text-align: left; }
  .rxp table.meds .nt { width: 19%; }
  .rxp table.meds td.nt { font-weight: 500; font-size: 10.5px; color: #334155; }
  .rxp table.meds td.nm2 { font-weight: 800; font-size: 12px; text-transform: uppercase; direction: ltr; }
  .rxp .box { border-radius: 7px; padding: 3px 8px; border: 1px solid; font-size: 11px; line-height: 1.4; display: flex; align-items: baseline; gap: 4px 8px; background: rgba(255,255,255,.85); }
  .rxp .box h3 { margin: 0; font-size: 11px; flex: none; white-space: nowrap; }
  .rxp .box h3::after { content: ':'; }
  .rxp .box > div { flex: 1; min-width: 0; }
  .rxp .box.img { border-color: #f5c77e; } .rxp .box.img h3 { color: #a35a00; }
  .rxp .box.lab { border-color: #9fd8cf; } .rxp .box.lab h3 { color: #0f5f55; }
  .rxp .box.ins { border-color: #bbdefb; } .rxp .box.ins h3 { color: ${INK}; }
  .rxp .chips { display: flex; flex-wrap: wrap; gap: 3px 5px; }
  .rxp .chips span { padding: 0 6px; border-radius: 999px; background: #fff; border: 1px solid #cbd5e1; font-size: 10.5px; }
  .rxp .fu { top: 84.2%; right: 14.4%; width: 16.5%; height: 2.4%; display: flex; align-items: center; justify-content: center; direction: ltr; background: #fff;
    font-size: 11.5px; font-weight: 800; color: ${INK}; }
`;

const dmy = (ymd: string) => ymd.split('-').reverse().join('/');

// title: عنوان فوق الأدوية (زي «طلب أشعة وتحاليل»)؛ الروشتة العادية من غيره
export function rxPageHtml(c: Omit<Consultation, 'id' | 'patientId'>, p?: RxPatient | null, title?: string): string {
  const meds = c.medications.filter((m) => m.name.trim());
  const labs = c.labs.filter(Boolean);
  const imgs = c.imagingRequests.filter((r) => r.region.trim() || r.view.trim());
  const base = typeof location !== 'undefined' ? location.origin : '';
  const age = ageOf(p?.birthDate ?? ''), file = fileNoText(p?.fileNo) || '';
  const extra = [age && `${age} سنة`, file && `ملف ${file}`].filter(Boolean).join(' · ');
  const medsHtml = meds.length
    ? `<table class="meds"><thead><tr><th class="n"></th><th class="nm2">اسم الدواء</th><th>الجرعة</th><th>التكرار</th><th>المدة</th><th class="nt">ملاحظات</th></tr></thead><tbody>${meds.map((m, i) => `<tr><td class="n">${i + 1}</td><td class="nm2">${esc(m.name)}</td><td>${esc(m.dose)}</td><td>${esc(m.frequency)}</td><td>${esc(m.duration)}</td><td class="nt">${esc(m.notes ?? '')}</td></tr>`).join('')}</tbody></table>`
    : '';
  return `<div class="rxp" dir="rtl">
<img class="bg" src="${base}/rx/letterhead.jpg" alt="">
<div class="f nm"><span>${esc(p?.fullName ?? '')}</span>${extra ? `<small>${esc(extra)}</small>` : ''}</div>
<div class="f dt">${esc(dmy(c.date))}</div>
<div class="f bd">
${title ? `<div class="ttl">${esc(title)}</div>` : ''}
${medsHtml}
${imgs.length ? `<div class="box img"><h3>الأشعة / السونار المطلوبة</h3><div>${imgs.map((r) => `<div>• ${esc(IMAGING_KIND[r.kind])} — ${esc(r.region)}${r.view ? ` <span class="ltr">(${esc(r.view)})</span>` : ''}</div>`).join('')}</div></div>` : ''}
${labs.length ? `<div class="box lab"><h3>التحاليل المطلوبة</h3><div class="chips ltr">${labs.map((l) => `<span>${esc(l)}</span>`).join('')}</div></div>` : ''}
${c.plan.trim() ? `<div class="box ins"><h3>ملاحظات وتعليمات</h3><div>${esc(c.plan).replace(/\n/g, '<br>')}</div></div>` : ''}
</div>
${c.followUp ? `<div class="f fu">${esc(dmy(c.followUp))}</div>` : ''}
</div>`;
}

export function rxHtml(c: Omit<Consultation, 'id' | 'patientId'>, p?: RxPatient | null, title?: string): string {
  return `<!doctype html><html lang="ar" dir="rtl"><head><meta charset="utf-8"><title>${esc(title || 'روشتة')} — ${esc(p?.fullName)}</title>
<link rel="stylesheet" href="${FONT_HREF}">
<style>
  @page { size: A5; margin: 0; }
  * { box-sizing: border-box; }
  :root { color-scheme: light; }
  body { background: #fff; margin: 0; }
  .rxp { width: 148mm; height: 210mm; aspect-ratio: auto; }
${RX_CSS}
</style></head><body>${rxPageHtml(c, p, title)}</body></html>`;
}

// win = تابة الطباعة لو اتفتحت قبل كده وقت الضغطة (زي «حفظ وطباعة الروشتة» اللي بيستنى الحفظ الأول)؛ من غيرها بتتفتح دلوقتي
export function printRx(c: Omit<Consultation, 'id' | 'patientId'>, p?: RxPatient | null, win?: Window | null, title?: string) {
  void printHtml(rxHtml(c, p, title), win === undefined ? openPrintWindow() : win);
}

// ١٢/١١: صورة الروشتة (نفس ورقة العيادة) — «تحميل على الموبايل» من تاب الروشتة؛ بتتجهز مقدمًا عشان الحفظ يحصل في نفس الضغطة
let rxImg: ReqImage | null = null;
let rxPending: Promise<ReqImage> | null = null;
let rxPendingKey = '';
export function prepareRxImage(c: Omit<Consultation, 'id' | 'patientId'>, p?: RxPatient | null): Promise<ReqImage> {
  const html = rxPageHtml(c, p);
  if (rxImg?.key === html) return Promise.resolve(rxImg);
  if (rxPending && rxPendingKey === html) return rxPending;
  rxPendingKey = html;
  const name = `Prescription-${(p?.fileNo || '').replace(/[^A-Za-z0-9-]/g, '') || 'patient'}-${c.date}-${Date.now().toString().slice(-5)}.png`;
  rxPending = renderLetterImage(html, name, `.rxp { width: 148mm; height: 210mm; }${RX_CSS}`, '.rxp').then((img) => { rxImg = img; return img; }).finally(() => { rxPending = null; });
  return rxPending;
}
export const readyRxImage = (c: Omit<Consultation, 'id' | 'patientId'>, p?: RxPatient | null) => (rxImg?.key === rxPageHtml(c, p) ? rxImg : null);
