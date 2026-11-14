// استيراد أسعار وشركات من ملف Excel بتاع «دليل الأدوية» (dwaprices.com) — نفس أعمدة ملفهم:
//   id | الاسم انجلش | الاسم عربي | سعر قديم | سعر جديد | تركيبة/مادة فعالة | شركة | تصنيف | وحدات | وحدات صغرى | حجم/وزن | تركيز | شكل صيدلاني | باركود دولي | محلي/مستورد | تاريخ تحديث سعر | شهرة الصنف
// الربط بالاسم الإنجليزي بعد توحيد الشكل (حروف صغيرة، من غير نقط، tabs=tab …). اللي بيتطابق بالظبط بس هو اللي بيتكتب؛
// التطابق التقريبي بيطلع في تقرير للمراجعة ومش بيتكتب.
// مش بيمسح ولا بيغيّر حاجة متسجلة: الشركة/البلد/العبوة/التركيز/الشكل في الخانات الفاضية بس، والسعر بيتضاف كسطر جديد بمصدره وتاريخه
// (ومش بيتكرر لو نفس السعر بنفس التاريخ والمصدر موجود).
// التشغيل: node scripts/import-dwa-prices.mjs --file=path.xlsx [--apply] [--report=out.csv]   (من غير --apply = تجربة بس)
import readXlsxFile from 'read-excel-file/node';
import { writeFileSync } from 'node:fs';
import { sql } from './_env.mjs';

const arg = (k) => process.argv.find((a) => a.startsWith(`--${k}=`))?.slice(k.length + 3);
const file = arg('file');
const apply = process.argv.includes('--apply');
const reportPath = arg('report');
if (!file) { console.error('لازم --file=path.xlsx'); process.exit(1); }

const COLS = { name: 'الاسم انجلش', ar: 'الاسم عربي', price: 'سعر جديد', sci: 'تركيبة/مادة فعالة', company: 'شركة', units: 'وحدات صغرى', volume: 'حجم/وزن', strength: 'تركيز', form: 'شكل صيدلاني', barcode: 'باركود دولي', origin: 'محلي/مستورد', date: 'تاريخ تحديث سعر' };
const FORM_AR = { tablet: 'أقراص', capsule: 'كبسولات', sachet: 'أكياس', ampoule: 'أمبولات', vial: 'فيال', syrup: 'شراب', suspension: 'معلّق', cream: 'كريم', gel: 'جل', ointment: 'مرهم', spray: 'سبراي', drops: 'نقط', 'eye drops': 'نقط عين', suppository: 'لبوس', lotion: 'لوشن', patch: 'لزقة', syringe: 'سرنجة', injection: 'حقن', 'effervescent granules': 'فوار' };

/** توحيد الاسم للمقارنة: «DIMRA 20 F.C.TAB.» = «dimra 20 f.c.tab» */
export function norm(s) {
  return String(s ?? '').toLowerCase()
    .replace(/(\d)\s*,\s*(\d)/g, '$1.$2')
    .replace(/(\d)\.(\d)/g, '$1\u0001$2') // نقطة الكسر العشري تفضل
    .replace(/[.()[\]{}'"`،,;:]/g, ' ').replace(/\u0001/g, '.')
    .replace(/(\d)\s+(mg|mcg|gm|g|ml|iu|%|cm|mm)\b/g, '$1$2')
    .replace(/\bgm\b|(\d)gm\b/g, (m, d) => (d ? `${d}g` : 'g'))
    .replace(/\b(tabs|tablets?)\b/g, 'tab').replace(/\b(caps|capsules?)\b/g, 'cap').replace(/\b(amps|ampoules?)\b/g, 'amp')
    .replace(/\bsachets\b/g, 'sachet').replace(/\bvials\b/g, 'vial').replace(/\bsupps?\b|\bsuppositories\b/g, 'supp')
    .replace(/\bf\s*c\b/g, 'fc').replace(/\be\s*c\b/g, 'ec').replace(/\bs\s*r\b/g, 'sr').replace(/\bm\s*r\b/g, 'mr')
    .replace(/-/g, ' ').replace(/\s+/g, ' ').trim();
}
const sorted = (s) => s.split(' ').sort().join(' ');
const brand = (s) => s.split(' ')[0];
const nums = (s) => (s.match(/\d+(?:\.\d+)?[a-z%]*/g) ?? []).sort().join(' ');
const formKey = (s) => (/\b(tab|caplet|fc|ec)\b|tabs?\b/.test(s) ? 'tab' : /\bcap\b/.test(s) ? 'cap' : /\bamp\b|\bvial\b|inj/.test(s) ? 'inj' : /sachet/.test(s) ? 'sachet' : /syrup|susp/.test(s) ? 'liquid' : /cream|gel|oint/.test(s) ? 'topical' : /drop/.test(s) ? 'drop' : /supp/.test(s) ? 'supp' : '');
const strongOk = process.argv.includes('--strong');

const sheets = await readXlsxFile(file);
const data = (Array.isArray(sheets[0]?.data) ? sheets[0].data : sheets);
const head = data[0].map((h) => String(h ?? '').trim());
const idx = Object.fromEntries(Object.entries(COLS).map(([k, h]) => [k, head.indexOf(h)]));
const missing = Object.entries(idx).filter(([, i]) => i < 0).map(([k]) => COLS[k]);
if (missing.length) { console.error('أعمدة ناقصة في الملف:', missing.join('، ')); process.exit(1); }
const sheetName = sheets[0]?.sheet ?? '';
const SOURCE = `دليل الأدوية (dwaprices.com) — ملف ${sheetName || file.split(/[\\/]/).pop()}`;

const items = data.slice(1).map((r) => {
  const g = (k) => r[idx[k]];
  const d = g('date');
  const date = d instanceof Date ? d.toISOString().slice(0, 10) : /^\d{4}-\d{2}-\d{2}/.test(String(d ?? '')) ? String(d).slice(0, 10) : '';
  const units = Number(g('units')) || 0;
  const form = String(g('form') ?? '').trim().toLowerCase();
  const formAr = FORM_AR[form] ?? form;
  return {
    name: String(g('name') ?? '').trim(), ar: String(g('ar') ?? '').trim(), price: Number(g('price')), sci: String(g('sci') ?? '').trim(),
    company: String(g('company') ?? '').trim(), strength: String(g('strength') ?? '').trim(), form: formAr, date,
    pack: units ? `${units} ${formAr}`.trim() : String(g('volume') ?? '').trim(),
    origin: String(g('origin') ?? '').trim().toLowerCase() === 'local' ? 'مصر (تصنيع محلي)' : String(g('origin') ?? '').trim().toLowerCase() === 'imported' ? 'مستورد (البلد مش محدد في المصدر)' : '',
    barcode: g('barcode') ? String(g('barcode')) : '',
  };
}).filter((x) => x.name);

const bank = await sql('select id, name, scientific_name, strength, dosage_form from ortho_medications');
const byNorm = new Map(), bySorted = new Map(), byBrand = new Map();
const push = (m, k, v) => { if (!m.has(k)) m.set(k, []); m.get(k).push(v); };
for (const b of bank) { const n = norm(b.name); push(byNorm, n, b); push(bySorted, sorted(n), b); push(byBrand, brand(n), b); }

const exact = [], review = [], none = [];
for (const it of items) {
  const n = norm(it.name);
  const hit = byNorm.get(n) ?? bySorted.get(sorted(n));
  if (hit?.length === 1) { exact.push({ it, med: hit[0] }); continue; }
  if (hit && hit.length > 1) { review.push({ it, why: 'أكتر من دوا بنفس الاسم في البنك', cands: hit.map((h) => h.name) }); continue; }
  const cands = (byBrand.get(brand(n)) ?? []).filter((b) => !it.sci || !b.scientific_name || norm(b.scientific_name).split(' ')[0] === norm(it.sci).split(' ')[0]);
  // تطابق قوي: نفس الاسم التجاري + نفس الأرقام بالظبط (التركيز والعدد) + نفس نوع الشكل + مرشح واحد بس
  const strong = cands.filter((b) => { const bn = norm(b.name); return nums(bn) === nums(n) && nums(n) !== '' && formKey(bn) === formKey(n); });
  if (strong.length === 1 && strongOk) { exact.push({ it, med: strong[0], strong: true }); continue; }
  if (cands.length) review.push({ it, why: strong.length === 1 ? 'تطابق قوي (نفس الاسم والأرقام) — شغّل --strong عشان يتكتب' : 'تطابق تقريبي (نفس الاسم التجاري)', cands: (strong.length === 1 ? strong : cands).slice(0, 6).map((c) => c.name) });
  else none.push({ it });
}

console.log(`الملف: ${items.length} صنف — متطابق بالظبط: ${exact.length} | محتاج مراجعة: ${review.length} | مش موجود في البنك: ${none.length}`);
console.log('أمثلة متطابقة:'); for (const { it, med } of exact.slice(0, 8)) console.log(`  ${it.name}  ⇐  ${med.name}  | ${it.price} EGP ${it.date} | ${it.company}`);
console.log('أمثلة للمراجعة:'); for (const r of review.slice(0, 8)) console.log(`  ${r.it.name}  ?  ${r.cands.join(' / ')}`);
console.log('أمثلة مش موجودة:'); for (const r of none.slice(0, 8)) console.log(`  ${r.it.name}`);

if (reportPath) {
  const esc = (s) => `"${String(s ?? '').replace(/"/g, '""')}"`;
  const lines = [['الحالة', 'اسم المصدر', 'سعر', 'تاريخ', 'شركة', 'دوا البنك / المرشحين', 'سبب'].map(esc).join(',')];
  for (const { it, med } of exact) lines.push(['متطابق', it.name, it.price, it.date, it.company, med.name, ''].map(esc).join(','));
  for (const r of review) lines.push(['مراجعة', r.it.name, r.it.price, r.it.date, r.it.company, r.cands.join(' | '), r.why].map(esc).join(','));
  for (const r of none) lines.push(['مش موجود', r.it.name, r.it.price, r.it.date, r.it.company, '', ''].map(esc).join(','));
  writeFileSync(reportPath, '﻿' + lines.join('\n'));
  console.log('التقرير:', reportPath);
}

if (!apply) { console.log('تجربة بس — مفيش حاجة اتكتبت. ضيف --apply عشان يكتب.'); process.exit(0); }

const q = (s) => "'" + String(s ?? '').replace(/'/g, "''") + "'";
const ok = exact.filter(({ it }) => Number.isFinite(it.price) && it.price > 0);
for (let i = 0; i < ok.length; i += 500) {
  const ch = ok.slice(i, i + 500);
  const vals = ch.map(({ it, med }) => `(${q(med.id)}::uuid, ${it.price}, ${q(it.pack)}, ${q(it.company)}, ${q(it.origin)}, ${q(it.strength)}, ${q(it.form)}, ${it.date ? q(it.date) + '::date' : 'current_date'})`).join(',');
  await sql(`
    insert into ortho_med_internal (medication_id, company, origin_country, pack_size, info_source)
      select v.id, v.co, v.orig, v.pack, ${q(SOURCE)} from (values ${vals}) v(id, price, pack, co, orig, st, fm, dt)
    on conflict (medication_id) do update set
      company = case when ortho_med_internal.company = '' then excluded.company else ortho_med_internal.company end,
      origin_country = case when ortho_med_internal.origin_country = '' then excluded.origin_country else ortho_med_internal.origin_country end,
      pack_size = case when ortho_med_internal.pack_size = '' then excluded.pack_size else ortho_med_internal.pack_size end,
      info_source = case when ortho_med_internal.info_source = '' then excluded.info_source else ortho_med_internal.info_source end;
    insert into ortho_med_prices (medication_id, price, currency, country, price_basis, pack_size, company, verified_at, source)
      select v.id, v.price, 'EGP', 'EG', 'pack', v.pack, v.co, v.dt, ${q(SOURCE)} from (values ${vals}) v(id, price, pack, co, orig, st, fm, dt)
      where not exists (select 1 from ortho_med_prices p where p.medication_id = v.id and p.price = v.price and p.verified_at = v.dt and p.source = ${q(SOURCE)});
    update ortho_medications m set
      strength = case when m.strength = '' then v.st else m.strength end,
      dosage_form = case when m.dosage_form = '' then v.fm else m.dosage_form end
      from (values ${vals}) v(id, price, pack, co, orig, st, fm, dt) where m.id = v.id;`);
  console.log('  اتكتب', Math.min(i + 500, ok.length));
}
console.log('خلص:', ok.length, 'دوا اتحدّث سعره وشركته من', SOURCE);
