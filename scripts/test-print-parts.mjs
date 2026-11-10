// اختبار باقي أجزاء الطباعة محليًا ببيانات تجريبية (من غير دخول ولا قاعدة بيانات) — مكمّل لـ test-print-local.mjs:
// كل جزء من التشخيص لوحده، طلب الأشعة، طلب التحاليل، شيت الحقن، شيت متابعة التمريض وروشتته،
// مسار الطباعة نفسه (تابة جديدة / iframe لو التابة اتحجبت)، وقواعد CSS بتاعة طباعة الفاتورة والتقارير.
//   OUT=<مجلد> node scripts/test-print-parts.mjs   (محتاج سيرفر Vite شغال على 4660)
import { writeFileSync, mkdirSync } from 'node:fs';
import { launchEdge } from './_edge.mjs';
const OUT = process.env.OUT; mkdirSync(OUT, { recursive: true });
const BASE = process.env.UI_BASE || 'http://127.0.0.1:4660';
const NAME = 'محمد أحمد علي عبد الرحمن';
const results = [];
const check = (n, ok, d = '') => { results.push({ n, ok, d }); console.log(ok ? '  PASS' : '  FAIL', n, ok ? '' : d); };

const browser = await launchEdge();
const ctx = await browser.newContext({ viewport: { width: 1366, height: 860 }, locale: 'ar-EG' });
await ctx.addInitScript(() => { window.__printed = 0; window.print = () => { window.__printed++; }; });
const page = await ctx.newPage();
const errors = []; page.on('pageerror', (e) => errors.push(e.message));
await page.goto(BASE + '/site', { waitUntil: 'domcontentloaded' });

// ---------- المستندات ----------
const docs = await page.evaluate(async (NAME) => {
  const { db } = await import('/src/data/db.ts');
  db.hydrateFromSnapshot({ patients: [{ id: 'p1', fileNo: 'TM-1001', fullName: NAME, phone: '+201000000000', birthDate: '1980-05-01', gender: 'male', address: 'دسوق — كفر الشيخ', registeredAt: Date.now(), active: true }] }, {});
  const dx = await import('/src/ortho/printDiagnosis.ts'); const rx = await import('/src/ortho/printRx.ts');
  const rq = await import('/src/ortho/requestData.ts'); const inj = await import('/src/ortho/Injections.tsx'); const nur = await import('/src/ortho/Nursing.tsx');
  const long = 'يعاني المريض من ألم مزمن في الركبة اليمنى مع تورم وصعوبة في الحركة وصعود السلم منذ أكثر من ستة أشهر. '.repeat(3);
  const sheet = {
    on: ['n.visit|متابعة', 'n.cc|ألم', 'x.cc|Knee pain', 'x.dxs.knee.1|Medial compartment OA',
      'rr.type|X-Ray (Plain)', 'rr.type|MRI', 'rr.side|Right', 'rr.reg|Knee', 'rr.reg|Lumbar Spine',
      ...rq.LAB_REQ_GROUPS.slice(0, 6).flatMap((g) => g.items.map((i) => 'lr|' + i))],
    txt: { 'n.name': NAME, 'x.notes': 'Rest.', 'rr.reg.other': 'Sacroiliac joints', 'lr.o1': 'Serum Zinc' }, meds: [], pain: ['knee:right'],
  };
  const p = { fullName: NAME, fileNo: 'TM-1001', birthDate: '1980-05-01' };
  const c = { patientId: 'p1', date: '2026-11-04', complaint: long, region: 'الركبة', side: 'right', examination: long, diagnosis: 'خشونة الركبة — Knee Osteoarthritis', plan: 'راحة وعلاج طبيعي ' + long, history: long, painScore: 7, icd10: 'M17',
    medications: [{ name: 'Panadol Extra 500mg', dose: 'قرص', frequency: '3 مرات يوميًا', duration: '5 أيام', notes: '' }], imagingRequests: [{ kind: 'xray', region: 'Knee — Right', view: 'X-Ray (Plain)' }], labs: ['CBC', 'ESR'], followUp: '2026-11-18', sheet, complete: true };
  const injection = { patientId: 'p1', appointmentId: null, date: '2026-11-04', sheet: { ...inj.emptyInjection(), diagnosis: 'Knee Osteoarthritis — ' + long, site: ['Knee'], side: 'Right', technique: 'Ultrasound Guided', approach: 'Superolateral', position: 'Supine', needle: '21G', syringe: '5 ml',
    materials: [{ drug: 'Hyaluronic acid', dose: '2 ml', batch: 'B-12345', expiry: '2027-06' }, { drug: 'Triamcinolone 40mg', dose: '1 ml', batch: 'T-777', expiry: '2027-01' }], consent: ['Allergies checked', 'Informed consent obtained'], aseptic: true, usConfirm: true, usFindings: 'Effusion', procedureNotes: long, complications: 'None', instructions: 'Yes', plannedFollowUp: '2 weeks', signature: 'Dr. Islam', notes: long } };
  const nursing = { patientId: 'p1', appointmentId: null, date: '2026-11-04', sheet: { ...nur.emptyNursing(), visitNo: '3', pain: 6, vsLast: 'أفضل', mobility: 'جيدة', adherence: 'ملتزم', newSymptoms: 'نعم', symptomsDetails: long, treatment: 'مستمر', treatmentNotes: long, notes: long,
    cast: { on: true, type: 'جبس', typeOther: '', limb: 'الساق اليمنى', applied: '2026-10-20', followUp: '2026-11-18', condition: 'جيد', conditionOther: '', notes: long },
    surgery: { on: true, procedure: 'تثبيت كسر الساق', date: '2026-10-15', followUp: '2026-11-18', wound: 'جيد', woundOther: '', dressing: 'تم اليوم', bandage: 'جافة', notes: long },
    plan: { tx: ['علاج تحفظي'], txOther: '', instr: ['راحة نسبية'], instrOther: '', fu: 'أسبوعين' } } };
  const out = {};
  const add = (k, fn, needs) => { try { out[k] = { html: fn(), needs }; } catch (e) { out[k] = { err: String(e?.message ?? e) }; } };
  add('تشخيص — الشيت العام', () => dx.diagnosisHtml(c, p, 3, ['nurse']), [NAME]);
  add('تشخيص — كشف الطبيب', () => dx.diagnosisHtml(c, p, 3, ['doctor']), [NAME]);
  add('تشخيص — الروشتة', () => dx.diagnosisHtml(c, p, 3, ['rx']), [NAME, 'Panadol']);
  add('تشخيص — الكل مضغوط', () => dx.diagnosisHtml(c, p, 3, ['nurse', 'doctor', 'rx'], true), [NAME, 'Panadol']);
  add('روشتة', () => rx.rxHtml(c, p), [NAME, 'Panadol']);
  add('طلب أشعة', () => rq.requestHtml('rad', sheet, p, c.date), [NAME, 'MRI', 'Knee', 'Sacroiliac']);
  add('طلب تحاليل', () => rq.requestHtml('lab', sheet, p, c.date), [NAME, 'HbA1c', 'Serum Zinc']);
  add('شيت الحقن', () => inj.injectionHtml(injection), [NAME, 'Hyaluronic acid', 'B-12345']);
  add('شيت متابعة التمريض', () => nur.nursingHtml(nursing), [NAME, 'تثبيت كسر الساق']);
  return out;
}, NAME).catch((e) => { check('تجهيز المستندات', false, e.message.slice(0, 400)); return {}; });

let i = 0;
for (const [name, d] of Object.entries(docs)) {
  i++;
  if (d.err) { check(name + ': المستند اتبنى', false, d.err.slice(0, 300)); continue; }
  const t = await ctx.newPage(); const tErr = []; t.on('pageerror', (e) => tErr.push(e.message));
  await t.setContent(d.html, { waitUntil: 'load' }); await t.evaluate(() => document.fonts.ready);
  const info = await t.evaluate(() => {
    const boxes = [...document.querySelectorAll('.page, .rxw, .rqp, .sec, body > *')];
    return { text: document.body.innerText, overflow: document.documentElement.scrollWidth - document.documentElement.clientWidth,
      clipped: boxes.filter((e) => e.scrollWidth > e.clientWidth + 2).length, badImgs: [...document.images].filter((x) => !x.complete || !x.naturalWidth).length };
  });
  const missing = d.needs.filter((x) => !info.text.includes(x));
  check(name + ': البيانات ظاهرة', missing.length === 0, 'ناقص: ' + missing.join(' / '));
  check(name + ': مفيش نص مقصوص', info.clipped === 0, 'عناصر مقصوصة ' + info.clipped);
  check(name + ': الصور والشعار حمّلوا', info.badImgs === 0, 'فاشلة ' + info.badImgs);
  const pdf = await t.pdf({ preferCSSPageSize: true, printBackground: true });
  const pages = (pdf.toString('latin1').match(/\/Type\s*\/Page[^s]/g) || []).length;
  writeFileSync(`${OUT}/${String(i).padStart(2, '0')}.pdf`, pdf);
  await t.screenshot({ path: `${OUT}/${String(i).padStart(2, '0')}.png`, fullPage: true });
  check(name + ': بيتحوّل لصفحات طباعة', pages >= 1 && tErr.length === 0, `صفحات ${pages} ${tErr.join(' | ')}`.slice(0, 200));
  console.log('      ', String(i).padStart(2, '0'), name, '— صفحات:', pages);
  await t.close();
}

// ---------- مسار الطباعة: تابة جديدة ----------
const popP = ctx.waitForEvent('page', { timeout: 10000 }).catch(() => null);
await page.evaluate(async () => { const m = await import('/src/utils/printDoc.ts'); window.__done = m.printHtml('<!doctype html><html dir="rtl"><body><h1 id="t">اختبار طباعة</h1></body></html>', m.openPrintWindow()); });
const pop = await popP;
check('مسار الطباعة: بيفتح تابة لوحدها', !!pop);
if (pop) {
  const ok = await pop.waitForFunction(() => window.__printed > 0 && !!document.querySelector('#t'), null, { timeout: 15000 }).then(() => true).catch(() => false);
  check('مسار الطباعة: المستند اتكتب في التابة و print() اتنادت', ok);
  await pop.close().catch(() => {});
}
check('مسار الطباعة: شاشة البرنامج نفسها ما اتطبعتش', (await page.evaluate(() => window.__printed)) === 0);

// ---------- مسار الطباعة: التابة اتحجبت ← iframe ----------
const fb = await page.evaluate(async () => {
  const m = await import('/src/utils/printDoc.ts');
  const orig = window.open; window.open = () => null;
  try {
    const done = m.printHtml('<!doctype html><html dir="rtl"><body><h1 id="t">اختبار طباعة</h1></body></html>');
    const t0 = Date.now(); let f = null;
    while (Date.now() - t0 < 6000) { f = document.querySelector('iframe[aria-hidden="true"]'); if (f?.contentWindow?.__printed > 0) break; await new Promise((r) => setTimeout(r, 100)); }
    await Promise.race([done, new Promise((r) => setTimeout(r, 500))]);
    return { frame: !!f, printed: f?.contentWindow?.__printed ?? 0, has: !!f?.contentDocument?.querySelector('#t') };
  } finally { window.open = orig; }
});
check('مسار الطباعة: لو التابة اتحجبت بيطبع من iframe', fb.frame && fb.printed > 0 && fb.has, JSON.stringify(fb));

// ---------- CSS طباعة الفاتورة / فاتورة المنتجات / التقارير ----------
await page.evaluate(() => {
  const d = document.createElement('div'); d.id = 'pt';
  d.innerHTML = '<div id="pt-side">قايمة</div><div class="no-print" id="pt-btn">أزرار</div><div class="print-area screen-only" id="pt-screen">شاشة</div><div class="print-only print-area" id="pt-paper">ورقة الفاتورة</div>';
  document.body.appendChild(d);
});
const vis = () => page.evaluate(() => Object.fromEntries(['pt-side', 'pt-btn', 'pt-screen', 'pt-paper'].map((id) => { const e = document.getElementById(id); const s = getComputedStyle(e); return [id, s.display !== 'none' && s.visibility !== 'hidden']; })));
const scr = await vis();
await page.emulateMedia({ media: 'print' });
const prn = await vis();
await page.emulateMedia({ media: 'screen' });
check('CSS الطباعة: على الشاشة الورقة مخفية والأزرار ظاهرة', !scr['pt-paper'] && scr['pt-btn'] && scr['pt-screen'], JSON.stringify(scr));
check('CSS الطباعة: وقت الطباعة الورقة بس اللي ظاهرة', prn['pt-paper'] && !prn['pt-btn'] && !prn['pt-screen'] && !prn['pt-side'], JSON.stringify(prn));

check('مفيش أخطاء JavaScript', errors.length === 0, errors.join(' | ').slice(0, 300));
await browser.close();
writeFileSync(OUT + '/results.json', JSON.stringify(results, null, 2));
console.log(results.filter((r) => r.ok).length + '/' + results.length + ' passed');
process.exit(results.every((r) => r.ok) ? 0 : 1);
