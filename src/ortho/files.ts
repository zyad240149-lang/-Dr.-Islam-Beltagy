// ملفات المريض (الأشعة والتحاليل) زي ما الشاشات بتشوفها: نسخة الخادم المحفوظة على الجهاز (بتفتح من غير إنترنت)
// + الملفات اللي اترفعت من غير إنترنت ولسه في طابور المزامنة (بتتعرض من الجهاز نفسه لحد ما توصل الخادم).
// الشاشة بتتحدّث لوحدها: تغيير على الخادم (Realtime) ← إعادة تحميل، وأي تغيير في الطابور ← إعادة رسم.
import { map } from '../data/remote';
import { offline, useOfflineState } from '../offline';
import { ortho, useOrthoVersion } from './data';
import type { PatientFile, PatientFileCategory } from '../types';

const localUrls = new Map<string, string>(); // رابط مؤقت للملف اللي لسه على الجهاز (معاينة من غير إنترنت)

export function patientFilesOf(patientId: string): PatientFile[] {
  const server = ortho.rows('files', patientId).map(map.file);
  const have = new Set(server.map((f) => f.id));
  const pending: PatientFile[] = [];
  for (const o of offline.queue.list()) {
    if (o.kind !== 'file.upload' || o.payload.patientId !== patientId || have.has(o.entityId)) continue;
    const p = o.payload as { path: string; name: string; type: string; size: number; note: string; category: PatientFileCategory; title: string; fileDate: string; uploadedByName: string; bytes?: ArrayBuffer };
    let url = localUrls.get(o.entityId);
    if (!url && p.bytes) { url = URL.createObjectURL(new Blob([p.bytes], { type: p.type })); localUrls.set(o.entityId, url); }
    pending.push({ id: o.entityId, patientId, uploadedBy: null, uploadedByName: p.uploadedByName, filePath: p.path, fileName: p.name, fileType: p.type, sizeBytes: p.size,
      note: p.note, createdAt: o.createdAt, category: p.category, title: p.title, fileDate: p.fileDate, pendingSync: true, localUrl: url,
      syncError: o.status === 'failed' || o.status === 'conflict' ? o.lastError ?? 'فشل الرفع' : '' });
  }
  // الملفات اللي وصلت الخادم: الرابط المحلي مابقاش له لازمة
  for (const [id, url] of localUrls) if (have.has(id)) { URL.revokeObjectURL(url); localUrls.delete(id); }
  return [...pending, ...server].sort((a, b) => b.createdAt - a.createdAt);
}

export function usePatientFiles(patientId: string) {
  useOrthoVersion();
  useOfflineState();
  return { files: patientId ? patientFilesOf(patientId) : [], loading: ortho.isLoading('files'), error: ortho.error('files') };
}
