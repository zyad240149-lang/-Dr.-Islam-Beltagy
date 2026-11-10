// طباعة روشتة الكشف (أدوية + تحاليل + أشعة مطلوبة + تعليمات) — في تابة لوحدها (utils/printDoc)
// بيانات المريض بتتبعت من الشاشة (الإدارة من كاش db، وبوابة المريض من سجله) عشان الملف ده مايسحبش كاش الإدارة كله.
import { DOCTOR, PLACES } from '../landing/content';
import { fileNoText } from '../utils/phoneUtils';
import { IMAGING_KIND, type Consultation } from './data';
import { openPrintWindow, printHtml } from '../utils/printDoc';

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

// نفس خط النظام (IBM Plex Sans Arabic) — بيتحمّل جوّه الروشتة نفسها والطباعة بتستنى لحد ما يجهز
const FONT_HREF = 'https://fonts.googleapis.com/css2?family=IBM+Plex+Sans+Arabic:wght@400;500;600;700&display=swap';

// ستايل الروشتة متقيّد بـ .rxp عشان تتحط في نفس ملف طباعة التشخيص (printDiagnosis) من غير ما تلخبط ستايل الشيتات.
// شكل الروشتة (١٠/١١): هيدر باسم الدكتور إنجليزي وعربي، شريط بيانات المريض، Rx وجدول الأدوية (الاسم/الجرعة/التكرار/المدة/ملاحظات)،
// موعد الاستشارة، وشريط سفلي بأرقام الحجز والعنوان.
export const RX_CSS = `
  .rxp { font-family: "IBM Plex Sans Arabic", "Segoe UI", Tahoma, sans-serif; color: #10182f; background: #fff; font-size: 13px; line-height: 1.55;
    -webkit-print-color-adjust: exact; print-color-adjust: exact; display: flex; flex-direction: column; min-height: 180mm; position: relative; }
  .rxp .ltr { direction: ltr; text-align: left; unicode-bidi: isolate; }
  .rxp .wave { height: 12px; border-radius: 0 0 0 60px; background: linear-gradient(90deg, #2bb3b1 0 38%, #1b2a54 38% 100%); }
  .rxp .top { direction: ltr; display: flex; align-items: center; gap: 12px; padding: 9px 2px 8px; }
  .rxp .top img { width: 50px; height: 50px; flex: none; }
  .rxp .top .en { flex: 1; min-width: 0; text-align: left; }
  .rxp .top .en b { display: block; font-family: Georgia, "Times New Roman", serif; font-size: 19px; color: #1b2a54; line-height: 1.2; }
  .rxp .top .en span { font-size: 10px; letter-spacing: 1px; color: #334155; }
  .rxp .top .sep { width: 2px; align-self: stretch; background: #1b2a54; border-radius: 2px; }
  .rxp .top .ar { flex: 1; min-width: 0; direction: rtl; text-align: center; }
  .rxp .top .ar h1 { margin: 0; font-size: 21px; font-weight: 700; color: #1b2a54; line-height: 1.3; }
  .rxp .top .ar .t { font-size: 12.5px; color: #1b2a54; border-bottom: 2px solid #2bb3b1; display: inline-block; padding-bottom: 2px; }
  .rxp .pt { direction: ltr; display: flex; flex-wrap: wrap; align-items: center; gap: 4px 16px; padding: 8px 14px; border-radius: 12px; background: #e8f0f8; font-size: 12.5px; }
  .rxp .pt div { display: flex; align-items: baseline; gap: 6px; }
  .rxp .pt .nm { flex: 1 1 40%; }
  .rxp .pt span { font-weight: 700; color: #1b2a54; white-space: nowrap; }
  .rxp .pt b { flex: 1; min-width: 46px; text-align: center; border-bottom: 1px solid #1b2a54; font-weight: 600; padding: 0 6px; unicode-bidi: plaintext; }
  .rxp .ttl { text-align: center; font-size: 17px; font-weight: 700; color: #1b2a54; margin: 8px 0 0; }
  .rxp .rx { font-size: 36px; font-weight: 700; font-style: italic; color: #1b2a54; font-family: Georgia, "Times New Roman", serif; margin: 6px auto 0 0; direction: ltr; text-align: left; line-height: 1;
    border-bottom: 2px solid #2bb3b1; width: 78px; padding-bottom: 2px; }
  .rxp .mark { position: absolute; left: 50%; top: 52%; width: 62%; transform: translate(-50%, -50%); opacity: .06; z-index: 0; pointer-events: none; }
  .rxp .body { position: relative; z-index: 1; }
  .rxp table.meds { direction: ltr; width: 100%; border-collapse: collapse; margin-top: 6px; table-layout: fixed; }
  .rxp table.meds th { font-size: 12px; font-weight: 700; color: #1b2a54; padding: 4px 4px 8px; text-align: center; }
  .rxp table.meds td { padding: 5px 4px; vertical-align: top; text-align: center; font-size: 12.5px; font-weight: 600; unicode-bidi: plaintext; overflow-wrap: anywhere; }
  .rxp table.meds .n { width: 22px; text-align: left; font-weight: 700; }
  .rxp table.meds .nm { width: 36%; text-align: left; }
  .rxp table.meds .nt { width: 19%; }
  .rxp table.meds td.nt { font-weight: 500; font-size: 11.5px; color: #334155; }
  .rxp table.meds td.nm { font-weight: 700; font-size: 13px; text-transform: uppercase; direction: ltr; }
  .rxp .box { margin-top: 6px; border-radius: 8px; padding: 4px 9px; border: 1px solid; position: relative; z-index: 1; font-size: 12px; line-height: 1.45;
    display: flex; align-items: baseline; gap: 4px 8px; }
  .rxp .box h3 { margin: 0; font-size: 12px; flex: none; white-space: nowrap; }
  .rxp .box h3::after { content: ':'; }
  .rxp .box > div { flex: 1; min-width: 0; }
  .rxp .box.img { border-color: #f5c77e; background: #fff8eb; } .rxp .box.img h3 { color: #a35a00; }
  .rxp .box.lab { border-color: #9fd8cf; background: #effaf7; } .rxp .box.lab h3 { color: #0f5f55; }
  .rxp .box.ins { border-color: #c7d2fe; background: #f5f7ff; } .rxp .box.ins h3 { color: #1b2a54; }
  .rxp .chips { display: flex; flex-wrap: wrap; gap: 4px 6px; }
  .rxp .chips span { padding: 0 7px; border-radius: 999px; background: #fff; border: 1px solid #cbd5e1; font-size: 11.5px; }
  .rxp .fu { margin-top: 8px; font-weight: 700; color: #10182f; font-size: 12.5px; }
  .rxp .grow { flex: 1; }
  .rxp .sign { display: flex; justify-content: flex-end; margin-top: 12px; }
  .rxp .sign div { min-width: 40%; text-align: center; border-top: 1px solid #94a3b8; padding-top: 4px; font-size: 12px; color: #475569; }
  .rxp .places { margin-top: 6px; display: grid; grid-template-columns: 1fr 1fr; gap: 4px 12px; font-size: 10px; color: #475569; }
  .rxp .places b { color: #1b2a54; font-size: 10.5px; }
  .rxp footer { margin-top: 8px; border-top: 4px solid #2bb3b1; border-radius: 14px 14px 0 0; background: #1b2a54; color: #fff; padding: 9px 14px;
    display: flex; align-items: center; justify-content: space-between; gap: 12px; font-size: 12px; font-weight: 600; }
  .rxp footer .ph { direction: ltr; display: flex; flex-wrap: wrap; gap: 2px 12px; font-size: 13px; font-weight: 700; }
  .rxp footer .ad { text-align: right; font-size: 11px; line-height: 1.5; }
`;

const dmy = (ymd: string) => ymd.split('-').reverse().join('/');

// title: عنوان فوق بيانات المريض (زي «طلب أشعة وتحاليل»)؛ الروشتة العادية من غيره
export function rxPageHtml(c: Omit<Consultation, 'id' | 'patientId'>, p?: RxPatient | null, title?: string): string {
  const meds = c.medications.filter((m) => m.name.trim());
  const labs = c.labs.filter(Boolean);
  const imgs = c.imagingRequests.filter((r) => r.region.trim() || r.view.trim());
  const logo = typeof location !== 'undefined' ? `${location.origin}/brand/logo.svg` : '/brand/logo.svg';
  return `<div class="rxp" dir="rtl">
<div class="wave"></div>
<div class="top">
  <img src="${logo}" alt="">
  <div class="en"><b>Dr. Islam Beltagy</b><span>ORTHOPEDIC &amp; TRAUMA CONSULTANT</span></div>
  <div class="sep"></div>
  <div class="ar"><h1>${esc(DOCTOR.name)}</h1><div class="t">${esc(DOCTOR.title)}</div></div>
</div>
<div class="pt">
  <div class="nm"><span>Name :</span><b>${esc(p?.fullName ?? '')}</b></div>
  <div><span>Age :</span><b>${esc(ageOf(p?.birthDate ?? ''))}</b></div>
  <div><span>File :</span><b>${esc(fileNoText(p?.fileNo) || '')}</b></div>
  <div><span>Date :</span><b>${esc(dmy(c.date))}</b></div>
</div>
${title ? `<div class="ttl">${esc(title)}</div>` : ''}
<img class="mark" src="${logo}" alt="">
${meds.length ? `<div class="rx">Rx</div><div class="body"><table class="meds"><thead><tr><th class="n"></th><th class="nm">اسم الدواء</th><th>الجرعة</th><th>التكرار</th><th>المدة</th><th class="nt">ملاحظات</th></tr></thead><tbody>${meds.map((m, i) => `<tr><td class="n">${i + 1}</td><td class="nm">${esc(m.name)}</td><td>${esc(m.dose)}</td><td>${esc(m.frequency)}</td><td>${esc(m.duration)}</td><td class="nt">${esc(m.notes ?? '')}</td></tr>`).join('')}</tbody></table></div>` : ''}
${imgs.length ? `<div class="box img"><h3>الأشعة / السونار المطلوبة</h3><div>${imgs.map((r) => `<div>• ${esc(IMAGING_KIND[r.kind])} — ${esc(r.region)}${r.view ? ` <span class="ltr">(${esc(r.view)})</span>` : ''}</div>`).join('')}</div></div>` : ''}
${labs.length ? `<div class="box lab"><h3>التحاليل المطلوبة</h3><div class="chips ltr">${labs.map((l) => `<span>${esc(l)}</span>`).join('')}</div></div>` : ''}
${c.plan.trim() ? `<div class="box ins"><h3>ملاحظات وتعليمات</h3><div>${esc(c.plan).replace(/\n/g, '<br>')}</div></div>` : ''}
${c.followUp ? `<div class="fu">موعد الاستشارة: <bdi class="ltr">${esc(dmy(c.followUp))}</bdi></div>` : ''}
<div class="grow"></div>
<div class="sign"><div>توقيع الطبيب</div></div>
<div class="places">${PLACES.map((pl) => `<div><b>${esc(pl.name)}</b> — ${esc(pl.days)} — ${esc(pl.hours)}</div>`).join('')}</div>
<footer><div class="ph">${DOCTOR.phones.map((t) => `<span>☎ ${esc(t.number)}</span>`).join('')}</div><div class="ad">📍 ${esc(DOCTOR.address)}</div></footer>
</div>`;
}

export function rxHtml(c: Omit<Consultation, 'id' | 'patientId'>, p?: RxPatient | null, title?: string): string {
  return `<!doctype html><html lang="ar" dir="rtl"><head><meta charset="utf-8"><title>${esc(title || 'روشتة')} — ${esc(p?.fullName)}</title>
<link rel="stylesheet" href="${FONT_HREF}">
<style>
  @page { size: A5; margin: 12mm; }
  * { box-sizing: border-box; }
  :root { color-scheme: light; }
  body { background: #fff; margin: 0; }
${RX_CSS}
</style></head><body>${rxPageHtml(c, p, title)}</body></html>`;
}

// win = تابة الطباعة لو اتفتحت قبل كده وقت الضغطة (زي «حفظ وطباعة الروشتة» اللي بيستنى الحفظ الأول)؛ من غيرها بتتفتح دلوقتي
export function printRx(c: Omit<Consultation, 'id' | 'patientId'>, p?: RxPatient | null, win?: Window | null, title?: string) {
  void printHtml(rxHtml(c, p, title), win === undefined ? openPrintWindow() : win);
}
