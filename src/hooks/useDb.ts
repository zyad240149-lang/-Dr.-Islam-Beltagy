import { useEffect, useState } from 'react';
import { db } from '../data/db';

export function useDbVersion(): number {
  const [v, setV] = useState(0);
  useEffect(() => db.subscribe(() => setV((n) => n + 1)), []);
  return v;
}

// حالة التحميل الحقيقية: true لحد ما البيانات تتحمّل من قاعدة البيانات
export function useLoading(): boolean {
  useDbVersion();
  return !db.isReady();
}
