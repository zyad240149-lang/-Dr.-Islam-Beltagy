// اختبارات قاعدة البيانات داخل معاملة واحدة بتتلغي بالكامل: الاستعلام كله معاملة ضمنية وآخره خطأ مقصود بيرجّع النتائج.
// ممنوع commit في أي نص، فمفيش صف بيتحفظ. العدّادات (sequences) بس ممكن تزيد.
import { readFileSync } from 'node:fs';
import { env, REF } from './_env.mjs';

const MARK = 'ROLLBACK_RESULTS:';
const FORBIDDEN = /(^|[;\s])(commit|end\s+transaction|vacuum|dblink|pg_terminate_backend)\b/i;

export const migration = (file) => readFileSync(new URL(`../supabase/migrations/${file}`, import.meta.url), 'utf8');
export const lit = (s) => `'${String(s).replace(/'/g, "''")}'`;

async function post(query) {
  const r = await fetch(`https://api.supabase.com/v1/projects/${REF}/database/query`, {
    method: 'POST', headers: { Authorization: 'Bearer ' + env.SUPABASE_ACCESS_TOKEN, 'Content-Type': 'application/json' }, body: JSON.stringify({ query }),
  });
  return { status: r.status, text: await r.text() };
}

/** بيبني معاملة: setup (نص SQL) + checks، وبيرجّع نتيجة كل فحص */
export function tx() {
  const parts = ["create temp table _r (n serial, name text, ok boolean, detail text); grant all on _r to public; grant all on _r_n_seq to public;"];
  const api = {
    raw(sql) { parts.push(sql); return api; },
    /** يدخل بهوية مستخدم (null = service/postgres) */
    as(authUid) {
      parts.push(authUid
        ? `select set_config('request.jwt.claims', ${lit(JSON.stringify({ sub: authUid, role: 'authenticated' }))}, true), set_config('role', 'authenticated', true);`
        : `select set_config('role', 'none', true), set_config('request.jwt.claims', '', true);`);
      return api;
    },
    /** لازم الكود ينجح، ولو رجّع false في v_ok الفحص بيفشل */
    ok(name, body) {
      parts.push(`do $chk$ declare v_ok boolean := true; v_detail text := ''; begin begin ${body}; exception when others then v_ok := false; v_detail := sqlerrm; end; insert into _r(name, ok, detail) values (${lit(name)}, v_ok, v_detail); end $chk$;`);
      return api;
    },
    /** لازم الكود يترفض (واختياريًا الرسالة تحتوي نص معيّن) */
    rejects(name, body, contains = '') {
      parts.push(`do $chk$ declare v_ok boolean; v_detail text := ''; begin begin ${body}; v_ok := false; v_detail := 'اتقبل وكان لازم يترفض'; exception when others then v_detail := sqlerrm; v_ok := (${lit(contains)} = '' or position(${lit(contains)} in sqlerrm) > 0); end; insert into _r(name, ok, detail) values (${lit(name)}, v_ok, v_detail); end $chk$;`);
      return api;
    },
    async run() {
      parts.push(`select set_config('role', 'none', true); do $end$ begin raise exception '${MARK}%', (select coalesce(json_agg(json_build_object('name', name, 'ok', ok, 'detail', detail) order by n), '[]') from _r); end $end$;`);
      const q = parts.join('\n');
      if (FORBIDDEN.test(q.replace(/--.*$/gm, ''))) throw new Error('النص فيه أمر ممنوع في اختبار الإلغاء');
      const { status, text } = await post(q);
      const at = text.indexOf(MARK);
      if (at < 0) throw new Error(`المعاملة فشلت قبل نهايتها (اتلغت): ${status} ${text.slice(0, 1500)}`);
      const raw = JSON.parse(text).message;
      const body = raw.slice(raw.indexOf(MARK) + MARK.length);
      return JSON.parse(body.slice(0, body.lastIndexOf(']') + 1));
    },
  };
  return api;
}

export function report(results) {
  let failed = 0;
  for (const r of results) { if (!r.ok) failed++; console.log(r.ok ? '  PASS' : '  FAIL', r.name, r.ok ? '' : `— ${r.detail}`); }
  console.log(`\n${results.length - failed}/${results.length} passed`);
  process.exitCode = failed ? 1 : 0;
  return failed;
}
