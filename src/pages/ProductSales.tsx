import { patientMatches, textMatches } from '../utils/phoneUtils';
// قسم «بيع المنتجات» — مستقل تمامًا عن المخزون العام (Inventory.tsx): منتجاته وكمياته ومبيعاته وفواتيره خاصة بيه.
// كل البيانات من productsApi (جداول products / product_sales)، وكل كتابة عبر RPC على الخادم.
import { useEffect, useMemo, useRef, useState } from 'react';
import { db } from '../data/db';
import { productsApi, type PayMethod, type Product, type ProductInput, type ProductSale } from '../data/productsApi';
import { Button, EmptyState, Input, Modal, Select, Skeleton, StatusBadge } from '../components/ui';
import { BarChart, ConfirmDialog, FilterBar, IconAction, RowActions, useCan } from '../components/common';
import { StatCard } from '../components/StatCard';
import { Icon } from '../utils/icons';
import { useToast } from '../hooks/useToast';
import { PAYMENT_METHOD_LABEL, PAYMENT_METHOD_OPTIONS, amountToArabicWords, exportCsv, fmtDateTime, money, riyadhYmd, riyadhTodayYmd, addDaysYmd } from '../utils/format';

const SALE_STATUS: Record<ProductSale['status'], { label: string; tone: string }> = {
  completed: { label: 'مكتملة', tone: 'ok' }, cancelled: { label: 'ملغاة', tone: 'danger' },
};
const empName = (id: string | null) => (id ? db.employees().find((e) => e.id === id)?.name : undefined) ?? '—';
const customerOf = (s: ProductSale) => (s.patientId ? db.patient(s.patientId)?.fullName : s.customerName) || 'عميل نقدي';

function useProductsData() {
  const [products, setProducts] = useState<Product[] | null>(null);
  const [sales, setSales] = useState<ProductSale[] | null>(null);
  const [error, setError] = useState('');
  const reload = async () => {
    const [p, s] = await Promise.all([productsApi.list(), productsApi.sales()]);
    if (!p.ok) { setError(p.error); setProducts([]); } else setProducts(p.rows);
    if (!s.ok) { setError(s.error); setSales([]); } else setSales(s.rows);
  };
  useEffect(() => { reload(); return productsApi.subscribe(reload); }, []);
  return { products, sales, error, reload };
}

function ProductThumb({ p, size = 54 }: { p: Pick<Product, 'imageUrl' | 'name'>; size?: number }) {
  return p.imageUrl
    ? <img src={p.imageUrl} alt={p.name} style={{ width: size, height: size, objectFit: 'cover', borderRadius: 10, border: '1px solid var(--line)' }} />
    : <span style={{ width: size, height: size, borderRadius: 10, display: 'inline-grid', placeItems: 'center', background: 'var(--bg-soft, #f2f4f8)', color: 'var(--muted)' }}><Icon name="box" size={size / 2.2} /></span>;
}

function availability(p: Product): { label: string; tone: string } {
  if (!p.active) return { label: 'غير متاح', tone: 'muted' };
  if (p.quantity <= 0) return { label: 'غير متوفر', tone: 'danger' };
  return { label: 'متاح', tone: 'ok' };
}

// ============ إضافة / تعديل منتج ============
function ProductModal({ product, categories, onClose, onSaved }: { product: Product | null; categories: string[]; onClose: () => void; onSaved: () => void }) {
  const toast = useToast();
  const [f, setF] = useState({ name: product?.name ?? '', sku: product?.sku ?? '', price: product && product.price > 0 ? String(product.price) : '', quantity: product && product.quantity > 0 ? String(product.quantity) : '', category: product?.category ?? '', description: product?.description ?? '', active: product?.active ?? true });
  const [file, setFile] = useState<File | null>(null);
  const [preview, setPreview] = useState<string | null>(product?.imageUrl ?? null);
  const [removeImg, setRemoveImg] = useState(false);
  const [busy, setBusy] = useState(false);
  const [tried, setTried] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);

  const price = Number(f.price), qty = f.quantity.trim() === '' ? 0 : Number(f.quantity);
  const errs = {
    name: !f.name.trim() ? 'اسم المنتج مطلوب' : '',
    sku: !f.sku.trim() ? 'كود المنتج مطلوب' : '',
    price: f.price === '' || !(price >= 0) ? 'أدخل سعر صحيح' : '',
    quantity: !Number.isInteger(qty) || qty < 0 ? 'أدخل كمية صحيحة (0 أو أكثر)' : '',
  };
  const pick = (fl: File | null) => { if (!fl) return; setFile(fl); setRemoveImg(false); setPreview(URL.createObjectURL(fl)); };

  const submit = async () => {
    setTried(true);
    if (Object.values(errs).some(Boolean)) return;
    setBusy(true);
    let imagePath: string | null | undefined = undefined;
    if (file) {
      const up = await productsApi.uploadImage(file);
      if (!up.ok) { setBusy(false); toast.error(up.error); return; }
      imagePath = up.path;
    } else if (removeImg) imagePath = null;
    const input: ProductInput = { id: product?.id, name: f.name.trim(), sku: f.sku.trim(), price, description: f.description, category: f.category.trim(), active: f.active, ...(product ? {} : { quantity: qty }), ...(imagePath !== undefined ? { imagePath } : {}) };
    const r = await productsApi.save(input);
    setBusy(false);
    if (!r.ok) { if (imagePath) productsApi.removeImage(imagePath); toast.error(r.error); return; }
    if (imagePath !== undefined && product?.imagePath && product.imagePath !== imagePath) productsApi.removeImage(product.imagePath);
    if (product && qty !== product.quantity) {
      const qr = await productsApi.setQuantity(product.id, qty);
      if (!qr.ok) { toast.error(`حُفظ المنتج، لكن الكمية لم تتعدّل: ${qr.error}`); onSaved(); return; }
    }
    toast.success(product ? 'تم تعديل المنتج.' : 'تمت إضافة المنتج.');
    onSaved(); onClose();
  };

  return (
    <Modal title={product ? `تعديل المنتج — ${product.name}` : 'إضافة منتج جديد'} onClose={onClose} wide footer={
      <><Button variant="outline" onClick={onClose} disabled={busy}>إلغاء</Button><Button icon="check" onClick={submit} loading={busy}>{product ? 'حفظ التعديلات' : 'إضافة المنتج'}</Button></>
    }>
      <div style={{ display: 'flex', gap: 14, alignItems: 'center', marginBottom: 16, flexWrap: 'wrap' }}>
        {preview ? <img src={preview} alt="" style={{ width: 88, height: 88, objectFit: 'cover', borderRadius: 12, border: '1px solid var(--line)' }} /> : <ProductThumb p={{ imageUrl: null, name: '' }} size={88} />}
        <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
          <input ref={fileRef} type="file" accept="image/png,image/jpeg,image/webp" hidden onChange={(e) => pick(e.target.files?.[0] ?? null)} />
          <Button variant="outline" icon="camera" onClick={() => fileRef.current?.click()}>{preview ? 'تغيير الصورة' : 'رفع صورة'}</Button>
          {preview && <Button variant="ghost" onClick={() => { setFile(null); setPreview(null); setRemoveImg(true); }}>إزالة الصورة</Button>}
        </div>
      </div>
      <div className="grid-form">
        <Input id="pr-name" label="اسم المنتج *" value={f.name} error={tried ? errs.name : ''} onChange={(e) => setF({ ...f, name: e.target.value })} />
        <Input id="pr-sku" label="كود المنتج (SKU) *" dir="ltr" value={f.sku} error={tried ? errs.sku : ''} hint="كود مميز لكل منتج" onChange={(e) => setF({ ...f, sku: e.target.value.toUpperCase() })} />
        <Input id="pr-price" label="سعر البيع (ج.م) *" type="number" min={0} step="0.01" value={f.price} error={tried ? errs.price : ''} onChange={(e) => setF({ ...f, price: e.target.value })} />
        <Input id="pr-qty" label="الكمية المتاحة" type="number" min={0} step={1} inputMode="numeric" value={f.quantity} error={tried ? errs.quantity : ''} onChange={(e) => setF({ ...f, quantity: e.target.value })} />
      </div>
      <Input id="pr-cat" label="التصنيف" list="pr-cats" value={f.category} onChange={(e) => setF({ ...f, category: e.target.value })} hint="مثال: Physiotherapy tools" />
      <datalist id="pr-cats">{categories.map((c) => <option key={c} value={c} />)}</datalist>
      <div className="field">
        <label htmlFor="pr-desc">وصف المنتج (اختياري)</label>
        <textarea id="pr-desc" className="input" rows={3} value={f.description} onChange={(e) => setF({ ...f, description: e.target.value })} />
      </div>
      <div className="field">
        <label>حالة المنتج</label>
        <div className="seg">
          <button type="button" className={`seg__btn ${f.active ? 'active' : ''}`} onClick={() => setF({ ...f, active: true })}>متاح</button>
          <button type="button" className={`seg__btn ${!f.active ? 'active' : ''}`} onClick={() => setF({ ...f, active: false })}>غير متاح</button>
        </div>
      </div>
    </Modal>
  );
}

// ============ إضافة كمية ============
function StockModal({ product, onClose, onSaved }: { product: Product; onClose: () => void; onSaved: () => void }) {
  const toast = useToast();
  const [qty, setQty] = useState('');
  const [note, setNote] = useState('');
  const [busy, setBusy] = useState(false);
  const n = Number(qty);
  const valid = Number.isInteger(n) && n > 0;
  const submit = async () => {
    if (!valid) { toast.error('أدخل كمية صحيحة أكبر من صفر.'); return; }
    setBusy(true);
    const r = await productsApi.addStock(product.id, n, note);
    setBusy(false);
    if (!r.ok) { toast.error(r.error); return; }
    toast.success(`تمت إضافة الكمية — الكمية الحين ${r.quantity}.`);
    onSaved(); onClose();
  };
  return (
    <Modal title={`إضافة كمية — ${product.name}`} onClose={onClose} footer={<><Button variant="outline" onClick={onClose} disabled={busy}>إلغاء</Button><Button icon="check" onClick={submit} loading={busy}>إضافة</Button></>}>
      <p className="muted" style={{ marginBottom: 12 }}>الكمية الحالية: <strong className="num">{product.quantity}</strong>{valid && <> — بعد الإضافة: <strong className="num">{product.quantity + n}</strong></>}</p>
      <Input id="st-qty" label="الكمية المضافة *" type="number" min={1} step={1} value={qty} onChange={(e) => setQty(e.target.value)} autoFocus />
      <Input id="st-note" label="ملاحظة (اختياري)" value={note} onChange={(e) => setNote(e.target.value)} />
    </Modal>
  );
}

// ============ البيع ============
function SellModal({ products, preset, onClose, onSold }: { products: Product[]; preset: Product | null; onClose: () => void; onSold: (saleId: string) => void }) {
  const toast = useToast();
  const sellable = products.filter((p) => p.active && p.quantity > 0);
  const [productId, setProductId] = useState(preset && preset.active && preset.quantity > 0 ? preset.id : sellable[0]?.id ?? '');
  const [qty, setQty] = useState('1');
  const [discount, setDiscount] = useState('');
  const [method, setMethod] = useState<PayMethod>('cash');
  const [forPatient, setForPatient] = useState(false);
  const [q, setQ] = useState('');
  const [patientId, setPatientId] = useState('');
  const [customer, setCustomer] = useState('');
  const [taxInput, setTaxInput] = useState(''); // نسبة الضريبة يحددها الموظف من 0 إلى 20% (فاضية = 0)
  const [busy, setBusy] = useState(false);
  const key = useMemo(() => crypto.randomUUID(), []);   // يمنع تسجيل البيع مرتين لو الزرار اتضغط مرتين

  const p = products.find((x) => x.id === productId);
  const n = Number(qty), d = Number(discount || 0);
  const subtotal = p && Number.isInteger(n) && n > 0 ? Math.round(p.price * n * 100) / 100 : 0;
  const taxRate = taxInput.trim() === '' ? 0 : Number(taxInput);
  const taxOk = Number.isFinite(taxRate) && taxRate >= 0 && taxRate <= 20;
  const tax = taxOk ? Math.round((subtotal - d) * taxRate) / 100 : 0;
  const total = subtotal - d + tax;
  const patient = patientId ? db.patient(patientId) : undefined;
  const results = q.trim() ? db.searchPatients(q).slice(0, 6) : [];

  const err = !p ? 'اختر المنتج'
    : !Number.isInteger(n) || n <= 0 ? 'لازم تكون الكمية رقم صحيح أكبر من صفر'
    : n > p.quantity ? `الكمية المطلوبة أكبر من المتاح (${p.quantity})`
    : !(d >= 0) || d > subtotal ? 'لازم يكون الخصم بين 0 وإجمالي البيع'
    : forPatient && !patientId ? 'اختر المريض أو ألغِ خيار «البيع لمريض»'
    : !taxOk ? 'نسبة الضريبة لازم تكون من 0 إلى 20' : '';

  const submit = async () => {
    if (err) { toast.error(err); return; }
    setBusy(true);
    const r = await productsApi.sell({ productId, qty: n, discount: d, patientId: forPatient ? patientId : null, customerName: forPatient ? '' : customer.trim(), taxRate, paymentMethod: method, key });
    setBusy(false);
    if (!r.ok) { toast.error(r.error); return; }
    toast.success(`تم البيع — فاتورة ${r.invoiceNo}`);
    onSold(r.id);
  };

  if (sellable.length === 0) return (
    <Modal title="بيع منتج" onClose={onClose} footer={<Button onClick={onClose}>حسنًا</Button>}>
      <EmptyState icon="box" title="ما فيه منتجات متاحة للبيع" text="كل المنتجات غير متاحة أو كميتها صفر — أضف كمية أولًا." />
    </Modal>
  );

  return (
    <Modal title="بيع منتج" onClose={onClose} wide footer={
      <><Button variant="outline" onClick={onClose} disabled={busy}>إلغاء</Button><Button icon="check" onClick={submit} loading={busy} disabled={!!err}>تأكيد البيع وإصدار الفاتورة</Button></>
    }>
      <div className="grid-form">
        <Select id="sl-product" label="المنتج *" value={productId} onChange={(e) => setProductId(e.target.value)}
          options={sellable.map((x) => ({ value: x.id, label: `${x.name} (${x.sku}) — متاح ${x.quantity}` }))} />
        <Input id="sl-qty" label="الكمية *" type="number" min={1} max={p?.quantity} step={1} value={qty} onChange={(e) => setQty(e.target.value)} hint={p ? `المتاح: ${p.quantity}` : ''} />
        <Input id="sl-disc" label="الخصم (ج.م)" type="number" min={0} step="0.01" value={discount} onChange={(e) => setDiscount(e.target.value)} />
        <Input id="sl-tax" label="نسبة الضريبة (%)" type="number" min={0} max={20} step="0.01" inputMode="decimal" value={taxInput} onChange={(e) => setTaxInput(e.target.value)} hint="حدد النسبة من 0 إلى 20" />
        <Select id="sl-method" label="طريقة الدفع" value={method} onChange={(e) => setMethod(e.target.value as PayMethod)}
          options={PAYMENT_METHOD_OPTIONS} />
      </div>

      <div className="field">
        <label>البيع لمن؟</label>
        <div className="seg">
          <button type="button" className={`seg__btn ${!forPatient ? 'active' : ''}`} onClick={() => setForPatient(false)}>عميل عادي</button>
          <button type="button" className={`seg__btn ${forPatient ? 'active' : ''}`} onClick={() => setForPatient(true)}>مريض مسجّل</button>
        </div>
      </div>
      {!forPatient ? (
        <>
          <Input id="sl-cust" label="اسم العميل (اختياري)" value={customer} onChange={(e) => setCustomer(e.target.value)} />
        </>
      ) : patient ? (
        <div className="choice selected" style={{ marginBottom: 14 }}>
          <span className="choice__ic"><Icon name="user" size={18} /></span>
          <span style={{ flex: 1 }}><strong>{patient.fullName}</strong><span> {patient.fileNo} · <span className="num">{patient.phone}</span></span></span>
          <Button type="button" variant="ghost" size="sm" onClick={() => setPatientId('')}>تغيير</Button>
        </div>
      ) : (
        <>
          <Input id="sl-psearch" icon="search" placeholder="اسم المريض أو الجوال أو رقم الملف أو الهوية" value={q} onChange={(e) => setQ(e.target.value)} />
          {results.length > 0 && (
            <div className="choice-grid" style={{ margin: '8px 0 14px' }}>
              {results.map((x) => (
                <button key={x.id} type="button" className="choice" onClick={() => { setPatientId(x.id); setQ(''); }}>
                  <span className="choice__ic"><Icon name="user" size={18} /></span>
                  <span><strong>{x.fullName}</strong><span> {x.fileNo} · <span className="num">{x.phone}</span></span></span>
                </button>
              ))}
            </div>
          )}
        </>
      )}

      <dl className="review-list" style={{ marginTop: 10 }}>
        <div><dt>سعر الوحدة</dt><dd className="num">{p ? money(p.price) : '—'}</dd></div>
        <div><dt>الإجمالي قبل الخصم</dt><dd className="num">{money(subtotal)}</dd></div>
        {d > 0 && <div><dt>الخصم</dt><dd className="num">- {money(d)}</dd></div>}
        <div><dt>{`ضريبة القيمة المضافة (${taxOk ? taxRate : 0}%)`}</dt><dd className="num">{money(tax)}</dd></div>
        <div><dt><strong>الإجمالي النهائي</strong></dt><dd className="num"><strong>{money(err ? 0 : total)}</strong></dd></div>
      </dl>
      {err && <div className="alert alert-warn" style={{ marginTop: 12 }}><Icon name="alert" size={17} /><div>{err}</div></div>}
    </Modal>
  );
}

// ============ الفاتورة ============
// نفس شكل فاتورة الخدمات المطبوعة
function ProductInvoiceTemplate({ sale, product }: { sale: ProductSale; product: Product | null }) {
  const center = db.center();
  const patient = sale.patientId ? db.patient(sale.patientId) : undefined;
  const paid = sale.status === 'cancelled' ? 0 : sale.total;
  return (
    <div className="pinv" dir="rtl">
      <div className="pinv__top">
        <div className="pinv__brand">
          <img src={`${import.meta.env.BASE_URL}brand/logo.svg`} alt="" />
          <div><h1>{center.name}</h1><p>{[center.city, center.district, center.street].filter(Boolean).join(' – ')}</p><p className="num">{center.phone}</p></div>
        </div>
        <div className="pinv__title"><h2>فاتورة بيع{sale.status === 'cancelled' ? ' (ملغاة)' : ''}</h2><p className="num">{sale.invoiceNo}</p></div>
      </div>
      <dl className="pinv__meta">
        <div><dt>التاريخ</dt><dd className="num date">{fmtDateTime(new Date(sale.createdAt).getTime())}</dd></div>
        <div><dt>رقم الملف</dt><dd className="num">{patient?.fileNo ?? '—'}</dd></div>
        <div><dt>العميل</dt><dd>{customerOf(sale)}</dd></div>
        <div><dt>الموظف</dt><dd>{empName(sale.employeeId)}</dd></div>
        <div><dt>طريقة الدفع</dt><dd>{PAYMENT_METHOD_LABEL[sale.paymentMethod]}</dd></div>
      </dl>
      <table className="pinv__table">
        <thead><tr><th>#</th><th>المنتج</th><th>الكمية</th><th>سعر الوحدة</th><th>الخصم</th><th>الإجمالي</th></tr></thead>
        <tbody><tr>
          <td>1</td>
          <td><div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
            {product?.imageUrl && <img src={product.imageUrl} alt="" style={{ width: 30, height: 30, objectFit: 'cover', borderRadius: 6 }} />}
            <span>{sale.productName}{sale.productSku && <span dir="ltr" style={{ display: 'block', fontSize: 10.5, color: '#666' }}>{sale.productSku}</span>}</span>
          </div></td>
          <td className="num">{sale.qty}</td><td className="num">{money(sale.unitPrice)}</td><td className="num">{money(sale.discount)}</td><td className="num">{money(sale.total)}</td>
        </tr></tbody>
      </table>
      <dl className="pinv__totals">
        <div><dt>الإجمالي قبل الخصم</dt><dd className="num">{money(sale.subtotal)}</dd></div>
        <div><dt>الخصم</dt><dd className="num">{money(sale.discount)}</dd></div>
        <div className="pinv__grand"><dt>الإجمالي المستحق</dt><dd className="num">{money(sale.total)}</dd></div>
        <div><dt>المدفوع</dt><dd className="num">{money(paid)}</dd></div>
      </dl>
      <p className="pinv__words">{amountToArabicWords(sale.total)}</p>
      <div className="pinv__sign"><span>توقيع العميل</span><span>توقيع الموظف</span></div>
    </div>
  );
}

async function downloadSalePdf(sale: ProductSale, product: Product | null) {
  const [{ default: html2canvas }, { jsPDF }, { createRoot }] = await Promise.all([import('html2canvas'), import('jspdf'), import('react-dom/client')]);
  const host = document.createElement('div');
  host.style.cssText = 'position:fixed;top:0;left:-10000px;width:780px;background:#fff;padding:24px;direction:rtl;';
  host.dir = 'rtl';
  document.body.appendChild(host);
  const root = createRoot(host);
  await new Promise<void>((res) => { root.render(<ProductInvoiceTemplate sale={sale} product={product} />); setTimeout(res, 60); });
  await Promise.all(Array.from(host.querySelectorAll('img')).map((img) => img.complete ? null : new Promise((r) => { img.onload = r; img.onerror = r; })));
  try {
    const canvas = await html2canvas(host, { scale: 2, useCORS: true, backgroundColor: '#ffffff' });
    const pdf = new jsPDF({ unit: 'mm', format: 'a4' });
    const w = pdf.internal.pageSize.getWidth();
    pdf.addImage(canvas.toDataURL('image/png'), 'PNG', 0, 0, w, (canvas.height * w) / canvas.width);
    pdf.save(`${sale.invoiceNo}.pdf`);
  } finally { root.unmount(); host.remove(); }
}

function InvoiceModal({ saleId, onClose }: { saleId: string; onClose: () => void }) {
  const toast = useToast();
  const [sale, setSale] = useState<ProductSale | null>(null);
  const [product, setProduct] = useState<Product | null>(null);
  const [busy, setBusy] = useState(false);
  useEffect(() => { productsApi.sale(saleId).then(async (s) => { setSale(s); if (s) setProduct(await productsApi.product(s.productId)); }); }, [saleId]);
  const download = async () => {
    if (!sale) return;
    setBusy(true);
    try { await downloadSalePdf(sale, product); } catch { toast.error('تعذّر إنشاء ملف PDF.'); }
    setBusy(false);
  };
  return (
    <Modal title={sale ? `فاتورة ${sale.invoiceNo}` : 'الفاتورة'} onClose={onClose} wide footer={
      <div className="no-print" style={{ display: 'contents' }}>
        <Button variant="outline" onClick={onClose}>إغلاق</Button>
        <Button variant="outline" icon="download" onClick={download} loading={busy} disabled={!sale}>تحميل PDF</Button>
        <Button icon="print" onClick={() => window.print()} disabled={!sale}>طباعة</Button>
      </div>
    }>
      {!sale ? <Skeleton h={300} /> : <div className="print-area"><ProductInvoiceTemplate sale={sale} product={product} /></div>}
    </Modal>
  );
}

function CancelSaleModal({ sale, onClose, onDone }: { sale: ProductSale; onClose: () => void; onDone: () => void }) {
  const toast = useToast();
  const [reason, setReason] = useState('');
  const [busy, setBusy] = useState(false);
  const submit = async () => {
    setBusy(true);
    const r = await productsApi.cancelSale(sale.id, reason);
    setBusy(false);
    if (!r.ok) { toast.error(r.error); return; }
    toast.success(`تم إلغاء الفاتورة ${sale.invoiceNo} وإرجاع الكمية.`);
    onDone(); onClose();
  };
  return (
    <Modal title={`إلغاء عملية البيع ${sale.invoiceNo}`} onClose={onClose} footer={<><Button variant="outline" onClick={onClose} disabled={busy}>رجوع</Button><Button variant="danger" onClick={submit} loading={busy}>تأكيد الإلغاء</Button></>}>
      <div className="alert alert-warn"><Icon name="alert" size={17} /><div>سيتم إلغاء الفاتورة وإرجاع <strong className="num">{sale.qty}</strong> من «{sale.productName}» للكمية المتاحة.</div></div>
      <Input id="cs-reason" label="سبب الإلغاء (اختياري)" value={reason} onChange={(e) => setReason(e.target.value)} />
    </Modal>
  );
}

// ============ تبويب المنتجات ============
function ProductsTab({ products, reload, onSell }: { products: Product[]; reload: () => void; onSell: (p: Product | null) => void }) {
  const can = useCan();
  const toast = useToast();
  const [q, setQ] = useState('');
  const [status, setStatus] = useState('');
  const [cat, setCat] = useState('');
  const categories = [...new Set(products.map((x) => x.category).filter(Boolean))].sort();
  const [editing, setEditing] = useState<Product | 'new' | null>(null);
  const [stocking, setStocking] = useState<Product | null>(null);
  const [deleting, setDeleting] = useState<Product | null>(null);
  const list = products.filter((p) => {
    const s = q.trim().toLowerCase();
    const a = availability(p).label;
    return (!s || p.name.toLowerCase().includes(s) || p.sku.toLowerCase().includes(s) || p.category.toLowerCase().includes(s)) && (!status || a === status) && (!cat || p.category === cat);
  });
  return (
    <>
      <FilterBar>
        <Input id="pr-q" icon="search" placeholder="ابحث باسم المنتج أو الكود" value={q} onChange={(e) => setQ(e.target.value)} />
        {categories.length > 0 && <Select id="pr-cat-f" value={cat} onChange={(e) => setCat(e.target.value)} options={[{ value: '', label: 'كل التصنيفات' }, ...categories.map((c) => ({ value: c, label: c }))]} />}
        <Select id="pr-status" value={status} onChange={(e) => setStatus(e.target.value)} options={[{ value: '', label: 'كل الحالات' }, { value: 'متاح', label: 'متاح' }, { value: 'غير متوفر', label: 'غير متوفر' }, { value: 'غير متاح', label: 'غير متاح' }]} />
        {can('products', 'create') && <Button icon="calendarPlus" onClick={() => setEditing('new')}>إضافة منتج</Button>}
      </FilterBar>
      {list.length === 0 ? (
        <div className="card"><div className="card__body"><EmptyState icon="box" title={products.length ? 'ما فيه نتائج' : 'ما فيه منتجات بعد'} text={products.length ? undefined : 'أضف أول منتج (مخدة، زيت، كريم…) لبدء البيع.'} /></div></div>
      ) : (
        <div className="table-wrap"><table className="table">
          <thead><tr><th>الصورة</th><th>المنتج</th><th>التصنيف</th><th>الكود</th><th>السعر</th><th>الكمية المتاحة</th><th>الحالة</th><th className="actions"></th></tr></thead>
          <tbody>
            {list.map((p) => {
              const a = availability(p);
              const canSell = p.active && p.quantity > 0;
              return (
                <tr key={p.id}>
                  <td><ProductThumb p={p} /></td>
                  <td><strong>{p.name}</strong>{p.description && <div className="muted-sm">{p.description}</div>}</td>
                  <td>{p.category || '—'}</td>
                  <td dir="ltr">{p.sku}</td>
                  <td className="num">{money(p.price)}</td>
                  <td className="num" style={{ fontWeight: 700, color: p.quantity === 0 ? 'var(--danger)' : undefined }}>{p.quantity > 0 ? p.quantity : ''}</td>
                  <td><StatusBadge label={a.label} tone={a.tone} /></td>
                  <td className="actions">
                    <RowActions>
                      {can('products', 'create') && <Button size="sm" icon="receipt" disabled={!canSell} title={canSell ? '' : a.label} onClick={() => onSell(p)}>بيع</Button>}
                      {can('products', 'edit') && <IconAction icon="box" label="إضافة كمية" onClick={() => setStocking(p)} />}
                      {can('products', 'edit') && <IconAction icon="edit" label="تعديل" onClick={() => setEditing(p)} />}
                      {can('products', 'delete') && <IconAction icon="trash" label="حذف" danger onClick={() => setDeleting(p)} />}
                    </RowActions>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table></div>
      )}
      {editing && <ProductModal product={editing === 'new' ? null : editing} categories={categories} onClose={() => setEditing(null)} onSaved={reload} />}
      {stocking && <StockModal product={stocking} onClose={() => setStocking(null)} onSaved={reload} />}
      {deleting && <ConfirmDialog title={`حذف المنتج «${deleting.name}»`}
        message="إذا كانت للمنتج عمليات بيع سابقة، فسيُعطَّل (غير متاح) بدل الحذف حفاظًا على سلامة سجل المبيعات والفواتير."
        onClose={() => setDeleting(null)}
        onConfirm={async () => {
          const r = await productsApi.remove(deleting.id);
          if (!r.ok) { toast.error(r.error); return; }
          if (r.mode === 'deleted' && deleting.imagePath) productsApi.removeImage(deleting.imagePath);
          toast.success(r.mode === 'disabled' ? 'المنتج له مبيعات سابقة — تم تعطيله بدل الحذف.' : 'تم حذف المنتج.');
          setDeleting(null); reload();
        }} />}
    </>
  );
}

// ============ سجل المبيعات ============
function SalesTab({ sales, products, reload, onView }: { sales: ProductSale[]; products: Product[]; reload: () => void; onView: (id: string) => void }) {
  const can = useCan();
  const [q, setQ] = useState('');
  const [product, setProduct] = useState('');
  const [emp, setEmp] = useState('');
  const [status, setStatus] = useState('');
  const [from, setFrom] = useState('');
  const [to, setTo] = useState('');
  const [cancelling, setCancelling] = useState<ProductSale | null>(null);
  const emps = [...new Set(sales.map((s) => s.employeeId).filter(Boolean))] as string[];
  const list = sales.filter((s) => {
    const d = riyadhYmd(new Date(s.createdAt));
    const t = q.trim().toLowerCase();
    return (!t || s.invoiceNo.toLowerCase().includes(t) || textMatches(customerOf(s), t) || (!!s.patientId && patientMatches(db.patient(s.patientId), t)))
      && (!product || s.productId === product) && (!emp || s.employeeId === emp) && (!status || s.status === status)
      && (!from || d >= from) && (!to || d <= to);
  });
  const exportIt = () => exportCsv('sales.csv', ['رقم الفاتورة', 'المنتج', 'الكمية', 'الإجمالي', 'العميل', 'الموظف', 'التاريخ', 'الحالة'],
    list.map((s) => [s.invoiceNo, s.productName, s.qty, s.total, customerOf(s), empName(s.employeeId), fmtDateTime(new Date(s.createdAt).getTime()), SALE_STATUS[s.status].label]));
  return (
    <>
      <FilterBar>
        <Input id="sa-q" icon="search" placeholder="رقم الفاتورة أو اسم العميل" value={q} onChange={(e) => setQ(e.target.value)} />
        <Select id="sa-product" value={product} onChange={(e) => setProduct(e.target.value)} options={[{ value: '', label: 'كل المنتجات' }, ...products.map((p) => ({ value: p.id, label: p.name }))]} />
        <Select id="sa-emp" value={emp} onChange={(e) => setEmp(e.target.value)} options={[{ value: '', label: 'كل الموظفين' }, ...emps.map((id) => ({ value: id, label: empName(id) }))]} />
        <Select id="sa-status" value={status} onChange={(e) => setStatus(e.target.value)} options={[{ value: '', label: 'كل الحالات' }, { value: 'completed', label: 'مكتملة' }, { value: 'cancelled', label: 'ملغاة' }]} />
        <Input id="sa-from" type="date" label="من" value={from} onChange={(e) => setFrom(e.target.value)} />
        <Input id="sa-to" type="date" label="إلى" value={to} onChange={(e) => setTo(e.target.value)} />
        <Button variant="outline" icon="download" onClick={exportIt} disabled={!list.length}>تصدير</Button>
      </FilterBar>
      {list.length === 0 ? <div className="card"><div className="card__body"><EmptyState icon="receipt" title={sales.length ? 'ما فيه نتائج' : 'ما فيه مبيعات بعد'} /></div></div> : (
        <div className="table-wrap"><table className="table">
          <thead><tr><th>رقم الفاتورة</th><th>المنتج</th><th>الكمية</th><th>إجمالي البيع</th><th>العميل/المريض</th><th>الموظف</th><th>التاريخ والوقت</th><th>الحالة</th><th className="actions"></th></tr></thead>
          <tbody>
            {list.map((s) => (
              <tr key={s.id}>
                <td dir="ltr"><strong>{s.invoiceNo}</strong></td>
                <td>{s.productName}<div className="muted-sm" dir="ltr">{s.productSku}</div></td>
                <td className="num">{s.qty}</td>
                <td className="num">{money(s.total)}</td>
                <td>{customerOf(s)}</td>
                <td>{empName(s.employeeId)}</td>
                <td>{fmtDateTime(new Date(s.createdAt).getTime())}</td>
                <td><StatusBadge label={SALE_STATUS[s.status].label} tone={SALE_STATUS[s.status].tone} />{s.cancelReason && <div className="muted-sm">{s.cancelReason}</div>}</td>
                <td className="actions">
                  <RowActions>
                    <IconAction icon="eye" label="عرض الفاتورة" onClick={() => onView(s.id)} />
                    {s.status === 'completed' && can('products', 'delete') && <IconAction icon="close" label="إلغاء العملية" danger onClick={() => setCancelling(s)} />}
                  </RowActions>
                </td>
              </tr>
            ))}
          </tbody>
        </table></div>
      )}
      {cancelling && <CancelSaleModal sale={cancelling} onClose={() => setCancelling(null)} onDone={reload} />}
    </>
  );
}

// ============ التقارير ============
function ReportTab({ sales }: { sales: ProductSale[] }) {
  const today = riyadhTodayYmd();
  const [from, setFrom] = useState(addDaysYmd(today, -29));
  const [to, setTo] = useState(today);
  const done = sales.filter((s) => { const d = riyadhYmd(new Date(s.createdAt)); return s.status === 'completed' && d >= from && d <= to; });
  const revenue = done.reduce((a, s) => a + s.total, 0);
  const units = done.reduce((a, s) => a + s.qty, 0);
  const byProduct = Object.values(done.reduce<Record<string, { name: string; qty: number; total: number }>>((m, s) => {
    (m[s.productId] ??= { name: s.productName, qty: 0, total: 0 }); m[s.productId].qty += s.qty; m[s.productId].total += s.total; return m;
  }, {})).sort((a, b) => b.qty - a.qty);
  // تجميع يومي لو الفترة ≤ 31 يوم، غير كده شهري
  const days = Math.round((new Date(to).getTime() - new Date(from).getTime()) / 86400000) + 1;
  const monthly = days > 31;
  const buckets = new Map<string, number>();
  if (!monthly) for (let d = from; d <= to; d = addDaysYmd(d, 1)) buckets.set(d, 0);
  for (const s of done) { const d = riyadhYmd(new Date(s.createdAt)); const k = monthly ? d.slice(0, 7) : d; buckets.set(k, (buckets.get(k) ?? 0) + s.total); }
  const series = [...buckets.entries()].sort(([a], [b]) => a.localeCompare(b)).map(([k, v]) => ({ label: monthly ? k : k.slice(5), value: Math.round(v) }));
  return (
    <>
      <FilterBar>
        <Input id="rp-from" type="date" label="من" value={from} onChange={(e) => setFrom(e.target.value)} />
        <Input id="rp-to" type="date" label="إلى" value={to} onChange={(e) => setTo(e.target.value)} />
      </FilterBar>
      <div className="kpi-grid">
        <StatCard icon="wallet" tone="ok" value={money(revenue)} label="إجمالي المبيعات" />
        <StatCard icon="box" tone="info" value={units} label="عدد المنتجات المباعة" />
        <StatCard icon="receipt" tone="brand" value={done.length} label="عدد عمليات البيع" />
      </div>
      <section className="card" style={{ marginBottom: 18 }}>
        <div className="card__head"><h2>المبيعات حسب الفترة {monthly ? '(شهري)' : '(يومي)'}</h2></div>
        <div className="card__body">{done.length ? <BarChart data={series} format={(n) => n.toLocaleString('en-US')} /> : <EmptyState icon="trend" title="ما فيه مبيعات في هذي الفترة" />}</div>
      </section>
      <section className="card">
        <div className="card__head"><h2>أكثر المنتجات مبيعًا</h2></div>
        <div className="card__body">
          {byProduct.length === 0 ? <EmptyState icon="box" title="ما فيه مبيعات في هذي الفترة" /> : (
            <div className="table-wrap"><table className="table">
              <thead><tr><th>#</th><th>المنتج</th><th>الكمية المباعة</th><th>إجمالي المبيعات</th></tr></thead>
              <tbody>{byProduct.map((p, i) => <tr key={p.name + i}><td className="num">{i + 1}</td><td><strong>{p.name}</strong></td><td className="num">{p.qty}</td><td className="num">{money(p.total)}</td></tr>)}</tbody>
            </table></div>
          )}
        </div>
      </section>
    </>
  );
}

export default function ProductSales() {
  const can = useCan();
  const { products, sales, error, reload } = useProductsData();
  const [tab, setTab] = useState<'products' | 'sales' | 'report'>('products');
  const [selling, setSelling] = useState<Product | null | false>(false);
  const [viewing, setViewing] = useState<string | null>(null);

  const out = (products ?? []).filter((p) => p.active && p.quantity === 0).length;
  const todayStr = riyadhTodayYmd();
  const todaySales = (sales ?? []).filter((s) => s.status === 'completed' && riyadhYmd(new Date(s.createdAt)) === todayStr);

  return (
    <div className="page">
      <div className="page-head">
        <div><h1>بيع المنتجات</h1><p>إدارة وبيع منتجات المركز (مخدات، زيوت، كريمات…) — مستقل عن المخزون العام.</p></div>
        {can('products', 'create') && <Button icon="receipt" onClick={() => setSelling(null)}>بيع منتج</Button>}
      </div>
      {error && <div className="alert alert-danger"><Icon name="alert" size={17} /><div>{error}</div></div>}
      {products === null || sales === null ? <Skeleton h={240} /> : (
        <>
          <div className="kpi-grid">
            <StatCard icon="box" tone="brand" value={products.length} label="عدد المنتجات" />
            <StatCard icon="alert" tone="danger" value={out} label="منتجات غير متوفرة" />
            <StatCard icon="wallet" tone="ok" value={money(todaySales.reduce((a, s) => a + s.total, 0))} label="مبيعات اليوم" />
          </div>
          <div className="svc-tabs">
            <button type="button" className={`svc-tab ${tab === 'products' ? 'active' : ''}`} onClick={() => setTab('products')}>المنتجات</button>
            <button type="button" className={`svc-tab ${tab === 'sales' ? 'active' : ''}`} onClick={() => setTab('sales')}>سجل المبيعات</button>
            <button type="button" className={`svc-tab ${tab === 'report' ? 'active' : ''}`} onClick={() => setTab('report')}>ملخص المبيعات</button>
          </div>
          {tab === 'products' && <ProductsTab products={products} reload={reload} onSell={setSelling} />}
          {tab === 'sales' && <SalesTab sales={sales} products={products} reload={reload} onView={setViewing} />}
          {tab === 'report' && <ReportTab sales={sales} />}
          {selling !== false && <SellModal products={products} preset={selling} onClose={() => setSelling(false)} onSold={(id) => { setSelling(false); reload(); setViewing(id); }} />}
          {viewing && <InvoiceModal saleId={viewing} onClose={() => setViewing(null)} />}
        </>
      )}
    </div>
  );
}
