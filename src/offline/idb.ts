// ======================================================================
// idb.ts — تخزين محلي بسيط فوق IndexedDB (من غير مكتبات). مخزنين: kv (لقطات البيانات والجلسة) و ops (طابور العمليات).
// لو IndexedDB مش متاح (وضع خاص/تخزين ممنوع/ممتلئ) بنرجع لتخزين في الذاكرة بس ونعلّم `persistent=false` —
// الواجهة بتعرض تحذير إن التغييرات المعلّقة هتضيع لو اتقفل التطبيق.
// ======================================================================

export interface KV {
  get<T = unknown>(key: string): Promise<T | undefined>;
  set(key: string, value: unknown): Promise<void>;
  del(key: string): Promise<void>;
  /** يمسح كل المخزنين (يتنادى عند الخروج أو تغيير المستخدم) */
  clearAll(): Promise<void>;
  ops: {
    getAll<T = unknown>(): Promise<T[]>;
    put(op: { id: string }): Promise<void>;
    del(id: string): Promise<void>;
  };
  persistent: boolean;
}

const DB_NAME = 'ortho-offline';
const DB_VERSION = 1;

/** مخزن في الذاكرة — للاختبارات وللمتصفحات اللي IndexedDB فيها معطّل */
export function memoryStore(): KV {
  const kv = new Map<string, unknown>();
  const ops = new Map<string, { id: string }>();
  const clone = <T>(v: T): T => (v === undefined ? v : (structuredClone(v) as T));
  return {
    persistent: false,
    async get(key) { return clone(kv.get(key)) as never; },
    async set(key, value) { kv.set(key, clone(value)); },
    async del(key) { kv.delete(key); },
    async clearAll() { kv.clear(); ops.clear(); },
    ops: {
      async getAll() { return [...ops.values()].map(clone) as never; },
      async put(op) { ops.set(op.id, clone(op)); },
      async del(id) { ops.delete(id); },
    },
  };
}

function openDb(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, DB_VERSION);
    req.onupgradeneeded = () => {
      const d = req.result;
      if (!d.objectStoreNames.contains('kv')) d.createObjectStore('kv');
      if (!d.objectStoreNames.contains('ops')) d.createObjectStore('ops', { keyPath: 'id' });
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
    req.onblocked = () => reject(new Error('indexeddb blocked'));
  });
}

function wrap<T>(r: IDBRequest<T>): Promise<T> {
  return new Promise((resolve, reject) => { r.onsuccess = () => resolve(r.result); r.onerror = () => reject(r.error); });
}
function txDone(tx: IDBTransaction): Promise<void> {
  return new Promise((resolve, reject) => { tx.oncomplete = () => resolve(); tx.onerror = () => reject(tx.error); tx.onabort = () => reject(tx.error ?? new Error('tx aborted')); });
}

export async function openStore(): Promise<KV> {
  if (typeof indexedDB === 'undefined') return memoryStore();
  let dbp: Promise<IDBDatabase>;
  try { dbp = openDb(); await dbp; } catch { return memoryStore(); }
  const d = await dbp;
  const run = async <T>(store: 'kv' | 'ops', mode: IDBTransactionMode, f: (s: IDBObjectStore) => IDBRequest<T> | void): Promise<T | undefined> => {
    const tx = d.transaction(store, mode);
    const r = f(tx.objectStore(store));
    await txDone(tx);
    return r ? (r as IDBRequest<T>).result : undefined;
  };
  return {
    persistent: true,
    get: (key) => run('kv', 'readonly', (s) => s.get(key)) as never,
    set: async (key, value) => { await run('kv', 'readwrite', (s) => { s.put(value, key); }); },
    del: async (key) => { await run('kv', 'readwrite', (s) => { s.delete(key); }); },
    async clearAll() {
      const tx = d.transaction(['kv', 'ops'], 'readwrite');
      tx.objectStore('kv').clear(); tx.objectStore('ops').clear();
      await txDone(tx);
    },
    ops: {
      getAll: () => wrap(d.transaction('ops', 'readonly').objectStore('ops').getAll()) as never,
      put: async (op) => { await run('ops', 'readwrite', (s) => { s.put(op); }); },
      del: async (id) => { await run('ops', 'readwrite', (s) => { s.delete(id); }); },
    },
  };
}
