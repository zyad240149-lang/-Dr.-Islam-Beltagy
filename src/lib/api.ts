import { supabase } from './supabase';

const BASE = `${import.meta.env.VITE_SUPABASE_URL}/functions/v1/api`;

async function authHeader(): Promise<Record<string, string>> {
  const { data } = await supabase.auth.getSession();
  const token = data.session?.access_token;
  return token ? { Authorization: `Bearer ${token}` } : {};
}

async function request(method: string, path: string, body?: unknown) {
  const headers: Record<string, string> = { 'Content-Type': 'application/json', ...(await authHeader()) };
  const res = await fetch(`${BASE}/${path}`, {
    method,
    headers,
    body: body !== undefined ? JSON.stringify(body) : undefined,
  });
  const data = await res.json().catch(() => null);
  // code = سبب محدد من الخادم (زي need_id في إنشاء الحساب) عشان الشاشة تتصرف عليه
  if (!res.ok) throw Object.assign(new Error(data?.error ?? `فشل الاتصال بالخادم (${res.status})`), { code: data?.code as string | undefined, status: res.status });
  return data;
}

export const api = {
  get: (table: string, id?: string) => request('GET', id ? `${table}/${id}` : table),
  query: (table: string, params: Record<string, string>) => request('GET', `${table}?${new URLSearchParams(params)}`),
  post: (table: string, body: unknown) => request('POST', table, body),
  patch: (table: string, id: string, body: unknown) => request('PATCH', `${table}/${id}`, body),
  del: (table: string, id: string) => request('DELETE', `${table}/${id}`),
  me: () => request('GET', 'me'),
};
