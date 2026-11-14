// «معلومات الطبيب» تحت كل دواء في الروشتة — داخلية للطبيب بس، ومش بتتطبع ولا بتتبعت للمريض
// (الطباعة printRx بتاخد الاسم/الجرعة/المرات/المدة/الملاحظة بس من سطر الروشتة).
// المعروض هنا هو اللي متسجّل فعلًا في بنك الأدوية — أي حاجة مش متسجلة بتظهر «غير مسجّل» من غير تخمين.
import { useEffect, useState, type ReactNode } from 'react';
import { supabase } from '../lib/supabase';
import { Button } from '../components/ui';
import { Icon } from '../utils/icons';
import { useToast } from '../hooks/useToast';
import { useClinicalCan } from './kit';
import type { Interaction } from './interactions';

// التركيز والشكل الصيدلاني مكتوبين جوه الاسم التجاري في البنك (مثال: WINZOXIB 120 MG 7 F.C.TABS.)
export function parseMedName(name: string) {
  // «30 GM» لوحدها غالبًا حجم أنبوبة مش تركيز — الجرام يتحسب تركيز بس لو أقل من 5 (مثال: AUGMENTIN 1GM) أو لو بعدها «/»
  const strength = [...name.matchAll(/\d+(?:[.,]\d+)?\s*(?:mg|mcg|µg|i\.?u\.?|%|gm|g|u)(?![a-z])(?:\s*\/\s*\d*(?:[.,]\d+)?\s*(?:ml|gm|g|tab|dose))?/gi)]
    .map((m) => m[0].replace(/\s+/g, ' ').trim())
    .find((s) => !/^[\d.,]+\s*(gm|g)$/i.test(s) || parseFloat(s.replace(',', '.')) < 5) ?? '';
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

// ———————————————————— البيانات (جداول 973) ————————————————————
interface BankRow { id: string; name: string; scientific_name: string; group: string; notes: string; strength: string; dosage_form: string; data_status: string; info_source: string }
interface Ingredient { id: string; name: string; synonyms: string[]; strength: string; reference_dose: string; contraindications: string; warnings: string; side_effects: string; interactions: string; info_source: string; info_updated_at: string | null; data_status: string }
export interface Internal { company: string; origin_country: string; pack_size: string; doctor_notes: string; info_source: string; updated_at: string }
export interface Price { price: number; currency: string; country: string; price_basis: 'pack' | 'unit'; pack_size: string; company: string; verified_at: string; source: string }
export interface MedInfoData { row: BankRow | null; ings: Ingredient[]; internal: Internal | null; prices: Price[]; offline?: boolean }

const esc = (s: string) => s.trim().replace(/[\\%_]/g, (c) => `\\${c}`);
const cache = new Map<string, MedInfoData>();

export async function loadInfo(name: string): Promise<MedInfoData> {
  const { data, error } = await supabase.from('ortho_medications').select('id,name,scientific_name,group,notes,strength,dosage_form,data_status,info_source').ilike('name', esc(name)).limit(1);
  if (error) return { row: null, ings: [], internal: null, prices: [], offline: true };
  const row = (data?.[0] as BankRow | undefined) ?? null;
  if (!row) return { row: null, ings: [], internal: null, prices: [] };
  const [li, inn, pr] = await Promise.all([
    supabase.from('ortho_medication_ingredients').select('strength,position,ingredient:ortho_active_ingredients(id,name,synonyms,reference_dose,contraindications,warnings,side_effects,interactions,info_source,info_updated_at,data_status,merged_into)').eq('medication_id', row.id).order('position'),
    supabase.from('ortho_med_internal').select('company,origin_country,pack_size,doctor_notes,info_source,updated_at').eq('medication_id', row.id).maybeSingle(),
    supabase.from('ortho_med_prices').select('price,currency,country,price_basis,pack_size,company,verified_at,source').eq('medication_id', row.id).order('verified_at', { ascending: false }).limit(10),
  ]);
  // المواد المكررة (merged_into — migration 975) بتتشال لإن الدواء مربوط كمان بالمادة الأساسية
  const ings = ((li.data ?? []) as unknown as { strength: string; ingredient: (Omit<Ingredient, 'strength'> & { merged_into: string | null }) | null }[]).filter((x) => x.ingredient && !x.ingredient.merged_into).map((x) => ({ ...x.ingredient!, strength: x.strength }));
  return { row, ings, internal: (inn.data as Internal | null) ?? null, prices: (pr.data ?? []) as Price[] };
}

function useMedInfo(name: string, enabled: boolean) {
  const k = name.trim().toLowerCase();
  const [info, setInfo] = useState<MedInfoData | undefined>(cache.get(k));
  const [tick, setTick] = useState(0);
  useEffect(() => {
    if (!k || !enabled) return;
    if (cache.has(k) && tick === 0) { setInfo(cache.get(k)); return; }
    let live = true;
    loadInfo(name).then((d) => { if (!d.offline) cache.set(k, d); if (live) setInfo(d); });
    return () => { live = false; };
  }, [k, name, enabled, tick]);
  return { info, reload: () => { cache.delete(k); setTick((t) => t + 1); } };
}

// البدائل: أدوية ليها نفس المواد الفعالة بالظبط (نفس الـ scientific_name) — بتركيزها
function useAlternatives(sci: string, self: string, enabled: boolean) {
  const [rows, setRows] = useState<{ name: string; strength: string }[] | null>(null);
  useEffect(() => {
    if (!enabled || !sci.trim()) { setRows(null); return; }
    let live = true;
    supabase.from('ortho_medications').select('name,strength').ilike('scientific_name', esc(sci)).neq('name', self).order('strength').order('name').limit(40)
      .then(({ data, error }) => { if (live) setRows(error ? [] : ((data ?? []) as { name: string; strength: string }[])); });
    return () => { live = false; };
  }, [sci, self, enabled]);
  return rows;
}

const STATUS: Record<string, [string, string]> = { needs_review: ['محتاج مراجعة', 'badge--warn'], partial: ['بيانات ناقصة', 'badge--info'], verified: ['متراجع', 'badge--ok'] };
const Missing = () => <span className="muted">غير مسجّل</span>;
const daysAgo = (d: string) => Math.floor((Date.now() - new Date(d + 'T00:00:00').getTime()) / 86400000);

function Line({ label, children }: { label: string; children: ReactNode }) {
  return <div className="med-info__line"><span className="med-info__k">{label}</span><span className="med-info__v">{children}</span></div>;
}

// المصدر: لو فيه رابط النشرة يبقى لينك يفتح في تابة جديدة
function SourceText({ src }: { src: string }) {
  if (!src) return <>المصدر: غير مذكور</>;
  const m = src.match(/https?:\/\/\S+/);
  if (!m) return <>المصدر: {src}</>;
  return <>المصدر: {src.slice(0, m.index).replace(/[—\s]+$/, '')} — <a href={m[0]} target="_blank" rel="noopener noreferrer">افتح النشرة</a></>;
}

function PriceText({ p }: { p: Price }) {
  const old = daysAgo(p.verified_at) > 180;
  return (
    <span>
      <b className="num">{Number(p.price).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })} {p.currency}</b>
      {' '}— {p.price_basis === 'pack' ? 'سعر العبوة' : 'سعر الوحدة'}{p.pack_size ? ` (${p.pack_size})` : ''}
      <span className="muted"> · اتأكد <span className="num" dir="ltr">{p.verified_at}</span> · المصدر: {p.source}</span>
      {old && <span className="badge badge--warn" style={{ marginInlineStart: 6 }}>قديم — محتاج تحديث</span>}
    </span>
  );
}

// ———————————————————— نموذج تعديل البيانات الداخلية + إضافة سعر ————————————————————
function InternalEditor({ medId, internal, onSaved, onCancel }: { medId: string; internal: Internal | null; onSaved: () => void; onCancel: () => void }) {
  const toast = useToast();
  const [f, setF] = useState({ company: internal?.company ?? '', origin_country: internal?.origin_country ?? '', pack_size: internal?.pack_size ?? '', doctor_notes: internal?.doctor_notes ?? '', info_source: internal?.info_source ?? '' });
  const [p, setP] = useState({ price: '', currency: 'EGP', price_basis: 'pack' as 'pack' | 'unit', verified_at: new Date().toISOString().slice(0, 10), source: '' });
  const [busy, setBusy] = useState(false);
  const set = (k: keyof typeof f) => (e: { target: { value: string } }) => setF((x) => ({ ...x, [k]: e.target.value }));
  const save = async () => {
    const priceN = p.price.trim() ? Number(p.price.replace(',', '.')) : null;
    if (priceN !== null && (!Number.isFinite(priceN) || priceN < 0)) { toast.error('السعر لازم يكون رقم'); return; }
    if (priceN !== null && !p.source.trim()) { toast.error('اكتب مصدر السعر (مثال: فاتورة الصيدلية، نشرة الشركة)'); return; }
    setBusy(true);
    try {
      const a = await supabase.from('ortho_med_internal').upsert({ medication_id: medId, ...f }, { onConflict: 'medication_id' });
      if (a.error) throw a.error;
      if (priceN !== null) {
        const b = await supabase.from('ortho_med_prices').insert({ medication_id: medId, price: priceN, currency: p.currency.trim() || 'EGP', country: 'EG', price_basis: p.price_basis, pack_size: f.pack_size, company: f.company, verified_at: p.verified_at, source: p.source.trim() });
        if (b.error) throw b.error;
      }
      toast.success('اتحفظت معلومات الطبيب');
      onSaved();
    } catch (e) { toast.error(`ماتحفظش: ${(e as Error).message}`); }
    finally { setBusy(false); }
  };
  return (
    <div className="med-info__edit">
      <div className="med-info__form">
        <label>الشركة المصنعة<input className="input" dir="auto" value={f.company} onChange={set('company')} /></label>
        <label>بلد المنشأ<input className="input" dir="auto" value={f.origin_country} onChange={set('origin_country')} /></label>
        <label>حجم العبوة<input className="input" dir="auto" placeholder="مثال: 20 قرص" value={f.pack_size} onChange={set('pack_size')} /></label>
        <label>مصدر البيانات<input className="input" dir="auto" placeholder="مثال: علبة الدواء، نشرة الشركة" value={f.info_source} onChange={set('info_source')} /></label>
      </div>
      <label className="med-info__notes">ملاحظات الطبيب (للطبيب بس — مش بتتطبع)<textarea className="input" rows={3} dir="auto" value={f.doctor_notes} onChange={set('doctor_notes')} placeholder="تنبيهات الجرعة، احتياطات، ملاحظات خاصة…" /></label>
      <fieldset className="med-info__price">
        <legend>إضافة سعر جديد (اختياري — السعر القديم بيفضل محفوظ في السجل)</legend>
        <div className="med-info__form">
          <label>السعر<input className="input num" inputMode="decimal" dir="ltr" value={p.price} onChange={(e) => setP((x) => ({ ...x, price: e.target.value }))} /></label>
          <label>العملة<input className="input" dir="ltr" value={p.currency} onChange={(e) => setP((x) => ({ ...x, currency: e.target.value.toUpperCase() }))} /></label>
          <label>السعر ده لـ<select className="input" value={p.price_basis} onChange={(e) => setP((x) => ({ ...x, price_basis: e.target.value as 'pack' | 'unit' }))}><option value="pack">العبوة كاملة</option><option value="unit">الوحدة (قرص/أمبول)</option></select></label>
          <label>تاريخ التأكد<input className="input" type="date" dir="ltr" value={p.verified_at} onChange={(e) => setP((x) => ({ ...x, verified_at: e.target.value }))} /></label>
          <label>مصدر السعر<input className="input" dir="auto" placeholder="مثال: فاتورة صيدلية…" value={p.source} onChange={(e) => setP((x) => ({ ...x, source: e.target.value }))} /></label>
        </div>
      </fieldset>
      <div className="med-info__actions">
        <Button size="sm" icon="check" loading={busy} onClick={save}>حفظ</Button>
        <Button size="sm" variant="ghost" onClick={onCancel}>إلغاء</Button>
      </div>
    </div>
  );
}

// ———————————————————— البطاقة ————————————————————
export function MedDoctorInfo({ name, interactions, onPickAlt }: { name: string; interactions: Interaction[]; onPickAlt?: (name: string) => void }) {
  const [open, setOpen] = useState(false);
  const [editing, setEditing] = useState(false);
  const perm = useClinicalCan('medications');
  const { info, reload } = useMedInfo(name, true);
  const row = info?.row ?? null;
  const p = parseMedName(name);
  const sci = row?.scientific_name?.trim() ?? '';
  const alts = useAlternatives(sci, row?.name ?? name, open);
  const mine = interactions.filter((x) => [x.a, x.b].some((n) => n.trim().toLowerCase() === name.trim().toLowerCase()));
  const internal = info?.internal ?? null;
  const price = info?.prices[0];
  const status = STATUS[row?.data_status ?? 'needs_review'];
  if (!name.trim()) return null;
  const ings = info?.ings ?? [];
  const pick = (k: 'contraindications' | 'warnings' | 'side_effects' | 'interactions' | 'reference_dose') => ings.filter((i) => i[k]?.trim()).map((i) => ({ who: i.name, text: i[k], src: i.info_source, at: i.info_updated_at, st: i.data_status }));
  const Medical = ({ title, k }: { title: string; k: 'contraindications' | 'warnings' | 'side_effects' | 'interactions' | 'reference_dose' }) => {
    const xs = pick(k);
    return (
      <div className="med-info__sec">
        <h4>{title}</h4>
        {!xs.length ? <p className="muted">مش متسجّلة — مفيش معلومة موثّقة نعرضها.</p> : xs.map((x, i) => (
          <div key={i} className="med-info__med">
            {ings.length > 1 && <b dir="ltr">{x.who}: </b>}<div className="med-info__txt" dir="ltr">{x.text}</div>
            <div className="med-info__src"><SourceText src={x.src} /> {x.at ? ` · تاريخ النشرة ${x.at}` : ''} · {STATUS[x.st]?.[0] ?? x.st}{x.src.includes('FDA') ? ' · نص النشرة الأمريكية بالإنجليزي' : ''}</div>
          </div>
        ))}
      </div>
    );
  };
  return (
    <details className="med-info" open={open} onToggle={(e) => setOpen((e.target as HTMLDetailsElement).open)}>
      <summary>
        <Icon name="alert" size={14} /> معلومات الطبيب
        {internal?.company && <span className="med-info__chip">{internal.company}</span>}
        {price && <span className="med-info__chip num">{Number(price.price).toLocaleString('en-US')} {price.currency}</span>}
        {sci && <span className="med-info__chip" dir="ltr">{sci}</span>}
        {mine.length > 0 && <span className={`med-info__chip ${mine.some((x) => x.level === 'danger') ? 'is-danger' : 'is-warn'}`}>{mine.length} تنبيه تداخل</span>}
        <span className="med-info__private">للطبيب فقط — مش بيتطبع</span>
      </summary>
      {open && (
        <div className="med-info__body">
          {info === undefined && <p className="muted">بيحمّل…</p>}
          {info?.offline && <p className="muted">مفيش نت — المعلومات اللي تحت من اسم الدواء بس.</p>}
          {info && !info.offline && !row && <p className="muted">الدواء ده مش متسجّل في بنك الأدوية — المعلومات اللي تحت من الاسم بس.</p>}
          {row && <div><span className={`badge ${status[1]}`}>{status[0]}</span></div>}
          <div className="med-info__grid">
            <Line label="الشركة المصنعة">{internal?.company || <Missing />}</Line>
            <Line label="سعر العبوة">{price ? <PriceText p={price} /> : <Missing />}</Line>
            <Line label="المادة الفعالة">{ings.length ? <span dir="ltr">{ings.map((i) => `${i.name}${i.strength ? ` ${i.strength}` : ''}`).join(' + ')}</span> : sci ? <span dir="ltr">{sci}</span> : <Missing />}</Line>
            <Line label="التركيز">{(row?.strength || p.strength) ? <span dir="ltr">{row?.strength || p.strength}</span> : <Missing />}</Line>
            <Line label="الشكل الصيدلاني">{row?.dosage_form || p.form || <Missing />}</Line>
            <Line label="حجم العبوة">{internal?.pack_size || p.pack || <Missing />}</Line>
            <Line label="بلد المنشأ">{internal?.origin_country || <Missing />}</Line>
            <Line label="التصنيف">{row?.group ? <span dir="ltr">{row.group}</span> : <Missing />}</Line>
          </div>
          {ings.length > 1 && <p className="muted" style={{ margin: 0 }}>دواء مركّب من <span className="num">{ings.length}</span> مواد فعالة.</p>}
          {mine.length > 0 && (
            <div className="med-info__sec">
              <h4>التداخلات مع أدوية الروشتة</h4>
              {mine.map((x, i) => <div key={i} className={`med-info__ix ${x.level === 'danger' ? 'is-danger' : 'is-warn'}`}><b>{x.level === 'danger' ? 'خطير' : 'متوسط'}</b> — مع <b dir="ltr">{x.a.toLowerCase() === name.trim().toLowerCase() ? x.b : x.a}</b>: {x.msg}<div className="med-info__src">المصدر: قواعد التداخل في النظام — للمراجعة</div></div>)}
            </div>
          )}
          <div className="med-info__sec">
            <h4>ملاحظات الطبيب</h4>
            {internal?.doctor_notes?.trim() ? <p style={{ whiteSpace: 'pre-wrap' }}>{internal.doctor_notes}</p> : <p className="muted">مفيش ملاحظات.</p>}
          </div>
          <Medical title="الجرعة المرجعية (للمراجعة)" k="reference_dose" />
          <Medical title="التحذيرات والاحتياطات" k="warnings" />
          <Medical title="موانع الاستخدام" k="contraindications" />
          <Medical title="الآثار الجانبية المهمة" k="side_effects" />
          <p className="muted" style={{ margin: 0, fontSize: 12 }}>غياب التحذير مش معناه إن الدواء آمن.</p>
          {info && info.prices.length > 1 && (
            <div className="med-info__sec"><h4>سجل الأسعار</h4>{info.prices.slice(1).map((x, i) => <div key={i}><PriceText p={x} /></div>)}</div>
          )}
          <div className="med-info__sec">
            <h4>بدائل بنفس المادة الفعالة {alts && <span className="num">({alts.length}{alts.length === 40 ? '+' : ''})</span>}</h4>
            {!sci ? <p className="muted">المادة الفعالة مش متسجّلة — مش هنقدر نجيب بدائل.</p>
              : alts === null ? <p className="muted">بيحمّل…</p>
              : alts.length === 0 ? <p className="muted">مفيش بدائل في البنك.</p>
              : <div className="med-info__alts">{alts.map((a) => <button type="button" key={a.name} dir="ltr" className={`med-info__alt${a.strength && row?.strength && a.strength.toLowerCase() !== row.strength.toLowerCase() ? ' is-diff' : ''}`} title={a.strength && row?.strength && a.strength.toLowerCase() !== row.strength.toLowerCase() ? 'تركيز مختلف — استبدل بالدواء ده' : 'استبدل بالدواء ده'} onClick={() => onPickAlt?.(a.name)}>{a.name}</button>)}</div>}
          </div>
          {row?.notes?.trim() && <div className="med-info__sec"><h4>الملاحظة الافتراضية للدواء (دي بتنزل في الروشتة)</h4><p>{row.notes}</p></div>}
          {row && perm.edit && !editing && <div><Button size="sm" variant="outline" icon="edit" onClick={() => setEditing(true)}>تعديل الشركة/السعر/ملاحظات الطبيب</Button></div>}
          {row && editing && <InternalEditor medId={row.id} internal={internal} onCancel={() => setEditing(false)} onSaved={() => { setEditing(false); reload(); }} />}
          <p className="med-info__src">المصدر: بنك الأدوية في النظام{internal?.info_source ? ` + ${internal.info_source}` : ''}. التركيز/الشكل/العبوة مستنتجين من الاسم التجاري لو مش مسجّلين. المصدر الأصلي للبنك غير موثّق — راجع قبل الاعتماد.</p>
        </div>
      )}
    </details>
  );
}
