// طباعة روشتة الكشف (أدوية + تحاليل + أشعة مطلوبة + تعليمات) — في تابة لوحدها (utils/printDoc)
// بيانات المريض بتتبعت من الشاشة (الإدارة من كاش db، وبوابة المريض من سجله) عشان الملف ده مايسحبش كاش الإدارة كله.
import { DOCTOR, PLACES } from '../landing/content';
import { fileNoText } from '../utils/phoneUtils';
import { fmtDate } from '../utils/format';
import { IMAGING_KIND, SIDE, type Consultation } from './data';
import { openPrintWindow, printHtml } from '../utils/printDoc';

const esc = (s: unknown) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]!));

function ageOf(birth: string) {
  if (!birth) return '';
  const b = new Date(birth + 'T00:00:00');
  if (isNaN(b.getTime())) return '';
  const n = new Date();
  let y = n.getFullYear() - b.getFullYear();
  if (n.getMonth() < b.getMonth() || (n.getMonth() === b.getMonth() && n.getDate() < b.getDate())) y--;
  return y >= 0 ? `${y} سنة` : '';
}

export interface RxPatient { fullName: string; fileNo?: string | null; birthDate?: string | null }

// نفس خط النظام (IBM Plex Sans Arabic) — بيتحمّل جوّه الروشتة نفسها والطباعة بتستنى لحد ما يجهز
const FONT_HREF = 'https://fonts.googleapis.com/css2?family=IBM+Plex+Sans+Arabic:wght@400;500;600;700&display=swap';

// ستايل الروشتة متقيّد بـ .rxp عشان تتحط في نفس ملف طباعة التشخيص (printDiagnosis) من غير ما تلخبط ستايل الشيتات.
// شكل الروشتة: شريط علوي باسم الدكتور واللوجو، وأرقام التواصل، وبيانات المريض، وR/ بالأدوية، والمطلوب من أشعة/سونار وتحاليل، والتوقيع، والعناوين تحت.
export const RX_CSS = `
  .rxp { font-family: "IBM Plex Sans Arabic", "Segoe UI", Tahoma, sans-serif; color: #10182f; background: #fff; font-size: 13px; line-height: 1.6;
    -webkit-print-color-adjust: exact; print-color-adjust: exact; display: flex; flex-direction: column; min-height: 180mm; }
  .rxp .ltr { direction: ltr; text-align: left; unicode-bidi: isolate; }
  .rxp .top { display: flex; align-items: center; gap: 12px; padding: 12px 14px; border-radius: 12px; color: #fff;
    background: linear-gradient(135deg, #1b2a54 0%, #24427a 100%); }
  .rxp .top img { width: 46px; height: 46px; background: #fff; border-radius: 10px; padding: 4px; flex: none; }
  .rxp .top .ar { flex: 1; min-width: 0; }
  .rxp .top h1 { margin: 0; font-size: 19px; font-weight: 700; color: #fff; }
  .rxp .top .t { font-size: 12.5px; opacity: .9; }
  .rxp .top .en { direction: ltr; text-align: left; font-size: 11.5px; opacity: .92; line-height: 1.45; }
  .rxp .top .en b { font-size: 13px; }
  .rxp .tel { display: flex; flex-wrap: wrap; justify-content: center; gap: 4px 14px; margin: 6px 0 0; padding: 5px 10px; border-radius: 8px;
    background: #e6f4f1; color: #0f5f55; font-size: 12px; font-weight: 600; }
  .rxp .tel span { white-space: nowrap; }
  .rxp .pt { display: grid; grid-template-columns: 1.6fr 1fr 1fr 1fr; gap: 2px 10px; margin: 10px 0 6px; padding: 7px 10px; border: 1px solid #d7deea; border-radius: 10px; font-size: 12.5px; }
  .rxp .pt span { color: #64748b; }
  .rxp .pt b { color: #1b2a54; }
  .rxp .dx { margin: 4px 0 6px; padding: 6px 10px; border-inline-start: 4px solid #1b2a54; background: #f3f5fa; border-radius: 6px; font-size: 12.5px; white-space: pre-line; }
  .rxp .rx { font-size: 30px; font-weight: 700; color: #c2410c; font-family: Georgia, "Times New Roman", serif; margin: 6px 0 2px; direction: ltr; text-align: left; }
  .rxp .li { display: flex; gap: 8px; align-items: flex-start; padding: 6px 0; border-bottom: 1px dashed #e2e8f0; }
  .rxp .li:last-child { border-bottom: 0; }
  .rxp .li > .n { flex: none; width: 22px; height: 22px; border-radius: 50%; background: #1b2a54; color: #fff; font-size: 11.5px; font-weight: 700; display: grid; place-items: center; }
  .rxp .li > .b { flex: 1; min-width: 0; }
  .rxp .med { direction: ltr; text-align: left; font-weight: 700; font-size: 14.5px; color: #10182f; }
  .rxp .sig { color: #334155; font-size: 12.5px; }
  .rxp .sig i { color: #64748b; }
  .rxp .box { margin-top: 10px; border-radius: 10px; padding: 7px 10px; border: 1px solid; }
  .rxp .box h3 { margin: 0 0 4px; font-size: 13px; }
  .rxp .box.img { border-color: #f5c77e; background: #fff8eb; } .rxp .box.img h3 { color: #a35a00; }
  .rxp .box.lab { border-color: #9fd8cf; background: #effaf7; } .rxp .box.lab h3 { color: #0f5f55; }
  .rxp .box.ins { border-color: #c7d2fe; background: #f5f7ff; } .rxp .box.ins h3 { color: #1b2a54; }
  .rxp .chips { display: flex; flex-wrap: wrap; gap: 4px 6px; }
  .rxp .chips span { padding: 1px 8px; border-radius: 999px; background: #fff; border: 1px solid #cbd5e1; font-size: 12px; }
  .rxp .fu { margin-top: 10px; font-weight: 700; color: #1b2a54; }
  .rxp .grow { flex: 1; }
  .rxp .sign { display: flex; justify-content: flex-end; margin-top: 16px; }
  .rxp .sign div { min-width: 46%; text-align: center; border-top: 1px solid #94a3b8; padding-top: 4px; font-size: 12px; color: #475569; }
  .rxp footer { margin-top: 12px; padding-top: 6px; border-top: 3px solid #1b2a54; display: grid; grid-template-columns: 1fr 1fr; gap: 6px 12px; font-size: 10.5px; color: #475569; }
  .rxp footer b { color: #1b2a54; font-size: 11px; }
`;

export function rxPageHtml(c: Omit<Consultation, 'id' | 'patientId'>, p?: RxPatient | null): string {
  const meds = c.medications.filter((m) => m.name.trim());
  const labs = c.labs.filter(Boolean);
  const imgs = c.imagingRequests.filter((r) => r.region.trim() || r.view.trim());
  const logo = typeof location !== 'undefined' ? `${location.origin}/brand/logo.svg` : '/brand/logo.svg';
  return `<div class="rxp" dir="rtl">
<div class="top">
  <img src="${logo}" alt="">
  <div class="ar"><h1>${esc(DOCTOR.name)}</h1><div class="t">${esc(DOCTOR.title)}</div></div>
  <div class="en"><b>Dr. Islam Gomaa Beltagy</b><br>Consultant of Orthopedic<br>&amp; Trauma Surgery</div>
</div>
<div class="tel">${DOCTOR.phones.map((t) => `<span>☎ ${esc(t.label)}: <bdi class="ltr">${esc(t.number)}</bdi></span>`).join('')}</div>
<div class="pt">
  <div><span>الاسم:</span> <b>${esc(p?.fullName ?? '—')}</b></div>
  <div><span>السن:</span> <b>${esc(ageOf(p?.birthDate ?? '') || '—')}</b></div>
  <div><span>رقم الملف:</span> <b>${esc(fileNoText(p?.fileNo) || '—')}</b></div>
  <div><span>التاريخ:</span> <b>${esc(fmtDate(c.date))}</b></div>
</div>
${c.diagnosis.trim() ? `<div class="dx">التشخيص: <b>${esc(c.diagnosis)}</b>${c.icd10 ? ` <span class="ltr">(${esc(c.icd10)})</span>` : ''}${c.region ? ` — ${esc(c.region)}${c.side !== 'na' ? ' ' + esc(SIDE[c.side]) : ''}` : ''}</div>` : ''}
${meds.length ? `<div class="rx">R/</div><div>${meds.map((m, i) => `<div class="li"><span class="n">${i + 1}</span><div class="b"><div class="med">${esc(m.name)}</div><div class="sig">${esc([m.dose, m.frequency, m.duration && 'لمدة ' + m.duration].filter(Boolean).join(' — '))}${m.notes ? ` <i>(${esc(m.notes)})</i>` : ''}</div></div></div>`).join('')}</div>` : ''}
${imgs.length ? `<div class="box img"><h3>الأشعة / السونار المطلوبة</h3>${imgs.map((r) => `<div>• ${esc(IMAGING_KIND[r.kind])} — ${esc(r.region)}${r.view ? ` <span class="ltr">(${esc(r.view)})</span>` : ''}</div>`).join('')}</div>` : ''}
${labs.length ? `<div class="box lab"><h3>التحاليل المطلوبة</h3><div class="chips ltr">${labs.map((l) => `<span>${esc(l)}</span>`).join('')}</div></div>` : ''}
${c.plan.trim() ? `<div class="box ins"><h3>التعليمات</h3><div>${esc(c.plan).replace(/\n/g, '<br>')}</div></div>` : ''}
${c.followUp ? `<div class="fu">ميعاد المتابعة: ${esc(fmtDate(c.followUp))}</div>` : ''}
<div class="grow"></div>
<div class="sign"><div>توقيع الطبيب</div></div>
<footer>${PLACES.map((pl) => `<div><b>${esc(pl.name)}</b><br>${esc(pl.address)}<br>${esc(pl.days)} — ${esc(pl.hours)}<br>☎ <bdi class="ltr">${pl.phones.map(esc).join(' • ')}</bdi></div>`).join('')}</footer>
</div>`;
}

export function rxHtml(c: Omit<Consultation, 'id' | 'patientId'>, p?: RxPatient | null): string {
  return `<!doctype html><html lang="ar" dir="rtl"><head><meta charset="utf-8"><title>روشتة — ${esc(p?.fullName)}</title>
<link rel="stylesheet" href="${FONT_HREF}">
<style>
  @page { size: A5; margin: 12mm; }
  * { box-sizing: border-box; }
  :root { color-scheme: light; }
  body { background: #fff; margin: 0; }
${RX_CSS}
</style></head><body>${rxPageHtml(c, p)}</body></html>`;
}

// win = تابة الطباعة لو اتفتحت قبل كده وقت الضغطة (زي «حفظ وطباعة الروشتة» اللي بيستنى الحفظ الأول)؛ من غيرها بتتفتح دلوقتي
export function printRx(c: Omit<Consultation, 'id' | 'patientId'>, p?: RxPatient | null, win?: Window | null) {
  void printHtml(rxHtml(c, p), win === undefined ? openPrintWindow() : win);
}
