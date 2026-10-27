// الرسائل التحفيزية في «تارجتي هذا الشهر» — بتتختار من نسبة الإنجاز الحقيقية (من الخادم).
// رسالة «حققت التارجت» بتظهر بس لما الخادم يقول reached (مش من تقريب النسبة)، ومفيش أي رسالة فيها لوم أو إحراج.
// التنويع: نسختين لكل مرحلة، والاختيار ثابت طول اليوم (بيتغيّر مع اليوم).
export type MotivationTone = 'info' | 'ok' | 'brand' | 'warn';
export interface Motivation { band: string; text: string; tone: MotivationTone }

const BANDS: Record<string, { tone: MotivationTone; texts: string[] }> = {
  noTarget: { tone: 'info', texts: ['التارجت الشهري ما تم تحديده بعد — سيظهر هنا فور تحديده من المدير.'] },
  start: { tone: 'brand', texts: ['بدأنا شهرًا جديدًا، لنحقق هدفنا ونصل إلى التارجت! 💪', 'شهر جديد وفرصة جديدة — كل زيارة تقرّبك من هدفك! 💪'] },
  zero: { tone: 'brand', texts: ['كل زيارة تقرّبك من هدفك — لنبدأ! 💪', 'الطريق يبدأ بخطوة — أول زيارة مؤهلة ستُحرّك الشريط! 💪'] },
  going: { tone: 'brand', texts: ['أحسنت! أداؤك جيد، واصل بالمستوى نفسه.', 'عملك واضح الأثر — واصل بالحماس نفسه!'] },
  q25: { tone: 'brand', texts: ['بداية موفقة! استمر في التقدم، فكل زيارة تقرّبك من هدفك.', 'أنجزت ربع الطريق — استمر وستصل!'] },
  q50: { tone: 'ok', texts: ['أحسنت! وصلت إلى منتصف الطريق، واصل بقوة! 🔥', 'تحقق نصف التارجت — واصل بالقوة نفسها! 🔥'] },
  q75: { tone: 'ok', texts: ['أنت قربت جدًا من هدفك، كمّل بنفس القوة!', 'أنجزت ثلاثة أرباع الطريق — الهدف أمامك!'] },
  q90: { tone: 'ok', texts: ['باقٍ {0}% فقط على التارجت، اقتربت كثيرًا! تقدر توصل! 💪'] },
  reached: { tone: 'ok', texts: ['مبروك! حققت التارجت الشهري، مجهود رائع! 🎉', 'مبروك! تحقق التارجت — جهدك أثمر! 🎉'] },
  exceeded: { tone: 'ok', texts: ['إنجاز ممتاز! تجاوزت التارجت المطلوب، استمر في التفوق! 🚀', 'أداء استثنائي! أنت فوق التارجت — واصل على هذا المستوى! 🚀'] },
};

export function motivation(input: { hasTarget: boolean; pct: number | null; reached: boolean; dayOfMonth: number }): Motivation {
  const { hasTarget, pct, reached, dayOfMonth } = input;
  let band: keyof typeof BANDS;
  const p = pct ?? 0;
  if (!hasTarget || pct == null) band = 'noTarget';
  else if (reached) band = p > 100 ? 'exceeded' : 'reached';
  else if (p >= 90) band = 'q90';
  else if (p >= 75) band = 'q75';
  else if (p >= 50) band = 'q50';
  else if (p >= 25) band = 'q25';
  else if (dayOfMonth <= 3) band = 'start';
  else if (p > 0) band = 'going';
  else band = 'zero';
  const b = BANDS[band];
  const text = b.texts[Math.abs(dayOfMonth) % b.texts.length].replace('{0}', String(Math.max(1, Math.ceil(100 - p))));
  return { band, text, tone: b.tone };
}
