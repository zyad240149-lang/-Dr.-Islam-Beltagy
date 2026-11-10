// «إرسال التمرينات عبر واتساب» من صفحة التشخيص: اختار تمارين المريض (بتتحفظ كخطة مربوطة بآخر تشخيص له)، وبعدين:
// صور / فيديوهات / رابط / فتح واتساب بس. مفيش حاجة بتتبعت لوحدها — واتساب بيفتح والمستخدم هو اللي يضغط «إرسال».
import { useState } from 'react';
import { Button, Modal } from '../components/ui';
import { db } from '../data/db';
import { useToast } from '../hooks/useToast';
import { waPhone, whatsappNumber } from '../utils/format';
import { ortho, useOrthoVersion, type Exercise, type ExerciseMedia } from './data';
import { MediaThumb } from './Exercises';
import { Field, PatientSelect, SearchBox, useClinicalCan, useRun } from './kit';
import { useCan } from '../components/common';

/** زرار «إرسال تمرينات واتساب» بيظهر بس لمين عنده صلاحية «التمرينات العلاجية» */
export function useCanSendExercises() { return useCan()('exercises', 'view'); }

type Mode = 'images' | 'videos' | 'pdfs' | 'link' | 'open';
const isPdf = (m: ExerciseMedia) => m.type === 'application/pdf';
const GREETING = 'السلام عليكم، دي التمرينات المطلوبة منك:';

const fileFor = async (m: ExerciseMedia) => {
  const blob = await (await fetch(m.url)).blob();
  return new File([blob], m.name || m.path, { type: m.type });
};

/** من مكتبة التمرينات: اختيار المريض الأول، وبعدها نفس شاشة الإرسال والتمرين متعلّم */
export function ExerciseSendPickPatient({ exercise, onClose }: { exercise: Exercise; onClose: () => void }) {
  const [patientId, setPatientId] = useState('');
  if (patientId) return <ExerciseSendModal patientId={patientId} initialSel={[exercise.id]} onClose={onClose} />;
  return (
    <Modal title={`إرسال «${exercise.name}» عبر واتساب`} onClose={onClose} footer={<Button variant="outline" onClick={onClose}>إلغاء</Button>}>
      <Field label="اختار المريض"><PatientSelect value={patientId} onChange={setPatientId} /></Field>
    </Modal>
  );
}

export function ExerciseSendModal({ patientId, initialSel, onClose }: { patientId: string; initialSel?: string[]; onClose: () => void }) {
  useOrthoVersion();
  const toast = useToast();
  const perm = useClinicalCan('exercises');
  const { run, busy } = useRun();
  // رقم الواتساب المسجّل في ملف المريض، وإلا الموبايل الأساسي
  const pt = db.patient(patientId);
  const phone = (pt ? whatsappNumber(pt) || pt.phone : '') ?? '';
  const exercises = ortho.list('exercises');
  const plans = ortho.list('exercise_plans', patientId);
  const last = plans[0];
  const [sel, setSel] = useState<string[]>(initialSel ?? last?.exerciseIds ?? []);
  const [notes, setNotes] = useState(last?.notes ?? '');
  const [q, setQ] = useState('');
  const [queue, setQueue] = useState<{ list: ExerciseMedia[]; i: number } | null>(null); // الكمبيوتر: نسخ الصور واحدة واحدة ولصقها في الشات
  const toggle = (id: string) => setSel((x) => (x.includes(id) ? x.filter((y) => y !== id) : [...x, id]));
  const term = q.trim().toLowerCase();
  const shown = exercises.filter((x) => !term || x.name.toLowerCase().includes(term) || x.group.includes(q.trim()));
  const chosen = sel.map((id) => exercises.find((x) => x.id === id)).filter((x): x is Exercise => !!x);
  const images = chosen.flatMap((x) => x.media.filter((m) => !m.type.startsWith('video/') && !isPdf(m)));
  const pdfs = chosen.flatMap((x) => x.media.filter(isPdf));
  const videos = chosen.flatMap((x) => x.media.filter((m) => m.type.startsWith('video/')));
  const canShareSheet = typeof navigator.share === 'function' && typeof navigator.canShare === 'function';
  const wa = (text?: string) => `https://wa.me/${waPhone(phone)}${text ? `?text=${encodeURIComponent(text)}` : ''}`;
  const same = !!last && last.notes === notes && last.exerciseIds.length === sel.length && last.exerciseIds.every((id, i) => id === sel[i]);

  /** الخطة بتتحفظ مربوطة بآخر تشخيص للمريض (أو بتتعاد استخدامها لو ما اتغيرتش) */
  async function ensurePlan() {
    if (same && last) return last;
    const consult = ortho.list('consultations', patientId).sort((a, b) => b.date.localeCompare(a.date))[0];
    const shareToken = crypto.randomUUID();
    const id = await ortho.save('exercise_plans', { patientId, consultationId: consult?.id ?? null, date: new Date().toISOString().slice(0, 10), exerciseIds: sel, notes, shareToken } as never);
    return { id, shareToken };
  }
  const linkText = (token: string) => `${GREETING}\n${notes ? notes + '\n' : ''}${location.origin}/ex/${token}`;
  const mediaText = (list: ExerciseMedia[]) => `${GREETING}\n${notes ? notes + '\n' : ''}${chosen.map((x) => `• ${x.name}`).join('\n')}\n\n${list.map((m) => m.url).join('\n')}`;

  const shortText = () => [GREETING, notes, ...chosen.map((x) => `• ${x.name}`)].filter(Boolean).join('\n');

  /** صور التمرينات: الموبايل ← مشاركة الصور كصور حقيقية؛ الكمبيوتر ← فتح شات المريض + نسخ كل صورة ولصقها (Ctrl+V) لأن واتساب مابيسمحش بإرفاق صور من موقع */
  async function sendImages() {
    if (!phone) { toast.error('المريض ده مالوش رقم جوال مسجّل.'); return; }
    if (!images.length) { toast.error('التمرينات المختارة مفيهاش صور.'); return; }
    if (canShareSheet) {
      const ok = await run(async () => {
        const files = await Promise.all(images.slice(0, 10).map(fileFor));
        if (!navigator.canShare({ files })) throw new Error('unsupported');
        await navigator.share({ files, text: shortText() });
      });
      void ok; onClose(); return;
    }
    window.open(wa(shortText()), '_blank');
    setQueue({ list: images, i: 0 });
  }
  async function copyNext() {
    if (!queue) return;
    const m = queue.list[queue.i];
    try {
      const blob = await (await fetch(m.url)).blob();
      const bmp = await createImageBitmap(blob);
      const cv = document.createElement('canvas'); cv.width = bmp.width; cv.height = bmp.height;
      cv.getContext('2d')!.drawImage(bmp, 0, 0);
      const png = await new Promise<Blob>((ok, no) => cv.toBlob((b) => (b ? ok(b) : no(new Error('png'))), 'image/png'));
      await navigator.clipboard.write([new ClipboardItem({ 'image/png': png })]);
      toast.success(`اتنسخت الصورة ${queue.i + 1} — الصقها في الشات (Ctrl+V) واضغط إرسال`);
      setQueue({ ...queue, i: queue.i + 1 });
    } catch { toast.error('تعذّر نسخ الصورة — اسمح للمتصفح بالوصول للـ clipboard أو جرّب Chrome/Edge.'); }
  }

  async function send(mode: Mode, asFiles = false) {
    if (!phone) { toast.error('المريض ده مالوش رقم جوال مسجّل.'); return; }
    if (mode === 'open') { window.open(wa(), '_blank'); return; }
    if (!chosen.length) { toast.error('اختار تمرين واحد على الأقل.'); return; }
    const list = mode === 'images' ? images : mode === 'pdfs' ? pdfs : videos;
    if (mode !== 'link' && !list.length) { toast.error(mode === 'images' ? 'التمرينات المختارة مفيهاش صور.' : mode === 'pdfs' ? 'التمرينات المختارة مفيهاش ملفات PDF.' : 'التمرينات المختارة مفيهاش فيديوهات.'); return; }
    // الكمبيوتر / مفيش مشاركة ملفات: نافذة واتساب بتتفتح وقت الضغطة (عشان المتصفح مايحجبهاش)
    const canFiles = asFiles && mode !== 'link' && typeof navigator.share === 'function' && typeof navigator.canShare === 'function';
    const win = canFiles ? null : window.open('about:blank', '_blank');
    await run(async () => {
      try {
        if (perm.add || perm.edit) { const plan = await ensurePlan(); if (mode === 'link') { const url = wa(linkText(plan.shareToken)); if (win && !win.closed) win.location.href = url; else window.open(url, '_blank'); return; } }
        else if (mode === 'link') throw new Error('ليس لديك صلاحية حفظ خطة التمرينات.');
        if (canFiles) {
          const files = await Promise.all(list.slice(0, 10).map(fileFor));
          if (navigator.canShare({ files })) {
            try { await navigator.share({ files, text: `${GREETING}\n${chosen.map((x) => `• ${x.name}`).join('\n')}` }); return; }
            catch (e) { if ((e as DOMException).name === 'AbortError') return; }
          }
          window.open(wa(mediaText(list)), '_blank'); return;
        }
        const url = wa(mediaText(list));
        if (win && !win.closed) win.location.href = url; else window.open(url, '_blank');
      } catch (e) { win?.close(); throw e; }
    });
    onClose();
  }

  return (
    <Modal title="إرسال التمرينات عبر واتساب" onClose={onClose} footer={<Button variant="outline" onClick={onClose}>إغلاق</Button>}>
      <p style={{ marginTop: 0 }}>اختار التمرينات للمريض <b>{db.patient(patientId)?.fullName}</b>{phone ? <> — واتساب <bdi dir="ltr" className="num">{phone}</bdi></> : <span className="sh-need"> — مفيش رقم جوال مسجّل</span>}</p>
      {exercises.length === 0
        ? <p className="muted">مفيش تمرينات في المكتبة لسه — ضيفها من قسم «التمرينات العلاجية».</p>
        : <>
          <SearchBox value={q} onChange={setQ} placeholder="ابحث في التمرينات" />
          <div className="ex-pick">
            {shown.map((x) => (
              <label key={x.id} className={`ex-pick__i${sel.includes(x.id) ? ' is-on' : ''}`}>
                <input type="checkbox" checked={sel.includes(x.id)} onChange={() => toggle(x.id)} />
                {x.media[0] && <MediaThumb m={x.media[0]} size={44} />}
                <span style={{ flex: 1, minWidth: 0 }}><b>{x.name}</b><span className="ortho-sub" style={{ display: 'block' }}>{x.group}{x.group && ' · '}{x.media.filter((m) => !m.type.startsWith('video/') && !isPdf(m)).length} صورة · {x.media.filter((m) => m.type.startsWith('video/')).length} فيديو · {x.media.filter(isPdf).length} PDF</span></span>
              </label>
            ))}
          </div>
          <input className="input" value={notes} onChange={(e) => setNotes(e.target.value)} placeholder="ملاحظة للمريض (اختياري)" />
          <div className="ortho-sub" style={{ margin: '8px 0 0' }}>المختار: <span className="num">{chosen.length}</span> تمرين</div>
        </>}
      {queue && (
        <div className="ex-step">
          {queue.i < queue.list.length ? <>
            <img src={queue.list[queue.i].url} alt="" className="ex-step__img" />
            <p className="ex-step__t">الصورة <b className="num">{queue.i + 1}</b> من <b className="num">{queue.list.length}</b> — دوس «نسخ الصورة» وبعدين في شات واتساب اضغط <b>Ctrl+V</b> وارسل. وارجع هنا للي بعدها.</p>
            <div className="ex-send"><Button icon="copy" onClick={() => void copyNext()}>نسخ الصورة {queue.i + 1}</Button><Button variant="outline" onClick={() => setQueue(null)}>إنهاء</Button></div>
          </> : <>
            <p className="ex-step__t">خلّصت كل الصور ✅</p>
            <div className="ex-send"><Button onClick={onClose}>تمام</Button></div>
          </>}
        </div>
      )}
      <div className="ex-send" hidden={!!queue}>
        {images.length > 0 && <Button icon="camera" disabled={busy} onClick={() => void sendImages()}>إرسال صور التمرينات ({images.length})</Button>}
        {videos.length > 0 && <Button icon="camera" disabled={busy} onClick={() => void send('videos')}>إرسال فيديوهات التمرينات ({videos.length})</Button>}
        {pdfs.length > 0 && <Button icon="doc" disabled={busy} onClick={() => void send('pdfs')}>إرسال ملفات PDF ({pdfs.length})</Button>}
        {chosen.length > 0 && <Button icon="share" disabled={busy} onClick={() => void send('link')}>إرسال رابط التمرينات</Button>}
        <Button variant="outline" icon="phone" disabled={busy} onClick={() => void send('open')}>فتح واتساب فقط</Button>
      </div>
      {canShareSheet && (videos.length > 0 || pdfs.length > 0) && (
        <div className="ex-send">
          {videos.length > 0 && <Button variant="outline" disabled={busy} onClick={() => void send('videos', true)}>مشاركة الفيديوهات كملفات</Button>}
          {pdfs.length > 0 && <Button variant="outline" disabled={busy} onClick={() => void send('pdfs', true)}>مشاركة PDF كملفات</Button>}
        </div>
      )}
      <p className="ortho-sub" style={{ marginBottom: 0 }}>بيفتح شات المريض على طول والرسالة جاهزة (فيها روابط الصور/الفيديوهات/الملفات) وانت اللي تضغط «إرسال». واتساب مابيسمحش بإرفاق ملفات تلقائيًا من موقع.</p>
    </Modal>
  );
}
