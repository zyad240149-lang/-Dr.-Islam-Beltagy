// ======================================================================
// crypto.ts — تشفير بيانات المرضى المحفوظة على الجهاز (AES-GCM 256 عبر Web Crypto).
//
// المفتاح: بيتولّد عشوائي على الجهاز كـ CryptoKey «غير قابل للتصدير» (extractable=false) ومحفوظ في IndexedDB.
//  - بيحمي النسخ اللي برّه المتصفح: ملفات IndexedDB على الهارد، النسخ الاحتياطية، أدوات استخراج بيانات المتصفح —
//    بايتات المفتاح نفسها مش متاحة لأي كود (ولا لينا)، فالبيانات المنسوخة من غير المتصفح ده مقروءة كأرقام عشوائية.
//  - مابيحميش من حد فاتح نفس حساب المتصفح على نفس الجهاز وهو مسجّل دخول (التطبيق نفسه لازم يفك التشفير عشان يعرض).
//    الحماية دي مسؤولية قفل الجهاز + تسجيل الخروج على الأجهزة المشتركة (الخروج بيمسح المفتاح والبيانات).
//  - تسجيل الخروج/تغيير المستخدم بيمسح المفتاح ← أي بيانات قديمة باقية بتبقى مستحيلة القراءة.
// لو Web Crypto مش متاح (صفحة مش https) بنخزّن من غير تشفير ونعلّم ده في حالة المزامنة (الواجهة بتعرضه).
// ======================================================================
import type { KV } from './idb';

const KEY_ID = 'device-key';
export interface Sealed { v: 1; iv: Uint8Array<ArrayBuffer>; ct: ArrayBuffer }

const subtle = (): SubtleCrypto | null => (typeof crypto !== 'undefined' && crypto.subtle ? crypto.subtle : null);
export const cryptoAvailable = () => !!subtle();

/** مفتاح الجهاز (بيتعمل أول مرة). null لو التشفير مش متاح في المتصفح ده. */
export async function deviceKey(store: KV): Promise<CryptoKey | null> {
  const s = subtle(); if (!s) return null;
  const existing = await store.get<CryptoKey>(KEY_ID);
  if (existing) return existing;
  const key = await s.generateKey({ name: 'AES-GCM', length: 256 }, false, ['encrypt', 'decrypt']);
  await store.set(KEY_ID, key);
  return key;
}

/** المفتاح الموجود بس (من غير ما نعمل جديد) — للقراءة: مفتاح جديد مش هيفك بيانات اتشفرت بالقديم */
export async function existingKey(store: KV): Promise<CryptoKey | null> {
  return subtle() ? ((await store.get<CryptoKey>(KEY_ID)) ?? null) : null;
}

const enc = new TextEncoder();
const dec = new TextDecoder();

export async function seal(key: CryptoKey, value: unknown): Promise<Sealed> {
  const iv = crypto.getRandomValues(new Uint8Array(new ArrayBuffer(12)));
  const ct = await subtle()!.encrypt({ name: 'AES-GCM', iv }, key, enc.encode(JSON.stringify(value)));
  return { v: 1, iv, ct };
}

export async function unseal<T>(key: CryptoKey, s: Sealed): Promise<T> {
  const pt = await subtle()!.decrypt({ name: 'AES-GCM', iv: s.iv }, key, s.ct);
  return JSON.parse(dec.decode(pt)) as T;
}

export const isSealed = (x: unknown): x is Sealed => !!x && typeof x === 'object' && (x as Sealed).v === 1 && (x as Sealed).ct instanceof ArrayBuffer;
