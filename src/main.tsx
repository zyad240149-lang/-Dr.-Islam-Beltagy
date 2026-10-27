import React from 'react';
import ReactDOM from 'react-dom/client';
import { BrowserRouter } from 'react-router-dom';
import App from './App';
import { AuthProvider } from './services/auth';
import { ToastProvider } from './hooks/useToast';
import { ErrorBoundary } from './components/ErrorBoundary';
import './index.css';
import './ortho/ortho.css';
import './styles/system.css';
import { initPwa } from './pwa/pwa';
import { initI18n } from './i18n';

// Vite: فشل تحميل ملف قسم بعد رفع نسخة جديدة → تحديث مرة واحدة (والعلامة بتتمسح لما الصفحة تشتغل)
window.addEventListener('vite:preloadError', (e) => {
  try { if (!sessionStorage.getItem('ortho_chunk_reload')) { e.preventDefault(); sessionStorage.setItem('ortho_chunk_reload', '1'); window.location.reload(); } } catch { /* ignore */ }
});
setTimeout(() => { try { sessionStorage.removeItem('ortho_chunk_reload'); } catch { /* ignore */ } }, 10000);
initPwa(); // قبل رسم الواجهة عشان مانفوّتش حدث beforeinstallprompt

// اللغة (عربي/إنجليزي) قبل أول رسم عشان مايبانش العربي ثانية وبعدين يتبدّل
initI18n().catch(() => {}).finally(() => ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <BrowserRouter basename={import.meta.env.BASE_URL.replace(/\/$/, '') || undefined}>
      <ErrorBoundary label="root">
        <ToastProvider>
          <AuthProvider>
            <App />
          </AuthProvider>
        </ToastProvider>
      </ErrorBoundary>
    </BrowserRouter>
  </React.StrictMode>,
));
