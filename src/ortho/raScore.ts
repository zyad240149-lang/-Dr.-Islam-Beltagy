// معايير تصنيف التهاب المفاصل الروماتويدي ACR/EULAR 2010 — نفس جدول المعايير الأصلي (4 مجالات، أعلى درجة في كل مجال، الإجمالي من 10).
// تصنيف مساعد فقط: الطبيب هو اللي يعتمد التقييم والتشخيص النهائي، ومفيش حاجة بتتغيّر في التشخيص أو الخطة تلقائيًا.
// المفاتيح في sheet: on «ra.j|…» «ra.s|…» «ra.a|…» «ra.d|…» (الصف المختار في كل مجال) و«ra|approved» و«ra|closed» (القسم مقفول — البيانات بتفضل)؛
// txt «ra.large» «ra.small» (عدد المفاصل — بيختار الصف تلقائي) و«ra.note».
import type { ExamSheet } from './data';

export type RaRow = [criteria: string, score: number];
export interface RaDomain { g: string; title: string; max: number; icon: string; rows: RaRow[] }

export const RA_DOMAINS: RaDomain[] = [
  { g: 'ra.j', title: 'Joint Involvement', max: 5, icon: 'bone', rows: [
    ['1 large joint (e.g., shoulder, elbow, hip, knee, ankle)', 0], ['2 – 10 large joints', 1], ['1 – 3 small joints (e.g., MCP, PIP, MTP, wrist)', 2], ['4 – 10 small joints', 3], ['> 10 joints (with ≥ 1 small joint)', 5],
  ] },
  { g: 'ra.s', title: 'Serology', max: 3, icon: 'scan', rows: [
    ['RF negative AND anti-CCP negative', 0], ['Low positive RF OR low positive anti-CCP (> ULN to ≤ 3 × ULN)', 2], ['High positive RF OR high positive anti-CCP (> 3 × ULN)', 3],
  ] },
  { g: 'ra.a', title: 'Acute Phase Reactants', max: 1, icon: 'trend', rows: [['Normal ESR AND normal CRP', 0], ['Abnormal ESR OR abnormal CRP', 1]] },
  { g: 'ra.d', title: 'Symptom Duration', max: 1, icon: 'calendar', rows: [['< 6 weeks', 0], ['≥ 6 weeks', 1]] },
];

/** صف المفاصل من العدد (large = كتف/كوع/ورك/ركبة/كاحل، small = MCP/PIP/MTP/رسغ…) — -1 = مفيش عدد */
export function jointRow(large: number, small: number): number {
  if (large + small > 10 && small >= 1) return 4;
  if (small >= 4) return 3;
  if (small >= 1) return 2;
  if (large >= 2) return 1;
  return large === 1 ? 0 : -1;
}
/** صف التحاليل من RF وAnti-CCP (0 سلبي، 1 إيجابي منخفض، 2 إيجابي مرتفع) — الأعلى بيكسب */
export const seroRow = (rf: number, ccp: number) => Math.max(rf, ccp);
/** صف مؤشرات الالتهاب: أي واحد غير طبيعي = 1 */
export const aprRow = (esrAbn: boolean, crpAbn: boolean) => (esrAbn || crpAbn ? 1 : 0);

export interface RaResult {
  enabled: boolean; approved: boolean; scores: (number | null)[]; total: number; complete: boolean; classified: boolean;
}
export function raCalc(s: ExamSheet): RaResult {
  const scores = RA_DOMAINS.map((d) => { const r = d.rows.find(([c]) => s.on.includes(`${d.g}|${c}`)); return r ? r[1] : null; });
  const total = scores.reduce<number>((a, b) => a + (b ?? 0), 0);
  return {
    // مقفول افتراضيًا (بقى جوّه «التيبس الصباحي» في الشيت العام — ٨/١١): بيتفتح بالزرار، وكشف قديم اتكتب فيه بيفضل مفتوح
    enabled: !s.on.includes('ra|closed') && (s.on.includes('ra|open') || s.on.some((o) => o.startsWith('ra.')) || Object.entries(s.txt).some(([k, v]) => k.startsWith('ra.') && v.trim())), approved: s.on.includes('ra|approved'), scores, total,
    complete: scores.every((x) => x !== null), classified: total >= 6,
  };
}

/** سطر الملخص النصي (بيطلع في «الفحص» وفي الطباعة) — مش بيغيّر التشخيص أو الخطة */
export function raSummary(s: ExamSheet): string {
  const r = raCalc(s);
  const note = (s.txt['ra.note'] ?? '').trim();
  if (!r.enabled || (r.scores.every((x) => x === null) && !note)) return '';
  const parts = RA_DOMAINS.map((d, i) => `${d.title} ${r.scores[i] ?? '—'}`).join(' + ');
  const verdict = r.classified ? '≥ 6/10: classifies as RA' : '< 6/10: does not meet criteria yet (follow-up & reassessment)';
  return `ACR/EULAR 2010 RA criteria: ${parts} = ${r.total}/10 — ${verdict}${r.complete ? '' : ' [incomplete]'} · ${r.approved ? 'Approved by the doctor' : 'Pending doctor approval'}${note ? ` · ${note}` : ''}`;
}
