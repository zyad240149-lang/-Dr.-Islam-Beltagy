// «معلومات الطبيب» تحت كل دواء في الروشتة — داخلية للطبيب بس، ومش بتتطبع ولا بتتبعت للمريض
// (الطباعة printRx بتاخد الاسم/الجرعة/المرات/المدة/الملاحظة بس من سطر الروشتة).
// المعروض هنا هو اللي متسجّل فعلًا في بنك الأدوية — أي حاجة مش متسجلة بتظهر «غير مسجّل» من غير تخمين.
import { useEffect, useState } from 'react';
import { supabase } from '../lib/supabase';
import { Icon } from '../utils/icons';
import type { Interaction } from './interactions';

interface BankRow { id: string; name: string; scientific_name: string; group: string; notes: string }

// التركيز والشكل الصيدلاني مكتوبين جوه الاسم التجاري في البنك (مثال: WINZOXIB 120 MG 7 F.C.TABS.)
export function parseMedName(name: string) {
  const strength = name.match(/\d+(?:[.,]\d+)?\s*(?:mg|mcg|µg|i\.?u\.?|%|gm|g|u)(?![a-z])(?:\s*\/\s*\d*(?:[.,]\d+)?\s*(?:ml|gm|g|tab|dose))?/i)?.[0]?.replace(/\s+/g, ' ').trim() ?? '';
  const forms: [RegExp, string][] = [
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

const cache = new Map<string, BankRow | null>();
function useBankRow(name: string) {
  const k = name.trim().toLowerCase();
  const [row, setRow] = useState<BankRow | null | undefined>(cache.get(k));
  useEffect(() => {
    if (!k) { setRow(null); return; }
    if (cache.has(k)) { setRow(cache.get(k)); return; }
    let live = true;
    supabase.from('ortho_medications').select('id,name,scientific_name,group,notes').ilike('name', name.trim()).limit(1).then(({ data, error }) => {
      if (error) { if (live) setRow(null); return; } // من غير نت: بنعرض اللي معانا بس
      const r = (data?.[0] as BankRow | undefined) ?? null;
      cache.set(k, r); if (live) setRow(r);
    });
    return () => { live = false; };
  }, [k, name]);
  return row;
}

function useAlternatives(sci: string, self: string, enabled: boolean) {
  const [rows, setRows] = useState<{ name: string }[] | null>(null);
  useEffect(() => {
    if (!enabled || !sci.trim()) { setRows(null); return; }
    let live = true;
    supabase.from('ortho_medications').select('name').ilike('scientific_name', sci.trim()).neq('name', self).order('name').limit(30)
      .then(({ data, error }) => { if (live) setRows(error ? [] : (data ?? [])); });
    return () => { live = false; };
  }, [sci, self, enabled]);
  return rows;
}

const Missing = () => <span className="muted">غير مسجّل</span>;

function Line({ label, children }: { label: string; children: React.ReactNode }) {
  return <div className="med-info__line"><span className="med-info__k">{label}</span><span className="med-info__v">{children}</span></div>;
}

export function MedDoctorInfo({ name, interactions, onPickAlt }: { name: string; interactions: Interaction[]; onPickAlt?: (name: string) => void }) {
  const [open, setOpen] = useState(false);
  const row = useBankRow(name);
  const p = parseMedName(name);
  const sci = row?.scientific_name?.trim() ?? '';
  const alts = useAlternatives(sci, row?.name ?? name, open);
  const mine = interactions.filter((x) => [x.a, x.b].some((n) => n.trim().toLowerCase() === name.trim().toLowerCase()));
  if (!name.trim()) return null;
  return (
    <details className="med-info" open={open} onToggle={(e) => setOpen((e.target as HTMLDetailsElement).open)}>
      <summary>
        <Icon name="alert" size={14} /> معلومات الطبيب
        {sci && <span className="med-info__chip" dir="ltr">{sci}</span>}
        {mine.length > 0 && <span className={`med-info__chip ${mine.some((x) => x.level === 'danger') ? 'is-danger' : 'is-warn'}`}>{mine.length} تنبيه تداخل</span>}
        <span className="med-info__private">للطبيب فقط — مش بيتطبع</span>
      </summary>
      <div className="med-info__body">
        {row === undefined && <p className="muted">بيحمّل…</p>}
        {row === null && <p className="muted">الدواء ده مش متسجّل في بنك الأدوية (أو مفيش نت) — المعلومات اللي تحت من الاسم بس.</p>}
        <div className="med-info__grid">
          <Line label="المادة الفعالة">{sci ? <span dir="ltr">{sci}</span> : <><Missing /> <span className="badge badge--warn">محتاج مراجعة</span></>}</Line>
          <Line label="التصنيف">{row?.group ? <span dir="ltr">{row.group}</span> : <Missing />}</Line>
          <Line label="التركيز">{p.strength ? <span dir="ltr">{p.strength}</span> : <Missing />}</Line>
          <Line label="الشكل الصيدلاني">{p.form || <Missing />}</Line>
          <Line label="حجم العبوة">{p.pack || <Missing />}</Line>
          <Line label="الشركة المصنعة"><Missing /></Line>
          <Line label="سعر العبوة"><Missing /></Line>
          <Line label="بلد المنشأ"><Missing /></Line>
        </div>
        {mine.length > 0 && (
          <div className="med-info__sec">
            <h4>التداخلات مع أدوية الروشتة</h4>
            {mine.map((x, i) => <div key={i} className={`med-info__ix ${x.level === 'danger' ? 'is-danger' : 'is-warn'}`}><b>{x.level === 'danger' ? 'خطير' : 'متوسط'}</b> — مع <b dir="ltr">{x.a.toLowerCase() === name.trim().toLowerCase() ? x.b : x.a}</b>: {x.msg}</div>)}
          </div>
        )}
        <div className="med-info__sec">
          <h4>التحذيرات · موانع الاستخدام · الآثار الجانبية</h4>
          <p className="muted">لسه مش متسجّلة لهذا الدواء — مفيش معلومة مؤكدة نعرضها. غياب التحذير مش معناه إن الدواء آمن.</p>
        </div>
        <div className="med-info__sec">
          <h4>بدائل بنفس المادة الفعالة {alts && <span className="num">({alts.length}{alts.length === 30 ? '+' : ''})</span>}</h4>
          {!sci ? <p className="muted">المادة الفعالة مش متسجّلة — مش هنقدر نجيب بدائل.</p>
            : alts === null ? <p className="muted">بيحمّل…</p>
            : alts.length === 0 ? <p className="muted">مفيش بدائل في البنك.</p>
            : <div className="med-info__alts">{alts.map((a) => <button type="button" key={a.name} dir="ltr" className="med-info__alt" title="استبدل بالدواء ده" onClick={() => onPickAlt?.(a.name)}>{a.name}</button>)}</div>}
        </div>
        {row?.notes?.trim() && <div className="med-info__sec"><h4>الملاحظة الافتراضية للدواء</h4><p>{row.notes}</p></div>}
        <p className="med-info__src">المصدر: بنك الأدوية في النظام (المادة الفعالة والتصنيف)، والتركيز/الشكل/العبوة مستنتجين من الاسم التجاري. المصدر الأصلي للبنك غير موثّق — راجع قبل الاعتماد.</p>
      </div>
    </details>
  );
}
