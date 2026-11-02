// معايير تصنيف التهاب المفاصل الروماتويدي ACR/EULAR 2010 — حساب الدرجات (0–10). تصنيف مساعد فقط: الطبيب هو اللي يعتمد التقييم والتشخيص النهائي.
// المفاتيح المخزّنة في sheet: on «ra|on» (القسم مفعّل) و«ra.rf|…» «ra.ccp|…» «ra.esr|…» «ra.crp|…» «ra.dur|…» «ra|approved»؛ txt «ra.large» «ra.small» «ra.note».
import type { ExamSheet } from './data';

export const RA_SERO = ['Negative', 'Low positive', 'High positive'] as const;
export const RA_APR = ['Normal', 'Abnormal'] as const;
export const RA_DUR = ['< 6 weeks', '≥ 6 weeks'] as const;
export const RA_SERO_SCORE: Record<string, number> = { Negative: 0, 'Low positive': 2, 'High positive': 3 };

/** درجة المفاصل: large = عدد المفاصل الكبيرة، small = الصغيرة (المفصل الكبير: كتف/كوع/ورك/ركبة/كاحل — الصغير: MCP/PIP/MTP/رسغ) */
export function jointScore(large: number, small: number): number {
  if (large + small > 10 && small >= 1) return 5;
  if (small >= 4) return 3;
  if (small >= 1) return 2;
  if (large >= 2) return 1;
  return 0;
}
export const JOINT_ROWS: [string, number][] = [
  ['1 large joint (shoulder, elbow, hip, knee, ankle)', 0], ['2 – 10 large joints', 1], ['1 – 3 small joints (MCP, PIP, MTP, wrist)', 2], ['4 – 10 small joints', 3], ['> 10 joints (with ≥ 1 small joint)', 5],
];
/** أي صف من JOINT_ROWS ينطبق على العدد ده (-1 = لسه ما اتدخلش عدد) */
export function jointRow(large: number, small: number): number {
  if (large + small > 10 && small >= 1) return 4;
  if (small >= 4) return 3;
  if (small >= 1) return 2;
  if (large >= 2) return 1;
  return large === 1 ? 0 : -1;
}

const num = (v: string | undefined) => { const n = parseInt((v ?? '').trim(), 10); return Number.isFinite(n) && n >= 0 ? n : NaN; };
const one = (s: ExamSheet, g: string, items: readonly string[]) => items.find((i) => s.on.includes(`${g}|${i}`));

export interface RaResult {
  enabled: boolean; approved: boolean;
  joints: number; sero: number; apr: number; dur: number; total: number;
  complete: boolean; classified: boolean; large: number; small: number;
}
export function raCalc(s: ExamSheet): RaResult {
  const large = num(s.txt['ra.large']), small = num(s.txt['ra.small']);
  const haveJoints = !Number.isNaN(large) || !Number.isNaN(small);
  const L = Number.isNaN(large) ? 0 : large, S = Number.isNaN(small) ? 0 : small;
  const joints = haveJoints ? jointScore(L, S) : 0;
  const rf = one(s, 'ra.rf', RA_SERO), ccp = one(s, 'ra.ccp', RA_SERO);
  const sero = Math.max(rf ? RA_SERO_SCORE[rf] : 0, ccp ? RA_SERO_SCORE[ccp] : 0);
  const esr = one(s, 'ra.esr', RA_APR), crp = one(s, 'ra.crp', RA_APR);
  const apr = esr === 'Abnormal' || crp === 'Abnormal' ? 1 : 0;
  const d = one(s, 'ra.dur', RA_DUR);
  const dur = d === '≥ 6 weeks' ? 1 : 0;
  const total = joints + sero + apr + dur;
  return {
    enabled: s.on.includes('ra|on'), approved: s.on.includes('ra|approved'), joints, sero, apr, dur, total,
    complete: haveJoints && !!(rf || ccp) && !!(esr || crp) && !!d, classified: total >= 6, large: L, small: S,
  };
}

/** سطر الملخص النصي (بيطلع في «الفحص» وفي الطباعة) — مش بيغيّر التشخيص أو الخطة */
export function raSummary(s: ExamSheet): string {
  const r = raCalc(s);
  if (!r.enabled || (!r.complete && !r.total && !s.txt['ra.note']?.trim())) return '';
  const note = (s.txt['ra.note'] ?? '').trim();
  const verdict = r.classified ? 'meets the classification criteria for RA (≥ 6/10)' : 'does not meet the criteria yet (< 6/10) — follow-up & reassessment';
  return `ACR/EULAR 2010 RA criteria: Joints ${r.joints} + Serology ${r.sero} + Acute-phase ${r.apr} + Duration ${r.dur} = ${r.total}/10 — ${verdict}${r.complete ? '' : ' [incomplete]'} · ${r.approved ? 'Approved by the doctor' : 'Pending doctor approval'}${note ? ` · ${note}` : ''}`;
}
