// ترتيب مجموعات الأدوية اللي الطبيب بيختاره — بيتطبق في صفحة الأدوية وفي اختيار الأدوية في الروشتة.
// متخزن في قاعدة البيانات (ortho_med_groups — migration 973) فبيتزامن بين الأجهزة، ونسخة على الجهاز عشان يشتغل من غير نت.
import { useSyncExternalStore } from 'react';
import { supabase } from '../lib/supabase';

const KEY = 'ortho.medGroupOrder.v1';
const subs = new Set<() => void>();
let cached: string[] | null = null;
let fetched = false;

function local(): string[] {
  try { const v = JSON.parse(localStorage.getItem(KEY) ?? '[]'); return Array.isArray(v) ? v.filter((x) => typeof x === 'string') : []; }
  catch { return []; }
}
function publish(order: string[]) {
  cached = [...order];
  try { localStorage.setItem(KEY, JSON.stringify(cached)); } catch { /* التخزين مقفول */ }
  subs.forEach((f) => f());
}
function read(): string[] {
  if (!cached) cached = local();
  if (!fetched) {
    fetched = true;
    supabase.from('ortho_med_groups').select('name,position').order('position').then(({ data, error }) => {
      if (!error && data?.length) publish(data.map((r) => r.name as string));
    });
  }
  return cached;
}

export async function setGroupOrder(order: string[]) {
  publish(order);
  const { error } = await supabase.from('ortho_med_groups').upsert(order.map((name, position) => ({ name, position })), { onConflict: 'name' });
  if (error) throw error;
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
