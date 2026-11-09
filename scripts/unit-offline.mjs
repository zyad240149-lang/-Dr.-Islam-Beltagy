// اختبارات وحدة لطبقة الأوفلاين (من غير متصفح ولا خادم): الطابور، التشفير، نسخة الجهاز، صلاحية الزيارة بدون إنترنت.
// الملفات TypeScript بتتجمّع بـ esbuild (جاي مع Vite) وتتشغّل في Node — نفس الكود اللي بيشتغل في المتصفح.
//   node scripts/unit-offline.mjs
import { build } from 'esbuild';
import { mkdtempSync, writeFileSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { pathToFileURL, fileURLToPath } from 'node:url';
import { suite } from './_harness.mjs';

const { check, section, save } = suite();
const ROOT = fileURLToPath(new URL('..', import.meta.url));
const dir = mkdtempSync(join(tmpdir(), 'ortho-unit-'));
const entry = join(dir, 'entry.ts');
writeFileSync(entry, `
export { OfflineQueue, backoff } from ${JSON.stringify(join(ROOT, 'src/offline/queue.ts').replace(/\\/g, '/'))};
export { memoryStore } from ${JSON.stringify(join(ROOT, 'src/offline/idb.ts').replace(/\\/g, '/'))};
export { OfflineSession, OFFLINE_MAX_DAYS } from ${JSON.stringify(join(ROOT, 'src/offline/session.ts').replace(/\\/g, '/'))};
export { seal, unseal, deviceKey } from ${JSON.stringify(join(ROOT, 'src/offline/crypto.ts').replace(/\\/g, '/'))};
`);
const out = join(dir, 'bundle.mjs');
await build({ entryPoints: [entry], bundle: true, format: 'esm', platform: 'node', outfile: out, logLevel: 'error' });
const m = await import(pathToFileURL(out).href);
rmSync(dir, { recursive: true, force: true });

try {
  // ============ الطابور ============
  section('طابور المزامنة');
  let now = 1_000_000;
  const store = m.memoryStore();
  const q = new m.OfflineQueue(store, { now: () => now });
  await q.load('u1');
  const a = await q.enqueue({ kind: 'patient.create', userId: 'u1', entityId: 'p1', label: 'مريض', payload: {} });
  const b = await q.enqueue({ kind: 'appointment.create', userId: 'u1', entityId: 'a1', label: 'موعد', payload: {}, dependsOn: 'p1' });
  check('العملية بتتحفظ في التخزين قبل أي إرسال', (await store.ops.getAll()).length === 2);
  const seen = [];
  let s = await q.run(async (op) => { seen.push(op.kind); return { type: 'retry', error: 'network' }; });
  check('فشل الشبكة ← تفضل معلّقة ومفيش عملية تانية بتتبعت', s.retry >= 1 && q.pendingCount() === 2 && seen.length === 1, JSON.stringify(s));
  check('إعادة المحاولة بتأخير متزايد (5ث ← 10ث ← … حد أقصى 5 دقايق)', m.backoff(1) === 5000 && m.backoff(2) === 10000 && m.backoff(20) === 300000);
  s = await q.run(async () => ({ type: 'done' }));
  check('قبل ميعاد إعادة المحاولة مابيتبعتش (إلا بزرار «مزامنة الآن»)', s.done === 0);
  now += 6000; seen.length = 0;
  s = await q.run(async (op) => { seen.push(op.kind); return { type: 'done' }; });
  check('بعد الميعاد: المريض الأول وبعده الموعد المعتمد عليه', s.done === 2 && seen.join(',') === 'patient.create,appointment.create' && q.pendingCount() === 0, seen.join(','));
  check('العملية الناجحة بتتشال من التخزين', (await store.ops.getAll()).length === 0);

  const c = await q.enqueue({ kind: 'patient.update', userId: 'u1', entityId: 'p2', label: 'تعديل', payload: { row: { full_name: 'x' } }, base: { full_name: 'y' } });
  await q.run(async () => ({ type: 'conflict', conflict: { reason: 'server_changed', message: 'اتعدل', fields: ['full_name'], serverValues: { full_name: 'z' } } }));
  check('التعارض مابيتكتبش فوقه — بيستنى قرار', q.get(c.id)?.status === 'conflict' && q.needsAttention() === 1);
  await q.run(async () => ({ type: 'done' }));
  check('التعارض مابيتبعتش تاني من غير قرار', q.get(c.id)?.status === 'conflict');
  await q.resolve(c.id, { type: 'keep-mine' });
  check('«استخدم تعديلي» ← معلّقة بعلامة كتابة إجبارية', q.get(c.id)?.status === 'pending' && q.get(c.id)?.payload.__force === true);
  await q.run(async () => ({ type: 'done' }));

  // التطبيق اتقفل والعملية بتتبعت
  const d = await q.enqueue({ kind: 'patient.create', userId: 'u1', entityId: 'p3', label: 'مريض', payload: {} });
  const raw = (await store.ops.getAll()).find((o) => o.id === d.id); raw.status = 'syncing'; await store.ops.put(raw);
  const q2 = new m.OfflineQueue(store, { now: () => now });
  await q2.load('u1');
  check('بعد إعادة الفتح: العملية اللي اتقطعت في نصها ترجع معلّقة (مش بتضيع)', q2.get(d.id)?.status === 'pending');
  const q3 = new m.OfflineQueue(store, { now: () => now }); await q3.load('u2');
  check('مستخدم تاني على نفس الجهاز مايشوفش عمليات الأول', q3.pendingCount() === 0);
  const ids = new Set(); for (let i = 0; i < 2000; i++) ids.add((await q2.enqueue({ kind: 'patient.create', userId: 'u1', entityId: 'x' + i, label: '', payload: {} })).id);
  check('معرّفات العمليات فريدة (2000 عملية)', ids.size === 2000);

  // ============ مريض اتسجّل من غير نت وطلع موجود على الخادم ← دمج تلقائي ============
  section('الدمج التلقائي وتحويل المعرّف المحلي للحقيقي');
  const qm = new m.OfflineQueue(m.memoryStore(), { now: () => now });
  await qm.load('u1');
  const LOCAL = '11111111-1111-4111-8111-111111111111', REAL = '22222222-2222-4222-8222-222222222222';
  await qm.enqueue({ kind: 'patient.create', userId: 'u1', entityId: LOCAL, label: 'مريض', payload: { row: { full_name: 'أ ب ج', phone: '0100' } } });
  await qm.enqueue({ kind: 'ortho.save', userId: 'u1', entityId: 'c1', label: 'تشخيص', dependsOn: LOCAL, payload: { table: 'ortho_consultations', isNew: true, row: { patient_id: LOCAL, attachments: [{ path: `${LOCAL}/xray/a.png` }] }, local: { patient_id: LOCAL } } });
  await qm.enqueue({ kind: 'appointment.create', userId: 'u1', entityId: 'a9', label: 'موعد', dependsOn: LOCAL, payload: { patientId: LOCAL, p: { patientId: LOCAL, date: '2026-11-10' }, local: { patientId: LOCAL } } });
  await qm.enqueue({ kind: 'file.upload', userId: 'u1', entityId: 'f1', label: 'ملف', dependsOn: LOCAL, payload: { patientId: LOCAL, path: `${LOCAL}/f1.png`, bytes: new ArrayBuffer(4) } });
  const sent = [];
  s = await qm.run(async (op) => { sent.push(op); return op.kind === 'patient.create' ? { type: 'merged', into: REAL } : { type: 'done' }; });
  const cs = sent.find((o) => o.kind === 'ortho.save'), ap = sent.find((o) => o.kind === 'appointment.create'), fu = sent.find((o) => o.kind === 'file.upload');
  check('الطابور خلص كله في نفس الجولة (مفيش سؤال ولا تعارض)', s.done === 4 && s.conflicts === 0 && qm.pendingCount() === 0, JSON.stringify(s));
  check('التشخيص اتبعت بمعرّف الملف الحقيقي (patient_id + مسار المرفق)', cs?.payload.row.patient_id === REAL && cs.payload.row.attachments[0].path === `${REAL}/xray/a.png` && !cs.dependsOn, JSON.stringify(cs?.payload.row));
  check('الموعد اتحوّل للملف الحقيقي', ap?.payload.patientId === REAL && ap.payload.p.patientId === REAL);
  check('الملف اتحوّل للملف الحقيقي والبايتات زي ما هي', fu?.payload.patientId === REAL && fu.payload.path === `${REAL}/f1.png` && fu.payload.bytes instanceof ArrayBuffer && fu.payload.bytes.byteLength === 4);
  // الترتيب: تشخيص معتمد على إنشاء لسه بيفشل مؤقتًا ← التشخيص يستنى (مايتبعتش بمعرّف مريض مش موجود على الخادم)
  const qo = new m.OfflineQueue(m.memoryStore(), { now: () => now }); await qo.load('u1');
  await qo.enqueue({ kind: 'patient.create', userId: 'u1', entityId: 'pX', label: '', payload: {} });
  await qo.enqueue({ kind: 'ortho.save', userId: 'u1', entityId: 'cX', label: '', dependsOn: 'pX', payload: { row: { patient_id: 'pX' } } });
  const order = []; await qo.run(async (op) => { order.push(op.kind); return op.kind === 'patient.create' ? { type: 'failed', error: 'x' } : { type: 'done' }; });
  check('إنشاء المريض فشل ← التشخيص المعتمد عليه مااتبعتش', order.join() === 'patient.create' && qo.pendingCount() === 2);

  // ============ التشفير ونسخة الجهاز ============
  section('تشفير البيانات على الجهاز');
  const st = m.memoryStore();
  const key = await m.deviceKey(st);
  check('مفتاح الجهاز غير قابل للتصدير', key && key.extractable === false && key.algorithm.name === 'AES-GCM');
  const sealed = await m.seal(key, { name: 'مريض سري' });
  const bytes = Buffer.from(sealed.ct).toString('utf8');
  check('البيانات المحفوظة مشفّرة (الاسم مش ظاهر في البايتات)', !bytes.includes('مريض') && sealed.iv.length === 12);
  check('فك التشفير بيرجّع نفس البيانات', (await m.unseal(key, sealed)).name === 'مريض سري');
  const otherKey = await m.deviceKey(m.memoryStore());
  let failed = false; try { await m.unseal(otherKey, sealed); } catch { failed = true; }
  check('مفتاح جهاز تاني مايفكش البيانات', failed);
  sealed.ct = new Uint8Array(sealed.ct).map((x, i) => (i === 3 ? x ^ 1 : x)).buffer;
  failed = false; try { await m.unseal(key, sealed); } catch { failed = true; }
  check('أي تلاعب في البيانات المحفوظة بيتكشف (AES-GCM)', failed);

  let t = 5_000_000_000;
  const ss = new m.OfflineSession(st, () => t);
  await ss.bindUser('u1', { id: 'u1', name: 'موظف' }, 'auth-u1');
  const patients = Array.from({ length: 9000 }, (_, i) => ({ id: 'p' + i, fullName: 'مريض ' + i }));
  await ss.saveSnapshot('u1', { patients, appointments: [] }, { patients: { rows: 9000, serverCount: 9000, watermark: '2026-10-27T00:00:00Z', tombAt: null, at: t, complete: true, mode: 'full' } });
  const meta = await ss.snapshotInfo();
  check('النسخة متشفّرة ومعاها حالة المزامنة', meta.encrypted === true && meta.sync.patients.rows === 9000);
  const back = await ss.readSnapshot('u1');
  check('قراءة 9,000 مريض من النسخة', back.data.patients.length === 9000 && back.data.patients[8999].fullName === 'مريض 8999');
  check('مستخدم تاني مايقراش النسخة', (await ss.readSnapshot('u2')) === undefined);
  const r1 = await ss.restore('auth-u1');
  check('فتح بدون إنترنت لنفس المستخدم في حدود المدة', r1.ok === true);
  check('فتح بدون زيارة محفوظة مرفوض', (await ss.restore(null)).reason === 'no-session');
  check('مستخدم تاني بزيارة على نفس الجهاز مرفوض', (await ss.restore('auth-u2')).reason === 'other-user');
  check('الفتح بيتأكد بحساب الدخول المحفوظ مش بمعرّف الموظف (كان سبب رجوع شاشة الدخول)', (await ss.restore('u1')).reason === 'other-user');
  t += (m.OFFLINE_MAX_DAYS + 1) * 86400_000;
  check(`بعد ${m.OFFLINE_MAX_DAYS} يوم من آخر تحقق من الخادم: لازم اتصال`, (await ss.restore('auth-u1')).reason === 'expired');
  await ss.touchVerified();
  check('أول ما يتصل ويتحقق، المدة بتتجدد', (await ss.restore('auth-u1')).ok === true);
  await st.del('device-key');
  const lost = await ss.readSnapshot('u1');
  check('لو المفتاح اتمسح: البيانات مابتتقريش وبتتعلّم «ناقصة» (بتتنزل تاني)', !lost.data.patients && lost.sync.patients.complete === false);
  await ss.bindUser('u2', { id: 'u2' });
  check('دخول مستخدم تاني بيمسح كل بيانات الأول ومفتاحه', !(await ss.snapshotInfo()) && !(await st.get('device-key')));
} catch (e) {
  check('تنفيذ الاختبارات بدون أخطاء غير متوقعة', false, e.stack ?? e.message);
} finally {
  save('unit-offline-results.json');
}
