// طباعة روشتة الكشف (أدوية + تحاليل + أشعة مطلوبة + تعليمات) — في تابة لوحدها (utils/printDoc)
// بيانات المريض بتتبعت من الشاشة (الإدارة من كاش db، وبوابة المريض من سجله) عشان الملف ده مايسحبش كاش الإدارة كله.
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

// ١١/١١: تصميم الروشتة الجديد (ورقة العيادة): هيدر اسم الدكتور إنجليزي (خط يدوي أحمر) + لوجو التطبيق + عربي، شريط «الإسم / التاريخ»،
// شريط «سونار المفاصل والعضلات — MSK Ultrasound»، Rx أحمر، وتحت: للطوارئ واتس + جدول الاستشارة/العيادة/مركز الرواد + فيسبوك.
export const RX_FONT_HREF = 'https://fonts.googleapis.com/css2?family=Cairo:wght@500;600;700;800&family=Great+Vibes&display=swap';
const FONT_HREF = RX_FONT_HREF;

const BLUE = '#1565c0', RED = '#d32f2f', INK = '#0d2a6b';
// ستايل الروشتة متقيّد بـ .rxp عشان تتحط في نفس ملف طباعة التشخيص (printDiagnosis) من غير ما تلخبط ستايل الشيتات.
export const RX_CSS = `
  .rxp { font-family: "Cairo", "Segoe UI", Tahoma, sans-serif; color: #10182f; background: #fff; font-size: 12.5px; line-height: 1.5;
    -webkit-print-color-adjust: exact; print-color-adjust: exact; display: flex; flex-direction: column; min-height: 180mm; position: relative;
    border: 2px solid #4fc3f7; outline: 1px solid #4fc3f7; outline-offset: 2px; padding: 10px 12px 8px; }
  .rxp .ltr { direction: ltr; text-align: left; unicode-bidi: isolate; }
  .rxp .hd { display: flex; align-items: center; gap: 10px; }
  .rxp .hd .ar { flex: 1; text-align: center; }
  .rxp .hd .ar small { display: block; color: ${BLUE}; font-size: 15px; font-weight: 800; line-height: 1.1; }
  .rxp .hd .ar h1 { margin: 0; color: ${RED}; font-size: 21px; white-space: nowrap; font-weight: 800; line-height: 1.25; }
  .rxp .hd .ar span { color: ${BLUE}; font-size: 11.5px; white-space: nowrap; font-weight: 700; }
  .rxp .hd .lg { flex: none; display: flex; align-items: center; gap: 10px; }
  .rxp .hd .lg i { width: 1.5px; height: 56px; background: ${BLUE}; }
  .rxp .hd .lg img { width: 62px; height: 62px; object-fit: contain; }
  .rxp .hd .en { flex: 1; direction: ltr; text-align: center; }
  .rxp .hd .en small { display: block; color: ${INK}; font-size: 15px; font-weight: 600; font-family: "Segoe UI", Tahoma, sans-serif; }
  .rxp .hd .en b { display: block; color: ${RED}; font-family: "Great Vibes", "Brush Script MT", cursive; font-size: 25px; font-weight: 400; line-height: 1.05; white-space: nowrap; }
  .rxp .hd .en span { color: ${BLUE}; font-size: 11px; font-weight: 700; font-family: "Segoe UI", Tahoma, sans-serif; }
  .rxp .pt { margin-top: 8px; display: flex; align-items: center; gap: 10px; border: 1.5px solid ${BLUE}; border-radius: 999px; padding: 4px 14px; }
  .rxp .pt .l { color: ${RED}; font-weight: 800; font-size: 14px; white-space: nowrap; }
  .rxp .pt .nm { flex: 1; border-bottom: 1px dotted #607d8b; font-weight: 700; min-height: 20px; padding: 0 4px; unicode-bidi: plaintext; }
  .rxp .pt .nm small { color: #607d8b; font-weight: 600; margin-inline-start: 8px; }
  .rxp .pt .d { color: ${INK}; font-weight: 800; font-size: 14px; white-space: nowrap; }
  .rxp .pt .dv { direction: ltr; font-weight: 700; min-width: 86px; text-align: center; }
  .rxp .us { margin-top: 7px; display: flex; align-items: center; gap: 10px; background: #e3f2fd; border-radius: 999px; padding: 3px 4px 3px 14px; }
  .rxp .us .t { flex: 1; text-align: center; color: ${INK}; font-weight: 600; font-size: 11px; white-space: nowrap; }
  .rxp .us .t::before { content: ''; display: inline-block; width: 24px; height: 1px; background: ${BLUE}; vertical-align: middle; margin-inline-end: 8px; }
  .rxp .us .r { color: ${RED}; font-weight: 700; }
  .rxp .us .m { direction: ltr; color: ${INK}; font-weight: 800; font-size: 13px; white-space: nowrap; font-family: "Segoe UI", Tahoma, sans-serif; border-inline-start: 1.5px solid ${INK}; padding-inline-start: 10px; }
  .rxp .us svg { flex: none; width: 92px; height: 28px; }
  .rxp .ttl { text-align: center; font-size: 16px; font-weight: 800; color: ${INK}; margin: 6px 0 0; }
  .rxp .rx { font-family: "Great Vibes", "Brush Script MT", cursive; color: ${RED}; font-size: 40px; line-height: 1; direction: ltr; text-align: left; margin: 4px 0 0 4px; }
  .rxp .mark { position: absolute; left: 4%; top: 36%; width: 46%; opacity: .05; z-index: 0; pointer-events: none; }
  .rxp .body { position: relative; z-index: 1; }
  .rxp table.meds { direction: ltr; width: 100%; border-collapse: collapse; margin-top: 4px; table-layout: fixed; }
  .rxp table.meds th { font-size: 11.5px; font-weight: 700; color: ${INK}; padding: 2px 4px 6px; text-align: center; border-bottom: 1px solid #bbdefb; }
  .rxp table.meds td { padding: 5px 4px; vertical-align: top; text-align: center; font-size: 12.5px; font-weight: 600; unicode-bidi: plaintext; overflow-wrap: anywhere; }
  .rxp table.meds .n { width: 22px; text-align: left; font-weight: 700; color: ${RED}; }
  .rxp table.meds .nm { width: 36%; text-align: left; }
  .rxp table.meds .nt { width: 19%; }
  .rxp table.meds td.nt { font-weight: 500; font-size: 11px; color: #334155; }
  .rxp table.meds td.nm { font-weight: 700; font-size: 13px; text-transform: uppercase; direction: ltr; }
  .rxp .box { margin-top: 6px; border-radius: 8px; padding: 4px 9px; border: 1px solid; position: relative; z-index: 1; font-size: 12px; line-height: 1.45; display: flex; align-items: baseline; gap: 4px 8px; }
  .rxp .box h3 { margin: 0; font-size: 12px; flex: none; white-space: nowrap; }
  .rxp .box h3::after { content: ':'; }
  .rxp .box > div { flex: 1; min-width: 0; }
  .rxp .box.img { border-color: #f5c77e; background: #fff8eb; } .rxp .box.img h3 { color: #a35a00; }
  .rxp .box.lab { border-color: #9fd8cf; background: #effaf7; } .rxp .box.lab h3 { color: #0f5f55; }
  .rxp .box.ins { border-color: #bbdefb; background: #f3f9ff; } .rxp .box.ins h3 { color: ${INK}; }
  .rxp .chips { display: flex; flex-wrap: wrap; gap: 4px 6px; }
  .rxp .chips span { padding: 0 7px; border-radius: 999px; background: #fff; border: 1px solid #cbd5e1; font-size: 11.5px; }
  .rxp .grow { flex: 1; min-height: 12px; }
  .rxp .em { display: flex; align-items: center; gap: 6px; font-size: 11.5px; font-weight: 700; margin-bottom: 4px; }
  .rxp .em svg { width: 16px; height: 16px; }
  .rxp .em .r { color: ${RED}; }
  .rxp .em .n { direction: ltr; color: #1b5e20; font-weight: 800; }
  .rxp .ft { border: 1.5px solid ${BLUE}; border-radius: 10px; overflow: hidden; }
  .rxp .ft .row { display: grid; grid-template-columns: 1.45fr .95fr 1.4fr; align-items: stretch; border-top: 1px solid #bbdefb; }
  .rxp .ft .row:first-child { border-top: 0; }
  .rxp .ft .c { padding: 3px 6px; display: flex; align-items: center; gap: 4px; font-size: 9.5px; line-height: 1.35; font-weight: 700; color: ${INK}; border-inline-start: 1px solid #bbdefb; min-width: 0; }
  .rxp .ft .c:first-child { border-inline-start: 0; }
  .rxp .ft .k { color: ${RED}; font-weight: 800; font-size: 11px; white-space: nowrap; }
  .rxp .ft .num { direction: ltr; font-weight: 800; white-space: nowrap; }
  .rxp .ft .fu { flex: 1; border-bottom: 1px dotted #607d8b; text-align: center; min-height: 16px; }
  .rxp .ft .red { color: ${RED}; font-weight: 800; font-size: 11px; white-space: nowrap; justify-content: center; }
  .rxp .ft svg { flex: none; width: 13px; height: 13px; }
  .rxp .fb { margin-top: 6px; display: flex; align-items: center; gap: 8px; font-size: 10.5px; font-weight: 700; color: ${INK}; }
  .rxp .fb::before, .rxp .fb::after { content: ''; flex: 1; height: 1px; background: ${BLUE}; }
  .rxp .fb svg { width: 18px; height: 18px; flex: none; }
`;

const dmy = (ymd: string) => ymd.split('-').reverse().join('/');
const ic = {
  wa: `<svg viewBox="0 0 24 24"><circle cx="12" cy="12" r="12" fill="#25d366"/><path fill="#fff" d="M17 14.4c-.3-.1-1.6-.8-1.8-.9-.3-.1-.4-.1-.6.1l-.8 1c-.2.2-.3.2-.6.1-1.6-.8-2.6-1.4-3.6-3.2-.3-.5.3-.4.8-1.4.1-.2 0-.3 0-.5l-.8-2c-.2-.5-.4-.4-.6-.4h-.5c-.2 0-.5.1-.7.3-.3.3-1 1-1 2.3s1 2.7 1.1 2.9c.1.2 2 3 4.8 4.2 1.8.8 2.5.8 3.4.7.5-.1 1.6-.7 1.8-1.3.2-.6.2-1.2.2-1.3-.1-.1-.3-.2-.6-.3z"/></svg>`,
  ph: `<svg viewBox="0 0 24 24"><circle cx="12" cy="12" r="12" fill="${BLUE}"/><path fill="#fff" d="M9.4 6.5 8 6.2c-.4-.1-.8.1-1 .5-.9 2 .2 5.1 2.6 7.6s5.6 3.5 7.6 2.6c.4-.2.6-.6.5-1l-.4-1.4c-.1-.4-.5-.6-.9-.6l-1.7.2c-.3 0-.6.2-.7.4l-.4.7c-1.4-.7-2.6-1.9-3.3-3.3l.7-.4c.3-.1.4-.4.4-.7l.2-1.7c0-.4-.2-.8-.6-.9z"/></svg>`,
  pin: `<svg viewBox="0 0 24 24"><path fill="${BLUE}" d="M12 1.5a7.5 7.5 0 0 0-7.5 7.5c0 5.3 7.5 13.5 7.5 13.5S19.5 14.3 19.5 9A7.5 7.5 0 0 0 12 1.5zm0 10.3A2.8 2.8 0 1 1 12 6.2a2.8 2.8 0 0 1 0 5.6z"/></svg>`,
  clock: `<svg viewBox="0 0 24 24"><circle cx="12" cy="12" r="10" fill="none" stroke="${BLUE}" stroke-width="2.4"/><path d="M12 6.5V12l3.5 2.2" fill="none" stroke="${BLUE}" stroke-width="2.4" stroke-linecap="round"/></svg>`,
  fb: `<svg viewBox="0 0 24 24"><circle cx="12" cy="12" r="12" fill="#1877f2"/><path fill="#fff" d="M13.3 19.5v-6.2h2.1l.3-2.4h-2.4V9.4c0-.7.2-1.2 1.2-1.2h1.3V6.1c-.2 0-1-.1-1.9-.1-1.9 0-3.1 1.1-3.1 3.2v1.8H8.7v2.4h2.1v6.2h2.5z"/></svg>`,
  // مسبار السونار
  probe: `<svg viewBox="0 0 112 34"><rect x="0" y="0" width="112" height="34" rx="17" fill="${BLUE}"/><path d="M6 19c10-1 22-2 34-2" stroke="#e3f2fd" stroke-width="3" fill="none" stroke-linecap="round"/><path d="M38 10h30c8 0 13 3 15 7-2 4-7 7-15 7H38c-3 0-4-2-4-7s1-7 4-7z" fill="#f5f9ff"/><rect x="80" y="9" width="5" height="16" rx="2.5" fill="#cfd8dc"/><path d="M90 11c2.5 3.5 2.5 8.5 0 12M95 8c4 5 4 13 0 18M100 6c5 6 5 16 0 22" stroke="#fff" stroke-width="2" fill="none" stroke-linecap="round"/></svg>`,
};

// title: عنوان فوق بيانات المريض (زي «طلب أشعة وتحاليل»)؛ الروشتة العادية من غيره
export function rxPageHtml(c: Omit<Consultation, 'id' | 'patientId'>, p?: RxPatient | null, title?: string): string {
  const meds = c.medications.filter((m) => m.name.trim());
  const labs = c.labs.filter(Boolean);
  const imgs = c.imagingRequests.filter((r) => r.region.trim() || r.view.trim());
  const base = typeof location !== 'undefined' ? location.origin : '';
  const logo = `${base}/icons/app-512.png`;
  const age = ageOf(p?.birthDate ?? ''), file = fileNoText(p?.fileNo) || '';
  const extra = [age && `${age} سنة`, file && `ملف ${file}`].filter(Boolean).join(' · ');
  const medsHtml = meds.length
    ? `<div class="body"><table class="meds"><thead><tr><th class="n"></th><th class="nm">اسم الدواء</th><th>الجرعة</th><th>التكرار</th><th>المدة</th><th class="nt">ملاحظات</th></tr></thead><tbody>${meds.map((m, i) => `<tr><td class="n">${i + 1}</td><td class="nm">${esc(m.name)}</td><td>${esc(m.dose)}</td><td>${esc(m.frequency)}</td><td>${esc(m.duration)}</td><td class="nt">${esc(m.notes ?? '')}</td></tr>`).join('')}</tbody></table></div>`
    : '';
  return `<div class="rxp" dir="rtl">
<div class="hd">
  <div class="ar"><small>دكتور</small><h1>إسلام جمعة بلتاجي</h1><span>استشاري جراحة العظام والكسور</span></div>
  <div class="lg"><i></i><img src="${logo}" alt=""><i></i></div>
  <div class="en"><small>Doctor</small><b>Islam Gomaa Beltage</b><span>Consultant of Orthopedic Surgery</span></div>
</div>
<div class="pt"><span class="l">الإسم :</span><span class="nm">${esc(p?.fullName ?? '')}${extra ? `<small>${esc(extra)}</small>` : ''}</span><span class="d">التاريخ :</span><span class="dv">${esc(dmy(c.date))}</span></div>
<div class="us"><span class="t">سونار المفاصل والعضلات .. تشخيص أدق</span><span class="r">|</span><span class="m">MSK Ultrasound</span>${ic.probe}</div>
${title ? `<div class="ttl">${esc(title)}</div>` : ''}
<img class="mark" src="${logo}" alt="">
<div class="rx">Rx</div>
${medsHtml}
${imgs.length ? `<div class="box img"><h3>الأشعة / السونار المطلوبة</h3><div>${imgs.map((r) => `<div>• ${esc(IMAGING_KIND[r.kind])} — ${esc(r.region)}${r.view ? ` <span class="ltr">(${esc(r.view)})</span>` : ''}</div>`).join('')}</div></div>` : ''}
${labs.length ? `<div class="box lab"><h3>التحاليل المطلوبة</h3><div class="chips ltr">${labs.map((l) => `<span>${esc(l)}</span>`).join('')}</div></div>` : ''}
${c.plan.trim() ? `<div class="box ins"><h3>ملاحظات وتعليمات</h3><div>${esc(c.plan).replace(/\n/g, '<br>')}</div></div>` : ''}
<div class="grow"></div>
<div class="em">${ic.wa}<span class="n">01004146497</span><span class="r">|</span><span class="r">للطوارئ واتس</span></div>
<div class="ft">
  <div class="row"><div class="c"><span class="k">الاستشارة :</span><span class="num fu">${c.followUp ? esc(dmy(c.followUp)) : ''}</span></div><div class="c red">الحجز قبل الحضور</div><div class="c">${ic.wa}<span class="num">01070072413</span>${ic.ph}<span class="num">0472557970</span></div></div>
  <div class="row"><div class="c"><span class="k">العيادة :</span>${ic.pin}<span>دسوق - شارع الشركات بجوار مسجد السمادوني</span></div><div class="c">${ic.ph}<span class="num">01222552399</span></div><div class="c">${ic.clock}<span>السبت والاثنين والأربعاء من 1 لـ 8 مساءً</span></div></div>
  <div class="row"><div class="c"><span class="k">مركز الرواد :</span>${ic.pin}<span>دسوق - أمام مستشفى دسوق العام</span></div><div class="c">${ic.ph}<span class="num" style="white-space:normal">0472573999<br>0472563999</span></div><div class="c">${ic.clock}<span>الأحد والثلاثاء والخميس من 4 لـ 8 مساءً</span></div></div>
</div>
<div class="fb">${ic.fb}<span>صفحتنا على فيسبوك : د/إسلام بلتاجي - استشاري جراحة العظام والكسور</span></div>
</div>`;
}

export function rxHtml(c: Omit<Consultation, 'id' | 'patientId'>, p?: RxPatient | null, title?: string): string {
  return `<!doctype html><html lang="ar" dir="rtl"><head><meta charset="utf-8"><title>${esc(title || 'روشتة')} — ${esc(p?.fullName)}</title>
<link rel="stylesheet" href="${FONT_HREF}">
<style>
  @page { size: A5; margin: 8mm; }
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
