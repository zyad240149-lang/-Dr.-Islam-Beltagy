// يجيب المعلومات الطبية للمواد الفعالة من نشرات FDA (openFDA drug label API — ملكية عامة، مسموح تجاريًا، من غير مفتاح)
// ويكتبها في ortho_active_ingredients: الجرعة المرجعية، الاستخدامات، الموانع، التحذيرات، الآثار الجانبية، التداخلات + المصدر والتاريخ.
// - بيكتب بس في الخانات الفاضية (مش بيمسح ولا بيغيّر حاجة الطبيب كتبها) — والحالة بتفضل «محتاج مراجعة».
// - المادة اللي مالهاش نشرة FDA (مثال: etoricoxib مش مسجّل في أمريكا) بتتعلّم في info_source إنها مالهاش نشرة، من غير تخمين.
// - المواد المركبة: كل مادة بتتجاب لوحدها (النشرة بتاعة المادة المنفردة).
// الاستخدام: node scripts/import-fda-labels.mjs [--scope=shown|used|top] [--limit=N] [--dry] [--force]
import { sql } from './_env.mjs';

const arg = (k, d) => process.argv.find((a) => a.startsWith(`--${k}=`))?.split('=')[1] ?? d;
const scope = arg('scope', 'shown');
const limit = Number(arg('limit', '150'));
const dry = process.argv.includes('--dry');
const force = process.argv.includes('--force'); // يعيد محاولة المواد اللي اتعلّمت قبل كده «مالهاش نشرة»
const MAX = 2500; // أقصى طول لكل خانة — النص الكامل في رابط النشرة
const q = (s) => "'" + String(s ?? '').replace(/'/g, "''") + "'";
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const base = `select i.id, i.name, i.synonyms from ortho_active_ingredients i where (i.info_source = ''${force ? " or i.info_source like 'openFDA: مفيش نشرة%'" : ''})`;
const pick = {
  shown: `${base} and i.id in (select l.ingredient_id from ortho_medication_ingredients l join ortho_medications m on m.id = l.medication_id where m.shown or m.created_by is not null)`,
  used: `${base} and i.id in (select l.ingredient_id from ortho_medication_ingredients l join ortho_medications m on m.id = l.medication_id join ortho_prescription_items p on lower(p.name) = lower(m.name))`,
  top: `${base} and i.id in (select ingredient_id from ortho_medication_ingredients group by 1 order by count(*) desc limit ${limit * 2})`,
}[scope];
if (!pick) throw new Error('scope لازم يكون shown أو used أو top');
const ings = (await sql(`${pick} order by i.name limit ${limit}`));
console.log(`scope=${scope}: ${ings.length} مادة فعالة`);

// أسامي للبحث: الاسم، الأسامي البديلة، ومن غير الملح (sodium/hydrochloride…)، وparacetamol ⇢ acetaminophen
const SALTS = /\b(sodium|potassium|calcium|magnesium|hydrochloride|hcl|hydrobromide|sulfate|sulphate|phosphate|maleate|mesylate|besylate|tartrate|citrate|acetate|succinate|fumarate|bromide|monohydrate|trihydrate|dihydrate|anhydrous)\b/gi;
const US = { paracetamol: 'acetaminophen', salbutamol: 'albuterol', 'vitamin d3': 'cholecalciferol', 'vitamin c': 'ascorbic acid', 'vitamin b12': 'cyanocobalamin', 'vitamin b1': 'thiamine', 'vitamin b6': 'pyridoxine hydrochloride', 'vit b12': 'cyanocobalamin', 'vit c': 'ascorbic acid', 'vit d': 'cholecalciferol', 'vit d3': 'cholecalciferol', cholecalciferol: 'vitamin d3', 'vit e': 'vitamin e', 'vit b3': 'niacin', 'vit k2': 'menaquinone', 'ibandronic acid': 'ibandronate sodium', 'alendronic acid': 'alendronate sodium', 'zoledronic acid': 'zoledronic acid', 'risedronic acid': 'risedronate sodium', 'glucosamine sulphate': 'glucosamine sulfate', adrenaline: 'epinephrine', glibenclamide: 'glyburide', frusemide: 'furosemide', 'diclofenac': 'diclofenac sodium' };
const names = (i) => {
  const out = [i.name, ...(i.synonyms ?? [])];
  for (const n of [...out]) { out.push(n.replace(SALTS, '').replace(/\s+/g, ' ').trim()); if (US[n]) out.push(US[n]); }
  return [...new Set(out.map((x) => x.trim().toUpperCase()).filter((x) => x.length > 2))].slice(0, 5);
};

async function fetchLabel(n) {
  for (const type of ['HUMAN PRESCRIPTION DRUG', 'HUMAN OTC DRUG']) {
    const url = `https://api.fda.gov/drug/label.json?search=openfda.generic_name.exact:${encodeURIComponent(`"${n}"`)}+AND+openfda.product_type:${encodeURIComponent(`"${type}"`)}&sort=effective_time:desc&limit=1`;
    for (let t = 0; t < 3; t++) {
      const r = await fetch(url);
      if (r.status === 404 || r.status === 400) break; // 400 = اسم فيه رموز openFDA مش بتقبلها
      if (r.status === 429) { await sleep(5000); continue; }
      if (!r.ok) throw new Error(`openFDA ${r.status}`);
      const j = await r.json();
      if (j.results?.[0]) return j.results[0];
      break;
    }
    await sleep(300);
  }
  // بديل: البحث بالمادة (substance_name) — بياخد نشرة فيها المادة دي لوحدها بس (مش مركّب)، بأي ملح
  const url = `https://api.fda.gov/drug/label.json?search=openfda.substance_name:${encodeURIComponent(`"${n}"`)}&sort=effective_time:desc&limit=25`;
  const r = await fetch(url);
  if (r.ok) {
    const j = await r.json();
    const one = (j.results ?? []).filter((x) => (x.openfda?.substance_name ?? []).length === 1 && (x.dosage_and_administration || x.indications_and_usage));
    return one.find((x) => x.openfda?.product_type?.[0] === 'HUMAN PRESCRIPTION DRUG') ?? one[0] ?? null;
  }
  return null;
}

const clean = (arr) => {
  if (!arr?.length) return '';
  let s = arr.join('\n').replace(/\s+\n/g, '\n').replace(/[ \t]+/g, ' ').trim();
  s = s.replace(/^(\d+(\.\d+)?\s*)?[A-Z][A-Z &/,-]{4,}\s+/, ''); // عنوان القسم (DOSAGE AND ADMINISTRATION)
  return s.length > MAX ? s.slice(0, MAX).replace(/\s+\S*$/, '') + ' …' : s;
};
const ymd = (s) => (s && /^\d{8}$/.test(s) ? `${s.slice(0, 4)}-${s.slice(4, 6)}-${s.slice(6, 8)}` : null);

let ok = 0, none = 0;
for (const i of ings) {
  let label = null, used = '';
  for (const n of names(i)) { label = await fetchLabel(n); if (label) { used = n; break; } await sleep(250); }
  if (!label) {
    none++;
    console.log('  ✗', i.name, '— مفيش نشرة FDA');
    if (!dry) await sql(`update ortho_active_ingredients set info_source = ${q(`openFDA: مفيش نشرة FDA للمادة دي (اتدوّر ${new Date().toISOString().slice(0, 10)}) — محتاج مصدر تاني`)} where id = ${q(i.id)} and info_source = ''`);
    continue;
  }
  const f = {
    reference_dose: clean(label.dosage_and_administration),
    indications: clean(label.indications_and_usage),
    contraindications: clean(label.contraindications),
    warnings: clean([...(label.boxed_warning ?? []).map((x) => `⚠ BOXED WARNING: ${x}`), ...(label.warnings_and_cautions ?? label.warnings ?? []), ...(label.precautions ?? [])]),
    side_effects: clean(label.adverse_reactions),
    interactions: clean(label.drug_interactions),
  };
  const src = `نشرة FDA (openFDA) — ${used} — https://dailymed.nlm.nih.gov/dailymed/drugInfo.cfm?setid=${label.set_id}`;
  ok++;
  console.log('  ✓', i.name, '⇢', used, ymd(label.effective_time), Object.entries(f).filter(([, v]) => v).map(([k]) => k).join(','));
  if (dry) continue;
  const sets = Object.entries(f).map(([k, v]) => `${k} = case when ${k} = '' then ${q(v)} else ${k} end`).join(', ');
  await sql(`update ortho_active_ingredients set ${sets}, info_source = ${q(src)}, info_updated_at = ${ymd(label.effective_time) ? q(ymd(label.effective_time)) : 'null'}, data_status = 'needs_review' where id = ${q(i.id)}`);
  await sleep(250);
}
console.log(`done: ${ok} اتجابت نشرتها، ${none} مالهاش نشرة FDA`);
