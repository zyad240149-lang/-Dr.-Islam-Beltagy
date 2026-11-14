// ترتيب مجموعات الأدوية اللي الطبيب بيختاره — بيتطبق في صفحة الأدوية وفي اختيار الأدوية في الروشتة.
// متخزن على الجهاز ده (localStorage) لحد ما يتعمل له مكان في قاعدة البيانات يتزامن بين الأجهزة.
import { useSyncExternalStore } from 'react';

const KEY = 'ortho.medGroupOrder.v1';
const subs = new Set<() => void>();
let cached: string[] | null = null;

function read(): string[] {
  if (cached) return cached;
  try { const v = JSON.parse(localStorage.getItem(KEY) ?? '[]'); cached = Array.isArray(v) ? v.filter((x) => typeof x === 'string') : []; }
  catch { cached = []; }
  return cached;
}

export function setGroupOrder(order: string[]) {
  cached = [...order];
  try { localStorage.setItem(KEY, JSON.stringify(cached)); } catch { /* التخزين مقفول — الترتيب يفضل للجلسة دي بس */ }
  subs.forEach((f) => f());
}

export function useGroupOrder() {
  return useSyncExternalStore((f) => { subs.add(f); return () => subs.delete(f); }, read, read);
}

/** يرتّب أسامي المجموعات: اللي الطبيب رتّبها الأول بترتيبه، والباقي بعدها بترتيبهم الأصلي، و«أخرى» في الآخر */
export function sortGroups<T>(entries: [string, T][], order: string[]): [string, T][] {
  const pos = new Map(order.map((g, i) => [g, i] as const));
  return entries.map((e, i) => ({ e, i })).sort((a, b) => {
    const ra = a.e[0] === 'أخرى' ? 1e9 : pos.get(a.e[0]) ?? 1e6 + a.i;
    const rb = b.e[0] === 'أخرى' ? 1e9 : pos.get(b.e[0]) ?? 1e6 + b.i;
    return ra - rb;
  }).map(({ e }) => e);
}
