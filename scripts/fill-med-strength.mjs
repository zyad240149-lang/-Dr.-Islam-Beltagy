// يملى التركيز والشكل الصيدلاني لأدوية البنك من الاسم التجاري (أعمدة 973 الجديدة) — بيكتب بس في الخانات الفاضية، ومش بيلمس الاسم أو أي عمود قديم.
// وكمان تركيز المادة في الأدوية اللي ليها مادة فعالة واحدة بس. التشغيل: node scripts/fill-med-strength.mjs [--dry]
import { sql } from './_env.mjs';
function parseMedName(name) {
  // «30 GM» لوحدها غالبًا حجم أنبوبة مش تركيز — الجرام يتحسب تركيز بس لو أقل من 5 (مثال: AUGMENTIN 1GM) أو لو بعدها «/»
  const strength = [...name.matchAll(/\d+(?:[.,]\d+)?\s*(?:mg|mcg|µg|i\.?u\.?|%|gm|g|u)(?![a-z])(?:\s*\/\s*\d*(?:[.,]\d+)?\s*(?:ml|gm|g|tab|dose))?/gi)]
    .map((m) => m[0].replace(/\s+/g, ' ').trim())
    .find((s) => !/^[\d.,]+\s*(gm|g)$/i.test(s) || parseFloat(s.replace(',', '.')) < 5) ?? '';
  const forms = [
    [/\b(f\.?c\.?|e\.?c\.?|s\.?r\.?|m\.?r\.?|e\.?r\.?)?\s*tabs?\b|caplet|\btab\.?/i, 'أقراص'], [/caps?\b|capsule/i, 'كبسولات'], [/syrup|\bsyr\b/i, 'شراب'], [/susp/i, 'معلّق'],
    [/amp|ampoule/i, 'أمبولات'], [/vial/i, 'فيال'], [/inj|pre-?filled|syringe/i, 'حقن'], [/sachet|sach/i, 'أكياس'], [/eff/i, 'فوار'],
    [/cream|crem/i, 'كريم'], [/emulgel|\bgel\b/i, 'جل'], [/oint/i, 'مرهم'], [/spray/i, 'سبراي'], [/drop/i, 'نقط'], [/patch|plaster/i, 'لزقة'], [/supp/i, 'لبوس'], [/lotion/i, 'لوشن'],
  ];
  const form = forms.find(([re]) => re.test(name))?.[1] ?? '';
  const pack = name.match(/\b(\d+)\s*(?:(?:f\.?c|e\.?c|s\.?r|m\.?r|i\.?m|i\.?v|s\.?c|top|orodispersible|eff)\.?\s*)*(tabs?|caps?|caplets?|amps?|sachets?|supp|vials?|tablets?|capsules?)\b/i);
  // أنبوبة/زجاجة: آخر كمية بالجرام أو المللي في الاسم لو مختلفة عن التركيز (مثال: GEL 40 GM)
  const vol = [...name.matchAll(/\b(\d+(?:[.,]\d+)?)\s*(gm|g|ml)\b(?!\s*\/)/gi)].pop();
  const volText = vol && !strength.toLowerCase().endsWith(vol[0].toLowerCase().replace(/\s+/g, ' ')) && !/\/\s*$/.test(name.slice(0, vol.index)) ? `${vol[1]} ${vol[2].toUpperCase()}` : '';
  const packText = pack ? `${pack[1]} ${form || pack[2]}` : volText;
  return { strength, form, pack: packText };
}
const dry = process.argv.includes('--dry');
const rows = await sql("select id, name from ortho_medications where strength = '' or dosage_form = ''");
const q = (s) => "'" + String(s).replace(/'/g, "''") + "'";
const vals = rows.map((r) => { const p = parseMedName(r.name); return [r.id, p.strength, p.form]; }).filter(([, s, f]) => s || f);
console.log(rows.length, 'rows to check,', vals.length, 'with strength/form found');
if (dry) { console.log(vals.slice(0, 10)); process.exit(0); }
for (let i = 0; i < vals.length; i += 2000) {
  const chunk = vals.slice(i, i + 2000).map(([id, s, f]) => `(${q(id)}::uuid, ${q(s)}, ${q(f)})`).join(',');
  await sql(`update ortho_medications m set strength = case when m.strength = '' then v.s else m.strength end, dosage_form = case when m.dosage_form = '' then v.f else m.dosage_form end
    from (values ${chunk}) v(id, s, f) where m.id = v.id`);
  console.log('  updated', Math.min(i + 2000, vals.length));
}
await sql(`update ortho_medication_ingredients l set strength = m.strength from ortho_medications m
  where l.medication_id = m.id and l.strength = '' and m.strength <> '' and (select count(*) from ortho_medication_ingredients x where x.medication_id = m.id) = 1`);
console.log('done');
