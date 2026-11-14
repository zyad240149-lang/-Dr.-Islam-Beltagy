// «معلومات الطبيب» جوّه نافذة «تعديل الدواء» (تحت الملاحظة) — للي عنده صلاحية قسم «الأدوية» بس، ومش بتتطبع في الروشتة.
// المواد الفعالة + التركيز للوحدة + الشكل + العبوة + الشركة + بلد المنشأ + السعر (وسعر الوحدة محسوب) + ملاحظات الطبيب.
// بتتحفظ في: ortho_medications (scientific_name/strength/dosage_form)، ortho_medication_ingredients، ortho_med_internal، ortho_med_prices.
import { useEffect, useState } from 'react';
import { supabase } from '../lib/supabase';
import { Field } from './kit';
import { loadInfo, parseMedName, type MedInfoData, type Price } from './medInfo';

export interface DoctorDraft {
  scientific: string; strength: string; form: string; pack_size: string; company: string; origin_country: string; doctor_notes: string; info_source: string;
  price: string; currency: string; price_basis: 'pack' | 'unit'; verified_at: string; price_source: string;
}
export const emptyDoctorDraft = (): DoctorDraft => ({ scientific: '', strength: '', form: '', pack_size: '', company: '', origin_country: '', doctor_notes: '', info_source: '', price: '', currency: 'EGP', price_basis: 'pack', verified_at: new Date().toISOString().slice(0, 10), price_source: '' });

const today = () => new Date().toISOString().slice(0, 10);
const units = (pack: string) => { const n = pack.match(/\d+(?:[.,]\d+)?/)?.[0]; return n ? parseFloat(n.replace(',', '.')) : 0; };
const money = (n: number, c: string) => `${n.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })} ${c}`;

/** بيحمّل البيانات المسجلة للدواء ويملى النموذج — والتركيز/الشكل/العبوة من الاسم لو مش مسجّلين (للمراجعة) */
export function useDoctorDraft(name: string, enabled: boolean) {
  const [d, setD] = useState<DoctorDraft>(emptyDoctorDraft);
  const [info, setInfo] = useState<MedInfoData | null>(null);
  const [loaded, setLoaded] = useState(false);
  useEffect(() => {
    if (!enabled || !name.trim()) { setLoaded(true); return; }
    let live = true;
    loadInfo(name).then((x) => {
      if (!live) return;
      const p = parseMedName(name);
      setInfo(x);
      setD((cur) => ({
        ...cur,
        scientific: x.row?.scientific_name ?? '',
        strength: x.row?.strength || p.strength,
        form: x.row?.dosage_form || p.form,
        pack_size: x.internal?.pack_size || p.pack,
        company: x.internal?.company ?? '', origin_country: x.internal?.origin_country ?? '',
        doctor_notes: x.internal?.doctor_notes ?? '', info_source: x.internal?.info_source ?? '',
      }));
      setLoaded(true);
    });
    return () => { live = false; };
    // بيتحمّل مرة واحدة لما النافذة تتفتح — تغيير الاسم وانت بتكتب مش بيمسح اللي كتبته
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [enabled]);
  return { d, setD, info, loaded };
}

export function DoctorFields({ d, setD, info }: { d: DoctorDraft; setD: (f: (x: DoctorDraft) => DoctorDraft) => void; info: MedInfoData | null }) {
  const set = (k: keyof DoctorDraft) => (e: { target: { value: string } }) => setD((x) => ({ ...x, [k]: e.target.value }));
  const cur: Price | undefined = info?.prices[0];
  const n = units(d.pack_size);
  const newPrice = d.price.trim() ? Number(d.price.replace(',', '.')) : NaN;
  const shownPrice = Number.isFinite(newPrice) ? { p: newPrice, c: d.currency || 'EGP', basis: d.price_basis } : cur ? { p: Number(cur.price), c: cur.currency, basis: cur.price_basis } : null;
  const perUnit = shownPrice && n > 0 ? (shownPrice.basis === 'pack' ? shownPrice.p / n : shownPrice.p * n) : null;
  const ings = info?.ings ?? [];
  return (
    <fieldset className="med-doc span-2">
      <legend>معلومات الطبيب <small>للطبيب بس — مش بتتطبع في الروشتة</small></legend>
      <div className="grid-form grid-form--2">
        <Field label="المادة الفعالة (لو أكتر من مادة: A + B)" className="span-2"><input className="input" dir="ltr" value={d.scientific} onChange={set('scientific')} placeholder="diclofenac potassium" /></Field>
        {ings.length > 0 && <p className="muted span-2" style={{ margin: '-4px 0 0', fontSize: 12.5 }} dir="ltr">{ings.map((i) => `${i.name}${i.strength ? ` ${i.strength}` : ''}`).join(' + ')}</p>}
        <Field label="التركيز في الوحدة"><input className="input" dir="ltr" value={d.strength} onChange={set('strength')} placeholder="50 mg / كيس" /></Field>
        <Field label="الشكل الصيدلاني"><input className="input" value={d.form} onChange={set('form')} placeholder="أكياس" /></Field>
        <Field label="عدد الوحدات في العبوة"><input className="input" value={d.pack_size} onChange={set('pack_size')} placeholder="9 أكياس" /></Field>
        <Field label="الشركة المصنعة"><input className="input" dir="auto" value={d.company} onChange={set('company')} /></Field>
        <Field label="بلد المنشأ"><input className="input" value={d.origin_country} onChange={set('origin_country')} placeholder="مصر" /></Field>
        <Field label="مصدر البيانات"><input className="input" value={d.info_source} onChange={set('info_source')} placeholder="علبة الدواء / نشرة الشركة" /></Field>
      </div>

      <div className="med-doc__price">
        <b>السعر</b>
        {cur ? <span> الحالي: <span className="num">{money(Number(cur.price), cur.currency)}</span> {cur.price_basis === 'pack' ? 'للعبوة' : 'للوحدة'} — اتأكد <span className="num" dir="ltr">{cur.verified_at}</span> ({cur.source})</span>
          : <span className="muted"> مفيش سعر مسجّل</span>}
        <div className="grid-form grid-form--2" style={{ marginTop: 8 }}>
          <Field label="سعر جديد (اختياري)"><input className="input num" inputMode="decimal" dir="ltr" value={d.price} onChange={set('price')} placeholder="0.00" /></Field>
          <Field label="السعر ده لـ"><select className="input" value={d.price_basis} onChange={(e) => setD((x) => ({ ...x, price_basis: e.target.value as 'pack' | 'unit' }))}><option value="pack">العبوة كاملة</option><option value="unit">الوحدة (قرص/كيس/أمبول)</option></select></Field>
          <Field label="العملة"><input className="input" dir="ltr" value={d.currency} onChange={(e) => setD((x) => ({ ...x, currency: e.target.value.toUpperCase() }))} /></Field>
          <Field label="تاريخ التأكد من السعر"><input className="input" type="date" dir="ltr" max={today()} value={d.verified_at} onChange={set('verified_at')} /></Field>
          <Field label="مصدر السعر (مطلوب مع السعر)" className="span-2"><input className="input" value={d.price_source} onChange={set('price_source')} placeholder="فاتورة صيدلية / قائمة الشركة" /></Field>
        </div>
        {shownPrice && (
          <p className="med-doc__calc">
            {n > 0
              ? <>محسوب: {shownPrice.basis === 'pack' ? <>سعر الوحدة ≈ <b className="num">{money(perUnit!, shownPrice.c)}</b> (العبوة ÷ <span className="num">{n}</span>)</> : <>سعر العبوة ≈ <b className="num">{money(perUnit!, shownPrice.c)}</b> (الوحدة × <span className="num">{n}</span>)</>}</>
              : <span className="muted">اكتب عدد الوحدات في العبوة عشان يتحسب سعر الوحدة.</span>}
          </p>
        )}
      </div>

      <Field label="ملاحظات الطبيب (تنبيهات الجرعة، احتياطات…)" className="span-2"><textarea className="input" rows={3} value={d.doctor_notes} onChange={set('doctor_notes')} placeholder="مش بتظهر للمريض" /></Field>
    </fieldset>
  );
}

/** حفظ معلومات الطبيب بعد حفظ الدواء نفسه (medId من ortho.save) */
export async function saveDoctorInfo(medId: string, d: DoctorDraft, before: MedInfoData | null) {
  const priceN = d.price.trim() ? Number(d.price.replace(',', '.')) : null;
  if (priceN !== null && (!Number.isFinite(priceN) || priceN < 0)) throw new Error('السعر لازم يكون رقم');
  if (priceN !== null && !d.price_source.trim()) throw new Error('اكتب مصدر السعر');
  const sci = d.scientific.split('+').map((x) => x.trim()).filter(Boolean).join('+');
  const up = await supabase.from('ortho_medications').update({ scientific_name: sci, strength: d.strength.trim(), dosage_form: d.form.trim(), data_status: 'partial' }).eq('id', medId);
  if (up.error) throw up.error;
  // ربط المواد الفعالة: لو اتغيّرت، كل مادة بتتلاقي (أو تتعمل) وتتربط — الربط القديم بيفضل
  if (sci && sci.toLowerCase() !== (before?.row?.scientific_name ?? '').toLowerCase()) {
    const parts = sci.split('+').map((x) => x.replace(/\(.*?\)/g, ' ').replace(/\s+/g, ' ').trim().toLowerCase()).filter(Boolean);
    for (const [pos, name] of parts.entries()) {
      let ing = (await supabase.from('ortho_active_ingredients').select('id,merged_into').ilike('name', name.replace(/[\\%_]/g, (c) => `\\${c}`)).maybeSingle()).data as { id: string; merged_into: string | null } | null;
      if (!ing) {
        const ins = await supabase.from('ortho_active_ingredients').insert({ name }).select('id,merged_into').single();
        if (ins.error) throw ins.error;
        ing = ins.data as { id: string; merged_into: string | null };
      }
      const link = await supabase.from('ortho_medication_ingredients').upsert({ medication_id: medId, ingredient_id: ing.merged_into ?? ing.id, position: pos, strength: parts.length === 1 ? d.strength.trim() : '' }, { onConflict: 'medication_id,ingredient_id' });
      if (link.error) throw link.error;
    }
  }
  const a = await supabase.from('ortho_med_internal').upsert({ medication_id: medId, company: d.company.trim(), origin_country: d.origin_country.trim(), pack_size: d.pack_size.trim(), doctor_notes: d.doctor_notes, info_source: d.info_source.trim() }, { onConflict: 'medication_id' });
  if (a.error) throw a.error;
  if (priceN !== null) {
    const b = await supabase.from('ortho_med_prices').insert({ medication_id: medId, price: priceN, currency: d.currency.trim() || 'EGP', country: 'EG', price_basis: d.price_basis, pack_size: d.pack_size.trim(), company: d.company.trim(), verified_at: d.verified_at || today(), source: d.price_source.trim() });
    if (b.error) throw b.error;
  }
}
