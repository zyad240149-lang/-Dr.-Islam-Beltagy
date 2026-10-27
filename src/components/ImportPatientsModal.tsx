// «استيراد المرضى من Excel» — للمدير فقط (الصلاحية patient_import على الخادم + إخفاء الزرار).
// خطوات: رفع الملف ← مطابقة الأعمدة ← معاينة وتصحيح الأخطاء ومراجعة التكرار ← حفظ على دفعات ← تقرير.
// مفيش حفظ نهائي غير بعد ما المدير يأكّد في خطوة المعاينة. الاستيراد بيضيف مرضى جدد بس — مابيعدّلش ولا يحذف مريض موجود.
import { useMemo, useRef, useState } from 'react';
import { supabase } from '../lib/supabase';
import { db } from '../data/db';
import { Button, Modal, StatusBadge } from './ui';
import { Icon } from '../utils/icons';
import { downloadXlsx } from '../utils/xlsx';
import { REFERRAL_SOURCE_LABEL } from '../utils/format';
import { useToast } from '../hooks/useToast';
import { useAuth } from '../services/auth';
import { exportPatientsWorkbook } from '../utils/patientsWorkbook';
import { fileNoText } from '../utils/phoneUtils';
import {
  FIELDS, FIELD_BY_KEY, MAX_FILE_BYTES, MAX_ROWS, TEMPLATE_HEADERS, buildRows, detectMapping, errorReport, markFileDuplicates, validateRec,
  type Cell, type ImportContext, type ImportKey, type ImportRow,
} from '../utils/patientImport';

type Step = 'upload' | 'map' | 'review' | 'importing' | 'done';
interface Dup { i: number; kind: 'duplicate' | 'possible'; by: string; matchFileNo: string; matchName: string }
interface ServerRes { i: number; status: 'added' | 'duplicate' | 'review' | 'rejected'; reason?: string; fileNo?: string; matchFileNo?: string }

const BATCH = 100;
const DUP_BY: Record<string, string> = { file_no: 'رقم الملف', national_id: 'رقم الهوية', phone: 'رقم الجوال', name_birth: 'الاسم + تاريخ الميلاد' };
const cleanErr = (m: string) => m.replace(/^.*?ERROR:\s*/, '');
const REQUIRED_NOTE = 'مطلوب لكل مريض: الاسم ثلاثي (الاسم + الأب + العائلة) + الرقم القومي (14 رقم يبدأ بـ 2 أو 3) أو جواز السفر للأجنبي + رقم الجوال + الجنسية (تُحدَّد من الهوية إذا لم تُكتب).';
const KEEP_EMAIL = 'zyad240149@gmail.com';

export function downloadPatientTemplate() {
  downloadXlsx('نموذج استيراد المرضى', [
    { name: 'المرضى', rows: [TEMPLATE_HEADERS], widths: TEMPLATE_HEADERS.map((h) => Math.max(14, h.length + 4)), freezeHeader: false },
    { name: 'تعليمات', widths: [26, 70], freezeHeader: true, rows: [['العمود', 'القيم المقبولة'], ...FIELDS.map((f) => [f.label, f.hint || 'نص حر']), ['', ''], ['ملاحظة', REQUIRED_NOTE], ['ملاحظة', 'اكتب أرقام الجوال كنص (Format: Text) حتى ما يُحذف الصفر في البداية.'], ['ملاحظة', 'الاستيراد يضيف مرضى جدد فقط ولا يعدّل مريض موجود. لازم ما يكون الجوال ورقم الملف ورقم الهوية مسجّلة مسبقًا.']] },
  ]);
}

export default function ImportPatientsModal({ onClose, onDone }: { onClose: () => void; onDone: () => void }) {
  const toast = useToast();
  const { user } = useAuth();
  const isGM = user?.role === 'system_admin';
  const [replace, setReplace] = useState(false);
  const [confirmText, setConfirmText] = useState('');
  const [wiped, setWiped] = useState<number | null>(null);
  const [step, setStep] = useState<Step>('upload');
  const [busy, setBusy] = useState(false);
  const [fileName, setFileName] = useState('');
  const [cells, setCells] = useState<Cell[][]>([]);
  const [mapping, setMapping] = useState<Partial<Record<ImportKey, number>>>({});
  const [fixedNat, setFixedNat] = useState<'' | 'saudi' | 'non_saudi'>('');
  const [rows, setRows] = useState<ImportRow[]>([]);
  const [dups, setDups] = useState<Map<number, Dup>>(new Map());
  const [decisions, setDecisions] = useState<Record<number, 'skip' | 'add'>>({});
  const [touched, setTouched] = useState<Record<number, ImportKey[]>>({}); // الصفوف اللي المدير بيصلّحها: بتفضل ظاهرة لحد ما يخلّص كتابة
  const [progress, setProgress] = useState(0);
  const [results, setResults] = useState<ServerRes[]>([]);
  const [err, setErr] = useState('');
  const importId = useRef(crypto.randomUUID());
  const running = useRef(false);
  const headers = useMemo(() => (cells[0] ?? []).map((c) => String(c ?? '').trim()), [cells]);
  const ctx: ImportContext = useMemo(() => ({ therapists: db.allTherapists().map((t) => ({ id: t.id, name: t.name })), fixedNationality: fixedNat }), [fixedNat]);

  const pickFile = async (f: File | undefined) => {
    if (!f) return;
    setErr('');
    if (/\.xls$/i.test(f.name)) { setErr('صيغة .xls القديمة غير مدعومة (لأسباب أمان). افتح الملف في Excel واحفظه بصيغة .xlsx ثم ارفعه.'); return; }
    if (!/\.xlsx$/i.test(f.name)) { setErr('لازم يكون الملف بصيغة .xlsx'); return; }
    if (f.size === 0) { setErr('الملف فارغ.'); return; }
    if (f.size > MAX_FILE_BYTES) { setErr('الملف كبير جدًا (الحد الأقصى 8 ميجا).'); return; }
    setBusy(true);
    try {
      const { readSheet } = await import('read-excel-file/browser');
      const data = (await readSheet(f)) as Cell[][];
      if (!data || data.length < 2) { setErr('الملف ما يحتوي على بيانات (لازم وجود صف عناوين وصف بيانات على الأقل).'); return; }
      if (data.length - 1 > MAX_ROWS) { setErr(`الملف يحتوي على أكثر من ${MAX_ROWS} صف. قسّمه إلى ملفين أو أكثر.`); return; }
      const hdr = (data[0] ?? []).map((c) => String(c ?? '').trim());
      const det = detectMapping(hdr);
      if (det.duplicateHeaders.length) { setErr(`فيه أعمدة مكررة بالاسم نفسه: ${det.duplicateHeaders.join('، ')} — غيّر اسم العمود المكرر في الملف وارفعه مرة ثانية.`); return; }
      setCells(data); setFileName(f.name); setMapping(det.mapping); setStep('map');
    } catch { setErr('تعذّرت قراءة الملف — تأكد أنه ملف Excel (.xlsx) سليم وغير تالف.'); }
    finally { setBusy(false); }
  };

  const hasName = mapping.fullName !== undefined || (mapping.firstName !== undefined && mapping.fatherName !== undefined && mapping.familyName !== undefined);
  const hasNat = mapping.nationality !== undefined || mapping.nationalId !== undefined || !!fixedNat;
  const canContinue = hasName && mapping.phone !== undefined && hasNat;
  const setMap = (k: ImportKey, v: string) => setMapping((m) => { const n = { ...m }; if (v === '') delete n[k]; else n[k] = +v; return n; });

  // معاينة: تحقق محلي + فحص تكرار من الخادم (مابيكتبش حاجة)
  const analyze = async () => {
    setBusy(true); setErr('');
    try {
      const built = buildRows(cells, mapping, ctx);
      if (!built.length) { setErr('ما فيه صفوف بيانات في الملف (جميعها فارغة).'); return; }
      const found = new Map<number, Dup>();
      const ready = built.filter((r) => r.payload);
      for (let s = 0; s < ready.length; s += 500) {
        const part = ready.slice(s, s + 500).map((r) => r.payload!);
        const { data, error } = await supabase.rpc('patient_import_check', { p_rows: part, p_replace: replace });
        if (error) throw new Error(cleanErr(error.message));
        for (const d of (data ?? []) as Array<{ i: number; kind: 'duplicate' | 'possible'; by: string; matchFileNo: string; matchName: string }>) found.set(d.i, d);
      }
      setRows(built); setDups(found); setDecisions({}); setStep('review');
    } catch (e) { setErr((e as Error).message || 'تعذّر فحص الملف.'); }
    finally { setBusy(false); }
  };

  const editRec = (i: number, key: ImportKey, value: string) => {
    setTouched((t) => ({ ...t, [i]: Array.from(new Set([...(t[i] ?? []), key, ...(rows.find((x) => x.i === i)?.issues.map((x) => x.field).filter((x): x is ImportKey => x !== 'row') ?? [])])) }));
    setRows((prev) => {
      const next = prev.map((r) => {
        if (r.i !== i) return r;
        const rec = { ...r.rec, [key]: value };
        const v = validateRec(rec, ctx, r.i);
        return { ...r, rec, payload: v.payload, issues: v.issues, notes: v.notes };
      });
      markFileDuplicates(next);
      return next;
    });
    setDups((d) => { const n = new Map(d); n.delete(i); return n; }); // التعديل بيلغي نتيجة فحص التكرار القديمة لحد ما يتعاد الفحص
  };
  const recheck = async () => {
    setBusy(true);
    try {
      const ready = rows.filter((r) => r.payload && !dups.has(r.i));
      const found = new Map(dups);
      for (let s = 0; s < ready.length; s += 500) {
        const { data, error } = await supabase.rpc('patient_import_check', { p_rows: ready.slice(s, s + 500).map((r) => r.payload!), p_replace: replace });
        if (error) throw new Error(cleanErr(error.message));
        for (const d of (data ?? []) as Dup[]) found.set(d.i, d);
      }
      setDups(found);
    } catch (e) { toast.error((e as Error).message); } finally { setBusy(false); }
  };

  const stat = useMemo(() => {
    const errors = rows.filter((r) => !r.payload).length;
    const fileDup = rows.filter((r) => r.payload && r.fileDup).length;
    const dupExist = rows.filter((r) => r.payload && !r.fileDup && dups.get(r.i)?.kind === 'duplicate').length;
    const possible = rows.filter((r) => r.payload && !r.fileDup && dups.get(r.i)?.kind === 'possible');
    const possibleAdd = possible.filter((r) => decisions[r.i] === 'add').length;
    const ready = rows.filter((r) => r.payload && !r.fileDup && !dups.has(r.i)).length + possibleAdd;
    return { total: rows.length, errors, fileDup, dupExist, possible: possible.length, possibleUndecided: possible.length - possible.filter((r) => decisions[r.i]).length, ready };
  }, [rows, dups, decisions]);

  const toSend = () => rows.filter((r) => r.payload && !r.fileDup && (!dups.has(r.i) || (dups.get(r.i)!.kind === 'possible' && decisions[r.i] === 'add')))
    .map((r) => ({ ...r.payload!, force: dups.get(r.i)?.kind === 'possible' }));

  const start = async () => {
    if (running.current) return; // منع الضغط المكرر
    const list = toSend();
    if (!list.length) { toast.error('ما فيه صفوف جاهزة للاستيراد.'); return; }
    if (replace && confirmText.trim() !== 'حذف') { toast.error('اكتب كلمة «حذف» للتأكيد قبل الاستبدال.'); return; }
    running.current = true; setStep('importing'); setProgress(0); setErr('');
    const all: ServerRes[] = [];
    try {
      if (replace) {
        // نسخة احتياطية Excel كاملة بتتنزّل أول، وبعدين الحذف (مرة واحدة بمفتاح ثابت)، وبعدين الاستيراد
        try { exportPatientsWorkbook(); } catch { /* النسخة الاحتياطية best-effort */ }
        const { data: w, error: we } = await supabase.rpc('patient_import_wipe', { p_key: `${importId.current}:wipe`, p_confirm: 'حذف' });
        if (we) throw new Error(cleanErr(we.message));
        setWiped((w as { wiped: number }).wiped);
      }
      for (let s = 0, n = 0; s < list.length; s += BATCH, n++) {
        const key = `${importId.current}:${n}`; // نفس الدفعة لو اتبعتت تاني ترجع نفس النتيجة من غير تكرار
        const { data, error } = await supabase.rpc('patient_import_commit', { p_key: key, p_rows: list.slice(s, s + BATCH) });
        if (error) throw new Error(cleanErr(error.message));
        all.push(...((data as { results: ServerRes[] }).results ?? []));
        setProgress(Math.min(100, Math.round(((s + BATCH) / list.length) * 100)));
      }
    } catch (e) { setErr('توقّف الاستيراد: ' + (e as Error).message + ' — ما حُفظ سابقًا يبقى محفوظًا، ولا تقدر تعيد الصفوف نفسها (ستُعلَّم مكررة).'); }
    setResults(all); running.current = false; setStep('done');
    await db.refresh();
    onDone();
  };

  const report = () => {
    const lines = errorReport(rows.filter((r) => !r.payload || r.fileDup || dups.has(r.i)), results);
    downloadXlsx('تقرير استيراد المرضى', [{ name: 'التقرير', freezeHeader: true, widths: [10, 24, 50, 50], rows: [['رقم الصف', 'العمود', 'السبب', 'طريقة التصحيح'], ...lines.map((l) => [l.row, l.column, l.reason, l.fix])] }]);
  };

  const added = results.filter((r) => r.status === 'added').length;
  const serverDup = results.filter((r) => r.status === 'duplicate').length;
  const serverRej = results.filter((r) => r.status === 'rejected').length;
  const serverRev = results.filter((r) => r.status === 'review').length;

  const issueRows = rows.filter((r) => !r.payload || r.fileDup || dups.has(r.i) || touched[r.i]);
  const therapistOpts = db.allTherapists();
  const cellInput = (r: ImportRow, key: ImportKey) => {
    const f = FIELD_BY_KEY[key];
    const bad = r.issues.some((x) => x.field === key);
    const style = { minWidth: 130, borderColor: bad ? 'var(--danger, #c0392b)' : undefined } as const;
    if (key === 'nationality') return <select className="input" style={style} value={r.rec.nationality} onChange={(e) => editRec(r.i, key, e.target.value)}><option value="">—</option><option value="مصري">مصري</option><option value="أجنبي">أجنبي</option></select>;
    if (key === 'gender') return <select className="input" style={style} value={r.rec.gender} onChange={(e) => editRec(r.i, key, e.target.value)}><option value="">—</option><option value="ذكر">ذكر</option><option value="أنثى">أنثى</option></select>;
    if (key === 'referralSource') return <select className="input" style={style} value={r.rec.referralSource} onChange={(e) => editRec(r.i, key, e.target.value)}><option value="">—</option>{Object.values(REFERRAL_SOURCE_LABEL).map((l) => <option key={l} value={l}>{l}</option>)}</select>;
    if (key === 'doctor') return <select className="input" style={style} value={r.rec.doctor} onChange={(e) => editRec(r.i, key, e.target.value)}><option value="">—</option>{therapistOpts.map((t) => <option key={t.id} value={t.name}>{t.name}</option>)}</select>;
    if (key === 'active') return <select className="input" style={style} value={r.rec.active} onChange={(e) => editRec(r.i, key, e.target.value)}><option value="">نشط (افتراضي)</option><option value="نشط">نشط</option><option value="معطّل">معطّل</option></select>;
    return <input className="input" style={style} dir={key === 'phone' || key === 'nationalId' || key === 'email' || key === 'birthDate' || key === 'fileNo' ? 'ltr' : 'auto'} value={r.rec[key]} aria-label={f.label} onChange={(e) => editRec(r.i, key, e.target.value)} />;
  };
  const fieldsOfRow = (r: ImportRow): ImportKey[] => {
    const ks = new Set<ImportKey>([...(touched[r.i] ?? []), ...r.issues.map((x) => x.field).filter((x): x is ImportKey => x !== 'row')]);
    if (r.fileDup) ks.add(r.fileDup.startsWith('رقم الجوال') ? 'phone' : r.fileDup.startsWith('رقم الهوية') ? 'nationalId' : 'fileNo');
    return [...ks];
  };

  const footer = step === 'upload' ? <Button variant="outline" onClick={onClose}>إغلاق</Button>
    : step === 'map' ? <><Button variant="outline" onClick={() => setStep('upload')}>رجوع</Button><Button onClick={analyze} loading={busy} disabled={!canContinue}>معاينة وفحص البيانات</Button></>
    : step === 'review' ? <><Button variant="outline" onClick={() => setStep('map')} disabled={busy}>رجوع للمطابقة</Button>
        <Button variant="outline" onClick={recheck} loading={busy}>إعادة فحص التكرار</Button>
        <Button icon="check" variant={replace ? 'danger' : undefined} onClick={start} disabled={busy || stat.ready === 0 || (replace && confirmText.trim() !== 'حذف')}>{replace ? 'حذف الحاليين واستيراد' : 'استيراد'} {stat.ready} مريض</Button></>
    : step === 'done' ? <><Button variant="outline" icon="download" onClick={report} disabled={!issueRows.length && !serverDup && !serverRej && !serverRev}>تنزيل تقرير الأخطاء</Button><Button onClick={onClose}>إغلاق</Button></>
    : undefined;

  return (
    <Modal title="استيراد المرضى من Excel" xl onClose={() => { if (step !== 'importing') onClose(); }} footer={footer}>
      {err && <div className="alert alert-danger" role="alert" style={{ marginBottom: 12 }}><Icon name="alert" size={17} /><div>{err}</div></div>}

      {step === 'upload' && (
        <div>
          <p style={{ marginTop: 0 }}>ارفع ملف Excel (.xlsx) يحتوي على بيانات المرضى. ستظهر لك معاينة لمراجعة الأخطاء والتكرار قبل أي حفظ، والاستيراد <strong>يضيف مرضى جدد فقط</strong> (ما يعدّل أي مريض موجود ولا يحذفه).</p>
          <div className="row-between" style={{ gap: 12, flexWrap: 'wrap', marginBottom: 14 }}>
            <Button variant="outline" icon="download" onClick={downloadPatientTemplate}>تحميل نموذج Excel جاهز</Button>
            <span className="muted-sm">الحد الأقصى {MAX_ROWS} صف و8 ميجا للملف.</span>
          </div>
          <label className="card" style={{ display: 'block', padding: 26, textAlign: 'center', borderStyle: 'dashed', cursor: 'pointer' }}>
            <Icon name="doc" size={28} /><div style={{ marginTop: 8, fontWeight: 600 }}>{busy ? 'جاري قراءة الملف…' : 'اضغط لاختيار ملف Excel'}</div>
            <input type="file" accept=".xlsx" style={{ display: 'none' }} disabled={busy} onChange={(e) => { void pickFile(e.target.files?.[0]); e.target.value = ''; }} />
          </label>
          <p className="muted-sm" style={{ marginTop: 12 }}>{REQUIRED_NOTE}</p>
        </div>
      )}

      {step === 'map' && (
        <div>
          <p style={{ marginTop: 0 }}>الملف: <strong dir="auto">{fileName}</strong> — <span className="num">{cells.length - 1}</span> صف. راجع مطابقة الأعمدة (تمت تلقائيًا) وصحّحها إن لزم.</p>
          <div className="table-wrap"><table className="table">
            <thead><tr><th>حقل النظام</th><th>عمود الملف</th><th>ملاحظة</th></tr></thead>
            <tbody>
              {FIELDS.map((f) => (
                <tr key={f.key}>
                  <td><strong>{f.label}</strong></td>
                  <td><select className="input" value={mapping[f.key] ?? ''} onChange={(e) => setMap(f.key, e.target.value)}>
                    <option value="">— غير مستورد —</option>
                    {headers.map((h, i) => <option key={i} value={i}>{h || `(عمود ${i + 1} بدون عنوان)`}</option>)}
                  </select></td>
                  <td className="muted-sm">{f.hint}</td>
                </tr>
              ))}
            </tbody>
          </table></div>
          <div className="card" style={{ padding: 12, marginTop: 12 }}>
            <label htmlFor="imp-nat" style={{ fontWeight: 600 }}>الجنسية لكل الصفوف التي لا تحتوي على جنسية</label>
            <select id="imp-nat" className="input" style={{ maxWidth: 320, marginTop: 6 }} value={fixedNat} onChange={(e) => setFixedNat(e.target.value as '' | 'saudi' | 'non_saudi')}>
              <option value="">بدون — تتحدد من عمود الجنسية أو رقم الهوية</option><option value="saudi">مصري لكل الصفوف</option><option value="non_saudi">أجنبي لكل الصفوف</option>
            </select>
            <p className="muted-sm" style={{ margin: '6px 0 0' }}>الجنسية بتحدد نوع الهوية المطلوب (رقم قومي أو جواز سفر)، لذلك لا تُخمَّن: إذا لم تكن محددة يُعلَّم الصف كخطأ.</p>
          </div>
          {isGM && (
            <div className="card" style={{ padding: 12, marginTop: 12, borderColor: replace ? 'var(--danger, #c0392b)' : undefined }}>
              <label style={{ display: 'flex', gap: 8, alignItems: 'flex-start', cursor: 'pointer' }}>
                <input type="checkbox" checked={replace} onChange={(e) => { setReplace(e.target.checked); setConfirmText(''); }} style={{ marginTop: 4 }} />
                <span><strong>استبدال جميع المرضى الحاليين بهذا الملف</strong><br /><span className="muted-sm">يحذف جميع المرضى (ومواعيدهم وفواتيرهم وخططهم وكل سجلاتهم) ما عدا المريض صاحب البريد الإلكتروني <span dir="ltr" className="num">{KEEP_EMAIL}</span>، وبعدها يستورد الملف. للمدير العام فقط.</span></span>
              </label>
            </div>
          )}
          {!canContinue && <div className="alert alert-warn" style={{ marginTop: 12 }}><div>{REQUIRED_NOTE}</div></div>}
        </div>
      )}

      {step === 'review' && (
        <div>
          <div className="kpi-grid" style={{ marginBottom: 12 }}>
            <div className="kpi"><div className="kpi__value num">{stat.total}</div><div className="kpi__label">إجمالي الصفوف</div></div>
            <div className="kpi"><div className="kpi__value num" style={{ color: 'var(--ok, #1f8f5f)' }}>{stat.ready}</div><div className="kpi__label">جاهز للاستيراد</div></div>
            <div className="kpi"><div className="kpi__value num" style={{ color: 'var(--danger, #c0392b)' }}>{stat.errors}</div><div className="kpi__label">صفوف بها أخطاء</div></div>
            <div className="kpi"><div className="kpi__value num">{stat.dupExist + stat.fileDup}</div><div className="kpi__label">مكرر (موجود / داخل الملف)</div></div>
            <div className="kpi"><div className="kpi__value num">{stat.possible}</div><div className="kpi__label">محتمل تكرار — للمراجعة</div></div>
          </div>
          {replace && (
            <div className="alert alert-danger" role="alert" style={{ marginBottom: 10, display: 'block' }}>
              <div><strong>تحذير — وضع الاستبدال:</strong> عند الضغط على «استيراد» ستُحذف <strong>كل المرضى الحاليين وكل سجلاتهم نهائيًا</strong> ماعدا <span dir="ltr" className="num">{KEEP_EMAIL}</span>، وقبل ذلك ستُنزَّل نسخة Excel احتياطية كاملة. ويُقارَن التكرار هنا بالمريض المُحتفَظ به فقط.</div>
              <div style={{ marginTop: 8 }}>اكتب كلمة <strong>حذف</strong> للتأكيد: <input className="input" style={{ maxWidth: 160, display: 'inline-block' }} value={confirmText} onChange={(e) => setConfirmText(e.target.value)} aria-label="تأكيد الحذف" /></div>
            </div>
          )}
          {stat.possibleUndecided > 0 && <div className="alert alert-warn" style={{ marginBottom: 10 }}><div>يوجد {stat.possibleUndecided} صف محتمل تكراره (نفس الاسم وتاريخ الميلاد لمريض موجود). اختر لكل صف: تخطي، أو إضافة كمريض جديد. الصفوف التي لم يُحدَّد لها قرار لن تُستورد.</div></div>}
          {issueRows.length === 0 ? <div className="alert alert-info"><div>كل الصفوف سليمة ولا فيه تكرار. اضغط «استيراد» للحفظ.</div></div> : (
            <div className="table-wrap"><table className="table">
              <thead><tr><th>الصف</th><th>الاسم</th><th>المشكلة</th><th>تصحيح</th></tr></thead>
              <tbody>
                {issueRows.slice(0, 300).map((r) => {
                  const d = dups.get(r.i); const nm = [r.rec.fullName, r.rec.firstName, r.rec.fatherName, r.rec.familyName].filter(Boolean).join(' ');
                  return (
                    <tr key={r.i}>
                      <td className="num">{r.i}</td>
                      <td dir="auto" data-no-i18n>{nm || '—'}</td>
                      <td style={{ maxWidth: 320 }}>
                        {r.payload && !r.fileDup && touched[r.i] && !dups.has(r.i) && <div><StatusBadge tone="ok" label="تم التصحيح" /> الصف جاهز للاستيراد</div>}
                        {r.issues.map((x, k) => <div key={k}><StatusBadge tone="danger" label={x.column} /> {x.reason} <span className="muted-sm">— {x.fix}</span></div>)}
                        {r.fileDup && <div><StatusBadge tone="warning" label="تكرار" /> {r.fileDup}</div>}
                        {!r.fileDup && d?.kind === 'duplicate' && <div><StatusBadge tone="muted" label="مكرر" /> {DUP_BY[d.by]} مسجّل لمريض موجود (ملف <span className="num" dir="ltr">{fileNoText(d.matchFileNo)}</span>) — لن يُضاف</div>}
                        {!r.fileDup && d?.kind === 'possible' && <div><StatusBadge tone="warning" label="محتمل تكرار" /> نفس الاسم وتاريخ الميلاد لمريض موجود (ملف <span className="num" dir="ltr">{fileNoText(d.matchFileNo)}</span>)</div>}
                      </td>
                      <td>
                        {d?.kind === 'possible' && !r.fileDup && r.payload ? (
                          <select className="input" value={decisions[r.i] ?? ''} onChange={(e) => setDecisions((x) => ({ ...x, [r.i]: e.target.value as 'skip' | 'add' }))}>
                            <option value="">— اختر —</option><option value="skip">تخطي (نفس المريض)</option><option value="add">إضافة كمريض جديد</option>
                          </select>
                        ) : <div style={{ display: 'grid', gap: 6 }}>{fieldsOfRow(r).map((k) => <div key={k}><span className="muted-sm">{FIELD_BY_KEY[k].label}</span>{cellInput(r, k)}</div>)}</div>}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table></div>
          )}
          {issueRows.length > 300 && <p className="muted-sm">تُعرض أول 300 صف بها مشكلات من {issueRows.length}. والبقية مُضمّنة في تقرير الأخطاء بعد الاستيراد.</p>}
          <p className="muted-sm" style={{ marginTop: 10 }}>الصفوف التي بها أخطاء أو تكرار مؤكد لن تُستورد، وستُحفظ باقي الصفوف السليمة. بعد تصحيح أي صف يُعتبر جاهزًا تلقائيًا (واضغط «إعادة فحص التكرار» إذا غيّرت جوالًا/هوية/رقم ملف).</p>
        </div>
      )}

      {step === 'importing' && (
        <div style={{ textAlign: 'center', padding: '24px 0' }}>
          <p>جاري الاستيراد… لا تغلق النافذة.</p>
          <div className="progress" style={{ maxWidth: 420, margin: '0 auto' }}><i style={{ width: `${progress}%` }} /></div>
          <p className="muted-sm num">{progress}%</p>
        </div>
      )}

      {step === 'done' && (
        <div>
          <div className="kpi-grid" style={{ marginBottom: 12 }}>
            <div className="kpi"><div className="kpi__value num">{rows.length}</div><div className="kpi__label">إجمالي الصفوف في الملف</div></div>
            <div className="kpi"><div className="kpi__value num" style={{ color: 'var(--ok, #1f8f5f)' }}>{added}</div><div className="kpi__label">تمت إضافتهم</div></div>
            <div className="kpi"><div className="kpi__value num" style={{ color: 'var(--danger, #c0392b)' }}>{stat.errors + serverRej}</div><div className="kpi__label">مرفوضة (أخطاء)</div></div>
            <div className="kpi"><div className="kpi__value num">{stat.dupExist + stat.fileDup + serverDup}</div><div className="kpi__label">مكررة (لم تُضاف)</div></div>
            <div className="kpi"><div className="kpi__value num">{rows.length - added}</div><div className="kpi__label">ما تم استيرادها</div></div>
          </div>
          <div className="alert alert-info"><Icon name="check" size={17} /><div>
            {wiped !== null && <>حُذف <strong className="num">{wiped}</strong> مريض حالي (مع الإبقاء على {KEEP_EMAIL}). </>}
            {added > 0 ? <>تمت إضافة <strong className="num">{added}</strong> مريض وظهروا في قائمة المرضى.</> : 'لم تتم إضافة أي مريض.'}
            {stat.possibleUndecided + serverRev > 0 && <> {stat.possibleUndecided + serverRev} صف محتمل تكراره لم يُحدَّد له قرار فلم يُستورد.</>}
            {' '}نزّل تقرير الأخطاء لمراجعة الصفوف التي لم تُضف (رقم الصف + السبب + طريقة التصحيح، دون بيانات طبية).
          </div></div>
        </div>
      )}
    </Modal>
  );
}
