// اختبار شكل الروشتة المطبوعة وملف الـ PDF (هجرة 964): ملاحظة كل دواء في جدول الـ Rx، مربع الملاحظات العامة على قد الكلام،
// ومفيش فراغات كبيرة، والهيدر وشريط المريض والفوتر في مكانهم. من غير دخول ولا قاعدة بيانات — سيرفر Vite محلي + Edge.
//   node scripts/test-print-rx.mjs            (الصور والـ PDF في docs/ui-shots/rx-*)
import { mkdirSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { createServer } from 'vite';
import { launchEdge } from './_edge.mjs';
import { suite } from './_harness.mjs';

const { check, section, save } = suite();
const PORT = 4697, BASE = `http://127.0.0.1:${PORT}`;
const OUT = new URL('../docs/ui-shots/', import.meta.url);
mkdirSync(OUT, { recursive: true });
const meds = [
  { name: 'Brufen 600mg', dose: 'قرص', frequency: 'مرتين يوميًا', duration: '5 أيام', notes: 'بعد الأكل' },
  { name: 'Myolgin', dose: 'كبسولة', frequency: 'مرة يوميًا', duration: '7 أيام', notes: 'قبل النوم' },
  { name: 'Voltaren Emulgel', dose: 'دهان', frequency: '3 مرات يوميًا', duration: '14 يوم', notes: 'على مكان الألم' },
];
const base = { date: '2026-11-10', complaint: '', region: 'الركبة', side: 'right', examination: '', diagnosis: '', history: '', painScore: '', icd10: '', labs: [], imagingRequests: [], attachments: [], followUp: '2026-11-24' };
const cases = {
  short: { ...base, medications: meds, plan: 'راحة نسبية وكمادات تلج 15 دقيقة.' },
  long: { ...base, medications: meds, labs: ['CBC', 'CRP', 'ESR'], imagingRequests: [{ kind: 'xray', region: 'الركبة اليمين', view: 'AP & Lateral' }],
    plan: 'راحة نسبية وتجنب طلوع السلم.\nكمادات تلج 15 دقيقة 3 مرات يوميًا.\nرباط ضاغط أثناء المشي.\nعلاج طبيعي 3 مرات في الأسبوع.' },
};
const p = { fullName: 'محمد أحمد علي عبد الرحمن', fileNo: '1001', birthDate: '1980-05-01' };

let server, browser;
try {
  server = await createServer({ configFile: fileURLToPath(new URL('../vite.config.ts', import.meta.url)), root: fileURLToPath(new URL('..', import.meta.url)), logLevel: 'error', server: { port: PORT, strictPort: true, host: '127.0.0.1' } });
  await server.listen();
  browser = await launchEdge();
  const ctx = await browser.newContext({ viewport: { width: 1200, height: 900 }, locale: 'ar-EG' });
  const page = await ctx.newPage();
  const errors = [];
  page.on('pageerror', (e) => errors.push(e.message));
  await page.goto(BASE + '/site', { waitUntil: 'domcontentloaded' });
  const html = await page.evaluate(async (cs) => {
    const rx = await import('/src/ortho/printRx.ts');
    const dx = await import('/src/ortho/printDiagnosis.ts');
    const out = {};
    for (const [k, c] of Object.entries(cs.cases)) out[k] = rx.rxHtml(c, cs.p);
    out.dx = dx.diagnosisHtml({ ...cs.cases.long, sheet: { on: [], txt: {}, meds: [], pain: [] }, patientId: 'x' }, cs.p, 2, ['rx']);
    return out;
  }, { cases, p });

  for (const name of ['short', 'long']) {
    section(`الروشتة (${name === 'short' ? 'ملاحظات قصيرة' : 'ملاحظات طويلة + أشعة وتحاليل'})`);
    const d = await ctx.newPage();
    // نفس مقاس صفحة A5 (148mm − هوامش 12mm = 124mm ≈ 469px)
    await d.setViewportSize({ width: 469, height: 900 });
    await d.setContent(html[name], { waitUntil: 'load' });
    await d.evaluate(() => document.fonts.ready);
    const m = await d.evaluate(() => {
      const q = (s) => document.querySelector(s);
      const r = (el) => (el ? el.getBoundingClientRect() : null);
      const rows = [...document.querySelectorAll('table.meds tbody tr')].map((tr) => [...tr.cells].map((td) => td.innerText.trim()));
      const ins = q('.box.ins'), lines = ins ? Math.round((r(ins.querySelector('div')).height) / parseFloat(getComputedStyle(ins.querySelector('div')).lineHeight)) : 0;
      const tbl = r(q('table.meds')), last = r(q('.box.ins') ?? q('table.meds')), sign = r(q('.sign')), foot = r(q('.rxp footer')), top = r(q('.top')), pt = r(q('.pt'));
      const notesHead = [...document.querySelectorAll('table.meds th')].map((t) => t.innerText.trim());
      return { rows, notesHead, insH: ins ? r(ins).height : 0, lines, gapToSign: sign && last ? sign.top - last.bottom : 0, hasTop: !!top, hasPt: !!pt, hasFoot: !!foot, tbl: !!tbl,
        overflow: document.documentElement.scrollWidth - document.documentElement.clientWidth, height: document.querySelector('.rxp').getBoundingClientRect().height };
    });
    check('الهيدر وشريط المريض وجدول الـ Rx والفوتر موجودين', m.hasTop && m.hasPt && m.tbl && m.hasFoot, JSON.stringify({ top: m.hasTop, pt: m.hasPt, tbl: m.tbl, foot: m.hasFoot }));
    check('عمود «ملاحظات» في جدول الأدوية', m.notesHead.includes('ملاحظات'), m.notesHead.join(','));
    check('ملاحظة كل دواء جنبه (بعد الأكل / قبل النوم / على مكان الألم)', m.rows.map((x) => x[x.length - 1]).join('|') === 'بعد الأكل|قبل النوم|على مكان الألم', JSON.stringify(m.rows));
    const want = name === 'short' ? 1 : 4;
    check(`مربع الملاحظات على قد الكلام (${want} سطر) من غير مساحة فاضية`, m.lines === want && m.insH < 30 + want * 22, `ارتفاع ${Math.round(m.insH)}px، ${m.lines} سطر`);
    // A5 بهوامش 12mm = 186mm ≈ 703px: الروشتة لازم تيجي في صفحة واحدة، والفوتر في آخرها (شكل ورق الروشتة)
    check('الروشتة كلها في صفحة A5 واحدة', m.height <= 703, `الارتفاع ${Math.round(m.height)}px`);
    check('مفيش حاجة خارجة برّه عرض الصفحة', m.overflow <= 0, `${m.overflow}px`);
    await d.screenshot({ path: fileURLToPath(new URL(`rx-${name}.png`, OUT)), fullPage: true });
    const pdf = await d.pdf({ preferCSSPageSize: true, printBackground: true });
    writeFileSync(new URL(`rx-${name}.pdf`, OUT), pdf);
    const pages = (pdf.toString('latin1').match(/\/Type\s*\/Page[^s]/g) ?? []).length;
    check('ملف الـ PDF سليم وصفحة A5 واحدة', pdf.subarray(0, 5).toString() === '%PDF-' && pages === 1, `${pages} صفحة، ${pdf.length} بايت`);
    await d.close();
  }

  section('الروشتة جوّه «طباعة وإرسال» التشخيص');
  const d = await ctx.newPage();
  await d.setContent(html.dx, { waitUntil: 'load' });
  const t = await d.evaluate(() => document.body.innerText);
  check('ملاحظات الأدوية ظاهرة في روشتة التشخيص', ['بعد الأكل', 'قبل النوم', 'على مكان الألم'].every((x) => t.includes(x)));
  await d.close();
  check('مفيش أخطاء JavaScript', errors.length === 0, errors.join(' | '));
} catch (e) {
  check('الاختبار كمّل للآخر', false, e.message);
} finally {
  await browser?.close().catch(() => {});
  await server?.close().catch(() => {});
  save('test-print-rx-results.json');
}
