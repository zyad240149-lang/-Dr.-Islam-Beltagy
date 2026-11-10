// مسح لمرة واحدة (طلب الدكتور ١٠/١١): كل الفواتير والمواعيد ومتابعات المرضى والتشخيصات الجديدة —
// ما عدا التشخيصات المنقولة من النظام القديم (اتعملت 2026-10-31) والحجوزات اللي اتعملت بعد الحصر (بعد 17:30 UTC — بتاعة بكرة ١١/١١).
// بياخد نسخة احتياطية JSON في backups/ الأول، وبعدين بيمسح كله في معاملة واحدة.   --dry = عرض بس
import { writeFileSync, mkdirSync } from 'node:fs';
import { sql } from './_env.mjs';
const dry = process.argv.includes('--dry');
const CUT = "'2026-11-10 17:30:00+00'";
const W = {
  appts: `select id from appointments where created_at <= ${CUT}`,
  invs: `select id from invoices where created_at <= ${CUT}`,
  fus: `select id from ortho_follow_ups where created_at <= ${CUT}`,
  dx: `select id from ortho_consultations where created_at >= '2026-11-01' and created_at <= ${CUT}`,
};
const q = async (s) => (await sql(s)) ?? [];
const backup = {
  at: new Date().toISOString(),
  invoices: await q(`select * from invoices where id in (${W.invs})`),
  invoice_items: await q(`select * from invoice_items where invoice_id in (${W.invs})`),
  payments: await q(`select * from payments where invoice_id in (${W.invs})`),
  appointments: await q(`select * from appointments where id in (${W.appts})`),
  appointment_status_history: await q(`select * from appointment_status_history where appointment_id in (${W.appts})`),
  ortho_follow_ups: await q(`select * from ortho_follow_ups where id in (${W.fus})`),
  ortho_consultations: await q(`select * from ortho_consultations where id in (${W.dx})`),
};
const zatca = await q(`select count(*)::int n from zatca_documents where invoice_id in (${W.invs})`);
console.log('هيتمسح:', Object.fromEntries(Object.entries(backup).filter(([k]) => k !== 'at').map(([k, v]) => [k, v.length])), '· zatca:', zatca[0].n);
if (dry) process.exit(0);
if (zatca[0].n) throw new Error('فيه مستندات ضريبية مربوطة بالفواتير — وقفت');
mkdirSync(new URL('../backups/', import.meta.url), { recursive: true });
const file = new URL(`../backups/purge-visits-${Date.now()}.json`, import.meta.url);
writeFileSync(file, JSON.stringify(backup, null, 1));
console.log('النسخة الاحتياطية:', file.pathname);
await sql(`begin;
  delete from invoices where id in (${W.invs});
  delete from ortho_follow_ups where id in (${W.fus});
  delete from ortho_consultations where id in (${W.dx});
  delete from appointments where id in (${W.appts});
commit;`);
const left = await q(`select (select count(*) from invoices)::int inv, (select count(*) from appointments)::int appt, (select count(*) from ortho_follow_ups)::int fu,
  (select count(*) from ortho_consultations)::int dx, (select count(*) from ortho_consultations where created_at < '2026-11-01')::int dx_imported, (select count(*) from patients)::int patients`);
console.log('بعد المسح:', JSON.stringify(left[0]));
setTimeout(() => process.exit(0), 100);
