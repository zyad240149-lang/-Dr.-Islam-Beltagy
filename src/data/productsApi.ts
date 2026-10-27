// قسم «بيع المنتجات» — طبقة بيانات مستقلة عن المخزون العام (inventory) وعن db.ts.
// القراءة مباشرة من الجداول (RLS: صلاحية products/view)، والكتابة كلها عبر دوال RPC على الخادم.
import { supabase } from '../lib/supabase';

export interface Product {
  id: string; sku: string; name: string; description: string; category: string; price: number; quantity: number;
  imagePath: string | null; imageUrl: string | null; active: boolean; createdAt: string; updatedAt: string;
}
export type SaleStatus = 'completed' | 'cancelled';
export type PayMethod = import('../types').PaymentMethod;
export interface ProductSale {
  id: string; invoiceNo: string; productId: string; productName: string; productSku: string; qty: number; unitPrice: number;
  subtotal: number; discount: number; taxRate: number; taxAmount: number; total: number; paymentMethod: PayMethod;
  patientId: string | null; customerName: string | null; employeeId: string | null; status: SaleStatus; cancelReason: string | null; createdAt: string;
}
export interface ProductInput { id?: string; sku: string; name: string; description: string; category: string; price: number; quantity?: number; imagePath?: string | null; active: boolean }

type Result<T> = ({ ok: true } & T) | { ok: false; error: string };
const clean = (m: string) => m.replace(/^.*?ERROR:\s*/, '').replace(/\s*\(SQLSTATE.*$/, '').trim() || 'حدث خطأ غير متوقع.';
const fail = (m: string) => ({ ok: false as const, error: clean(m) });

const BUCKET = 'product-images';
const imgUrl = (path: string | null) => (path ? supabase.storage.from(BUCKET).getPublicUrl(path).data.publicUrl : null);

const toProduct = (r: any): Product => ({
  id: r.id, sku: r.sku, name: r.name, description: r.description ?? '', category: r.category ?? '', price: Number(r.price), quantity: r.quantity,
  imagePath: r.image_path, imageUrl: imgUrl(r.image_path), active: r.active, createdAt: r.created_at, updatedAt: r.updated_at,
});
const toSale = (r: any): ProductSale => ({
  id: r.id, invoiceNo: r.invoice_no, productId: r.product_id, productName: r.product_name, productSku: r.product_sku, qty: r.qty,
  unitPrice: Number(r.unit_price), subtotal: Number(r.subtotal), discount: Number(r.discount), taxRate: Number(r.tax_rate),
  taxAmount: Number(r.tax_amount), total: Number(r.total), paymentMethod: r.payment_method, patientId: r.patient_id,
  customerName: r.customer_name, employeeId: r.employee_id, status: r.status, cancelReason: r.cancel_reason, createdAt: r.created_at,
});

export const productsApi = {
  async list(): Promise<Result<{ rows: Product[] }>> {
    const { data, error } = await supabase.from('products').select('*').order('name');
    return error ? fail(error.message) : { ok: true, rows: (data ?? []).map(toProduct) };
  },
  async sales(): Promise<Result<{ rows: ProductSale[] }>> {
    const { data, error } = await supabase.from('product_sales').select('*').order('created_at', { ascending: false }).limit(5000);
    return error ? fail(error.message) : { ok: true, rows: (data ?? []).map(toSale) };
  },
  async sale(id: string): Promise<ProductSale | null> {
    const { data } = await supabase.from('product_sales').select('*').eq('id', id).maybeSingle();
    return data ? toSale(data) : null;
  },
  async product(id: string): Promise<Product | null> {
    const { data } = await supabase.from('products').select('*').eq('id', id).maybeSingle();
    return data ? toProduct(data) : null;
  },
  async uploadImage(file: File): Promise<Result<{ path: string }>> {
    if (!/^image\/(png|jpeg|webp)$/.test(file.type)) return fail('لازم تكون الصورة PNG أو JPG أو WEBP.');
    if (file.size > 3 * 1024 * 1024) return fail('حجم الصورة أكبر من 3 ميجا.');
    const ext = file.type === 'image/png' ? 'png' : file.type === 'image/webp' ? 'webp' : 'jpg';
    const path = `${crypto.randomUUID()}.${ext}`;
    const { error } = await supabase.storage.from(BUCKET).upload(path, file, { contentType: file.type });
    return error ? fail('تعذّر رفع الصورة: ' + error.message) : { ok: true, path };
  },
  async removeImage(path: string) { await supabase.storage.from(BUCKET).remove([path]); },
  async save(p: ProductInput): Promise<Result<{ id: string }>> {
    const { data, error } = await supabase.rpc('product_save', { p });
    return error ? fail(error.message) : { ok: true, id: data as string };
  },
  async addStock(id: string, qty: number, note?: string): Promise<Result<{ quantity: number }>> {
    const { data, error } = await supabase.rpc('product_add_stock', { p_id: id, p_qty: qty, p_note: note ?? null });
    return error ? fail(error.message) : { ok: true, quantity: data as number };
  },
  // كتابة الكمية المتاحة مباشرة (بتتسجّل كحركة «تعديل»)
  async setQuantity(id: string, qty: number, note?: string): Promise<Result<{ quantity: number }>> {
    const { data, error } = await supabase.rpc('product_set_quantity', { p_id: id, p_qty: qty, p_note: note ?? null });
    return error ? fail(error.message) : { ok: true, quantity: data as number };
  },
  async remove(id: string): Promise<Result<{ mode: 'deleted' | 'disabled' }>> {
    const { data, error } = await supabase.rpc('product_delete', { p_id: id });
    return error ? fail(error.message) : { ok: true, mode: data as 'deleted' | 'disabled' };
  },
  async sell(a: { productId: string; qty: number; discount: number; patientId: string | null; customerName: string; taxRate: number; paymentMethod: PayMethod; key: string }): Promise<Result<{ id: string; invoiceNo: string }>> {
    const { data, error } = await supabase.rpc('sell_product', {
      p_product: a.productId, p_qty: a.qty, p_discount: a.discount, p_patient: a.patientId, p_customer_name: a.customerName || null,
      p_payment_method: a.paymentMethod, p_idempotency_key: a.key, p_tax_rate: a.taxRate,
    });
    return error ? fail(error.message) : { ok: true, id: data.id, invoiceNo: data.invoiceNo };
  },
  async cancelSale(id: string, reason: string): Promise<Result<object>> {
    const { error } = await supabase.rpc('cancel_product_sale', { p_id: id, p_reason: reason || null });
    return error ? fail(error.message) : { ok: true };
  },
  // تحديثات لحظية لما موظف تاني يبيع أو يعدّل منتج
  subscribe(cb: () => void) {
    const ch = supabase.channel(`products-live-${crypto.randomUUID()}`);
    let t: ReturnType<typeof setTimeout> | null = null;
    const bump = () => { if (t) clearTimeout(t); t = setTimeout(cb, 300); };
    ch.on('postgres_changes', { event: '*', schema: 'public', table: 'products' }, bump);
    ch.on('postgres_changes', { event: '*', schema: 'public', table: 'product_sales' }, bump);
    ch.subscribe();
    return () => { if (t) clearTimeout(t); supabase.removeChannel(ch); };
  },
};
