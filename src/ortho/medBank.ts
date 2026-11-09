// بحث بنك الأدوية على الخادم: البنك فيه عشرات الآلاف من الأسامي، فمش بيتحمّل على الجهاز — الجهاز بيحمّل اللي الطبيب اختاره بس (MEDS_ON_DEVICE).
import { useEffect, useRef, useState } from 'react';
import { supabase } from '../lib/supabase';
import type { MedItem } from './data';

const pattern = (term: string) => `%${term.trim().replace(/[\\%_]/g, (c) => `\\${c}`).replace(/\s+/g, '%')}%`;

async function fetchPage(term: string, offset: number, limit: number) {
  let q = supabase.from('ortho_medications').select('id,name,group,dose,frequency,duration,shown', { count: 'exact' }).order('name').range(offset, offset + limit - 1);
  if (term.trim()) q = q.ilike('name', pattern(term));
  const { data, error, count } = await q;
  if (error) throw error;
  return { rows: (data ?? []) as MedItem[], total: count ?? 0 };
}

export function useMedBank(term: string, enabled = true, limit = 50) {
  const [rows, setRows] = useState<MedItem[]>([]);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(false);
  const [failed, setFailed] = useState(false);
  const seq = useRef(0);
  useEffect(() => {
    const mine = ++seq.current;
    if (!enabled) { setRows([]); setTotal(0); setFailed(false); setLoading(false); return; }
    setLoading(true);
    const t = window.setTimeout(() => {
      fetchPage(term, 0, limit)
        .then((r) => { if (mine === seq.current) { setRows(r.rows); setTotal(r.total); setFailed(false); } })
        .catch(() => { if (mine === seq.current) { setRows([]); setTotal(0); setFailed(true); } })
        .finally(() => { if (mine === seq.current) setLoading(false); });
    }, 250);
    return () => window.clearTimeout(t);
  }, [term, enabled, limit]);
  const more = () => {
    const mine = seq.current;
    setLoading(true);
    fetchPage(term, rows.length, limit)
      .then((r) => { if (mine === seq.current) { setRows((x) => [...x, ...r.rows]); setTotal(r.total); } })
      .catch(() => { if (mine === seq.current) setFailed(true); })
      .finally(() => { if (mine === seq.current) setLoading(false); });
  };
  return { rows, total, loading, failed, hasMore: rows.length < total, more };
}
