// فحص التداخلات الدوائية في الروشتة: بيعرف المادة الفعالة لكل دواء (من بنك الأدوية + اسم المجموعة + الاسم نفسه)
// ويقارن كل اتنين ببعض على قواعد معروفة. ده تنبيه مساعد — مش بديل عن قرار الطبيب.
import { useEffect, useState } from 'react';
import { supabase } from '../lib/supabase';
import { medCatalog } from './clinicalLists';
import type { Medication } from './data';

type Cls = 'sedative' | 'tca' | 'inhibitor' | 'herbal' | 'statin' | 'colchicine' | 'cox2' | 'nsaid' | 'steroid' | 'anticoag' | 'antiplatelet' | 'ssri' | 'tramadol' | 'opioid' | 'relaxant' | 'benzo' | 'pregab' | 'ppi' | 'methotrexate' | 'quinolone' | 'acei' | 'diuretic' | 'lithium' | 'paracetamol' | 'potassium' | 'bisphos' | 'calcium';

const RULES: [Cls, RegExp][] = [
  ['cox2', /etoricoxib|celecoxib|cox-?2|parecoxib/i],
  ['nsaid', /diclofenac|ibuprofen|naproxen|ketoprofen|dexketoprofen|piroxicam|lornoxicam|meloxicam|tenoxicam|indomethacin|aceclofenac|ketorolac|mefenamic|nimesulide|flurbiprofen|etodolac|nsaid|aspirin\b(?!.*(75|81|100) ?mg)/i],
  ['steroid', /prednisol|prednison|dexamethason|methylpredni|betamethason|hydrocortison|triamcinolon|deflazacort|cortico/i],
  ['anticoag', /warfarin|enoxaparin|heparin|rivaroxaban|apixaban|dabigatran|edoxaban|fondaparinux|tinzaparin|anticoag/i],
  ['antiplatelet', /clopidogrel|ticagrelor|prasugrel|aspirin.*(75|81|100) ?mg|cilostazol/i],
  ['ssri', /sertraline|fluoxetine|paroxetine|escitalopram|citalopram|fluvoxamine|venlafaxine|duloxetine|ssri|snri/i],
  ['tramadol', /tramadol/i],
  ['opioid', /morphine|codeine|oxycodone|tapentadol|nalbuphine|pethidine|fentanyl|opioid/i],
  ['relaxant', /tizanidine|baclofen|orphenadrine|chlorzoxazone|methocarbamol|thiocolchicoside|tolperisone|cyclobenzaprine|muscle relax/i],
  ['benzo', /diazepam|alprazolam|clonazepam|bromazepam|lorazepam/i],
  ['pregab', /pregabalin|gabapentin/i],
  ['methotrexate', /methotrexate/i],
  ['quinolone', /ciprofloxacin|levofloxacin|moxifloxacin|ofloxacin|quinolone/i],
  ['acei', /captopril|enalapril|lisinopril|ramipril|perindopril|losartan|valsartan|candesartan|irbesartan|telmisartan/i],
  ['diuretic', /furosemide|hydrochlorothiazide|indapamide|spironolactone|torsemide|diuretic/i],
  ['lithium', /lithium/i],
  ['paracetamol', /paracetamol|acetaminophen/i],
  ['potassium', /spironolactone|potassium chloride|eplerenone/i],
  ['bisphos', /alendron|risedron|ibandron|bisphosph/i],
  ['calcium', /calcium|\biron\b|ferrous|antacid|magnesium hydroxide|aluminium/i],
  ['sedative', /quetiapine|olanzapine|risperidone|aripiprazole|haloperidol|chlorpromazine|mirtazapine|amitriptyline|imipramine|clomipramine|chlorpheniramine|diphenhydramine|promethazine|hydroxyzine|zolpidem/i],
  ['tca', /amitriptyline|imipramine|clomipramine|nortriptyline|dapoxetine|ondansetron|linezolid/i],
  ['inhibitor', /clarithromycin|erythromycin|fluconazole|itraconazole|ketoconazole|voriconazole|metronidazole|amiodarone/i],
  ['herbal', /ginkgo|fish oil|omega|garlic|ginseng|turmeric|curcumin/i],
  ['statin', /simvastatin|atorvastatin|lovastatin/i],
  ['colchicine', /colchicine/i],
];

type Pair = { a: Cls[]; b: Cls[]; level: 'danger' | 'warn'; msg: string; same?: boolean };
const PAIRS: Pair[] = [
  { a: ['nsaid', 'cox2'], b: ['nsaid', 'cox2'], same: true, level: 'danger', msg: 'مسكنين من نفس النوع (NSAIDs) مع بعض — مفيش فايدة زيادة وخطر على المعدة والكلى. اكتفي بواحد.' },
  { a: ['nsaid', 'cox2'], b: ['anticoag'], level: 'danger', msg: 'مسكن NSAID مع مُسيل للدم — خطر نزيف عالي.' },
  { a: ['nsaid', 'cox2'], b: ['antiplatelet'], level: 'warn', msg: 'مسكن NSAID مع مضاد صفائح — احتمال نزيف معدة؛ فكّر في واقي معدة.' },
  { a: ['nsaid', 'cox2'], b: ['steroid'], level: 'warn', msg: 'NSAID مع كورتيزون — خطر قرحة/نزيف معدة؛ ضيف واقي معدة.' },
  { a: ['nsaid', 'cox2'], b: ['ssri'], level: 'warn', msg: 'NSAID مع مضاد اكتئاب SSRI/SNRI — بيزود احتمال النزيف.' },
  { a: ['nsaid', 'cox2'], b: ['methotrexate'], level: 'danger', msg: 'NSAID مع Methotrexate — بيرفع سُمّية الميثوتريكسات.' },
  { a: ['nsaid', 'cox2'], b: ['lithium'], level: 'danger', msg: 'NSAID مع Lithium — بيرفع مستوى الليثيوم في الدم.' },
  { a: ['nsaid', 'cox2'], b: ['acei'], level: 'warn', msg: 'NSAID مع دوا ضغط (ACEI/ARB) — بيقلل مفعول الضغط وممكن يأثر على الكلى.' },
  { a: ['nsaid', 'cox2'], b: ['diuretic'], level: 'warn', msg: 'NSAID مع مدر بول — خطر على الكلى وبيقلل مفعول المدر.' },
  { a: ['steroid'], b: ['steroid'], same: true, level: 'warn', msg: 'نوعين كورتيزون مع بعض — اتأكد إنه مقصود.' },
  { a: ['steroid'], b: ['quinolone'], level: 'warn', msg: 'كورتيزون مع Quinolone — خطر التهاب/قطع وتر (خصوصًا وتر أكيليس).' },
  { a: ['anticoag'], b: ['anticoag'], same: true, level: 'danger', msg: 'نوعين مُسيل للدم مع بعض — خطر نزيف شديد.' },
  { a: ['anticoag'], b: ['antiplatelet', 'ssri'], level: 'warn', msg: 'مُسيل للدم مع دوا بيأثر على الصفائح — خطر نزيف.' },
  { a: ['tramadol'], b: ['ssri'], level: 'danger', msg: 'Tramadol مع SSRI/SNRI — خطر متلازمة السيروتونين وتشنجات.' },
  { a: ['tramadol', 'opioid'], b: ['tramadol', 'opioid'], same: true, level: 'danger', msg: 'نوعين مسكن أفيوني مع بعض — خطر تثبيط التنفس.' },
  { a: ['tramadol', 'opioid'], b: ['benzo', 'pregab'], level: 'danger', msg: 'أفيوني مع مهدئ (بنزو/بريجابالين) — نُعاس شديد وتثبيط تنفس.' },
  { a: ['tramadol', 'opioid', 'benzo', 'pregab'], b: ['relaxant'], level: 'warn', msg: 'مُرخي عضلات مع دوا مهدئ — نُعاس ودوخة زيادة؛ نبّه المريض على السواقة.' },
  { a: ['relaxant'], b: ['relaxant'], same: true, level: 'warn', msg: 'نوعين مُرخي عضلات مع بعض — مفيش داعي غالبًا ونُعاس زيادة.' },
  { a: ['paracetamol'], b: ['paracetamol'], same: true, level: 'danger', msg: 'باراسيتامول في أكتر من دوا — خطر جرعة زيادة على الكبد.' },
  { a: ['bisphos'], b: ['calcium'], level: 'warn', msg: 'Bisphosphonate مع كالسيوم/حديد/مضاد حموضة — بيمنع الامتصاص؛ لازم فرق ساعتين على الأقل.' },
  { a: ['quinolone'], b: ['calcium'], level: 'warn', msg: 'Quinolone مع كالسيوم/حديد/مضاد حموضة — بيقلل الامتصاص؛ افصل بينهم.' },
  { a: ['tramadol'], b: ['tca'], level: 'danger', msg: 'Tramadol مع دوا بيرفع السيروتونين (Amitriptyline/Ondansetron/Dapoxetine…) — خطر متلازمة السيروتونين وتشنجات.' },
  { a: ['tramadol', 'opioid', 'relaxant', 'pregab', 'benzo'], b: ['sedative'], level: 'warn', msg: 'مسكن/مُرخي عضلات مع دوا مهدئ (مضاد ذهان/حساسية/نوم) — نُعاس شديد ودوخة؛ نبّه المريض.' },
  { a: ['anticoag'], b: ['inhibitor'], level: 'danger', msg: 'مُسيل للدم مع دوا بيرفع مستواه (Clarithromycin/Fluconazole/Metronidazole…) — خطر نزيف؛ راجع INR/الجرعة.' },
  { a: ['anticoag', 'antiplatelet'], b: ['herbal'], level: 'warn', msg: 'مُسيل/مضاد صفائح مع مكمّل بيأثر على السيولة (Ginkgo/Omega-3/Garlic…) — احتمال نزيف.' },
  { a: ['statin'], b: ['inhibitor'], level: 'warn', msg: 'Statin مع Clarithromycin/Fluconazole — خطر التهاب وتكسّر العضلات.' },
  { a: ['colchicine'], b: ['inhibitor', 'statin'], level: 'danger', msg: 'Colchicine مع Clarithromycin/Statin — خطر سُمّية الكولشيسين والعضلات.' },
  { a: ['acei'], b: ['potassium'], level: 'warn', msg: 'دوا ضغط ACEI/ARB مع Spironolactone/بوتاسيوم — خطر ارتفاع البوتاسيوم.' },
];

const classify = (text: string): Set<Cls> => new Set(RULES.filter(([, r]) => r.test(text)).map(([c]) => c));
const key = (s: string) => s.trim().toLowerCase();

export interface Interaction { a: string; b: string; level: 'danger' | 'warn'; msg: string }

// المواد الفعالة من نص «A+B(syn)» → أسامي موحّدة
const ingredientsOf = (sci = '') => sci.toLowerCase().split('+').map((x) => x.replace(/\(.*?\)/g, ' ').replace(/\s+/g, ' ').trim()).filter(Boolean);

export function findInteractions(meds: { name: string; text: string; sci?: string }[]): Interaction[] {
  // الدهانات والجِل والسبراي امتصاصها للدم ضعيف — مش بتدخل في التداخلات
  const topical = /\b(gel|cream|crem|oint|ointment|spray|patch|plaster|lotion|emulgel|topical|top\.)/i;
  const cls = meds.map((m) => (topical.test(`${m.name} ${m.text}`) ? new Set<Cls>() : classify(`${m.name} ${m.text}`)));
  const out: Interaction[] = [];
  for (let i = 0; i < meds.length; i++) for (let j = i + 1; j < meds.length; j++) {
    if (key(meds[i].name) === key(meds[j].name)) continue; // التكرار ليه تنبيه لوحده
    // نفس المادة الفعالة في دواءين بأسامي تجارية مختلفة (مثال: Panadol + Cetal)
    const shared = ingredientsOf(meds[i].sci).filter((x) => ingredientsOf(meds[j].sci).includes(x));
    if (shared.length) { out.push({ a: meds[i].name, b: meds[j].name, level: 'danger', msg: `نفس المادة الفعالة (${shared.join(' + ')}) في الدواءين — جرعة مضاعفة. اكتفي بواحد.` }); continue; }
    const hit = (p: Pair, x: Set<Cls>, y: Set<Cls>) => p.a.some((c) => x.has(c)) && p.b.some((c) => y.has(c));
    const p = PAIRS.find((p) => hit(p, cls[i], cls[j]) || (!p.same && hit(p, cls[j], cls[i])));
    if (p) out.push({ a: meds[i].name, b: meds[j].name, level: p.level, msg: p.msg });
  }
  return out.sort((x, y) => (x.level === y.level ? 0 : x.level === 'danger' ? -1 : 1));
}

// المادة الفعالة من البنك على الخادم (بالاسم بالظبط) — بتتحفظ عشان مانسألش تاني
const sciCache = new Map<string, string>();
const ingCache = new Map<string, string>();

export function useRxInteractions(meds: Medication[]): Interaction[] {
  const names = meds.map((m) => m.name.trim()).filter(Boolean);
  const sig = names.map(key).sort().join('|');
  const [, bump] = useState(0);
  useEffect(() => {
    const missing = names.filter((n) => !sciCache.has(key(n)));
    if (!missing.length) return;
    let live = true;
    supabase.from('ortho_medications').select('name,scientific_name,group').in('name', missing).then(({ data }) => {
      for (const n of missing) sciCache.set(key(n), '');
      for (const r of data ?? []) { sciCache.set(key(r.name), `${r.scientific_name ?? ''} ${r.group ?? ''}`); ingCache.set(key(r.name), r.scientific_name ?? ''); }
      if (live) bump((x) => x + 1);
    });
    return () => { live = false; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sig]);
  const groupOf = new Map(medCatalog().map((m) => [key(m.name), `${m.group} ${(m as { scientificName?: string }).scientificName ?? ''}`]));
  return findInteractions(names.map((n) => ({ name: n, text: `${groupOf.get(key(n)) ?? ''} ${sciCache.get(key(n)) ?? ''}`, sci: ingCache.get(key(n)) ?? '' })));
}
