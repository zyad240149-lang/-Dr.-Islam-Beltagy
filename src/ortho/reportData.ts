// ١٢/١١: «التقارير» — إفادة طبية على ورقة العيادة (نفس صورة الروشتة): طباعة + حفظ صورة على الموبايل + إرسال واتساب (محادثة فاضية والطبيب يبعت الصورة)
// الخانات بتتحفظ في شيت الكشف (rep.*) فبتفضل مع الكشف لو اتفتح تاني.
import type { ExamSheet } from './data';
import { fileNoText } from '../utils/phoneUtils';
import { REQ_CSS, deliverRequestImage, renderLetterImage, type ReqImage, type ReqPatient } from './requestData';

export interface ReportFields { visitDate: string; diagnosis: string; needs: string; nextDate: string; issueDate: string }
const esc = (v: unknown) => String(v ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]!));
const dmy = (ymd: string) => (ymd ? ymd.split('-').reverse().join('/') : '../../….');
const dayName = (ymd: string) => (ymd ? new Intl.DateTimeFormat('ar-EG', { weekday: 'long' }).format(new Date(ymd + 'T00:00:00')) : '……………');
const ageOf = (birth?: string | null) => {
  if (!birth) return '';
  const b = new Date(birth + 'T00:00:00'); if (isNaN(b.getTime())) return '';
  const n = new Date(); let y = n.getFullYear() - b.getFullYear();
  if (n.getMonth() < b.getMonth() || (n.getMonth() === b.getMonth() && n.getDate() < b.getDate())) y--;
  return y >= 0 ? String(y) : '';
};

/** خانات التقرير من شيت الكشف — والفاضي بياخد من الكشف نفسه (التشخيص/ميعاد المتابعة/تاريخ الكشف) */
export function reportFields(s: ExamSheet, d: { date: string; diagnosis?: string; followUp?: string | null; today: string }): ReportFields {
  const t = (k: string) => (s.txt[k] ?? '').trim();
  return {
    visitDate: t('rep.visit') || d.date,
    diagnosis: t('rep.dx') || (d.diagnosis ?? ''),
    needs: t('rep.needs'),
    nextDate: t('rep.next') || (d.followUp ?? ''),
    issueDate: t('rep.issue') || d.today,
  };
}

export const REPORT_CSS = `
  .rpp .bd { direction: rtl !important; gap: 8px !important; font-size: 13px; line-height: 1.95; color: #10182f; }
  .rpp .rp-p { margin: 0; text-align: justify; }
  .rpp .rp-v { font-weight: 800; color: #0d2a6b; }
  .rpp .rp-box { border: 1px solid #c9d6ea; border-radius: 9px; padding: 4px 10px; background: rgba(255,255,255,.9); white-space: pre-line; font-weight: 700; color: #0d2a6b; min-height: 30px; }
  .rpp .rp-sign { margin-top: auto; align-self: flex-start; text-align: center; font-weight: 800; color: #0d2a6b; line-height: 1.6; }
  .rpp .rp-sign small { display: block; font-weight: 600; color: #334155; }
  .rpp .rp-iss { font-size: 11.5px; color: #475569; }
`;

export function reportPageHtml(r: ReportFields, p: ReqPatient | null | undefined): string {
  const age = ageOf(p?.birthDate), file = fileNoText(p?.fileNo) || '';
  const extra = [age && `${age} سنة`, file && `ملف ${file}`].filter(Boolean).join(' · ');
  const v = (x: string) => `<span class="rp-v">${esc(x)}</span>`;
  return `<div class="rqp rpp" dir="rtl">
<img class="bg" src="${location.origin}/rx/letterhead.jpg" alt="">
<div class="f nm"><span>${esc(p?.fullName || '')}</span>${extra ? `<small>${esc(extra)}</small>` : ''}</div>
<div class="f dt">${esc(dmy(r.issueDate))}</div>
<div class="f norx"></div>
<div class="f bd">
<div class="ttl">إفادة طبية</div>
<p class="rp-p">المريض المذكور بياناته أعلاه قد حضر إلى العيادة يوم ${v(dayName(r.visitDate))} الموافق ${v(dmy(r.visitDate))}.</p>
<p class="rp-p">وبعد توقيع الكشف الطبي وإجراء الفحوصات الطبية اللازمة، تبيّن أن المريض يعاني من:</p>
<div class="rp-box">${esc(r.diagnosis) || '&nbsp;'}</div>
<p class="rp-p">ويحتاج إلى:</p>
<div class="rp-box">${esc(r.needs) || '&nbsp;'}</div>
<p class="rp-p">وذلك وفقًا لما تقتضيه حالته الصحية والتقييم الطبي.</p>
<p class="rp-p">كما يُوصى بإعادة العرض مرة أخرى بتاريخ ${v(dmy(r.nextDate))}، لمتابعة الحالة وتقييم مدى الاستجابة للعلاج واستكمال الخطة العلاجية.</p>
<p class="rp-p">وقد أُعطيت هذه الإفادة بناءً على طلب المريض لتقديمها إلى من يهمه الأمر.</p>
<div class="rp-sign">د. إسلام جمعة بلتاجي<small>استشاري جراحة العظام</small><span class="rp-iss">تاريخ إصدار التقرير: ${esc(dmy(r.issueDate))}</span></div>
</div>
</div>`;
}

export function reportHtml(r: ReportFields, p: ReqPatient | null | undefined): string {
  return `<!doctype html><html lang="ar" dir="rtl"><head><meta charset="utf-8"><title>إفادة طبية — ${esc(p?.fullName)}</title>
<link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=Cairo:wght@500;600;700;800&display=swap">
<style>@page { size: A5; margin: 0; } body { margin: 0; } ${REQ_CSS} ${REPORT_CSS}</style></head><body>${reportPageHtml(r, p)}</body></html>`;
}

// صورة التقرير بتتجهز مقدمًا (زي صورة الطلب) عشان الحفظ يحصل في نفس الضغطة على الموبايل
let cache: ReqImage | null = null;
let pending: Promise<ReqImage> | null = null;
let pendingKey = '';
const fileName = (p: ReqPatient | null | undefined, r: ReportFields) => `Medical-Report-${(p?.fileNo || '').replace(/[^A-Za-z0-9-]/g, '') || 'patient'}-${r.issueDate}-${Date.now().toString().slice(-5)}.png`;
export function prepareReportImage(r: ReportFields, p: ReqPatient | null | undefined): Promise<ReqImage> {
  const html = reportPageHtml(r, p);
  if (cache?.key === html) return Promise.resolve(cache);
  if (pending && pendingKey === html) return pending;
  pendingKey = html;
  pending = renderLetterImage(html, fileName(p, r), REPORT_CSS).then((img) => { cache = img; return img; }).finally(() => { pending = null; });
  return pending;
}
export const readyReportImage = (r: ReportFields, p: ReqPatient | null | undefined) => (cache?.key === reportPageHtml(r, p) ? cache : null);
export const deliverReportImage = deliverRequestImage;
