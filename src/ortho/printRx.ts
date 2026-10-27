// طباعة روشتة الكشف (أدوية + تحاليل + أشعة مطلوبة + تعليمات) — iframe مخفي عشان الطباعة تشتغل حتى بعد الحفظ (من غير popup)
// بيانات المريض بتتبعت من الشاشة (الإدارة من كاش db، وبوابة المريض من سجله) عشان الملف ده مايسحبش كاش الإدارة كله.
import { DOCTOR } from '../landing/content';
import { fileNoText } from '../utils/phoneUtils';
import { fmtDate } from '../utils/format';
import { IMAGING_KIND, SIDE, type Consultation } from './data';

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

// ستايل الروشتة متقيّد بـ .rxp عشان تتحط في نفس ملف طباعة التشخيص (printDiagnosis) من غير ما تلخبط ستايل الشيتات
export const RX_CSS = `
  .rxp { font-family: "IBM Plex Sans Arabic", "Segoe UI", Tahoma, sans-serif; color: #10182f; background: #fff; font-size: 13px; line-height: 1.6; }
  .rxp header { display: flex; justify-content: space-between; align-items: flex-start; border-bottom: 2px solid #1b2a54; padding-bottom: 8px; }
  .rxp header h1 { margin: 0; font-size: 18px; color: #1b2a54; }
  .rxp header .t { color: #475569; font-size: 12.5px; }
  .rxp header .en { text-align: left; direction: ltr; font-size: 12px; color: #475569; }
  .rxp .pt { display: grid; grid-template-columns: repeat(3, 1fr); gap: 2px 12px; margin: 10px 0; padding: 8px 10px; background: #f3f5fa; border-radius: 8px; font-size: 12.5px; }
  .rxp .pt b { color: #1b2a54; }
  .rxp .dx { margin: 6px 0 10px; font-size: 12.5px; }
  .rxp .rx { font-size: 26px; font-weight: 700; color: #1b2a54; font-family: Georgia, "Times New Roman", serif; margin: 4px 0; direction: ltr; text-align: left; }
  .rxp ol { margin: 0; padding: 0 18px 0 0; }
  .rxp ol li { margin-bottom: 8px; }
  .rxp ul { margin: 0; padding: 0 18px 0 0; }
  .rxp .med { direction: ltr; text-align: left; font-weight: 700; font-size: 14px; }
  .rxp .sig { color: #334155; }
  .rxp h3 { font-size: 13.5px; margin: 12px 0 4px; color: #1b2a54; border-bottom: 1px solid #e2e8f0; padding-bottom: 2px; }
  .rxp .ltr { direction: ltr; text-align: left; }
  .rxp footer { margin-top: 18px; border-top: 1px solid #cbd5e1; padding-top: 6px; font-size: 11px; color: #64748b; display: flex; justify-content: space-between; gap: 8px; }
  .rxp .fu { margin-top: 10px; font-weight: 700; }
`;

export function rxPageHtml(c: Omit<Consultation, 'id' | 'patientId'>, p?: RxPatient | null): string {
  const meds = c.medications.filter((m) => m.name.trim());
  const labs = c.labs.filter(Boolean);
  const imgs = c.imagingRequests.filter((r) => r.region.trim() || r.view.trim());
  const phones = DOCTOR.phones.map((x) => `${esc(x.label)}: <span dir="ltr">${esc(x.number)}</span>`).join(' &nbsp;•&nbsp; ');
  return `<div class="rxp" dir="rtl">
<header>
  <div><h1>${esc(DOCTOR.name)}</h1><div class="t">${esc(DOCTOR.title)}</div></div>
  <div class="en">Orthopedic &amp; Trauma Surgery<br>${esc(fmtDate(c.date))}</div>
</header>
<div class="pt">
  <div>الاسم: <b>${esc(p?.fullName ?? '—')}</b></div>
  <div>رقم الملف: <b>${esc(fileNoText(p?.fileNo) || '—')}</b></div>
  <div>السن: <b>${esc(ageOf(p?.birthDate ?? '') || '—')}</b></div>
</div>
${c.diagnosis.trim() ? `<div class="dx">التشخيص: <b>${esc(c.diagnosis)}</b>${c.icd10 ? ` <span class="ltr">(${esc(c.icd10)})</span>` : ''} — ${esc(c.region)}${c.side !== 'na' ? ' ' + esc(SIDE[c.side]) : ''}</div>` : ''}
${meds.length ? `<div class="rx">R/</div><ol>${meds.map((m) => `<li><div class="med">${esc(m.name)}</div><div class="sig">${esc([m.dose, m.frequency, m.duration && 'لمدة ' + m.duration].filter(Boolean).join(' — '))}${m.notes ? ` <i>(${esc(m.notes)})</i>` : ''}</div></li>`).join('')}</ol>` : ''}
${labs.length ? `<h3>التحاليل المطلوبة</h3><div class="ltr">${labs.map(esc).join(' • ')}</div>` : ''}
${imgs.length ? `<h3>الأشعة المطلوبة</h3><ul>${imgs.map((r) => `<li>${esc(IMAGING_KIND[r.kind])} — ${esc(r.region)}${r.view ? ` <span class="ltr">(${esc(r.view)})</span>` : ''}</li>`).join('')}</ul>` : ''}
${c.plan.trim() ? `<h3>تعليمات</h3><div>${esc(c.plan).replace(/\n/g, '<br>')}</div>` : ''}
${c.followUp ? `<div class="fu">ميعاد المتابعة: ${esc(fmtDate(c.followUp))}</div>` : ''}
<footer><span>${esc(DOCTOR.address)}</span><span>${phones}</span></footer>
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

export function printRx(c: Omit<Consultation, 'id' | 'patientId'>, p?: RxPatient | null) {
  const f = document.createElement('iframe');
  f.setAttribute('aria-hidden', 'true');
  f.style.cssText = 'position:fixed;width:0;height:0;border:0;inset-inline-start:-9999px';
  document.body.appendChild(f);
  const doc = f.contentDocument!;
  doc.open(); doc.write(rxHtml(c, p)); doc.close();
  // الطباعة بعد ما الخط العربي يتحمّل (وإلا الروشتة بتطلع بخط الجهاز)؛ حد أقصى 2.5 ثانية لو مفيش إنترنت
  const fontsReady = doc.fonts?.ready ?? Promise.resolve();
  const wait = Promise.race([fontsReady.then(() => doc.fonts?.load('700 14px "IBM Plex Sans Arabic"')), new Promise((r) => setTimeout(r, 2500))]);
  void wait.catch(() => undefined).then(() => {
    f.contentWindow?.focus();
    f.contentWindow?.print();
    setTimeout(() => f.remove(), 1000);
  });
}
