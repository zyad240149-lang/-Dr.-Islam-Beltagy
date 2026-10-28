// طباعة مستند HTML مستقل (التشخيص / الروشتة) في تابة لوحدها — مش iframe مخفي جوّه الصفحة:
// Chrome/Edge على الكمبيوتر كانوا ساعات بيطبعوا شاشة البرنامج نفسها بدل الـ iframe. التابة بتتقفل لوحدها بعد الطباعة.
// التابة لازم تتفتح وقت الضغطة (قبل أي await) وإلا المتصفح يحجبها: openPrintWindow() في الضغطة، وprintHtml(html, win) بعدين.

/** يفتح تابة الطباعة فورًا (null = المتصفح حجبها — printHtml بيرجع لـ iframe) */
export function openPrintWindow(): Window | null {
  const w = window.open('', '_blank');
  if (!w) return null;
  w.document.write('<!doctype html><html lang="ar" dir="rtl"><meta charset="utf-8"><title>طباعة…</title><body style="font-family:Tahoma,sans-serif;color:#475569;padding:40px">جاري تجهيز الطباعة…</body></html>');
  w.document.close();
  return w;
}

// الخطوط (حد أقصى 2.5 ثانية لو مفيش إنترنت) والصور قبل الطباعة — وإلا بتطلع بخط الجهاز أو من غير اللوجو
async function ready(doc: Document) {
  const fontsReady = doc.fonts?.ready ?? Promise.resolve();
  await Promise.race([fontsReady.then(() => doc.fonts?.load('700 12px "IBM Plex Sans Arabic"')), new Promise((r) => setTimeout(r, 2500))]).catch(() => undefined);
  await Promise.all(Array.from(doc.images).map((img) => (img.complete ? null : new Promise((r) => { img.onload = r; img.onerror = r; }))));
}

export async function printHtml(html: string, win?: Window | null) {
  const w = win === undefined ? openPrintWindow() : win;
  if (w && !w.closed) {
    // التطبيق المتثبّت على الموبايل بيفتح التابة في متصفح منفصل مانقدرش نكتب فيه ← نقفلها ونطبع بالطريقة التانية
    try {
      w.document.open(); w.document.write(html); w.document.close();
      await ready(w.document);
      w.addEventListener('afterprint', () => w.close());
      w.focus();
      w.print();
      return;
    } catch { try { w.close(); } catch { /* اتقفلت */ } }
  }
  // التابة اتحجبت: iframe مخفي (الطريقة القديمة) — بيتشال بعد الطباعة
  const f = document.createElement('iframe');
  f.setAttribute('aria-hidden', 'true');
  f.style.cssText = 'position:fixed;right:0;bottom:0;width:0;height:0;border:0';
  document.body.appendChild(f);
  const doc = f.contentDocument!;
  doc.open(); doc.write(html); doc.close();
  await ready(doc);
  const cleanup = () => setTimeout(() => f.remove(), 500);
  f.contentWindow?.addEventListener('afterprint', cleanup);
  f.contentWindow?.focus();
  f.contentWindow?.print();
  setTimeout(() => f.remove(), 60_000);
}
