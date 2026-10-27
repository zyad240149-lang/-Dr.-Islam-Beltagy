// طباعة / PDF التشخيص: الشيتين متعبّيين بنفس شكل الورق — «شيت التمريض» و«Hip & Knee Consultation Sheet» (A4 بالعرض،
// الخانات المتعلّمة ✓ والمكتوب على السطور) — والروشتة (A5). المستخدم بيختار أجزاء منهم أو الكل.
// كشف قديم من غير شيت بيطلع ملخصه النصي. الطباعة في تابة لوحدها (utils/printDoc).
import { DOCTOR } from '../landing/content';
import { fileNoText } from '../utils/phoneUtils';
import { fmtDate } from '../utils/format';
import { SIDE, type Consultation, type ExamSheet } from './data';
import { SHEET_LISTS as L, bmiOf, normSheet, painLabel, sheetHasContent } from './ExamSheet';
import { RX_CSS, rxPageHtml } from './printRx';
import { openPrintWindow, printHtml } from '../utils/printDoc';

type DxConsult = Omit<Consultation, 'id'> & { id?: string };
export interface DxPatient { fullName: string; fileNo?: string | null; birthDate?: string | null }

export type DxPart = 'nurse' | 'doctor' | 'rx';
export const DX_PARTS: { id: DxPart; label: string }[] = [
  { id: 'nurse', label: 'شيت التمريض' }, { id: 'doctor', label: 'كشف الطبيب — الورك والركبة' }, { id: 'rx', label: 'الروشتة والأشعة والتحاليل' },
];
/** فيه روشتة تتطبع؟ (أدوية/تحاليل/أشعة مطلوبة/تعليمات/متابعة) */
export const hasRx = (c: DxConsult) => c.medications.some((m) => m.name.trim()) || c.labs.length > 0
  || c.imagingRequests.some((r) => r.region.trim()) || !!c.plan.trim() || !!c.followUp;

const esc = (s: unknown) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]!));
const FONT_HREF = 'https://fonts.googleapis.com/css2?family=IBM+Plex+Sans:wght@400;600;700&family=IBM+Plex+Sans+Arabic:wght@400;600;700&display=swap';

function sheetPages(c: DxConsult, p: DxPatient | null | undefined, visitNo?: number) {
  const s: ExamSheet = normSheet(c.sheet);
  const has = (g: string, i: string) => s.on.includes(`${g}|${i}`);
  const v = (k: string) => esc((s.txt[k] ?? '').trim());
  const ck = (on: boolean, label: string) => `<span class="ck${on ? ' on' : ''}"><i>${on ? '✓' : ''}</i>${esc(label)}</span>`;
  const cks = (g: string, items: string[]) => items.map((i) => ck(has(g, i), i)).join('');
  const line = (label: string, val: string) => `<div class="ln"><b>${esc(label)}</b><span>${val || '&nbsp;'}</span></div>`;
  const box = (n: number, title: string, body: string, cls = '') => `<section class="box ${cls}"><h3><span>${n}</span>${title}</h3><div class="bd">${body}</div></section>`;
  const name = v('n.name') || esc(p?.fullName ?? '');
  const fileNo = esc(fileNoText(p?.fileNo) || '');
  const date = esc(fmtDate(c.date));
  const dmy = (ymd: string) => esc(ymd.split('-').reverse().join('/')); // صفحة الإنجليزي: 27/10/2026
  const head = (title: string, sub: string) => `<header>
    <img src="${location.origin}${import.meta.env.BASE_URL}landing/logo.png" alt="">
    <div class="brand"><b>${esc(DOCTOR.name)}</b><span>${esc(DOCTOR.title)}</span></div>
    <div class="title">${title}${sub ? `<small>${sub}</small>` : ''}</div>
  </header>`;

  // ---------- صفحة 1: شيت التمريض ----------
  const meds = s.meds.filter((m) => m.name.trim());
  const nurse = `<div class="page shp" dir="rtl">
  ${head('شيت التمريض', 'يملأ بواسطة التمريض قبل دخول المريض')}
  <div class="bar">${cks('n.visit', L.N_VISIT)}<span>اسم المريض: <b>${name || '—'}</b></span><span>رقم الملف: <b>${fileNo || '—'}</b></span><span>رقم الزيارة: <b>${visitNo ?? '—'}</b></span><span>التاريخ: <b>${date}</b></span></div>
  <div class="grid g4">
    ${box(1, 'البيانات الأساسية', `${line('الاسم', name)}${line('السن', v('n.age'))}<div class="row"><b>النوع</b>${cks('n.gender', L.N_GENDER)}</div>${line('رقم الهاتف', `<bdi>${v('n.phone')}</bdi>`)}${line('العنوان', v('n.address'))}${line('المهنة', v('n.job'))}<div class="row"><b>الحالة الاجتماعية</b>${cks('n.marital', L.N_MARITAL)}</div>${line('اسم المرافق', v('n.compName'))}${line('رقم المرافق', `<bdi>${v('n.compPhone')}</bdi>`)}`)}
    ${box(2, 'العلامات الحيوية والقياسات', `${line('ضغط الدم', [v('n.bp.sys'), v('n.bp.dia')].some(Boolean) ? `<bdi>${v('n.bp.sys')} / ${v('n.bp.dia')} mmHg</bdi>` : '')}${line('النبض', v('n.pulse') && `${v('n.pulse')} / دقيقة`)}${line('درجة الحرارة', v('n.temp') && `${v('n.temp')} °C`)}${line('معدل التنفس', v('n.rr') && `${v('n.rr')} / دقيقة`)}${line('الوزن', v('n.wt') && `${v('n.wt')} كجم`)}${line('الطول', v('n.ht') && `${v('n.ht')} سم`)}${line('مؤشر كتلة الجسم (BMI)', bmiOf(s))}`)}
    ${box(3, 'التاريخ المرضي المعروف', `<div class="cols2">${cks('n.hx', L.N_HX)}</div><div class="row"><b>التدخين</b>${cks('n.smoke', L.YES_NO)}</div>${line('أخرى', v('n.hx.other'))}`)}
    ${box(4, 'الأدوية الحالية والحساسية', `<table><thead><tr><th>اسم الدواء</th><th>الجرعة</th><th>عدد المرات</th></tr></thead><tbody>${(meds.length ? meds : [{ name: '', dose: '', freq: '' }]).map((m) => `<tr><td>${esc(m.name)}</td><td>${esc(m.dose)}</td><td>${esc(m.freq)}</td></tr>`).join('')}</tbody></table><div class="lbl">الحساسية</div>${cks('n.allergy', L.N_ALLERGY)}${line('مواد أخرى', v('n.allergy.other'))}${line('التفاصيل', v('n.allergy.details'))}`)}
    ${box(5, 'سبب الزيارة الحالية ومكان الألم وتفاصيل المشكلة', `<div class="g3">
      <div><div class="lbl">الشكوى</div>${cks('n.cc', L.N_CC)}${line('أخرى', v('n.cc.other'))}</div>
      <div><div class="lbl">مكان الألم</div>${s.pain.length ? `<ul>${s.pain.map((k) => `<li>${esc(painLabel(k))}</li>`).join('')}</ul>` : '<div class="ln"><span>&nbsp;</span></div>'}
        <div class="lbl">شدة الألم حاليًا (من 10)</div><div class="vas">${Array.from({ length: 11 }, (_, n) => `<span class="${c.painScore === n ? 'on' : ''}">${n}</span>`).join('')}</div></div>
      <div><div class="lbl">منذ متى؟</div>${cks('n.since', L.N_SINCE)}${line('بداية المشكلة / كيفية حدوثها', v('n.onset'))}<div class="row"><b>هل توجد إصابة حديثة؟</b>${cks('n.injury', L.YES_NO)}</div>${line('إذا نعم، ما هي؟', v('n.injury.what'))}${line('ماذا تم عمله حتى الآن؟', v('n.done'))}</div>
    </div>`, 'wide')}
  </div>
</div>`;

  // ---------- صفحة 2: Hip & Knee ----------
  const rtLt = (k: string) => `<td>${v(k + '.rt')}</td><td>${v(k + '.lt')}</td>`;
  const sex = has('n.gender', 'ذكر') ? 'M' : has('n.gender', 'أنثى') ? 'F' : '';
  const dr = `<div class="page shp" dir="ltr">
  ${head('HIP &amp; KNEE CONSULTATION SHEET', '')}
  <div class="bar">Patient Name: <b>${name || '—'}</b><span>Age: <b>${v('n.age') || '—'}</b></span><span>Sex: ${ck(sex === 'M', 'M')}${ck(sex === 'F', 'F')}</span><span>Date: <b>${dmy(c.date)}</b></span><span>File No.: <b>${fileNo || '—'}</b></span></div>
  <div class="grid g4">
    ${box(1, 'Chief Complaint', `<div class="two"><div>${cks('x.cc', L.X_CC)}${line('Other:', v('x.cc.other'))}</div><div><div class="lbl">Duration:</div>${cks('x.dur', L.X_DUR)}</div></div>`)}
    ${box(2, 'History of Present Illness', `<div class="row"><b>Side:</b>${L.X_SIDE.map(([k, l]) => ck(c.side === k, l)).join('')}</div><div class="row"><b>Onset:</b>${cks('x.onset', L.X_ONSET)}</div><div class="row"><b>Course:</b>${cks('x.course', L.X_COURSE)}</div>${line('Aggravating factors:', v('x.aggr'))}${line('Relieving factors:', v('x.reliev'))}<div class="lbl">Previous treatment:</div><div class="row">${cks('x.prev', L.X_PREV)}</div>${line('Other:', v('x.prev.other'))}`)}
    ${box(3, '⚠ Red Flags', `${cks('x.rf', L.X_RF)}${line('Others:', v('x.rf.other'))}`, 'red')}
    ${box(4, 'Dermatomes (Sensation Map)', `<table><thead><tr><th>Root</th><th>Key area</th><th>Rt.</th><th>Lt.</th></tr></thead><tbody>${L.X_DERM.map(([r, area, color]) => `<tr><td><i class="sw" style="background:${color}"></i>${r}</td><td>${esc(area)}</td><td>${has('x.derm', `${r} Rt`) ? '✓' : ''}</td><td>${has('x.derm', `${r} Lt`) ? '✓' : ''}</td></tr>`).join('')}</tbody></table><div class="note">✓ = reduced / lost sensation</div>`)}
    ${box(5, 'Palpation', `<div class="two"><div><div class="lbl">Hip</div>${cks('x.palp.hip', L.X_PALP_HIP)}${line('Other:', v('x.palp.hip.other'))}</div><div><div class="lbl">Knee</div>${cks('x.palp.knee', L.X_PALP_KNEE)}${line('Other:', v('x.palp.knee.other'))}</div></div>`)}
    ${box(6, 'Range of Motion', `<table><thead><tr><th>Hip Motion</th><th>Normal</th><th>Rt.</th><th>Lt.</th></tr></thead><tbody>${L.X_ROM_HIP.map(([m, n]) => `<tr><td>${m}</td><td>${n}</td>${rtLt(`x.rom.hip.${m}`)}</tr>`).join('')}</tbody></table><table><thead><tr><th>Knee Motion</th><th>Normal</th><th>Rt.</th><th>Lt.</th></tr></thead><tbody>${L.X_ROM_KNEE.map(([m, n]) => `<tr><td>${m}</td><td>${n}</td>${rtLt(`x.rom.knee.${m}`)}</tr>`).join('')}</tbody></table><div class="row"><b>Patellar mobility:</b>${cks('x.patmob', L.X_PATMOB)}</div><div class="row">${cks('x.sprom', L.X_SPROM)}</div>${line('Other:', v('x.sprom.other'))}`)}
    ${box(7, 'Neurological Examination', `<table><thead><tr><th>Motor Power (MRC)</th><th>Rt.</th><th>Lt.</th></tr></thead><tbody>${L.X_MRC.map(([r, m]) => `<tr><td>${r} (${m})</td><td>${v(`x.mrc.${r}.rt`) && v(`x.mrc.${r}.rt`) + '/5'}</td><td>${v(`x.mrc.${r}.lt`) && v(`x.mrc.${r}.lt`) + '/5'}</td></tr>`).join('')}</tbody></table><table><thead><tr><th>Reflexes</th><th>Rt.</th><th>Lt.</th></tr></thead><tbody>${L.X_REFLEX.map(([n, root]) => `<tr><td>${n} (${root})</td>${rtLt(`x.refl.${n}`)}</tr>`).join('')}</tbody></table>`)}
    ${box(8, 'Special Tests (+ve)', `<div class="two"><div><div class="lbl">Hip</div>${cks('x.st.hip', L.X_ST_HIP)}${line('Other:', v('x.st.hip.other'))}</div><div><div class="lbl">Knee</div>${cks('x.st.knee', L.X_ST_KNEE)}${line('Other:', v('x.st.knee.other'))}</div></div>`)}
    ${box(9, 'Imaging / Investigations', `${L.X_IMG.map((m) => `<div class="row">${ck(has('x.img', m), m + ':')}<span class="fill">${v(`x.img.${m}`)}</span><span>Date: ${v(`x.img.${m}.date`) ? dmy(v(`x.img.${m}.date`)) : '__ / __ / __'}</span></div>`).join('')}${line('Previous imaging:', v('x.img.prev'))}${line('Others:', v('x.img.other'))}`)}
    ${box(10, 'Diagnosis (Likely / Working)', `<div class="two"><div><div class="lbl">Hip</div>${cks('x.dx.hip', L.X_DX_HIP)}</div><div><div class="lbl">Knee</div>${cks('x.dx.knee', L.X_DX_KNEE)}</div></div>${line('Others:', v('x.dx.other'))}${c.icd10 ? line('ICD-10:', esc(c.icd10)) : ''}`)}
    ${box(11, 'Plan', `${cks('x.plan', L.X_PLAN)}${line('Follow up after:', v('x.plan.fu'))}${line('Others:', v('x.plan.other'))}${c.followUp ? line('Next visit:', dmy(c.followUp)) : ''}`)}
    ${box(12, 'Notes', `<div class="notes">${v('x.notes').replace(/\n/g, '<br>') || '&nbsp;'}</div>`)}
  </div>
</div>`;
  return { nurse, doctor: dr };
}

// كشف قديم (قبل الشيت): ملخصه النصي في صفحة واحدة
function legacyHtml(c: DxConsult, p: DxPatient | null | undefined) {
  const row = (l: string, t: string) => (t.trim() ? `<div class="ln stack"><b>${l}</b><span>${esc(t).replace(/\n/g, '<br>')}</span></div>` : '');
  return `<div class="page shp" dir="rtl"><header><div class="brand"><b>${esc(DOCTOR.name)}</b><span>${esc(DOCTOR.title)}</span></div><div class="title">التشخيص</div></header>
  <div class="bar"><span>اسم المريض: <b>${esc(p?.fullName ?? '—')}</b></span><span>رقم الملف: <b>${esc(fileNoText(p?.fileNo) || '—')}</b></span><span>التاريخ: <b>${esc(fmtDate(c.date))}</b></span><span>المنطقة: <b>${esc(c.region)}${c.side !== 'na' ? ' ' + esc(SIDE[c.side]) : ''}</b></span></div>
  <div class="legacy">${row('الشكوى', c.complaint)}${row('التاريخ المرضي', c.history)}${row('الفحص', c.examination)}${row('التشخيص', c.diagnosis + (c.icd10 ? ` (${c.icd10})` : ''))}${row('التعليمات', c.plan)}</div></div>`;
}

export function diagnosisHtml(c: DxConsult, p?: DxPatient | null, visitNo?: number, parts: DxPart[] = ['nurse', 'doctor']): string {
  const pages: string[] = [];
  const sheetParts = parts.filter((x) => x !== 'rx');
  if (sheetParts.length) {
    if (sheetHasContent(normSheet(c.sheet))) { const sp = sheetPages(c, p, visitNo); sheetParts.forEach((x) => pages.push(sp[x as 'nurse' | 'doctor'])); }
    else pages.push(legacyHtml(c, p));
  }
  if (parts.includes('rx')) pages.push(`<div class="page rxw">${rxPageHtml(c, p)}</div>`);
  const body = pages.join('');
  return `<!doctype html><html lang="ar"><head><meta charset="utf-8"><title>التشخيص — ${esc(p?.fullName)}</title>
<link rel="stylesheet" href="${FONT_HREF}">
<style>
  @page { size: A4 landscape; margin: 7mm; }
  * { box-sizing: border-box; }
  :root { color-scheme: light; }
  @page rx { size: A5; margin: 12mm; }
  body { background: #fff; margin: 0; }
  .rxw { page: rx; }
  .shp { font-family: "IBM Plex Sans", "IBM Plex Sans Arabic", "Segoe UI", Tahoma, sans-serif; color: #10182f; font-size: 9px; line-height: 1.22; }
  .shp[dir="rtl"] { font-family: "IBM Plex Sans Arabic", "IBM Plex Sans", "Segoe UI", Tahoma, sans-serif; }
  /* على الشاشة (معاينة ملف المريض / تابة الطباعة قبل ما تطبع): صفحات بيضا بمقاس الورق على خلفية رمادي */
  @media screen {
    body { background: #e9edf3; padding: 14px 0; }
    .page { background: #fff; margin: 0 auto 14px; box-shadow: 0 1px 4px rgba(16, 24, 47, .15); border-radius: 4px; }
    .shp { width: 1124px; padding: 26px; }
    .rxw { width: 560px; padding: 45px; }
  }
  /* PDF: كل صفحة بعرض المساحة المطبوعة بتاعتها (A4 بالعرض / A5) وبتتصوّر لوحدها */
  .pdf body { background: #fff; padding: 0; }
  .pdf .page { box-shadow: none; border-radius: 0; }
  .pdf .shp { width: 1070px; }
  .pdf .rxw { width: 469px; }
  .pdf .page { margin-bottom: 24px; padding: 4px; }
  .page { break-after: page; }
  .page:last-child { break-after: auto; }
  .shp header { display: flex; align-items: center; gap: 12px; border-bottom: 2.5px solid #1b4f8f; padding-bottom: 4px; margin-bottom: 5px; }
  .shp header img { width: 32px; height: 32px; object-fit: contain; }
  .shp header .brand b { display: block; font-size: 13.5px; color: #1b4f8f; }
  .shp header .brand span { display: block; font-size: 9.5px; color: #475569; }
  .shp header .title { flex: 1; text-align: center; background: #1b4f8f; color: #fff; border-radius: 7px; padding: 4px 10px; font-weight: 700; font-size: 13px; letter-spacing: .3px; }
  .shp[dir="rtl"] header .title { letter-spacing: 0; }
  .shp header .title small { display: block; font-weight: 500; font-size: 9.5px; opacity: .9; }
  .bar { display: flex; flex-wrap: wrap; align-items: center; gap: 4px 20px; background: #eef4fb; border: 1px solid #c7dcf2; border-radius: 7px; padding: 3px 10px; margin-bottom: 5px; font-size: 10px; }
  .bar b { color: #1b4f8f; }
  .grid { display: grid; gap: 4px; }
  .g4 { grid-template-columns: repeat(4, minmax(0, 1fr)); }
  .box { border: 1.3px solid #1b4f8f; border-radius: 7px; overflow: hidden; break-inside: avoid; }
  .box.wide { grid-column: 1 / -1; }
  .box.red { border-color: #c4372d; }
  .box h3 { display: flex; align-items: center; gap: 6px; margin: 0; background: #1b4f8f; color: #fff; font-size: 10px; padding: 2px 7px; }
  .box.red h3 { background: #c4372d; }
  .box h3 span { display: inline-grid; place-items: center; min-width: 16px; height: 16px; border-radius: 4px; background: rgba(0, 0, 0, .25); font-size: 9.5px; }
  .bd { padding: 4px 6px; }
  .ck { display: flex; align-items: center; gap: 4px; margin-bottom: 1px; color: #334155; }
  .ck i { display: inline-grid; place-items: center; width: 9px; height: 9px; border: 1.1px solid #334155; border-radius: 2px; font-style: normal; font-size: 8px; line-height: 1; flex: none; }
  .ck.on { color: #10182f; font-weight: 700; }
  .ck.on i { background: #1b4f8f; border-color: #1b4f8f; color: #fff; }
  .row .ck, .bar .ck { display: inline-flex; margin: 0; }
  .row { display: flex; flex-wrap: wrap; align-items: center; gap: 2px 9px; margin-bottom: 2px; }
  .row > b, .ln > b, .lbl { color: #1b4f8f; font-weight: 700; }
  .lbl { margin: 3px 0 1px; }
  .ln { display: flex; gap: 5px; align-items: baseline; margin: 1px 0; }
  .ln > b { flex: none; }
  .ln > span { flex: 1; min-height: 11px; border-bottom: 1px solid #94a3b8; font-weight: 600; }
  .ln.stack { display: block; margin: 0 0 8px; font-size: 12px; }
  .ln.stack > span { display: block; border: 0; font-weight: 400; }
  .fill { flex: 1; min-width: 50px; border-bottom: 1px solid #94a3b8; font-weight: 600; }
  .two { display: grid; grid-template-columns: 1fr 1fr; gap: 0 8px; }
  .g3 { display: grid; grid-template-columns: 1fr 1fr 1.4fr; gap: 0 14px; }
  .cols2 { columns: 2; column-gap: 8px; }
  .shp table { width: 100%; border-collapse: collapse; margin: 1px 0 4px; }
  .shp th, .shp td { border: 1px solid #cbd5e1; padding: 1px 4px; text-align: center; font-size: 8.5px; }
  .shp th { background: #eef4fb; color: #1b4f8f; }
  .shp th:first-child, .shp td:first-child { text-align: start; }
  .shp td { height: 12px; font-weight: 600; }
  .sw { display: inline-block; width: 7px; height: 7px; border-radius: 2px; margin-inline-end: 4px; }
  .note { font-size: 8.5px; color: #64748b; }
  .shp ul { margin: 0 0 3px; padding-inline-start: 14px; font-weight: 600; }
  .vas { display: flex; gap: 2px; margin: 2px 0; }
  .vas span { width: 15px; height: 15px; display: grid; place-items: center; border: 1px solid #94a3b8; border-radius: 3px; font-size: 9px; }
  .vas span.on { background: #c4372d; border-color: #c4372d; color: #fff; font-weight: 700; }
  .notes { min-height: 50px; font-weight: 600; white-space: normal; }
  .legacy { padding: 8px 4px; }
${RX_CSS}
</style></head><body>${body}</body></html>`;
}

// iframe بالمحتوى (لتصوير صفحات الـ PDF) + استنّى الخطوط (حد أقصى 2.5 ثانية لو مفيش إنترنت) والصور
async function loadFrame(html: string, cssText: string) {
  const f = document.createElement('iframe');
  f.setAttribute('aria-hidden', 'true');
  f.style.cssText = cssText;
  document.body.appendChild(f);
  const doc = f.contentDocument!;
  doc.open(); doc.write(html); doc.close();
  const fontsReady = doc.fonts?.ready ?? Promise.resolve();
  await Promise.race([fontsReady.then(() => doc.fonts?.load('700 12px "IBM Plex Sans Arabic"')), new Promise((r) => setTimeout(r, 2500))]).catch(() => undefined);
  await Promise.all(Array.from(doc.images).map((img) => (img.complete ? null : new Promise((r) => { img.onload = r; img.onerror = r; }))));
  return f;
}

/** لازم تتنادى من الضغطة نفسها (بتفتح تابة الطباعة على طول) */
export function printDiagnosis(c: DxConsult, p?: DxPatient | null, visitNo?: number, parts?: DxPart[]) {
  void printHtml(diagnosisHtml(c, p, visitNo, parts), openPrintWindow());
}

/** نفس الصفحات كملف PDF: الشيتات A4 بالعرض والروشتة A5 — كل صفحة صورة بتتظبط على المساحة المطبوعة */
export async function buildDiagnosisPdf(c: DxConsult, p?: DxPatient | null, visitNo?: number, parts?: DxPart[]): Promise<Blob> {
  const [{ default: html2canvas }, { jsPDF }] = await Promise.all([import('html2canvas'), import('jspdf')]);
  const html = diagnosisHtml(c, p, visitNo, parts).replace('<html lang="ar">', '<html lang="ar" class="pdf">');
  const f = await loadFrame(html, 'position:fixed;top:0;left:-12000px;width:1200px;height:900px;border:0;');
  try {
    const pages = Array.from(f.contentDocument!.querySelectorAll<HTMLElement>('.page'));
    if (!pages.length) throw new Error('مفيش حاجة تتطبع.');
    let pdf: InstanceType<typeof jsPDF> | null = null;
    for (const el of pages) {
      const rx = el.classList.contains('rxw');
      const [format, orientation, w, h, m] = rx ? ['a5', 'portrait', 148, 210, 12] as const : ['a4', 'landscape', 297, 210, 7] as const;
      const canvas = await html2canvas(el, { scale: 2, useCORS: true, backgroundColor: '#ffffff' });
      if (!pdf) pdf = new jsPDF({ unit: 'mm', format, orientation }); else pdf.addPage(format, orientation);
      const k = Math.min((w - 2 * m) / canvas.width, (h - 2 * m) / canvas.height);
      pdf.addImage(canvas.toDataURL('image/jpeg', 0.92), 'JPEG', (w - canvas.width * k) / 2, m, canvas.width * k, canvas.height * k);
    }
    return pdf!.output('blob');
  } finally { f.remove(); }
}
