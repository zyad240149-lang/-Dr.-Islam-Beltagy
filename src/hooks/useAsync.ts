import { useCallback, useEffect, useRef, useState } from 'react';

// تحميل غير متزامن مع حالات Loading / Error والتحديث اليدوي
export function useAsync<T>(fn: () => Promise<T>, deps: unknown[] = []) {
  const [data, setData] = useState<T | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const seq = useRef(0);
  const run = useCallback(async () => {
    const my = ++seq.current;
    setLoading(true); setError('');
    try { const r = await fn(); if (my === seq.current) setData(r); }
    catch (e) { if (my === seq.current) setError(e instanceof Error ? e.message : 'حدث خطأ، حاول مرة ثانية'); }
    finally { if (my === seq.current) setLoading(false); }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, deps);
  useEffect(() => { run(); }, [run]);
  return { data, loading, error, reload: run };
}
