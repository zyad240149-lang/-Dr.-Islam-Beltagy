// «طباعة وإرسال» التشخيص: اختيار الأجزاء (شيت التمريض / كشف الطبيب / الروشتة — أو الكل) وبعدين طباعة أو تحميل PDF أو واتساب.
// واتساب من غير API (زي إرسال الفاتورة): الموبايل ← شاشة المشاركة والـ PDF مرفق؛ الكمبيوتر ← الملف بيتحمّل ومحادثة المريض بتتفتح
// والموظف يرفقه. نص الرسالة عام من غير أي بيانات طبية.
import { useState } from 'react';
import { Button, Modal } from '../components/ui';
import { Icon } from '../utils/icons';
import { useToast } from '../hooks/useToast';
import { isMobile } from '../pwa/pwa';
import { canShareFiles } from '../data/whatsappInvoice';
import { fileNoText } from '../utils/phoneUtils';
import { waPhone } from '../utils/format';
import type { Patient } from '../types';
import type { Consultation } from './data';
import { DX_PARTS, buildDiagnosisPdf, hasRx, printDiagnosis, type DxPart } from './printDiagnosis';

const SHARE_TEXT = 'السلام عليكم، مرفق لكم ملف الكشف من عيادة د. إسلام جمعة بلتاجي.';

function saveFile(file: File) {
  const a = document.createElement('a');
  a.href = URL.createObjectURL(file); a.download = file.name;
  document.body.appendChild(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(a.href), 60_000);
}

export function DiagnosisOutput({ c, patient, visitNo, initial, onClose }: {
  c: Omit<Consultation, 'id'> & { id?: string }; patient?: Patient | null; visitNo?: number; initial: DxPart[]; onClose: () => void;
}) {
  const toast = useToast();
  const rxOk = hasRx(c);
  const available = DX_PARTS.filter((x) => x.id !== 'rx' || rxOk).map((x) => x.id);
  const [parts, setParts] = useState<DxPart[]>(() => initial.filter((x) => available.includes(x)));
  const [busy, setBusy] = useState<'' | 'pdf' | 'wa'>('');
  const [ready, setReady] = useState<File | null>(null); // المتصفح طلب ضغطة تانية قبل المشاركة — الملف جاهز
  const chosen = DX_PARTS.map((x) => x.id).filter((x) => parts.includes(x));
  const all = available.every((x) => parts.includes(x));
  const phone = patient?.phone ? waPhone(patient.phone) : '';
  const toggle = (id: DxPart) => setParts((xs) => (xs.includes(id) ? xs.filter((x) => x !== id) : [...xs, id]));

  async function makeFile() {
    const blob = await buildDiagnosisPdf(c, patient, visitNo, chosen);
    const what = chosen.length === available.length ? 'Diagnosis' : chosen.map((x) => ({ nurse: 'Nursing', doctor: 'HipKnee', rx: 'Rx' }[x])).join('-');
    return new File([blob], `${what}-${fileNoText(patient?.fileNo) || 'patient'}-${c.date}.pdf`, { type: 'application/pdf' });
  }

  async function download() {
    setBusy('pdf');
    try { saveFile(await makeFile()); toast.success('اتحمّل ملف PDF.'); }
    catch (e) { toast.error((e as Error).message || 'تعذّر إنشاء ملف PDF.'); }
    finally { setBusy(''); }
  }

  async function share(file: File) {
    try {
      await navigator.share({ files: [file], text: SHARE_TEXT });
      setReady(null);
    } catch (e) {
      const name = (e as DOMException).name;
      if (name === 'NotAllowedError') setReady(file); // المتصفح عايز ضغطة جديدة
      else if (name !== 'AbortError') { saveFile(file); toast.info('اتحمّل الملف — ابعته من واتساب.'); }
    }
  }

  async function whatsapp() {
    const mobileShare = isMobile && canShareFiles();
    // الكمبيوتر: النافذة بتتفتح وقت الضغطة (قبل تجهيز الملف) عشان المتصفح مايحجبهاش
    const win = mobileShare ? null : window.open('about:blank', '_blank');
    setBusy('wa');
    try {
      const file = await makeFile();
      if (mobileShare) { await share(file); return; }
      saveFile(file);
      const url = phone ? `https://wa.me/${phone}?text=${encodeURIComponent(SHARE_TEXT)}` : `https://api.whatsapp.com/send?text=${encodeURIComponent(SHARE_TEXT)}`;
      if (win && !win.closed) win.location.href = url; else window.open(url, '_blank');
      toast.info('اتحمّل ملف الـ PDF — ارفقه في محادثة واتساب اللي اتفتحت.');
    } catch (e) {
      win?.close();
      toast.error((e as Error).message || 'تعذّر إنشاء ملف PDF.');
    } finally { setBusy(''); }
  }

  return (
    <Modal title="طباعة وإرسال" onClose={onClose} footer={<Button variant="outline" onClick={onClose}>إغلاق</Button>}>
      <div className="out">
        <div className="out__lbl">اختار اللي عايز تطبعه أو تبعته</div>
        <div className="out-parts">
          <label className={`out-part out-part--all${all ? ' is-on' : ''}`}>
            <input type="checkbox" checked={all} onChange={() => setParts(all ? [] : available)} />
            <span>الكل مرة واحدة</span>
          </label>
          {DX_PARTS.map((x, i) => {
            const off = !available.includes(x.id);
            return (
              <label key={x.id} className={`out-part${parts.includes(x.id) ? ' is-on' : ''}${off ? ' is-off' : ''}`}>
                <input type="checkbox" disabled={off} checked={parts.includes(x.id)} onChange={() => toggle(x.id)} />
                <span><b className="num">{i + 1}</b> {x.label}{off && <small> — مفيش روشتة في الكشف ده</small>}</span>
              </label>
            );
          })}
        </div>

        <div className="out-actions">
          <button type="button" className="out-act" disabled={!chosen.length || !!busy} onClick={() => printDiagnosis(c, patient, visitNo, chosen)}>
            <Icon name="print" size={22} /><b>طباعة</b><small>على الطابعة على طول</small>
          </button>
          <button type="button" className="out-act" disabled={!chosen.length || !!busy} onClick={() => void download()}>
            <Icon name="download" size={22} /><b>{busy === 'pdf' ? 'بيتجهّز…' : 'تحميل PDF'}</b><small>ملف على الجهاز</small>
          </button>
          <button type="button" className="out-act out-act--wa" disabled={!chosen.length || !!busy} onClick={() => void whatsapp()}>
            <Icon name="share" size={22} /><b>{busy === 'wa' ? 'بيتجهّز…' : 'إرسال واتساب'}</b>
            <small>{phone ? <>للمريض <bdi dir="ltr">{patient?.phone}</bdi></> : 'مفيش رقم — هتختار المحادثة'}</small>
          </button>
        </div>

        {ready && (
          <div className="out-ready">
            <span>الملف جاهز — اضغط «مشاركة» واختار واتساب.</span>
            <Button size="sm" icon="share" onClick={() => void share(ready)}>مشاركة</Button>
          </div>
        )}
      </div>
    </Modal>
  );
}
