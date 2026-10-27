import { Component, type ErrorInfo, type ReactNode } from 'react';
import { Icon } from '../utils/icons';

// شبكة أمان: بدونها أي خطأ غير متوقع أثناء رسم أي صفحة (بيانات ناقصة، تاريخ غير صالح، خلل مؤقت في الشبكة...)
// كان يخلي الصفحة كلها بيضاء تمامًا بدون أي رسالة ولا طريقة للتعافي غير إعادة تحميل يدوية.
// هنا بنلتقط الخطأ، نسجّله في الـ console للتشخيص، ونعرض رسالة واضحة مع زر إعادة المحاولة/التحميل.
interface Props { children: ReactNode; label?: string }
interface State { error: Error | null }

export class ErrorBoundary extends Component<Props, State> {
  state: State = { error: null };

  static getDerivedStateFromError(error: Error): State {
    return { error };
  }

  componentDidCatch(error: Error, info: ErrorInfo) {
    // eslint-disable-next-line no-console
    console.error('[ErrorBoundary]', this.props.label ?? '', error, info.componentStack);
    // نسخة جديدة اترفعت والصفحة المفتوحة بتطلب ملف قسم اتشال: تحديث مرة واحدة بيجيب النسخة الجديدة
    if (/dynamically imported module|Importing a module script failed|Failed to fetch dynamically|error loading dynamically/i.test(String(error?.message))) {
      try { if (!sessionStorage.getItem('ortho_chunk_reload')) { sessionStorage.setItem('ortho_chunk_reload', '1'); window.location.reload(); } } catch { /* ignore */ }
    }
  }

  render() {
    if (this.state.error) {
      return (
        <div className="page" style={{ minHeight: 320, display: 'grid', placeItems: 'center', textAlign: 'center' }}>
          <div>
            <Icon name="alert" size={34} />
            <h2 style={{ margin: '14px 0 6px' }}>حدث خطأ غير متوقع</h2>
            <p className="muted" style={{ marginBottom: 16 }}>تعذّر عرض هذا القسم. جرّب إعادة المحاولة، ولو تكررت المشكلة بلّغ الدعم الفني.</p>
            <button className="btn btn--primary" onClick={() => { this.setState({ error: null }); }} style={{ marginInlineEnd: 8 }}>إعادة المحاولة</button>
            <button className="btn btn--outline" onClick={() => location.reload()}>تحديث الصفحة</button>
          </div>
        </div>
      );
    }
    return this.props.children;
  }
}
