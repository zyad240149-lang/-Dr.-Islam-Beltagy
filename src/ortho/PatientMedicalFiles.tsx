// «الأشعة والتحاليل الخاصة بالمريض» جوّه التشخيص: كل اللي الاستقبال رفعه في ملف المريض (patient_files) بيتعرض تلقائي في كل تشخيص.
// الملفات مش بتتنسخ جوّه التشخيص — بتتقري من ملف المريض كل مرة، فمفيش تكرار ومابتختفيش بعد الحفظ أو مع تشخيص جديد.
// «جديدة» = اترفعت بعد آخر تشخيص اتحفظ للمريض (غير التشخيص المفتوح)؛ الباقي «سابقة».
import { useEffect, useState } from 'react';
import { db } from '../data/db';
import { Icon } from '../utils/icons';
import { fmtDate, fmtDateTime } from '../utils/format';
import { FilePreviewModal } from '../components/DetailsHost';
import { FILE_CATEGORY, downloadFile, fileTitle } from '../components/PatientExtras';
import { ortho } from './data';
import { usePatientFiles } from './files';
import type { PatientFile, PatientFileCategory } from '../types';

/** categories: يعرض تصنيفات معيّنة بس (أشعة عند الأشعة، سونار عند السونار، تحاليل عند التحاليل). hideEmpty: مايظهرش لو مفيش ملفات */
export function PatientMedicalFiles({ patientId, excludeConsultId, categories, title = 'الأشعة والتحاليل الخاصة بالمريض', icon = 'doc', hideEmpty }: {
  patientId: string; excludeConsultId?: string; categories?: PatientFileCategory[]; title?: string; icon?: string; hideEmpty?: boolean;
}) {
  const live = usePatientFiles(patientId);
  // ملفات الفواتير (invoices/) مش ملفات طبية
  const files: PatientFile[] | null = live.loading ? null : live.files.filter((f) => !f.filePath.includes('/invoices/') && (!categories || categories.includes(f.category)));
  const err = !!live.error && !live.files.length;
  const [preview, setPreview] = useState<PatientFile | null>(null);
  const [open, setOpen] = useState(true);
  if (!patientId) return null;

  const lastConsult = ortho.list('consultations', patientId)
    .filter((c) => c.id !== excludeConsultId)
    .map((c) => Date.parse(String((c as { createdAt?: string }).createdAt ?? '')) || 0)
    .reduce((a, b) => Math.max(a, b), 0);
  const medical = (files ?? []).filter((f) => f.category !== 'other');
  const others = (files ?? []).filter((f) => f.category === 'other');
  const fresh = medical.filter((f) => lastConsult && f.createdAt > lastConsult);
  const older = medical.filter((f) => !fresh.includes(f));
  const total = (files ?? []).length;
  if (hideEmpty && files !== null && total === 0) return null;
  const what = categories?.length === 1 ? FILE_CATEGORY[categories[0]] : 'أشعة أو تحاليل';

  return (
    <section className="cx-sec pmf">
      <button type="button" className="cx-sec__head pmf__head" aria-expanded={open} onClick={() => setOpen((v) => !v)}>
        <Icon name={icon as 'doc'} size={17} /><h3>{title}</h3>
        <span className="badge badge--brand num">{files === null ? '…' : total}</span>
        {fresh.length > 0 && <span className="badge badge--warn">{fresh.length} جديد</span>}
        <Icon name={open ? 'chevron' : 'chevronLeft'} size={15} />
      </button>
      {open && (err ? <p className="cx-empty">تعذّر تحميل الملفات — اتأكد من الاتصال بالإنترنت.</p>
        : files === null ? <p className="cx-empty">جاري التحميل…</p>
        : total === 0 ? <p className="cx-empty">مفيش {what} مرفوعة في ملف المريض. الاستقبال يقدر يرفعها من ملف المريض ← «ملفات الأشعة والتحاليل» (يختار التصنيف «{categories?.length === 1 ? FILE_CATEGORY[categories[0]] : 'أشعة'}»).</p>
        : <>
          {fresh.length > 0 && <Group title="جديدة منذ آخر تشخيص" items={fresh} onOpen={setPreview} fresh />}
          {older.length > 0 && <Group title={fresh.length ? 'سابقة' : lastConsult ? 'سابقة' : 'كل الملفات'} items={older} onOpen={setPreview} />}
          {others.length > 0 && <Group title="ملفات أخرى" items={others} onOpen={setPreview} />}
        </>)}
      {preview && <FilePreviewModal file={preview} onClose={() => setPreview(null)} />}
    </section>
  );
}

function Group({ title, items, onOpen, fresh }: { title: string; items: PatientFile[]; onOpen: (f: PatientFile) => void; fresh?: boolean }) {
  return (
    <div className="pmf__group">
      <div className="pmf__gtitle">{title}</div>
      <div className="pmf__grid">{items.map((f) => <Tile key={f.id} f={f} onOpen={() => onOpen(f)} fresh={fresh} />)}</div>
    </div>
  );
}

function Tile({ f, onOpen, fresh }: { f: PatientFile; onOpen: () => void; fresh?: boolean }) {
  const [thumb, setThumb] = useState<string | null>(null);
  useEffect(() => { if (!f.fileType.startsWith('image/')) return; if (f.localUrl) setThumb(f.localUrl); else void db.fileUrl(f.filePath).then(setThumb); }, [f.filePath, f.fileType, f.localUrl]);
  return (
    <div className={`pmf__tile ${fresh ? 'is-new' : ''}`}>
      <button type="button" className="pmf__thumb" onClick={onOpen} title={`معاينة ${fileTitle(f)}`}>
        {thumb ? <img src={thumb} alt="" loading="lazy" /> : <span><Icon name="doc" size={26} />{f.fileType === 'application/pdf' ? 'PDF' : ''}</span>}
      </button>
      <div className="pmf__meta">
        <b title={fileTitle(f)}>{fileTitle(f)}</b>
        {f.pendingSync && <span className={`badge badge--${f.syncError ? 'danger' : 'warn'}`}>{f.syncError ? 'فشل الرفع' : 'على الجهاز — بانتظار الرفع'}</span>}
        <span className="muted-sm">{FILE_CATEGORY[f.category]}{f.fileDate ? ` · ${fmtDate(f.fileDate)}` : ''}</span>
        <span className="muted-sm">اترفع {fmtDateTime(f.createdAt)}{f.uploadedByName ? ` — ${f.uploadedByName}` : ''}</span>
        {f.note && <span className="muted-sm pmf__note">{f.note}</span>}
        <span className="pmf__acts">
          <button type="button" className="btn btn--outline btn--sm" onClick={onOpen}>فتح</button>
          <button type="button" className="btn btn--outline btn--sm" onClick={() => void downloadFile(f)} aria-label={`تنزيل ${fileTitle(f)}`}><Icon name="download" size={14} /></button>
        </span>
      </div>
    </div>
  );
}
