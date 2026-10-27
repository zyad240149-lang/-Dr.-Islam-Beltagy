// يولّد supabase/migrations/903_egypt_localization.sql من تعريفات الدوال الحالية في القاعدة:
// الهوية المصرية بدل السعودية، «مصري/أجنبي» بدل «سعودي/غير سعودي»، ج.م بدل ر.س، وقيمة جلسة الولاء من خدمة موجودة.
// القيم المخزنة للجنسية زي ما هي (saudi = مصري، non_saudi = أجنبي) عشان عشرات الدوال والضريبة (0%) ماتتأثرش.
//   node scripts/gen-egypt-migration.mjs   (مرة واحدة — الناتج ملف هجرة عادي بيتراجع ويتطبق بـ db-migrate)
import { writeFileSync } from 'node:fs';
import { sql } from './_env.mjs';

const EG_ID = `'^[23][0-9]{13}$'`;          // الرقم القومي المصري: 14 رقم، أوله 2 (مواليد 1900s) أو 3 (2000s)
const PASSPORT = `'^[A-Za-z0-9]{6,20}$'`;   // جواز سفر الأجنبي

// [اسم الدالة أو * للكل, نص قديم أو regex, نص جديد]
const RULES = [
  ['patient_missing_fields', /case when coalesce\(p\.national_id, ''\) !~ '\^\\d\{10\}\$'[\s\S]*?end end,/,
    `case when (coalesce(p.nationality, 'saudi') <> 'non_saudi' and coalesce(p.national_id, '') !~ ${EG_ID})
           or (p.nationality = 'non_saudi' and coalesce(p.national_id, '') !~ ${PASSPORT})
         then case when p.nationality = 'non_saudi' then 'رقم جواز السفر' else 'الرقم القومي' end end,`],
  ['patient_missing_fields', `'نوع الهوية (الجنسية)'`, `'الجنسية (مصري / أجنبي)'`],
  ['list_patients', `(p_gaps = 'id' and (coalesce(p.national_id, '') !~ '^\\d{10}$' or left(p.national_id, 1) <> case when p.nationality = 'non_saudi' then '2' else '1' end))`,
    `(p_gaps = 'id' and case when p.nationality = 'non_saudi' then coalesce(p.national_id, '') !~ ${PASSPORT} else coalesce(p.national_id, '') !~ ${EG_ID} end)`],
  ['patient_import_commit', `elsif not (nid ~ '^\\d{10}$' and ((nat = 'saudi' and nid like '1%') or (nat = 'non_saudi' and nid like '2%'))) then reason := 'رقم الهوية/الإقامة غير صحيح';`,
    `elsif not ((nat = 'saudi' and nid ~ ${EG_ID}) or (nat = 'non_saudi' and nid ~ ${PASSPORT})) then reason := 'الرقم القومي (14 رقم) أو رقم جواز السفر غير صحيح';`],
  ['patient_import_commit', `'رقم الهوية/الإقامة مطلوب'`, `'الرقم القومي / جواز السفر مطلوب'`],
  ['sell_product', `if v_nat is null or v_nat not in ('saudi','non_saudi') then raise exception 'اختر جنسية العميل (سعودي / غير سعودي)'; end if;`,
    `v_nat := coalesce(v_nat, 'saudi'); -- عميل بدون جنسية = مصري (الضريبة صفر للكل)
    if v_nat not in ('saudi','non_saudi') then raise exception 'اختر جنسية العميل (مصري / أجنبي)'; end if;`],
  ['sell_product', `if v_nid is not null and v_nat = 'saudi' and v_nid !~ '^1[0-9]{9}$' then raise exception 'رقم الهوية الوطنية 10 أرقام يبدأ بـ 1'; end if;`,
    `if v_nid is not null and v_nat = 'saudi' and v_nid !~ ${EG_ID} then raise exception 'الرقم القومي 14 رقم يبدأ بـ 2 أو 3'; end if;`],
  ['online_accounts', `then 'إقامة'`, `then 'جواز سفر'`],
  ['online_accounts', `then 'هوية وطنية'`, `then 'رقم قومي'`],
  // مكافأة الولاء = جلسة مجانية بسعر جلسة التأهيل (الخدمة القديمة اتشالت فكان بيرجع لقيمة ثابتة 250)
  ['loyalty_redeem_core', `where id = 'sv_pt'`, `where id = 'sv_physio'`],
  // نصوص ظاهرة للمستخدم في كل الدوال
  ['*', 'غير سعوديين', 'أجانب'], ['*', 'غير السعوديين', 'الأجانب'], ['*', 'غير سعودي', 'أجنبي'], ['*', 'سعودي', 'مصري'],
  ['*', ' ر.س', ' ج.م'], ['*', 'ر.س', 'ج.م'],
];

const fns = await sql(`select p.oid::int as oid, p.proname, pg_get_functiondef(p.oid) d from pg_proc p join pg_namespace n on n.oid = p.pronamespace
  where n.nspname = 'public' and p.prokind = 'f' order by p.proname, p.oid`);
let out = `-- 903 (مولَّد بـ scripts/gen-egypt-migration.mjs): توطين مصر في دوال القاعدة\n--  • الرقم القومي المصري (14 رقم يبدأ بـ 2/3) للمصري، ورقم جواز السفر (6–20 حرف/رقم) للأجنبي — بدل الهوية/الإقامة السعودية\n--  • «مصري / أجنبي» بدل «سعودي / غير سعودي» (القيم المخزنة saudi/non_saudi زي ما هي)، و ج.م بدل ر.س\n--  • مكافأة الولاء بقيمة جلسة التأهيل sv_physio\n\n`;
const touched = [];
for (const f of fns) {
  let d = f.d;
  const before = d;
  const hits = [];
  for (const [name, from, to] of RULES) {
    if (name !== '*' && name !== f.proname) continue;
    // دالة بدل نص في replace: النص فيه '$' (نهاية regex في SQL) وكان بيتفسّر كنمط استبدال
    const next = typeof from === 'string' ? d.split(from).join(to) : d.replace(from, () => to);
    if (next !== d) { hits.push(typeof from === 'string' ? from.slice(0, 30) : 'regex'); d = next; }
    else if (name !== '*') console.warn(`  ! rule did not match in ${f.proname}: ${String(from).slice(0, 60)}`);
  }
  if (d !== before) { out += `${d};\n\n`; touched.push(`${f.proname} (${hits.length})`); }
}
writeFileSync(new URL('../supabase/migrations/903_egypt_localization.sql', import.meta.url), out);
console.log(`functions rewritten: ${touched.length}\n  ${touched.join('\n  ')}`);
