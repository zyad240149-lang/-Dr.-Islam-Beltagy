// اختبار الطباعة وPDF محليًا ببيانات تجريبية في المتصفح (من غير دخول ولا قاعدة بيانات)
//   OUT=<مجلد> node scripts/test-print-local.mjs   (محتاج سيرفر Vite شغال على 4660)
import { writeFileSync, mkdirSync } from 'node:fs';
import { launchEdge } from './_edge.mjs';
const OUT = process.env.OUT; mkdirSync(OUT, { recursive: true });
const BASE = process.env.UI_BASE || 'http://127.0.0.1:4660';
const sheet = { on: ['n.visit|متابعة', 'n.cc|ألم', 'x.cc|Knee pain', 'x.dxs.knee.1|Medial compartment OA', 'af.cc|Ankle pain', 'af.dxs.ankle.4|Lateral ankle ligaments (lateral ankle sprain)'], txt: { 'n.name': 'حسام طارق طباعةاختبار', 'x.notes': 'Rest.' }, meds: [], pain: ['knee:right', 'ankle_foot:right'] };
const long = 'يعاني المريض من ألم مزمن في الركبة اليمنى مع تورم وصعوبة في الحركة وصعود السلم منذ أكثر من ستة أشهر. '.repeat(4);
const c = { patientId: 'p1', date: '2026-11-04', complaint: long, region: 'الركبة', side: 'right', examination: long, diagnosis: 'خشونة الركبة — Knee Osteoarthritis', plan: 'راحة وعلاج طبيعي ' + long, history: long, painScore: 7, icd10: 'M17', medications: [{ name: 'Panadol Extra 500mg', dose: 'قرص', frequency: '3 مرات يوميًا', duration: '5 أيام' }, { name: 'Voltaren 75mg', dose: 'حقنة', frequency: 'مرة', duration: '3 أيام' }], labs: ['CBC', 'CRP'], imagingRequests: [{ kind: 'xray', region: 'الركبة اليمنى' }], attachments: [], followUp: '2026-11-20', sheet, complete: true };
const p = { fullName: 'محمد أحمد علي عبد الرحمن', fileNo: 'TM-1001', birthDate: '1980-05-01' };
const browser = await launchEdge();
const results = [];
const check = (n, ok, d = '') => { results.push({ n, ok, d }); console.log(ok ? '  PASS' : '  FAIL', n, ok ? '' : d); };
for (const [label, viewport] of [['desktop', { width: 1366, height: 860 }], ['mobile', { width: 390, height: 844 }]]) {
  const ctx = await browser.newContext({ viewport, locale: 'ar-EG', deviceScaleFactor: 1 });
  const page = await ctx.newPage();
  const errors = []; page.on('pageerror', (e) => errors.push(e.message));
  await page.goto(BASE + '/site', { waitUntil: 'domcontentloaded' });
  const docs = await page.evaluate(async ({ c, p }) => {
    const dx = await import('/src/ortho/printDiagnosis.ts'); const rx = await import('/src/ortho/printRx.ts');
    return { dx: dx.diagnosisHtml(c, p, 3, ['nurse', 'doctor', 'rx']), rx: rx.rxHtml(c, p) };
  }, { c, p });
  for (const [name, html, opts] of [['diagnosis', docs.dx, { preferCSSPageSize: true }], ['rx', docs.rx, { preferCSSPageSize: true }]]) {
    const d = await ctx.newPage(); await d.setContent(html, { waitUntil: 'load' }); await d.evaluate(() => document.fonts.ready);
    const info = await d.evaluate(() => { const pages = [...document.querySelectorAll('.page, .rxw, body > *')]; return {
      dir: document.documentElement.dir || document.body.dir || getComputedStyle(document.body).direction, text: document.body.innerText.length, overflow: document.documentElement.scrollWidth - document.documentElement.clientWidth,
      clipped: pages.filter((e) => e.scrollWidth > e.clientWidth + 2).length, font: getComputedStyle(document.body).fontFamily.slice(0, 40), logo: [...document.images].filter((i) => !i.complete || !i.naturalWidth).length, imgs: document.images.length, hasName: document.body.innerText.includes('محمد أحمد علي'), hasMed: document.body.innerText.includes('Panadol') }; });
    check(label + ' ' + name + ': اسم المريض ظاهر', info.hasName);
    check(label + ' ' + name + ': الدواء ظاهر', info.hasMed);
    check(label + ' ' + name + ': مفيش نص خارج الصفحة', info.clipped === 0, 'عناصر مقصوصة ' + info.clipped);
    check(label + ' ' + name + ': الصور والشعار حمّلوا', info.logo === 0, 'فاشلة ' + info.logo + ' من ' + info.imgs);
    writeFileSync(OUT + '/' + label + '-' + name + '.pdf', await d.pdf({ ...opts, printBackground: true }));
    await d.screenshot({ path: OUT + '/' + label + '-' + name + '.png', fullPage: true }); await d.close();
  }
  if (label === 'desktop') {
    const b64 = await page.evaluate(async ({ c, p }) => {
      const dx = await import('/src/ortho/printDiagnosis.ts'); const blob = await dx.buildDiagnosisPdf(c, p, 3, ['nurse', 'doctor', 'rx']);
      const buf = new Uint8Array(await blob.arrayBuffer()); let s = ''; for (const x of buf) s += String.fromCharCode(x); return btoa(s);
    }, { c, p }).catch((e) => { check('ملف PDF التشخيص', false, e.message); return null; });
    if (b64) { const b = Buffer.from(b64, 'base64'); writeFileSync(OUT + '/built-diagnosis.pdf', b); check('ملف PDF التشخيص اتبنى', b.subarray(0, 4).toString() === '%PDF' && b.length > 20000, 'حجم ' + b.length); }
    const inv = await page.evaluate(async () => {
      const { db } = await import('/src/data/db.ts');
      db.hydrateFromSnapshot({ patients: [{ id: 'p1', fileNo: 'TM-1001', fullName: 'محمد أحمد علي عبد الرحمن', phone: '+201000000000', registeredAt: Date.now(), active: true }], invoices: [{ id: 'i1', no: 'INV-1001', patientId: 'p1', appointmentId: null, serviceName: 'عملية: تثبيت كسر الساق', price: 1000, discount: 100, total: 900, paid: 500, remaining: 400, status: 'partial', date: '2026-11-04', taxRate: 0, taxAmount: 0, items: [] }], payments: [{ id: 'y1', invoiceId: 'i1', patientId: 'p1', amount: 500, method: 'cash', date: Date.now(), note: '' }] }, {});
      const m = await import('/src/pages/Invoices.tsx'); const blob = await m.buildInvoicePdf('i1');
      const buf = new Uint8Array(await blob.arrayBuffer()); let s = ''; for (const x of buf) s += String.fromCharCode(x); return btoa(s);
    }).catch((e) => { check('ملف PDF الفاتورة', false, e.message.slice(0, 300)); return null; });
    if (inv) { const b = Buffer.from(inv, 'base64'); writeFileSync(OUT + '/built-invoice.pdf', b); check('ملف PDF الفاتورة اتبنى', b.subarray(0, 4).toString() === '%PDF' && b.length > 5000, 'حجم ' + b.length); }
  }
  check(label + ': مفيش أخطاء JavaScript', errors.length === 0, errors.join(' | ').slice(0, 300));
  await ctx.close();
}
await browser.close();
writeFileSync(OUT + '/results.json', JSON.stringify(results, null, 2));
console.log(results.filter((r) => r.ok).length + '/' + results.length + ' passed');
process.exit(results.every((r) => r.ok) ? 0 : 1);
